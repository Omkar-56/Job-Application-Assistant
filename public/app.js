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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function refreshAll() {
  loadSummary().catch((err) => console.error(err));
  loadJobs().catch((err) => console.error(err));
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

refreshAll();
