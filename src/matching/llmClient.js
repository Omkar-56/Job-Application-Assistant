/**
 * The only file in the codebase that talks to an LLM provider directly.
 * resumeParser.js and llmMatcher.js both call generateJSON() and never see
 * a provider-specific request/response shape — swapping Gemini for
 * something else later means editing this file only.
 *
 * Uses Gemini's REST API directly (no SDK dependency) with
 * responseMimeType: "application/json" so the model returns parseable JSON
 * without needing to strip markdown fences ourselves.
 */

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

/**
 * @param {object} args
 * @param {string} args.prompt
 * @param {object} [args.schema] - optional JSON schema to constrain the response shape
 * @returns {Promise<object>} parsed JSON response
 */
export async function generateJSON({ prompt, schema }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey ' +
        'and add it to .env.'
    );
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const generationConfig = { responseMimeType: 'application/json' };
  if (schema) generationConfig.responseSchema = schema;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini response had no text content: ${JSON.stringify(data).slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini did not return valid JSON: ${text.slice(0, 500)}`);
  }
}
