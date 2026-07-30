// W2.5 (audit 3.3.1) — provenance_event_log flush transform helpers.
//
// The authoritative transform is the SQL RPC lcc_flush_provenance_events()
// (proven end-to-end by that migration's in-transaction self-rollback gate + the
// live drain recorded in the PR). These tests cover the pure JS helpers the
// admin.js handler shares with that contract: the marker predicate and the
// target_table normalization rule — the two places a bug would silently corrupt
// the ledger (merge a bulk marker as a real write, or write a bare table name
// that field_source_priority can't rank).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isProvenanceMarker,
  normalizeProvenanceTargetTable,
  buildProvenanceRunId,
} from '../api/_shared/provenance-flush.js';

describe('W2.5 isProvenanceMarker — never merge a historical bulk marker', () => {
  it('flags a <...> placeholder record pk', () => {
    assert.equal(isProvenanceMarker({ record_pk_value: '<bulk_backfill_QA22>', new_value: null }), true);
    assert.equal(isProvenanceMarker({ record_pk_value: '<bulk_backfill_QA24>', new_value: 'VA' }), true);
  });

  it('flags a metadata.kind=historical_bulk_update_marker row', () => {
    assert.equal(
      isProvenanceMarker({ record_pk_value: '5b1de7de', new_value: 'Federal', metadata: { kind: 'historical_bulk_update_marker' } }),
      true
    );
  });

  it('flags a row with no new value (nothing to merge)', () => {
    assert.equal(isProvenanceMarker({ record_pk_value: '5b1de7de', new_value: null }), true);
    assert.equal(isProvenanceMarker({ record_pk_value: '5b1de7de' }), true);
    assert.equal(isProvenanceMarker(null), true);
  });

  it('does NOT flag a real per-record field write', () => {
    assert.equal(
      isProvenanceMarker({ record_pk_value: '5b1de7de-7434-4c84-9bd2-bb5c61b8b0fc', new_value: 'Federal', metadata: { phase: 'backfill' } }),
      false
    );
    // a legitimate value that merely looks bracket-ish but isn't a placeholder
    assert.equal(isProvenanceMarker({ record_pk_value: '12345', new_value: 'DaVita' }), false);
  });
});

describe('W2.5 normalizeProvenanceTargetTable — domain-prefix bare table names', () => {
  it('prefixes a bare gov agency_classifier table', () => {
    assert.equal(normalizeProvenanceTargetTable('gov', 'sales_transactions'), 'gov.sales_transactions');
    assert.equal(normalizeProvenanceTargetTable('gov', 'properties'), 'gov.properties');
    assert.equal(normalizeProvenanceTargetTable('gov', 'leases'), 'gov.leases');
    assert.equal(normalizeProvenanceTargetTable('gov', 'property_agencies'), 'gov.property_agencies');
  });

  it('passes an already-prefixed name through unchanged', () => {
    assert.equal(normalizeProvenanceTargetTable('gov', 'gov.properties'), 'gov.properties');
    assert.equal(normalizeProvenanceTargetTable('dia', 'dia.properties'), 'dia.properties');
  });

  it('prefixes the dia domain correctly', () => {
    assert.equal(normalizeProvenanceTargetTable('dia', 'properties'), 'dia.properties');
  });
});

describe('W2.5 buildProvenanceRunId — preserve originating source lineage', () => {
  it('encodes source + event id', () => {
    assert.equal(buildProvenanceRunId('agency_classifier', 3), 'agency_classifier:evt3');
    assert.equal(buildProvenanceRunId('qa22_davita_brand_canonicalize', 94), 'qa22_davita_brand_canonicalize:evt94');
  });
  it('falls back to domain_trigger when source is missing', () => {
    assert.equal(buildProvenanceRunId(null, 7), 'domain_trigger:evt7');
  });
});
