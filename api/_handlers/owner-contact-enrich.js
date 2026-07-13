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
import { buildCrossRefAdapter, crossRefDryRun } from '../_shared/owner-cross-reference.js';
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

// ---------------------------------------------------------------------------
// Person-name normalization (2026-06-26) — clean the minted contact name.
// ---------------------------------------------------------------------------
// Recorded-owner manager/agent picks arrive as ALL-CAPS "LAST FIRST [MIDDLE]"
// (deed/recorder convention: "LOMANGINO CHARLES", "MOTISI MEEGAN T"). They pass
// looksLikePersonName fine, but minting them verbatim leaves an all-caps,
// wrong-order entity name. Normalize to "First [Middle] Last" before the gate
// AND before minting so the attached decision-maker reads as a human name.
// Conservative: only an ALL-CAPS multi-token name is reordered (the recorder
// signal); a mixed-case name ("Anil Goel", "Henry John A IV") keeps its order
// and is left untouched. Never fabricates — only re-cases / re-orders the tokens
// already on the record.
function titleCaseToken(tok) {
  if (/^(?:II|III|IV|VI{0,3}|JR|SR)\.?$/i.test(tok)) {                 // generational suffix
    return tok.replace(/\.$/, '').toUpperCase() + (tok.endsWith('.') ? '.' : '');
  }
  if (/^[A-Za-z]\.?$/.test(tok)) return tok.toUpperCase();             // bare initial "T" / "T."
  return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
}

export function normalizePersonName(raw) {
  if (typeof raw !== 'string') return raw;
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t) return raw;
  const tokens = t.split(' ');
  const isAllCaps = !/[a-z]/.test(t) && /[A-Z]/.test(t);
  // Reorder LAST→end only for an all-caps 2–4 token name (the recorder signal).
  const ordered = (isAllCaps && tokens.length >= 2 && tokens.length <= 4)
    ? [...tokens.slice(1), tokens[0]]
    : tokens;
  return ordered.map(titleCaseToken).join(' ');
}

// Advance the pivot's updated_at (and optionally record a disposition) so the
// batch's `order=updated_at.asc` FIFO always progresses. This is the silent-churn
// guard: a processed row that does NOT attach must change state, or it re-serves
// at the head of the queue every tick and starves the attachable tail. Best-effort.
async function touchPivot(deps, entityId, patch) {
  try {
    await deps.opsQuery('PATCH', 'owner_contact_pivot?entity_id=eq.' + pgFilterVal(entityId),
      { ...(patch || {}), updated_at: new Date().toISOString() });
    return true;
  } catch (_e) { return false; }
}

/**
 * Attach a resolved person to the owner: ensureEntityLink (guards) →
 * link person→owner → stamp the contactless cadence → point the pivot at the
 * new contact entity. Shared by the attach class + a successful external resolve.
 * Returns a granular outcome so a non-attach surfaces WHY (guard_rejected /
 * link_failed / patch_failed) instead of a silent no-op.
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
    return { ok: false, outcome: 'guard_rejected',
      reason: (link && (link.skipped || link.error)) || 'no_entity', skipped: link && link.skipped };
  }
  const contactEntityId = link.entityId;
  const linkRes = await deps.linkPersonToEntity({
    workspaceId: row.workspace_id, entityId: row.entity_id, contactEntityId,
    role: role || 'owner_contact', via: via || 'contact_selection',
  });
  if (linkRes && linkRes.ok === false && !linkRes.existed) {
    return { ok: false, outcome: 'link_failed', contact_entity_id: contactEntityId,
      reason: linkRes.skipped || linkRes.detail || 'link_failed' };
  }
  // Fill a contactless cadence only — never clobber an existing prospecting contact.
  await deps.stampContactOnActiveCadence({ entityId: row.entity_id, contactEntityId, onlyContactless: true });
  const patch = await deps.opsQuery('PATCH', 'owner_contact_pivot?entity_id=eq.' + pgFilterVal(row.entity_id),
    { active_contact_entity_id: contactEntityId, active_contact_name: personName, updated_at: new Date().toISOString() });
  if (!patch || !patch.ok) {
    return { ok: false, outcome: 'patch_failed', contact_entity_id: contactEntityId,
      reason: (patch && patch.data) || 'pivot_patch_failed' };
  }
  return { ok: true, outcome: 'attached', contact_entity_id: contactEntityId, contact_name: personName };
}

// Outcomes that already advanced the pivot's updated_at (attach PATCHes the
// contact pointer; the manager drill PATCHes enrichment_action). `already_linked`
// returns before the finalize. Everything else is stamped by the silent-churn
// guard so the FIFO progresses.
const ADVANCED_OUTCOMES = new Set(['attached', 'manager_drillthrough', 'already_linked']);

// (b) MANAGER-ENTITY DRILL-THROUGH: the controlling-role pick is a FIRM (a
// management company, not a person). Register the org + a manager edge and route
// the pivot to find a PERSON at the manager. Never mints the firm as a person.
async function runManagerDrillthrough(row, deps) {
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
  return { entity_id: row.entity_id, outcome: 'guard_rejected',
    reason: (org && org.skipped) || 'org_rejected', skipped: org && org.skipped };
}

// (c) EXTERNAL ENRICHMENT for the contactless — ordered chain (Scott's amendment
// 2026-06-20): cross-ref (free) → public-IR terminal → routed adapter
// (deed/SOS/address) → web search → manual-research worklist. Each step that
// can't resolve records WHY; the unresolvable tail is SURFACED, never guess-filled.
async function runExternalEnrichment(row, deps) {
  const action = row.enrichment_action;
  const tried = [];

  // 1. Cross-reference — reuse a contact already established on a RELATED owner
  // (same_asset / same_parent / naming_core). The strategy rides the attach `via`
  // for provenance ('cross_reference:<strategy>'); the source entity is reported.
  const xref = await (deps.crossRef || defaultCrossRef)(row);
  if (xref && xref.ok && xref.person_name) {
    const via = 'cross_reference:' + (xref.strategy || 'unknown');
    const r = await attachPersonToOwner(row, normalizePersonName(xref.person_name), xref.role || 'principal', deps, via);
    return { entity_id: row.entity_id, source: 'cross_reference', strategy: xref.strategy || null,
      source_entity_id: xref.source_entity_id || null, source_owner_name: xref.source_owner_name || null, ...r };
  }
  tried.push({ method: 'cross_reference', reason: (xref && xref.reason) || 'no_sibling' });

  // 2. Public-company IR — a known-IR-contact MANUAL path (not a scraper).
  if (action === 'public_company_ir') {
    return { entity_id: row.entity_id, outcome: 'public_ir_manual', action };
  }

  // 3. Backoff: a manual row already OPEN ⇒ externals were tried before.
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
      const r = await attachPersonToOwner(row, normalizePersonName(res.person_name), res.role || routed.role, deps, routed.source + '_lookup');
      return { entity_id: row.entity_id, source: routed.source, ...r };
    }
    tried.push({ method: routed.source, reason: (res && res.reason) || 'no_result' });
  }

  // 5. Free web search.
  const web = await (deps.webSearch || defaultWebSearch)(row);
  if (web && web.ok && web.person_name) {
    const r = await attachPersonToOwner(row, normalizePersonName(web.person_name), web.role || 'principal', deps, 'web_search');
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

/**
 * Process ONE owner pivot row. Pure orchestration over injected deps.
 * @param row {entity_id, owner_name, workspace_id, active_contact_name,
 *             active_contact_entity_id, active_authority_level, active_contact_role,
 *             enrichment_action}
 */
export async function processOwnerEnrichmentRow(row, deps) {
  const looksPerson = deps.looksLikePersonName || looksLikePersonName;
  const normalize = deps.normalizePersonName || normalizePersonName;

  if (row.active_contact_entity_id) {
    return { entity_id: row.entity_id, outcome: 'already_linked' };
  }

  const personName = row.active_contact_name ? normalize(row.active_contact_name) : null;
  const isPerson = !!(personName && looksPerson(personName));
  let out;

  if (isPerson) {
    // (a) ATTACH a named active contact (a real person), minted with a clean name.
    const r = await attachPersonToOwner(row, personName, row.active_contact_role, deps, 'contact_selection');
    out = { entity_id: row.entity_id, ...r };
    // A guard-rejected / failed "person" is research work — NOT a firm. Do not
    // fall through to the manager-drill branch and mint the person name as an org.
    if (out.outcome !== 'attached') {
      out.disposition = { enrichment_action: 'manual_research',
        active_source: 'attach_failed:' + (r.reason || r.outcome || 'unknown') };
    }
  } else if (row.active_contact_name && Number(row.active_authority_level) <= 2) {
    // (b) MANAGER-ENTITY DRILL-THROUGH: the pick is a FIRM, not a person.
    out = await runManagerDrillthrough(row, deps);
    if (out.outcome !== 'manager_drillthrough') {
      out.disposition = { enrichment_action: 'manual_research',
        active_source: 'drillthrough_failed:' + (out.reason || 'unknown') };
    }
  } else {
    // (c) EXTERNAL ENRICHMENT chain (contactless / non-person picks).
    out = await runExternalEnrichment(row, deps);
  }

  // Silent-churn guard (2026-06-26): every processed row that did NOT already
  // advance the pivot is stamped here so the FIFO `order=updated_at.asc` batch
  // always progresses and the named tail drains, instead of re-serving the same
  // stuck oldest rows every tick. Honest: a non-attach changes state (advances
  // updated_at + records the disposition) but NEVER fabricates a contact.
  if (out && !ADVANCED_OUTCOMES.has(out.outcome)) {
    await touchPivot(deps, row.entity_id, out.disposition);
    delete out.disposition;
  }
  return out;
}

/**
 * Classify what class a pivot row WOULD hit — shared by the batch dry-run and the
 * Phase 5b single-owner preview so the two never drift. Pure.
 */
export function classifyEnrichRow(row, looksPersonImpl) {
  const looksPerson = looksPersonImpl || looksLikePersonName;
  if (row.active_contact_entity_id) return 'already_linked';
  const personName = row.active_contact_name ? normalizePersonName(row.active_contact_name) : null;
  if (personName && looksPerson(personName)) return 'attach_person';
  if (row.active_contact_name && Number(row.active_authority_level) <= 2) return 'manager_drillthrough';
  return row.enrichment_action || 'manual_research';
}

// Resolve classes that need NO external egress (a guard-passed named person /
// a manager drill-through) vs those that need a configured adapter webhook
// (SOS / address / deed / web / public-IR) vs manual research. Cross-reference
// (free sibling reuse) runs inside the external chain, so it isn't a class here.
const FREE_RESOLVE_CLASSES = new Set(['attach_person', 'manager_drillthrough']);
const ADAPTER_RESOLVE_CLASSES = new Set([
  'sos_manager_lookup', 'address_reverse_lookup', 'parse_deed_signatory',
  'find_person_at_manager', 'public_company_ir',
]);

/**
 * Roll a by_action tally (classifyEnrichRow keys) into the acquisition-cost
 * breakdown: how many resolve for FREE, need a configured adapter, or fall to
 * manual research. Pure. `already_linked` is reported separately (nothing to do).
 */
export function summarizeResolution(byAction = {}) {
  const out = { free_resolvable: 0, needs_adapter: 0, manual_research: 0, already_linked: 0 };
  for (const [k, n] of Object.entries(byAction)) {
    if (k === 'already_linked') out.already_linked += n;
    else if (FREE_RESOLVE_CLASSES.has(k)) out.free_resolvable += n;
    else if (ADAPTER_RESOLVE_CLASSES.has(k)) out.needs_adapter += n;
    else out.manual_research += n;   // 'manual_research' + any unknown action
  }
  return out;
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
    // crossRef: the free sibling-reuse resolver (the FRONT of Scott's chain).
    // Resolves a contactless owner's decision-maker by reusing a contact already
    // established on a RELATED owner (same_asset / same_parent / naming_core),
    // guarded + provenance-tagged. Runs over the LCC entity graph (no egress);
    // no confident match ⇒ the row flows on to SOS/web/manual.
    crossRef: buildCrossRefAdapter({ opsQuery }),
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
  // Same auth contract as the sibling worker sub-routes (document-text-tick,
  // lease-backfill, contact-acquisition, developer-chain-resolve, …):
  // authenticate(req, res) returns the user object or null AFTER sending its own
  // 401. It does NOT return an {ok,status} shape — the prior `auth.ok` check read
  // a property the user object never carries, so a valid X-LCC-Key (the daily
  // cron AND the Phase 5b "Run lookup" CTA) still 401'd, so this worker never ran.
  const user = await authenticate(req, res);
  if (!user) return; // authenticate already sent the 401

  // ---- Cross-reference dry-run: size the FREE sibling-reuse yield over the
  // value-ranked contactless worklist BEFORE any real run (no writes). Reports
  // per-strategy counts + a sample of (owner → reused contact, source) pairs so
  // the yield can be eyeballed for correctness. Defaults to the ≥$1M head.
  if (req.query.xref_dryrun) {
    const minValue = req.query.min_value != null ? Number(req.query.min_value) : 1000000;
    const out = await crossRefDryRun({ opsQuery }, { minValue, limit: req.query.limit });
    return res.status(out && out.ok ? 200 : 500).json({ ok: !!(out && out.ok), xref_dryrun: true, ...out });
  }

  // ---- Phase 5b: single-owner one-click run (the worklist "Run lookup" CTA) ----
  // POST &entity_id=<uuid> → ensure the owner's pivot (seed from
  // v_owner_active_contact) and run processOwnerEnrichmentRow on that ONE row.
  // GET &entity_id=<uuid> → non-mutating preview (which class it WOULD hit).
  // Reuses the exact batch core; no fork. Safe by construction (the enrich worker
  // only attaches a guard-passed person or queues research — never guess-fills).
  const entityId = req.query.entity_id;
  if (entityId) {
    const pivotSel = 'owner_contact_pivot?select=entity_id,owner_name,workspace_id,'
      + 'active_contact_name,active_contact_entity_id,active_authority_level,'
      + 'active_contact_role,enrichment_action,status&entity_id=eq.'
      + pgFilterVal(entityId) + '&limit=1';

    if (req.method === 'GET') {
      const pr = await opsQuery('GET', pivotSel);
      const row = (pr.ok && Array.isArray(pr.data)) ? pr.data[0] : null;
      if (!row) return res.status(200).json({ ok: true, single: true, preview: true, would: 'no_pivot' });
      return res.status(200).json({ ok: true, single: true, preview: true, would: classifyEnrichRow(row),
        adapters: { sos: isConfiguredSos(), address: isConfiguredAddress(), deed: isConfiguredDeed() } });
    }

    // POST → ensure the pivot exists (idempotent; seeds from v_owner_active_contact)
    await opsQuery('POST', 'rpc/lcc_ensure_owner_pivot', { p_entity_id: entityId });
    const pr = await opsQuery('GET', pivotSel);
    const row = (pr.ok && Array.isArray(pr.data)) ? pr.data[0] : null;
    if (!row) {
      return res.status(404).json({ ok: false, single: true, outcome: 'no_pivot',
        detail: 'owner has no contact-selection pivot (not bridged with domain signals)' });
    }
    const deps = buildDeps();
    let out;
    try { out = await processOwnerEnrichmentRow(row, deps); }
    catch (e) { out = { entity_id: entityId, outcome: 'error', error: String(e && e.message || e) }; }
    if (out.outcome === 'attached') {
      try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }
    }
    return res.status(200).json({ ok: true, single: true, ...out,
      adapters: { sos: isConfiguredSos(), address: isConfiguredAddress(), deed: isConfiguredDeed() } });
  }

  const dryRun = req.method === 'GET';
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 200);

  // Candidates: pivot rows not yet linked (named → attach/drill-through) +
  // contactless rows carrying an enrichment_action. status locked/superseded are
  // engaged/retired — skip.
  const COLS = 'entity_id,owner_name,workspace_id,active_contact_name,'
    + 'active_contact_entity_id,active_authority_level,active_contact_role,enrichment_action,status';
  const FILTERS = '&active_contact_entity_id=is.null'
    + '&status=in.(active,exhausted)'
    + '&or=(active_contact_name.not.is.null,enrichment_action.not.is.null)';
  // VALUE-RANKED (rank_value DESC) so the worker spends its budget-limited attach
  // effort on the highest-value owners FIRST instead of FIFO — and the value-gated
  // cadence-seed fires on the owners that matter. rank_value comes from the EXISTING
  // R34 value sources (portfolio rollup → R17 connected-property value) via
  // v_owner_contact_enrich_queue; updated_at ASC is the tiebreak that keeps the
  // silent-churn guard progressing among equal-value rows.
  const valueSel = 'v_owner_contact_enrich_queue?select=' + COLS + ',rank_value'
    + FILTERS + '&order=rank_value.desc.nullslast,updated_at.asc&limit=' + limit;
  // Deploy-order-safe fallback: if the value-rank view isn't present yet, drain the
  // table FIFO (the prior behavior) rather than erroring. Reversible — drop the
  // view → the worker silently reverts to least-recently-updated ordering.
  const tableSel = 'owner_contact_pivot?select=' + COLS
    + FILTERS + '&order=updated_at.asc&limit=' + limit;
  let r = await opsQuery('GET', valueSel);
  if (!r.ok) r = await opsQuery('GET', tableSel);
  if (!r.ok) return res.status(r.status || 500).json({ error: 'load_failed', detail: r.data });
  const rows = Array.isArray(r.data) ? r.data : [];

  if (dryRun) {
    const byAction = {};
    for (const row of rows) {
      const k = classifyEnrichRow(row);
      byAction[k] = (byAction[k] || 0) + 1;
    }
    return res.status(200).json({ ok: true, dry_run: true, candidates: rows.length, by_action: byAction,
      // Phase 2 — quantify the acquisition-cost picture so Scott can make the
      // paid-web-search / walled-SOS call with real numbers: how many resolve
      // for FREE now (attach a named person / drill through a manager — no
      // external egress) vs need a configured adapter (SOS/address/deed/web) vs
      // fall to manual research.
      resolution_breakdown: summarizeResolution(byAction),
      adapters: { sos: isConfiguredSos(), address: isConfiguredAddress(), deed: isConfiguredDeed() } });
  }

  const deps = buildDeps();
  const started = Date.now();
  const summary = { processed: 0, attached: 0, drillthrough: 0, failed: 0, skipped: 0, results: [] };
  let attachedAny = false;
  const FAIL_OUTCOMES = new Set(['guard_rejected', 'link_failed', 'patch_failed', 'error']);
  for (const row of rows) {
    if (Date.now() - started > WALL_CLOCK_MS) break;
    let out;
    try { out = await processOwnerEnrichmentRow(row, deps); }
    catch (e) {
      out = { entity_id: row.entity_id, outcome: 'error', error: String(e && e.message || e) };
      // A throw before the in-row finalize would leave updated_at frozen and the
      // row would re-serve at the head of the FIFO forever — advance it so the
      // batch always progresses (silent-churn guard, defense-in-depth).
      await touchPivot(deps, row.entity_id, { active_source: 'error:' + String(e && e.message || e).slice(0, 80) });
    }
    summary.processed += 1;
    if (out.outcome === 'attached') { summary.attached += 1; attachedAny = true; }
    else if (out.outcome === 'manager_drillthrough') summary.drillthrough += 1;
    else if (FAIL_OUTCOMES.has(out.outcome)) summary.failed += 1;
    else summary.skipped += 1;
    summary.results.push(out);
  }

  // Attaching makes owners connected/reachable → refresh the queue cache once.
  if (attachedAny) { try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ } }

  return res.status(200).json({ ok: true, ...summary });
}
