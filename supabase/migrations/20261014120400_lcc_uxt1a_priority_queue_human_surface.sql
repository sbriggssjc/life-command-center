-- UX-T1a Unit 3 — take the plumbing bands off the human surface WITHOUT deleting them.
-- APPLIED LIVE to xengecqvemvfknjvbvrq 2026-09-03 (as two migrations, consolidated here).
--
-- Measured 2026-09-03 over v_priority_queue_enriched (1,635 rows):
--   HIDDEN (941 rows / 939 owners) — every one has an AUTOMATED consumer already:
--     P0.4  resolve_ownership_control    555  -> A2 applies the `agrees` bucket, cron 244
--     P-CONTACT select_prospecting_contact 216 -> Tier 0 lane + the TIER0_AUTO_ATTACH sweep
--     P0.5  open_bd_opportunity_needed   148  -> CRM hygiene; no human judgement in it
--     P-BUYER repeat_buyer_relationship   22  -> buyers are pursued by SHOWING them deals
--                                               (doctrine 0.3), not by working a queue row
--   SHOWN  (694 rows / 346 owners) — the seller-timing bands:
--     P8 213, P3 166, P1 147, P2 95, P5 59, P4 14.
-- 694 reproduces the Part A audit's seller-timing figure EXACTLY.
-- ⚠️ P-CONTACT reads 216 here against the audit's 231 -- ordinary day-to-day drift.
-- Re-derive these numbers; do not quote them.
--
-- NOTHING IS DELETED AND NOTHING IS FILTERED IN THE VIEW. This adds a flag; the surfaces
-- choose. Deleting these rows would break the automated consumers above, and filtering
-- inside the view would hide them from those consumers too. A band is hidden from a
-- HUMAN, not retired from the system.
--
-- ⚠️ KEYED ON priority_band, NOT reason. `reason` carries per-row suffixes
-- (`agency_active_solicitations:23`, `repeat_buyer_relationship:238`,
-- `aged_building_value_add:built_1921`), so a reason-keyed predicate would match some
-- rows of a band and not others -- the band is the stable classifier.
--
-- Reverse: re-create v_priority_queue_enriched from its prior body (kept in
-- `_uxt1a_pq_enriched_body_backup_20260903`), restore v_priority_queue_band_counts to
-- (priority_band, n), drop the two `human_surface=is.true` filters in api/admin.js, then
-- DROP FUNCTION public.lcc_priority_band_is_human_surface(text).

-- Single owner of the classification. IMMUTABLE so it can be indexed/inlined; a JS copy
-- of this band list is the normaliser drift this repo warns about a dozen times --
-- surfaces read the column, they do not restate the list.
CREATE OR REPLACE FUNCTION public.lcc_priority_band_is_human_surface(p_band text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  -- Default TRUE: a band nobody has classified reaches the operator rather than
  -- silently vanishing. An unknown band showing up as noise is a visible problem;
  -- an unknown band hidden by default is an invisible one.
  SELECT COALESCE(p_band, '') NOT IN ('P0.4', 'P-CONTACT', 'P0.5', 'P-BUYER');
$fn$;

COMMENT ON FUNCTION public.lcc_priority_band_is_human_surface(text) IS
  'UX-T1a Unit 3: does this priority band earn a human? FALSE for the four bands with an '
  'automated consumer (P0.4 -> A2/cron 244, P-CONTACT -> Tier 0 auto-attach, P0.5 -> CRM '
  'hygiene, P-BUYER -> buyers are pursued by showing them deals). Fails OPEN: an '
  'unclassified band is shown, never hidden.';

-- Keep the pre-change body so the reversal is mechanical rather than reconstructed.
CREATE TABLE IF NOT EXISTS public._uxt1a_pq_enriched_body_backup_20260903 AS
  SELECT now() AS captured_at, pg_get_viewdef('public.v_priority_queue_enriched'::regclass, true) AS body;

-- Append the column mechanically: wrap the LIVE body and add one column. `q.*` preserves
-- every existing column's name, type and POSITION, which is what CREATE OR REPLACE VIEW
-- requires (42P16 otherwise) -- and it avoids restating 6.7 KB of view body, where a
-- transcription slip would be silent.
DO $outer$
DECLARE v_body text; v_sql text;
BEGIN
  SELECT pg_get_viewdef('public.v_priority_queue_enriched'::regclass, true) INTO v_body;
  IF v_body IS NULL THEN RAISE EXCEPTION 'UX-T1a: v_priority_queue_enriched not found'; END IF;
  IF position('human_surface' IN v_body) > 0 THEN
    RAISE NOTICE 'UX-T1a: human_surface already present; no change'; RETURN;
  END IF;
  v_body := regexp_replace(btrim(v_body), ';\s*$', '');
  v_sql := 'CREATE OR REPLACE VIEW public.v_priority_queue_enriched AS SELECT q.*, '
        || 'public.lcc_priority_band_is_human_surface(q.priority_band) AS human_surface '
        || 'FROM (' || v_body || ') q';
  EXECUTE v_sql;
END $outer$;

COMMENT ON VIEW public.v_priority_queue_enriched IS
  'Priority queue with entity enrichment. UX-T1a Unit 3 (2026-09-03) appended '
  'human_surface: FALSE for the four bands that have an automated consumer (P0.4, '
  'P-CONTACT, P0.5, P-BUYER = 941 rows) and TRUE for the 694 seller-timing rows. '
  'A flag, not a filter -- the automated consumers still read their bands.';

-- The chip-count view must gate on the SAME predicate as the item list, or the chips
-- report 1,635 over a list of 694 -- the badge-that-lies failure (P139's chip read
-- "6 of 65"). Append-only: human_surface goes after `n`.
CREATE OR REPLACE VIEW public.v_priority_queue_band_counts AS
 SELECT priority_band,
    count(*)::integer AS n,
    public.lcc_priority_band_is_human_surface(priority_band) AS human_surface
   FROM v_priority_queue_enriched
  GROUP BY priority_band;

COMMENT ON VIEW public.v_priority_queue_band_counts IS
  'One row per priority band with its row count. UX-T1a Unit 3 appended human_surface '
  '(from lcc_priority_band_is_human_surface) so the chips and the item list gate on the '
  'SAME predicate -- a chip counting a band the list does not show is a lying badge.';

-- VERIFIED: human_surface false 941 rows / bands P-BUYER,P-CONTACT,P0.4,P0.5;
--           human_surface true  694 rows / bands P1,P2,P3,P4,P5,P8. Total 1,635 unchanged.
