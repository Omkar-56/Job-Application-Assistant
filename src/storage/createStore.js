import { JobStore } from './jobStore.js';
import { PostgresJobStore } from './postgresJobStore.js';

export function createStore(config, portal) {
  if (config.db.backend === 'json') {
    console.log('[storage] Using JSON file store (STORAGE_BACKEND=json).');
    return new JobStore(config.dataDir, portal);
  }
  if (!config.db.connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Set it in .env (see .env.example), or set ' +
        'STORAGE_BACKEND=json to use the JSON file store instead.'
    );
  }
  console.log('[storage] Using PostgreSQL store.');
  return new PostgresJobStore(config.db.connectionString, portal);
}
