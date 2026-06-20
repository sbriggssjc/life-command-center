// api/_handlers/owner-contact-enrich.js
// ============================================================================
// CONTACT-SELECTION Slice 3 — owner-contact enrichment worker
// ----------------------------------------------------------------------------
// Drains the contact-selection bench into REAL connected contacts, turning a
// read-only "who to call" hypothesis (owner_contact_pivot / v_owner_active_contact)
// into an attached person the operator can actually prospect — so the owner
// becomes connected/reachable and leaves the NBT `acquire_contact` state.
//
//   GET  → dry-run (no writes) — reports what WOULD be processed per outcome.
//   POST → drain (bounded by `limit` + a wall-clock budget).
//
// Three classes, one core (processOwnerEnrichmentRow):
//   (a) ATTACH a NAMED active contact (authority 1-3, a real person) — the free
//       drainer: ensureEntityLink the person (guards) → link person→owner
//       (associated_with) → stamp the contactless cadence → record the contact
//       entity on the pivot. ~88 named owners.
//   (b) MANAGER-ENTITY DRILL-THROUGH — when the controlling-role pick is a FIRM
//       (a management company, not a person), don't mint it as a person: register
//       the manager org + a `managed_by` edge and re-route the pivot to find a
//       PERSON at that manager (sos on the manager). The standard's drill-through.
//   (c) EXTERNAL ENRICHMENT for the contactless (sos_manager_lookup /
//       address_reverse_lookup / parse_deed_signatory / public_company_ir) —
//       feature-flagged adapters; no-op cleanly when unconfigured (the
//       find_contacts_by_account rollout pattern). Free SOS-direct preferred.
//
// Reuses (never forks): ensureEntityLink (person/org create + guards), the
// contact-attach helpers (linkPersonToEntity / stampContactOnActiveCadence).
// Reversible — every attach is a relationship row + the pivot pointer; delete the
// relationship and null active_contact_entity_id to undo.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { ensureEntityLink, looksLikePersonName } from '../_shared/entity-link.js';
import { linkPersonToEntity, stampContactOnActiveCadence } from '../_shared/contact-attach.js';
import { buildDeedParseAdapter, isDeedAdapterConfigured } from '../_shared/deed-signatory.js';
import { buildSosLookupAdapter, isSosAdapterConfigured } from '../_shared/sos-lookup.js';
import { buildAddressReverseAdapter, isAddressAdapterConfigured } from '../_shared/address-reverse.js';
import { buildWebSearchAdapter, isWebSearchAdapterConfigured } from '../_shared/web-search-enrich.js';
import { buildManualResearchProducer, MANUAL_RESEARCH_TYPE } from '../_shared/manual-research-worklist.js';

const WALL_CLOCK_MS = 20000;

// ---- external enrichment adapters (Slice 4; feature-flagged; free SOS-direct
// preferred). Slice 3 left these as TODO no-op stubs; Slice 4 wires the real
// adapters (see _shared/{deed-signatory,sos-lookup,address-reverse}.js). Each
// still no-ops cleanly (`unconfigured`) when its OWNER_ENRICH_*_URL is unset (or,
// for SOS, no state parser is enabled yet) — so the worker drains the
// attach/drill-through classes today and the external classes light up when the
// webhook + (SOS) a validated per-state parser land post-deploy.
async function defaultSosLookup() { return { ok: false, reason: 'unconfigured' }; }
async function defaultAddressLookup() { return { ok: false, reason: 'unconfigured' }; }
async function defaultDeedParse() { return { ok: false, reason: 'unconfigured' }; }
// Slice-4 amendment: cross-ref (free sibling reuse) + web search.
async function defaultCrossRef() { return { ok: false, reason: 'no_sibling' }; }
async function defaultWebSearch() { return { ok: false, reason: 'unconfigured' }; }

const isConfiguredSos = isSosAdapterConfigured;
const isConfiguredAddress = isAddressAdapterConfigured;
const isConfiguredDeed = isDeedAdapterConfigured;

// Thin production fetchers: POST the owner/doc reference to the configured
// OWNER_ENRICH_*_URL webhook (a Scott-provided PA flow / proxy that performs the
// egress the worker can't) and return its JSON. DEFERRED: the webhooks, the SOS
// per-state response parsers, and the dia per-owner context load (state /
// notice_address / deed source_url) are the post-deploy activation pieces. The
// adapters no-op without both the URL and a fetcher, so this is inert until then.
function webhookFetcher(envKey) {
  const url = process.env[envKey];
  if (!url) return undefined;
  return async function postWebhook(...payloadParts) {
    const body = JSON.stringify({ args: payloadParts });
    const resp = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (!resp.ok) throw new Error(`${envKey} ${resp.status}`);
    return await resp.json();
  };
}

/**
 * Attach a resolved person to the owner: ensureEntityLink (guards) →
 * link person→owner → stamp the contactless cadence → point the pivot at the
 * new contact entity. Shared by the attach class + a successful external resolve.
 */
async function attachPersonToOwner(row, personName, role, deps, via) {
  const ensure = deps.ensureEntityLink;
  const link = await ensure({
    workspaceId: row.workspace_id,
    sourceType: 'person',
    domain: 'lcc',
    seedFields: { name: personName, entity_type: 'person', domain: 'lcc' },
  });
  if (!link || !link.ok || !link.entityId) {
    return { ok: false, outcome: 'guard_rejected', skipped: link && link.skipped };
  }
  const contactEntityId = link.entityId;
  await deps.linkPersonToEntity({
    workspaceId: row.workspace_id, entityId: row.entity_id, contactEntityId,
    role: role || 'owner_contact', via: via || 'contact_selection',
  });
  // Fill a contactless cadence only — never clobber an existing prospecting contact.
  await deps.stampContactOnActiveCadence({ entityId: row.entity_id, contactEntityId, onlyContactless: true });
  await deps.opsQuery('PATCH', 'owner_contact_pivot?entity_id=eq.' + pgFilterVal(row.entity_id),
    { active_contact_entity_id: contactEntityId, updated_at: new Date().toISOString() });
  return { ok: true, outcome: 'attached', contact_entity_id: contactEntityId, contact_name: personName };
}

/**
 * Process ONE owner pivot row. Pure orchestration over injected deps.
 * @param row {entity_id, owner_name, workspace_id, active_contact_name,
 *             active_contact_entity_id, active_authority_level, active_contact_role,
 *             enrichment_action}
 */
export async function processOwnerEnrichmentRow(row, deps) {
  const looksPerson = deps.looksLikePersonName || looksLikePersonName;

  if (row.active_contact_entity_id) {
    return { entity_id: row.entity_id, outcome: 'already_linked' };
  }

  // (a) ATTACH a named active contact (a real person).
  if (row.active_contact_name && looksPerson(row.active_contact_name)) {
    const r = await attachPersonToOwner(row, row.active_contact_name, row.active_contact_role, deps, 'contact_selection');
    return { entity_id: row.entity_id, ...r };
  }

  // (b) MANAGER-ENTITY DRILL-THROUGH: controlling-role pick is a FIRM.
  if (row.active_contact_name && Number(row.active_authority_level) <= 2) {
    const org = await deps.ensureEntityLink({
      workspaceId: row.workspace_id, sourceType: 'organization', domain: 'lcc',
      seedFields: { name: row.active_contact_name, entity_type: 'organization', domain: 'lcc' },
    });
    if (org && org.ok && org.entityId) {
      await deps.linkPersonToEntity({
        workspaceId: row.workspace_id, entityId: row.entity_id, contactEntityId: org.entityId,
        role: 'manager', via: 'contact_selection_drillthrough',
      });
      await deps.opsQuery('PATCH', 'owner_contact_pivot?entity_id=eq.' + pgFilterVal(row.entity_id),
        { enrichment_action: 'find_person_at_manager', updated_at: new Date().toISOString() });
      return { entity_id: row.entity_id, outcome: 'manager_drillthrough', manager_entity_id: org.entityId };
    }
    return { entity_id: row.entity_id, outcome: 'guard_rejected', skipped: org && org.skipped };
  }

  // (c) EXTERNAL ENRICHMENT for the contactless — ordered chain (Scott's
  // amendment 2026-06-20): cross-ref (free) → public-IR terminal → routed
  // adapter (deed/SOS/address) → web search → manual-research worklist. Each
  // step that can't resolve records WHY, so the worklist row carries full
  // breadcrumbs. First confident resolve wins; the unresolvable tail is
  // SURFACED (worklist), never dropped or guess-filled.
  const action = row.enrichment_action;
  const tried = [];

  // 1. Cross-reference — reuse a principal already resolved on a sibling owner.
  //    Free, zero external; run FIRST.
  const xref = await (deps.crossRef || defaultCrossRef)(row);
  if (xref && xref.ok && xref.person_name) {
    const r = await attachPersonToOwner(row, xref.person_name, xref.role || 'principal', deps, 'cross_reference');
    return { entity_id: row.entity_id, source: 'cross_reference', ...r };
  }
  tried.push({ method: 'cross_reference', reason: (xref && xref.reason) || 'no_sibling' });

  // 2. Public-company IR — a known-IR-contact MANUAL path (not a scraper), its
  //    own terminal (reached only after the free cross-ref).
  if (action === 'public_company_ir') {
    return { entity_id: row.entity_id, outcome: 'public_ir_manual', action };
  }

  // 3. Backoff: a manual row already OPEN ⇒ the external methods were tried on a
  //    prior tick — don't re-hammer (cross-ref above is the only worthwhile retry
  //    as siblings resolve over time).
  if (deps.manualResearch && typeof deps.manualResearch.check === 'function') {
    const open = await deps.manualResearch.check(row);
    if (open && open.open) return { entity_id: row.entity_id, outcome: 'manual_research_pending' };
  }

  // 4. Routed external adapter by enrichment_action.
  const routed =
    (action === 'sos_manager_lookup' || action === 'find_person_at_manager')
      ? { run: deps.sosLookup || defaultSosLookup, source: 'sos', role: 'managing_member' }
      : action === 'address_reverse_lookup'
        ? { run: deps.addressLookup || defaultAddressLookup, source: 'address', role: 'economic_owner_contact' }
        : action === 'parse_deed_signatory'
          ? { run: deps.deedParse || defaultDeedParse, source: 'deed', role: 'signatory' }
          : null;
  if (routed) {
    const res = await routed.run(row);
    if (res && res.ok && res.person_name) {
      const r = await attachPersonToOwner(row, res.person_name, res.role || routed.role, deps, routed.source + '_lookup');
      return { entity_id: row.entity_id, source: routed.source, ...r };
    }
    tried.push({ method: routed.source, reason: (res && res.reason) || 'no_result' });
  }

  // 5. Free web search.
  const web = await (deps.webSearch || defaultWebSearch)(row);
  if (web && web.ok && web.person_name) {
    const r = await attachPersonToOwner(row, web.person_name, web.role || 'principal', deps, 'web_search');
    return { entity_id: row.entity_id, source: 'web', ...r };
  }
  tried.push({ method: 'web_search', reason: (web && web.reason) || 'no_result' });

  // 6. Manual-research worklist — surfaced with breadcrumbs, never dropped.
  if (deps.manualResearch && typeof deps.manualResearch.queue === 'function') {
    const q = await deps.manualResearch.queue(row, { tried, enrichment_action: action, bench: row.bench_tried || [] });
    return { entity_id: row.entity_id, outcome: q && q.existed ? 'manual_research_pending' : 'manual_research_queued', queued: !!(q && q.ok), action: action || null };
  }
  return { entity_id: row.entity_id, outcome: 'manual_research', action: action || null };
}

function buildDeps() {
  // Real Slice-4 adapters; each no-ops `unconfigured` without its webhook (and,
  // for SOS, an enabled per-state parser), so unconfigured behavior is identical
  // to the Slice-3 no-op. The deed adapter's doc fetch is the deferred byte-fetch
  // (deed CDN / SharePoint); the SOS/address fetchers are the deferred webhooks.
  return {
    ensureEntityLink, linkPersonToEntity, stampContactOnActiveCadence, opsQuery, looksLikePersonName,
    deedParse: buildDeedParseAdapter({ fetchDocText: webhookFetcher('OWNER_ENRICH_DEED_URL') }),
    sosLookup: buildSosLookupAdapter({ fetch: webhookFetcher('OWNER_ENRICH_SOS_URL') }),
    addressLookup: buildAddressReverseAdapter({ fetch: webhookFetcher('OWNER_ENRICH_ADDRESS_URL') }),
    webSearch: buildWebSearchAdapter({ search: webhookFetcher('OWNER_ENRICH_WEBSEARCH_URL') }),
    // crossRef: the free sibling-reuse resolver. The production cross-DB sibling
    // query (shared notice_address / property cluster / true-owner family) needs
    // its own grounding and is the post-deploy piece; until then the chain's
    // cross-ref step no-ops (`no_sibling`) and the row flows to the worklist.
    manualResearch: buildManualResearchProducer(buildManualResearchDeps()),
  };
}

// Production deps for the manual-research worklist over the research_tasks table
// (mirrors api/admin.js createResearchTask: research_tasks.workspace_id + domain
// are NOT NULL). Idempotent open-check keys on (research_type, entity_id, open).
function buildManualResearchDeps() {
  return {
    findOpenTask: async (entityId) => {
      const q = 'research_tasks?select=id&research_type=eq.' + MANUAL_RESEARCH_TYPE
        + '&entity_id=eq.' + pgFilterVal(entityId)
        + '&status=in.(queued,in_progress)&limit=1';
      const r = await opsQuery('GET', q);
      return (r.ok && Array.isArray(r.data)) ? r.data : [];
    },
    createTask: async (payload) => opsQuery('POST', 'research_tasks', payload),
    resolveWorkspace: async (row) => {
      if (row && row.workspace_id) return row.workspace_id;
      const wr = await opsQuery('GET', 'workspaces?select=id&order=created_at.asc&limit=1');
      return (wr.ok && Array.isArray(wr.data) && wr.data[0]) ? wr.data[0].id : null;
    },
  };
}

export async function handleOwnerContactEnrichTick(req, res) {
  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error || 'unauthorized' });

  const dryRun = req.method === 'GET';
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 200);

  // Candidates: pivot rows not yet linked (named → attach/drill-through) +
  // contactless rows carrying an enrichment_action. status locked/superseded are
  // engaged/retired — skip. Ordered by least-recently-updated for fair drain.
  const sel = 'owner_contact_pivot?select=entity_id,owner_name,workspace_id,'
    + 'active_contact_name,active_contact_entity_id,active_authority_level,active_contact_role,enrichment_action,status'
    + '&active_contact_entity_id=is.null'
    + '&status=in.(active,exhausted)'
    + '&or=(active_contact_name.not.is.null,enrichment_action.not.is.null)'
    + '&order=updated_at.asc&limit=' + limit;
  const r = await opsQuery('GET', sel);
  if (!r.ok) return res.status(r.status || 500).json({ error: 'load_failed', detail: r.data });
  const rows = Array.isArray(r.data) ? r.data : [];

  if (dryRun) {
    const byAction = {};
    for (const row of rows) {
      const k = row.active_contact_name && looksLikePersonName(row.active_contact_name) ? 'attach_person'
        : (row.active_contact_name && Number(row.active_authority_level) <= 2) ? 'manager_drillthrough'
        : (row.enrichment_action || 'manual_research');
      byAction[k] = (byAction[k] || 0) + 1;
    }
    return res.status(200).json({ ok: true, dry_run: true, candidates: rows.length, by_action: byAction,
      adapters: { sos: isConfiguredSos(), address: isConfiguredAddress(), deed: isConfiguredDeed() } });
  }

  const deps = buildDeps();
  const started = Date.now();
  const summary = { processed: 0, attached: 0, drillthrough: 0, unconfigured: 0, skipped: 0, results: [] };
  let attachedAny = false;
  for (const row of rows) {
    if (Date.now() - started > WALL_CLOCK_MS) break;
    let out;
    try { out = await processOwnerEnrichmentRow(row, deps); }
    catch (e) { out = { entity_id: row.entity_id, outcome: 'error', error: String(e && e.message || e) }; }
    summary.processed += 1;
    if (out.outcome === 'attached') { summary.attached += 1; attachedAny = true; }
    else if (out.outcome === 'manager_drillthrough') summary.drillthrough += 1;
    else if (out.outcome === 'enrichment_unconfigured') summary.unconfigured += 1;
    else summary.skipped += 1;
    summary.results.push(out);
  }

  // Attaching makes owners connected/reachable → refresh the queue cache once.
  if (attachedAny) { try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ } }

  return res.status(200).json({ ok: true, ...summary });
}
