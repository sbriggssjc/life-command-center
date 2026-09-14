// C11 — the call sheet names a person; it must say WHY they are the contact.
//
// C10 made the sheet legible (real owner names, real portfolio values). It did
// NOT make the contact justified: the operator got a name and a dollar figure
// and no basis for either, and now that the sheet is legible it will
// confidently name a person at the wrong firm.
//
// The basis was already recorded and simply never read. Measured live
// 2026-08-31 over the 126 eligible rows: 121 carry an owner->contact
// `entity_relationships` edge whose role is on file —
//   prospecting_contact 58 · institution_decision_maker 35 · manager 15 ·
//   works_at 12 · decision_maker 1 — and 5 carry no edge at all.
//
// GUARD DESIGN
// ------------
// Mostly BEHAVIOURAL: it compiles the REAL map + renderer out of
// api/operations.js and asserts on what they emit, rather than grepping for a
// literal that moves (CLAUDE.md block-slice footgun). Two invariants are
// structural because they are statements about what the code must NOT do, and
// an absence cannot be observed from one row's output.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING, and that is load-bearing: the fix's
// own comments say "works_at", "association only" and "no relationship on file"
// repeatedly while explaining the hazard, so a detector reading raw source
// would find every token present and pass straight over a real regression
// (the A5c / N18 lesson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(new URL('../api/operations.js', import.meta.url)), 'utf8');

function stripComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// Slice between STABLE identity tokens, never a line number.
function between(src, a, b, label) {
  const i = src.indexOf(a);
  assert.notEqual(i, -1, `${label}: start anchor missing — "${a}". Re-anchor this ` +
    'guard rather than deleting it.');
  const j = src.indexOf(b, i + a.length);
  assert.notEqual(j, -1, `${label}: end anchor missing — "${b}"`);
  return src.slice(i + a.length, j);
}

const CLEAN       = stripComments(SRC);
const MAP_BODY    = between(CLEAN, 'contacts = queueResult.data.map(c => ({', '}));', 'lcc_queue map');
const RENDER_BODY = between(CLEAN, '? contacts.map((c, i) => {', "}).join('\\n\\n')", 'lcc_queue renderer');
const PROMPT_BODY = between(CLEAN, 'const prompt = source === \'lcc_queue\'', ': `Generate a concise daily prospecting call sheet', 'lcc_queue prompt');

// Compile the shipping map + renderer and run one synthetic view row through
// them. This is the behaviour the operator sees, not a description of it.
const mapFn    = new Function('c', `return ({${MAP_BODY}});`);
const renderFn = new Function('c', 'i', RENDER_BODY);

const BASE_ROW = {
  entity_name: 'Acme Holdings', owner_role: 'buyer', domain: 'gov',
  contact_email: 'a@acmeholdings.com', contact_id: 'x',
  rank_value: '1000000', rank_property_count: 2, days_overdue: 7,
  next_touch_type: 'email', review_flag: false, phase: 'prospecting',
  contact_owner_role: 'institution_decision_maker',
  contact_domain_confirms_owner: false,
};
const draw = over => renderFn(mapFn({ ...BASE_ROW, ...over }), 0);

test('C11: a recorded role is stated on the sheet, verbatim', () => {
  const out = draw({ contact_owner_role: 'institution_decision_maker' });
  assert.match(out, /institution_decision_maker/,
    'the call sheet must state the role recorded on the owner->contact edge — ' +
    'naming a person with no basis is the whole defect C11 exists to fix.');
});

test('C11: the role vocabulary is NOT closed — an unexpected token reaches the operator', () => {
  // Fleet-wide the edge roles include `MGR`, `broker_of_record` and
  // `economic_owner_contact`. A renderer that maps a fixed allowlist and falls
  // back to a friendly default would swallow exactly the tokens worth seeing —
  // a `broker_of_record` on a BD call sheet IS the signal.
  for (const token of ['broker_of_record', 'MGR', 'economic_owner_contact', 'some_future_role']) {
    assert.match(draw({ contact_owner_role: token }), new RegExp(token),
      `the renderer dropped the edge role "${token}". Roles are printed ` +
      'verbatim; do not introduce an allowlist with a friendly fallback.');
  }
});

test('C11: `works_at` is marked association-only and does not read like an authority role', () => {
  // `works_at` is the Salesforce org edge P161 MEASURED AND DISQUALIFIED as
  // evidence of control. It proves association, never authority. It is not a
  // corner case: 12 of the 126 eligible rows, carrying $130.7M — more rank
  // value than the 35 `institution_decision_maker` rows — and 3 of the current
  // top 10 by portfolio value.
  const weak   = draw({ contact_owner_role: 'works_at' });
  const strong = draw({ contact_owner_role: 'decision_maker' });

  assert.match(weak, /association only/i,
    '`works_at` must be flagged as association only — P161 measured it as ' +
    'proof of association, never of control.');
  assert.doesNotMatch(strong, /association only/i,
    'only the weak-association role may carry the association-only warning; ' +
    'applying it to every role makes it invisible.');
});

test('C11: no edge on file is stated as such, never as an empty or absent role', () => {
  const out = draw({ contact_owner_role: null });
  assert.match(out, /no relationship on file/i,
    'a null edge role must say "no relationship on file" — a different fact ' +
    'from a weak role, and rendering it as "" reads as "no role" (P180).');
  // The label must not collapse into the blank the row would otherwise show.
  assert.doesNotMatch(out, /Contact basis:\s*(\||$)/m,
    'the contact-basis line must never render blank.');
});

test('C11: employer corroboration is ADDITIVE POSITIVE ONLY', () => {
  // P188 established the asymmetry on named rows: a real employee can use a
  // personal address — Easterly's own confirmed contact sits on
  // @centurytel.net. `false` means "we hold no corroboration", NEVER "wrong
  // person". Rendering the negative would turn a lower bound into an accusation.
  const yes = draw({ contact_domain_confirms_owner: true });
  const no  = draw({ contact_domain_confirms_owner: false });
  const na  = draw({ contact_domain_confirms_owner: null });

  assert.match(yes, /corroborated/i, 'a true corroboration must be surfaced.');
  for (const [label, out] of [['false', no], ['null', na]]) {
    assert.doesNotMatch(out, /corroborat/i,
      `a ${label} corroboration must render NOTHING. Any "not corroborated" / ` +
      '"unverified employer" wording asserts doubt the signal cannot support (P188).');
  }
});

test('C11: nothing filters, ranks or gates on the corroboration signal', () => {
  // Structural, because this is an absence. C8 has just finished undoing
  // exactly this mistake on this surface (Class 24): excluding real owners
  // because a LABEL is missing rather than a FACT being false. 22 of the 113
  // eligible rows carrying an email are corroborated — a LOWER BOUND, not a
  // claim that the other 91 are wrong.
  const flag = 'contact_domain_confirms_owner';
  assert.ok(!new RegExp(`${flag}[^\\n]*(is\\.true|eq\\.true|=is\\.)`).test(CLEAN),
    `${flag} must never appear in a PostgREST filter — it is evidence, not a gate.`);
  for (const region of [MAP_BODY, RENDER_BODY]) {
    assert.ok(!/\.filter\(|\.sort\(/.test(region),
      'the call sheet must not filter or re-sort on the client: the gate and the ' +
      'ordering live in the SELECTION (A5c), and demoting on corroboration would ' +
      'drop real owners on a lower bound.');
  }
});

test('C11: the prompt bounds what the model may claim from a weak or absent basis', () => {
  // A legible sheet plus an unbounded model is how "association only" becomes
  // "the decision-maker" in prose.
  assert.match(PROMPT_BODY, /association only/i,
    'the prompt must tell the model what "association only" permits, or the ' +
    'model will restate a Salesforce org edge as authority.');
  assert.match(PROMPT_BODY, /no relationship on file/i,
    'the prompt must tell the model how to treat an unverified link.');
  assert.match(PROMPT_BODY, /absence[^.]*never|never[^.]*wrong firm|do not cast doubt/i,
    'the prompt must state that MISSING corroboration is not evidence against ' +
    'the contact (P188), or the model will hedge on 91 of 113 rows.');
});
