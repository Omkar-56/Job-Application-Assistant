/**
 * Contract for handling a portal's "recruiter questions" chat panel once it
 * appears after clicking Apply. This is the deliberate seam between "how we
 * detect/apply to jobs" (adapter's job) and "how we answer questions"
 * (this). LLMAnswerStrategy implements this same method — reading the
 * questions and typing generated answers instead of waiting for a human —
 * and nothing in NaukriAdapter or the apply runner needs to change.
 */
export class AnswerStrategy {
  /**
   * @param {object} args
   * @param {object} args.job - the job being applied to (title, company, url, ...)
   * @param {() => Promise<boolean>} args.checkStillOpen - resolves true
   *   while the questions panel is still open, false once closed.
   * @param {() => Promise<string|null>} args.readCurrentQuestion - reads
   *   the latest question text from the panel, or null if none visible.
   *   Only used by strategies that actually read questions (e.g. an LLM
   *   strategy) — ManualAnswerStrategy ignores it.
   * @param {(text: string) => Promise<void>} args.submitAnswer - types and
   *   submits an answer into the panel. Also only used by strategies that
   *   answer directly.
   * @returns {Promise<{ completed: boolean, reason?: string }>}
   */
  async handleQuestions({ job, checkStillOpen, readCurrentQuestion, submitAnswer }) {
    throw new Error('handleQuestions() not implemented');
  }
}
