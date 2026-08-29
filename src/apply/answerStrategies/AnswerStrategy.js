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
   * @param {(text: string) => Promise<{ submittedText: string, truncated: boolean }>} args.typeAnswer -
   *   types a free-text answer WITHOUT submitting it, and reports what
   *   actually landed. There's no maxlength attribute to check ahead of
   *   time, so truncation is only detectable after typing — callers should
   *   retry with a shorter answer before calling confirmSubmit(), so a
   *   truncated/garbled answer never reaches a real recruiter.
   * @param {() => Promise<void>} args.confirmSubmit - submits whatever is
   *   currently typed into the input.
   * @param {() => Promise<{ question: string, options: string[] } | null>} [args.readOptionQuestion] -
   *   for single-select (radio/dropdown) questions instead of free text.
   *   Returns null when the current question isn't this shape.
   * @param {(optionText: string) => Promise<boolean>} [args.selectOption] -
   *   selects one of the options readOptionQuestion() returned, verbatim.
   * @returns {Promise<{ completed: boolean, reason?: string }>}
   */
  async handleQuestions({ job, checkStillOpen, readCurrentQuestion, typeAnswer, confirmSubmit, readOptionQuestion, selectOption }) {
    throw new Error('handleQuestions() not implemented');
  }
}
