// W2.2 (audit 3.3.3 / 3.3.8) — provenance records EFFECT, not intent.
//
// The sidebar sale writer used to (a) flush provenance from the UNFILTERED
// saleData (so fields the strict field-priority gate dropped were still recorded
// as written) and (b) drive the parser-diagnostic written_* booleans off the
// same intent payload, and it dropped explicit nulls entirely. W2.2 repoints all
// of that at what actually LANDED: the FILTERED payload that was sent, gated on
// the write result, with explicit clears recorded as decision='cleared' and
// failed writes as decision='failed_write'.
//
// These tests cover the pure helpers that encode that contract (the DB effect of
// failed_write/cleared is proven in the migration's in-transaction DO block:
// supabase/migrations/20260812130000_lcc_w2_2_provenance_record_effect.sql).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveProvenanceRecording,
  buildSalesProvenanceFields,
  pushSalesProvenance,
  computeWrittenSalesFlags,
  SALES_PROV_FIELDS,
} from '../api/_handlers/sidebar-pipeline.js';

describe('W2.2 buildSalesProvenanceFields — record only what was SENT', () => {
  it('a field the priority gate DROPPED is not recorded (record effect, not intent)', () => {
    // saleData carried buyer + sold_cap_rate, but the strict gate blocked
    // sold_cap_rate → it is absent from the filtered payload that was sent.
    const filteredSalesPatch = {
      sale_date: '2026-01-15',
      sold_price: 4_200_000,
      buyer: 'ACME OWNER LLC',
      // sold_cap_rate intentionally absent — blocked by a higher-trust source
    };
    const fields = buildSalesProvenanceFields(filteredSalesPatch);
    assert.equal('sold_cap_rate' in fields, false, 'blocked field must NOT be recorded');
    assert.equal(fields.buyer, 'ACME OWNER LLC');
    assert.equal(fields.sold_price, 4_200_000);
  });

  it('preserves an explicit null (a deliberately-cleared column) so it can be logged as cleared', () => {
    const filteredSalesPatch = { sale_date: '2026-01-15', stated_cap_rate: null };
    const fields = buildSalesProvenanceFields(filteredSalesPatch);
    assert.equal('stated_cap_rate' in fields, true);
    assert.equal(fields.stated_cap_rate, null);
  });

  it('ignores non-curated keys and never crashes on a bad payload', () => {
    assert.deepEqual(buildSalesProvenanceFields({ some_random_col: 1 }), {});
    assert.deepEqual(buildSalesProvenanceFields(null), {});
    assert.deepEqual(buildSalesProvenanceFields(undefined), {});
  });

  it('the curated set spans both dia and gov column names', () => {
    for (const k of ['buyer', 'buyer_name', 'seller', 'seller_name',
                     'stated_cap_rate', 'sold_cap_rate', 'purchasing_broker',
                     'procuring_broker']) {
      assert.ok(SALES_PROV_FIELDS.includes(k), `${k} should be a curated prov field`);
    }
  });
});

describe('W2.2 pushSalesProvenance — a failed PATCH records decision=failed_write', () => {
  it('failed write → forceDecision=failed_write on the collected entry', () => {
    const coll = [];
    pushSalesProvenance(coll, 42, { sale_date: '2026-01-15', buyer: 'ACME LLC' }, { ok: false, status: 400 });
    assert.equal(coll.length, 1);
    assert.equal(coll[0].table, 'sales_transactions');
    assert.equal(coll[0].recordPk, '42');
    assert.equal(coll[0].forceDecision, 'failed_write');
    assert.equal(coll[0].recordNulls, true);
    assert.equal(coll[0].fields.buyer, 'ACME LLC');
  });

  it('successful write → no forced decision (lcc_merge_field decides write/skip/conflict)', () => {
    const coll = [];
    pushSalesProvenance(coll, 42, { sale_date: '2026-01-15', buyer: 'ACME LLC' }, { ok: true });
    assert.equal(coll.length, 1);
    assert.equal(coll[0].forceDecision, null);
  });

  it('an empty/absent payload pushes nothing (nothing to record)', () => {
    const coll = [];
    pushSalesProvenance(coll, 42, {}, { ok: true });
    pushSalesProvenance(coll, 42, null, { ok: true });
    assert.equal(coll.length, 0);
  });
});

describe('W2.2 resolveProvenanceRecording — explicit null becomes cleared', () => {
  it('an explicit null is recorded as decision=cleared (not dropped)', () => {
    assert.deepEqual(resolveProvenanceRecording(null, null),
      { value: null, forceDecision: 'cleared' });
  });

  it('undefined (an ABSENT field) is dropped', () => {
    assert.equal(resolveProvenanceRecording(undefined, null), null);
  });

  it('a real value records normally with no forced decision', () => {
    assert.deepEqual(resolveProvenanceRecording('ACME LLC', null),
      { value: 'ACME LLC', forceDecision: null });
  });

  it('failed_write wins over an explicit null (nothing landed, cleared or not)', () => {
    assert.deepEqual(resolveProvenanceRecording(null, 'failed_write'),
      { value: null, forceDecision: 'failed_write' });
    assert.deepEqual(resolveProvenanceRecording('ACME LLC', 'failed_write'),
      { value: 'ACME LLC', forceDecision: 'failed_write' });
  });
});

describe('W2.2 computeWrittenSalesFlags — diagnostics measure what LANDED', () => {
  it('an empty payload (failed write / nothing survived the gate) is all-false', () => {
    const w = computeWrittenSalesFlags({});
    assert.equal(w.written_buyer, false);
    assert.equal(w.written_seller, false);
    assert.equal(w.written_listing_broker, false);
    assert.equal(w.written_procuring_broker, false);
    assert.equal(w.written_cap_rate, false);
    assert.equal(w.written_sold_price, false);
  });

  it('undefined payload is treated as nothing-landed', () => {
    const w = computeWrittenSalesFlags(undefined);
    assert.equal(w.written_buyer, false);
    assert.equal(w.written_sold_price, false);
  });

  it('gov column names (buyer / purchasing_broker / sold_cap_rate) count as written', () => {
    const w = computeWrittenSalesFlags({
      buyer: 'ACME LLC', seller: 'SELLER LP', purchasing_broker: 'CBRE',
      sold_cap_rate: 0.0725, sold_price: 4_200_000,
    });
    assert.equal(w.written_buyer, true);
    assert.equal(w.written_seller, true);
    assert.equal(w.written_procuring_broker, true);
    assert.equal(w.written_cap_rate, true);
    assert.equal(w.written_sold_price, true);
  });

  it('dia column names (buyer_name / procuring_broker / stated_cap_rate) count as written', () => {
    const w = computeWrittenSalesFlags({
      buyer_name: 'ACME LLC', procuring_broker: 'JLL', listing_broker: 'CBRE',
      stated_cap_rate: 0.06, sold_price: 1,
    });
    assert.equal(w.written_buyer, true);
    assert.equal(w.written_procuring_broker, true);
    assert.equal(w.written_listing_broker, true);
    assert.equal(w.written_cap_rate, true);
  });

  it('a zero/blank sold_price does not count as written', () => {
    assert.equal(computeWrittenSalesFlags({ sold_price: 0 }).written_sold_price, false);
    assert.equal(computeWrittenSalesFlags({ sold_price: null }).written_sold_price, false);
  });

  it('a whitespace-only broker string does not count as written', () => {
    assert.equal(computeWrittenSalesFlags({ listing_broker: '   ' }).written_listing_broker, false);
  });
});

// End-to-end contract summary (the three required fixtures, cross-referenced):
//   1. blocked-field not recorded ....... buildSalesProvenanceFields drops it
//   2. failed PATCH → failed_write ...... pushSalesProvenance + resolveProvenanceRecording
//   3. null → cleared ................... resolveProvenanceRecording(null) → cleared
