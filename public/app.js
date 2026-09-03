const STATUS_META = {
  discovered: { label: 'Discovered', cardLabel: 'Discovered / Pending' },
  dry_run: { label: 'Dry run', cardLabel: 'Dry Run' },
  applied: { label: 'Applied', cardLabel: 'Applied' },
  needs_manual_review: { label: 'Needs review', cardLabel: 'Needs Review' },
  external_site: { label: 'External site', cardLabel: 'External Site' },
  failed: { label: 'Failed', cardLabel: 'Failed' },
};

const PAGE_SIZE = 25;
let currentOffset = 0;
let currentTotal = 0;

const el = (id) => document.getElementById(id);

async function loadSummary() {
  const res = await fetch('/api/summary');
  if (!res.ok) throw new Error('Failed to load summary');
  const summary = await res.json();
  renderSummary(summary);
}

function renderSummary(summary) {
  const byStatus = summary.byStatus || {};
  const cards = [
    { value: summary.total ?? 0, label: 'Total Tracked', accent: true },
    { value: byStatus.applied ?? 0, label: STATUS_META.applied.cardLabel },
    { value: byStatus.needs_manual_review ?? 0, label: STATUS_META.needs_manual_review.cardLabel },
    { value: byStatus.external_site ?? 0, label: STATUS_META.external_site.cardLabel },
    { value: byStatus.failed ?? 0, label: STATUS_META.failed.cardLabel },
    { value: byStatus.discovered ?? 0, label: STATUS_META.discovered.cardLabel },
    { value: byStatus.dry_run ?? 0, label: STATUS_META.dry_run.cardLabel },
    { value: summary.avgMatchScore ?? '—', label: `Avg Match Score${summary.scoredCount ? ` (${summary.scoredCount} scored)` : ''}` },
    { value: summary.appliedLast7Days ?? 0, label: 'Applied — Last 7 Days' },
  ];

  el('summaryCards').innerHTML = cards
    .map(
      (c) => `
      <div class="card ${c.accent ? 'card-accent' : ''}">
        <div class="card-value">${c.value}</div>
        <div class="card-label">${c.label}</div>
      </div>`
    )
    .join('');
}

async function loadJobs() {
  const params = new URLSearchParams();
  const search = el('searchInput').value.trim();
  const status = el('statusFilter').value;
  const minScore = el('minScoreFilter').value;

  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (minScore) params.set('minScore', minScore);
  params.set('limit', PAGE_SIZE);
  params.set('offset', currentOffset);

  const res = await fetch(`/api/jobs?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load jobs');
  const { jobs, total } = await res.json();
  currentTotal = total;
  renderJobs(jobs);
  renderPagination();
}

function scoreClass(score) {
  if (score === null || score === undefined) return 'score-none';
  if (score >= 75) return 'score-high';
  if (score >= 50) return 'score-mid';
  return 'score-low';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderJobs(jobs) {
  const tbody = el('jobsBody');
  const emptyState = el('emptyState');

  if (!jobs.length) {
    tbody.innerHTML = '';
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  tbody.innerHTML = jobs
    .map((job) => {
      const meta = STATUS_META[job.applicationStatus] || { label: job.applicationStatus || 'unknown' };
      const dateLabel = job.appliedAt ? formatDate(job.appliedAt) : formatDate(job.matchedAt || job.postedDate);
      const scoreLabel = job.matchScore === null || job.matchScore === undefined ? '—' : `${job.matchScore}`;

      return `
        <tr>
          <td>
            <p class="job-title">${escapeHtml(job.title)}</p>
            <p class="job-company">${escapeHtml(job.company || '')}</p>
          </td>
          <td>${escapeHtml(job.location || '—')}</td>
          <td>${escapeHtml(job.experience || '—')}</td>
          <td><span class="score-badge ${scoreClass(job.matchScore)}">${scoreLabel}</span></td>
          <td><span class="badge" style="color:var(--status-${job.applicationStatus});background:var(--status-${job.applicationStatus}-bg)">${escapeHtml(meta.label)}</span></td>
          <td class="date-cell">${dateLabel}</td>
          <td class="link-cell">${job.url ? `<a href="${escapeHtml(job.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</td>
        </tr>`;
    })
    .join('');
}

function renderPagination() {
  const start = currentTotal === 0 ? 0 : currentOffset + 1;
  const end = Math.min(currentOffset + PAGE_SIZE, currentTotal);
  el('pageInfo').textContent = `${start}–${end} of ${currentTotal}`;
  el('prevPage').disabled = currentOffset === 0;
  el('nextPage').disabled = end >= currentTotal;
}

function renderMiniList(containerId, jobs, { emptyText, showReason }) {
  const container = el(containerId);
  if (!jobs.length) {
    container.innerHTML = `<div class="mini-empty">${emptyText}</div>`;
    return;
  }
  container.innerHTML = jobs
    .map((job) => {
      const meta = STATUS_META[job.applicationStatus] || { label: job.applicationStatus };
      const reasonBadge = showReason
        ? `<span class="badge" style="color:var(--status-${job.applicationStatus});background:var(--status-${job.applicationStatus}-bg)">${escapeHtml(meta.label)}</span>`
        : `<span class="date-cell">${formatDate(job.appliedAt)}</span>`;
      return `
        <div class="mini-item">
          <div>
            <p class="mini-item-title">${escapeHtml(job.title)}</p>
            <p class="mini-item-company">${escapeHtml(job.company || '')}</p>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            ${reasonBadge}
            ${job.url ? `<a href="${escapeHtml(job.url)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--primary);font-weight:600;text-decoration:none;">Open ↗</a>` : ''}
          </div>
        </div>`;
    })
    .join('');
}

async function loadAppliedToday() {
  const res = await fetch('/api/jobs/applied-today');
  if (!res.ok) throw new Error('Failed to load applied-today');
  const { jobs } = await res.json();
  renderMiniList('appliedTodayList', jobs, { emptyText: 'No applications submitted today yet.', showReason: false });
}

async function loadNeedsAttention() {
  const res = await fetch('/api/jobs/needs-attention');
  if (!res.ok) throw new Error('Failed to load needs-attention');
  const { jobs } = await res.json();
  renderMiniList('needsAttentionList', jobs, { emptyText: 'Nothing needs your attention right now.', showReason: true });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function refreshAll() {
  loadSummary().catch((err) => console.error(err));
  loadJobs().catch((err) => console.error(err));
  loadAppliedToday().catch((err) => console.error(err));
  loadNeedsAttention().catch((err) => console.error(err));
}

let searchDebounce;
el('searchInput').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentOffset = 0;
    loadJobs().catch((err) => console.error(err));
  }, 300);
});

el('statusFilter').addEventListener('change', () => {
  currentOffset = 0;
  loadJobs().catch((err) => console.error(err));
});

el('minScoreFilter').addEventListener('change', () => {
  currentOffset = 0;
  loadJobs().catch((err) => console.error(err));
});

el('prevPage').addEventListener('click', () => {
  currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
  loadJobs().catch((err) => console.error(err));
});

el('nextPage').addEventListener('click', () => {
  currentOffset += PAGE_SIZE;
  loadJobs().catch((err) => console.error(err));
});

el('refreshBtn').addEventListener('click', refreshAll);

// --- Run triggers (Discover+Match / Apply) ---
let pollTimer = null;
let logsVisible = false;

async function triggerRun(endpoint, button) {
  button.disabled = true;
  try {
    const res = await fetch(endpoint, { method: 'POST' });
    if (res.status === 409) {
      const { error } = await res.json();
      alert(error || 'A run is already in progress.');
      button.disabled = false;
      return;
    }
    if (!res.ok) throw new Error('Failed to start run');
    startPolling();
  } catch (err) {
    console.error(err);
    alert('Could not start the run — check the server console.');
    button.disabled = false;
  }
}

el('runDiscoverBtn').addEventListener('click', () => triggerRun('/api/runs/discover-match', el('runDiscoverBtn')));
el('runApplyBtn').addEventListener('click', () => {
  if (!confirm('This runs Apply in dry-run mode (dashboard runs never submit real applications). Continue?')) return;
  triggerRun('/api/runs/apply', el('runApplyBtn'));
});

el('toggleLogsBtn').addEventListener('click', () => {
  logsVisible = !logsVisible;
  el('runLogs').hidden = !logsVisible;
  el('toggleLogsBtn').textContent = logsVisible ? 'Hide logs' : 'Show logs';
});

function startPolling() {
  el('runBanner').hidden = false;
  if (pollTimer) return;
  pollTimer = setInterval(pollRunStatus, 2000);
  pollRunStatus();
}

async function pollRunStatus() {
  const [statusRes, logsRes] = await Promise.all([fetch('/api/runs/status'), fetch('/api/runs/logs?tail=200')]);
  const status = await statusRes.json();
  const { logs } = await logsRes.json();

  const statusEl = el('runBannerStatus');
  const kindLabel = status.kind === 'discover-match' ? 'Discover + Match' : status.kind === 'apply' ? 'Apply (dry run)' : '';

  if (status.running) {
    statusEl.textContent = `${kindLabel} running…`;
    statusEl.className = 'run-banner-status status-running';
  } else if (status.exitCode === 0) {
    statusEl.textContent = `${kindLabel} finished successfully.`;
    statusEl.className = 'run-banner-status status-done';
    stopPollingAndRefresh();
  } else if (status.exitCode !== null) {
    statusEl.textContent = `${kindLabel} finished with errors (exit code ${status.exitCode}) — check logs.`;
    statusEl.className = 'run-banner-status status-error';
    logsVisible = true;
    el('runLogs').hidden = false;
    el('toggleLogsBtn').textContent = 'Hide logs';
    stopPollingAndRefresh();
  }

  el('runLogs').textContent = logs.join('\n');
  el('runLogs').scrollTop = el('runLogs').scrollHeight;
}

function stopPollingAndRefresh() {
  clearInterval(pollTimer);
  pollTimer = null;
  el('runDiscoverBtn').disabled = false;
  el('runApplyBtn').disabled = false;
  refreshAll();
}

// Resume polling on page load if a run was already active (e.g. page refreshed mid-run)
fetch('/api/runs/status')
  .then((r) => r.json())
  .then((status) => {
    if (status.running) startPolling();
  })
  .catch(() => {});

refreshAll();
