CREATE TABLE IF NOT EXISTS jobs (
  id             SERIAL PRIMARY KEY,
  portal         TEXT NOT NULL,
  portal_job_id  TEXT NOT NULL,
  title          TEXT NOT NULL,
  company        TEXT,
  location       TEXT,
  experience     TEXT,
  skills         JSONB NOT NULL DEFAULT '[]'::jsonb,
  posted_date    TEXT,
  url            TEXT,
  discovered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal, portal_job_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_portal ON jobs (portal);

-- Phase 4: application tracking. Additive — safe to re-run on a DB that
-- already has the Phase 3 table.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS application_status TEXT NOT NULL DEFAULT 'discovered';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_application_status ON jobs (application_status);

-- Phase 6: AI matching. Additive — safe to re-run.
-- A "version" of the candidate's resume: re-parsing the same PDF (same
-- hash) reuses the existing row instead of calling the LLM again.
CREATE TABLE IF NOT EXISTS candidate_profiles (
  id           SERIAL PRIMARY KEY,
  resume_hash  TEXT NOT NULL UNIQUE,
  profile      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_text TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS match_score NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS match_reasoning TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS matched_profile_id INTEGER REFERENCES candidate_profiles(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_match_score ON jobs (match_score);

-- Phase 9 dashboard follow-up: tracks the last time the apply pipeline
-- touched a job, regardless of outcome — lets "needs attention" filter to
-- today's failures specifically instead of every failure ever.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ;

