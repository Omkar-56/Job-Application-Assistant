import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSearchCriteria() {
  const raw = readFileSync(path.join(__dirname, 'searchCriteria.json'), 'utf-8');
  return JSON.parse(raw);
}

function loadFilterRules() {
  const raw = readFileSync(path.join(__dirname, 'filterRules.json'), 'utf-8');
  return JSON.parse(raw);
}

export const config = {
  headless: (process.env.HEADLESS ?? 'false').toLowerCase() === 'true',
  maxPages: Number(process.env.MAX_PAGES ?? 3),
  naukri: {
    email: process.env.NAUKRI_EMAIL || null,
    password: process.env.NAUKRI_PASSWORD || null,
    storageStatePath: path.join(__dirname, '..', '..', 'auth', 'naukri-state.json'),
  },
  search: loadSearchCriteria(),
  filterRules: loadFilterRules(),
  dataDir: path.join(__dirname, '..', '..', 'data'),
  db: {
    connectionString: process.env.DATABASE_URL || null,
    // 'postgres' (default, Phase 3) or 'json' (Phase 1/2 fallback for quick local testing)
    backend: (process.env.STORAGE_BACKEND || 'postgres').toLowerCase(),
  },
  apply: {
    // Safety default: nothing is ever actually submitted unless DRY_RUN is
    // explicitly set to "false" in .env.
    dryRun: (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
    maxPerRun: Number(process.env.MAX_APPLICATIONS_PER_RUN ?? 5),
  },
};
