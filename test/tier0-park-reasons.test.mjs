// P196 Unit 2 — WHY a Tier 0 card is parked, and the sponsor-shaped route out.
//
// WHAT THIS PINS, AND WHY.
//
//  1. THE DECIDABILITY CASE IS NOT WIDENED. P188/P192 measured that person
//     evidence (SF campaign, SF contact, Outlook, correspondence, a job title)
//     attests the PERSON, never the LINK — Gary George at georgesinc.com, a
//     poultry company, passes three of four for George Washington University.
//     Admitting any of it to un-park restores exactly the noise P192 removed, and
//     it is the single most tempting "fix" for this backlog. So the CASE must keep
//     its `ELSE 'parked_domain_only'` and must not read n_person_evidence.
//
//  2. THE PARK REASON IS COMPUTED FROM FIELDS, NOT FROM PROSE. A1's lesson: a
//     text detector over generated prose agrees with the boolean today and is
//     structurally wrong (P182 — pg_views.definition is deparsed, and prose has
//     no parser). The classifier must name n_employer_on_file /
//     n_employer_comparable and must contain no `ilike`.
//
//  3. THE SPONSOR GATE KEEPS ALL FOUR GUARDS. Leading-token equality alone reads
//     ~25% precision over the live parked population — the same number P189
//     measured and rejected for domain-keyed merge grouping. Each guard was added
//     against a named false positive: George Kurz <- George's Inc (person-shaped),
//     Steel Station Rd LLC <- Steel Equities (street), Cedar Oma LLC <- Cedarwood
//     Group (no SPE marker), and brokerages on principle. Drop one and the view
//     becomes a noise generator.
//
//  4. NOTHING IN UNIT 2 WRITES. Confirming a sponsor row is a curated human INSERT.
//
// Anchored on VIEW/FUNCTION NAMES and the classifier's own field tokens — never a
// line number, never a sliced region between banners (the block-slice footgun).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = 'supabase/migrations';
const P196 = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f.includes('p196_tier0_park_reasons'))
  .map((f) => readFileSync(`${MIGRATIONS}/${f}`, 'utf8'))
  .join('\n');
const SQL = P196.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const TICK = readFileSync('api/_handlers/tier0-auto-attach-tick.js', 'utf8');

/** One CASE expression, bounded by its own `AS <alias>` — a stable boundary. */
const caseFor = (alias) => {
  const end = SQL.indexOf(`END AS ${alias}`);
  assert.ok(end > 0, `CASE ... AS ${alias} not found`);
  const start = SQL.lastIndexOf('CASE', end);
  return SQL.slice(start, end);
};

test('the migration defines the gate, the reasons and the proposal view', () => {
  assert.ok(P196.length > 0, 'P196 unit-2 migration not found');
  for (const obj of [
    'lcc_tier0_brand_token',
    'lcc_tier0_sponsor_brand_token',
    'v_lcc_tier0_owner_contact_lane_triage',
    'v_lcc_tier0_park_watch',
    'v_lcc_tier0_sponsor_map_proposals',
  ]) assert.match(SQL, new RegExp(obj), `missing ${obj}`);
});

test('the decidability CASE is unchanged and still refuses person evidence', () => {
  const c = caseFor('decidability');
  assert.match(c, /ELSE 'parked_domain_only'/);
  assert.match(c, /c\.n_link_evidence > 0/, 'link evidence is the only evidence arm');
  assert.doesNotMatch(c, /n_person_evidence/,
    'person evidence attests the PERSON, never the LINK — P188 Gary George');
  for (const strength of ['exact', 'domain_is_core_prefix', 'core_is_domain_prefix', 'curated_sponsor']) {
    assert.match(c, new RegExp(`'${strength}'`), `decidability lost the ${strength} arm`);
  }
});

test('park_reason is classified from FIELDS, never from prose', () => {
  const c = caseFor('park_reason');
  assert.match(c, /n_employer_on_file = 0/);
  assert.match(c, /n_employer_comparable = 0/);
  assert.match(c, /'employer_on_file_differs'/);
  // NULL for a card that is not parked: a reason on an actionable card reads as a
  // blocker that is not there.
  assert.match(c, /decidability <> 'parked_domain_only'/);
  assert.doesNotMatch(c, /ilike/i,
    'a text detector over generated prose is the A1 defect, even when it agrees');
});

test('employer_not_comparable is kept distinct from employer_on_file_differs', () => {
  // The comparator has a 6-char floor on BOTH sides. "it could not run" and
  // "it ran and disagreed" are different facts; one bucket hides the first.
  assert.match(SQL, /length\(e_1\.company_core\) >= 6 AND length\(e_1\.owner_core\) >= 6 AS employer_comparable/);
  assert.match(caseFor('park_reason'), /'employer_not_comparable'/);
});

test('the sponsor gate keeps every guard, each earned on a named row', () => {
  const g = SQL.slice(SQL.indexOf('function public.lcc_tier0_sponsor_brand_token'));
  const body = g.slice(0, g.indexOf('$$;'));
  assert.match(body, /length\(o\) < 5 or length\(c\) < 5/, 'the 5-char floor');
  assert.match(body, /propert\(y\|ies\)\|holdings\|owner\|propco\|holdco\|fund/, 'the SPE-marker guard');
  assert.match(body, /\\m\(rd\|road\|st\|street/, 'the street-name guard (Steel Station Rd)');
  assert.match(body, /lcc_looks_like_person\(p_owner_name\)/, 'the person-shape guard (George Kurz)');
  assert.match(body, /lcc_owner_name_is_brokerage\(p_company\)/, 'a brokerage is the agent, never the principal');
});

test('unit 2 writes nothing', () => {
  assert.doesNotMatch(SQL, /insert\s+into\s+public\.lcc_owner_sponsor_domain/i,
    'confirming a sponsor row is a curated human INSERT');
  assert.doesNotMatch(SQL, /(insert|update|delete)[\s\S]{0,40}owner_contact_pivot/i);
  assert.doesNotMatch(SQL, /cron\.schedule/, 'unit 2 schedules nothing');
});

test('the tick renders only columns it actually selects', () => {
  // P137: diff the consumer's reads against the handler's own select=.
  const sel = TICK.slice(TICK.indexOf("'v_lcc_tier0_park_watch?select="));
  const selectList = sel.slice(0, sel.indexOf('&order='));
  for (const col of ['park_reason', 'park_employer_on_file', 'park_owner_compared',
    'sponsor_shaped', 'owner_rent', 'owner_name', 'domain']) {
    assert.ok(selectList.includes(col), `park_watch select= is missing ${col}`);
  }
});

test('the parked block is on the DRY RUN only and counts the rows it fetched', () => {
  const dry = TICK.slice(TICK.indexOf("mode: 'dry_run'"), TICK.indexOf('---- POST: write'));
  assert.match(dry, /parked: await fetchParkBreakdown\(\)/);
  assert.match(dry, /sponsor_map_proposals: await fetchSponsorProposals\(\)/);
  // the badge and the list must come from the same rows (P132)
  assert.match(TICK, /cards: rows\.length/);
  assert.match(TICK, /capped: rows\.length === PARK_CAP/);
});
