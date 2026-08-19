import { config } from './config/config.js';
import { NaukriAdapter } from './adapters/naukri/naukriAdapter.js';
import { createStore } from './storage/createStore.js';
import { applyFilters } from './filters/ruleBasedFilter.js';
import { ManualAnswerStrategy } from './apply/answerStrategies/ManualAnswerStrategy.js';

async function main() {
  console.log('=== Job Application Assistant — Phase 4: Applying ===');
  console.log(`DRY_RUN: ${config.apply.dryRun}`);
  console.log(`Max applications this run: ${config.apply.maxPerRun}`);
  if (!config.apply.dryRun) {
    console.log(
      '!!! DRY_RUN is OFF — this run will actually click Apply and may ' +
        'submit real applications. Ctrl+C now if that is not what you want. !!!'
    );
  }

  const adapter = new NaukriAdapter({
    headless: config.headless,
    storageStatePath: config.naukri.storageStatePath,
    credentials: config.naukri.email && config.naukri.password
      ? { email: config.naukri.email, password: config.naukri.password }
      : null,
  });

  const store = createStore(config, 'naukri');
  const answerStrategy = new ManualAnswerStrategy({ headless: config.headless });

  const tally = { applied: 0, dry_run: 0, needs_manual_review: 0, failed: 0 };

  try {
    await adapter.login();

    const allJobs = await store.all();
    const { matched } = applyFilters(allJobs, config.filterRules);

    const pending = matched.filter(
      (job) => (job.applicationStatus ?? 'discovered') === 'discovered'
    );
    console.log(
      `\n[apply] ${matched.length} jobs pass the filter; ${pending.length} of those ` +
        `haven't been touched yet.`
    );

    const batch = pending.slice(0, config.apply.maxPerRun);
    if (batch.length < pending.length) {
      console.log(
        `[apply] Only processing the first ${batch.length} (MAX_APPLICATIONS_PER_RUN=${config.apply.maxPerRun}). ` +
          `Run again to continue with the rest.`
      );
    }

    for (const job of batch) {
      const result = await adapter.applyToJob(job, { dryRun: config.apply.dryRun, answerStrategy });
      await store.updateApplicationStatus(job.portalJobId, result.status);
      tally[result.status] = (tally[result.status] ?? 0) + 1;
      console.log(`[apply] "${job.title}" — ${job.company} → ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
    }

    console.log('\n=== Summary ===');
    console.log(`Applied: ${tally.applied}`);
    console.log(`Dry-run (not actually submitted): ${tally.dry_run}`);
    console.log(`Needs manual review: ${tally.needs_manual_review}`);
    console.log(`Failed: ${tally.failed}`);
    if (tally.needs_manual_review > 0) {
      console.log(
        '\nSome jobs need manual review — either the recruiter questions ' +
          'timed out, or the run was headless. Set HEADLESS=false and re-run ' +
          'to handle them by hand for now.'
      );
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
