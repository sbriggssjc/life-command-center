// INTAKE-RESTAGE1 (2026-09-23) — a stored file could not be re-staged.
//
// stageOmIntake keys the OM inbox card `external_id = om_sha256:<sha>`. The
// only live unique index on inbox_items is the PARTIAL
//   inbox_items_workspace_external_id_unique (workspace_id, external_id)
//   WHERE external_id IS NOT NULL
// and the insert sent `resolution=merge-duplicates` with no on_conflict, so
// PostgREST arbitrated on the primary key and the partial index raised 23505:
// every re-stage of the same file (Findlay OM, sf_files 1747) failed
// `inbox_item_insert_failed`. on_conflict cannot fix it (PostgREST emits no
// index predicate; Postgres cannot infer a partial index without one → 42P10),
// so the fix is lookup → insert → on 23505 look up again and attach.
//
// This drives the REAL stageOmIntake through a global.fetch fake of PostgREST
// that enforces the partial unique index and the staged_intake_items PK, and
// pins: a re-stage reuses the card and re-runs extraction FORCED; a concurrent
// double-stage yields ONE card; a 23505 is attached to, a 23503 is not; two
// concurrent re-stages run ONE forced extraction.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.EXTRACT_RACE_MS = '1000';

const { stageOmIntake, resolveOmInboxCard, planOmRestage } =
  await import('../api/_shared/intake-om-pipeline.js');
const { requeueDecision } =
  await import('../supabase/functions/intake-salesforce-files/discovery.ts');

const WS = 'a0000000-0000-0000-0000-000000000001';
const SHA = '2d9b1df96709f98fa063ff61ba0437c6d9b7c792dcf50ea40970d111e69f5b16';
const EXT = `om_sha256:${SHA}`;
const OLD = '2026-09-22T12:15:32.000Z';

const originalFetch = global.fetch;

function resp(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

// Parse `a=eq.x&b=eq.y&or=(...)` into { eq: {a:'x'}, or: '...' }.
function parseQuery(qs) {
  const eq = {};
  let or = null;
  for (const part of qs.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent(part.slice(0, i));
    const v = decodeURIComponent(part.slice(i + 1));
    if (k === 'or') or = v.replace(/^\(|\)$/g, '');
    else if (v.startsWith('eq.')) eq[k] = v.slice(3);
  }
  return { eq, or };
}

function matchesEq(row, eq) {
  return Object.entries(eq).every(([k, v]) => String(row[k]) === v);
}

// Evaluates the only `or` shape the pipeline sends: (status.neq.X,updated_at.lt.T)
function matchesOr(row, or) {
  if (!or) return true;
  return or.split(',').some((cond) => {
    const [col, op, ...rest] = cond.split('.');
    const val = rest.join('.');
    if (op === 'neq') return String(row[col]) !== val;
    if (op === 'lt') return Date.parse(row[col]) < Date.parse(val);
    throw new Error(`unhandled or op ${op}`);
  });
}

function makeDb({ inboxLookupBarrier = 0 } = {}) {
  const db = {
    inbox_items: [], staged_intake_items: [], staged_intake_artifacts: [],
    staged_intake_extractions: [],
    log: [], cacheChecks: 0, claimPatches: [],
  };
  let seq = 0;
  // Barrier: hold the first N inbox_items external_id lookups until N have
  // arrived, so N concurrent stages all read "no card" before any inserts.
  let waiting = [];
  let barrierLeft = inboxLookupBarrier;

  db.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const m = u.match(/\/rest\/v1\/([a-z_]+)\??(.*)$/);
    if (!m) return resp({});
    const [, table, qs] = m;
    const { eq, or } = parseQuery(qs);
    const body = opts.body ? JSON.parse(opts.body) : null;
    db.log.push(`${method} ${table}`);

    if (table === 'inbox_items') {
      if (method === 'GET' && eq.external_id) {
        const snapshot = db.inbox_items.filter((r) => matchesEq(r, eq)).map((r) => ({ ...r }));
        if (barrierLeft > 0) {
          barrierLeft--;
          await new Promise((res) => {
            waiting.push(res);
            if (barrierLeft === 0) { waiting.forEach((w) => w()); waiting = []; }
          });
        }
        return resp(snapshot);
      }
      if (method === 'POST') {
        const dup = db.inbox_items.find((r) => r.workspace_id === body.workspace_id
          && body.external_id != null && r.external_id === body.external_id);
        if (dup) {
          return resp({ code: '23505', message: 'duplicate key value violates unique constraint "inbox_items_workspace_external_id_unique"' }, 409);
        }
        const row = { id: `card-${++seq}`, created_at: new Date().toISOString(), ...body };
        db.inbox_items.push(row);
        return resp([row], 201);
      }
      return resp([]);
    }

    if (table === 'staged_intake_items') {
      if (method === 'GET') return resp(db.staged_intake_items.filter((r) => matchesEq(r, eq)));
      if (method === 'POST') {
        if (db.staged_intake_items.some((r) => r.intake_id === body.intake_id)) {
          return resp({ code: '23505', message: 'duplicate key value violates unique constraint "staged_intake_items_pkey"' }, 409);
        }
        const now = new Date().toISOString();
        const row = { created_at: now, updated_at: now, ...body };
        db.staged_intake_items.push(row);
        return resp([row], 201);
      }
      if (method === 'PATCH') {
        const hit = db.staged_intake_items.filter((r) => matchesEq(r, eq) && matchesOr(r, or));
        if (or) db.claimPatches.push(hit.length);
        hit.forEach((r) => Object.assign(r, body));
        return resp(hit);
      }
      return resp([]);
    }

    if (table === 'staged_intake_artifacts') {
      if (method === 'GET') return resp(db.staged_intake_artifacts.filter((r) => matchesEq(r, eq)));
      if (method === 'POST') { db.staged_intake_artifacts.push(body); return resp([{ id: `art-${++seq}`, ...body }], 201); }
      return resp([]);
    }

    if (table === 'staged_intake_extractions') {
      // The extractor's cached-extraction short-circuit is the only reader that
      // orders by created_at — it is skipped when forceReextract is set.
      if (method === 'GET' && /order=created_at\.desc/.test(qs)) db.cacheChecks++;
      if (method === 'GET') return resp(db.staged_intake_extractions.filter((r) => matchesEq(r, eq)));
      return resp([{ id: `ex-${++seq}` }], 201);
    }

    if (method === 'POST') return resp([{ id: `row-${++seq}` }], 201);
    return resp([]);
  };
  return db;
}

// A settled first pass: card + finalized staged row + artifact + extraction.
function seedFirstPass(db, { stagedStatus = 'finalized', updatedAt = OLD } = {}) {
  db.inbox_items.push({ id: 'card-first', workspace_id: WS, external_id: EXT, status: 'triaged', created_at: OLD });
  db.staged_intake_items.push({ intake_id: 'card-first', status: stagedStatus, created_at: OLD, updated_at: updatedAt });
  db.staged_intake_artifacts.push({ intake_id: 'card-first', sha256: SHA, file_name: 'USRenalMOB_Findlay_OH_OM_SB.pdf' });
  db.staged_intake_extractions.push({ intake_id: 'card-first', extraction_snapshot: { document_type: 'om' } });
}

function input() {
  return {
    bytes_base64: Buffer.from('%PDF-1.4 findlay').toString('base64'),
    file_name: 'USRenalMOB_Findlay_OH_OM_SB.pdf',
    mime_type: 'application/pdf',
    sha256: SHA,
    channel: 'email',
    seed_data: { sf_entity_type: 'Comp__c', source_vertical: 'dia' },
  };
}
const AUTH = { email: 'sf-files@lcc.test' };

let db;
beforeEach(() => { db = makeDb(); global.fetch = db.fetch; });
afterEach(() => { global.fetch = originalFetch; });

describe('INTAKE-RESTAGE1 — re-stage of the same sha reuses the card', () => {
  it('reuses the existing card, mints no second card/artifact, and re-runs extraction FORCED', async () => {
    seedFirstPass(db);
    const out = await stageOmIntake(input(), AUTH, WS);

    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.ok, true);
    assert.equal(out.body.intake_id, 'card-first', 're-stage attaches to the existing card');
    assert.equal(out.body.deduplicated, true);
    assert.equal(out.body.restage, 'restage');
    assert.equal(db.inbox_items.length, 1, 'exactly one card');
    assert.equal(db.staged_intake_items.length, 1, 'the staged row is reused, not re-inserted');
    assert.equal(db.staged_intake_artifacts.length, 1, 'same bytes ⇒ no second artifact');
    assert.deepEqual(db.claimPatches, [1], 'the settled staged row was claimed back to queued');
    assert.equal(db.cacheChecks, 0, 'forceReextract bypasses the cached-extraction short-circuit');
    assert.ok(!db.log.includes('DELETE inbox_items'), 'a reused card is never rolled back');
  });

  it('a stale queued row (stranded) is also re-staged, not treated as in flight', async () => {
    seedFirstPass(db, { stagedStatus: 'queued', updatedAt: OLD });
    const out = await stageOmIntake(input(), AUTH, WS);
    assert.equal(out.body.restage, 'restage');
    assert.equal(db.cacheChecks, 0);
  });

  it('a first-ever stage still inserts one card and runs the normal (non-forced) extraction', async () => {
    const out = await stageOmIntake(input(), AUTH, WS);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.deduplicated, false);
    assert.equal(out.body.restage, null);
    assert.equal(db.inbox_items.length, 1);
    assert.equal(db.staged_intake_artifacts.length, 1);
    assert.ok(db.cacheChecks >= 1, 'first pass keeps the extractor cache check (no force)');
  });
});

describe('INTAKE-RESTAGE1 — concurrency', () => {
  it('two concurrent first stages of one file produce ONE card and ONE extraction', async () => {
    db = makeDb({ inboxLookupBarrier: 2 });
    global.fetch = db.fetch;
    const [a, b] = await Promise.all([
      stageOmIntake(input(), AUTH, WS),
      stageOmIntake(input(), AUTH, WS),
    ]);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(db.inbox_items.length, 1, 'one card');
    assert.equal(a.body.intake_id, b.body.intake_id, 'both calls report the same card');
    const modes = [a.body.restage, b.body.restage].sort();
    assert.deepEqual(modes, ['in_flight', null], 'the loser stands down');
    assert.equal(db.staged_intake_items.length, 1);
    assert.equal(db.staged_intake_artifacts.length, 1);
  });

  it('two concurrent RE-stages claim once: one forced extraction, the other stands down', async () => {
    seedFirstPass(db);
    const [a, b] = await Promise.all([
      stageOmIntake(input(), AUTH, WS),
      stageOmIntake(input(), AUTH, WS),
    ]);
    const modes = [a.body.restage, b.body.restage].sort();
    assert.deepEqual(modes, ['in_flight', 'restage']);
    assert.deepEqual(db.claimPatches.sort(), [0, 1], 'exactly one claim matched');
    assert.equal(db.inbox_items.length, 1);
  });
});

describe('INTAKE-RESTAGE1 — the partial-index conflict', () => {
  const payload = { workspace_id: WS, external_id: EXT, title: 'OM: Findlay' };

  it('a 23505 on insert (lookup raced) attaches to the winner via a second lookup', async () => {
    // First lookup misses (stale read), then the winner's row is visible.
    let lookups = 0;
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'GET') {
        lookups++;
        return resp(lookups === 1 ? [] : [{ id: 'card-winner', created_at: new Date().toISOString() }]);
      }
      return resp({ code: '23505', message: 'duplicate key value violates unique constraint "inbox_items_workspace_external_id_unique"' }, 409);
    };
    const r = await resolveOmInboxCard({ wsId: WS, externalId: EXT, itemPayload: payload });
    assert.equal(r.ok, true);
    assert.equal(r.item.id, 'card-winner');
    assert.equal(r.via, 'conflict');
    assert.equal(lookups, 2);
  });

  it('a 409 that is a FOREIGN-KEY violation (23503) is NOT attached to — it is an error', async () => {
    // A later lookup WOULD find a row — so treating the FK 409 as a conflict
    // would wrongly attach this stage to someone else's card.
    let lookups = 0;
    global.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'GET') {
        lookups++;
        return resp(lookups === 1 ? [] : [{ id: 'someone-else' }]);
      }
      return resp({ code: '23503', message: 'insert or update on table "inbox_items" violates foreign key constraint' }, 409);
    };
    const r = await resolveOmInboxCard({ wsId: WS, externalId: EXT, itemPayload: payload });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
  });

  it('the insert no longer relies on merge-duplicates (which arbitrates on the PK only)', async () => {
    let prefer = null;
    global.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        prefer = opts.headers?.Prefer || null;
        return resp([{ id: 'card-new' }], 201);
      }
      return resp([]);
    };
    const r = await resolveOmInboxCard({ wsId: WS, externalId: EXT, itemPayload: payload });
    assert.equal(r.via, 'insert');
    assert.ok(prefer && !/merge-duplicates/.test(prefer), `Prefer was ${prefer}`);
  });
});

describe('planOmRestage modes', () => {
  const NOW = Date.parse('2026-09-23T15:00:00.000Z');
  const fresh = new Date(NOW - 10_000).toISOString();
  const stale = new Date(NOW - 10 * 60_000).toISOString();

  async function plan(staged, opts) {
    db = makeDb();
    global.fetch = db.fetch;
    if (staged) db.staged_intake_items.push({ intake_id: 'c1', ...staged });
    db.staged_intake_artifacts.push({ intake_id: 'c1', sha256: SHA });
    return planOmRestage('c1', SHA, { now: NOW, ...opts });
  }

  it('fresh queued → in_flight; stale queued → restage; terminal → restage', async () => {
    assert.equal((await plan({ status: 'queued', updated_at: fresh })).mode, 'in_flight');
    assert.equal((await plan({ status: 'queued', updated_at: stale })).mode, 'restage');
    assert.equal((await plan({ status: 'finalized', updated_at: fresh })).mode, 'restage');
    assert.equal((await plan({ status: 'failed', updated_at: stale })).mode, 'restage');
  });

  it('no staged row: young card → in_flight, old card → resume; conflict → in_flight', async () => {
    assert.equal((await plan(null, { cardCreatedAt: fresh })).mode, 'in_flight');
    assert.equal((await plan(null, { cardCreatedAt: stale })).mode, 'resume');
    assert.equal((await plan({ status: 'finalized', updated_at: stale }, { via: 'conflict' })).mode, 'in_flight');
  });

  it('reports artifact reuse by sha256', async () => {
    const p = await plan({ status: 'finalized', updated_at: stale });
    assert.equal(p.artifactExists, true);
    assert.equal(p.stagedExists, true);
  });
});

describe('sf_files ?action=requeue decision', () => {
  it('stored + settled → requeue; stored + queued → no-op; not stored → refuse', () => {
    assert.equal(requeueDecision({ ingestion_status: 'stored', extraction_status: 'extracted', storage_path: 'p' }).verdict, 'requeue');
    assert.equal(requeueDecision({ ingestion_status: 'stored', extraction_status: 'extract_failed', storage_path: 'p' }).verdict, 'requeue');
    assert.equal(requeueDecision({ ingestion_status: 'stored', extraction_status: 'queued', storage_path: 'p' }).verdict, 'already_queued');
    assert.equal(requeueDecision({ ingestion_status: 'discovered', extraction_status: null, storage_path: null }).verdict, 'not_stored');
    assert.equal(requeueDecision({ ingestion_status: 'stored', extraction_status: 'extracted', storage_path: '' }).verdict, 'not_stored');
  });
});
