// ============================================================================
// Express Server — Railway deployment entry point
// Life Command Center
//
// Replaces Vercel serverless function routing with a single Express server.
// All 12 API handlers are mounted with identical URL paths and rewrite aliases
// from vercel.json. No handler code is modified — they remain (req, res) => {}.
// ============================================================================

import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Import all 9 API handlers (Phase 4b consolidated) ──────────────────────
// daily-briefing, data-proxy, diagnostics absorbed into admin.js
import actionsHandler from './api/actions.js';
import adminHandler from './api/admin.js';
import applyChangeHandler from './api/apply-change.js';
import domainsHandler from './api/domains.js';
import entityHubHandler from './api/entity-hub.js';
import intakeHandler from './api/intake.js';
import operationsHandler from './api/operations.js';
import queueHandler from './api/queue.js';
import syncHandler from './api/sync.js';

// ── App setup ───────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'Prefer',
    'X-LCC-Key', 'X-LCC-User-Id', 'X-LCC-User-Email', 'X-LCC-Workspace'
  ]
}));

// ── Security headers (replicate vercel.json headers) ────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

// Cache-Control for API routes
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// ── Rewrite aliases (vercel.json rewrites → Express routes) ─────────────────
// Each rewrite sets the same query params that vercel.json would inject,
// then delegates to the target handler.

// admin rewrites (formerly diagnostics + data-proxy + daily-briefing)
app.all('/api/config', (req, res) => { req.query._route = 'config'; adminHandler(req, res); });
app.all('/api/diag', (req, res) => { req.query._route = 'diag'; adminHandler(req, res); });
app.all('/api/treasury', (req, res) => { req.query._route = 'treasury'; adminHandler(req, res); });
app.all('/api/daily-briefing', (req, res) => { req.query._route = 'edge-brief'; req.query.action = 'snapshot'; adminHandler(req, res); });
app.all('/api/cms-match', (req, res) => { req.query._route = 'cms-match'; adminHandler(req, res); });
app.all('/api/ownership-reconcile', (req, res) => { req.query._route = 'ownership-reconcile'; adminHandler(req, res); });

// edge-data rewrites (formerly data-proxy)
app.all('/api/gov-query', (req, res) => { req.query._route = 'edge-data'; req.query._source = 'gov'; adminHandler(req, res); });
app.all('/api/gov-write', (req, res) => { req.query._route = 'edge-data'; req.query._edgeRoute = 'gov-write'; adminHandler(req, res); });
app.all('/api/gov-evidence', (req, res) => { req.query._route = 'edge-data'; req.query._edgeRoute = 'gov-evidence'; adminHandler(req, res); });
app.all('/api/dia-query', (req, res) => { req.query._route = 'edge-data'; req.query._source = 'dia'; adminHandler(req, res); });

// actions rewrites
app.all('/api/activities', (req, res) => { req.query._route = 'activities'; actionsHandler(req, res); });

// admin sub-route rewrites
app.all('/api/workspaces', (req, res) => { req.query._route = 'workspaces'; adminHandler(req, res); });
app.all('/api/members', (req, res) => { req.query._route = 'members'; adminHandler(req, res); });
app.all('/api/flags', (req, res) => { req.query._route = 'flags'; adminHandler(req, res); });
app.all('/api/auth-config', (req, res) => { req.query._route = 'auth-config'; adminHandler(req, res); });
app.all('/api/me', (req, res) => { req.query._route = 'me'; adminHandler(req, res); });
app.all('/api/connectors', (req, res) => { req.query._route = 'connectors'; adminHandler(req, res); });

// queue rewrites
app.all('/api/queue-v2', (req, res) => { req.query._version = 'v2'; queueHandler(req, res); });
app.all('/api/inbox', (req, res) => { req.query._route = 'inbox'; queueHandler(req, res); });

// sync rewrites
app.all('/api/rcm-ingest', (req, res) => { req.query._route = 'rcm-ingest'; syncHandler(req, res); });
app.all('/api/rcm-backfill', (req, res) => { req.query._route = 'rcm-backfill'; syncHandler(req, res); });
app.all('/api/live-ingest', (req, res) => { req.query._route = 'live-ingest'; syncHandler(req, res); });
app.all('/api/loopnet-ingest', (req, res) => { req.query._route = 'loopnet-ingest'; syncHandler(req, res); });
app.all('/api/lead-health', (req, res) => { req.query._route = 'lead-health'; syncHandler(req, res); });
app.all('/api/cross-domain-match', (req, res) => { req.query._route = 'cross-domain-match'; syncHandler(req, res); });
app.all('/api/listing-webhook', (req, res) => { req.query._route = 'listing-webhook'; syncHandler(req, res); });

// operations rewrites (copilot, chat, draft, bridge, workflows, context)
app.all('/api/copilot/portfolio/:action', (req, res) => { req.query._route = 'chat'; req.query._copilot_path = req.params.action; operationsHandler(req, res); });
app.all('/api/copilot/ops/:action', (req, res) => { req.query._route = 'chat'; req.query._copilot_path = req.params.action; operationsHandler(req, res); });
app.all('/api/copilot/outreach/:action', (req, res) => { req.query._route = 'chat'; req.query._copilot_path = req.params.action; operationsHandler(req, res); });
app.all('/api/copilot/workflow/:action', (req, res) => { req.query._route = 'chat'; req.query._copilot_path = req.params.action; operationsHandler(req, res); });
app.all('/api/copilot/domain/:action', (req, res) => { req.query._route = 'chat'; req.query._copilot_path = req.params.action; operationsHandler(req, res); });
app.all('/api/copilot-spec', (req, res) => { req.query._route = 'chat'; req.query.copilot_spec = 'openapi'; operationsHandler(req, res); });
app.all('/api/copilot-manifest', (req, res) => { req.query._route = 'chat'; req.query.copilot_spec = 'manifest'; operationsHandler(req, res); });
app.all('/api/chat', (req, res) => { req.query._route = 'chat'; operationsHandler(req, res); });
app.all('/api/draft', (req, res) => { req.query._route = 'draft'; operationsHandler(req, res); });
app.all('/api/preassemble', (req, res) => { req.query._route = 'context'; req.query.action = 'preassemble-nightly'; operationsHandler(req, res); });
app.all('/api/context', (req, res) => { req.query._route = 'context'; operationsHandler(req, res); });
app.all('/api/weekly-report', (req, res) => { req.query._route = 'context'; req.query.action = 'weekly-intelligence-report'; operationsHandler(req, res); });
app.all('/api/bridge', operationsHandler);
app.all('/api/workflows', operationsHandler);

// entity-hub rewrites
app.all('/api/unified-contacts', (req, res) => { req.query._domain = 'contacts'; entityHubHandler(req, res); });
app.all('/api/contacts', (req, res) => { req.query._domain = 'contacts'; entityHubHandler(req, res); });
app.all('/api/entities', (req, res) => { req.query._domain = 'entities'; entityHubHandler(req, res); });
app.all('/api/property', (req, res) => { req.query._domain = 'property'; entityHubHandler(req, res); });
app.all('/api/contact', (req, res) => { req.query._domain = 'contact'; entityHubHandler(req, res); });
app.all('/api/search', (req, res) => { req.query._domain = 'search'; entityHubHandler(req, res); });
app.all('/api/briefing-email', (req, res) => { req.query._domain = 'briefing-email'; entityHubHandler(req, res); });
app.all('/api/recalculate-cap-rates', (req, res) => { req.query._domain = 'cap-rate-recalc'; entityHubHandler(req, res); });

// intake rewrites
app.all('/api/copilot/action', (req, res) => { req.query._route = 'copilot-action'; intakeHandler(req, res); });
app.all('/api/intake-outlook-message', (req, res) => { req.query._route = 'outlook-message'; intakeHandler(req, res); });
app.all('/api/intake-summary', (req, res) => { req.query._route = 'summary'; intakeHandler(req, res); });
app.all('/api/intake-extract', (req, res) => { req.query._route = 'extract'; intakeHandler(req, res); });
app.all('/api/intake-queue', (req, res) => { req.query._route = 'queue'; intakeHandler(req, res); });
app.all('/api/intake-promote', (req, res) => { req.query._route = 'promote'; intakeHandler(req, res); });
app.all('/api/intake-discard', (req, res) => { req.query._route = 'discard'; intakeHandler(req, res); });
app.all('/api/intake-pdf', (req, res) => { req.query._route = 'ingest_pdf'; intakeHandler(req, res); });

// ── Primary handler routes (9 canonical endpoints) ──────────────────────────
app.all('/api/actions', actionsHandler);
app.all('/api/admin', adminHandler);
app.all('/api/apply-change', applyChangeHandler);
app.all('/api/domains', domainsHandler);
app.all('/api/entity-hub', entityHubHandler);
app.all('/api/intake', intakeHandler);
app.all('/api/operations', operationsHandler);
app.all('/api/queue', queueHandler);
app.all('/api/sync', syncHandler);

// ── Legal pages (required by Teams manifest) ──────────────────────────────
// ── Health check — no auth, no DB, used by Railway deployment healthcheck ──
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', ts: Date.now() }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', ts: Date.now() }));

app.get('/privacy', (req, res) => res.type('text/plain').send(
  'Life Command Center — Team Briggs, Northmarq Net Lease Investment Sales. Internal tool.'
));
app.get('/terms', (req, res) => res.type('text/plain').send(
  'Life Command Center — internal tool for Team Briggs use only. Not for public distribution.'
));

// ── Serve Office Add-in files ──────────────────────────────────────────────
// Manifest and taskpane HTML for Outlook, Excel, and Word sideloadable add-ins.
// RAILWAY_URL placeholder is replaced at serve time with the actual base URL.

app.get('/office-addins/:addin/taskpane.html', (req, res) => {
  const { addin } = req.params;
  const allowed = ['outlook', 'excel', 'word'];
  if (!allowed.includes(addin)) return res.status(404).send('Not found');
  try {
    const html = readFileSync(
      join(__dirname, 'office-addins', addin, 'taskpane.html'), 'utf8'
    );
    const baseUrl = process.env.LCC_BASE_URL || req.protocol + '://' + req.get('host');
    const injected = html.replace(/RAILWAY_URL/g, baseUrl);
    // Office Add-ins load in a WebView/iframe — allow framing
    res.removeHeader('X-Frame-Options');
    res.type('text/html').send(injected);
  } catch { res.status(404).send('Add-in not found'); }
});

app.get('/office-addins/:addin/manifest.xml', (req, res) => {
  const { addin } = req.params;
  const allowed = ['outlook', 'excel', 'word'];
  if (!allowed.includes(addin)) return res.status(404).send('Not found');
  try {
    const xml = readFileSync(
      join(__dirname, 'office-addins', addin, 'manifest.xml'), 'utf8'
    ).replace(/RAILWAY_URL/g,
      process.env.LCC_BASE_URL || req.protocol + '://' + req.get('host')
    );
    res.type('application/xml').send(xml);
  } catch { res.status(404).send('Manifest not found'); }
});

// ── Static files ────────────────────────────────────────────────────────────
app.use(express.static(__dirname, {
  index: 'index.html',
  extensions: ['html']
}));

// SPA fallback — serve index.html for unmatched routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// ── Start server ────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);

process.on('uncaughtException', (err) => {
  console.error('[LCC] FATAL uncaughtException:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[LCC] FATAL unhandledRejection:', reason);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[LCC] Server running on port ${PORT}`);
  console.log(`[LCC] Bound to 0.0.0.0:${PORT}`);
  console.log(`[LCC] Health: http://0.0.0.0:${PORT}/health`);
  console.log(`[LCC] Environment: ${process.env.LCC_ENV || 'development'}`);
});
