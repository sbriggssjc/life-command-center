-- ============================================================================
-- 20260728120000_rls_security_hardening_ops.sql
-- OPS project (xengecqvemvfknjvbvrq) — security-advisor ERROR remediation (135 -> 0).
-- Applied live 2026-07-28 via Supabase MCP; committed here for version control.
--
-- Safe because: the engine's OPS connection uses the SERVICE_ROLE key (bypasses RLS),
-- and the frontend/extension use the anon key ONLY for Supabase Auth (never direct
-- table/view reads). Verified post-apply: cadence-scan (21 open/4 overdue, unchanged)
-- and get_pipeline_health (reads a dozen v_* views) both returned full data.
-- ============================================================================

-- 1) CRITICAL: OAuth tokens (access_token/refresh_token) were API-reachable with no RLS.
alter table public.cortex_oauth_tokens enable row level security;
revoke all on public.cortex_oauth_tokens from anon, authenticated;

-- 2) Enable RLS on the remaining exposed public tables (deny-all for anon/authenticated;
--    service_role bypasses). Idempotent: ENABLE on an already-enabled table is a no-op.
alter table public._recon_merge_log                    enable row level security;
alter table public.cortex_contact_moves                enable row level security;
alter table public.cortex_discovery_requests           enable row level security;
alter table public.cortex_entity_link_log              enable row level security;
alter table public.cortex_entity_promotion_queue       enable row level security;
alter table public.cortex_file_moves                   enable row level security;
alter table public.cortex_hygiene_targets              enable row level security;
alter table public.cortex_janitor_rules                enable row level security;
alter table public.cortex_janitor_suggestions          enable row level security;
alter table public.cortex_market_intel                 enable row level security;
alter table public.cortex_owner_identities             enable row level security;
alter table public.cortex_skill_updates                enable row level security;
alter table public.lcc_boyd_reconcile_2026_07          enable row level security;
alter table public.lcc_institution_contacts            enable row level security;
alter table public.lcc_owner_address_observations      enable row level security;
alter table public.lcc_owner_address_reconcile_state   enable row level security;
alter table public.lcc_owner_evidence_cache            enable row level security;
alter table public.lcc_owner_link_observations         enable row level security;
alter table public.lcc_owner_reconcile                 enable row level security;
alter table public.lcc_owner_reconcile_evidence        enable row level security;
alter table public.lcc_owner_reconcile_queue           enable row level security;
alter table public.lcc_reconcile_config                enable row level security;
alter table public.lcc_refresh_log                     enable row level security;
alter table public.lcc_reusable_owner_contacts         enable row level security;
alter table public.lcc_sf_list_membership              enable row level security;
alter table public.lcc_signal_authority                enable row level security;
alter table public.lcc_users                           enable row level security;
alter table public.merge_sf_pinned_widen_backup        enable row level security;
alter table public.processing_log                      enable row level security;
alter table public.r40_merge_reconcile_backup          enable row level security;
alter table public.sf_account_on_person_cleanup_backup enable row level security;
alter table public.sf_contact_resolve_queue            enable row level security;
alter table public.todo_task_map                       enable row level security;

-- 3) Flip the 100 API-exposed views to security_invoker so they respect the caller's RLS.
--    Only regular views (relkind='v') — matviews auto-skipped. Idempotent.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v' and c.relname in ('cm_natl_st_avg_deal_q','cm_natl_st_buyer_share_y','cm_natl_st_cap_quartile_q','cm_natl_st_cap_ttm_q','cm_natl_st_cap_yoy_q','cm_natl_st_cost_of_capital_q','cm_natl_st_count_ttm_q','cm_natl_st_macro_rates_q','cm_natl_st_net_lease_spread_q','cm_natl_st_nm_share_y','cm_natl_st_nm_vs_market_q','cm_natl_st_rca_unioned','cm_natl_st_returns_indexes_q','cm_natl_st_sources_capital','cm_natl_st_top_buyers','cm_natl_st_top_sellers','cm_natl_st_volume_ttm_q','cm_natl_st_yoy_change_q','cortex_entity_promotion_candidates','cross_domain_contacts','high_performing_templates','ignored_recommendation_contacts','slow_action_report','v_bridge_freshness','v_client_error_rollup','v_competitive_touches','v_composite_unique_with','v_connector_checklist','v_cron_health_summary','v_duplicate_candidates','v_email_lifecycle','v_entity_completeness','v_entity_timeline','v_feed_freshness','v_field_provenance_actionable','v_field_provenance_conflict_classified','v_field_provenance_conflicts','v_field_provenance_current','v_field_provenance_review_queue','v_field_provenance_unranked','v_field_provenance_warn_strict_skips','v_field_provenance_would_block','v_field_source_priority_invalid_columns','v_field_source_priority_unobserved','v_fk_references_to','v_flow_run_failures_open','v_inbox_triage','v_ingest_write_failures_24h','v_ingest_write_failures_by_label','v_ingest_write_failures_recent','v_ingest_write_failures_top_24h','v_lcc_buyer_spe_entities','v_lcc_buyer_spe_entities_live','v_lcc_canonical_twin_candidates','v_lcc_contact_writeback_candidates','v_lcc_cre_bov_ready','v_lcc_date_uncertain_recovery_map','v_lcc_decision_open_counts','v_lcc_exact_name_merge_candidates','v_lcc_health_alerts_open','v_lcc_merge_candidates','v_lcc_missing_comp_ids','v_lcc_on_market_backfill_map','v_lcc_owner_address_coverage','v_lcc_owner_address_dimension','v_lcc_owner_link_review','v_lcc_owner_reconcile_review','v_lcc_owner_shared_address','v_lcc_reusable_owner_contacts','v_lcc_sf_account_shared_entities','v_lcc_trigger_band_properties','v_lcc_trigger_band_rollup','v_lcc_true_owner_noise','v_manager_overview','v_matcher_accuracy_recent','v_mv_freshness','v_my_work','v_news_alert_developer_queue','v_news_alert_review_queue','v_orphaned_actions','v_overdue_touchpoints','v_perf_endpoint_summary','v_perf_hourly_throughput','v_perf_slow_requests','v_perf_target_compliance','v_perf_workspace_summary','v_priority_queue','v_priority_queue_band_counts','v_priority_queue_enriched','v_priority_queue_live','v_processing_log_daily','v_research_queue','v_sales_parser_miss_rates_7d','v_stale_identities','v_stuck_intakes','v_sync_exceptions','v_team_queue','v_unassigned_work','v_unlinked_entities','v_work_counts')
  loop
    execute format('alter view public.%I set (security_invoker = on)', r.relname);
  end loop;
end $$;
