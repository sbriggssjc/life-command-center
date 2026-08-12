// api/_handlers/contact-acquisition-engine.js
// ============================================================================
// W9.1 (Prompt 98) — Contact-acquisition engine, STAGE 1 (internal sources).
// ----------------------------------------------------------------------------
// The lever on the 68-73% no-contact gap. For the value-ranked pool of true owners
// with NO contact (ops v_owner_contact_worklist), run the sanctioned acquisition
// chain per owner in COST ORDER, STOPPING AT FIRST SUCCESS. Every stage emits a
// PROPOSAL (never a direct write) into the Decision Center contact_acquisition_review
// lane; a HUMAN verdict resolves it into the ops entity graph via the shared
// contact-attach helpers.
//
//   GET  → dry-run report (no writes).
//   GET ?score=1&n=  → dry-run + inline proposal sample (no writes).
//   POST → apply: upsert proposals (flag-gated; no-ops while W9_1_CONTACT_ACQUISITION off).
//
// STAGE 1 stages (pluggable — the runner takes a stage list so Stage 2 SOS-direct
// slots in later without rework; web-search proxy stays PAUSED):
//   1a crossref     — an existing person under a DIFFERENT owner (lcc_resolve_owner_
//                     cross_reference) → ATTACH.
//   1a institution  — an institution-registry contact (lcc_resolve_institution_contact)
//                     → ATTACH (or mint-from-registry).
//   1b deed_signatory — a signatory name in the owner's own deed text → MINT
//                     (VERBATIM-quoted; validator drops a non-verbatim name).
//   1c broker_of_record — the listing broker on the sale that conveyed the asset →
//                     ATTACH/MINT, ALWAYS typed broker_of_record (never a direct
//                     owner contact).
//
// House pattern: windowed + cursored pool walk (anti-joins its own proposals — the
// 92-class guard), value-gated + capped, budget-floored, batched lookups, per-stage
// counts + loud scan_errors, reversible ledger, flag-gated, proposal-only.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import {
  STAGE_CROSSREF, STAGE_INSTITUTION, STAGE_DEED, STAGE_BROKER, STAGE_SOS,
  valueGateOwners, runStagesForOwner, finalizeProposal, normDomain, resolveStageOrder,
  buildCrossrefProposal, buildInstitutionProposal, buildDeedSignatoryProposal, buildBrokerProposal,
  buildSosProposal,
} from '../_shared/contact-acquisition-planner.js';
import { buildSosLookupAdapter } from '../_shared/sos-lookup.js';

function envFlagOn(name) {
  const v = String(process.env[name] || '').toLowerCase();
  return ['on', '1', 'true', 'yes', 'enabled'].includes(v);
}
export function contactAcquisitionEnabled(flagRow) {
  if (envFlagOn('W9_1_CONTACT_ACQUISITION')) return true;
  return String(flagRow?.state || '').toLowerCase() === 'on';
}
async function fetchFlagRow() {
  const r = await opsQuery('GET',
    'feature_flags_registry?flag=eq.W9_1_CONTACT_ACQUISITION&select=flag,state&limit=1',
    undefined, { countMode: 'none' });
  return r.ok && Array.isArray(r.data) ? r.data[0] : null;
}

// W9.1 Stage 2 — SOS-direct. Enabled ⇒ the runner appends the STAGE_SOS fetch (via
// the residential proxy). Off ⇒ the order is Stage-1 only (honest-blocked, no fetch).
export function sosDirectEnabled(flagRow) {
  if (envFlagOn('W9_1_SOS_DIRECT')) return true;
  return String(flagRow?.state || '').toLowerCase() === 'on';
}
async function fetchSosFlagRow() {
  const r = await opsQuery('GET',
    'feature_flags_registry?flag=eq.W9_1_SOS_DIRECT&select=flag,state&limit=1',
    undefined, { countMode: 'none' });
  return r.ok && Array.isArray(r.data) ? r.data[0] : null;
}

// The SOS fetch seam — POSTs to OWNER_ENRICH_SOS_URL (which fronts the fetch+parse
// service; that service reaches the SOS site through the GaryBuilt residential proxy).
// Attaches the DEDICATED CF Access service-token headers (never the ollama token) so
// the request passes the proxy hostname's Access policy. Unset URL ⇒ the sos-lookup
// adapter returns `unconfigured` and STAGE_SOS no-ops (honest-blocked).
export function sosWebhookFetcher() {
  const url = process.env.OWNER_ENRICH_SOS_URL;
  if (!url) return undefined;
  return async function postSos(adapter, name, state) {
    const headers = { 'content-type': 'application/json' };
    if (process.env.SOS_PROXY_CF_ACCESS_CLIENT_ID && process.env.SOS_PROXY_CF_ACCESS_CLIENT_SECRET) {
      headers['CF-Access-Client-Id'] = process.env.SOS_PROXY_CF_ACCESS_CLIENT_ID;
      headers['CF-Access-Client-Secret'] = process.env.SOS_PROXY_CF_ACCESS_CLIENT_SECRET;
    }
    if (process.env.SOS_PROXY_TOKEN) headers['authorization'] = 'Bearer ' + process.env.SOS_PROXY_TOKEN;
    const body = JSON.stringify({ args: [{ state: adapter && adapter.state, name, search_hint: adapter && adapter.search_hint }, name, state] });
    const resp = await fetch(url, { method: 'POST', headers, body });
    if (!resp.ok) throw new Error('OWNER_ENRICH_SOS_URL ' + resp.status);
    return await resp.json();
  };
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────
export async function handleContactAcquisitionEngineTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const scoreMode = req.query.score === '1' || req.query.score === 'true';
  const inlineN = Math.min(30, Math.max(1, parseInt(req.query.n || '8', 10) || 8));

  // Budget floors / batch knobs (env-tunable, all Math.max(floor, env||default)).
  const MAX_OWNERS = Math.max(20, parseInt(process.env.CONTACT_ACQ_MAX_OWNERS || '40', 10));
  const OVERFETCH = Math.min(1000, Math.max(MAX_OWNERS, MAX_OWNERS * 8));
  const MIN_VALUE = Math.max(0, parseInt(process.env.CONTACT_ACQ_MIN_VALUE || '0', 10));
  const BUDGET_MS = Math.max(5000, parseInt(process.env.CONTACT_ACQ_BUDGET_MS || '45000', 10));
  const deadline = Date.now() + BUDGET_MS;

  const flagRow = await fetchFlagRow();
  const enabled = contactAcquisitionEnabled(flagRow);
  const sosFlagRow = await fetchSosFlagRow();
  const sosEnabled = sosDirectEnabled(sosFlagRow);
  // SOS is the expensive last resort — cap live fetches per tick (weekly cadence; the
  // cron POSTs weekly). Bounded per the house pattern; 0 ⇒ effectively off.
  const SOS_MAX = sosEnabled ? Math.max(0, parseInt(process.env.CONTACT_ACQ_SOS_MAX || '15', 10)) : 0;
  let sosAttempts = 0;

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    flag_state: String(flagRow?.state || 'off'),
    flag_enabled: enabled,
    sos_flag_state: String(sosFlagRow?.state || 'off'),
    sos_enabled: sosEnabled,
    scanned_owners: 0,
    owners_with_proposal: 0,
    stages: { crossref: 0, institution: 0, deed_signatory: 0, broker_of_record: 0, sos_direct: 0 },
    proposed: 0,
    dropped: 0,
    already_proposed_excluded: 0,
    no_source: 0,
    budget_stopped: false,
    scan_errors: [],
    items: [],
  };

  // POST-apply is inert while the flag is off (the cron POSTs nightly; no-op).
  if (!dryRun && !enabled) {
    result.note = 'W9_1_CONTACT_ACQUISITION off — apply no-op (dry-run GET still reports).';
    return res.status(200).json(result);
  }

  // ── Pool: value-ranked contactless owners (v_owner_contact_worklist). Windowed +
  // over-fetched so already-proposed/decided owners can be anti-joined in JS and the
  // per-tick budget still fills with workable owners (the 92-class cursor guard).
  let poolPath = 'v_owner_contact_worklist?select=entity_id,owner_name,rank_value,primary_domain'
    + '&order=rank_value.desc.nullslast&limit=' + OVERFETCH;
  if (MIN_VALUE > 0) poolPath += '&rank_value=gte.' + MIN_VALUE;
  const poolRes = await opsQuery('GET', poolPath);
  if (!poolRes.ok) {
    return res.status(502).json({ error: 'owner worklist read failed', detail: poolRes.data });
  }
  const pool = valueGateOwners(Array.isArray(poolRes.data) ? poolRes.data : []);

  // Anti-join: owners that already carry an OPEN or DECIDED proposal for ANY stage
  // are excluded (the 92-class guard — walk the pool, never re-hammer the head).
  const ownerIds = pool.map((o) => o.entity_id).filter(Boolean);
  const decided = new Set();
  for (let i = 0; i < ownerIds.length; i += 100) {
    const inList = ownerIds.slice(i, i + 100).map(pgFilterVal).join(',');
    const r = await opsQuery('GET',
      'contact_acquisition_review?owner_entity_id=in.(' + inList + ')&select=owner_entity_id&limit=1000',
      undefined, { countMode: 'none' });
    if (r.ok && Array.isArray(r.data)) for (const row of r.data) decided.add(String(row.owner_entity_id));
  }
  const workable = pool.filter((o) => !decided.has(String(o.entity_id)));
  result.already_proposed_excluded = pool.length - workable.length;

  const owners = workable.slice(0, MAX_OWNERS);
  result.scanned_owners = owners.length;
  if (owners.length === 0) {
    return res.status(200).json(result);
  }

  // ── Batched cross-DB reads for the deed + broker stages (built ONCE per tick — no
  // per-owner fan-out). Owner → {domain, property_id} via lcc_entity_portfolio_facts;
  // then per domain a single deed_records + sales_transactions read over those ids.
  const propMap = await buildOwnerPropertyMap(owners.map((o) => o.entity_id), result.scan_errors);
  const brokerByOwner = await buildBrokerMap(propMap, result.scan_errors);
  const deedByOwner = await buildDeedMap(propMap, result.scan_errors);

  // Stage-2 SOS adapter (built ONCE per tick when enabled). It reuses the sos-lookup
  // framework's state inference + person guards; the fetch seam carries the CF Access
  // headers to the residential proxy. Unconfigured (no OWNER_ENRICH_SOS_URL or no
  // enabled adapter) ⇒ returns { ok:false, reason:'unconfigured' } and STAGE_SOS no-ops.
  const stageOrder = resolveStageOrder(sosEnabled);
  const sosLookup = sosEnabled ? buildSosLookupAdapter({ fetch: sosWebhookFetcher() }) : null;

  // ── Per-owner stage runner: cost-ordered, STOP AT FIRST SUCCESS. Stage fns are
  // pure map lookups (deed/broker) or a cheap per-owner RPC (crossref/institution).
  const droppedRows = [];
  const finalized = [];
  for (const owner of owners) {
    if (Date.now() > deadline) { result.budget_stopped = true; break; }
    const stageFns = {
      [STAGE_CROSSREF]: async (o) => {
        try {
          const r = await opsQuery('POST', 'rpc/lcc_resolve_owner_cross_reference', { p_entity_id: o.entity_id });
          const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
          return buildCrossrefProposal(o, row);
        } catch (e) { result.scan_errors.push({ stage: 'crossref', owner: o.entity_id, error: String(e && e.message || e) }); return null; }
      },
      [STAGE_INSTITUTION]: async (o) => {
        try {
          const r = await opsQuery('POST', 'rpc/lcc_resolve_institution_contact', { p_entity_id: o.entity_id });
          const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
          return buildInstitutionProposal(o, row);
        } catch (e) { result.scan_errors.push({ stage: 'institution', owner: o.entity_id, error: String(e && e.message || e) }); return null; }
      },
      [STAGE_DEED]: async (o) => {
        const sig = (deedByOwner.get(String(o.entity_id)) || [])[0];
        if (!sig) return null;
        const built = buildDeedSignatoryProposal(o, sig);
        if (built && built.drop) {
          droppedRows.push({ owner, stage: STAGE_DEED, name: built.drop.name, quote: built.drop.quote, reason: built.drop.reason });
          return null;
        }
        return built && built.proposal ? built.proposal : null;
      },
      [STAGE_BROKER]: async (o) => {
        const b = (brokerByOwner.get(String(o.entity_id)) || [])[0];
        if (!b) return null;
        return buildBrokerProposal(o, b);
      },
      // Stage 2 — SOS-direct (only present when enabled; the runner reaches it only
      // if every internal stage returned null). Bounded by SOS_MAX live fetches/tick.
      ...(sosLookup ? { [STAGE_SOS]: async (o) => {
        if (sosAttempts >= SOS_MAX) return null;
        sosAttempts++;
        try {
          const res = await sosLookup({ owner_name: o.owner_name, owner_state: o.owner_state, state_of_incorporation: o.state_of_incorporation });
          return buildSosProposal(o, res);
        } catch (e) { result.scan_errors.push({ stage: 'sos_direct', owner: o.entity_id, error: String(e && e.message || e) }); return null; }
      } } : {}),
    };
    // eslint-disable-next-line no-await-in-loop
    const outcome = await runStagesForOwner(owner, stageFns, stageOrder);
    if (!outcome.proposal) { result.no_source++; continue; }
    const row = finalizeProposal(owner, outcome.proposal);
    finalized.push(row);
    result.stages[row.stage] = (result.stages[row.stage] || 0) + 1;
    result.owners_with_proposal++;
  }
  result.dropped = droppedRows.length;

  // ── Dry-run: inline sample (?score=1&n=) or a summary; NO writes. ──────────
  if (dryRun) {
    if (scoreMode) {
      result.items = finalized.slice(0, inlineN).map((p) => ({
        stage: p.stage, proposed_kind: p.proposed_kind, owner_name: p.owner_name,
        rank_value: p.rank_value, candidate_name: p.candidate_name,
        proposed_contact_role: p.proposed_contact_role, confidence: p.confidence,
        evidence_quote: p.evidence_quote, evidence_source: p.evidence_source, reason: p.reason,
      }));
    }
    result.proposed = finalized.length;
    return res.status(200).json(result);
  }

  // ── Apply (flag-gated, reached only when enabled): write a scan batch ledger,
  // upsert proposals (on_conflict=subject_ref — idempotent), log the dropped rows.
  const sourceRunId = 'contact-acq-' + Date.now().toString(36);
  let scanBatchId = null;
  try {
    const b = await opsQuery('POST', 'contact_acquisition_batch',
      { batch_kind: 'scan', source_run_id: sourceRunId, actor: user.id,
        details: { scanned_owners: result.scanned_owners, stages: result.stages, dropped: result.dropped, scan_errors: result.scan_errors.slice(0, 20) } },
      { Prefer: 'return=representation' });
    if (b.ok && Array.isArray(b.data) && b.data[0]) scanBatchId = b.data[0].batch_id;
  } catch (e) { result.scan_errors.push({ stage: 'batch', error: String(e && e.message || e) }); }

  let written = 0;
  for (const p of finalized) {
    try {
      const w = await opsQuery('POST', 'contact_acquisition_review?on_conflict=subject_ref',
        Object.assign({}, p, { source_run_id: sourceRunId, scan_batch_id: scanBatchId }),
        { Prefer: 'resolution=merge-duplicates,return=minimal' });
      if (w.ok) written++;
      else result.scan_errors.push({ stage: 'write', subject_ref: p.subject_ref, status: w.status, detail: w.data });
    } catch (e) { result.scan_errors.push({ stage: 'write', subject_ref: p.subject_ref, error: String(e && e.message || e) }); }
  }
  for (const d of droppedRows) {
    try {
      await opsQuery('POST', 'contact_acquisition_dropped_log',
        { subject_ref: null, stage: d.stage, domain: normDomain(d.owner.primary_domain || ''),
          owner_entity_id: d.owner.entity_id, proposed_name: d.name, quote: d.quote, reason: d.reason, source_run_id: sourceRunId },
        { Prefer: 'return=minimal' });
    } catch (_e) { /* audit-only, non-fatal */ }
  }
  result.proposed = written;
  return res.status(200).json(result);
}

// ── Batched read helpers (built ONCE per tick — no per-owner fan-out). ────────

// Owner → [{ domain, property_id }] via lcc_entity_portfolio_facts (current rows).
async function buildOwnerPropertyMap(ownerIds, scanErrors) {
  const map = new Map();
  for (let i = 0; i < ownerIds.length; i += 100) {
    const inList = ownerIds.slice(i, i + 100).map(pgFilterVal).join(',');
    try {
      const r = await opsQuery('GET',
        'lcc_entity_portfolio_facts?entity_id=in.(' + inList + ')&is_current=eq.true'
        + '&select=entity_id,source_domain,source_property_id&limit=1000', undefined, { countMode: 'none' });
      if (r.ok && Array.isArray(r.data)) {
        for (const row of r.data) {
          if (!row.entity_id || !row.source_property_id) continue;
          const key = String(row.entity_id);
          if (!map.has(key)) map.set(key, []);
          map.get(key).push({ domain: normDomain(row.source_domain), property_id: String(row.source_property_id) });
        }
      }
    } catch (e) { scanErrors.push({ stage: 'portfolio_map', error: String(e && e.message || e) }); }
  }
  return map;
}

// Group a propMap by domain → the set of property_ids to read once.
function propsByDomain(propMap) {
  const byDomain = { dia: new Set(), gov: new Set() };
  for (const list of propMap.values()) {
    for (const p of list) {
      if (p.domain === 'dia' || p.domain === 'gov') byDomain[p.domain].add(p.property_id);
    }
  }
  return byDomain;
}

// property_id → listing broker (name/firm/sale_id), read once per domain.
async function buildBrokerMap(propMap, scanErrors) {
  const byDomain = propsByDomain(propMap);
  const brokerByProp = new Map(); // 'dia:123' -> { broker_name, broker_firm, sale_id }
  for (const domain of ['dia', 'gov']) {
    const ids = [...byDomain[domain]];
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      const inList = slice.map((v) => '"' + String(v).replace(/"/g, '') + '"').join(',');
      try {
        const r = await domainQuery(domain, 'GET',
          'sales_transactions?property_id=in.(' + encodeURIComponent(inList) + ')'
          + '&listing_broker=not.is.null&select=property_id,listing_broker,sale_id&limit=1000',
          undefined, {}, {});
        if (r.ok && Array.isArray(r.data)) {
          for (const row of r.data) {
            const key = domain + ':' + String(row.property_id);
            if (!brokerByProp.has(key) && row.listing_broker) {
              brokerByProp.set(key, { broker_name: row.listing_broker, sale_id: row.sale_id != null ? String(row.sale_id) : null });
            }
          }
        }
      } catch (e) { scanErrors.push({ stage: 'broker_read', domain, error: String(e && e.message || e) }); }
    }
  }
  // Fold property-level broker rows up to the owner.
  const byOwner = new Map();
  for (const [ownerId, list] of propMap.entries()) {
    const hits = [];
    for (const p of list) {
      const b = brokerByProp.get(p.domain + ':' + p.property_id);
      if (b) hits.push(Object.assign({ domain: p.domain, property_id: p.property_id }, b));
    }
    if (hits.length) byOwner.set(ownerId, hits);
  }
  return byOwner;
}

// property_id → deed signatory (from deed_records.raw_payload), read once per domain.
// deed_records has NO signatory column — the signatory name is parsed into the deed
// document text/raw_payload. We read it fill-safe; absent ⇒ honest zero (Stage 1 is
// input-thin here until the deed OCR/signatory backfill lands — surfaced, not faked).
async function buildDeedMap(propMap, scanErrors) {
  const byDomain = propsByDomain(propMap);
  const deedByProp = new Map();
  for (const domain of ['dia', 'gov']) {
    const ids = [...byDomain[domain]];
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      const inList = slice.map((v) => '"' + String(v).replace(/"/g, '') + '"').join(',');
      try {
        const r = await domainQuery(domain, 'GET',
          'deed_records?property_id=in.(' + encodeURIComponent(inList) + ')'
          + '&select=property_id,deed_id,document_number,grantee,grantee_address,raw_payload&limit=1000',
          undefined, {}, {});
        if (r.ok && Array.isArray(r.data)) {
          for (const row of r.data) {
            const key = domain + ':' + String(row.property_id);
            if (deedByProp.has(key)) continue;
            const rp = row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
            const sigName = rp.signatory_name || rp.signatory || (rp.deed_extraction && rp.deed_extraction.signatory_name) || null;
            if (!sigName) continue; // no signatory captured on this deed → skip (honest zero)
            const evidenceText = String(rp.text || rp.raw_text || rp.body || row.grantee || '');
            deedByProp.set(key, {
              name: sigName,
              title: rp.signatory_title || null,
              quote: rp.signatory_quote || evidenceText,
              evidence_text: evidenceText,
              document_id: row.document_number || null,
              deed_id: row.deed_id != null ? String(row.deed_id) : null,
              property_id: String(row.property_id),
              domain,
            });
          }
        }
      } catch (e) { scanErrors.push({ stage: 'deed_read', domain, error: String(e && e.message || e) }); }
    }
  }
  const byOwner = new Map();
  for (const [ownerId, list] of propMap.entries()) {
    const hits = [];
    for (const p of list) {
      const d = deedByProp.get(p.domain + ':' + p.property_id);
      if (d) hits.push(d);
    }
    if (hits.length) byOwner.set(ownerId, hits);
  }
  return byOwner;
}
