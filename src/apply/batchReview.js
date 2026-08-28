import { createInterface } from 'node:readline/promises';

/**
 * Prints every job about to be attempted this run (with match score and
 * experience for context), and — only when this is a real run, not a dry
 * run — pauses for a single whole-batch confirm before anything is
 * actually clicked. This is the last checkpoint before real applications
 * go out, separate from the per-answer confirm in LLMAnswerStrategy.
 *
 * @param {object[]} batch
 * @param {{ dryRun: boolean }} opts
 * @returns {Promise<boolean>} true to proceed, false to abort without
 *   touching any job
 */
export async function reviewBatch(batch, { dryRun }) {
  console.log(`\n=== Batch review (${batch.length} job(s) this run) ===`);
  for (const job of batch) {
    const score =
      job.matchScore === null || job.matchScore === undefined ? 'unscored' : `${job.matchScore}/100`;
    console.log(`- ${job.title} — ${job.company} | match: ${score} | exp: ${job.experience || 'n/a'}`);
  }

  if (dryRun) {
    console.log('(DRY_RUN is on — nothing will actually be submitted, proceeding without confirmation.)');
    return true;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const response = await rl.question(
      `\nDRY_RUN is OFF. Proceed with these ${batch.length} real application(s)? [y/N]: `
    );
    return response.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}
