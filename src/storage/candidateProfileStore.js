import pg from 'pg';

const { Pool } = pg;

/**
 * Candidate profiles are their own entity (not a "job"), so this is a
 * separate small store rather than bolted onto JobStore/PostgresJobStore.
 * Postgres-only by design — versioning via a resume_hash UNIQUE constraint
 * is inherently relational, and the JSON file store remains a lightweight
 * fallback for the discovery/filter/apply phases only.
 */
export class CandidateProfileStore {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString });
  }

  /** @returns {Promise<{ id: number, profile: object } | null>} */
  async getByHash(resumeHash) {
    const { rows } = await this.pool.query(
      'SELECT id, profile FROM candidate_profiles WHERE resume_hash = $1',
      [resumeHash]
    );
    if (!rows.length) return null;
    return { id: rows[0].id, profile: rows[0].profile };
  }

  /** @returns {Promise<{ id: number, profile: object }>} */
  async create(resumeHash, profile) {
    const { rows } = await this.pool.query(
      `INSERT INTO candidate_profiles (resume_hash, profile)
       VALUES ($1, $2)
       ON CONFLICT (resume_hash) DO UPDATE SET resume_hash = EXCLUDED.resume_hash
       RETURNING id, profile`,
      [resumeHash, JSON.stringify(profile)]
    );
    return { id: rows[0].id, profile: rows[0].profile };
  }

  async close() {
    await this.pool.end();
  }
}
