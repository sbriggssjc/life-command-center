-- DEPLOY2-coverage — the Dialysis_DB half of the schema-object existence probe.
--
-- Deliberate, byte-for-byte-in-contract PORT of the LCC Opps function shipped as
-- `supabase/migrations/20260916120100_lcc_deploy2_migration_probe_rpc.sql`. It exists because the
-- build-brief `migration_unapplied` rule (scripts/build-brief-collector.mjs) now scans
-- `supabase/migrations/dialysis/` as well as the root directory, and those migrations target
-- **Dialysis_DB `zqzrriwuavgrquhisnoa`**, not LCC Opps. Probing a dia-targeted migration against
-- LCC Opps would report every object absent -- a rule wrong on its entire output, which this arc
-- has already rejected twice (see the collector's own "REJECTED DESIGN" note).
--
-- WHY `dialysis/` IS IN SCOPE AT ALL: the previous window was root-only, justified as
-- "`dialysis/` and `government/` are historical copies of a database owned by another repo". That
-- is TRUE of `government/` (README + `HISTORICAL — DO NOT RE-APPLY` on every file + a guard) and
-- FALSE of `dialysis/`, which CLAUDE.md's own ownership table assigns to THIS repo. The cost of
-- the over-generalisation was exact: `20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql`
-- is OWNERGAP1, one of the three incidents the detector was built to catch, and it sat outside the
-- window. See ./README.md.
--
-- SECURITY — and this is where the port DELIBERATELY DIFFERS from the LCC copy, which is exactly
-- the thing ADDR1b says to check rather than inherit:
--   * The LCC probe is `service_role`-only because `LCC_SERVICE_ROLE_KEY` is a service key.
--   * The credential CI resolves for this project is `diaSupabaseKey()`
--     (api/_shared/supabase-keys.js), which prefers `DIA_SUPABASE_SERVICE_KEY` and falls back to
--     `DIA_SUPABASE_KEY`. Per GitHub issue #720 that fallback name "historically held the **anon**
--     JWT ... despite the names suggesting otherwise", and `DIA_SUPABASE_SERVICE_KEY` is not set on
--     Production today. So a `service_role`-only grant here would fail on EVERY run.
--   * Therefore: grant BOTH `service_role` AND `anon`, and assert both.
--   ⚠️ CONSEQUENCE, STATED NOT BURIED: this grants schema OBJECT-NAME ENUMERATION on Dialysis_DB to
--     any holder of the project's anon key. It is bounded in scope (names only -- never a row, a
--     definition, or a value; the names it can enumerate are already reachable through
--     `information_schema` for most roles) and bounded in TIME by issue #720's Phase 4 mass-revoke
--     of anon grants.
--   👉 WHEN #720 PHASE 4 LANDS (or the moment `DIA_SUPABASE_SERVICE_KEY` is set on Production):
--     REMOVE the `anon` grant below and flip its assertion to the negative form, matching the LCC
--     copy exactly. The resolver already prefers the service key, so nothing else has to change.
--
-- `SECURITY INVOKER` is KEPT (not upgraded to DEFINER): the function reads `pg_catalog` only, which
-- every role can already read, so there is no privilege to escalate and no reason to reach for
-- DEFINER. It answers EXISTENCE, never CONTENT.

drop function if exists public.lcc_probe_schema_objects(jsonb);

create or replace function public.lcc_probe_schema_objects(p_objects jsonb)
returns jsonb
language plpgsql
security invoker
stable
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_obj jsonb;
  v_kind text;
  v_name text;
  v_exists boolean;
begin
  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'p_objects must be a jsonb array of {kind, name}';
  end if;

  for v_obj in select * from jsonb_array_elements(p_objects)
  loop
    v_kind := lower(coalesce(v_obj->>'kind', ''));
    v_name := coalesce(v_obj->>'name', '');
    v_exists := false;

    if v_name <> '' then
      case v_kind
        when 'function' then
          -- Name-only match (no arg-type resolution): a CREATE OR REPLACE that only changed the
          -- BODY of an existing overload still reads "present" here. KNOWN and DOCUMENTED --
          -- existence is a weaker verdict than absence, never the reverse (the XB2-precision shape).
          select exists(select 1 from pg_proc where proname = v_name) into v_exists;
        when 'table' then
          select (to_regclass('public.' || v_name) is not null) into v_exists;
        when 'view' then
          select (to_regclass('public.' || v_name) is not null) into v_exists;
        when 'index' then
          select (to_regclass('public.' || v_name) is not null) into v_exists;
        when 'type' then
          select (to_regtype('public.' || v_name) is not null) into v_exists;
        when 'trigger' then
          select exists(select 1 from pg_trigger where tgname = v_name and not tgisinternal) into v_exists;
        when 'policy' then
          select exists(select 1 from pg_policy where polname = v_name) into v_exists;
        else
          v_exists := null; -- unknown kind: report null, never a false "absent"
      end case;
    end if;

    v_out := v_out || jsonb_build_object('kind', v_kind, 'name', v_name, 'exists', v_exists);
  end loop;

  return v_out;
end;
$$;

revoke all on function public.lcc_probe_schema_objects(jsonb) from public, anon, authenticated;
grant execute on function public.lcc_probe_schema_objects(jsonb) to service_role;
-- ⚠️ #720 PHASE 4: delete the next line and invert its assertion below.
grant execute on function public.lcc_probe_schema_objects(jsonb) to anon;

do $$
begin
  -- Never read a privilege off the GRANT/REVOKE you just wrote -- assert it
  -- (CLAUDE.md, consolidated SECURITY DEFINER PRIVILEGES statement).
  if not has_function_privilege('service_role', 'public.lcc_probe_schema_objects(jsonb)', 'execute') then
    raise exception 'lcc_probe_schema_objects must be service_role-executable';
  end if;
  -- Intentional, time-bounded: see the #720 note in this file's header.
  if not has_function_privilege('anon', 'public.lcc_probe_schema_objects(jsonb)', 'execute') then
    raise exception 'lcc_probe_schema_objects must be anon-executable until #720 Phase 4 (the CI key is the anon JWT)';
  end if;
  if has_function_privilege('authenticated', 'public.lcc_probe_schema_objects(jsonb)', 'execute') then
    raise exception 'lcc_probe_schema_objects must not be authenticated-executable';
  end if;
end $$;
