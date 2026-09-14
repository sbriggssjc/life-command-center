-- ============================================================================
-- OCR2 — deed-lane OCR provenance: persist what the handler already computes
-- Domain: dialysis (zqzrriwuavgrquhisnoa)
--
-- THE DEFECT (measured 2026-09-02): `api/_handlers/document-text.js` builds
-- { method, ocr_tier, ocr_engine, ocr_pages, ocr_confidence } for every document
-- it extracts and returns them on the tick response, then the PATCH persists only
-- { raw_text, ingestion_status }. So the deed lane's tier mix — which engine read
-- which deed, at what page cost — is unauditable after the fact. Live before this
-- migration: gov 325 deeds with text / 0 with provenance; dia 182 / 0.
-- The CRE lane's sidecar (lcc_cre_property_document_text) records all four, which
-- is why every number on the CRE side is auditable and every number on the deed
-- side has been a guess.
--
-- ⚠️ THE HAZARD THIS MIGRATION EXISTS TO SURVIVE — `extracted_data` HAS TWO
-- WRITERS AND ONE OF THEM REPLACES THE WHOLE COLUMN.
--   deed-parser.js:557 does  extracted_data: { deed_extraction, extracted_at }
-- i.e. a WHOLESALE REPLACE, not a merge. So a provenance key written before the
-- deed parse is destroyed by it, and a later re-parse (processOneReparse, which
-- runs over stored raw_text) destroys one written on an earlier tick. Evidence
-- that this is real and not theoretical: on gov, all 185 deed rows carrying
-- extracted_data carry EXACTLY the two keys that write puts there and nothing
-- else; dia carries 10 rows with a third key (`r59_backfilled_at`, written by the
-- one call site that already merges) — so a sibling key CAN survive, and on the
-- parser's path it does not.
--
-- Hence: this RPC is the SINGLE OWNER of "merge into property_documents
-- .extracted_data". Both JS call sites (the provenance write and the deed
-- parser's own extraction write) go through it, so neither can clobber the other
-- and a third writer added later inherits the same guarantee.
--
-- ⚠️ PostgREST cannot merge jsonb in a PATCH, and a read-then-write from the
-- handler would RACE the deed parser inside the same tick. That is why this is an
-- RPC and not application-side logic.
--
-- DISCIPLINE: additive · fill-blanks (p_fill_blanks) · never fabricates · single
-- owner · reversible (drop the function + view; no column is added and no
-- existing row is rewritten by this migration).
--
-- DEPLOY ORDER: additive schema BEFORE the writer deploy. Apply this, then ship
-- the Railway redeploy. The RPC is unreferenced until the JS lands, so applying
-- it early is a no-op.
--
-- ⚠️ NO BACKFILL, DELIBERATELY. 507 deeds already carry text and their tier is
-- unknowable now — 154 of gov's 185 dated extractions ran 2026-07-15..07-25,
-- BEFORE DocAI went live 2026-08-12, when gpt-4o was the only OCR there was; the
-- other 140 gov rows carry no date at all. Writing a tier onto those would be a
-- fabrication (unknown is not a value). They stay `unrecorded` on the view below,
-- and `unrecorded` staying at its pre-change count is the verification.
--
-- REVERSAL:
--   drop view if exists public.v_dia_deed_ocr_provenance;
--   drop function if exists public.dia_merge_document_extracted_data(bigint, jsonb, text, boolean);
-- ============================================================================

-- ── 1. The single merge owner ───────────────────────────────────────────────
create or replace function public.dia_merge_document_extracted_data(
  p_document_id      bigint,
  p_patch            jsonb,
  p_ingestion_status text    default null,
  p_fill_blanks      boolean default false
) returns jsonb
language plpgsql
as $fn$
declare
  v_existing  jsonb;
  v_effective jsonb := '{}'::jsonb;
  v_written   text[] := '{}';
  v_skipped   text[] := '{}';
  v_key       text;
begin
  -- Never guess at a target. A null id is a caller bug, not a row to invent.
  if p_document_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_document_id');
  end if;

  -- A non-object patch would either no-op silently or corrupt the column.
  -- Refuse it by name so the caller can count the refusal.
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'patch_not_object');
  end if;

  -- FOR UPDATE: the deed parser and the provenance write touch this same row
  -- inside one tick. Serialising them here is what makes "neither clobbers the
  -- other" true under concurrency rather than only in call order.
  select coalesce(extracted_data, '{}'::jsonb)
    into v_existing
    from public.property_documents
   where document_id = p_document_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'document_not_found');
  end if;

  -- Per-KEY fill-blanks. Whole-object fill-blanks would be wrong: a patch
  -- carrying one new key and one existing key must write the new one.
  for v_key in select jsonb_object_keys(p_patch) loop
    if p_fill_blanks and (v_existing ? v_key) then
      v_skipped := v_skipped || v_key;
    else
      v_effective := v_effective || jsonb_build_object(v_key, p_patch -> v_key);
      v_written   := v_written || v_key;
    end if;
  end loop;

  if v_effective <> '{}'::jsonb or p_ingestion_status is not null then
    update public.property_documents
       set extracted_data  = v_existing || v_effective,   -- MERGE, never replace
           ingestion_status = coalesce(p_ingestion_status, ingestion_status)
     where document_id = p_document_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'keys_written', to_jsonb(v_written),
    'keys_skipped', to_jsonb(v_skipped),
    'status_set',   p_ingestion_status is not null
  );
end;
$fn$;

comment on function public.dia_merge_document_extracted_data(bigint, jsonb, text, boolean) is
  'OCR2 — the single owner of merging into property_documents.extracted_data. '
  'Exists because PostgREST cannot merge jsonb and because the deed parser used to '
  'REPLACE the whole column, destroying any sibling key. Merge, never replace.';

-- ⚠️ REVOKE FROM **BOTH** PUBLIC AND THE NAMED ROLES — MEASURED, NOT ASSUMED.
-- This repo already documents one half of the trap: `revoke ... from anon,
-- authenticated` does NOT remove the default PUBLIC grant on a new function.
-- The COMPLEMENTARY half bit this migration live, and only `has_function_privilege`
-- caught it: Supabase ships ALTER DEFAULT PRIVILEGES granting EXECUTE on new
-- functions to anon + authenticated, so at CREATE time those roles hold EXPLICIT
-- grants, and `revoke ... from public` alone leaves them intact. Measured after
-- the first apply: proacl = {postgres=X/postgres,anon=X/postgres,
-- authenticated=X/postgres,service_role=X/postgres} and
-- has_function_privilege('anon', ..., 'EXECUTE') = TRUE — i.e. the "fix" was a
-- no-op for the two roles that matter. Revoke BOTH, then grant the one role that
-- needs it, then ASSERT with has_function_privilege() rather than by re-reading
-- the REVOKE you just wrote. This is a WRITER reached only by the service key.
--   Verified live 2026-09-02: anon=false, authenticated=false, service_role=true.
revoke all on function public.dia_merge_document_extracted_data(bigint, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.dia_merge_document_extracted_data(bigint, jsonb, text, boolean) to service_role;

-- ── 2. The audit surface ────────────────────────────────────────────────────
-- One row per (state, method, tier, engine) over the WHOLE deed population, so
-- recorded and unrecorded are visible together and sum to the total. Reporting
-- only the recorded rows would let a lane that records nothing look empty rather
-- than blind.
-- ⚠️ This view is NEW. `create or replace view` is append-only for columns, so
-- whoever edits it next adds at the END of the select list or drops it first.
create or replace view public.v_dia_deed_ocr_provenance as
with deeds as (
  select
    document_id,
    extracted_data -> 'document_text' as dt
  from public.property_documents
  where lower(document_type) like '%deed%'
    and raw_text is not null
)
select
  case when dt is null then 'unrecorded' else 'recorded' end as provenance_state,
  dt ->> 'method'                                            as method,
  dt ->> 'ocr_tier'                                          as ocr_tier,
  dt ->> 'ocr_engine'                                        as ocr_engine,
  count(*)                                                   as docs,
  -- ⚠️ ocr_pages is what we were BILLED for; page_count is how long the document
  -- is. They are the same number for a whole-document read and differ for a
  -- windowed one, so they are reported separately and never summed together.
  avg(nullif(dt ->> 'ocr_pages', '')::numeric)::numeric(10,1) as avg_ocr_pages,
  sum(nullif(dt ->> 'ocr_pages', '')::numeric)               as total_ocr_pages,
  avg(nullif(dt ->> 'ocr_confidence', '')::numeric)::numeric(10,1) as avg_ocr_confidence,
  min(dt ->> 'extracted_at')                                 as first_extracted_at,
  max(dt ->> 'extracted_at')                                 as last_extracted_at
from deeds
group by 1, 2, 3, 4;

comment on view public.v_dia_deed_ocr_provenance is
  'OCR2 — deed-lane OCR tier mix. The `unrecorded` row is the pre-OCR2 backlog '
  '(tier unknowable; deliberately never backfilled). It must not fall.';

-- Same rule on the view: it is an internal audit surface, not an anon read.
revoke all on public.v_dia_deed_ocr_provenance from anon, authenticated;
grant select on public.v_dia_deed_ocr_provenance to service_role;
