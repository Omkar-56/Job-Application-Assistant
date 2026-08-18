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
  };
}
