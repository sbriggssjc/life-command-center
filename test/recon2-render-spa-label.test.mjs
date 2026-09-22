// RECON2-render-spa + RECON2-render-dossier — the property panel, the dia
// sales-comps table and the dossier label an expiration_state='expired_unconfirmed'
// lease, and every other state (and every gov lease, which has no such column)
// renders byte-for-byte as before. Labelling only: which lease is picked as the
// "active" one never changes.
//
// The SPA cannot import mcp/ (classic scripts, one global scope), so
// lease-expiration-label.js mirrors the server string. The LOCK-STEP test below
// fails on any drift between the two, and carries its own positive control
// (a one-character mutation of the mirror must be caught).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { leaseExpirationStateLabel, EXPIRED_UNCONFIRMED } from '../mcp/lease-expiration-state.js';
import { applyLeaseExpirationStateTag } from '../api/_handlers/entities-handler.js';
import { __test__ as dossierTest } from '../api/_shared/dossier-generator.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const OTHER_STATES = ['in_term', 'expired_confirmed', 'occupied_term_unknown',
  'renewed_confirmed', 'expiration_unknown', null, undefined];
const DATES = ['2024-03-31', '2024-03-31T00:00:00+00:00', null, undefined, ''];

// Load the SPA mirror in an isolated context, with the app's own esc().
function loadSpa(src = read('lease-expiration-label.js')) {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const ctx = { window: {}, esc };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window;
}

function lockStepMismatches(spa) {
  const bad = [];
  for (const state of [EXPIRED_UNCONFIRMED, ...OTHER_STATES]) {
    for (const d of DATES) {
      const lease = { expiration_state: state, lease_expiration: d, is_active: true };
      const want = leaseExpirationStateLabel(lease);
      const got = spa._leaseExpStateLabel(lease);
      if (want !== got) bad.push({ state, d, want, got });
    }
  }
  for (const l of [null, undefined, {}]) {
    if (spa._leaseExpStateLabel(l) !== leaseExpirationStateLabel(l)) bad.push({ l });
  }
  return bad;
}

describe('SPA label mirror is in lock-step with mcp/lease-expiration-state.js', () => {
  it('matches the server helper for every state × date shape', () => {
    assert.deepEqual(lockStepMismatches(loadSpa()), []);
  });

  it('POSITIVE CONTROL: a one-word drift in the mirror is caught', () => {
    const drifted = read('lease-expiration-label.js')
      .replace('renewal not on file (unconfirmed)`', 'renewal not found (unconfirmed)`');
    assert.notEqual(drifted, read('lease-expiration-label.js'), 'mutation must apply');
    assert.ok(lockStepMismatches(loadSpa(drifted)).length > 0);
  });

  it('badge is empty for every other state and a gov lease (no column)', () => {
    const spa = loadSpa();
    for (const s of OTHER_STATES) {
      assert.equal(spa._leaseExpStateBadge({ expiration_state: s, lease_expiration: '2024-03-31' }), '', String(s));
    }
    // gov leases have no expiration_state column at all
    assert.equal(spa._leaseExpStateBadge({ lease_expiration: '2024-03-31', is_active: true, tenant_agency: 'SSA' }), '');
    assert.equal(spa._leaseExpStateBadge(null), '');
  });

  it('badge carries the exact label for expired_unconfirmed', () => {
    const spa = loadSpa();
    const html = spa._leaseExpStateBadge({ expiration_state: EXPIRED_UNCONFIRMED, lease_expiration: '2024-03-31' });
    assert.match(html, /Expired 2024-03-31 — renewal not on file \(unconfirmed\)/);
    assert.match(html, /class="lease-exp-unconfirmed"/);
  });
});

describe('index.html loads the mirror as a classic script before its consumers', () => {
  const html = read('index.html');
  const idx = (f) => html.search(new RegExp(`<script\\s+src="${f.replace('.', '\\.')}\\?v=`));
  it('loads before dialysis.js and detail.js, not as a module', () => {
    const lbl = idx('lease-expiration-label.js');
    assert.ok(lbl >= 0, 'index.html must load lease-expiration-label.js');
    assert.ok(lbl < idx('dialysis.js'));
    assert.ok(lbl < idx('detail.js'));
    assert.doesNotMatch(html, /type="module"\s+src="lease-expiration-label\.js/);
  });
  it('shares the cache-buster set with detail.js', () => {
    const v = (f) => (html.match(new RegExp(`${f.replace('.', '\\.')}\\?v=(\\d+)`)) || [])[1];
    assert.equal(v('lease-expiration-label.js'), v('detail.js'));
  });
});

describe('SPA call sites label only — the active-lease pick is untouched', () => {
  const detail = read('detail.js');
  const dia = read('dialysis.js');
  it('detail.js labels the rent-roll header, term timeline, lease tab, sub-detail and KPI', () => {
    assert.match(detail, /Active<\/span>';\n\s+html \+= _leaseExpStateBadge\(activeTerm\);/);
    assert.match(detail, /font-weight:600">Active<\/span>' \+ _leaseExpStateBadge\(t\);/);
    assert.match(detail, /const badge = _leaseExpStateBadge\(l\);/);
    assert.match(detail, /const _expBadge = _leaseExpStateBadge\(l\);/);
    assert.match(detail, /leaseExpStateLabel = _leaseExpStateLabel\(primaryLease\);/);
  });
  it('the three active-lease selectors RECON2 designed are unchanged', () => {
    assert.match(detail, /_ovLeases\.filter\(l => l && String\(l\.status \|\| ''\)\.toLowerCase\(\) === 'active' && l\.is_active === true\)/);
    assert.match(detail, /const activeLease = _udCache\.leases\.find\(ll => ll\.is_active === true \|\| ll\.is_active === 'true'\)/);
    assert.match(dia, /const aActive = \(a\.is_active === true \|\| a\.status === 'active'\) \? 1 : 0;/);
  });
  it('dialysis.js carries expiration_state into the comp row ONLY for expired_unconfirmed', () => {
    assert.match(dia, /data_quality_flag,expiration_state\)\)'/);
    assert.match(dia, /lease && lease\.expiration_state === 'expired_unconfirmed' \? \{ expiration_state: lease\.expiration_state \} : \{\}/);
    assert.match(dia, /const _expBadge = _leaseExpStateBadge\(r\);/);
  });
});

describe('dossier renders the expiration status row only when the packet carries it', () => {
  const lease = { tenant: 'DaVita', lease_start: '2014-04-01', lease_expiration: '2024-03-31' };
  const packet = (tl) => ({ identity: {}, ownership: {}, tenancy_lease: tl, operations: {}, valuation: {} });
  const tagged = (state) => {
    const tl = { tenant: { v: 'DaVita' }, lease_expiration: { v: '2024-03-31' } };
    return applyLeaseExpirationStateTag(tl, { ...lease, expiration_state: state });
  };

  it('adds an Expiration status row for expired_unconfirmed', () => {
    const out = dossierTest.renderPropertySections(packet(tagged(EXPIRED_UNCONFIRMED)));
    assert.match(out, /Expiration status<\/td><td class="v">Expired 2024-03-31 — renewal not on file \(unconfirmed\)/);
  });

  it('byte-for-byte unchanged for every other state and for a gov lease', () => {
    const baseline = dossierTest.renderPropertySections(
      packet({ tenant: { v: 'DaVita' }, lease_expiration: { v: '2024-03-31' } }));
    for (const s of OTHER_STATES) {
      assert.equal(dossierTest.renderPropertySections(packet(tagged(s))), baseline, String(s));
    }
    assert.doesNotMatch(baseline, /Expiration status/);
  });

  it('the deal dossier also carries the row when present, and nothing otherwise', () => {
    const deal = (tl) => ({ identity: {}, ownership: {}, tenancy_lease: tl, deal: {} });
    const withRow = dossierTest.renderDealSections(deal(tagged(EXPIRED_UNCONFIRMED)));
    assert.match(withRow, /Expiration status<\/td><td class="v">Expired 2024-03-31/);
    const baseline = dossierTest.renderDealSections(
      deal({ tenant: { v: 'DaVita' }, lease_expiration: { v: '2024-03-31' } }));
    for (const s of OTHER_STATES) {
      assert.equal(dossierTest.renderDealSections(deal(tagged(s))), baseline, String(s));
    }
  });
});
