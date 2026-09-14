// ============================================================================
// OCR1 bake-off harness — guards for the comparison logic.
//
// The harness's whole value is one number (field agreement), and the two ways
// that number lies are guarded here:
//
//   1. BOTH-NULL COUNTED AS AGREEMENT. If a document defeats both engines every
//      field is null on both sides; naive equality then reports 100% agreement
//      over a total failure. `agreement_rate` must EXCLUDE both-null.
//   2. A GRADED KEY THE CONSUMER NEVER EMITS. `extractTenantFromLease` renames
//      on the way out (tenant_name→name, leased_sf→sf). Grading on the model's
//      JSON names reads `undefined`, normalizes to null on both sides, and
//      scores `both_null` forever — a field silently not measured. THIS WAS LIVE
//      in the harness's first run, on 2 of 6 fields.
//
// Pure functions only: no network, no model, no OCR binary.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GRADED_FIELDS, assertGradedFieldsReadable, normalizeField, compareField,
  scoreDocument, garbleStats, clauseLegibility,
  normalizePunctuation, isNullSentinel, summarizeSelfControl, deltaVsSelf,
  stderrTail, classifyEngineAvailability,
} from '../scripts/ocr-bakeoff.mjs';
import { extractTenantFromLease } from '../api/_shared/bov-extract.js';

const HARNESS_SRC = readFileSync(new URL('../scripts/ocr-bakeoff.mjs', import.meta.url), 'utf8');

/**
 * ⚠️ STRIP COMMENTS BEFORE GREPPING THE SOURCE. This harness's comments quote
 * every hazard they remove — `.slice(0, 160)`, `temperature`, the sentinel
 * spellings — by name and at length. A raw-source detector finds them all
 * present and passes over a regression (the A5c / N18 lesson). Block comments
 * and line comments only; string literals are preserved because the assertions
 * below match on code that CONTAINS literals.
 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * ⚠️ AND SOMETIMES THE PROSE IS IN A STRING, NOT A COMMENT. The report the
 * harness RENDERS says, in a `L.push('…')` literal, that the control is
 * "deliberately NOT `temperature=0`" — so a grep for `temperature` over
 * comment-stripped source matches the sentence explaining the rule and reads it
 * as a violation. (It did: the assertion below went red over correct code on its
 * first run.) A detector for a CODE shape must blank string literals too.
 *
 * Scoped to that one assertion, because every other source check here matches on
 * code that CONTAINS a literal (`control === 'self'`, `entry.graded_values`).
 * Template-literal `${…}` expressions are blanked with the rest; acceptable
 * because nothing this guard looks for is ever written inside one.
 *
 * ⚠️ RUN IT ON COMMENT-STRIPPED SOURCE. A bare apostrophe in prose opens a
 * string this scanner never closes correctly, blanking real code behind it.
 */
function blankStringLiterals(src) {
  let out = ''; let i = 0; let quote = null;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { out += '  '; i += 2; continue; }
      if (ch === quote) { out += ch; quote = null; i += 1; continue; }
      out += (ch === '\n' ? '\n' : ' '); i += 1; continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i += 1; continue; }
    out += ch; i += 1;
  }
  return out;
}

const T = (over = {}) => ({
  name: 'Acme Dialysis LLC', lease_commencement: '2019-06-01', lease_expiration: '2034-05-31',
  year1_rent: 412500, sf: 14250, lease_type: 'NNN', ...over,
});

// --- 1. the both-null trap --------------------------------------------------

test('both-null is its own verdict and is never agreement', () => {
  assert.equal(compareField(GRADED_FIELDS[0], null, null), 'both_null');
  assert.equal(compareField(GRADED_FIELDS[0], '', ''), 'both_null');
});

test('a document where both engines found nothing scores null, NOT 1.0', () => {
  const s = scoreDocument({}, {});
  assert.equal(s.tally.both_null, GRADED_FIELDS.length);
  assert.equal(s.decided_fields, 0);
  assert.equal(s.agreement_rate, null, 'a mutual total failure must not render as a perfect score');
});

test('agreement_rate denominator excludes both_null', () => {
  // 3 agree, 1 disagree, 2 both-null → 3/4 = 75%, never 3/6 or 4/6.
  const base = T({ year1_rent: null, sf: null });
  const cand = T({ year1_rent: null, sf: null, lease_type: 'Gross' });
  const s = scoreDocument(base, cand);
  assert.equal(s.tally.both_null, 2);
  assert.equal(s.decided_fields, 4);
  assert.equal(s.agreement_rate, 0.75);
});

test('a local miss and a local win are distinguished, and neither is agreement', () => {
  assert.equal(compareField(GRADED_FIELDS[3], 412500, null), 'baseline_only'); // local LOST it
  assert.equal(compareField(GRADED_FIELDS[3], null, 412500), 'candidate_only'); // local WON it
  const s = scoreDocument(T(), T({ year1_rent: null }));
  assert.equal(s.tally.baseline_only, 1);
  assert.equal(s.tally.agree, 5);
  assert.ok(s.agreement_rate < 1, 'a field the local engine lost must reduce the rate');
});

// --- 2. graded keys must exist on the CONSUMER's object ---------------------

test('every graded key is one extractTenantFromLease actually emits', async () => {
  // Drive the real consumer with a stub model so the tenant shape is the real one.
  const model = {
    tenant_name: 'Acme', leased_sf: 100, lease_type: 'NNN', year1_rent: 1,
    lease_commencement: '2020-01-01', lease_expiration: '2030-01-01',
  };
  const res = await extractTenantFromLease(
    { document_id: 'x', raw_text: 'lease', pages: null },
    { invokeExtractionAI: async () => ({ ok: true, data: { response: JSON.stringify(model) } }) },
  );
  assert.ok(res.ok, 'stub extraction should succeed');
  const unreadable = assertGradedFieldsReadable(res.tenant);
  assert.deepEqual(unreadable, [],
    `graded keys absent from the consumer tenant object: ${unreadable.join(', ')} — these would score both_null forever`);
  // And the values must actually arrive, not just the keys exist.
  for (const f of GRADED_FIELDS) {
    assert.notEqual(res.tenant[f.key], undefined, `${f.label} (key ${f.key}) unreadable`);
  }
});

test('assertGradedFieldsReadable names a renamed key instead of scoring both_null', () => {
  const missing = assertGradedFieldsReadable({ lease_type: 'NNN' });
  assert.ok(missing.includes('tenant_name'));
  assert.ok(missing.includes('leased_sf'));
  assert.equal(assertGradedFieldsReadable(null).length, GRADED_FIELDS.length);
});

// --- 3. normalization dispatches on TYPE, not on field name -----------------

test('money and SF normalize past $ and commas; dates past surrounding text', () => {
  assert.equal(normalizeField('number', '$412,500'), 412500);
  assert.equal(normalizeField('number', 412500), 412500);
  assert.equal(normalizeField('date', 'commencing 2019-06-01 hereof'), '2019-06-01');
  assert.equal(normalizeField('string', ' Acme  Dialysis, LLC. '), 'acme dialysis llc');
  assert.equal(normalizeField('number', 'not a number'), null);
});

test('a digit error is a DISAGREEMENT, never smoothed away by a tolerance', () => {
  // 412500 vs 412600 is exactly the OCR failure the bake-off exists to catch.
  assert.equal(compareField(GRADED_FIELDS[3], 412500, 412600), 'disagree');
});

// --- 4. context signals -----------------------------------------------------

test('garbleStats separates a clean read from a same-length garbled one', () => {
  const clean = garbleStats('The Tenant shall pay Base Rent monthly in advance');
  const garbled = garbleStats('Tl1e T3nant 5h@ll p@y B@se R3nt m0nthly 1n adv@nce');
  assert.ok(garbled.wordlike_ratio < clean.wordlike_ratio,
    'a garbled read of similar length must score lower on wordlike_ratio');
});

test('garbleStats reports empty text honestly rather than as a zero score', () => {
  const g = garbleStats('');
  assert.equal(g.chars, 0);
  assert.equal(g.wordlike_ratio, null, 'no text means cannot be measured, not measured-as-0');
});

test('clauseLegibility finds back-half clauses and reports where they sit', () => {
  const text = `${'filler '.repeat(400)}Tenant shall have the option to extend the term. `
    + 'Upon an event of default Tenant shall have a cure period. Any holding over is at 150%.';
  const c = clauseLegibility(text);
  assert.equal(c.renewal_options.found, true);
  assert.equal(c.default_cure.found, true);
  assert.equal(c.holdover.found, true);
  assert.equal(c.early_termination.found, false, 'a clause the text does not state must read false');
  assert.ok(c.renewal_options.position > 0.5, 'a back-half clause should report a back-half position');
  assert.equal(c.found_count, 3);
});

// ============================================================================
// OCR1c guards — the comparator artifacts, the self-agreement floor, the
// failure reporting that hid two real causes behind 36 identical warnings, and
// arm B's unreadable count.
//
// The first real run scored 77% tesseract-vs-DocAI field agreement over 10
// documents. Reading the 11 non-agreements showed at least 6 were harness or
// model artifacts, not OCR. These guard the four repairs.
// ============================================================================

// --- 5. comparator artifacts are not OCR findings ---------------------------

test('a curly apostrophe and a straight one are the same tenant, not a disagreement', () => {
  // MEASURED: 2 of the 11 first-run non-agreements were exactly this pair.
  assert.equal(compareField(GRADED_FIELDS[0], "Kohl's", 'Kohl’s'), 'agree');
  assert.equal(compareField(GRADED_FIELDS[0], '“Acme” Medical', '"Acme" Medical'), 'agree');
  assert.equal(compareField(GRADED_FIELDS[0], 'Smith–Jones LLC', 'Smith-Jones LLC'), 'agree');
  assert.equal(compareField(GRADED_FIELDS[0], 'Acme Medical  Partners', 'Acme Medical Partners'), 'agree');
});

test('the four no-value spellings all mean null and never score candidate_only', () => {
  // MEASURED: 2 of the 11 were `""` vs `null`, scored candidate_only — a
  // disagreement reported where both sides said "not found".
  for (const sentinel of ['', 'null', 'N/A', 'n/a', '—', '   ']) {
    assert.equal(compareField(GRADED_FIELDS[0], sentinel, null), 'both_null',
      `${JSON.stringify(sentinel)} must normalize to null`);
    assert.equal(compareField(GRADED_FIELDS[0], null, sentinel), 'both_null',
      `${JSON.stringify(sentinel)} must normalize to null on the candidate side too`);
  }
  assert.equal(isNullSentinel(undefined), true);
});

test('the sentinel list is NARROW — a real value is never nulled, and 0 is a value', () => {
  // Widening isNullSentinel is how a genuine miss gets hidden as both_null.
  assert.equal(isNullSentinel(0), false, '0 is a value, not "no value"');
  assert.equal(isNullSentinel('NNN'), false);
  assert.equal(isNullSentinel('Nullarbor Holdings LLC'), false, 'a name CONTAINING null is a name');
  assert.equal(isNullSentinel('N/A Property Group'), false);
  assert.equal(normalizeField('number', 0), 0);
});

test('a number normalizes past $ , and a trailing SF unit, and rounds without toleranceing', () => {
  assert.equal(normalizeField('number', '14,250 sf'), 14250);
  assert.equal(normalizeField('number', '$412,500'), 412500);
  assert.equal(normalizeField('number', 412500.4), 412500, 'one rent read two ways');
  // Rounding must NOT become a tolerance. This is the OCR digit error the whole
  // bake-off exists to catch.
  assert.equal(compareField(GRADED_FIELDS[3], 412500, 412600), 'disagree');
  assert.equal(compareField(GRADED_FIELDS[4], '14,250 sf', 14250), 'agree');
});

test('normalizePunctuation collapses whitespace runs and trims', () => {
  assert.equal(normalizePunctuation('  Acme \n  Medical\t'), 'Acme Medical');
});

// --- 6. the self-agreement floor -------------------------------------------

test('summarizeSelfControl folds every non-agree verdict into self_disagree', () => {
  // Run 2 finding a value run 1 did not is the model failing to agree with
  // ITSELF — not a "win" for anybody. candidate_only/baseline_only must count
  // against the floor, or the floor reads higher than the truth.
  const s = summarizeSelfControl([
    scoreDocument(T(), T({ year1_rent: null })),          // baseline_only
    scoreDocument(T({ sf: null }), T()),                  // candidate_only
    scoreDocument(T(), T({ lease_type: 'Gross' })),       // disagree
  ]);
  assert.equal(s.per_field.year1_rent.self_disagree, 1);
  assert.equal(s.per_field.leased_sf.self_disagree, 1);
  assert.equal(s.per_field.lease_type.self_disagree, 1);
  assert.equal(s.overall.self_agree, 15);
  assert.equal(s.overall.self_disagree, 3);
  assert.equal(s.overall.self_rate, 15 / 18);
});

test('the floor excludes both_null on the SAME rule as the engines, or the two are not comparable', () => {
  const s = summarizeSelfControl([scoreDocument(
    T({ year1_rent: null, sf: null }), T({ year1_rent: null, sf: null }),
  )]);
  assert.equal(s.per_field.year1_rent.self_both_null, 1);
  assert.equal(s.per_field.year1_rent.self_rate, null,
    'a field neither run decided has NO floor and must read null, not 1.0');
  assert.equal(s.overall.self_both_null, 2);
  assert.equal(s.overall.self_rate, 1);
});

test('summarizeSelfControl over no controlled documents reports null, not a perfect floor', () => {
  const s = summarizeSelfControl([]);
  assert.equal(s.documents, 0);
  assert.equal(s.overall.self_rate, null, 'an unrun control must never render as a 100% floor');
  assert.equal(summarizeSelfControl([null, null]).documents, 0);
});

test('deltaVsSelf returns null — never 0 — when there is no floor to read against', () => {
  // 0 reads as "at parity with the model". The truth is "not measured" (P180).
  assert.equal(deltaVsSelf(0.77, null), null);
  assert.equal(deltaVsSelf(null, 0.9), null);
  assert.equal(deltaVsSelf(0.77, 0.77), 0);
  // The number this whole prompt exists for: 77% against an 80% floor is not a loss.
  assert.equal(deltaVsSelf(0.77, 0.80), -3);
  assert.equal(deltaVsSelf(1, 0.8), 20);
});

test('the harness runs the control as TWO independent calls, not a pinned seed', () => {
  // temperature=0 would report a floor the real pipeline never has.
  const src = stripComments(HARNESS_SRC);
  const i = src.indexOf("control === 'self'");
  assert.ok(i > 0, "the control branch must exist and be keyed on control === 'self'");
  const branch = src.slice(i, i + 600);
  assert.ok(/extractFrom\(btext, bpages, invoke, extractTenantFromLease\)/.test(branch),
    'the control must call the SAME consumer with the SAME model on the SAME baseline text');
  // ⚠️ Blank string literals first — the RENDERED REPORT says "deliberately NOT
  // `temperature=0`" in a push()ed string, which a comment-only strip reads as
  // the very pinning it forbids.
  // ⚠️ ORDER IS LOAD-BEARING: comments FIRST, then literals. An apostrophe in
  // ordinary prose ("the engine's output") opens a fake string for the blanker
  // and swallows real code after it — which is exactly how the positive-control
  // mutation for this assertion first survived.
  const code = blankStringLiterals(stripComments(HARNESS_SRC));
  assert.ok(!/\btemperature\s*[:=]/i.test(code),
    'no seed/temperature pinning anywhere in CODE — that would fake the floor');
});

test('the report refuses to present an engine rate without saying the floor is missing', () => {
  const src = stripComments(HARNESS_SRC);
  const i = src.indexOf("rep.control_mode !== 'self'");
  assert.ok(i > 0, 'renderReport must branch on whether the control ran');
  assert.ok(/NOT RUN/.test(src.slice(i, i + 500)),
    'a report with no control must say so rather than printing a bare rate');
});

// --- 7. failure reporting ---------------------------------------------------

test('stderrTail shows the END of stderr, where the cause is', () => {
  // MEASURED: all 36 first-run failures printed the same
  // `RequestsDependencyWarning` first line and hid both real causes.
  const noisy = 'RequestsDependencyWarning: urllib3 v2 only supports OpenSSL. '.repeat(20)
    + "ModuleNotFoundError: No module named 'paddle'";
  const tail = stderrTail(noisy);
  assert.ok(tail.includes("No module named 'paddle'"), 'the cause must survive truncation');
  assert.ok(!tail.startsWith('RequestsDependencyWarning'), 'the warning must NOT be what is shown');
  assert.ok(tail.length <= 301);
  assert.equal(stderrTail('short cause'), 'short cause', 'short stderr is shown whole, unmarked');
  assert.equal(stderrTail(''), '');
  assert.equal(stderrTail(null), '');
});

test('no engine failure reason truncates stderr from the FRONT', () => {
  const src = stripComments(HARNESS_SRC);
  const bad = src.match(/stderr[^;\n]*\.slice\(0,\s*\d+\)/g) || [];
  assert.deepEqual(bad, [], `these show the warning instead of the cause: ${bad.join(' | ')}`);
});

test('a paddleocr wrapper without the paddle runtime is NOT available, and says the fix', () => {
  // MEASURED: `paddleocr --version` succeeded and all 18 documents failed,
  // because `pip install paddleocr` installs only the wrapper.
  const v = classifyEngineAvailability('paddleocr', { binaryPresent: true, paddleRuntime: false });
  assert.equal(v.available, false);
  assert.match(v.note, /paddlepaddle/, 'the note must name the pip package that fixes it');
  assert.equal(
    classifyEngineAvailability('paddleocr', { binaryPresent: true, paddleRuntime: true }).available,
    true,
  );
});

test('"could not check the paddle runtime" is not "it is missing"', () => {
  // tri-state: null means no python on PATH; reading it as false would call a
  // working engine broken.
  const v = classifyEngineAvailability('paddleocr', { binaryPresent: true, paddleRuntime: null });
  assert.equal(v.available, true, 'unverified must stay runnable');
  assert.match(v.note, /UNVERIFIED/i);
});

test('surya that needs a Docker VLM server is skipped when Docker is down, kept when it is up', () => {
  const down = classifyEngineAvailability('surya', {
    binaryPresent: true, suryaNeedsServer: true, dockerReachable: false,
  });
  assert.equal(down.available, false, '18 identical failures is not a measurement');
  assert.match(down.note, /Docker/);
  assert.match(down.note, /GPU box/, 'the note must say where it is meant to run');
  assert.equal(classifyEngineAvailability('surya', {
    binaryPresent: true, suryaNeedsServer: true, dockerReachable: true,
  }).available, true, 'the GPU box must still be able to run it');
});

test('a missing binary and a missing rasterizer are different notes, both unavailable', () => {
  assert.deepEqual(classifyEngineAvailability('tesseract', { binaryPresent: false }),
    { available: false, note: 'not installed' });
  const noRaster = classifyEngineAvailability('tesseract', { binaryPresent: true, rasterizerPresent: false });
  assert.equal(noRaster.available, false);
  assert.match(noRaster.note, /pdftoppm/);
  assert.deepEqual(classifyEngineAvailability('tesseract', { binaryPresent: true, rasterizerPresent: true }),
    { available: true, note: null });
});

test('--self-test names the fix for a missing Pillow instead of only the failure', () => {
  const src = stripComments(HARNESS_SRC);
  assert.ok(/No module named/.test(src), 'the fixture failure must be classified, not just reported');
  assert.ok(/pip install pillow/.test(src), 'the fix must be printed, not left in a traceback');
  assert.ok(/FIX:/.test(src), 'the fix must be labelled so an operator sees it');
});

// --- 8. arm B must carry values, not only a count ---------------------------

test('arm B records the field VALUES so a 5/6 count can actually be read', () => {
  const src = stripComments(HARNESS_SRC);
  assert.ok(/entry\.graded_values\s*=/.test(src),
    'every candidate must carry the six graded values into agreement.json');
  assert.ok(/entry\.fields_found\s*=/.test(src));
  assert.ok(/Field values as read/.test(src),
    'the report must render the values — a count of found fields is not readable');
  // and the count must use the sentinel rule, or "N/A" reads as a found field.
  assert.ok(/fields_found = GRADED_FIELDS\.filter\(\(f\) => !isNullSentinel/.test(src),
    'a sentinel like "N/A" must not count as a field found');
});
