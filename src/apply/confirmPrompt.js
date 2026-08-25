import { createInterface } from 'node:readline/promises';

/**
 * Shows the LLM's proposed answer and asks for a go-ahead. Runs on the
 * terminal, not the browser — works the same whether the browser itself is
 * headed or headless.
 *
 * @returns {Promise<string|null>} the text to send (proposed, or edited),
 *   or null if the user wants to abort this job.
 */
export async function confirmAnswer(question, proposedAnswer) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n[llm-answer] Recruiter asked: "${question}"`);
    console.log(`[llm-answer] Proposed answer: "${proposedAnswer}"`);
    const response = await rl.question(
      '[llm-answer] Press Enter to send as-is, type a replacement, or "skip" to abort this job: '
    );
    const trimmed = response.trim();
    if (trimmed.toLowerCase() === 'skip') return null;
    return trimmed === '' ? proposedAnswer : trimmed;
  } finally {
    rl.close();
  }
}
