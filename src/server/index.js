import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chatHandler } from './chat.js';
import { auditHandler } from './audit.js';
import { adminRouter } from './admin.js';
import { getSession } from './sessions.js';
import { handoffManager } from './handoff.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3001'] }));
app.use(express.json());

// ── Chat endpoints ─────────────────────────────────────────────────────────────
app.post('/api/chat',               chatHandler);
app.get('/api/audit/:sessionId',    auditHandler);

// ── Admin API (no auth — dev/internal only) ────────────────────────────────────
app.use('/api/admin', adminRouter);

// ── Legacy admin panel (static HTML) at /admin-ops ────────────────────────────
// The new React handoff admin is served by Vite at /admin.
app.use('/admin-ops', express.static(join(__dirname, '../admin')));

// ── Debug endpoint ─────────────────────────────────────────────────────────────
app.get('/api/session/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  return res.json(session);
});

// ── HTTP server (wraps express for WebSocket upgrade support) ──────────────────
const server = http.createServer(app);

// ── WebSocket server — live handoff ───────────────────────────────────────────
handoffManager.init(server);

server.listen(PORT, () => {
  console.log(`Meridian bot server running on http://localhost:${PORT}`);
  console.log(`Legacy admin panel:  http://localhost:${PORT}/admin-ops`);
  console.log(`WebSocket endpoint:  ws://localhost:${PORT}/ws`);
});
