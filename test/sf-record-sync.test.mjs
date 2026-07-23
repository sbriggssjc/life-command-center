// Targeted SF record sync — the spec registry + the tick orchestrator.
// Anchors: (1) unknown object → error listing the registered specs; (2) the
// account missing set excludes ids already known as a salesforce/Account identity
// (15↔18 both directions); (3) batching stays under the SF OData node ceiling;
// (4) unconfigured is a clean no-op (no flow call, no writes); (5) persist routes
// through the SHARED persistAccountRow (sf_account_import mint shape); (6) a second
// drain over the same ids reports ~0 created (idempotent); (7) missing_after <
// missing_before on a successful drain.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSyncSpec, SYNC_SPECS, runSync } from '../api/_handlers/sf-record-sync.js';
import { chunk, buildOdataIdFilter, normalizeCompRecords } from '../api/_shared/sf-record-lookup.js';
import { toSf18, sf15 } from '../api/_shared/sf-id.js';

// Four more valid 15-char Account (001…) ids for the multi-batch interleave tests.
const C15 = '0011I00000AAA01';
const D15 = '0011I00000AAA02';
const E15 = '0011I00000AAA03';
const F15 = '0011I00000AAA04';
const PAST = () => Date.now() - 1;   // a deadline already expired

const ID15 = '0011I00000h7mHE';           // real live 15-char Account id
const ID18 = '0011I00000h7mHEQAY';        // its canonical 18-char form
const B15 = '0011I00000h7yOi';            // a second real Account id
const B18 = '0011I00000h7yOiQAI';

const FAR = () => Date.now() + 60000;

describe('resolveSyncSpec', () => {
  it("account resolves to a spec carrying its name + objectType 'Account'", () => {
    const { spec, error } = resolveSyncSpec('account');
    assert.equal(error, undefined);
    assert.equal(spec.name, 'account');
    assert.equal(spec.objectType, 'Account');
    // ROE Slice 2: the Account pull also carries OwnerId/Owner.Name (the assigned
    // Northmarq broker) so the SF sync can capture it onto the account identity.
    assert.equal(spec.fields, 'Id,Name,OwnerId,Owner.Name');
    assert.equal(typeof spec.computeMissing, 'function');
    assert.equal(typeof spec.persist, 'function');
  });

  it('is case-insensitive on the object name', () => {
    assert.equal(resolveSyncSpec('ACCOUNT').spec.name, 'account');
  });

  it('unknown object → error listing the registered specs (never a default)', () => {
    const r = resolveSyncSpec('bogus');
    assert.equal(r.spec, undefined);
    assert.match(r.error, /unknown object 'bogus'/);
    assert.deepEqual(r.valid, Object.keys(SYNC_SPECS));
    assert.ok(r.valid.includes('account'));
  });
});

describe('account computeMissing — needed minus known, 15↔18 safe', () => {
  // membership pull returns `needed`; the external_identities probe returns `known`
  // (stored 18-char form). One page (test sets < 1000).
  function query({ needed = [], known = [] }) {
    return async (_m, path) => {
      if (path.startsWith('lcc_sf_list_membership')) {
        return { ok: true, data: path.includes('offset=0') ? needed.map((k) => ({ acct: k })) : [] };
      }
      if (path.startsWith('external_identities')) {
        return { ok: true, data: known.map((k) => ({ external_id: toSf18(k) })) };
      }
      return { ok: false, data: [] };
    };
  }

  it('excludes an id already known (needed 15-char, known 18-char)', async () => {
    const out = await SYNC_SPECS.account.computeMissing({ query: query({ needed: [ID15, B15], known: [ID18] }) });
    assert.equal(out.neededCount, 2);
    assert.equal(out.knownCount, 1);
    assert.deepEqual(out.missing, [B18]);              // ID excluded, B included (canonical 18)
    assert.ok(out.neededKeys.has(ID15) && out.neededKeys.has(B15));
  });

  it('excludes an id already known (needed 18-char, known 15-char) — the reverse', async () => {
    const out = await SYNC_SPECS.account.computeMissing({ query: query({ needed: [ID18, B18], known: [B15] }) });
    assert.deepEqual(out.missing, [ID18]);             // B excluded, ID remains
  });

  it('nothing known → every needed id is missing (deduped by sf15)', async () => {
    const out = await SYNC_SPECS.account.computeMissing({ query: query({ needed: [ID15, ID18, B15], known: [] }) });
    assert.equal(out.missing.length, 2);               // ID15==ID18 collapse
    assert.ok(out.missing.includes(ID18) && out.missing.includes(B18));
  });

  it('everything known → missing is empty', async () => {
    const out = await SYNC_SPECS.account.computeMissing({ query: query({ needed: [ID15, B15], known: [ID15, B15] }) });
    assert.deepEqual(out.missing, []);
  });
});

describe('batching stays under the SF OData node ceiling', () => {
  it('4,627 ids → 232 batches of <=20, each filter under the ceiling', () => {
    const ids = Array.from({ length: 4627 }, (_, i) => '0011I00000A' + String(i).padStart(6, '0'));
    const batches = chunk(ids, 20);
    assert.equal(batches.length, 232);                 // ceil(4627/20)
    for (const b of batches) {
      assert.ok(b.length <= 20);
      const clauses = (buildOdataIdFilter(b).match(/Id eq /g) || []).length;
      assert.ok(clauses <= 20, 'each OData filter has <=20 Id-eq clauses');
    }
  });
});

// A stateful mock: membership returns `needed`; the external_identities probe
// reflects the GROWING known set (an ensureLink success marks the id known); the
// lookup fetchImpl echoes the requested ids as {Id,Name}. This exercises a full
// drain end to end without a DB or the PA flow.
function statefulDeps(needed18, { ensureCapture } = {}) {
  const known = new Set();                             // sf15 known so far
  const query = async (_m, path) => {
    if (path.startsWith('lcc_sf_list_membership')) {
      return { ok: true, data: path.includes('offset=0') ? needed18.map((id) => ({ acct: id })) : [] };
    }
    if (path.startsWith('external_identities')) {
      return { ok: true, data: [...known].map((k) => ({ external_id: toSf18(k) })) };
    }
    return { ok: false, data: [] };
  };
  const ensureLink = async (args) => {
    if (ensureCapture) ensureCapture(args);
    const k = sf15(args.externalId);
    const created = !!k && !known.has(k);
    if (k) known.add(k);
    return { ok: true, entityId: 'e-' + args.externalId, createdEntity: created };
  };
  // The PA record-lookup flow shape: read the OData filter, echo each id as a row.
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const ids = [...String(body.filter).matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]);
    return { ok: true, status: 200, text: async () => JSON.stringify({ records: ids.map((id) => ({ Id: id, Name: 'Acct ' + id })) }) };
  };
  return { known, deps: { query, ensureLink, fetchImpl } };
}

describe('runSync — drain', () => {
  it('persist routes through the shared sf_account_import mint (salesforce/Account, via)', async () => {
    const captured = [];
    const { spec } = resolveSyncSpec('account');
    const { deps } = statefulDeps([ID18, B18], { ensureCapture: (a) => captured.push(a) });
    await runSync({ spec, dryRun: false, limit: 1000, batchSize: 20, requestIdSeed: 't', ctx: { workspaceId: 'ws', userId: 'u', deadline: FAR() }, deps });
    assert.ok(captured.length >= 1);
    const a = captured[0];
    assert.equal(a.sourceSystem, 'salesforce');
    assert.equal(a.sourceType, 'Account');
    assert.equal(a.domain, 'lcc');
    assert.equal(a.metadata.via, 'sf_account_import');  // reversible tag, shared shape
    assert.equal(a.seedFields.org_type, 'company');
  });

  it('drains the missing set: records fetched + persisted, missing_after < missing_before', async () => {
    const { spec } = resolveSyncSpec('account');
    const { deps } = statefulDeps([ID18, B18]);
    const out = await runSync({ spec, dryRun: false, limit: 1000, batchSize: 20, requestIdSeed: 't', ctx: { workspaceId: 'ws', userId: 'u', deadline: FAR() }, deps });
    assert.equal(out.mode, 'apply');
    assert.equal(out.unconfigured, false);
    assert.equal(out.missing_before, 2);
    assert.equal(out.ids_requested, 2);
    assert.equal(out.records_returned, 2);
    assert.equal(out.records_persisted, 2);
    assert.equal(out.entities_created, 2);
    assert.equal(out.missing_after, 0);
    assert.ok(out.missing_after < out.missing_before);  // the progress proof
  });

  it('idempotent: a second drain over the now-known set creates ~0', async () => {
    const { spec } = resolveSyncSpec('account');
    const { deps } = statefulDeps([ID18, B18]);
    const first = await runSync({ spec, dryRun: false, limit: 1000, batchSize: 20, requestIdSeed: 't', ctx: { deadline: FAR() }, deps });
    assert.equal(first.entities_created, 2);
    const second = await runSync({ spec, dryRun: false, limit: 1000, batchSize: 20, requestIdSeed: 't', ctx: { deadline: FAR() }, deps });
    assert.equal(second.missing_before, 0);
    assert.equal(second.ids_requested, 0);
    assert.equal(second.records_persisted, 0);
    assert.equal(second.entities_created, 0);
  });

  it('capped by ?limit — only `limit` ids fetched this tick, the rest deferred', async () => {
    const { spec } = resolveSyncSpec('account');
    const { deps } = statefulDeps([ID18, B18]);
    const out = await runSync({ spec, dryRun: false, limit: 1, batchSize: 20, requestIdSeed: 't', ctx: { deadline: FAR() }, deps });
    assert.equal(out.missing_before, 2);
    assert.equal(out.ids_requested, 1);
    assert.equal(out.capped, true);
    assert.equal(out.entities_created, 1);
    assert.equal(out.missing_after, 1);                 // the other id still missing
  });
});

describe('runSync — dry-run + unconfigured', () => {
  it('dry-run computes the plan, writes nothing, calls no flow', async () => {
    const { spec } = resolveSyncSpec('account');
    let fetched = 0, ensured = 0;
    const base = statefulDeps([ID18, B18]);
    const deps = {
      query: base.deps.query,
      ensureLink: async (a) => { ensured++; return base.deps.ensureLink(a); },
      fetchImpl: async (...args) => { fetched++; return base.deps.fetchImpl(...args); },
    };
    const out = await runSync({ spec, dryRun: true, limit: 1000, batchSize: 20, requestIdSeed: 't', ctx: { deadline: FAR() }, deps });
    assert.equal(out.mode, 'dry_run');
    assert.equal(out.missing_before, 2);
    assert.equal(out.batches, 1);
    assert.equal(out.records_persisted, 0);
    assert.equal(out.missing_after, out.missing_before);
    assert.equal(fetched, 0);                           // no flow call
    assert.equal(ensured, 0);                           // no writes
  });

  it('unconfigured (no flow URL, no fetchImpl) → clean no-op, unconfigured:true, no writes', async () => {
    const saved = process.env.SF_RECORD_LOOKUP_URL;
    delete process.env.SF_RECORD_LOOKUP_URL;
    try {
      const { spec } = resolveSyncSpec('account');
      let ensured = 0;
      const base = statefulDeps([ID18, B18]);
      const deps = { query: base.deps.query, ensureLink: async (a) => { ensured++; return base.deps.ensureLink(a); } };
      const out = await runSync({ spec, dryRun: false, limit: 1000, batchSize: 20, requestIdSeed: 't', ctx: { deadline: FAR() }, deps });
      assert.equal(out.mode, 'apply');
      assert.equal(out.unconfigured, true);
      assert.equal(out.missing_before, 2);
      assert.equal(out.records_returned, 0);
      assert.equal(out.records_persisted, 0);
      assert.equal(out.records_discarded, 0);
      assert.equal(out.missing_after, out.missing_before);
      assert.equal(out.lookup, undefined);              // the flow never ran
      assert.equal(ensured, 0);                          // no writes
    } finally {
      if (saved === undefined) delete process.env.SF_RECORD_LOOKUP_URL;
      else process.env.SF_RECORD_LOOKUP_URL = saved;
    }
  });
});

describe('runSync — interleave (fetch a batch, persist that batch, repeat)', () => {
  it('a budget expiring mid-drain persists EVERY fetched record (records_discarded=0)', async () => {
    // batchSize 1 → 4 single-id batches; the deadline is already past, so after the
    // first batch fully completes (fetch+persist) the loop stops STARTING new ones.
    // The old two-phase shape would have fetched several then persisted 0.
    const { spec } = resolveSyncSpec('account');
    const { deps } = statefulDeps([C15, D15, E15, F15]);
    const out = await runSync({ spec, dryRun: false, limit: 1000, batchSize: 1, requestIdSeed: 't', ctx: { workspaceId: 'ws', userId: 'u', deadline: PAST() }, deps });
    assert.equal(out.mode, 'apply');
    assert.equal(out.missing_before, 4);
    assert.ok(out.records_returned >= 1, 'at least one batch always runs');
    assert.equal(out.records_discarded, 0, 'no fetched record is ever thrown away');
    assert.equal(out.records_returned, out.records_persisted, 'everything fetched was persisted');
    assert.ok(out.missing_after < out.missing_before, 'the progress proof');
    assert.equal(out.budget_stopped, true, 'stopped STARTING new batches');
  });

  it('a budget that expires during fetch stops cleanly with no partial/unpersisted batch', async () => {
    // Same shape: whatever was fetched is fully persisted; the deferred remainder
    // stays missing for the next tick (resumable). records_discarded stays 0.
    const { spec } = resolveSyncSpec('account');
    const { deps } = statefulDeps([C15, D15, E15, F15]);
    const out = await runSync({ spec, dryRun: false, limit: 1000, batchSize: 1, requestIdSeed: 't', ctx: { deadline: PAST() }, deps });
    assert.equal(out.records_discarded, 0);
    assert.equal(out.records_persisted, out.records_returned);
    // Exactly the persisted ids left the missing set; the rest are deferred.
    assert.equal(out.missing_after, out.missing_before - out.records_persisted);
    assert.ok(out.entities_created >= 1);
  });

  it('records_returned > 0 && records_persisted === 0 is impossible under normal operation', async () => {
    const { spec } = resolveSyncSpec('account');
    const { deps } = statefulDeps([ID18, B18]);
    const out = await runSync({ spec, dryRun: false, limit: 1000, batchSize: 20, requestIdSeed: 't', ctx: { deadline: FAR() }, deps });
    assert.ok(out.records_returned > 0);
    assert.ok(!(out.records_returned > 0 && out.records_persisted === 0),
      'a fetched-but-persisted-nothing tick — the pre-fix bug — must never happen normally');
    assert.equal(out.records_discarded, 0);
  });

  it('reports per-phase throughput telemetry so the cron limit can be tuned on evidence', async () => {
    const { spec } = resolveSyncSpec('account');
    const { deps } = statefulDeps([ID18, B18]);
    const out = await runSync({ spec, dryRun: false, limit: 1000, batchSize: 20, requestIdSeed: 't', ctx: { deadline: FAR() }, deps });
    assert.equal(typeof out.ms_missing_set, 'number');
    assert.equal(typeof out.ms_lookup, 'number');
    assert.equal(typeof out.ms_persist, 'number');
    assert.ok(out.records_per_second === null || typeof out.records_per_second === 'number');
  });
});

describe('T4c comp lookup path in sf-record-lookup.js is untouched', () => {
  it('normalizeCompRecords still maps a comp record to the retained-map shape', () => {
    const out = normalizeCompRecords([
      { Id: 'a1Y000000000001', On_Market_Date__c: '2026-01-22T00:00:00Z', CreatedDate: '2025-12-01T00:00:00Z' },
      { id: 'a1Y000000000002' },                        // lowercase id, null dates tolerated
      { On_Market_Date__c: '2026-01-01' },              // no id → dropped
    ]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { sf_comp_id: 'a1Y000000000001', on_market_date: '2026-01-22', created_date: '2025-12-01' });
    assert.deepEqual(out[1], { sf_comp_id: 'a1Y000000000002', on_market_date: null, created_date: null });
  });
});
