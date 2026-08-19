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
