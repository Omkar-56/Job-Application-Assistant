import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { JobPortalAdapter } from '../../core/JobPortalAdapter.js';
import { humanDelay } from '../../utils/delay.js';

const BASE_URL = 'https://www.naukri.com';

/**
 * NOTE ON SELECTORS: Naukri's markup changes periodically (it's a React
 * app), so the CSS selectors below are collected in one place and kept as
 * simple as possible so they're easy to fix if Naukri changes something.
 * If discover() starts returning 0 jobs, run with HEADLESS=false, open
 * devtools, and update the selectors here first.
 */
const SELECTORS = {
  jobCard: '.srp-jobtuple-wrapper, article.jobTuple',
  title: 'a.title, a.ellipsis',
  company: '.comp-name, a.subTitle',
  location: '.locWdth, .loc span',
  experience: '.expwdth, .exp span',
  skills: '.tags-gt li, .tagsAndButtons li',
  postedDate: '.job-post-day, .fleft.postedDate',
  paginationLink: 'div.styles_pages__v1rAK a',
  loginTrigger: 'a[title="Jobseeker Login"], #login_Layer',
  loginEmail: '#usernameField, input[placeholder="Enter your active Email ID"]',
  loginPassword: '#passwordField, input[placeholder="Enter your password"]',
  loginSubmit: 'button[type="submit"]',
  loggedInMarker: '.nI-gNb-drawer__icon, a[title="My Naukri"]',
  // --- Phase 4: apply flow ---
  applyButton: 'button:text-is("Apply"), #apply-button',
  appliedMarker: 'button:text-is("Applied")',
  // The recruiter/Naukri chat panel seen in the screenshots — its text
  // input is the clearest, least-likely-to-change signal that it's open.
  chatQuestionInput: 'input[placeholder="Type message here..."]',
  // Best-effort — the chat bubbles don't have a documented class name from
  // the screenshots alone. This targets the last message bubble in the
  // panel; if question reading comes back empty, inspect the panel with
  // devtools and tighten this selector.
  chatBotMessage: '[class*="bot"], [class*="message"]:not(input)',
  // --- Phase 6: AI matching ---
  jobDescription: '.styles_JDC__dang-inner-html__h0K4t, .dang-inner-html, section.job-desc, .styles_job-desc__',
};

export class NaukriAdapter extends JobPortalAdapter {
  constructor({ headless, storageStatePath, credentials }) {
    super();
    this.headless = headless;
    this.storageStatePath = storageStatePath;
    this.credentials = credentials; // { email, password } — may be null
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async _launch() {
    this.browser = await chromium.launch({ headless: this.headless });

    const hasSession = existsSync(this.storageStatePath);
    this.context = await this.browser.newContext(
      hasSession ? { storageState: this.storageStatePath } : {}
    );
    this.page = await this.context.newPage();
    return hasSession;
  }

  async login() {
    const hadSession = await this._launch();
    await this.page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await humanDelay();

    if (hadSession && (await this._isLoggedIn())) {
      console.log('[naukri] Reusing saved session — already logged in.');
      return;
    }

    console.log('[naukri] Not logged in. Opening login form...');
    const trigger = this.page.locator(SELECTORS.loginTrigger).first();
    if (await trigger.count()) {
      await trigger.click();
      await humanDelay();
    }

    if (this.credentials?.email && this.credentials?.password) {
      console.log('[naukri] Filling credentials from environment variables...');
      await this.page.fill(SELECTORS.loginEmail, this.credentials.email);
      await this.page.fill(SELECTORS.loginPassword, this.credentials.password);
      await this.page.click(SELECTORS.loginSubmit);
    } else {
      console.log(
        '[naukri] No credentials supplied. Please log in manually in the ' +
          'opened browser window (solve any captcha/2FA yourself). Waiting ' +
          'up to 3 minutes...'
      );
    }

    try {
      await this.page.waitForSelector(SELECTORS.loggedInMarker, { timeout: 180_000 });
    } catch {
      throw new Error(
        'Login was not detected within 3 minutes. Re-run and log in manually, ' +
          'or check that NAUKRI_EMAIL/NAUKRI_PASSWORD in .env are correct.'
      );
    }

    console.log('[naukri] Login detected. Saving session for next time...');
    const authDir = path.dirname(this.storageStatePath);
    if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });
    await this.context.storageState({ path: this.storageStatePath });
  }

  async _isLoggedIn() {
    return (await this.page.locator(SELECTORS.loggedInMarker).count()) > 0;
  }

  _buildSearchUrl({ keywords, location, experienceYears }) {
    const slug = (s) => encodeURIComponent(s.trim().toLowerCase().replace(/\s+/g, '-'));
    let url = `${BASE_URL}/${slug(keywords)}-jobs`;
    if (location) url += `-in-${slug(location)}`;
    if (experienceYears !== undefined && experienceYears !== null) {
      url += `?experience=${experienceYears}`;
    }
    return url;
  }

  async discover(criteria) {
    const maxPages = criteria.maxPages ?? 3;
    const searchUrl = this._buildSearchUrl(criteria);

    const seenThisRun = new Map();

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`[naukri] Navigating to page ${pageNum}`);

      if (pageNum === 1) {
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      } else {
        // Don't guess the URL — read the real href Naukri renders in its
        // pagination bar (div.styles_pages__v1rAK a) for this page number.
        const pageLink = this.page
          .locator(`${SELECTORS.paginationLink}[href$="-${pageNum}"]`)
          .first();

        const count = await pageLink.count();
        if (!count) {
          console.log(`[naukri] Could not find pagination link for page ${pageNum} — stopping.`);
          break;
        }

        const href = await pageLink.getAttribute('href');
        if (!href) {
          console.log(`[naukri] Pagination link for page ${pageNum} has no href — stopping.`);
          break;
        }

        const pageUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        console.log(`[naukri] Page ${pageNum} URL: ${pageUrl}`);
        await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
      }

      await humanDelay();

      await this.page.waitForSelector(SELECTORS.jobCard, { timeout: 20_000 }).catch(() => {});
      const cards = await this.page.locator(SELECTORS.jobCard).all();
      console.log(`[naukri] Page ${pageNum}: found ${cards.length} job cards on screen.`);

      if (cards.length === 0) {
        console.log('[naukri] No cards on this page — stopping.');
        break;
      }

      for (const card of cards) {
        const job = await this._extractJob(card);
        if (job && !seenThisRun.has(job.portalJobId)) {
          seenThisRun.set(job.portalJobId, job);
        }
      }
    }

    return [...seenThisRun.values()];
  }

  async _extractJob(card) {
    try {
      const titleEl = card.locator(SELECTORS.title).first();
      const url = await titleEl.getAttribute('href');
      const title = (await titleEl.textContent())?.trim();
      if (!url || !title) return null;

      const company = (await card.locator(SELECTORS.company).first().textContent().catch(() => null))?.trim() ?? '';
      const location = (await card.locator(SELECTORS.location).first().textContent().catch(() => null))?.trim() ?? '';
      const experience = (await card.locator(SELECTORS.experience).first().textContent().catch(() => null))?.trim() ?? '';
      const postedDate = (await card.locator(SELECTORS.postedDate).first().textContent().catch(() => null))?.trim() ?? '';

      const skillEls = await card.locator(SELECTORS.skills).all();
      const skills = [];
      for (const el of skillEls) {
        const text = (await el.textContent())?.trim();
        if (text) skills.push(text);
      }

      // Naukri job URLs contain a stable numeric id near the end, e.g.
      // .../job-listings-node-js-developer-some-co-delhi-2-6-years-190824500123
      const idMatch = url.match(/(\d{6,})(?:\?.*)?$/);
      const portalJobId = idMatch ? idMatch[1] : url;

      return {
        portal: 'naukri',
        portalJobId,
        title,
        company,
        location,
        experience,
        skills,
        postedDate,
        url: url.startsWith('http') ? url : `${BASE_URL}${url}`,
      };
    } catch (err) {
      console.warn('[naukri] Skipped a card due to extraction error:', err.message);
      return null;
    }
  }

  /**
   * Opens a job page and applies to it — or, in dry-run mode, just reports
   * what it would have done. Detects the two flows you found in Naukri's
   * UI: a direct apply (button click is enough) and a chat-style
   * recruiter-questions panel (handed off to answerStrategy).
   *
   * @param {object} job - a job object from discover()/the store, needs `.url`
   * @param {{ dryRun: boolean, answerStrategy: import('../../apply/answerStrategies/AnswerStrategy.js').AnswerStrategy }} opts
   * @returns {Promise<{ status: 'applied'|'dry_run'|'needs_manual_review'|'failed', reason?: string }>}
   */
  async applyToJob(job, { dryRun = true, answerStrategy } = {}) {
    console.log(`\n[naukri] Opening job: ${job.title} — ${job.company}`);
    await this.page.goto(job.url, { waitUntil: 'domcontentloaded' });
    await humanDelay();

    const applyBtn = this.page.locator(SELECTORS.applyButton).first();
    if (!(await applyBtn.count())) {
      return { status: 'failed', reason: 'Apply button not found (layout may differ, or listing is closed)' };
    }

    const btnText = (await applyBtn.textContent())?.trim().toLowerCase();
    if (btnText === 'applied') {
      console.log('[naukri] Already applied to this job — skipping.');
      return { status: 'applied', reason: 'already applied per Naukri UI' };
    }

    if (dryRun) {
      console.log(`[naukri] [DRY RUN] Would click Apply for "${job.title}" — no click performed.`);
      return { status: 'dry_run' };
    }

    await humanDelay();
    await applyBtn.click();

    // Don't guess how long Naukri takes to render — actively wait (up to
    // 15s) for either the chat panel or a success confirmation, whichever
    // comes first. A fixed short delay here was the bug: if the panel took
    // longer than the delay to appear, we'd wrongly conclude there wasn't
    // one and move straight to the next job, which looked like the panel
    // "closing immediately."
    const [chatVisible, appliedVisible] = await Promise.all([
      this.page.locator(SELECTORS.chatQuestionInput).first()
        .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
      this.page.locator(SELECTORS.appliedMarker).first()
        .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
    ]);

    if (chatVisible) {
      console.log('[naukri] Recruiter questions popped up — handing off to answer strategy.');
      const result = await answerStrategy.handleQuestions({
        job,
        checkStillOpen: async () => (await this.page.locator(SELECTORS.chatQuestionInput).count()) > 0,
        readCurrentQuestion: () => this._readCurrentQuestion(),
        submitAnswer: (text) => this._submitAnswer(text),
      });
      if (!result.completed) {
        return { status: 'needs_manual_review', reason: result.reason || 'chat questions left unanswered' };
      }
    }

    await humanDelay(1000, 2000);
    const confirmedApplied = (await this.page.locator(SELECTORS.appliedMarker).count()) > 0;
    if (confirmedApplied) {
      console.log('[naukri] Application confirmed.');
      return { status: 'applied' };
    }

    console.log('[naukri] Could not confirm the application succeeded — flagging for manual review.');
    return { status: 'needs_manual_review', reason: 'no success confirmation detected after apply' };
  }

  /**
   * Fetches the full job description text for matching. Only called for
   * jobs that already passed the cheap local pre-filter — full-page loads
   * are the expensive step, so we don't do this for every discovered job.
   * @param {object} job - needs `.url`
   * @returns {Promise<string>} description text, or '' if not found
   */
  async fetchJobDescription(job) {
    await this.page.goto(job.url, { waitUntil: 'domcontentloaded' });
    await humanDelay();

    const desc = this.page.locator(SELECTORS.jobDescription).first();
    if (!(await desc.count())) {
      console.warn(`[naukri] Could not find job description for "${job.title}" — selector may need updating.`);
      return '';
    }
    return (await desc.textContent())?.trim() ?? '';
  }

  /**
   * Best-effort read of the most recent bot message in the chat panel —
   * used by LLMAnswerStrategy to know what to answer. Falls back to '' if
   * the selector doesn't match, which the strategy treats as "nothing new
   * to answer yet."
   */
  async _readCurrentQuestion() {
    const bubbles = this.page.locator(SELECTORS.chatBotMessage);
    const count = await bubbles.count();
    if (!count) return '';
    return (await bubbles.nth(count - 1).textContent())?.trim() ?? '';
  }

  /** Types an answer into the chat input and submits it with Enter. */
  async _submitAnswer(text) {
    const input = this.page.locator(SELECTORS.chatQuestionInput).first();
    await input.fill(text);
    await humanDelay(400, 900);
    await input.press('Enter');
  }

  async close() {
    await this.context?.close();
    await this.browser?.close();
  }
}
