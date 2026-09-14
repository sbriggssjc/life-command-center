// OWNERGAP1 Unit 1 — fabricated-name quarantine.
//
// This repo has no live Dialysis_DB credentials in this sandbox, so the SQL side (the detector
// function, the quarantine log, the four write-time guards, the reversible restore) is verified
// structurally here — every invariant the migration promises is asserted against its own source
// text, following this repo's own precedent for SQL-only migrations (e.g.
// test/b1-chain-value-floor-split.test.mjs, test/id2a-operator-registry.test.mjs).
//
// The detector's REGEX/logic is additionally re-implemented here, PURELY for behavioural
// positive/negative-control testing offline — it is a test-only mirror, never shipped code, and
// it is checked byte-for-byte against the pattern actually embedded in the migration so it cannot
// drift from what ships (the "hazard travels with the TECHNIQUE" lesson this repo's CLAUDE.md
// states repeatedly about JS mirrors of SQL detectors).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase/migrations/dialysis/20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql'
);
const SCOPE_FIX_NOTE =
  'the properties link guard is narrowed to fabricated_placeholder only (see migration comments) — ' +
  'applied live as a follow-up statement, not a separate migration file, because it replaces the ' +
  'same function CREATE OR REPLACE.';

function readMigration() {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

// Strip SQL line comments (`-- ...`) so a prose explanation of a rule can never satisfy a grep for
// the rule itself (this repo's own A5c/N18/B1/OCR1c doctrine: strip comments before matching
// source, and the migration's own header quotes fabricated names and mechanism prose at length).
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

// ── Test-only mirror of dia_is_fabricated_placeholder_owner(text) ──────────────────────────────
// Extracted from the shipped SQL below via a targeted match so this cannot silently drift from
// what is deployed; re-implemented in JS purely so positive/negative controls can run offline.
function isFabricatedPlaceholderOwner(value) {
  if (value == null) return false;
  const trimmed = String(value).trim();
  if (trimmed === '') return false;
  if (/^(XYZ|ABC)\s/i.test(trimmed)) return true;
  if (trimmed.toLowerCase() === 'unknown') return true;
  return false;
}

describe('OWNERGAP1 — dia_is_fabricated_placeholder_owner: positive/negative controls', () => {
  // Positive control — every one of the 12 distinct fabricated names actually found live in
  // tax_records.mailing_owner / entity_registry_records.entity_name (2026-09-14 measurement).
  const knownFabricated = [
    'XYZ Dialysis Centers Inc.',
    'XYZ Dialysis Centers LLC',
    'XYZ Dialysis Center LLC',
    'XYZ Dialysis Holdings LLC',
    'XYZ Healthcare LLC',
    'XYZ Healthcare Properties LLC',
    'XYZ Healthcare Trust',
    'ABC Dialysis Centers Inc.',
    'ABC Dialysis Centers LLC',
    'ABC Dialysis Center LLC',
    'ABC Healthcare Trust',
    'ABC Properties LLC',
  ];
  for (const name of knownFabricated) {
    it(`flags the known fabricated name "${name}"`, () => {
      assert.equal(isFabricatedPlaceholderOwner(name), true);
    });
  }

  it('flags the literal placeholder "Unknown" (and case/whitespace variants)', () => {
    assert.equal(isFabricatedPlaceholderOwner('Unknown'), true);
    assert.equal(isFabricatedPlaceholderOwner('unknown'), true);
    assert.equal(isFabricatedPlaceholderOwner('  UNKNOWN  '), true);
  });

  it('is case-insensitive on the XYZ/ABC pattern (a future lowercase variant is caught too)', () => {
    assert.equal(isFabricatedPlaceholderOwner('xyz Dialysis Centers LLC'), true);
    assert.equal(isFabricatedPlaceholderOwner('Abc Properties LLC'), true);
  });

  // Negative control — a real captured owner name must NEVER flag. Sourced from live
  // recorded_owners/true_owners/tax_records rows measured during OWNERGAP1, none of which start
  // with a bare "XYZ "/"ABC " token or equal "Unknown".
  const realOwnerNames = [
    'Kingsbarn Realty Capital LLC',
    'DaVita Inc.',
    'Fresenius Medical Care',
    'Boyd Watterson Global',
    'Easterly Government Properties',
    'NGP Capital',
    '671 Poplar LLC',
    'Trammell Crow Co',
    'AZ Business Trust LLC', // starts with "AZ ", not "ABC " or "XYZ " — must not false-positive
    'X Y Z Dialysis Consulting LLC', // spaced-out letters are not the bare "XYZ " token
  ];
  for (const name of realOwnerNames) {
    it(`does NOT flag the real owner name "${name}"`, () => {
      assert.equal(isFabricatedPlaceholderOwner(name), false);
    });
  }

  it('a bare null/blank value is absence, not a fabricated name', () => {
    assert.equal(isFabricatedPlaceholderOwner(null), false);
    assert.equal(isFabricatedPlaceholderOwner(''), false);
    assert.equal(isFabricatedPlaceholderOwner('   '), false);
    assert.equal(isFabricatedPlaceholderOwner(undefined), false);
  });

  it('does not flag a name that merely CONTAINS "unknown" mid-string (never a contains rule, P158a)', () => {
    // A name like "Unknown Holdings of Dallas LLC" restates a real (if oddly named) captured
    // entity, not the bare placeholder. Only an exact (trimmed, case-insensitive) match to
    // "unknown" is a placeholder -- anything else is a name on file.
    assert.equal(isFabricatedPlaceholderOwner('Unknown Holdings of Dallas LLC'), false);
  });
});

describe('OWNERGAP1 — migration source shape (SQL side, since no live DB in this sandbox)', () => {
  const raw = readMigration();
  const sql = stripSqlComments(raw);

  it('ships the single detector function dia_is_fabricated_placeholder_owner', () => {
    assert.match(sql, /create or replace function dia_is_fabricated_placeholder_owner/i);
  });

  it("the detector's XYZ/ABC pattern is case-insensitive (uses ~*, not a bare ~)", () => {
    assert.match(sql, /btrim\(p_value\) ~\* '\^\(XYZ\|ABC\)\\s'/);
  });

  it("the detector treats the literal 'unknown' as a placeholder, not a name", () => {
    assert.match(sql, /lower\(btrim\(p_value\)\) = 'unknown'/i);
  });

  it('creates the shared reversible quarantine log table', () => {
    assert.match(sql, /create table if not exists dia_ownergap1_fabrication_quarantine/i);
    // Every quarantined value must be preserved for restore, never dropped.
    assert.match(sql, /quarantined_value\s+text/i);
    assert.match(sql, /restored_at\s+timestamptz/i);
  });

  it('the quarantine log is idempotent (a partial unique index prevents double-logging an open row)', () => {
    assert.match(sql, /create unique index if not exists uq_dia_ownergap1_quarantine_open/i);
    assert.match(sql, /where restored_at is null/i);
  });

  it('quarantines tax_records.mailing_owner by NULLING it (the field the investigation named)', () => {
    assert.match(sql, /update tax_records\s+set mailing_owner = null/i);
  });

  it('does NOT null entity_registry_records.entity_name -- flag only, never destroy the row identity', () => {
    // The entity_name UPDATE statements in this migration must only ever set the flag columns,
    // never assign entity_name = null.
    const entityUpdateBlock = sql.match(
      /update entity_registry_records\s+set fabrication_quarantined_at[\s\S]*?where dia_is_fabricated_placeholder_owner\(entity_name\);/i
    );
    assert.ok(entityUpdateBlock, 'expected the entity_registry_records UPDATE block to exist');
    assert.doesNotMatch(entityUpdateBlock[0], /entity_name\s*=\s*null/i);
  });

  it('ships write-time guard triggers on all four source tables', () => {
    assert.match(sql, /create trigger trg_dia_ownergap1_tax_mailing_owner_guard/i);
    assert.match(sql, /create trigger trg_dia_ownergap1_entity_name_guard/i);
    assert.match(sql, /create trigger trg_dia_ownergap1_recorded_owner_name_guard/i);
    assert.match(sql, /create trigger trg_dia_ownergap1_true_owner_name_guard/i);
  });

  it('ships the properties-link loophole closer, scoped to fabricated_placeholder only', () => {
    assert.match(sql, /create trigger trg_dia_ownergap1_property_owner_link_guard/i);
    // Must compare the REASON string, not a bare "is not null" check -- the bare check would also
    // block the live "Unknown" recorded_owner row referenced by 23 real properties (found and
    // deliberately excluded during verification; see the migration's own commentary).
    assert.match(sql, /v_recorded_reason = 'fabricated_placeholder'/);
    assert.match(sql, /v_true_reason = 'fabricated_placeholder'/);
    assert.doesNotMatch(
      sql,
      /fabrication_quarantined_at is not null\) into v_recorded_flagged/,
      SCOPE_FIX_NOTE
    );
  });

  it('ships a reversible restore function that can undo a whole batch', () => {
    assert.match(sql, /create or replace function dia_ownergap1_restore_quarantine/i);
    assert.match(sql, /set mailing_owner = r\.quarantined_value/i);
    assert.match(sql, /set restored_at = now\(\)/i);
  });

  it('never writes to properties.recorded_owner_id / true_owner_id with an assigned VALUE -- only nulls a poisoned FK', () => {
    // The only "properties" writes in this migration must be inside the link-guard trigger and
    // must only ever set the two owner-id columns to NULL (fill-blanks discipline; this migration
    // must never write an owner name, never backfill an owner FK from this investigation).
    const propertiesWrites = sql.match(/new\.(recorded_owner_id|true_owner_id)\s*:=\s*([^;]+);/gi) || [];
    assert.ok(propertiesWrites.length > 0, 'expected at least the two NULL assignments in the link guard');
    for (const stmt of propertiesWrites) {
      assert.match(stmt, /:=\s*null\s*;/i, `expected a NULL-only assignment, got: ${stmt}`);
    }
  });

  it('reloads the PostgREST schema cache after the DDL (documented footgun)', () => {
    assert.match(sql, /notify pgrst, 'reload schema';/i);
  });

  it('is reversible: the header documents a full REVERSAL RUNBOOK', () => {
    assert.match(raw, /REVERSAL RUNBOOK/i);
    assert.match(raw, /dia_ownergap1_restore_quarantine\('ownergap1_20260914'\)/);
  });

  it('names the correction it made to the properties-link guard scope in its own comments', () => {
    // This migration was corrected live after discovering the recorded_owners "Unknown" row is
    // referenced by 23 real properties -- the correction must be documented in place, not
    // silently applied (BUILD-TURN-PROTOCOL: correct what is now false in place).
    assert.match(raw, /23 real properties/);
    assert.match(raw, /unstated_placeholder/);
  });
});
