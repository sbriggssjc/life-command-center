// C13g-min guard — the migration file must define the retype RPC allowlist,
// the reversible ledger, and the SEC1-definer-default revoke stanza for both
// SECURITY DEFINER functions it creates. This is a source-shape guard (no live
// DB access from CI), so it strips comments before matching (A5c/N18) and
// anchors on distinctive tokens, never a line number (block-slice footgun).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION = path.join(
  process.cwd(),
  'supabase/migrations/20261101120000_lcc_c13g_min_entity_retype.sql'
);

function stripSqlComments(sql) {
  // strip -- line comments and /* */ block comments, leaving string literals intact
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function readMigration() {
  return fs.readFileSync(MIGRATION, 'utf8');
}

test('migration file exists', () => {
  assert.ok(fs.existsSync(MIGRATION), 'C13g-min migration must exist');
});

test('lcc_retype_entity refuses any p_to outside the organization allowlist', () => {
  const src = stripSqlComments(readMigration());
  assert.match(
    src,
    /if\s+p_to\s+is\s+distinct\s+from\s+'organization'\s+then/i,
    'lcc_retype_entity must gate p_to to the organization allowlist by name'
  );
});

test('lcc_retype_entity refuses a tombstone and a non-person source type', () => {
  const src = stripSqlComments(readMigration());
  assert.match(src, /merged_into_entity_id\s+is\s+not\s+null/i);
  assert.match(src, /entity_type::text\s+is\s+distinct\s+from\s+'person'/i);
});

test('the write stamps the P149-shaped metadata key and inserts a ledger row', () => {
  const src = stripSqlComments(readMigration());
  assert.match(src, /c13g_prior_entity_type/);
  assert.match(src, /insert\s+into\s+lcc_entity_retype_log/i);
});

test('lcc_unretype_entity restores from the ledger row, never re-derives the prior type', () => {
  const src = stripSqlComments(readMigration());
  assert.match(src, /select\s+\*\s+into\s+v_log\s+from\s+lcc_entity_retype_log/i);
  assert.match(src, /v_log\.from_type::entity_type/);
  assert.match(src, /reverted_at\s*=\s*now\(\)/i);
});

test('the ambiguous-column footgun is guarded (#variable_conflict use_column) on unretype', () => {
  const src = stripSqlComments(readMigration());
  assert.match(src, /#variable_conflict\s+use_column/);
});

test('both SECURITY DEFINER functions carry the SEC1-definer-default revoke + assert stanza', () => {
  const src = stripSqlComments(readMigration());
  for (const fn of [
    'lcc_retype_entity(uuid, text, uuid, text, text)',
    'lcc_unretype_entity(uuid)',
  ]) {
    const revokeRe = new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+${fn.replace(/[()]/g, '\\$&')}\\s+from\\s+public,\\s*anon,\\s*authenticated`,
      'i'
    );
    assert.match(src, revokeRe, `missing revoke stanza for ${fn}`);
  }
  assert.match(src, /has_function_privilege\('anon',\s*'lcc_retype_entity/i);
  assert.match(src, /has_function_privilege\('authenticated',\s*'lcc_retype_entity/i);
  assert.match(src, /has_function_privilege\('anon',\s*'lcc_unretype_entity/i);
  assert.match(src, /has_function_privilege\('authenticated',\s*'lcc_unretype_entity/i);
});

test('the ledger table itself is locked down from anon/authenticated', () => {
  const src = stripSqlComments(readMigration());
  assert.match(
    src,
    /revoke\s+all\s+on\s+lcc_entity_retype_log\s+from\s+public,\s*anon,\s*authenticated/i
  );
});

test('the candidate view carries every corroboration column the C13g-min prompt requires', () => {
  const src = stripSqlComments(readMigration());
  for (const col of [
    'has_salesforce_contact',
    'has_salesforce_account',
    'n_rca_contact_ids',
    'n_costar_contact_ids',
    'looks_like_person_warning',
    'has_org_marker',
    'relationship_count',
    'resolved_owner_of',
    'blocks_own_t0e_sponsor_id',
    'blocks_own_t0e_token',
  ]) {
    assert.ok(src.includes(col), `v_lcc_entity_retype_candidates must carry ${col}`);
  }
});

test('the candidate view keys on entities.entity_type = person with >= 2 current facts, or an OWN-T0e block', () => {
  const src = stripSqlComments(readMigration());
  assert.match(src, /entity_type\s*=\s*'person'/i);
  assert.match(src, /having\s+count\(\*\)\s+filter\s*\(where\s+f\.is_current\)\s*>=\s*2/i);
  assert.match(src, /spe_props_max\s*>=\s*2/i);
});
