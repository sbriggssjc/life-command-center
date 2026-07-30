// ============================================================================
// W2.5 — provenance_event_log flush: pure transform helpers.
//
// The authoritative transform lives in the SQL RPC lcc_flush_provenance_events()
// (supabase/migrations/20260813120000_lcc_w2_5_provenance_event_flush.sql) and is
// proven end-to-end by that migration's in-transaction self-rollback gate + the
// live drain. These JS mirrors exist so the admin.js handler (dry-run
// classification + cursor bookkeeping) and its tests share ONE definition of the
// marker predicate and the target_table normalization rule, rather than
// re-encoding them inline.
// ============================================================================

/**
 * A provenance_event_log row is a historical bulk-UPDATE acknowledgement marker
 * (not a real per-record field write) when it has no resolvable record pk, its
 * pk is a `<...>` placeholder, its metadata says so, or it carries no new value.
 * Markers are drained (acknowledged) but never merged into the ledger.
 * @param {object} e a provenance_event_log row (new_value already JSON-parsed)
 * @returns {boolean}
 */
export function isProvenanceMarker(e) {
  if (!e) return true;
  const pk = e.record_pk_value;
  if (pk == null) return true;
  if (typeof pk === 'string' && pk.startsWith('<') && pk.endsWith('>')) return true;
  if (e.metadata && e.metadata.kind === 'historical_bulk_update_marker') return true;
  if (e.new_value == null) return true;
  return false;
}

/**
 * Normalize a domain event's target_table to the field_provenance / field_source_priority
 * domain-prefixed convention. The gov agency_classifier writes BARE table names
 * (`sales_transactions`, `properties`, …); the QA markers and the dia trigger
 * write already-prefixed names (`gov.properties`, `dia.properties`). A bare name
 * gets the domain prefix; an already-prefixed name passes through unchanged.
 * @param {'dia'|'gov'} domain
 * @param {string} rawTable
 * @returns {string}
 */
export function normalizeProvenanceTargetTable(domain, rawTable) {
  const raw = String(rawTable || '');
  return raw.includes('.') ? raw : `${domain}.${raw}`;
}

/**
 * Preserve the originating source lineage in the lcc_merge_field source_run_id
 * (the flushed rows all carry source='domain_trigger', so the real writer —
 * agency_classifier / qa22_davita_brand_canonicalize / … — rides here).
 * @param {string} source
 * @param {number|string} eventId
 * @returns {string}
 */
export function buildProvenanceRunId(source, eventId) {
  return `${source || 'domain_trigger'}:evt${eventId}`;
}
