// P197 — the Tier 0 lane resolved "employer on file" from ONE source, by ONE key.
//
// WHAT THIS PINS, AND WHY EACH LINE EXISTS.
//
//  1. THE UNVERIFIED TIERS ARE CORROBORATION-GATED, THE HUB TIERS ARE NOT.
//     `lcc_sf_list_membership.company_name` and `entities.metadata->>'company'` are
//     human/capture labels, not employer registers. Measured on named rows over the
//     parked population they carry city/zip strings ("Southbury, CT 06488",
//     "Hollywood, FL 33021"), the person's own name ("Steve Blumer"), a P188-named junk
//     label ("Inco Commercial", on two people sharing ONE mailbox) and simply stale firms
//     ("Pop Local" for someone @edwardsrealtyco.com; "The Carpet Shop"
//     @corporaterealty1.com). Feeding those to `ev_company_matches_owner` would
//     manufacture a LINK — the exact claim P188 established these signals cannot make.
//     The hub tiers are ungated on purpose: the hub IS the system of record, so whatever
//     it says is "on file" by definition, which is also the pre-P197 behaviour.
//
//  2. THE CORROBORATION RULE HAS ONE OWNER. It previously lived inline in
//     v_lcc_tier0_owner_contact_lane as ev_company_confirms_employer. Two copies of one
//     predicate is the normaliser drift this repo has paid for repeatedly
//     (lcc_normalize_entity_name, the P134 re-derived GROUP BY). The lane must CALL the
//     function, and the migration must not restate the inline position() test.
//
//  3. THE DECIDABILITY CASE IS UNTOUCHED — and this migration rebuilds the view that
//     carries it, so P196's guard (which reads the P196 file) no longer describes the
//     shipped definition. Re-asserted here against the file that is now live:
//     'auto' still needs match_strength='exact' AND n_eligible=1, so NOTHING here can
//     widen what the unattended auto-attach sweep may write; and un-parking still must
//     not read n_person_evidence (P188's Gary George — green on three person signals for
//     George Washington University, employed by a poultry company).
//
//  4. THE PARK REASON IS COMPUTED FROM FIELDS, NOT PROSE (A1/P182).
//
//  5. PROVENANCE REACHES THE OPERATOR. A card decided off a Salesforce label is a weaker
//     claim than one decided off the hub; collapsing the two is the one-label-two-facts
//     failure (P181). So employer_source must survive into the card and the park report.
//
// Anchored on FUNCTION/VIEW NAMES and the resolver's own tier literals — never a line
// number, never a sliced region between banners (the block-slice footgun).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = 'supabase/migrations';
const P197 = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f.includes('p197_tier0_employer_resolver'))
  .map((f) => readFileSync(`${MIGRATIONS}/${f}`, 'utf8'))
  .join('\n');
const SQL = P197.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const PLANNER = readFileSync('api/_shared/tier0-confirm-planner.js', 'utf8');
const ADMIN = readFileSync('api/admin.js', 'utf8');
const TICK = readFileSync('api/_handlers/tier0-auto-attach-tick.js', 'utf8');

/** The resolver body, bounded by its own CREATE and its terminating `$$;` — a stable boundary. */
function resolverBody() {
  const start = SQL.indexOf('create or replace function public.lcc_tier0_employer_on_file');
  assert.ok(start > 0, 'lcc_tier0_employer_on_file not defined in the migration');
  const end = SQL.indexOf('$$;', start);
  assert.ok(end > start, 'resolver body not terminated');
  return SQL.slice(start, end);
}

/** One CASE expression, bounded by its own `AS <alias>`. */
function caseFor(alias) {
  const end = SQL.indexOf(`END AS ${alias}`);
  assert.ok(end > 0, `CASE ... AS ${alias} not found`);
  return SQL.slice(SQL.lastIndexOf('CASE', end), end);
}

test('the migration defines the resolver and carries every dependent view WHOLE', () => {
  assert.ok(P197.length > 0, 'P197 migration not found');
  for (const fn of ['lcc_tier0_company_confirms_domain', 'lcc_tier0_employer_on_file']) {
    assert.match(SQL, new RegExp(`create or replace function public\\.${fn}\\b`), `${fn} not defined`);
  }
  // P194: a migration that changes a view must carry the WHOLE view, or the next rebuild
  // from the committed source silently regresses it (predicted 1-row diff, actual 21).
  for (const v of [
    'v_lcc_tier0_owner_contact_candidates',
    'v_lcc_tier0_owner_contact_lane',
    'v_lcc_tier0_owner_contact_lane_triage',
    'v_lcc_tier0_park_watch',
    'v_lcc_tier0_owner_contact_lane_open',
  ]) {
    assert.match(SQL, new RegExp(`create or replace view public\\.${v}\\b`), `${v} not carried`);
  }
});

test('the two UNVERIFIED tiers are corroboration-gated; the two hub tiers are not', () => {
  const body = resolverBody();
  const tier = (label) => {
    const i = body.indexOf(`'${label}'`);
    assert.ok(i > 0, `tier ${label} missing from the resolver`);
    // the arm runs from the previous `select` to the next `union all` (or the end)
    const start = body.lastIndexOf('select', i);
    const nxt = body.indexOf('union all', i);
    return body.slice(start, nxt === -1 ? body.length : nxt);
  };
  for (const label of ['sf_campaign', 'entity_capture']) {
    assert.match(tier(label), /lcc_tier0_company_confirms_domain/,
      `${label} must be gated by the email-domain corroboration rule — it is a human/capture label, not an employer register`);
  }
  for (const label of ['hub_email', 'hub_entity_id']) {
    assert.doesNotMatch(tier(label), /lcc_tier0_company_confirms_domain/,
      `${label} must NOT be corroboration-gated — the hub is the system of record`);
  }
  // Rank order decides which answer wins; hub must outrank the labels.
  const ord = ['hub_email', 'hub_entity_id', 'sf_campaign', 'entity_capture'].map((l) => body.indexOf(`'${l}'`));
  assert.deepEqual(ord, [...ord].sort((a, b) => a - b), 'resolver tiers are out of rank order');
});

test('the hub lookup matches on entity_id as well as email', () => {
  // 247 person entities fleet-wide carry a unified_contacts row reachable ONLY by
  // entity_id; an email-only join reports them as having no employer at all.
  assert.match(SQL, /u\.entity_id = p_person_id/, 'resolver does not consult unified_contacts.entity_id');
  assert.match(SQL, /u2\.entity_id = mp\.person_id/, 'candidates hub lateral does not consult unified_contacts.entity_id');
});

test('the corroboration rule has ONE owner — the lane calls it, never restates it', () => {
  assert.match(SQL, /AS ev_company_confirms_employer/, 'ev_company_confirms_employer missing from the lane');
  const i = SQL.indexOf('AS ev_company_confirms_employer');
  const expr = SQL.slice(SQL.lastIndexOf('\n', SQL.lastIndexOf('\n', i) - 1), i);
  assert.match(expr, /lcc_tier0_company_confirms_domain/,
    'the lane must CALL the corroboration function, not restate the rule inline');
  assert.doesNotMatch(expr, /POSITION\s*\(\(e_1\.company_core\)\s+IN\s+\(e_1\.sldn\)\)/i,
    'the inline company_core/sldn containment test is a second copy of the rule');
});

test('the decidability CASE is NOT widened by this migration', () => {
  const c = caseFor('decidability');
  assert.match(c, /'exact'::text AND c\.n_eligible = 1 THEN 'auto'/,
    "auto must still require match_strength='exact' AND exactly one eligible candidate");
  assert.doesNotMatch(c, /n_person_evidence/,
    'person evidence attests the PERSON, never the LINK (P188) — it must never un-park a card');
  assert.match(c, /ELSE 'parked_domain_only'/, 'the CASE must still default to parked');
});

test('the park reason is classified from FIELDS, not from generated prose', () => {
  const c = caseFor('park_reason');
  for (const field of ['n_employer_on_file', 'n_employer_comparable']) {
    assert.match(c, new RegExp(field), `park_reason must read ${field}`);
  }
  assert.doesNotMatch(c, /ilike/i, 'a text detector over generated prose is the A1/P182 defect');
});

test('employer provenance reaches the card and the park report', () => {
  assert.match(SQL, /'employer_source', s\.employer_source/, 'people[] must carry employer_source');
  assert.match(SQL, /AS park_employer_source/, 'park_employer_source not exposed');
  assert.match(PLANNER, /employer_sources:/, 'buildTier0Card must expose employer_sources');
  // P134/P137: diff the handler's select= against the columns the consumer reads.
  const sel = ADMIN.slice(ADMIN.indexOf('v_lcc_tier0_owner_contact_lane_open?select='), ADMIN.indexOf('v_lcc_tier0_owner_contact_lane_open?select=') + 600);
  assert.match(sel, /employer_sources/, 'admin.js does not select employer_sources');
  const psel = TICK.slice(TICK.indexOf('v_lcc_tier0_park_watch?select='), TICK.indexOf('v_lcc_tier0_park_watch?select=') + 400);
  assert.match(psel, /park_employer_source/, 'the tick does not select park_employer_source');
});
