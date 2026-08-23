import { generateJSON } from './llmClient.js';

const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    reasoning: { type: 'string' },
    recommended: { type: 'boolean' },
  },
  required: ['score', 'reasoning', 'recommended'],
};

/**
 * Deliberately knows nothing about Naukri or any other portal — only the
 * normalized job shape (title/company/skills/experience/description) and
 * the structured candidate profile. Works unchanged for any future adapter.
 *
 * @param {object} args
 * @param {object} args.job - normalized job (title, company, experience, skills)
 * @param {string} args.description - full job description text
 * @param {object} args.profile - structured CandidateProfile
 * @param {{ generate?: typeof generateJSON }} [deps] - injectable for tests
 * @returns {Promise<{ score: number, reasoning: string, recommended: boolean }>}
 */
export async function matchJobToProfile({ job, description, profile }, { generate = generateJSON } = {}) {
  const prompt = `You are scoring how well a candidate fits a job posting, for a
personal job-search assistant. Score from 0-100 (0 = no fit, 100 = ideal fit).
Consider skill overlap, seniority/experience match, and role alignment. Be
honest and specific — this score decides whether the candidate applies.
Return ONLY JSON: score (number 0-100), reasoning (1-2 sentences, specific),
recommended (boolean, true if score would justify applying).

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

JOB POSTING:
Title: ${job.title}
Company: ${job.company}
Experience required: ${job.experience || 'not specified'}
Listed skills: ${(job.skills || []).join(', ') || 'none listed'}
Description:
"""
${description || '(no description available)'}
"""`;

  const result = await generate({ prompt, schema: MATCH_SCHEMA });
  return {
    score: Number(result.score),
    reasoning: result.reasoning,
    recommended: Boolean(result.recommended),
  };
}
