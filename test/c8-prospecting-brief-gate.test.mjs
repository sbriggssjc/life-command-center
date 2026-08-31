// C8 — the prospecting brief must admit RESOLVED OWNERS, not just labelled ones.
//
// `handleProspectingBrief` (api/operations.js) is the operator call sheet. It
// gated on `owner_role IN (developer,user_owner,buyer,seller_flipper,operator)`
// with a comment correctly stating the intent ("brokers and unclassified
// intermediaries must be excluded") — and `owner_role` is the wrong instrument
// for that intent. `unknown` covers 93.9% of entities and is not in the
// vocabulary at all, so the role list excluded the book to exclude the brokers:
// measured live over the 311 eligible cadence rows, it showed 80 ($442.8M) and
// hid 231, of which 47 are RESOLVED PROPERTY OWNERS carrying $515.2M against
// only 3 brokerages. Easterly Gov Properties ($114.9M / 85 properties) — the
// single largest owner in the system — was not on the call sheet.
//
// The fix is C6's rule on a second surface (Dead-End playbook Class 24): admit
// on the PER-ASSET FACT the system already holds, not on the party-level label.
//
// GUARD DESIGN
// - It slices `handleProspectingBrief` on a STABLE STRUCTURAL BOUNDARY (the
//   function declaration to the next top-level declaration), never on a line
//   number or a moving literal — the CLAUDE.md block-slice footgun.
// - It STRIPS COMMENTS FIRST. The fix's own comments quote the defect they
//   removed ("NOT as owner_role.in.(...)", "owner_role='unknown'"), so a naive
//   grep would pass over a reverted gate — the A1 prose-detector defect, and
//   the A5c variant where a file's own explanation satisfied the assertion.
// - It asserts the anchors exist, so no rule can go vacuously true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(new URL('../api/operations.js', import.meta.url)), 'utf8');

// Strip block comments and whole-line `//` comments. Deliberately does NOT
// strip trailing `//` comments, because that would also eat the `//` in any
// `https://` URL inside a string literal and mangle real code.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
}

// Slice the handler on a structural boundary: its own declaration through the
// next top-level `function` / `async function` at column 0.
function handlerBody(src) {
  const start = src.indexOf('async function handleProspectingBrief(');
  assert.notEqual(start, -1, 'anchor missing: handleProspectingBrief declaration');
  const rest = src.slice(start + 1);
  const m = rest.match(/\n(?:async )?function \w+\s*\(/);
  assert.ok(m, 'anchor missing: no following top-level function to bound the slice');
  return rest.slice(0, m.index);
}

const BODY = handlerBody(SRC);
const CODE = stripComments(BODY);

// The PostgREST path string the handler builds for the primary queue read.
function gateSource(code) {
  const i = code.indexOf('v_bd_cadence_dashboard');
  assert.notEqual(i, -1, 'anchor missing: the handler no longer reads v_bd_cadence_dashboard');
  return code;
}

test('the guard can see real code, not just prose (positive control)', () => {
  assert.ok(BODY.length > CODE.length, 'stripComments removed nothing — the slice has no comments?');
  assert.ok(CODE.includes('v_bd_cadence_dashboard'), 'slice lost the queue read');
  assert.ok(CODE.includes('BD_OWNER_ROLES'), 'slice lost the role constant');
  // The comments DO mention the removed construct; the stripped code must not.
  assert.ok(BODY.includes('owner_role.in.('),
    'expected the explanatory comment to quote the rejected in.() form');
});

test('the gate admits resolved property owners, not only labelled roles', () => {
  const code = gateSource(CODE);
  assert.ok(code.includes('is_resolved_owner'),
    'C8 REGRESSION: the prospecting brief gates on owner_role alone again. '
    + 'That hides every resolved owner whose role is `unknown` — 47 owners / '
    + '$515.2M when measured, Easterly Gov Properties among them.');
  assert.ok(/or=\([^)]*is_resolved_owner\.is\.true/.test(code),
    'the resolved-owner test must be an OR alternative to the role list, not an AND');
});

test('the brokerage guard is explicit and applies to BOTH arms', () => {
  const code = gateSource(CODE);
  assert.ok(code.includes('is_brokerage=is.false'),
    'C8 REGRESSION: the brokerage guard is gone. Once the gate admits resolved '
    + 'owners it can no longer rely on `owner_role` accidentally excluding '
    + 'brokers — the guard has to be stated.');
  // It must sit OUTSIDE the or=(...) group, i.e. be ANDed across both arms.
  // Inside the group it would merely be a third way to be admitted.
  const orGroup = code.match(/or=\(([^)]*)\)/);
  assert.ok(orGroup, 'expected an or=(...) group in the gate');
  assert.ok(!orGroup[1].includes('is_brokerage'),
    'is_brokerage must be ANDed across both arms, not an OR alternative — '
    + 'inside the group it admits brokerages instead of excluding them');
});

test('the role arm avoids the untested in.() -inside- or=() construct', () => {
  const code = gateSource(CODE);
  const orGroup = code.match(/or=\(([^)]*)\)/);
  assert.ok(orGroup, 'expected an or=(...) group in the gate');
  assert.ok(!orGroup[1].includes('.in.('),
    'a comma-separated in.() list nested inside an or=() group (whose own '
    + 'separator is a comma) is not exercised anywhere else in api/, and a 400 '
    + 'here does NOT raise: !queueResult.ok is treated as "queue empty" and '
    + 'falls through to the dead fallback, so a mis-parse would read as the '
    + 'calm sentence "No BD contacts found." Spell the roles as eq alternatives.');
  // ⚠️ Asserting `code.includes('BD_OWNER_ROLES')` here is NOT a guard: the
  // constant's own declaration satisfies it, so hard-coding the roles into the
  // gate and never reading the constant walks straight through (verified — that
  // mutation passed the first cut of this test). Assert on the GATE'S OWN
  // CONTENT instead: the role arm must be interpolated, never literal roles.
  // Same family as the N15c inline-copy guard defeated by a local variable.
  assert.ok(!/owner_role\.eq\.[a-z]/.test(orGroup[1]),
    'the role arm must be interpolated from BD_OWNER_ROLES, not hard-coded into '
    + 'the query string — a second copy of the role list is the drift this '
    + 'codebase keeps paying for');
  assert.ok(/\$\{\w+\}/.test(orGroup[1]),
    'expected the role arm to be a template interpolation of the derived list');
  assert.ok(/BD_OWNER_ROLES\s*\n?\s*\.split\(/.test(code)
         || /split\([^)]*\)[\s\S]{0,120}owner_role\.eq\./.test(code),
    'the interpolated role arm must be built by splitting BD_OWNER_ROLES');
});

test('the gate stays in the SELECTION, never a post-read JS filter', () => {
  // Filtering after the read would leave the server-side ranked head full of
  // rows nobody can work while the valuable tail below is never reached (A5c).
  const badFilter = /\.filter\([^)]*\b(owner_role|is_resolved_owner|is_brokerage)\b/;
  assert.ok(!badFilter.test(CODE),
    'the BD-target gate must be pushed into the PostgREST query so that '
    + 'order=rank_value.desc & limit=N stay server-side');
});
