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

test('county_records is absent from the provenance-flush first-class allowlist', () => {
  // The trap, and it cuts BOTH ways. lcc_flush_provenance_events() relabels
  // every event whose source is not on `v_first_class` to 'domain_trigger'.
  // So emitting source='county_records' into provenance_event_log today would
  // land in field_provenance as 'domain_trigger' -- at a rung that does not
  // exist for these fields -- while a verification querying
  // `field_provenance where source='county_records'` still read zero.
  //
  // Keeping it OFF the allowlist is therefore the correct state while the
  // producer is model output. Adding it is a deliberate act that must happen
  // together with a real acquisition path, not as plumbing.
  const sqlFiles = readdirSync(join(ROOT, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => join(ROOT, 'supabase', 'migrations', f));
  const allowlistFiles = sqlFiles.filter((f) =>
    /v_first_class/.test(readFileSync(f, 'utf8')));
  assert.ok(allowlistFiles.length > 0,
    'v_first_class allowlist not found — lcc_flush_provenance_events may have been renamed; re-verify the relabel behaviour');
  for (const f of allowlistFiles) {
    const body = readFileSync(f, 'utf8');
    const m = body.match(/v_first_class[^;]*?ARRAY\[([^\]]*)\]/s);
    if (!m) continue;
    assert.ok(!/county_records/.test(m[1]),
      `county_records is on the flush allowlist in ${f.replace(ROOT, '')} — ` +
      'that arms the ladder for a producer that generates its values');
  }
});
