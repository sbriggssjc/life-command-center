// ============================================================================
// PR5c-entities — the `entities` ladder had 13 rungs and no caller (2026-09-02)
//
// Measured live on LCC Opps (xengecqvemvfknjvbvrq): 13 field_source_priority
// rungs on `entities` (email 5, phone 5, canonical_name 2, name 1) and
// `field_provenance` rows for that table = ZERO. Positive control:
// dia.properties, 49,571 rows. lcc_merge_field ALWAYS inserts a row -- write,
// skip AND conflict -- so a zero there means the RPC was never called, not that
// it decided against writing (PR5c). The rung's own PR5 note said it plainly:
// "Referenced only in a comment (owner-contact-propagate.js:37)".
//
// WHY EACH ASSERTION IS SHAPED THE WAY IT IS:
//
//  1. BEHAVIOUR OVER MENTION. OCR2 shipped two guards that passed their own
//     mutation because the source still MENTIONED the identifier -- on the
//     import line. So the contact-writeback half INVOKES gateLadderFields with a
//     stub and asserts on what comes back; the owner-contact-propagate half
//     parses applyFill's AST span and requires a CallExpression inside it plus
//     the PATCH argument being the binding that call produced. Neither is
//     satisfied by an import.
//  2. AST SPANS, NEVER CHARACTER WINDOWS. A fixed `source[start:start+N]` slice
//     fails in both directions -- undershoot goes red over correct code,
//     overshoot passes on code it never named (27 of them, 21/6/0, in the
//     Dialysis repo). Spans come from acorn.
//  3. BYTE-FOR-BYTE SPELLING. The rung lookup keys on
//     (target_table, field_name, source) with no normalisation, so 'lcc.entities'
//     or 'domain_owner_contacts' silently produces new_priority=NULL and the
//     unregistered BRANCH -- which still writes a row, so nothing errors and the
//     ladder is simply not consulted. The literals are asserted against the
//     values read from the live registry.
//  4. SCOPE IS ASSERTED, NOT ASSUMED. address/city/state/zip/metadata have NO
//     entities rung; routing them through lcc_merge_field would mint provenance
//     for unregistered triples and push them onto v_field_provenance_unranked.
//     A test pins that they pass through untouched (backlog PR5a owns whether
//     they should be registered at all).
//  5. COMMENTS STRIPPED FIRST. Both files' new comments quote every literal
//     under test while explaining it, so a raw-source grep finds them all
//     present and passes over a complete revert (A5c / N18 / B1 / PR8).
//  6. POSITIVE / POPULATION CONTROL. The stripper is asserted to actually
//     remove a comment, and each scanned span is asserted non-empty, so the
//     walker cannot silently stop finding code and pass vacuously (P182).
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';

import {
  gateLadderFields,
  LADDER_GOVERNED_FIELDS,
} from '../api/_handlers/contact-writeback.js';
import { PROVENANCE_TARGET_DATABASES } from '../api/_shared/field-priority-guard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OCP = join(ROOT, 'api/_handlers/owner-contact-propagate.js');
const CWB = join(ROOT, 'api/_handlers/contact-writeback.js');

// The registry's own spelling, read from the live rows 2026-09-02. A mismatch
// here is invisible at runtime: the lookup just misses and the write lands on
// the unregistered branch.
const REGISTRY_TARGET_TABLE = 'entities';
const REGISTRY_SOURCES = { ocp: 'domain_owner_contact', cwb: 'salesforce' };
const REGISTRY_GOVERNED_FIELDS = ['email', 'phone'];

// --------------------------------------------------------------------------
// comment stripper (blanks comments, PRESERVES string literals and offsets)
// --------------------------------------------------------------------------
function stripComments(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n' ? '\n' : ' '); i++; }
      out += '  '; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function parse(file) {
  const src = stripComments(readFileSync(file, 'utf8'));
  return { src, ast: acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' }) };
}

/** Every node in the tree, depth-first. */
function* nodes(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) yield* nodes(c); }
    else if (v && typeof v.type === 'string') yield* nodes(v);
  }
}

/** The AST span of a named function declaration (note 2 — never a char window). */
function fnSpan(ast, name) {
  for (const n of nodes(ast)) {
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression')
        && n.id && n.id.name === name) return n;
    if (n.type === 'VariableDeclarator' && n.id?.name === name
        && (n.init?.type === 'ArrowFunctionExpression' || n.init?.type === 'FunctionExpression')) return n.init;
  }
  return null;
}

const calleeName = (n) =>
  n.callee?.type === 'Identifier' ? n.callee.name
  : n.callee?.type === 'MemberExpression' && n.callee.property?.type === 'Identifier'
    ? n.callee.property.name : null;

/** Object-literal property value for `key`, if it is a plain string literal. */
function literalProp(objNode, key) {
  if (objNode?.type !== 'ObjectExpression') return undefined;
  for (const p of objNode.properties) {
    if (p.type !== 'Property') continue;
    const k = p.key.type === 'Identifier' ? p.key.name : p.key.value;
    if (k !== key) continue;
    if (p.value.type === 'Literal') return p.value.value;
    return { __ident: p.value.type === 'Identifier' ? p.value.name : null };
  }
  return undefined;
}

/** Resolve a module-level `const X = 'lit'` / `const X = f('lit')`. */
function constInit(ast, name) {
  for (const n of nodes(ast)) {
    if (n.type !== 'VariableDeclarator' || n.id?.name !== name) continue;
    if (n.init?.type === 'Literal') return { kind: 'literal', value: n.init.value };
    if (n.init?.type === 'CallExpression') {
      return { kind: 'call', fn: calleeName(n.init),
               arg: n.init.arguments[0]?.type === 'Literal' ? n.init.arguments[0].value : null };
    }
  }
  return null;
}

// ==========================================================================
// 0. the instrument itself
// ==========================================================================

test('positive control: the stripper removes comments and keeps string literals', () => {
  const s = stripComments(`const a = 'domain_owner_contact'; // domain_owner_contact\n/* domain_owner_contact */`);
  assert.ok(s.includes("'domain_owner_contact'"), 'string literal must survive');
  assert.equal((s.match(/domain_owner_contact/g) || []).length, 1,
    'the two commented copies must be blanked — otherwise every assertion below can be satisfied by prose');
});

test('population control: both writers parse and both target functions are found', () => {
  for (const [file, fn] of [[OCP, 'applyFill'], [CWB, 'gateLadderFields']]) {
    const { ast } = parse(file);
    const span = fnSpan(ast, fn);
    assert.ok(span, `${fn} not found in ${file} — the walker stopped finding code`);
    assert.ok(span.end - span.start > 200, `${fn} span implausibly small`);
  }
});

// ==========================================================================
// 1. owner-contact-propagate — AST, not mention
// ==========================================================================

test('applyFill CALLS filterByFieldPriority (an import is not a call)', () => {
  const { ast } = parse(OCP);
  const span = fnSpan(ast, 'applyFill');
  const calls = [...nodes(span)].filter(n => n.type === 'CallExpression'
    && calleeName(n) === 'filterByFieldPriority');
  assert.equal(calls.length, 1,
    'applyFill must consult the ladder exactly once — 0 means the rung is a comment again');
});

test('applyFill PATCHes the gated result, never the ungated plan', () => {
  const { ast } = parse(OCP);
  const span = fnSpan(ast, 'applyFill');

  // the identifier the filter result is bound to
  let gatedName = null;
  for (const n of nodes(span)) {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier') {
      const hasFilter = [...nodes(n.init)].some(x => x.type === 'CallExpression'
        && calleeName(x) === 'filterByFieldPriority');
      if (hasFilter) gatedName = n.id.name;
    }
  }
  assert.ok(gatedName, 'the filter result must be bound to a variable');

  const patchCalls = [...nodes(span)].filter(n => n.type === 'CallExpression'
    && calleeName(n) === 'opsQuery'
    && n.arguments[0]?.type === 'Literal' && n.arguments[0].value === 'PATCH');
  assert.equal(patchCalls.length, 1, 'exactly one entity PATCH expected in applyFill');
  const body = patchCalls[0].arguments[2];
  assert.equal(body?.type, 'Identifier');
  assert.equal(body.name, gatedName,
    `the PATCH body must be the gated patch (${gatedName}), not the pre-gate plan`);
});

test('applyFill ledgers what was WRITTEN, not what was planned', () => {
  const { ast, src } = parse(OCP);
  const span = fnSpan(ast, 'applyFill');
  const text = src.slice(span.start, span.end);
  assert.ok(/const\s+ledger\s*=\s*Object\.keys\(gated\)/.test(text),
    'the ledger must be built from the gated patch — otherwise a blocked field reads as filled');
  assert.ok(/new_value:\s*gated\[f\]/.test(text), 'ledger new_value must come from the gated patch');
});

// ==========================================================================
// 2. spelling — a miss is silent, so it is pinned against the live registry
// ==========================================================================

test('owner-contact-propagate uses the registry spelling byte-for-byte', () => {
  const { ast } = parse(OCP);
  assert.deepEqual(constInit(ast, 'PROVENANCE_TARGET_TABLE'),
    { kind: 'literal', value: REGISTRY_TARGET_TABLE });
  assert.deepEqual(constInit(ast, 'PROVENANCE_SOURCE'),
    { kind: 'literal', value: REGISTRY_SOURCES.ocp });
  const db = constInit(ast, 'PROVENANCE_TARGET_DB');
  assert.equal(db.kind, 'call');
  assert.equal(db.fn, 'provenanceTargetDatabase', 'the vocabulary has ONE owner (PR5c)');
  assert.ok(PROVENANCE_TARGET_DATABASES.includes(db.arg) || db.arg === 'lcc',
    `provenanceTargetDatabase(${JSON.stringify(db.arg)}) must canonicalise into the CHECK vocabulary`);
});

test('contact-writeback uses the registry spelling byte-for-byte', () => {
  const { ast } = parse(CWB);
  assert.deepEqual(constInit(ast, 'PROVENANCE_TARGET_TABLE'),
    { kind: 'literal', value: REGISTRY_TARGET_TABLE });
  assert.deepEqual(constInit(ast, 'PROVENANCE_SOURCE'),
    { kind: 'literal', value: REGISTRY_SOURCES.cwb });
  const db = constInit(ast, 'PROVENANCE_TARGET_DB');
  assert.equal(db.fn, 'provenanceTargetDatabase');
});

test('neither writer JSON.stringify()s the jsonb value (PR5c note 7)', () => {
  for (const f of [OCP, CWB]) {
    const { src } = parse(f);
    assert.ok(!/JSON\.stringify\s*\([^)]*\b(value|fields|patch|gated)\b/.test(src),
      `${f}: p_value is a jsonb PARAM — stringifying double-encodes it to '"\\"x\\""'::jsonb`);
  }
});

// ==========================================================================
// 3. contact-writeback — behavioural, through the deps seam
// ==========================================================================

const PLAN = () => ({
  changed: true,
  patch: {
    email: 'a@b.com', phone: '918-555-0100',
    address: '1 Main St', city: 'Tulsa', state: 'OK', zip: '74103',
    metadata: { company: 'Acme', field_sources: { email: 'salesforce', phone: 'salesforce', address: 'salesforce' } },
  },
  fieldSources: { email: 'salesforce', phone: 'salesforce', address: 'salesforce' },
});

test('only email/phone are ladder-governed; the rest pass through untouched', async () => {
  let seen = null;
  const out = await gateLadderFields('E1', PLAN(), 'run1', {
    filterByFieldPriority: async (a) => { seen = a; return a.fields; },
  });
  assert.deepEqual(Object.keys(seen.fields).sort(), REGISTRY_GOVERNED_FIELDS,
    'address/city/state/zip/metadata have NO entities rung — sending them mints unregistered provenance (PR5a)');
  assert.deepEqual(LADDER_GOVERNED_FIELDS, REGISTRY_GOVERNED_FIELDS);
  for (const k of ['address', 'city', 'state', 'zip']) assert.equal(out[k], PLAN().patch[k]);
  assert.deepEqual(out.metadata, PLAN().patch.metadata, 'metadata must be byte-identical when nothing is dropped');
});

test('the gate is handed the registry spelling and a legal target_database', async () => {
  let seen = null;
  await gateLadderFields('E1', PLAN(), 'run1', {
    filterByFieldPriority: async (a) => { seen = a; return a.fields; },
  });
  assert.equal(seen.targetTable, REGISTRY_TARGET_TABLE);
  assert.equal(seen.source, REGISTRY_SOURCES.cwb);
  assert.equal(seen.recordPk, 'E1');
  assert.ok(PROVENANCE_TARGET_DATABASES.includes(seen.targetDb),
    `target_database ${seen.targetDb} is outside the CHECK vocabulary — 23514 on every call`);
});

test('a dropped field also loses its metadata.field_sources stamp', async () => {
  const out = await gateLadderFields('E1', PLAN(), 'run1', {
    filterByFieldPriority: async (a) => { const { email, ...rest } = a.fields; return rest; },
  });
  assert.ok(!('email' in out), 'a blocked field must not reach the PATCH');
  assert.equal(out.phone, '918-555-0100', 'an allowed sibling must still be written');
  assert.equal(out.metadata.field_sources.email, undefined,
    'the in-metadata ledger must not claim salesforce wrote a value it was blocked from writing');
  assert.equal(out.metadata.field_sources.phone, 'salesforce', 'the surviving stamp must remain');
  assert.equal(out.metadata.company, 'Acme', 'unrelated metadata must be preserved');
});

test('fails OPEN on a registry outage — a curated promotion is never lost', async () => {
  const out = await gateLadderFields('E1', PLAN(), 'run1', {
    filterByFieldPriority: async () => { throw new Error('rpc down'); },
  });
  assert.equal(out.email, 'a@b.com');
  assert.equal(out.phone, '918-555-0100');
});

test('a patch with no governed field is returned byte-identically, un-gated', async () => {
  let called = false;
  const plan = { changed: true, patch: { city: 'Tulsa' }, fieldSources: { city: 'salesforce' } };
  const out = await gateLadderFields('E1', plan, 'run1', {
    filterByFieldPriority: async () => { called = true; return {}; },
  });
  assert.equal(called, false, 'no governed field ⇒ no RPC, no unregistered provenance row');
  assert.deepEqual(out, { city: 'Tulsa' });
});

test('an all-dropped, metadata-only patch sends nothing rather than an empty-effect PATCH', async () => {
  const plan = {
    changed: true,
    patch: { email: 'a@b.com', metadata: { field_sources: { email: 'salesforce' } } },
    fieldSources: { email: 'salesforce' },
  };
  const out = await gateLadderFields('E1', plan, 'run1', {
    filterByFieldPriority: async () => ({}),
  });
  assert.deepEqual(out, {});
});
