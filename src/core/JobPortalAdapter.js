/**
 * Base contract every portal adapter (Naukri, Wellfound, Indeed, LinkedIn...)
 * must implement. Nothing in src/core or src/storage should ever import a
 * portal-specific module directly — only this interface.
 *
 * A "job" object returned by discover() should always have this shape:
 * {
 *   portal: string,        // e.g. "naukri"
 *   portalJobId: string,   // stable unique id from the portal (for dedupe)
 *   title: string,
 *   company: string,
 *   location: string,
 *   experience: string,
 *   skills: string[],
 *   postedDate: string,
 *   url: string,
 * }
 */
export class JobPortalAdapter {
  /** @returns {Promise<void>} */
  async login() {
    throw new Error('login() not implemented');
  }

  /**
   * @param {object} criteria - portal-agnostic search criteria (keywords, location, etc.)
   * @returns {Promise<object[]>} discovered jobs, already deduplicated within this run
   */
  async discover(criteria) {
    throw new Error('discover() not implemented');
  }

  /**
   * Applies to a single job (or, in dry-run mode, reports what it would do).
   * @param {object} job
   * @param {{ dryRun: boolean, answerStrategy: object }} opts
   * @returns {Promise<{ status: 'applied'|'dry_run'|'needs_manual_review'|'failed', reason?: string }>}
   */
  async applyToJob(job, opts) {
    throw new Error('applyToJob() not implemented');
  }

  /** @returns {Promise<void>} */
  async close() {
    throw new Error('close() not implemented');
  }
}
