// ID2b — consumers of the operator identity registry (docs/claude-code/prompts/
// ID2b-consumer-switch-to-operator-id.md). This sandbox has no live Dialysis_DB credentials
// (same constraint id2a-operator-registry.test.mjs documents), so the SQL side is verified
// structurally against the shipped migration's own source text; the migration was applied live
// and measured (docs/audits/ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md) before this test was
// written.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase/migrations/dialysis/20260912120000_dia_id2b_market_brief_operator_id.sql'
);

function readMigration() {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

// Strip SQL line comments before matching, per this repo's own A5c/N18/B1 doctrine: a prose
// explanation of the old (pre-fix) grouping must never satisfy a grep for the fix being present.
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('ID2b — v_market_brief_cms_operator_counts groups on operator_id', () => {
  it('the migration file exists and is the newest touch of this view', () => {
    const sql = readMigration();
    assert.match(sql, /v_market_brief_cms_operator_counts/);
  });

  it('groups via properties.operator_id (survivor-resolved), not raw chain_organization alone', () => {
    const sql = stripSqlComments(readMigration());
    assert.match(sql, /p\.operator_id/, 'must join through properties.operator_id');
    assert.match(sql, /dia_operator_survivor/, 'must resolve to the merge survivor, like the ID2a parity view');
    // The GROUP BY / SELECT list must key on the resolved `operator` column (COALESCE(name, raw
    // text)), never on medicare_clinics.chain_organization directly.
    assert.match(sql, /GROUP BY\s+operator\b/i);
    assert.doesNotMatch(sql, /GROUP BY\s+(mc\.)?chain_organization/i);
  });

  it('fills blanks — an unresolved clinic keeps its raw text and is marked, never dropped', () => {
    const sql = stripSqlComments(readMigration());
    assert.match(sql, /COALESCE\(o\.name,\s*mc\.chain_organization\)/);
    assert.match(sql, /operator_id_resolved/);
    assert.match(sql, /all_rows_operator_id_resolved/);
  });

  it('is reversible and idempotent (view-only, no base-table mutation)', () => {
    const sql = readMigration();
    assert.match(sql, /CREATE OR REPLACE VIEW/);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(sql, /\bUPDATE\s+(public\.)?medicare_clinics\b/i);
    assert.doesNotMatch(sql, /\bUPDATE\s+(public\.)?properties\b/i);
  });
});

// ── Class guard: a NEW view/module must not group raw operator/tenant text without also
// mentioning operator_id, so this class of fragmentation cannot silently reappear elsewhere.
// This is a REPO-side guard only (JS/SQL committed here); it cannot see the ~90-view Dialysis_DB
// population this repo does not own the source for — that population is enumerated and sized as a
// named follow-up in docs/audits/ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md, not silently
// declared clean by this test.
describe('ID2b — class guard: no NEW repo module groups by operator text without operator_id', () => {
  const WATCHED_DIRS = ['api/_shared', 'api/_handlers', 'mcp'];
  const ALLOWLIST = new Set([
    // Pre-existing, explicitly measured-and-deferred surfaces (see the audit doc). Adding a path
    // here requires a reason in the audit doc, per this repo's stale-allowlist-entry discipline.
    'mcp/comps-tools.js', // fuzzy comp SELECTION (operatorTier/tenantMatches) -- spec explicitly
                          // forbids switching this blind; comp-set delta not yet measured (ID2b-c).
    'api/_shared/dossier-generator.js',
    'api/_shared/rent-projection.js',
    'api/_shared/team-context.js',
    'api/_handlers/sidebar-pipeline.js',
    // FIXED AT SOURCE, not here: this handler reads v_market_brief_cms_operator_counts, which the
    // 20260912120000 migration switched to group on properties.operator_id in the DB. The JS is a
    // pass-through consumer of {operator, count} rows and is intentionally operator_id-agnostic
    // (per-operator caching/dedup here keys on whatever label the view emits).
    'api/_handlers/market-brief-psql-tick.js',
  ]);

  function listJsFiles(dir) {
    const abs = path.join(REPO_ROOT, dir);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    let out = [];
    for (const e of entries) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(listJsFiles(rel));
      else if (e.isFile() && e.name.endsWith('.js')) out.push(rel);
    }
    return out;
  }

  function stripJsComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  it('every watched module that groups/buckets on operator or tenant text also names operator_id (or is a dated, reasoned exemption)', () => {
    const offenders = [];
    for (const dir of WATCHED_DIRS) {
      for (const rel of listJsFiles(dir)) {
        if (ALLOWLIST.has(rel)) continue;
        const src = stripJsComments(readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
        // Look for a GROUP-BY-shaped construct over an operator/tenant column: a reduce/Map keyed
        // on `.operator` / `.tenant`, or a raw SQL `GROUP BY ... operator` / `GROUP BY ... tenant`.
        const groupsOnOperatorText =
          /group\s+by[^;]{0,200}\b(operator|tenant)\b/i.test(src) ||
          /\.(operator|tenant)\b[^\n]{0,80}\.(get|set)\(/i.test(src);
        if (groupsOnOperatorText && !/operator_id/i.test(src)) {
          offenders.push(rel);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `New/undocumented operator-text grouping found (not in ALLOWLIST): ${offenders.join(', ')}. ` +
        'Either switch it to operator_id or add it to ALLOWLIST with a dated reason in ' +
        'docs/audits/ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md.'
    );
  });

  it('the allowlist itself is not stale — every entry still exists', () => {
    for (const rel of ALLOWLIST) {
      assert.doesNotThrow(
        () => readFileSync(path.join(REPO_ROOT, rel), 'utf8'),
        `allowlisted file ${rel} no longer exists — remove it from the allowlist`
      );
    }
  });
});
