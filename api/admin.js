// ============================================================================
// Admin API — Consolidated: workspaces, members, flags, connectors, diagnostics, edge proxies
// Life Command Center  (cache-bust: force rebuild of handler imports)
//
// Routed via vercel.json rewrites:
//   /api/workspaces  → /api/admin?_route=workspaces
//   /api/members     → /api/admin?_route=members
//   /api/flags       → /api/admin?_route=flags
//   /api/connectors  → /api/admin?_route=connectors
//   /api/config      → /api/admin?_route=config
//   /api/diag        → /api/admin?_route=diag
//   /api/treasury    → /api/admin?_route=treasury
//   /api/gov-query   → /api/admin?_route=edge-data&_source=gov
//   /api/dia-query   → /api/admin?_route=edge-data&_source=dia
//   /api/gov-write   → /api/admin?_route=edge-data&_edgeRoute=gov-write
//   /api/gov-evidence→ /api/admin?_route=edge-data&_edgeRoute=gov-evidence
//   /api/daily-briefing → /api/admin?_route=edge-brief
//   /api/cms-match   → /api/admin?_route=cms-match
//   /api/ownership-reconcile → /api/admin?_route=ownership-reconcile
//   /api/npi-lookup  → /api/admin?_route=npi-lookup
//   /api/merge-log-reconcile → /api/admin?_route=merge-log-reconcile  (Round 76ee Phase 2)
// ============================================================================

import { authenticate, requireRole, primaryWorkspace, handleCors, authReadiness } from './_shared/auth.js';
import { opsQuery, pgFilterVal, requireOps, withErrorHandler, fetchWithTimeout } from './_shared/ops-db.js';
import { ROLES } from './_shared/lifecycle.js';
import { domainQuery } from './_shared/domain-db.js';
import { reconcilePropertyOwnership } from './_handlers/sidebar-pipeline.js';
import { lookupLlc } from './_shared/llc-research.js';
import { handleFlSosEnrichLink } from './_shared/fl-sos-enrich-link.js';
import { findSalesforceAccountByName, isSalesforceConfigured } from './_shared/salesforce.js';
import { handleGeocodeTick } from './_handlers/geocode-backfill.js';
import { runDownstreamPipeline } from './_handlers/intake-extractor.js';
import { createPropertyFromIntake } from './_handlers/intake-create-property.js';
import {
  isNonDealSnapshot, hasFullDealSignature, normalizeDocType,
  snapshotLooksLikeListing, LISTING_DOCUMENT_TYPES,
} from './_shared/intake-classify.js';
import { normalizeState, parseContactFromJunk } from './_shared/entity-link.js';
import { diaSupabaseKey, govSupabaseKey } from './_shared/supabase-keys.js';

// Default flag values — safe defaults for gradual rollout
const DEFAULT_FLAGS = {
  strict_auth: false,
  queue_v2_enabled: false,
  queue_v2_auto_fallback: true,
  auto_sync_on_load: false,
  sync_outlook_enabled: true,
  sync_salesforce_enabled: true,
  sync_outbound_enabled: false,
  team_queue_enabled: true,
  escalations_enabled: false,
  bulk_operations_enabled: false,
  domain_templates_enabled: false,
  domain_sync_enabled: false,
  mutation_fallback_enabled: false,
  ops_pages_enabled: true,
  more_drawer_enabled: true,
  freshness_indicators: true,

  // ── Edge Migration Flags (Phase 0–4) ──
  // When enabled, frontend routes requests to Supabase Edge Functions
  // instead of Vercel API endpoints. Disable to instantly roll back.
  edge_context_broker: false,     // Phase 1: Context Broker → Supabase Edge
  edge_lead_ingest: false,        // Phase 2: RCM + LoopNet lead ingest → Supabase Edge
  edge_intake_receiver: false,    // Phase 2: Outlook email intake → Supabase Edge
  edge_copilot_chat: false,       // Phase 3: Chat / Copilot → Supabase Edge
  edge_template_service: false,   // Phase 3: Template drafts → Supabase Edge
  edge_daily_briefing: false,     // Phase 4: Daily briefing → Supabase Edge
  edge_data_query: false,         // Phase 4: Gov/Dia data queries → Supabase Edge
};

const VALID_ROLES = ROLES;

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const route = req.query._route;
  switch (route) {
    case 'workspaces':  return handleWorkspaces(req, res);
    case 'members':     return handleMembers(req, res);
    case 'flags':       return handleFlags(req, res);
    case 'auth-config': return handleAuthConfig(req, res);
    case 'me':          return handleMe(req, res);
    case 'connectors':  return handleConnectors(req, res);
    case 'config':      return handleConfig(req, res);
    case 'diag':        return handleDiag(req, res);
    case 'treasury':    return handleTreasury(req, res);
    case 'edge-data':   return handleEdgeDataProxy(req, res);
    case 'edge-brief':  return handleEdgeBriefingProxy(req, res);
    case 'cms-match':   return handleCmsMatch(req, res);
    case 'ownership-reconcile': return handleOwnershipReconcile(req, res);
    case 'sf-sync-queue':       return handleSfSyncQueue(req, res);
    case 'storage-cleanup':     return handleStorageCleanup(req, res);
    case 'artifact-offload':    return handleArtifactOffload(req, res);
    case 'consolidate-property': return handleConsolidateProperty(req, res);
    case 'npi-lookup':           return handleNpiLookupProxy(req, res);
    case 'npi-registry-sync':    return handleNpiRegistrySyncProxy(req, res);
    case 'merge-log-reconcile':  return handleMergeLogReconcile(req, res);
    case 'auto-scrape-listings': return handleAutoScrapeListings(req, res);
    case 'availability-promotion-sweep': return handleAvailabilityPromotionSweep(req, res);
    case 'resolve-listing-confirmation': return handleResolveListingConfirmation(req, res);
    case 'geocode-tick':         return handleGeocodeTick(req, res);
    case 'dia-link-provenance-replay': return handleDiaLinkProvenanceReplay(req, res);
    case 'llc-research-tick':       return handleLlcResearchTick(req, res);
    case 'intake-rematch':         return handleIntakeRematch(req, res);
    case 'sf-link-tick':            return handleSfLinkTick(req, res);
    case 'next-best-action':        return handleNextBestAction(req, res);
    case 'client-error':            return handleClientErrorReport(req, res);
    case 'llc-research-queue':      return handleLlcResearchQueueList(req, res);
    case 'resolve-llc-research':    return handleResolveLlcResearch(req, res);
    case 'sos-writeback':           return handleSosWriteback(req, res);
    case 'generate-research-tasks': return handleGenerateResearchTasks(req, res);
    case 'agency-drift-queue':      return handleAgencyDriftQueueList(req, res);
    case 'resolve-agency-drift':    return handleResolveAgencyDrift(req, res);
    case 'write-failures-rollup':   return handleWriteFailuresRollup(req, res);
    case 'resolve-orphan-sale':     return handleResolveOrphanSale(req, res);
    case 'resolve-lease-tenant-drift': return handleResolveLeaseTenantDrift(req, res);
    case 'resolve-cms-chain-drift':    return handleResolveCmsChainDrift(req, res);
    case 'priority-band':              return handlePriorityBand(req, res);
    case 'priority-queue':             return handlePriorityQueueList(req, res);
    case 'review-counts':              return handleReviewCounts(req, res);
    case 'ops-health':                 return handleOpsHealth(req, res);
    case 'fl-sos-enrich-link':         return handleFlSosEnrichLink(req, res);
    case 'resolve-owner-link':         return handleResolveOwnerLink(req, res);
    case 'decisions':                  return handleDecisionsList(req, res);
    case 'decision-verdict':           return handleDecisionVerdict(req, res);
    case 'decision-sf-search':         return handleDecisionSfSearch(req, res);
    case 'junk-bucket':                return handleJunkBucket(req, res);
    case 'exact-merge':                return handleExactMerge(req, res);
    default:
      return res.status(400).json({ error: 'Unknown admin route' });
  }
});

// ============================================================================
// OPS HEALTH (2026-05-31)
// GET /api/ops-health -> one batched read of the system-health views so a human
//   can finally see failing crons, dead/stalled workers, open alerts, flow
//   failures, and write-failure pile-ups in-app. Every section is best-effort:
//   a failed sub-read yields null so the surface still renders. The stuck-LLC
//   regression that degraded silently for days is exactly what this surfaces.
// ============================================================================
async function handleOpsHealth(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const opsRead = async (path) => {
    try { const r = await opsQuery('GET', path); return r.ok ? (Array.isArray(r.data) ? r.data : []) : null; }
    catch (_e) { return null; }
  };
  const opsCount = async (path) => {
    try { const r = await opsQuery('GET', path + (path.includes('?') ? '&' : '?') + 'select=*&limit=1', undefined, { countMode: 'exact' }); return r.ok ? (r.count || 0) : null; }
    catch (_e) { return null; }
  };
  // Cross-domain LLC worker health: queued vs in_progress (stuck) per domain.
  const domCount = async (dom, path) => {
    try { const r = await domainQuery(dom, 'GET', path + (path.includes('?') ? '&' : '?') + 'select=*&limit=1', { 'Prefer': 'count=exact' }); return r.ok ? (r.count || 0) : null; }
    catch (_e) { return null; }
  };

  const [
    openAlerts, openFlowFailures, cronSummary,
    writeFail24h, writeFailTop, writeFail7d,
    diaLlcQueued, diaLlcInProgress, govLlcQueued, govLlcInProgress,
  ] = await Promise.all([
    opsRead('v_lcc_health_alerts_open?select=alert_kind,source,severity,summary,detected_at,age_hours&order=detected_at.desc&limit=50'),
    opsRead('v_flow_run_failures_open?select=flow_name,failed_action,error_kind,error_detail_short,severity,detected_at&order=detected_at.desc&limit=50'),
    opsRead('v_cron_health_summary?select=alert_kind,source,severity,summary,detected_at,resolved_at&order=detected_at.desc&limit=50'),
    opsCount('v_ingest_write_failures_24h'),
    opsRead('v_ingest_write_failures_top_24h?select=domain,method,http_status,path_norm,failures_24h,sample_error&order=failures_24h.desc&limit=5'),
    opsCount('v_ingest_write_failures_recent'),  // 7d, kept as context only
    domCount('dia', 'llc_research_queue?status=eq.queued'),
    domCount('dia', 'llc_research_queue?status=eq.in_progress'),
    domCount('gov', 'llc_research_queue?status=eq.queued'),
    domCount('gov', 'llc_research_queue?status=eq.in_progress'),
  ]);

  // Worker health rollup: flag stuck-in_progress (the regression signature).
  const workers = [
    { key: 'llc_research_dia', label: 'LLC/SOS research (Dialysis)', queued: diaLlcQueued, in_progress: diaLlcInProgress,
      status: (diaLlcInProgress != null && diaLlcInProgress > 25) ? 'stuck' : (diaLlcQueued ? 'idle_backlog' : 'ok') },
    { key: 'llc_research_gov', label: 'LLC/SOS research (Government)', queued: govLlcQueued, in_progress: govLlcInProgress,
      status: (govLlcInProgress != null && govLlcInProgress > 25) ? 'stuck' : (govLlcQueued ? 'idle_backlog' : 'ok') },
  ];

  const alerts = openAlerts || [];
  const flows = openFlowFailures || [];
  const crons = (cronSummary || []).filter(r => !r.resolved_at);

  const topFail = (Array.isArray(writeFailTop) && writeFailTop[0]) ? writeFailTop[0] : null;
  return res.status(200).json({
    generated_at: new Date().toISOString(),
    summary: {
      open_alerts: alerts.length,
      open_flow_failures: flows.length,
      open_cron_issues: crons.length,
      // Honest window (R7 Phase 2.3): 24h count + the single worst path, with
      // the 7d figure demoted to context. The old "write_failures_recent" was a
      // 7d total mislabeled "recent" and hid the LLC 23514 storm in the noise.
      write_failures_24h: writeFail24h,
      write_failures_7d: writeFail7d,
      write_failures_top: topFail ? {
        domain: topFail.domain, method: topFail.method, http_status: topFail.http_status,
        path: topFail.path_norm, count_24h: topFail.failures_24h, sample_error: topFail.sample_error,
      } : null,
      workers_stuck: workers.filter(w => w.status === 'stuck').length,
    },
    alerts, flow_failures: flows, cron_issues: crons, workers,
    write_failures_top_24h: Array.isArray(writeFailTop) ? writeFailTop : [],
  });
}

// ============================================================================
// REVIEW CONSOLE COUNTS (UX move #2b, 2026-05-31)
// GET /api/review-counts -> one batched call returning live counts for each
//   work-type lane of the Review Console, across LCC Opps + gov + dia. Every
//   count is best-effort: a failed sub-query yields null for that metric so the
//   console still renders. Counts use ?select=..&limit=1 + count=exact header,
//   read from result.count (content-range), never pulling row bodies.
// ============================================================================
async function handleReviewCounts(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  // --------------------------------------------------------------------------
  // Performance (Round 76qa.13, 2026-06-03). These are HEADLINE approximations
  // ("~13k to review"), not exact band chips, so the count strategy differs
  // from QA#3/QA#4 (which need exact small counts and must stay count=exact):
  //   * Ops-local lanes (v_field_provenance_actionable ~3.6s, v_stale_identities,
  //     v_unlinked_entities) are read from a pg_cron-refreshed cache table
  //     (lcc_review_lane_counts). count=exact on the provenance view dominated
  //     the endpoint, and count=estimated is unusable there (planner estimates
  //     765 rows vs 13k actual). See the cache migration.
  //   * Big domain tables with accurate planner stats (gov ownership_research_queue
  //     ~738ms, dia v_next_best_research ~192ms) use count=estimated — a sub-ms
  //     EXPLAIN estimate instead of a full scan.
  //   * Small/cheap domain lanes keep count=exact (precise number, ~ms cost).
  // Every lane is wrapped in a per-lane timeout so one slow/hung source resolves
  // to null (+ a status marker) instead of blocking the whole batch.
  // --------------------------------------------------------------------------

  // Per-lane timeout. The internal fetch timeouts (8s ops / 30s domain) are too
  // coarse to keep this endpoint under its sub-1s budget. Resolves to
  // { value, status } where status is 'ok' | 'timeout' | 'error'.
  const LANE_TIMEOUT_MS = 3500;
  const withLaneTimeout = (p) => Promise.race([
    Promise.resolve(p).then(
      (value) => ({ value, status: 'ok' }),
      ()      => ({ value: null, status: 'error' }),
    ),
    new Promise((resolve) =>
      setTimeout(() => resolve({ value: null, status: 'timeout' }), LANE_TIMEOUT_MS)),
  ]);

  // Live count of a domain source. countMode 'exact' (default) for small/cheap
  // lanes; 'estimated' for big tables with healthy stats.
  // NOTE: the Prefer header MUST be domainQuery's 5th (extraHeaders) arg — the
  // previous form passed it as the 4th (body) arg, which GET silently drops, so
  // no count header was ever sent and every domain lane resolved to 0.
  const domCount = async (dom, path, countMode = 'exact') => {
    try {
      const r = await domainQuery(dom, 'GET',
        path + (path.includes('?') ? '&' : '?') + 'select=*&limit=1',
        undefined, { 'Prefer': `count=${countMode}` });
      return r.ok && typeof r.count === 'number' ? r.count : null;
    } catch (_e) { return null; }
  };
  const opsCount = async (path, countMode = 'exact') => {
    try {
      const r = await opsQuery('GET',
        path + (path.includes('?') ? '&' : '?') + 'select=*&limit=1',
        undefined, { countMode });
      return r.ok && typeof r.count === 'number' ? r.count : null;
    } catch (_e) { return null; }
  };

  // Read the cron-refreshed ops-local cache (sub-ms). Stale after 4 missed
  // 5-minute refreshes.
  const CACHE_STALE_MS = 20 * 60 * 1000;
  const opsCache = {};
  let opsCacheAt = null;
  try {
    const c = await withLaneTimeout(opsQuery('GET',
      'lcc_review_lane_counts?select=lane_key,lane_count,computed_at',
      undefined, { countMode: 'none' }));
    if (c.status === 'ok' && c.value && c.value.ok && Array.isArray(c.value.data)) {
      for (const row of c.value.data) {
        opsCache[row.lane_key] = Number(row.lane_count);
        if (!opsCacheAt || row.computed_at > opsCacheAt) opsCacheAt = row.computed_at;
      }
    }
  } catch (_e) { /* fall through to live reads below */ }
  const opsCacheStale = opsCacheAt
    ? (Date.now() - new Date(opsCacheAt).getTime() > CACHE_STALE_MS) : true;

  // An ops lane: prefer the cache; fall back to a live read (cold deploy before
  // the first cron tick) so a lane is never silently zero.
  const opsLane = (key, livePath) => {
    if (typeof opsCache[key] === 'number') {
      return Promise.resolve({ value: opsCache[key], status: opsCacheStale ? 'stale' : 'ok' });
    }
    return withLaneTimeout(opsCount(livePath));
  };

  // Fire all lane sub-counts in parallel; each resolves to { value, status }.
  const [
    provConflicts, staleIdentities, unlinkedEntities,
    diaResearch, govOwnershipQueue, diaLlc, govLlc,
    govDupAddr, govPending, govSosLinks, stagedIntakeReview,
  ] = await Promise.all([
    opsLane('data_conflicts',    'v_field_provenance_actionable'),
    opsLane('stale_identities',  'v_stale_identities'),
    opsLane('unlinked_entities', 'v_unlinked_entities'),
    withLaneTimeout(domCount('dia', 'v_next_best_research', 'estimated')),
    withLaneTimeout(domCount('gov', 'ownership_research_queue', 'estimated')),
    withLaneTimeout(domCount('dia', 'llc_research_queue?status=eq.queued')),
    withLaneTimeout(domCount('gov', 'llc_research_queue?status=eq.queued')),
    withLaneTimeout(domCount('gov', 'v_data_quality_issues?issue_kind=eq.duplicate_property_address')),
    withLaneTimeout(domCount('gov', 'pending_updates?status=eq.pending')),
    withLaneTimeout(domCount('gov', 'v_recorded_owner_link_review')),
    // R4-C §3: the round-3 staged-intake review queue had no console surface.
    // Its per-item actions (Create property / Re-extract OCR / View extraction)
    // now live on the Inbox cards, so the lane deep-links there.
    withLaneTimeout(opsCount('staged_intake_items?status=in.(review_required,failed)')),
  ]);

  const val = (r) => (r && typeof r.value === 'number') ? r.value : null;
  const sum = (...rs) => {
    const v = rs.map(val).filter((x) => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  // Worst status across a lane's contributing sources: timeout/error -> partial,
  // a stale cache hit -> stale, otherwise ok.
  const laneStatus = (...rs) => {
    if (rs.some((r) => r && (r.status === 'timeout' || r.status === 'error'))) return 'partial';
    if (rs.some((r) => r && r.status === 'stale')) return 'stale';
    return 'ok';
  };

  // Lanes mirror the audit's work-type spine. label/icon are UI hints; count
  // is the headline; href is the existing surface to deep-link into until each
  // lane gets its own dedicated worker view. count_mode tells the UI whether a
  // figure is exact, an estimate, or a cached (possibly stale) value.
  const lanes = [
    { key: 'ownership_research', label: 'Ownership & LLC research',
      count: sum(diaResearch, govOwnershipQueue, diaLlc, govLlc),
      parts: { dia_next_best: val(diaResearch), gov_ownership_queue: val(govOwnershipQueue), dia_llc_queued: val(diaLlc), gov_llc_queued: val(govLlc) },
      count_mode: 'estimated', status: laneStatus(diaResearch, govOwnershipQueue, diaLlc, govLlc),
      href: 'pageResearch', tone: 'red' },
    { key: 'data_conflicts', label: 'Data conflicts & provenance',
      count: sum(provConflicts), parts: { actionable: val(provConflicts) },
      count_mode: 'cached', status: laneStatus(provConflicts),
      href: 'pageDataQuality', tone: 'yellow' },
    { key: 'merges_dupes', label: 'Property merges & duplicates',
      count: sum(govDupAddr), parts: { gov_dup_address: val(govDupAddr) },
      count_mode: 'exact', status: laneStatus(govDupAddr),
      href: 'pageDataQuality', tone: 'yellow' },
    { key: 'pending_updates', label: 'Pending updates (Gov)',
      count: sum(govPending), parts: { pending: val(govPending) },
      count_mode: 'exact', status: laneStatus(govPending),
      href: 'pageResearch', tone: '' },
    { key: 'intake_identity', label: 'Intake & identity',
      count: sum(staleIdentities, unlinkedEntities),
      parts: { stale_identities: val(staleIdentities), unlinked_entities: val(unlinkedEntities) },
      count_mode: 'cached', status: laneStatus(staleIdentities, unlinkedEntities),
      href: 'pageDataQuality', tone: 'yellow' },
    { key: 'sos_owner_links', label: 'Owner-contact links to confirm',
      count: sum(govSosLinks), parts: { fl_sos_weak_links: val(govSosLinks) },
      count_mode: 'exact', status: laneStatus(govSosLinks),
      href: 'pageDataQuality', tone: '' },
    { key: 'staged_intake_review', label: 'Staged intake — needs review',
      count: sum(stagedIntakeReview),
      parts: { review_required_or_failed: val(stagedIntakeReview) },
      count_mode: 'exact', status: laneStatus(stagedIntakeReview),
      href: 'pageInbox', tone: 'yellow' },
  ];

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    ops_cache_at: opsCacheAt,
    degraded: lanes.some((l) => l.status === 'partial'),
    lanes,
  });
}

// ============================================================================
// PRIORITY BAND (Phase 8, PR3 2026-05-30)
// GET /api/priority-band?domain=gov&property_id=16404
//   -> the owner's BD priority band for a property, from v_priority_queue_enriched
//      on LCC Opps. Powers the owner-level row at the top of the property-detail
//      prospecting feed. Returns null-ish ({band:null}) when the property's owner
//      is not in the queue, so the front-end degrades gracefully.
// Also accepts ?entity_id=<uuid> to look up an entity-level band directly.
// ============================================================================
async function handlePriorityBand(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const domainRaw = String(req.query.domain || '').toLowerCase();
  const domain = domainRaw === 'government' ? 'gov' : domainRaw === 'dialysis' ? 'dia' : domainRaw;
  const propertyId = req.query.property_id != null ? String(req.query.property_id) : null;
  const entityId = req.query.entity_id ? String(req.query.entity_id) : null;

  if (!entityId && !(domain && propertyId)) {
    return res.status(400).json({ error: 'Provide entity_id, or domain + property_id' });
  }

  const selectCols = [
    'entity_id', 'name', 'vertical', 'priority_band', 'reason',
    'owner_role_confidence', 'effective_owner_role', 'is_cross_vertical',
    'total_property_count', 'current_property_count', 'next_touch_due',
    'days_overdue', 'source_domain', 'source_property_id', 'source_property_address',
    // R6: ownership-resolution context so the detail Next-Step banner stays
    // consistent with the queue's P0.4 verdict (same state source).
    'resolve_reason', 'resolve_true_owner_name', 'resolve_is_connected',
  ].join(',');

  let path;
  if (entityId) {
    path = 'v_priority_queue_enriched?select=' + selectCols
         + '&entity_id=eq.' + pgFilterVal(entityId) + '&limit=1';
  } else {
    // source_domain on the view is canonical short-form (dia/gov) as of E2E#5
    // (2026-06-03). Accept the legacy long form too during the transition so a
    // not-yet-migrated row still matches. (This was the third dia/gov alias bug:
    // the old eq.<long-form> filter silently missed every short-form row — e.g.
    // P5 dia 26502 / Palestra Properties returned no band.)
    const srcForms = domain === 'gov' ? '(gov,government)'
                   : domain === 'dia' ? '(dia,dialysis)'
                   : '(' + domain + ')';
    path = 'v_priority_queue_enriched?select=' + selectCols
         + '&source_domain=in.' + srcForms
         + '&source_property_id=eq.' + pgFilterVal(propertyId)
         + '&limit=1';
  }

  const r = await opsQuery('GET', path);
  if (!r.ok) {
    // Soft-fail: the front-end treats a non-ok / empty result as "no band".
    console.warn('[priority-band] query failed:', r.status, r.data);
    return res.status(200).json({ priority_band: null });
  }
  const row = Array.isArray(r.data) ? r.data[0] : (r.data || null);

  // Persisted lead/cadence truth for the property's owner entity (Bug c,
  // 2026-06-03). Resolve the open prospect opportunity + cadence keyed on the
  // entity — either the one passed in, or the one the queue resolved for this
  // property. This lets the property "Next step" banner render the real state
  // ("Lead is live" / "On cadence ✓") on a fresh reopen instead of stale-
  // banding back to "Create the lead". Falls back to null on any soft failure.
  const effectiveEntityId = entityId || (row && row.entity_id) || null;
  const oppState = effectiveEntityId
    ? await resolveOwnerOppState(effectiveEntityId)
    : { open_opportunity: false, bd_opportunity_id: null, cadence_next_touch_due: null };

  if (!row) {
    // No queue row: still surface the opportunity/cadence truth (the owner may
    // be led but no longer "due", so they've dropped out of the band view).
    return res.status(200).json({
      priority_band: null,
      entity_id: effectiveEntityId,
      open_opportunity: oppState.open_opportunity,
      bd_opportunity_id: oppState.bd_opportunity_id,
      cadence_next_touch_due: oppState.cadence_next_touch_due,
    });
  }

  // Normalize owner name + numeric confidence for the UI.
  return res.status(200).json({
    priority_band: row.priority_band || null,
    reason: row.reason || null,
    owner_name: row.name || null,
    owner_role: row.effective_owner_role || null,
    owner_role_confidence: row.owner_role_confidence != null ? Number(row.owner_role_confidence) : null,
    is_cross_vertical: !!row.is_cross_vertical,
    total_property_count: row.total_property_count != null ? Number(row.total_property_count) : null,
    next_touch_due: row.next_touch_due || null,
    days_overdue: row.days_overdue != null ? Number(row.days_overdue) : null,
    entity_id: row.entity_id || null,
    source_property_address: row.source_property_address || null,
    open_opportunity: oppState.open_opportunity,
    bd_opportunity_id: oppState.bd_opportunity_id,
    cadence_next_touch_due: oppState.cadence_next_touch_due,
    // R6 ownership-resolution context (drives the banner's "Resolve ownership
    // & control" step when the owner isn't yet connected).
    resolve_reason: row.resolve_reason || null,
    resolve_true_owner_name: row.resolve_true_owner_name || null,
    resolve_is_connected: row.resolve_is_connected != null ? !!row.resolve_is_connected : null,
  });
}

// Resolve an owner entity's persisted BD state: is there an OPEN prospect
// opportunity, and what is the latest cadence next-touch date. Two cheap reads
// against LCC Opps; soft-fails to "no opportunity" so the banner degrades
// gracefully. (Bug c, 2026-06-03)
async function resolveOwnerOppState(entityId) {
  const out = { open_opportunity: false, bd_opportunity_id: null, cadence_next_touch_due: null };
  try {
    const oppR = await opsQuery('GET',
      'bd_opportunities?select=id&entity_id=eq.' + pgFilterVal(entityId)
      + '&type=eq.prospect&is_open=is.true&order=opened_at.desc&limit=1');
    if (oppR.ok && Array.isArray(oppR.data) && oppR.data[0]) {
      out.open_opportunity = true;
      out.bd_opportunity_id = oppR.data[0].id || null;
    }
  } catch (_e) { /* soft-fail */ }
  try {
    const cadR = await opsQuery('GET',
      'touchpoint_cadence?select=next_touch_due&entity_id=eq.' + pgFilterVal(entityId)
      + '&order=updated_at.desc&limit=1');
    if (cadR.ok && Array.isArray(cadR.data) && cadR.data[0]) {
      out.cadence_next_touch_due = cadR.data[0].next_touch_due || null;
    }
  } catch (_e) { /* soft-fail */ }
  return out;
}

// Batch-resolve open-prospect-opportunity state for a page of priority-queue
// rows (R4-C §2 state-aware CTA). One cheap read per ~80 entities lets the
// front-end pick the right CTA per row (Open opportunity / Log touch / View
// opportunity) instead of always showing "Open opportunity →". Soft-fails to
// leaving open_opportunity undefined so the UI falls back to band inference.
async function attachPqOppState(items) {
  const ids = Array.from(new Set(
    (Array.isArray(items) ? items : [])
      .map(it => it && it.entity_id)
      .filter(Boolean)
      .map(String)
  ));
  if (!ids.length) return;
  const openSet = new Set();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    // UUIDs are safe inside an unquoted PostgREST in.() list.
    const inList = 'in.(' + chunk.join(',') + ')';
    try {
      const r = await opsQuery('GET',
        'bd_opportunities?select=entity_id&type=eq.prospect&is_open=is.true&entity_id=' + inList);
      if (r.ok && Array.isArray(r.data)) {
        for (const row of r.data) if (row && row.entity_id) openSet.add(String(row.entity_id));
      }
    } catch (_e) { /* soft-fail: leave this chunk unresolved */ }
  }
  for (const it of items) {
    if (it && it.entity_id) it.open_opportunity = openSet.has(String(it.entity_id));
  }
}

// ============================================================================
// PRIORITY QUEUE LIST (BD front door, 2026-06-03)
// GET /api/priority-queue?band=<P1|P0.5|...>&limit=<n>&offset=<n>
//   The 'start here' worklist: the doctrinal priority bands from
//   v_priority_queue_enriched, ordered most-urgent first. Returns per-band
//   counts (for the filter chips) + a page of enriched rows carrying the
//   property reference so each row routes straight into the BD spine.
// ============================================================================
async function handlePriorityQueueList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const band = req.query.band ? String(req.query.band) : null;
  const limit = Math.min(300, Math.max(1, parseInt(req.query.limit || '150', 10)));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

  const selectCols = [
    'entity_id', 'name', 'vertical', 'priority_band', 'reason', 'days_overdue',
    'next_touch_due', 'owner_role_confidence', 'effective_owner_role', 'is_cross_vertical',
    'total_property_count', 'current_property_count', 'current_annual_rent_total', 'avg_cap_rate',
    'source_domain', 'source_property_id', 'source_property_address',
    'source_property_city', 'source_property_state', 'source_property_lease_expiration',
    'source_property_firm_term_remaining',
    // R5 P-BUYER lane: parent rollup of the SPE portfolio (NULL on other bands).
    'buyer_spe_count', 'buyer_rollup_property_count', 'buyer_rollup_annual_rent',
    'buyer_last_acquisition_date', 'buyer_sf_account_id', 'buyer_needs_sf_mapping',
    // R6 P0.4 resolve band: ownership-resolution context.
    'resolve_reason', 'resolve_true_owner_name', 'resolve_is_connected',
  ].join(',');

  // Items page: most-urgent band first, then most-overdue within band, then
  // by portfolio value so the rows worth the most rank above no-value rows
  // (R4-C §2: P0.5 had 488 identical rows with no-value items sorting above
  // $385K-rent ones). current_annual_rent_total breaks the within-band tie.
  let itemsPath = 'v_priority_queue_enriched?select=' + selectCols
    + '&order=priority_band.asc,days_overdue.desc.nullslast,current_annual_rent_total.desc.nullslast'
    + '&limit=' + limit + '&offset=' + offset;
  if (band) itemsPath += '&priority_band=eq.' + pgFilterVal(band);

  // Per-band counts for the chip row. Read the pre-aggregated view so the
  // 1000-row PostgREST cap can't truncate the tally (QA#3). The view collapses
  // the queue to one row per band, so a plain select returns every band.
  const countsPath = 'v_priority_queue_band_counts?select=priority_band,n';

  // R7 Phase 0 (2026-06-07): the ~5-7s queue floor is gone. v_priority_queue
  // and its buyer-SPE root are now materialized into cron-refreshed cache
  // tables (lcc_priority_queue_resolved / lcc_buyer_spe_resolved) that
  // v_priority_queue + v_priority_queue_band_counts + v_priority_queue_enriched
  // read transparently (cache-or-live; an empty cache falls back to the live
  // computation, so this is safe regardless of deploy order). Measured live:
  // unfiltered enriched 5,785ms -> ~1,140ms raw; the items page ~866ms; band
  // counts 627ms -> 68ms. So the R6 hotfix's 25s band-aid (which only existed
  // to keep the inherently-slow read from being aborted into a 500) is no
  // longer needed — the read is back under the default fetchWithTimeout budget.
  //   countMode:'none' is retained on its own merits: the handler derives
  //   `total` from the band-counts rows and never consumes itemsR.count, so an
  //   exact COUNT would be a pure extra full-source pass.
  // Band-counts also soft-fails independently below: a hiccup on the chips view
  // must never take down the page — items still render with empty chips.
  const HEAVY = { countMode: 'none' };
  const countsR0 = opsQuery('GET', countsPath, undefined, HEAVY)
    .catch((e) => {
      console.warn('[priority-queue] band-counts query threw:', e?.message || e);
      return { ok: false, status: 0, data: null };
    });
  const [itemsR, countsR] = await Promise.all([
    opsQuery('GET', itemsPath, undefined, HEAVY),
    countsR0,
  ]);
  if (!itemsR.ok) {
    console.warn('[priority-queue] items query failed:', itemsR.status, itemsR.data);
    return res.status(502).json({ error: 'list_failed', detail: itemsR.data });
  }
  const items = Array.isArray(itemsR.data) ? itemsR.data : [];

  // Attach persisted open-opportunity truth so the CTA can be state-aware.
  await attachPqOppState(items);

  const countMap = {};
  let total = 0;
  if (countsR.ok && Array.isArray(countsR.data)) {
    for (const r of countsR.data) {
      const b = r.priority_band || '?';
      const n = Number(r.n) || 0;
      countMap[b] = n; total += n;
    }
  }
  // Stable doctrinal order for the chips.
  const BAND_ORDER = ['P0','P0.4','P0.5','P-BUYER','P1','P2','P3','P4','P5','P6','P7','P8'];
  const counts = Object.keys(countMap)
    .sort((a, b) => (BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b)))
    .map(b => ({ band: b, n: countMap[b] }));

  return res.status(200).json({ counts, total, band: band || null, items });
}

// ============================================================================
// DECISION CENTER (R7 Phase 1, Slice 2 — 2026-06-07)
// ============================================================================
// The Review Console becomes the Decision Center: one surface, lanes keyed by
// the QUESTION being asked (decision_type). The decision record (lcc_decisions)
// is first-class; verdicts RIDE EXISTING MACHINERY (ensureEntityLink, the
// lcc_buyer_parents upsert, activity_events research tasks) — the Decision
// Center is a router + recorder, not a new pipeline.
//
//   GET  /api/admin?_route=decisions[&type=<dt>][&summary=1][&limit][&offset]
//   POST /api/admin?_route=decision-verdict   {decision_id, verdict, payload}
//   GET  /api/admin?_route=decision-sf-search&name=<parent name>
//
// Lanes in this slice: confirm_true_owner (142 P0.4 true_owner_known_connect),
// confirm_buyer_parent + map_sf_parent_account (18 buyer parents incl. USGBF).
// The "Stale — new owner is…" verdict is RECORD-ONLY here (no domain write —
// the cross-domain gov true_owner write-back is Slice 3, behind Scott's
// explicit blessing). Re-parent / rename anchor verdicts are deferred too.
// ============================================================================

// Refresh the priority-queue cache immediately when a verdict's effect should
// move a row between bands (the Slice-1 staleness contract), instead of waiting
// out the 5-minute cron tick. Best-effort: a refresh hiccup never fails the
// verdict (the cron still catches up).
async function refreshQueueAfterDecision() {
  try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); }
  catch (e) { console.warn('[decision-verdict] queue refresh skipped:', e?.message || e); }
}

// ============================================================================
// R7 Phase 2 — list-federated lanes (the anti-bloat rule).
// ============================================================================
// Large/churning universes (intake ~542, property merges ~6.9k, provenance
// ~14k, pending updates ~2k, …) are NOT seeded into lcc_decisions — that would
// mirror a 14k-row backlog into an auth-critical table and strand stale rows as
// the source self-resolves (the disk-incident lesson). Instead each lane LISTS
// top-N straight from its source view, and a decision row is minted only at
// VERDICT time (lcc_open_decision + record). lcc_decisions stays the bounded
// audit trail of judgments actually MADE, not a copy of the backlog.
//
// Three invariants (the Phase-2 acceptance checks):
//  1. Idempotent on (decision_type, subject) — lcc_open_decision dedupes the
//     open row; we also anti-join decided subjects out of the source list.
//  2. The list EXCLUDES already-decided subjects, so a verdict drops the item
//     out of top-N immediately (self-propelling; the lane drains).
//  3. Counts are honest: federated lanes report the source-view workable count
//     (universe − decided), each labeled with its mode.
// ============================================================================
const FEDERATED_DECISION_TYPES = new Set([
  'intake_disposition', 'property_merge', 'provenance_conflict',
  'pending_update', 'cms_link_suspect', 'implausible_value',
]);

// Canonical subject key for a federated decision (the dedupe + exclusion key).
function federatedSubjectRef(type, s) {
  s = s || {};
  switch (type) {
    case 'intake_disposition': return s.intake_id ? 'intake:' + s.intake_id : null;
    case 'property_merge':     return (s.domain && s.property_id != null) ? 'merge:' + s.domain + ':' + s.property_id : null;
    case 'provenance_conflict':return s.provenance_id != null ? 'prov:' + s.provenance_id
                                     : (s.record_id != null ? 'prov:dia_xref:' + s.record_id : null);
    case 'pending_update':     return s.pending_id != null ? 'pending:gov:' + s.pending_id : null;
    case 'cms_link_suspect':   return (s.medicare_id != null && s.property_id != null) ? 'cms:dia:' + s.medicare_id + ':' + s.property_id : null;
    case 'implausible_value':  return (s.domain && s.sale_id != null) ? 'implausible:' + s.domain + ':' + s.sale_id : null;
  }
  return null;
}

// Pull the small snapshot facts off a staged-intake raw_payload for the card.
function _intakeSnap(rp) {
  const ex = (rp && rp.extraction_result) || {};
  const snap = ex.snapshot || ex.deal || {};
  const askingRaw = snap.asking_price ?? snap.price ?? snap.list_price;
  const asking = Number(String(askingRaw == null ? '' : askingRaw).replace(/[^0-9.]/g, ''));
  return {
    asking: Number.isFinite(asking) && asking > 0 ? asking : null,
    tenant: snap.tenant_name || snap.tenant || null,
    address: snap.address || snap.property_address || null,
    doctype: ex.doc_type || snap.doc_type || null,
  };
}
const _provImportance = (f) => /(?:price|rent|cap|noi|value|sold|owner)/i.test(String(f || '')) ? 1000
  : /(?:tenant|address|agency|name|sf_)/i.test(String(f || '')) ? 300 : 50;

// Set of subject_refs already decided (decided/skipped/superseded) for a lane.
async function fetchExcludedRefs(type) {
  const set = new Set();
  try {
    const r = await opsQuery('GET', 'lcc_decisions?select=subject_ref&decision_type=eq.'
      + pgFilterVal(type) + '&status=neq.open&subject_ref=not.is.null&limit=5000');
    if (r.ok && Array.isArray(r.data)) for (const row of r.data) if (row.subject_ref) set.add(row.subject_ref);
  } catch (_e) { /* soft-fail → no exclusion */ }
  return set;
}

// Per-lane source fetch. Returns { items, total } where each item carries the
// subject_ref + display context + rank_value. `cap` bounds the source pull
// (top-of-funnel; exclusion + paging happen in JS).
async function fetchFederatedSource(type, cap) {
  const out = { items: [], total: null };
  const domCnt = async (dom, path) => {
    const r = await domainQuery(dom, 'GET',
      path + (path.includes('?') ? '&' : '?') + 'select=*&limit=1', undefined, { 'Prefer': 'count=exact' });
    return (r.ok && typeof r.count === 'number') ? r.count : null;
  };
  const opsCnt = async (path) => {
    const r = await opsQuery('GET', path + (path.includes('?') ? '&' : '?') + 'select=*&limit=1',
      undefined, { countMode: 'exact' });
    return (r.ok && typeof r.count === 'number') ? r.count : null;
  };

  if (type === 'intake_disposition') {
    const r = await opsQuery('GET', 'staged_intake_items?select=intake_id,source_type,status,created_at,raw_payload'
      + '&status=in.(review_required,failed)&order=created_at.desc&limit=' + cap);
    const rows = (r.ok && Array.isArray(r.data)) ? r.data : [];
    out.items = rows.map((row) => {
      const snap = _intakeSnap(row.raw_payload);
      return {
        subject_ref: 'intake:' + row.intake_id,
        subject_domain: null, subject_property_id: null, subject_entity_id: null,
        rank_value: snap.asking || 0,
        context: { intake_id: row.intake_id, source_type: row.source_type, status: row.status,
          asking_price: snap.asking, tenant: snap.tenant, address: snap.address, doctype: snap.doctype },
      };
    }).sort((a, b) => (b.rank_value - a.rank_value));
    out.total = await opsCnt('staged_intake_items?status=in.(review_required,failed)');
    return out;
  }

  if (type === 'property_merge') {
    const fetchDom = async (dom) => {
      const r = await domainQuery(dom, 'GET', 'v_data_quality_issues?select=record_id,detail_1,detail_2,detail_3,severity'
        + '&issue_kind=eq.duplicate_property_address&order=severity.desc&limit=' + cap);
      const rows = (r.ok && Array.isArray(r.data)) ? r.data : [];
      return rows.map((row) => ({
        subject_ref: 'merge:' + dom + ':' + row.record_id,
        subject_domain: dom, subject_property_id: String(row.record_id), subject_entity_id: null,
        rank_value: Number(row.severity) || 0,
        context: { domain: dom, property_id: row.record_id, address: row.detail_1, state: row.detail_2,
          label: row.detail_3, cluster_size: Number(row.severity) || null },
      }));
    };
    const [g, d, gc, dc] = await Promise.all([
      fetchDom('gov'), fetchDom('dia'),
      domCnt('gov', 'v_data_quality_issues?issue_kind=eq.duplicate_property_address'),
      domCnt('dia', 'v_data_quality_issues?issue_kind=eq.duplicate_property_address'),
    ]);
    out.items = g.concat(d).sort((a, b) => b.rank_value - a.rank_value);
    out.total = (gc == null && dc == null) ? null : (gc || 0) + (dc || 0);
    return out;
  }

  if (type === 'provenance_conflict') {
    // LCC field-provenance conflicts (the bulk) + dia sales-price xref conflicts.
    const [pv, xr, pc, xc] = await Promise.all([
      opsQuery('GET', 'v_field_provenance_actionable?select=provenance_id,target_database,target_table,'
        + 'record_pk_value,field_name,attempted_value,attempted_source,current_value,current_source,'
        + 'decision,enforce_mode,recorded_at&order=recorded_at.desc&limit=' + cap),
      domainQuery('dia', 'GET', 'v_data_quality_issues?select=record_id,detail_1,detail_2,detail_3,severity'
        + '&issue_kind=eq.sales_price_xref_conflict&order=severity.desc&limit=' + cap),
      opsCnt('v_field_provenance_actionable'),
      domCnt('dia', 'v_data_quality_issues?issue_kind=eq.sales_price_xref_conflict'),
    ]);
    const pvRows = (pv.ok && Array.isArray(pv.data)) ? pv.data : [];
    const xrRows = (xr.ok && Array.isArray(xr.data)) ? xr.data : [];
    const pvItems = pvRows.map((row) => ({
      subject_ref: 'prov:' + row.provenance_id,
      subject_domain: row.target_database || null, subject_property_id: null, subject_entity_id: null,
      rank_value: _provImportance(row.field_name),
      context: { kind: 'field_provenance', provenance_id: row.provenance_id,
        target_database: row.target_database, target_table: row.target_table,
        record_pk_value: row.record_pk_value, field_name: row.field_name,
        attempted_value: row.attempted_value, attempted_source: row.attempted_source,
        current_value: row.current_value, current_source: row.current_source,
        decision: row.decision, enforce_mode: row.enforce_mode },
    }));
    const xrItems = xrRows.map((row) => ({
      subject_ref: 'prov:dia_xref:' + row.record_id,
      subject_domain: 'dia', subject_property_id: String(row.record_id), subject_entity_id: null,
      rank_value: 1000 + (Number(row.severity) || 0),
      context: { kind: 'sales_price_xref', record_id: row.record_id,
        detail_1: row.detail_1, detail_2: row.detail_2, detail_3: row.detail_3, severity: row.severity },
    }));
    out.items = pvItems.concat(xrItems).sort((a, b) => b.rank_value - a.rank_value);
    out.total = (pc == null && xc == null) ? null : (pc || 0) + (xc || 0);
    return out;
  }

  if (type === 'pending_update') {
    const r = await domainQuery('gov', 'GET', 'pending_updates?select=id,table_name,property_id,record_id,'
      + 'field_name,old_value,new_value,reason,confidence,priority_score,created_at'
      + '&status=eq.pending&order=priority_score.desc.nullslast,created_at.desc&limit=' + cap);
    const rows = (r.ok && Array.isArray(r.data)) ? r.data : [];
    out.items = rows.map((row) => ({
      subject_ref: 'pending:gov:' + row.id,
      subject_domain: 'gov', subject_property_id: row.property_id != null ? String(row.property_id) : null, subject_entity_id: null,
      rank_value: Number(row.priority_score) || 0,
      context: { pending_id: row.id, table_name: row.table_name, property_id: row.property_id,
        record_id: row.record_id, field_name: row.field_name, old_value: row.old_value,
        new_value: row.new_value, reason: row.reason, confidence: row.confidence },
    }));
    out.total = await domCnt('gov', 'pending_updates?status=eq.pending');
    return out;
  }

  if (type === 'cms_link_suspect') {
    // dia: order worst-first (state_diff, then street_looks_unrelated, then the rest).
    const r = await domainQuery('dia', 'GET', 'v_property_cms_link_suspect?select=property_id,medicare_id,'
      + 'suspect_kind,street_looks_unrelated,zip5_matches,cms_facility_name,cms_address,cms_city,cms_state,'
      + 'property_address,property_city,property_state&limit=' + cap);
    const rows = (r.ok && Array.isArray(r.data)) ? r.data : [];
    const score = (row) => (row.suspect_kind === 'state_diff' ? 3000 : 1000)
      + (row.street_looks_unrelated ? 500 : 0) - (row.zip5_matches ? 400 : 0);
    out.items = rows.map((row) => ({
      subject_ref: 'cms:dia:' + row.medicare_id + ':' + row.property_id,
      subject_domain: 'dia', subject_property_id: String(row.property_id), subject_entity_id: null,
      rank_value: score(row),
      context: { property_id: row.property_id, medicare_id: row.medicare_id, suspect_kind: row.suspect_kind,
        street_looks_unrelated: row.street_looks_unrelated, zip5_matches: row.zip5_matches,
        cms_facility_name: row.cms_facility_name, cms_address: row.cms_address, cms_city: row.cms_city, cms_state: row.cms_state,
        property_address: row.property_address, property_city: row.property_city, property_state: row.property_state },
    })).sort((a, b) => b.rank_value - a.rank_value);
    out.total = await domCnt('dia', 'v_property_cms_link_suspect');
    return out;
  }

  if (type === 'implausible_value') {
    const fetchDom = async (dom) => {
      const r = await domainQuery(dom, 'GET', 'v_implausible_sale_values?select=sale_id,property_id,sold_price,'
        + 'sale_date,address,city,state,label,ceiling&order=sold_price.desc&limit=' + cap);
      const rows = (r.ok && Array.isArray(r.data)) ? r.data : [];
      return rows.map((row) => ({
        subject_ref: 'implausible:' + dom + ':' + row.sale_id,
        subject_domain: dom, subject_property_id: row.property_id != null ? String(row.property_id) : null, subject_entity_id: null,
        rank_value: Number(row.sold_price) || 0,
        context: { domain: dom, sale_id: row.sale_id, property_id: row.property_id, sold_price: row.sold_price,
          sale_date: row.sale_date, address: row.address, city: row.city, state: row.state,
          label: row.label, ceiling: row.ceiling },
      }));
    };
    const [g, d, gc, dc] = await Promise.all([
      fetchDom('gov'), fetchDom('dia'),
      domCnt('gov', 'v_implausible_sale_values'), domCnt('dia', 'v_implausible_sale_values'),
    ]);
    out.items = g.concat(d).sort((a, b) => b.rank_value - a.rank_value);
    out.total = (gc == null && dc == null) ? out.items.length : (gc || 0) + (dc || 0);
    return out;
  }

  return out;
}

// List a federated lane: source top-N minus already-decided subjects.
async function listFederatedLane(type, limit, offset) {
  const cap = Math.min(400, (limit + offset) * 3 + 60);
  const [src, excluded] = await Promise.all([fetchFederatedSource(type, cap), fetchExcludedRefs(type)]);
  const workable = src.items.filter((it) => it.subject_ref && !excluded.has(it.subject_ref));
  const total = (typeof src.total === 'number') ? Math.max(0, src.total - excluded.size) : workable.length;
  const items = workable.slice(offset, offset + limit).map((it) => ({
    id: null, decision_type: type, status: 'open', mode: 'federated',
    subject_entity_id: it.subject_entity_id, subject_domain: it.subject_domain,
    subject_property_id: it.subject_property_id, subject_ref: it.subject_ref,
    context: it.context, rank_value: it.rank_value,
  }));
  return { type, mode: 'federated', total, items };
}

async function handleDecisionsList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  // Summary mode: open-decision counts per lane (the chip row). Seeded lanes
  // report their open-decision count; federated lanes report the source-view
  // workable count (universe − decided), each labeled with its mode so the chip
  // number means the same thing ("things to work") regardless of mode.
  if (req.query.summary) {
    const seededR = await opsQuery('GET', 'v_lcc_decision_open_counts?select=decision_type,n');
    const seeded = (seededR.ok && Array.isArray(seededR.data)) ? seededR.data : [];
    const lanes = seeded.map((l) => ({ decision_type: l.decision_type, n: Number(l.n) || 0, mode: 'seeded' }));
    const fed = await Promise.all([...FEDERATED_DECISION_TYPES].map(async (t) => {
      try {
        const [src, excl] = await Promise.all([fetchFederatedSource(t, 1), fetchExcludedRefs(t)]);
        const n = (typeof src.total === 'number') ? Math.max(0, src.total - excl.size)
                : Math.max(0, src.items.length - excl.size);
        return { decision_type: t, n, mode: 'federated' };
      } catch (_e) { return { decision_type: t, n: 0, mode: 'federated' }; }
    }));
    const all = lanes.concat(fed);
    const total = all.reduce((s, l) => s + (Number(l.n) || 0), 0);
    return res.status(200).json({ lanes: all, total });
  }

  const type = req.query.type ? String(req.query.type) : null;
  if (!type) return res.status(400).json({ error: 'type (decision_type) or summary=1 required' });
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

  // Federated lane: list from the source view, excluding decided subjects.
  if (FEDERATED_DECISION_TYPES.has(type)) {
    try {
      const out = await listFederatedLane(type, limit, offset);
      return res.status(200).json(out);
    } catch (e) {
      console.error('[decisions:federated]', type, e?.message || e);
      return res.status(502).json({ error: 'federated_list_failed', message: e?.message });
    }
  }

  // Seeded lane: workable top-N from lcc_decisions ranked by $ value; universe
  // count returned separately so the UI can demote it to a subtitle.
  const selectCols = 'id,decision_type,status,subject_entity_id,subject_domain,'
    + 'subject_property_id,subject_ref,question,context,rank_value,created_at';
  const itemsPath = 'lcc_decisions?select=' + selectCols
    + '&status=eq.open&decision_type=eq.' + pgFilterVal(type)
    + '&order=rank_value.desc.nullslast,created_at.asc'
    + '&limit=' + limit + '&offset=' + offset;
  const [itemsR, countR] = await Promise.all([
    opsQuery('GET', itemsPath),
    opsQuery('GET', 'lcc_decisions?select=id&status=eq.open&decision_type=eq.'
      + pgFilterVal(type) + '&limit=1', undefined, { countMode: 'exact' }),
  ]);
  if (!itemsR.ok) return res.status(502).json({ error: 'list_failed', detail: itemsR.data });
  return res.status(200).json({
    type, mode: 'seeded',
    total: (countR.ok && typeof countR.count === 'number') ? countR.count : null,
    items: Array.isArray(itemsR.data) ? itemsR.data : [],
  });
}

// ============================================================================
// B9 (2026-06-06): Junk-entity bulk disposition by bucket.
//
// The junk_entity_name lane carries ~1,050 soft-flagged entities — too many to
// work one-by-one. They fall into a few structural buckets, most of which are
// capture artifacts (deal/attribution strings, embedded phone/email) that are
// definitively NOT real entities, plus a "by <Broker>" bucket whose real name
// is deterministically recoverable. This worker classifies the flagged set,
// previews each bucket (count + samples), and applies ONE verdict to a bucket
// at a time — batch-capped, effect-first, idempotent, recording the verdict on
// each entity's existing seeded decision. The catch-all "other" bucket has NO
// bulk verdict: it may contain real-but-mis-flagged orgs and stays manual.
// ============================================================================

const _JUNK_BROKER_SUFFIX_RE = /\s+by\s+(northmarq|cbre|jll|colliers( international)?|newmark|cushman( ?& ?wakefield)?|marcus ?& ?millichap|matthews( real estate)?|matthews|berkadia|hanley|capital pacific|nai( [a-z]+)?|stream realty|kw commercial|trinity|avison( young)?|stan johnson( company)?|grubb ?& ?ellis|sjc)\.?\s*$/i;

function junkStripBrokerSuffix(name) {
  return String(name || '').replace(_JUNK_BROKER_SUFFIX_RE, '').trim();
}

// Classify a flagged entity name into a structural bucket. Order matters:
// phone/email first (hard junk), then deal strings, then broker-suffix, then
// trust placeholders, else 'other' (stays manual).
function classifyJunkName(name) {
  const s = String(name || '');
  // Embedded phone number / email / (p)(m)(c)(f) phone-type labels.
  if (/\(\s*\d|\d{3}[)\s.\-]\s*\d{3}[\s.\-]\d{4}|\([pmcf]\)|[\w.+\-]+@[\w.\-]+\.\w{2,}/i.test(s)) return 'phone_or_email';
  // Deal / attribution fragments: JV / OBO / CMBS-style codes / series / $amounts
  // / approx / alloc'd / semicolon-joined deals.
  if (/\bJV\b|\bOBO\b|\bCMBS\b|\bBBCMS\b|\bCDCMT\b|ML-?CFC|\b\d{4}-[A-Z]?\d|\$\s?\d|\bapprox\b|alloc'?d|;\s/i.test(s)) return 'deal_string';
  // Real owner name with a " by <Broker>" attribution suffix (cleanable).
  if (_JUNK_BROKER_SUFFIX_RE.test(s) && junkStripBrokerSuffix(s).length >= 3) return 'by_brokerage';
  // Placeholder trust codes, e.g. "Trust 4230".
  if (/^trust\s+\d+$/i.test(s.trim())) return 'trust_placeholder';
  return 'other';
}

// Which bulk verdict a bucket supports. 'other' → none (manual only).
// phone_or_email rows are real people (panel-header bleed-through) — they get
// PARSED into a clean contact, never dismissed.
const JUNK_BUCKET_VERDICT = {
  phone_or_email:   'parse_contact',
  deal_string:      'dismiss',
  trust_placeholder:'dismiss',
  by_brokerage:     'clean_rename',
  other:            null,
};


// GET  /api/junk-bucket            → classify + preview (counts + samples)
// POST /api/junk-bucket  { bucket, verdict, limit } → apply one verdict to a bucket
async function handleJunkBucket(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  let workspaceId = null;
  try { workspaceId = req.headers['x-lcc-workspace'] || primaryWorkspace(user)?.workspace_id || null; } catch (_e) { workspaceId = null; }

  // Pull the still-flagged (not-yet-reviewed) entities. Bounded; the universe
  // is ~1k so 3000 is ample headroom.
  const pull = async () => {
    const r = await opsQuery('GET',
      'entities?select=id,name,entity_type,metadata'
      + (workspaceId ? '&workspace_id=eq.' + pgFilterVal(workspaceId) : '')
      + '&metadata->>junk_name_flagged=eq.true&limit=3000');
    const rows = (r.ok && Array.isArray(r.data)) ? r.data : [];
    // Defensive: exclude any already marked reviewed (a re-run / race).
    return rows.filter(e => !(e.metadata && e.metadata.junk_name_reviewed === true));
  };

  if (req.method === 'GET') {
    const rows = await pull();
    const buckets = {};
    for (const e of rows) {
      const b = classifyJunkName(e.name);
      if (!buckets[b]) buckets[b] = { bucket: b, verdict: JUNK_BUCKET_VERDICT[b], count: 0, samples: [] };
      buckets[b].count++;
      if (buckets[b].samples.length < 8) {
        const sample = { id: e.id, name: e.name };
        if (b === 'by_brokerage') sample.cleaned_name = junkStripBrokerSuffix(e.name);
        if (b === 'phone_or_email') {
          const p = parseContactFromJunk(e.name);
          sample.parsed = p ? { name: p.name, phone: p.phone, email: p.email, role: p.role } : null;
        }
        buckets[b].samples.push(sample);
      }
    }
    const order = ['phone_or_email', 'deal_string', 'by_brokerage', 'trust_placeholder', 'other'];
    const list = order.filter(b => buckets[b]).map(b => buckets[b]);
    return res.status(200).json({ total_flagged: rows.length, buckets: list });
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
    const body = req.body || {};
    const bucket = String(body.bucket || '').trim();
    const verdict = String(body.verdict || '').trim();
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || 100, 1), 500);
    if (!JUNK_BUCKET_VERDICT[bucket]) {
      return res.status(400).json({ error: 'bucket has no bulk verdict (manual only)', bucket });
    }
    if (verdict !== JUNK_BUCKET_VERDICT[bucket]) {
      return res.status(400).json({ error: 'verdict not allowed for bucket', bucket, allowed: JUNK_BUCKET_VERDICT[bucket] });
    }

    const rows = (await pull()).filter(e => classifyJunkName(e.name) === bucket).slice(0, limit);
    if (!rows.length) return res.status(200).json({ bucket, verdict, attempted: 0, succeeded: 0, failed: 0, remaining_in_bucket: 0 });

    // Batch-load the open seeded decision per entity so we record on the
    // existing row instead of minting new ones (the bounded-lcc_decisions rule).
    const ids = rows.map(e => e.id);
    const inList = ids.map(id => pgFilterVal(id)).join(',');
    const decR = await opsQuery('GET',
      'lcc_decisions?select=id,subject_entity_id&decision_type=eq.junk_entity_name&status=eq.open'
      + '&subject_entity_id=in.(' + inList + ')&limit=' + (ids.length + 50));
    const decByEntity = {};
    if (decR.ok && Array.isArray(decR.data)) for (const d of decR.data) if (d.subject_entity_id) decByEntity[d.subject_entity_id] = d.id;

    let succeeded = 0, failed = 0;
    const errors = [];
    for (const e of rows) {
      // Build the effect-first metadata patch (soft, reversible — never delete).
      const meta = Object.assign({}, e.metadata || {});
      delete meta.junk_name_flagged;             // drop out of the lane (seed predicate fails)
      meta.junk_name_reviewed = true;
      meta.junk_name_disposition = bucket + '_' + verdict;
      meta.junk_name_reviewed_at = new Date().toISOString();
      const patch = { metadata: meta, updated_at: new Date().toISOString() };
      let recordVerdict = 'dismissed';
      let recordStatus = 'skipped';

      if (verdict === 'clean_rename') {
        const cleaned = junkStripBrokerSuffix(e.name);
        if (!cleaned || cleaned === e.name || cleaned.length < 3) { failed++; errors.push({ id: e.id, error: 'uncleanable_name' }); continue; }
        patch.name = cleaned;
        meta.junk_name_disposition = bucket + '_renamed';
        recordVerdict = 'rename';
        recordStatus = 'decided';
      } else if (verdict === 'parse_contact') {
        // Parse a real person out of the panel-header bleed-through. Rows the
        // parser can't confidently split STAY flagged (never guessed/dismissed).
        const c = parseContactFromJunk(e.name);
        if (!c) { failed++; errors.push({ id: e.id, error: 'unparseable_contact' }); continue; }
        patch.name = c.name;
        const toks = c.name.split(/\s+/);
        patch.first_name = toks[0] || null;
        patch.last_name = toks.length > 1 ? toks.slice(1).join(' ') : null;
        if (c.phone) patch.phone = c.phone;
        if (c.email) patch.email = c.email;
        if (c.title) patch.title = c.title;
        // Person stays a person; the entity IS the contact record on LCC (the
        // P-BUYER picker name-match reads person entities — clearing the junk
        // flag + a plausible name makes this row eligible).
        meta.junk_name_disposition = 'phone_or_email_parsed';
        meta.contact_role = c.role;
        meta.parsed_from_capture = true;
        recordVerdict = 'parse_contact';
        recordStatus = 'decided';
      }

      // Effect FIRST.
      const pr = await opsQuery('PATCH', 'entities?id=eq.' + pgFilterVal(e.id), patch);
      if (!pr.ok) { failed++; errors.push({ id: e.id, error: pr.data }); continue; }

      // Record the verdict on the existing seeded decision (best-effort — the
      // entity effect is the source of truth; a missing decision row is rare).
      const did = decByEntity[e.id];
      if (did != null) {
        await opsQuery('POST', 'rpc/lcc_record_decision_verdict', {
          p_decision_id: did, p_verdict: recordVerdict, p_status: recordStatus,
          p_verdict_payload: (verdict === 'clean_rename' || verdict === 'parse_contact')
            ? { new_name: patch.name, phone: patch.phone || null, email: patch.email || null, role: meta.contact_role || null, bulk: true }
            : { bulk: true, bucket },
          p_effects: { bulk_bucket: bucket, source: 'junk-bucket-worker' },
          p_decided_by: user.id || null,
        });
      }
      succeeded++;
    }

    return res.status(200).json({
      bucket, verdict, attempted: rows.length, succeeded, failed,
      errors: errors.slice(0, 10),
      note: 'Re-run to process the next batch; idempotent (reviewed rows are excluded).',
    });
  }

  return res.status(405).json({ error: 'GET or POST only' });
}

// ============================================================================
// Exact-name auto-merge (the rename aftermath of the B9 clean-renames).
//
// A clean-renamed junk entity often now carries the EXACT name of an
// established canonical entity (e.g. a renamed "SMBC Leasing and Finance"
// beside the real one). v_lcc_exact_name_merge_candidates classifies those
// collisions SAFE vs REVIEW. This worker previews them and applies the SAFE
// ones via the proven lcc_merge_entity machinery — always junk → canonical
// (the renamed artifact is the loser; the established entity is the winner),
// never the reverse. REVIEW pairs (multi-match / domain mismatch / both-SF)
// stay for the per-item junk "Merge into…" lane.
// ============================================================================
async function handleExactMerge(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  let workspaceId = null;
  try { workspaceId = req.headers['x-lcc-workspace'] || primaryWorkspace(user)?.workspace_id || null; } catch (_e) { workspaceId = null; }
  const wsFilter = workspaceId ? '&workspace_id=eq.' + pgFilterVal(workspaceId) : '';
  const sel = 'select=junk_id,junk_name,junk_domain,tgt_id,tgt_name,tgt_domain,n_tgt,classification,review_reason';

  if (req.method === 'GET') {
    const [safeR, revR] = await Promise.all([
      opsQuery('GET', 'v_lcc_exact_name_merge_candidates?' + sel + '&classification=eq.safe' + wsFilter + '&limit=2000'),
      opsQuery('GET', 'v_lcc_exact_name_merge_candidates?' + sel + '&classification=eq.review' + wsFilter + '&limit=2000'),
    ]);
    if (!safeR.ok) return res.status(safeR.status || 502).json({ error: 'preview_failed', detail: safeR.data });
    const safe = Array.isArray(safeR.data) ? safeR.data : [];
    const review = (revR.ok && Array.isArray(revR.data)) ? revR.data : [];
    const reviewBreakdown = {};
    review.forEach(r => { const k = r.review_reason || 'other'; reviewBreakdown[k] = (reviewBreakdown[k] || 0) + 1; });
    return res.status(200).json({
      safe_count: safe.length,
      review_count: review.length,
      review_breakdown: reviewBreakdown,
      safe_samples: safe.slice(0, 10).map(r => ({ junk_id: r.junk_id, junk_name: r.junk_name, tgt_id: r.tgt_id, tgt_name: r.tgt_name, domain: r.tgt_domain || r.junk_domain })),
      review_samples: review.slice(0, 10).map(r => ({ junk_name: r.junk_name, tgt_name: r.tgt_name, reason: r.review_reason, n_tgt: r.n_tgt })),
    });
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
    const limit = Math.min(Math.max(parseInt((req.body || {}).limit, 10) || 50, 1), 200);
    const r = await opsQuery('GET', 'v_lcc_exact_name_merge_candidates?' + sel
      + '&classification=eq.safe' + wsFilter + '&limit=' + limit);
    if (!r.ok) return res.status(r.status || 502).json({ error: 'load_failed', detail: r.data });
    const pairs = Array.isArray(r.data) ? r.data : [];
    if (!pairs.length) return res.status(200).json({ attempted: 0, merged: 0, failed: 0, remaining_safe: 0 });

    let merged = 0, failed = 0;
    const errors = [];
    for (const p of pairs) {
      // Effect FIRST: merge junk (loser) INTO canonical (winner).
      const mr = await opsQuery('POST', 'rpc/lcc_merge_entity', { p_loser: p.junk_id, p_winner: p.tgt_id });
      if (!mr.ok) { failed++; errors.push({ junk_id: p.junk_id, error: mr.data }); continue; }
      // Record the decision per pair (audit trail; mint→record, idempotent on
      // the open-subject key). Best-effort — the merge is the source of truth.
      try {
        const mint = await opsQuery('POST', 'rpc/lcc_open_decision', {
          p_decision_type: 'exact_name_merge', p_workspace_id: workspaceId || null,
          p_question: 'Exact-name collision after clean-rename — merge artifact into canonical?',
          p_context: { junk_name: p.junk_name, tgt_id: p.tgt_id, tgt_name: p.tgt_name, domain: p.tgt_domain || p.junk_domain },
          p_subject_entity_id: p.junk_id, p_subject_ref: 'exact_merge:' + p.junk_id,
        });
        let did = null;
        if (mint.ok) {
          if (typeof mint.data === 'number') did = mint.data;
          else if (Array.isArray(mint.data) && mint.data[0] != null) { const f = mint.data[0]; did = (typeof f === 'number') ? f : (f.lcc_open_decision ?? f.id ?? null); }
          else if (mint.data && typeof mint.data === 'object') did = mint.data.lcc_open_decision ?? mint.data.id ?? null;
        }
        if (did != null) {
          await opsQuery('POST', 'rpc/lcc_record_decision_verdict', {
            p_decision_id: Number(did), p_verdict: 'merged', p_status: 'decided',
            p_verdict_payload: { winner: p.tgt_id, loser: p.junk_id, name: p.tgt_name },
            p_effects: { lcc_merge_entity: 'merged', source: 'exact-merge-worker' },
            p_decided_by: user.id || null,
          });
        }
      } catch (_e) { /* audit record is best-effort; merge already applied */ }
      merged++;
    }
    return res.status(200).json({
      attempted: pairs.length, merged, failed, errors: errors.slice(0, 10),
      note: 'Re-run for the next batch; idempotent (merged losers drop out of the candidate view).',
    });
  }

  return res.status(405).json({ error: 'GET or POST only' });
}

// SF account typeahead for the buyer-parent mapping verdict.
async function handleDecisionSfSearch(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;
  const id = String(req.query.id || '').trim();
  const name = String(req.query.name || '').trim();
  if (!id && !name) return res.status(400).json({ error: 'name or id required' });
  try {
    const sf = await import('./_shared/salesforce.js');
    // Manual-entry confirmation path: validate the Id + fetch its name.
    if (id) {
      const r = await sf.getSalesforceAccountById(id);
      return res.status(200).json(r);
    }
    // Name search: returns the best auto-pick AND the full scored candidate list.
    const r = await sf.findSalesforceAccountByName(name);
    return res.status(200).json(r);
  } catch (err) {
    console.error('[decision-sf-search]', err?.message || err);
    return res.status(500).json({ error: 'sf_search_failed', message: err?.message });
  }
}

async function handleDecisionVerdict(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;
  const body = req.body || {};
  const verdict = String(body.verdict || '').toLowerCase();
  const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
  if (!verdict) return res.status(400).json({ error: 'verdict required' });

  // Two entry shapes:
  //  * Seeded lane: { decision_id, verdict } — load the existing lcc_decisions row.
  //  * Federated lane: { type, subject, verdict } — mint the decision at VERDICT
  //    time (the anti-bloat rule), idempotent on (decision_type, subject_ref).
  let decisionId = null;
  let decision = null;
  const rawId = Number(body.decision_id);
  if (Number.isFinite(rawId)) {
    const dR = await opsQuery('GET', 'lcc_decisions?id=eq.' + rawId + '&select=*&limit=1');
    decision = (dR.ok && Array.isArray(dR.data)) ? dR.data[0] : null;
    if (!decision) return res.status(404).json({ error: 'decision_not_found' });
    if (decision.status !== 'open') {
      return res.status(409).json({ error: 'decision_not_open', status: decision.status });
    }
    decisionId = rawId;
  } else {
    const dtype = String(body.type || body.decision_type || '').trim();
    const subject = (body.subject && typeof body.subject === 'object') ? body.subject : null;
    if (!FEDERATED_DECISION_TYPES.has(dtype) || !subject) {
      return res.status(400).json({ error: 'decision_id, or (federated type + subject), required' });
    }
    const subjectRef = federatedSubjectRef(dtype, Object.assign({}, subject, subject.context || {}));
    if (!subjectRef) return res.status(400).json({ error: 'subject missing identifying fields for ' + dtype });
    // Idempotent guard: a subject already decided is not re-minted (a double-
    // click or a re-surfaced row is a no-op, not a duplicate row).
    const prior = await opsQuery('GET', 'lcc_decisions?select=id,status&decision_type=eq.'
      + pgFilterVal(dtype) + '&subject_ref=eq.' + pgFilterVal(subjectRef)
      + '&status=neq.open&order=decided_at.desc&limit=1');
    if (prior.ok && Array.isArray(prior.data) && prior.data[0]) {
      return res.status(409).json({ error: 'already_decided', status: prior.data[0].status, decision_id: prior.data[0].id });
    }
    let ws = null; try { ws = primaryWorkspace(user)?.workspace_id || null; } catch (_e) { ws = null; }
    const ctx = (subject.context && typeof subject.context === 'object') ? subject.context : subject;
    const subjProp = subject.subject_property_id != null ? String(subject.subject_property_id)
      : (ctx.property_id != null ? String(ctx.property_id) : null);
    const mint = await opsQuery('POST', 'rpc/lcc_open_decision', {
      p_decision_type: dtype, p_workspace_id: ws || null,
      p_question: subject.question || ctx.question || null,
      p_context: ctx, p_subject_entity_id: subject.subject_entity_id || null,
      p_subject_domain: subject.subject_domain || ctx.domain || null,
      p_subject_property_id: subjProp, p_subject_ref: subjectRef,
      p_rank_value: subject.rank_value != null ? Number(subject.rank_value) : null,
    });
    let mintedId = null;
    if (mint.ok) {
      if (typeof mint.data === 'number') mintedId = mint.data;
      else if (Array.isArray(mint.data) && mint.data[0] != null) {
        const f = mint.data[0];
        mintedId = (typeof f === 'number') ? f : (f.lcc_open_decision ?? f.id ?? null);
      } else if (mint.data && typeof mint.data === 'object') {
        mintedId = mint.data.lcc_open_decision ?? mint.data.id ?? null;
      }
    }
    if (mintedId == null) return res.status(502).json({ error: 'mint_failed', detail: mint.data });
    decisionId = Number(mintedId);
    const dR = await opsQuery('GET', 'lcc_decisions?id=eq.' + decisionId + '&select=*&limit=1');
    decision = (dR.ok && Array.isArray(dR.data)) ? dR.data[0] : null;
    if (!decision) return res.status(502).json({ error: 'mint_reload_failed' });
  }

  const record = async (v, status, verdictPayload, effects) => {
    const r = await opsQuery('POST', 'rpc/lcc_record_decision_verdict', {
      p_decision_id: decisionId, p_verdict: v, p_status: status,
      p_verdict_payload: verdictPayload || null, p_effects: effects || null,
      p_decided_by: user.id || null,
    });
    return r;
  };
  // Spawn a research_task (the decision-inventory target — mirrors
  // lcc_generate_chain_research_tasks: research_type/title/instructions/
  // entity_id/domain/source_*). Returns the opsQuery result so the caller can
  // gate the verdict on the ACTUAL outcome (never claim success on a failed
  // write). research_tasks.domain/workspace_id are NOT NULL; both are present
  // on every seeded decision.
  const createResearchTask = async ({ research_type, title, instructions }) => {
    // research_tasks.workspace_id is NOT NULL. Most seeded decisions carry a
    // workspace, but R8 producer lanes (llc_research_dead / botblock) emit with
    // a null workspace — fall back to the operator's primary workspace, then the
    // oldest workspace, so the task write never fails on a null.
    let ws = decision.workspace_id;
    if (!ws) { try { ws = primaryWorkspace(user)?.workspace_id || null; } catch (_e) { ws = null; } }
    if (!ws) {
      try {
        const wr = await opsQuery('GET', 'workspaces?select=id&order=created_at.asc&limit=1');
        if (wr.ok && Array.isArray(wr.data) && wr.data[0]) ws = wr.data[0].id;
      } catch (_e) { /* leave null — the insert will surface the failure honestly */ }
    }
    return opsQuery('POST', 'research_tasks', {
      workspace_id: ws,
      created_by: user.id || null,
      research_type, title, instructions: instructions || null,
      entity_id: decision.subject_entity_id || null,
      domain: decision.subject_domain || 'lcc',
      status: 'queued', priority: 50,
      source_record_id: String(decisionId), source_table: 'lcc_decisions',
      metadata: { decision_id: decisionId, decision_type: decision.decision_type },
    }); // POST defaults to Prefer: return=representation, so rt.data carries the row
  };
  // On a failed effect: record the real outcome in effects + KEEP the decision
  // open (retryable) — do not stamp a verdict/decided_at it didn't earn.
  const recordEffectFailure = async (effects) =>
    opsQuery('PATCH', 'lcc_decisions?id=eq.' + decisionId,
      { effects, updated_at: new Date().toISOString() });

  try {
    // ---- confirm_true_owner -------------------------------------------------
    if (decision.decision_type === 'confirm_true_owner') {
      if (verdict === 'correct' || verdict === 'correct_connect') {
        // Confirm the domain true_owner is current and hand off to the existing
        // connect ladder (LCC-local; the entity leaves P0.4 once connection
        // completes there — no band move recorded here).
        const effects = { recorded: 'true_owner_confirmed_current', next: 'connect_ladder' };
        await record('correct_connect', 'decided', payload, effects);
        return res.status(200).json({ ok: true, verdict: 'correct_connect',
          next: { action: 'connect', entity_id: decision.subject_entity_id,
            source_domain: decision.subject_domain, source_property_id: decision.subject_property_id } });
      }
      if (verdict === 'stale') {
        // Slice 3: the cross-domain gov true_owner write-back. GATED — the real
        // write fires only when DECISION_GOV_WRITEBACK is enabled (Scott's
        // blessing) AND the subject is a gov property. A dry-run preview is
        // always available; otherwise we record-only (Slice-2 behavior).
        const newOwner = String(payload.proposed_owner_name || '').trim();
        if (!newOwner) return res.status(400).json({ error: 'payload.proposed_owner_name required' });
        const writebackOn = /^(on|1|true|yes|enabled)$/i.test(String(process.env.DECISION_GOV_WRITEBACK || ''));
        const pid = parseInt(decision.subject_property_id, 10);
        const govSubject = decision.subject_domain === 'gov' && Number.isFinite(pid);
        const actor = user.email || user.id || 'decision_center';
        const idem = 'decision:' + decisionId;

        // Always-safe preview (no flag, no record): show what WOULD change.
        if (payload.dry_run) {
          if (!govSubject) {
            return res.status(200).json({ ok: true, dry_run: true, supported: false,
              note: 'Write-back currently supports gov property subjects only.' });
          }
          const dr = await domainQuery('government', 'POST', 'rpc/gov_apply_manual_true_owner', {
            p_property_id: pid, p_new_owner_name: newOwner, p_actor: actor,
            p_idempotency_key: idem, p_dry_run: true });
          const prow = (dr.ok && Array.isArray(dr.data)) ? dr.data[0] : null;
          return res.status(dr.ok ? 200 : 502).json({ ok: dr.ok, dry_run: true, preview: prow,
            detail: dr.ok ? undefined : dr.data });
        }

        // Not blessed (or unsupported subject) → record-only, defer the write.
        if (!writebackOn || !govSubject) {
          await record('stale_pending_writeback', 'decided',
            { proposed_owner_name: newOwner, proposed_owner_entity_id: payload.proposed_owner_entity_id || null },
            { writeback: writebackOn ? 'unsupported_subject' : 'deferred_pending_blessing' });
          return res.status(200).json({ ok: true, verdict: 'stale_pending_writeback',
            deferred: writebackOn ? 'unsupported_subject' : 'pending_blessing',
            note: writebackOn
              ? 'Recorded. Write-back supports gov property subjects only.'
              : 'Recorded. Set DECISION_GOV_WRITEBACK to enable the gov true_owner write-back.' });
        }

        // Blessed + gov subject: write through the existing gov provenance path
        // (manual_change_events + field_value_provenance + provenance_event_log
        // + ownership_history; source='manual_decision'). Effect FIRST, gated.
        const wr = await domainQuery('government', 'POST', 'rpc/gov_apply_manual_true_owner', {
          p_property_id: pid, p_new_owner_name: newOwner, p_actor: actor,
          p_idempotency_key: idem, p_dry_run: false });
        const row = (wr.ok && Array.isArray(wr.data)) ? wr.data[0] : null;
        if (!wr.ok || !row || (!row.wrote && row.note !== 'already_applied')) {
          await recordEffectFailure({ writeback: false, error: (row && row.note) || wr.data || wr.status });
          return res.status(502).json({ error: 'writeback_failed', detail: row || wr.data });
        }
        // Update the LCC owner-facts mirror so the resolver re-runs immediately
        // (best-effort; the provenance_event_log flush + R6 sync also reconcile).
        try {
          await opsQuery('PATCH', 'lcc_property_owner_facts?source_domain=eq.gov&source_property_id=eq.'
            + pgFilterVal(decision.subject_property_id),
            { true_owner_name: newOwner, updated_at: new Date().toISOString() });
        } catch (e) { console.warn('[decision-verdict] owner-facts mirror patch skipped:', e?.message || e); }
        await record('stale_applied', 'decided', { proposed_owner_name: newOwner },
          { writeback: 'applied', gov_note: row.note, gov_change_event_id: row.change_event_id,
            gov_new_true_owner_id: row.new_true_owner_id });
        await refreshQueueAfterDecision();
        return res.status(200).json({ ok: true, verdict: 'stale_applied', gov: row });
      }
      if (verdict === 'research') {
        // Effect FIRST; the recorded outcome must reflect the actual write.
        const rt = await createResearchTask({
          research_type: 'confirm_true_owner',
          title: 'Confirm true owner for ' + (decision.context?.entity_name || 'entity'),
          instructions: 'Decision Center: verify whether the domain true_owner ("'
            + (decision.context?.true_owner_name || '?') + '") is current or stale (pre-acquisition) '
            + 'for this entity, then confirm or correct it.',
        });
        if (!rt.ok) {
          await recordEffectFailure({ research_task: false, error: rt.data || rt.status });
          return res.status(502).json({ error: 'research_task_failed', detail: rt.data });
        }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('research', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'research', research_task_id: rid });
      }
      if (verdict === 'skip') {
        await record('skip', 'skipped', null, null);
        return res.status(200).json({ ok: true, verdict: 'skip' });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- confirm_buyer_parent (sponsor confirmation, e.g. USGBF) -----------
    if (decision.decision_type === 'confirm_buyer_parent') {
      if (verdict === 'confirm_sponsor' || verdict === 'confirm_parent') {
        const pid = decision.subject_entity_id;
        const pr = await opsQuery('PATCH', 'lcc_buyer_parents?parent_entity_id=eq.' + pgFilterVal(pid),
          { confirmed_by: user.id, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        if (!pr.ok) return res.status(502).json({ error: 'confirm_failed', detail: pr.data });
        await record('confirm_sponsor', 'decided', payload, { lcc_buyer_parents: 'confirmed' });
        await refreshQueueAfterDecision();
        return res.status(200).json({ ok: true, verdict: 'confirm_sponsor', parent_entity_id: pid });
      }
      if (verdict === 'subsidiary_of' || verdict === 'rename') {
        return res.status(501).json({ error: 'deferred', detail: 're-parent / rename anchor lands in a later slice' });
      }
      if (verdict === 'research') {
        const rt = await createResearchTask({
          research_type: 'confirm_buyer_parent',
          title: 'Confirm controlling sponsor for ' + (decision.context?.parent_name || 'buyer parent'),
          instructions: 'Decision Center: identify/confirm the controlling sponsor for this repeat-buyer '
            + 'parent before any buy-side opportunity is opened on it.',
        });
        if (!rt.ok) {
          await recordEffectFailure({ research_task: false, error: rt.data || rt.status });
          return res.status(502).json({ error: 'research_task_failed', detail: rt.data });
        }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('research', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'research', research_task_id: rid });
      }
      if (verdict === 'skip') {
        await record('skip', 'skipped', null, null);
        return res.status(200).json({ ok: true, verdict: 'skip' });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- map_sf_parent_account ---------------------------------------------
    if (decision.decision_type === 'map_sf_parent_account') {
      if (verdict === 'map') {
        const sfId = String(payload.sf_account_id || '').trim();
        const sfName = payload.sf_account_name ? String(payload.sf_account_name) : null;
        if (!sfId) return res.status(400).json({ error: 'payload.sf_account_id required' });
        const pid = decision.subject_entity_id;
        // 1) lcc_buyer_parents is the routing source of truth — set it + clear
        //    the hold so v_lcc_government_buyer_sync_health flips ready_to_sync.
        const pr = await opsQuery('PATCH', 'lcc_buyer_parents?parent_entity_id=eq.' + pgFilterVal(pid),
          { sf_account_id: sfId, sf_account_name: sfName, needs_sf_mapping: false,
            updated_at: new Date().toISOString() });
        if (!pr.ok) return res.status(502).json({ error: 'map_failed', detail: pr.data });
        // 2) Mirror into the entity graph (best-effort) so the parent carries a
        //    Salesforce identity. ensureEntityLink canonicalizes the system.
        let identityLinked = false;
        try {
          const { ensureEntityLink } = await import('./_shared/entity-link.js');
          const link = await ensureEntityLink({
            workspaceId: decision.workspace_id || null, userId: user.id,
            sourceSystem: 'salesforce', sourceType: 'Account', externalId: sfId,
            entityId: pid, seedFields: sfName ? { name: sfName } : {},
            metadata: { via: 'decision_center', decision_id: decisionId },
          });
          identityLinked = !!(link && link.ok);
        } catch (e) { console.warn('[decision-verdict] sf identity link skipped:', e?.message || e); }
        await record('map', 'decided', { sf_account_id: sfId, sf_account_name: sfName },
          { lcc_buyer_parents: 'mapped', external_identity: identityLinked });
        await refreshQueueAfterDecision();
        return res.status(200).json({ ok: true, verdict: 'map', parent_entity_id: pid,
          sf_account_id: sfId, identity_linked: identityLinked });
      }
      if (verdict === 'create_later') {
        await record('create_later', 'decided', payload, { sf_mapping: 'hold' });
        return res.status(200).json({ ok: true, verdict: 'create_later' });
      }
      if (verdict === 'confirm_sponsor') {
        // A map card can also bless the sponsor inline.
        const pid = decision.subject_entity_id;
        const pr = await opsQuery('PATCH', 'lcc_buyer_parents?parent_entity_id=eq.' + pgFilterVal(pid),
          { confirmed_by: user.id, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        if (!pr.ok) return res.status(502).json({ error: 'confirm_failed', detail: pr.data });
        await record('confirm_sponsor', 'decided', payload, { lcc_buyer_parents: 'confirmed' });
        return res.status(200).json({ ok: true, verdict: 'confirm_sponsor', parent_entity_id: pid });
      }
      if (verdict === 'skip') {
        await record('skip', 'skipped', null, null);
        return res.status(200).json({ ok: true, verdict: 'skip' });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- junk_entity_name (seeded) -----------------------------------------
    // "What should this entity be?" Verdicts ride existing entity machinery:
    // rename (entities PATCH), merge (lcc_merge_entity), leave flagged, research.
    if (decision.decision_type === 'junk_entity_name') {
      const eid = decision.subject_entity_id;
      if (verdict === 'rename') {
        const newName = String(payload.new_name || '').trim();
        if (!newName) return res.status(400).json({ error: 'payload.new_name required' });
        // Clear the junk flag while renaming (read-modify-write the small jsonb).
        let meta = {};
        try {
          const er = await opsQuery('GET', 'entities?id=eq.' + pgFilterVal(eid) + '&select=metadata&limit=1');
          meta = (er.ok && Array.isArray(er.data) && er.data[0] && er.data[0].metadata) ? er.data[0].metadata : {};
        } catch (_e) { meta = {}; }
        const nextMeta = Object.assign({}, meta); delete nextMeta.junk_name_flagged;
        nextMeta.junk_name_resolved = 'renamed';
        const pr = await opsQuery('PATCH', 'entities?id=eq.' + pgFilterVal(eid),
          { name: newName, metadata: nextMeta, updated_at: new Date().toISOString() });
        if (!pr.ok) { await recordEffectFailure({ rename: false, error: pr.data }); return res.status(502).json({ error: 'rename_failed', detail: pr.data }); }
        await record('rename', 'decided', { new_name: newName }, { entity: 'renamed' });
        return res.status(200).json({ ok: true, verdict: 'rename', entity_id: eid, new_name: newName });
      }
      if (verdict === 'merge') {
        const target = String(payload.target_entity_id || '').trim();
        if (!target) return res.status(400).json({ error: 'payload.target_entity_id required' });
        // The junk entity is the loser, the chosen real entity the winner.
        const mr = await opsQuery('POST', 'rpc/lcc_merge_entity', { p_loser: eid, p_winner: target });
        if (!mr.ok) { await recordEffectFailure({ merge: false, error: mr.data }); return res.status(502).json({ error: 'merge_failed', detail: mr.data }); }
        await record('merge', 'decided', { target_entity_id: target }, { lcc_merge_entity: 'merged' });
        return res.status(200).json({ ok: true, verdict: 'merge', loser: eid, winner: target });
      }
      if (verdict === 'leave_flagged' || verdict === 'skip') {
        await record('leave_flagged', 'skipped', null, { entity: 'left_flagged' });
        return res.status(200).json({ ok: true, verdict: 'leave_flagged' });
      }
      if (verdict === 'research') {
        const rt = await createResearchTask({ research_type: 'junk_entity_name',
          title: 'Resolve junk entity name: ' + (decision.context?.entity_name || eid),
          instructions: 'Decision Center: decide whether to rename this entity, merge it into a real one, or leave it flagged.' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('research', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'research', research_task_id: rid });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    const c = decision.context || {};

    // ---- intake_disposition (federated) ------------------------------------
    // Staged-intake review. The heavy actions (create property / re-extract)
    // ride the existing intake routes via a hand-off; dismiss/research are safe.
    if (decision.decision_type === 'intake_disposition') {
      if (verdict === 'dismiss') {
        await record('dismiss', 'decided', null, { intake: 'dismissed_from_lane' });
        return res.status(200).json({ ok: true, verdict: 'dismiss' });
      }
      if (verdict === 'create_property') {
        await record('create_property', 'decided', payload, { handoff: 'intake_create_property' });
        return res.status(200).json({ ok: true, verdict: 'create_property',
          next: { action: 'intake_create_property', intake_id: c.intake_id } });
      }
      if (verdict === 'reextract') {
        await record('reextract', 'decided', payload, { handoff: 'intake_reextract' });
        return res.status(200).json({ ok: true, verdict: 'reextract',
          next: { action: 'intake_reextract', intake_id: c.intake_id } });
      }
      if (verdict === 'research') {
        const rt = await createResearchTask({ research_type: 'intake_disposition',
          title: 'Triage staged intake ' + (c.intake_id || ''),
          instructions: 'Decision Center: review this staged-intake item (' + (c.doctype || 'unknown doctype')
            + (c.tenant ? ', tenant ' + c.tenant : '') + ') and decide create-property / re-extract / dismiss.' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('research', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'research', research_task_id: rid });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- property_merge (federated) ----------------------------------------
    // "Are these the same property?" merge rides the existing consolidate
    // machinery (dia_merge_property / gov_merge_property); not_duplicate +
    // research are safe (record-only / task).
    if (decision.decision_type === 'property_merge') {
      const dom = c.domain === 'dia' ? 'dialysis' : c.domain === 'gov' ? 'government' : null;
      if (verdict === 'not_duplicate') {
        await record('not_duplicate', 'decided', null, { merge: 'suppressed_pair' });
        return res.status(200).json({ ok: true, verdict: 'not_duplicate' });
      }
      if (verdict === 'merge') {
        const keepId = parseInt(payload.keep_id, 10);
        const dropId = parseInt(payload.drop_id, 10);
        if (!dom || !Number.isFinite(keepId) || !Number.isFinite(dropId) || keepId === dropId) {
          return res.status(400).json({ error: 'merge requires payload.keep_id, drop_id (distinct) on a dia/gov subject' });
        }
        const fn = c.domain === 'dia' ? 'rpc/dia_merge_property' : 'rpc/gov_merge_property';
        const mr = await domainQuery(dom, 'POST', fn, { p_keep_id: keepId, p_drop_id: dropId });
        if (!mr.ok) { await recordEffectFailure({ merge: false, error: mr.data }); return res.status(502).json({ error: 'merge_failed', detail: mr.data }); }
        await record('merge', 'decided', { keep_id: keepId, drop_id: dropId }, { merge: 'consolidated' });
        return res.status(200).json({ ok: true, verdict: 'merge', keep_id: keepId, drop_id: dropId });
      }
      if (verdict === 'research') {
        const rt = await createResearchTask({ research_type: 'property_merge',
          title: 'Confirm property merge: ' + (c.address || c.property_id || ''),
          instructions: 'Decision Center: confirm whether ' + (c.domain || '') + ' property ' + (c.property_id || '')
            + ' (' + (c.address || '') + ') is a duplicate to be merged, or a distinct property.' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('research', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'research', research_task_id: rid });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- provenance_conflict (federated) -----------------------------------
    // "Which value is right?" keep_current confirms the standing value (safe);
    // accept_attempted defers the domain write to a research task (no silent
    // overwrite — the manual-edit machinery applies it); research/skip.
    if (decision.decision_type === 'provenance_conflict') {
      if (verdict === 'keep_current') {
        await record('keep_current', 'decided', null, { provenance: 'current_confirmed' });
        return res.status(200).json({ ok: true, verdict: 'keep_current' });
      }
      if (verdict === 'accept_attempted') {
        const where = (c.target_database || c.kind || '') + '.' + (c.target_table || '') + '.' + (c.field_name || '');
        const rt = await createResearchTask({ research_type: 'provenance_conflict',
          title: 'Apply attempted value to ' + where,
          instructions: 'Decision Center: apply the attempted value (' + JSON.stringify(c.attempted_value ?? c.detail_2 ?? null)
            + ') over the current value (' + JSON.stringify(c.current_value ?? c.detail_1 ?? null) + ') on '
            + where + ' record ' + (c.record_pk_value || c.record_id || '') + ' via the manual-edit path.' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('accept_attempted', 'decided', payload, { provenance: 'apply_queued', research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'accept_attempted', research_task_id: rid });
      }
      if (verdict === 'research') {
        const rt = await createResearchTask({ research_type: 'provenance_conflict',
          title: 'Resolve data conflict on ' + (c.field_name || c.kind || 'field'),
          instructions: 'Decision Center: resolve which value is authoritative for this field-provenance conflict.' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('research', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'research', research_task_id: rid });
      }
      if (verdict === 'skip') { await record('skip', 'skipped', null, null); return res.status(200).json({ ok: true, verdict: 'skip' }); }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- pending_update (federated, gov state machine) ----------------------
    // Advance the existing pending_updates state machine (approved | rejected —
    // the existing terminal transitions; no new states invented). reject is
    // safe; apply hands the approved row to the gov pipeline consumer.
    if (decision.decision_type === 'pending_update') {
      const pid = c.pending_id;
      const stamp = { resolved_at: new Date().toISOString(),
        resolution_notes: 'Decision Center (' + (user.email || user.id || 'lcc') + ')' };
      if (verdict === 'apply' || verdict === 'reject') {
        const status = verdict === 'apply' ? 'approved' : 'rejected';
        const pr = await domainQuery('gov', 'PATCH', 'pending_updates?id=eq.' + encodeURIComponent(pid),
          Object.assign({ status }, stamp));
        if (!pr.ok) { await recordEffectFailure({ pending_update: false, error: pr.data }); return res.status(502).json({ error: 'pending_update_failed', detail: pr.data }); }
        await record(verdict, 'decided', payload, { pending_update: status });
        return res.status(200).json({ ok: true, verdict, pending_id: pid, status });
      }
      if (verdict === 'research') {
        const rt = await createResearchTask({ research_type: 'pending_update',
          title: 'Review gov pending update #' + pid,
          instructions: 'Decision Center: decide whether to apply the proposed update to '
            + (c.table_name || '') + '.' + (c.field_name || '') + ' (' + JSON.stringify(c.old_value)
            + ' → ' + JSON.stringify(c.new_value) + ').' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('research', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'research', research_task_id: rid });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- cms_link_suspect (federated, dia) ---------------------------------
    // "Is this clinic linked to the right property?" link_correct is safe;
    // break_link hands off to the existing cms-match DELETE route; research.
    if (decision.decision_type === 'cms_link_suspect') {
      if (verdict === 'link_correct') {
        await record('link_correct', 'decided', null, { cms_link: 'confirmed' });
        return res.status(200).json({ ok: true, verdict: 'link_correct' });
      }
      if (verdict === 'break_link') {
        await record('break_link', 'decided', payload, { handoff: 'cms_unlink' });
        return res.status(200).json({ ok: true, verdict: 'break_link',
          next: { action: 'cms_unlink', domain: 'dia', property_id: c.property_id, medicare_id: c.medicare_id } });
      }
      if (verdict === 'research') {
        const rt = await createResearchTask({ research_type: 'cms_link_suspect',
          title: 'Verify CMS link for property ' + (c.property_id || ''),
          instructions: 'Decision Center: verify whether medicare clinic ' + (c.medicare_id || '')
            + ' (' + (c.cms_facility_name || '') + ') is correctly linked to this property.' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('research', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'research', research_task_id: rid });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- implausible_value (federated) -------------------------------------
    // "Is this value real?" confirm_as_is is safe (the price was retained, the
    // human blesses it); correct writes the corrected price; void defers to a
    // research task (never a silent delete); research.
    if (decision.decision_type === 'implausible_value') {
      const dom = c.domain === 'dia' ? 'dialysis' : c.domain === 'gov' ? 'government' : null;
      if (verdict === 'confirm_as_is') {
        await record('confirm_as_is', 'decided', null, { sale: 'confirmed_legitimate' });
        return res.status(200).json({ ok: true, verdict: 'confirm_as_is' });
      }
      if (verdict === 'correct') {
        const corrected = Number(payload.corrected_price);
        if (!dom || !Number.isFinite(corrected) || corrected <= 0) {
          return res.status(400).json({ error: 'correct requires payload.corrected_price (>0) on a dia/gov subject' });
        }
        const pr = await domainQuery(dom, 'PATCH', 'sales_transactions?sale_id=eq.' + encodeURIComponent(c.sale_id),
          { sold_price: corrected });
        if (!pr.ok) { await recordEffectFailure({ correct: false, error: pr.data }); return res.status(502).json({ error: 'correct_failed', detail: pr.data }); }
        await record('correct', 'decided', { corrected_price: corrected }, { sale: 'price_corrected' });
        return res.status(200).json({ ok: true, verdict: 'correct', sale_id: c.sale_id, corrected_price: corrected });
      }
      if (verdict === 'void' || verdict === 'research') {
        const rt = await createResearchTask({ research_type: 'implausible_value',
          title: (verdict === 'void' ? 'Void implausible sale ' : 'Review implausible sale ') + (c.sale_id || ''),
          instructions: 'Decision Center: ' + (verdict === 'void' ? 'void/remove' : 'review')
            + ' the $' + Number(c.sold_price || 0).toLocaleString() + ' sale (' + (c.domain || '')
            + ' sale_id ' + (c.sale_id || '') + ', address ' + (c.address || '') + ') flagged over the magnitude ceiling.' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record(verdict, 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict, research_task_id: rid });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- match_disambiguation (R8 — producer: intake matcher) ---------------
    // "Multiple candidate properties matched — which one?" pick attaches the
    // chosen property (mirrors the matcher matched-path so the existing promoter
    // takes over); create_property hands off to the F4 create route; research.
    if (decision.decision_type === 'match_disambiguation') {
      const intakeId = c.intake_id
        || (decision.subject_ref ? String(decision.subject_ref).replace(/^match_disambig:/, '') : null);
      if (verdict === 'pick') {
        const dom = payload.domain === 'dia' ? 'dialysis' : payload.domain === 'gov' ? 'government' : null;
        const propId = payload.property_id != null ? String(payload.property_id) : null;
        if (!intakeId || !dom || !propId) {
          return res.status(400).json({ error: 'pick requires payload.domain (dia|gov) + payload.property_id' });
        }
        // Write the confirmed match exactly like the matcher's matched-path so the
        // single-attach promoter picks it up, then flip the intake to matched.
        const mw = await opsQuery('POST', 'staged_intake_matches', {
          intake_id: intakeId, decision: 'manual_match', reason: 'decision_center_disambiguation',
          domain: payload.domain, property_id: propId, confidence: 1.0,
          match_result: { status: 'matched', reason: 'manual_disambiguation',
            property_id: propId, domain: payload.domain, confidence: 1.0 },
        });
        if (!mw.ok) { await recordEffectFailure({ pick: false, error: mw.data }); return res.status(502).json({ error: 'pick_write_failed', detail: mw.data }); }
        const sp = await opsQuery('PATCH', 'staged_intake_items?intake_id=eq.' + encodeURIComponent(intakeId),
          { status: 'matched' });
        if (!sp.ok) { await recordEffectFailure({ pick: 'match_written_status_patch_failed', error: sp.data }); return res.status(502).json({ error: 'pick_status_failed', detail: sp.data }); }
        await record('pick', 'decided', { domain: payload.domain, property_id: propId },
          { match: 'manual_disambiguation', domain: payload.domain, property_id: propId });
        return res.status(200).json({ ok: true, verdict: 'pick',
          next: { action: 'intake_promote', intake_id: intakeId, domain: payload.domain, property_id: propId } });
      }
      if (verdict === 'create_property') {
        await record('create_property', 'decided', payload, { handoff: 'intake_create_property' });
        return res.status(200).json({ ok: true, verdict: 'create_property',
          next: { action: 'intake_create_property', intake_id: intakeId } });
      }
      if (verdict === 'research') {
        const rt = await createResearchTask({ research_type: 'match_disambiguation',
          title: 'Disambiguate intake match ' + (intakeId || ''),
          instructions: 'Decision Center: the matcher found multiple candidate properties for this intake ('
            + (c.address || '') + (c.tenant ? ', tenant ' + c.tenant : '')
            + '). Pick the right property or create a new one.' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('research', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'research', research_task_id: rid });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- llc_research_dead (R8 — producer: llc-research tick dead-letter) ----
    // "The automated LLC research dead-lettered." retry requeues the domain
    // queue row; resolve_manually spawns a SOS research task; park skips. The
    // source row lives in the domain DB so there is no refresh-sweep — verdicts
    // close the decision (bounded by LLC_MAX_ATTEMPTS).
    if (decision.decision_type === 'llc_research_dead') {
      const dom = c.domain === 'dia' ? 'dialysis' : c.domain === 'gov' ? 'government' : null;
      if (verdict === 'retry') {
        if (!dom || c.queue_id == null) return res.status(400).json({ error: 'retry requires domain + queue_id in context' });
        const pr = await domainQuery(dom, 'PATCH', 'llc_research_queue?queue_id=eq.' + encodeURIComponent(c.queue_id),
          { status: 'queued', attempts: 0, last_error: null, resolved_at: null });
        if (!pr.ok) { await recordEffectFailure({ retry: false, error: pr.data }); return res.status(502).json({ error: 'retry_failed', detail: pr.data }); }
        await record('retry', 'decided', null, { llc: 'requeued', queue_id: c.queue_id });
        return res.status(200).json({ ok: true, verdict: 'retry', queue_id: c.queue_id });
      }
      if (verdict === 'resolve_manually' || verdict === 'research') {
        const rt = await createResearchTask({ research_type: 'llc_research_manual',
          title: 'Manually research owner LLC: ' + (c.search_name || c.recorded_owner_id || ''),
          instructions: 'Decision Center: automated LLC research dead-lettered after ' + (c.attempts || '?')
            + ' attempts (' + (c.last_error || 'unknown error') + '). Look up "' + (c.search_name || '')
            + '" in the ' + (c.guessed_state || '?') + ' Secretary of State business registry and record '
            + 'manager / registered agent on the recorded_owner.' });
        if (!rt.ok) { await recordEffectFailure({ research_task: false, error: rt.data }); return res.status(502).json({ error: 'research_task_failed', detail: rt.data }); }
        const rid = (Array.isArray(rt.data) && rt.data[0]) ? rt.data[0].id : null;
        await record('resolve_manually', 'decided', payload, { research_task: true, research_task_id: rid });
        return res.status(200).json({ ok: true, verdict: 'resolve_manually', research_task_id: rid });
      }
      if (verdict === 'park') {
        await record('park', 'skipped', null, { llc: 'parked_dead' });
        return res.status(200).json({ ok: true, verdict: 'park' });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    // ---- availability_checker_botblock (R8 — producer: health alert) --------
    // "Availability-checker is being bot-blocked." verify deep-links to the
    // listings for manual checking (record-only); acknowledge resolves the
    // underlying alert (the refresh sweep then supersedes this decision too).
    if (decision.decision_type === 'availability_checker_botblock') {
      if (verdict === 'verify') {
        await record('verify', 'decided', payload, { botblock: 'manual_verify_initiated' });
        return res.status(200).json({ ok: true, verdict: 'verify',
          next: { action: 'availability_verify', domain: c.domain } });
      }
      if (verdict === 'acknowledge') {
        const ar = await opsQuery('PATCH', 'lcc_health_alerts?alert_kind=eq.availability_checker_botblock'
          + '&resolved_at=is.null&source=eq.' + pgFilterVal(c.source || ''),
          { resolved_at: new Date().toISOString(), resolved_note: 'acknowledged via Decision Center' });
        await record('acknowledge', 'decided', payload, { botblock: 'acknowledged', alert_resolved: !!(ar && ar.ok) });
        return res.status(200).json({ ok: true, verdict: 'acknowledge', alert_resolved: !!(ar && ar.ok) });
      }
      return res.status(400).json({ error: 'unknown_verdict_for_type', verdict });
    }

    return res.status(400).json({ error: 'unsupported_decision_type', decision_type: decision.decision_type });
  } catch (err) {
    console.error('[decision-verdict]', err?.message || err);
    return res.status(500).json({ error: 'verdict_failed', message: err?.message });
  }
}

// ============================================================================
// CONSOLIDATE PROPERTY (Round 76be, 2026-04-28)
// ============================================================================
//
// GET  /api/admin?_route=consolidate-property&domain=dia&property_id=24609
//   Returns find_property_consolidation_candidates() output: same-address dups,
//   same-tenant-in-city candidates, chain summary.
//
// POST /api/admin?_route=consolidate-property&domain=dia
//   Body: { keep_id, drop_id }
//   Calls dia_merge_property() (or gov equivalent) to consolidate.
//
async function handleConsolidateProperty(req, res) {
  const domain = (req.query.domain || '').toLowerCase();
  if (!['dia', 'gov'].includes(domain)) {
    return res.status(400).json({ error: 'domain must be dia or gov' });
  }

  if (req.method === 'GET') {
    const propertyId = parseInt(req.query.property_id, 10);
    if (!Number.isFinite(propertyId)) {
      return res.status(400).json({ error: 'property_id required' });
    }
    try {
      const { domainQuery } = await import('./_shared/domain-db.js');
      const dom = domain === 'dia' ? 'dialysis' : 'government';
      const r = await domainQuery(dom, 'POST', 'rpc/find_property_consolidation_candidates', {
        p_property_id: propertyId
      });
      if (!r.ok) return res.status(500).json({ error: 'rpc_failed', detail: r.data });
      return res.status(200).json(r.data);
    } catch (err) {
      return res.status(500).json({ error: 'consolidate_lookup_failed', message: err?.message });
    }
  }

  if (req.method === 'POST') {
    const { keep_id, drop_id } = req.body || {};
    const keepId = parseInt(keep_id, 10);
    const dropId = parseInt(drop_id, 10);
    if (!Number.isFinite(keepId) || !Number.isFinite(dropId) || keepId === dropId) {
      return res.status(400).json({ error: 'keep_id and drop_id required and must differ' });
    }
    try {
      const { domainQuery } = await import('./_shared/domain-db.js');
      const dom = domain === 'dia' ? 'dialysis' : 'government';
      const fnName = domain === 'dia' ? 'dia_merge_property' : 'gov_merge_property';
      const r = await domainQuery(dom, 'POST', `rpc/${fnName}`, {
        p_keep_id: keepId, p_drop_id: dropId
      });
      if (!r.ok) return res.status(500).json({ error: 'merge_failed', detail: r.data });
      return res.status(200).json({ ok: true, keep_id: keepId, drop_id: dropId });
    } catch (err) {
      return res.status(500).json({ error: 'merge_failed', message: err?.message });
    }
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}

// ============================================================================
// MERGE-LOG RECONCILE (Round 76ee Phase 2, 2026-04-29)
// ============================================================================
//
// Reads unreconciled rows from dia + gov property_merge_log and patches LCC
// entity backreferences (metadata.domain_property_id +
// metadata._pipeline_summary.domain_property_id) so entities pointing at a
// merged-away property_id are repointed at the canonical keep_id.
//
// Without this, Round 76ee Phase 1's audit log stays informational only —
// future merges would still leave LCC entities pointing at deleted property
// rows (the orphan problem we hit on 2026-04-29 with 21 dia entities).
//
// Routing:
//   GET  /api/admin?_route=merge-log-reconcile        — dry-run, returns counts only
//   POST /api/admin?_route=merge-log-reconcile        — actually patches + stamps log
//
// Query params:
//   ?domain=dia|gov|both    (default both)
//   ?limit=200              (cap unreconciled rows scanned per call)
//
// Both methods return shape:
//   { mode, scanned, patched, by_domain: { dialysis: {scanned,patched,errors:[]}, government: {...} } }
//
// Cron: pg_cron job (`lcc-merge-log-reconcile`, every 15 min) POSTs to this
// endpoint via lcc_cron_post() so freshly merged property_merge_log rows get
// their LCC backrefs patched within ~15 minutes.
//
async function handleMergeLogReconcile(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const domainParam = String(req.query.domain || 'both').toLowerCase();
  if (!['dia','gov','both'].includes(domainParam)) {
    return res.status(400).json({ error: 'domain must be dia, gov, or both' });
  }
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '200', 10)));
  const dryRun = req.method === 'GET';

  const targets = domainParam === 'both' ? ['dia','gov'] : [domainParam];

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    scanned: 0,
    patched: 0,
    by_domain: {},
  };

  for (const target of targets) {
    const dom = target === 'dia' ? 'dialysis' : 'government';
    const summary = { scanned: 0, patched: 0, log_rows_stamped: 0, errors: [] };

    // 1. Pull unreconciled merge-log rows from the domain DB.
    const listRes = await domainQuery(dom, 'GET',
      `property_merge_log?reconciled_lcc_at=is.null&select=id,keep_id,drop_id,merged_at,notes&order=merged_at.asc&limit=${limit}`
    );
    if (!listRes.ok) {
      summary.errors.push({ stage: 'list', status: listRes.status, detail: listRes.data });
      result.by_domain[dom] = summary;
      continue;
    }
    const rows = Array.isArray(listRes.data) ? listRes.data : [];
    summary.scanned = rows.length;
    result.scanned += rows.length;

    if (rows.length === 0) {
      result.by_domain[dom] = summary;
      continue;
    }

    // 2. For each row, repoint LCC entities and (on apply) stamp the log row.
    for (const row of rows) {
      const keepId = String(row.keep_id);
      const dropId = String(row.drop_id);
      let patched = 0;

      // Always do a dry-count first via SELECT — cheap and gives the user
      // an accurate "would patch N entities" preview in GET mode.
      const countRes = await opsQuery('GET',
        `entities?entity_type=eq.asset&domain=eq.${pgFilterVal(dom)}` +
        `&or=(metadata->>domain_property_id.eq.${pgFilterVal(dropId)},` +
            `metadata->_pipeline_summary->>domain_property_id.eq.${pgFilterVal(dropId)})` +
        `&select=id&limit=1000`,
        null,
        { 'Prefer': 'count=exact' }
      );
      if (!countRes.ok) {
        summary.errors.push({
          stage: 'count', merge_log_id: row.id, drop_id: dropId,
          status: countRes.status, detail: countRes.data,
        });
        continue;
      }
      const expected = countRes.count ?? (Array.isArray(countRes.data) ? countRes.data.length : 0);

      if (dryRun) {
        patched = expected;
      } else if (expected === 0) {
        // Nothing to patch — but still stamp the log row so we don't
        // re-scan it on every cron tick.
        patched = 0;
      } else {
        // Call the SQL helper that does atomic JSONB patch on both keys.
        const rpcRes = await opsQuery('POST', 'rpc/lcc_repoint_entity_property_id', {
          p_domain:  dom,
          p_keep_id: keepId,
          p_drop_id: dropId,
        });
        if (!rpcRes.ok) {
          summary.errors.push({
            stage: 'repoint', merge_log_id: row.id, drop_id: dropId,
            status: rpcRes.status, detail: rpcRes.data,
          });
          continue;
        }
        patched = typeof rpcRes.data === 'number'
          ? rpcRes.data
          : (Array.isArray(rpcRes.data) ? rpcRes.data[0] : Number(rpcRes.data || 0));
      }

      summary.patched += patched;
      result.patched += patched;

      // 3. Stamp the merge_log row (only on apply).
      if (!dryRun) {
        const stampRes = await domainQuery(dom, 'PATCH',
          `property_merge_log?id=eq.${encodeURIComponent(row.id)}`,
          {
            reconciled_lcc_at: new Date().toISOString(),
            reconciled_lcc_count: patched,
          }
        );
        if (!stampRes.ok) {
          summary.errors.push({
            stage: 'stamp', merge_log_id: row.id,
            status: stampRes.status, detail: stampRes.data,
          });
          continue;
        }
        summary.log_rows_stamped += 1;
      }
    }

    result.by_domain[dom] = summary;
  }

  const httpStatus = (() => {
    const totalErrs = Object.values(result.by_domain)
      .reduce((acc, s) => acc + (s.errors?.length || 0), 0);
    if (totalErrs > 0 && result.patched === 0) return 502;
    if (totalErrs > 0) return 207; // Multi-Status — partial success
    return 200;
  })();

  return res.status(httpStatus).json(result);
}

// ============================================================================
// AUTO-SCRAPE LISTINGS (Round 76cx Phase 4b, 2026-04-29)
// ============================================================================
//
// Cron-triggered listing-verification sweeper. Every N hours:
//   1. Pull active dia + gov listings whose verification_due_at <= now()
//   2. For each, decide a check_result via cheap heuristics:
//        - SOLD if a sales_transactions row exists for the same property_id
//          with sale_date >= listing_date AND sale_date <= now()
//          (closes the listing the moment the deed records — far more
//          reliable than waiting for a manual "mark as sold" click)
//        - STILL_AVAILABLE otherwise — defers a real availability check to
//          the next cron tick or to the user's next sidebar/manual action.
//          We deliberately don't HEAD-fetch the listing_url here: that
//          opens the door to user-agent / bot blocking, JS-rendered SPA
//          false-404s, and rate-limiting incidents that would silently
//          mark thousands of healthy listings as 'unreachable'. Phase 4c
//          can wire URL probing in once we have a more conservative pass.
//   3. Call public.lcc_record_listing_check via PostgREST RPC for each.
//
// Routing:
//   GET  /api/admin?_route=auto-scrape-listings           — dry-run, returns counts
//   POST /api/admin?_route=auto-scrape-listings           — actually records checks
//
// Query params:
//   ?domain=dia|gov|both   (default both)
//   ?limit=50              (cap listings processed per call — keeps each
//                           cron tick under Vercel's 60s function timeout)
//   ?max_age_days=14       (don't auto-verify listings whose verification
//                           is more than N days overdue — those need
//                           manual research, not a stale cron tick)
//
// Cron: pg_cron job (`lcc-auto-scrape-listings`, every 6h) POSTs to this
// endpoint via lcc_cron_post() so freshly overdue listings get verified
// within the same business day. The user can still click Verify still
// available / Mark off market on the sidebar at any point — those manual
// methods take precedence over this auto-scrape since they share the
// same lcc_record_listing_check function.
//
async function handleAutoScrapeListings(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const domainParam = String(req.query.domain || 'both').toLowerCase();
  if (!['dia', 'gov', 'both'].includes(domainParam)) {
    return res.status(400).json({ error: 'domain must be dia, gov, or both' });
  }
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const maxAgeDays = Math.min(60, Math.max(1, parseInt(req.query.max_age_days || '14', 10)));
  const dryRun = req.method === 'GET';

  const targets = domainParam === 'both' ? ['dia', 'gov'] : [domainParam];
  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    scanned: 0,
    auto_marked_sold: 0,
    auto_verified_available: 0,
    by_domain: {},
  };

  const cutoffIso = new Date(Date.now() - maxAgeDays * 86400000).toISOString();

  for (const target of targets) {
    const dom = target === 'dia' ? 'dialysis' : 'government';
    const summary = {
      scanned: 0,
      sold: 0,
      verified_available: 0,
      skipped_too_stale: 0,
      errors: [],
    };

    // 1. Pull overdue active listings, picking the columns we need to make
    //    the sold/available decision.
    const isActiveFilter = dom === 'dialysis'
      ? `is_active=eq.true`
      : `listing_status=eq.active`;
    const dateCol = dom === 'dialysis' ? 'listing_date' : 'listing_date';
    const select = `listing_id,property_id,${dateCol},verification_due_at,consecutive_check_failures`;

    // gov.available_listings has an exclude_from_listing_metrics flag for
    // listings that shouldn't influence dashboard counts — e.g. test rows,
    // soft-deletes, or known-bad campaigns. The gov v_available_listings
    // and v_listing_verification_summary views all filter on this; the
    // cron should too, otherwise it auto-touches rows the rest of the
    // system intentionally ignores. Dia doesn't have this column.
    const excludeFilter = dom === 'government'
      ? `&exclude_from_listing_metrics=not.is.true`
      : '';

    // Listings to verify this tick:
    //   verification_due_at IS NULL              ← drift recovery (BEFORE-INSERT
    //                                              trigger missed it, e.g. row
    //                                              loaded via psql or replication)
    //   OR (verification_due_at within [cutoff, now])
    //
    // The previous version used two flat verification_due_at filters which
    // excluded NULL rows entirely (PostgREST treats NULL comparisons as not
    // matching), even though the order clause says nullsfirst — that was the
    // tell that NULLs were always meant to be in scope. The companion view
    // v_listings_due_for_verification already uses
    // (verification_due_at IS NULL OR verification_due_at <= now()).
    const cutoffEnc = encodeURIComponent(cutoffIso);
    const nowEnc = encodeURIComponent(new Date().toISOString());
    const path =
      `available_listings?${isActiveFilter}` +
      excludeFilter +
      `&or=(verification_due_at.is.null,and(verification_due_at.gte.${cutoffEnc},verification_due_at.lte.${nowEnc}))` +
      `&select=${select}` +
      `&order=verification_due_at.asc.nullsfirst&limit=${limit}`;

    const listingsRes = await domainQuery(dom, 'GET', path);
    if (!listingsRes.ok) {
      summary.errors.push({ stage: 'list', status: listingsRes.status, detail: listingsRes.data });
      result.by_domain[dom] = summary;
      continue;
    }
    const listings = Array.isArray(listingsRes.data) ? listingsRes.data : [];
    summary.scanned = listings.length;
    result.scanned += listings.length;

    if (listings.length === 0) {
      result.by_domain[dom] = summary;
      continue;
    }

    // 2. Per-listing sale-window check. One sales_transactions GET per
    //    listing — fewer round trips than a bulk-and-merge, and lets us
    //    treat each listing's outcome independently if a sale only matches
    //    one of multiple listings.
    //
    //    Window matches the JS sidebar path's pickClosestListing logic
    //    (±~3 years around listing_date, closest in time wins, prefer
    //    sale_date >= listing_date). Both paths converge on the same
    //    listing→sale pairing, just from different directions: the JS path
    //    fires when a new sale lands, the cron fires when a stale Active
    //    listing comes due for verification.
    for (const l of listings) {
      try {
        // Default outcome: cron found no sale evidence in the property's
        // ±3-year window, so we record an audit-honest 'inferred_active'
        // — advances the verification timer but doesn't claim a URL was
        // scraped or attest to listing_status. Round 76et-C added this
        // value to the lvh_check_result_check constraint and updated
        // lcc_record_listing_check to handle it as a narrow timer
        // advance.
        let checkResult = 'inferred_active';
        let offMarketReason = null;
        let notes = 'auto-scrape: no sale evidence in 3y window, timer advanced';

        if (l.property_id && l[dateCol]) {
          const listingMs = Date.parse(l[dateCol]);
          if (Number.isFinite(listingMs)) {
            const windowDays = 3 * 365 + 1;
            const lower = new Date(listingMs - windowDays * 86400000).toISOString().slice(0, 10);
            const upper = new Date(listingMs + windowDays * 86400000).toISOString().slice(0, 10);

            // Pull all candidate sales in the window and pick the best in JS
            // — limit=10 is enough headroom for any realistic property
            // history. Order ascending so a primary-key tiebreak after the
            // distance comparison stays deterministic across runs.
            const salePath =
              `sales_transactions?property_id=eq.${Number(l.property_id)}` +
              `&sale_date=gte.${encodeURIComponent(lower)}` +
              `&sale_date=lte.${encodeURIComponent(upper)}` +
              `&select=sale_id,sale_date,sold_price&order=sale_date.asc&limit=10`;
            const saleRes = await domainQuery(dom, 'GET', salePath);
            if (saleRes.ok && Array.isArray(saleRes.data) && saleRes.data.length > 0) {
              // Inverse of pickClosestListing: pick the sale whose sale_date
              // is closest to listing_date, tiebreak prefer sale on-or-after
              // listing_date (the closing sale, not a phantom earlier one).
              let best = null;
              let bestDist = Infinity;
              let bestSign = 1;
              for (const sale of saleRes.data) {
                const saleMs = Date.parse(sale.sale_date);
                if (!Number.isFinite(saleMs)) continue;
                const dist = Math.abs(saleMs - listingMs);
                const sign = saleMs >= listingMs ? -1 : 1; // -1 wins
                if (dist < bestDist || (dist === bestDist && sign < bestSign)) {
                  best = sale;
                  bestDist = dist;
                  bestSign = sign;
                }
              }
              if (best) {
                checkResult = 'sold';
                offMarketReason = 'sold';
                notes = `auto-scrape: matched sales_transactions sale_id=${best.sale_id} on ${best.sale_date}`;
              }
            }
          }
        }

        if (dryRun) {
          if (checkResult === 'sold') summary.sold += 1;
          else summary.verified_available += 1;
          continue;
        }

        const rpcRes = await domainQuery(dom, 'POST', 'rpc/lcc_record_listing_check', {
          p_listing_id: l.listing_id,
          p_method: 'auto_scrape',
          p_check_result: checkResult,
          // Fresh audit A-3 (2026-05-18): label inserted via opts below
          p_asking_price: null,
          p_cap_rate: null,
          p_source_url: null,
          p_off_market_reason: offMarketReason,
          p_notes: notes,
          p_verified_by: user.id || null,
        }, { label: 'autoScrapeListings:recordCheck' });
        if (!rpcRes.ok) {
          summary.errors.push({
            stage: 'rpc', listing_id: l.listing_id,
            status: rpcRes.status, detail: rpcRes.data,
          });
          continue;
        }
        if (checkResult === 'sold') {
          summary.sold += 1;
          result.auto_marked_sold += 1;
        } else {
          summary.verified_available += 1;
          result.auto_verified_available += 1;
        }
      } catch (err) {
        summary.errors.push({ stage: 'process', listing_id: l.listing_id, message: err?.message });
      }
    }

    result.by_domain[dom] = summary;
  }

  const totalErrs = Object.values(result.by_domain)
    .reduce((acc, s) => acc + (s.errors?.length || 0), 0);
  const httpStatus =
    (totalErrs > 0 && result.auto_marked_sold + result.auto_verified_available === 0) ? 502 :
    (totalErrs > 0) ? 207 : 200;
  return res.status(httpStatus).json(result);
}

// ============================================================================
// AVAILABILITY-PROMOTION-SWEEP (Round 76ej.h, 2026-05-05)
// ============================================================================
//
// Promotion path for listings the availability-checker (Round 76ej.g)
// stamped 'unverified_assumed_off'. The Edge Function never writes
// check_result='sold' on its own — even when a page banner reads "Sold"
// — because that path needs deed-level evidence the cron worker doesn't
// have. Without a follow-up, those listings would sit indefinitely with
// off_market_reason='unverified_assumed_off' even after the actual sale
// recorded in sales_transactions.
//
// This sweep closes the loop. Every 6h (offset from auto-scrape) it:
//   1. Pulls active dia + gov listings with
//      off_market_reason='unverified_assumed_off' and a recent
//      off_market_date (default last 90d).
//   2. For each, queries sales_transactions for a sale within the
//      property's ±3-year window (same logic + closest-sale picker as
//      handleAutoScrapeListings).
//   3. On a match, calls lcc_record_listing_check(check_result='sold')
//      which upgrades off_market_reason from 'unverified_assumed_off'
//      to 'sold' and writes a 'sold' row to listing_status_history.
//
// Routing:
//   GET  /api/admin?_route=availability-promotion-sweep        — dry-run
//   POST /api/admin?_route=availability-promotion-sweep        — apply
//
// Query params:
//   ?domain=dia|gov|both    (default both)
//   ?limit=50               (cap listings per call)
//   ?max_age_days=90        (only sweep listings off-market within N days)
//
// Cron: pg_cron job 'lcc-availability-promotion-sweep' every 6h at :45,
// 15min after lcc-availability-checker so it's looking at fresh evidence
// from the same cycle.
async function handleAvailabilityPromotionSweep(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const domainParam = String(req.query.domain || 'both').toLowerCase();
  if (!['dia', 'gov', 'both'].includes(domainParam)) {
    return res.status(400).json({ error: 'domain must be dia, gov, or both' });
  }
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const maxAgeDays = Math.min(180, Math.max(7, parseInt(req.query.max_age_days || '90', 10)));
  const dryRun = req.method === 'GET';

  const targets = domainParam === 'both' ? ['dia', 'gov'] : [domainParam];
  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    scanned: 0,
    promoted_to_sold: 0,
    no_sale_evidence: 0,
    by_domain: {},
  };

  const offMarketCutoff = new Date(Date.now() - maxAgeDays * 86400000)
    .toISOString().slice(0, 10);

  for (const target of targets) {
    const dom = target === 'dia' ? 'dialysis' : 'government';
    const summary = {
      scanned: 0,
      promoted: 0,
      no_evidence: 0,
      errors: [],
    };

    // gov has the exclude_from_listing_metrics flag for soft-deleted /
    // test rows; mirror handleAutoScrapeListings' filter.
    const excludeFilter = dom === 'government'
      ? `&exclude_from_listing_metrics=not.is.true`
      : '';

    // Pull off-market listings the scraper stamped as unverified.
    // We don't filter on is_active/listing_status — the off_market_reason
    // filter implicitly captures rows that aren't active anymore.
    const select = 'listing_id,property_id,listing_date,off_market_date,off_market_reason';
    const path =
      `available_listings?off_market_reason=eq.unverified_assumed_off` +
      `&listing_date=not.is.null` +
      `&off_market_date=gte.${encodeURIComponent(offMarketCutoff)}` +
      excludeFilter +
      `&select=${select}` +
      `&order=off_market_date.desc,listing_id.asc&limit=${limit}`;

    const listingsRes = await domainQuery(dom, 'GET', path);
    if (!listingsRes.ok) {
      summary.errors.push({ stage: 'list', status: listingsRes.status, detail: listingsRes.data });
      result.by_domain[dom] = summary;
      continue;
    }
    const listings = Array.isArray(listingsRes.data) ? listingsRes.data : [];
    summary.scanned = listings.length;
    result.scanned += listings.length;

    if (listings.length === 0) {
      result.by_domain[dom] = summary;
      continue;
    }

    for (const l of listings) {
      try {
        if (!l.property_id || !l.listing_date) {
          summary.no_evidence += 1;
          result.no_sale_evidence += 1;
          continue;
        }
        const listingMs = Date.parse(l.listing_date);
        if (!Number.isFinite(listingMs)) {
          summary.no_evidence += 1;
          result.no_sale_evidence += 1;
          continue;
        }

        // Same ±3-year window + closest-sale picker as handleAutoScrapeListings.
        const windowDays = 3 * 365 + 1;
        const lower = new Date(listingMs - windowDays * 86400000).toISOString().slice(0, 10);
        const upper = new Date(listingMs + windowDays * 86400000).toISOString().slice(0, 10);
        const salePath =
          `sales_transactions?property_id=eq.${Number(l.property_id)}` +
          `&sale_date=gte.${encodeURIComponent(lower)}` +
          `&sale_date=lte.${encodeURIComponent(upper)}` +
          `&select=sale_id,sale_date,sold_price&order=sale_date.asc&limit=10`;
        const saleRes = await domainQuery(dom, 'GET', salePath);
        if (!saleRes.ok) {
          summary.errors.push({
            stage: 'sale_lookup', listing_id: l.listing_id,
            status: saleRes.status, detail: saleRes.data,
          });
          continue;
        }
        const sales = Array.isArray(saleRes.data) ? saleRes.data : [];
        if (sales.length === 0) {
          summary.no_evidence += 1;
          result.no_sale_evidence += 1;
          continue;
        }

        // Pick closest by date, tiebreak prefer sale on-or-after listing_date.
        let best = null;
        let bestDist = Infinity;
        let bestSign = 1;
        for (const sale of sales) {
          const saleMs = Date.parse(sale.sale_date);
          if (!Number.isFinite(saleMs)) continue;
          const dist = Math.abs(saleMs - listingMs);
          const sign = saleMs >= listingMs ? -1 : 1;
          if (dist < bestDist || (dist === bestDist && sign < bestSign)) {
            best = sale;
            bestDist = dist;
            bestSign = sign;
          }
        }
        if (!best) {
          summary.no_evidence += 1;
          result.no_sale_evidence += 1;
          continue;
        }

        if (dryRun) {
          summary.promoted += 1;
          result.promoted_to_sold += 1;
          continue;
        }

        const rpcRes = await domainQuery(dom, 'POST', 'rpc/lcc_record_listing_check', {
          p_listing_id: l.listing_id,
          p_method: 'auto_scrape',
          p_check_result: 'sold',
          p_off_market_reason: 'sold',
          p_effective_at: best.sale_date,
          p_notes: `availability-promotion-sweep: matched sales_transactions sale_id=${best.sale_id} on ${best.sale_date} (was unverified_assumed_off)`,
          p_verified_by: user.id || null,
        }, { label: 'availabilityPromotionSweep:recordCheck' });
        if (!rpcRes.ok) {
          summary.errors.push({
            stage: 'rpc', listing_id: l.listing_id,
            status: rpcRes.status, detail: rpcRes.data,
          });
          continue;
        }
        summary.promoted += 1;
        result.promoted_to_sold += 1;
      } catch (err) {
        summary.errors.push({ stage: 'process', listing_id: l.listing_id, message: err?.message });
      }
    }

    result.by_domain[dom] = summary;
  }

  const totalErrs = Object.values(result.by_domain)
    .reduce((acc, s) => acc + (s.errors?.length || 0), 0);
  const httpStatus =
    (totalErrs > 0 && result.promoted_to_sold === 0) ? 502 :
    (totalErrs > 0) ? 207 : 200;
  return res.status(httpStatus).json(result);
}

// ============================================================================
// RESOLVE LISTING CONFIRMATION (manual human follow-up — main app, not sidebar)
// ============================================================================
// POST { domain:'dia'|'gov', listing_id, action, sale_id?, sold_price?,
//        sale_date?, off_market_reason?, notes? }
// action: 'confirm_sold' | 'mark_withdrawn' | 'still_active'
// Lets a user in the main app resolve a v_listings_needing_manual_confirmation
// row without the Chrome sidebar. Writes through the same
// lcc_record_listing_check RPC with method='manual_user' and
// verified_by=user.id, so it's audited identically to the cron/sidebar paths.
async function handleResolveListingConfirmation(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const b = req.body || {};
  const domainParam = String(b.domain || '').toLowerCase();
  if (!['dia', 'gov'].includes(domainParam)) {
    return res.status(400).json({ error: 'domain must be dia or gov' });
  }
  const dom = domainParam === 'dia' ? 'dialysis' : 'government';
  const listingId = b.listing_id;
  if (listingId === undefined || listingId === null || listingId === '') {
    return res.status(400).json({ error: 'listing_id required' });
  }
  const action = String(b.action || '');
  const ACTIONS = {
    confirm_sold:   { check_result: 'sold',            off_market_reason: 'sold' },
    mark_withdrawn: { check_result: 'off_market',      off_market_reason: 'withdrawn' },
    still_active:   { check_result: 'still_available',  off_market_reason: null },
  };
  if (!ACTIONS[action]) {
    return res.status(400).json({ error: "action must be confirm_sold, mark_withdrawn, or still_active" });
  }
  const map = ACTIONS[action];

  const rpcBody = {
    p_listing_id: listingId,
    p_method: 'manual_user',
    p_check_result: map.check_result,
    p_off_market_reason: b.off_market_reason || map.off_market_reason,
    p_verified_by: user.id || null,
    p_notes: b.notes
      || `manual confirmation by user${b.sale_id ? ` (sale_id=${b.sale_id})` : ''}`,
  };
  // confirm_sold: stamp the effective date from the matched sale when supplied
  // so off_market_date reflects the actual close, not "today".
  if (action === 'confirm_sold' && b.sale_date) rpcBody.p_effective_at = b.sale_date;

  const rpcRes = await domainQuery(dom, 'POST', 'rpc/lcc_record_listing_check', rpcBody,
    { label: 'resolveListingConfirmation:recordCheck' });
  if (!rpcRes.ok) {
    return res.status(502).json({ error: 'rpc_failed', status: rpcRes.status, detail: rpcRes.data });
  }
  return res.status(200).json({ ok: true, domain: domainParam, listing_id: listingId, action, result: rpcRes.data });
}

// ============================================================================
// SF SYNC QUEUE
// ============================================================================
// POST body: { kind: 'create_account'|'create_opportunity'|..., payload: {...} }
// Inserts a pending row into lcc_opps.sf_sync_queue. A Power Automate flow
// polls this table, executes the write against Salesforce (using the same
// SSO-backed SF connector the lookup flow uses), and updates status/result.
//
// This exists because Scott's org can't register a Connected App for OAuth,
// so every SF write has to be brokered by a PA flow. LCC writes the intent
// to Supabase; PA reads it and performs the SF side-effect.
async function handleSfSyncQueue(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const { kind, payload } = req.body || {};
  const validKinds = ['create_account','create_opportunity','update_account','find_account','link_contact'];
  if (!kind || !validKinds.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${validKinds.join(', ')}` });
  }

  const workspaceId = user.memberships?.[0]?.workspace_id || null;
  const insertRes = await opsQuery('POST', 'sf_sync_queue', {
    workspace_id:  workspaceId,
    kind,
    payload:       payload || {},
    status:        'pending',
    requested_by:  user.display_name || user.email || 'unknown',
  }, { 'Prefer': 'return=representation' });

  if (!insertRes.ok) {
    return res.status(insertRes.status || 500).json({
      error: 'Failed to queue SF sync request',
      detail: insertRes.data,
    });
  }
  const row = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  return res.status(201).json({ ok: true, queue_id: row?.id, kind, status: 'pending' });
}

// ============================================================================
// WORKSPACES
// ============================================================================

async function handleWorkspaces(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const { id } = req.query;

    if (id) {
      const membership = user.memberships.find(m => m.workspace_id === id);
      if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

      const result = await opsQuery('GET', `workspaces?id=eq.${pgFilterVal(id)}&select=*`);
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch workspace' });

      const workspace = Array.isArray(result.data) ? result.data[0] : result.data;
      return res.status(200).json({ workspace, role: membership.role });
    }

    const workspaceIds = user.memberships.map(m => m.workspace_id);
    if (workspaceIds.length === 0) return res.status(200).json({ workspaces: [] });

    const result = await opsQuery('GET',
      `workspaces?id=in.(${workspaceIds.join(',')})&select=*&order=name`
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch workspaces' });

    const workspaces = (Array.isArray(result.data) ? result.data : []).map(ws => ({
      ...ws,
      role: user.memberships.find(m => m.workspace_id === ws.id)?.role
    }));

    return res.status(200).json({ workspaces });
  }

  if (req.method === 'POST') {
    const { name, slug } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
    }

    const wsResult = await opsQuery('POST', 'workspaces', { name, slug });
    if (!wsResult.ok) return res.status(wsResult.status).json({ error: 'Failed to create workspace', detail: wsResult.data });

    const workspace = Array.isArray(wsResult.data) ? wsResult.data[0] : wsResult.data;
    await opsQuery('POST', 'workspace_memberships', {
      workspace_id: workspace.id,
      user_id: user.id,
      role: 'owner'
    });

    return res.status(201).json({ workspace, role: 'owner' });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });
    if (!requireRole(user, 'manager', id)) {
      return res.status(403).json({ error: 'Manager role or higher required to update workspace' });
    }

    const { name, slug } = req.body || {};
    const updates = {};
    if (name) updates.name = name;
    if (slug) {
      if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
      updates.slug = slug;
    }
    updates.updated_at = new Date().toISOString();

    const result = await opsQuery('PATCH', `workspaces?id=eq.${pgFilterVal(id)}`, updates);
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update workspace' });

    return res.status(200).json({ workspace: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ============================================================================
// MEMBERS
// ============================================================================

async function handleMembers(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context. Set X-LCC-Workspace header.' });

  const myMembership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!myMembership) return res.status(403).json({ error: 'Not a member of this workspace' });

  if (req.method === 'GET' && req.query.action === 'me') {
    return res.status(200).json({
      user: { id: user.id, email: user.email, display_name: user.display_name, avatar_url: user.avatar_url },
      workspace_id: workspaceId,
      role: myMembership.role,
      memberships: user.memberships
    });
  }

  if (req.method === 'GET') {
    const { user_id } = req.query;

    if (user_id) {
      const result = await opsQuery('GET',
        `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(user_id)}&select=*,users(*)`
      );
      if (!result.ok || !result.data?.length) return res.status(404).json({ error: 'Member not found' });
      const m = result.data[0];
      return res.status(200).json({
        member: { user_id: m.user_id, role: m.role, joined_at: m.joined_at, ...m.users }
      });
    }

    const result = await opsQuery('GET',
      `workspace_memberships?workspace_id=eq.${workspaceId}&select=*,users(*)&order=joined_at`
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch members' });

    const members = (Array.isArray(result.data) ? result.data : []).map(m => ({
      user_id: m.user_id, role: m.role, joined_at: m.joined_at,
      display_name: m.users?.display_name, email: m.users?.email,
      avatar_url: m.users?.avatar_url, is_active: m.users?.is_active
    }));

    return res.status(200).json({ members, workspace_id: workspaceId });
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Manager role or higher required to add members' });
    }

    const { email, display_name, role } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });

    const memberRole = role || 'operator';
    if (!VALID_ROLES.includes(memberRole)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (memberRole === 'owner' && myMembership.role !== 'owner') {
      return res.status(403).json({ error: 'Only workspace owners can assign the owner role' });
    }

    let targetUser;
    const existingResult = await opsQuery('GET', `users?email=eq.${pgFilterVal(email)}&select=*&limit=1`);
    if (existingResult.ok && existingResult.data?.length > 0) {
      targetUser = existingResult.data[0];
    } else {
      const createResult = await opsQuery('POST', 'users', {
        email, display_name: display_name || email.split('@')[0], is_active: true
      });
      if (!createResult.ok) return res.status(createResult.status).json({ error: 'Failed to create user', detail: createResult.data });
      targetUser = Array.isArray(createResult.data) ? createResult.data[0] : createResult.data;
    }

    const memberCheck = await opsQuery('GET',
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${targetUser.id}&select=id`
    );
    if (memberCheck.ok && memberCheck.data?.length > 0) {
      return res.status(409).json({ error: 'User is already a member of this workspace' });
    }

    const memberResult = await opsQuery('POST', 'workspace_memberships', {
      workspace_id: workspaceId, user_id: targetUser.id, role: memberRole
    });
    if (!memberResult.ok) return res.status(memberResult.status).json({ error: 'Failed to add membership' });

    return res.status(201).json({
      member: { user_id: targetUser.id, email: targetUser.email, display_name: targetUser.display_name, role: memberRole }
    });
  }

  if (req.method === 'PATCH') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id query parameter required' });
    if (!requireRole(user, 'owner', workspaceId)) {
      return res.status(403).json({ error: 'Only workspace owners can change roles' });
    }

    const { role } = req.body || {};
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (user_id === user.id && myMembership.role === 'owner' && role !== 'owner') {
      return res.status(400).json({ error: 'Cannot demote yourself. Transfer ownership first.' });
    }

    const result = await opsQuery('PATCH',
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(user_id)}`, { role }
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update role' });

    return res.status(200).json({ user_id, role, updated: true });
  }

  if (req.method === 'DELETE') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id query parameter required' });
    if (!requireRole(user, 'owner', workspaceId)) {
      return res.status(403).json({ error: 'Only workspace owners can remove members' });
    }
    if (user_id === user.id) return res.status(400).json({ error: 'Cannot remove yourself from workspace' });

    await opsQuery('DELETE',
      `workspace_memberships?workspace_id=eq.${workspaceId}&user_id=eq.${pgFilterVal(user_id)}`
    );

    return res.status(200).json({ user_id, removed: true });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ============================================================================
// FLAGS
// ============================================================================

async function handleFlags(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  const wsResult = await opsQuery('GET', `workspaces?id=eq.${workspaceId}&select=config`);
  const wsConfig = wsResult.data?.[0]?.config || {};
  const featureFlags = wsConfig.feature_flags || {};

  if (req.method === 'GET') {
    const { flag } = req.query;

    const resolved = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_FLAGS)) {
      resolved[key] = featureFlags[key] !== undefined ? featureFlags[key] : defaultValue;
    }

    if (flag) {
      if (!(flag in DEFAULT_FLAGS)) return res.status(404).json({ error: `Unknown flag: ${flag}` });
      return res.status(200).json({
        flag, value: resolved[flag],
        source: featureFlags[flag] !== undefined ? 'workspace' : 'default',
        default: DEFAULT_FLAGS[flag]
      });
    }

    return res.status(200).json({ flags: resolved, overrides: featureFlags, defaults: DEFAULT_FLAGS });
  }

  if (req.method === 'POST') {
    if (!requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Manager role required to update feature flags' });
    }

    const { flag, value } = req.body || {};
    if (!flag || !(flag in DEFAULT_FLAGS)) {
      return res.status(400).json({ error: `flag must be one of: ${Object.keys(DEFAULT_FLAGS).join(', ')}` });
    }
    if (typeof value !== 'boolean') return res.status(400).json({ error: 'value must be a boolean' });

    const updatedFlags = { ...featureFlags, [flag]: value };
    const updatedConfig = { ...wsConfig, feature_flags: updatedFlags };

    const result = await opsQuery('PATCH',
      `workspaces?id=eq.${workspaceId}`,
      { config: updatedConfig, updated_at: new Date().toISOString() }
    );

    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update flag' });

    return res.status(200).json({
      flag, value,
      previous: featureFlags[flag] !== undefined ? featureFlags[flag] : DEFAULT_FLAGS[flag],
      updated_at: new Date().toISOString()
    });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ============================================================================
// AUTH CONFIG — Public endpoint for frontend to discover auth settings
// No authentication required (needed before the user can sign in)
// ============================================================================

function handleAuthConfig(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Return the public (anon) Supabase credentials — NEVER the service role key
  const supabaseUrl = process.env.OPS_SUPABASE_URL || null;
  const supabaseAnonKey = process.env.OPS_SUPABASE_ANON_KEY || null;
  const env = process.env.LCC_ENV || 'development';
  const lccApiKey = process.env.LCC_API_KEY || null;

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({
    supabase_url: supabaseUrl,
    supabase_anon_key: supabaseAnonKey,
    env,
    // Phase 6b: expose API key so the frontend fetch interceptor can authenticate
    // when JWT is unavailable. This is safe for a single-user private deployment.
    // For multi-user production, remove this and require JWT auth exclusively.
    lcc_api_key: lccApiKey,
    auth_modes: lccApiKey ? ['jwt', 'magic_link', 'api_key'] : ['jwt', 'magic_link'],
    _note: supabaseAnonKey
      ? 'Supabase auth is configured. Frontend should use JWT authentication.'
      : lccApiKey
        ? 'API key mode — frontend will authenticate via X-LCC-Key header.'
        : 'No auth configured (OPS_SUPABASE_ANON_KEY / LCC_API_KEY). Running in dev fallback mode.'
  });
}

// ============================================================================
// ME — Return the authenticated user's profile and workspace info
// Requires authentication (JWT or API key)
// ============================================================================

async function handleMe(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  return res.status(200).json({
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    auth_id: user.auth_id || null,
    _transitional: user._transitional || false,
    _api_key_auth: user._api_key_auth || false,
    memberships: user.memberships || []
  });
}

// ============================================================================
// CONNECTORS — Connector account CRUD (migrated from sync.js, Phase 4b)
// GET/POST/PATCH/DELETE /api/connectors → /api/admin?_route=connectors
// ============================================================================

const VALID_CONNECTOR_TYPES = ['salesforce', 'outlook', 'power_automate', 'supabase_domain', 'webhook'];
const VALID_CONNECTOR_METHODS = ['direct_api', 'power_automate', 'webhook', 'manual'];
const VALID_CONNECTOR_STATUSES = ['healthy', 'degraded', 'error', 'disconnected', 'pending_setup'];

async function handleConnectors(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context. Set X-LCC-Workspace header.' });

  const myMembership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!myMembership) return res.status(403).json({ error: 'Not a member of this workspace' });

  if (req.method === 'GET') {
    const { id, user_id, action } = req.query;

    if (action === 'health') {
      const result = await opsQuery('GET',
        `connector_accounts?workspace_id=eq.${pgFilterVal(workspaceId)}&select=id,user_id,connector_type,status,last_sync_at,last_error,display_name`
      );
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });

      const connectors = Array.isArray(result.data) ? result.data : [];
      return res.status(200).json({
        total: connectors.length,
        healthy: connectors.filter(c => c.status === 'healthy').length,
        degraded: connectors.filter(c => c.status === 'degraded').length,
        error: connectors.filter(c => c.status === 'error').length,
        disconnected: connectors.filter(c => c.status === 'disconnected').length,
        pending: connectors.filter(c => c.status === 'pending_setup').length,
        connectors
      });
    }

    if (id) {
      const result = await opsQuery('GET',
        `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=*`
      );
      if (!result.ok || !result.data?.length) return res.status(404).json({ error: 'Connector not found' });

      const connector = result.data[0];
      if (connector.user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
        const { config, ...safe } = connector;
        return res.status(200).json({ connector: safe });
      }
      return res.status(200).json({ connector });
    }

    if (user_id) {
      if (user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Cannot view other users\' connectors' });
      }
      const result = await opsQuery('GET',
        `connector_accounts?workspace_id=eq.${pgFilterVal(workspaceId)}&user_id=eq.${pgFilterVal(user_id)}&select=*&order=connector_type`
      );
      if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });
      return res.status(200).json({ connectors: result.data || [] });
    }

    const isManager = !!requireRole(user, 'manager', workspaceId);
    const select = isManager
      ? '*'
      : 'id,user_id,connector_type,execution_method,display_name,status,last_sync_at';

    const result = await opsQuery('GET',
      `connector_accounts?workspace_id=eq.${pgFilterVal(workspaceId)}&select=${select}&order=connector_type,display_name`
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to fetch connectors' });
    return res.status(200).json({ connectors: result.data || [] });
  }

  if (req.method === 'POST') {
    const { connector_type, execution_method, display_name, config, external_user_id, target_user_id } = req.body || {};

    if (!connector_type || !VALID_CONNECTOR_TYPES.includes(connector_type)) {
      return res.status(400).json({ error: `connector_type must be one of: ${VALID_CONNECTOR_TYPES.join(', ')}` });
    }
    if (!display_name) return res.status(400).json({ error: 'display_name is required' });

    const method = execution_method || 'power_automate';
    if (!VALID_CONNECTOR_METHODS.includes(method)) {
      return res.status(400).json({ error: `execution_method must be one of: ${VALID_CONNECTOR_METHODS.join(', ')}` });
    }

    let targetUserId = user.id;
    if (target_user_id && target_user_id !== user.id) {
      if (!requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Only managers can create connectors for other users' });
      }
      targetUserId = target_user_id;
    }

    const result = await opsQuery('POST', 'connector_accounts', {
      workspace_id: workspaceId, user_id: targetUserId, connector_type,
      execution_method: method, display_name, status: 'pending_setup',
      config: config || {}, external_user_id: external_user_id || null
    });

    if (!result.ok) return res.status(result.status).json({ error: 'Failed to create connector', detail: result.data });
    return res.status(201).json({ connector: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    const existing = await opsQuery('GET',
      `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=user_id`
    );
    if (!existing.ok || !existing.data?.length) return res.status(404).json({ error: 'Connector not found' });

    if (existing.data[0].user_id !== user.id && !requireRole(user, 'manager', workspaceId)) {
      return res.status(403).json({ error: 'Can only update your own connectors' });
    }

    const { display_name, status, config, execution_method, external_user_id, last_sync_at, last_error } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };

    if (display_name) updates.display_name = display_name;
    if (status && VALID_CONNECTOR_STATUSES.includes(status)) updates.status = status;
    if (config !== undefined) updates.config = config;
    if (execution_method && VALID_CONNECTOR_METHODS.includes(execution_method)) updates.execution_method = execution_method;
    if (external_user_id !== undefined) updates.external_user_id = external_user_id;
    if (last_sync_at !== undefined) updates.last_sync_at = last_sync_at;
    if (last_error !== undefined) updates.last_error = last_error;

    const result = await opsQuery('PATCH',
      `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}`, updates
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update connector' });
    return res.status(200).json({ connector: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    const existing = await opsQuery('GET',
      `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=user_id`
    );
    if (!existing.ok || !existing.data?.length) return res.status(404).json({ error: 'Connector not found' });

    if (existing.data[0].user_id !== user.id && !requireRole(user, 'owner', workspaceId)) {
      return res.status(403).json({ error: 'Only connector owner or workspace owner can delete connectors' });
    }

    await opsQuery('DELETE',
      `connector_accounts?id=eq.${pgFilterVal(id)}&workspace_id=eq.${pgFilterVal(workspaceId)}`
    );

    return res.status(200).json({ id, removed: true });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

// ============================================================================
// DIAGNOSTICS — Config, diag, treasury (migrated from diagnostics.js, Phase 4b)
// ============================================================================

async function handleConfig(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    gov: { connected: !!govSupabaseKey() },
    dia: { connected: !!diaSupabaseKey() },
    ops: { connected: !!(process.env.OPS_SUPABASE_URL && process.env.OPS_SUPABASE_KEY) }
  });
}

async function handleDiag(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Auth-readiness probe — PUBLIC (no auth), read-only, no behavior change.
  // Reports whether THIS request would survive flipping LCC_ENV=production
  // ({ has_jwt, has_api_key, would_pass_in_production }). Reachable regardless
  // of enforcement state so it can never itself contribute to a lockout — call
  // it while still in DEV MODE to confirm the frontend is already sending
  // X-LCC-Key before committing to the enforced flip:  /api/diag?kind=auth-ready
  if (req.query.kind === 'auth-ready') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(authReadiness(req));
  }

  const user = await authenticate(req, res);
  if (!user) return;

  // Lightweight env-var presence probe — no secret required. Added after the
  // 2026-04-24 outage where OPS_SUPABASE_KEY went missing from Vercel Prod
  // and every endpoint silently 503'd with no actionable signal. Call from
  // the browser or PowerShell: /api/diag?kind=env
  if (req.query.kind === 'env') {
    return res.status(200).json({
      ops_url_set:  !!process.env.OPS_SUPABASE_URL,
      ops_key_set:  !!process.env.OPS_SUPABASE_KEY,
      gov_url_set:  !!process.env.GOV_SUPABASE_URL,
      gov_key_set:  !!govSupabaseKey(),
      gov_key_kind: process.env.GOV_SUPABASE_SERVICE_KEY ? 'service' : (process.env.GOV_SUPABASE_KEY ? 'anon_fallback' : null),
      dia_url_set:  !!process.env.DIA_SUPABASE_URL,
      dia_key_set:  !!diaSupabaseKey(),
      dia_key_kind: process.env.DIA_SUPABASE_SERVICE_KEY ? 'service' : (process.env.DIA_SUPABASE_KEY ? 'anon_fallback' : null),
      lcc_api_key_set:    !!process.env.LCC_API_KEY,
      anthropic_key_set:  !!process.env.ANTHROPIC_API_KEY,
      teams_webhook_set:  !!process.env.TEAMS_INTAKE_WEBHOOK_URL,
      sf_webhook_set:     !!process.env.SF_LOOKUP_WEBHOOK_URL,
      ms_graph_token_set: !!process.env.MS_GRAPH_TOKEN,
      vercel_env:         process.env.VERCEL_ENV || null,
      lcc_env:            process.env.LCC_ENV || null,
      node_version:       process.version,
    });
  }

  const secret = process.env.DIAG_SECRET || 'lcc-diag-2024';
  if (req.query.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden — pass ?secret=<DIAG_SECRET>' });
  }

  const govKey = govSupabaseKey() || '';
  const diaKey = diaSupabaseKey() || '';
  const govUrl = process.env.GOV_SUPABASE_URL;
  const diaUrl = process.env.DIA_SUPABASE_URL;
  const results = {};

  if (govUrl) {
    try {
      const r = await fetch(`${govUrl}/rest/v1/ownership_history?select=ownership_id&limit=1`, {
        headers: { 'apikey': govKey, 'Authorization': `Bearer ${govKey}` }
      });
      const body = await r.text();
      results.gov = { status: r.status, keySet: govKey.length > 0, sample: body.substring(0, 200) };
    } catch (e) {
      results.gov = { error: e.message, keySet: govKey.length > 0 };
    }
  } else {
    results.gov = { error: 'GOV_SUPABASE_URL not configured', keySet: false };
  }

  if (diaUrl) {
    try {
      const r = await fetch(`${diaUrl}/rest/v1/v_counts_freshness?select=*&limit=1`, {
        headers: { 'apikey': diaKey, 'Authorization': `Bearer ${diaKey}` }
      });
      const body = await r.text();
      results.dia = { status: r.status, keySet: diaKey.length > 0, sample: body.substring(0, 200) };
    } catch (e) {
      results.dia = { error: e.message, keySet: diaKey.length > 0 };
    }
  } else {
    results.dia = { error: 'DIA_SUPABASE_URL not configured', keySet: false };
  }

  return res.status(200).json(results);
}

// ============================================================================
// OWNERSHIP RECONCILIATION — batch-fix stale properties.recorded_owner_id
// ============================================================================

async function handleOwnershipReconcile(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const user = await authenticate(req, res);
  if (!user) return;

  const secret = process.env.DIAG_SECRET || 'lcc-diag-2024';
  if (req.query.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden — pass ?secret=<DIAG_SECRET>' });
  }

  const domain = req.query.domain || 'government';
  if (!['government', 'dialysis'].includes(domain)) {
    return res.status(400).json({ error: 'domain must be government or dialysis' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

  // Fetch properties that have ownership_history records
  const propsRes = await domainQuery(domain, 'GET',
    `properties?select=property_id&limit=${limit}`
  );
  if (!propsRes.ok) {
    return res.status(502).json({ error: 'Failed to fetch properties', detail: propsRes.data });
  }

  const results = { total: 0, updated: 0, skipped: 0, errors: 0 };
  for (const row of (propsRes.data || [])) {
    results.total++;
    try {
      const r = await reconcilePropertyOwnership(domain, row.property_id);
      if (r.updated) results.updated++;
      else results.skipped++;
    } catch (e) {
      results.errors++;
      console.error(`[ownership-reconcile] property ${row.property_id}:`, e.message);
    }
  }

  return res.status(200).json(results);
}

function parseXmlEntry(entry) {
  const dateMatch = entry.match(/<d:NEW_DATE[^>]*>([^<]+)/);
  const tenYrMatch = entry.match(/<d:BC_10YEAR[^>]*>([^<]+)/);
  const thirtyYrMatch = entry.match(/<d:BC_30YEAR[^>]*>([^<]+)/);
  return {
    date: dateMatch ? dateMatch[1].split('T')[0] : null,
    ten_yr: tenYrMatch ? parseFloat(tenYrMatch[1]) : null,
    thirty_yr: thirtyYrMatch ? parseFloat(thirtyYrMatch[1]) : null
  };
}

async function fetchXmlYear(year) {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/xml', 'User-Agent': 'Mozilla/5.0 (compatible; LCC/1.0)' }
    });
    if (!r.ok) {
      console.warn(`[treasury/xml] non-OK status ${r.status} fetching ${url}`);
      return [];
    }
    const text = await r.text();
    const entries = text.split('<m:properties>').slice(1);
    return entries.map(parseXmlEntry).filter(e => e.date && e.ten_yr !== null);
  } catch (err) {
    // Network or parse failure — treasury source is occasionally unavailable.
    // Log so we can spot a sustained outage instead of silently returning [].
    console.warn('[treasury/xml] fetch failed:', err?.message || err);
    return [];
  }
}

async function fetchCsvYear(year) {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${year}?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!r.ok) return [];
    const csvText = await r.text();
    const lines = csvText.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const hdrs = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const tenIdx = hdrs.findIndex(h => h === '10 Yr');
    const thirtyIdx = hdrs.findIndex(h => h === '30 Yr');
    if (tenIdx < 0) return [];
    return lines.slice(1).map(line => {
      const cols = line.split(',').map(v => v.replace(/"/g, '').trim());
      const tenVal = parseFloat(cols[tenIdx]);
      if (isNaN(tenVal)) return null;
      const parts = cols[0].split('/');
      const isoDate = parts.length === 3
        ? `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`
        : cols[0];
      return { date: isoDate, ten_yr: tenVal, thirty_yr: thirtyIdx >= 0 ? (parseFloat(cols[thirtyIdx]) || null) : null };
    }).filter(Boolean);
  } catch (err) {
    console.warn(`[treasury/csv] fetch failed for year ${year}:`, err?.message || err);
    return [];
  }
}

// Module-level last-good cache so a transient treasury.gov outage degrades
// the rate widget to the last known value (stale: true) instead of erroring.
// `latest` holds the most recent non-history payload; `history` is keyed by
// the requested year span (e.g. "1", "5").
let _treasuryCache = { latest: null, history: {} };

async function handleTreasury(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const wantHistory = req.query.history === 'true';
  const numYears = Math.min(parseInt(req.query.years, 10) || 1, 5);
  const currentYear = new Date().getFullYear();
  const historyKey = String(numYears);

  // Returns the last-good payload as a 200 with stale:true, or null if no
  // cache exists yet for this request shape.
  const serveStale = () => {
    const cached = wantHistory ? _treasuryCache.history[historyKey] : _treasuryCache.latest;
    if (!cached) return false;
    const staleDate = wantHistory
      ? (cached.history && cached.history.length ? cached.history[cached.history.length - 1].date : null)
      : (cached.date || null);
    res.status(200).json({ ...cached, stale: true, as_of: staleDate });
    return true;
  };

  try {
    if (wantHistory) {
      const years = [];
      for (let i = 0; i < numYears; i++) years.push(currentYear - i);
      let allEntries = (await Promise.all(years.map(fetchXmlYear))).flat();
      if (allEntries.length === 0) allEntries = (await Promise.all(years.map(fetchCsvYear))).flat();
      allEntries.sort((a, b) => a.date.localeCompare(b.date));
      if (allEntries.length === 0 && serveStale()) return;
      const payload = { history: allEntries };
      _treasuryCache.history[historyKey] = payload;
      return res.status(200).json(payload);
    }

    const entries = await fetchXmlYear(currentYear);
    if (entries.length > 0) {
      const latest = entries[entries.length - 1];
      const prev = entries.length > 1 ? entries[entries.length - 2] : null;
      const payload = {
        date: latest.date, ten_yr: latest.ten_yr, thirty_yr: latest.thirty_yr,
        prev_date: prev ? prev.date : null, prev_ten_yr: prev ? prev.ten_yr : null,
      };
      _treasuryCache.latest = payload;
      return res.status(200).json(payload);
    }

    const csvEntries = await fetchCsvYear(currentYear);
    if (csvEntries.length > 0) {
      const latest = csvEntries[csvEntries.length - 1];
      const prev = csvEntries.length > 1 ? csvEntries[csvEntries.length - 2] : null;
      const payload = {
        date: latest.date, ten_yr: latest.ten_yr, thirty_yr: latest.thirty_yr,
        prev_date: prev ? prev.date : null, prev_ten_yr: prev ? prev.ten_yr : null,
      };
      _treasuryCache.latest = payload;
      return res.status(200).json(payload);
    }

    const fiscalUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=2&fields=record_date,avg_interest_rate_amt,security_desc&filter=security_desc:eq:Treasury Notes';
    const fiscalRes = await fetch(fiscalUrl, { headers: { 'Accept': 'application/json' } });
    if (fiscalRes.ok) {
      const json = await fiscalRes.json();
      const rows = json.data || [];
      if (rows.length >= 1) {
        const latest = rows[0];
        const prev = rows.length > 1 ? rows[1] : null;
        const payload = {
          date: latest.record_date, ten_yr: parseFloat(latest.avg_interest_rate_amt) || null,
          thirty_yr: null, prev_date: prev ? prev.record_date : null,
          prev_ten_yr: prev ? (parseFloat(prev.avg_interest_rate_amt) || null) : null,
        };
        _treasuryCache.latest = payload;
        return res.status(200).json(payload);
      }
    }

    // All upstream sources empty — degrade to last-good before erroring.
    if (serveStale()) return;
    return res.status(500).json({ error: 'No data from any Treasury source' });
  } catch (e) {
    console.error('[diagnostics] Treasury rate fetch error:', e.message);
    if (serveStale()) return;
    return res.status(500).json({ error: 'Treasury rate fetch failed' });
  }
}

// ============================================================================
// EDGE FUNCTION PROXIES — Phase 4b: Pure edge-first routing
// No local fallback — edge functions are the source of truth
//
// QA-02 (2026-05-18) reminder: the LIVE data-query Edge Function is on
// the Dialysis_DB project (zqzrriwuavgrquhisnoa), NOT on LCC Opps
// (xengecqvemvfknjvbvrq) which also has a data-query function. When
// updating the allowlist in supabase/functions/data-query/index.ts, the
// redeploy target is the project in the URL below. Deploying to the
// wrong project will silently no-op against production traffic.
// ============================================================================

const DATA_QUERY_EDGE_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/data-query';
const DAILY_BRIEFING_EDGE_URL_ADMIN = 'https://xengecqvemvfknjvbvrq.supabase.co/functions/v1/daily-briefing';
const NPI_LOOKUP_EDGE_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/npi-lookup';
const NPI_REGISTRY_SYNC_EDGE_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/npi-registry-sync';

function buildEdgeProxyHeaders(req) {
  const hdrs = { 'Content-Type': 'application/json' };
  const forward = [
    'x-lcc-workspace', 'x-lcc-key', 'x-pa-webhook-secret',
    'x-lcc-user-id', 'x-lcc-user-email', 'authorization', 'prefer'
  ];
  for (const h of forward) {
    if (req.headers[h]) hdrs[h] = req.headers[h];
  }
  return hdrs;
}

async function handleEdgeDataProxy(req, res) {
  const url = new URL(DATA_QUERY_EDGE_URL);

  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '_route') continue;
    if (key === '_edgeRoute') { url.searchParams.set('_route', value); continue; }
    url.searchParams.set(key, value);
  }

  try {
    const edgeRes = await fetch(url.toString(), {
      method: req.method,
      headers: buildEdgeProxyHeaders(req),
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    const data = await edgeRes.json();
    return res.status(edgeRes.status).json(data);
  } catch (err) {
    console.error('[admin/edge-data] Edge proxy failed:', err.message);
    return res.status(502).json({ error: 'Edge function unavailable', detail: err.message });
  }
}

// Proxies POST /api/npi-lookup to the npi-lookup edge function on the
// dialysis Supabase project. Used by the NPI Intel UI button + by the
// weekly pg_cron job that auto-fills new missing-NPI rows.
async function handleNpiLookupProxy(req, res) {
  const url = new URL(NPI_LOOKUP_EDGE_URL);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '_route') continue;
    url.searchParams.set(key, value);
  }
  try {
    const edgeRes = await fetch(url.toString(), {
      method: req.method,
      headers: buildEdgeProxyHeaders(req),
      body: req.method !== 'GET' ? JSON.stringify(req.body || {}) : undefined,
      // 621 active rows × ~80ms throttle = ~50s in the worst case; give
      // headroom for slow NPPES responses + DB writes.
      signal: AbortSignal.timeout(120000),
    });
    const data = await edgeRes.json().catch(() => ({}));
    return res.status(edgeRes.status).json(data);
  } catch (err) {
    console.error('[admin/npi-lookup] proxy failed:', err.message);
    return res.status(502).json({ error: 'NPI lookup edge function unavailable', detail: err.message });
  }
}

// Proxies POST /api/npi-registry-sync to the npi-registry-sync edge function
// on the dialysis project. Used by the weekly pg_cron job that walks the
// NPPES registry per state and snapshots into clinic_npi_registry_history.
async function handleNpiRegistrySyncProxy(req, res) {
  const url = new URL(NPI_REGISTRY_SYNC_EDGE_URL);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '_route') continue;
    url.searchParams.set(key, value);
  }
  try {
    const edgeRes = await fetch(url.toString(), {
      method: req.method,
      headers: buildEdgeProxyHeaders(req),
      body: req.method !== 'GET' ? JSON.stringify(req.body || {}) : undefined,
      // Full national sweep can take ~2 minutes (50 states × ~80ms throttle
      // + per-state subdivision for big states). Give plenty of headroom.
      signal: AbortSignal.timeout(180000),
    });
    const data = await edgeRes.json().catch(() => ({}));
    return res.status(edgeRes.status).json(data);
  } catch (err) {
    console.error('[admin/npi-registry-sync] proxy failed:', err.message);
    return res.status(502).json({ error: 'NPI registry sync edge function unavailable', detail: err.message });
  }
}

async function handleEdgeBriefingProxy(req, res) {
  const url = new URL(DAILY_BRIEFING_EDGE_URL_ADMIN);

  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '_route') continue;
    url.searchParams.set(key, value);
  }

  // Daily-briefing edge function is strictly GET-only. The pg_cron job
  // wraps via lcc_cron_post() which uses POST, but the edge function
  // returns 405 on anything other than GET. If the client (or cron) sent
  // POST, lift any body params into the query string and force GET.
  if (req.method !== 'GET' && req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const edgeRes = await fetch(url.toString(), {
      method: 'GET',
      headers: buildEdgeProxyHeaders(req),
      signal: AbortSignal.timeout(30000),
    });
    const data = await edgeRes.json();
    return res.status(edgeRes.status).json(data);
  } catch (err) {
    console.error('[admin/edge-brief] Edge proxy failed:', err.message);
    return res.status(502).json({ error: 'Edge function unavailable', detail: err.message });
  }
}

// ============================================================================
// CMS MATCH — resolve property_id → CMS medicare_id via fuzzy address match
// ============================================================================
// Routes:
//   GET  /api/cms-match?action=resolve&property_id=UUID
//     → { medicare_id, match_score, match_method, facility, cms } | { match: null, candidates: [...] }
//   GET  /api/cms-match?action=search&q=string&state=CA&zip=92392&limit=10
//     → { candidates: [ { medicare_id, facility_name, address, ... }, ... ] }
//   POST /api/cms-match?action=link
//     body: { property_id, medicare_id, match_method?: 'manual' }
//     → { ok: true, link: {...} }
//   DELETE /api/cms-match?action=link&property_id=UUID
//     → { ok: true }
// ----------------------------------------------------------------------------

const US_STREET_SUFFIX_MAP = {
  st: 'street', str: 'street', 'st.': 'street',
  rd: 'road', 'rd.': 'road',
  ave: 'avenue', av: 'avenue', 'ave.': 'avenue',
  blvd: 'boulevard', bvd: 'boulevard', 'blvd.': 'boulevard',
  dr: 'drive', drv: 'drive', 'dr.': 'drive',
  ln: 'lane', 'ln.': 'lane',
  ct: 'court', 'ct.': 'court',
  cir: 'circle', 'cir.': 'circle',
  pkwy: 'parkway', pky: 'parkway', pkway: 'parkway', 'pkwy.': 'parkway',
  hwy: 'highway', 'hwy.': 'highway',
  expy: 'expressway', fwy: 'freeway',
  pl: 'place', 'pl.': 'place',
  ter: 'terrace', 'ter.': 'terrace',
  trl: 'trail', 'trl.': 'trail',
  trce: 'trace',
  xing: 'crossing',
  sq: 'square',
  byp: 'bypass',
  way: 'way', wy: 'way',
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest',
  se: 'southeast', sw: 'southwest',
};

function normalizeAddress(addr) {
  if (!addr || typeof addr !== 'string') return { raw: '', tokens: [], number: null, canonical: '' };
  const raw = addr.trim().toLowerCase();
  // Strip unit suffixes (#, ste, suite, unit, apt) — everything after
  const stripped = raw
    .replace(/[.,]/g, ' ')
    .replace(/\b(suite|ste|unit|apt|apartment|#)\s*[a-z0-9-]+/gi, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = stripped.split(/\s+/).filter(Boolean);
  // Extract leading house number
  let number = null;
  if (parts.length && /^\d+[a-z]?$/.test(parts[0])) {
    number = parts[0].replace(/[a-z]$/, '');
  }
  // Expand abbreviations
  const expanded = parts.map(t => US_STREET_SUFFIX_MAP[t] || t);
  const canonical = expanded.join(' ');
  return { raw, tokens: expanded, number, canonical };
}

function jaccardSimilarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function scoreAddressMatch(propAddr, candAddr, propZip, candZip) {
  const pn = normalizeAddress(propAddr);
  const cn = normalizeAddress(candAddr);
  if (!pn.tokens.length || !cn.tokens.length) return 0;

  // House number: must match if both present
  let numScore = 0;
  if (pn.number && cn.number) {
    numScore = pn.number === cn.number ? 1 : 0;
  } else {
    numScore = 0.5; // partial credit if one is missing
  }

  // Street name tokens (drop leading number)
  const pTail = pn.tokens.filter(t => !/^\d/.test(t));
  const cTail = cn.tokens.filter(t => !/^\d/.test(t));
  const nameScore = jaccardSimilarity(pTail, cTail);

  // Zip exact match
  const zipScore = (propZip && candZip && String(propZip).substring(0, 5) === String(candZip).substring(0, 5)) ? 1 : 0;

  // Weighted: number 40%, street name 50%, zip 10%
  return numScore * 0.40 + nameScore * 0.50 + zipScore * 0.10;
}

function requireDiaEnv(res) {
  const url = process.env.DIA_SUPABASE_URL;
  const key = diaSupabaseKey();
  if (!url || !key) {
    res.status(503).json({ error: 'DIA_SUPABASE_URL / DIA_SUPABASE_SERVICE_KEY (or DIA_SUPABASE_KEY) not configured' });
    return null;
  }
  return { url, key };
}

async function diaRest(env, method, path, body) {
  const fullUrl = `${env.url.replace(/\/+$/, '')}/rest/v1/${path}`;
  // POST uses resolution=merge-duplicates for upsert; DELETE/PATCH only need return=representation
  let prefer = '';
  if (method === 'POST') prefer = 'return=representation,resolution=merge-duplicates';
  else if (method !== 'GET') prefer = 'return=representation';
  const opts = {
    method,
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(fullUrl, opts);
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

async function fetchPropertyForMatch(env, propertyId) {
  // SELECT * — the Dialysis `properties` table has gone through several
  // normalization passes (see sql/20260410_normalize_properties_address*.sql)
  // and the exact set of columns isn't guaranteed. Pulling all columns
  // avoids 400 errors from PostgREST when a named column no longer exists.
  const r = await diaRest(env, 'GET',
    `properties?select=*&property_id=eq.${encodeURIComponent(propertyId)}&limit=1`);
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  const p = r.data[0];
  return {
    property_id: p.property_id,
    address: p.address || p.street_address || p.address_1 || p.property_name || '',
    city: p.city || '',
    state: p.state || '',
    zip: p.zip_code || p.zip || p.postal_code || '',
    // Denormalized CMS link columns on properties — when populated, they are
    // an authoritative manual/curated link and short-circuit fuzzy matching.
    medicare_id: p.medicare_id || null,
    linked_medicare_facility_id: p.linked_medicare_facility_id || null,
  };
}

async function fetchCandidateClinics(env, { zip, state, city }) {
  // SELECT * so callers can read whichever zip/address column exists. The
  // CMS dataset uses `zip_code`, but older ingestions may still carry `zip`.
  // Filtering on a column that doesn't exist returns 400 from PostgREST,
  // so we try `zip_code` first and fall back to `zip`/state+city.
  const zip5 = zip ? String(zip).substring(0, 5) : '';
  const tryQueries = [];
  if (zip5) {
    tryQueries.push(`medicare_clinics?select=*&zip_code=like.${zip5}%25&limit=200`);
    tryQueries.push(`medicare_clinics?select=*&zip=like.${zip5}%25&limit=200`);
  }
  if (state) {
    const stateFilter = `state=eq.${encodeURIComponent(state)}`;
    const cityFilter = city ? `&city=ilike.${encodeURIComponent(city)}` : '';
    tryQueries.push(`medicare_clinics?select=*&${stateFilter}${cityFilter}&limit=200`);
    // Final wide net: state-only. Reached when a property has no zip AND
    // its city differs from CMS's spelling (e.g., property "St. Louis" vs
    // CMS "SAINT LOUIS"). 500-row cap is enough for any single state.
    if (city) tryQueries.push(`medicare_clinics?select=*&${stateFilter}&limit=500`);
  }
  for (const q of tryQueries) {
    try {
      const r = await diaRest(env, 'GET', q);
      if (r.ok && Array.isArray(r.data) && r.data.length) {
        console.log('[cms-match] candidates from', q.split('?')[1].split('&').slice(1, 4).join('&'), '→', r.data.length);
        return r.data;
      }
    } catch (e) {
      console.warn('[cms-match] candidate fetch failed for', q, e.message);
    }
  }
  console.warn('[cms-match] no candidates found — zip:', zip || '(none)', 'state:', state || '(none)', 'city:', city || '(none)');
  return [];
}

async function fetchCmsSnapshot(env, medicareId) {
  // Pull a compact operational snapshot for the Operations tab.
  // Best-effort across several tables — any missing piece returns null.
  const id = encodeURIComponent(medicareId);
  const jobs = [
    diaRest(env, 'GET',
      `medicare_clinics?select=*&medicare_id=eq.${id}&limit=1`),
    diaRest(env, 'GET',
      `v_property_rankings?select=*&medicare_id=eq.${id}&limit=1`),
    diaRest(env, 'GET',
      `clinic_quality_metrics?select=*&medicare_id=eq.${id}&order=snapshot_date.desc&limit=1`),
    diaRest(env, 'GET',
      `facility_patient_counts?select=*&medicare_id=eq.${id}&order=snapshot_date.desc&limit=1`),
    diaRest(env, 'GET',
      `clinic_trends?select=*&medicare_id=eq.${id}&limit=1`),
    diaRest(env, 'GET',
      `v_clinic_payer_mix?select=*&medicare_id=eq.${id}&limit=1`),
    diaRest(env, 'GET',
      `facility_cost_reports?select=*&medicare_id=eq.${id}&order=fiscal_year.desc&limit=1`),
  ];
  const [clinic, rankings, quality, patient, trends, payer, cost] = await Promise.all(
    jobs.map(j => j.catch(() => ({ ok: false, data: [] })))
  );
  const first = r => (r && r.ok && Array.isArray(r.data) && r.data[0]) || null;
  return {
    clinic: first(clinic),
    rankings: first(rankings),
    quality: first(quality),
    patient: first(patient),
    trends: first(trends),
    payer: first(payer),
    cost: first(cost),
  };
}

function detectOperator(clinic, rankings) {
  const name = (
    (rankings && (rankings.chain_organization || rankings.operator_name)) ||
    (clinic && (clinic.chain_organization || clinic.operator_name)) ||
    ''
  ).toString().toLowerCase();
  if (!name) return { label: 'Unknown', key: 'unknown' };
  if (/davita/.test(name)) return { label: 'DaVita', key: 'davita' };
  if (/fresenius|fmc|fkc/.test(name)) return { label: 'Fresenius (FMC)', key: 'fmc' };
  if (/u\.?s\.?\s*renal|usrc/.test(name)) return { label: 'US Renal', key: 'usrenal' };
  if (/satellite/.test(name)) return { label: 'Satellite', key: 'satellite' };
  if (/dialyze\s*direct/.test(name)) return { label: 'Dialyze Direct', key: 'dialyzedirect' };
  return { label: 'Independent', key: 'indy' };
}

async function handleCmsMatch(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const action = req.query.action || 'resolve';
  const env = requireDiaEnv(res);
  if (!env) return;

  // ── action=search (typeahead) ─────────────────────────────────────────────
  if (action === 'search') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
    const q = (req.query.q || '').toString().trim();
    const state = (req.query.state || '').toString().trim();
    const zip = (req.query.zip || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 25);
    if (!q && !zip) {
      return res.status(400).json({ error: 'q or zip required' });
    }
    // Try `zip_code` first, fall back to `zip` if PostgREST 400s on the column.
    // SELECT * guards against schema drift between ingestions.
    const baseFilters = [];
    if (q) {
      const qEnc = encodeURIComponent(q);
      baseFilters.push(
        `or=(facility_name.ilike.*${qEnc}*,address.ilike.*${qEnc}*,medicare_id.eq.${qEnc})`
      );
    }
    if (state) baseFilters.push(`state=eq.${encodeURIComponent(state)}`);

    const zip5 = zip ? zip.substring(0, 5) : '';
    const attempts = [];
    if (zip5) {
      attempts.push([...baseFilters, `zip_code=like.${zip5}%25`]);
      attempts.push([...baseFilters, `zip=like.${zip5}%25`]);
    }
    attempts.push(baseFilters); // final fallback — no zip filter

    try {
      let rows = [];
      let lastErr = null;
      for (const filters of attempts) {
        const qs = `medicare_clinics?select=*&${filters.join('&')}&limit=${limit}`;
        const r = await diaRest(env, 'GET', qs);
        if (r.ok) {
          rows = Array.isArray(r.data) ? r.data : [];
          lastErr = null;
          if (rows.length > 0) break; // keep trying broader scopes if no results
        } else {
          lastErr = { status: r.status, detail: r.data };
        }
      }
      if (lastErr && !rows.length) {
        return res.status(lastErr.status || 502).json({ error: 'Search failed', detail: lastErr.detail });
      }
      return res.status(200).json({ candidates: rows });
    } catch (err) {
      console.error('[cms-match/search] error:', err.message);
      return res.status(502).json({ error: 'Search unavailable', detail: err.message });
    }
  }

  // ── action=link (manual / upsert) ─────────────────────────────────────────
  if (action === 'link') {
    if (req.method === 'DELETE') {
      const propertyId = req.query.property_id;
      if (!propertyId) return res.status(400).json({ error: 'property_id required' });
      try {
        const r = await diaRest(env, 'DELETE',
          `property_cms_link?property_id=eq.${encodeURIComponent(propertyId)}`);
        if (!r.ok) return res.status(r.status).json({ error: 'Delete failed', detail: r.data });
        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(502).json({ error: 'Delete failed', detail: err.message });
      }
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST or DELETE' });
    const body = req.body || {};
    const { property_id, medicare_id, match_method = 'manual', match_notes } = body;
    if (!property_id || !medicare_id) {
      return res.status(400).json({ error: 'property_id and medicare_id required' });
    }
    if (!['manual', 'manual:typeahead', 'auto:address_zip', 'auto:medicare_clinics'].includes(match_method)) {
      return res.status(400).json({ error: 'invalid match_method' });
    }
    const row = {
      property_id,
      medicare_id,
      match_method,
      match_notes: match_notes || null,
      match_score: match_method.startsWith('manual') ? null : (body.match_score ?? null),
      matched_by: user.email || user.display_name || user.id,
      matched_at: new Date().toISOString(),
    };
    try {
      const r = await diaRest(env, 'POST', 'property_cms_link', row);
      if (!r.ok) {
        console.error('[cms-match/link] upsert failed:', r.status, JSON.stringify(r.data));
        return res.status(r.status).json({ error: 'Upsert failed', detail: r.data });
      }
      console.log('[cms-match/link] upsert ok:', property_id, '→', medicare_id,
        'method=', match_method, 'response=', Array.isArray(r.data) ? r.data.length + ' rows' : typeof r.data);
      // Audit history
      diaRest(env, 'POST', 'property_cms_link_history', {
        property_id, medicare_id,
        match_method, match_score: row.match_score,
        action: 'created', matched_by: row.matched_by,
      }).catch(() => {});
      const snap = await fetchCmsSnapshot(env, medicare_id);
      const operator = detectOperator(snap.clinic, snap.rankings);
      return res.status(200).json({
        ok: true,
        link: Array.isArray(r.data) ? r.data[0] : r.data,
        facility: snap.clinic,
        rankings: snap.rankings,
        quality: snap.quality,
        patient: snap.patient,
        trends: snap.trends,
        payer: snap.payer,
        cost: snap.cost,
        operator,
      });
    } catch (err) {
      console.error('[cms-match/link] error:', err.message);
      return res.status(502).json({ error: 'Link failed', detail: err.message });
    }
  }

  // ── action=resolve (auto fuzzy match + cache) ─────────────────────────────
  if (action === 'resolve') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
    const propertyId = req.query.property_id;
    if (!propertyId) return res.status(400).json({ error: 'property_id required' });

    try {
      // 1. Check cache
      const cached = await diaRest(env, 'GET',
        `property_cms_link?select=*&property_id=eq.${encodeURIComponent(propertyId)}&limit=1`);
      if (cached.ok && Array.isArray(cached.data) && cached.data[0]) {
        const link = cached.data[0];
        const snap = await fetchCmsSnapshot(env, link.medicare_id);
        return res.status(200).json({
          source: 'cache',
          medicare_id: link.medicare_id,
          match_score: link.match_score,
          match_method: link.match_method,
          facility: snap.clinic,
          rankings: snap.rankings,
          quality: snap.quality,
          patient: snap.patient,
          trends: snap.trends,
          payer: snap.payer,
          cost: snap.cost,
          operator: detectOperator(snap.clinic, snap.rankings),
        });
      }

      // 2. Load the property
      const prop = await fetchPropertyForMatch(env, propertyId);
      if (!prop) return res.status(404).json({ error: 'property not found' });
      console.log('[cms-match/resolve] property loaded:',
        'addr=', JSON.stringify(prop.address), 'city=', prop.city,
        'state=', prop.state, 'zip=', prop.zip);

      // 2b. Authoritative denormalized link on the property record itself.
      // When properties.linked_medicare_facility_id (or properties.medicare_id)
      // is populated, treat it as a curated/manual link and skip fuzzy match.
      // This fixes the bug where Operations tab showed "No CMS facility linked"
      // for properties whose CCN was already known but absent from
      // property_cms_link cache and medicare_clinics.property_id back-link.
      const denormCcn = prop.linked_medicare_facility_id || prop.medicare_id;
      if (denormCcn) {
        console.log('[cms-match/resolve] using denormalized property CCN:', denormCcn,
          '(', prop.linked_medicare_facility_id ? 'linked_medicare_facility_id' : 'medicare_id', ')');
        // Persist to property_cms_link so subsequent loads short-circuit on cache.
        await diaRest(env, 'POST', 'property_cms_link', {
          property_id: propertyId,
          medicare_id: denormCcn,
          match_method: 'auto:property_field',
          match_score: 1.0,
          matched_by: 'system',
          matched_at: new Date().toISOString(),
        }).catch(() => {});
        const snap = await fetchCmsSnapshot(env, denormCcn);
        return res.status(200).json({
          source: 'property_field',
          medicare_id: denormCcn,
          match_score: 1.0,
          match_method: 'auto:property_field',
          facility: snap.clinic,
          rankings: snap.rankings,
          quality: snap.quality,
          patient: snap.patient,
          trends: snap.trends,
          payer: snap.payer,
          cost: snap.cost,
          operator: detectOperator(snap.clinic, snap.rankings),
        });
      }

      // 3. Check if medicare_clinics already links this property_id
      //    SELECT * — the exact column set varies across ingestions.
      const mc = await diaRest(env, 'GET',
        `medicare_clinics?select=*&property_id=eq.${encodeURIComponent(propertyId)}&limit=1`);
      if (mc.ok && Array.isArray(mc.data) && mc.data[0] && mc.data[0].medicare_id) {
        const mid = mc.data[0].medicare_id;
        await diaRest(env, 'POST', 'property_cms_link', {
          property_id: propertyId,
          medicare_id: mid,
          match_method: 'auto:medicare_clinics',
          match_score: 1.0,
          matched_by: 'system',
          matched_at: new Date().toISOString(),
        }).catch(() => {});
        const snap = await fetchCmsSnapshot(env, mid);
        return res.status(200).json({
          source: 'medicare_clinics',
          medicare_id: mid,
          match_score: 1.0,
          match_method: 'auto:medicare_clinics',
          facility: snap.clinic || mc.data[0],
          rankings: snap.rankings,
          quality: snap.quality,
          patient: snap.patient,
          trends: snap.trends,
          payer: snap.payer,
          cost: snap.cost,
          operator: detectOperator(snap.clinic || mc.data[0], snap.rankings),
        });
      }

      // 4. Fuzzy address match — pull candidates by zip (or state+city)
      const candidates = await fetchCandidateClinics(env, {
        zip: prop.zip, state: prop.state, city: prop.city,
      });
      console.log('[cms-match/resolve] candidates found:', candidates.length,
        'for zip=', prop.zip, 'state=', prop.state, 'city=', prop.city);

      const scored = candidates.map(c => ({
        ...c,
        _score: scoreAddressMatch(prop.address, c.address, prop.zip, c.zip_code || c.zip),
      }))
        .sort((a, b) => b._score - a._score);

      const top = scored[0];
      if (top) {
        console.log('[cms-match/resolve] top candidate:', top.medicare_id,
          'name=', top.facility_name, 'addr=', top.address,
          'city=', top.city, 'zip=', top.zip_code || top.zip,
          'score=', top._score.toFixed(3));
      }
      const CONFIDENT_THRESHOLD = 0.80;
      const CANDIDATE_THRESHOLD = 0.55;

      if (top && top._score >= CONFIDENT_THRESHOLD) {
        // Cache and return
        await diaRest(env, 'POST', 'property_cms_link', {
          property_id: propertyId,
          medicare_id: top.medicare_id,
          match_method: 'auto:address_zip',
          match_score: Number(top._score.toFixed(3)),
          match_notes: `auto-matched ${prop.address} → ${top.address}`,
          matched_by: user.email || user.display_name || user.id,
          matched_at: new Date().toISOString(),
        }).catch(err => console.warn('[cms-match] cache write failed:', err.message));
        diaRest(env, 'POST', 'property_cms_link_history', {
          property_id: propertyId, medicare_id: top.medicare_id,
          match_method: 'auto:address_zip', match_score: Number(top._score.toFixed(3)),
          action: 'created', matched_by: user.email || user.display_name || user.id,
        }).catch(() => {});
        const snap = await fetchCmsSnapshot(env, top.medicare_id);
        return res.status(200).json({
          source: 'fuzzy',
          medicare_id: top.medicare_id,
          match_score: Number(top._score.toFixed(3)),
          match_method: 'auto:address_zip',
          facility: snap.clinic || top,
          rankings: snap.rankings,
          quality: snap.quality,
          patient: snap.patient,
          trends: snap.trends,
          payer: snap.payer,
          cost: snap.cost,
          operator: detectOperator(snap.clinic || top, snap.rankings),
        });
      }

      // 5. No confident match — return top candidates for manual selection
      const hints = scored
        .filter(s => s._score >= CANDIDATE_THRESHOLD)
        .slice(0, 5)
        .map(s => ({
          medicare_id: s.medicare_id,
          facility_name: s.facility_name,
          address: s.address,
          city: s.city,
          state: s.state,
          zip: s.zip_code || s.zip,
          chain_organization: s.chain_organization,
          operator_name: s.operator_name,
          match_score: Number(s._score.toFixed(3)),
        }));
      // If no hints cleared the 0.55 threshold, still expose the top 3 raw
      // candidates so the Match-facility card can show "Did you mean…?"
      // suggestions instead of showing nothing.
      const fallbackHints = hints.length ? hints : scored.slice(0, 3).map(s => ({
        medicare_id: s.medicare_id,
        facility_name: s.facility_name,
        address: s.address,
        city: s.city,
        state: s.state,
        zip: s.zip_code || s.zip,
        chain_organization: s.chain_organization,
        operator_name: s.operator_name,
        match_score: Number((s._score || 0).toFixed(3)),
      }));
      console.warn('[cms-match/resolve] no confident match for', prop.property_id,
        'addr=', prop.address, 'zip=', prop.zip,
        'candidates=', candidates.length, 'topScore=', top ? top._score : null);
      return res.status(200).json({
        source: 'none',
        medicare_id: null,
        match: null,
        property: prop,
        candidates: fallbackHints,
        debug: {
          candidate_count: candidates.length,
          top_score: top ? Number(top._score.toFixed(3)) : null,
          confident_threshold: CONFIDENT_THRESHOLD,
          candidate_threshold: CANDIDATE_THRESHOLD,
        },
      });
    } catch (err) {
      console.error('[cms-match/resolve] error:', err.message, err.stack);
      return res.status(502).json({ error: 'Resolve failed', detail: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use: resolve, search, link' });
}

// ============================================================================
// STORAGE CLEANUP — delete orphan PDFs from lcc-om-uploads bucket
//
// Round 76aq 2026-04-28: replaces the broken pg_cron-based cleanup that
// failed every nightly run because Supabase's storage.protect_delete()
// trigger blocks direct DELETE FROM storage.objects. This Vercel endpoint
// uses the Supabase Storage REST API DELETE method, which the trigger
// permits (because it routes through the storage backend, not SQL).
//
// Routing: /api/admin?_route=storage-cleanup
//   GET    : dry-run, returns counts only
//   POST   : actually deletes (still capped at batch_size objects)
//
// Query/body params:
//   ?bucket=lcc-om-uploads   (default)
//   ?grace_days=14           (default — only delete orphans older than this)
//   ?batch_size=200          (default — bound the per-call blast radius)
//
// Auth: standard X-LCC-Key + workspace membership.
// ============================================================================

async function handleStorageCleanup(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST (delete) only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const bucket    = String(req.query.bucket    || 'lcc-om-uploads');
  const graceDays = Math.max(1, parseInt(req.query.grace_days || '14', 10));
  const batchSize = Math.min(1000, Math.max(1, parseInt(req.query.batch_size || '200', 10)));
  const dryRun    = req.method === 'GET';

  // 1. Find orphans via PostgREST: storage.objects rows in this bucket
  //    older than graceDays whose `name` doesn't appear in any
  //    staged_intake_artifacts.storage_path.
  const opsUrl = process.env.OPS_SUPABASE_URL;
  const opsKey = process.env.OPS_SUPABASE_KEY;
  if (!opsUrl || !opsKey) {
    return res.status(500).json({ error: 'ops_credentials_missing' });
  }

  // Use the dedicated SQL function if it exists, else inline query.
  // For now, do the lookup via PostgREST RPC against a helper view.
  // Simpler: use SQL via opsQuery — but storage schema isn't exposed
  // through PostgREST by default. We hit the Storage REST API for
  // listing AND deletion to keep the contract clean.
  const cutoffIso = new Date(Date.now() - graceDays * 86400000).toISOString();

  // List candidates from PostgREST (storage tables ARE exposed for
  // service_role keys via the storage schema). If the project doesn't
  // expose it, we can fall back to net.http_post inside Postgres.
  let listResp;
  try {
    listResp = await fetch(
      `${opsUrl}/rest/v1/rpc/lcc_list_orphan_storage_objects`,
      {
        method: 'POST',
        headers: {
          'apikey':        opsKey,
          'Authorization': `Bearer ${opsKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          _bucket: bucket,
          _cutoff: cutoffIso,
          _limit:  batchSize,
        }),
      }
    );
  } catch (err) {
    return res.status(502).json({ error: 'storage_list_fetch_failed', detail: err?.message });
  }

  if (!listResp.ok) {
    const detail = await listResp.text();
    return res.status(502).json({
      error:  'storage_list_rpc_failed',
      status: listResp.status,
      detail: detail.slice(0, 400),
    });
  }

  const orphans = await listResp.json();
  if (!Array.isArray(orphans)) {
    return res.status(502).json({
      error:  'storage_list_unexpected_shape',
      detail: JSON.stringify(orphans).slice(0, 400),
    });
  }

  if (dryRun) {
    return res.status(200).json({
      mode:        'dry_run',
      bucket,
      grace_days:  graceDays,
      batch_size:  batchSize,
      orphan_count: orphans.length,
      sample_names: orphans.slice(0, 10).map(o => o.name),
    });
  }

  // 2. Actually delete via Storage REST API DELETE /object/{bucket}/{name}
  let deleted = 0;
  const failures = [];
  for (const obj of orphans) {
    try {
      // Storage REST API expects literal '/' in object paths, not %2F.
      // encodeURIComponent encodes '/' which the API rejects with 400.
      // Encode each path segment individually so spaces/specials still get
      // encoded but slashes pass through. Round 76as 2026-04-28.
      const encodedPath = obj.name.split('/').map(encodeURIComponent).join('/');
      const delResp = await fetch(
        `${opsUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
        {
          method: 'DELETE',
          headers: {
            'apikey':        opsKey,
            'Authorization': `Bearer ${opsKey}`,
          },
        }
      );
      if (delResp.ok || delResp.status === 404) {
        deleted++;
      } else {
        failures.push({ name: obj.name, status: delResp.status });
      }
    } catch (err) {
      failures.push({ name: obj.name, error: err?.message });
    }
  }

  return res.status(200).json({
    mode:         'delete',
    bucket,
    grace_days:   graceDays,
    batch_size:   batchSize,
    orphan_total: orphans.length,
    deleted,
    failures:     failures.slice(0, 20),
    failure_count: failures.length,
  });
}


// ============================================================================
// ARTIFACT OFFLOAD — staged_intake_artifacts inline_data → Supabase Storage
// Routing: /api/admin?_route=artifact-offload  (rewritten to /api/artifact-offload)
//   GET    : dry-run — counts eligible artifacts + reclaimable bytes, no writes
//   POST   : drain a batch — upload inline bytes to Storage, null inline_data
//
// Why: large email/copilot OM files are stored base64 in
// staged_intake_artifacts.inline_data at ingest (no storage_path). That table
// reached ~6 GB and is the largest disk consumer on LCC Opps after the
// 2026-05-29 sf_sync_log incident. This worker moves the bytes to the
// lcc-om-uploads bucket (cheap object storage) and clears inline_data,
// PRESERVING the file. Transparent to all readers: the extractor
// (intake-extractor.js getArtifactBytes) and the download handler both fall
// back to storage_path when inline_data is null.
//
// Safety / idempotency:
//   * Only touches rows with inline_data NOT NULL and storage_path NULL that
//     are older than grace_minutes (default 15) — gives the inline-based
//     initial extraction time to finish before the bytes move.
//   * Upload uses x-upsert:true; on partial failure (uploaded but row not
//     patched) the next tick re-uploads to the same deterministic path and
//     patches — no duplicates, no data loss. If upload fails, the row is left
//     untouched and still readable via inline_data.
//   * Time-budgeted (~7s) so it stays under the Vercel function limit;
//     idempotent across many small ticks (run on a cron, like geocode-tick).
//
// Query/body params:
//   ?limit=15            (max per tick; capped at 40)
//   ?grace_minutes=15    (skip artifacts newer than this)
//   ?bucket=lcc-om-uploads
//
// Auth: standard X-LCC-Key + workspace membership (via authenticate()).
// ============================================================================

const ARTIFACT_OFFLOAD_MIME_EXT = {
  'application/pdf':                                                          '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':        '.xlsx',
  'application/vnd.ms-excel':                                                 '.xls',
  'application/msword':                                                       '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':  '.docx',
  'text/plain':                                                               '.txt',
  'message/rfc822':                                                           '.eml',
};

function artifactOffloadSafeName(fileName, mimeType) {
  const fallbackExt = ARTIFACT_OFFLOAD_MIME_EXT[(mimeType || 'application/pdf').toLowerCase()] || '.bin';
  let safe = String(fileName || 'upload')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'upload';
  if (!/\.[a-z0-9]{2,6}$/i.test(safe)) safe += fallbackExt;
  return safe;
}

async function handleArtifactOffload(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST (offload) only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const opsUrl = process.env.OPS_SUPABASE_URL;
  const opsKey = process.env.OPS_SUPABASE_KEY;
  if (!opsUrl || !opsKey) {
    return res.status(503).json({ error: 'ops_credentials_missing' });
  }

  const bucket       = String(req.query.bucket || 'lcc-om-uploads');
  const graceMinutes = Math.max(0, parseInt(req.query.grace_minutes || '15', 10));
  const limit        = Math.min(40, Math.max(1, parseInt(req.query.limit || '15', 10)));
  const dryRun       = req.method === 'GET';
  const cutoffIso    = new Date(Date.now() - graceMinutes * 60000).toISOString();

  // 1. Find eligible rows. Do NOT select inline_data here — that column holds
  //    multi-MB base64 and would blow up the response. Largest first so we
  //    reclaim the most disk per tick.
  const listFilter =
    `staged_intake_artifacts?select=id,file_name,mime_type,size_bytes` +
    `&inline_data=not.is.null&storage_path=is.null` +
    `&created_at=lt.${pgFilterVal(cutoffIso)}` +
    `&order=size_bytes.desc.nullslast&limit=${limit}`;
  const listRes = await opsQuery('GET', listFilter, null, { countMode: 'exact' });
  if (!listRes.ok) {
    return res.status(listRes.status || 502).json({ error: 'artifact_list_failed', detail: listRes.data });
  }
  const rows = Array.isArray(listRes.data) ? listRes.data : [];

  if (dryRun) {
    return res.status(200).json({
      mode:          'dry_run',
      bucket,
      grace_minutes: graceMinutes,
      eligible_now:  rows.length,
      eligible_total: listRes.count,
      sample:        rows.slice(0, 10).map(r => ({ id: r.id, file_name: r.file_name, size_bytes: r.size_bytes })),
    });
  }

  // 2. Offload one at a time, fetching inline_data per row to bound memory.
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 7000;
  const stats = { scanned: 0, offloaded: 0, skipped_empty: 0, errored: 0, bytes_freed: 0 };
  const failures = [];

  for (const row of rows) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    stats.scanned++;
    try {
      // 2a. Fetch the bytes for just this row.
      const oneRes = await opsQuery('GET',
        `staged_intake_artifacts?select=inline_data&id=eq.${pgFilterVal(row.id)}`,
        null, { countMode: 'none' });
      const inline = Array.isArray(oneRes.data) && oneRes.data[0]?.inline_data;
      if (!inline) { stats.skipped_empty++; continue; }

      const buf = Buffer.from(inline, 'base64');
      if (!buf.length) { stats.skipped_empty++; continue; }

      // 2b. Deterministic object path keyed by row id (re-tick-safe).
      const datePart   = new Date(row.created_at || Date.now()).toISOString().slice(0, 10);
      const safeName   = artifactOffloadSafeName(row.file_name, row.mime_type);
      const objectPath = `${datePart}/${row.id}-${safeName}`;
      const fullPath   = `${bucket}/${objectPath}`;
      const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');

      // 2c. Upload to Storage with the service key (x-upsert so re-ticks are safe).
      const upRes = await fetchWithTimeout(
        `${opsUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
        {
          method: 'POST',
          headers: {
            'apikey':        opsKey,
            'Authorization': `Bearer ${opsKey}`,
            'Content-Type':  row.mime_type || 'application/octet-stream',
            'x-upsert':      'true',
          },
          body: buf,
        },
        9000,
      );
      if (!upRes.ok) {
        const detail = await upRes.text();
        stats.errored++;
        failures.push({ id: row.id, status: upRes.status, detail: detail.slice(0, 200) });
        continue;
      }

      // 2d. Point the row at Storage and drop the inline copy. Guard the
      //     UPDATE on storage_path IS NULL so we never clobber a concurrent
      //     writer, and so a re-tick is a no-op once done.
      const patchRes = await opsQuery('PATCH',
        `staged_intake_artifacts?id=eq.${pgFilterVal(row.id)}&storage_path=is.null`,
        { storage_path: fullPath, inline_data: null },
        { headers: { Prefer: 'return=minimal' } });
      if (!patchRes.ok) {
        stats.errored++;
        failures.push({ id: row.id, status: patchRes.status, detail: 'patch_failed' });
        continue;
      }

      stats.offloaded++;
      stats.bytes_freed += buf.length;
    } catch (err) {
      stats.errored++;
      failures.push({ id: row.id, detail: err?.message?.slice(0, 200) });
    }
  }

  return res.status(200).json({
    mode:          'offload',
    bucket,
    grace_minutes: graceMinutes,
    eligible_total: listRes.count,
    ...stats,
    bytes_freed_pretty: `${(stats.bytes_freed / 1024 / 1024).toFixed(1)} MB`,
    failures: failures.slice(0, 20),
  });
}


// ============================================================================
// DIA AUTO-LINKER PROVENANCE REPLAY (FU6 — 2026-04-29)
// ============================================================================
//
// The dia auto-linker functions (auto_link_exact_address_singletons,
// auto_link_high_confidence_property_candidates, etc.) write to
// dia.public.research_queue_outcomes with `source_name`, `selected_property_id`,
// and `clinic_id`, then call apply_property_link_outcome() which UPDATEs:
//   - properties.medicare_id   = clinic_id
//   - medicare_clinics.property_id = property_id
//
// Both UPDATEs happen in the dialysis DB; LCC Opps' field_provenance never
// observes them. The 13 priority rules registered in PR #484 stay forever
// scaffolding-without-signal. This handler closes the loop by polling
// dia.research_queue_outcomes since a watermark and replaying each as
// lcc_merge_field calls so the audit trail catches up.
//
// Source attribution comes verbatim from research_queue_outcomes.source_name
// (manual_verify, auto_link_high_confidence, auto_link_exact_singleton,
// auto_link_orphan_property, auto_relink_misrouted_lease, auto_stub_from_clinic).
// source_run_id maps to the outcome row's source_run_id when present, else
// falls back to a derived 'replay:<outcome_id>' tag.
//
// Idempotent under repeated calls: watermark advances only on success, and
// lcc_merge_field's append-only append-with-decision semantics tolerate
// re-replays without corrupting prior history.

async function handleDiaLinkProvenanceReplay(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '200', 10)));

  // 1. Read watermark.
  const wmRes = await opsQuery(
    'GET',
    'dia_link_provenance_watermark?singleton=eq.true&select=last_outcome_id'
  );
  if (!wmRes.ok) {
    return res.status(500).json({ error: 'watermark fetch failed', detail: wmRes.data });
  }
  const lastOutcomeId = Array.isArray(wmRes.data) && wmRes.data.length
    ? Number(wmRes.data[0].last_outcome_id || 0)
    : 0;

  // 2. Pull the next batch of outcomes from dia. PK column is `outcome_id`
  // on dia.research_queue_outcomes (not `id` — verified against live schema).
  const outcomeRes = await domainQuery(
    'dialysis',
    'GET',
    `research_queue_outcomes?queue_type=eq.property_review` +
    `&status=eq.approved_link` +
    `&outcome_id=gt.${lastOutcomeId}` +
    `&order=outcome_id.asc&limit=${limit}` +
    `&select=outcome_id,clinic_id,selected_property_id,source_name,source_run_id,assigned_at`
  );
  if (!outcomeRes.ok) {
    return res.status(502).json({ error: 'dia outcome fetch failed', detail: outcomeRes.data });
  }
  const outcomes = Array.isArray(outcomeRes.data) ? outcomeRes.data : [];

  if (outcomes.length === 0) {
    return res.status(200).json({
      mode:    dryRun ? 'dry_run' : 'apply',
      from_id: lastOutcomeId,
      to_id:   lastOutcomeId,
      replayed: 0,
      message: 'no new outcomes since watermark',
    });
  }

  // 3. For each outcome, dispatch the lcc_merge_field calls.
  // Confidence: manual_verify gets 1.0; auto-* gets 0.85 (lower-trust than
  // a human verify but higher than aggregator-quality).
  const results = { replayed: 0, failed: 0, by_source: {} };
  const merges = [];
  for (const o of outcomes) {
    if (!o.clinic_id || !o.selected_property_id || !o.source_name) continue;
    const source     = o.source_name;
    const confidence = source === 'manual_verify' ? 1.0 : 0.85;
    const runId      = o.source_run_id ? `${source}:${o.source_run_id}` : `replay:${o.outcome_id}`;

    // Two writes per outcome: properties.medicare_id and
    // medicare_clinics.property_id. lcc_merge_field's parameter prefix
    // is `p_*` (verified against pg_proc); PostgREST RPC matches arg
    // names exactly so the prefix matters.
    merges.push({
      p_workspace_id:    null,
      p_target_database: 'dia_db',
      p_target_table:    'dia.properties',
      p_record_pk:       String(o.selected_property_id),
      p_field_name:      'medicare_id',
      p_value:           o.clinic_id,
      p_source:          source,
      p_source_run_id:   runId,
      p_confidence:      confidence,
      p_recorded_by:     null,
    });
    merges.push({
      p_workspace_id:    null,
      p_target_database: 'dia_db',
      p_target_table:    'dia.medicare_clinics',
      p_record_pk:       String(o.clinic_id),
      p_field_name:      'property_id',
      p_value:           o.selected_property_id,
      p_source:          source,
      p_source_run_id:   runId,
      p_confidence:      confidence,
      p_recorded_by:     null,
    });
    results.by_source[source] = (results.by_source[source] || 0) + 1;
  }

  if (dryRun) {
    return res.status(200).json({
      mode:    'dry_run',
      from_id: lastOutcomeId,
      to_id:   outcomes[outcomes.length - 1].outcome_id,
      outcomes: outcomes.length,
      merge_calls_planned: merges.length,
      by_source: results.by_source,
    });
  }

  // 4. Fire the merges in parallel batches. Best-effort: a single failure
  // doesn't block the batch. Vercel hobby has a 10s wall budget; sequential
  // dispatch of 400 RPC calls (200 outcomes × 2 fields) at 20-50ms each
  // would be 8-20s, risking timeout. Parallel via Promise.allSettled keeps
  // wall time bounded by the slowest call (typically <500ms).
  const settled = await Promise.allSettled(
    merges.map(args =>
      opsQuery('POST', 'rpc/lcc_merge_field', args)
        .then(r => (r?.ok ? 'replayed' : 'failed'))
        .catch(() => 'failed')
    )
  );
  for (const r of settled) {
    const value = r.status === 'fulfilled' ? r.value : 'failed';
    if (value === 'replayed') results.replayed++;
    else                       results.failed++;
  }

  // 5. Advance watermark only if the entire batch dispatched (replayed +
  // failed equals merges.length — both are terminal states; failures stay
  // failed but the watermark moves so we don't replay them forever).
  const newWatermark = outcomes[outcomes.length - 1].outcome_id;
  await opsQuery(
    'PATCH',
    'dia_link_provenance_watermark?singleton=eq.true',
    { last_outcome_id: newWatermark, last_run_at: new Date().toISOString() }
  );

  return res.status(200).json({
    mode:     'apply',
    from_id:  lastOutcomeId,
    to_id:    newWatermark,
    outcomes: outcomes.length,
    replayed: results.replayed,
    failed:   results.failed,
    by_source: results.by_source,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Round 76ek.j Phase 2 — LLC research worker.
//
// Drains the per-domain `llc_research_queue` table populated by the
// upsertDomainOwners writer hook. For each queued row, calls lookupLlc()
// (which today routes to OpenCorporates when OPENCORPORATES_API_KEY is set,
// otherwise no-ops) and writes the enrichment back to recorded_owners +
// the queue row.
//
// GET  → dry-run; reports what WOULD be looked up but does no API calls
//        and no DB writes. Useful for sanity-checking the queue.
// POST → live; processes up to `limit` queued rows.
//
// Query params:
//   domain  = 'dia' | 'gov' | 'both' (default 'both')
//   limit   = max rows per domain per tick (default 10, max 50)
//
// The handler is idempotent and safe to retry — queue rows are stamped
// status='in_progress' before lookup and 'done'/'failed'/'no_match'/
// 'unsupported_state' after, and the UNIQUE(recorded_owner_id) constraint
// on the queue blocks duplicate inserts.
// ────────────────────────────────────────────────────────────────────────────
async function handleLlcResearchTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const domainParam = String(req.query.domain || 'both').toLowerCase();
  if (!['dia', 'gov', 'both'].includes(domainParam)) {
    return res.status(400).json({ error: 'domain must be dia, gov, or both' });
  }
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10)));
  const dryRun = req.method === 'GET';

  const targets = domainParam === 'both' ? ['dia', 'gov'] : [domainParam];
  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    handler_configured: !!process.env.OPENCORPORATES_API_KEY,
    scanned: 0,
    enriched: 0,
    no_match: 0,
    unsupported_state: 0,
    failed: 0,
    by_domain: {},
  };

  for (const target of targets) {
    const dom = target === 'dia' ? 'dialysis' : 'government';
    const summary = { scanned: 0, enriched: 0, no_match: 0, unsupported_state: 0, failed: 0, items: [] };

    // Reclaim (2026-05-31): rows can strand in 'in_progress' when a prior tick
    // hit the function wall-clock limit after marking them but before the
    // lookup/reset ran. Since the work fetch only pulls status=queued, those
    // rows would never retry — the queue silently bleeds into a dead state
    // (observed: 50 -> 200+ stuck per domain). Reset any in_progress row whose
    // last_attempt_at is older than the stale window back to queued so it
    // re-enters the working set. Window via LLC_INPROGRESS_STALE_MIN (default 15).
    const _staleMin = parseInt(process.env.LLC_INPROGRESS_STALE_MIN || '15', 10);
    const _staleCut = new Date(Date.now() - _staleMin * 60000).toISOString();
    // Hard dead-letter cap (2026-06-07): a row that has burned through this many
    // attempts and is still stranded in_progress is parked 'dead' (terminal,
    // never reclaimed) instead of cycling forever — backoff so one permanently-
    // failing row can't flood ingest_write_failures (the 23514 storm signature).
    const _maxAttempts = parseInt(process.env.LLC_MAX_ATTEMPTS || '8', 10);
    try {
      // 1a. Dead-letter the truly-stuck: stale in_progress AND over the cap.
      const dead = await domainQuery(dom, 'PATCH',
        `llc_research_queue?status=eq.in_progress&last_attempt_at=lt.${_staleCut}&attempts=gte.${_maxAttempts}`,
        { status: 'dead', last_error: 'max_attempts_exhausted', resolved_at: new Date().toISOString() },
        { 'Prefer': 'return=representation,count=exact' });
      if (dead && dead.ok) {
        const n = dead.count || (Array.isArray(dead.data) ? dead.data.length : 0);
        if (n) { summary.dead_lettered = n; result.dead_lettered = (result.dead_lettered || 0) + n; }
        // R8: funnel each dead-lettered row into the Decision Center
        // (llc_research_dead lane) so capped dead work stays VISIBLE instead of
        // dying silently. Idempotent on subject_ref; best-effort (a failed emit
        // never fails the tick). The verdict (retry/resolve_manually/park)
        // closes the decision.
        if (Array.isArray(dead.data)) {
          for (const row of dead.data) {
            try {
              await opsQuery('POST', 'rpc/lcc_open_decision', {
                p_decision_type: 'llc_research_dead',
                p_workspace_id: null,
                p_question: 'Automated LLC research dead-lettered — resolve manually, retry, or park.',
                p_context: { domain: target, queue_id: row.queue_id, recorded_owner_id: row.recorded_owner_id,
                  property_id: row.property_id, search_name: row.search_name, guessed_state: row.guessed_state,
                  attempts: row.attempts, last_error: row.last_error },
                p_subject_domain: target,
                p_subject_ref: 'llc_dead:' + target + ':' + row.queue_id,
                p_rank_value: row.attempts != null ? Number(row.attempts) : null,
              });
            } catch (_e) { /* best-effort funnel — never fail the tick */ }
          }
        }
      }
      // 1b. Reclaim the rest (under the cap) back to queued.
      const reclaimed = await domainQuery(dom, 'PATCH',
        `llc_research_queue?status=eq.in_progress&last_attempt_at=lt.${_staleCut}&attempts=lt.${_maxAttempts}`,
        { status: 'queued' }, { 'Prefer': 'return=representation,count=exact' });
      if (reclaimed && reclaimed.ok) {
        const n = reclaimed.count || (Array.isArray(reclaimed.data) ? reclaimed.data.length : 0);
        if (n) { summary.reclaimed = n; result.reclaimed = (result.reclaimed || 0) + n; }
      }
    } catch (_e) { /* non-fatal: reclaim is best-effort */ }

    // Pull queued rows. Sort by created_at so older entries get drained first.
    const queueRes = await domainQuery(dom, 'GET',
      `llc_research_queue?status=eq.queued` +
      `&select=queue_id,recorded_owner_id,property_id,search_name,guessed_state,attempts` +
      `&order=created_at.asc&limit=${limit}`
    );
    if (!queueRes.ok) {
      summary.error = { stage: 'list', status: queueRes.status, detail: queueRes.data };
      result.by_domain[dom] = summary;
      continue;
    }
    const queued = Array.isArray(queueRes.data) ? queueRes.data : [];
    summary.scanned = queued.length;
    result.scanned += queued.length;

    if (queued.length === 0 || dryRun) {
      summary.items = queued.map(q => ({
        queue_id: q.queue_id,
        search_name: q.search_name,
        guessed_state: q.guessed_state,
      }));
      result.by_domain[dom] = summary;
      continue;
    }

    // Time budget (2026-05-31): stop before the function wall-clock limit so we
    // never leave a half-processed batch stranded in_progress. LLC_TICK_BUDGET_MS
    // default 20s (Vercel/Railway ~30s ceiling).
    const _tickDeadline = Date.now() + parseInt(process.env.LLC_TICK_BUDGET_MS || '20000', 10);
    for (const q of queued) {
      if (Date.now() > _tickDeadline) { summary.budget_stopped = true; break; }
      const item = { queue_id: q.queue_id, search_name: q.search_name };
      try {
        // 1. Mark in_progress so concurrent ticks don't double-process.
        await domainQuery(dom, 'PATCH',
          `llc_research_queue?queue_id=eq.${q.queue_id}`,
          {
            status: 'in_progress',
            attempts: (q.attempts || 0) + 1,
            last_attempt_at: new Date().toISOString(),
          });

        // 2. Look up.
        const r = await lookupLlc({ name: q.search_name, state: q.guessed_state });

        // 3. Map result → terminal state.
        if (!r.found) {
          // Backoff (2026-05-31): when no handler is configured we used to
          // re-queue the row indefinitely, which let the head of the queue
          // (the oldest ~50 rows) cycle every tick and starve everything
          // behind it (some rows hit 400+ attempts while ~1,860 were never
          // reached). Now, after LLC_NO_HANDLER_ATTEMPT_CAP attempts on a
          // no_handler_configured result, park the row as 'deferred' so it
          // drops out of the status=queued working set. A later run (once a
          // handler/API key lands) can re-queue deferred rows in bulk.
          const LLC_NO_HANDLER_ATTEMPT_CAP = parseInt(process.env.LLC_NO_HANDLER_ATTEMPT_CAP || '3', 10);
          const attemptsNow = (q.attempts || 0) + 1;
          let status =
            r.reason === 'no_match'              ? 'no_match' :
            r.reason === 'unsupported_state'     ? 'unsupported_state' :
            r.reason === 'no_handler_configured'
              ? (attemptsNow >= LLC_NO_HANDLER_ATTEMPT_CAP ? 'deferred' : 'queued') :
                                                   'failed';
          const isReQueue = (status === 'queued');
          await domainQuery(dom, 'PATCH',
            `llc_research_queue?queue_id=eq.${q.queue_id}`,
            {
              status,
              last_error: r.reason || 'unknown',
              resolved_at: isReQueue ? null : new Date().toISOString(),
            });
          item.outcome = status;
          // 'deferred' is a terminal-for-now state; count it like the other
          // non-resolving outcomes under failed so the tick summary is honest.
          const bucket = isReQueue ? 'failed' : (status === 'deferred' ? 'failed' : status);
          summary[bucket] = (summary[bucket] || 0) + 1;
          if (bucket === 'failed') result.failed += 1;
          else result[bucket] += 1;
          continue;
        }

        // 4. Found: write enrichment to recorded_owners. dia uses
        //    state_of_incorporation; gov uses filing_state.
        const isGov = dom === 'government';
        const stateCol = isGov ? 'filing_state' : 'state_of_incorporation';
        const ownerPatch = stripNullsLocal({
          [stateCol]:               r.filing_state,
          filing_id:                r.filing_id,
          filing_date:              r.filing_date,
          filing_status:            r.filing_status,
          registered_agent_name:    r.registered_agent_name,
          registered_agent_address: r.registered_agent_address,
          manager_name:             r.manager_name,
          manager_role:             r.manager_role,
          llc_research_at:          new Date().toISOString(),
          llc_research_source:      r.source,
        });
        await domainQuery(dom, 'PATCH',
          `recorded_owners?recorded_owner_id=eq.${q.recorded_owner_id}`,
          ownerPatch);

        // 5. Mark queue row done.
        await domainQuery(dom, 'PATCH',
          `llc_research_queue?queue_id=eq.${q.queue_id}`,
          {
            status: 'done',
            found_filing_id: r.filing_id || null,
            found_filing_state: r.filing_state || null,
            enrichment_payload: r.payload || null,
            resolved_at: new Date().toISOString(),
            last_error: null,
          });

        item.outcome = 'enriched';
        item.filing_state = r.filing_state;
        item.filing_status = r.filing_status;
        summary.enriched += 1;
        result.enriched += 1;
      } catch (err) {
        // Network / parse failures land here. Mark failed but keep the row
        // so a future tick can retry — attempts column tracks the retry
        // count for visibility.
        await domainQuery(dom, 'PATCH',
          `llc_research_queue?queue_id=eq.${q.queue_id}`,
          {
            status: 'failed',
            last_error: String(err?.message || err).slice(0, 500),
          });
        item.outcome = 'error';
        item.error = err?.message || String(err);
        summary.failed += 1;
        result.failed += 1;
      }
      summary.items.push(item);
    }

    result.by_domain[dom] = summary;
  }

  return res.status(200).json(result);
}

// ============================================================================
// INTAKE-REMATCH (2026-06-04)
// ============================================================================
//
// GET/POST /api/intake-rematch?limit=100&workspace_id=<uuid>
//   Retro-processes the review_required intake "purgatory pile". A 2026-06-04
//   forensic found the bulk of review_required OM intakes with an extracted
//   address were unmatched purely on street normalization (N vs North, Ave vs
//   Avenue) — the property already existed. With the matcher's canonical
//   normalization + multi-address split + cross-domain fallback now in place,
//   this worker re-runs the improved match over the backlog and, on a hit,
//   re-runs the EXISTING promotion path (runDownstreamPipeline) so the intake
//   advances to matched/finalized exactly as a fresh intake would.
//
//   GET  = dry-run (counts only, no writes, no status changes).
//   POST = drain  (re-match + promote, batch-limited, idempotent).
//
//   Idempotent: matched rows leave the review_required set; rows that stay
//   unmatched are stamped raw_payload.rematch.last_at and skipped for
//   REMATCH_COOLDOWN_HOURS (default 168h) so the cron doesn't re-grind the
//   same misses every tick. Promotion itself is idempotent (upsert keyed on
//   source_listing_ref = intake_id).
//
//   Mirrors the llc-research-tick worker pattern (GET dry-run / POST drain,
//   time-budgeted, batch-limited). Scheduled by pg_cron every 30 min.
// ============================================================================
async function handleIntakeRematch(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10)));
  const dryRun = req.method === 'GET';
  const cooldownHours = Math.max(0, parseInt(process.env.REMATCH_COOLDOWN_HOURS || '168', 10));
  const cooldownCut = new Date(Date.now() - cooldownHours * 3600 * 1000).toISOString();
  const workspaceId = req.query.workspace_id
    || req.headers['x-lcc-workspace']
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;

  // Guarded AUTO create-from-intake (2026-06-04). Default OFF. When
  // INTAKE_AUTOCREATE=1, the worker auto-creates a property for items that have
  // already been rematched once (cooldown stamp present), still don't match,
  // carry a full deal signature (address+tenant+asking_price), parse to a real
  // state, and classify as a listing doc. Capped per tick.
  const autoEnabled = process.env.INTAKE_AUTOCREATE === '1';
  const autoCap = Math.max(0, parseInt(process.env.INTAKE_AUTOCREATE_CAP || '10', 10));
  let autoCreatedThisTick = 0;

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    scanned: 0,
    eligible: 0,
    rematched: 0,
    newly_matched: 0,
    promoted: 0,
    still_unmatched: 0,
    skipped_no_address: 0,
    skipped_cooldown: 0,
    // Disposition pass (2026-06-04):
    dispositioned_non_deal: 0,   // no-address non-deal → discarded
    flagged_ocr_needed: 0,       // zero-text PDF → review + ocr_needed flag
    auto_create_enabled: autoEnabled,
    auto_created: 0,
    auto_promoted: 0,
    errored: 0,
    items: [],
  };

  // Pull a generous candidate window — we filter out cooldown'd + no-address
  // rows in JS, so fetch more than `limit` to keep each tick productive.
  const fetchLimit = Math.min(1000, limit * 4);
  const listRes = await opsQuery('GET',
    `staged_intake_items?status=eq.review_required` +
    `&select=intake_id,workspace_id,raw_payload,created_at` +
    `&order=created_at.asc&limit=${fetchLimit}`
  );
  if (!listRes.ok) {
    return res.status(502).json({ error: 'list_failed', detail: listRes.data });
  }
  const rows = Array.isArray(listRes.data) ? listRes.data : [];
  result.scanned = rows.length;

  // Time budget so we never strand a half-processed batch (Vercel/Railway wall).
  const tickDeadline = Date.now() + parseInt(process.env.REMATCH_TICK_BUDGET_MS || '22000', 10);

  let processed = 0;
  for (const row of rows) {
    if (processed >= limit) break;
    if (Date.now() > tickDeadline) { result.budget_stopped = true; break; }

    const intakeId = row.intake_id;
    const payload = row.raw_payload || {};
    const ext = payload.extraction_result || {};
    // Eligible = has an extracted address (single or multi).
    const hasAddress = !!(ext.address || (Array.isArray(ext.addresses) && ext.addresses.length));

    // ---- Disposition pass (2026-06-04) -------------------------------------
    // Drain the no-address pile that will never match/promote, and rescue
    // zero-text PDFs that parked as all-null review rows. Runs before the
    // rematch eligibility so non-deal newsletters stop being re-ground.
    const alreadyFlaggedOcr = payload.extraction_quality === 'ocr_needed';
    const diags = Array.isArray(ext.diagnostics) ? ext.diagnostics : [];
    const zeroTextPdf = !alreadyFlaggedOcr && diags.some(d =>
      (String(d.mime_type || '').toLowerCase() === 'application/pdf'
        || /\.pdf$/i.test(d.file_name || ''))
      && d.pdf_text_len === 0 && !d.pdf_parse_error && !d.ocr_ok
    );
    if (zeroTextPdf) {
      // Scanned/image PDF — flag it so it surfaces in triage instead of hiding
      // among newsletters; keep it in review (a human or the ocr-reextract
      // route rescues it). Never discard a real OM scan.
      result.flagged_ocr_needed += 1;
      if (!dryRun) {
        await opsQuery('PATCH',
          `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
          { raw_payload: { ...payload, extraction_quality: 'ocr_needed' } }
        ).catch(() => {});
      }
      if (result.items.length < 100) result.items.push({ intake_id: intakeId, action: 'flagged_ocr_needed' });
      continue;
    }
    if (!alreadyFlaggedOcr && isNonDealSnapshot({
      document_type: ext.document_type,
      address:       ext.address,
      addresses:     ext.addresses,
      asking_price:  ext.asking_price,
      cap_rate:      ext.cap_rate,
      tenant_name:   ext.tenant_name,
    })) {
      // Newsletter / broker blast / thread history — no address, no price, no
      // cap, non-listing doctype. Soft-disposition to 'discarded' (status +
      // reason, never delete; reversible by re-running extraction).
      result.dispositioned_non_deal += 1;
      if (!dryRun) {
        await opsQuery('PATCH',
          `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
          { status: 'discarded',
            raw_payload: { ...payload, discard_reason: 'non_deal_no_address' },
            updated_at: new Date().toISOString() }
        ).catch(() => {});
        // Drain the triage view too (best-effort).
        await opsQuery('PATCH',
          `inbox_items?id=eq.${encodeURIComponent(intakeId)}`, { status: 'dismissed' }
        ).catch(() => {});
      }
      if (result.items.length < 100) result.items.push({ intake_id: intakeId, action: 'discarded_non_deal' });
      continue;
    }

    if (!hasAddress) { result.skipped_no_address += 1; continue; }

    // Cooldown: skip rows we already re-matched recently and that stayed
    // unmatched — but this is exactly the set the guarded AUTO create acts on
    // (previously attempted, still unmatched).
    const lastAt = payload.rematch?.last_at || null;
    if (lastAt && lastAt > cooldownCut) {
      result.skipped_cooldown += 1;
      if (!dryRun && autoEnabled && autoCreatedThisTick < autoCap && payload.autocreated == null) {
        const sig = {
          document_type:    ext.document_type,
          address:          ext.address,
          addresses:        ext.addresses,
          tenant_name:      ext.tenant_name,
          asking_price:     ext.asking_price,
          cap_rate:         ext.cap_rate,
          building_sf:      ext.building_sf,
          lease_expiration: ext.lease_expiration,
        };
        const dt = normalizeDocType(ext.document_type || '');
        const docOk = LISTING_DOCUMENT_TYPES.has(dt) || snapshotLooksLikeListing(sig);
        const stateOk = !!normalizeState(ext.state);
        if (hasFullDealSignature(sig) && docOk && stateOk) {
          autoCreatedThisTick += 1;
          try {
            const cr = await createPropertyFromIntake(intakeId, {
              workspaceId: row.workspace_id || workspaceId,
              actorId: user.id,
              trigger: 'auto',
            });
            result.auto_created += 1;
            if (cr?.matched && cr?.promotion_result?.ok) result.auto_promoted += 1;
            if (result.items.length < 100) {
              result.items.push({ intake_id: intakeId, action: 'auto_created',
                ok: cr?.ok ?? null, matched: cr?.matched ?? null,
                created: (cr?.created || []).filter(c => c.ok).length });
            }
          } catch (err) {
            result.errored += 1;
            if (result.items.length < 100) {
              result.items.push({ intake_id: intakeId, action: 'auto_create_error',
                error: String(err?.message || err).slice(0, 200) });
            }
          }
        }
      }
      continue;
    }

    result.eligible += 1;
    if (dryRun) {
      if (result.items.length < 50) {
        result.items.push({
          intake_id: intakeId,
          address: ext.address || (Array.isArray(ext.addresses) ? ext.addresses[0] : null),
          city: ext.city || null,
          state: ext.state || null,
          tenant: ext.tenant_name || null,
        });
      }
      continue;
    }

    processed += 1;
    const item = { intake_id: intakeId };
    try {
      // Fetch the FULL extraction snapshot (carries city/state/addresses[] etc.)
      // — the persisted summary is a trimmed view.
      const exRes = await opsQuery('GET',
        `staged_intake_extractions?intake_id=eq.${encodeURIComponent(intakeId)}` +
        `&select=extraction_snapshot&order=created_at.desc&limit=1`
      );
      const snapshot = (exRes.ok && Array.isArray(exRes.data) && exRes.data.length)
        ? exRes.data[0].extraction_snapshot
        : null;
      if (!snapshot || typeof snapshot !== 'object') {
        // No stored snapshot — fall back to the trimmed summary so the matcher
        // still has address/city/state/tenant to work with.
        item.outcome = 'no_snapshot_used_summary';
      }
      const effectiveSnapshot = (snapshot && typeof snapshot === 'object')
        ? snapshot
        : {
            address: ext.address || null,
            addresses: Array.isArray(ext.addresses) ? ext.addresses : null,
            city: ext.city || null,
            state: ext.state || null,
            tenant_name: ext.tenant_name || null,
            document_type: ext.document_type || null,
          };

      // Re-run the EXACT downstream pipeline a fresh intake uses: improved
      // matcher → promoter → inbox link → status advance. Reusing the
      // pipeline's own function keeps promotion behavior identical.
      const downstream = await runDownstreamPipeline(intakeId, effectiveSnapshot, {
        workspaceId: row.workspace_id || workspaceId,
        actorId: user.id,
        seedData: payload.seed_data || null,
      });

      result.rematched += 1;
      const mr = downstream?.match_result || null;
      const matched = mr?.status === 'matched' && mr?.property_id != null;
      item.match_status = mr?.status || 'unknown';
      item.domain = mr?.domain || null;
      item.property_id = mr?.property_id != null ? String(mr.property_id) : null;
      item.reason = mr?.reason || null;
      if (mr?.matched_count != null) item.matched_count = mr.matched_count;

      if (matched) {
        result.newly_matched += 1;
        if (downstream?.promotion_result?.ok) result.promoted += 1;
        item.promotion_ok = downstream?.promotion_result?.ok ?? null;
      } else {
        result.still_unmatched += 1;
      }

      // Stamp the cooldown marker so a still-unmatched row drops out of the
      // working set for REMATCH_COOLDOWN_HOURS. (Matched rows already left
      // review_required via the matcher's status patch.)
      try {
        const cur = await opsQuery('GET',
          `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}&select=raw_payload&limit=1`
        );
        const curPayload = cur.ok && cur.data?.length ? (cur.data[0].raw_payload || {}) : payload;
        await opsQuery('PATCH',
          `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
          {
            raw_payload: {
              ...curPayload,
              rematch: {
                last_at: new Date().toISOString(),
                outcome: matched ? 'matched' : 'unmatched',
                attempts: (curPayload.rematch?.attempts || 0) + 1,
              },
            },
          }
        );
      } catch (_e) { /* stamp is best-effort */ }
    } catch (err) {
      result.errored += 1;
      item.error = String(err?.message || err).slice(0, 300);
    }
    if (result.items.length < 100) result.items.push(item);
  }

  return res.status(200).json(result);
}

// ============================================================================
// SF-LINK-TICK (A7, 2026-05-27)
// ============================================================================
//
// GET/POST /api/sf-link-tick
//   Drains the per-domain `sf_link_research_queue` populated by the A7
//   one-shot backfill. For each row, calls findSalesforceAccountByName
//   (Power Automate flow proxy) and applies the result:
//     - score >= 0.90 → auto-link, status='linked', PATCH the source row
//     - 0.50 <= score < 0.90 → status='needs_review', candidate stored on
//       the queue row (no source-table write — human triages later)
//     - reason='no_match' / 'no_good_match' → status='no_match'
//     - reason='sf_not_configured' → leave 'queued' for a future tick
//     - other errors → status='failed', kept for retry
//
// Mirror of handleLlcResearchTick (Round 76ek.j Phase 2). GET = dry-run.
// ============================================================================
async function handleSfLinkTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const domainParam = String(req.query.domain || 'both').toLowerCase();
  if (!['dia', 'gov', 'both'].includes(domainParam)) {
    return res.status(400).json({ error: 'domain must be dia, gov, or both' });
  }
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10)));
  const dryRun = req.method === 'GET';

  const targets = domainParam === 'both' ? ['dia', 'gov'] : [domainParam];
  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    handler_configured: isSalesforceConfigured(),
    scanned: 0,
    linked: 0,
    needs_review: 0,
    no_match: 0,
    failed: 0,
    by_domain: {},
  };

  for (const target of targets) {
    const dom = target === 'dia' ? 'dialysis' : 'government';
    const summary = { scanned: 0, linked: 0, needs_review: 0, no_match: 0, failed: 0, items: [] };

    const queueRes = await domainQuery(dom, 'GET',
      'sf_link_research_queue?status=eq.queued' +
      '&select=queue_id,source_table,source_id,owner_name,canonical_name,state,property_count,attempts' +
      `&order=priority_score.desc,created_at.asc&limit=${limit}`
    );
    if (!queueRes.ok) {
      summary.error = { stage: 'list', status: queueRes.status, detail: queueRes.data };
      result.by_domain[dom] = summary;
      continue;
    }
    const queued = Array.isArray(queueRes.data) ? queueRes.data : [];
    summary.scanned = queued.length;
    result.scanned += queued.length;

    if (queued.length === 0 || dryRun) {
      summary.items = queued.map(q => ({
        queue_id: q.queue_id,
        source_table: q.source_table,
        owner_name: q.owner_name,
        canonical_name: q.canonical_name,
        property_count: q.property_count,
      }));
      result.by_domain[dom] = summary;
      continue;
    }

    for (const q of queued) {
      const item = {
        queue_id: q.queue_id,
        source_table: q.source_table,
        owner_name: q.owner_name,
      };
      try {
        // 1. Mark in_progress.
        await domainQuery(dom, 'PATCH',
          `sf_link_research_queue?queue_id=eq.${q.queue_id}`,
          {
            status: 'in_progress',
            attempts: (q.attempts || 0) + 1,
            last_attempted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

        // 2. SF lookup. Uses the existing PA flow proxy.
        const r = await findSalesforceAccountByName(q.canonical_name);

        // 3. Map to terminal state.
        if (!r.ok) {
          // SF not configured OR PA flow returned error/timeout.
          const status = r.reason === 'sf_not_configured' ? 'queued' : 'failed';
          await domainQuery(dom, 'PATCH',
            `sf_link_research_queue?queue_id=eq.${q.queue_id}`,
            {
              status,
              last_error: r.reason || 'unknown',
              resolved_at: status === 'queued' ? null : new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          item.outcome = status;
          if (status === 'queued') {
            // Treated as not-yet-processed; counted as failed for telemetry
            // but stays in the pool for the next tick after the env lands.
            summary.failed += 1;
            result.failed += 1;
          } else {
            summary.failed += 1;
            result.failed += 1;
          }
          item.reason = r.reason;
          summary.items.push(item);
          continue;
        }

        if (!r.account) {
          // SF responded but no candidate met the 0.50 threshold.
          await domainQuery(dom, 'PATCH',
            `sf_link_research_queue?queue_id=eq.${q.queue_id}`,
            {
              status: 'no_match',
              last_error: r.reason || null,
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              sf_account_name_resolved: r.best_candidate_name || null,
              score_resolved:           r.best_candidate_score ?? null,
            });
          item.outcome = 'no_match';
          summary.no_match += 1;
          result.no_match += 1;
          summary.items.push(item);
          continue;
        }

        const score    = Number(r.score) || 0;
        const acctId   = r.account.Id;
        const acctName = r.account.Name;

        // 4a. score >= 0.90 → auto-link.
        if (score >= 0.90) {
          // Domain + source-table specific PATCH targets.
          const isGov = dom === 'government';
          let targetTable, targetCol, patchBody;
          if (q.source_table === 'true_owners') {
            targetTable = 'true_owners';
            targetCol   = 'true_owner_id';
            patchBody = isGov
              ? { sf_account_id: acctId, sf_last_synced: new Date().toISOString() }
              : { sf_company_id: acctId };
          } else { // recorded_owners (gov only — dia.recorded_owners has no SF col)
            targetTable = 'recorded_owners';
            targetCol   = 'recorded_owner_id';
            patchBody = isGov
              ? { sf_account_id: acctId, sf_last_synced: new Date().toISOString() }
              : null;
          }

          if (patchBody) {
            await domainQuery(dom, 'PATCH',
              `${targetTable}?${targetCol}=eq.${q.source_id}`,
              patchBody);
          }

          await domainQuery(dom, 'PATCH',
            `sf_link_research_queue?queue_id=eq.${q.queue_id}`,
            {
              status: 'linked',
              sf_account_id_resolved:   acctId,
              sf_account_name_resolved: acctName,
              score_resolved:           score,
              resolved_at:              new Date().toISOString(),
              updated_at:               new Date().toISOString(),
              last_error:               null,
            });
          item.outcome    = 'linked';
          item.sf_account = acctId;
          item.score      = score;
          summary.linked += 1;
          result.linked += 1;
        }
        // 4b. 0.50 <= score < 0.90 → human triage.
        else if (score >= 0.50) {
          await domainQuery(dom, 'PATCH',
            `sf_link_research_queue?queue_id=eq.${q.queue_id}`,
            {
              status: 'needs_review',
              sf_account_id_resolved:   acctId,
              sf_account_name_resolved: acctName,
              score_resolved:           score,
              resolved_at:              new Date().toISOString(),
              updated_at:               new Date().toISOString(),
              last_error:               null,
            });
          item.outcome    = 'needs_review';
          item.sf_account = acctId;
          item.score      = score;
          summary.needs_review += 1;
          result.needs_review += 1;
        }
        // 4c. < 0.50 → no_match (defensive; findSalesforceAccountByName
        // already returns account=null below 0.50, so this branch is rare).
        else {
          await domainQuery(dom, 'PATCH',
            `sf_link_research_queue?queue_id=eq.${q.queue_id}`,
            {
              status: 'no_match',
              sf_account_name_resolved: acctName,
              score_resolved:           score,
              resolved_at:              new Date().toISOString(),
              updated_at:               new Date().toISOString(),
            });
          item.outcome = 'no_match';
          summary.no_match += 1;
          result.no_match += 1;
        }
      } catch (err) {
        await domainQuery(dom, 'PATCH',
          `sf_link_research_queue?queue_id=eq.${q.queue_id}`,
          {
            status: 'failed',
            last_error: String(err?.message || err).slice(0, 500),
            updated_at: new Date().toISOString(),
          });
        item.outcome = 'error';
        item.error = err?.message || String(err);
        summary.failed += 1;
        result.failed += 1;
      }
      summary.items.push(item);
    }

    result.by_domain[dom] = summary;
  }

  return res.status(200).json(result);
}

// ============================================================================
// NEXT-BEST-ACTION (Item #4 Phase B-2, 2026-05-17)
// ============================================================================
//
// GET /api/admin?_route=next-best-action
//   Query params:
//     domain      'dia' | 'gov' | 'both'   (default 'both')
//     limit       1-500                     (default 50)
//     offset      >= 0                      (default 0)
//     severity    'critical'|'high'|'medium'|'low'  (optional filter)
//     gap_type    exact match               (optional filter, e.g. 'missing_recorded_owner')
//
// Fans out in parallel to dia.v_next_best_action + gov.v_next_best_action,
// merges, globally re-ranks by gap_value DESC, applies offset + limit, and
// returns the unified ranked list tagged with source_domain per row.
//
// This is the cross-domain merge layer for the v_next_best_action surface
// built in Phase A (dia) + Phase B-1 (gov). The Phase C Home rail UI in
// app.js will call this single endpoint to render the merged queue.
//
// Closes the cross-domain merge half of audit finding B-1.
// Phase C (Home rail UI) and Phase B-3 (LCC Opps view for provenance
// conflicts + inbox triage + health alerts) are queued as follow-ups.
// ============================================================================
async function handleNextBestAction(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const domainParam = String(req.query.domain || 'both').toLowerCase();
  if (!['dia', 'gov', 'both'].includes(domainParam)) {
    return res.status(400).json({ error: "domain must be 'dia', 'gov', or 'both'" });
  }
  const limit  = Math.min(500, Math.max(1, parseInt(req.query.limit  || '50', 10)));
  const offset = Math.max(0,                parseInt(req.query.offset || '0', 10));
  const severityFilter = req.query.severity ? String(req.query.severity) : null;
  const gapTypeFilter  = req.query.gap_type ? String(req.query.gap_type) : null;
  if (severityFilter && !['critical','high','medium','low'].includes(severityFilter)) {
    return res.status(400).json({ error: "severity must be 'critical', 'high', 'medium', or 'low'" });
  }

  const targets = domainParam === 'both'
    ? ['dialysis', 'government']
    : domainParam === 'dia' ? ['dialysis'] : ['government'];

  // Fetch enough headroom from each domain so global re-rank can produce
  // an accurate offset+limit slice. We pull (offset + limit + 50) from each
  // side so the merged top-N is correct even when one domain dominates.
  const fetchLimit = Math.min(500, offset + limit + 50);

  const fanOutResults = await Promise.all(targets.map(async (dom) => {
    // Deal-value reconciliation (2026-05-21): gap_value is now the property
    // value (no gap-weight or completeness multipliers). Sort by
    // gap_priority_score so cross-domain merge respects the same weighted
    // ranking the view computes internally.
    let path = 'v_next_best_action?select=*'
             + '&order=gap_priority_score.desc.nullslast,first_seen_at.asc'
             + '&limit=' + fetchLimit;
    if (severityFilter) path += '&gap_severity=eq.' + encodeURIComponent(severityFilter);
    if (gapTypeFilter)  path += '&gap_type=eq.'      + encodeURIComponent(gapTypeFilter);

    const r = await domainQuery(dom, 'GET', path);
    if (!r.ok) {
      console.error('[next-best-action] ' + dom + ' query failed:', r.status, r.data);
      return { domain: dom, ok: false, rows: [], status: r.status, error: r.data };
    }
    const rows = Array.isArray(r.data) ? r.data : [];
    return {
      domain: dom,
      ok: true,
      rows: rows.map(row => ({ ...row, source_domain: dom })),
    };
  }));

  // Merge + global re-rank by gap_priority_score DESC, tiebreak first_seen_at
  // ASC. gap_value is now the unweighted property value (deal-value
  // reconciliation 2026-05-21); priority score is what governs ranking.
  // Fall back to gap_value if priority is missing (older view shape).
  const merged = [];
  for (const { rows } of fanOutResults) {
    for (const row of rows) merged.push(row);
  }

  // R4-D #5 (2026-06-05): magnitude plausibility guard. A dia row surfaced a
  // "$950M" gap_value (QA#1 aggregate-bleed class — a portfolio sale price bled
  // onto a single property and not yet auto-nulled). Such artifacts otherwise
  // rank #1 on a phantom value. Reuse the per-domain ceiling from
  // sidebar-pipeline.js::SALE_PRICE_BLEED_CEILING (mirrored here to avoid
  // importing the heavy handler module). This is a display-layer filter only —
  // no DB writes — so it never auto-nulls a legitimately large gov building.
  const NBA_VALUE_CEILING = { dialysis: 50000000, government: 250000000 };
  let suppressedImplausible = 0;
  const plausible = merged.filter(row => {
    const ceiling = NBA_VALUE_CEILING[row.source_domain] ?? NBA_VALUE_CEILING.government;
    const v = Number(row.gap_value);
    if (Number.isFinite(v) && v > ceiling) { suppressedImplausible++; return false; }
    return true;
  });

  plausible.sort((a, b) => {
    const av = Number(a.gap_priority_score ?? a.gap_value) || 0;
    const bv = Number(b.gap_priority_score ?? b.gap_value) || 0;
    if (av !== bv) return bv - av;
    return String(a.first_seen_at || '').localeCompare(String(b.first_seen_at || ''));
  });

  // R4-D #5 (2026-06-05): dedupe by (domain, property) BEFORE slicing so the
  // top-10 are 10 distinct items. v_next_best_action can emit several gap rows
  // for the same property (and join fan-out can duplicate exact rows), which is
  // why #6/#7/#9 were all the same gov property. Keep the highest-priority row
  // per property (the list is already sorted by priority). Rows without a
  // property_id fall back to a gap_type+label key so they aren't all collapsed.
  const seenKeys = new Set();
  const deduped = [];
  for (const row of plausible) {
    const key = row.property_id != null
      ? `${row.source_domain}:${row.property_id}`
      : `${row.source_domain}:nolabel:${row.gap_type || ''}:${row.gap_label || ''}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(row);
  }

  const items = deduped.slice(offset, offset + limit).map((row, idx) => ({
    // Hotfix (2026-05-17): spread row FIRST so the per-domain ROW_NUMBER()
    // rank from each v_next_best_action view doesn't clobber the merged
    // cross-domain rank below.
    ...row,
    rank: offset + idx + 1,
  }));

  const byDomain = {};
  for (const r of fanOutResults) {
    byDomain[r.domain] = r.ok
      ? { ok: true, fetched: r.rows.length }
      : { ok: false, status: r.status, error: r.error };
  }

  return res.status(200).json({
    ok:            true,
    // total_merged now reflects DISTINCT plausible open items (post dedupe +
    // magnitude guard) so the "N total open" UI count agrees with the list.
    total_merged:  deduped.length,
    total_raw:     merged.length,
    suppressed_implausible: suppressedImplausible,
    returned:      items.length,
    limit, offset,
    severity:      severityFilter,
    gap_type:      gapTypeFilter,
    by_domain:     byDomain,
    items,
  });
}

// ============================================================================
// CLIENT ERROR REPORT — Item #10 Phase B (2026-05-17)
//
// POST /api/admin?_route=client-error
//   Body: { batch: [<errorRecord>, ...] }
//
//   errorRecord: { label, tier, code?, message?, stack?, detail?,
//                  url?, user_agent?, occurred_at? }
//
// Fire-and-forget telemetry endpoint. Buffers browser-side errors
// captured by lccReportError into public.client_errors on LCC Opps.
// Never blocks the caller; returns 200 even on partial-insert errors
// so the client's flush loop doesn't churn on retries.
// ============================================================================
async function handleClientErrorReport(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const body = req.body || {};
  const batch = Array.isArray(body.batch) ? body.batch : [];
  if (batch.length === 0) {
    return res.status(200).json({ ok: true, inserted: 0, reason: 'empty_batch' });
  }
  // Cap batch size so a runaway client can't blast us.
  const capped = batch.slice(0, 50);

  const workspaceId = (req.headers['x-lcc-workspace'] || '').trim()
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;

  // Normalize records — clamp string lengths, validate tier, drop garbage.
  const ALLOWED_TIERS = new Set(['error', 'warn', 'info', 'ok']);
  const rows = capped.map(r => {
    if (!r || typeof r !== 'object') return null;
    const tier = typeof r.tier === 'string' && ALLOWED_TIERS.has(r.tier.toLowerCase())
      ? r.tier.toLowerCase()
      : 'error';
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 200) : null;
    if (!label) return null;
    return {
      workspace_id: workspaceId,
      user_email:   (user.email || r.user_email || null) ? String(user.email || r.user_email).slice(0, 200) : null,
      user_agent:   r.user_agent ? String(r.user_agent).slice(0, 500) : null,
      url:          r.url ? String(r.url).slice(0, 500) : null,
      label,
      tier,
      code:         r.code ? String(r.code).slice(0, 32) : null,
      message:      r.message ? String(r.message).slice(0, 2000) : null,
      stack:        r.stack ? String(r.stack).slice(0, 4000) : null,
      detail:       (r.detail && typeof r.detail === 'object') ? r.detail : null,
      occurred_at:  r.occurred_at && /^[0-9]{4}-/.test(String(r.occurred_at)) ? r.occurred_at : new Date().toISOString(),
    };
  }).filter(Boolean);

  if (rows.length === 0) {
    return res.status(200).json({ ok: true, inserted: 0, reason: 'no_valid_rows' });
  }

  try {
    const { opsQuery } = await import('./_shared/ops-db.js');
    const r = await opsQuery('POST', 'client_errors', rows, { 'Prefer': 'return=minimal' });
    if (!r.ok) {
      console.warn('[client-error] insert failed:', r.status, r.data);
      return res.status(200).json({ ok: false, inserted: 0, status: r.status });
    }
    return res.status(200).json({ ok: true, inserted: rows.length });
  } catch (err) {
    console.warn('[client-error] handler threw:', err?.message || err);
    return res.status(200).json({ ok: false, inserted: 0, error: 'exception' });
  }
}

// ============================================================================
// LLC RESEARCH QUEUE — Item #2 Phase B (2026-05-17)
//
// GET  /api/admin?_route=llc-research-queue&limit=20
//   Returns top-N queued LLC research items joined with property context.
//
// POST /api/admin?_route=resolve-llc-research
//   Body: { queue_id, status: 'no_match'|'completed',
//           found_filing_id?, found_filing_state? }
//   Marks an entry as resolved. `completed` sets resolved_at to now().
// ============================================================================

async function handleLlcResearchQueueList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  // Domain-aware: gov holds the high-value GSA LLCs; dialysis is the default
  // for backward-compatibility with the original (dialysis-only) caller.
  const domain = String(req.query.domain || 'dialysis').toLowerCase();
  if (!['government', 'dialysis'].includes(domain)) {
    return res.status(400).json({ error: "domain must be 'government' or 'dialysis'" });
  }
  const isGov = domain === 'government';

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    // Pull queue rows first. recorded_owner_id is REQUIRED so the sidebar can
    // target the SOS write-back at the right owner.
    const qRes = await domainQuery(domain, 'GET',
      'llc_research_queue' +
      '?status=eq.queued' +
      '&select=queue_id,recorded_owner_id,property_id,search_name,guessed_state,attempts,last_attempt_at,last_error,created_at' +
      '&order=created_at.asc' +
      '&limit=' + limit
    );
    if (!qRes.ok) {
      return res.status(502).json({ error: 'queue_fetch_failed', detail: qRes.data });
    }
    const rows = Array.isArray(qRes.data) ? qRes.data : [];
    if (rows.length === 0) {
      return res.status(200).json({ ok: true, domain, items: [], total: 0 });
    }

    // Fetch property context for each queue row (single batched query)
    const propIds = Array.from(new Set(rows.map(r => r.property_id).filter(Boolean)));
    let propsById = {};
    if (propIds.length > 0) {
      const propSelect = isGov
        ? 'property_id,address,city,state,agency,gross_rent,investment_score,deal_grade'
        : 'property_id,address,city,state,zip_code,tenant,operator,chain_canonical,latest_sale_price,current_value_estimate,annual_rent,completeness_band,completeness_score';
      const pRes = await domainQuery(domain, 'GET',
        'properties?property_id=in.(' + propIds.join(',') + ')&select=' + propSelect
      );
      if (pRes.ok && Array.isArray(pRes.data)) {
        for (const p of pRes.data) propsById[p.property_id] = p;
      }
    }

    // Value signal for ranking. dia has a dedicated revenue view; gov ranks on
    // gross_rent (annual rent is the cleanest deal-size proxy there).
    let valueById = {};
    if (!isGov && propIds.length > 0) {
      const vRes = await domainQuery('dialysis', 'GET',
        'v_property_value_signal?property_id=in.(' + propIds.join(',') + ')&select=property_id,rev_value'
      );
      if (vRes.ok && Array.isArray(vRes.data)) {
        for (const v of vRes.data) valueById[v.property_id] = Number(v.rev_value) || 0;
      }
    }

    const items = rows.map(r => {
      const prop = propsById[r.property_id] || null;
      const rev_value = isGov
        ? (Number(prop?.gross_rent) || 0)
        : (valueById[r.property_id] || 0);
      return {
        queue_id:           r.queue_id,
        recorded_owner_id:  r.recorded_owner_id || null,
        domain,
        property_id:        r.property_id,
        search_name:        r.search_name,
        guessed_state:      r.guessed_state,
        attempts:           r.attempts,
        last_attempt_at:    r.last_attempt_at,
        last_error:         r.last_error,
        created_at:         r.created_at,
        property_address:   prop?.address || null,
        property_city:      prop?.city || null,
        property_state:     prop?.state || null,
        property_zip:       prop?.zip_code || null,
        tenant:             isGov
                              ? (prop?.agency || null)
                              : (prop?.tenant || prop?.operator || prop?.chain_canonical || null),
        deal_grade:         isGov ? (prop?.deal_grade || null) : null,
        completeness_band:  isGov ? null : (prop?.completeness_band || null),
        completeness_score: (!isGov && prop?.completeness_score != null) ? Number(prop.completeness_score) : null,
        rev_value,
      };
    });

    // Sort by rev_value DESC so highest-value research surfaces first
    items.sort((a, b) => (b.rev_value || 0) - (a.rev_value || 0));

    return res.status(200).json({ ok: true, domain, items, total: items.length });
  } catch (err) {
    console.error('[llc-research-queue]', err?.message || err);
    return res.status(500).json({ error: 'llc_research_queue_failed', message: err?.message });
  }
}

// ============================================================================
// RESOLVE OWNER-CONTACT LINK (FL SOS engine review lane, 2026-05-31)
// GET  /api/resolve-owner-link            -> list weak links awaiting review
// POST /api/resolve-owner-link {link_id, decision:'confirm'|'reject'}
//   confirm -> link_status='confirmed'; reject -> 'rejected'. Stamps decided_by/at.
// Drives the Review Console "Owner-contact links to confirm" lane.
// ============================================================================
async function handleResolveOwnerLink(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  const actor = user.email || user.display_name || user.id || 'reviewer';

  // GET = list the weak/proposed links (the lane worklist).
  if (req.method === 'GET') {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const r = await domainQuery('government', 'GET',
      'v_recorded_owner_link_review?select=link_id,recorded_owner_name,owner_state,registered_agent_name,manager_name,match_signals,contact_name,contact_company,sf_account_id,source_property_id,source_property_address' +
      '&order=created_at.asc&limit=' + limit);
    if (!r.ok) return res.status(502).json({ error: 'list_failed', detail: r.data });
    return res.status(200).json({ items: Array.isArray(r.data) ? r.data : [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const body = req.body || {};
  const linkId = Number(body.link_id);
  const decision = String(body.decision || '').toLowerCase();
  if (!Number.isFinite(linkId)) return res.status(400).json({ error: 'link_id (number) required' });
  if (!['confirm', 'reject'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'confirm' or 'reject'" });
  }
  const newStatus = decision === 'confirm' ? 'confirmed' : 'rejected';

  try {
    const r = await domainQuery('government', 'PATCH',
      'recorded_owner_contact_links?link_id=eq.' + linkId,
      { link_status: newStatus, decided_by: actor, decided_at: new Date().toISOString() });
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });
    // BD-flow confirm->act loop: hand back the SF account just linked and a
    // representative property so the UI can refresh the badge and route the
    // user forward. Best-effort — never fail the confirm on a lookup miss.
    let sfAccountId = null, sourcePropertyId = null;
    if (decision === 'confirm') {
      try {
        const lk = await domainQuery('government', 'GET',
          'recorded_owner_contact_links?link_id=eq.' + linkId + '&select=sf_account_id,recorded_owner_id&limit=1');
        const lkRow = (lk.ok && Array.isArray(lk.data)) ? lk.data[0] : null;
        if (lkRow) {
          sfAccountId = lkRow.sf_account_id || null;
          if (lkRow.recorded_owner_id != null) {
            const pr = await domainQuery('government', 'GET',
              'properties?recorded_owner_id=eq.' + encodeURIComponent(lkRow.recorded_owner_id) + '&select=property_id&order=property_id.asc&limit=1');
            const prRow = (pr.ok && Array.isArray(pr.data)) ? pr.data[0] : null;
            if (prRow) sourcePropertyId = prRow.property_id;
          }
        }
      } catch (_e) { /* best-effort enrichment only */ }
    }
    return res.status(200).json({ ok: true, link_id: linkId, link_status: newStatus, decided_by: actor,
      sf_account_id: sfAccountId, source_property_id: sourcePropertyId });
  } catch (err) {
    console.error('[resolve-owner-link]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

async function handleResolveLlcResearch(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const body = req.body || {};
  const queueId = Number(body.queue_id);
  const status  = String(body.status || '').toLowerCase();
  const domain  = String(body.domain || 'dialysis').toLowerCase();
  if (!['government', 'dialysis'].includes(domain)) {
    return res.status(400).json({ error: "domain must be 'government' or 'dialysis'" });
  }
  if (!Number.isFinite(queueId)) return res.status(400).json({ error: 'queue_id (number) required' });
  if (!['no_match', 'completed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'no_match' or 'completed'" });
  }

  const patch = { status };
  if (status === 'completed') {
    patch.resolved_at = new Date().toISOString();
    if (body.found_filing_id)    patch.found_filing_id    = String(body.found_filing_id).slice(0, 200);
    if (body.found_filing_state) patch.found_filing_state = String(body.found_filing_state).slice(0, 4);
  } else {
    // no_match — still mark resolved_at so we can age out and re-queue later
    patch.resolved_at = new Date().toISOString();
    if (body.last_error) patch.last_error = String(body.last_error).slice(0, 500);
  }

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const r = await domainQuery(domain, 'PATCH',
      'llc_research_queue?queue_id=eq.' + queueId, patch);
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });
    return res.status(200).json({ ok: true, domain, queue_id: queueId, status, patch });
  } catch (err) {
    console.error('[resolve-llc-research]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// ============================================================================
// SOS MANUAL WRITE-BACK — sidebar-assisted SOS lookup (2026-05-21)
//
// The demand-driven workhorse for owner-LLC enrichment. The Chrome sidebar's
// public-records scanner already extracts the SOS entity-detail fields
// (registered agent, officers/members, filing number, formation date, status,
// state of formation). This route accepts that capture and writes it back to
// `recorded_owners` using the SAME field mapping as the automated
// `llc-research-tick`, then marks the originating `llc_research_queue` row
// done. Works for all 50 states day one (a human is the parser), is compliant
// (broker opens the official SOS page), and needs no per-state adapter or paid
// API key. Per-state automated adapters (SPEC_sos_direct_scraper) drain the
// long tail later; this covers the high-value head immediately.
//
// POST /api/admin?_route=sos-writeback   (rewritten: /api/sos-writeback)
//   Body: {
//     domain: 'government' | 'dialysis',
//     recorded_owner_id: <uuid>,          // required — the owner to enrich
//     queue_id?: <number>,                // optional — queue row to close
//     capture: {                          // raw sidebar SOS scan
//       name?, registered_agent?, agent_address?, principal_address?,
//       officers?, filing_number?, formation_date?, status?,
//       state_of_formation?
//     }
//   }
// ============================================================================

// "John Smith, Manager; Jane Doe, Member" → {name:'John Smith', role:'Manager'}
function parseSosOfficer(raw) {
  if (!raw || typeof raw !== 'string') return { name: null, role: null };
  const first = raw.split(/[;\n]|(?:,\s*(?:and|&)\s*)/i)[0]?.trim() || '';
  if (!first) return { name: null, role: null };
  // Try "Name, Role"
  const m = first.match(/^(.+?)\s*[,\-–—]\s*([A-Za-z][A-Za-z /]+)$/);
  if (m) {
    const role = m[2].trim();
    if (/manager|member|president|ceo|director|officer|principal|partner|owner|registered agent|secretary|treasurer/i.test(role)) {
      return { name: m[1].trim().slice(0, 200), role: role.slice(0, 100) };
    }
  }
  return { name: first.slice(0, 200), role: null };
}

// "Delaware" / "DE" / "State of Texas" → 2-letter code (best-effort, else null)
function normalizeStateCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase().replace(/^STATE OF\s+/, '');
  if (/^[A-Z]{2}$/.test(s)) return s;
  const MAP = {
    ALABAMA:'AL',ALASKA:'AK',ARIZONA:'AZ',ARKANSAS:'AR',CALIFORNIA:'CA',COLORADO:'CO',
    CONNECTICUT:'CT',DELAWARE:'DE','DISTRICT OF COLUMBIA':'DC',FLORIDA:'FL',GEORGIA:'GA',
    HAWAII:'HI',IDAHO:'ID',ILLINOIS:'IL',INDIANA:'IN',IOWA:'IA',KANSAS:'KS',KENTUCKY:'KY',
    LOUISIANA:'LA',MAINE:'ME',MARYLAND:'MD',MASSACHUSETTS:'MA',MICHIGAN:'MI',MINNESOTA:'MN',
    MISSISSIPPI:'MS',MISSOURI:'MO',MONTANA:'MT',NEBRASKA:'NE',NEVADA:'NV','NEW HAMPSHIRE':'NH',
    'NEW JERSEY':'NJ','NEW MEXICO':'NM','NEW YORK':'NY','NORTH CAROLINA':'NC','NORTH DAKOTA':'ND',
    OHIO:'OH',OKLAHOMA:'OK',OREGON:'OR',PENNSYLVANIA:'PA','RHODE ISLAND':'RI','SOUTH CAROLINA':'SC',
    'SOUTH DAKOTA':'SD',TENNESSEE:'TN',TEXAS:'TX',UTAH:'UT',VERMONT:'VT',VIRGINIA:'VA',
    WASHINGTON:'WA','WEST VIRGINIA':'WV',WISCONSIN:'WI',WYOMING:'WY',
  };
  return MAP[s] || null;
}

// Best-effort date parse → ISO YYYY-MM-DD, else null
function parseSosDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const d = new Date(raw.trim());
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function handleSosWriteback(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const body    = req.body || {};
  const domain  = String(body.domain || '').toLowerCase();
  const ownerId = body.recorded_owner_id ? String(body.recorded_owner_id) : null;
  const queueId = body.queue_id != null ? Number(body.queue_id) : null;
  const cap     = body.capture || {};

  if (!['government', 'dialysis'].includes(domain)) {
    return res.status(400).json({ error: "domain must be 'government' or 'dialysis'" });
  }
  if (!ownerId) {
    return res.status(400).json({ error: 'recorded_owner_id required' });
  }

  const officer  = parseSosOfficer(cap.officers);
  const isGov     = domain === 'government';
  const stateCol  = isGov ? 'filing_state' : 'state_of_incorporation';
  const filingState = normalizeStateCode(cap.state_of_formation);

  const ownerPatch = stripNullsLocal({
    [stateCol]:               filingState,
    filing_id:                cap.filing_number ? String(cap.filing_number).slice(0, 200) : null,
    filing_date:              parseSosDate(cap.formation_date),
    filing_status:            cap.status ? String(cap.status).slice(0, 100) : null,
    registered_agent_name:    cap.registered_agent ? String(cap.registered_agent).slice(0, 300) : null,
    registered_agent_address: cap.agent_address
                                ? String(cap.agent_address).slice(0, 500)
                                : (cap.principal_address ? String(cap.principal_address).slice(0, 500) : null),
    manager_name:             officer.name,
    manager_role:             officer.role,
    llc_research_at:          new Date().toISOString(),
    llc_research_source:      'sos_manual_sidebar',
  });

  if (Object.keys(ownerPatch).length <= 2) {
    // only the two timestamp/source fields → nothing useful was captured
    return res.status(400).json({ error: 'capture contained no enrichable SOS fields' });
  }

  try {
    const r = await domainQuery(domain, 'PATCH',
      `recorded_owners?recorded_owner_id=eq.${ownerId}`, ownerPatch);
    if (!r.ok) return res.status(502).json({ error: 'owner_update_failed', detail: r.data });

    let queueClosed = false;
    if (Number.isFinite(queueId)) {
      const qr = await domainQuery(domain, 'PATCH',
        `llc_research_queue?queue_id=eq.${queueId}`,
        stripNullsLocal({
          status:             'done',
          found_filing_id:    ownerPatch.filing_id || null,
          found_filing_state: ownerPatch[stateCol] || null,
          resolved_at:        new Date().toISOString(),
          last_error:         null,
        }));
      queueClosed = !!qr.ok;
    }

    return res.status(200).json({
      ok: true,
      domain,
      recorded_owner_id: ownerId,
      queue_id: Number.isFinite(queueId) ? queueId : null,
      queue_closed: queueClosed,
      applied: ownerPatch,
    });
  } catch (err) {
    console.error('[sos-writeback]', err?.message || err);
    return res.status(500).json({ error: 'sos_writeback_failed', message: err?.message });
  }
}

// ============================================================================
// AGENCY DRIFT QUEUE — Fresh audit A-5 (2026-05-18)
//
// GET  /api/admin?_route=agency-drift-queue&limit=15
//   Returns top-N gov v_gap_agency_drift rows where drift_kind=
//   'agency_disagreement', ordered by property value DESC (most
//   valuable disagreement first). Includes property context.
//
// POST /api/admin?_route=resolve-agency-drift
//   Body: { property_id, resolution: 'use_lease', new_agency_canonical?,
//           new_agency_full? }
//   Patches gov.properties.agency / agency_canonical / agency_full_name
//   to the lease tenant value. Closes the drift outright on next view
//   refresh.
// ============================================================================

async function handleAgencyDriftQueueList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const limit = Math.min(parseInt(req.query.limit, 10) || 15, 100);
  // Phase B (2026-05-18): `kind` chooses between the two drift_kind
  // surfaces. Default preserves A-5 behavior.
  const ALLOWED_KINDS = new Set(['agency_disagreement', 'lease_agency_but_property_agency_null']);
  const kind = ALLOWED_KINDS.has(String(req.query.kind || '')) ? String(req.query.kind) : 'agency_disagreement';

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const gRes = await domainQuery('government', 'GET',
      'v_gap_agency_drift' +
      '?drift_kind=eq.' + encodeURIComponent(kind) +
      '&select=property_id,prop_agency,prop_agency_canonical,lease_tenant_agency,lease_tenant_agency_full,property_value,drift_kind' +
      '&order=property_value.desc.nullslast' +
      '&limit=' + limit
    );
    if (!gRes.ok) return res.status(502).json({ error: 'queue_fetch_failed', detail: gRes.data });

    const rows = Array.isArray(gRes.data) ? gRes.data : [];
    if (rows.length === 0) return res.status(200).json({ ok: true, items: [], total: 0 });

    // Hydrate property context (address, city, state, completeness_band).
    const propIds = Array.from(new Set(rows.map(r => r.property_id).filter(Boolean)));
    let propsById = {};
    if (propIds.length > 0) {
      const pRes = await domainQuery('government', 'GET',
        'properties?property_id=in.(' + propIds.join(',') + ')' +
        '&select=property_id,address,city,state,completeness_band,completeness_score'
      );
      if (pRes.ok && Array.isArray(pRes.data)) {
        for (const p of pRes.data) propsById[p.property_id] = p;
      }
    }

    const items = rows.map(r => {
      const prop = propsById[r.property_id] || null;
      return {
        property_id:            r.property_id,
        prop_agency:            r.prop_agency,
        prop_agency_canonical:  r.prop_agency_canonical,
        lease_tenant_agency:    r.lease_tenant_agency,
        lease_tenant_agency_full: r.lease_tenant_agency_full,
        property_value:         Number(r.property_value) || 0,
        drift_kind:             r.drift_kind,
        property_address:       prop?.address || null,
        property_city:          prop?.city || null,
        property_state:         prop?.state || null,
        completeness_band:      prop?.completeness_band || null,
        completeness_score:     prop?.completeness_score != null ? Number(prop.completeness_score) : null,
      };
    });

    return res.status(200).json({ ok: true, items, total: items.length, kind });
  } catch (err) {
    console.error('[agency-drift-queue]', err?.message || err);
    return res.status(500).json({ error: 'agency_drift_queue_failed', message: err?.message });
  }
}

async function handleResolveAgencyDrift(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const body = req.body || {};
  const propertyId = Number(body.property_id);
  const resolution = String(body.resolution || '').toLowerCase();
  if (!Number.isFinite(propertyId)) return res.status(400).json({ error: 'property_id (number) required' });
  if (resolution !== 'use_lease') {
    return res.status(400).json({ error: "resolution must be 'use_lease' (only supported value in Phase A)" });
  }

  const patch = {};
  if (body.new_agency_canonical) patch.agency_canonical = String(body.new_agency_canonical).slice(0, 200);
  if (body.new_agency_full)      patch.agency_full_name = String(body.new_agency_full).slice(0, 500);
  if (body.new_agency_canonical) patch.agency          = String(body.new_agency_canonical).slice(0, 200);
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no agency fields to update' });
  }
  patch.updated_at = new Date().toISOString();

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const r = await domainQuery('government', 'PATCH',
      'properties?property_id=eq.' + propertyId, patch,
      undefined, { label: 'resolveAgencyDrift' });
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });
    return res.status(200).json({ ok: true, property_id: propertyId, patch });
  } catch (err) {
    console.error('[resolve-agency-drift]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// ============================================================================
// WRITE FAILURES ROLLUP — Phase C (2026-05-18)
//
// GET /api/admin?_route=write-failures-rollup&hours=24
//   Returns:
//     {
//       ok: true,
//       window_hours,
//       totals: { total, labeled, unlabeled, distinct_labels },
//       top_combos: [{ label, path, http_status, count, latest_at, sample_detail }]
//     }
//   top_combos limited to 25 rows ordered by count DESC.
// ============================================================================
async function handleWriteFailuresRollup(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const hours = Math.min(parseInt(req.query.hours, 10) || 24, 168);

  try {
    const { opsQuery } = await import('./_shared/ops-db.js');
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    // Pull recent failures with bounded payload (cap at 5000 rows for stats).
    const r = await opsQuery('GET',
      'ingest_write_failures?occurred_at=gte.' + encodeURIComponent(cutoff) +
      '&select=label,path,http_status,occurred_at,error_detail' +
      '&order=occurred_at.desc' +
      '&limit=5000'
    );
    if (!r.ok) return res.status(502).json({ error: 'rollup_fetch_failed', detail: r.data });

    const rows = Array.isArray(r.data) ? r.data : [];
    const labelsSeen = new Set();
    let labeled = 0;
    let unlabeled = 0;
    const buckets = new Map();
    for (const row of rows) {
      if (row.label) { labeled++; labelsSeen.add(row.label); } else { unlabeled++; }
      const key = (row.label || '(unlabeled)') + '|' + (row.path || '') + '|' + (row.http_status || '');
      let b = buckets.get(key);
      if (!b) {
        b = {
          label: row.label || null,
          path: row.path || null,
          http_status: row.http_status || null,
          count: 0,
          latest_at: row.occurred_at,
          sample_detail: null,
        };
        buckets.set(key, b);
      }
      b.count++;
      if (row.occurred_at > b.latest_at) b.latest_at = row.occurred_at;
      if (!b.sample_detail && row.error_detail) {
        try {
          const det = typeof row.error_detail === 'string' ? row.error_detail : JSON.stringify(row.error_detail);
          b.sample_detail = det.length > 240 ? det.slice(0, 237) + '...' : det;
        } catch (_) {}
      }
    }
    const top_combos = Array.from(buckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 25);

    return res.status(200).json({
      ok: true,
      window_hours: hours,
      totals: {
        total:           rows.length,
        labeled,
        unlabeled,
        distinct_labels: labelsSeen.size,
      },
      top_combos,
    });
  } catch (err) {
    console.error('[write-failures-rollup]', err?.message || err);
    return res.status(500).json({ error: 'rollup_failed', message: err?.message });
  }
}

// ============================================================================
// RESOLVE ORPHAN SALE — Item #8 Phase B-3 (2026-05-18)
//
// POST /api/admin?_route=resolve-orphan-sale
//   Body: { sale_id, property_id, domain: 'government'|'dialysis' }
//
// Single-row version of the A-1 bulk backfill. Attributes one specific
// orphan sale to its property's current recorded_owner_id, BUT only when
// the sale is the most-recent for its property (same safety check as A-1).
//
// Earlier sales need ownership_history resolution and are out of scope —
// returns 409 with the actual most-recent sale_id so the UI can explain
// why the attribution was refused.
// ============================================================================
async function handleResolveOrphanSale(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const body = req.body || {};
  const saleId     = body.sale_id;
  const propertyId = Number(body.property_id);
  const domain     = String(body.domain || '').toLowerCase();
  if (!saleId)                     return res.status(400).json({ error: 'sale_id required' });
  if (!Number.isFinite(propertyId)) return res.status(400).json({ error: 'property_id (number) required' });
  if (!['government', 'dialysis'].includes(domain)) {
    return res.status(400).json({ error: "domain must be 'government' or 'dialysis'" });
  }

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');

    // 1. Find the most-recent sale for this property. Order by sale_date
    //    DESC NULLS LAST, then sale_id DESC as a deterministic tiebreaker
    //    (matches the A-1 ordering).
    const rankRes = await domainQuery(domain, 'GET',
      'sales_transactions?property_id=eq.' + propertyId +
      '&order=sale_date.desc.nullslast,sale_id.desc' +
      '&select=sale_id&limit=1'
    );
    if (!rankRes.ok || !rankRes.data?.length) {
      return res.status(404).json({ error: 'no sales for this property' });
    }
    const mostRecentId = rankRes.data[0].sale_id;
    if (String(mostRecentId) !== String(saleId)) {
      return res.status(409).json({
        error: 'not_most_recent_sale',
        message: 'Earlier sales need ownership_history resolution. Only the most-recent sale per property can be auto-backlinked.',
        most_recent_sale_id: mostRecentId,
      });
    }

    // 2. Fetch the property's current recorded_owner_id.
    const propRes = await domainQuery(domain, 'GET',
      'properties?property_id=eq.' + propertyId + '&select=recorded_owner_id,recorded_owner_name&limit=1'
    );
    if (!propRes.ok || !propRes.data?.length) {
      return res.status(404).json({ error: 'property not found' });
    }
    const ownerId = propRes.data[0].recorded_owner_id;
    const ownerName = propRes.data[0].recorded_owner_name;
    if (!ownerId) {
      return res.status(409).json({
        error: 'no_owner_to_attribute',
        message: 'Property has no recorded_owner_id yet. Resolve missing_recorded_owner first.',
      });
    }

    // 3. PATCH the sale.
    const r = await domainQuery(domain, 'PATCH',
      'sales_transactions?sale_id=eq.' + encodeURIComponent(saleId),
      { recorded_owner_id: ownerId, updated_at: new Date().toISOString() },
      undefined, { label: 'resolveOrphanSale' });
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });

    return res.status(200).json({
      ok: true, sale_id: saleId, property_id: propertyId,
      recorded_owner_id: ownerId, recorded_owner_name: ownerName || null,
    });
  } catch (err) {
    console.error('[resolve-orphan-sale]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// ============================================================================
// RESOLVE LEASE-TENANT DRIFT — Item #8 Phase B-4 (2026-05-18, dia-only)
//
// POST /api/admin?_route=resolve-lease-tenant-drift
//   Body: { property_id }
//   Looks up v_gap_lease_tenant_drift for the property to fetch
//   lease_tenant, then PATCHes dia.properties.tenant = lease_tenant.
// ============================================================================
async function handleResolveLeaseTenantDrift(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const propertyId = Number((req.body || {}).property_id);
  if (!Number.isFinite(propertyId)) return res.status(400).json({ error: 'property_id (number) required' });

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const driftRes = await domainQuery('dialysis', 'GET',
      'v_gap_lease_tenant_drift?property_id=eq.' + propertyId +
      '&select=property_id,lease_tenant,prop_tenant&limit=1'
    );
    if (!driftRes.ok || !driftRes.data?.length) {
      return res.status(404).json({ error: 'no_active_drift', message: 'No active lease-tenant drift row for this property' });
    }
    const leaseTenant = (driftRes.data[0].lease_tenant || '').trim();
    if (!leaseTenant) {
      return res.status(409).json({ error: 'no_lease_tenant', message: 'Lease has no tenant to apply' });
    }
    const r = await domainQuery('dialysis', 'PATCH',
      'properties?property_id=eq.' + propertyId,
      { tenant: leaseTenant, updated_at: new Date().toISOString() },
      undefined, { label: 'resolveLeaseTenantDrift' });
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });
    return res.status(200).json({ ok: true, property_id: propertyId, tenant: leaseTenant });
  } catch (err) {
    console.error('[resolve-lease-tenant-drift]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// ============================================================================
// RESOLVE CMS CHAIN DRIFT — Item #8 Phase B-4 (2026-05-18, dia-only)
//
// POST /api/admin?_route=resolve-cms-chain-drift
//   Body: { property_id }
//   Only handles the 'cms_chain_but_property_tenant_null' drift_kind.
//   Looks up v_gap_chain_drift for the property, fetches cms_chain,
//   and PATCHes dia.properties.tenant = cms_chain.
//   The 'operator_transition_candidate' variant is NOT auto-resolvable
//   (needs human judgment between competing tenant values).
// ============================================================================
async function handleResolveCmsChainDrift(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const propertyId = Number((req.body || {}).property_id);
  if (!Number.isFinite(propertyId)) return res.status(400).json({ error: 'property_id (number) required' });

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const driftRes = await domainQuery('dialysis', 'GET',
      'v_gap_chain_drift?property_id=eq.' + propertyId +
      '&drift_kind=eq.cms_chain_but_property_tenant_null' +
      '&select=property_id,cms_chain,prop_tenant,drift_kind&limit=1'
    );
    if (!driftRes.ok || !driftRes.data?.length) {
      return res.status(404).json({ error: 'no_active_drift', message: 'No cms_chain_but_property_tenant_null drift for this property (operator_transition_candidate is not auto-resolvable)' });
    }
    const cmsChain = (driftRes.data[0].cms_chain || '').trim();
    if (!cmsChain) {
      return res.status(409).json({ error: 'no_cms_chain', message: 'CMS chain has no value to apply' });
    }
    const r = await domainQuery('dialysis', 'PATCH',
      'properties?property_id=eq.' + propertyId,
      { tenant: cmsChain, updated_at: new Date().toISOString() },
      undefined, { label: 'resolveCmsChainDrift' });
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });
    return res.status(200).json({ ok: true, property_id: propertyId, tenant: cmsChain });
  } catch (err) {
    console.error('[resolve-cms-chain-drift]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
// ============================================================================
// RESEARCH-TASK GENERATOR (O-9, 2026-05-21)
// Materializes the gov/dia `v_next_best_research` NBA feed into LCC
// `research_tasks`. Cross-DB: reads the gap feed via the data-query edge
// function (?_source=gov|dia), upserts into research_tasks keyed on
// (domain, research_type, source_record_id).
//   POST /api/admin?_route=generate-research-tasks&domain=gov|dia|both&limit=N
// Auto-close (filled gap -> completed/gap_resolved) only fires when the full
// feed fit under `limit` — never on a capped slice.
// ============================================================================
async function fetchNbaFeed(source, limit, req) {
  const url = new URL(DATA_QUERY_EDGE_URL);
  url.searchParams.set('_source', source);
  url.searchParams.set('table', 'v_next_best_research');
  url.searchParams.set('select', 'research_type,entity_kind,entity_id,label,priority,instructions,domain');
  url.searchParams.set('order', 'priority.desc');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('count', 'false');
  const r = await fetch(url.toString(), {
    method: 'GET',
    headers: buildEdgeProxyHeaders(req),
    signal: AbortSignal.timeout(25000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`data-query ${source} ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return Array.isArray(body.data) ? body.data : [];
}

async function handleGenerateResearchTasks(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;
  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const domainParam = String(req.query.domain || 'both').toLowerCase();
  if (!['gov', 'dia', 'both'].includes(domainParam)) {
    return res.status(400).json({ error: "domain must be gov, dia, or both" });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 2000);
  const sources = domainParam === 'both' ? ['gov', 'dia'] : [domainParam];

  const result = { ok: true, by_domain: {} };

  for (const source of sources) {
    const domain = source === 'dia' ? 'dialysis' : 'government';
    const summary = { feed: 0, inserted: 0, refreshed: 0, closed: 0, skipped_ignored: 0, errors: [] };
    try {
      const feed = await fetchNbaFeed(source, limit, req);
      summary.feed = feed.length;

      const ignoreRes = await opsQuery('GET',
        `ignored_recommendation_contacts?select=entity_id&domain=eq.${encodeURIComponent(domain)}`);
      const ignored = new Set(
        (ignoreRes.ok && Array.isArray(ignoreRes.data) ? ignoreRes.data : [])
          .map(r => String(r.entity_id)));

      const openRes = await opsQuery('GET',
        `research_tasks?select=id,research_type,source_record_id,priority,status` +
        `&domain=eq.${encodeURIComponent(domain)}&source_table=eq.v_next_best_research&status=eq.queued`);
      const openTasks = (openRes.ok && Array.isArray(openRes.data) ? openRes.data : []);
      const openByKey = new Map(openTasks.map(t => [`${t.research_type}|${t.source_record_id}`, t]));
      const feedKeys = new Set();

      for (const row of feed) {
        const entityId = row.entity_id == null ? null : String(row.entity_id);
        if (!entityId) continue;
        if (ignored.has(entityId)) { summary.skipped_ignored += 1; continue; }
        const key = `${row.research_type}|${entityId}`;
        feedKeys.add(key);
        const existing = openByKey.get(key);
        const priority = row.priority != null ? Number(row.priority) : 0;
        if (existing) {
          if (Number(existing.priority) !== priority) {
            await opsQuery('PATCH', `research_tasks?id=eq.${pgFilterVal(existing.id)}`,
              { priority, updated_at: new Date().toISOString() });
            summary.refreshed += 1;
          }
        } else {
          const title = (row.label && String(row.label).slice(0, 200)) || `${row.research_type} — ${entityId}`;
          const ins = await opsQuery('POST', 'research_tasks', {
            workspace_id:    workspaceId,
            research_type:   row.research_type || 'ownership_research',
            title,
            instructions:    row.instructions || null,
            domain,
            status:          'queued',
            priority,
            source_record_id: entityId,
            source_table:    'v_next_best_research',
            metadata:        { entity_kind: row.entity_kind || null, label: row.label || null },
          });
          if (ins.ok) summary.inserted += 1;
          else summary.errors.push(`insert ${key}: ${JSON.stringify(ins.data).slice(0, 120)}`);
        }
      }

      if (feed.length < limit) {
        for (const t of openTasks) {
          const key = `${t.research_type}|${t.source_record_id}`;
          if (!feedKeys.has(key)) {
            await opsQuery('PATCH', `research_tasks?id=eq.${pgFilterVal(t.id)}`,
              { status: 'completed', outcome: 'gap_resolved',
                completed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
            summary.closed += 1;
          }
        }
      } else {
        summary.note = 'feed capped at limit; auto-close skipped';
      }
    } catch (err) {
      summary.errors.push(String(err?.message || err));
    }
    result.by_domain[domain] = summary;
  }
  return res.status(200).json(result);
}

function stripNullsLocal(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}
