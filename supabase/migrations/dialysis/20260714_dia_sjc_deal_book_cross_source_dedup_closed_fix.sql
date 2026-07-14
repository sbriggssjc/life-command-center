-- ============================================================================
-- Dia — SJC Deal Book: tighten cross-source dedup (Bug 1) + fix manual-row
-- closed classification (Bug 2)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL / zqzrriwuavgrquhisnoa)
--
-- WHY (grounded live 2026-07-14): loading the bootstrap seed into
-- public.sjc_deal_ingest surfaced two consolidation bugs that over-count closed
-- deals (v_sjc_deal_book showed 313 closed vs the ~251 SF-export ground truth):
--
--   BUG 1 — cross-source dedup misses same-deal pairs.
--     dedup_key = norm(deal_name)|close_date(YYYY-MM-DD)|round(price/1000)*1000.
--     The sf_crawl arm records est_close_date = expected_close_date; the
--     manual_export arm records the actual close_date. For the same deal these
--     differ by a few DAYS (often crossing a month/year boundary), so the
--     day-precise dedup_key never sees the pair as duplicates and DISTINCT ON
--     keeps BOTH. Grounded live: 35 sf_crawl rows (all closed) name-match a
--     manual_export twin yet were never collapsed. The names are essentially
--     unique property identifiers ("DaVita Dialysis - <City> - <ST>"), the
--     price rounds to the same $1k bucket, only the date drifts.
--     Fix: add a ROBUST cross-source supersede key
--       cross_key = norm(deal_name) | close-YEAR
--     and DISTINCT ON (cross_key) keeping sf_crawl first. Grounded safe:
--       * name+year has ZERO intra-source collisions in BOTH arms (name-only
--         has 10 cross-year manual dupes = legitimately different deals; the
--         year segment keeps those separate).
--       * the 3 intra-crawl name+year groups are 0-closed (2 of 3 are
--         deal_side='other', excluded from the book; the third — Grants Pass —
--         is a genuine duplicate Opportunity record).
--     So cross_key collapses only genuine same-deal rows; the day-precise
--     dedup_key is retained as an output/audit column.
--
--   BUG 2 — manual_export rows are all hard-coded is_closed=TRUE.
--     The bootstrap arm stamped is_closed=TRUE / deal_stage='closed' on EVERY
--     manual_export row, but ~20 are referral / outside-fee / advisory
--     ENGAGEMENTS (a fee, not a property sale) that never closed a sale.
--     Grounded live: the reliable discriminator is a referral/outside-fee/
--     advisory MARKER in the deal_name (or deal_type = 'IS - Referral') — NOT
--     null-price. Two null-price rows carry NO marker and ARE genuine closed
--     sales with an unrecorded price ("DaVita Dialysis - Jonesboro - GA" =
--     co-broke buyer; "Fresenius Medical Care (SLB) - Ruston, LA" = a
--     sale-leaseback), so a "null price => not closed" rule would wrongly drop
--     them. The two marker rows that carry a NON-null price ("... (Referral)"
--     @ $178,880 / $196,460) record a referral FEE, not a sale price.
--     Fix: classify a manual_export row by the marker via
--       public.sjc_deal_is_non_sale(deal_name, deal_type). A marker row becomes
--       deal_side='IS - Referral', deal_stage='referral', is_closed=FALSE,
--       closed_price=NULL (kept in the book as a non-closed referral record, so
--       it no longer inflates closed count / closed-volume / cap-rate). Every
--       other manual row (incl. null-price co-broke / SLB) stays a closed sale.
--
-- Bug 2 is applied UNIFORMLY to BOTH arms: grounding found 2 sf_crawl rows
-- ("DaVita - Terre Haute - IN (Referral)", "Fresenius ... Pasadena - TX
-- (Referral)") with stage='Closed IS' that also leaked as $0 closed Sale Deal -
-- Commercial rows, so the crawl arm gets the same sjc_deal_is_non_sale gate.
--
-- Verified live 2026-07-14: book closed 313 -> 259 (Bug 1 collapses 35
-- cross-source twins; Bug 2 reclassifies 17 manual + 2 crawl referral/advisory
-- rows to non-closed). closed Sale-Commercial 211 -> 209. Invariants: 0
-- cross-source dup groups in v_sjc_deal_ingest_current; 0 closed rows carry a
-- referral marker; v_sjc_deal_book_summary (259) + _by_year (209) reconcile with
-- the book. No genuine deal merged; both consumer views key on is_closed / a
-- Sale-Commercial deal_side, so referrals automatically drop out of closed
-- metrics. Book closed lands in the ~251-265 SF-export-truth range.
--
-- REVERSIBLE: re-create the prior view bodies from
-- 20260714_dia_sjc_deal_book_deal_primary.sql. The loaded sjc_deal_ingest data
-- is NOT touched (this migration only changes view definitions + adds two
-- IMMUTABLE helper functions). Idempotent (CREATE OR REPLACE).
-- ============================================================================

-- ── The robust cross-source supersede key (single source of truth) ──────────
-- cross_key = norm(deal_name) | close-YEAR. Collapses a crawl Deal row onto its
-- manual_export twin (day-level date drift + price rounding no longer split the
-- pair). A NULL close date falls back to the staging_id so an undated row can
-- never collapse onto another (there are 0 today; future-proofing).
CREATE OR REPLACE FUNCTION public.sjc_deal_cross_key(p_name text, p_close date, p_staging bigint)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(coalesce(public.sjc_norm_deal_name(p_name), ''))
      || '|' || COALESCE(to_char(p_close, 'YYYY'), 'nd:' || coalesce(p_staging::text, ''))
$$;

-- ── Non-sale (referral / outside-fee / advisory) marker detector ────────────
-- A fee ENGAGEMENT, not a closed property sale. Anchored on the marker text so
-- it never flips a genuine off-market SALE (deal_type 'IS - Off-Market (CM)'
-- WITHOUT a referral word) nor a null-price co-broke / SLB sale.
CREATE OR REPLACE FUNCTION public.sjc_deal_is_non_sale(p_name text, p_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (coalesce(p_name, '') ~* '(referral|outside\s*fee|advisory)')
      OR (coalesce(p_type, '') ~* '(referral|outside\s*fee|advisory)')
$$;

-- ── Consolidated deal-object truth (crawl ∪ bootstrap, superseded by cross_key)
-- One row per distinct deal. A sf_crawl row supersedes a manual_export row with
-- the same cross_key, then the most recently modified wins.
CREATE OR REPLACE VIEW public.v_sjc_deal_ingest_current AS
WITH src AS (
  -- crawl arm: the live SF Deal-object crawl. BUG 2 also applies here — a crawl
  -- Deal named "... (Referral)" carries stage='Closed IS' and would otherwise
  -- count as a $0 closed Sale Deal - Commercial (grounded: 2 such rows). The
  -- sjc_deal_is_non_sale marker reclassifies them to non-closed IS - Referral,
  -- uniformly with the manual arm.
  SELECT
    'sf_crawl'::text                                             AS deal_source,
    s.staging_id,
    s.sf_deal_id,
    s.sf_last_modified,
    s.deal_name,
    CASE
      WHEN public.sjc_deal_is_non_sale(s.deal_name, s.deal_type)
        THEN 'IS - Referral'
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
    CASE WHEN public.sjc_deal_is_non_sale(s.deal_name, s.deal_type)
         THEN 'Referral' ELSE s.stage END                       AS deal_status_raw,
    CASE
      WHEN public.sjc_deal_is_non_sale(s.deal_name, s.deal_type) THEN 'referral'
      WHEN s.stage = 'Closed IS'      THEN 'closed'
      WHEN s.stage = 'Terminated IS'  THEN 'terminated'
      WHEN s.stage = 'Listing Signed' THEN 'active_listing'
      WHEN s.stage = 'LOI Executed'   THEN 'under_loi'
      WHEN s.stage = 'In Escrow'      THEN 'in_escrow'
      WHEN s.stage = 'Non-refundable' THEN 'in_escrow'
      ELSE 'other'
    END                                                         AS deal_stage,
    (s.stage = 'Closed IS'
       AND NOT public.sjc_deal_is_non_sale(s.deal_name, s.deal_type)) AS is_closed,
    CASE WHEN public.sjc_deal_is_non_sale(s.deal_name, s.deal_type) THEN NULL::numeric
         WHEN s.stage = 'Closed IS' THEN s.deal_price END       AS closed_price,
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
  -- bootstrap / manual arm — BUG 2: classify referral / outside-fee / advisory
  -- ENGAGEMENTS as non-closed (was hard-coded is_closed=TRUE for every row).
  SELECT
    i.deal_source,
    i.staging_id,
    i.sf_deal_id,
    COALESCE(i.updated_at, i.created_at)                        AS sf_last_modified,
    i.deal_name,
    CASE
      WHEN public.sjc_deal_is_non_sale(i.deal_name, i.deal_type)
        THEN 'IS - Referral'
      WHEN lower(coalesce(i.referral,'')) IN ('yes','y','true','referral','1')
        THEN 'IS - Referral'
      WHEN lower(coalesce(i.deal_type,'')) LIKE '%buy%'
        THEN 'IS - Buy Side (CM)'
      WHEN lower(coalesce(i.deal_type,'')) LIKE '%off%market%'
        THEN 'IS - Off-Market (CM)'
      ELSE 'Sale Deal - Commercial'
    END                                                         AS deal_side,
    i.team                                                      AS sjc_team,
    CASE WHEN public.sjc_deal_is_non_sale(i.deal_name, i.deal_type)
         THEN 'Referral' ELSE 'Closed IS' END                  AS deal_status_raw,
    CASE WHEN public.sjc_deal_is_non_sale(i.deal_name, i.deal_type)
         THEN 'referral' ELSE 'closed' END                     AS deal_stage,
    (NOT public.sjc_deal_is_non_sale(i.deal_name, i.deal_type)) AS is_closed,
    CASE WHEN public.sjc_deal_is_non_sale(i.deal_name, i.deal_type)
         THEN NULL::numeric ELSE i.sales_price END              AS closed_price,
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
  SELECT src.*,
    public.sjc_deal_dedup_key(src.deal_name, src.est_close_date, src.closed_price) AS dedup_key,
    public.sjc_deal_cross_key(src.deal_name, src.est_close_date, src.staging_id)   AS cross_key
  FROM src
)
-- BUG 1: DISTINCT ON the robust cross_key (was dedup_key) so a crawl Deal row
-- supersedes its manual_export twin despite day-level date / price drift.
SELECT DISTINCT ON (cross_key) *
FROM keyed
ORDER BY cross_key,
         (deal_source = 'sf_crawl') DESC,      -- crawl supersedes manual_export
         sf_last_modified DESC NULLS LAST,
         staging_id DESC;

-- ── The book — DEAL-OBJECT-PRIMARY, Listing supplemental ────────────────────
-- 26 existing columns (exact order/type) + broker_name (col 27). Unchanged
-- output; the Listing-arm dedup now keys on cross_key (was dedup_key) to match
-- the consolidated deal arm.
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
    c.dedup_key,
    c.cross_key
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
      public.lcc_safe_numeric(d.j->>'Notable_Transaction_Price_sjc__c'))     AS dedup_key,
    public.sjc_deal_cross_key(
      COALESCE(d.j->>'Deal_Name_sjc__c', d.j->>'Name', d.listing_name),
      public.lcc_safe_date(d.j->>'Est_Act_Close_Date_sjc__c'),
      d.staging_id)                                                          AS cross_key
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
-- Listing rows ONLY where not already represented by a Deal row
-- (dedup by sf_deal_id or the robust cross_key)
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
            OR dd.cross_key = l.cross_key
      );

COMMENT ON VIEW public.v_sjc_deal_book IS
  'Deal-object-primary SJC deal book. Primary source = v_sjc_deal_ingest_current '
  '(sf_deal_staging crawl ∪ sjc_deal_ingest bootstrap, superseded by cross_key = '
  'norm(deal_name)|close-YEAR so a crawl Deal collapses its manual_export twin '
  'despite day-level date drift). Manual rows carrying a referral/outside-fee/'
  'advisory marker (sjc_deal_is_non_sale) are non-closed IS - Referral records. '
  'sf_listing_staging is supplemental. Revert to '
  '20260714_dia_sjc_deal_book_deal_primary.sql.';
