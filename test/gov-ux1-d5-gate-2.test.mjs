// GOV-UX1-D5-gate-2 (2026-09-23) — the three gaps behind the seller-lead lane's
// ~50% graded precision: plain banks, buyer SPEs found through a shared
// decision-maker, and sponsor SPEs that share one contact (one conversation =
// one card).
//
// The bank arm lives ONLY in SQL (no JS regex list). It is tested by evaluating
// the migration's own regex literals against named rows: the ones the live
// measurement graded, including the SPE-named-for-a-bank-building negatives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applySellerLeadGate, likelyBuyerSpeParent, collapseSharedDecisionMakers, findGateCard,
  clusterBatchTag, evaluateSellerLeadGate,
} from '../api/_shared/seller-lead-gate.js';
import { planAutoCreate, recordClusterSiblings } from '../api/_handlers/seller-lead-gate.js';

const MIGRATION = 'supabase/migrations/20261102280000_lcc_gov_ux1_d5_gate_2_bank_buyerspe_sponsor.sql';
const sql = () => readFileSync(MIGRATION, 'utf8').replace(/--[^\n]*/g, '');

function fnBody(src, name) {
  const start = src.indexOf('FUNCTION public.' + name + '(');
  assert.ok(start >= 0, name + ' not defined');
  const open = src.indexOf('$function$', start);
  const close = src.indexOf('$function$', open + 10);
  return src.slice(open + 10, close);
}

// Translate the Postgres ARE literals the bank function uses into JS regexes
// (\m / \M word boundaries; ~* is case-insensitive). Test-only; never shipped.
function pgRegex(lit) {
  return new RegExp(lit.replace(/\\m|\\M/g, '\\b'), 'i');
}
function plainBank(name) {
  const body = fnBody(sql(), 'lcc_owner_name_is_plain_bank');
  const clauses = [...body.matchAll(/(!?~\*)\s*'((?:[^']|'')*)'/g)].map((m) => ({ neg: m[1] === '!~*', re: pgRegex(m[2].replace(/''/g, "'")) }));
  const negs = clauses.filter((c) => c.neg);
  const poss = clauses.filter((c) => !c.neg);
  assert.ok(negs.length >= 2 && poss.length >= 5, 'bank function shape changed');
  return negs.every((c) => !c.re.test(name)) && poss.some((c) => c.re.test(name));
}

// ---- bank -----------------------------------------------------------------
test('bank: plain bank owners match (graded live 2026-09-23)', () => {
  for (const n of ['Truist Bank', 'Huntington National Bank, The', 'BANK MIDWEST N.A.', 'Bank of America',
    'OPPORTUNITY BANK OF MONTANA', 'Abby Bancorp, Inc.', 'Sumitomo Mitsui Banking Corporation',
    'BRANCH BANKING AND TRUST', 'Burke & Herbert Bank & Trust Company', 'BBVA Compass Bancshares, Inc.']) {
    assert.equal(plainBank(n), true, n);
  }
});

test('bank: real-estate SPEs named for a bank, persons and charities do NOT match', () => {
  for (const n of ['BANK BUILDING INVESTORS, LIMITED', 'First Bank Building LLC', 'BANCORP PLAZA LLC',
    'Bank of Louisville,LLC', 'Gregory M Bancroft', 'TC II 7200 BANCROFT, LLC', 'TEP Flint Bankruptcy Court, LLC',
    'Food Bank of Delaware', 'Highwoods Realty Limited Partnership', 'Curtis Properties',
    // Buildings named for a bank: only the SPE/real-estate suffix exclusion keeps these out.
    'Bank of America Plaza', 'Bank of the West Building', 'Bank One Tower Investors']) {
    assert.equal(plainBank(n), false, n);
  }
});

test('bank: the arm is OR-ed into the ONE choke point (lcc_owner_name_is_bank_or_trustee)', () => {
  const body = fnBody(sql(), 'lcc_owner_name_is_bank_or_trustee');
  assert.match(body, /or public\.lcc_owner_name_is_plain_bank\(p_name\)/);
  // The existing trustee arms are preserved, not replaced.
  assert.match(body, /national association/);
  assert.match(body, /savings bank/);
});

// ---- buyerspe -------------------------------------------------------------
function row(over = {}) {
  return {
    entity_id: 'e-' + Math.random().toString(36).slice(2), workspace_id: 'w', owner_name: 'PASADENA SSA LLC',
    rank_value: 7372803, reason_to_sell: 'debt', reason_measured: true,
    dm_people: [{ person_id: 'kc', name: 'Kiljuana Crawford', role: 'decision_maker', shared_buyer_parent: 'UIRC' }],
    owner_name_sql_junk: false, repeat_buyer_parent: null, has_open_opportunity: false,
    point_person_user_id: 'u', prior_decision: null, ...over,
  };
}

test('buyerspe: the only decision-maker also decides for a repeat buyer → likely SPE of that buyer', () => {
  assert.equal(likelyBuyerSpeParent(row()), 'UIRC');
});

test('buyerspe: one independent decision-maker is enough to NOT flag the owner', () => {
  const r = row({ dm_people: [
    { person_id: 'kc', name: 'Kiljuana Crawford', role: 'decision_maker', shared_buyer_parent: 'UIRC' },
    { person_id: 'x', name: 'Pat Owner', role: 'decision_maker', shared_buyer_parent: null },
  ] });
  assert.equal(likelyBuyerSpeParent(r), null);
  assert.equal(likelyBuyerSpeParent(row({ dm_people: [{ person_id: 'x', name: 'Pat Owner', role: 'manager' }] })), null);
});

test('buyerspe: stays in the lane (not a gate condition) with the note, and OFF the auto path', () => {
  const spe = row();
  const plain = row({ owner_name: 'Curtis Properties', dm_people: [{ person_id: 'cc', name: 'Chris Curtis', role: 'prospecting_contact' }] });
  assert.equal(evaluateSellerLeadGate(spe).qualifies, true);
  const { gated, funnel } = applySellerLeadGate([spe, plain]);
  assert.equal(gated.length, 2);
  assert.equal(funnel.likely_buyer_spe, 1);
  assert.equal(gated.find((g) => g.owner_name === 'PASADENA SSA LLC').likely_spe_of, 'UIRC');
  const plan = planAutoCreate(gated, { eligible: true });
  assert.deepEqual(plan.map((r) => r.owner_name), ['Curtis Properties']);
});

test('buyerspe: the view resolves the shared buyer through lcc_resolve_buyer_parent on a DECISION role', () => {
  const s = sql();
  const cte = s.slice(s.indexOf('shared_buyer AS ('), s.indexOf('dm AS ('));
  assert.match(cte, /lcc_resolve_buyer_parent\(oe\.id\)/);
  assert.match(cte, /oe\.id <> dp\.entity_id/);
  assert.match(cte, /WHERE public\.lcc_is_seller_lead_decision_role\(/);
  assert.match(s, /'shared_buyer_parent', sb\.shared_buyer_parent/);
});

// ---- sponsor collapse -----------------------------------------------------
const KM = { person_id: 'km', name: 'Karen Massey', role: 'institution_decision_maker' };
function arc(name, rank) { return row({ entity_id: name, owner_name: name, rank_value: rank, dm_people: [KM] }); }

test('sponsor: five SPEs sharing one decision-maker collapse into ONE card (the top-value owner)', () => {
  const owners = [arc('ARC GSIFLMN001, LLC', 14800000), arc('ARC GSFFDME001, LLC', 12013524),
    arc('ARC GSRNGME001, LLC', 8600000), arc('ARC GSDALTX001, LLC', 4700000), arc('ARC GSGTNPA001, LLC', 4201194)];
  const other = row({ entity_id: 'curtis', owner_name: 'Curtis Properties', rank_value: 8626529,
    dm_people: [{ person_id: 'cc', name: 'Chris Curtis', role: 'prospecting_contact' }] });
  const { gated, funnel } = applySellerLeadGate([...owners, other]);
  assert.equal(gated.length, 2);
  assert.equal(funnel.qualifies, 6);
  assert.equal(funnel.cards, 2);
  assert.equal(funnel.collapsed_siblings, 4);
  const card = gated[0];
  assert.equal(card.owner_name, 'ARC GSIFLMN001, LLC');
  assert.equal(card.cluster_size, 5);
  assert.equal(card.cluster_siblings.length, 4);
  assert.equal(card.gate_contact.name, 'Karen Massey');
  assert.equal(card.cluster_rank_value, 14800000 + 12013524 + 8600000 + 4700000 + 4201194);
  assert.equal(gated[1].cluster_siblings.length, 0);
});

test('sponsor: the collapse is transitive and keyed on the person, never the name', () => {
  const a = row({ entity_id: 'a', owner_name: 'Alpha LLC', rank_value: 3, dm_people: [{ person_id: 'p1', name: 'One', role: 'manager' }] });
  const b = row({ entity_id: 'b', owner_name: 'Beta LLC', rank_value: 2, dm_people: [{ person_id: 'p1', name: 'One', role: 'manager' }, { person_id: 'p2', name: 'Two', role: 'manager' }] });
  const c = row({ entity_id: 'c', owner_name: 'Gamma LLC', rank_value: 1, dm_people: [{ person_id: 'p2', name: 'Two', role: 'manager' }] });
  // Same name, different person: not collapsed.
  const d = row({ entity_id: 'd', owner_name: 'ARC GSXXXX001, LLC', rank_value: 9, dm_people: [{ person_id: 'p9', name: 'Karen Massey', role: 'manager' }] });
  const cards = collapseSharedDecisionMakers([a, b, c, d]);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.find((x) => x.entity_id === 'a').cluster_siblings.map((s) => s.entity_id).sort(), ['b', 'c']);
  assert.equal(findGateCard(cards, 'c').entity_id, 'a');
  assert.equal(findGateCard(cards, 'nope'), null);
});

test('sponsor: one decision on the card is recorded for each sibling as decided_via=cluster (never counted by the meter)', async () => {
  const card = applySellerLeadGate([arc('ARC A', 3), arc('ARC B', 2), arc('ARC C', 1)]).gated[0];
  const writes = [];
  const out = await recordClusterSiblings(card, { decision: 'reject', reason: 'repeat_buyer_or_reit', decided_by: 'u' }, {
    recordDecision: async (r, f) => { writes.push({ r, f }); return { ok: true, duplicate: false }; },
  });
  assert.equal(out.length, 2);
  assert.deepEqual(writes.map((w) => w.r.entity_id).sort(), ['ARC B', 'ARC C']);
  for (const w of writes) {
    assert.equal(w.f.decided_via, 'cluster');
    assert.equal(w.f.batch_tag, clusterBatchTag('ARC A'));
    assert.equal(w.f.decision, 'reject');
    assert.equal(w.f.lead_id, null);
    assert.equal(w.r.cluster_rep_entity_id, 'ARC A');
  }
  // The ledger accepts 'cluster'; the precision meter (previous migration, unchanged) reads 'lane' only.
  assert.match(sql(), /CHECK \(decided_via IN \('lane', 'auto', 'cluster'\)\)/);
  assert.doesNotMatch(sql(), /v_lcc_seller_lead_gate_precision/);
  const prev = readFileSync('supabase/migrations/20261102260000_lcc_gov_ux1_d5_gate_seller_lead_review_lane.sql', 'utf8');
  assert.match(prev, /WHERE decided_via = 'lane' AND reversed_at IS NULL/);
});

test('sponsor: the lane decision and a lane "Not a lead" reversal reach the siblings', () => {
  const src = readFileSync('api/_handlers/seller-lead-gate.js', 'utf8');
  assert.match(src, /const row = findGateCard\(gate\.gated, entityId\)/);
  assert.equal((src.match(/await recordClusterSiblings\(row,/g) || []).length, 3, 'reject, create and auto create');
  assert.match(src, /decided_via=eq\.cluster&reversed_at=is\.null&batch_tag=eq\.'\s*\+ encodeURIComponent\(clusterBatchTag\(d\.entity_id\)\)/);
});
