import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSearchCriteria() {
  const raw = readFileSync(path.join(__dirname, 'searchCriteria.json'), 'utf-8');
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
  dataDir: path.join(__dirname, '..', '..', 'data'),
};
