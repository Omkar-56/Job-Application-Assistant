import { generateJSON } from '../matching/llmClient.js';

const ANSWER_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
};

const COVER_LETTER_SCHEMA = {
  type: 'object',
  properties: { coverLetter: { type: 'string' } },
  required: ['coverLetter'],
};

/**
 * @param {object} args
 * @param {string} args.question - the recruiter/Naukri screening question
 * @param {object} args.job - job being applied to (title, company)
 * @param {object} args.profile - structured CandidateProfile
 * @param {number} [args.maxLength] - the input box's observed character
 *   cap, if known (from a previous truncated attempt). No attribute
 *   exposes this ahead of time, so it's only known after a first try.
 * @param {{ generate?: typeof generateJSON }} [deps] - injectable for tests
 * @returns {Promise<string>}
 */
export async function generateAnswer({ question, job, profile, maxLength }, { generate = generateJSON } = {}) {
  const lengthInstruction = maxLength
    ? `\nIMPORTANT: the answer box only accepts about ${maxLength} characters total — keep your answer under that, no exceptions.`
    : '';

  const prompt = `You are answering a recruiter's screening question on behalf of
a candidate, during a job application chat. Answer truthfully and
specifically using ONLY the candidate's actual background below — never
invent experience, employers, technologies, or years that aren't there.
If the question asks something the profile genuinely doesn't cover, answer
as honestly and reasonably as possible without fabricating specifics. Keep
it concise (1-3 sentences unless the question clearly wants more detail),
first person, professional tone for a job application.${lengthInstruction}

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

JOB CONTEXT:
Title: ${job.title}
Company: ${job.company}

RECRUITER QUESTION:
"${question}"

Return ONLY JSON: { "answer": "..." }`;

  const result = await generate({ prompt, schema: ANSWER_SCHEMA });
  return result.answer;
}

/**
 * For single-select (radio/dropdown) questions: picks exactly one of the
 * given option strings. The schema constrains the response to an enum of
 * the real options, so the model can't hallucinate something unclickable.
 *
 * @param {object} args
 * @param {string} args.question
 * @param {string[]} args.options - the exact, real option strings from the UI
 * @param {object} args.job
 * @param {object} args.profile
 * @param {{ generate?: typeof generateJSON }} [deps]
 * @returns {Promise<string>} one of args.options, verbatim
 */
export async function chooseOption({ question, options, job, profile }, { generate = generateJSON } = {}) {
  const schema = {
    type: 'object',
    properties: { choice: { type: 'string', enum: options } },
    required: ['choice'],
  };

  const prompt = `You are answering a recruiter's screening question on behalf of
a candidate during a job application. This question has fixed answer
choices — you MUST pick exactly one, verbatim, from the options given. Pick
the option that best and most honestly reflects the candidate's actual
profile below.

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

JOB CONTEXT:
Title: ${job.title}
Company: ${job.company}

QUESTION: "${question}"
OPTIONS: ${JSON.stringify(options)}

Return ONLY JSON: { "choice": "<one of the options above, exactly>" }`;

  const result = await generate({ prompt, schema });
  return result.choice;
}

/**
 * @param {object} args
 * @param {object} args.job
 * @param {string} [args.description] - full JD text, if available
 * @param {object} args.profile
 * @param {{ generate?: typeof generateJSON }} [deps]
 * @returns {Promise<string>}
 */
export async function generateCoverLetter({ job, description, profile }, { generate = generateJSON } = {}) {
  const prompt = `Write a short, genuine cover letter / application note
(120-180 words) from the candidate below, for the job posting below. Ground
every claim in the candidate's actual skills/projects/education — never
invent experience. No generic filler ("I am writing to express my
interest..."); be specific about why THIS candidate's actual background
fits THIS particular role. First person, professional but not stiff.

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

JOB POSTING:
Title: ${job.title}
Company: ${job.company}
Description:
"""
${description || '(no description available)'}
"""

Return ONLY JSON: { "coverLetter": "..." }`;

  const result = await generate({ prompt, schema: COVER_LETTER_SCHEMA });
  return result.coverLetter;
}
