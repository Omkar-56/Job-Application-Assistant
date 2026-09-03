import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/config.js';
import { PostgresJobStore } from '../storage/postgresJobStore.js';
import * as runManager from './runManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (config.db.backend !== 'postgres') {
    throw new Error(
      'The dashboard requires STORAGE_BACKEND=postgres — the summary/filter ' +
        'queries it runs need a real database, not the JSON fallback store.'
    );
  }

  const store = new PostgresJobStore(config.db.connectionString, 'naukri');
  const app = express();

  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  app.get('/api/summary', async (req, res) => {
    try {
      res.json(await store.getSummary());
    } catch (err) {
      console.error('[dashboard] /api/summary failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/jobs', async (req, res) => {
    try {
      const { status, minScore, search, limit, offset } = req.query;
      const result = await store.listJobs({
        status: status || undefined,
        minScore: minScore ? Number(minScore) : undefined,
        search: search || undefined,
        limit: limit ? Math.min(Number(limit), 200) : 50,
        offset: offset ? Number(offset) : 0,
      });
      res.json(result);
    } catch (err) {
      console.error('[dashboard] /api/jobs failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/jobs/applied-today', async (req, res) => {
    try {
      res.json({ jobs: await store.getAppliedToday() });
    } catch (err) {
      console.error('[dashboard] /api/jobs/applied-today failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/jobs/needs-attention', async (req, res) => {
    try {
      res.json({ jobs: await store.getNeedsAttention() });
    } catch (err) {
      console.error('[dashboard] /api/jobs/needs-attention failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/runs/status', (req, res) => {
    res.json(runManager.getStatus());
  });

  app.get('/api/runs/logs', (req, res) => {
    const tail = req.query.tail ? Number(req.query.tail) : 200;
    res.json({ logs: runManager.getLogs(tail) });
  });

  app.post('/api/runs/discover-match', (req, res) => {
    try {
      runManager.startDiscoverMatch();
      res.status(202).json({ started: true });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  app.post('/api/runs/apply', (req, res) => {
    try {
      runManager.startApply();
      res.status(202).json({ started: true });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  app.listen(config.dashboard.port, () => {
    console.log(`[dashboard] Running at http://localhost:${config.dashboard.port}`);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
