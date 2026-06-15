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

// ── Import the core 9 API handlers (Phase 4b consolidated) ─────────────────
// daily-briefing, data-proxy, diagnostics absorbed into admin.js
// (capital-markets + bridges imported just below — Round 76fb)
import actionsHandler from './api/actions.js';
import adminHandler from './api/admin.js';
import applyChangeHandler from './api/apply-change.js';
import domainsHandler from './api/domains.js';
import entityHubHandler from './api/entity-hub.js';
import intakeHandler from './api/intake.js';
import operationsHandler from './api/operations.js';
import queueHandler from './api/queue.js';
import syncHandler from './api/sync.js';

// ── Two more existing Vercel functions that were never mounted on Railway ───
// (Round 76fb) — without these, /api/capital-markets and the /api/bridges
// family fell through to the SPA catch-all and returned index.html (200),
// breaking the Capital Markets dashboard/exports/RCA import and the
// Microsoft/Salesforce connector webhooks. Both .js files already exist and
// count toward the 12-function cap; this is purely Railway routing.
import capitalMarketsHandler from './api/capital-markets.js';
import bridgesHandler from './api/bridges.js';
// intake-share is the iOS Shortcut "Send to LCC" share-target (self-dispatching
// POST/GET/PATCH). Vercel auto-routes it; on Railway it was unmounted and fell
// through to the SPA shell, so the Shortcut got HTML back. No vercel.json change
// needed (no friendly alias — clients hit /api/intake-share directly).
import intakeShareHandler from './api/intake-share.js';

// ── App setup ───────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Deploy-derived asset version (R4-D #4, 2026-06-05) ──────────────────────
// index.html shipped hard-coded `?v=2026050802` cache-busters on every <script>.
// Because the value never changed across deploys, a Railway redeploy did NOT
// bust browser caches — users ran weeks-old frontends until a manual hard
// refresh (a contributor to the 2026-06-03 stale-export day). We now derive a
// version token from the deploy itself so every redeploy mints a fresh `?v=`.
// Railway injects RAILWAY_GIT_COMMIT_SHA / RAILWAY_DEPLOYMENT_ID; if neither is
// present (local/other host) we fall back to server-start time, which still
// changes on every restart/redeploy.
const DEPLOY_VERSION = (
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.RENDER_GIT_COMMIT ||
  process.env.SOURCE_VERSION ||
  String(Date.now())
).slice(0, 12);

// Serve index.html with (a) every asset `?v=…` rewritten to DEPLOY_VERSION and
// (b) a no-cache header on the HTML itself, so a redeployed bundle is always
// picked up on the next navigation. The static JS files keep their own
// validators; the changed query string is what forces the refetch.
let _indexHtmlCache = null;
function readIndexHtml() {
  if (_indexHtmlCache == null) {
    _indexHtmlCache = readFileSync(join(__dirname, 'index.html'), 'utf8');
  }
  // Rewrite existing ?v=<token> busters and append ?v= to any unversioned LOCAL
  // .js/.css refs so the deploy token is the single source of truth. The
  // negative lookahead skips absolute/CDN URLs (https://…, //…) so we never
  // rewrite Chart.js/pdf.js/xlsx and friends.
  return _indexHtmlCache
    .replace(/(\b(?:src|href)=")(?!https?:|\/\/)([^"?]+\.(?:js|css))(\?v=[^"]*)?(")/g,
      (_m, pre, path, _old, post) => `${pre}${path}?v=${DEPLOY_VERSION}${post}`);
}
function sendIndex(res) {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(readIndexHtml());
}
app.get(['/', '/index.html'], (req, res) => sendIndex(res));

// 30 MB matches the OM_INLINE_MAX_BYTES (25 MB) + headroom for base64 inflation
// of post-bytes JSON envelope. NorthMarq OMs from SF average 5-15 MB; the largest
// observed (Pizza Hut Fairview OM, ingested via Flow 7 backfill) was 27 MB.
app.use(express.json({ limit: '30mb' }));
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
app.all('/api/sf-sync-queue', (req, res) => { req.query._route = 'sf-sync-queue'; adminHandler(req, res); });
app.all('/api/storage-cleanup', (req, res) => { req.query._route = 'storage-cleanup'; adminHandler(req, res); });
app.all('/api/consolidate-property', (req, res) => { req.query._route = 'consolidate-property'; adminHandler(req, res); });
app.all('/api/geocode-tick', (req, res) => { req.query._route = 'geocode-tick'; adminHandler(req, res); });
app.all('/api/intake-rematch', (req, res) => { req.query._route = 'intake-rematch'; adminHandler(req, res); });
app.all('/api/intake-promote-drain', (req, res) => { req.query._route = 'intake-promote-drain'; adminHandler(req, res); });
app.all('/api/priority-band', (req, res) => { req.query._route = 'priority-band'; adminHandler(req, res); });
app.all('/api/priority-queue', (req, res) => { req.query._route = 'priority-queue'; adminHandler(req, res); });
app.all('/api/priority-trigger-properties', (req, res) => { req.query._route = 'priority-trigger-properties'; adminHandler(req, res); });
app.all('/api/review-counts', (req, res) => { req.query._route = 'review-counts'; adminHandler(req, res); });
app.all('/api/ops-health', (req, res) => { req.query._route = 'ops-health'; adminHandler(req, res); });
app.all('/api/fl-sos-enrich-link', (req, res) => { req.query._route = 'fl-sos-enrich-link'; adminHandler(req, res); });
app.all('/api/resolve-owner-link', (req, res) => { req.query._route = 'resolve-owner-link'; adminHandler(req, res); });
// R7 Phase 1 Slice 2 (2026-06-07): Decision Center list / verdict / SF search.
app.all('/api/decisions', (req, res) => { req.query._route = 'decisions'; adminHandler(req, res); });
app.all('/api/decision-verdict', (req, res) => { req.query._route = 'decision-verdict'; adminHandler(req, res); });
app.all('/api/decision-sf-search', (req, res) => { req.query._route = 'decision-sf-search'; adminHandler(req, res); });
app.all('/api/junk-bucket', (req, res) => { req.query._route = 'junk-bucket'; adminHandler(req, res); });
app.all('/api/exact-merge', (req, res) => { req.query._route = 'exact-merge'; adminHandler(req, res); });
// Round 77 (2026-05-21): SOS write-back (extension sidebar posts here via LCC_RAILWAY_URL) + research-task generator. Without these the Express server 404s them — vercel.json rewrites only apply on Vercel.
app.all('/api/sos-writeback', (req, res) => { req.query._route = 'sos-writeback'; adminHandler(req, res); });
app.all('/api/generate-research-tasks', (req, res) => { req.query._route = 'generate-research-tasks'; adminHandler(req, res); });
// NPI proxies posted by pg_cron (weekly-npi-lookup, weekly-npi-registry-sync) via lcc_cron_post → Railway.
// vercel.json rewrites only apply on Vercel, so without these the Express server returns "Cannot POST /api/npi-lookup".
app.all('/api/npi-lookup', (req, res) => { req.query._route = 'npi-lookup'; adminHandler(req, res); });
app.all('/api/npi-registry-sync', (req, res) => { req.query._route = 'npi-registry-sync'; adminHandler(req, res); });
// R4-D #3 (2026-06-05): these eight admin sub-routes existed in vercel.json but
// were never mounted on Railway, so on the live app they fell through to the
// SPA catch-all and returned index.html (E2E#1 class). The frontend ones broke
// loudly — gov.js's LLC-queue widget fetched /api/llc-research-queue, got
// "<!DOCTYPE …", and `resp.json()` threw "Unexpected token '<'". The cron-driven
// ones (offload/auto-scrape/merge-reconcile/sf-link/llc tick) silently 404'd
// against pg_cron POSTs. All eight map to real admin.js _route cases.
app.all('/api/llc-research-queue',         (req, res) => { req.query._route = 'llc-research-queue';         adminHandler(req, res); });
app.all('/api/resolve-llc-research',       (req, res) => { req.query._route = 'resolve-llc-research';       adminHandler(req, res); });
app.all('/api/llc-research-tick',          (req, res) => { req.query._route = 'llc-research-tick';          adminHandler(req, res); });
app.all('/api/chain-connect-tick',         (req, res) => { req.query._route = 'chain-connect-tick';         adminHandler(req, res); });
app.all('/api/chain-classify-tick',        (req, res) => { req.query._route = 'chain-classify-tick';        adminHandler(req, res); });
app.all('/api/resolve-listing-confirmation', (req, res) => { req.query._route = 'resolve-listing-confirmation'; adminHandler(req, res); });
app.all('/api/auto-scrape-listings',       (req, res) => { req.query._route = 'auto-scrape-listings';       adminHandler(req, res); });
app.all('/api/artifact-offload',           (req, res) => { req.query._route = 'artifact-offload';           adminHandler(req, res); });
app.all('/api/merge-log-reconcile',        (req, res) => { req.query._route = 'merge-log-reconcile';        adminHandler(req, res); });
app.all('/api/sf-link-tick',               (req, res) => { req.query._route = 'sf-link-tick';               adminHandler(req, res); });
app.all('/api/gov-buyer-sync',             (req, res) => { req.query._route = 'gov-buyer-sync';             adminHandler(req, res); });

// edge-data rewrites (formerly data-proxy)
app.all('/api/gov-query', (req, res) => { req.query._route = 'edge-data'; req.query._source = 'gov'; adminHandler(req, res); });
app.all('/api/gov-write', (req, res) => { req.query._route = 'edge-data'; req.query._edgeRoute = 'gov-write'; adminHandler(req, res); });
app.all('/api/gov-evidence', (req, res) => { req.query._route = 'edge-data'; req.query._edgeRoute = 'gov-evidence'; adminHandler(req, res); });
app.all('/api/dia-query', (req, res) => { req.query._route = 'edge-data'; req.query._source = 'dia'; adminHandler(req, res); });
// R5-FE-2 (2026-05-20): mirror the vercel.json /api/data-query rewrite on Railway.
// detail.js contact/ownership/Add-Contact lookups carry their own _source=gov|dia, so do NOT bake _source here.
app.all('/api/data-query', (req, res) => { req.query._route = 'edge-data'; adminHandler(req, res); });

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
app.all('/api/copilot-spec-v2', (req, res) => { req.query._route = 'chat'; req.query.copilot_spec = 'swagger2'; operationsHandler(req, res); });
app.all('/api/copilot-manifest', (req, res) => { req.query._route = 'chat'; req.query.copilot_spec = 'manifest'; operationsHandler(req, res); });
app.all('/api/chat', (req, res) => { req.query._route = 'chat'; operationsHandler(req, res); });
app.all('/api/draft', (req, res) => { req.query._route = 'draft'; operationsHandler(req, res); });
app.all('/api/preassemble', (req, res) => { req.query._route = 'context'; req.query.action = 'preassemble-nightly'; operationsHandler(req, res); });
app.all('/api/context', (req, res) => { req.query._route = 'context'; operationsHandler(req, res); });
app.all('/api/weekly-report', (req, res) => { req.query._route = 'context'; req.query.action = 'weekly-intelligence-report'; operationsHandler(req, res); });
app.all('/api/contact-acquisition-tick', (req, res) => { req.query._route = 'contact-acquisition-tick'; operationsHandler(req, res); });
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
app.all('/api/intake-create-property', (req, res) => { req.query._route = 'create-property'; intakeHandler(req, res); });
app.all('/api/intake-ocr-reextract', (req, res) => { req.query._route = 'ocr-reextract'; intakeHandler(req, res); });
app.all('/api/intake-discard', (req, res) => { req.query._route = 'discard'; intakeHandler(req, res); });
app.all('/api/intake-pdf', (req, res) => { req.query._route = 'ingest_pdf'; intakeHandler(req, res); });
// Phase 2 folder-feed worker (cron + manual): GET=dry-run, POST=drain.
app.all('/api/folder-feed-tick', (req, res) => { req.query._route = 'folder-feed-tick'; intakeHandler(req, res); });
// Phase 2 Slice 2d (Unit 3): bounded async extraction drain. GET=dry-run, POST=drain.
app.all('/api/intake-extract-drain', (req, res) => { req.query._route = 'intake-extract-drain'; intakeHandler(req, res); });

// Phase 2 Slice 2b: write an LCC-generated deliverable INTO a property folder.
app.all('/api/property-doc-writeback', (req, res) => { req.query._route = 'property-doc-writeback'; intakeHandler(req, res); });
// R15 Phase 2: backfill CRE property owners from master-sheet/BOV docs. GET=dry-run, POST=drain.
app.all('/api/cre-owner-backfill', (req, res) => { req.query._route = 'cre-owner-backfill'; intakeHandler(req, res); });

// Stage B widen: one-time LEASE backfill over the existing folder_feed_seen corpus
// (re-run the lease extractor on already-seen in-domain lease docs). GET=dry-run, POST=drain.
app.all('/api/lease-backfill', (req, res) => { req.query._route = 'lease-backfill'; intakeHandler(req, res); });

// Phase 2 Slice 3b (Unit 2): mirror Salesforce Task/Activity records into the
// canonical activity_events timeline (linked via external_identities).
app.all('/api/sf-activity', (req, res) => { req.query._route = 'sf-activity'; intakeHandler(req, res); });

// intake rewrites — slash-path Copilot action presets. These were present in
// vercel.json's rewrites but missing from server.js, so PA Flow requests to
// Railway hit Express's 404 handler. 2026-04-24 E2E test: PA Flow's
// LCC Flagged Email Intake calls /api/intake/prepare-upload (signed Storage
// upload URL step) and /api/intake/finalize-om. Also /api/intake/artifact
// is the signed-download endpoint used by the dashboard's "View OM" button.
app.all('/api/intake/stage-om', (req, res) => {
  req.query._route = 'copilot-action';
  req.query._preset_action = 'intake.stage.om.v1';
  intakeHandler(req, res);
});
app.all('/api/intake/prepare-upload', (req, res) => {
  req.query._route = 'copilot-action';
  req.query._preset_action = 'intake.prepare_upload.v1';
  intakeHandler(req, res);
});
app.all('/api/intake/finalize-om', (req, res) => {
  req.query._route = 'copilot-action';
  req.query._preset_action = 'intake.finalize.om.v1';
  intakeHandler(req, res);
});
app.all('/api/intake/artifact', (req, res) => {
  req.query._route = 'copilot-action';
  req.query._preset_action = 'intake.artifact_download.v1';
  intakeHandler(req, res);
});
app.all('/api/intake/feedback', (req, res) => {
  req.query._route = 'feedback';
  intakeHandler(req, res);
});
app.all('/api/intake/accuracy', (req, res) => {
  req.query._route = 'accuracy';
  intakeHandler(req, res);
});
app.all('/api/context/retrieve-entity', (req, res) => {
  req.query._route = 'copilot-action';
  req.query._preset_action = 'context.retrieve.entity.v1';
  intakeHandler(req, res);
});
app.all('/api/memory/log-turn', (req, res) => {
  req.query._route = 'copilot-action';
  req.query._preset_action = 'memory.log.turn.v1';
  intakeHandler(req, res);
});

// Copilot chat slash-paths per-surface — vercel.json uses :action path
// parameter. Express translates to :action route param, read into
// req.params.action and forwarded as _copilot_path query.
const copilotSurfaces = ['portfolio', 'ops', 'outreach', 'workflow', 'domain'];
for (const surface of copilotSurfaces) {
  app.all(`/api/copilot/${surface}/:action`, (req, res) => {
    req.query._route = 'chat';
    req.query._copilot_path = req.params.action;
    operationsHandler(req, res);
  });
}

// capital-markets — single function, handles its own ?action= dispatch.
// No vercel.json rewrites (clients hit /api/capital-markets directly), so the
// only thing needed on Railway is the bare route.
app.all('/api/capital-markets', capitalMarketsHandler);

// bridges — _route-dispatched. Mirror the vercel.json friendly aliases exactly
// (they are the source of truth for the _route/_source mapping) so Railway and
// Vercel behave identically.
app.all('/api/bridges', bridgesHandler);
app.all('/api/enrichment-worker',           (req, res) => { req.query._route = 'worker';   bridgesHandler(req, res); });
app.all('/api/salesforce-changes',          (req, res) => { req.query._route = 'ingest'; req.query._source = 'salesforce'; bridgesHandler(req, res); });
app.all('/api/sharepoint-changes',          (req, res) => { req.query._route = 'ingest'; req.query._source = 'sharepoint'; bridgesHandler(req, res); });
app.all('/api/outlook-changes',             (req, res) => { req.query._route = 'ingest'; req.query._source = 'outlook';    bridgesHandler(req, res); });
app.all('/api/calendar-changes',            (req, res) => { req.query._route = 'ingest'; req.query._source = 'calendar';   bridgesHandler(req, res); });
app.all('/api/sf-write',                    (req, res) => { req.query._route = 'write';    bridgesHandler(req, res); });
app.all('/api/cadence-tick',                (req, res) => { req.query._route = 'cadence';  bridgesHandler(req, res); });
app.all('/api/sharepoint-extract',          (req, res) => { req.query._route = 'sp_extract'; bridgesHandler(req, res); });
app.all('/api/sharepoint-extract-callback', (req, res) => { req.query._route = 'sp_extract'; req.query.action = 'callback'; bridgesHandler(req, res); });
app.all('/api/admin/bridges',               (req, res) => { req.query._route = 'admin';    bridgesHandler(req, res); });

// ── Primary handler routes (12 canonical endpoints) ─────────────────────────
app.all('/api/actions', actionsHandler);
app.all('/api/admin', adminHandler);
app.all('/api/apply-change', applyChangeHandler);
app.all('/api/domains', domainsHandler);
app.all('/api/entity-hub', entityHubHandler);
app.all('/api/intake', intakeHandler);
app.all('/api/operations', operationsHandler);
app.all('/api/queue', queueHandler);
app.all('/api/sync', syncHandler);
app.all('/api/intake-share', intakeShareHandler);

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
// index:false so express.static never serves the *unstamped* index.html — the
// explicit `/` + `/index.html` routes above (and the SPA fallback below) own
// index delivery and inject the deploy-version cache-buster (R4-D #4).
app.use(express.static(__dirname, {
  index: false,
  extensions: ['html']
}));

// SPA fallback — serve the version-stamped index.html for unmatched routes
app.get('*', (req, res) => sendIndex(res));

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
