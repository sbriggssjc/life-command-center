// UX-T1a-gates — the two coverage gates, and the plumbing bands leaving the human surface.
//
// Three units, three classes of defect, and the guards target the SHAPE of each rather
// than a line number or a literal that moves (CLAUDE.md block-slice footgun):
//
//   Unit 1 (mirror-dia-lease) — `lcc_property_attributes` held NO lease dates for dia at
//     all (0 of 17,225) while gov read 11,725 of 13,838 through the SAME apply function.
//     The break needed THREE edits (source view, tick select=, apply branch) and any one
//     alone is a silent no-op.
//
//   Unit 2 (debt) — the `loan_maturity` slot. Two real traps are pinned here:
//     (a) `LCC_SIGNAL_TYPES` must list loan_maturity, or the new arm is fetched by
//         NOTHING and is invisible on every surface;
//     (b) the dedup must prefer the OWNER-ATTRIBUTED row, or the domain fan-out (which
//         emits entity_id:null) silently wins on rank_value and the card loses its owner.
//
//   Unit 3 (human_surface) — the flag must gate the item list AND the chip counts from
//     the same predicate, or the badge counts bands the list does not show.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE EVERY SOURCE ASSERTION. Each fix explains itself by
// NAMING the thing it removed ("is_distressed: false", "=== 2", the four band names), so
// a raw-source grep finds every banned token present and passes over a complete revert.
// This is the A5c / N18 / C10 lesson and it is load-bearing here, not hygiene.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// Strip // and /* */ comments without touching string literals. Deliberately simple:
// it only needs to survive these two files, and both are ordinary JS.
function stripJsComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | sq | dq | tpl
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; } i++; continue; }
    // inside a string literal
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    out += c; i++;
  }
  return out;
}

const sqlNoComments = (src) => src.replace(/--[^\n]*/g, '');

// ── the comment stripper itself, so the guards below cannot be silently disarmed ──
test('stripJsComments removes comments and preserves string literals', () => {
  assert.equal(stripJsComments('a // x\nb'), 'a \nb');
  assert.equal(stripJsComments('a /* x */ b'), 'a  b');
  // the case that matters: a banned token quoted INSIDE a comment must disappear...
  assert.ok(!stripJsComments('// is_distressed: false\nx').includes('is_distressed'));
  // ...while the same token in real code survives.
  assert.ok(stripJsComments("const s = 'is_distressed';").includes('is_distressed'));
  // and an apostrophe inside a line comment must not open a string and swallow code
  assert.ok(stripJsComments("// the engine's output\nconst kept = 1;").includes('const kept = 1;'));
});

// ─────────────────────────────── Unit 1 ────────────────────────────────
test('Unit 1: the dia mirror leg asks for the lease columns', () => {
  const sql = sqlNoComments(read('supabase/migrations/20261014120000_lcc_uxt1a_mirror_dia_lease_dates.sql'));
  // The tick's dia select= must request all six, or the apply function reads keys that
  // never arrive (P137).
  for (const col of ['lease_commencement', 'lease_expiration', 'firm_term_remaining',
                     'term_remaining', 'lease_source', 'initial_term_years']) {
    assert.ok(new RegExp(`v_new text :=[^;]*${col}`, 's').test(sql),
      `tick dia select= must request ${col}`);
  }
});

test('Unit 1: the apply function WRITES every lease column it asks for', () => {
  const sql = sqlNoComments(read('supabase/migrations/20261014120000_lcc_uxt1a_mirror_dia_lease_dates.sql'));
  const dia = sql.slice(sql.indexOf("IF p_domain = 'dia'"), sql.indexOf('ELSE', sql.indexOf("IF p_domain = 'dia'")));
  for (const col of ['lease_commencement', 'lease_expiration', 'firm_term_remaining',
                     'term_remaining', 'lease_source', 'initial_term_years']) {
    assert.ok(dia.includes(`${col}=COALESCE(EXCLUDED.${col}`),
      `dia apply branch must fill-blanks ${col} (asking without writing is a silent no-op)`);
  }
});

test('Unit 1: the tick replacement is ASSERTED, never a silent no-op', () => {
  const sql = sqlNoComments(read('supabase/migrations/20261014120000_lcc_uxt1a_mirror_dia_lease_dates.sql'));
  assert.ok(/RAISE EXCEPTION/.test(sql),
    'a replacement on a live definition must raise when its anchor is missing');
  // ⚠️ Pin the RAISE, not just the IF condition: replacing the raise body with `NULL;`
  // left the condition in place and SURVIVED an earlier version of this assertion.
  assert.ok(/position\(v_new IN v_def\) = 0 THEN\s*\n?\s*RAISE EXCEPTION/.test(sql),
    'the post-replacement check must RAISE, not merely be evaluated');
});

test('Unit 1: dia firm_term_remaining is an honest NULL, never 0', () => {
  const sql = sqlNoComments(read('supabase/migrations/dialysis/20260903120000_dia_uxt1a_mirror_lease_dates.sql'));
  assert.ok(/NULL::numeric\s+AS firm_term_remaining/.test(sql),
    'dia has no firm-term fact; 0 would read as "none remaining" (PR1a/PR1b sentinel class)');
  assert.ok(!/0::numeric\s+AS firm_term_remaining/.test(sql));
});

test('Unit 1: the dia lease lateral excludes SUPERSEDED leases', () => {
  const sql = sqlNoComments(read('supabase/migrations/dialysis/20260903120000_dia_uxt1a_mirror_lease_dates.sql'));
  // A superseded lease has been REPLACED; treating one as in effect is what inflates the
  // ceiling from the honest 1,747 to the audit's 1,940.
  // ⚠️ BOTH new laterals must exclude it. A bare presence check SURVIVED deleting the
  // exclusion from the lease-date lateral, because the initial-term lateral still
  // carried one — the same "appears legitimately elsewhere" trap. Anchor per lateral.
  const lz = sql.slice(sql.indexOf('FROM leases ll'), sql.indexOf('LIMIT 1) lz'));
  assert.ok(/superseded_at IS NULL/.test(lz),
    'the lease-DATE lateral must exclude superseded rows (a superseded lease has been replaced)');
  const it = sql.slice(sql.indexOf('FROM leases li'), sql.indexOf('LIMIT 1) it'));
  assert.ok(/superseded_at IS NULL/.test(it), 'the initial-term lateral must exclude them too');
  // and it must not silently reuse the RENT lateral, which does not filter superseded
  assert.ok(/lz\.lease_expiration/.test(sql), 'lease dates come from their own lateral, not the rent lateral');
});

// ─────────────────────────────── Unit 2 ────────────────────────────────
test('Unit 2: LCC_SIGNAL_TYPES lists loan_maturity, or the arm is fetched by nothing', () => {
  const js = stripJsComments(read('api/operations.js'));
  const m = js.match(/const LCC_SIGNAL_TYPES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'LCC_SIGNAL_TYPES must exist');
  assert.ok(m[1].includes('loan_maturity'),
    'the LCC loan_maturity arm is invisible on every surface unless it is fetched');
});

test('Unit 2: the lcc filter is keyed on the array length, not a hard-coded number', () => {
  const js = stripJsComments(read('api/operations.js'));
  assert.ok(/lccTypes\.length === LCC_SIGNAL_TYPES\.length/.test(js),
    'a literal === 2 silently becomes a per-type filter when a fourth arm is added');
  assert.ok(!/lccTypes\.length === 2/.test(js));
});

// ⚠️ BEHAVIOURAL, not a source grep. The first cut asserted the ORDER of the tokens
// `entity_id` and `rank_value` inside the comparator, and deleting the whole attribution
// branch SURVIVED it — because the `const ra = r.entity_id ? 1 : 0` declarations remain
// and still satisfy an indexOf check. That is the documented "a guard that matches a
// shape is defeated by a name that legitimately appears elsewhere". Invoke the real
// function instead. Found by the mutation pass, not by reading the guard.
test('Unit 2: dedup keeps the owner-attributed row even when it is worth LESS', async () => {
  const { assembleBdWorklist } = await import('../api/operations.js');
  const merged = assembleBdWorklist({
    // the LCC arm: owner resolved, but the asset is unpriced (39 of 172 rows are)
    lcc: [{ signal_type: 'loan_maturity', source_domain: 'gov', property_id: '12899',
            entity_id: 'e-owner-1', what: 'Loan matures Aug 2027 (11 mo)', who: 'NGP V DENTON TX LLC',
            rank_value: null, detail: {} }],
    // the domain fan-out for the SAME property: priced, but no owner at all
    loan_maturity: { gov: [{ property_id: '12899', owner_name: 'NGP V DENTON TX LLC',
                             annual_rent: 3126717.96, maturity_date: '2027-08-05',
                             maturity_band: '<=12mo' }] },
  });
  const rows = merged.filter((r) => r.signal_type === 'loan_maturity' && r.property_id === '12899');
  assert.equal(rows.length, 1, 'the two producers must collapse to one card');
  assert.equal(rows[0].entity_id, 'e-owner-1',
    'the owner-attributed row must survive; otherwise the card names a maturing loan with nobody to call');
});

test('Unit 2: within one attribution class, value still decides', async () => {
  const { assembleBdWorklist } = await import('../api/operations.js');
  const merged = assembleBdWorklist({
    lcc: [
      { signal_type: 'ownership_chain', source_domain: 'gov', property_id: '1', entity_id: 'a', what: 'x', rank_value: 10, detail: {} },
      { signal_type: 'ownership_chain', source_domain: 'gov', property_id: '1', entity_id: 'b', what: 'y', rank_value: 99, detail: {} },
    ],
  });
  const rows = merged.filter((r) => r.signal_type === 'ownership_chain');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rank_value, 99, 'attribution ties must fall through to value, as before');
});

test('Unit 2: is_distressed is read from the row, not hard-coded false', () => {
  const js = stripJsComments(read('api/operations.js'));
  const lcc = js.slice(js.indexOf('for (const r of (sources.lcc || []))'),
                       js.indexOf('const addLoan'));
  assert.ok(/is_distressed:\s*!!r\.is_distressed/.test(lcc),
    'the renderer has always read this key; hard-coding false is C10 one field over');
  assert.ok(!/is_distressed:\s*false/.test(lcc));
});

test('Unit 2: the LCC select= asks for is_distressed', () => {
  const js = stripJsComments(read('api/operations.js'));
  // ⚠️ There are TWO `v_lcc_bd_worklist?select=` occurrences — the count-only SUMMARY
  // path (`?select=signal_type`) and the LIST path. A bare `.match()` returns the FIRST,
  // so the first cut of this guard asserted against the summary and failed over correct
  // code. Target the ROW-FETCHING select by a column only it carries.
  const sels = [...js.matchAll(/v_lcc_bd_worklist\?select=([^&`']*)/g)].map((m) => m[1]);
  assert.ok(sels.length >= 2, 'expected both the summary and the list select=');
  const listSel = sels.find((s) => s.includes('rank_property_count'));
  assert.ok(listSel, 'the row-fetching select= must exist');
  assert.ok(listSel.includes('is_distressed'),
    'reading a field the query never asked for is the C10 defect itself');
});

test('Unit 2: the loan worklist keeps its correctness guards', () => {
  const sql = sqlNoComments(read('supabase/migrations/20261014120300_lcc_uxt1a_debt_worklist_and_arm.sql'));
  assert.ok(/e\.merged_into_entity_id IS NULL/.test(sql),
    'existence is not liveness — a tombstone still satisfies a plain join (P175)');
  assert.ok(/rank_value/.test(sql) && /value_unknown/.test(sql),
    'unpriced must be its own state, never $0 (P180)');
  // NULL, not 0 — a COALESCE to zero here would render "$0" and read as worthless
  assert.ok(!/COALESCE\(NULLIF\(f\.annual_rent, 0\), NULLIF\(pa\.annual_rent, 0\), 0\)/.test(sql));
  assert.ok(/ORDER BY lm\.maturity_date ASC/.test(sql),
    'the SOONEST maturity is the actionable one for a reason-to-sell signal');
});

// ─────────────────────────────── Unit 3 ────────────────────────────────
test('Unit 3: human_surface is keyed on the BAND, not the reason', () => {
  const sql = sqlNoComments(read('supabase/migrations/20261014120400_lcc_uxt1a_priority_queue_human_surface.sql'));
  const fn = sql.slice(sql.indexOf('lcc_priority_band_is_human_surface'), sql.indexOf('COMMENT ON FUNCTION'));
  for (const band of ['P0.4', 'P-CONTACT', 'P0.5', 'P-BUYER']) {
    assert.ok(fn.includes(`'${band}'`), `${band} must be classified`);
  }
  // `reason` carries per-row suffixes (agency_active_solicitations:23), so a
  // reason-keyed predicate matches some rows of a band and not others.
  assert.ok(!/\breason\b/.test(fn), 'the classifier must not key on reason');
});

test('Unit 3: the classifier fails OPEN — an unknown band is shown, not hidden', () => {
  const sql = sqlNoComments(read('supabase/migrations/20261014120400_lcc_uxt1a_priority_queue_human_surface.sql'));
  const fn = sql.slice(sql.indexOf('RETURNS boolean'), sql.indexOf('$fn$;'));
  assert.ok(/NOT IN/.test(fn),
    'an allowlist would hide every future band by default; a denylist shows it');
  assert.ok(!/\bIN\s*\(\s*'P1'/.test(fn));
});

test('Unit 3: nothing is deleted or filtered inside the view', () => {
  const sql = sqlNoComments(read('supabase/migrations/20261014120400_lcc_uxt1a_priority_queue_human_surface.sql'));
  assert.ok(!/\bDELETE\b/i.test(sql), 'the hidden bands have automated consumers; deleting breaks them');
  // the view APPENDS a flag; it must not filter, or the automated consumers go blind too
  assert.ok(/SELECT q\.\*/.test(sql), 'the flag is appended to the whole row set');
  assert.ok(!/WHERE .*human_surface/i.test(sql), 'the view flags; the surfaces filter');
});

test('Unit 3: the item list and the chip counts gate on the SAME predicate', () => {
  const js = stripJsComments(read('api/admin.js'));
  const region = js.slice(js.indexOf('let itemsPath = ') - 400, js.indexOf('let itemsPath = ') + 2500);
  assert.ok(/itemsPath \+= '&human_surface=is\.true'/.test(region),
    'the item list must serve only bands that earn a human');
  assert.ok(/v_priority_queue_band_counts\?select=priority_band,n&human_surface=is\.true/.test(region),
    'a chip counting a band the list does not show is a lying badge (P139)');
  assert.ok(/human_surface=is\.true&effective_domain=/.test(region),
    'the domain-filtered count path must gate too');
});

test('Unit 3: an explicit band request still reaches a hidden band', () => {
  const js = stripJsComments(read('api/admin.js'));
  const region = js.slice(js.indexOf('let itemsPath = '), js.indexOf('let itemsPath = ') + 900);
  // hidden ≠ unreachable: a deliberate drill-in must still work, so the filter is on the
  // DEFAULT path only.
  assert.ok(/if \(band\) itemsPath \+= '&priority_band=eq\.'/.test(region));
  assert.ok(/else itemsPath \+= '&human_surface=is\.true'/.test(region),
    'the human-surface filter must be the else branch, not unconditional');
});
