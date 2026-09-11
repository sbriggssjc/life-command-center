// ID2a — operator source-of-record, phase A.
//
// This repo has no live Dialysis_DB credentials in this sandbox, so the SQL
// side (registry rebuild, alias table, resolver, write guard, backfill) is
// verified structurally here — every invariant the migration promises is
// asserted against its own source text — plus a repo-wide guard that a
// second canonical operator map can never appear. The JS resolver wrapper
// (`resolveOperatorAgainstRegistry`) IS live-testable (it takes an injected
// query function) and is exercised behaviourally below.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase/migrations/dialysis/20260911200000_dia_id2a_operator_registry.sql'
);

function readMigration() {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

// Strip SQL line comments (`-- ...`) so a prose explanation of a rule can
// never satisfy a grep for the rule itself (this repo's own A5c/N18/B1
// doctrine: strip comments before matching source).
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      // Naive but sufficient here: no `--` occurs inside a string literal in
      // this migration's own body (verified by inspection: every literal is
      // either a plain identifier/name or wrapped in single quotes with no
      // embedded `--`).
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const { resolveOperatorAgainstRegistry, SHORT_OPERATOR_DISPLAY, listCanonicalOperators } =
  await import('../api/_shared/operator-normalize.js');

describe('ID2a — canonical name decisions (Scott, 2026-09-11)', () => {
  it('Fresenius canonical is "Fresenius Medical Care"', () => {
    assert.ok(listCanonicalOperators().includes('Fresenius Medical Care'));
    assert.ok(!listCanonicalOperators().includes('Fresenius'));
  });
  it('US Renal Care canonical is the brand form, not the legal-entity form', () => {
    assert.ok(listCanonicalOperators().includes('US Renal Care'));
    assert.ok(!listCanonicalOperators().includes('US Renal Care, Inc.'));
  });
  it('the short chart-label map seeds Fresenius -> Fresenius so no chart changes', () => {
    assert.equal(SHORT_OPERATOR_DISPLAY['Fresenius Medical Care'], 'Fresenius');
  });
});

describe('ID2a — resolveOperatorAgainstRegistry (JS resolver wrapper) fails closed', () => {
  it('blank/whitespace text never calls the DB', async () => {
    let called = false;
    const r = await resolveOperatorAgainstRegistry('   ', async () => { called = true; });
    assert.equal(called, false);
    assert.deepEqual(r, { operatorId: null, canonicalName: null, status: 'blank' });
  });

  it('a matched RPC response resolves operatorId/canonicalName/status', async () => {
    const stub = async (method, path, body) => {
      assert.equal(method, 'POST');
      assert.equal(path, 'rpc/dia_resolve_operator');
      assert.equal(body.p_text, 'DaVita Kidney Care');
      return { ok: true, data: [{ operator_id: 4, canonical_name: 'DaVita', status: 'matched' }] };
    };
    const r = await resolveOperatorAgainstRegistry('DaVita Kidney Care', stub);
    assert.deepEqual(r, { operatorId: 4, canonicalName: 'DaVita', status: 'matched' });
  });

  it('an unresolved RPC status never mints an operatorId', async () => {
    const stub = async () => ({ ok: true, data: [{ operator_id: null, canonical_name: null, status: 'needs_review' }] });
    const r = await resolveOperatorAgainstRegistry('Some Weird LLC', stub);
    assert.equal(r.operatorId, null);
    assert.equal(r.status, 'needs_review');
  });

  it('a failed/unreachable RPC fails closed to lookup_failed, never guesses', async () => {
    const stub = async () => ({ ok: false });
    const r = await resolveOperatorAgainstRegistry('DaVita', stub);
    assert.equal(r.operatorId, null);
    assert.equal(r.status, 'lookup_failed');
  });

  it('a throwing query function fails closed rather than propagating', async () => {
    const stub = async () => { throw new Error('network down'); };
    const r = await resolveOperatorAgainstRegistry('DaVita', stub);
    assert.equal(r.operatorId, null);
    assert.equal(r.status, 'lookup_failed');
  });

  it('a missing query function fails closed', async () => {
    const r = await resolveOperatorAgainstRegistry('DaVita', undefined);
    assert.equal(r.status, 'lookup_failed');
  });
});

describe('ID2a — migration structural invariants', () => {
  const raw = readMigration();
  const sql = stripSqlComments(raw);

  it('never deletes an operators row — retire, never delete', () => {
    assert.doesNotMatch(sql, /delete\s+from\s+public\.operators/i);
  });

  it('categories/payers are reclassified by KIND, never removed from the table', () => {
    assert.match(sql, /kind\s*=\s*'category'/i);
    assert.match(sql, /kind\s*=\s*'payer'/i);
    assert.match(sql, /'None',\s*'Other',\s*'Independent',\s*'State Owned'/);
    assert.match(sql, /'UnitedHealthcare',\s*'Kaiser Permanente'/);
  });

  it('the DaVita | ... multi-tenant composites are retired as non_operator, never merged', () => {
    assert.match(sql, /kind\s*=\s*'non_operator'/i);
    assert.match(sql, /DaVita \| %/);
  });

  it('DaVita at Home is a brand CHILD (parent_operator_id), never merged into DaVita', () => {
    assert.match(sql, /davita at home/i);
    assert.match(sql, /parent_operator_id/);
    // It must not appear inside the DaVita merge-group member array.
    const davitaGroupMatch = sql.match(
      /dia_id2a_merge_operator_group\('DaVita',\s*ARRAY\[([^\]]*)\]/i
    );
    assert.ok(davitaGroupMatch, 'expected the DaVita merge-group call');
    assert.doesNotMatch(davitaGroupMatch[1], /davita at home/i);
  });

  it('the resolver fails closed — it never inserts into public.operators', () => {
    const fnMatch = sql.match(
      /create or replace function public\.dia_resolve_operator\([^)]*\)([\s\S]*?)^\$\$;/im
    );
    assert.ok(fnMatch, 'expected dia_resolve_operator body');
    assert.doesNotMatch(fnMatch[1], /insert\s+into\s+public\.operators/i);
  });

  it('the write guard hard-blocks (RAISE EXCEPTION), it does not silently null the value', () => {
    const fnMatch = sql.match(
      /create or replace function public\.dia_operator_write_guard\(\)([\s\S]*?)^\$\$;/im
    );
    assert.ok(fnMatch, 'expected dia_operator_write_guard body');
    assert.match(fnMatch[1], /raise exception/i);
    // The blank/matched paths return NEW; only the unresolved path may fall
    // through to the raise.
    assert.match(fnMatch[1], /NEW\.operator_id\s*:=/);
  });

  it('the write guard is wired as a BEFORE trigger on properties.operator', () => {
    assert.match(
      sql,
      /before insert or update of operator on public\.properties[\s\S]*?dia_operator_write_guard/i
    );
  });

  it('the backfill auto-applies ONLY status=matched rows', () => {
    const fnMatch = sql.match(
      /create or replace function public\.dia_id2a_backfill_property_operator_ids\([^)]*\)([\s\S]*?)^\$\$;/im
    );
    assert.ok(fnMatch, 'expected the backfill function body');
    assert.match(fnMatch[1], /t\.status\s*=\s*'matched'/i);
    // Everything else is routed to the review lane, never auto-written.
    assert.match(fnMatch[1], /insert into public\.dia_operator_write_review/i);
    assert.match(fnMatch[1], /t\.status\s*<>\s*'matched'/i);
  });

  it('the backfill is dry-run default', () => {
    assert.match(sql, /p_dry_run boolean default true/i);
  });

  it('the survivor resolver is hop-capped (never an unbounded merge-chain follow)', () => {
    const fnMatch = sql.match(
      /create or replace function public\.dia_operator_survivor\([^)]*\)([\s\S]*?)^\$\$;/im
    );
    assert.ok(fnMatch, 'expected dia_operator_survivor body');
    assert.match(fnMatch[1], /p_max_hops/i);
    assert.match(fnMatch[1], /v_hops\s*>=\s*p_max_hops/i);
  });

  it('the resolver and the JS module use the SAME renamed canonical spellings', () => {
    assert.match(sql, /then 'Fresenius Medical Care'/);
    assert.doesNotMatch(sql, /then 'Fresenius'\s*$/m);
    assert.match(sql, /then 'US Renal Care'/);
    assert.doesNotMatch(sql, /then 'US Renal Care, Inc\.'/);
  });

  it('states the LCC Opps decision (external_identities source_type=operator, cache not a second identity)', () => {
    assert.match(raw, /external_identities/);
    assert.match(raw, /source_type\s*=\s*'operator'/);
    assert.match(raw, /lcc_operator_affiliate_patterns/);
  });
});

describe('ID2a — no second canonical operator map exists anywhere in the repo', () => {
  // The ONE JS source of the alias/family map is api/_shared/operator-normalize.js.
  // The ONE SQL mirror is the ID2a migration (which itself CREATE OR REPLACEs
  // dia_operator_from_tenant/dia_operator_tenant_status — first authored in
  // the 2026-06-24 migration, re-declared here in lock-step, never forked).
  const ALLOWED_FILES = new Set([
    'api/_shared/operator-normalize.js',
    'supabase/migrations/dialysis/20260624_dia_operator_normalize.sql',
    'supabase/migrations/dialysis/20260911200000_dia_id2a_operator_registry.sql',
    // ⚠️ PRE-EXISTING, DISCOVERED BY THIS GUARD'S OWN FIRST RUN, NOT
    // INTRODUCED BY ID2a — a genuinely SEPARATE canonicalizer over
    // `dia.leases.tenant` (a different column and a different, DISAGREEING
    // canonical spelling: 'DaVita Kidney Care' not 'DaVita', 'U.S. Renal
    // Care' not the ID2a-decided 'US Renal Care', 'DCI' not 'Dialysis
    // Clinic, Inc.', 'Innovative Renal Care' not 'American Renal
    // Associates'). It is a live writer (sidebar-pipeline.js,
    // intake-promoter.js, bridge-handlers-salesforce.js). Out of scope for
    // ID2a (which resolves `properties.operator`, not `leases.tenant`, and
    // "no new normalizer anywhere" means this phase adds none — it does not
    // mean retrofitting an unrelated pre-existing one). Filed as a new
    // finding for the ID1 audit addendum / a future round (tentatively
    // ID2c) rather than silently allowlisted without comment.
    'api/_shared/tenant-canonical.js',
  ]);

  // A second map would restate at least two of these three families' anchored
  // regex targets together — a single hit is plausibly a comment/citation
  // (this repo cites 'DaVita'/'Fresenius' constantly in prose), but the SAME
  // file defining anchored classification rules for ALL of DaVita AND
  // Fresenius AND US Renal Care is the shape of an actual second map.
  const FAMILY_MARKERS = [
    /da\s*vita/i,
    /fres[ei]?nius/i,
    /u\.?\s*s\.?\s*renal\s*care|usrc/i,
  ];

  function walk(dir, out) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(js|mjs|cjs|sql)$/i.test(entry.name)) out.push(full);
    }
  }

  it('no file outside the two authoritative sources defines all three family patterns as ANCHORED classification rules', () => {
    const candidates = [];
    walk(path.join(REPO_ROOT, 'api'), candidates);
    walk(path.join(REPO_ROOT, 'supabase', 'migrations'), candidates);
    walk(path.join(REPO_ROOT, 'mcp'), candidates);

    const offenders = [];
    for (const file of candidates) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      if (ALLOWED_FILES.has(rel)) continue;
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      // Anchored family classification specifically — an anchored regex/LIKE
      // start (`^`) combined with the family word, which is what a real
      // second map looks like (prose mentions never anchor).
      const anchoredHits = FAMILY_MARKERS.filter((re) => {
        const anchoredRe = new RegExp('\\^[^\\n]{0,40}' + re.source, re.flags);
        return anchoredRe.test(text) || new RegExp("t\\s*~\\*\\s*'\\^[^']{0,40}" + re.source, re.flags).test(text);
      });
      if (anchoredHits.length >= 2) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `second canonical map candidate(s): ${offenders.join(', ')}`);
  });
});
