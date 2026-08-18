/**
 * Pure, portal-agnostic rule-based filtering. Takes the job objects produced
 * by any adapter (see JobPortalAdapter's doc comment for the shape) plus a
 * rules config, and returns which jobs pass and why the rest were rejected.
 *
 * Nothing here is Naukri-specific — it only looks at fields every adapter
 * is expected to provide (title, skills, experience).
 */

/**
 * Parses strings like "0-3 Yrs", "2-5 yrs", "5+ Yrs" into a {min, max}
 * numeric range. Returns null if it can't confidently parse one.
 */
function parseExperienceRange(experienceStr) {
  if (!experienceStr) return null;

  const rangeMatch = experienceStr.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    return { min: Number(rangeMatch[1]), max: Number(rangeMatch[2]) };
  }

  const plusMatch = experienceStr.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plusMatch) {
    return { min: Number(plusMatch[1]), max: Infinity };
  }

  return null;
}

function rangesOverlap(a, b) {
  return a.min <= b.max && b.min <= a.max;
}

function textFor(job) {
  return `${job.title} ${(job.skills || []).join(' ')}`.toLowerCase();
}

/**
 * @param {object[]} jobs
 * @param {object} rules - { includeKeywords, excludeKeywords, experience, onUnknownExperience }
 * @returns {{ matched: object[], rejected: { job: object, reasons: string[] }[] }}
 */
export function applyFilters(jobs, rules) {
  const includeKeywords = (rules.includeKeywords || []).map((k) => k.toLowerCase());
  const excludeKeywords = (rules.excludeKeywords || []).map((k) => k.toLowerCase());
  const desiredExperience = rules.experience || null;
  const onUnknownExperience = rules.onUnknownExperience || 'include';

  const matched = [];
  const rejected = [];

  for (const job of jobs) {
    const reasons = [];
    const text = textFor(job);

    if (includeKeywords.length && !includeKeywords.some((kw) => text.includes(kw))) {
      reasons.push(`no include keyword matched (looked for: ${includeKeywords.join(', ')})`);
    }

    const hitExclude = excludeKeywords.find((kw) => text.includes(kw));
    if (hitExclude) {
      reasons.push(`matched exclude keyword "${hitExclude}"`);
    }

    if (desiredExperience) {
      const jobRange = parseExperienceRange(job.experience);
      if (!jobRange) {
        if (onUnknownExperience === 'exclude') {
          reasons.push(`could not parse experience "${job.experience}" and onUnknownExperience=exclude`);
        }
      } else if (!rangesOverlap(jobRange, desiredExperience)) {
        reasons.push(
          `experience ${job.experience} doesn't overlap desired ${desiredExperience.min}-${desiredExperience.max} yrs`
        );
      }
    }

    if (reasons.length === 0) {
      matched.push(job);
    } else {
      rejected.push({ job, reasons });
    }
  }

  return { matched, rejected };
}
