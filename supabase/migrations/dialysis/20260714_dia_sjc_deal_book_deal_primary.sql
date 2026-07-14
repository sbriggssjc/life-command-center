-- ============================================================================
-- Dia — SJC Deal Book: make it DEAL-OBJECT-PRIMARY + self-maintaining
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL / zqzrriwuavgrquhisnoa)
--
-- WHY (grounded live 2026-07-14): the SJC Deal Book (v_sjc_deal_book) was fed
-- ENTIRELY from the Salesforce *Listing* object (sf_listing_staging) — so only a
-- closed deal that had a marketing Listing record showed up. Off-market /
-- buy-side / co-broke / referral / older deals have no Listing record → invisible
-- (82 closed vs Scott's ~251-deal ground truth).
--
-- The durable SF *Deal* object crawl ALREADY EXISTS: the intake-salesforce edge
-- function stages the Opportunity object into public.sf_deal_staging (149 deals,
-- full history 2006–2027, refreshed daily). So we do NOT build a new crawl — we
-- REPOINT the book at the Deal object as PRIMARY, consolidate the manual/bootstrap
-- channel + the Listing channel around it, dedup on a natural key, and keep the
-- output columns stable so v_sjc_deal_book_summary / _by_year are unaffected.
--
-- The three sources, one consolidated truth (superseded by dedup_key):
--   1. sf_deal_staging   — the live SF Deal-object crawl (deal_source='sf_crawl').
--   2. sjc_deal_ingest    — the one-time historical bootstrap (deal_source=
--                           'manual_export') + any manual channel. A sf_crawl row
--                           SUPERSEDES a manual_export row on the same dedup_key.
--   3. sf_listing_staging — SUPPLEMENTAL: active-marketing status + any closed
--                           listing not yet covered by a Deal row (no regression).
--
-- Everything here is ADDITIVE + REVERSIBLE:
--   - sjc_deal_ingest is a new table (drop it → gone).
--   - v_sjc_deal_book is CREATE OR REPLACE, keeping the 26 existing columns in the
--     exact order/type and APPENDING broker_name (col 27, append-only rule).
--   - Revert: re-create the prior v_sjc_deal_book body from
--     20260604140000_dia_sjc_deal_book_dedupe.sql (committed in git).
-- ============================================================================

-- lcc_safe_numeric / lcc_safe_date are already defined (20260529260000). Reuse.

-- ── Natural dedup key (the single source of truth for cross-source supersession)
-- dedup_key = normalized(deal_name) | close_date(YYYY-MM-DD) | round(price/1000)*1000
-- Collapses the export's both-side / referral / outside-fee duplicate rows and
-- matches a crawl Deal row to its manual_export twin.
CREATE OR REPLACE FUNCTION public.sjc_norm_deal_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]+', ' ', 'g'), ' ')
$$;

CREATE OR REPLACE FUNCTION public.sjc_deal_dedup_key(p_name text, p_close date, p_price numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(coalesce(public.sjc_norm_deal_name(p_name), ''))
      || '|' || coalesce(to_char(p_close, 'YYYY-MM-DD'), '')
      || '|' || coalesce((round(coalesce(p_price,0) / 1000.0) * 1000)::bigint::text, '0')
$$;

-- ── The bootstrap / manual channel table ────────────────────────────────────
-- BOTH the one-time historical export AND any future manual entry write here.
-- The durable SF crawl lives in sf_deal_staging (read directly by the view).
CREATE TABLE IF NOT EXISTS public.sjc_deal_ingest (
  staging_id           bigserial PRIMARY KEY,
  deal_source          text NOT NULL DEFAULT 'manual_export'
                         CHECK (deal_source IN ('manual_export','sf_crawl','manual')),
  sf_deal_id           text,                 -- null for the bootstrap; set by any crawl-sourced row
  import_batch         text,
  raw                  jsonb,
  dedup_key            text,                 -- filled by trigger from the key fn when null (seed may precompute it)
  -- typed columns the book + analytics render
  deal_name            text,
  sales_price          numeric,
  cap_rate             numeric,
  close_date           date,
  lead_broker          text,
  team                 text,
  deal_type            text,
  referral             text,
  city                 text,
  state                text,
  tenant               text,
  building_sf          integer,
  deal_commission      numeric,
  property_subtype     text,
  seller_company       text,
  buyer_company        text,
  buyer_contact_name   text,
  list_date            date,
  listing_price        numeric,
  marketing_cap_rate   numeric,
  lease_term_years     numeric,
  time_on_market_days  integer,
  linked_property_id   integer,
  matched_sale_id      integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sjc_deal_ingest_dedup   ON public.sjc_deal_ingest (dedup_key);
CREATE INDEX IF NOT EXISTS idx_sjc_deal_ingest_source  ON public.sjc_deal_ingest (deal_source);
CREATE INDEX IF NOT EXISTS idx_sjc_deal_ingest_sfdeal  ON public.sjc_deal_ingest (sf_deal_id);

-- Fill dedup_key from the shared fn when a writer (or the seed) leaves it null,
-- so a direct query of the table is consistent with the view's authoritative key.
CREATE OR REPLACE FUNCTION public.sjc_deal_ingest_fill_key()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dedup_key IS NULL OR NEW.dedup_key = '' THEN
    NEW.dedup_key := public.sjc_deal_dedup_key(NEW.deal_name, NEW.close_date, NEW.sales_price);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sjc_deal_ingest_fill_key ON public.sjc_deal_ingest;
CREATE TRIGGER trg_sjc_deal_ingest_fill_key
  BEFORE INSERT OR UPDATE ON public.sjc_deal_ingest
  FOR EACH ROW EXECUTE FUNCTION public.sjc_deal_ingest_fill_key();

-- ── Consolidated deal-object truth (crawl ∪ bootstrap, superseded by dedup_key)
-- One row per distinct deal. A sf_crawl row (has sf_deal_id) beats a manual_export
-- row with the same dedup_key, then the most recently modified wins.
CREATE OR REPLACE VIEW public.v_sjc_deal_ingest_current AS
WITH src AS (
  -- crawl arm: the live SF Deal-object crawl
  SELECT
    'sf_crawl'::text                                             AS deal_source,
    s.staging_id,
    s.sf_deal_id,
    s.sf_last_modified,
    s.deal_name,
    -- deal_side from Category (Disposition=sell / Acquisition=buy) + Direct/Co-Broke
    CASE
      WHEN lower(coalesce(s.raw_row->>'Category_sjc__c','')) = 'acquisition'
        THEN CASE WHEN s.raw_row->>'Direct_Co_Broke_sjc__c' ILIKE '%co-broke%'
                  THEN 'IS - Co-Broke Buyer' ELSE 'IS - Buy Side (CM)' END
      WHEN s.deal_type = 'IS CM'
        OR coalesce(s.raw_row->>'Business_Line__c','') ILIKE 'Investment Sales%'
        THEN 'Sale Deal - Commercial'
      ELSE 'other'
    END                                                         AS deal_side,
    NULLIF(trim(coalesce(s.raw_row->>'SJC_Broker_Team_Name_sjc__c',
                         s.raw_row->>'_lcc_deal_team','')), '') AS sjc_team,
    s.stage                                                     AS deal_status_raw,
    CASE s.stage
      WHEN 'Closed IS'      THEN 'closed'
      WHEN 'Terminated IS'  THEN 'terminated'
      WHEN 'Listing Signed' THEN 'active_listing'
      WHEN 'LOI Executed'   THEN 'under_loi'
      WHEN 'In Escrow'      THEN 'in_escrow'
      WHEN 'Non-refundable' THEN 'in_escrow'
      ELSE 'other'
    END                                                         AS deal_stage,
    (s.stage = 'Closed IS')                                     AS is_closed,
    CASE WHEN s.stage = 'Closed IS' THEN s.deal_price END       AS closed_price,
    s.deal_cap_rate                                             AS cap_rate,
    s.noi,
    COALESCE(s.expected_close_date,
             public.lcc_safe_date(s.raw_row->>'Deal_Date__c'))  AS est_close_date,
    public.lcc_safe_date(s.raw_row->>'List_Date__c')            AS list_date,
    s.listing_price                                             AS asking_price,
    s.deal_cap_rate                                             AS marketing_cap_rate,
    COALESCE(s.property_address, s.raw_row->>'Address_sjc__c')  AS property_address,
    COALESCE(s.property_city,    s.raw_row->>'City_sjc__c')     AS city,
    COALESCE(s.property_state,   s.raw_row->>'State_sjc__c')    AS state,
    s.property_subtype                                          AS primary_use,
    COALESCE(s.seller_company_name,
             s.raw_row->>'Seller_Company_sjc__c')               AS seller_company,
    s.buyer_company_name                                        AS buyer_company,
    NULL::text                                                  AS buyer_contact_name,
    -- Broker_Name__c is an HTML anchor (<a ...>Scott Briggs</a>) → strip tags
    NULLIF(trim(regexp_replace(coalesce(s.raw_row->>'Broker_Name__c',''),
                               '<[^>]*>', '', 'g')), '')        AS lead_broker,
    s.raw_row->>'Producer__c'                                   AS listing_broker_sf_id,
    s.linked_property_id,
    s.deal_type,
    s.raw_row->>'Referral_Type__c'                              AS referral,
    s.building_sf,
    s.lease_term_remaining                                      AS lease_term_years,
    NULL::integer                                               AS time_on_market_days
  FROM public.sf_deal_staging s
  UNION ALL
  -- bootstrap / manual arm
  SELECT
    i.deal_source,
    i.staging_id,
    i.sf_deal_id,
    COALESCE(i.updated_at, i.created_at)                        AS sf_last_modified,
    i.deal_name,
    CASE
      WHEN lower(coalesce(i.referral,'')) IN ('yes','y','true','referral','1')
        THEN 'IS - Referral'
      WHEN lower(coalesce(i.deal_type,'')) LIKE '%buy%'
        THEN 'IS - Buy Side (CM)'
      WHEN lower(coalesce(i.deal_type,'')) LIKE '%off%market%'
        THEN 'IS - Off-Market (CM)'
      ELSE 'Sale Deal - Commercial'
    END                                                         AS deal_side,
    i.team                                                      AS sjc_team,
    'Closed IS'::text                                           AS deal_status_raw,
    'closed'::text                                              AS deal_stage,
    TRUE                                                        AS is_closed,
    i.sales_price                                               AS closed_price,
    i.cap_rate,
    NULL::numeric                                               AS noi,
    i.close_date                                                AS est_close_date,
    i.list_date,
    i.listing_price                                             AS asking_price,
    i.marketing_cap_rate,
    NULL::text                                                  AS property_address,
    i.city,
    i.state,
    i.property_subtype                                          AS primary_use,
    i.seller_company,
    i.buyer_company,
    i.buyer_contact_name,
    i.lead_broker,
    NULL::text                                                  AS listing_broker_sf_id,
    i.linked_property_id,
    i.deal_type,
    i.referral,
    i.building_sf,
    i.lease_term_years,
    i.time_on_market_days
  FROM public.sjc_deal_ingest i
),
keyed AS (
  SELECT src.*, public.sjc_deal_dedup_key(src.deal_name, src.est_close_date, src.closed_price) AS dedup_key
  FROM src
)
SELECT DISTINCT ON (dedup_key) *
FROM keyed
ORDER BY dedup_key,
         (deal_source = 'sf_crawl') DESC,      -- crawl supersedes manual_export
         sf_last_modified DESC NULLS LAST,
         staging_id DESC;

-- ── The book — DEAL-OBJECT-PRIMARY, Listing supplemental ────────────────────
-- 26 existing columns (exact order/type) + broker_name appended (col 27).
CREATE OR REPLACE VIEW public.v_sjc_deal_book AS
WITH deal AS (
  SELECT
    c.sf_deal_id,
    NULL::text                                                  AS sf_listing_id,
    c.staging_id,
    c.deal_name,
    c.deal_side,
    c.sjc_team,
    c.listing_broker_sf_id,
    c.deal_status_raw                                           AS deal_status,
    c.deal_stage,
    c.is_closed,
    NULL::text                                                  AS marketing_status,
    c.closed_price,
    c.asking_price,
    c.cap_rate,
    c.noi,
    c.est_close_date,
    NULL::date                                                  AS first_broadcast_date,
    c.property_address,
    c.city,
    c.state,
    c.primary_use,
    c.seller_company,
    c.linked_property_id,
    NULL::numeric                                               AS match_confidence,
    ( SELECT st.sale_id FROM public.sales_transactions st
       WHERE st.property_id = c.linked_property_id AND st.transaction_state = 'live'
       ORDER BY abs(st.sale_date - COALESCE(c.est_close_date, st.sale_date))
       LIMIT 1)::integer                                        AS matched_sale_id,
    c.sf_last_modified,
    COALESCE(
      ( SELECT NULLIF(trim(COALESCE(sc.first_name,'') || ' ' || COALESCE(sc.last_name,'')), '')
          FROM public.salesforce_contacts sc
         WHERE sc.sf_contact_id = c.listing_broker_sf_id LIMIT 1),
      c.lead_broker)                                            AS broker_name,
    c.dedup_key
  FROM public.v_sjc_deal_ingest_current c
  WHERE c.deal_side <> 'other'
),
listing_raw AS (
  SELECT DISTINCT ON (s.sf_listing_id)
    s.staging_id, s.sf_listing_id, s.sf_deal_id, s.sf_last_modified,
    s.listing_name, s.record_type, s.first_broadcast_date,
    s.property_address, s.normalized_address, s.linked_property_id, s.match_confidence,
    s.raw_row::jsonb AS j
  FROM public.sf_listing_staging s
  WHERE s.record_type = ANY (ARRAY['Sale Deal - Commercial','IS - Buy Side (CM)',
                                   'IS - Co-Broke Buyer','IS - Off-Market (CM)'])
  ORDER BY s.sf_listing_id,
           s.sf_last_modified DESC NULLS LAST,
           s.imported_at DESC NULLS LAST,
           s.updated_at DESC NULLS LAST,
           s.staging_id DESC
),
listing AS (
  SELECT
    d.sf_deal_id,
    d.sf_listing_id,
    d.staging_id,
    COALESCE(d.j->>'Deal_Name_sjc__c', d.j->>'Name', d.listing_name)         AS deal_name,
    d.record_type                                                            AS deal_side,
    d.j->>'SJC_Broker_Team_sjc__c'                                           AS sjc_team,
    d.j->>'Listing_Broker_sjc__c'                                            AS listing_broker_sf_id,
    d.j->>'Deal_Status__c'                                                   AS deal_status,
    CASE d.j->>'Deal_Status__c'
      WHEN 'Closed IS'      THEN 'closed'
      WHEN 'Terminated IS'  THEN 'terminated'
      WHEN 'Listing Signed' THEN 'active_listing'
      WHEN 'LOI Executed'   THEN 'under_loi'
      WHEN 'In Escrow'      THEN 'in_escrow'
      WHEN 'Non-refundable' THEN 'in_escrow'
      ELSE 'other' END                                                       AS deal_stage,
    (d.j->>'Deal_Status__c' = 'Closed IS')                                   AS is_closed,
    d.j->>'Marketing_Status_sjc__c'                                          AS marketing_status,
    public.lcc_safe_numeric(d.j->>'Notable_Transaction_Price_sjc__c')        AS closed_price,
    public.lcc_safe_numeric(COALESCE(d.j->>'Asking_List_Price_sjc__c',
                                     d.j->>'Asking_List_Price2_sjc__c'))      AS asking_price,
    public.lcc_safe_numeric(COALESCE(d.j->>'Marketing_Cap_Rate_sjc__c',
                                     d.j->>'Cap_Rate_sjc__c'))                AS cap_rate,
    public.lcc_safe_numeric(d.j->>'NOI_sjc__c')                              AS noi,
    public.lcc_safe_date(d.j->>'Est_Act_Close_Date_sjc__c')                  AS est_close_date,
    d.first_broadcast_date,
    COALESCE(d.j->>'Property_Address__c', d.property_address, d.normalized_address) AS property_address,
    d.j->>'City_sjc__c'                                                      AS city,
    d.j->>'State_sjc__c'                                                     AS state,
    COALESCE(d.j->>'Primary_Use_sjc__c', 'Dialysis')                         AS primary_use,
    d.j->>'Seller_Company_sjc__c'                                            AS seller_company,
    d.linked_property_id,
    d.match_confidence,
    ( SELECT st.sale_id FROM public.sales_transactions st
       WHERE st.property_id = d.linked_property_id AND st.transaction_state = 'live'
       ORDER BY abs(st.sale_date - COALESCE(public.lcc_safe_date(d.j->>'Est_Act_Close_Date_sjc__c'), st.sale_date))
       LIMIT 1)::integer                                                     AS matched_sale_id,
    d.sf_last_modified,
    ( SELECT NULLIF(trim(COALESCE(sc.first_name,'') || ' ' || COALESCE(sc.last_name,'')), '')
        FROM public.salesforce_contacts sc
       WHERE sc.sf_contact_id = d.j->>'Listing_Broker_sjc__c' LIMIT 1)       AS broker_name,
    public.sjc_deal_dedup_key(
      COALESCE(d.j->>'Deal_Name_sjc__c', d.j->>'Name', d.listing_name),
      public.lcc_safe_date(d.j->>'Est_Act_Close_Date_sjc__c'),
      public.lcc_safe_numeric(d.j->>'Notable_Transaction_Price_sjc__c'))     AS dedup_key
  FROM listing_raw d
)
-- Deal-object rows first (the primary truth)
SELECT
  sf_deal_id, sf_listing_id, staging_id, deal_name, deal_side, sjc_team,
  listing_broker_sf_id, deal_status, deal_stage, is_closed, marketing_status,
  closed_price, asking_price, cap_rate, noi, est_close_date, first_broadcast_date,
  property_address, city, state, primary_use, seller_company, linked_property_id,
  match_confidence, matched_sale_id, sf_last_modified, broker_name
FROM deal
UNION ALL
-- Listing rows ONLY where not already represented by a Deal row (dedup by sf_deal_id or dedup_key)
SELECT
  l.sf_deal_id, l.sf_listing_id, l.staging_id, l.deal_name, l.deal_side, l.sjc_team,
  l.listing_broker_sf_id, l.deal_status, l.deal_stage, l.is_closed, l.marketing_status,
  l.closed_price, l.asking_price, l.cap_rate, l.noi, l.est_close_date, l.first_broadcast_date,
  l.property_address, l.city, l.state, l.primary_use, l.seller_company, l.linked_property_id,
  l.match_confidence, l.matched_sale_id, l.sf_last_modified, l.broker_name
FROM listing l
WHERE NOT EXISTS (
        SELECT 1 FROM deal dd
         WHERE (dd.sf_deal_id IS NOT NULL AND dd.sf_deal_id = l.sf_deal_id)
            OR dd.dedup_key = l.dedup_key
      );

-- v_sjc_deal_book_summary + v_sjc_deal_book_by_year read v_sjc_deal_book BY NAME,
-- so they inherit the deal-primary source with no change.

COMMENT ON VIEW public.v_sjc_deal_book IS
  'Deal-object-primary SJC deal book. Primary source = v_sjc_deal_ingest_current '
  '(sf_deal_staging crawl ∪ sjc_deal_ingest bootstrap, superseded by dedup_key). '
  'sf_listing_staging is supplemental (active marketing + closed listings not yet '
  'covered by a Deal row). Revert to the listing-only body in '
  '20260604140000_dia_sjc_deal_book_dedupe.sql.';
