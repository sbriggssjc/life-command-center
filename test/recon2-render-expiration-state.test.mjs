// RECON2-render — every human-facing lease reader labels an
// expiration_state='expired_unconfirmed' lease, and leaves every other state's
// output byte-for-byte what it was before.
//
// "Before" is measured, not asserted from memory: each reader's output for a row
// carrying some OTHER expiration_state (or NULL) must equal its output for the
// same row with no expiration_state key at all — the exact shape every reader
// received before RECON2 added the column.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { leaseExpirationStateLabel, EXPIRED_UNCONFIRMED } from '../mcp/lease-expiration-state.js';
import { hydrateSubjectFromRecord } from '../mcp/comps-tools.js';
import { applyLeaseExpirationStateTag } from '../api/_handlers/entities-handler.js';
import { __test__ as assetTest } from '../api/_shared/asset-entity.js';
import { __test__ as provTest } from '../api/_shared/provenance-row-context.js';

const LABEL = 'Expired 2024-03-31 — renewal not on file (unconfirmed)';
// Every value chk_leases_expiration_state admits other than the labelled one, plus NULL.
const OTHER_STATES = ['in_term', 'expired_confirmed', 'occupied_term_unknown',
  'renewed_confirmed', 'expiration_unknown', null];

const baseLease = () => ({
  lease_id: 4242, property_id: 777, tenant: 'DaVita', lease_start: '2014-04-01',
  lease_expiration: '2024-03-31', is_active: true,
});
const withState = (state) => ({ ...baseLease(), expiration_state: state });

describe('leaseExpirationStateLabel (shared helper)', () => {
  it('labels expired_unconfirmed with the date', () => {
    assert.equal(leaseExpirationStateLabel(withState(EXPIRED_UNCONFIRMED)), LABEL);
  });
  it('still labels when the date is missing, without inventing one', () => {
    assert.equal(leaseExpirationStateLabel({ expiration_state: EXPIRED_UNCONFIRMED }),
      'Expired — renewal not on file (unconfirmed)');
  });
  it('returns null for every other state and for no lease', () => {
    for (const s of OTHER_STATES) assert.equal(leaseExpirationStateLabel(withState(s)), null, String(s));
    assert.equal(leaseExpirationStateLabel(null), null);
    assert.equal(leaseExpirationStateLabel(baseLease()), null);
  });
});

// ── 1. mcp/comps-tools.js::hydrateSubjectFromRecord ─────────────────────────
function compsDeps(leaseRow, seen) {
  const dia = async (method, path) => {
    if (method === 'GET' && /^properties\?address=ilike/.test(path)) {
      return { ok: true, status: 200, data: [{
        property_id: 777, address: '1 Test Rd', city: 'Austin', state: 'TX',
        tenant: 'DaVita', building_size: 6000, total_chairs: 12, year_built: 2010,
        wavg_lease_expiration: null,
      }] };
    }
    if (method === 'GET' && /^leases\?property_id=eq/.test(path)) {
      if (seen) seen.push(path);
      return { ok: true, status: 200, data: [leaseRow] };
    }
    return { ok: true, status: 200, data: [] };
  };
  const gov = async () => ({ ok: true, status: 200, data: [] });
  return { diaQuery: dia, govQuery: gov };
}
async function hydrate(leaseRow, seen) {
  const subject = { address: '1 Test Rd', fields: {} };
  return hydrateSubjectFromRecord({ request: 'comps for 1 Test Rd, Austin, TX', subject, appraisal_mode: true },
    compsDeps(leaseRow, seen));
}

describe('call site 1 — hydrateSubjectFromRecord (comps subject)', () => {
  it('asks the dia lease read for expiration_state', async () => {
    const seen = [];
    await hydrate(withState(EXPIRED_UNCONFIRMED), seen);
    assert.match(seen[0], /select=lease_expiration,expiration_state/);
  });
  it('surfaces the label beside remaining_term for expired_unconfirmed', async () => {
    const s = await hydrate(withState(EXPIRED_UNCONFIRMED));
    assert.equal(s.lease_expiration, '2024-03-31');
    // A past expiration yields no remaining_term (unchanged behaviour) — the label is
    // what tells the reader why, instead of a silent blank.
    assert.equal(s.remaining_term, undefined);
    assert.equal(s.lease_expiration_note, LABEL);
    assert.equal(s.fields.lease_expiration_note, LABEL);
  });
  it('every other state is byte-identical to the pre-RECON2 row shape', async () => {
    const before = JSON.stringify(await hydrate(baseLease()));
    assert.ok(!before.includes('lease_expiration_note'));
    for (const st of OTHER_STATES) {
      assert.equal(JSON.stringify(await hydrate(withState(st))), before, String(st));
    }
  });
});

// ── 2. api/_handlers/entities-handler.js::buildPropertyPacket ──────────────
describe('call site 2 — buildPropertyPacket tenancy_lease', () => {
  const block = () => ({ tenant: { v: 'DaVita', source: 'leases' },
    lease_expiration: { v: '2024-03-31', source: 'leases' } });
  it('names expiration_state explicitly for expired_unconfirmed', () => {
    const out = applyLeaseExpirationStateTag(block(), withState(EXPIRED_UNCONFIRMED));
    assert.deepEqual(out.lease_expiration_state,
      { v: LABEL, source: 'leases', expiration_state: EXPIRED_UNCONFIRMED });
    assert.deepEqual(out.lease_expiration, { v: '2024-03-31', source: 'leases' }, 'existing tag untouched');
  });
  it('every other state, a gov lease (no column) and no lease leave the block byte-identical', () => {
    const before = JSON.stringify(block());
    for (const st of OTHER_STATES) {
      assert.equal(JSON.stringify(applyLeaseExpirationStateTag(block(), withState(st))), before, String(st));
    }
    assert.equal(JSON.stringify(applyLeaseExpirationStateTag(block(), baseLease())), before);
    assert.equal(JSON.stringify(applyLeaseExpirationStateTag(block(), null)), before);
  });
});

// ── 3. api/_shared/asset-entity.js lease_expiration field builder ──────────
describe('call site 3 — asset-entity buildTenants', () => {
  const { buildTenants } = assetTest;
  it('labels an expired_unconfirmed tenant row', () => {
    const [row] = buildTenants([withState(EXPIRED_UNCONFIRMED)]);
    assert.deepEqual(row, { name: 'DaVita', lease_expiration: '2024-03-31',
      expiration_state: EXPIRED_UNCONFIRMED, lease_expiration_note: LABEL });
  });
  it('every other state is byte-identical to the pre-RECON2 row shape', () => {
    const before = JSON.stringify(buildTenants([baseLease()]));
    assert.equal(before, JSON.stringify([{ name: 'DaVita', lease_expiration: '2024-03-31' }]));
    for (const st of OTHER_STATES) {
      assert.equal(JSON.stringify(buildTenants([withState(st)])), before, String(st));
    }
  });
});

// ── 4. api/_shared/provenance-row-context.js provenance sentence ───────────
describe('call site 4 — provenance review-queue label (dia.leases)', () => {
  const cfg = provTest.TABLE_CONFIG['dia.leases'];
  it('selects expiration_state (dia only — gov has no leases config to widen)', () => {
    assert.match(cfg.cols, /\bexpiration_state\b/);
    assert.equal(provTest.TABLE_CONFIG['gov.leases'], undefined);
  });
  it('replaces "expires <date>" with the label for expired_unconfirmed', () => {
    assert.equal(cfg.label(withState(EXPIRED_UNCONFIRMED)), `DaVita · ${LABEL}`);
  });
  it('every other state renders exactly as before', () => {
    const before = cfg.label(baseLease());
    assert.equal(before, 'DaVita · expires 2024-03-31');
    for (const st of OTHER_STATES) assert.equal(cfg.label(withState(st)), before, String(st));
  });
});
