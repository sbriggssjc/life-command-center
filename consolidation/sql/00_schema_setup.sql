-- ============================================================================
-- consolidation/sql/00_schema_setup.sql
--
-- TEMPLATE — NOT FOR EXECUTION YET.
--
-- This is the Phase 1 schema-setup script for the Supabase consolidation
-- plan (see ../../SUPABASE_CONSOLIDATION_PLAN.md). It creates the four
-- domain schemas and sets up default privileges. It does NOT migrate
-- any data — that's Phase 2.
--
-- Run order:
--   1. Phase 0 sign-off (user approval)
--   2. Provision new Supabase Pro project in us-west-2, PG17
--   3. Run THIS script via `supabase db push` or the SQL editor
--   4. Verify schemas exist with: \dn (psql) or SELECT FROM pg_namespace
--   5. Proceed to Phase 2 data migration
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Schema creation
-- ----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS gov;
CREATE SCHEMA IF NOT EXISTS dia;
CREATE SCHEMA IF NOT EXISTS lcc;
CREATE SCHEMA IF NOT EXISTS ops;

COMMENT ON SCHEMA gov IS 'Government lease data (was: government project public schema)';
COMMENT ON SCHEMA dia IS 'Dialysis clinic data (was: Dialysis_DB project public schema)';
COMMENT ON SCHEMA lcc IS 'LCC operational entities and queue (was: LCC Opps public schema)';
COMMENT ON SCHEMA ops IS 'Workspace, sync, signals, context_packets (was: LCC Opps admin tables)';

-- ----------------------------------------------------------------------------
-- Schema-level grants
--
-- Pattern:
--   - service_role: full access (used by edge functions and LCC server)
--   - authenticated: SELECT only (locked down further per-table via RLS)
--   - anon: no access
-- ----------------------------------------------------------------------------

GRANT USAGE ON SCHEMA gov TO authenticated, service_role;
GRANT USAGE ON SCHEMA dia TO authenticated, service_role;
GRANT USAGE ON SCHEMA lcc TO authenticated, service_role;
GRANT USAGE ON SCHEMA ops TO authenticated, service_role;

-- service_role gets full DML on everything
GRANT ALL ON ALL TABLES IN SCHEMA gov TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA dia TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA lcc TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA ops TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA gov TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA dia TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA lcc TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ops TO service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA gov TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA dia TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA lcc TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ops TO service_role;

-- authenticated gets SELECT (further locked by RLS in lcc/ops)
GRANT SELECT ON ALL TABLES IN SCHEMA gov TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA dia TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA lcc TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA ops TO authenticated;

-- ----------------------------------------------------------------------------
-- Default privileges for tables created AFTER this script runs
--
-- Without this, every new table needs grants re-applied. With this, any
-- table created in these schemas inherits the privileges above.
-- ----------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA gov GRANT SELECT ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA dia GRANT SELECT ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA lcc GRANT SELECT ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT SELECT ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA gov GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA dia GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA lcc GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA gov GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA dia GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA lcc GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA gov GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA dia GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA lcc GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ----------------------------------------------------------------------------
-- RLS pattern example (for reference — not applied here)
--
-- Each tenant-scoped table in lcc / ops gets a policy. gov / dia tables
-- typically DON'T need RLS at the row level (they're operator data, not
-- tenant data) — schema-level grants above are sufficient for those.
--
-- Workspace-scoped pattern (apply per-table after data migration):
-- ----------------------------------------------------------------------------

-- ALTER TABLE lcc.entities ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY lcc_entities_select ON lcc.entities
--   FOR SELECT TO authenticated
--   USING (workspace_id = current_setting('lcc.workspace_id', true)::uuid);
--
-- CREATE POLICY lcc_entities_insert ON lcc.entities
--   FOR INSERT TO authenticated
--   WITH CHECK (workspace_id = current_setting('lcc.workspace_id', true)::uuid);
--
-- CREATE POLICY lcc_entities_update ON lcc.entities
--   FOR UPDATE TO authenticated
--   USING (workspace_id = current_setting('lcc.workspace_id', true)::uuid)
--   WITH CHECK (workspace_id = current_setting('lcc.workspace_id', true)::uuid);
--
-- CREATE POLICY lcc_entities_delete ON lcc.entities
--   FOR DELETE TO authenticated
--   USING (workspace_id = current_setting('lcc.workspace_id', true)::uuid);
--
-- -- Service role bypass (for edge functions)
-- CREATE POLICY lcc_entities_service ON lcc.entities
--   FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- Verification queries (run these after the script to confirm setup)
-- ----------------------------------------------------------------------------

-- 1. Schemas exist:
-- SELECT nspname FROM pg_namespace WHERE nspname IN ('gov','dia','lcc','ops');
-- Expected: 4 rows.

-- 2. Default privileges set:
-- SELECT nspname, defaclrole::regrole, defaclacl
--   FROM pg_default_acl
--   JOIN pg_namespace ON pg_namespace.oid = defaclnamespace
--   WHERE nspname IN ('gov','dia','lcc','ops');
-- Expected: rows for service_role + authenticated on each schema.

-- 3. service_role can create tables in each schema:
-- SET ROLE service_role;
-- CREATE TABLE gov._smoketest (id int);
-- DROP TABLE gov._smoketest;
-- RESET ROLE;
-- Expected: no errors.
