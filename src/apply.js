import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { config } from './config/config.js';
import { NaukriAdapter } from './adapters/naukri/naukriAdapter.js';
import { createStore } from './storage/createStore.js';
import { CandidateProfileStore } from './storage/candidateProfileStore.js';
import { applyFilters } from './filters/ruleBasedFilter.js';
import { ManualAnswerStrategy } from './apply/answerStrategies/ManualAnswerStrategy.js';
import { LLMAnswerStrategy } from './apply/answerStrategies/LLMAnswerStrategy.js';
import { reviewBatch } from './apply/batchReview.js';

async function createAnswerStrategy() {
  if (config.apply.answerStrategy !== 'llm') {
    console.log('[apply] Using manual answer strategy (ANSWER_STRATEGY=manual).');
    return { strategy: new ManualAnswerStrategy({ headless: config.headless }), profileStore: null };
  }

  if (config.db.backend !== 'postgres') {
    throw new Error('ANSWER_STRATEGY=llm requires STORAGE_BACKEND=postgres (candidate profiles are relational).');
  }

  const profileStore = new CandidateProfileStore(config.db.connectionString);
  const resumeBuffer = readFileSync(config.matching.resumePath);
  const resumeHash = createHash('sha256').update(resumeBuffer).digest('hex');
  const profileRow = await profileStore.getByHash(resumeHash);
  if (!profileRow) {
    await profileStore.close();
    throw new Error(
      'No candidate profile found for the current resume. Run `npm run match` ' +
        'first — it parses your resume once and this reuses that.'
    );
  }

  console.log(
    `[apply] Using LLM answer strategy (profile id ${profileRow.id}, ` +
      `AUTO_CONFIRM_ANSWERS=${config.apply.autoConfirmAnswers}).`
  );
  const strategy = new LLMAnswerStrategy({
    profile: profileRow.profile,
    autoConfirm: config.apply.autoConfirmAnswers,
  });
  return { strategy, profileStore };
}

async function main() {
  console.log('=== Job Application Assistant — Applying ===');
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
    resumePath: config.matching.resumePath,
  });

  const store = createStore(config, 'naukri');
  const { strategy: answerStrategy, profileStore } = await createAnswerStrategy();

  const tally = { applied: 0, dry_run: 0, needs_manual_review: 0, external_site: 0, failed: 0 };

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

    if (batch.length === 0) {
      console.log('[apply] Nothing to apply to this run.');
    } else {
      const proceed = await reviewBatch(batch, { dryRun: config.apply.dryRun });
      if (!proceed) {
        console.log('[apply] Aborted at batch review — no jobs were touched.');
        return;
      }

      for (const job of batch) {
        const result = await adapter.applyToJob(job, { dryRun: config.apply.dryRun, answerStrategy });
        await store.updateApplicationStatus(job.portalJobId, result.status);
        tally[result.status] = (tally[result.status] ?? 0) + 1;
        console.log(`[apply] "${job.title}" — ${job.company} → ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Applied: ${tally.applied}`);
    console.log(`Dry-run (not actually submitted): ${tally.dry_run}`);
    console.log(`Needs manual review: ${tally.needs_manual_review}`);
    console.log(`Requires applying on company site (not automated): ${tally.external_site}`);
    console.log(`Failed: ${tally.failed}`);
    if (tally.needs_manual_review > 0) {
      console.log(
        '\nSome jobs need manual review — either the recruiter questions ' +
          'timed out, or the run was headless. Set HEADLESS=false and re-run ' +
          'to handle them by hand for now.'
      );
    }
    if (tally.external_site > 0) {
      console.log(
        `\n${tally.external_site} job(s) redirect to the company's own site — ` +
          'check application_status = \'external_site\' in the DB and apply to those by hand.'
      );
    }
  } finally {
    await adapter.close();
    await store.close();
    if (profileStore) await profileStore.close();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
