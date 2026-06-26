// R28 Unit 2 — contact-qualify tests.
//
// Covers the deps-injected core (performContactQualify): owner resolution +
// contactless-cadence stamp (owner first, else self per R20), terminal
// disposition as the guaranteed effect, and outcome-truthful failure handling.
// Plus the contact-attach onlyContactless extension (stamps only a cadence with
// no contact yet, so qualifying never clobbers an existing owner contact).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { performContactQualify, filterQualifiableContacts } from '../api/operations.js';
import { stampContactOnActiveCadence, maybeSeedValuableCadence } from '../api/_shared/contact-attach.js';

const UUID_A = '11111111-1111-1111-1111-111111111111'; // inbox item
const UUID_P = '22222222-2222-2222-2222-222222222222'; // person
const UUID_PROP = '33333333-3333-3333-3333-333333333333'; // property entity
const UUID_OWNER = '44444444-4444-4444-4444-444444444444'; // owner entity

function recordingDeps(overrides = {}) {
  const calls = { linkPerson: [], stampCadence: [], disposition: [], refresh: 0 };
  const deps = {
    getRow: async () => ({ id: UUID_A, entity_id: UUID_P, status: 'new', metadata: { property_entity_id: UUID_PROP } }),
    resolveOwner: async () => UUID_OWNER,
    linkPerson: async (ownerId, personId) => { calls.linkPerson.push([ownerId, personId]); return { ok: true }; },
    stampCadence: async (entityId, args) => { calls.stampCadence.push([entityId, args]); return { ok: true, cadenceId: 'cad-' + entityId }; },
    dispositionInbox: async (id, patch) => { calls.disposition.push([id, patch]); return { ok: true }; },
    refreshQueue: async () => { calls.refresh += 1; return { ok: true }; },
    ...overrides,
  };
  return { deps, calls };
}

describe('performContactQualify (R28 Unit 2)', () => {
  it('owner + contactless cadence → links person→owner, stamps owner cadence, promotes', async () => {
    const { deps, calls } = recordingDeps();
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.linked, true);
    assert.deepEqual(calls.linkPerson[0], [UUID_OWNER, UUID_P]);
    assert.equal(out.body.cadence_stamped.target, 'owner');
    // Owner stamp must request onlyContactless so it never clobbers a contact.
    assert.equal(calls.stampCadence[0][0], UUID_OWNER);
    assert.equal(calls.stampCadence[0][1].onlyContactless, true);
    assert.equal(calls.stampCadence[0][1].contactEntityId, UUID_P);
    // Terminal disposition + staleness refresh fired.
    assert.equal(calls.disposition[0][1].status, 'promoted');
    assert.equal(calls.disposition[0][1].metadata.contact_qualify.source, 'r28_unit2');
    assert.equal(calls.refresh, 1);
  });

  it('owner has NO contactless cadence → falls back to self-stamp (R20)', async () => {
    let n = 0;
    const { deps, calls } = recordingDeps({
      stampCadence: async (entityId, args) => {
        calls.stampCadence.push([entityId, args]); n += 1;
        // First call (owner) finds none; second call (self) stamps.
        return n === 1 ? { ok: false, reason: 'no_active_cadence' } : { ok: true, cadenceId: 'cad-self' };
      },
    });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.body.cadence_stamped.target, 'self');
    assert.equal(calls.stampCadence[1][0], UUID_P); // self-stamp on the person
    assert.equal(calls.stampCadence[1][1].contactEntityId, UUID_P);
    assert.equal(out.body.linked, true); // still linked to the owner
  });

  it('no owner resolvable → links nothing, self-stamps, still promotes', async () => {
    const { deps, calls } = recordingDeps({ resolveOwner: async () => null });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.body.linked, false);
    assert.equal(calls.linkPerson.length, 0);
    assert.equal(out.body.cadence_stamped.target, 'self');
    assert.equal(out.body.status, 'promoted');
  });

  it('no owner AND no stampable cadence → still dispositions terminal (guaranteed effect)', async () => {
    const { deps, calls } = recordingDeps({
      resolveOwner: async () => null,
      stampCadence: async () => ({ ok: false, reason: 'no_active_cadence' }),
    });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.status, 200);
    assert.equal(out.body.cadence_stamped, null);
    assert.equal(out.body.status, 'promoted');
    assert.equal(calls.disposition.length, 1);
    assert.equal(calls.refresh, 0); // no cadence stamped → no queue refresh
  });

  it('already-terminal row → already_qualified, no writes', async () => {
    const { deps, calls } = recordingDeps({ getRow: async () => ({ id: UUID_A, entity_id: UUID_P, status: 'promoted', metadata: {} }) });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.body.already_qualified, true);
    assert.equal(calls.disposition.length, 0);
    assert.equal(calls.stampCadence.length, 0);
  });

  it('disposition PATCH fails → 502, outcome-truthful (no false promote)', async () => {
    const { deps } = recordingDeps({ dispositionInbox: async () => ({ ok: false, detail: 'boom' }) });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.status, 502);
    assert.equal(out.body.error, 'inbox_disposition_failed');
  });

  it('row not found → 404; bad id → 400', async () => {
    const { deps } = recordingDeps({ getRow: async () => null });
    assert.equal((await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps)).status, 404);
    assert.equal((await performContactQualify({ inboxItemId: 'not-a-uuid', workspaceId: 'ws' }, deps)).status, 400);
  });
});

describe('filterQualifiableContacts (R29 Unit 2 — firm-as-person exclusion)', () => {
  it('keeps real person names; drops firms mistyped as persons', () => {
    const rows = [
      { entity_type: 'person', contact_name: 'Jane A. Smith', has_email: true },   // real human → keep
      { entity_type: 'person', contact_name: "Sean O'Brien", has_email: true },    // real human → keep
      { entity_type: 'person', contact_name: 'Jamestown' },                        // single-token firm → drop
      { entity_type: 'person', contact_name: 'MetLife' },                          // single-token firm → drop
      { entity_type: 'person', contact_name: 'Akridge' },                          // single-token firm → drop
      { entity_type: 'person', contact_name: 'Foulger Pratt Capital LLC' },        // firm suffix → drop
    ];
    const kept = filterQualifiableContacts(rows);
    assert.deepEqual(kept.map((r) => r.contact_name), ['Jane A. Smith', "Sean O'Brien"]);
  });

  it('passes non-person rows (organizations) untouched regardless of name shape', () => {
    const rows = [
      { entity_type: 'organization', contact_name: 'Northwestern Mutual' },
      { entity_type: 'organization', contact_name: 'Jamestown' },
    ];
    assert.equal(filterQualifiableContacts(rows).length, 2);
  });

  it('drops person rows with a missing / blank name; tolerates non-array input', () => {
    assert.equal(filterQualifiableContacts([{ entity_type: 'person', contact_name: null }]).length, 0);
    assert.equal(filterQualifiableContacts([{ entity_type: 'person', contact_name: '' }]).length, 0);
    assert.deepEqual(filterQualifiableContacts(null), []);
    assert.deepEqual(filterQualifiableContacts(undefined), []);
  });
});

describe('stampContactOnActiveCadence onlyContactless filter (R28)', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  it('onlyContactless:true restricts the cadence GET to contactless rows', async () => {
    let getUrl = null;
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && m === 'GET') {
        getUrl = u;
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{ id: 'cad-x', metadata: {} }]); } };
      }
      if (u.includes('/touchpoint_cadence') && m === 'PATCH') {
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{}]); } };
      }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    const r = await stampContactOnActiveCadence({ entityId: UUID_OWNER, contactEntityId: UUID_P, onlyContactless: true });
    assert.equal(r.ok, true);
    assert.match(getUrl, /contact_id=is\.null/);
    assert.match(getUrl, /sf_contact_id=is\.null/);
  });

  it('onlyContactless defaults off (no contactless filter)', async () => {
    let getUrl = null;
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && m === 'GET') {
        getUrl = u;
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{ id: 'cad-x', metadata: {} }]); } };
      }
      if (u.includes('/touchpoint_cadence') && m === 'PATCH') {
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{}]); } };
      }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    await stampContactOnActiveCadence({ entityId: UUID_OWNER, contactEntityId: UUID_P, seedIfValuable: false });
    assert.doesNotMatch(getUrl, /contact_id=is\.null/);
  });
});

// ── Value-gated cadence seed: contact-acquisition → outreach surface wire ────
// When a contactless owner gains a contact and has NO active cadence, seed ONE
// prospecting cadence ONLY if it clears the R63 BD-value floor — so a $1M+ owner
// becomes workable outreach instead of stranding connected-but-cadence-less.
describe('maybeSeedValuableCadence (value-gated seed)', () => {
  const NEW_CAD = 'cad-seeded-1';

  // A seed dep that mimics getCadenceState: a fresh CREATE (is_new) carries the
  // contact + a now-ish next_touch_due; an existing row would return is_new:false.
  function seedDep(behaviour = 'create') {
    return async (ids /*, propertyInfo */) => {
      if (behaviour === 'fail') return { ok: false, error: 'insert_failed' };
      if (behaviour === 'existing') {
        return { ok: true, is_new: false, cadence: { id: 'cad-paused', phase: 'paused', contact_id: null } };
      }
      return {
        ok: true, is_new: true,
        cadence: {
          id: NEW_CAD, phase: 'prospecting', bd_opportunity_id: null,
          contact_id: ids.contact_id || null, sf_contact_id: ids.sf_contact_id || null,
          next_touch_due: new Date().toISOString(),
        },
      };
    };
  }

  it('high-value owner (signal=true) seeds exactly one prospecting cadence with the contact set', async () => {
    let seedCalls = 0;
    const r = await maybeSeedValuableCadence({
      entityId: UUID_OWNER, contactEntityId: UUID_P,
      deps: {
        signalCheck: async () => true,
        seedCadence: async (ids, pi) => { seedCalls += 1; return seedDep('create')(ids, pi); },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.seeded, true);
    assert.equal(r.cadenceId, NEW_CAD);
    assert.ok(r.cadenceNextDue, 'seeded cadence carries next_touch_due (surfaces in focus session)');
    assert.equal(seedCalls, 1, 'exactly one cadence created');
  });

  it('low-value owner (signal=false) gains a contact but NO cadence is seeded', async () => {
    let seedCalls = 0;
    const r = await maybeSeedValuableCadence({
      entityId: UUID_OWNER, contactEntityId: UUID_P,
      deps: {
        signalCheck: async () => false,
        seedCadence: async () => { seedCalls += 1; return seedDep('create')(); },
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'below_value_floor');
    assert.equal(seedCalls, 0, 'seed never attempted below the floor (no spam)');
  });

  it('existing (paused) cadence found → not a seed, left untouched (no duplicate)', async () => {
    const r = await maybeSeedValuableCadence({
      entityId: UUID_OWNER, contactEntityId: UUID_P,
      deps: { signalCheck: async () => true, seedCadence: seedDep('existing') },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_active_cadence');
    assert.notEqual(r.seeded, true);
  });

  it('fails closed on a signal-check error (no seed)', async () => {
    let seedCalls = 0;
    const r = await maybeSeedValuableCadence({
      entityId: UUID_OWNER, contactEntityId: UUID_P,
      deps: {
        signalCheck: async () => { throw new Error('boom'); },
        seedCadence: async () => { seedCalls += 1; return seedDep('create')(); },
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'signal_check_failed');
    assert.equal(seedCalls, 0);
  });
});

describe('stampContactOnActiveCadence → seed branch wiring', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  // No active cadence (GET returns []) → the seed deps decide. A valuable owner
  // seeds; the stamp returns the seeded cadence id instead of no_active_cadence.
  it('no active cadence + valuable owner → seeds, returns seeded cadence', async () => {
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && m === 'GET') {
        return { ok: true, status: 200, headers: { get: () => '0-0/0' }, async text() { return JSON.stringify([]); } };
      }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    const r = await stampContactOnActiveCadence({
      entityId: UUID_OWNER, contactEntityId: UUID_P,
      deps: {
        signalCheck: async () => true,
        seedCadence: async (ids) => ({ ok: true, is_new: true, cadence: { id: 'cad-new', next_touch_due: new Date().toISOString(), contact_id: ids.contact_id } }),
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.seeded, true);
    assert.equal(r.cadenceId, 'cad-new');
  });

  it('no active cadence + low-value owner → no_active_cadence (no seed)', async () => {
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && m === 'GET') {
        return { ok: true, status: 200, headers: { get: () => '0-0/0' }, async text() { return JSON.stringify([]); } };
      }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    const r = await stampContactOnActiveCadence({
      entityId: UUID_OWNER, contactEntityId: UUID_P,
      deps: { signalCheck: async () => false, seedCadence: async () => { throw new Error('should not seed'); } },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_active_cadence');
  });

  it('seedIfValuable:false → never seeds even when no active cadence', async () => {
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && m === 'GET') {
        return { ok: true, status: 200, headers: { get: () => '0-0/0' }, async text() { return JSON.stringify([]); } };
      }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    const r = await stampContactOnActiveCadence({
      entityId: UUID_OWNER, contactEntityId: UUID_P, seedIfValuable: false,
      deps: { signalCheck: async () => { throw new Error('should not check'); } },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_active_cadence');
  });

  it('existing active cadence → stamps it, no seed (no duplicate)', async () => {
    let seeded = false;
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && m === 'GET') {
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{ id: 'cad-x', bd_opportunity_id: null, next_touch_due: null, metadata: {} }]); } };
      }
      if (u.includes('/touchpoint_cadence') && m === 'PATCH') {
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{}]); } };
      }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    const r = await stampContactOnActiveCadence({
      entityId: UUID_OWNER, contactEntityId: UUID_P,
      deps: { signalCheck: async () => { seeded = true; return true; }, seedCadence: async () => { seeded = true; return {}; } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.cadenceId, 'cad-x');
    assert.notEqual(r.seeded, true);
    assert.equal(seeded, false, 'seed path never reached when an active cadence exists');
  });
});
