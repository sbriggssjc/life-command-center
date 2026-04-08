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
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Import all 12 API handlers ──────────────────────────────────────────────
import actionsHandler from './api/actions.js';
import adminHandler from './api/admin.js';
import applyChangeHandler from './api/apply-change.js';
import dailyBriefingHandler from './api/daily-briefing.js';
import dataProxyHandler from './api/data-proxy.js';
import diagnosticsHandler from './api/diagnostics.js';
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

// diagnostics rewrites
app.all('/api/config', (req, res) => { req.query._route = 'config'; diagnosticsHandler(req, res); });
app.all('/api/diag', (req, res) => { req.query._route = 'diag'; diagnosticsHandler(req, res); });
app.all('/api/treasury', (req, res) => { req.query._route = 'treasury'; diagnosticsHandler(req, res); });

// data-proxy rewrites
app.all('/api/gov-query', (req, res) => { req.query._source = 'gov'; dataProxyHandler(req, res); });
app.all('/api/gov-write', (req, res) => { req.query._route = 'gov-write'; dataProxyHandler(req, res); });
app.all('/api/gov-evidence', (req, res) => { req.query._route = 'gov-evidence'; dataProxyHandler(req, res); });
app.all('/api/dia-query', (req, res) => { req.query._source = 'dia'; dataProxyHandler(req, res); });

// actions rewrites
app.all('/api/activities', (req, res) => { req.query._route = 'activities'; actionsHandler(req, res); });

// admin rewrites
app.all('/api/workspaces', (req, res) => { req.query._route = 'workspaces'; adminHandler(req, res); });
app.all('/api/members', (req, res) => { req.query._route = 'members'; adminHandler(req, res); });
app.all('/api/flags', (req, res) => { req.query._route = 'flags'; adminHandler(req, res); });
app.all('/api/auth-config', (req, res) => { req.query._route = 'auth-config'; adminHandler(req, res); });
app.all('/api/me', (req, res) => { req.query._route = 'me'; adminHandler(req, res); });

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
app.all('/api/connectors', (req, res) => { req.query._route = 'connectors'; syncHandler(req, res); });

// operations rewrites (copilot, chat, draft, bridge, workflows)
app.all('/api/copilot-spec', (req, res) => { req.query._route = 'chat'; req.query.copilot_spec = 'openapi'; operationsHandler(req, res); });
app.all('/api/copilot-manifest', (req, res) => { req.query._route = 'chat'; req.query.copilot_spec = 'manifest'; operationsHandler(req, res); });
app.all('/api/chat', (req, res) => { req.query._route = 'chat'; operationsHandler(req, res); });
app.all('/api/draft', (req, res) => { req.query._route = 'draft'; operationsHandler(req, res); });
app.all('/api/preassemble', (req, res) => { req.query._route = 'context'; req.query.action = 'preassemble-nightly'; operationsHandler(req, res); });
app.all('/api/bridge', operationsHandler);
app.all('/api/workflows', operationsHandler);

// entity-hub rewrites
app.all('/api/unified-contacts', (req, res) => { req.query._domain = 'contacts'; entityHubHandler(req, res); });
app.all('/api/contacts', (req, res) => { req.query._domain = 'contacts'; entityHubHandler(req, res); });
app.all('/api/entities', (req, res) => { req.query._domain = 'entities'; entityHubHandler(req, res); });

// intake rewrites
app.all('/api/intake-outlook-message', (req, res) => { req.query._route = 'outlook-message'; intakeHandler(req, res); });
app.all('/api/intake-summary', (req, res) => { req.query._route = 'summary'; intakeHandler(req, res); });

// ── Primary handler routes (12 canonical endpoints) ─────────────────────────
app.all('/api/actions', actionsHandler);
app.all('/api/admin', adminHandler);
app.all('/api/apply-change', applyChangeHandler);
app.all('/api/daily-briefing', dailyBriefingHandler);
app.all('/api/data-proxy', dataProxyHandler);
app.all('/api/diagnostics', diagnosticsHandler);
app.all('/api/domains', domainsHandler);
app.all('/api/entity-hub', entityHubHandler);
app.all('/api/intake', intakeHandler);
app.all('/api/operations', operationsHandler);
app.all('/api/queue', queueHandler);
app.all('/api/sync', syncHandler);

// ── Legal pages (required by Teams manifest) ──────────────────────────────
app.get('/privacy', (req, res) => res.type('text/plain').send(
  'Life Command Center — Team Briggs, Northmarq Net Lease Investment Sales. Internal tool.'
));
app.get('/terms', (req, res) => res.type('text/plain').send(
  'Life Command Center — internal tool for Team Briggs use only. Not for public distribution.'
));

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[LCC] Server running on port ${PORT}`);
  console.log(`[LCC] Environment: ${process.env.LCC_ENV || 'development'}`);
});
