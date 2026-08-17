import { config } from './config/config.js';
import { NaukriAdapter } from './adapters/naukri/naukriAdapter.js';
import { JobStore } from './storage/jobStore.js';

async function main() {
  console.log('=== Job Application Assistant — Phase 1: Naukri Discovery ===');
  console.log(`Criteria: ${JSON.stringify(config.search)}`);
  console.log(`Headless: ${config.headless}`);

  const adapter = new NaukriAdapter({
    headless: config.headless,
    storageStatePath: config.naukri.storageStatePath,
    credentials: config.naukri.email && config.naukri.password
      ? { email: config.naukri.email, password: config.naukri.password }
      : null,
  });

  const store = new JobStore(config.dataDir, 'naukri');

  try {
    await adapter.login();
    const discovered = await adapter.discover(config.search);
    console.log(`\n[result] Discovered ${discovered.length} jobs this run.`);

    const newJobs = store.addMany(discovered);
    console.log(`[result] ${newJobs.length} of those are new (not seen in previous runs).`);
    console.log(`[result] Total jobs tracked so far: ${store.all().length}`);

    // console.log('\n--- New jobs found this run ---');
    // for (const job of newJobs) {
    //   console.log(
    //     `• ${job.title} — ${job.company} (${job.location || 'location n/a'}) ` +
    //     `[${job.experience || 'exp n/a'}]\n  ${job.url}`
    //   );
    // }
    if (newJobs.length === 0) {
      console.log('(none — everything discovered was already in data/naukri-jobs.json)');
    }
  } finally {
    await adapter.close();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
