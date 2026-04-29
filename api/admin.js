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

import { authenticate, requireRole, primaryWorkspace, handleCors } from './_shared/auth.js';
import { opsQuery, pgFilterVal, requireOps, withErrorHandler } from './_shared/ops-db.js';
import { ROLES } from './_shared/lifecycle.js';
import { domainQuery } from './_shared/domain-db.js';
import { reconcilePropertyOwnership } from './_handlers/sidebar-pipeline.js';

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
    case 'consolidate-property': return handleConsolidateProperty(req, res);
    case 'npi-lookup':           return handleNpiLookupProxy(req, res);
    case 'npi-registry-sync':    return handleNpiRegistrySyncProxy(req, res);
    case 'merge-log-reconcile':  return handleMergeLogReconcile(req, res);
    case 'auto-scrape-listings': return handleAutoScrapeListings(req, res);
    default:
      return res.status(400).json({ error: 'Unknown admin route' });
  }
});

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
    const path =
      `available_listings?${isActiveFilter}` +
      `&verification_due_at=lte.${encodeURIComponent(new Date().toISOString())}` +
      `&verification_due_at=gte.${encodeURIComponent(cutoffIso)}` +
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

    // 2. Per-listing sale-window check. Reasonable property-level filter:
    //    one sales_transactions GET per listing. Fewer round trips than a
    //    bulk-and-merge query, and lets us treat each listing's outcome
    //    independently if a sale only matches one of multiple listings.
    for (const l of listings) {
      try {
        let checkResult = 'still_available';
        let offMarketReason = null;
        let notes = 'auto-scrape: no recent sale, deferred';

        if (l.property_id && l[dateCol]) {
          const salePath =
            `sales_transactions?property_id=eq.${Number(l.property_id)}` +
            `&sale_date=gte.${encodeURIComponent(l[dateCol])}` +
            `&select=sale_id,sale_date,sold_price&limit=1`;
          const saleRes = await domainQuery(dom, 'GET', salePath);
          if (saleRes.ok && Array.isArray(saleRes.data) && saleRes.data.length > 0) {
            const sale = saleRes.data[0];
            checkResult = 'sold';
            offMarketReason = 'sold';
            notes = `auto-scrape: matched sales_transactions sale_id=${sale.sale_id} on ${sale.sale_date}`;
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
          p_asking_price: null,
          p_cap_rate: null,
          p_source_url: null,
          p_off_market_reason: offMarketReason,
          p_notes: notes,
          p_verified_by: user.id || null,
        });
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
    gov: { connected: !!process.env.GOV_SUPABASE_KEY },
    dia: { connected: !!process.env.DIA_SUPABASE_KEY },
    ops: { connected: !!(process.env.OPS_SUPABASE_URL && process.env.OPS_SUPABASE_KEY) }
  });
}

async function handleDiag(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

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
      gov_key_set:  !!process.env.GOV_SUPABASE_KEY,
      dia_url_set:  !!process.env.DIA_SUPABASE_URL,
      dia_key_set:  !!process.env.DIA_SUPABASE_KEY,
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

  const govKey = process.env.GOV_SUPABASE_KEY || '';
  const diaKey = process.env.DIA_SUPABASE_KEY || '';
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

async function handleTreasury(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const wantHistory = req.query.history === 'true';
  const numYears = Math.min(parseInt(req.query.years, 10) || 1, 5);
  const currentYear = new Date().getFullYear();

  try {
    if (wantHistory) {
      const years = [];
      for (let i = 0; i < numYears; i++) years.push(currentYear - i);
      let allEntries = (await Promise.all(years.map(fetchXmlYear))).flat();
      if (allEntries.length === 0) allEntries = (await Promise.all(years.map(fetchCsvYear))).flat();
      allEntries.sort((a, b) => a.date.localeCompare(b.date));
      return res.status(200).json({ history: allEntries });
    }

    const entries = await fetchXmlYear(currentYear);
    if (entries.length > 0) {
      const latest = entries[entries.length - 1];
      const prev = entries.length > 1 ? entries[entries.length - 2] : null;
      return res.status(200).json({
        date: latest.date, ten_yr: latest.ten_yr, thirty_yr: latest.thirty_yr,
        prev_date: prev ? prev.date : null, prev_ten_yr: prev ? prev.ten_yr : null,
      });
    }

    const csvEntries = await fetchCsvYear(currentYear);
    if (csvEntries.length > 0) {
      const latest = csvEntries[csvEntries.length - 1];
      const prev = csvEntries.length > 1 ? csvEntries[csvEntries.length - 2] : null;
      return res.status(200).json({
        date: latest.date, ten_yr: latest.ten_yr, thirty_yr: latest.thirty_yr,
        prev_date: prev ? prev.date : null, prev_ten_yr: prev ? prev.ten_yr : null,
      });
    }

    const fiscalUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=2&fields=record_date,avg_interest_rate_amt,security_desc&filter=security_desc:eq:Treasury Notes';
    const fiscalRes = await fetch(fiscalUrl, { headers: { 'Accept': 'application/json' } });
    if (fiscalRes.ok) {
      const json = await fiscalRes.json();
      const rows = json.data || [];
      if (rows.length >= 1) {
        const latest = rows[0];
        const prev = rows.length > 1 ? rows[1] : null;
        return res.status(200).json({
          date: latest.record_date, ten_yr: parseFloat(latest.avg_interest_rate_amt) || null,
          thirty_yr: null, prev_date: prev ? prev.record_date : null,
          prev_ten_yr: prev ? (parseFloat(prev.avg_interest_rate_amt) || null) : null,
        });
      }
    }

    return res.status(500).json({ error: 'No data from any Treasury source' });
  } catch (e) {
    console.error('[diagnostics] Treasury rate fetch error:', e.message);
    return res.status(500).json({ error: 'Treasury rate fetch failed' });
  }
}

// ============================================================================
// EDGE FUNCTION PROXIES — Phase 4b: Pure edge-first routing
// No local fallback — edge functions are the source of truth
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
  blvd: 'boulevard', 'blvd.': 'boulevard',
  dr: 'drive', 'dr.': 'drive',
  ln: 'lane', 'ln.': 'lane',
  ct: 'court', 'ct.': 'court',
  cir: 'circle', 'cir.': 'circle',
  pkwy: 'parkway', 'pkwy.': 'parkway',
  hwy: 'highway', 'hwy.': 'highway',
  pl: 'place', 'pl.': 'place',
  ter: 'terrace', 'ter.': 'terrace',
  trl: 'trail', 'trl.': 'trail',
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
  const key = process.env.DIA_SUPABASE_KEY;
  if (!url || !key) {
    res.status(503).json({ error: 'DIA_SUPABASE_URL / DIA_SUPABASE_KEY not configured' });
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
  }
  for (const q of tryQueries) {
    try {
      const r = await diaRest(env, 'GET', q);
      if (r.ok && Array.isArray(r.data) && r.data.length) return r.data;
    } catch (e) {
      console.warn('[cms-match] candidate fetch failed for', q, e.message);
    }
  }
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

