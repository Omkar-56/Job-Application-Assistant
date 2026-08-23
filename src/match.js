import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { config } from './config/config.js';
import { NaukriAdapter } from './adapters/naukri/naukriAdapter.js';
import { createStore } from './storage/createStore.js';
import { CandidateProfileStore } from './storage/candidateProfileStore.js';
import { applyFilters } from './filters/ruleBasedFilter.js';
import { parseResumePdf } from './matching/resumeParser.js';
import { matchJobToProfile } from './matching/llmMatcher.js';

async function getOrCreateProfile(profileStore) {
  const resumeBuffer = readFileSync(config.matching.resumePath);
  const resumeHash = createHash('sha256').update(resumeBuffer).digest('hex');

  const existing = await profileStore.getByHash(resumeHash);
  if (existing) {
    console.log(`[match] Reusing cached candidate profile (id ${existing.id}) — resume unchanged since last parse.`);
    return existing;
  }

  console.log('[match] New or changed resume detected — parsing with the LLM...');
  const profile = await parseResumePdf(resumeBuffer);
  const created = await profileStore.create(resumeHash, profile);
  console.log(`[match] Parsed and stored as profile id ${created.id}.`);
  return created;
}

async function main() {
  console.log('=== Job Application Assistant — Phase 6: AI Matching ===');

  if (config.db.backend !== 'postgres') {
    throw new Error(
      'AI matching requires STORAGE_BACKEND=postgres (candidate profile ' +
        'versioning is relational). Set it in .env.'
    );
  }

  const profileStore = new CandidateProfileStore(config.db.connectionString);
  const store = createStore(config, 'naukri');
  const adapter = new NaukriAdapter({
    headless: config.headless,
    storageStatePath: config.naukri.storageStatePath,
    credentials: config.naukri.email && config.naukri.password
      ? { email: config.naukri.email, password: config.naukri.password }
      : null,
  });

  try {
    const profile = await getOrCreateProfile(profileStore);

    await adapter.login();

    const allJobs = await store.all();
    const { matched } = applyFilters(allJobs, config.filterRules);
    // Cache check: skip any job already scored under this exact profile
    // version — no re-fetch, no re-score. See README for why this is a
    // deliberate simplification over hashing the JD itself.
    const needsMatch = matched.filter((job) => job.matchedProfileId !== profile.id);
    console.log(
      `\n[match] ${matched.length} jobs pass the local filter; ${needsMatch.length} ` +
        `haven't been scored against profile id ${profile.id} yet.`
    );

    const batch = needsMatch.slice(0, config.matching.maxPerRun);
    if (batch.length < needsMatch.length) {
      console.log(
        `[match] Only scoring the first ${batch.length} (MATCH_MAX_PER_RUN=${config.matching.maxPerRun}). ` +
          `Run again to continue with the rest.`
      );
    }

    for (const job of batch) {
      console.log(`\n[match] Fetching description: ${job.title} — ${job.company}`);
      const description = await adapter.fetchJobDescription(job);
      const result = await matchJobToProfile({ job, description, profile: profile.profile });
      await store.updateJobMatch(job.portalJobId, {
        descriptionText: description,
        score: result.score,
        reasoning: result.reasoning,
        profileId: profile.id,
      });
      console.log(`[match] Score: ${result.score}/100 — ${result.reasoning}`);
    }

    const allAfter = await store.all();
    const scored = allAfter
      .filter((j) => j.matchedProfileId === profile.id && j.matchScore !== null)
      .sort((a, b) => b.matchScore - a.matchScore);

    console.log(`\n=== Top matches (profile id ${profile.id}) ===`);
    for (const job of scored.slice(0, 10)) {
      console.log(`${job.matchScore}/100 — ${job.title} — ${job.company}\n  ${job.url}`);
    }
  } finally {
    await adapter.close();
    await store.close();
    await profileStore.close();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
