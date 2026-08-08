// ============================================================================
// Prompt 78 (W8 U4) — PGRST204 schema-drift regression guard.
//
// The U4 audit's #1 critical cluster was ~7k silently-lost domain writes where
// a writer sent a field the target table lacks. This test pins each fixed
// writer's field set against the live table columns so the next drift breaks
// the build instead of production writes. Two layers:
//   1. Every WRITER_COLUMN_SETS entry ⊆ its table's PINNED_DOMAIN_COLUMNS.
//   2. The specific drifted fields we removed no longer appear in the writer
//      source (regression on the exact bugs).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PINNED_DOMAIN_COLUMNS,
  WRITER_COLUMN_SETS,
} from '../api/_shared/domain-writer-columns.js';

const repoRoot = process.cwd();
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');

describe('Prompt 78 — writer field sets are subsets of live schema', () => {
  for (const [writer, { table, columns }] of Object.entries(WRITER_COLUMN_SETS)) {
    it(`${writer} → ${table} writes only real columns`, () => {
      const pinned = PINNED_DOMAIN_COLUMNS[table];
      assert.ok(pinned, `no pinned column set for ${table}`);
      const pinnedSet = new Set(pinned);
      const drifted = columns.filter((c) => !pinnedSet.has(c));
      assert.deepEqual(
        drifted, [],
        `${writer} emits column(s) missing from ${table}: ${drifted.join(', ')} — schema drift = a lost PGRST204 write`,
      );
    });
  }
});

describe('Prompt 78 — the specific drifted fields are gone from the writers', () => {
  const sidebar = read('api/_handlers/sidebar-pipeline.js');
  const promoter = read('api/_handlers/intake-promoter.js');

  it('createSaleAlert no longer sends title/message/data_source/is_resolved', () => {
    const fn = sidebar.slice(
      sidebar.indexOf('async function createSaleAlert'),
      sidebar.indexOf('async function stageGovCompForSalesforce'),
    );
    assert.ok(fn.length > 0, 'createSaleAlert not found');
    for (const bad of ['title:', 'message:', 'data_source:', 'is_resolved:']) {
      assert.ok(!fn.includes(bad), `createSaleAlert still emits ${bad}`);
    }
    for (const good of ['alert_reason:', 'source:', 'resolved:']) {
      assert.ok(fn.includes(good), `createSaleAlert missing ${good}`);
    }
  });

  it('routeListingMisroute DB payload writes last_price, not list_price', () => {
    const start = sidebar.indexOf('routeListingMisroute');
    const recStart = sidebar.indexOf('const record = {', start);
    const record = sidebar.slice(recStart, sidebar.indexOf('};', recStart));
    assert.ok(record.includes('last_price:'), 'routeListingMisroute record missing last_price');
    assert.ok(!/\blist_price:/.test(record), 'routeListingMisroute record still emits list_price');
  });

  it('the dia contacts SF-link stamp is domain-gated to contact_fields_synced_at', () => {
    assert.ok(
      promoter.includes('contact_fields_synced_at'),
      'intake-promoter no longer gates the dia contacts sync stamp',
    );
  });
});

describe('Prompt 78 — additive migrations exist', () => {
  it('property_documents.source (dia + gov)', () => {
    for (const p of [
      'supabase/migrations/20260808120000_dia_prompt78_property_documents_source.sql',
      'supabase/migrations/government/20260808120000_gov_prompt78_property_documents_source.sql',
    ]) {
      assert.match(read(p), /ADD COLUMN IF NOT EXISTS source TEXT/);
    }
  });

  it('properties.last_ingested_at + sales_transactions.listing_sale_id (dia)', () => {
    assert.match(
      read('supabase/migrations/20260421200000_properties_last_ingested_at.sql'),
      /ADD COLUMN IF NOT EXISTS last_ingested_at/,
    );
    assert.match(
      read('supabase/migrations/20260415120000_sales_listing_sale_id.sql'),
      /ADD COLUMN IF NOT EXISTS listing_sale_id/,
    );
  });

  it('lease_escalations CoStar band columns (dia)', () => {
    const sql = read('supabase/migrations/20260808121000_dia_prompt78_lease_escalations_costar_band.sql');
    for (const col of ['rent_low_psf', 'rent_high_psf', 'rent_estimate_psf', 'expense_structure', 'escalation_source', 'data_source']) {
      assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`));
    }
  });
});
