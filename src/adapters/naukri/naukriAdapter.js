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
  // The REAL success confirmation, confirmed via DevTools: a green banner
  // <div class="apply-status-header green">...<span class="apply-message">
  // "You have successfully applied to..."</span></div> — NOT a button
  // changing to "Applied". This was the actual bug: successful applies
  // were being marked needs_manual_review because only the button variant
  // was checked.
  appliedBanner: '.apply-status-header.green, span.apply-message',
  // Naukri sometimes redirects to the company's own site instead of a
  // native apply — different button text, easy to tell apart from the
  // regular Apply button.
  externalApplyButton: 'button:has-text("Apply on company site"), a:has-text("Apply on company site")',
  // The chat input is a contenteditable div, NOT an <input> — confirmed
  // via DevTools: <div contenteditable="true" data-placeholder="Type
  // message here...">. The old input[placeholder=...] selector matched
  // zero elements, which is why nothing ever got typed.
  chatQuestionInput: '[contenteditable="true"][data-placeholder="Type message here..."]',
  // Scoped to the actual message list (ul[id^="chatList_"]) instead of a
  // broad class-substring guess — each message is an <li>.
  chatBotMessage: 'ul[id^="chatList_"] li',
  // Quick-reply chip questions — e.g. "Upload Resume" / "I'll do it
  // later", or more generally any Yes/No/city-name style choice. The
  // per-chip class (chipItem) is inconsistent between jobs — confirmed via
  // two DevTools captures where it appeared on different chips each time —
  // so this targets the stable container and its DIRECT children only,
  // rather than matching on that class.
  chipsContainer: '.chatbot_Chips',
  // Single-select radio question (e.g. notice period, location) — confirmed
  // via DevTools: <div class="singleselect-radiobutton">...
  // <div class="ssrc__radio-btn-container"><input type="radio" ...><label>...
  radioQuestionContainer: '.singleselect-radiobutton',
  radioOption: '.ssrc__radio-btn-container',
  radioOptionInput: '.ssrc__radio-btn-container input[type="radio"]',
  radioOptionLabel: '.ssrc__radio-btn-container label',
  // --- Phase 6: AI matching ---
  jobDescription: '.styles_JDC__dang-inner-html__h0K4t, .dang-inner-html, section.job-desc, .styles_job-desc__',
};

export class NaukriAdapter extends JobPortalAdapter {
  constructor({ headless, storageStatePath, credentials, resumePath }) {
    super();
    this.headless = headless;
    this.storageStatePath = storageStatePath;
    this.credentials = credentials; // { email, password } — may be null
    this.resumePath = resumePath; // used for automated resume-upload chip handling
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
   * what it would have done. Handles the flows found in Naukri's UI: a
   * direct apply, a chat-style recruiter-questions panel (handed off to
   * answerStrategy), a chat "Upload Resume" quick-reply chip (handled
   * automatically — deterministic, no LLM/human judgment needed), and an
   * "Apply on company site" redirect (flagged, not attempted — see the
   * class doc for why that one isn't automated).
   *
   * @param {object} job - a job object from discover()/the store, needs `.url`
   * @param {{ dryRun: boolean, answerStrategy: import('../../apply/answerStrategies/AnswerStrategy.js').AnswerStrategy }} opts
   * @returns {Promise<{ status: 'applied'|'dry_run'|'needs_manual_review'|'external_site'|'failed', reason?: string }>}
   */
  async applyToJob(job, { dryRun = true, answerStrategy } = {}) {
    console.log(`\n[naukri] Opening job: ${job.title} — ${job.company}`);
    await this.page.goto(job.url, { waitUntil: 'domcontentloaded' });
    await humanDelay();

    // "Apply on company site" leads to an arbitrary external site — every
    // company's application form is different and unpredictable, so this
    // is intentionally never automated. Flag it and move on.
    if (await this.page.locator(SELECTORS.externalApplyButton).count()) {
      console.log(`[naukri] "${job.title}" requires applying on the company's own site — flagging for manual application.`);
      return { status: 'external_site', reason: "Naukri redirects to the company's own site for this listing" };
    }

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
    // 15s) for ANY of: the free-text panel, a chip-choice panel (e.g. the
    // resume-upload prompt — this can appear with NO text box at all),
    // a radio-question panel, or a success confirmation. Watching only
    // the text box was the bug: a job whose chat opens with just chips
    // would never trip that check, time out, and get wrongly treated as
    // "no panel here" while the real (chip) panel sat open unanswered.
    const [chatVisible, chipVisible, radioVisible, appliedVisible, bannerVisible] = await Promise.all([
      this.page.locator(SELECTORS.chatQuestionInput).first()
        .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
      this.page.locator(SELECTORS.chipsContainer).first()
        .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
      this.page.locator(SELECTORS.radioQuestionContainer).first()
        .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
      this.page.locator(SELECTORS.appliedMarker).first()
        .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
      this.page.locator(SELECTORS.appliedBanner).first()
        .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
    ]);
    const panelVisible = chatVisible || chipVisible || radioVisible;

    if (panelVisible) {
      console.log('[naukri] Recruiter questions popped up — handing off to answer strategy.');
      // Resolve any resume-upload chip up front too — it can be the very
      // first thing the chat shows, before checkStillOpen's first poll.
      await this._autoHandleResumeUploadChip();
      const result = await answerStrategy.handleQuestions({
        job,
        checkStillOpen: async () => {
          // Auto-handle the "Upload Resume" quick-reply chip transparently,
          // regardless of which answer strategy is active — it's a
          // deterministic file upload, not something that needs an LLM's
          // or a human's judgment. Neither ManualAnswerStrategy nor
          // LLMAnswerStrategy need to know this exists.
          await this._autoHandleResumeUploadChip();
          // "Still open" means ANY of the three panel shapes is visible —
          // same blind spot as the initial detection above would otherwise
          // repeat here on every poll.
          const [textOpen, chipOpen, radioOpen] = await Promise.all([
            this.page.locator(SELECTORS.chatQuestionInput).first().isVisible().catch(() => false),
            this.page.locator(SELECTORS.chipsContainer).first().isVisible().catch(() => false),
            this.page.locator(SELECTORS.radioQuestionContainer).first().isVisible().catch(() => false),
          ]);
          return textOpen || chipOpen || radioOpen;
        },
        readCurrentQuestion: () => this._readCurrentQuestion(),
        typeAnswer: (text) => this._typeAnswer(text),
        confirmSubmit: () => this._confirmSubmit(),
        readOptionQuestion: () => this.readOptionQuestion(),
        selectOption: (optionText) => this.selectOption(optionText),
        readChipQuestion: () => this.readChipQuestion(),
        selectChip: (optionText) => this.selectChip(optionText),
      });
      if (!result.completed) {
        return { status: 'needs_manual_review', reason: result.reason || 'chat questions left unanswered' };
      }
    }

    await humanDelay(1000, 2000);
    const confirmedApplied =
      (await this.page.locator(SELECTORS.appliedMarker).count()) > 0 ||
      (await this.page.locator(SELECTORS.appliedBanner).count()) > 0;
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
   * Detects the "Upload Resume" / "I'll do it later" quick-reply chips
   * (seen when the recruiter's chat wants a resume rather than a typed
   * answer) and, if present, clicks "Upload Resume" and uploads
   * this.resumePath automatically — this is a deterministic action, not
   * something that needs an LLM's or a human's judgment, so it's handled
   * transparently regardless of which answer strategy is active.
   *
   * Tries two upload mechanisms since it's unclear which one Naukri uses
   * here: a plain <input type="file"> that appears after the click (most
   * common for React upload widgets — doesn't need a native dialog at
   * all), falling back to a native OS file-chooser dialog if no such input
   * shows up.
   * @returns {Promise<boolean>} true if it found and handled the chip
   */
  async _autoHandleResumeUploadChip() {
    if (!this.resumePath) return false; // nothing to upload — leave it for manual review

    const uploadChip = await this._findChipByText(/^upload resume$/i);
    if (!uploadChip) return false;

    console.log('[naukri] Chat requested a resume upload — uploading automatically.');
    try {
      const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
      await uploadChip.click();
      await humanDelay(800, 1500);

      const fileInput = this.page.locator('input[type="file"]').first();
      if (await fileInput.count()) {
        await fileInput.setInputFiles(this.resumePath);
      } else {
        const chooser = await fileChooserPromise;
        if (chooser) {
          await chooser.setFiles(this.resumePath);
        } else {
          console.warn(
            '[naukri] Clicked "Upload Resume" but found neither a file input nor a native ' +
              'file dialog — the upload UI may differ from expected. Flagging for manual review.'
          );
          return false;
        }
      }

      await humanDelay(1500, 2500);
      console.log('[naukri] Resume uploaded.');
      return true;
    } catch (err) {
      console.warn(`[naukri] Found the resume-upload chip but the upload failed: ${err.message}`);
      return false;
    }
  }

  /** Finds a chip (direct child of .chatbot_Chips) whose text matches, or null. */
  async _findChipByText(pattern) {
    const container = this.page.locator(SELECTORS.chipsContainer).first();
    if (!(await container.count())) return null;
    const chip = container.locator('> div').filter({ hasText: pattern }).first();
    if (!(await chip.count()) || !(await chip.isVisible().catch(() => false))) return null;
    return chip;
  }

  /**
   * Detects a general chip-choice question (Yes/No, a city name list,
   * etc.) — the same UI as the resume-upload chips, but for anything other
   * than that specific case, which is auto-handled separately. Returns
   * null if the current chips ARE the resume-upload prompt (leave that to
   * _autoHandleResumeUploadChip) or if no chips are showing at all.
   * @returns {Promise<{ question: string, options: string[] } | null>}
   */
  async readChipQuestion() {
    const container = this.page.locator(SELECTORS.chipsContainer).first();
    if (!(await container.count()) || !(await container.isVisible().catch(() => false))) {
      return null;
    }

    const chips = container.locator('> div');
    const count = await chips.count();
    const options = [];
    for (let i = 0; i < count; i++) {
      const text = (await chips.nth(i).textContent())?.trim();
      if (text) options.push(text);
    }
    if (!options.length) return null;
    if (options.some((o) => /^upload resume$/i.test(o))) return null; // handled separately

    const question = await this._readCurrentQuestion();
    return { question, options };
  }

  /** Clicks the chip whose text matches optionText exactly (case-insensitive). */
  async selectChip(optionText) {
    const chip = await this._findChipByText(
      new RegExp(`^${optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    );
    if (!chip) {
      console.warn(`[naukri] Could not find a chip matching "${optionText}" to click.`);
      return false;
    }
    await chip.click();
    await humanDelay(400, 800);
    return true;
  }

  /**
   * Types an answer into the chat input WITHOUT submitting it, and reports
   * what actually landed. There's no maxlength attribute to check ahead of
   * time (it's a contenteditable div, cap varies per job) — so truncation
   * is only detectable after typing. Deliberately does not press Enter:
   * callers should retry with a shorter answer on truncation, then call
   * _confirmSubmit() only once satisfied — sending a garbled truncated
   * answer to a real recruiter is worse than a slightly slower retry.
   * @returns {Promise<{ submittedText: string, truncated: boolean }>}
   */
  async _typeAnswer(text) {
    const input = this.page.locator(SELECTORS.chatQuestionInput).first();
    await input.click();
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Backspace');
    // .fill() writes the DOM directly, which React-controlled contenteditable
    // elements often don't register as a real change. Simulating actual
    // keystrokes is more reliable here.
    await this.page.keyboard.type(text, { delay: 15 });
    await humanDelay(400, 900);

    const submittedText = (await input.textContent())?.trim() ?? '';
    const truncated = submittedText.length < text.trim().length;
    if (truncated) {
      console.warn(
        `[naukri] Input appears to cap length: typed ${text.trim().length} chars, ` +
          `only ${submittedText.length} landed in the box.`
      );
    }
    return { submittedText, truncated };
  }

  /** Submits whatever is currently in the chat input. */
  async _confirmSubmit() {
    await this.page.locator(SELECTORS.chatQuestionInput).first().press('Enter');
  }

  /**
   * Detects a single-select radio question (e.g. notice period, location)
   * — a different UI shape from the free-text chat input. Returns null if
   * one isn't currently showing, so callers can fall through to the
   * free-text flow.
   * @returns {Promise<{ question: string, options: string[] } | null>}
   */
  async readOptionQuestion() {
    const container = this.page.locator(SELECTORS.radioQuestionContainer).first();
    if (!(await container.count()) || !(await container.isVisible().catch(() => false))) {
      return null;
    }

    const question = await this._readCurrentQuestion();
    const labels = this.page.locator(SELECTORS.radioOptionLabel);
    const count = await labels.count();
    const options = [];
    for (let i = 0; i < count; i++) {
      const text = (await labels.nth(i).textContent())?.trim();
      // "Skip this question" is a real option but not one we want the LLM
      // choosing by default — only offer it if there's genuinely nothing
      // better, by leaving it out of the choice set entirely for now.
      if (text && !/^skip this question$/i.test(text)) options.push(text);
    }
    if (!options.length) return null;
    return { question, options };
  }

  /**
   * Clicks the radio option matching the given label text (must be one of
   * the strings readOptionQuestion() returned) and submits it.
   */
  async selectOption(optionText) {
    const options = this.page.locator(SELECTORS.radioOption);
    const count = await options.count();
    for (let i = 0; i < count; i++) {
      const label = (await options.nth(i).locator('label').textContent())?.trim();
      if (label === optionText) {
        await options.nth(i).locator('input[type="radio"]').click();
        await humanDelay(400, 800);
        // Selecting a radio may auto-advance the chat, or may need an
        // explicit Save click — try both, harmlessly, since clicking a
        // Save button that isn't there or is a no-op is safe.
        const saveBtn = this.page.locator('button:text-is("Save")').first();
        if ((await saveBtn.count()) && (await saveBtn.isEnabled().catch(() => false))) {
          await saveBtn.click();
        }
        return true;
      }
    }
    console.warn(`[naukri] Could not find a radio option matching "${optionText}" to click.`);
    return false;
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

  async close() {
    await this.context?.close();
    await this.browser?.close();
  }
}
