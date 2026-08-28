import { config } from './config/config.js';
import { NaukriAdapter } from './adapters/naukri/naukriAdapter.js';
import { createStore } from './storage/createStore.js';
import { applyFilters } from './filters/ruleBasedFilter.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('=== Job Application Assistant — Naukri Discovery ===');
  console.log(`Criteria: ${JSON.stringify(config.search)}`);
  console.log(`Headless: ${config.headless}`);

  const adapter = new NaukriAdapter({
    headless: config.headless,
    storageStatePath: config.naukri.storageStatePath,
    credentials: config.naukri.email && config.naukri.password
      ? { email: config.naukri.email, password: config.naukri.password }
      : null,
  });

  const store = createStore(config, 'naukri');

  try {
    await adapter.login();
    const discovered = await adapter.discover({ ...config.search, maxPages: config.maxPages });
    console.log(`\n[result] Discovered ${discovered.length} jobs this run.`);

    // addMany/all work whether the store is sync (JSON) or async (Postgres)
    // — awaiting a plain value just resolves immediately.
    const newJobs = await store.addMany(discovered);
    const allJobs = await store.all();
    console.log(`[result] ${newJobs.length} of those are new (not seen in previous runs).`);
    console.log(`[result] Total jobs tracked so far: ${allJobs.length}`);

    console.log('\n--- New jobs found this run ---');
    for (const job of newJobs) {
      console.log(
        `• ${job.title} — ${job.company} (${job.location || 'location n/a'}) ` +
        `[${job.experience || 'exp n/a'}]\n  ${job.url}`
      );
    }
    if (newJobs.length === 0) {
      console.log('(none — everything discovered was already tracked)');
    }

    console.log('\n=== Applying rule-based filter ===');
    const { matched, rejected } = applyFilters(allJobs, config.filterRules);
    console.log(`[filter] ${matched.length} of ${allJobs.length} tracked jobs pass the current rules.`);

    const filteredPath = path.join(config.dataDir, 'naukri-jobs-filtered.json');
    writeFileSync(filteredPath, JSON.stringify(matched, null, 2), 'utf-8');
    console.log(`[filter] Wrote matched jobs to ${filteredPath}`);

    if (rejected.length) {
      console.log(`\n[filter] ${rejected.length} rejected — reasons (for tuning filterRules.json):`);
      for (const { job, reasons } of rejected) {
        console.log(`  • ${job.title} — ${job.company}: ${reasons.join('; ')}`);
      }
    }
  } finally {
    await adapter.close();
    await store.close();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
