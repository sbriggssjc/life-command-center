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
//   POST → drain: fetch the missing records by Id (gated on SF_RECORD_LOOKUP_URL),
//          persist via the object's `persist`, re-measure the missing set.
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
 * skipped, never minted). ctx.deadline bounds the loop.
 * deps.ensureLink + deps.persistRow injectable.
 */
async function accountPersist(records, neededKeys, ctx, deps = {}) {
  const persistRow = deps.persistRow || persistAccountRow;
  const ensureLink = deps.ensureLink || ensureEntityLink;
  const out = {
    records_persisted: 0, entities_created: 0, entities_matched: 0,
    skipped_guard: 0, skipped_bad_id: 0, skipped_no_name: 0, skipped_not_needed: 0,
    budget_stopped: false,
  };
  for (const raw of (Array.isArray(records) ? records : [])) {
    if (ctx && ctx.deadline && Date.now() > ctx.deadline) { out.budget_stopped = true; break; }
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
  const before = await spec.computeMissing(deps);
  const missingBefore = before.missing.length;
  const fetchIds = before.missing.slice(0, limit);
  const batches = chunk(fetchIds, batchSize).length;
  const configured = isSfRecordLookupConfigured() || !!deps.fetchImpl;

  const result = {
    object: spec.name,
    object_type: spec.objectType,
    mode: dryRun ? 'dry_run' : 'apply',
    missing_before: missingBefore,
    needed_total: before.neededCount ?? null,
    already_known: before.knownCount ?? null,
    ids_requested: fetchIds.length,
    batches,
    batch_size: batchSize,
    capped: fetchIds.length < missingBefore,
    unconfigured: !configured,
  };

  // Dry-run: plan only, no flow call, no writes.
  if (dryRun) {
    result.sample_ids = fetchIds.slice(0, 10);
    result.records_returned = 0;
    result.records_persisted = 0;
    result.entities_created = 0;
    result.missing_after = missingBefore;
    return result;
  }

  // Drain but unconfigured (or nothing to fetch): clean no-op, honest receipts.
  if (!configured || !fetchIds.length) {
    result.records_returned = 0;
    result.records_persisted = 0;
    result.entities_created = 0;
    result.missing_after = missingBefore;
    return result;
  }

  // Fetch the missing records by Id (OData `Id eq …` chain, <=batchSize/batch).
  const lookup = await lookupSfRecordsByIds({
    objectType: spec.objectType, fields: spec.fields, ids: fetchIds,
    batchSize, requestIdSeed, fetchImpl: deps.fetchImpl, deadline: ctx && ctx.deadline,
  });
  result.records_returned = Array.isArray(lookup.records) ? lookup.records.length : 0;
  result.lookup = {
    ok: lookup.ok, batches_run: lookup.batches_run, batches_failed: lookup.batches_failed,
    batches_total: lookup.batches_total, budget_stopped: !!lookup.budget_stopped,
  };
  if (lookup.errors && lookup.errors.length) result.lookup.errors = lookup.errors.slice(0, 5);

  const persisted = await spec.persist(lookup.records || [], before.neededKeys, ctx, deps);
  result.records_persisted = persisted.records_persisted;
  result.entities_created = persisted.entities_created;
  result.persist = persisted;

  // Re-measure the missing set: persisting an id makes it a known identity, so it
  // drops out — missing_after < missing_before proves progress (honest, not derived).
  const after = await spec.computeMissing(deps);
  result.missing_after = after.missing.length;

  // Given the incident history, entity growth per tick is logged in its own line.
  console.log('[sf-record-sync] object=' + spec.name
    + ' entities_created=' + persisted.entities_created
    + ' records_persisted=' + persisted.records_persisted
    + ' missing ' + missingBefore + '->' + result.missing_after);

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
