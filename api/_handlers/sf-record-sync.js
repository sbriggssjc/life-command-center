// api/_handlers/sf-record-sync.js
// ============================================================================
// Targeted SF record sync — fetch ONLY the records LCC knows it is missing.
// ----------------------------------------------------------------------------
// The bulk "SF Get Accounts" pull is the wrong shape: the connector returns
// accounts in Id order, so a sweep yields Northmarq's own office records + 2019
// rows while the ~4,627 accounts our contactless list members actually reference
// sit scattered through a 100,000+ row table (grounded 2026-07-20: a 7,335-account
// bulk pull covered 40 of the needed 4,627 = 0.5%). And a full sweep re-adds
// ~100k entities — ~15× the +6,545 seed that degraded v_priority_queue_live >60s
// and saturated the LCC-Opps connection pool on 2026-07-19 (auth lives on this DB).
//
// Invert it: ask Salesforce ONLY for the records LCC is missing, by Id. Every
// record fetched is needed by construction, so entity growth is bounded to the
// ids we asked for (never tens of thousands).
//
//   ?_route=sf-record-sync-tick&object=<name>   (default `account`)
//   GET  → dry-run: compute the missing-id set + batch plan, write NOTHING,
//          call NO flow.
//   POST → drain: INTERLEAVE fetch+persist per batch (gated on SF_RECORD_LOOKUP_URL),
//          re-measure the missing set. Each batch is persisted before the next
//          fetch starts, so the budget bounds how many batches run — never whether
//          a fetched record is kept. `records_discarded` is 0 by construction; a
//          non-zero value is a bug signal, not an accepted outcome. (The pre-fix
//          two-phase shape — fetch-all then persist-all sharing one ~22s budget —
//          let the fetch phase spend the whole budget and the persist phase return
//          0, throwing away fetched records as a "successful" 200.) Throughput
//          telemetry (ms_missing_set / ms_lookup / ms_persist / records_per_second)
//          lets the cron `limit` be tuned on evidence.
//
// SPEC-DRIVEN: adding a future object (contact / opportunity / lead) is a spec in
// SYNC_SPECS — a { objectType, fields, computeMissing, persist } — not a new
// worker. Unknown `object` → honest 400 listing the registered specs.
//
// Reuse (never fork): the T4c ID-lookup transport (lookupSfRecordsByIds +
// buildOdataIdFilter + chunk, already batchSize<=20 for the SF OData ceiling) and
// the account-ingest core (persistAccountRow — the SAME upsert sf-account-import
// uses). Feature-flagged on SF_RECORD_LOOKUP_URL (clean `unconfigured` no-op when
// unset). LCC-Opps only; no SF writes; no dia/gov writes; additive; reversible
// (metadata.via='sf_account_import'); idempotent (a resolved id drops out of the
// missing set → the next drain re-selects nothing).
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, resolvePrimaryWorkspaceId } from '../_shared/ops-db.js';
import { ensureEntityLink } from '../_shared/entity-link.js';
import { isSfRecordLookupConfigured, lookupSfRecordsByIds, chunk } from '../_shared/sf-record-lookup.js';
import { sf15 } from '../_shared/sf-id.js';
import {
  normalizeAccountRow, persistAccountRow,
  buildNeededAccountIdMap, fetchKnownAccountKeys,
} from './sf-account-import.js';

const DEFAULT_ID_LIMIT = 1000;    // max missing ids fetched per tick (bounded)
const MAX_ID_LIMIT = 5000;
// <=20 ids/batch: an `Id eq 'x' or …` OData filter overruns the SF connector's
// 100-node ceiling / the synchronous PA flow response window past ~100 ids
// (re-derived on the CampaignMember flow). Sequential (concurrency 1).
const DEFAULT_BATCH_SIZE = 20;
const BUDGET_MS = 22000;

// ── The Account spec's two halves ───────────────────────────────────────────

/**
 * The Account missing set: DISTINCT `raw.sf_account_id_unresolved` on contactless
 * `lcc_sf_list_membership` rows (the ~4,627 accounts a member is waiting on),
 * MINUS the ids LCC already holds as a salesforce/Account external identity. Keyed
 * by sf15 so a 15-char member id and an 18-char stored id compare cleanly.
 * Returns { missing: id18[], neededKeys: Set<sf15>, neededCount, knownCount }.
 * deps.query injectable (opsQuery-shaped).
 */
async function accountComputeMissing(deps = {}) {
  const neededById = await buildNeededAccountIdMap(deps);   // Map<sf15, id18>
  const neededKeys = new Set(neededById.keys());
  const known = await fetchKnownAccountKeys(Array.from(neededById.values()), deps);
  const missing = [];
  for (const [k, id18] of neededById) if (!known.has(k)) missing.push(id18);
  return { missing, neededKeys, neededCount: neededById.size, knownCount: known.size };
}

/**
 * Persist the fetched Account records via the SHARED per-account upsert
 * (persistAccountRow — the identical mint sf-account-import uses). Every fetched
 * id is needed by construction; the `neededKeys` filter is kept as DEFENSE IN
 * DEPTH against a future accidental bulk POST (a record we did not ask for is
 * skipped, never minted). ctx.deadline bounds the loop — but the interleave loop
 * in runSync passes deadline:0 so a batch just fetched is ALWAYS fully persisted
 * (never abandoned mid-write). `records_seen` = the records this call actually
 * processed (persisted OR skipped-for-a-reason); the caller uses it to prove no
 * fetched record was silently discarded.
 * deps.ensureLink + deps.persistRow injectable.
 */
async function accountPersist(records, neededKeys, ctx, deps = {}) {
  const persistRow = deps.persistRow || persistAccountRow;
  const ensureLink = deps.ensureLink || ensureEntityLink;
  const out = {
    records_persisted: 0, entities_created: 0, entities_matched: 0,
    skipped_guard: 0, skipped_bad_id: 0, skipped_no_name: 0, skipped_not_needed: 0,
    records_seen: 0, budget_stopped: false,
  };
  for (const raw of (Array.isArray(records) ? records : [])) {
    if (ctx && ctx.deadline && Date.now() > ctx.deadline) { out.budget_stopped = true; break; }
    out.records_seen++;
    const n = normalizeAccountRow(raw);
    if (n.skip === 'bad_id') { out.skipped_bad_id++; continue; }
    if (n.skip === 'no_name') { out.skipped_no_name++; continue; }
    // Defense in depth: never mint a record outside the needed set (a no-op for a
    // targeted sync since we only asked for missing-needed ids).
    if (neededKeys && !neededKeys.has(sf15(n.id18))) { out.skipped_not_needed++; continue; }
    const p = await persistRow(n, ctx, { ensureLink });
    if (!p.ok) { out.skipped_guard++; continue; }
    out.records_persisted++;
    if (p.created) out.entities_created++;
    else out.entities_matched++;
  }
  return out;
}

// ── The spec registry — add an object here, not a new worker ─────────────────
export const SYNC_SPECS = {
  account: {
    objectType: 'Account',
    fields: 'Id,Name',
    computeMissing: accountComputeMissing,
    persist: accountPersist,
  },
};

/**
 * Resolve `object` → the registered spec (with its `name`), or an error listing
 * the valid specs. Pure. Unknown object never falls through to a default.
 */
export function resolveSyncSpec(name) {
  const valid = Object.keys(SYNC_SPECS);
  const key = String(name || '').toLowerCase();
  const spec = SYNC_SPECS[key];
  if (!spec) return { error: `unknown object '${key}'`, valid };
  return { spec: { name: key, ...spec }, valid };
}

// ── The tick orchestrator (pure over its injected query / ensureLink / fetch) ─

/**
 * Run ONE sync tick for a resolved spec. Returns the honest receipts object.
 *   missing_after < missing_before on a successful drain IS the progress proof.
 * @param {{spec, dryRun, limit, batchSize, requestIdSeed, ctx, deps}} args
 *   deps.query / deps.ensureLink / deps.persistRow / deps.fetchImpl injectable.
 */
export async function runSync({ spec, dryRun, limit, batchSize, requestIdSeed, ctx, deps = {} }) {
  const deadline = (ctx && ctx.deadline) || 0;
  const tMissing = Date.now();
  const before = await spec.computeMissing(deps);
  const msMissingSet = Date.now() - tMissing;
  const missingBefore = before.missing.length;
  const fetchIds = before.missing.slice(0, limit);
  const idBatches = chunk(fetchIds, batchSize);
  const configured = isSfRecordLookupConfigured() || !!deps.fetchImpl;

  const result = {
    object: spec.name,
    object_type: spec.objectType,
    mode: dryRun ? 'dry_run' : 'apply',
    missing_before: missingBefore,
    needed_total: before.neededCount ?? null,
    already_known: before.knownCount ?? null,
    ids_requested: fetchIds.length,
    batches: idBatches.length,
    batch_size: batchSize,
    capped: fetchIds.length < missingBefore,
    unconfigured: !configured,
    ms_missing_set: msMissingSet,
  };

  // Dry-run: plan only, no flow call, no writes.
  if (dryRun) {
    result.sample_ids = fetchIds.slice(0, 10);
    result.records_returned = 0;
    result.records_persisted = 0;
    result.records_discarded = 0;
    result.entities_created = 0;
    result.missing_after = missingBefore;
    return result;
  }

  // Drain but unconfigured (or nothing to fetch): clean no-op, honest receipts.
  if (!configured || !fetchIds.length) {
    result.records_returned = 0;
    result.records_persisted = 0;
    result.records_discarded = 0;
    result.entities_created = 0;
    result.missing_after = missingBefore;
    return result;
  }

  // ── INTERLEAVE: fetch a batch, persist THAT batch, repeat ──────────────────
  // The budget bounds how many BATCHES run, never whether a fetched record is
  // kept. A batch just fetched from Salesforce (real API calls) is persisted
  // before the next fetch starts, so `records_discarded` is 0 by construction.
  // The old two-phase shape (fetch-all → persist-all sharing one budget) let the
  // fetch phase spend the whole budget and the persist phase return 0 — 140
  // fetched records thrown away, reported as a successful 200.
  const persistAgg = {
    records_persisted: 0, entities_created: 0, entities_matched: 0,
    skipped_guard: 0, skipped_bad_id: 0, skipped_no_name: 0, skipped_not_needed: 0,
    records_seen: 0,
  };
  const lookupErrors = [];
  let recordsReturned = 0;
  let lookupBatchesRun = 0, lookupBatchesFailed = 0, lookupOk = true;
  let msLookup = 0, msPersist = 0;
  let maxBatchMs = 0;
  let budgetStopped = false;

  for (let i = 0; i < idBatches.length; i++) {
    // Reserve a persist tail: don't START a batch we likely can't fetch+persist
    // within budget (after ≥1 batch, so we always make progress). Persist itself
    // runs WITHOUT a deadline — a started batch is never abandoned mid-write.
    if (i > 0 && deadline && Date.now() + maxBatchMs > deadline) { budgetStopped = true; break; }
    const batchStart = Date.now();

    const lookup = await lookupSfRecordsByIds({
      objectType: spec.objectType, fields: spec.fields, ids: idBatches[i],
      batchSize, requestIdSeed: `${requestIdSeed}-${i}`, fetchImpl: deps.fetchImpl, deadline: 0,
    });
    msLookup += Date.now() - batchStart;
    lookupBatchesRun += lookup.batches_run || 0;
    lookupBatchesFailed += lookup.batches_failed || 0;
    if (!lookup.ok) lookupOk = false;
    if (lookup.errors && lookup.errors.length) {
      for (const e of lookup.errors) if (lookupErrors.length < 5) lookupErrors.push({ ...e, batch: i });
    }
    const recs = Array.isArray(lookup.records) ? lookup.records : [];
    recordsReturned += recs.length;

    // Persist THIS batch immediately (deadline:0 → never abandons a fetched batch).
    const pStart = Date.now();
    const persisted = await spec.persist(recs, before.neededKeys, { ...ctx, deadline: 0 }, deps);
    msPersist += Date.now() - pStart;
    persistAgg.records_persisted += persisted.records_persisted;
    persistAgg.entities_created += persisted.entities_created;
    persistAgg.entities_matched += persisted.entities_matched;
    persistAgg.skipped_guard += persisted.skipped_guard;
    persistAgg.skipped_bad_id += persisted.skipped_bad_id;
    persistAgg.skipped_no_name += persisted.skipped_no_name;
    persistAgg.skipped_not_needed += persisted.skipped_not_needed;
    persistAgg.records_seen += persisted.records_seen;

    const batchMs = Date.now() - batchStart;
    if (batchMs > maxBatchMs) maxBatchMs = batchMs;
  }

  result.records_returned = recordsReturned;
  result.records_persisted = persistAgg.records_persisted;
  // Fetched but never handed to persist (should ALWAYS be 0 with interleave — a
  // non-zero value is a bug signal, not an accepted outcome).
  result.records_discarded = Math.max(0, recordsReturned - persistAgg.records_seen);
  result.entities_created = persistAgg.entities_created;
  // budget_stopped scoped honestly: "stopped STARTING new batches", never
  // "abandoned fetched records".
  result.budget_stopped = budgetStopped;
  result.lookup = {
    ok: lookupOk, batches_run: lookupBatchesRun, batches_failed: lookupBatchesFailed,
    batches_total: idBatches.length, budget_stopped: budgetStopped,
  };
  if (lookupErrors.length) result.lookup.errors = lookupErrors;
  result.persist = persistAgg;

  // Throughput telemetry so the cron `limit` can be tuned on evidence.
  result.ms_lookup = msLookup;
  result.ms_persist = msPersist;
  const workSecs = (msLookup + msPersist) / 1000;
  result.records_per_second = workSecs > 0
    ? Math.round((persistAgg.records_persisted / workSecs) * 10) / 10
    : null;

  // Re-measure the missing set: persisting an id makes it a known identity, so it
  // drops out — missing_after < missing_before proves progress (honest, not derived).
  const after = await spec.computeMissing(deps);
  result.missing_after = after.missing.length;

  // A tick that fetched records but persisted none is anomalous — the pre-fix bug
  // looked exactly like this and passed as a 200. Log it loudly; never silent.
  if (recordsReturned > 0 && persistAgg.records_persisted === 0) {
    console.warn('[sf-record-sync] ANOMALY object=' + spec.name
      + ' records_returned=' + recordsReturned + ' records_persisted=0'
      + ' skipped{guard=' + persistAgg.skipped_guard + ',not_needed=' + persistAgg.skipped_not_needed
      + ',bad_id=' + persistAgg.skipped_bad_id + ',no_name=' + persistAgg.skipped_no_name + '}');
  }
  if (result.records_discarded > 0) {
    console.warn('[sf-record-sync] ANOMALY object=' + spec.name
      + ' records_discarded=' + result.records_discarded
      + ' (records_returned=' + recordsReturned + ' records_seen=' + persistAgg.records_seen + ')');
  }

  // Given the incident history, entity growth + throughput per tick are logged.
  console.log('[sf-record-sync] object=' + spec.name
    + ' entities_created=' + persistAgg.entities_created
    + ' records_persisted=' + persistAgg.records_persisted
    + ' records_discarded=' + result.records_discarded
    + ' missing ' + missingBefore + '->' + result.missing_after
    + ' ms{missing=' + msMissingSet + ',lookup=' + msLookup + ',persist=' + msPersist + '}'
    + ' rps=' + result.records_per_second
    + (budgetStopped ? ' budget_stopped' : ''));

  return result;
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────
export async function handleSfRecordSyncTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST (drain) only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const { spec, error, valid } = resolveSyncSpec(req.query.object || 'account');
  if (error) {
    return res.status(400).json({ error, object: String(req.query.object || 'account'), valid_objects: valid });
  }

  const dryRun = req.method === 'GET';
  const limit = Math.min(MAX_ID_LIMIT, Math.max(1, parseInt(req.query.limit || String(DEFAULT_ID_LIMIT), 10)));
  const batchSize = Math.min(100, Math.max(1, parseInt(req.query.batch_size || String(DEFAULT_BATCH_SIZE), 10)));

  const workspaceId = await resolvePrimaryWorkspaceId();
  if (!workspaceId) return res.status(500).json({ error: 'no_workspace' });

  const deadline = Date.now() + parseInt(process.env.SF_RECORD_SYNC_BUDGET_MS || String(BUDGET_MS), 10);
  const out = await runSync({
    spec, dryRun, limit, batchSize,
    requestIdSeed: 'sfsync-' + spec.name + '-' + new Date().toISOString().slice(0, 10),
    ctx: { workspaceId, userId: user.id, deadline },
    deps: { query: opsQuery },
  });
  return res.status(200).json(out);
}
