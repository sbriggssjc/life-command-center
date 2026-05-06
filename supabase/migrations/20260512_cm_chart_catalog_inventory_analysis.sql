-- Capital Markets — Inventory Analysis chart_template_ids (deliverable p.29-35).
--
-- Adds 6 new chart_template_ids that back the Inventory Analysis section of
-- the Dialysis Market Filter deliverable. These charts report on ACTIVE
-- listings (clinics currently on market) and are sourced from the new
-- cm_dialysis_active_listings_q + 5 derived rollup views shipped in the
-- companion DialysisProject migration 20260512_cm_dialysis_inventory_views.
--
-- Phase 5 is reserved for inventory-analysis templates so that:
--   - phase=lte.4 keeps the dashboard's default landing page lean
--   - phase=lte.5 (or no filter) opts in to the inventory section
-- The frontend can later choose to render these inline or behind a
-- collapsible "Inventory Analysis" section.

INSERT INTO public.cm_chart_catalog (
  chart_template_id, name, chart_type, data_shape, metric_focus,
  y_format_token, applies_to_verticals, view_name_template, phase
) VALUES
  -- p.29 — On-Market Snapshot (KPI block, current vs year-ago, 2 cohorts)
  ('inventory_snapshot_kpis',
   'On-Market Snapshot — KPI Block',
   'kpi_block',
   'kpi_snapshot_table',
   'active_inventory_kpis',
   'mixed',
   ARRAY['dialysis'],
   'cm_{vertical}_inventory_snapshot_kpis',
   5),

  -- p.30 top — Available Market Size (count bars + avg cap line, 2 cohorts)
  ('available_market_size_combo',
   'Available Market Size — Count + Avg Cap',
   'BarChart',
   'time_series_quarterly_combo',
   'active_market_size',
   'percent_basis_points',
   ARRAY['dialysis'],
   'cm_{vertical}_available_market_size_q',
   5),

  -- p.30 bottom — Avg Price + Cap Quartiles by Term Bucket (cross-section)
  ('available_by_term_bucket',
   'Available Listings by Term Bucket',
   'DataTable',
   'term_bucket_table',
   'term_bucket_pricing',
   'mixed',
   ARRAY['dialysis'],
   'cm_{vertical}_available_by_term_bucket',
   5),

  -- p.31 top — Asking Cap Rate Quartiles Over Time (4-line, 2 cohorts × upper/lower)
  ('asking_cap_quartiles_active',
   'Asking Cap Rate Quartiles — Active Listings',
   'LineChart',
   'time_series_quarterly_quartile',
   'asking_cap_quartiles',
   'percent_basis_points',
   ARRAY['dialysis'],
   'cm_{vertical}_asking_cap_quartiles_active_q',
   5),

  -- p.31 bottom — DOM + Price-Change Frequency over time, 2 cohorts
  ('dom_price_change_active',
   'DOM & Price-Change Frequency — Active Listings',
   'BarChart',
   'time_series_quarterly_combo',
   'active_dom_price_change',
   'integer_count',
   ARRAY['dialysis'],
   'cm_{vertical}_dom_price_change_active_q',
   5),

  -- p.32 — Available Clinics by Tenant (per-tenant summary table)
  ('available_by_tenant',
   'Available Clinics by Tenant',
   'DataTable',
   'tenant_summary_table',
   'tenant_inventory',
   'mixed',
   ARRAY['dialysis'],
   'cm_{vertical}_available_by_tenant',
   5)
ON CONFLICT (chart_template_id) DO UPDATE SET
  name = EXCLUDED.name,
  chart_type = EXCLUDED.chart_type,
  data_shape = EXCLUDED.data_shape,
  metric_focus = EXCLUDED.metric_focus,
  y_format_token = EXCLUDED.y_format_token,
  applies_to_verticals = EXCLUDED.applies_to_verticals,
  view_name_template = EXCLUDED.view_name_template,
  phase = EXCLUDED.phase;
