// REVIEW-LANES1 (2026-09-25) — the four review queues as Decision Center lanes, JS half.
//
// The SQL writers are tested behaviourally in test/review-lanes1-dia-listing-sale.test.mjs,
// test/review-lanes1-lcc-writers.test.mjs and government-lease
// tests/unit/test_review_lanes1_listing_sale_decide.py. This file proves the wiring:
//   * each decision type applies its verdict through the RIGHT writer (DB + function + args);
//   * the undo recorded on the decision is the matching undo function, and undo reopens the card;
//   * a refused write keeps the decision open (no 'decided' is claimed);
//   * the tick's asset auto-relink only takes a ledger survivor that is one of the candidates;
//   * the lanes are registered in the server set, the client set, the lane map and review-counts.
// Mutations are applied to the module source and re-imported; each must turn a test red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'api', '_shared', 'review-lanes1.js');

import {
  REVIEW_LANES1_TYPES, planReviewLanes1Verdict, planReviewLanes1Undo, reviewLanes1SubjectRef, unwrapRpc,
} from '../api/_shared/review-lanes1.js';
import {
  applyReviewLanes1Verdict, undoReviewLanes1Decision, planAssetLedgerAutoRelinks,
} from '../api/_handlers/review-lanes1.js';

const CTX = {
  listing_sale_review: { domain: 'gov', review_id: 7 },
  asset_property_link_review: { ledger_id: 29, candidates: [{ property_id: '37545' }, { property_id: '29507' }] },
  gov_owner_contact_review: { review_id: 734 },
  contact_hub_conflict: { conflict_log_id: 2054 },
};

// Every (type, verdict) → the writer it must reach.
const EXPECT = [
  ['listing_sale_review', 'confirm_sold', {}, 'gov', 'gov_decide_listing_sale_review', { p_review_id: 7, p_decision: 'confirm_sold' }],
  ['listing_sale_review', 'reject', {}, 'gov', 'gov_decide_listing_sale_review', { p_review_id: 7, p_decision: 'reject' }],
  ['asset_property_link_review', 'relink', { kept: '29507' }, 'ops', 'lcc_decide_asset_property_link', { p_ledger_id: 29, p_decision: 'relink', p_kept: '29507' }],
  ['asset_property_link_review', 'no_match', {}, 'ops', 'lcc_decide_asset_property_link', { p_ledger_id: 29, p_decision: 'no_match', p_kept: null }],
  ['gov_owner_contact_review', 'link', {}, 'ops', 'lcc_decide_gov_owner_review', { p_review_id: 734, p_decision: 'link' }],
  ['gov_owner_contact_review', 'create', {}, 'ops', 'lcc_decide_gov_owner_review', { p_review_id: 734, p_decision: 'create' }],
  ['gov_owner_contact_review', 'already_represented', {}, 'ops', 'lcc_decide_gov_owner_review', { p_review_id: 734, p_decision: 'already_represented' }],
  ['gov_owner_contact_review', 'not_same', {}, 'ops', 'lcc_decide_gov_owner_review', { p_review_id: 734, p_decision: 'not_same' }],
  ['contact_hub_conflict', 'repoint_to_survivor', {}, 'ops', 'lcc_decide_contact_hub_conflict', { p_log_id: 2054, p_decision: 'repoint_to_survivor' }],
  ['contact_hub_conflict', 'keep_both', {}, 'ops', 'lcc_decide_contact_hub_conflict', { p_log_id: 2054, p_decision: 'keep_both' }],
];

function stubDeps(answer = { ok: true }) {
  const calls = [];
  const rpc = (db) => async (...a) => {
    const [method, path, body] = db === 'ops' ? a : a.slice(1);
    calls.push({ db: db === 'ops' ? 'ops' : a[0], method, path, body });
    if (method === 'PATCH') return { ok: true, data: [] };
    return { ok: true, data: typeof answer === 'function' ? answer(path, body) : answer };
  };
  return { calls, deps: { opsQuery: rpc('ops'), domainQuery: rpc('dom') } };
}

test('every (lane, verdict) reaches its writer — plan and executed call agree', async () => {
  for (const [type, verdict, payload, db, fn, args] of EXPECT) {
    const plan = planReviewLanes1Verdict(type, verdict, CTX[type], payload, 'scott');
    assert.equal(plan.db, db, `${type}/${verdict} db`);
    assert.equal(plan.fn, fn, `${type}/${verdict} fn`);
    for (const [k, v] of Object.entries(args)) assert.deepEqual(plan.args[k], v, `${type}/${verdict} ${k}`);
    const { calls, deps } = stubDeps({ ok: true, decision: verdict });
    const out = await applyReviewLanes1Verdict({ type, verdict, context: CTX[type], payload, user: { id: 'u1' } }, deps);
    assert.equal(out.ok, true, `${type}/${verdict} applied`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].db, db);
    assert.equal(calls[0].path, 'rpc/' + fn);
  }
});

test('the undo recorded on each verdict is the matching undo function', () => {
  assert.equal(planReviewLanes1Undo('listing_sale_review', 'confirm_sold', CTX.listing_sale_review, {}).fn, 'gov_undo_listing_sale_review');
  assert.equal(planReviewLanes1Undo('listing_sale_review', 'reject', { domain: 'dia', review_id: 3 }, {}).fn, 'dia_undo_listing_sale_review');
  assert.equal(planReviewLanes1Undo('asset_property_link_review', 'relink', CTX.asset_property_link_review, {}).fn, 'lcc_undo_asset_property_link');
  assert.equal(planReviewLanes1Undo('gov_owner_contact_review', 'create', CTX.gov_owner_contact_review, {}).fn, 'lcc_undo_gov_owner_review');
  assert.equal(planReviewLanes1Undo('contact_hub_conflict', 'repoint_to_survivor', CTX.contact_hub_conflict, {}).fn, 'lcc_undo_contact_hub_conflict_repoint');
  const m = planReviewLanes1Undo('contact_hub_conflict', 'merge', CTX.contact_hub_conflict, { backup_id: 12 });
  assert.equal(m.fn, 'lcc_undo_contact_conflict_merge');
  assert.equal(m.args.p_backup_id, 12);
  assert.equal(planReviewLanes1Undo('contact_hub_conflict', 'keep_both', CTX.contact_hub_conflict, {}), null);
});

test('relink refuses a property that is not one of the evidence candidates', async () => {
  const plan = planReviewLanes1Verdict('asset_property_link_review', 'relink', CTX.asset_property_link_review, { kept: '12345' });
  assert.equal(plan.error, 'kept_not_a_candidate');
  const { calls, deps } = stubDeps();
  const out = await applyReviewLanes1Verdict({ type: 'asset_property_link_review', verdict: 'relink',
    context: CTX.asset_property_link_review, payload: { kept: '12345' } }, deps);
  assert.equal(out.ok, false);
  assert.equal(calls.length, 0, 'no writer call for an invalid pick');
});

test('an unknown verdict never reaches a writer', () => {
  assert.equal(planReviewLanes1Verdict('listing_sale_review', 'dismiss', CTX.listing_sale_review).error, 'unknown_verdict');
});

test('a writer that refuses keeps the decision open (ok:false, no undo recorded)', async () => {
  const { deps } = stubDeps({ ok: false, error: 'candidate_already_linked' });
  const out = await applyReviewLanes1Verdict({ type: 'gov_owner_contact_review', verdict: 'link',
    context: CTX.gov_owner_contact_review }, deps);
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
  assert.equal(out.body.error, 'candidate_already_linked');
});

test('merge snapshots first, runs the contact merge path, records the backup for undo', async () => {
  const order = [];
  const { deps } = stubDeps((path) => {
    order.push(path);
    return { ok: true, backup_id: 44, keep_id: 'k', drop_id: 'd' };
  });
  deps.mergeUnifiedContacts = async ({ keep_id, merge_id }) => { order.push('merge:' + keep_id + '<-' + merge_id); return { ok: true, status: 200, body: { action: 'merged' } }; };
  const out = await applyReviewLanes1Verdict({ type: 'contact_hub_conflict', verdict: 'merge', context: CTX.contact_hub_conflict }, deps);
  assert.deepEqual(order, ['rpc/lcc_snapshot_contact_conflict_merge', 'merge:k<-d']);
  assert.equal(out.effects.undo.fn, 'lcc_undo_contact_conflict_merge');
  assert.equal(out.effects.undo.args.p_backup_id, 44);
});

test('merge never runs when the snapshot refuses (person into company)', async () => {
  let merged = false;
  const { deps } = stubDeps({ ok: false, error: 'contact_class_differs' });
  deps.mergeUnifiedContacts = async () => { merged = true; return { ok: true, status: 200, body: {} }; };
  const out = await applyReviewLanes1Verdict({ type: 'contact_hub_conflict', verdict: 'merge', context: CTX.contact_hub_conflict }, deps);
  assert.equal(out.ok, false);
  assert.equal(merged, false);
});

test('undo runs the recorded call and reopens the decision', async () => {
  const { calls, deps } = stubDeps({ ok: true, restored: 1 });
  const decision = { id: 91, decision_type: 'listing_sale_review', status: 'decided', verdict: 'confirm_sold',
    effects: { undo: { db: 'dia', fn: 'dia_undo_listing_sale_review', args: { p_review_id: 3 } } }, metadata: {} };
  const out = await undoReviewLanes1Decision(decision, { id: 'u1' }, deps);
  assert.equal(out.ok, true);
  assert.equal(calls[0].path, 'rpc/dia_undo_listing_sale_review');
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'decision reopened');
  assert.equal(patch.path, 'lcc_decisions?id=eq.91');
  assert.equal(patch.body.status, 'open');
  assert.equal(patch.body.metadata.undo_history.length, 1);
});

test('undo does not reopen the card when the undo call fails', async () => {
  const { calls, deps } = stubDeps({ ok: false, error: 'nothing_to_restore' });
  const decision = { id: 92, decision_type: 'listing_sale_review', status: 'decided',
    effects: { undo: { db: 'gov', fn: 'gov_undo_listing_sale_review', args: {} } } };
  const out = await undoReviewLanes1Decision(decision, {}, deps);
  assert.equal(out.ok, false);
  assert.equal(calls.some((c) => c.method === 'PATCH'), false);
});

test('tick auto-relinks only when the merge ledger names one of the candidates', async () => {
  const deps = {
    opsQuery: async () => ({ ok: true, data: [
      { id: 1, domain: 'dia', dropped_property_id: '100', evidence: { candidates: ['200'] } },
      { id: 2, domain: 'dia', dropped_property_id: '101', evidence: { candidates: ['201'] } },
      { id: 3, domain: 'dia', dropped_property_id: '102', evidence: { candidates: ['202'] } },
    ] }),
    domainQuery: async () => ({ ok: true, data: [
      { dropped_property_id: 100, final_survivor_id: 200, reversed_at: null },    // candidate → take
      { dropped_property_id: 101, final_survivor_id: 999, reversed_at: null },    // not a candidate → leave
      { dropped_property_id: 102, final_survivor_id: 202, reversed_at: '2026-09-01' }, // reversed → leave
    ] }),
  };
  assert.deepEqual(await planAssetLedgerAutoRelinks(deps), [{ ledger_id: 1, kept: '200' }]);
});

test('subject refs are stable and domain-scoped', () => {
  assert.equal(reviewLanes1SubjectRef('listing_sale_review', { domain: 'dia', review_id: 8 }), 'lsr:dia:8');
  assert.equal(reviewLanes1SubjectRef('listing_sale_review', { domain: 'dialysis', review_id: 8 }), null);
  assert.equal(reviewLanes1SubjectRef('contact_hub_conflict', { conflict_log_id: 2048 }), 'hubconf:2048');
  assert.deepEqual(unwrapRpc([{ dia_decide_listing_sale_review: { ok: true } }]), { ok: true });
});

test('the lanes are registered everywhere a lane must be', () => {
  const admin = readFileSync(join(ROOT, 'api', 'admin.js'), 'utf8');
  const ops = readFileSync(join(ROOT, 'ops.js'), 'utf8');
  const shared = readFileSync(join(ROOT, 'review-shared.js'), 'utf8');
  const dc = readFileSync(join(ROOT, 'dc-lanes.js'), 'utf8');
  const server = readFileSync(join(ROOT, 'server.js'), 'utf8');
  const fed = admin.match(/FEDERATED_DECISION_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/)[1];
  for (const t of REVIEW_LANES1_TYPES) {
    assert.ok(fed.includes(`'${t}'`), `${t} in FEDERATED_DECISION_TYPES`);
    assert.ok(ops.includes(`{ dt: '${t}'`), `${t} in the Decision Center sublanes`);
    assert.match(shared, new RegExp(`\\n  ${t}:\\s+\\{ lane: 'accuracy'`), `${t} in the accuracy lane`);
    assert.ok(dc.includes(`  ${t}: { title:`), `${t} has card meta`);
    assert.ok(admin.includes(`key: '${t}'`), `${t} has a review-counts badge`);
  }
  // listing-sale is first: the accuracy lane leads, and the sublane list opens with it.
  assert.ok(shared.indexOf("lane: 'accuracy'") < shared.indexOf("lane: 'ownership'"));
  assert.ok(ops.indexOf("{ dt: 'listing_sale_review'") < ops.indexOf("{ dt: 'confirm_true_owner'"));
  assert.match(server, /'\/api\/decision-undo'/);
  assert.match(server, /'\/api\/review-lanes-tick'/);
});

// ── mutations: rewrite the shared module, re-import, and the matching assertion must fail ──────
async function withMutation(pairs, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'rl1mut_'));
  try {
    mkdirSync(join(dir, '_shared'), { recursive: true });
    let t = readFileSync(SHARED, 'utf8');
    for (const [o, n] of pairs) { assert.ok(t.includes(o), o); t = t.replace(o, n); }
    const f = join(dir, '_shared', 'review-lanes1.js');
    writeFileSync(f, t);
    return await fn(await import(pathToFileURL(f).href + '?m=' + Math.random()));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const MUTATIONS = [
  ['a listing verdict aimed at the wrong writer', [["fn: c.domain + '_decide_listing_sale_review'", "fn: c.domain + '_undo_listing_sale_review'"]],
    (m) => m.planReviewLanes1Verdict('listing_sale_review', 'confirm_sold', CTX.listing_sale_review).fn === 'gov_decide_listing_sale_review'],
  ['relink without the candidate check', [["if (!kept || !cands.includes(kept)) return { error: 'kept_not_a_candidate', candidates: cands };", '']],
    (m) => m.planReviewLanes1Verdict('asset_property_link_review', 'relink', CTX.asset_property_link_review, { kept: '12345' }).error === 'kept_not_a_candidate'],
  ['merge undo without the backup', [["args: { p_backup_id: Number(r.backup_id) } }", "args: { p_backup_id: null } }"]],
    (m) => m.planReviewLanes1Undo('contact_hub_conflict', 'merge', CTX.contact_hub_conflict, { backup_id: 12 }).args.p_backup_id === 12],
  ['an owner verdict aimed at the undo', [["fn: 'lcc_decide_gov_owner_review'", "fn: 'lcc_undo_gov_owner_review'"]],
    (m) => m.planReviewLanes1Verdict('gov_owner_contact_review', 'link', CTX.gov_owner_contact_review).fn === 'lcc_decide_gov_owner_review'],
  ['the verdict allow-list dropped', [["if (!allowed.includes(verdict)) return { error: 'unknown_verdict', allowed };", '']],
    (m) => m.planReviewLanes1Verdict('listing_sale_review', 'dismiss', CTX.listing_sale_review).error === 'unknown_verdict'],
];
for (const [name, pairs, holds] of MUTATIONS) {
  test(`mutation turns red: ${name}`, async () => {
    const real = await import(pathToFileURL(SHARED).href);
    assert.equal(holds(real), true, 'the property holds on the real module');
    assert.equal(await withMutation(pairs, holds), false, 'the mutation must break it');
  });
}
