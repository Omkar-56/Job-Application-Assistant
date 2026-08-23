import { generateJSON } from './llmClient.js';

const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    totalYearsExperience: { type: 'number' },
    skills: { type: 'array', items: { type: 'string' } },
    roles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          durationYears: { type: 'number' },
          highlights: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    education: { type: 'array', items: { type: 'string' } },
    location: { type: 'string' },
  },
  required: ['headline', 'totalYearsExperience', 'skills'],
};

/**
 * @param {string} resumeText - raw text extracted from the resume PDF
 * @param {{ generate?: typeof generateJSON }} [deps] - injectable for tests
 * @returns {Promise<object>} structured CandidateProfile
 */
export async function parseResumeText(resumeText, { generate = generateJSON } = {}) {
  const prompt = `You are structuring a candidate's resume for a job-matching system.
Extract the following from the resume text below and return ONLY JSON matching
the schema: headline (a 1-line professional summary), totalYearsExperience
(number, best estimate), skills (flat array of technical skills mentioned),
roles (past positions with title/company/durationYears/highlights), education
(array of degree/institution strings), location (city/region if mentioned).

Resume text:
"""
${resumeText}
"""`;

  return generate({ prompt, schema: PROFILE_SCHEMA });
}

/**
 * @param {Buffer} pdfBuffer
 * @param {{ generate?: typeof generateJSON }} [deps]
 * @returns {Promise<object>} structured CandidateProfile
 */
export async function parseResumePdf(pdfBuffer, deps = {}) {
  // Lazy import so pdf-parse (and its dependency footprint) is only loaded
  // when actually parsing a resume, not on every module load.
  const { default: pdfParse } = await import('pdf-parse');
  const { text } = await pdfParse(pdfBuffer);
  return parseResumeText(text, deps);
}
