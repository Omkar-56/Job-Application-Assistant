import pg from 'pg';

const { Pool } = pg;

/**
 * PostgreSQL-backed replacement for JobStore (the JSON-file version). Same
 * shape — load / has / addMany / all / close — so nothing outside this file
 * needed to change conceptually; index.js just picks whichever store to
 * construct based on config.
 *
 * Dedupe is enforced by the database itself via a UNIQUE (portal,
 * portal_job_id) constraint (see schema.sql) — addMany() relies on
 * ON CONFLICT DO NOTHING rather than an in-memory Set, so it stays correct
 * even if multiple discovery runs happen concurrently.
 */
export class PostgresJobStore {
  constructor(connectionString, portal) {
    this.pool = new Pool({ connectionString });
    this.portal = portal;
  }

  /** No-op — kept so callers don't need to branch on which store they have. */
  async load() {}

  async has(portalJobId) {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM jobs WHERE portal = $1 AND portal_job_id = $2',
      [this.portal, portalJobId]
    );
    return rows.length > 0;
  }

  /** Inserts jobs not already present (by portal + portalJobId). Returns only the newly-added jobs. */
  async addMany(jobs) {
    if (!jobs.length) return [];

    const client = await this.pool.connect();
    const added = [];
    try {
      await client.query('BEGIN');
      for (const job of jobs) {
        const { rows } = await client.query(
          `INSERT INTO jobs
             (portal, portal_job_id, title, company, location, experience, skills, posted_date, url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (portal, portal_job_id) DO NOTHING
           RETURNING portal_job_id`,
          [
            this.portal,
            job.portalJobId,
            job.title,
            job.company,
            job.location,
            job.experience,
            JSON.stringify(job.skills || []),
            job.postedDate,
            job.url,
          ]
        );
        if (rows.length) added.push(job);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return added;
  }

  async all() {
    const { rows } = await this.pool.query(
      'SELECT * FROM jobs WHERE portal = $1 ORDER BY discovered_at DESC',
      [this.portal]
    );
    return rows.map(rowToJob);
  }

  /**
   * @param {string} portalJobId
   * @param {'discovered'|'dry_run'|'applied'|'needs_manual_review'|'external_site'|'failed'} status
   */
  async updateApplicationStatus(portalJobId, status) {
    await this.pool.query(
      `UPDATE jobs
       SET application_status = $1,
           applied_at = CASE WHEN $1 = 'applied' THEN now() ELSE applied_at END,
           attempted_at = now()
       WHERE portal = $2 AND portal_job_id = $3`,
      [status, this.portal, portalJobId]
    );
  }

  /**
   * @param {string} portalJobId
   * @param {{ descriptionText: string, score: number, reasoning: string, profileId: number }} match
   */
  async updateJobMatch(portalJobId, { descriptionText, score, reasoning, profileId }) {
    await this.pool.query(
      `UPDATE jobs
       SET description_text = $1,
           match_score = $2,
           match_reasoning = $3,
           matched_profile_id = $4,
           matched_at = now()
       WHERE portal = $5 AND portal_job_id = $6`,
      [descriptionText, score, reasoning, profileId, this.portal, portalJobId]
    );
  }

  /**
   * Jobs successfully applied to today — for the "Applied Today" section.
   * @returns {Promise<object[]>}
   */
  async getAppliedToday() {
    const { rows } = await this.pool.query(
      `SELECT * FROM jobs
       WHERE portal = $1 AND application_status = 'applied' AND applied_at::date = CURRENT_DATE
       ORDER BY applied_at DESC`,
      [this.portal]
    );
    return rows.map(rowToJob);
  }

  /**
   * Jobs that need manual follow-up TODAY — automation failed, or the
   * listing requires applying on the company's own site, attempted today.
   * Filtered by attempted_at (when the apply pipeline last touched it),
   * not discovered_at — a job discovered days ago that just failed today
   * should still show up here.
   * @returns {Promise<object[]>}
   */
  async getNeedsAttention() {
    const { rows } = await this.pool.query(
      `SELECT * FROM jobs
       WHERE portal = $1
         AND application_status IN ('failed', 'external_site')
         AND attempted_at::date = CURRENT_DATE
       ORDER BY attempted_at DESC`,
      [this.portal]
    );
    return rows.map(rowToJob);
  }

  /**
   * Aggregate counts for the dashboard's summary cards.
   * @returns {Promise<{ total: number, byStatus: object, scoredCount: number, avgMatchScore: number|null, appliedLast7Days: number }>}
   */
  async getSummary() {
    const [statusRes, statsRes] = await Promise.all([
      this.pool.query(
        'SELECT application_status, COUNT(*)::int AS count FROM jobs WHERE portal = $1 GROUP BY application_status',
        [this.portal]
      ),
      this.pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE match_score IS NOT NULL)::int AS scored_count,
           ROUND(AVG(match_score)::numeric, 1) AS avg_match_score,
           COUNT(*) FILTER (WHERE applied_at > now() - interval '7 days')::int AS applied_last_7_days
         FROM jobs WHERE portal = $1`,
        [this.portal]
      ),
    ]);

    const byStatus = {};
    for (const row of statusRes.rows) byStatus[row.application_status] = row.count;
    const stats = statsRes.rows[0];

    return {
      total: stats.total,
      byStatus,
      scoredCount: stats.scored_count,
      avgMatchScore: stats.avg_match_score === null ? null : Number(stats.avg_match_score),
      appliedLast7Days: stats.applied_last_7_days,
    };
  }

  /**
   * Filtered, paginated job listing for the dashboard's table.
   * @param {{ status?: string, minScore?: number, search?: string, limit?: number, offset?: number }} [opts]
   * @returns {Promise<{ jobs: object[], total: number }>}
   */
  async listJobs({ status, minScore, search, limit = 50, offset = 0 } = {}) {
    const conditions = ['portal = $1'];
    const params = [this.portal];
    let idx = 2;

    if (status) {
      conditions.push(`application_status = $${idx++}`);
      params.push(status);
    }
    if (minScore !== undefined && minScore !== null) {
      conditions.push(`match_score >= $${idx++}`);
      params.push(minScore);
    }
    if (search) {
      conditions.push(`(title ILIKE $${idx} OR company ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await this.pool.query(`SELECT COUNT(*)::int AS count FROM jobs WHERE ${whereClause}`, params);
    const total = countRes.rows[0].count;

    const listParams = [...params, limit, offset];
    const rowsRes = await this.pool.query(
      `SELECT * FROM jobs WHERE ${whereClause}
       ORDER BY discovered_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      listParams
    );

    return { jobs: rowsRes.rows.map(rowToJob), total };
  }

  async close() {
    await this.pool.end();
  }
}

function rowToJob(row) {
  return {
    portal: row.portal,
    portalJobId: row.portal_job_id,
    title: row.title,
    company: row.company,
    location: row.location,
    experience: row.experience,
    skills: row.skills,
    postedDate: row.posted_date,
    url: row.url,
    applicationStatus: row.application_status,
    appliedAt: row.applied_at,
    attemptedAt: row.attempted_at,
    descriptionText: row.description_text,
    matchScore: row.match_score === null ? null : Number(row.match_score),
    matchReasoning: row.match_reasoning,
    matchedProfileId: row.matched_profile_id,
    matchedAt: row.matched_at,
  };
}
