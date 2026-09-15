-- DEPLOY2-unapplied — a narrow, read-only schema-object existence probe.
--
-- WHY THIS EXISTS: the Node build-brief collector (scripts/build-brief-collector.mjs) parses
-- CREATE [OR REPLACE] FUNCTION|VIEW|TABLE|TRIGGER|INDEX|TYPE|POLICY statements out of recent
-- migration FILES (filesystem state, which Postgres cannot see) and needs to ask the LIVE
-- database whether each declared object actually exists (DB state, which Node cannot see without
-- a round trip). This RPC is that round trip's ONLY job: given a batch of {kind, name} pairs,
-- return which are present in pg_catalog. It answers EXISTENCE, never CONTENT — the collector's
-- "existence alone is a weaker verdict than absence" caveat is handled entirely in JS
-- (classifyMigrationApplication), not here.
--
-- ⚠️ THIS IS NOT THE XB2 AUDIT RPC. `public.lcc_build_brief_db_audit()` (the migration this repo's
-- own CLAUDE.md and 20260915120000's header both point to) answers questions Postgres already
-- knows the ANSWER to (flag staleness, producer stalls, market-brief lane freshness) — those
-- belong in that function by that migration's own stated split. This rule needs the migration
-- FILES too, which live only in the git checkout, so it cannot be answered by SQL alone and
-- belongs in the Node collector per that same split. This RPC is the minimal DB-side primitive
-- the Node rule needs; it is deliberately narrow (existence checks over four catalog tables) and
-- carries no application logic of its own.
--
-- SECURITY: reads pg_catalog only (proname/relname/tgname/polname — all already world-readable via
-- information_schema-style catalog views), so SECURITY INVOKER is correct and sufficient; there is
-- no privilege to escalate. Still explicitly revoked from PUBLIC/anon/authenticated and granted only
-- to service_role, per this repo's SECURITY DEFINER discipline extended defensively to every new
-- function regardless of definer status (CLAUDE.md's SEC1/OCR2/ADDR1b consolidated statement: never
-- read a privilege off the GRANT/REVOKE you wrote — assert it).

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
          -- BODY of an existing overload still reads "present" here. That is a KNOWN, DOCUMENTED
          -- weakness (see the collector header + this migration's header) -- existence is a
          -- weaker verdict than absence, never the reverse. It is exactly the XB2-precision shape.
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

do $$
begin
  if has_function_privilege('anon', 'public.lcc_probe_schema_objects(jsonb)', 'execute') then
    raise exception 'lcc_probe_schema_objects must not be anon-executable';
  end if;
  if has_function_privilege('authenticated', 'public.lcc_probe_schema_objects(jsonb)', 'execute') then
    raise exception 'lcc_probe_schema_objects must not be authenticated-executable';
  end if;
end $$;
