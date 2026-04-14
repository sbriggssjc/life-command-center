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
  'location_code_reference',
  'frpp_records',
  'county_authorities',
  'loans',
  'sales_transactions',
  'property_sale_events',
  'recorded_owners',
  'true_owners',
  'v_sales_comps',
  'v_available_listings',
  'v_property_latest_sale',
  // Detail panel views
  'v_property_detail',
  'v_lease_detail',
  'v_property_operations',
  'v_ownership_chain',
  'v_ownership_current',
  'v_property_intel',
  'v_property_history',
  // Overview pre-computed stats
  'mv_gov_overview_stats',
  // Research & Sales tables
  'sales_comps',
  'research_queue_outcomes',
  'pending_updates',
  'ingestion_tracker',
  'ingestion_log',
  // Unified Contact Hub
  'unified_contacts',
  'contact_change_log',
  'contact_merge_queue',
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
  'property_sale_events',
  'loans',
  'research_queue_outcomes',
  // Unified Contact Hub
  'unified_contacts',
  'contact_change_log',
  'contact_merge_queue',
  // RPC calls
  'rpc/upsert_lead',
  'rpc/save_research_outcome',
  'rpc/resolve_contact',
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
  'v_clinic_lease_data_gaps',
  'v_clinic_lease_renewal_watchlist',
  'v_ingestion_reconciliation',
  'v_clinic_research_priority',
  'v_cms_data',
  'v_sales_comps',
  'v_available_listings',
  'v_loans',
  'v_sf_activity_feed',
  'v_marketing_deals',
  'v_marketing_crm_tasks',
  'v_crm_client_rollup',
  'v_sf_tasks_contact_rollup',
  'v_opportunity_domain_classified',
  'salesforce_activities',
  'salesforce_tasks',
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
  'property_sale_events',
  'v_property_latest_sale',
  'sale_brokers',
  'brokers',
  'loans',
  // Detail panel views (shared with GOV)
  'v_property_detail',
  'v_lease_detail',
  'v_ownership_current',
  'v_ownership_chain',
  'v_property_rankings',
  // Operations tab — clinic detail data
  'facility_patient_counts',
  'clinic_trends',
  'clinic_quality_metrics',
  'facility_cost_reports',
  'leases',
  'lease_extensions',
  'lease_rent_schedule',
  'v_lease_extensions_summary',
  'v_clinic_payer_mix',
  'v_payer_mix_geo_averages',
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
  'property_sale_events',
  'loans',
  'v_clinic_property_link_review_queue',
  'salesforce_activities',
  // RPC calls
  'rpc/upsert_research_outcome',
  'rpc/save_outbound_activity',
  'rpc/match_marketing_lead_to_sf',
  'rpc/refresh_crm_rollup',
]);

// Government tables where writes MUST go through Gov write services (not raw proxy).
// Reads via the data proxy are still allowed — only POST/PATCH is blocked here.
export const GOV_WRITE_SERVICE_TABLES = new Set([
  'properties',
  'prospect_leads',
  'recorded_owners',
  'true_owners',
  'contacts',
  'research_queue_outcomes',
  'rpc/upsert_lead',
  'rpc/save_research_outcome',
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
