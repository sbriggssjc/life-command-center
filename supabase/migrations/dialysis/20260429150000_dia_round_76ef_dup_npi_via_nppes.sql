-- ============================================================================
-- Round 76ef — Duplicate NPI auto-resolve via NPPES authoritative address
--
-- Phase 3 of the NPI-signals self-cleaning sequence. The Phase 1 resolver
-- (76eb) handled same-address NPI clusters by promoting one to is_primary_ccn.
-- That left ~842 actionable duplicate rows (155 data_error pairs + 228 same-
-- name multi-loc pairs) where the cluster spans multiple addresses and we
-- couldn't auto-pick a winner.
--
-- Phase 2 (76ed) populated npi_registry weekly with NPPES practice addresses
-- for every ESRD NPI. So now: for each multi-address dup cluster, the NPPES
-- address is the authoritative tiebreaker. The medicare_clinics row whose
-- address matches NPPES keeps the NPI; the rest get NPI cleared (which makes
-- them missing_inventory_npi rows that the Phase 1 NPPES auto-fill will
-- attempt to re-resolve on its next run).
--
-- Conservative: only auto-clears when (a) winner address exact-matches
-- NPPES, AND (b) no other row in the cluster also matches. Otherwise the
-- cluster stays in the human review queue.
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_auto_resolve_dup_npi_via_nppes()
RETURNS TABLE (
  clusters_processed integer,
  clusters_auto_cleared integer,
  rows_npi_cleared integer,
  clusters_ambiguous integer,
  clusters_no_nppes integer
) LANGUAGE plpgsql AS $func$
DECLARE
  v_clusters     integer := 0;
  v_resolved     integer := 0;
  v_rows_cleared integer := 0;
  v_ambiguous    integer := 0;
  v_no_nppes     integer := 0;
  v_step         integer;
  r              record;
  v_winner_id    text;
  v_winner_score numeric;
  v_runner_score numeric;
  v_match_count  integer;
BEGIN
  -- Iterate each NPI cluster with > 1 active medicare_clinics row.
  FOR r IN
    SELECT npi
    FROM public.medicare_clinics
    WHERE COALESCE(npi,'') <> '' AND is_active
    GROUP BY npi
    HAVING COUNT(*) > 1
       AND COUNT(DISTINCT lower(regexp_replace(coalesce(address,''),'[^a-z0-9]+','','gi'))
                || '|' || upper(coalesce(state,''))) > 1   -- skip same-address clusters (76eb handles those)
  LOOP
    v_clusters := v_clusters + 1;

    -- Score each cluster member's address against NPPES practice address.
    --   exact normalized match     = 1.0
    --   street-number + first-word = 0.7  (handles "St" vs "Street" abbrev)
    --   else                       = 0
    -- Returns: (winner_medicare_id, winner_score, runner_score, no_nppes_count, match_count_>=0.7)
    SELECT
      MAX(CASE WHEN rn = 1 THEN medicare_id END),
      MAX(CASE WHEN rn = 1 THEN score END),
      MAX(CASE WHEN rn = 2 THEN score END),
      COUNT(*) FILTER (WHERE no_nppes),
      COUNT(*) FILTER (WHERE score >= 0.7)
    INTO v_winner_id, v_winner_score, v_runner_score, v_step, v_match_count
    FROM (
      SELECT mc.medicare_id, n.norm_addr IS NULL AS no_nppes,
             CASE
               WHEN n.norm_addr IS NULL THEN NULL
               WHEN lower(regexp_replace(coalesce(mc.address,''),'[^a-z0-9]+','','gi')) = n.norm_addr
                 AND upper(coalesce(mc.state,'')) = n.st THEN 1.0
               WHEN lower(split_part(btrim(mc.address),' ',1)) = n.num
                 AND lower(split_part(btrim(mc.address),' ',2)) = n.street1
                 AND n.num ~ '^\d+$'
                 AND upper(coalesce(mc.state,'')) = n.st THEN 0.7
               ELSE 0.0
             END AS score,
             ROW_NUMBER() OVER (ORDER BY
               CASE
                 WHEN n.norm_addr IS NULL THEN NULL
                 WHEN lower(regexp_replace(coalesce(mc.address,''),'[^a-z0-9]+','','gi')) = n.norm_addr
                   AND upper(coalesce(mc.state,'')) = n.st THEN 1.0
                 WHEN lower(split_part(btrim(mc.address),' ',1)) = n.num
                   AND lower(split_part(btrim(mc.address),' ',2)) = n.street1
                   AND n.num ~ '^\d+$'
                   AND upper(coalesce(mc.state,'')) = n.st THEN 0.7
                 ELSE 0.0
               END DESC NULLS LAST, mc.medicare_id) AS rn
      FROM public.medicare_clinics mc
      LEFT JOIN (
        SELECT lower(regexp_replace(coalesce(npi_address,''),'[^a-z0-9]+','','gi')) AS norm_addr,
               upper(coalesce(npi_state,''))                                         AS st,
               lower(split_part(btrim(npi_address),' ',1))                           AS num,
               lower(split_part(btrim(npi_address),' ',2))                           AS street1
        FROM public.npi_registry
        WHERE npi = r.npi AND is_esrd_taxonomy
        LIMIT 1
      ) n ON true
      WHERE mc.npi = r.npi AND mc.is_active
    ) z;

    -- Decision tree
    IF v_step > 0 THEN
      v_no_nppes := v_no_nppes + 1;
      CONTINUE;                   -- no NPPES record for this NPI; skip cluster
    END IF;

    IF v_winner_score >= 0.9 AND v_match_count = 1 THEN
      -- Decisive winner: clear NPI on losers.
      UPDATE public.medicare_clinics
         SET npi = NULL,
             compliance_flag_reason = COALESCE(compliance_flag_reason || '; ', '')
                                      || 'auto-cleared duplicate NPI (NPPES address resolved to ' || v_winner_id || ')',
             updated_at = now()
       WHERE npi = r.npi
         AND medicare_id <> v_winner_id
         AND is_active;
      GET DIAGNOSTICS v_step = ROW_COUNT;
      v_rows_cleared := v_rows_cleared + v_step;
      v_resolved     := v_resolved + 1;

      INSERT INTO public.npi_signal_auto_resolutions(
        resolution_kind, npi, winner_medicare_id, loser_medicare_ids,
        cluster_size, reason
      )
      SELECT 'duplicate_npi_nppes_address_resolve',
             r.npi,
             v_winner_id,
             array_agg(medicare_id) FILTER (WHERE medicare_id <> v_winner_id),
             COUNT(*)::int,
             'NPPES practice address matched ' || v_winner_id || '; cleared NPI on others'
      FROM public.medicare_clinics WHERE npi = r.npi AND is_active;
    ELSE
      v_ambiguous := v_ambiguous + 1;
    END IF;
  END LOOP;

  clusters_processed     := v_clusters;
  clusters_auto_cleared  := v_resolved;
  rows_npi_cleared       := v_rows_cleared;
  clusters_ambiguous     := v_ambiguous;
  clusters_no_nppes      := v_no_nppes;
  RETURN NEXT;
END $func$;

GRANT EXECUTE ON FUNCTION public.dia_auto_resolve_dup_npi_via_nppes() TO anon;

-- Schedule: 06:46 UTC daily (after 06:45 same-address resolver, before 06:50 refresh)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('auto-resolve-dup-npi-via-nppes'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'auto-resolve-dup-npi-via-nppes',
      '46 6 * * *',
      'SELECT public.dia_auto_resolve_dup_npi_via_nppes();'
    );
  END IF;
END $cron$;
