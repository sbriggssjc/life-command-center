// PDR1 / P13 fork 1 — the ambiguous-entity-resolution automerge planner + tick.
//
// ⚠️ DB ACCESS WAS UNAVAILABLE WHEN THIS WAS BUILT (sandboxed session, no
// Supabase egress). Every test here is either (a) a pure-function test of
// api/_shared/ambiguous-entity-merge-planner.js against FIXTURE candidate
// data (including the DaVita/Donna-TX worked example from PLANNED-
// BACKLOG.md §P17/§P13#1, documented not measured), or (b) a static
// source/migration-shape check mirroring the house convention (bench-rank-
// tick.test.mjs, tier0-auto-attach.test.mjs) — comments stripped before
// matching so a fix's own prose cannot satisfy a regex over deleted code.
// Nothing here calls the network or a live Supabase project (TEST-NET-LEAK).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  scoreCandidate, rankCandidates, planAmbiguousEntityMerge,
  ambiguousEntitySubjectRef, buildAmbiguousEntityCard, validateAmbiguousEntityVerdict,
  AMBIGUOUS_MERGE_SCORING,
} from '../api/_shared/ambiguous-entity-merge-planner.js';

// ---------------------------------------------------------------------------
// (a) A bare-placeholder candidate (no address at all) never wins over an
//     addressed one, no matter how it is ordered in the input array.
// ---------------------------------------------------------------------------
test('a bare city-name placeholder candidate never outscores an addressed candidate', () => {
  const bare = { id: 'bare-1', name: 'Donna, TX', address: null, normalized_address: null };
  const addressed = { id: 'real-1', name: '123 Main St', address: '123 Main St', normalized_address: '123 MAIN ST' };

  const plan1 = planAmbiguousEntityMerge(null, [bare, addressed]);
  const plan2 = planAmbiguousEntityMerge(null, [addressed, bare]); // order reversed

  for (const plan of [plan1, plan2]) {
    assert.equal(plan.eligible, true, 'a clean address-vs-bare case should auto-merge');
    assert.equal(plan.winner.id, 'real-1', 'the addressed candidate must win regardless of input order');
  }

  const scoredBare = scoreCandidate(bare);
  const scoredAddressed = scoreCandidate(addressed);
  assert.equal(scoredBare.has_address, false);
  assert.equal(scoredAddressed.has_address, true);
  assert.ok(scoredAddressed.score > scoredBare.score);
});

test('a bare placeholder cannot win even with maximal fabricated signal counts', () => {
  const bare = {
    id: 'bare-2', name: 'Somewhere, TX', address: null, normalized_address: null,
    entity_relationships_count: 999, portfolio_facts_count: 999, external_identities_count: 999,
  };
  const addressed = { id: 'real-2', name: '456 Oak Ave', address: '456 Oak Ave', normalized_address: null };
  const ranked = rankCandidates([bare, addressed]);
  assert.equal(ranked[0].candidate.id, 'real-2', 'address presence must dominate any signal-count tie-break');
});

// ---------------------------------------------------------------------------
// (b) A non-normalized address loses to a normalized one on tie-break.
// ---------------------------------------------------------------------------
test('a non-normalized address loses to a normalized address at the same base address quality', () => {
  const notNormalized = { id: 'unnorm-1', name: 'Property A', address: '789 Elm St', normalized_address: null };
  const normalized = { id: 'norm-1', name: 'Property A', address: '789 Elm St', normalized_address: '789 ELM ST' };

  const plan = planAmbiguousEntityMerge(null, [notNormalized, normalized]);
  assert.equal(plan.eligible, true);
  assert.equal(plan.winner.id, 'norm-1', 'the normalized-address candidate must win the tie-break');

  const ranked = plan.ranked;
  assert.equal(ranked[0].candidate.id, 'norm-1');
  assert.equal(ranked[1].candidate.id, 'unnorm-1');
  assert.ok(ranked[0].score > ranked[1].score);
});

// ---------------------------------------------------------------------------
// (c) The threshold correctly abstains to needs_human when the top two
//     candidates are close in score (a genuine judgement call).
// ---------------------------------------------------------------------------
test('two comparably-good addressed candidates abstain to needs_human (margin too close)', () => {
  const candA = { id: 'a-1', name: 'Property A', address: '100 First St', normalized_address: '100 FIRST ST' };
  const candB = { id: 'b-1', name: 'Property B', address: '200 Second St', normalized_address: '200 SECOND ST' };
  const plan = planAmbiguousEntityMerge(null, [candA, candB]);
  assert.equal(plan.eligible, false);
  assert.equal(plan.reason, 'needs_human:margin_too_close');
  assert.equal(plan.winner, null);
  // Both candidates must still be present, scored, in the ranked output --
  // a needs_human card must show what the planner saw, not just "abstained".
  assert.equal(plan.ranked.length, 2);
});

test('no candidate with an address at all abstains to needs_human, never guesses', () => {
  const bareA = { id: 'bare-a', name: 'City A, TX', address: null, normalized_address: null };
  const bareB = { id: 'bare-b', name: 'City B, TX', address: null, normalized_address: null };
  const plan = planAmbiguousEntityMerge(null, [bareA, bareB]);
  assert.equal(plan.eligible, false);
  assert.equal(plan.reason, 'needs_human:no_candidate_clears_min_score');
});

test('an entity with no candidate list at all is reported distinctly (no_candidates), not silently eligible', () => {
  const plan1 = planAmbiguousEntityMerge({ id: 'x', metadata: {} }, undefined);
  assert.equal(plan1.eligible, false);
  assert.equal(plan1.reason, 'no_candidates');
  const plan2 = planAmbiguousEntityMerge({ id: 'y', metadata: { ambiguous_resolution: [] } }, undefined);
  assert.equal(plan2.eligible, false);
  assert.equal(plan2.reason, 'no_candidates');
});

// ---------------------------------------------------------------------------
// (d) DaVita/Donna-TX fixture — the documented worked example from
//     PLANNED-BACKLOG.md §P17/§P13#1: entity 8d1fd46e-3524-476e-946e-
//     eb33d683820d, three candidates. The exact candidate SHAPE beyond "one
//     is a bare city placeholder, another is un-normalized, a third is the
//     clean normalized winner" was NOT independently measured in this build
//     session (no DB access) -- this fixture is constructed to match the
//     DOCUMENTED description (a bare "Donna, TX" placeholder plus a real,
//     un-normalized duplicate address plus the clean normalized target) and
//     is explicitly a worked EXAMPLE, not a live-verified fact. Live
//     verification is a named follow-up (see STATUS.md).
// ---------------------------------------------------------------------------
test('DaVita/Donna-TX fixture (documented shape, NOT live-verified) resolves to the normalized winner', () => {
  const placeholder = {
    id: '8d1fd46e-3524-476e-946e-eb33d683820d',
    name: 'Donna, TX',
    metadata: {
      ambiguous_resolution: [
        { id: 'donna-bare', name: 'Donna, TX' },              // the bare city placeholder itself
        { id: 'davita-unnorm', name: 'DaVita Kidney Care' },  // real address, never normalized (PDR1c)
        { id: 'davita-clean', name: 'DaVita Kidney Care' },   // the clean normalized target
      ],
    },
  };
  // Enrichment (address/normalized_address), as the tick would fetch it --
  // this is the part no live DB was available to confirm.
  const enriched = [
    { id: 'donna-bare', name: 'Donna, TX', address: null, normalized_address: null },
    { id: 'davita-unnorm', name: 'DaVita Kidney Care', address: '123 S Business Hwy 83', normalized_address: null },
    { id: 'davita-clean', name: 'DaVita Kidney Care', address: '123 S Business Hwy 83', normalized_address: '123 S BUSINESS HWY 83' },
  ];

  const plan = planAmbiguousEntityMerge(placeholder, enriched);
  assert.equal(plan.eligible, true, 'the documented shape should clear the auto-merge threshold');
  assert.equal(plan.winner.id, 'davita-clean', 'the normalized, addressed candidate must be the winner');
  assert.equal(plan.placeholder_id, '8d1fd46e-3524-476e-946e-eb33d683820d');

  // Bare placeholder must rank last, never win.
  const ranked = plan.ranked;
  assert.equal(ranked[ranked.length - 1].candidate.id, 'donna-bare');
});

// ---------------------------------------------------------------------------
// Card / subjectRef / verdict-gate helpers used by the Decision Center lane.
// ---------------------------------------------------------------------------
test('ambiguousEntitySubjectRef is keyed on the placeholder alone', () => {
  assert.equal(ambiguousEntitySubjectRef('abc-123'), 'amb:abc-123');
  assert.equal(ambiguousEntitySubjectRef(null), null);
});

test('buildAmbiguousEntityCard carries the ranked list and the abstain reason', () => {
  const candA = { id: 'a-1', name: 'A', address: '1 A St', normalized_address: null };
  const candB = { id: 'b-1', name: 'B', address: '2 B St', normalized_address: null };
  const plan = planAmbiguousEntityMerge(null, [candA, candB]);
  const card = buildAmbiguousEntityCard({ id: 'ph-1', name: 'Ambiguous Deal', city: 'X', state: 'TX' }, plan);
  assert.equal(card.placeholder_id, 'ph-1');
  assert.equal(card.reason, plan.reason);
  assert.equal(card.ranked.length, 2);
});

test('validateAmbiguousEntityVerdict refuses a merge candidate not on the card', () => {
  const candA = { id: 'a-1', name: 'A', address: '1 A St', normalized_address: '1 A ST' };
  const plan = planAmbiguousEntityMerge(null, [candA]);
  const card = buildAmbiguousEntityCard({ id: 'ph-1' }, plan);
  const bad = validateAmbiguousEntityVerdict(card, 'merge', { candidate_id: 'not-on-card' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'candidate_not_on_card');
  const good = validateAmbiguousEntityVerdict(card, 'merge', { candidate_id: 'a-1' });
  assert.equal(good.ok, true);
  assert.equal(good.candidate.id, 'a-1');
});

test('validateAmbiguousEntityVerdict accepts keep_new and research with no candidate_id', () => {
  const gate1 = validateAmbiguousEntityVerdict({ ranked: [] }, 'keep_new', {});
  assert.equal(gate1.ok, true);
  const gate2 = validateAmbiguousEntityVerdict({ ranked: [] }, 'research', {});
  assert.equal(gate2.ok, true);
  const gate3 = validateAmbiguousEntityVerdict({ ranked: [] }, 'bogus', {});
  assert.equal(gate3.ok, false);
});

test('the scoring constants are documented and internally consistent (margin cannot exceed the max possible score)', () => {
  const s = AMBIGUOUS_MERGE_SCORING;
  assert.ok(s.MIN_AUTO_MARGIN > 0);
  assert.ok(s.MIN_AUTO_MARGIN <= (s.ADDRESS_PRESENT_POINTS + s.ADDRESS_NORMALIZED_POINTS + s.SIGNAL_POINTS_CAP));
});

// ===========================================================================
// Static wiring + shape checks (no network) — mirrors bench-rank-tick.test.mjs
// / tier0-auto-attach.test.mjs.
// ===========================================================================

const SERVER_JS = readFileSync('server.js', 'utf8');
const ADMIN_JS = readFileSync('api/admin.js', 'utf8');
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('server.js mounts /api/ambiguous-entity-automerge-tick and sets the matching _route', () => {
  assert.match(SERVER_JS, /app\.all\('\/api\/ambiguous-entity-automerge-tick'.*_route\s*=\s*'ambiguous-entity-automerge-tick'/);
});

test('admin.js dispatches ambiguous-entity-automerge-tick to the imported handler', () => {
  assert.match(ADMIN_JS, /import\s*\{\s*handleAmbiguousEntityAutomergeTick\s*\}\s*from\s*'\.\/_handlers\/ambiguous-entity-automerge-tick\.js'/);
  assert.match(ADMIN_JS, /case\s+'ambiguous-entity-automerge-tick':\s*return\s+handleAmbiguousEntityAutomergeTick\(req,\s*res\)/);
});

test('ambiguous_entity_resolution is registered in FEDERATED_DECISION_TYPES (server) and _DC_FEDERATED (client)', () => {
  assert.match(ADMIN_JS, /FEDERATED_DECISION_TYPES\s*=\s*new Set\(\[[\s\S]*?'ambiguous_entity_resolution'[\s\S]*?\]\)/);
  const opsJs = readFileSync('ops.js', 'utf8');
  assert.match(opsJs, /_DC_FEDERATED\s*=\s*new Set\(\[[\s\S]*?'ambiguous_entity_resolution'[\s\S]*?\]\)/);
});

const HANDLER_SRC = readFileSync('api/_handlers/ambiguous-entity-automerge-tick.js', 'utf8');
const HANDLER_NOCOMMENT = strip(HANDLER_SRC);

test('the tick GET path is an unconditional dry run (dryRun computed from req.method, never gated by the flag)', () => {
  assert.match(HANDLER_NOCOMMENT, /const dryRun = req\.method !== 'POST'/);
  assert.match(HANDLER_NOCOMMENT, /if \(dryRun\) \{/);
});

test('the tick write path is gated on the flag (never writes on GET, never writes with the flag off)', () => {
  assert.match(HANDLER_NOCOMMENT, /if \(!flagOn\) \{/);
  assert.match(HANDLER_NOCOMMENT, /skipped_reason: 'flag_off'/);
});

test('the tick reuses planAmbiguousEntityMerge for BOTH the dry-run grade and the write set (no second scoring implementation)', () => {
  assert.match(HANDLER_NOCOMMENT, /from '\.\.\/_shared\/ambiguous-entity-merge-planner\.js'/);
  // Only one call site scores a plan.
  const calls = (HANDLER_NOCOMMENT.match(/planAmbiguousEntityMerge\(/g) || []).length;
  assert.equal(calls, 1, 'the planner should be called from exactly one place in the tick');
});

test('the tick calls rpc/reconcile_entity — no second merge writer (no direct UPDATE of bd_opportunities/activity_events/entity_relationships)', () => {
  assert.match(HANDLER_NOCOMMENT, /opsQuery\('POST', 'rpc\/reconcile_entity'/);
  assert.doesNotMatch(HANDLER_NOCOMMENT, /'POST', 'bd_opportunities'/);
  assert.doesNotMatch(HANDLER_NOCOMMENT, /'PATCH', 'bd_opportunities/);
  assert.doesNotMatch(HANDLER_NOCOMMENT, /'PATCH', 'activity_events/);
  assert.doesNotMatch(HANDLER_NOCOMMENT, /'PATCH', 'entity_relationships/);
});

test('the reconcile_entity RPC call payload names p_placeholder / p_canonical / p_keep_new — the RPC contract', () => {
  assert.match(HANDLER_NOCOMMENT, /p_placeholder:\s*placeholderId/);
  assert.match(HANDLER_NOCOMMENT, /p_canonical:\s*canonicalId/);
  assert.match(HANDLER_NOCOMMENT, /p_keep_new:\s*false/);
});

// The admin.js verdict branch must also call rpc/reconcile_entity, and must
// NOT re-derive a second scoring/merge path.
test('the admin.js Decision Center verdict for ambiguous_entity_resolution also calls rpc/reconcile_entity (one writer, two entry points)', () => {
  const idx = ADMIN_JS.indexOf("decision.decision_type === 'ambiguous_entity_resolution'");
  assert.ok(idx >= 0, 'expected the ambiguous_entity_resolution verdict branch in admin.js');
  const slice = ADMIN_JS.slice(idx, idx + 6000);
  const sliceNoComment = strip(slice);
  assert.match(sliceNoComment, /opsQuery\('POST', 'rpc\/reconcile_entity'/);
  assert.match(sliceNoComment, /validateAmbiguousEntityVerdict\(/);
});

// ===========================================================================
// Migration shape (never applied live in this session — see STATUS.md).
// ===========================================================================
const MIG_FILE = readdirSync('supabase/migrations')
  .find((f) => f.includes('lcc_pdr1_ambiguous_entity_automerge'));

test('the PDR1 migration file exists', () => {
  assert.ok(MIG_FILE, 'expected a supabase/migrations/*_lcc_pdr1_ambiguous_entity_automerge.sql file');
});

const MIG_RAW = readFileSync(`supabase/migrations/${MIG_FILE}`, 'utf8');
const MIG_SQL = MIG_RAW.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('the migration creates the run-log table and seeds the AMBIGUOUS_ENTITY_AUTOMERGE flag OFF by default', () => {
  assert.match(MIG_SQL, /CREATE TABLE IF NOT EXISTS public\.lcc_ambiguous_entity_automerge_run_log/);
  assert.match(MIG_SQL, /AMBIGUOUS_ENTITY_AUTOMERGE/);
  assert.match(MIG_SQL, /'off',/);
});

test('the migration is additive/idempotent (IF NOT EXISTS / ON CONFLICT, no destructive DROP of an existing table)', () => {
  assert.match(MIG_SQL, /ON CONFLICT \(flag\) DO NOTHING/);
  assert.doesNotMatch(MIG_SQL, /DROP TABLE public\.entities/i);
});
