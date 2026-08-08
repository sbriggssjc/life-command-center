-- ============================================================================
-- dia — recurring Salesforce Closed-IS (CIS) ingestion into dia_nm_cis_closings.
-- Applies live to Dialysis_DB (zqzrriwuavgrquhisnoa). ADDITIVE — run BEFORE the
-- Railway JS redeploy (deploy-ordering rule).
--
-- Goal: a scheduled SF report ("Closed IS", dialysis/medical, ALL owners) flows
-- Power Automate -> POST /api/intake?_route=sf-cis -> UPSERT dia_nm_cis_closings
-- keyed by the SALESFORCE RECORD ID (idempotency key), then a conservative link
-- step resolves each closing to a property + sale so it CERTIFIES automatically
-- in v_dia_nm_attribution_audit (which already UNIONs dia_nm_cis_closings through
-- v_dia_nm_closing_evidence — the certification only fires once the CIS row
-- carries a linked_property_id/linked_sale_id AND the sale is is_northmarq).
--
-- The CIS national export is Northmarq's OWN closed Investment-Sales book, so a
-- CIS row that matches one of our sales is, by definition, an NM-brokered deal —
-- the link step flags is_northmarq on the matched sale (source 'cis_export').
--
-- Discipline: SINGLE WRITER per concern, fill-blanks-only, conservative /
-- unambiguous matching (ambiguity is SKIPPED + surfaced, never guessed), the SF
-- record id is the idempotency key, provenance on every write, reversible by
-- batch_tag via a ledger, idempotent, dry-run-default. Never fabricate a broker,
-- a property link, or an NM flag.
-- ============================================================================

-- ── PART 1: extend dia_nm_cis_closings for the recurring ingest ──────────────
-- Additive only. Existing columns (cis_id, normalized_address, city, state,
-- sold_date, sold_price, broker, deal_name, linked_property_id, linked_sale_id,
-- import_batch, created_at) are preserved.
ALTER TABLE public.dia_nm_cis_closings
  ADD COLUMN IF NOT EXISTS sf_record_id     text,   -- SF report record Id — idempotency key
  ADD COLUMN IF NOT EXISTS listing_broker   text,
  ADD COLUMN IF NOT EXISTS procuring_broker text,
  ADD COLUMN IF NOT EXISTS source           text DEFAULT 'cis_export',
  ADD COLUMN IF NOT EXISTS raw              jsonb,  -- the raw SF report row (audit)
  ADD COLUMN IF NOT EXISTS is_northmarq_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();

-- Idempotency key: one CIS row per SF record id. Partial (WHERE NOT NULL) so any
-- pre-existing rows without a record id don't block the constraint. The JS
-- ingest UPSERTs with ?on_conflict=sf_record_id against this index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dia_nm_cis_sf_record_id
  ON public.dia_nm_cis_closings(sf_record_id)
  WHERE sf_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_dia_nm_cis_unlinked
  ON public.dia_nm_cis_closings(linked_property_id)
  WHERE linked_property_id IS NULL;

-- ── PART 2: reversible link ledger ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dia_nm_cis_link_log (
  id          bigserial PRIMARY KEY,
  run_id      text,
  batch_tag   text,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  dry_run     boolean NOT NULL,
  cis_id      bigint,
  sale_id     integer,
  property_id integer,
  field       text,          -- 'linked_property_id' | 'linked_sale_id' | 'is_northmarq'
  prev_value  text,
  new_value   text,
  source      text,          -- 'cis_export'
  note        text
);
CREATE INDEX IF NOT EXISTS ix_dia_nm_cis_link_log_batch
  ON public.dia_nm_cis_link_log(batch_tag);

-- Conservative address normalizer (mirror of the JS-side collapse used by the
-- audit). Strips everything but [a-z0-9] so "123 Main St, Ste A" vs "123 MAIN
-- ST STE A" collapse identically. Deterministic; no fuzzy matching.
CREATE OR REPLACE FUNCTION public.dia_cis_norm_addr(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]+', '', 'g'), '');
$$;

-- ── PART 3: single-writer link step ──────────────────────────────────────────
-- Resolve each UNLINKED cis row to ONE unambiguous property (normalized address
-- + state), fill-blanks linked_property_id, then to ONE unambiguous LIVE sale on
-- that property within date (±150d) / price (±$100k) proximity — the same
-- tolerance v_dia_nm_attribution_audit certifies on — filling linked_sale_id and
-- flagging is_northmarq (CIS = NM's own closed book). Everything logged for
-- reversal by batch_tag. Ambiguity is skipped (never guessed) and left to the
-- worklist view.
CREATE OR REPLACE FUNCTION public.dia_nm_cis_link(
  p_dry_run   boolean DEFAULT true,
  p_batch_tag text    DEFAULT NULL
) RETURNS TABLE(metric text, n bigint)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_run text := coalesce(p_batch_tag, 'cis_link_'||to_char(now(),'YYYYMMDDHH24MISS'));
  v_prop_ambig     bigint := 0;
  v_prop_linked    bigint := 0;
  v_sale_linked    bigint := 0;
  v_nm_flagged     bigint := 0;
  v_no_property    bigint := 0;
BEGIN
  -- Property resolution: exactly one property on (norm addr, state).
  CREATE TEMP TABLE _cisprop ON COMMIT DROP AS
  WITH unl AS (
    SELECT c.cis_id,
           public.dia_cis_norm_addr(c.normalized_address) AS na,
           upper(nullif(btrim(c.state),'')) AS st,
           c.sold_date, c.sold_price
    FROM public.dia_nm_cis_closings c
    WHERE c.linked_property_id IS NULL
      AND public.dia_cis_norm_addr(c.normalized_address) IS NOT NULL
  ),
  cand AS (
    SELECT u.cis_id, u.sold_date, u.sold_price,
           count(DISTINCT coalesce(p.canonical_property_id, p.property_id)) AS prop_ct,
           min(coalesce(p.canonical_property_id, p.property_id))            AS property_id
    FROM unl u
    JOIN public.properties p
      ON public.dia_cis_norm_addr(p.address) = u.na
     AND (u.st IS NULL OR upper(p.state) = u.st)
    GROUP BY u.cis_id, u.sold_date, u.sold_price
  )
  SELECT * FROM cand;

  SELECT count(*) FILTER (WHERE prop_ct = 1),
         count(*) FILTER (WHERE prop_ct > 1)
    INTO v_prop_linked, v_prop_ambig
  FROM _cisprop;

  SELECT count(*) INTO v_no_property FROM public.dia_nm_cis_closings c
   WHERE c.linked_property_id IS NULL
     AND public.dia_cis_norm_addr(c.normalized_address) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM _cisprop cp WHERE cp.cis_id = c.cis_id);

  -- Sale resolution: exactly one live sale on the resolved property within
  -- proximity. Left NULL when 0 or >1 candidates (property still links).
  CREATE TEMP TABLE _cissale ON COMMIT DROP AS
  WITH one AS (
    SELECT cp.cis_id, cp.property_id, cp.sold_date, cp.sold_price
    FROM _cisprop cp WHERE cp.prop_ct = 1
  ),
  m AS (
    SELECT o.cis_id, o.property_id,
           s.sale_id, s.is_northmarq,
           count(*) OVER (PARTITION BY o.cis_id) AS sale_ct
    FROM one o
    JOIN public.sales_transactions s
      ON coalesce(s.property_id, -1) = o.property_id
     AND coalesce(s.transaction_state,'live') = 'live'
     AND (o.sold_date IS NULL OR s.sale_date IS NULL
          OR abs(s.sale_date - o.sold_date) < 150)
     AND (o.sold_price IS NULL OR s.sold_price IS NULL
          OR abs(s.sold_price - o.sold_price) < 100000)
  )
  SELECT cis_id, property_id, sale_id, is_northmarq FROM m WHERE sale_ct = 1;

  IF NOT p_dry_run THEN
    -- 3a. fill-blanks linked_property_id (unambiguous only)
    WITH upd AS (
      UPDATE public.dia_nm_cis_closings c
         SET linked_property_id = cp.property_id, updated_at = now()
        FROM _cisprop cp
       WHERE c.cis_id = cp.cis_id AND cp.prop_ct = 1
         AND c.linked_property_id IS NULL
      RETURNING c.cis_id, cp.property_id
    ),
    ins AS (
      INSERT INTO public.dia_nm_cis_link_log
        (run_id,batch_tag,dry_run,cis_id,property_id,field,prev_value,new_value,source,note)
      SELECT v_run,p_batch_tag,false,cis_id,property_id,'linked_property_id',NULL,
             property_id::text,'cis_export','unambiguous norm-addr + state'
      FROM upd RETURNING 1
    )
    SELECT count(*) INTO v_prop_linked FROM ins;

    -- 3b. fill-blanks linked_sale_id (unambiguous proximity only)
    WITH upd AS (
      UPDATE public.dia_nm_cis_closings c
         SET linked_sale_id = cs.sale_id, updated_at = now()
        FROM _cissale cs
       WHERE c.cis_id = cs.cis_id AND c.linked_sale_id IS NULL
      RETURNING c.cis_id, cs.sale_id
    ),
    ins AS (
      INSERT INTO public.dia_nm_cis_link_log
        (run_id,batch_tag,dry_run,cis_id,sale_id,field,prev_value,new_value,source,note)
      SELECT v_run,p_batch_tag,false,cis_id,sale_id,'linked_sale_id',NULL,
             sale_id::text,'cis_export','unambiguous live sale within ±150d/±100k'
      FROM upd RETURNING 1
    )
    SELECT count(*) INTO v_sale_linked FROM ins;

    -- 3c. flag the matched sale is_northmarq (CIS = NM's own closed book).
    --     Never overwrites an existing TRUE flag/source.
    WITH upd AS (
      UPDATE public.sales_transactions s
         SET is_northmarq = true,
             is_northmarq_buyside = false,
             is_northmarq_source = 'cis_export'
        FROM _cissale cs
       WHERE s.sale_id = cs.sale_id
         AND s.is_northmarq IS NOT TRUE
      RETURNING s.sale_id
    ),
    ins AS (
      INSERT INTO public.dia_nm_cis_link_log
        (run_id,batch_tag,dry_run,cis_id,sale_id,field,prev_value,new_value,source,note)
      SELECT v_run,p_batch_tag,false,cs.cis_id,cs.sale_id,'is_northmarq','false','true',
             'cis_export','CIS national export = NM closed IS deal'
      FROM _cissale cs JOIN upd u ON u.sale_id = cs.sale_id RETURNING 1
    )
    SELECT count(*) INTO v_nm_flagged FROM ins;

    UPDATE public.dia_nm_cis_closings c
       SET is_northmarq_applied = true, updated_at = now()
      FROM _cissale cs
     WHERE c.cis_id = cs.cis_id AND c.is_northmarq_applied IS NOT TRUE;

    -- self-labeling sync ledger (sf_sync_log pattern, mirrors dia_nm_broker_backfill)
    INSERT INTO public.sf_sync_log(sync_id,sync_type,sf_object_type,status,payload,created_at)
    VALUES (gen_random_uuid(),'dia_nm_cis_link','closed_is','success',
      jsonb_build_object('batch_tag',p_batch_tag,'run_id',v_run,
        'property_linked',v_prop_linked,'sale_linked',v_sale_linked,
        'nm_flagged',v_nm_flagged,'property_ambiguous',v_prop_ambig,
        'no_property_match',v_no_property), now());
  ELSE
    SELECT count(*) INTO v_sale_linked FROM _cissale cs
      JOIN public.dia_nm_cis_closings c ON c.cis_id = cs.cis_id
     WHERE c.linked_sale_id IS NULL;
    SELECT count(*) INTO v_nm_flagged FROM _cissale cs
      JOIN public.sales_transactions s ON s.sale_id = cs.sale_id
     WHERE s.is_northmarq IS NOT TRUE;
  END IF;

  RETURN QUERY VALUES
    ('property_linked',    v_prop_linked),
    ('property_ambiguous', v_prop_ambig),
    ('no_property_match',  v_no_property),
    ('sale_linked',        v_sale_linked),
    ('nm_flagged',         v_nm_flagged);
END;
$fn$;

-- ── PART 4: unlinked worklist (surface, never guess) ─────────────────────────
CREATE OR REPLACE VIEW public.v_dia_nm_cis_unlinked AS
  SELECT c.cis_id, c.sf_record_id, c.normalized_address, c.city, c.state,
         c.sold_date, c.sold_price, c.listing_broker, c.procuring_broker,
         c.deal_name, c.import_batch, c.created_at,
         CASE WHEN public.dia_cis_norm_addr(c.normalized_address) IS NULL
                THEN 'no_address'
              WHEN EXISTS (SELECT 1 FROM public.properties p
                           WHERE public.dia_cis_norm_addr(p.address)
                                 = public.dia_cis_norm_addr(c.normalized_address)
                             AND (c.state IS NULL OR upper(p.state)=upper(c.state)))
                THEN 'property_candidate_exists'
              ELSE 'no_property_match' END AS unlinked_reason
    FROM public.dia_nm_cis_closings c
   WHERE c.linked_property_id IS NULL;

GRANT SELECT ON public.v_dia_nm_cis_unlinked TO anon, authenticated, service_role;

-- ── PART 5: going-forward sync — schedule the link step ──────────────────────
-- Runs after the ingest lands rows and before dia-nm-comp-promote (05:40), so a
-- freshly-ingested CIS closing self-links + self-certifies each night. The JS
-- ingest also fires this in real time (best-effort) on each batch.
SELECT cron.schedule('dia-nm-cis-link','32 5 * * *',
  $$SELECT public.dia_nm_cis_link(false,'cron')$$);

-- ── REVERSAL RUNBOOK ─────────────────────────────────────────────────────────
-- Link/flag writes for a batch:
--   UPDATE dia_nm_cis_closings c SET linked_property_id=NULL
--     FROM dia_nm_cis_link_log g
--    WHERE g.cis_id=c.cis_id AND g.batch_tag=:tag AND g.field='linked_property_id';
--   (symmetric for linked_sale_id; for is_northmarq restore prev_value on
--    sales_transactions by g.sale_id)
-- Ingest rows for a batch:  DELETE FROM dia_nm_cis_closings WHERE import_batch=:tag;
-- Cron: SELECT cron.unschedule('dia-nm-cis-link');
-- Columns/index/view/fn: DROP them (all additive, IF EXISTS-guarded on re-run).
