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
experience). Leave `NAUKRI_EMAIL`/`NAUKRI_PASSWORD` in `.env` blank if you'd
rather log in manually — the browser will open, pause, and wait for you.

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
  config/                    — env + search criteria loading
  utils/delay.js             — human-like randomized delays
  index.js                   — wires it together
data/naukri-jobs.json        — accumulated discovered jobs (gitignored)
auth/naukri-state.json       — saved login session, not your password (gitignored)
```

Adding a new portal later (Wellfound, Indeed, LinkedIn) means writing a new
adapter under `src/adapters/<portal>/` that implements
`JobPortalAdapter`, plus a matching `JobStore` instance — nothing in
`core/`, `storage/`, or `index.js`'s shape needs to change.
