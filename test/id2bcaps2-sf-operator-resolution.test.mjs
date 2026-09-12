// ID2b-caps-2 — closes the gap ID2b-caps left open: sf_comp_staging (Team
// Briggs' own Salesforce-staged closed comps) has no `properties` join, so
// ID2b-caps' rpc_query_comps change always emitted `operator_id: null` for
// that arm. Live re-check by Cowork found FIVE per-operator TTM cap-rate
// bands where there should be THREE — two of them (Fresenius Medical Care,
// DaVita) each split into an id-keyed band and a leftover text-keyed band
// carrying the IDENTICAL display label, because 196 `DaVita Dialysis` and
// 179 `Fresenius Medical Care` sf_comp_staging rows were exact matches of
// already-registered aliases the RPC's text fallback never consulted.
//
// This unit is two things, tested separately:
//   1. sf_comp_staging.operator_id (a new first-class column, resolved via
//      the ONE shared ID2a resolver `dia_resolve_operator` — see
//      supabase/migrations/dialysis/20260912140000_..._sf_comp_staging_operator_id.sql
//      and .../20260912150000_..._rpc_query_comps_sf_operator_id.sql). The
//      RPC bodies live in Postgres, not this repo's JS, so what this file
//      CAN test without a DB is: the migration source shape (fill-blanks
//      trigger, backfill function, review-lane routing) and that the RPC's
//      SF arm was rewired from a NULL literal to a resolved lateral join
//      while every other key/arm is untouched. The live merge itself was
//      verified against zqzrriwuavgrquhisnoa (see the addendum in
//      docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md).
//   2. planOperatorCapRateBands()'s new structural invariant: two DIFFERENT
//      resolved operator_id groups must never render under one canonical
//      label. Pure, no-DB, fully exercised here with constructed fixtures.
//
// Pure / no-DB — mirrors test/id2b-caps-operator-id-bands.test.mjs's own
// stated convention.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planOperatorCapRateBands } from '../api/_handlers/market-brief-psql-tick.js';
import { MIN_N_CAP_BAND } from '../api/_shared/market-brief-facts.js';

function stripComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const TICK_SRC = stripComments(readFileSync(
  fileURLToPath(new URL('../api/_handlers/market-brief-psql-tick.js', import.meta.url)), 'utf8'));

const RPC_SF_SRC = readFileSync(
  fileURLToPath(new URL(
    '../supabase/migrations/dialysis/20260912150000_dia_id2bcaps2_rpc_query_comps_sf_operator_id.sql',
    import.meta.url)), 'utf8');

const SF_COLUMN_SRC = readFileSync(
  fileURLToPath(new URL(
    '../supabase/migrations/dialysis/20260912140000_dia_id2bcaps2_sf_comp_staging_operator_id.sql',
    import.meta.url)), 'utf8');

const N = MIN_N_CAP_BAND;

function rows(spec) {
  return spec.map((s, i) => ({
    comp_id: `t${i}`,
    tenant: s.tenant,
    operator_id: s.operator_id ?? null,
    operator_canonical: s.operator_canonical ?? null,
    cap_rate: s.cap_rate,
    sale_date: s.sale_date || '2026-01-01',
  }));
}

function repeat(spec, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ ...spec, cap_rate: spec.cap_rate + i * 0.0001, sale_date: `2026-0${(i % 9) + 1}-01` });
  return out;
}

// ---------------------------------------------------------------------------
// 1. SF-arm resolution fixtures — a sf_comp_staging-shaped row that now
//    carries operator_id (post-fix) merges into the id-keyed band exactly
//    like a properties-sourced row does. This is planOperatorCapRateBands()
//    exercising the SAME code path ID2b-caps' own test suite already covers
//    for the properties arm — the only NEW fact here is that the source of
//    these rows is `sf_comp_staging`, which previously could only ever
//    arrive with operator_id=null.
// ---------------------------------------------------------------------------

test('a sf_comp_staging-shaped row now carrying operator_id merges into the id-keyed band, not a second text band', () => {
  const r = [
    // Rows shaped like the properties/sales_transactions arm.
    ...repeat({ tenant: 'Fresenius', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.07 }, N),
    // Rows shaped like the FIXED sf_comp_staging arm — same operator_id,
    // resolved via sf_comp_staging.operator_id -> dia_operator_survivor,
    // exactly the shape rpc_query_comps now emits for that arm.
    ...repeat({ tenant: 'Fresenius Medical Care', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.071 }, N),
  ];
  const { facts, retire } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 1, 'one merged band, not two');
  assert.equal(facts[0].fact_key, 'cap_rate_ttm_band:5');
  assert.equal(facts[0]._n, N * 2);
  const retireKeys = retire.map((x) => x.fact_key).sort();
  assert.deepEqual(retireKeys, ['cap_rate_ttm_band:fresenius', 'cap_rate_ttm_band:fresenius_medical_care']);
});

test('DaVita Dialysis (the sf_comp_staging spelling) merges under operator_id 4 with the properties-sourced DaVita rows', () => {
  const r = [
    ...repeat({ tenant: 'DaVita', operator_id: 4, operator_canonical: 'DaVita', cap_rate: 0.06 }, N),
    ...repeat({ tenant: 'DaVita Dialysis', operator_id: 4, operator_canonical: 'DaVita', cap_rate: 0.062 }, N),
  ];
  const { facts } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].fact_key, 'cap_rate_ttm_band:4');
  assert.equal(facts[0]._n, N * 2);
});

// ---------------------------------------------------------------------------
// 2. An unresolvable tenant (not yet in the registry — routed to
//    dia_operator_write_review, live-measured: 6 of 406 sf_comp_staging
//    tenants) stays operator_id=null and forms its own text-keyed band --
//    never dropped, never guessed into an unrelated bucket. This is the
//    ID2a coverage-gap fallback, deliberately unchanged by this unit.
// ---------------------------------------------------------------------------

test('an unresolvable tenant (still open in dia_operator_write_review) keeps grouping on raw text, never dropped', () => {
  const r = repeat({ tenant: 'Reliant Renal Care', operator_id: null, operator_canonical: null, cap_rate: 0.08 }, N);
  const { facts, retire } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].fact_key, 'cap_rate_ttm_band:reliant_renal_care');
  assert.equal(facts[0]._n, N);
  assert.equal(retire.length, 0, 'nothing to retire -- this tenant never resolved an operator_id this run');
});

// ---------------------------------------------------------------------------
// 3. The duplicate-display-label invariant: two DIFFERENT resolved
//    operator_id groups must never both render under one canonical label.
//    Constructed directly (a registry defect this codebase's own operators
//    table has never actually had — two ids named identically that were
//    never merged) since a live instance of THIS class does not exist
//    today; the invariant exists to make the CLASS impossible, not to
//    describe a currently-open defect.
// ---------------------------------------------------------------------------

test('duplicate-label invariant: two different operator_ids sharing a canonical label collapse to ONE live band', () => {
  const r = [
    // A hypothetical un-merged registry duplicate: two DIFFERENT operator_ids
    // (91 and 92) both canonicalizing to "Acme Dialysis" -- a registry defect
    // this codebase's own merge machinery (dia_id2a_merge_operator_group)
    // exists to prevent, but the band builder must refuse to ship it even if
    // one slips through.
    ...repeat({ tenant: 'Acme Dialysis', operator_id: 91, operator_canonical: 'Acme Dialysis', cap_rate: 0.065 }, N + 3), // larger n -- winner
    ...repeat({ tenant: 'Acme Renal', operator_id: 92, operator_canonical: 'Acme Dialysis', cap_rate: 0.067 }, N), // smaller n -- loser
  ];
  const { facts, retire } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 1, 'the duplicate label never ships as two live facts');
  assert.equal(facts[0].fact_key, 'cap_rate_ttm_band:91', 'the larger-n group wins');
  assert.equal(facts[0]._n, N + 3, 'the loser`s rows are NOT folded into the winner -- they are refused, not merged');
  // Supersede, not duplicate: the loser is explicitly retired, mirroring the
  // exact mechanism (retireStaleFact -> status=superseded) the raw-text
  // aliases already use -- never left live beside its winner, never
  // silently dropped with no trace.
  const loserRetire = retire.find((x) => x.fact_key === 'cap_rate_ttm_band:92');
  assert.ok(loserRetire, 'the loser fact_key is explicitly named for retirement');
  assert.equal(loserRetire.reason, 'duplicate_label:id:91');
});

test('duplicate-label invariant is a NO-OP when the labels genuinely differ (the ordinary case)', () => {
  const r = [
    ...repeat({ tenant: 'DaVita', operator_id: 4, operator_canonical: 'DaVita', cap_rate: 0.06 }, N),
    ...repeat({ tenant: 'Fresenius', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.07 }, N),
  ];
  const { facts } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  assert.equal(facts.length, 2);
  assert.deepEqual(facts.map((f) => f.fact_key).sort(), ['cap_rate_ttm_band:4', 'cap_rate_ttm_band:5']);
});

test('duplicate-label invariant does NOT apply to an id-keyed band sharing a label with a text-keyed (unresolved) fallback band — the documented ID2a coverage-gap exception', () => {
  const r = [
    // Resolved via operator_id.
    ...repeat({ tenant: 'Fresenius Medical Care', operator_id: 5, operator_canonical: 'Fresenius Medical Care', cap_rate: 0.07 }, N),
    // A DIFFERENT property, same raw text, but its operator_id has never
    // resolved (the live 2026-09-12 case: dia_db:14785). Must coexist, per
    // the pre-existing "raw-text alias is never retired if OTHER,
    // unresolved rows still need it" behaviour this unit does not change.
    ...repeat({ tenant: 'Fresenius Medical Care', operator_id: null, operator_canonical: null, cap_rate: 0.09 }, N),
  ];
  const { facts, retire } = planOperatorCapRateBands({ rows: r, lane: 'dialysis', asOfIso: '2026-09-12T00:00:00Z' });
  const keys = facts.map((f) => f.fact_key).sort();
  assert.deepEqual(keys, ['cap_rate_ttm_band:5', 'cap_rate_ttm_band:fresenius_medical_care'],
    'an unresolved-property fallback band is NOT collapsed by the duplicate-label invariant');
  assert.equal(retire.length, 0, 'the unresolved fallback key is genuinely live this run -- must not be retired');
});

// ---------------------------------------------------------------------------
// 4. Regression: comp SELECTION/scoring and every pre-existing RPC key are
//    untouched -- source-level check anchored on stable identity tokens
//    (per this repo's own block-slice footgun rule), not a line number.
// ---------------------------------------------------------------------------

test('the RPC sale/listing arms keep the ID2b-caps operator_id resolution byte-identical -- only the SF arm changed', () => {
  // Both arms still resolve operator_id via properties.operator_id ->
  // dia_operator_survivor -> operators.name, unchanged from ID2b-caps.
  const saleArmResolve = "select o.operator_id, o.name\n      from public.operators o\n      where o.operator_id = public.dia_operator_survivor(p.operator_id::bigint)\n    ) op_resolved on true";
  assert.ok(RPC_SF_SRC.includes(saleArmResolve), 'sale/listing arm operator resolution is unchanged');
  const occurrences = RPC_SF_SRC.split('dia_operator_survivor(p.operator_id::bigint)').length - 1;
  assert.equal(occurrences, 2, 'exactly the sale arm + listing arm resolve via properties.operator_id, as before');
});

test('the SF arm now resolves operator_id from sf_comp_staging.operator_id via the survivor chain, not a NULL literal', () => {
  assert.match(RPC_SF_SRC, /dia_operator_survivor\(st\.operator_id::bigint\)/,
    'the SF arm resolves through the same survivor chain the other two arms use');
  assert.ok(!/'operator_id',\s*null::bigint/.test(RPC_SF_SRC),
    'the old NULL-literal SF arm output is gone');
  assert.match(RPC_SF_SRC, /'operator_id',\s*sf_op_resolved\.operator_id/);
  assert.match(RPC_SF_SRC, /'operator_canonical',\s*sf_op_resolved\.name/);
});

test('mcp/comps-tools.js comp SELECTION reads none of the operator_id fields this unit touches', () => {
  const compsToolsSrc = readFileSync(
    fileURLToPath(new URL('../mcp/comps-tools.js', import.meta.url)), 'utf8');
  assert.ok(!compsToolsSrc.includes('operator_id'),
    'operatorTier()/compTenantText() must not read operator_id -- SELECTION is untouched by this unit');
});

// ---------------------------------------------------------------------------
// 5. The sf_comp_staging migration itself: fill-blanks trigger (never
//    raises, never overwrites), review-lane routing, dry-run-default
//    backfill -- source-shape checks since this repo has no DB in test.
// ---------------------------------------------------------------------------

test('the sf_comp_staging operator-fill trigger is fill-blanks only and never raises', () => {
  assert.match(SF_COLUMN_SRC, /if NEW\.operator_id is not null then\s*\n\s*return NEW;/,
    'fill-blanks: an already-set operator_id is never overwritten');
  assert.match(SF_COLUMN_SRC, /create trigger trg_dia_sf_comp_staging_operator_fill\s*\n\s*before insert or update of tenant/);
  // Scope the "never raises" check to the TRIGGER FUNCTION BODY only -- the
  // migration's own startup guard (`do $$ ... raise exception ... end $$`)
  // legitimately raises if the target DB is missing sf_comp_staging or
  // dia_resolve_operator, which is unrelated to the trigger's own
  // never-block-the-write contract.
  const fnStart = SF_COLUMN_SRC.indexOf('create or replace function public.dia_sf_comp_staging_operator_fill()');
  assert.ok(fnStart >= 0, 'trigger function definition found');
  const fnEnd = SF_COLUMN_SRC.indexOf('$$;', SF_COLUMN_SRC.indexOf('$$', fnStart) + 2);
  const fnBody = SF_COLUMN_SRC.slice(fnStart, fnEnd);
  assert.ok(!/raise exception/i.test(stripComments(fnBody)),
    'the sf_comp_staging fill trigger never raises -- unlike properties.operator hard-block guard, this is an externally-fed table');
});

test('unresolved sf_comp_staging tenants route to the SAME shared review lane, de-duplicated per (row, raw text)', () => {
  assert.match(SF_COLUMN_SRC, /dia_id2a_log_unresolved_write\('sf_comp_staging', NEW\.staging_id::text, NEW\.tenant\)/);
  assert.match(SF_COLUMN_SRC, /not exists \(\s*\n\s*select 1 from public\.dia_operator_write_review r/,
    'de-dupes against an already-open review row for the same (table, record_pk, raw text)');
});

test('the backfill function is dry-run-default and only auto-applies exact/alias matches', () => {
  assert.match(SF_COLUMN_SRC, /p_dry_run boolean default true/);
  assert.match(SF_COLUMN_SRC, /from tmp_id2bcaps2_sf_comp_plan where status = 'matched'/,
    'the reported auto-apply count is scoped to matched rows');
  assert.match(SF_COLUMN_SRC, /where st\.staging_id = t\.staging_id and t\.status = 'matched'/,
    'the apply UPDATE only ever writes matched rows');
  assert.match(SF_COLUMN_SRC, /where t\.status <> 'matched'/,
    'everything else routes to the review lane, never auto-written');
});

// ---------------------------------------------------------------------------
// 6. The duplicate-label guard fires from the ONE lane builder — sanity that
//    the invariant lives in planOperatorCapRateBands (the single owner of
//    band grouping), not duplicated anywhere else in this file.
// ---------------------------------------------------------------------------

test('the duplicate-label invariant is defined exactly once, inside planOperatorCapRateBands', () => {
  const occurrences = (TICK_SRC.match(/DUPLICATE BAND LABEL invariant fired/g) || []).length;
  assert.equal(occurrences, 1, 'no second copy of this guard exists anywhere in the tick file');
});
