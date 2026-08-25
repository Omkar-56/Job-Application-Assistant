import { generateJSON } from './llmClient.js';

const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    location: { type: 'string' },
    experience: {
      type: 'object',
      properties: {
        totalYears: { type: 'number' },
        level: { type: 'string' }, // e.g. "Fresher", "Junior", "Mid-level"
      },
      required: ['totalYears', 'level'],
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          degree: { type: 'string' },
          field: { type: 'string' },
          institution: { type: 'string' },
          location: { type: 'string' },
          graduationYear: { type: 'number' },
          cgpa: { type: 'number' },
        },
      },
    },
    targetRoles: { type: 'array', items: { type: 'string' } },
    skills: {
      type: 'object',
      properties: {
        backend: { type: 'array', items: { type: 'string' } },
        frontend: { type: 'array', items: { type: 'string' } },
        databases: { type: 'array', items: { type: 'string' } },
        ai_ml: { type: 'array', items: { type: 'string' } },
        tools: { type: 'array', items: { type: 'string' } },
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          technologies: { type: 'array', items: { type: 'string' } },
          keywords: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  required: ['headline', 'experience', 'skills'],
};

/**
 * @param {string} resumeText - raw text extracted from the resume PDF
 * @param {{ generate?: typeof generateJSON }} [deps] - injectable for tests
 * @returns {Promise<object>} structured CandidateProfile
 */
export async function parseResumeText(resumeText, { generate = generateJSON } = {}) {
  const prompt = `You are structuring a candidate's resume for a job-matching AND
job-application-answering system. Extract the following from the resume text
below and return ONLY JSON matching the schema:

- headline: 1-line professional summary
- location: city/region
- experience: { totalYears (best numeric estimate), level (e.g. "Fresher",
  "Junior", "Mid-level", "Senior" — infer from years/projects if not explicit) }
- education: array of { degree, field, institution, location, graduationYear, cgpa }
- targetRoles: array of job titles this candidate would realistically apply
  for, inferred from their skills/projects (e.g. "Backend Developer",
  "Full Stack Developer") — this will be used to help the candidate answer
  "what role are you looking for" style questions later
- skills: grouped by category (backend, frontend, databases, ai_ml, tools) —
  only include categories that actually apply
- projects: array of { name, technologies, keywords } — keywords should
  capture what the project actually DOES (e.g. "geospatial search",
  "real-time", "RAG", "signed URLs"), not just tech names, so this can be
  used later to answer "describe a relevant project" style questions

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
