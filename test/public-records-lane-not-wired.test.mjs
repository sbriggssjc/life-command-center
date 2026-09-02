// ============================================================================
// PR1 — the public-records lane must not reach lcc_merge_field while its
// source is model output.
//
// `county_records` sits at priority 5-15 across 93 field rungs on both
// domains, above salesforce(20), om_extraction(30-50) and every sidebar
// (45-65). Its producers (Dialysis + government-lease
// src/public_record_ingest.py) contain no county record fetch: dia asks
// gpt-4o to recall parcel/tax facts from a prompt seeded with the property's
// own address and the owner we already hold; gov fetches a <=4,000-char
// snapshot of the assessor PORTAL HOMEPAGE and asks a model for parcel JSON.
//
// Measured 2026-09-01:
//   gov parcel_records — 100.0% of the 9,265 unstamped assessed values are
//   exact multiples of $100,000, against 3.8% on the CoStar leg in the SAME
//   table. dia tax_records — 186 rows carry a literal "XYZ ..." placeholder
//   owner and others are city-templated ("Santa Rosa Dialysis LLC").
//
// So wiring this lane to the ladder would promote generated numbers above
// real evidence. These guards make that wiring fail loudly instead of
// silently, and pin the relabelling trap that would hide it either way.
//
// Comments are stripped before matching: this file and the migrations name
// `county_records` repeatedly while explaining why it is NOT wired, so a raw
// grep would match the explanation and pass over a real regression.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Strip // line comments and block comments, keeping code intact. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('positive control: the comment stripper removes prose naming county_records', () => {
  const sample = `// source: 'county_records' is deliberately NOT wired\nconst x = 1;\n`;
  assert.ok(!stripComments(sample).includes('county_records'),
    'the stripper does not remove the prose these guards must see past');
  assert.ok(stripComments(sample).includes('const x = 1'), 'the stripper ate real code');
});

test('no api/ code calls lcc_merge_field with the county_records source', () => {
  const offenders = [];
  for (const file of walk(join(ROOT, 'api'))) {
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!/lcc_merge_field|recordFieldProvenance|provenance_event_log/.test(code)) continue;
    if (/['"`]county_records['"`]/.test(code)) offenders.push(file.replace(ROOT, ''));
  }
  assert.deepEqual(offenders, [],
    `these files would promote model output to the county_records rungs:\n  ${offenders.join('\n  ')}\n` +
    'If a real county adapter now exists, re-grade the lane and update ' +
    'docs/architecture/public-records-source-lane.md before removing this guard.');
});

test('county_records is REFUSED its own identity by the shipped flush body', () => {
  // The trap, and it cuts BOTH ways. Until PR8 (2026-09-02),
  // lcc_flush_provenance_events() relabelled every event whose source was not
  // on a four-name `v_first_class` literal to 'domain_trigger'. So emitting
  // source='county_records' landed in field_provenance as 'domain_trigger' --
  // at a rung that does not exist for these fields, so at most a blank-fill --
  // while a verification querying `field_provenance where source='county_records'`
  // still read zero.
  //
  // PR8 replaced that literal with "registered for this (table, field) => keep
  // your own name". county_records holds 93 rungs across 18 tables at a best
  // rung of 5 -- above salesforce(20), om_extraction(25-50) and every
  // sidebar(45-65) -- so under the new rule it would merge at 5 and OVERRIDE
  // real evidence rather than merely fill a blank. The relabel was the only
  // structural thing keeping a model-generated source off the ladder, so the
  // refusal is now EXPLICIT: `v_never_first_class`.
  //
  // Retiring that entry is a deliberate act that belongs with a real
  // acquisition path (REGRID_API_KEY -> regrid_client.py, backlog PR1d),
  // never as plumbing. Verified live 2026-09-02 against the shipped function:
  // a synthetic county_records event still stores source='domain_trigger'.
  const DEFINES = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.lcc_flush_provenance_events/i;
  const stripSql = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');

  const dir = join(ROOT, 'supabase', 'migrations');
  const defining = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, src: readFileSync(join(dir, f), 'utf8') }))
    .filter((m) => DEFINES.test(stripSql(m.src)));

  assert.ok(defining.length > 0,
    'no migration defines lcc_flush_provenance_events -- it may have been ' +
    'renamed; re-verify the relabel behaviour before touching this guard');

  // Only the NEWEST definition ships. Asserting over every migration that ever
  // defined it would keep passing on superseded bodies (P197).
  const { name, src } = defining[defining.length - 1];
  const code = stripSql(src);

  const deny = code.match(/v_never_first_class[^;]*ARRAY\[([^\]]*)\]/s);
  assert.ok(deny,
    `${name}: the shipped flush body declares no v_never_first_class deny set. ` +
    'Removing the old allowlist without it ARMS county_records at priority 5 ' +
    'for a producer that asks gpt-4o to recall parcel facts.');
  assert.match(deny[1], /'county_records'/,
    `${name}: county_records is no longer refused its own identity -- that ` +
    'promotes model output above salesforce, om_extraction and every sidebar. ' +
    'If a real county adapter now exists, re-grade the lane and update ' +
    'docs/architecture/public-records-source-lane.md before removing this guard.');

  assert.ok(/NOT\s*\(\s*v_src\s*=\s*ANY\s*\(\s*v_never_first_class\s*\)\s*\)/.test(code),
    `${name}: v_never_first_class is declared but not consulted by the ` +
    'merge-source gate -- a deny set nothing reads is not a defence');
});
