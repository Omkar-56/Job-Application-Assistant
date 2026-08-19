/**
 * Contract for handling a portal's "recruiter questions" chat panel once it
 * appears after clicking Apply. This is the deliberate seam between "how we
 * detect/apply to jobs" (adapter's job) and "how we answer questions"
 * (this). In Phase 7, LLMAnswerStrategy implements this same method —
 * reading the questions and typing generated answers instead of waiting for
 * a human — and nothing in NaukriAdapter or the apply runner needs to
 * change.
 */
export class AnswerStrategy {
  /**
   * @param {object} args
   * @param {object} args.job - the job being applied to (title, company, url, ...)
   * @param {() => Promise<boolean>} args.checkStillOpen - portal-agnostic
   *   callback the adapter provides; resolves true while the questions
   *   panel is still open, false once it's closed/answered.
   * @returns {Promise<{ completed: boolean, reason?: string }>}
   */
  async handleQuestions({ job, checkStillOpen }) {
    throw new Error('handleQuestions() not implemented');
  }
}
