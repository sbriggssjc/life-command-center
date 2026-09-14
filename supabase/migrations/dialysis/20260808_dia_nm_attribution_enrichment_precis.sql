-- ============================================================================
-- dia — NM attribution enrichment (pre-CIS). Applied live to zqzrriwuavgrquhisnoa.
--
-- Goal: maximize is_northmarq CERTIFICATION from data we already hold, feeding
-- v_dia_nm_attribution_audit. The CIS national export remains the authoritative
-- final layer (dia_nm_cis_closings, empty until loaded) — this round mines the
-- SF surfaces already in the DB.
--
-- Discipline: SINGLE WRITER per concern, fill-blanks-only, conservative /
-- unambiguous matching (ambiguity is skipped + surfaced, never guessed),
-- provenance on every write, reversible by batch_tag via a ledger, idempotent,
-- dry-run-default. Never fabricate a broker or an NM flag.
--
-- Grounded baseline (2026-08-08, sales 2023+):
--   audit: market_no_evidence 837 / flagged_nm_uncertified 50 / certified_nm 3
--   root cause of low certification: dia_promote_nm_comps had already matched
--   ~121 sales to sf_internal_comp_export (is_northmarq_source=
--   'salesforce_internal_comp') but v_dia_nm_closing_evidence never unioned that
--   source, so the audit could not certify them.
--
-- APPLIED RESULTS (2026-08-08, batch nm_attr_enrich_20260808):
--   Step 1 broker backfill: 312 listing_broker filled (fill-blanks, provenance
--     listing_linkage), 43 ambiguous multi-name skipped, 0 procuring (source had
--     none), 0 NEW nm flags — all 20 NM-broker-string sales were ALREADY
--     is_northmarq=true (NM's own SF comps already covered them). Remaining
--     broker-null 2023+: 2023=176, 2024=123, 2025=163, 2026=50 (62 filled in-window).
--   Step 2+3 audit (sales 2023+): certified_nm 3 -> 44, flagged_nm_uncertified
--     50 -> 10, hidden_nm 0 (no market sale false-tagged). Publish gate:
--     reconciles=true, attribution_certified=false (10 uncertified remain — they
--     have no SF comp/deal/broker evidence we hold; certifiable only when the CIS
--     national export lands). Value-prop 24m unchanged (26 NM vs 183 market;
--     NM 6.95% vs market 7.05%; +9.8bps) — published STAYS false, Scott decides.
--
-- Four parts:
--   1. Broker-null backfill from linked listings + conservative NM broker re-pass
--   2. Extend v_dia_nm_closing_evidence: union the authoritative comp-promote log
--      (sf_internal_comp_export + sf_comp_staging matches) + NM broker-of-record
--   3. (audit + value-prop re-run — views auto-reflect; published stays false)
--   4. Going-forward sync: schedule the broker backfill (comp-promote already crons)
-- ============================================================================

-- ── PART 1: reversible ledger + single-writer broker backfill ────────────────

CREATE TABLE IF NOT EXISTS public.dia_nm_broker_backfill_log (
  id          bigserial PRIMARY KEY,
  run_id      text,
  batch_tag   text,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  dry_run     boolean NOT NULL,
  sale_id     integer,
  field       text,           -- 'listing_broker' | 'procuring_broker' | 'is_northmarq'
  prev_value  text,
  new_value   text,
  source      text,           -- 'listing_linkage' | 'listing_broker_nm'
  note        text
);
CREATE INDEX IF NOT EXISTS ix_dia_nm_broker_backfill_log_batch
  ON public.dia_nm_broker_backfill_log(batch_tag);

-- The NM classifier ported to SQL (mirror of api/_shared/sf-nm-classifier.js).
-- IMPORTANT: Postgres ARE uses \y for a word boundary — JS \b is BACKSPACE here.
-- Conservative "strong firm" tokens only (never surname-only) so a broker string
-- can only CERTIFY a genuinely-NM deal, never false-tag a competitor's sale.
CREATE OR REPLACE FUNCTION public.dia_broker_is_nm(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name IS NOT NULL
     AND p_name ~* '(northmarq|stan johnson|\ysjc\y|team briggs|\ybriggs\y)'
     -- known confirmed outside brokers can still ride a buy-side co-broke; never NM-list them
     AND p_name !~* '(sam bretz|nathan huffman|peranich)'
     -- a national competitor in the string denies NM-listing regardless
     AND p_name !~* '(cushman|wakefield|\yc&w\y|colliers|\ycbre\y|newmark|\yjll\y|marcus\s*&\s*millichap|\ym&m\y|\ymmi\y|institutional property advisors|\yipa\y|\ysrs\y|avison young|\ynai\y|matthews|flagship|\ysvn\y|keller williams|\ykw\y)';
$$;

-- Single writer for the broker gap. Resolves ONE unambiguous listing-broker per
-- broker-null sale from its linked available_listings row(s) (join either
-- direction: sale.listing_sale_id -> listing_id, or listing.sale_transaction_id
-- -> sale_id), fills blanks only, tags provenance 'listing_linkage', then runs
-- the conservative NM broker re-pass over the backfilled set. Everything is
-- logged for reversal by batch_tag.
CREATE OR REPLACE FUNCTION public.dia_nm_broker_backfill(
  p_dry_run   boolean DEFAULT true,
  p_batch_tag text    DEFAULT NULL
) RETURNS TABLE(metric text, n bigint)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_run text := coalesce(p_batch_tag, 'broker_backfill_'||to_char(now(),'YYYYMMDDHH24MISS'));
  v_listing_filled  bigint := 0;
  v_procuring_filled bigint := 0;
  v_nm_flagged      bigint := 0;
  v_ambiguous       bigint := 0;
  v_candidates      bigint := 0;
BEGIN
  -- One row per broker-null sale with an unambiguous resolved name.
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  WITH bn AS (
    SELECT s.sale_id, s.listing_sale_id, s.is_northmarq
    FROM public.sales_transactions s
    WHERE (s.listing_broker IS NULL OR btrim(s.listing_broker)='')
  ),
  m AS (
    SELECT bn.sale_id, bn.is_northmarq,
      nullif(btrim(coalesce(al.listing_broker, bc.company_name)),'')  AS bname,
      nullif(btrim(pbc.company_name),'')                              AS pname
    FROM bn
    JOIN public.available_listings al
      ON al.sale_transaction_id = bn.sale_id
      OR al.listing_id          = bn.listing_sale_id
    LEFT JOIN public.broker_companies bc  ON bc.broker_company_id  = al.listing_broker_id
    LEFT JOIN public.broker_companies pbc ON pbc.broker_company_id = al.procuring_broker_id
  )
  SELECT
    sale_id,
    bool_or(is_northmarq IS TRUE)                                       AS already_nm,
    count(DISTINCT lower(bname)) FILTER (WHERE bname IS NOT NULL)       AS name_ct,
    min(bname)  FILTER (WHERE bname IS NOT NULL)                        AS bname,
    count(DISTINCT lower(pname)) FILTER (WHERE pname IS NOT NULL)       AS pname_ct,
    min(pname)  FILTER (WHERE pname IS NOT NULL)                        AS pname
  FROM m
  GROUP BY sale_id;

  SELECT count(*) FILTER (WHERE name_ct = 1 AND bname IS NOT NULL),
         count(*) FILTER (WHERE name_ct > 1)
    INTO v_candidates, v_ambiguous
  FROM _cand;

  IF NOT p_dry_run THEN
    -- 1a. listing_broker fill-blanks (unambiguous only), provenance listing_linkage
    WITH upd AS (
      UPDATE public.sales_transactions s
         SET listing_broker = c.bname
        FROM _cand c
       WHERE s.sale_id = c.sale_id
         AND c.name_ct = 1 AND c.bname IS NOT NULL
         AND (s.listing_broker IS NULL OR btrim(s.listing_broker)='')
      RETURNING s.sale_id, c.bname
    ),
    ins AS (
      INSERT INTO public.dia_nm_broker_backfill_log
        (run_id,batch_tag,dry_run,sale_id,field,prev_value,new_value,source,note)
      SELECT v_run,p_batch_tag,false,sale_id,'listing_broker',NULL,bname,'listing_linkage',
             'from linked available_listings'
      FROM upd RETURNING 1
    )
    SELECT count(*) INTO v_listing_filled FROM ins;

    -- 1b. procuring_broker fill-blanks (unambiguous only)
    WITH upd AS (
      UPDATE public.sales_transactions s
         SET procuring_broker = c.pname
        FROM _cand c
       WHERE s.sale_id = c.sale_id
         AND c.pname_ct = 1 AND c.pname IS NOT NULL
         AND (s.procuring_broker IS NULL OR btrim(s.procuring_broker)='')
      RETURNING s.sale_id, c.pname
    ),
    ins AS (
      INSERT INTO public.dia_nm_broker_backfill_log
        (run_id,batch_tag,dry_run,sale_id,field,prev_value,new_value,source,note)
      SELECT v_run,p_batch_tag,false,sale_id,'procuring_broker',NULL,pname,'listing_linkage',
             'from linked available_listings'
      FROM upd RETURNING 1
    )
    SELECT count(*) INTO v_procuring_filled FROM ins;

    -- 1c. conservative NM broker re-pass over the just-backfilled listing_broker.
    --     Only strong NM firm tokens; never overwrites an existing is_northmarq flag.
    WITH upd AS (
      UPDATE public.sales_transactions s
         SET is_northmarq = true,
             is_northmarq_buyside = false,
             is_northmarq_source = 'listing_broker_nm'
        FROM _cand c
       WHERE s.sale_id = c.sale_id
         AND s.is_northmarq IS NOT TRUE
         AND public.dia_broker_is_nm(s.listing_broker)
      RETURNING s.sale_id, s.listing_broker
    ),
    ins AS (
      INSERT INTO public.dia_nm_broker_backfill_log
        (run_id,batch_tag,dry_run,sale_id,field,prev_value,new_value,source,note)
      SELECT v_run,p_batch_tag,false,sale_id,'is_northmarq','false','true','listing_broker_nm',
             'NM broker of record: '||listing_broker
      FROM upd RETURNING 1
    )
    SELECT count(*) INTO v_nm_flagged FROM ins;

    -- going-forward sync ledger (sf_sync_log pattern)
    INSERT INTO public.sf_sync_log(sync_id,sync_type,status,payload,created_at)
    VALUES (gen_random_uuid(),'dia_nm_broker_backfill','success',
      jsonb_build_object('batch_tag',p_batch_tag,'run_id',v_run,
        'listing_filled',v_listing_filled,'procuring_filled',v_procuring_filled,
        'nm_flagged',v_nm_flagged,'ambiguous_skipped',v_ambiguous), now());
  ELSE
    -- dry-run projections (no writes)
    SELECT count(*) INTO v_listing_filled FROM _cand c
      JOIN public.sales_transactions s ON s.sale_id=c.sale_id
     WHERE c.name_ct=1 AND c.bname IS NOT NULL
       AND (s.listing_broker IS NULL OR btrim(s.listing_broker)='');
    SELECT count(*) INTO v_procuring_filled FROM _cand c
      JOIN public.sales_transactions s ON s.sale_id=c.sale_id
     WHERE c.pname_ct=1 AND c.pname IS NOT NULL
       AND (s.procuring_broker IS NULL OR btrim(s.procuring_broker)='');
    SELECT count(*) INTO v_nm_flagged FROM _cand c
      JOIN public.sales_transactions s ON s.sale_id=c.sale_id
     WHERE c.name_ct=1 AND s.is_northmarq IS NOT TRUE
       AND public.dia_broker_is_nm(c.bname);
  END IF;

  RETURN QUERY VALUES
    ('candidates_unambiguous', v_candidates),
    ('ambiguous_skipped',      v_ambiguous),
    ('listing_broker_filled',  v_listing_filled),
    ('procuring_broker_filled',v_procuring_filled),
    ('nm_flagged_from_broker', v_nm_flagged);
END;
$fn$;

-- ── PART 2: extend v_dia_nm_closing_evidence ─────────────────────────────────
-- Columns preserved in the SAME order (evidence_source, evidence_ref, property_id,
-- sale_id, address, state, close_date, price). Two new UNION branches:
--   (a) nm comp-promote log — the AUTHORITATIVE already-matched sale<->comp links
--       (dia_promote_nm_comps), which surfaces sf_internal_comp_export at last.
--   (b) nm_listing_broker — NM broker-of-record (conservative strong-firm tokens).
CREATE OR REPLACE VIEW public.v_dia_nm_closing_evidence AS
  SELECT 'sf_deal_staging'::text AS evidence_source,
         sf_deal_staging.staging_id::text AS evidence_ref,
         sf_deal_staging.linked_property_id AS property_id,
         NULL::integer AS sale_id,
         sf_deal_staging.property_address AS address,
         sf_deal_staging.property_state AS state,
         sf_deal_staging.expected_close_date AS close_date,
         sf_deal_staging.deal_price AS price
    FROM sf_deal_staging
   WHERE sf_deal_staging.stage = ANY (ARRAY['Closed IS'::text,'Final'::text])
  UNION ALL
  SELECT 'sf_comp_internal_sold'::text, sf_comp_staging.staging_id::text,
         sf_comp_staging.linked_property_id, sf_comp_staging.linked_sale_id,
         sf_comp_staging.normalized_address, sf_comp_staging.state,
         sf_comp_staging.sold_date, sf_comp_staging.sold_price
    FROM sf_comp_staging
   WHERE sf_comp_staging.comp_type = 'Internal'::text AND sf_comp_staging.status = 'Sold'::text
  UNION ALL
  SELECT 'cis_export'::text, dia_nm_cis_closings.cis_id::text,
         dia_nm_cis_closings.linked_property_id, dia_nm_cis_closings.linked_sale_id,
         dia_nm_cis_closings.normalized_address, dia_nm_cis_closings.state,
         dia_nm_cis_closings.sold_date, dia_nm_cis_closings.sold_price
    FROM dia_nm_cis_closings
  UNION ALL
  -- (a) authoritative matched links from the comp-promote log
  SELECT DISTINCT
         CASE WHEN ice.sf_comp_id IS NOT NULL THEN 'sf_internal_comp_export'::text
              ELSE 'nm_comp_promote_log'::text END,
         l.sf_comp_id,
         st.property_id,
         l.sale_id,
         NULL::text,
         COALESCE(ice.state, scs.state),
         COALESCE(ice.sold_date, scs.sold_date, st.sale_date),
         COALESCE(l.comp_price, ice.sold_price, scs.sold_price)
    FROM dia_nm_comp_promote_log l
    JOIN sales_transactions st ON st.sale_id = l.sale_id
    LEFT JOIN sf_internal_comp_export ice ON ice.sf_comp_id = l.sf_comp_id
    LEFT JOIN sf_comp_staging scs        ON scs.sf_comp_id = l.sf_comp_id
   WHERE l.dry_run = false AND l.new_is_northmarq IS TRUE AND l.sale_id IS NOT NULL
     AND COALESCE(l.action,'') NOT ILIKE '%skip%'
  UNION ALL
  -- (b) NM broker-of-record evidence (conservative)
  SELECT 'nm_listing_broker'::text, st.sale_id::text, st.property_id, st.sale_id,
         NULL::text, NULL::text, st.sale_date, st.sold_price
    FROM sales_transactions st
   WHERE st.sale_date >= '2023-01-01'::date
     AND public.dia_broker_is_nm(st.listing_broker);

GRANT SELECT ON public.v_dia_nm_closing_evidence TO anon, authenticated, service_role;

-- ── PART 4: going-forward sync — schedule the broker backfill ────────────────
-- dia-nm-comp-promote (05:40) already crons the comp path. Run the broker fill
-- just before it so future broker-null sales linked to listings self-label.
SELECT cron.schedule('dia-nm-broker-backfill','30 5 * * *',
  $$SELECT public.dia_nm_broker_backfill(false,'cron')$$);

-- ── REVERSAL RUNBOOK ─────────────────────────────────────────────────────────
-- Broker/NM writes for a batch:
--   UPDATE sales_transactions s SET listing_broker=NULL
--     FROM dia_nm_broker_backfill_log g
--    WHERE g.sale_id=s.sale_id AND g.batch_tag=:tag AND g.field='listing_broker';
--   (symmetric for procuring_broker; for is_northmarq restore prev_value/source)
-- Evidence view: re-create the prior 3-branch body (see
--   20260808_dia_rent_intelligence_phase2_nm_audit_valueprop.sql / addendum).
-- Cron: SELECT cron.unschedule('dia-nm-broker-backfill');
