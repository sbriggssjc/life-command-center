// Owner cross-reference resolver tests.
//
// Covers the pure naming-distinctiveness policy (sharedCoreOf /
// isDistinctiveSharedCore / namingCoreMatches / isReusablePersonName) so the
// safe-vs-wrong-family decision is verified independent of the DB, plus the
// deps-injected adapter (buildCrossRefAdapter) and the dry-run sizer
// (crossRefDryRun). Cores fed to the pure helpers are DB-normalized
// (lcc_normalize_entity_name) cores, matching the SQL resolver.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sharedCoreOf, isDistinctiveSharedCore, namingCoreMatches, isReusablePersonName,
  buildCrossRefAdapter, crossRefDryRun,
} from '../api/_shared/owner-cross-reference.js';

describe('sharedCoreOf (whole-token overlap)', () => {
  it('exact match', () => assert.equal(sharedCoreOf('starwood', 'starwood'), 'starwood'));
  it('whole-token prefix (a prefix of b)', () =>
    assert.equal(sharedCoreOf('starwood', 'starwood real estate income sreit'), 'starwood'));
  it('whole-token prefix (b prefix of a)', () =>
    assert.equal(sharedCoreOf('smith family 2019', 'smith family'), 'smith family'));
  it('NOT a sub-token prefix (starwood vs starwoodish)', () =>
    assert.equal(sharedCoreOf('starwood', 'starwoodish capital'), null));
  it('no overlap → null', () => assert.equal(sharedCoreOf('palestra', 'brookfield'), null));
  it('empty → null', () => { assert.equal(sharedCoreOf('', 'x'), null); assert.equal(sharedCoreOf('x', ''), null); });
});

describe('isDistinctiveSharedCore (the wrong-family guard)', () => {
  it('multi-token core is distinctive', () => assert.equal(isDistinctiveSharedCore('smith family'), true));
  it('distinctive single token (Starwood / Palestra) passes', () => {
    assert.equal(isDistinctiveSharedCore('starwood'), true);
    assert.equal(isDistinctiveSharedCore('palestra'), true);
  });
  it('common short single token (thomas / sage) rejected', () => {
    assert.equal(isDistinctiveSharedCore('thomas'), false);  // len 6 < 8
    assert.equal(isDistinctiveSharedCore('sage'), false);    // len 4 < 8
  });
  it('generic industry single token (healthcare) rejected even though long', () =>
    assert.equal(isDistinctiveSharedCore('healthcare'), false));
  it('empty rejected', () => assert.equal(isDistinctiveSharedCore(''), false));
});

describe('namingCoreMatches (end-to-end naming policy)', () => {
  it('Starwood REIT ↔ Starwood Capital Group → match', () =>
    assert.equal(namingCoreMatches('starwood real estate income sreit', 'starwood'), true));
  it('Thomas Properties ↔ Thomas Taft Jr → reject (common single token)', () =>
    assert.equal(namingCoreMatches('thomas', 'thomas taft jr'), false));
  it('Healthcare Trust ↔ Healthcare Property Advisors → reject (generic token)', () =>
    assert.equal(namingCoreMatches('healthcare', 'healthcare advisors'), false));
  it('unrelated → reject', () => assert.equal(namingCoreMatches('palestra', 'brookfield'), false));
});

describe('isReusablePersonName (defense-in-depth guard)', () => {
  it('a real human name passes', () => assert.equal(isReusablePersonName('Mark Deason'), true));
  it('a firm / implausible name fails', () => {
    assert.equal(isReusablePersonName('Starwood Capital LLC'), false);
    assert.equal(isReusablePersonName('Starwood Real Estate Income Trust'), false);
  });
  it('empty / null fails', () => { assert.equal(isReusablePersonName(''), false); assert.equal(isReusablePersonName(null), false); });
});

// --- adapter (buildCrossRefAdapter) ---------------------------------------
function rpcDeps(rows) {
  const calls = [];
  return {
    calls,
    deps: { opsQuery: async (m, p, b) => { calls.push([m, p, b]); return { ok: true, data: rows }; } },
  };
}

describe('buildCrossRefAdapter', () => {
  it('returns the reused person + strategy + source on a hit', async () => {
    const { deps, calls } = rpcDeps([{
      person_entity_id: 'p1', person_name: 'Mark Deason', person_role: 'principal',
      strategy: 'naming_core', source_entity_id: 's1', source_owner_name: 'Starwood Capital Group', confidence: 'medium',
    }]);
    const crossRef = buildCrossRefAdapter(deps);
    const out = await crossRef({ entity_id: 'own-1' });
    assert.equal(out.ok, true);
    assert.equal(out.person_name, 'Mark Deason');
    assert.equal(out.strategy, 'naming_core');
    assert.equal(out.source_entity_id, 's1');
    assert.equal(out.source_owner_name, 'Starwood Capital Group');
    assert.equal(calls[0][1], 'rpc/lcc_resolve_owner_cross_reference');
    assert.deepEqual(calls[0][2], { p_entity_id: 'own-1' });
  });

  it('no resolver row → no_sibling (falls through to SOS/web/manual)', async () => {
    const crossRef = buildCrossRefAdapter(rpcDeps([]).deps);
    assert.deepEqual(await crossRef({ entity_id: 'own-1' }), { ok: false, reason: 'no_sibling' });
  });

  it('a guard-failing person from the resolver → guard_rejected (never attached)', async () => {
    const crossRef = buildCrossRefAdapter(rpcDeps([{ person_name: 'Starwood Capital LLC', strategy: 'naming_core' }]).deps);
    assert.deepEqual(await crossRef({ entity_id: 'own-1' }), { ok: false, reason: 'guard_rejected' });
  });

  it('no entity_id → no_entity (no RPC call)', async () => {
    const { deps, calls } = rpcDeps([]);
    assert.deepEqual(await buildCrossRefAdapter(deps)({}), { ok: false, reason: 'no_entity' });
    assert.equal(calls.length, 0);
  });

  it('resolver error / not-ok → resolver_error', async () => {
    const throwing = buildCrossRefAdapter({ opsQuery: async () => { throw new Error('boom'); } });
    assert.equal((await throwing({ entity_id: 'x' })).reason, 'resolver_error');
    const notOk = buildCrossRefAdapter({ opsQuery: async () => ({ ok: false, data: 'nope' }) });
    assert.equal((await notOk({ entity_id: 'x' })).reason, 'resolver_error');
  });
});

// --- dry-run sizer (crossRefDryRun) ---------------------------------------
describe('crossRefDryRun', () => {
  it('tallies by strategy + builds a sample; guard-failing rows are dropped not counted', async () => {
    const rows = [
      { owner_name: 'Starwood REIT', rank_value: 1047199, strategy: 'naming_core', source_owner_name: 'Starwood Capital Group', person_name: 'Mark Deason' },
      { owner_name: 'Palestra Properties', rank_value: 448815, strategy: 'naming_core', source_owner_name: 'Palestra Real Estate Partners', person_name: 'Vincent Curran' },
      { owner_name: 'Acme Co-owner', rank_value: 900000, strategy: 'same_asset', source_owner_name: 'Acme Partners', person_name: 'Jane Roe' },
      { owner_name: 'Junk Owner', rank_value: 500000, strategy: 'naming_core', source_owner_name: 'X', person_name: 'Junk Capital LLC' }, // guard-fails
    ];
    const out = await crossRefDryRun({ opsQuery: async () => ({ ok: true, data: rows }) }, { minValue: 0, limit: 100 });
    assert.equal(out.ok, true);
    assert.equal(out.resolved, 3);
    assert.equal(out.guard_dropped, 1);
    assert.deepEqual(out.by_strategy, { naming_core: 2, same_asset: 1 });
    assert.equal(out.sample.length, 3);
    assert.equal(out.sample[0].reuse_from, 'Starwood Capital Group');
    assert.equal(out.sample[0].rank_value, 1047199);
  });

  it('preview error → not ok', async () => {
    const out = await crossRefDryRun({ opsQuery: async () => ({ ok: false, data: 'err' }) }, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'preview_error');
  });
});
