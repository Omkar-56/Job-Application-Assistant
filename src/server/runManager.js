import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const MAX_LOG_LINES = 500;

let state = {
  running: false,
  kind: null, // 'discover-match' | 'apply'
  startedAt: null,
  finishedAt: null,
  exitCode: null,
};
let logs = [];

function appendLog(line) {
  logs.push(line);
  if (logs.length > MAX_LOG_LINES) logs.shift();
}

/** Runs one script to completion as a child process, capturing its output into the shared log. */
function runScript(scriptPath, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...extraEnv },
    });
    child.stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach(appendLog));
    child.stderr.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => appendLog(`[stderr] ${l}`)));
    child.on('close', (code) => resolve(code));
    child.on('error', (err) => {
      appendLog(`[spawn error] ${err.message}`);
      resolve(1);
    });
  });
}

export function getStatus() {
  return { ...state };
}

export function getLogs(tail = 200) {
  return logs.slice(-tail);
}

/** Discovery followed by AI matching — never applies to anything. */
export function startDiscoverMatch() {
  if (state.running) throw new Error('A run is already in progress.');
  state = { running: true, kind: 'discover-match', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null };
  logs = [];

  (async () => {
    // Dashboard-triggered runs are unattended by design — no visible
    // browser needed since nobody's watching for this kind of run.
    const env = { HEADLESS: 'true' };
    appendLog('=== Starting discovery ===');
    const discoverCode = await runScript(path.join(PROJECT_ROOT, 'src', 'index.js'), env);
    appendLog(`=== Discovery finished (exit code ${discoverCode}) ===`);

    let matchCode = null;
    if (discoverCode === 0) {
      appendLog('=== Starting AI matching ===');
      matchCode = await runScript(path.join(PROJECT_ROOT, 'src', 'match.js'), env);
      appendLog(`=== Matching finished (exit code ${matchCode}) ===`);
    } else {
      appendLog('=== Skipping matching — discovery did not exit cleanly ===');
    }

    state.exitCode = matchCode ?? discoverCode;
    state.running = false;
    state.finishedAt = new Date().toISOString();
  })();
}

/**
 * Applies to discovered jobs. Always forced to DRY_RUN=true and
 * HEADLESS=true, regardless of .env — a background/unattended run has no
 * terminal for the batch-review or per-answer confirmations to prompt on,
 * and dry-run mode is the one path that never reaches those prompts at
 * all (applyToJob returns before ever clicking Apply). Live applications
 * remain a deliberate CLI action (`npm run apply:headed` with
 * DRY_RUN=false) where those interactive safety checks work properly.
 */
export function startApply() {
  if (state.running) throw new Error('A run is already in progress.');
  state = { running: true, kind: 'apply', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null };
  logs = [];

  (async () => {
    appendLog('=== Starting apply run (dashboard runs are always DRY_RUN — see docs) ===');
    const code = await runScript(path.join(PROJECT_ROOT, 'src', 'apply.js'), {
      DRY_RUN: 'true',
      HEADLESS: 'true',
    });
    appendLog(`=== Apply run finished (exit code ${code}) ===`);
    state.exitCode = code;
    state.running = false;
    state.finishedAt = new Date().toISOString();
  })();
}
