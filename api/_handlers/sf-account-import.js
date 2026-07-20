// api/_handlers/sf-account-import.js
// ============================================================================
// SF Get Accounts — bulk Account → LCC-org (Name) map ingest endpoint.
// ----------------------------------------------------------------------------
// GET  /api/sf-account-import                 — dry-run (counts only, no writes)
// POST /api/sf-account-import { accounts:[{Id,Name}, …] }
//                                             — mint/attach the org carrying the
//                                               salesforce/Account identity
// GET/POST /api/sf-account-import?backfill=1[&limit=N]
//                                             — resolve already-ingested list
//                                               members that recorded a
//                                               `raw.sf_account_id_unresolved`
//                                               once its Account is now known
//
// WHY. The SF-list ingest (`sf-list-import`) can only resolve an AccountId that
// LCC ALREADY holds as a salesforce/Account identity — of the members carrying an
// AccountId, ~76% pointed at an Account LCC had never seen, so they recorded
// `raw.sf_account_id_unresolved` and left `company_name` NULL. A simple flat
// `Account (Id, Name)` pull from Salesforce fills that map: minting each org here
// makes its AccountId resolvable, and the `backfill` pass retro-fixes the members
// that were waiting on it (no 90-minute PA CampaignMember re-run needed).
//
// This is the SIMPLE pull — no chunking, no OData node limit, no Contact resolve
// (the chunking saga was caused by `CampaignMember.Id eq …` filters; a flat Get on
// Account has none of that).
//
// ── NEEDED-ONLY FILTER (default) ────────────────────────────────────────────
// Scott's SF org is 100,000+ Accounts; minting an org entity for EACH would grow
// `entities` ~45.8k → ~146k. On 2026-07-19 a +6,545-entity seed alone degraded
// `v_priority_queue_live` >60s and saturated the LCC-Opps connection pool (auth
// lives on this DB) — a 100k increment is ~15× that. And LCC needs exactly the
// ~4,667 accounts referenced by contactless `lcc_sf_list_membership` rows; the
// rest is pulled only to be discarded (Northmarq internal offices/program buckets,
// individuals, …). So by DEFAULT we persist ONLY accounts LCC actually needs:
//   * the account is in the "needed set" (a member's `raw.sf_account_id_unresolved`
//     awaiting resolution), OR
//   * the account is ALREADY known to LCC (an existing salesforce/Account
//     identity — persisting refreshes the name and CANNOT grow the entity table).
// Everything else is skipped (`accounts_skipped_not_needed`), never minted. The
// needed set + the known set are each fetched ONCE per batch (bounded queries, no
// N+1). `?all=1` restores the old persist-everything behavior for the rare case
// Scott deliberately wants a full account mirror (adds ~100k entities — do not use
// casually). The `backfill` pass is unchanged and, by construction, can never
// strand a member: the needed set IS the members' unresolved ids, so every account
// a member references is always persisted.
//
// Reuse (never fork): ensureEntityLink (org mint + guards + the salesforce/Account
// identity write, deduped by external-identity then canonical_name → idempotent),
// linkPersonToEntity (person→org works_at edge — the same relate processMember
// does). sf-id (toSf18 / sf15 / isAccountId — 15/18-safe, Account-only).
// LCC-Opps only; no SF writes; no dia/gov writes; additive; reversible; never
// fabricate a name.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal, resolvePrimaryWorkspaceId } from '../_shared/ops-db.js';
import { ensureEntityLink } from '../_shared/entity-link.js';
import { linkPersonToEntity } from '../_shared/contact-attach.js';
import { sf15, toSf18, isAccountId } from '../_shared/sf-id.js';

const ACCOUNT_CAP = 500;             // hard cap of accounts processed per POST
const BUDGET_MS = 22000;             // wall-clock budget per tick
const DEFAULT_BACKFILL_LIMIT = 500;
const MAX_BACKFILL_LIMIT = 1000;

function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { return {}; } }
  return b;
}

// Tolerant scalar read across spellings (the connector/flow shape varies).
function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

/**
 * Normalize ONE inbound account row → a classified result. Pure.
 *   { id18, name }              — usable (Account id + non-blank name)
 *   { skip:'bad_id', name }     — no valid 15/18-char Account (001…) id
 *   { skip:'no_name', id18 }    — valid id but blank/missing Name (never fabricated)
 */
export function normalizeAccountRow(raw) {
  const rawId = pick(raw, 'Id', 'id', 'AccountId', 'account_id', 'accountId');
  const rawName = pick(raw, 'Name', 'name', 'AccountName', 'account_name');
  const name = rawName == null ? '' : String(rawName).trim();
  const id18 = toSf18(rawId);                         // 15/18-safe → canonical 18; null if malformed
  if (!id18 || !isAccountId(id18)) return { skip: 'bad_id', name: name || null };
  if (!name) return { skip: 'no_name', id18 };
  return { id18, name };
}

/**
 * Resolve a set of SF Account ids to their LCC org { name, entity_id } via the
 * external_identities → entities join, in a BOUNDED number of queries (NOT one
 * per id). Mirrors buildAccountNameMap but keyed off a raw id list (the backfill
 * feed) and also returns entity_id (the authoritative org carrying the Account
 * identity). Returns a Map keyed by the 15-char case-sensitive natural key (sf15)
 * so a 15-char member id and an 18-char stored id resolve to the same entry.
 *
 * deps.query: opsQuery-shaped (method, path) => { ok, data }  (injectable).
 * deps.enc:   value → PostgREST-safe string (defaults to pgFilterVal).
 * Pure over its injected query — no direct DB import.
 */
export async function resolveAccountNamesByIds(ids, deps = {}) {
  const query = deps.query;
  const enc = deps.enc || pgFilterVal;
  const out = new Map();                              // sf15 -> { name, entity_id }
  if (typeof query !== 'function' || !Array.isArray(ids)) return out;

  // Distinct keys (sf15) + the exact id-forms to probe (18-canonical + 15-base).
  const keys = new Set();
  const forms = new Set();
  for (const raw of ids) {
    const k = sf15(raw);
    if (!k || keys.has(k)) continue;
    keys.add(k);
    const s18 = toSf18(k);
    if (s18) forms.add(s18);
    forms.add(k);
  }
  if (!keys.size) return out;

  // 1) external_identities Account rows → entity_id (chunked in.() lists).
  const entByKey = new Map();                          // sf15 -> entity_id
  const formList = Array.from(forms);
  for (let i = 0; i < formList.length; i += 80) {
    const inList = formList.slice(i, i + 80).map(enc).join(',');
    if (!inList) continue;
    const r = await query('GET', 'external_identities?source_system=eq.salesforce&source_type=eq.Account'
      + '&external_id=in.(' + inList + ')&select=entity_id,external_id');
    if (r && r.ok && Array.isArray(r.data)) {
      for (const row of r.data) {
        const kk = sf15(row.external_id);
        if (kk && row.entity_id && !entByKey.has(kk)) entByKey.set(kk, row.entity_id);
      }
    }
  }
  if (!entByKey.size) return out;

  // 2) entities.name for the resolved entity ids.
  const entityIds = Array.from(new Set([...entByKey.values()]));
  const nameById = new Map();
  for (let i = 0; i < entityIds.length; i += 100) {
    const inList = entityIds.slice(i, i + 100).map(enc).join(',');
    if (!inList) continue;
    const r = await query('GET', 'entities?id=in.(' + inList + ')&select=id,name');
    if (r && r.ok && Array.isArray(r.data)) {
      for (const row of r.data) if (row.id && row.name) nameById.set(row.id, row.name);
    }
  }
  for (const [k, eid] of entByKey) {
    const nm = nameById.get(eid);
    if (nm) out.set(k, { name: nm, entity_id: eid });
  }
  return out;
}

// ── Needed / known account-key sets (built ONCE per batch — no N+1) ─────────

/**
 * The "needed set": the DISTINCT `raw.sf_account_id_unresolved` values on
 * contactless `lcc_sf_list_membership` rows — the exact ~4,667 accounts a member
 * is waiting on. Keyed by the 15-char natural key (sf15) so a 15-char member id
 * and an 18-char posted id land in the same bucket. Paged 1000/row (PostgREST
 * cap) selecting ONLY the id (a tiny jsonb projection — never the whole `raw`).
 * deps.query: opsQuery-shaped (method, path) => { ok, data }  (injectable).
 */
export async function buildNeededAccountKeys(deps = {}) {
  return new Set((await buildNeededAccountIdMap(deps)).keys());
}

/**
 * Same "needed set" as buildNeededAccountKeys, but keeps the ACTUAL id (canonical
 * 18-char form) per key — the targeted SF-record-sync worker needs the ids to
 * fetch them by Id, not just the sf15 keys. Returns Map<sf15, id18>, deduped by
 * sf15 (a member id may appear 15 or 18-char across rows). Paged 1000/row
 * (PostgREST cap) selecting ONLY the id (a tiny jsonb projection). deps.query
 * injectable.
 */
export async function buildNeededAccountIdMap(deps = {}) {
  const query = deps.query || opsQuery;
  const map = new Map();                               // sf15 -> id18 (canonical)
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const r = await query('GET',
      'lcc_sf_list_membership?company_name=is.null&raw->>sf_account_id_unresolved=not.is.null'
      + '&select=acct:raw->>sf_account_id_unresolved&order=id.asc&limit=' + PAGE + '&offset=' + offset);
    const data = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
    for (const row of data) {
      const k = sf15(row && row.acct);
      if (!k || map.has(k)) continue;
      map.set(k, toSf18(k) || String(row.acct));       // canonical 18 (fallback: raw)
    }
    if (data.length < PAGE) break;                     // paged past the end
  }
  return map;
}

/**
 * The "known set": the sf15 of every posted account that ALREADY carries a
 * salesforce/Account identity in LCC. Probed in bounded `in.()` chunks over the
 * batch's ids (both 18-canonical + 15-base forms, so a stored 15 or 18 matches) —
 * NOT one query per account. Used so an already-tracked account is still persisted
 * (name refresh, zero entity growth) even when no member currently needs it.
 * deps.query / deps.enc injectable.
 */
export async function fetchKnownAccountKeys(id18List, deps = {}) {
  const query = deps.query || opsQuery;
  const enc = deps.enc || pgFilterVal;
  const known = new Set();                             // sf15 already in external_identities
  if (!Array.isArray(id18List) || !id18List.length) return known;

  const keys = new Set();
  const forms = new Set();
  for (const id of id18List) {
    const k = sf15(id);
    if (!k || keys.has(k)) continue;
    keys.add(k);
    const s18 = toSf18(k);
    if (s18) forms.add(s18);
    forms.add(k);
  }
  const formList = Array.from(forms);
  for (let i = 0; i < formList.length; i += 80) {
    const inList = formList.slice(i, i + 80).map(enc).join(',');
    if (!inList) continue;
    const r = await query('GET', 'external_identities?source_system=eq.salesforce&source_type=eq.Account'
      + '&external_id=in.(' + inList + ')&select=external_id');
    if (r && r.ok && Array.isArray(r.data)) {
      for (const row of r.data) { const kk = sf15(row && row.external_id); if (kk) known.add(kk); }
    }
  }
  return known;
}

// ── Exact-count helper (Content-Range, no rows fetched) ─────────────────────
// selectCol must be a column the target table actually has (external_identities
// has no `id`, so callers pass a real column like `entity_id`).
async function countExact(path, selectCol = 'id') {
  const r = await opsQuery('GET', path + (path.includes('?') ? '&' : '?') + 'select=' + selectCol + '&limit=1',
    { countMode: 'exact' });
  return (r && typeof r.count === 'number') ? r.count : 0;
}

// ── Account-import (POST) ───────────────────────────────────────────────────

/**
 * Persist ONE normalized account row (`{id18, name}`) → mint/attach the org
 * carrying the salesforce/Account identity. The SINGLE upsert both the bulk
 * import (importAccounts) AND the targeted SF-record-sync worker call, so the
 * mint semantics can't drift. ensureEntityLink dedups by external-identity then
 * canonical_name (idempotent — a re-run reports ~0 created), applies the junk/
 * structural guards, and NEVER fabricates (a blank name is screened by
 * normalizeAccountRow before this is reached). Reversible via
 * metadata.via='sf_account_import'.
 *   → { ok:true, created, matched, entityId }  on success
 *   → { ok:false, skipped }                    when the guard/link refuses
 * deps.ensureLink injectable (defaults to ensureEntityLink).
 */
export async function persistAccountRow(n, ctx, deps = {}) {
  const ensureLink = deps.ensureLink || ensureEntityLink;
  const { workspaceId, userId } = ctx || {};
  let link;
  try {
    link = await ensureLink({
      workspaceId, userId,
      sourceSystem: 'salesforce', sourceType: 'Account', externalId: n.id18,
      seedFields: { name: n.name, org_type: 'company' },
      domain: 'lcc',
      metadata: { via: 'sf_account_import' },
    });
  } catch (e) {
    return { ok: false, skipped: String((e && e.message) || e) };
  }
  if (!link || !link.ok || !link.entityId) {
    return { ok: false, skipped: (link && link.skipped) || 'guard' };
  }
  return { ok: true, created: !!link.createdEntity, matched: !link.createdEntity, entityId: link.entityId };
}

export async function importAccounts(accounts, ctx, deps = {}) {
  const { workspaceId, userId, result, deadline, all } = ctx;
  const ensureLink = deps.ensureLink || ensureEntityLink;

  // Normalize the whole batch up-front so the filter sets are built over the
  // valid ids (and so the needed/known lookups are one-per-batch, not per-account).
  const rows = accounts.slice(0, ACCOUNT_CAP).map((raw) => normalizeAccountRow(raw));

  // Default (filtered) mode: fetch the needed set + the already-known set ONCE.
  let neededKeys = null, knownKeys = null;
  if (!all) {
    neededKeys = await buildNeededAccountKeys(deps);
    result.needed_set_size = neededKeys.size;
    // One log line per request so a run's receipts show what it filtered against.
    console.log('[sf-account-import] needed-set size=' + neededKeys.size
      + ' (distinct account ids awaited by contactless list members)');
    const validIds = rows.filter((n) => n.id18).map((n) => n.id18);
    knownKeys = await fetchKnownAccountKeys(validIds, deps);
  }

  for (const n of rows) {
    if (Date.now() > deadline) { result.budget_stopped = true; break; }
    result.accounts_received++;
    if (n.skip === 'bad_id') { result.accounts_skipped_bad_id++; continue; }
    if (n.skip === 'no_name') { result.accounts_skipped_no_name++; continue; }

    // Persist ONLY what LCC needs (a member awaits it) OR already tracks (name
    // refresh, no growth). Everything else is a genuinely-unreferenced account we
    // pulled only to discard — skip it, never mint (the entity-graph blast radius).
    if (!all) {
      const key = sf15(n.id18);
      if (!neededKeys.has(key) && !knownKeys.has(key)) {
        result.accounts_skipped_not_needed++;
        continue;
      }
    }

    // Mint/attach the org via the shared per-account upsert (the SAME path the
    // targeted SF-record-sync worker uses — one place, can't drift).
    const p = await persistAccountRow(n, { workspaceId, userId }, { ensureLink });
    if (!p.ok) { result.accounts_skipped_guard++; continue; }
    if (p.created) result.accounts_created++;
    else result.accounts_matched_existing++;
  }
}

// ── Backfill (POST&backfill=1) ──────────────────────────────────────────────

async function backfillMembers({ workspaceId, limit, result, deadline }) {
  // Members that recorded an unresolved AccountId and still have no company_name.
  const sel = await opsQuery('GET',
    'lcc_sf_list_membership?company_name=is.null&raw->>sf_account_id_unresolved=not.is.null'
    + '&select=id,entity_id,raw&order=id.asc&limit=' + Math.max(1, Math.min(limit, MAX_BACKFILL_LIMIT)),
    { countMode: 'none' });
  const rows = (sel && sel.ok && Array.isArray(sel.data)) ? sel.data : [];
  result.members_scanned = rows.length;
  if (!rows.length) return;

  // Resolve the distinct account ids to { name, entity_id } in a bounded batch.
  const ids = rows.map((r) => (r.raw && r.raw.sf_account_id_unresolved) || null).filter(Boolean);
  const acctMap = await resolveAccountNamesByIds(ids, { query: opsQuery });

  for (const row of rows) {
    if (Date.now() > deadline) { result.budget_stopped = true; break; }
    const acctId = row.raw && row.raw.sf_account_id_unresolved;
    const hit = acctId ? acctMap.get(sf15(acctId)) : null;
    if (!hit) { result.members_still_unresolved++; continue; }

    // Wire the person → org (works_at) edge, sourced from the authoritative org
    // that carries the Account identity (the map's entity_id) — the same relate
    // processMember does, but keyed on the SF-identity org, not a name re-mint.
    if (row.entity_id && hit.entity_id && hit.entity_id !== row.entity_id) {
      try {
        await linkPersonToEntity({
          workspaceId, entityId: hit.entity_id, contactEntityId: row.entity_id,
          role: 'works_at', via: 'sf_account_import',
        });
      } catch (_e) { /* soft — the company_name fill below is the primary payoff */ }
    }

    // Fill company_name + clear the unresolved marker (resumable: a re-run won't
    // re-select this row since company_name is now set).
    const newRaw = { ...(row.raw || {}) };
    delete newRaw.sf_account_id_unresolved;
    let patched = false;
    try {
      const p = await opsQuery('PATCH', 'lcc_sf_list_membership?id=eq.' + pgFilterVal(row.id)
        + '&company_name=is.null',
        { company_name: hit.name, org_entity_id: hit.entity_id, raw: newRaw, last_seen_at: new Date().toISOString() },
        { headers: { Prefer: 'return=minimal' } });
      patched = !!(p && p.ok);
    } catch (_e) { /* soft */ }
    if (patched) result.members_resolved++;
    else result.members_still_unresolved++;
  }
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────

export async function handleSfAccountImport(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const isBackfill = String(req.query.backfill || '') === '1' || req.query.backfill === 'true';
  const body = readBody(req);

  // ── Dry-run (GET) — counts only, never writes ─────────────────────────────
  if (dryRun) {
    const accountsKnown = await countExact(
      'external_identities?source_system=eq.salesforce&source_type=eq.Account', 'entity_id');
    const membersWaiting = await countExact(
      'lcc_sf_list_membership?company_name=is.null&raw->>sf_account_id_unresolved=not.is.null');
    return res.status(200).json({
      mode: isBackfill ? 'backfill_dry_run' : 'dry_run',
      accounts_known: accountsKnown,
      members_waiting: membersWaiting,
    });
  }

  const workspaceId = await resolvePrimaryWorkspaceId();
  if (!workspaceId) return res.status(500).json({ error: 'no_workspace' });
  const deadline = Date.now() + BUDGET_MS;

  // ── Backfill (POST&backfill=1) ────────────────────────────────────────────
  if (isBackfill) {
    const limit = Number(req.query.limit || body.limit || DEFAULT_BACKFILL_LIMIT) || DEFAULT_BACKFILL_LIMIT;
    const result = { mode: 'backfill', members_scanned: 0, members_resolved: 0, members_still_unresolved: 0 };
    await backfillMembers({ workspaceId, limit, result, deadline });
    // A resolved member gains a contact/org edge → refresh the queue cache so the
    // owner's value/reachability lands within the request (Slice-1 staleness hook).
    if (result.members_resolved > 0) {
      try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }
    }
    return res.status(200).json(result);
  }

  // ── Account import (POST) ─────────────────────────────────────────────────
  // Default: needed-only. `?all=1` opts into persist-everything (adds ~100k
  // entities — do NOT use casually; see the header).
  const all = String(req.query.all || '') === '1' || req.query.all === 'true';
  const accounts = Array.isArray(body.accounts) ? body.accounts : [];
  const result = {
    mode: 'apply',
    filtered: !all,
    needed_set_size: 0,
    accounts_received: 0,
    accounts_created: 0,
    accounts_matched_existing: 0,
    accounts_skipped_not_needed: 0,
    accounts_skipped_guard: 0,
    accounts_skipped_no_name: 0,
    accounts_skipped_bad_id: 0,
  };
  await importAccounts(accounts, { workspaceId, userId: user.id, result, deadline, all });
  return res.status(200).json(result);
}
