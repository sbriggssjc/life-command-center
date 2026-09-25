-- SALE-PROMOTER1 (2026-09-25): record the sales Salesforce and the CoStar sidebar already know about,
-- so a sold listing closes itself through LISTING-SALE-PARITY1's triggers. Dia half; the gov half is
-- government-lease sql/20260925_gov_sale_promoter1.sql, and the rule block below is byte-identical there.
--
-- Measured before this file (live, 2026-09-25): active dia listings sold per Salesforce or the CoStar
-- sidebar with no sales_transactions row on their own property: 25570 Oak Forest (SF), 28981 Manchester
-- (SF + sidebar), 35803 Bronx (sidebar), 27823 Durham (sidebar, owner-user), 37696 Kissimmee (sidebar).
-- Dia had NO sf_comp_staging -> sales writer at all (130 'External' Sold comps, 110 priced, 96 linked).
--
-- Pieces (same as gov): lcc_sale_candidate_verdict (shared, md5-pinned) · dia_sidebar_sale_candidate
-- (staged sidebar sales_history rows) · dia_promote_market_sales (guarded writer, dry-run default,
-- logged in dia_sale_promote_log; a second run writes 0) · dia_restore_sale_promote (undo) ·
-- dia_route_stale_listings_to_verification ('listed_over_2y' re-keyed on the capture date when the
-- on-market date is an older SF date) + dia_release_stale_listings_rekeyed.
-- Dia has no reliable first-seen stamp (backlog LISTING-SALE-PARITY1-dia-first-seen), so "capture" is
-- dia_listing_capture_date(), the same proxy the parity verdict uses. Dia sales_transactions has no
-- source_sf_id column; the SF comp id rides in notes and in dia_sale_promote_log.
--
-- Duplicates are judged against EVERY transaction_state, on the property and its civic-guarded twins,
-- and against a same-price sale in the same city on a DIFFERENT property. Live 2026-09-25 that second
-- check is Oak Forest (sale 14875 sits on 38853 "5340 159th St"; the listing is on 25570 "5340A W 159th
-- St") and Kissimmee (sale 14880 on 37624; the listing on 37696 "For Sale | 802 N John Young Pky").
-- Those are duplicate property rows: the promoter refuses and queues the listing for review instead of
-- minting a second comp.

-- ===== BEGIN lcc_sale_candidate_verdict (SALE-PROMOTER1) — byte-identical on dia and gov =====
-- One rule set for "is this Salesforce comp / CoStar sidebar sale row a sale we may record?".
-- Pure: it sees only the candidate's own facts, never a table. Identity, duplicates and the
-- write are the per-DB promoter's job (<dom>_promote_market_sales).
--   A date alone is not a sale (SIDEBAR-AGENCY-OVERWRITE): the candidate needs a price, a party
--   (buyer/seller) or a recording fact (deed/document number/recordation date).
--   A price-less transfer (a party or a deed, no price) is refused as refuse_priceless_transfer:
--   R37 (sidebar-pipeline classifySaleWrite) never mints a price-less row into sales_transactions,
--   and the promoter does not reopen that door. The promote log keeps the evidence.
--   Owner-user, non-arm's-length, nominal, related-party, partial-interest, auction, foreclosure
--   and condo/suite sales are recorded with exclude_from_market_metrics (promote_non_market):
--   the building changed hands, but the price is not a market comp. They never close a listing
--   on their own (lcc_listing_sale_verdict skips non-market sales); the promoter queues a review.
--   A portfolio price is refused: it is not this property's price.
CREATE OR REPLACE FUNCTION public.lcc_sale_candidate_verdict(
  p_sale_date date, p_price numeric, p_has_party boolean, p_has_recording boolean,
  p_sale_type text, p_deed_type text, p_recordation_date date, p_is_portfolio boolean,
  p_as_of date)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_sale_date IS NULL THEN
    RETURN 'refuse_no_date';
  END IF;
  IF p_sale_date > p_as_of + 1 THEN
    RETURN 'refuse_future_date';
  END IF;
  IF coalesce(p_deed_type, '') ~* '(mortgage|deed of trust|assignment|release|satisfaction)'
     OR coalesce(p_sale_type, '') ~* '(refinanc|standalone mortgage)' THEN
    RETURN 'refuse_not_a_transfer';
  END IF;
  IF p_recordation_date IS NOT NULL AND abs(p_recordation_date - p_sale_date) > 365 THEN
    RETURN 'refuse_date_inconsistent';
  END IF;
  IF coalesce(p_price, 0) <= 0 AND NOT coalesce(p_has_party, false)
     AND NOT coalesce(p_has_recording, false) THEN
    RETURN 'refuse_date_only';
  END IF;
  IF p_price IS NOT NULL AND p_price > 0 AND p_price < 50000 THEN
    RETURN 'refuse_price_implausible';
  END IF;
  IF coalesce(p_price, 0) <= 0 THEN
    RETURN 'refuse_priceless_transfer';
  END IF;
  IF coalesce(p_is_portfolio, false) THEN
    RETURN 'refuse_portfolio_price';
  END IF;
  IF coalesce(p_sale_type, '') ~* '(owner.?user|non.?arm|nominal|related|intra.?family|partial interest|auction|foreclos|\mreo\M|condo)' THEN
    RETURN 'promote_non_market';
  END IF;
  RETURN 'promote_market';
END
$fn$;
REVOKE ALL ON FUNCTION public.lcc_sale_candidate_verdict(date, numeric, boolean, boolean, text, text, date, boolean, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_sale_candidate_verdict(date, numeric, boolean, boolean, text, text, date, boolean, date) TO service_role;
-- ===== END lcc_sale_candidate_verdict =====

-- ---------------------------------------------------------------------------------------------
-- 1. Staged sidebar candidates. Loaded from LCC Opps entities.metadata.sales_history (the loader is
--    the operator/Cowork step documented in LCC docs/audits/SALE_PROMOTER1_2026-09-25.md).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dia_sidebar_sale_candidate (
  candidate_id      bigserial PRIMARY KEY,
  entity_id         uuid NOT NULL,
  row_key           text NOT NULL,
  property_id       integer NOT NULL,
  sale_date         date,
  sale_price        numeric,
  buyer             text,
  seller            text,
  sale_type         text,
  deed_type         text,
  document_number   text,
  recordation_date  date,
  comp_status       text,
  price_status      text,
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  loaded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, row_key)
);

CREATE TABLE IF NOT EXISTS public.dia_sale_promote_log (
  log_id             bigserial PRIMARY KEY,
  run_id             text NOT NULL,
  source             text NOT NULL,
  source_ref         text NOT NULL,
  property_id        integer,
  sale_date          date,
  sold_price         numeric,
  decision           text NOT NULL,
  reason             text,
  sale_id            integer,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_changed_at    timestamptz NOT NULL DEFAULT now(),
  restored_at        timestamptz,
  UNIQUE (source, source_ref)
);

ALTER TABLE public.dia_sidebar_sale_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dia_sale_promote_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dia_sidebar_sale_candidate, public.dia_sale_promote_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.dia_sidebar_sale_candidate_candidate_id_seq, public.dia_sale_promote_log_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dia_sidebar_sale_candidate, public.dia_sale_promote_log TO service_role;
GRANT ALL ON SEQUENCE public.dia_sidebar_sale_candidate_candidate_id_seq, public.dia_sale_promote_log_log_id_seq TO service_role;
DROP POLICY IF EXISTS service_role_all_dia_sidebar_sale_candidate ON public.dia_sidebar_sale_candidate;
CREATE POLICY service_role_all_dia_sidebar_sale_candidate ON public.dia_sidebar_sale_candidate
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_dia_sale_promote_log ON public.dia_sale_promote_log;
CREATE POLICY service_role_all_dia_sale_promote_log ON public.dia_sale_promote_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------------------------
-- 2. The promoter.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dia_promote_market_sales(
  p_dry_run boolean DEFAULT true, p_since date DEFAULT NULL, p_property_ids integer[] DEFAULT NULL,
  p_run text DEFAULT NULL)
RETURNS TABLE(source text, source_ref text, property_id integer, sale_date date, sold_price numeric,
              decision text, reason text, sale_id integer)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
#variable_conflict use_column
DECLARE
  v_run   text := coalesce(p_run, 'sale_promoter1_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'));
  v_since date := coalesce(p_since, current_date - 730);
  r       record;
  v_new   integer;
  v_dec   text;
  v_rsn   text;
  v_l     record;
BEGIN
  DROP TABLE IF EXISTS _spc;
  CREATE TEMP TABLE _spc ON COMMIT DROP AS
  WITH sf AS (
    SELECT 'sf_comp'::text AS src, cs.sf_comp_id AS ref, cs.linked_property_id AS pid,
           cs.street, cs.state AS c_state, cs.sold_date AS sd, cs.sold_price AS sp,
           NULL::text AS buyer, NULL::text AS seller,
           concat_ws(' ', CASE WHEN (cs.raw_row->>'Auction_Sale__c')::boolean THEN 'auction' END,
                          CASE WHEN (cs.raw_row->>'Condo_Coop__c')::boolean THEN 'condo' END) AS stype,
           NULL::text AS dtype, NULL::date AS recd,
           coalesce((cs.raw_row->>'Buyer_Seller_Populated__c')::boolean, false) AS has_party,
           false AS has_rec,
           coalesce((cs.raw_row->>'Portfolio__c')::boolean, false) AS portfolio,
           cs.normalized_address AS naddr, 2 AS src_rank
      FROM (SELECT DISTINCT ON (s0.sf_comp_id) s0.*          -- staging can hold one comp twice
              FROM public.sf_comp_staging s0
             ORDER BY s0.sf_comp_id, s0.imported_at DESC NULLS LAST, s0.staging_id DESC) cs
     WHERE cs.source_system = 'salesforce' AND cs.comp_type = 'External' AND cs.status = 'Sold'
       AND NOT coalesce((cs.raw_row->>'Deleted__c')::boolean, false)
       AND cs.sold_date >= v_since
  ), sb AS (
    SELECT 'sidebar'::text, c.entity_id || ':' || c.row_key, c.property_id,
           NULL::text, NULL::text, c.sale_date, c.sale_price, c.buyer, c.seller,
           c.sale_type, c.deed_type, c.recordation_date,
           (nullif(btrim(c.buyer), '') IS NOT NULL OR nullif(btrim(c.seller), '') IS NOT NULL),
           (nullif(btrim(c.document_number), '') IS NOT NULL OR c.recordation_date IS NOT NULL
              OR nullif(btrim(c.deed_type), '') IS NOT NULL),
           coalesce(c.raw->>'sale_condition', '') ~* '(portfolio|bulk)',
           NULL::text, 1
      FROM (SELECT x.candidate_id, x.entity_id, x.row_key, x.property_id, x.sale_date, x.sale_price,
                   -- a placeholder party ('Undisclosed', 'Unknown', ...) is not a party
                   CASE WHEN x.buyer ~* '^\s*(undisclosed|not disclosed|unknown|n/?a|none|tbd)\s*$' THEN NULL
                        ELSE nullif(btrim(x.buyer), '') END AS buyer,
                   CASE WHEN x.seller ~* '^\s*(undisclosed|not disclosed|unknown|n/?a|none|tbd)\s*$' THEN NULL
                        ELSE nullif(btrim(x.seller), '') END AS seller,
                   x.sale_type, x.deed_type, x.document_number, x.recordation_date, x.raw
              FROM public.dia_sidebar_sale_candidate x) c
     WHERE c.sale_date >= v_since
  ), u AS (SELECT * FROM sf UNION ALL SELECT * FROM sb)
  SELECT u.*,
         lcc_sale_candidate_verdict(u.sd, u.sp, u.has_party, u.has_rec, u.stype, u.dtype, u.recd,
                                    u.portfolio, current_date) AS rule,
         coalesce(u.pid, am.only_id) AS rpid,
         am.n_match
    FROM u
    LEFT JOIN LATERAL (
      SELECT min(p.property_id) AS only_id, count(*) AS n_match
        FROM public.properties p
       WHERE u.pid IS NULL AND u.street IS NOT NULL
         AND substring(u.street, '^\s*(\d+)') IS NOT NULL
         AND dia_normalize_state((p.state)::text) = dia_normalize_state(u.c_state)
         AND dia_normalize_address(p.address) = dia_normalize_address(u.street)
         AND substring(p.address, '^\s*(\d+)') = substring(u.street, '^\s*(\d+)')
      HAVING count(*) = 1
    ) am ON true;

  DROP TABLE IF EXISTS _spd;
  CREATE TEMP TABLE _spd ON COMMIT DROP AS
  SELECT c.*,
    CASE
      WHEN c.rule LIKE 'refuse_%' THEN c.rule
      WHEN c.rpid IS NULL THEN 'refuse_property_unmatched'
      WHEN p.property_id IS NULL THEN 'refuse_property_missing'
      WHEN lg.restored_at IS NOT NULL THEN 'skip_restored'
      WHEN lg.decision LIKE 'promoted_%' THEN 'skip_already_promoted'
      WHEN EXISTS (SELECT 1 FROM public.sales_transactions s
                    WHERE s.property_id = ANY (dia_listing_twin_property_ids(c.rpid))
                      AND abs(s.sale_date - c.sd) <= 30) THEN 'refuse_existing_sale_within_30d'
      WHEN c.sp > 0 AND EXISTS (SELECT 1 FROM public.sales_transactions s
                    WHERE s.property_id = ANY (dia_listing_twin_property_ids(c.rpid))
                      AND abs(s.sale_date - c.sd) <= 400
                      AND abs(s.sold_price - c.sp) <= 0.01 * c.sp) THEN 'refuse_existing_same_price'
      WHEN c.sp > 0 AND EXISTS (SELECT 1 FROM public.sales_transactions s
                    JOIN public.properties sp2 ON sp2.property_id = s.property_id
                    WHERE s.property_id <> ALL (dia_listing_twin_property_ids(c.rpid))
                      AND dia_normalize_state((sp2.state)::text) = dia_normalize_state((p.state)::text)
                      AND lower(btrim(sp2.city)) = lower(btrim(p.city))
                      AND abs(s.sale_date - c.sd) <= 45
                      AND abs(s.sold_price - c.sp) <= 0.005 * c.sp) THEN 'refuse_sale_on_other_property'
      WHEN EXISTS (SELECT 1 FROM _spc o
                    WHERE o.rpid = c.rpid AND o.ref <> c.ref AND o.rule LIKE 'promote_%'
                      AND abs(o.sd - c.sd) <= 30
                      AND (coalesce(o.sp, 0) > 0, o.has_party, o.src_rank, o.ref)
                          > (coalesce(c.sp, 0) > 0, c.has_party, c.src_rank, c.ref))
        THEN 'refuse_duplicate_candidate'
      WHEN c.sp > 0 AND EXISTS (SELECT 1 FROM _spc o
                    WHERE o.rpid IS DISTINCT FROM c.rpid AND o.rule LIKE 'promote_%'
                      AND abs(o.sd - c.sd) <= 45 AND abs(o.sp - c.sp) <= 0.005 * c.sp)
        THEN 'refuse_same_price_other_candidate'
      ELSE c.rule
    END AS decision,
    (SELECT s.sale_id FROM public.sales_transactions s
       JOIN public.properties sp2 ON sp2.property_id = s.property_id
      WHERE c.sp > 0 AND s.property_id <> ALL (dia_listing_twin_property_ids(coalesce(c.rpid, -1)))
        AND dia_normalize_state((sp2.state)::text) = dia_normalize_state((p.state)::text) AND lower(btrim(sp2.city)) = lower(btrim(p.city))
        AND abs(s.sale_date - c.sd) <= 45 AND abs(s.sold_price - c.sp) <= 0.005 * c.sp
      ORDER BY abs(s.sale_date - c.sd) LIMIT 1) AS other_sale_id
  FROM _spc c
  LEFT JOIN public.properties p ON p.property_id = c.rpid
  LEFT JOIN public.dia_sale_promote_log lg ON lg.source = c.src AND lg.source_ref = c.ref
  WHERE p_property_ids IS NULL OR c.rpid = ANY (p_property_ids);

  FOR r IN SELECT * FROM _spd ORDER BY rpid NULLS LAST, sd, ref LOOP
    v_dec := r.decision; v_new := NULL;
    v_rsn := CASE WHEN r.decision = 'refuse_property_unmatched' AND r.pid IS NULL
                   THEN 'no linked property and no single civic-guarded address match'
                   WHEN r.decision = 'refuse_sale_on_other_property'
                   THEN 'same price and city on another property (sale ' || r.other_sale_id || ')' END;

    IF NOT p_dry_run AND r.decision LIKE 'promote_%' THEN
      BEGIN
        INSERT INTO public.sales_transactions (property_id, sold_price, sale_date, buyer_name, seller_name,
               data_source, transaction_state, exclude_from_market_metrics, transaction_type, notes)
        VALUES (r.rpid, nullif(r.sp, 0), r.sd, r.buyer, r.seller,
                CASE r.src WHEN 'sf_comp' THEN 'salesforce_market_comp' ELSE 'costar_sidebar_promote' END,
                'live', r.decision = 'promote_non_market', nullif(btrim(r.stype), ''),
                'SALE-PROMOTER1 ' || r.src || ' ' || r.ref
                  || CASE WHEN r.decision = 'promote_non_market'
                          THEN ' (non-market: ' || coalesce(nullif(btrim(r.stype), ''), 'no price') || ')' ELSE '' END)
        RETURNING sales_transactions.sale_id INTO v_new;
        v_dec := 'promoted_' || substr(r.decision, 9);
      EXCEPTION WHEN OTHERS THEN
        v_dec := 'refuse_write_error'; v_new := NULL;
        v_rsn := SQLSTATE || ' ' || SQLERRM;
      END;

      -- A non-market sale never closes a listing (lcc_listing_sale_verdict); a promoted market sale
      -- the verdict still cannot close (an undated listing) is not guessed at. Both go to review.
      IF v_new IS NOT NULL THEN
        FOR v_l IN SELECT al.listing_id, b.verdict
                     FROM public.available_listings al
                     CROSS JOIN LATERAL public.dia_listing_best_sale_verdict(
                            al.listing_id, al.property_id, al.on_market_date, al.on_market_date_confidence,
                            dia_listing_capture_date(al.last_seen, al.listing_date_source, al.listing_date, al.created_at),
                            coalesce(al.last_price, al.initial_price)) b
                    WHERE al.property_id = r.rpid
                      AND al.is_active IS TRUE
                      AND b.verdict NOT LIKE 'review_%'
        LOOP
          INSERT INTO public.dia_listing_sale_review (listing_id, sale_id, verdict, details)
          VALUES (v_l.listing_id, v_new,
                  CASE WHEN v_dec = 'promoted_non_market' THEN 'review_non_market_sale'
                       ELSE 'review_promoted_sale_listing_open' END,
                  jsonb_build_object('batch', v_run, 'listing_verdict', v_l.verdict, 'sale_date', r.sd,
                                     'sold_price', r.sp, 'source', r.src, 'source_ref', r.ref))
          ON CONFLICT (listing_id, sale_id) DO NOTHING;
        END LOOP;
      END IF;
    ELSIF NOT p_dry_run AND r.decision = 'refuse_sale_on_other_property' AND r.other_sale_id IS NOT NULL THEN
      INSERT INTO public.dia_listing_sale_review (listing_id, sale_id, verdict, details)
      SELECT al.listing_id, r.other_sale_id, 'review_sale_on_other_property',
             jsonb_build_object('batch', v_run, 'candidate_property_id', r.rpid, 'sale_date', r.sd,
                                'sold_price', r.sp, 'source', r.src, 'source_ref', r.ref)
        FROM public.available_listings al
       WHERE al.property_id = r.rpid
         AND al.is_active IS TRUE
      ON CONFLICT (listing_id, sale_id) DO NOTHING;
    END IF;

    IF NOT p_dry_run AND v_dec NOT IN ('skip_already_promoted', 'skip_restored') THEN
      INSERT INTO public.dia_sale_promote_log AS lg (run_id, source, source_ref, property_id, sale_date,
             sold_price, decision, reason, sale_id, details)
      VALUES (v_run, r.src, r.ref, r.rpid, r.sd, r.sp, v_dec, v_rsn, v_new,
              jsonb_build_object('rule', r.rule, 'address_match', r.pid IS NULL AND r.rpid IS NOT NULL))
      ON CONFLICT (source, source_ref) DO UPDATE
        SET run_id = EXCLUDED.run_id, property_id = EXCLUDED.property_id, sale_date = EXCLUDED.sale_date,
            sold_price = EXCLUDED.sold_price, decision = EXCLUDED.decision, reason = EXCLUDED.reason,
            sale_id = EXCLUDED.sale_id, details = EXCLUDED.details, last_changed_at = now()
        WHERE lg.decision IS DISTINCT FROM EXCLUDED.decision AND lg.decision NOT LIKE 'promoted_%';
    END IF;
    source := r.src; source_ref := r.ref; property_id := r.rpid; sale_date := r.sd;
    sold_price := r.sp; decision := v_dec; reason := v_rsn; sale_id := v_new;
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 3. Undo a run (or one candidate within it).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dia_restore_sale_promote(p_run text, p_source_ref text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE r record; c record; n integer := 0;
BEGIN
  FOR r IN SELECT * FROM public.dia_sale_promote_log
            WHERE run_id = p_run AND decision LIKE 'promoted_%' AND restored_at IS NULL AND sale_id IS NOT NULL
              AND (p_source_ref IS NULL OR source_ref = p_source_ref)
  LOOP
    FOR c IN SELECT DISTINCT batch_tag, listing_id FROM public.dia_listing_sale_close_log
              WHERE sale_id = r.sale_id AND restored_at IS NULL LOOP
      PERFORM public.dia_restore_listing_sale_close(c.batch_tag, c.listing_id);
    END LOOP;
    UPDATE public.available_listings SET sale_transaction_id = NULL WHERE sale_transaction_id = r.sale_id;
    DELETE FROM public.dia_listing_sale_review WHERE sale_id = r.sale_id AND status = 'open';
    DELETE FROM public.sales_transactions WHERE sale_id = r.sale_id;
    UPDATE public.dia_sale_promote_log SET restored_at = now() WHERE log_id = r.log_id;
    n := n + 1;
  END LOOP;
  RETURN n;
END
$fn$;

-- ---------------------------------------------------------------------------------------------
-- 4. Stale rule: 'listed_over_2y' measured from the capture date when the on-market date is a
--    Salesforce date older than capture (a 2026 OM carrying a 2019 SF on-market date is not a
--    listing we have watched for seven years). Everything else unchanged.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dia_listing_market_age_date(
  p_on_market_date date, p_on_market_source text, p_listing_date date, p_capture date)
RETURNS date
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_on_market_source = 'sf_on_market_date' AND p_capture IS NOT NULL
                   AND p_on_market_date < p_capture
              THEN p_capture
              ELSE coalesce(p_on_market_date, p_listing_date) END
$fn$;

CREATE OR REPLACE FUNCTION public.dia_route_stale_listings_to_verification(
  p_dry_run boolean DEFAULT true, p_batch text DEFAULT NULL)
RETURNS TABLE(listing_id integer, reason text)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
#variable_conflict use_column
DECLARE r record; v_batch text := coalesce(p_batch, 'listing_stale_verify_' || to_char(now(), 'YYYYMMDD'));
BEGIN
  FOR r IN
    SELECT al.listing_id AS lid, al.verification_due_at, al.verification_priority,
           CASE WHEN al.last_seen < current_date - 180 THEN 'not_seen_180d'
                ELSE 'listed_over_2y' END AS why
      FROM public.available_listings al
     WHERE al.is_active IS TRUE
       AND (al.last_seen < current_date - 180
            OR dia_listing_market_age_date(al.on_market_date, al.on_market_date_source, al.listing_date,
                 dia_listing_capture_date(al.last_seen, al.listing_date_source, al.listing_date, al.created_at))
               < current_date - 730)
       AND (al.verification_due_at IS NULL OR al.verification_due_at > now()
            OR coalesce(al.verification_priority, '') <> 'high')
  LOOP
    listing_id := r.lid; reason := r.why;
    IF NOT p_dry_run THEN
      INSERT INTO public.dia_listing_sale_close_log (batch_tag, listing_id, sale_id, verdict, action, prior)
      VALUES (v_batch, r.lid, NULL, r.why, 'stale_verify',
              jsonb_build_object('verification_due_at', r.verification_due_at,
                                 'verification_priority', r.verification_priority));
      UPDATE public.available_listings al
         SET verification_due_at = least(coalesce(al.verification_due_at, now()), now()),
             verification_priority = 'high'
       WHERE al.listing_id = r.lid;
    END IF;
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- Release listings the old rule queued that the re-keyed rule would not: restore each one's
-- stale_verify log row (it puts verification_due_at/priority back, and stamps restored_at).
CREATE OR REPLACE FUNCTION public.dia_release_stale_listings_rekeyed(p_dry_run boolean DEFAULT true)
RETURNS TABLE(listing_id integer, batch_tag text)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
#variable_conflict use_column
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT l.batch_tag AS b, l.listing_id AS lid
      FROM public.dia_listing_sale_close_log l
      JOIN public.available_listings al ON al.listing_id = l.listing_id
     WHERE l.action = 'stale_verify' AND l.verdict = 'listed_over_2y' AND l.restored_at IS NULL
       AND NOT coalesce(al.last_seen < current_date - 180, false)
       AND NOT coalesce(dia_listing_market_age_date(al.on_market_date, al.on_market_date_source, al.listing_date,
                 dia_listing_capture_date(al.last_seen, al.listing_date_source, al.listing_date, al.created_at))
               < current_date - 730, false)
  LOOP
    listing_id := r.lid; batch_tag := r.b;
    IF NOT p_dry_run THEN
      PERFORM public.dia_restore_listing_sale_close(r.b, r.lid);
    END IF;
    RETURN NEXT;
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION public.dia_promote_market_sales(boolean, date, integer[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_restore_sale_promote(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_listing_market_age_date(date, text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_route_stale_listings_to_verification(boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dia_release_stale_listings_rekeyed(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dia_promote_market_sales(boolean, date, integer[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_restore_sale_promote(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_listing_market_age_date(date, text, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_route_stale_listings_to_verification(boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dia_release_stale_listings_rekeyed(boolean) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Schedule: daily 05:52 UTC, after the hourly SF staging refresh (:41).
-- ---------------------------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dia-sale-promoter';
    PERFORM cron.schedule('dia-sale-promoter', '52 5 * * *',
                          'select count(*) from public.dia_promote_market_sales(false)');
  END IF;
END
$cron$;

DO $assert$
BEGIN
  IF has_table_privilege('anon', 'public.dia_sale_promote_log', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dia_sidebar_sale_candidate', 'INSERT') THEN
    RAISE EXCEPTION 'sale-promoter ledgers are client-writable';
  END IF;
  IF has_function_privilege('anon', 'public.dia_promote_market_sales(boolean, date, integer[], text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.dia_restore_sale_promote(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'sale promoter is client-executable';
  END IF;
  IF lcc_sale_candidate_verdict('2026-07-01', NULL, false, false, NULL, NULL, NULL, false, '2026-09-25') <> 'refuse_date_only' THEN
    RAISE EXCEPTION 'lcc_sale_candidate_verdict self-check failed';
  END IF;
END
$assert$;
