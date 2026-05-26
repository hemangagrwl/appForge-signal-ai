/**
 * AppForge Server v2
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { runPipeline } from './pipeline/orchestrator.js';
import { getAllPrompts } from './evaluation/dataset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend/public')));

app.post('/api/generate', async (req, res) => {
  const { prompt, skipClarification = false } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
    return res.status(400).json({ error: 'Prompt must be at least 3 characters' });
  }
  try {
    const result = await runPipeline(prompt.trim(), { skipClarification });
    return res.json(result);
  } catch (err) {
    console.error('[Server] Pipeline error:', err);
    return res.status(500).json({ error: err.message, success: false });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});

app.get('/api/examples', (req, res) => {
  res.json({ prompts: getAllPrompts() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🔥 AppForge v2 running at http://localhost:${PORT}\n`);
});

export default app;
