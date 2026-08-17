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
  loadMore: '.styles_btn-secondary__2AsIP, a.btn-secondary',
  loginTrigger: 'a[title="Jobseeker Login"], #login_Layer',
  loginEmail: '#usernameField, input[placeholder="Enter your active Email ID / Username"]',
  loginPassword: '#passwordField, input[placeholder="Enter your password"]',
  loginSubmit: 'button[type="submit"]',
  loggedInMarker: '.nI-gNb-drawer__icon, a[title="My Naukri"]',
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
    console.log(`[naukri] Navigating to search: ${searchUrl}`);
    await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await humanDelay();

    const seenThisRun = new Map();

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      await this.page.waitForSelector(SELECTORS.jobCard, { timeout: 20_000 }).catch(() => {});
      const cards = await this.page.locator(SELECTORS.jobCard).all();
      console.log(`[naukri] Page ${pageNum}: found ${cards.length} job cards on screen.`);

      for (const card of cards) {
        const job = await this._extractJob(card);
        if (job && !seenThisRun.has(job.portalJobId)) {
          seenThisRun.set(job.portalJobId, job);
        }
      }

      if (pageNum === maxPages) break;

      const loadMore = this.page.locator(SELECTORS.loadMore).first();
      await card_scroll_into_view(this.page);
      if (await loadMore.count()) {
        await humanDelay();
        await loadMore.click().catch(() => {});
        await humanDelay(1500, 3000);
      } else {
        console.log('[naukri] No further pages found — stopping.');
        break;
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

  async close() {
    await this.context?.close();
    await this.browser?.close();
  }
}

async function card_scroll_into_view(page) {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
}
