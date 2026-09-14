@echo off
cd /d "C:\Users\Scott\life-command-center"
git add sw.js supabase/functions/data-query/index.ts supabase/migrations/20260416233000_dia_hardening_indexes_ingestion.sql supabase/migrations/20260416234000_gov_hardening_indexes.sql supabase/migrations/20260416235000_dia_check_constraints_fk_cascades.sql supabase/migrations/20260416236000_gov_check_constraints_fk_cascades.sql supabase/migrations/20260416230000_v_npi_inventory_signal_summary.sql supabase/migrations/20260416231000_lease_extensions_and_rent_schedule.sql supabase/migrations/20260416232000_gov_property_sale_events_and_ingestion_log.sql
git commit -m "Round 42: DB hardening — indexes, ingestion_log, CHECK constraints, FK cascades, edge function allowlist update"
git push origin main
