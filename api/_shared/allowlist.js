// ============================================================================
// API Allowlist — Controls which tables/views can be accessed via proxy
// Life Command Center — Backend Hardening (Phase 1)
// ============================================================================

// Government Supabase — allowed tables and views for read (GET)
export const GOV_READ_TABLES = new Set([
  'properties',
  'prospect_leads',
  'ownership_history',
  'contacts',
  'available_listings',
  'gsa_lease_events',
  'gsa_snapshots',
  'frpp_records',
  'county_authorities',
  'loans',
  'sales_transactions',
  'recorded_owners',
  'true_owners',
  'v_sales_comps',
  'v_available_listings',
  // Detail panel views
  'v_property_detail',
  'v_lease_detail',
  'v_property_operations',
  'v_ownership_chain',
  'v_ownership_current',
  'v_property_intel',
  'v_property_history',
]);

// Government Supabase — allowed tables for write (POST/PATCH)
export const GOV_WRITE_TABLES = new Set([
  'properties',
  'prospect_leads',
  'ownership_history',
  'contacts',
  'recorded_owners',
  'true_owners',
  'sales_transactions',
  'loans',
  'research_queue_outcomes',
  // RPC calls
  'rpc/upsert_lead',
  'rpc/save_research_outcome',
]);

// Dialysis Supabase — allowed tables and views for read (GET)
export const DIA_READ_TABLES = new Set([
  'v_counts_freshness',
  'v_clinic_inventory_diff_summary',
  'v_clinic_inventory_latest_diff',
  'v_facility_patient_counts_mom',
  'v_npi_inventory_signal_summary',
  'v_npi_inventory_signals',
  'v_clinic_property_link_review_queue',
  'v_clinic_lease_backfill_candidates',
  'v_ingestion_reconciliation',
  'v_clinic_research_priority',
  'v_cms_data',
  'v_sales_comps',
  'v_available_listings',
  'v_loans',
  'v_sf_activity_feed',
  'v_marketing_deals',
  'medicare_clinics',
  'available_listings',
  'marketing_leads',
  'research_queue_outcomes',
  'clinic_financial_estimates',
  'ownership_history',
  'bd_email_templates',
  'outbound_activities',
  'properties',
  'recorded_owners',
  'true_owners',
  'contacts',
  'sales_transactions',
  'loans',
  // Detail panel views (shared with GOV)
  'v_property_detail',
  'v_lease_detail',
  'v_ownership_current',
  'v_ownership_chain',
  'v_property_rankings',
]);

// Dialysis Supabase — allowed tables for write (POST/PATCH)
export const DIA_WRITE_TABLES = new Set([
  'research_queue_outcomes',
  'outbound_activities',
  'marketing_leads',
  'properties',
  'recorded_owners',
  'true_owners',
  'contacts',
  'sales_transactions',
  'loans',
  'v_clinic_property_link_review_queue',
  // RPC calls
  'rpc/upsert_research_outcome',
  'rpc/save_outbound_activity',
  'rpc/match_marketing_lead_to_sf',
]);

// Maximum allowed limits per request
export const MAX_LIMIT = 5000;
export const DEFAULT_LIMIT = 1000;

// Validate a table name against an allowlist
export function isAllowedTable(table, allowlist) {
  if (!table || typeof table !== 'string') return false;
  // Sanitize: only allow alphanumeric, underscore, forward slash (for rpc/)
  if (!/^[a-zA-Z0-9_/]+$/.test(table)) return false;
  return allowlist.has(table);
}

// Clamp limit to safe range
export function safeLimit(limit) {
  const n = parseInt(limit, 10);
  if (isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// Validate select parameter — only allow safe characters
export function safeSelect(select) {
  if (!select || typeof select !== 'string') return '*';
  // Allow: alphanumeric, underscore, comma, dot, parens, colon, star, space
  if (!/^[a-zA-Z0-9_,.*:()\s]+$/.test(select)) return '*';
  return select;
}

// Validate a column name in filter parameters — must be alphanumeric/underscore only
// Returns null if invalid, the column name if valid
export function safeColumn(col) {
  if (!col || typeof col !== 'string') return null;
  // Column names: only letters, digits, underscores
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) return null;
  return col;
}
