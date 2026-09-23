// GOV-UX1-D5-gate (2026-09-23) — the tightened seller-lead gate, its review lane,
// and the auto-create switch.
//
// Every condition is tested ALONE against a row that otherwise qualifies, so a
// deleted or weakened condition turns exactly one test red. Source/AST assertions
// strip comments first (the migration header and handler comments quote the
// shapes they forbid).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import {
  evaluateSellerLeadGate, applySellerLeadGate, autoCreateEligibility, precisionMeterLabel,
  SELLER_LEAD_REJECT_REASONS, isValidRejectReason, GATE_CONDITIONS, buildCreateLeadBody,
  SELLER_LEAD_AUTOCREATE_SOURCE,
} from '../api/_shared/seller-lead-gate.js';
import { planAutoCreate, invokeCreateLead } from '../api/_handlers/seller-lead-gate.js';
import { NON_REACHABLE_ROLES } from '../api/_shared/owner-reachable-via.js';

const MIGRATION = 'supabase/migrations/20261102260000_lcc_gov_ux1_d5_gate_seller_lead_review_lane.sql';
const HANDLER = 'api/_handlers/seller-lead-gate.js';
const SHARED = 'api/_shared/seller-lead-gate.js';

function stripSqlComments(s) { return s.replace(/--[^\n]*/g, ''); }

function base(over = {}) {
  return {
    entity_id: '00000000-0000-0000-0000-00000000000a',
    workspace_id: '00000000-0000-0000-0000-0000000000ff',
    owner_name: 'Highwoods Realty Limited Partnership',
    source_domain: 'gov',
    source_property_id: '1234',
    rank_value: 19983685,
    reason_to_sell: 'value_creation_developer',
    reason_measured: true,
    dm_people: [{ person_id: 'p1', name: 'Brian Leary', role: 'prospecting_contact' }],
    owner_name_sql_junk: false,
    repeat_buyer_parent: null,
    has_open_opportunity: false,
    point_person_user_id: 'b0000000-0000-0000-0000-000000000001',
    prior_decision: null,
    ...over,
  };
}

test('the base row qualifies (positive control for every exclusion below)', () => {
  const v = evaluateSellerLeadGate(base());
  assert.equal(v.qualifies, true);
  assert.deepEqual(v.failed, []);
  assert.equal(v.contact.name, 'Brian Leary');
});

const SINGLE = [
  ['reason_measured', { reason_measured: false }],
  ['decision_maker_linked', { dm_people: [] }],
  // P164: the only "decision-maker" is the owner's own firm name restated.
  ['decision_maker_linked', { owner_name: 'Boyd Watterson Asset Management, LLC',
    dm_people: [{ person_id: 'p9', name: 'Boyd Watterson', role: 'decision_maker' }] }],
  ['owner_name_ok', { owner_name: '4238 Washington Street' }],     // isAddressAsName
  ['owner_name_ok', { owner_name_sql_junk: true }],                 // lcc_owner_name_is_junk
  ['owner_name_ok', { owner_name: 'Seller Contacts: (555) 123-4567' }], // isJunkEntityName
  ['not_repeat_buyer', { repeat_buyer_parent: 'Realty Income Corporation' }],
  ['no_open_lead', { has_open_opportunity: true }],
  ['point_person_resolved', { point_person_user_id: null }],
  ['not_already_decided', { prior_decision: 'reject' }],
];

for (const [cond, over] of SINGLE) {
  test(`gate condition alone excludes: ${cond} (${JSON.stringify(over).slice(0, 60)})`, () => {
    const v = evaluateSellerLeadGate(base(over));
    assert.equal(v.qualifies, false);
    assert.deepEqual(v.failed, [cond]);
  });
}

test('every declared condition has at least one single-condition exclusion test', () => {
  const covered = new Set(SINGLE.map(([c]) => c));
  for (const c of GATE_CONDITIONS) assert.ok(covered.has(c), c + ' has no exclusion test');
});

test('"Not a lead" suppresses the owner from the lane (JS gate + SQL view)', () => {
  const { gated, funnel } = applySellerLeadGate([base(), base({ entity_id: 'x', prior_decision: 'reject' })]);
  assert.equal(gated.length, 1);
  assert.equal(funnel.failed_by.not_already_decided, 1);
  // The view surfaces a live (unreversed) decision as prior_decision; a reversed
  // AUTO create stays a standing "no".
  const sql = stripSqlComments(readFileSync(MIGRATION, 'utf8'));
  const dec = sql.slice(sql.indexOf('dec AS ('), sql.indexOf('SELECT t.entity_id'));
  assert.match(dec, /WHERE d\.reversed_at IS NULL/);
  assert.match(dec, /d\.decided_via = 'auto' AND d\.decision = 'create'/);
  assert.match(sql, /dec\.decision\s+AS prior_decision/);
});

test('decision-maker role rule: weak/structural/broker roles never count (P161, SQL mirrors JS)', () => {
  const sql = stripSqlComments(readFileSync(MIGRATION, 'utf8'));
  const fn = sql.slice(sql.indexOf('FUNCTION public.lcc_is_seller_lead_decision_role'), sql.indexOf('$function$;'));
  assert.match(fn, /NOT public\.lcc_is_weak_association_role\(p_role\)/);
  for (const r of ['parent_of', 'child_of', 'subsidiary_of', ...NON_REACHABLE_ROLES]) {
    assert.ok(fn.includes(`'${r}'`), 'role missing from SQL exclusion: ' + r);
  }
  // The view filters linked people through it.
  assert.match(sql, /WHERE public\.lcc_is_seller_lead_decision_role\(role\)/);
});

test('reject picklist: JS and the SQL CHECK carry the identical keys', () => {
  const sql = stripSqlComments(readFileSync(MIGRATION, 'utf8'));
  const chk = sql.slice(sql.indexOf('chk_seller_lead_reject_reason'), sql.indexOf('CREATE UNIQUE INDEX'));
  const sqlKeys = [...chk.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((k) => k !== 'reject');
  assert.deepEqual([...sqlKeys].sort(), SELLER_LEAD_REJECT_REASONS.map((r) => r.key).sort());
  assert.equal(isValidRejectReason('not_a_seller'), true);
  assert.equal(isValidRejectReason('because'), false);
});

test('auto-create stays OFF with the flag off, even at perfect precision', () => {
  const e = autoCreateEligibility({ flagOn: false, precisionRow: { window_size: 25, precision_threshold: 0.9, decided: 25, creates: 25, precision: 1 } });
  assert.equal(e.eligible, false);
  assert.equal(e.reason, 'flag_off');
  assert.deepEqual(planAutoCreate([base()], e), []);
});

test('auto-create stays OFF below 25 decisions, even at 100%', () => {
  const e = autoCreateEligibility({ flagOn: true, precisionRow: { window_size: 25, precision_threshold: 0.9, decided: 24, creates: 24, precision: 1 } });
  assert.equal(e.eligible, false);
  assert.equal(e.reason, 'too_few_decisions');
  assert.deepEqual(planAutoCreate([base()], e), []);
});

test('auto-create stays OFF below 90% over a full window', () => {
  const e = autoCreateEligibility({ flagOn: true, precisionRow: { window_size: 25, precision_threshold: 0.9, decided: 25, creates: 22, precision: 0.88 } });
  assert.equal(e.eligible, false);
  assert.equal(e.reason, 'precision_below_threshold');
});

test('auto-create unlocks at flag ON + >= 90% over 25, and "unproven" is never eligible', () => {
  const on = autoCreateEligibility({ flagOn: true, precisionRow: { window_size: 25, precision_threshold: 0.9, decided: 25, creates: 23, precision: 0.92 } });
  assert.equal(on.eligible, true);
  assert.equal(planAutoCreate([base(), base({ entity_id: 'b' })], on, 1).length, 1);
  const none = autoCreateEligibility({ flagOn: true, precisionRow: null });
  assert.equal(none.eligible, false);
  assert.equal(none.precision, null);
  assert.match(precisionMeterLabel(on), /23\/25 accepted, 92%/);
});

test('precision is measured on LANE decisions only (an auto create cannot grade its own gate)', () => {
  const sql = stripSqlComments(readFileSync(MIGRATION, 'utf8'));
  const v = sql.slice(sql.indexOf('CREATE VIEW public.v_lcc_seller_lead_gate_precision'));
  assert.match(v, /WHERE decided_via = 'lane' AND reversed_at IS NULL/);
  assert.match(v, /LIMIT 25/);
  assert.match(v, /0\.90::numeric/);
});

test('idempotency: one live decision per owner (unique index) and a decided owner leaves the plan', () => {
  const sql = stripSqlComments(readFileSync(MIGRATION, 'utf8'));
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_lead_gate_decision_live\s+ON public\.lcc_seller_lead_gate_decision \(workspace_id, entity_id\)\s+WHERE reversed_at IS NULL/);
  const elig = { eligible: true };
  const first = planAutoCreate(applySellerLeadGate([base()]).gated, elig);
  assert.equal(first.length, 1);
  // After the tick records its create, the view reports prior_decision and an open opp.
  const second = planAutoCreate(applySellerLeadGate([base({ prior_decision: 'create', has_open_opportunity: true })]).gated, elig);
  assert.equal(second.length, 0);
});

test('the flag row ships OFF', () => {
  const sql = stripSqlComments(readFileSync(MIGRATION, 'utf8'));
  const ins = sql.slice(sql.indexOf("INSERT INTO public.feature_flags_registry"));
  assert.match(ins, /'SELLER_LEAD_AUTOCREATE', 'off'/);
});

test('invokeCreateLead calls bridgeCreateLead and captures its HTTP response', async () => {
  let seen;
  const out = await invokeCreateLead({ domain: 'gov', property_id: '1' }, { id: 'u' }, 'w', {
    bridgeCreateLead: async (req, res, user, ws) => { seen = { body: req.body, user, ws }; res.status(201).json({ ok: true, lead_id: 7 }); },
  });
  assert.equal(out.status, 201);
  assert.equal(out.body.lead_id, 7);
  assert.equal(seen.user.id, 'u');
  const body = buildCreateLeadBody(base(), SELLER_LEAD_AUTOCREATE_SOURCE);
  assert.equal(body.source, 'seller_lead_autocreate');
  assert.equal(body.entity_id, base().entity_id);
});

// ---- No second lead writer ------------------------------------------------
function callsIn(file) {
  const ast = acorn.parse(readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const out = [];
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression') out.push(n);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  return out;
}
const lit = (n) => (n && n.type === 'Literal' ? n.value : (n && n.type === 'TemplateLiteral' ? n.quasis.map((q) => q.value.cooked).join('*') : null));
const calleeName = (c) => (c.callee.type === 'Identifier' ? c.callee.name : (c.callee.property && c.callee.property.name));

test('no second lead writer: the lane/tick only POST to their own ledgers; leads go through bridgeCreateLead', () => {
  for (const file of [HANDLER, SHARED]) {
    for (const c of callsIn(file)) {
      const name = calleeName(c);
      if (name === 'opsQuery') {
        const method = lit(c.arguments[0]);
        if (method === 'POST') {
          assert.ok(['lcc_seller_lead_gate_decision', 'producer_runs'].includes(lit(c.arguments[1])),
            file + ': opsQuery POST to ' + lit(c.arguments[1]));
        }
      }
      if (name === 'domainQuery' || name === 'domainInsert') {
        assert.equal(lit(c.arguments[1]), 'PATCH', file + ': domain write other than a reversal PATCH');
      }
    }
  }
  const src = readFileSync(HANDLER, 'utf8');
  assert.match(src, /\(await import\('\.\.\/operations\.js'\)\)\.bridgeCreateLead/);
  const ops = readFileSync('api/operations.js', 'utf8');
  assert.match(ops, /export async function bridgeCreateLead\(/);
});

test('the tick names its skip and uses the point person as the lead owner', () => {
  const src = readFileSync(HANDLER, 'utf8');
  assert.match(src, /status: 'skipped', skip_reason: elig\.reason/);
  assert.match(src, /id: row\.point_person_user_id/);
});

test('routes are mounted in server.js', () => {
  const s = readFileSync('server.js', 'utf8');
  assert.match(s, /app\.all\('\/api\/seller-lead-gate', handleSellerLeadGate\)/);
  assert.match(s, /app\.all\('\/api\/seller-lead-autocreate-tick', handleSellerLeadAutocreateTick\)/);
});
