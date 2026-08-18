import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Minimal JSON-file-backed store, scoped to a single portal, that persists
 * discovered jobs and lets discover() dedupe against previous runs.
 *
 * This is intentionally the only place that knows jobs are stored as a JSON
 * file. In Phase 3 this gets replaced by a PostgreSQL-backed store with the
 * same three methods (load / has / addMany), so nothing else in the codebase
 * needs to change.
 */
export class JobStore {
  constructor(dataDir, portal) {
    this.filePath = path.join(dataDir, `${portal}-jobs.json`);
    this._jobs = new Map(); // portalJobId -> job
    this._loaded = false;
  }

  load() {
    if (!existsSync(path.dirname(this.filePath))) {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
    }
    if (existsSync(this.filePath)) {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      for (const job of raw) this._jobs.set(job.portalJobId, job);
    }
    this._loaded = true;
  }

  has(portalJobId) {
    if (!this._loaded) this.load();
    return this._jobs.has(portalJobId);
  }

  /** Adds jobs not already present. Returns only the newly-added jobs. */
  addMany(jobs) {
    if (!this._loaded) this.load();
    const added = [];
    for (const job of jobs) {
      if (!this._jobs.has(job.portalJobId)) {
        this._jobs.set(job.portalJobId, job);
        added.push(job);
      }
    }
    this._save();
    return added;
  }

  all() {
    if (!this._loaded) this.load();
    return [...this._jobs.values()];
  }

  _save() {
    writeFileSync(this.filePath, JSON.stringify(this.all(), null, 2), 'utf-8');
  }

  /** No-op — kept so callers don't need to branch on which store they have. */
  async close() {}
}
