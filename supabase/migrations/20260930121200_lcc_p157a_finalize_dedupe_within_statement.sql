-- ============================================================================
-- P157a — lcc_finalize_owner_contact_signals aborts whenever one batch of
-- inflight responses carries the same owner twice.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-20.
-- ----------------------------------------------------------------------------
--   ERROR 21000: ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- Two paged pulls covering the same owner -- a retried sync, an overlapping
-- cron, or simply firing the sync twice before finalize -- put the same
-- (source_domain, source_true_owner_id) into ONE insert, and Postgres refuses.
--
-- The failure is SELF-PERPETUATING: when the statement aborts, the CTE that
-- deletes consumed rows from lcc_owner_signal_sync_inflight never runs either,
-- so the duplicates survive and the next finalize inherits them and fails
-- identically. Once triggered it would never recover on its own.
--
-- ⚠️ THIS WAS DORMANT ONLY BECAUSE OF P157. While the domain-side RLS defect
-- made every anon response an empty array, no batch ever contained two rows with
-- the same key, so this could not fire. Restoring the data flow is what exposed
-- it -- a reminder that "it has run green for months" can mean "nothing has
-- flowed through it for months".
--
-- FIX: DISTINCT ON (source_domain, true_owner_id) with the newest request_id
-- winning, so a batch carrying an owner twice collapses to the most recent
-- observation before the upsert sees it.
--
-- LIVE: finalize then returned (18, 1124) and the table moved to gov 743 /
-- dia 408, both written 2026-08-20 -- first write since 2026-07-28.
--
-- REVERSAL: restore the previous body (no `deduped` CTE; select straight from
-- `rows` with the WHERE true_owner_id IS NOT NULL predicate inline).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_finalize_owner_contact_signals()
 RETURNS TABLE(finalized_requests integer, rows_upserted integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_finalized int; v_upserted int;
BEGIN
  WITH consumed AS (
    SELECT i.request_id, i.source_domain, r.content
    FROM public.lcc_owner_signal_sync_inflight i
    JOIN net._http_response r ON r.id = i.request_id WHERE r.status_code = 200
  ),
  rows AS (
    SELECT request_id, source_domain, jsonb_array_elements(content::jsonb) AS row
      FROM consumed
  ),
  -- P157a: one row per (domain, owner) per statement; latest request wins.
  deduped AS (
    SELECT DISTINCT ON (source_domain, row->>'true_owner_id')
           source_domain, row
      FROM rows
     WHERE row->>'true_owner_id' IS NOT NULL
     ORDER BY source_domain, row->>'true_owner_id', request_id DESC
  ),
  upsert AS (
    INSERT INTO public.lcc_owner_contact_signals (
      source_domain, source_true_owner_id, true_owner_name, candidates, has_reg_address, reg_address, updated_at)
    SELECT source_domain, (row->>'true_owner_id')::text, NULLIF(row->>'true_owner_name',''),
           COALESCE(row->'candidates', '[]'::jsonb), COALESCE((row->>'has_reg_address')::boolean, false),
           NULLIF(btrim(row->>'reg_address'), ''), now()
    FROM deduped
    ON CONFLICT (source_domain, source_true_owner_id) DO UPDATE SET
      true_owner_name = EXCLUDED.true_owner_name, candidates = EXCLUDED.candidates,
      has_reg_address = EXCLUDED.has_reg_address, reg_address = EXCLUDED.reg_address, updated_at = now()
    RETURNING 1
  ),
  cleanup AS (DELETE FROM public.lcc_owner_signal_sync_inflight WHERE request_id IN (SELECT request_id FROM consumed) RETURNING 1)
  SELECT (SELECT count(*) FROM consumed), (SELECT count(*) FROM upsert) INTO v_finalized, v_upserted;
  DELETE FROM public.lcc_owner_signal_sync_inflight WHERE issued_at < now() - interval '24 hours';
  ANALYZE public.lcc_owner_contact_signals;
  finalized_requests := v_finalized; rows_upserted := v_upserted; RETURN NEXT;
END;
$function$;
