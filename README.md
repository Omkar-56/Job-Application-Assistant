# Job Application Assistant — Phase 1: Naukri Discovery

Portal-agnostic job discovery/matching/application tool. This is Phase 1
only: it opens Naukri, logs in, searches, scrolls/paginates, extracts job
listings, deduplicates against previous runs, and prints the results.

## Setup

```bash
cd job-application-assistant
npm install
npx playwright install chromium   # downloads the browser binary
cp .env.example .env
```

Edit `src/config/searchCriteria.json` for your search (keywords, location,
experience). `MAX_PAGES` in `.env` controls pagination — it's the only
place page count is configured (an earlier version also had a `maxPages`
field in `searchCriteria.json` that silently overrode it; that's removed
now, so `.env` is the single source of truth). Leave `NAUKRI_EMAIL`/
`NAUKRI_PASSWORD` in `.env` blank if you'd rather log in manually — the
browser will open, pause, and wait for you.

## Run

```bash
npm run discover
```

This runs headed by default (`HEADLESS=false` in `.env.example`) so you can
watch it work, as requested for Phase 1.

## What happens

1. Launches a headed Chromium browser.
2. If `auth/naukri-state.json` exists (a saved login session), it reuses
   that — no re-login needed.
3. Otherwise, it opens the login form. If you put credentials in `.env`, it
   fills them in; if not, it pauses for up to 3 minutes for you to log in
   by hand (so you can also handle any captcha/2FA yourself). Either way,
   your password is never written to disk — only Playwright's session
   cookies are saved to `auth/naukri-state.json`, which is gitignored.
4. Navigates to a search URL built from `searchCriteria.json`.
5. Scrolls and clicks "load more" up to `maxPages` times.
6. Extracts title, company, location, experience, skills, posted date, and
   URL for each listing, using a stable numeric job ID pulled from the
   listing URL for dedup.
7. Cross-references against `data/naukri-jobs.json` (a simple JSON file for
   now — Phase 3 swaps this for PostgreSQL behind the same `JobStore`
   interface) and prints only the genuinely new jobs.

## Phase 2: rule-based filtering

Edit `src/config/filterRules.json`:

```json
{
  "includeKeywords": ["node", "node.js", "express", "backend", "mern"],
  "excludeKeywords": ["only fresher", "internship", "trainee"],
  "experience": { "min": 0, "max": 3 },
  "onUnknownExperience": "include"
}
```

- A job passes only if its title/skills contain at least one `includeKeywords`
  entry, contain none of `excludeKeywords`, and its parsed experience range
  overlaps `experience`.
- `onUnknownExperience` controls what happens when a job's experience string
  can't be parsed — `"include"` (default, don't punish unparseable data) or
  `"exclude"`.
- Every run writes `data/naukri-jobs-filtered.json` and prints why each
  rejected job was excluded, so you can tune the rules by watching the
  reasons rather than guessing.

`src/filters/ruleBasedFilter.js` is portal-agnostic — it only looks at
`title`, `skills`, and `experience`, so it'll work unchanged once Wellfound
etc. are added.

## Phase 3: PostgreSQL + duplicate tracking

Dedup now lives in the database, not a JSON file. `data/naukri-jobs.json`
is no longer used for tracking (only `data/naukri-jobs-filtered.json` still
gets written, as a snapshot for convenience).

**Setup:**

1. Get a Postgres instance running (locally via `brew install postgresql` /
   `apt install postgresql`, or any hosted Postgres — Supabase, Railway,
   Neon, etc. all work).
2. In `.env`, set `DATABASE_URL=postgresql://user:password@host:5432/dbname`.
   Never commit this — `.env` is gitignored, and no credentials live in
   source anywhere.
3. Run the migration once: `npm run migrate`. This creates a single `jobs`
   table (see `src/storage/schema.sql`) with a
   `UNIQUE (portal, portal_job_id)` constraint — that constraint is what
   actually enforces dedupe, at the database level, not in application code.
4. `npm run discover` as before — it now reads/writes Postgres by default.

**Don't have Postgres handy right now?** Set `STORAGE_BACKEND=json` in
`.env` to fall back to the Phase 1/2 JSON-file store — same dedupe
behavior, just less durable and single-machine only.

`src/storage/postgresJobStore.js` implements the exact same
`load/has/addMany/all/close` shape as the old JSON `JobStore`, so
`src/index.js` and the filter step don't know or care which one is active.

**What to test:**

- Run `npm run migrate`, then `npm run discover` twice in a row — the
  second run should report `0 new jobs` (dedup enforced by the DB's unique
  constraint) while total tracked count stays the same.
- Inspect the table directly: `psql $DATABASE_URL -c "select portal, title, company from jobs limit 5;"`
- Try `STORAGE_BACKEND=json npm run discover` — confirm it still works
  against the old JSON file path, in case you want to test without a DB.

## Phase 4: applying (Apply button + recruiter chat questions)

Naukri's Apply flow has two branches, and `applyToJob()` handles both:

- **Direct apply** — clicking Apply is enough, no extra info needed.
- **Chat-style questions** — a panel opens asking things like "how many
  years of experience...". Right now, answering these is handed off to
  `ManualAnswerStrategy`, which pauses and waits for you to type the
  answers yourself in the browser window, then detects you're done when the
  panel closes. In Phase 7, an `LLMAnswerStrategy` will implement the exact
  same `handleQuestions()` interface — reading the questions and generating
  answers instead of waiting for you — and nothing in the adapter or
  `apply.js` will need to change.

**Safety defaults, on by design:**

- `DRY_RUN=true` by default. With it on, Apply is never actually clicked —
  every action is logged as `[DRY RUN]` and the job is marked `dry_run` in
  the DB. Only flip it to `false` in `.env` once you've watched a dry run
  and trust the selectors.
- `MAX_APPLICATIONS_PER_RUN=5` by default. A single run only touches this
  many jobs, so nothing can unattended-apply to your whole filtered list at
  once. Run `npm run apply` again to continue with the rest.
- Every job's `application_status` (`discovered` / `dry_run` / `applied` /
  `needs_manual_review` / `failed`) is tracked in Postgres, so re-running
  never re-touches a job that's already been handled.

**Setup:** `npm run migrate` once (adds two columns to the existing `jobs`
table — safe to re-run, nothing is dropped).

**Run:** `npm run apply` (or `npm run apply:headed` to force a visible
browser — you'll need headed mode anyway to answer any chat questions that
come up).

**What to test:**

- Run once with the default `DRY_RUN=true` and confirm the console shows
  `[DRY RUN]` lines and no jobs actually get applied to (check
  naukri.com/mnavYourApplications hasn't changed).
- Check `application_status` in the DB after: `psql $DATABASE_URL -c "select application_status, count(*) from jobs group by 1;"`
- Run again immediately — the batch should pick up different jobs than last
  time (pending count shrinks as jobs move out of `discovered`).
- Only once you're confident, set `DRY_RUN=false` and try a very small
  `MAX_APPLICATIONS_PER_RUN` (like `1`) on a real run, watching the headed
  browser the whole time.
- Try a job that pops up recruiter questions — the terminal should tell you
  to answer in the browser, then continue automatically once you close the
  panel.

## Phase 6: AI job matching

Adds semantic scoring on top of Phase 2's keyword filter, using your
resume and a free LLM (Gemini 2.5 Flash-Lite by default — no credit card,
generous free daily quota, native JSON output).

**Pipeline:** resume PDF → parsed once into a structured, versioned
`CandidateProfile` → jobs that already passed the Phase 2 rule-based filter
→ full job description fetched → LLM scores it against your profile
→ score/reasoning persisted in Postgres.

**Why the local filter still runs first:** the LLM only scores what
already passed keyword filtering, so a bad search doesn't burn API calls
on hundreds of irrelevant postings.

**Caching, simplified on purpose:** a job is only re-scored if it hasn't
been scored *under the current resume version* — no fetch, no LLM call, if
it has. This is simpler than hashing the job description itself (which
would need fetching the JD before knowing whether to skip it) and it
solves the main cost concern: reruns don't re-score everything every time.
The trade-off is it won't notice if a listing's description silently
changed after being scored — a reasonable gap for a personal tool, not
something to over-engineer yet.

**Setup:**

1. `npm run migrate` (adds `candidate_profiles` table + match columns to
   `jobs` — additive, safe on your existing DB).
2. Get a free key at https://aistudio.google.com/apikey, set
   `GEMINI_API_KEY` in `.env`.
3. Put your resume PDF at the project root as `resume.pdf` (or set
   `RESUME_PATH` to point elsewhere).
4. `npm run match:headed`.

**Notes:**

- AI matching requires `STORAGE_BACKEND=postgres` — candidate profile
  versioning needs a relational foreign key, so the JSON file store
  intentionally doesn't support it (fails with a clear error if you try).
- `MATCH_MAX_PER_RUN` (default 10) caps how many jobs get scored per run,
  same spirit as `MAX_APPLICATIONS_PER_RUN` — each one costs a page load
  plus an LLM call. Run again to continue with the rest.
- Re-run any time you update your resume — a changed PDF gets a new hash,
  triggers one fresh LLM parse, and gets a new profile version; all jobs
  get rescored against it (old scores from the previous version stay in
  the DB for history, just not reused).
- `LLMJobMatcher` (`src/matching/llmMatcher.js`) only sees the normalized
  job shape + description + profile — no Naukri awareness — so it'll work
  unchanged for Wellfound/Indeed/etc. later.

**What to test:**

- First run: confirm it parses your resume once (`New or changed resume
  detected...`), then scores up to `MATCH_MAX_PER_RUN` jobs with sensible
  scores/reasoning.
- Run again immediately: should say `0` or a small number `haven't been
  scored`, and skip straight past everything already scored — instant, no
  API calls.
- Check the DB: `psql $DATABASE_URL -c "select title, match_score, match_reasoning from jobs where match_score is not null order by match_score desc limit 10;"`
- Try editing your resume PDF slightly and re-running — confirm it detects
  the change (`New or changed resume detected`) rather than reusing the
  cached profile.

## Phase 7: LLM answering recruiter chat questions

Replaces the pause-and-wait behavior of `ManualAnswerStrategy` with
`LLMAnswerStrategy`, which reads each question from the chat panel and
answers it grounded in your candidate profile (built in Phase 6) — same
`handleQuestions()` interface, so this is a config change, not a rewrite.

**The safety flag you asked for:** `AUTO_CONFIRM_ANSWERS`, default `false`.
With it off, every generated answer is printed to the terminal and paused
for you: press Enter to send it as-is, type a replacement to send that
instead, or type `skip` to abort that job (flags it `needs_manual_review`
rather than sending a bad answer). Nothing reaches a real recruiter without
you seeing it first, until you set it to `true`.

**Other safety caps:** `maxQuestions` (8) stops a misdetected/looping
conversation instead of answering forever, and the same panel-closed
debounce from the Phase 4 bug fix is reused here so mid-conversation gaps
between questions aren't mistaken for "done."

**Setup:**

1. Set `ANSWER_STRATEGY=llm` in `.env` (default is still `manual`).
2. Run `npm run match` at least once first — `apply.js` reuses that same
   cached candidate profile rather than re-parsing your resume.
3. `npm run apply:headed` as usual. Leave `AUTO_CONFIRM_ANSWERS=false` for
   your first several runs.

**What to test:**

- With `AUTO_CONFIRM_ANSWERS=false`: trigger a job with chat questions,
  confirm you see each proposed answer and can accept/edit/skip it in the
  terminal, and that it actually types your final choice (not the original
  proposal) into the browser when you edit.
- Try `skip` on one — confirm that job ends up `needs_manual_review`, not
  `applied`.
- Only once you trust the answers: set `AUTO_CONFIRM_ANSWERS=true` and
  watch one run end-to-end without interrupting it, to confirm it still
  behaves well unattended.

## Phase 8: batch review before real submission

Before touching any job, `apply.js` now prints the full list about to be
attempted this run (title, company, match score, experience). When
`DRY_RUN=true`, it proceeds automatically — nothing's actually submitted,
so there's nothing to gate. When `DRY_RUN=false`, it pauses for one
whole-batch confirm (`[y/N]`, defaults to no) before anything is clicked —
a last checkpoint separate from the per-answer confirm in
`LLMAnswerStrategy`. Answering anything other than `y` aborts the run with
no job touched.

**What to test:**

- `DRY_RUN=true npm run apply:headed` — confirm it prints the batch list
  and proceeds without asking.
- `DRY_RUN=false npm run apply:headed` — confirm it pauses and shows the
  same list, then try answering `n` and confirm nothing gets clicked
  (check `application_status` in the DB is unchanged after).

## Two more apply-flow cases (resume upload chip, external apply)

On top of the direct-apply and chat-question flows from Phase 4, Naukri has
two more cases:

- **"Upload Resume" quick-reply chip** — instead of a typed question, the
  chat sometimes shows two buttons: "Upload Resume" / "I'll do it later".
  This is handled automatically and transparently, regardless of which
  answer strategy (`manual` or `llm`) is active — it's a deterministic file
  upload, not a judgment call, so neither strategy needs to know it exists.
  It clicks "Upload Resume" and uploads `RESUME_PATH` (the same resume
  already used for matching) via Playwright's native file-chooser handling.
- **"Apply on company site"** — Naukri redirects to the company's own
  application form for some listings. This is intentionally **never
  automated** — every company's site is different and unpredictable, and
  attempting to script arbitrary third-party forms is exactly the kind of
  fragile, unmaintainable automation this project avoids. These jobs are
  flagged with `application_status = 'external_site'` and skipped; the
  end-of-run summary tells you how many need manual attention.

**A caveat on testing:** the file-upload piece (`waitForEvent('filechooser')`
+ `setFiles()`) uses the standard, documented Playwright pattern for native
file dialogs, and the surrounding control flow is unit-tested with a mocked
browser page — but it hasn't been exercised against the real Naukri site
yet. Worth watching closely on your first real run.

**What to test:**

- Trigger a job that shows the resume-upload chip (like your screenshot) —
  confirm it uploads automatically without pausing, and that the chat
  advances afterward (check for a confirmation message or the panel
  closing).
- Trigger a job with "Apply on company site" — confirm it's skipped
  immediately with `external_site` status and nothing gets clicked.
  `psql $DATABASE_URL -c "select title, company, url from jobs where application_status = 'external_site';"`
  to see which ones need manual attention.

## Character limits and other question types (radio/dropdown)

Two gaps closed, both specific to `ANSWER_STRATEGY=llm` — manual mode
already handles any question shape since a human sees the real browser.

**Character limits:** Naukri's chat input has no `maxlength` attribute to
check ahead of time (it's a contenteditable box, and the cap varies per
job) — so the approach is to type the answer, read back what actually
landed, and if it's shorter than what was typed, regenerate a tighter
version and retry. Bounded to `maxTruncationRetries` (2 by default); if it
still doesn't fit, the job is flagged `needs_manual_review` rather than
sending a cut-off answer. Critically, nothing is ever submitted mid-retry —
typing and submitting are separate steps, so a truncated draft never
reaches a real recruiter while a shorter version is generated.

**Single-select questions (radio buttons — notice period, location,
etc.):** a fundamentally different UI from free text, so it's detected and
handled separately. The LLM is given the *exact* option strings from the
page and constrained (via the API's schema `enum`) to pick only one of
them verbatim — it cannot hallucinate an option that isn't actually
clickable. If you edit a proposed choice during confirmation and your edit
isn't one of the real options, it falls back to the model's original valid
choice rather than trying to click something nonexistent.

**On "is there a general way to handle any question":** partially. There's
a general *pattern* — for any question shape, figure out what the UI
actually accepts (free text with a length budget, or exactly one of N
options) and constrain the LLM to that shape — but each genuinely new UI
shape (dropdown `<select>`, multi-select checkboxes, date pickers, etc.)
still needs its own detection/interaction code written once, following
that same pattern. Anything not yet recognized safely times out into
`needs_manual_review` rather than being guessed at.

**Testing caveat:** the truncation-retry and option-selection *logic* is
unit-tested against a mocked browser (retry-until-fit, refuses to submit a
still-truncated answer, correctly falls back on an invalid edited option) —
but like the resume-upload chip, the actual Naukri selectors involved
(`.singleselect-radiobutton`, etc.) haven't been exercised against the real
site yet. Watch closely on your first real run with each question type.

## Phase 9: application tracking dashboard

A small Express API (`src/server/index.js`) over the existing Postgres
data, plus a static dashboard (`public/`) — vanilla HTML/CSS/JS, no build
step, consistent with the rest of this project staying dependency-light.

**Run:** `npm run dashboard`, then open http://localhost:4000 (port
configurable via `DASHBOARD_PORT`).

**What it shows:**
- Summary cards: total tracked, applied, needs review, external site,
  failed, discovered/pending, dry run, average match score, applied in the
  last 7 days.
- A filterable, paginated job table — search by title/company, filter by
  status or minimum match score — with match score and status shown as
  color-coded badges, and a link straight to the Naukri listing.

**API endpoints** (used by the dashboard, but usable directly too):
- `GET /api/summary` — the aggregate counts above.
- `GET /api/jobs?status=&minScore=&search=&limit=&offset=` — filtered,
  paginated job list.

**Requires `STORAGE_BACKEND=postgres`** — the summary/filter queries need
a real database; it fails with a clear error on the JSON fallback store
rather than silently returning nothing.

**Tested against real data** (not just syntax-checked): seeded a real
Postgres instance with your actual 60-job dataset spread across every
status (applied, needs_manual_review, external_site, failed, dry_run,
discovered), started the real server, and hit every endpoint directly —
`/api/summary` returned correct counts per status plus a real average
match score; `/api/jobs` filters (`status`, `minScore`, `search`) each
returned exactly the right subset; pagination across 3 pages summed
correctly to the true total (25 + 25 + 10 = 60); all three static assets
(`index.html`, `styles.css`, `app.js`) served with 200s; the
`STORAGE_BACKEND=json` guard correctly rejected with a clear error instead
of starting up broken.

**What to test:** open the dashboard in a browser with your real data,
click through status filters and the score filter, try the search box,
and confirm the "Open ↗" links go to the right Naukri listings.

## What to test

- Run once with your real search criteria and confirm the browser opens,
  logs in (manually or via `.env`), and prints a job list that matches what
  you see on naukri.com for the same search.
- Run it a second time immediately after — it should report `0 new jobs`
  since everything's already in `data/naukri-jobs.json`, but the login
  should be instant (session reuse).
- Try a search with very few results and one with many, to sanity-check
  pagination stops correctly (either hits `maxPages` or runs out of "load
  more").
- **If it extracts 0 jobs**: Naukri's HTML changes periodically. Open
  `src/adapters/naukri/naukriAdapter.js`, look at the `SELECTORS` object,
  and use the headed browser + devtools to find the current class names.
  Everything selector-related lives in that one object by design.

## Project layout

```
src/
  core/JobPortalAdapter.js   — interface every portal adapter implements
  adapters/naukri/           — all Naukri-specific logic lives here only
  storage/jobStore.js        — dedupe/persistence, JSON-backed for now
  storage/postgresJobStore.js — Postgres-backed store, incl. dashboard queries
  server/index.js            — Express API for the dashboard
  config/                    — env + search criteria loading
  utils/delay.js             — human-like randomized delays
  index.js                   — wires it together
public/                      — dashboard static files (HTML/CSS/JS, no build step)
data/naukri-jobs.json        — accumulated discovered jobs (gitignored)
auth/naukri-state.json       — saved login session, not your password (gitignored)
```

Adding a new portal later (Wellfound, Indeed, LinkedIn) means writing a new
adapter under `src/adapters/<portal>/` that implements
`JobPortalAdapter`, plus a matching `JobStore` instance — nothing in
`core/`, `storage/`, or `index.js`'s shape needs to change.
