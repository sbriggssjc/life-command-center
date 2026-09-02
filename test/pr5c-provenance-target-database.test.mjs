// ============================================================================
// PR5c — field_provenance.target_database is a CLOSED vocabulary, class-wide.
//
//   field_provenance_target_database_check
//     CHECK (target_database = ANY (ARRAY['lcc_opps','dia_db','gov_db']))
//
// lcc_merge_field() ALWAYS inserts a field_provenance row — write, skip AND
// conflict all land — so a (table, field, source) sitting at zero rows means
// the RPC never completed, never that it decided against writing. Measured
// live 2026-09-02 by replaying each call site's exact payload in a rolled-back
// transaction: FIVE call sites passed a value outside the vocabulary
// ('dia', 'gov', 'lcc', 'lcc_db') and raised 23514 on 100% of calls, into a
// bare `catch`. Between them they cover 12 of PR5c's 33 LCC-internal rungs
// plus comms_observed / w9_2_internal_harvest / availability_scraper.
//
// Why these guards, and why each one exists:
//
//   1. CLASS, NOT INSTANCE. The lesson had already been written down once,
//      beside ONE call site (api/admin.js comms_owner_bridge: "p_target_database
//      ='lcc_opps' matches the ops-local convention") — and that is the only
//      LCC-internal lane with provenance rows. Four siblings, and the very
//      edge function that comment cites as a precedent, stayed broken. So this
//      scans EVERY p_target_database in api/ and supabase/functions/.
//   2. RESOLVE THE IDENTIFIER, DON'T MATCH THE SHAPE. `p_target_database: dom`
//      looks fine and was the defect. A guard that accepts any identifier is
//      defeated by a local variable (N15c). Identifiers are resolved to their
//      initializer before being judged.
//   3. COMMENTS ARE STRIPPED FIRST, STRING LITERALS ARE NOT. The fix's own
//      comments quote 'dia', 'lcc' and 'lcc_db' repeatedly while explaining
//      them, so a raw grep matches the explanation and passes over a
//      regression (A5c / N18 / PR8). But the VALUES are string literals, so
//      literals must survive the stripper — hence a real scanner, not a regex.
//   4. POSITIVE CONTROL. A detector that has never been seen firing is a
//      claim (P182). Each of the four historically-broken values is replayed
//      through the same resolver and must be flagged.
//   5. POPULATION CONTROL. An empty scan passes vacuously; the site count is
//      asserted non-trivial so the walker cannot silently stop finding files.
//   6. STATED CEILING. Resolution is INTRA-FILE: a literal, a ternary of
//      literals, a local const/arrow, or a call to a sanctioned canonicaliser.
//      A value arriving as a function PARAMETER is accepted as a "carrier" —
//      and the carrier keys (targetDb / targetDatabase) are scanned by the same
//      pass, so every string LITERAL anywhere in that plumbing is still judged.
//      What this does NOT do is interprocedural flow analysis. All five live
//      defects were literals or a local const, which is the shape this catches.
//   7. THE DOUBLE-ENCODING SIBLING. p_value is a jsonb PARAM; JSON.stringify()
//      on a string double-encodes it to '"\"x\""'::jsonb, which no other
//      source can ever compare equal to. Three of the five broken sites did
//      that too, so fixing target_database alone would have armed a malformed
//      payload. Guarded here because it is the same call's contract.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import {
  PROVENANCE_TARGET_DATABASES,
  provenanceTargetDatabase,
} from '../api/_shared/field-priority-guard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['api', 'supabase/functions'];
const SCAN_EXT = ['.js', '.mjs', '.ts'];

// The sanctioned owners of the vocabulary. A call to one of these is accepted;
// their OUTPUTS are asserted separately so the allowlist cannot launder a bug.
const RESOLVER_FNS = new Set(['provenanceTargetDatabase', 'provenanceDbName']);

// The same value travels under these keys before it reaches the RPC. Scanning
// them with the SAME rule is what keeps a literal from hiding one hop upstream
// (`shouldWriteField({ targetDb: 'dia' })` is the identical defect). Carriers
// are scanned in JS only: in .ts, `targetDatabase: Vertical` is a TYPE
// annotation, and the two edge functions reach the RPC through a canonicaliser.
const CARRIER_KEYS = ['targetDatabase', 'targetDb'];
const CARRIER_IDENTS = new Set([...CARRIER_KEYS, 'targetDatabase', 'targetDb']);

// Expressions that read a target_database back off a row that is ALREADY in
// field_provenance (so it satisfied the CHECK by construction). Allowlisted by
// exact expression text with a reason — never by weakening the resolver.
const ROW_ECHO_ALLOWLIST = new Map([
  ['c.target_database',
   'api/admin.js provenance-conflict replay: re-stamps a value read off an existing field_provenance row'],
]);

// ---------------------------------------------------------------------------
// Comment stripper that PRESERVES string literals (see header note 3).
// ---------------------------------------------------------------------------
export function stripCommentsKeepStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (SCAN_EXT.some(x => e.endsWith(x))) acc.push(full);
  }
  return acc;
}

/** Everything after `p_target_database:` up to the top-level `,` / `}` / newline. */
function extractRhs(stripped, at) {
  let i = at;
  while (i < stripped.length && /\s/.test(stripped[i])) i++;
  let depth = 0, out = '';
  for (; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '\n') break;
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
    if (ch === ',' && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

const LITERAL = /^(['"`])(.*)\1$/;

/**
 * Resolve an RHS expression to a set of possible literal values, or throw.
 * `unresolved` is returned as a sentinel so the caller can name the site.
 */
export function resolveTargetDatabaseExpr(expr, strippedFile, depth = 0) {
  const e = expr.trim();
  if (depth > 3) return { kind: 'unresolved', expr: e };

  const lit = LITERAL.exec(e);
  if (lit) return { kind: 'literals', values: [lit[2]] };

  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(e);
  if (call && RESOLVER_FNS.has(call[1])) return { kind: 'resolver', fn: call[1] };

  if (ROW_ECHO_ALLOWLIST.has(e)) return { kind: 'row_echo', expr: e };

  // ternary of resolvable branches
  const q = e.indexOf('?');
  if (q > 0) {
    const rest = e.slice(q + 1);
    const colon = rest.lastIndexOf(':');
    if (colon > 0) {
      const a = resolveTargetDatabaseExpr(rest.slice(0, colon), strippedFile, depth + 1);
      const b = resolveTargetDatabaseExpr(rest.slice(colon + 1), strippedFile, depth + 1);
      if (a.kind === 'literals' && b.kind === 'literals') {
        return { kind: 'literals', values: [...a.values, ...b.values] };
      }
      if (a.kind !== 'unresolved' && b.kind !== 'unresolved') return { kind: 'resolver', fn: 'ternary' };
      return { kind: 'unresolved', expr: e };
    }
  }

  // call to a LOCAL canonicaliser (e.g. `const DOMAIN_DB = (d) => ...`):
  // resolve the arrow body / the function's return literals.
  if (call) {
    const name = call[1];
    const arrow = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*([^;\\n]+)`).exec(strippedFile);
    if (arrow) return resolveTargetDatabaseExpr(arrow[1].replace(/^\((.*)\)$/s, '$1'), strippedFile, depth + 1);
    const fnBody = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(strippedFile);
    if (fnBody) {
      const rets = [...fnBody[1].matchAll(/return\s+(['"`])([^'"`]*)\1/g)].map(m => m[2]);
      if (rets.length) return { kind: 'literals', values: rets };
    }
  }

  // bare identifier -> resolve to its initializer in the same file (note 2)
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const decl = new RegExp(`(?:const|let|var)\\s+${e}\\s*=\\s*([^;\\n]+)`).exec(strippedFile);
    if (decl) return resolveTargetDatabaseExpr(decl[1], strippedFile, depth + 1);
    // A function PARAMETER carrying the value in: accepted only under a carrier
    // name, whose own literal leaves this same scan judges (note 6).
    if (CARRIER_IDENTS.has(e)) return { kind: 'carrier', expr: e };
    return { kind: 'unresolved', expr: e };
  }

  // `ctx.targetDatabase` / `opts.targetDb` — same carrier, one property deep.
  const member = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.exec(e);
  if (member) {
    const prop = e.split('.').pop();
    if (CARRIER_IDENTS.has(prop)) return { kind: 'carrier', expr: e };
  }

  return { kind: 'unresolved', expr: e };
}

/** Every p_target_database site under SCAN_ROOTS, with its verdict. */
export function scanTargetDatabaseSites(root = ROOT) {
  const files = [];
  for (const r of SCAN_ROOTS) walk(join(root, r), files);
  const sites = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    if (!raw.includes('p_target_database') && !CARRIER_KEYS.some(k => raw.includes(k + ':'))) continue;
    const stripped = stripCommentsKeepStrings(raw);
    const keys = f.endsWith('.ts')
      ? ['p_target_database']
      : ['p_target_database', ...CARRIER_KEYS];
    for (const key of keys) {
      const re = new RegExp(`(?<![\\w$])${key}\\s*:`, 'g');
      let m;
      while ((m = re.exec(stripped)) !== null) {
        const expr = extractRhs(stripped, m.index + m[0].length);
        const line = stripped.slice(0, m.index).split('\n').length;
        const res = resolveTargetDatabaseExpr(expr, stripped);
        const bad = res.kind === 'unresolved'
          || (res.kind === 'literals' && res.values.some(v => !PROVENANCE_TARGET_DATABASES.includes(v)));
        sites.push({ file: relative(root, f), line, key, expr, res, bad });
      }
    }
  }
  return sites;
}

// ---------------------------------------------------------------------------

test('the vocabulary is exactly what the DB CHECK accepts', () => {
  assert.deepEqual([...PROVENANCE_TARGET_DATABASES].sort(), ['dia_db', 'gov_db', 'lcc_opps']);
});

test('provenanceTargetDatabase canonicalises every alias and refuses the rest', () => {
  for (const v of ['dia', 'dialysis', 'dia_db', 'DIA', ' dia ']) {
    assert.equal(provenanceTargetDatabase(v), 'dia_db', v);
  }
  for (const v of ['gov', 'government', 'gov_db']) {
    assert.equal(provenanceTargetDatabase(v), 'gov_db', v);
  }
  for (const v of ['lcc', 'lcc_db', 'lcc_opps', 'ops', 'cre']) {
    assert.equal(provenanceTargetDatabase(v), 'lcc_opps', v);
  }
  // Never invent a value: an unknown key must be null, not a plausible guess.
  for (const v of [null, undefined, '', 'dia_supabase', 'government-lease', 'opps']) {
    assert.equal(provenanceTargetDatabase(v), null, String(v));
  }
  // Every output it CAN produce satisfies the CHECK.
  for (const v of ['dia', 'gov', 'lcc']) {
    assert.ok(PROVENANCE_TARGET_DATABASES.includes(provenanceTargetDatabase(v)));
  }
});

test('no call site passes a p_target_database outside the vocabulary', () => {
  const sites = scanTargetDatabaseSites();
  const bad = sites.filter(s => s.bad);
  assert.deepEqual(
    bad.map(s => `${s.file}:${s.line} -> ${s.expr}`),
    [],
    'a p_target_database that is not lcc_opps/dia_db/gov_db raises 23514 and destroys the whole '
    + 'lcc_merge_field() call, silently, inside the caller\'s best-effort catch',
  );
});

test('population control — the scan actually finds the call sites', () => {
  const sites = scanTargetDatabaseSites();
  // Live 2026-09-02: 47 sites / 14 files (p_target_database 21, targetDb 20,
  // targetDatabase 6), of which 32 resolve to a literal. A collapse to near-zero
  // means the walker, the extension list or the stripper broke, not that the
  // defect was fixed — an empty scan passes every other assertion vacuously.
  assert.ok(sites.length >= 30, `expected >= 30 sites, found ${sites.length}`);
  const files = new Set(sites.map(s => s.file));
  assert.ok(files.size >= 10, `expected >= 10 files, found ${files.size}`);
  assert.ok(sites.some(s => s.key === 'p_target_database'), 'no RPC site found');
  assert.ok(sites.some(s => CARRIER_KEYS.includes(s.key)), 'no carrier site found');
  // The leaves are what the DB actually receives; they must be exactly the
  // vocabulary, with none missing (a scan that finds only one is not a scan).
  const leaves = new Set(sites.filter(s => s.res.kind === 'literals').flatMap(s => s.res.values));
  assert.ok(leaves.size >= 20 || [...leaves].every(v => PROVENANCE_TARGET_DATABASES.includes(v)));
  assert.ok(sites.filter(s => s.res.kind === 'literals').length >= 20,
    'fewer than 20 literal leaves — the resolver stopped resolving');
  // Both scan roots must be represented, or a whole deploy surface is unwatched.
  assert.ok([...files].some(f => f.startsWith('api/')), 'no api/ site found');
  assert.ok([...files].some(f => f.startsWith('supabase/functions/')),
    'no supabase/functions/ site found — the edge functions are a THIRD deploy surface and '
    + 'availability-checker is exactly where this defect survived');
});

test('positive control — every historically-broken value is still flagged', () => {
  const file = "const dom = 'dia';\n";
  for (const brokenExpr of ["'dia'", "'gov'", "'lcc'", "'lcc_db'", 'dom', 'someUnknownVar']) {
    const res = resolveTargetDatabaseExpr(brokenExpr, file);
    const bad = res.kind === 'unresolved'
      || (res.kind === 'literals' && res.values.some(v => !PROVENANCE_TARGET_DATABASES.includes(v)));
    assert.ok(bad, `resolver failed to flag ${brokenExpr}`);
  }
  // ...and does NOT flag the correct forms.
  for (const okExpr of ["'dia_db'", "'gov_db'", "'lcc_opps'", "provenanceTargetDatabase(dom)"]) {
    const res = resolveTargetDatabaseExpr(okExpr, file);
    const bad = res.kind === 'unresolved'
      || (res.kind === 'literals' && res.values.some(v => !PROVENANCE_TARGET_DATABASES.includes(v)));
    assert.ok(!bad, `resolver wrongly flagged ${okExpr}`);
  }
});

test('the row-echo allowlist still matches something (it cannot rot into a lie)', () => {
  const sites = scanTargetDatabaseSites();
  for (const [expr] of ROW_ECHO_ALLOWLIST) {
    assert.ok(sites.some(s => s.expr === expr),
      `allowlisted expression ${expr} no longer appears — drop the entry rather than leaving a `
      + 'permanently-satisfied exemption');
  }
});

test('the comment stripper keeps string literals and drops explanations', () => {
  const src = [
    "// p_target_database: 'dia' <- this is prose about the bug",
    "/* p_target_database: 'lcc_db' also prose */",
    "const a = { p_target_database: 'dia_db' };",
  ].join('\n');
  const out = stripCommentsKeepStrings(src);
  assert.ok(out.includes("'dia_db'"), 'string literals must survive the stripper');
  assert.ok(!out.includes("'dia'"), 'a commented-out example must not reach the scanner');
  assert.ok(!out.includes("'lcc_db'"), 'a block-comment example must not reach the scanner');
  // and the scanner therefore sees exactly one site here
  const hits = [...out.matchAll(/p_target_database\s*:/g)];
  assert.equal(hits.length, 1);
});

test('p_value is never JSON.stringify-ed — a jsonb param must not be double-encoded', () => {
  const files = [];
  for (const r of SCAN_ROOTS) walk(join(ROOT, r), files);
  const offenders = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    if (!raw.includes('p_value')) continue;
    const stripped = stripCommentsKeepStrings(raw);
    const re = /p_value\s*:/g;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const rhs = extractRhs(stripped, m.index + m[0].length);
      if (/JSON\.stringify\s*\(/.test(rhs)) {
        offenders.push(`${relative(ROOT, f)}:${stripped.slice(0, m.index).split('\n').length} -> ${rhs}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    "p_value is a jsonb PARAM: PostgREST hands it the parsed JSON value, so JSON.stringify('x') "
    + 'stores \'"\\"x\\""\'::jsonb, which no other source can ever compare equal to');
});

test('the edge-function local mapper only ever returns canonical values', () => {
  const p = join(ROOT, 'supabase/functions/availability-checker/index.ts');
  const stripped = stripCommentsKeepStrings(readFileSync(p, 'utf8'));
  const body = /function provenanceTargetDatabase\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(stripped);
  assert.ok(body, 'availability-checker must own a local canonicaliser (Deno cannot import api/)');
  const returned = [...body[1].matchAll(/return\s+"([^"]+)"/g)].map(m => m[1]);
  assert.ok(returned.length >= 3, `expected >= 3 return literals, got ${returned.length}`);
  for (const v of returned) {
    assert.ok(PROVENANCE_TARGET_DATABASES.includes(v), `edge mapper returns non-canonical ${v}`);
  }
});
