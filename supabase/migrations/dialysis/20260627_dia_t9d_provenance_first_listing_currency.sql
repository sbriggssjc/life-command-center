-- =============================================================================
-- T9d (2026-06-27, dia zqzrriwuavgrquhisnoa) — PROVENANCE-FIRST listing currency.
-- Replaces the rejected exclusion-based T9d (reverted). Constructive: recover the
-- TRUE on-market date from the source we hold, keep every evidenced deal, window
-- it honestly. Reversible; no fabricated dates; dia only.
--
-- Doctrine (Scott, 2026-06-26): a listing is an "available for sale" deal if we
-- hold ANY real source (OM / flyer / email / fax / comp / CoStar-RCA capture).
-- A live URL is NOT required (commercial has no MLS — we'll never reach 100%).
-- So: KEEP every provenance-backed listing, recover its date from the document,
-- infer exits conservatively, and window currency = entry + exit + a generous
-- age-out backstop (NOT a live re-check — 0/323 were ever URL-checked).
--
-- ⚠️ SUPERSEDES the 2026-06-24 "keep the listing_date freshness gate; do NOT
--    switch cm_dialysis_active_listings_m/_q membership to on_market_date" note.
--    T9c explicitly queued this round ("re-key the currency proxy on authoritative
--    on_market_date, or park the fake listing_dates"). The fake capture_date_fallback
--    listing_dates + phantom last_seen are exactly what inflated the count; the
--    proxy is retired here. The CLAUDE.md CM doctrine note is updated to match.
--
-- THE RECOVERY KEY (grounded live 2026-06-27): OM/flyer artifacts are stored at
--   intake under `lcc-om-uploads/YYYY-MM-DD/<uuid>-…` where the date segment is the
--   OM's RECEIPT date. 242/242 NULL-on_market_date listings that carry an artifact
--   have a parseable path date (created_at is NULL on these rows; listing_date is
--   the fake capture_date_fallback). The path date is the real evidence — recovered
--   here retroactively, and at the ingest path going forward (intake-promoter.js).
--
-- Apply order matters and is encoded top-to-bottom:
--   Unit 4 (harden close-on-sale + orphan repair) FIRST so the Unit-1 recovery
--   UPDATE of on_market_date is governed by the hardened trigger; then Unit 1
--   (recovery + classify date_uncertain, reversible); then Unit 2 (rebuild the
--   membership views on on_market_date). Idempotent: a replay recovers 0 new rows.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- UNIT 4 — close-on-sale landmine: window the match, repair the orphan FK.
-- ─────────────────────────────────────────────────────────────────────────────

-- 4a) Repair the orphaned property_sale_events.sales_transaction_id=5701
--     (the referenced sales_transactions row does not exist). NULL the dangling
--     pointer — the event row itself (date/price) is kept. Reversible: re-set if
--     the sale is ever re-created. (414 such dangling pointers exist in total;
--     only the audit-named 5701 is repaired here per scope — the rest are
--     surfaced for a separate sweep.)
UPDATE public.property_sale_events
   SET sales_transaction_id = NULL
 WHERE sales_transaction_id = 5701
   AND NOT EXISTS (SELECT 1 FROM public.sales_transactions st WHERE st.sale_id = 5701);

-- 4b) Harden fn_listing_close_if_sold. The bug: with NEW.on_market_date NULL the
--     sale-match window `(v_on_market IS NULL OR sale_date >= v_on_market - 90d)`
--     collapsed to "any past sale on the property" → a listing could auto-close
--     Sold against an old/unrelated (pre-market-entry) sale. Fix:
--       * anchor the window on COALESCE(on_market_date, listing_date) = v_ref;
--       * when v_ref IS NULL, do NOT auto-close (no anchor → cannot match safely);
--       * bound the match BOTH sides: v_ref - 90d <= sale_date <= LEAST(today,
--         v_ref + 1356d + 180d grace) so neither a pre-entry sale nor a sale far
--         beyond plausible listing-life is matched;
--       * guard a dangling txn pointer (never stamp a non-existent sale_id).
CREATE OR REPLACE FUNCTION public.fn_listing_close_if_sold()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_sale_date  DATE;
    v_sale_price NUMERIC;
    v_sale_txn   BIGINT;
    v_ref        DATE := COALESCE(NEW.on_market_date, NEW.listing_date);
    v_hi         DATE;
BEGIN
    -- Already-closed listings are never re-overridden.
    IF COALESCE(NEW.is_active, TRUE) IS NOT TRUE
       AND LOWER(COALESCE(NEW.status, '')) IN ('sold','closed','closed but obligated','superseded','stale','withdrawn','expired','orphan')
    THEN
        RETURN NEW;
    END IF;

    -- No market-entry anchor ⇒ cannot window the match ⇒ never auto-close.
    -- (T9d: this is the landmine fix — was "any past sale" when on_market was NULL.)
    IF v_ref IS NULL THEN
        RETURN NEW;
    END IF;

    v_hi := LEAST(CURRENT_DATE, (v_ref + INTERVAL '1356 days' + INTERVAL '180 days')::date);

    SELECT pse.sale_date, pse.price, pse.sales_transaction_id
      INTO v_sale_date, v_sale_price, v_sale_txn
      FROM public.property_sale_events pse
     WHERE pse.property_id = NEW.property_id
       AND pse.sale_date IS NOT NULL
       AND pse.sale_date >= v_ref - INTERVAL '90 days'
       AND pse.sale_date <= v_hi
     ORDER BY pse.sale_date DESC, pse.sale_event_id DESC
     LIMIT 1;

    IF v_sale_date IS NULL THEN
        SELECT st.sale_date, st.sold_price, st.sale_id
          INTO v_sale_date, v_sale_price, v_sale_txn
          FROM public.sales_transactions st
         WHERE st.property_id = NEW.property_id
           AND st.sale_date IS NOT NULL
           AND COALESCE(st.exclude_from_market_metrics, FALSE) = FALSE
           AND st.sale_date >= v_ref - INTERVAL '90 days'
           AND st.sale_date <= v_hi
         ORDER BY st.sale_date DESC, st.sale_id DESC
         LIMIT 1;
    END IF;

    -- Never stamp a dangling transaction id (the 5701-class orphan guard).
    IF v_sale_txn IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.sales_transactions st WHERE st.sale_id = v_sale_txn) THEN
        v_sale_txn := NULL;
    END IF;

    IF v_sale_date IS NOT NULL THEN
        NEW.status              := 'Sold';
        NEW.is_active           := FALSE;
        NEW.sold_date           := COALESCE(NEW.sold_date,       v_sale_date);
        NEW.sold_price          := COALESCE(NEW.sold_price,      v_sale_price);
        NEW.off_market_date     := COALESCE(NEW.off_market_date, v_sale_date);
        NEW.off_market_reason   := COALESCE(NEW.off_market_reason, 'sold');
        NEW.sale_transaction_id := COALESCE(NEW.sale_transaction_id, v_sale_txn::integer);
        NEW.notes               := COALESCE(NULLIF(NEW.notes, '') || E'\n', '') ||
                                   '[fn_listing_close_if_sold ' || CURRENT_DATE ||
                                   '] auto-closed: matched sale on ' || v_sale_date;
    END IF;
    RETURN NEW;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- UNIT 1 — recover on_market_date from provenance (constructive, reversible).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a) Reversible backup of every row Unit 1 changes (comprehensive prior mutable
--     state, so a revert restores even any close-on-sale the recovery UPDATE
--     triggers). Predicate = the union of the recovery set and the date_uncertain
--     reclass set. Drop the table -> zero trace.
CREATE TABLE IF NOT EXISTS public.t9d_listing_omd_backup (
  id                         bigserial PRIMARY KEY,
  listing_id                 integer NOT NULL,
  change_kind                text    NOT NULL,           -- 'recover_om_receipt' | 'reclass_date_uncertain'
  prior_on_market_date       date,
  prior_on_market_date_source text,
  prior_on_market_date_confidence text,
  prior_status               varchar,
  prior_is_active            boolean,
  prior_off_market_date      date,
  prior_off_market_reason    text,
  prior_sold_date            date,
  prior_sold_price           numeric,
  prior_sale_transaction_id  integer,
  prior_notes                text,
  batch_tag                  text    NOT NULL DEFAULT 't9d',
  snapped_at                 timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.t9d_listing_omd_backup IS
  'T9d reversible backup: prior mutable state of available_listings rows whose '
  'on_market_date was recovered from the artifact path (om_receipt) or reclassified '
  'date_uncertain. Reverse via the runbook at the bottom of the T9d migration.';

INSERT INTO public.t9d_listing_omd_backup
  (listing_id, change_kind, prior_on_market_date, prior_on_market_date_source,
   prior_on_market_date_confidence, prior_status, prior_is_active, prior_off_market_date,
   prior_off_market_reason, prior_sold_date, prior_sold_price, prior_sale_transaction_id, prior_notes)
SELECT al.listing_id,
       CASE WHEN al.intake_artifact_path ~ '/((?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))/'
            THEN 'recover_om_receipt' ELSE 'reclass_date_uncertain' END,
       al.on_market_date, al.on_market_date_source, al.on_market_date_confidence,
       al.status, al.is_active, al.off_market_date, al.off_market_reason,
       al.sold_date, al.sold_price, al.sale_transaction_id, al.notes
FROM public.available_listings al
WHERE al.on_market_date IS NULL
  AND COALESCE(al.on_market_date_source, '') = 'unestablished'
  AND NOT EXISTS (SELECT 1 FROM public.t9d_listing_omd_backup WHERE batch_tag = 't9d');

-- 1b) THE RECOVERY — fill on_market_date from the artifact storage-path receipt
--     date for held ('unestablished') rows that carry an artifact. Source
--     'om_receipt', confidence 'medium' (the receipt date, the best real evidence
--     for the OM/email channel — the T4c analog). Only sets rows currently HELD
--     (idempotent). The stricter regex (valid month/day) guarantees the cast
--     never fails; never sets a future date. listing_date is left RAW/audit.
UPDATE public.available_listings al
SET on_market_date            = (regexp_match(al.intake_artifact_path,
                                   '/((?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))/'))[1]::date,
    on_market_date_source     = 'om_receipt',
    on_market_date_confidence = 'medium'
WHERE al.on_market_date IS NULL
  AND COALESCE(al.on_market_date_source, '') = 'unestablished'
  AND al.intake_artifact_path ~ '/((?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))/'
  AND (regexp_match(al.intake_artifact_path,
        '/((?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))/'))[1]::date <= CURRENT_DATE;

-- 1c) CLASSIFY the un-recoverable-but-provenance-backed remainder as
--     'date_uncertain' (kept + surfaced, NEVER deleted; on_market_date stays NULL
--     so the row drops off the time axis honestly). Provenance = an intake
--     artifact type, an OM/email-harvest listing_date_source, a data_source, a
--     seller/broker, or raw_text. Rows with NO real provenance at all stay
--     'unestablished' (the only set genuinely excludable).
UPDATE public.available_listings al
SET on_market_date_source     = 'date_uncertain',
    on_market_date_confidence = 'none'
-- NOTE: 1b already moved every successfully-recovered row out of 'unestablished'
-- (its source is now 'om_receipt'), so the source filter alone excludes them; the
-- remainder are the genuinely un-dated rows.
WHERE al.on_market_date IS NULL
  AND COALESCE(al.on_market_date_source, '') = 'unestablished'
  AND (al.intake_artifact_type IS NOT NULL
       OR COALESCE(al.listing_date_source, '') IN
            ('capture_date_fallback','date_unknown_r70b34','date_unknown','om_lease_inference')
       OR al.data_source IS NOT NULL
       OR al.seller_name IS NOT NULL
       OR al.listing_broker IS NOT NULL
       OR NULLIF(al.raw_text, '') IS NOT NULL);

COMMENT ON COLUMN public.available_listings.on_market_date_source IS
  'T9d provenance: om_receipt (artifact storage-path receipt date) / sf_on_market_date '
  '/ on_market_date / costar_* / days_on_market / master_curated / unestablished_historical '
  '/ synth_* (synthetic, excluded) / date_uncertain (provenance but no recoverable date, '
  'kept + surfaced, off the time axis) / unestablished (held, no provenance).';

-- ─────────────────────────────────────────────────────────────────────────────
-- UNIT 2 — rebuild cm_dialysis_active_listings_m/_q membership on on_market_date.
--   available at period_end iff:  on_market_date present + non-synthetic (real
--   provenance)  AND  on_market_date <= period_end  AND  no exit by period_end
--   (off_market_date / sold_date)  AND  (period_end - on_market_date) <= 1356d
--   (generous p90-closed-DOM age-out backstop — a lost-track guard, NOT a pruner).
--   RETIRED: the last_seen/url_last_checked/last_verified_at/listing_date currency
--   PROXY and the listing_date entry gate and the status/is_active TODAY-state gate
--   (point-in-time availability is defined by entry + exits; verified 0 closed-no-
--   exit rows would sneak in). KEPT: synthetic guards + the synth on_market_date_source
--   guard. listing_date stays RAW/audit (never read for timing). days_on_market is
--   already period_end - on_market_date — now honest for recovered rows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_m AS
 WITH month_anchors AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2010-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), active_pairs AS (
   SELECT q.period_end,
      al.listing_id, al.property_id, al.listing_date, al.last_price,
      COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS last_cap_rate,
      al.initial_price, al.seller_name,
      p.operator, p.tenant, p.building_name, p.true_owner_name,
      q.period_end - al.on_market_date AS days_on_market,
      (al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price) AS had_price_change,
      COALESCE(
        CASE WHEN s.firm_term_years_at_sale IS NOT NULL AND s.sale_date >= q.period_end
             THEN s.firm_term_years_at_sale + (s.sale_date - q.period_end)::numeric / 365.0
             ELSE NULL::numeric END,
        ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
            FROM leases l
           WHERE l.property_id = al.property_id AND l.is_active = true
             AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text,'superseded_duplicate'::text,'expired'::text,'terminated'::text,'placeholder'::text,'closed'::text,'closed but obligated'::text]))
             AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end
             AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
           ORDER BY l.lease_expiration DESC
          LIMIT 1)) AS firm_term_years
     FROM month_anchors q
       JOIN available_listings al ON
              al.on_market_date IS NOT NULL
          AND al.on_market_date <= q.period_end
          AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text
          AND COALESCE(al.listing_date_source, ''::text) !~~ 'sale_anchor%'::text
          AND COALESCE(al.on_market_date_source, ''::text) !~~ 'synth%'::text
          AND (al.sold_date IS NULL OR al.sold_date > q.period_end)
          AND (al.off_market_date IS NULL OR al.off_market_date > q.period_end)
          AND (q.period_end - al.on_market_date) <= 1356
       LEFT JOIN properties p ON p.property_id = al.property_id
       LEFT JOIN sales_transactions s ON s.sale_id = al.sale_transaction_id
 )
 SELECT active_pairs.period_end,
    'all'::text AS subspecialty,
    active_pairs.listing_id, active_pairs.property_id, active_pairs.listing_date,
    active_pairs.days_on_market, active_pairs.last_price, active_pairs.last_cap_rate,
    active_pairs.initial_price, active_pairs.had_price_change, active_pairs.firm_term_years,
    active_pairs.firm_term_years >= 10::numeric AS is_core_10plus,
    true AS is_observed
   FROM active_pairs;

CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_q AS
 WITH quarter_anchors AS (
   SELECT (date_trunc('quarter', g.d) + '3 mons -1 days'::interval)::date AS period_end
   FROM generate_series('2013-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '3 mons'::interval) g(d)
 ), active_pairs AS (
   SELECT q.period_end,
      al.listing_id, al.property_id, al.listing_date, al.last_price,
      COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS last_cap_rate,
      al.initial_price, al.seller_name,
      p.operator, p.tenant, p.building_name, p.true_owner_name,
      q.period_end - al.on_market_date AS days_on_market,
      (al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price) AS had_price_change,
      COALESCE(
        ( SELECT st.firm_term_years_at_sale + (st.sale_date - q.period_end)::numeric / 365.0
            FROM sales_transactions st
           WHERE st.sale_id = al.sale_transaction_id AND st.firm_term_years_at_sale IS NOT NULL AND st.sale_date >= q.period_end),
        ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
            FROM leases l
           WHERE l.property_id = al.property_id
             AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text,'superseded_duplicate'::text,'terminated'::text]))
             AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end
             AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
           ORDER BY (COALESCE(l.is_active, false)) DESC, l.lease_expiration DESC
          LIMIT 1)) AS firm_term_years
     FROM quarter_anchors q
       JOIN available_listings al ON
              al.on_market_date IS NOT NULL
          AND al.on_market_date <= q.period_end
          AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text
          AND COALESCE(al.listing_date_source, ''::text) !~~ 'sale_anchor%'::text
          AND COALESCE(al.on_market_date_source, ''::text) !~~ 'synth%'::text
          AND (al.sold_date IS NULL OR al.sold_date > q.period_end)
          AND (al.off_market_date IS NULL OR al.off_market_date > q.period_end)
          AND (q.period_end - al.on_market_date) <= 1356
       LEFT JOIN properties p ON p.property_id = al.property_id
 )
 SELECT active_pairs.period_end,
    'all'::text AS subspecialty,
    active_pairs.listing_id, active_pairs.property_id, active_pairs.listing_date,
    active_pairs.days_on_market, active_pairs.last_price, active_pairs.last_cap_rate,
    active_pairs.initial_price, active_pairs.had_price_change, active_pairs.firm_term_years,
    active_pairs.firm_term_years >= 10::numeric AS is_core_10plus,
    CASE
        WHEN active_pairs.operator ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.operator ~~* '%fresenius%'::text OR active_pairs.operator ~~* '%fmc%'::text OR active_pairs.operator ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.operator ~~* '%u.s. renal%'::text OR active_pairs.operator ~~* '%us renal%'::text OR active_pairs.operator ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN active_pairs.operator IS NOT NULL AND TRIM(BOTH FROM active_pairs.operator) <> ''::text THEN 'Other'::text
        WHEN active_pairs.seller_name ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.seller_name ~~* '%fresenius%'::text OR active_pairs.seller_name ~~* '%fmc%'::text OR active_pairs.seller_name ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.seller_name ~~* '%u.s. renal%'::text OR active_pairs.seller_name ~~* '%us renal%'::text OR active_pairs.seller_name ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN active_pairs.tenant::text ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.tenant::text ~~* '%fresenius%'::text OR active_pairs.tenant::text ~~* '%fmc%'::text OR active_pairs.tenant::text ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.tenant::text ~~* '%u.s. renal%'::text OR active_pairs.tenant::text ~~* '%us renal%'::text OR active_pairs.tenant::text ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN active_pairs.building_name ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.building_name ~~* '%fresenius%'::text OR active_pairs.building_name ~~* '%fmc%'::text OR active_pairs.building_name ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.building_name ~~* '%u.s. renal%'::text OR active_pairs.building_name ~~* '%us renal%'::text OR active_pairs.building_name ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN active_pairs.true_owner_name ~~* '%davita%'::text THEN 'DaVita'::text
        WHEN active_pairs.true_owner_name ~~* '%fresenius%'::text OR active_pairs.true_owner_name ~~* '%fmc%'::text OR active_pairs.true_owner_name ~~* '%fkc%'::text THEN 'FMC'::text
        WHEN active_pairs.true_owner_name ~~* '%u.s. renal%'::text OR active_pairs.true_owner_name ~~* '%us renal%'::text OR active_pairs.true_owner_name ~~* '%usrc%'::text THEN 'US Renal'::text
        WHEN (active_pairs.seller_name IS NULL OR TRIM(BOTH FROM active_pairs.seller_name) = ''::text) AND (active_pairs.tenant IS NULL OR TRIM(BOTH FROM active_pairs.tenant) = ''::text) AND (active_pairs.building_name IS NULL OR TRIM(BOTH FROM active_pairs.building_name) = ''::text) AND (active_pairs.true_owner_name IS NULL OR TRIM(BOTH FROM active_pairs.true_owner_name) = ''::text) THEN 'Unknown'::text
        ELSE 'Other'::text
    END AS tenant_bucket,
    active_pairs.operator,
    true AS is_observed
   FROM active_pairs;

-- ── REVERSAL RUNBOOK (run only to undo T9d) ──────────────────────────────────
-- 1) Restore the prior view bodies from the pre-T9d definitions (the
--    listing_date-entry + last_seen-proxy gate) captured in
--    20260722_cm_round74_dia_canonical_active_inventory.sql / T4c.
-- 2) Restore the recovered/reclassified rows:
--    UPDATE public.available_listings al SET
--      on_market_date            = b.prior_on_market_date,
--      on_market_date_source     = b.prior_on_market_date_source,
--      on_market_date_confidence = b.prior_on_market_date_confidence,
--      status            = b.prior_status,    is_active        = b.prior_is_active,
--      off_market_date   = b.prior_off_market_date, off_market_reason = b.prior_off_market_reason,
--      sold_date         = b.prior_sold_date, sold_price        = b.prior_sold_price,
--      sale_transaction_id = b.prior_sale_transaction_id, notes = b.prior_notes
--    FROM public.t9d_listing_omd_backup b
--    WHERE al.listing_id = b.listing_id AND b.batch_tag = 't9d';
--    -- then DROP TABLE public.t9d_listing_omd_backup;
-- 3) (Optional) restore the prior fn_listing_close_if_sold body + re-set
--    property_sale_events.sales_transaction_id = 5701.
