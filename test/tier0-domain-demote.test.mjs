import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTier0DemotionIndex,
  tier0DemotionVerdict,
  tier0DemotionReadiness,
} from '../api/_shared/tier0-domain-demote.js';

test('buildTier0DemotionIndex keys on domain+arm+key, never bare domain', () => {
  const idx = buildTier0DemotionIndex([
    { domain: 'ngpv.com', match_arm: 'exact', match_key: 'ngp' },
  ]);
  assert.equal(idx.size, 1);
  assert.ok(idx.has('ngpv.com::exact::ngp'));
});

test('buildTier0DemotionIndex drops rows missing any of domain/arm/key', () => {
  const idx = buildTier0DemotionIndex([
    { domain: 'x.com', match_arm: 'exact' }, // no key
    { domain: 'y.com', match_key: 'k' }, // no arm
    { match_arm: 'exact', match_key: 'k' }, // no domain
    {},
  ]);
  assert.equal(idx.size, 0);
});

test('tier0DemotionVerdict demotes only an exact domain+arm+key match', () => {
  const idx = buildTier0DemotionIndex([
    { domain: 'ngpv.com', match_arm: 'exact', match_key: 'ngp' },
  ]);
  const same = tier0DemotionVerdict({ domain: 'NGPV.com', match_arm: 'Exact', match_key: 'NGP' }, idx);
  assert.equal(same.demoted, true);
  assert.equal(same.reason, 'rejected_same_domain_arm_key');
});

test('P194 corroboration trap: a shared DOMAIN alone must NOT demote a different arm/key', () => {
  // 16 open cards collided with an attached domain and 0 of 16 were contradictions
  // (P194). This module must not generalize a reject to "this domain is bad".
  const idx = buildTier0DemotionIndex([
    { domain: 'ngpv.com', match_arm: 'exact', match_key: 'ngp-vi-essex-vt' },
  ]);
  const differentKey = tier0DemotionVerdict(
    { domain: 'ngpv.com', match_arm: 'exact', match_key: 'ngp-vi-phoenix-az' },
    idx
  );
  assert.equal(differentKey.demoted, false, 'a different match_key on the same domain must not be demoted');

  const differentArm = tier0DemotionVerdict(
    { domain: 'ngpv.com', match_arm: 'domain_is_core_prefix', match_key: 'ngp-vi-essex-vt' },
    idx
  );
  assert.equal(differentArm.demoted, false, 'a different match_arm on the same domain/key must not be demoted');
});

test('tier0DemotionVerdict never drops (excludes) a card, only demotes ranking', () => {
  const idx = buildTier0DemotionIndex([{ domain: 'x.com', match_arm: 'exact', match_key: 'x' }]);
  const v = tier0DemotionVerdict({ domain: 'x.com', match_arm: 'exact', match_key: 'x' }, idx);
  // demoted is a boolean signal, never a hard exclusion field like `excluded`/`dropped`
  assert.equal(typeof v.demoted, 'boolean');
  assert.ok(!('excluded' in v));
  assert.ok(!('dropped' in v));
});

test('tier0DemotionVerdict on an empty index never demotes', () => {
  const idx = buildTier0DemotionIndex([]);
  const v = tier0DemotionVerdict({ domain: 'x.com', match_arm: 'exact', match_key: 'x' }, idx);
  assert.equal(v.demoted, false);
  assert.equal(v.reason, null);
});

test('tier0DemotionVerdict on a candidate missing a field never demotes', () => {
  const idx = buildTier0DemotionIndex([{ domain: 'x.com', match_arm: 'exact', match_key: 'x' }]);
  const v = tier0DemotionVerdict({ domain: 'x.com', match_arm: 'exact' }, idx);
  assert.equal(v.demoted, false);
});

test('tier0DemotionReadiness reports the honest measured state: 0 rejects today', () => {
  // Measured live 2026-09-10 on lcc_tier0_confirm_log: 27 rows, 0 verdict=reject.
  // This is the state this module was BUILT against — do not wire a cron/view
  // until this flips true on real data.
  const r = tier0DemotionReadiness([]);
  assert.equal(r.readyToWire, false);
  assert.equal(r.rejectCount, 0);
});

test('tier0DemotionReadiness flips true the moment a real reject lands', () => {
  const r = tier0DemotionReadiness([{ domain: 'x.com', match_arm: 'exact', match_key: 'x' }]);
  assert.equal(r.readyToWire, true);
  assert.equal(r.rejectCount, 1);
});
