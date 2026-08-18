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
