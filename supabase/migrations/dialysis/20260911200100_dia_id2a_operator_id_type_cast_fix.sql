-- ============================================================================
-- ID2a follow-up: `operators.operator_id` is `integer`, not `bigint`.
--
-- Two schema-mismatch defects were found applying 20260911200000 to the live
-- Dialysis_DB project (zqzrriwuavgrquhisnoa) and are recorded here so a future
-- rebuild from this repo does not silently regress ("running but not merged",
-- inverted — see the ID1 audit's own doctrine section):
--
--   1. The committed migration assumed `operators.id` (bigint); the live PK
--      column is `operators.operator_id` (integer). Fixed in place in
--      20260911200000 (every `operators(id)` / `o.id` reference corrected to
--      `operator_id`) — that file now matches what was actually applied.
--   2. `dia_resolve_operator`'s `RETURNS TABLE(operator_id bigint, ...)`
--      requires an EXPLICIT cast at every `RETURN QUERY` site when the source
--      column is `integer`, even though a plain variable ASSIGNMENT
--      (`v_survivor := ...`) accepts the implicit widening for free. This
--      migration is that one-line fix, applied live 2026-09-11 immediately
--      after 20260911200000.
--
-- Nothing else changes. Idempotent (CREATE OR REPLACE).
-- ============================================================================

create or replace function public.dia_resolve_operator(p_text text)
returns table(operator_id bigint, canonical_name text, status text)
language plpgsql stable as $$
declare
  v_norm text := lower(btrim(coalesce(p_text, '')));
  v_alias_op bigint;
  v_survivor bigint;
  v_family_name text;
  v_family_status text;
begin
  if v_norm = '' then
    return query select null::bigint, null::text, 'blank'::text;
    return;
  end if;

  select a.operator_id into v_alias_op
    from public.dia_operator_aliases a
   where a.alias_norm = v_norm
   limit 1;

  if v_alias_op is not null then
    v_survivor := public.dia_operator_survivor(v_alias_op);
    return query
      select o.operator_id::bigint, o.name, 'matched'::text
        from public.operators o
       where o.operator_id = v_survivor;
    return;
  end if;

  v_family_name := public.dia_operator_from_tenant(p_text);
  if v_family_name is not null then
    return query
      select o.operator_id::bigint, o.name, 'matched'::text
        from public.operators o
       where lower(o.name) = lower(v_family_name)
         and o.merged_into_operator_id is null
       limit 1;
    if found then return; end if;
    return query select null::bigint, v_family_name, 'needs_review'::text;
    return;
  end if;

  v_family_status := public.dia_operator_tenant_status(p_text);
  return query
    select null::bigint, null::text,
           case when v_family_status = 'non_dialysis' then 'non_dialysis' else 'needs_review' end;
end;
$$;

comment on function public.dia_resolve_operator(text) is
  'ID2a: the single operator resolver. text in, (operator_id, canonical_name, '
  'status) out. status is matched | needs_review | non_dialysis | blank. '
  'NEVER mints a public.operators row. operator_id is explicitly cast to '
  'bigint (the live operators.operator_id column is integer) so the RETURNS '
  'TABLE contract is honoured — see the ID2a schema-mismatch fix note.';
