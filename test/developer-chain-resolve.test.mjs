// UW#7 — developer-chain-resolve worker tests.
//
// Covers the pure classifier (classifyDeveloperOrigin) across every bucket and
// the deps-injected per-row core (processChainResolveRow): the resolve path
// (entity mint + provenance gate + fill-blanks write + task complete), the
// fill-blanks no-op, a provenance block, an entity-guard rejection, and the
// non-developer defer.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDeveloperName,
  classifyDeveloperOrigin,
  processChainResolveRow,
  chainResolveDisposition,
} from '../api/_handlers/developer-chain-resolve.js';

describe('classifyDeveloperOrigin', () => {
  it('Tier A — build-to-suit origin resolves (developer by construction)', () => {
    const c = classifyDeveloperOrigin({ earliest_owner: 'Acme Holdings LLC', owner_links: 3, is_build_to_suit: true, cur_true_owner_name: 'Boyd Watterson' });
    assert.equal(c.resolve, true);
    assert.equal(c.tier, 'bts_origin');
    assert.equal(c.developer_name, 'Acme Holdings LLC');
    assert.ok(c.confidence >= 0.8);
  });

  it('Tier B — explicit development keyword at a genuine chain origin resolves', () => {
    for (const name of ['DOMINION SHORE DEVELOPMENT CORPORATION', 'Amcraft Construction Co', 'Hines Two Renaissance', 'Duke Realty Limited Partnership']) {
      const c = classifyDeveloperOrigin({ earliest_owner: name, owner_links: 3, is_build_to_suit: false, cur_true_owner_name: 'NGP Capital' });
      assert.equal(c.resolve, true, name);
      assert.equal(c.tier, 'developer_keyword', name);
    }
  });

  it('rejects a bank/lender at origin (foreclosure interim, not a developer)', () => {
    for (const name of ['WELLS FARGO BANK, NATIONAL ASSOCIATION', 'Empire Insurance Company', 'Some Trust Company']) {
      const c = classifyDeveloperOrigin({ earliest_owner: name, owner_links: 3, is_build_to_suit: false });
      assert.equal(c.resolve, false, name);
      assert.equal(c.reason, 'origin_not_developer', name);
    }
  });

  it('rejects a REIT/income trust at origin', () => {
    const c = classifyDeveloperOrigin({ earliest_owner: 'GOVERNMENT PROPERTIES INCOME TRUST LLC', owner_links: 2, is_build_to_suit: false });
    assert.equal(c.resolve, false);
    assert.equal(c.reason, 'origin_not_developer');
  });

  it('rejects a net-lease financier (VEREIT / Capital Lease Funding) even on the BTS path (UW#7b)', () => {
    for (const name of ['Capital Lease Funding AKA VEREIT', 'VEREIT', 'Spirit Realty Capital', 'Lexington Realty Trust']) {
      const c = classifyDeveloperOrigin({ earliest_owner: name, owner_links: 3, is_build_to_suit: true });
      assert.equal(c.resolve, false, name);
      assert.equal(c.reason, 'origin_not_developer', name);
    }
  });

  it('rejects an individual human name at origin (the landowner, not the developer) — UW#7b', () => {
    // bare person names — even on the BTS path — are the prior landowner, never the developer
    for (const name of ['SEVDE MARGUERITE', 'Gary Brown', 'Robert J. Smith']) {
      const c = classifyDeveloperOrigin({ earliest_owner: name, owner_links: 3, is_build_to_suit: true });
      assert.equal(c.resolve, false, name);
      assert.equal(c.reason, 'origin_is_person', name);
    }
    // a developer BRAND that reads as a person ("Trammell Crow") still resolves (dev signal wins)
    const tc = classifyDeveloperOrigin({ earliest_owner: 'Trammell Crow', owner_links: 3, is_build_to_suit: true });
    assert.equal(tc.resolve, true);
    assert.equal(tc.tier, 'bts_origin');
    // a development company named after a person is a legitimate org
    const jsd = classifyDeveloperOrigin({ earliest_owner: 'John Smith Development', owner_links: 3, is_build_to_suit: false, cur_true_owner_name: 'Other' });
    assert.equal(jsd.resolve, true);
    assert.equal(jsd.tier, 'developer_keyword');
    // an org with a firm suffix is never mistaken for a person
    assert.equal(classifyDeveloperOrigin({ earliest_owner: 'Acme Holdings LLC', owner_links: 3, is_build_to_suit: true }).resolve, true);
  });

  it('a generic org (no dev signal, no reject) defers as ambiguous — not auto-resolved', () => {
    for (const name of ['DRA CRT CHAMBLEE CENTER LLC', 'ELMAN KC LLC', 'BLDG 11, LLC', 'MIDDLE STREET OFFICE TOWER A ASSOCIATES LIMITED PARTNERSHIP']) {
      const c = classifyDeveloperOrigin({ earliest_owner: name, owner_links: 3, is_build_to_suit: false, cur_true_owner_name: 'Other' });
      assert.equal(c.resolve, false, name);
      assert.equal(c.reason, 'ambiguous_generic_org', name);
    }
  });

  it('rejects placeholder/role-only origins even on the BTS path (the live-gate find)', () => {
    for (const name of ['Previous Owner', 'Owner', 'Seller', 'Various', 'Unknown', 'N/A', 'Prior owner']) {
      const c = classifyDeveloperOrigin({ earliest_owner: name, owner_links: 3, is_build_to_suit: true });
      assert.equal(c.resolve, false, name);
      assert.equal(c.reason, 'guard_rejected', name);
    }
    // a real name that merely CONTAINS a role word still resolves on BTS
    assert.equal(classifyDeveloperOrigin({ earliest_owner: 'Chandler Property', owner_links: 5, is_build_to_suit: true }).resolve, true);
    // CoStar attribution leakage ($ / alloc'd / Private/Other) → not a developer
    assert.equal(classifyDeveloperOrigin({ earliest_owner: "Hilligas Co Inc Private/Other ($6.9m alloc'd)", owner_links: 4, is_build_to_suit: true }).reason, 'origin_not_developer');
  });

  it('no chain (owner_links<=1 or no origin) defers to UW#6', () => {
    assert.equal(classifyDeveloperOrigin({ earliest_owner: 'Foo Development LLC', owner_links: 1, is_build_to_suit: true }).reason, 'no_chain');
    assert.equal(classifyDeveloperOrigin({ earliest_owner: null, owner_links: 5, is_build_to_suit: true }).reason, 'no_chain');
    assert.equal(classifyDeveloperOrigin(undefined).reason, 'no_chain');
  });

  it('origin == current true owner is no real trace', () => {
    const c = classifyDeveloperOrigin({ earliest_owner: 'Albany Road Real Estate Partners', owner_links: 2, is_build_to_suit: false, cur_true_owner_name: 'albany road real estate partners' });
    assert.equal(c.reason, 'origin_equals_current');
  });

  it('already-resolved (developer present) is skipped — fill-blanks', () => {
    const c = classifyDeveloperOrigin({ earliest_owner: 'Hines Development', owner_links: 3, is_build_to_suit: true, current_developer: 'Existing Dev Co' });
    assert.equal(c.reason, 'already_resolved');
  });

  it('rejects structural junk (guard) and federal/$-shape (not_developer) at origin', () => {
    // structural garbage (embedded phone) → the shared isJunkEntityName guard
    assert.equal(classifyDeveloperOrigin({ earliest_owner: 'Foo Dev (916) 768-5544', owner_links: 3, is_build_to_suit: true }).reason, 'guard_rejected');
    // federal agency → FEDERAL_AGENCY_RE
    assert.equal(classifyDeveloperOrigin({ earliest_owner: 'United States of America', owner_links: 3, is_build_to_suit: true }).reason, 'origin_not_developer');
    // $ amounts / CMBS codes are non-developer capture shapes
    assert.equal(classifyDeveloperOrigin({ earliest_owner: 'D H Ventures Dexia Group ($5.0m)', owner_links: 3, is_build_to_suit: false }).reason, 'origin_not_developer');
  });
});

describe('cleanDeveloperName', () => {
  it('trims, collapses whitespace, strips trailing separators', () => {
    assert.equal(cleanDeveloperName('  Foo   Bar Development,  '), 'Foo Bar Development');
    assert.equal(cleanDeveloperName(null), '');
  });
});

// ---- deps-injected processor ------------------------------------------------
function recordingDeps(overrides = {}) {
  const calls = { ensure: [], gate: [], patch: [], ops: [] };
  const deps = {
    runId: 'run-1',
    now: '2026-06-21T00:00:00.000Z',
    ensureEntityLink: async (a) => { calls.ensure.push(a); return { ok: true, entityId: 'dev-ent-1' }; },
    shouldWriteField: async (a) => { calls.gate.push(a); return { write: true, decision: 'write', enforceMode: 'record_only' }; },
    domainQuery: async (dom, m, p, b) => { calls.patch.push([dom, m, p, b]); return { ok: true, status: 200, data: [{ property_id: 7368 }] }; },
    opsQuery: async (m, p, b) => { calls.ops.push([m, p, b]); return { ok: true, data: [] }; },
    ...overrides,
  };
  return { deps, calls };
}

const task = { id: 'task-1', source_record_id: '7368', workspace_id: 'ws-1', metadata: {} };

describe('processChainResolveRow', () => {
  it('resolves: mints the developer org, gates, fill-blanks writes, completes the task', async () => {
    const { deps, calls } = recordingDeps();
    const cand = { earliest_owner: 'Acme Construction Co', owner_links: 3, is_build_to_suit: false, cur_true_owner_name: 'Boyd' };
    const out = await processChainResolveRow(task, cand, deps);

    assert.equal(out.outcome, 'resolved');
    assert.equal(out.developer, 'Acme Construction Co');
    assert.equal(out.tier, 'developer_keyword');
    // entity minted as an org in the gov domain
    assert.equal(calls.ensure[0].domain, 'gov');
    assert.equal(calls.ensure[0].sourceType, 'developer');
    // provenance gate hit with the right source + field
    assert.equal(calls.gate[0].source, 'chain_resolution');
    assert.equal(calls.gate[0].fieldName, 'developer');
    assert.equal(calls.gate[0].targetTable, 'gov.properties');
    // gov write is fill-blanks (developer IS NULL filter)
    const patch = calls.patch.find((c) => c[1] === 'PATCH');
    assert.ok(patch[2].includes('developer=is.null'), 'fill-blanks filter present');
    assert.equal(patch[3].developer, 'Acme Construction Co');
    // task completed (not left queued)
    const complete = calls.ops.find((c) => c[0] === 'PATCH' && c[1].includes('research_tasks'));
    assert.equal(complete[2].status, 'completed');
    assert.equal(complete[2].outcome.source, 'chain_resolution');
  });

  it('fill-blanks no-op: gov returns 0 rows (already had a developer) → already_resolved, no false write', async () => {
    const { deps, calls } = recordingDeps({
      domainQuery: async () => ({ ok: true, status: 200, data: [] }), // 0 rows affected
    });
    const out = await processChainResolveRow(task, { earliest_owner: 'Acme Construction Co', owner_links: 3, is_build_to_suit: true }, deps);
    assert.equal(out.outcome, 'already_resolved');
    // task still closed honestly
    assert.ok(calls.ops.some((c) => c[1].includes('research_tasks') && c[2].status === 'completed'));
  });

  it('provenance block keeps the task open (no write, no complete)', async () => {
    const { deps, calls } = recordingDeps({
      shouldWriteField: async () => ({ write: false, decision: 'skip', enforceMode: 'strict', reason: 'blocked' }),
    });
    const out = await processChainResolveRow(task, { earliest_owner: 'Acme Construction Co', owner_links: 3, is_build_to_suit: true }, deps);
    assert.equal(out.outcome, 'blocked_by_provenance');
    assert.equal(calls.patch.filter((c) => c[1] === 'PATCH').length, 0, 'no gov write');
    assert.ok(!calls.ops.some((c) => c[2]?.status === 'completed'), 'task not completed');
  });

  it('entity guard rejection aborts the write (no developer written)', async () => {
    const { deps, calls } = recordingDeps({
      ensureEntityLink: async () => ({ ok: false, skipped: 'junk_entity_name' }),
    });
    const out = await processChainResolveRow(task, { earliest_owner: 'Acme Construction Co', owner_links: 3, is_build_to_suit: true }, deps);
    assert.equal(out.outcome, 'not_resolved');
    assert.equal(out.reason, 'entity_guard_rejected');
    assert.equal(calls.gate.length, 0, 'never reached the provenance gate');
    assert.equal(calls.patch.length, 0, 'never wrote');
  });

  it('a non-developer origin is not resolved and writes nothing', async () => {
    const { deps, calls } = recordingDeps();
    const out = await processChainResolveRow(task, { earliest_owner: 'WELLS FARGO BANK, NATIONAL ASSOCIATION', owner_links: 3, is_build_to_suit: false }, deps);
    assert.equal(out.outcome, 'not_resolved');
    assert.equal(out.reason, 'origin_not_developer');
    assert.equal(calls.ensure.length, 0);
    assert.equal(calls.patch.length, 0);
  });

  it('a person-name origin (UW#7b) is not resolved and writes nothing — no orphan entity', async () => {
    const { deps, calls } = recordingDeps();
    const out = await processChainResolveRow(task, { earliest_owner: 'Gary Brown', owner_links: 3, is_build_to_suit: true }, deps);
    assert.equal(out.outcome, 'not_resolved');
    assert.equal(out.reason, 'origin_is_person');
    assert.equal(calls.ensure.length, 0, 'never minted the person as a developer entity');
    assert.equal(calls.patch.length, 0, 'never wrote');
  });
});

// ── R60 Unit 2B — disposition: close terminal buckets, keep transient queued ──
describe('R60 chainResolveDisposition', () => {
  it('closes the structurally-terminal buckets', () => {
    for (const r of ['already_resolved', 'no_chain', 'origin_equals_current',
                     'guard_rejected', 'origin_not_developer', 'origin_is_person',
                     'entity_guard_rejected']) {
      assert.equal(chainResolveDisposition(r), 'terminal', r);
    }
  });

  it('keeps transient/contingent failures queued for retry', () => {
    for (const r of ['blocked_by_provenance', 'write_failed', 'something_unknown']) {
      assert.equal(chainResolveDisposition(r), 'retry', r);
    }
  });

  it('ambiguous_generic_org is terminal only when no external research is configured', () => {
    assert.equal(chainResolveDisposition('ambiguous_generic_org'), 'terminal');
    assert.equal(chainResolveDisposition('ambiguous_generic_org', { externalResearch: false }), 'terminal');
    assert.equal(chainResolveDisposition('ambiguous_generic_org', { externalResearch: true }), 'retry');
  });

  it('every classifier not-resolve reason maps to terminal or retry', () => {
    const cases = [
      { current_developer: 'Hines', earliest_owner: 'x', owner_links: 3 },
      { earliest_owner: '', owner_links: 0 },
      { earliest_owner: 'Acme LLC', cur_true_owner_name: 'Acme LLC', owner_links: 2 },
      { earliest_owner: 'Wells Fargo Bank NA', owner_links: 2 },
      { earliest_owner: 'Gary Brown', owner_links: 2 },
      { earliest_owner: 'Smith Holdings LLC', owner_links: 2 },
    ];
    for (const c of cases) {
      const cls = classifyDeveloperOrigin(c);
      assert.equal(cls.resolve, false, JSON.stringify(c));
      assert.ok(['terminal', 'retry'].includes(chainResolveDisposition(cls.reason)), cls.reason);
    }
  });

  it('a resolvable origin (dev keyword / BTS) is NOT a terminal close', () => {
    const kw = classifyDeveloperOrigin({ earliest_owner: 'Ryan Development Co', owner_links: 2 });
    assert.equal(kw.resolve, true);
    assert.equal(kw.tier, 'developer_keyword');
    const bts = classifyDeveloperOrigin({ earliest_owner: 'Chandler Property', owner_links: 2, is_build_to_suit: true });
    assert.equal(bts.resolve, true);
    assert.equal(bts.tier, 'bts_origin');
  });
});
