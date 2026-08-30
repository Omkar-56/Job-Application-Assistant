import { AnswerStrategy } from './AnswerStrategy.js';
import { generateAnswer, chooseOption } from '../answerGenerator.js';
import { generateJSON } from '../../matching/llmClient.js';
import { confirmAnswer } from '../confirmPrompt.js';

/**
 * Answers the recruiter chat automatically, replacing the pause-and-wait
 * behavior of ManualAnswerStrategy — same handleQuestions() interface, so
 * nothing in NaukriAdapter or apply.js changes to use it.
 *
 * Handles two question shapes generically: free-text (typed answer, with
 * length-limit retry — see _answerFreeText) and single-select
 * (readOptionQuestion/selectOption — the LLM is constrained to pick only
 * from the real options, never a hallucinated one). A question that's
 * neither shape safely falls through to the timeout/maxQuestions safety
 * net below rather than being guessed at.
 *
 * Safety caps: maxQuestions bounds how many questions it'll answer for a
 * single job (protects against a misdetected/looping conversation), and
 * timeoutMs bounds total wall-clock time, same as the manual strategy.
 *
 * autoConfirm (config flag AUTO_CONFIRM_ANSWERS, default false): when
 * false, every generated answer/choice is shown in the terminal and you
 * confirm, edit, or skip it before it's actually sent — real recruiters
 * see these, so nothing goes out unsupervised until you trust it.
 */
export class LLMAnswerStrategy extends AnswerStrategy {
  constructor({
    profile,
    autoConfirm = false,
    maxQuestions = 8,
    maxTruncationRetries = 2,
    timeoutMs = 3 * 60 * 1000,
    generate = generateJSON,
  } = {}) {
    super();
    if (!profile) throw new Error('LLMAnswerStrategy requires a candidate profile.');
    this.profile = profile;
    this.autoConfirm = autoConfirm;
    this.maxQuestions = maxQuestions;
    this.maxTruncationRetries = maxTruncationRetries;
    this.timeoutMs = timeoutMs;
    this.generate = generate;
  }

  async handleQuestions({
    job,
    checkStillOpen,
    readCurrentQuestion,
    typeAnswer,
    confirmSubmit,
    readOptionQuestion,
    selectOption,
    readChipQuestion,
    selectChip,
  }) {
    const start = Date.now();
    let lastQuestion = null;
    let lastSubmittedAnswer = null;
    let answered = 0;

    while (Date.now() - start < this.timeoutMs) {
      const open = await checkStillOpen();
      if (!open) {
        // Debounce, same reasoning as ManualAnswerStrategy: a brief
        // re-render between questions shouldn't be read as "done."
        await sleep(1000);
        if (!(await checkStillOpen())) {
          console.log(`[llm-answer] Panel closed — "${job.title}" answered (${answered} question(s)).`);
          return { completed: true };
        }
        continue;
      }

      if (answered >= this.maxQuestions) {
        console.log(
          `[llm-answer] Hit the safety cap of ${this.maxQuestions} questions for ` +
            `"${job.title}" — flagging for manual review instead of continuing indefinitely.`
        );
        return { completed: false, reason: `exceeded max questions (${this.maxQuestions})` };
      }

      // Try both non-text shapes before falling back to free text — radio
      // buttons and chip choices are different UI entirely from the chat
      // input, not something readCurrentQuestion would find.
      const choiceSources = [
        readOptionQuestion && selectOption ? { read: readOptionQuestion, select: selectOption } : null,
        readChipQuestion && selectChip ? { read: readChipQuestion, select: selectChip } : null,
      ].filter(Boolean);

      let handledChoice = false;
      for (const { read, select } of choiceSources) {
        const choiceQ = await read();
        if (choiceQ && choiceQ.question !== lastQuestion) {
          const outcome = await this._answerChoiceQuestion(choiceQ, { job, selectFn: select });
          if (outcome.skipped) {
            return { completed: false, reason: outcome.reason };
          }
          lastQuestion = choiceQ.question;
          answered++;
          handledChoice = true;
          break;
        }
      }
      if (handledChoice) {
        await sleep(1500);
        continue;
      }

      const question = await readCurrentQuestion();
      // The message list likely includes our own messages too, so right
      // after submitting, the "latest message" is briefly our own echoed
      // answer, not the bot's next question — skip re-answering it.
      if (!question || question === lastQuestion || question === lastSubmittedAnswer) {
        await sleep(800);
        continue;
      }

      const outcome = await this._answerFreeText(question, { job, typeAnswer, confirmSubmit });
      if (outcome.skipped) {
        return { completed: false, reason: outcome.reason };
      }
      lastQuestion = question;
      lastSubmittedAnswer = outcome.submittedText;
      answered++;

      // Give the UI a moment to advance to the next question (or close)
      // before we check again.
      await sleep(1500);
    }

    console.log(`[llm-answer] Timed out answering "${job.title}" — flagging for review.`);
    return { completed: false, reason: 'timed out answering recruiter questions' };
  }

  /** Generates, confirms, types (retrying shorter on truncation), and submits a free-text answer. */
  async _answerFreeText(question, { job, typeAnswer, confirmSubmit }) {
    console.log(`[llm-answer] Q: ${question}`);
    let proposed = await generateAnswer({ question, job, profile: this.profile }, { generate: this.generate });

    let finalAnswer = await this._resolveAnswer(question, proposed);
    if (finalAnswer === null) return { skipped: true, reason: 'user skipped during answer confirmation' };

    let { submittedText, truncated } = await typeAnswer(finalAnswer);
    let retries = 0;
    while (truncated && retries < this.maxTruncationRetries) {
      retries++;
      const cap = submittedText.length;
      console.log(
        `[llm-answer] Answer doesn't fit the box (~${cap} char limit) — ` +
          `regenerating shorter (attempt ${retries}/${this.maxTruncationRetries}).`
      );
      const shorter = await generateAnswer(
        { question, job, profile: this.profile, maxLength: cap },
        { generate: this.generate }
      );
      finalAnswer = await this._resolveAnswer(question, shorter);
      if (finalAnswer === null) return { skipped: true, reason: 'user skipped during truncation-retry confirmation' };
      ({ submittedText, truncated } = await typeAnswer(finalAnswer));
    }

    if (truncated) {
      console.warn(
        `[llm-answer] Still didn't fit after ${retries} retries for "${job.title}" — flagging for review ` +
          'rather than sending a cut-off answer.'
      );
      return { skipped: true, reason: 'answer would not fit the input length limit after retries' };
    }

    await confirmSubmit();
    return { skipped: false, submittedText };
  }

  /** Picks a constrained choice, confirms, and selects it (works for both radio and chip questions). */
  async _answerChoiceQuestion(choiceQ, { job, selectFn }) {
    console.log(`[llm-answer] Q (choice): ${choiceQ.question}`);
    console.log(`[llm-answer] Options: ${choiceQ.options.join(', ')}`);
    const proposed = await chooseOption(
      { question: choiceQ.question, options: choiceQ.options, job, profile: this.profile },
      { generate: this.generate }
    );

    let finalChoice = proposed;
    if (!this.autoConfirm) {
      const response = await confirmAnswer(choiceQ.question, proposed);
      if (response === null) return { skipped: true, reason: 'user skipped during option confirmation' };
      finalChoice = response;
    } else {
      console.log(`[llm-answer] Choice: ${proposed}`);
    }

    // If you typed a free-text edit instead of accepting the proposed
    // choice, it has to actually be one of the clickable options — fall
    // back to the model's original (valid) choice if it isn't, rather
    // than trying to click something that doesn't exist.
    const matched = choiceQ.options.find((o) => o.toLowerCase() === String(finalChoice).trim().toLowerCase());
    const toSelect = matched ?? proposed;
    if (!matched && finalChoice !== proposed) {
      console.warn(`[llm-answer] "${finalChoice}" isn't one of the valid options — using "${proposed}" instead.`);
    }

    await selectFn(toSelect);
    return { skipped: false };
  }

  /** Shows/confirms a proposed answer per autoConfirm, or returns it unchanged. */
  async _resolveAnswer(question, proposed) {
    if (this.autoConfirm) {
      console.log(`[llm-answer] A: ${proposed}`);
      return proposed;
    }
    return confirmAnswer(question, proposed);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
