import { AnswerStrategy } from './AnswerStrategy.js';
import { generateAnswer } from '../answerGenerator.js';
import { generateJSON } from '../../matching/llmClient.js';
import { confirmAnswer } from '../confirmPrompt.js';

/**
 * Answers the recruiter chat automatically, replacing the pause-and-wait
 * behavior of ManualAnswerStrategy — same handleQuestions() interface, so
 * nothing in NaukriAdapter or apply.js changes to use it.
 *
 * Safety caps: maxQuestions bounds how many questions it'll answer for a
 * single job (protects against a misdetected/looping conversation), and
 * timeoutMs bounds total wall-clock time, same as the manual strategy.
 *
 * autoConfirm (config flag AUTO_CONFIRM_ANSWERS, default false): when
 * false, every generated answer is shown in the terminal and you confirm,
 * edit, or skip it before it's actually typed into the chat — real
 * recruiters see these, so nothing goes out unsupervised until you trust
 * it. Set to true once you do.
 */
export class LLMAnswerStrategy extends AnswerStrategy {
  constructor({
    profile,
    autoConfirm = false,
    maxQuestions = 8,
    timeoutMs = 3 * 60 * 1000,
    generate = generateJSON,
  } = {}) {
    super();
    if (!profile) throw new Error('LLMAnswerStrategy requires a candidate profile.');
    this.profile = profile;
    this.autoConfirm = autoConfirm;
    this.maxQuestions = maxQuestions;
    this.timeoutMs = timeoutMs;
    this.generate = generate;
  }

  async handleQuestions({ job, checkStillOpen, readCurrentQuestion, submitAnswer }) {
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

      const question = await readCurrentQuestion();
      // The message list likely includes our own messages too, so right
      // after submitting, the "latest message" is briefly our own echoed
      // answer, not the bot's next question — skip re-answering it.
      if (!question || question === lastQuestion || question === lastSubmittedAnswer) {
        await sleep(800);
        continue;
      }

      console.log(`[llm-answer] Q: ${question}`);
      const proposed = await generateAnswer(
        { question, job, profile: this.profile },
        { generate: this.generate }
      );

      let finalAnswer = proposed;
      if (!this.autoConfirm) {
        finalAnswer = await confirmAnswer(question, proposed);
        if (finalAnswer === null) {
          console.log(`[llm-answer] You skipped "${job.title}" — flagging for manual review.`);
          return { completed: false, reason: 'user skipped during answer confirmation' };
        }
      } else {
        console.log(`[llm-answer] A: ${proposed}`);
      }

      await submitAnswer(finalAnswer);
      lastQuestion = question;
      lastSubmittedAnswer = finalAnswer;
      answered++;

      // Give the UI a moment to advance to the next question (or close)
      // before we check again.
      await sleep(1500);
    }

    console.log(`[llm-answer] Timed out answering "${job.title}" — flagging for review.`);
    return { completed: false, reason: 'timed out answering recruiter questions' };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
