import { AnswerStrategy } from './AnswerStrategy.js';

/**
 * Today's strategy: pause automation and wait for a human to type answers
 * into the chat panel themselves, then detect that they're done by polling
 * until the panel closes. Phase 7's LLMAnswerStrategy will implement the
 * exact same handleQuestions() signature, so swapping it in later is a
 * one-line change in apply.js — not a rewrite.
 */
export class ManualAnswerStrategy extends AnswerStrategy {
  constructor({ headless, timeoutMs = 5 * 60 * 1000, pollMs = 3000 } = {}) {
    super();
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
  }

  async handleQuestions({ job, checkStillOpen }) {
    if (this.headless) {
      console.log(
        `[manual-answer] Running headless — can't prompt you to answer. ` +
          `Flagging "${job.title}" for manual review instead of waiting.`
      );
      return { completed: false, reason: 'headless run cannot collect manual answers' };
    }

    console.log(`\n[manual-answer] >>> Recruiter questions appeared for "${job.title}" (${job.company}). <<<`);
    console.log('[manual-answer] Please answer them in the browser window, then click Save / close the panel.');
    console.log(`[manual-answer] Waiting up to ${Math.round(this.timeoutMs / 60000)} minute(s)...`);

    const start = Date.now();
    let lastReminder = start;

    while (Date.now() - start < this.timeoutMs) {
      const stillOpen = await checkStillOpen();
      if (!stillOpen) {
        console.log(`[manual-answer] Panel closed — treating "${job.title}" as answered.`);
        return { completed: true };
      }

      if (Date.now() - lastReminder > 30_000) {
        console.log('[manual-answer] Still waiting for your answers...');
        lastReminder = Date.now();
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }

    console.log(`[manual-answer] Timed out waiting for answers on "${job.title}" — flagging for review.`);
    return { completed: false, reason: 'timed out waiting for manual answers' };
  }
}
