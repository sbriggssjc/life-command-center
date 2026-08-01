import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '20260801210000_lcc_field_source_priority_schema_drift_710_listing_fix.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

describe('Issue #710 field_source_priority listing schema drift', () => {
  it('removes the known dead folder-feed available_listings rules', () => {
    for (const field of [
      'asking_cap',
      'asking_price',
      'listing_price',
      'original_price',
      'sold_cap_rate',
      'last_price_change',
      'sold_price',
    ]) {
      assert.match(sql, new RegExp(`'${field}'`), `${field} should be explicitly cleaned up or remapped`);
    }
    assert.match(sql, /DELETE FROM public\.field_source_priority/);
    assert.match(sql, /source IN \('folder_feed_bov', 'folder_feed_master'\)/);
  });

  it('registers folder-feed listing ask rules only on live available_listings columns', () => {
    const expectedLiveColumns = [
      ['dia.available_listings', 'initial_price'],
      ['dia.available_listings', 'last_price'],
      ['dia.available_listings', 'initial_cap_rate'],
      ['dia.available_listings', 'current_cap_rate'],
      ['dia.available_listings', 'cap_rate'],
      ['dia.available_listings', 'price_change_date'],
      ['gov.available_listings', 'asking_price'],
      ['gov.available_listings', 'asking_cap_rate'],
    ];

    for (const [targetTable, fieldName] of expectedLiveColumns) {
      assert.match(sql, new RegExp(`'${targetTable}',\\s*'${fieldName}'`));
    }

    assert.match(sql, /45,\s*0,\s*'warn'/);
    assert.match(sql, /folder_feed_bov/);
    assert.match(sql, /folder_feed_master/);
  });

  it('adds a registration-time guard backed by domain_table_columns', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.assert_field_source_priority_column_exists/);
    assert.match(sql, /CREATE TRIGGER trg_field_source_priority_column_exists/);
    assert.match(sql, /BEFORE INSERT OR UPDATE OF target_table, field_name/);
    assert.match(sql, /domain_table_columns/);
    assert.match(sql, /RAISE EXCEPTION\s+'field_source_priority column drift:/);
  });
});

