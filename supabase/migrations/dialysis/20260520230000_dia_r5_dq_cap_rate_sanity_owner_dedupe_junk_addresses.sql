-- ============================================================================
-- R5-DQ: Dialysis data-consolidation fixes
--   1. R5-DQ-1: cap-rate sanity quarantine (>0.10 or <0.005 → suspect)
--   2. R5-DQ-2: owner name normalization + Tsoumpas variant merge
--   3. R5-DQ-3: junk OM section-header addresses (4 properties)
--   4. R5-DQ-4: expose extra columns on v_ownership_chain for the UI
--
-- Surfaced 2026-05-20 from the DaVita Rocky Mount NC drawer (property 23146).
-- 242 dia sales_transactions rows had cap > 0.10 (implausible for NNN);
-- the canonical Northmarq comp at $3.8M @ 5.69% was hidden behind a phantom
-- $1.7M sidebar capture that calculated to 13.99%.
--
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Mirror: see api/_handlers/sidebar-pipeline.js — sanitizeOwnerName() and
--         isJunkAddress() are the JS-side counterparts that keep the data
--         clean going forward.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- R5-DQ-1: cap-rate sanity bound
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_transactions
  DROP CONSTRAINT IF EXISTS sales_transactions_cap_rate_confidence_check;
ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_cap_rate_confidence_check
  CHECK (cap_rate_confidence IS NULL
         OR cap_rate_confidence IN ('low','medium','high','suspect'));

COMMENT ON COLUMN public.sales_transactions.cap_rate_confidence IS
  'Confidence tier for the calculated cap rate: low | medium | high | suspect. '
  '"suspect" is set automatically by dia_flag_suspect_cap_rate() when the '
  'computed cap rate falls outside [0.005, 0.10] (the plausible dialysis NNN '
  'band). Suspect rows are also marked exclude_from_market_metrics=true.';

CREATE OR REPLACE FUNCTION public.dia_flag_suspect_cap_rate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cap numeric;
BEGIN
  v_cap := COALESCE(NEW.calculated_cap_rate, NEW.cap_rate, NEW.stated_cap_rate);
  IF v_cap IS NOT NULL AND (v_cap > 0.10 OR v_cap < 0.005) THEN
    NEW.cap_rate_confidence := 'suspect';
    -- Don't clobber an explicit FALSE — that's the UI-set "human reviewed
    -- and approved" signal. Only flip default/NULL/true values.
    IF NEW.exclude_from_market_metrics IS DISTINCT FROM false THEN
      NEW.exclude_from_market_metrics := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dia_flag_suspect_cap_rate ON public.sales_transactions;
CREATE TRIGGER trg_dia_flag_suspect_cap_rate
  BEFORE INSERT OR UPDATE OF cap_rate, calculated_cap_rate, stated_cap_rate
  ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.dia_flag_suspect_cap_rate();

UPDATE public.sales_transactions
SET    cap_rate_confidence         = 'suspect',
       exclude_from_market_metrics = true
WHERE  (COALESCE(calculated_cap_rate, cap_rate, stated_cap_rate) > 0.10
        OR COALESCE(calculated_cap_rate, cap_rate, stated_cap_rate) < 0.005)
  AND (cap_rate_confidence IS DISTINCT FROM 'suspect'
       OR exclude_from_market_metrics IS DISTINCT FROM true);

-- ---------------------------------------------------------------------------
-- R5-DQ-2: owner name normalization (" by <Brokerage>" suffix)
-- ---------------------------------------------------------------------------

-- Mirror: api/_handlers/sidebar-pipeline.js BROKER_SUFFIX_RE
CREATE OR REPLACE FUNCTION public.dia_strip_broker_suffix(name text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN name IS NULL THEN NULL
    ELSE regexp_replace(name,
      '\s+by\s+(northmarq|cbre|jll|colliers( international)?|newmark|' ||
      'cushman( & wakefield)?|marcus( & millichap)?|matthews( real estate)?|' ||
      'matthews|berkadia|hanley|capital pacific|nai( [a-z]+)?|' ||
      'stream realty|kw commercial|trinity|avison( young)?|' ||
      'stan johnson( company)?|sjc)\.?\s*$', '', 'i')
  END;
$$;

-- text fields on sales_transactions (no unique constraint — simple UPDATE)
UPDATE public.sales_transactions SET buyer_name = trim(public.dia_strip_broker_suffix(buyer_name))
WHERE  buyer_name IS DISTINCT FROM trim(public.dia_strip_broker_suffix(buyer_name));
UPDATE public.sales_transactions SET seller_name = trim(public.dia_strip_broker_suffix(seller_name))
WHERE  seller_name IS DISTINCT FROM trim(public.dia_strip_broker_suffix(seller_name));
UPDATE public.sales_transactions SET recorded_owner_name = trim(public.dia_strip_broker_suffix(recorded_owner_name))
WHERE  recorded_owner_name IS DISTINCT FROM trim(public.dia_strip_broker_suffix(recorded_owner_name));
UPDATE public.sales_transactions SET true_owner_name = trim(public.dia_strip_broker_suffix(true_owner_name))
WHERE  true_owner_name IS DISTINCT FROM trim(public.dia_strip_broker_suffix(true_owner_name));

-- recorded_owners + true_owners have UNIQUE(name). The suffix strip can
-- collide with (a) an existing canonical row, or (b) another by-suffix
-- variant ("Kingsbarn Realty by Avison Young" + "Kingsbarn Realty by
-- Marcus & Millichap" both strip to "Kingsbarn Realty"). For each
-- (table, stripped_name) group:
--   - pick the canonical row (existing exact-match, else first by-suffix variant)
--   - re-point all FK references from the other rows to canonical
--   - DELETE the doomed rows (and their entries in tables with UNIQUE
--     constraints on the owner column — analytics rollups rehydrate
--     from the next cron tick)
--   - rename the canonical to the stripped name
DO $$
DECLARE g RECORD; v_canonical uuid; v_drop uuid[];
BEGIN
  FOR g IN
    SELECT trim(public.dia_strip_broker_suffix(name)) AS stripped,
           array_agg(recorded_owner_id) AS ids
    FROM   public.recorded_owners
    WHERE  name IS DISTINCT FROM trim(public.dia_strip_broker_suffix(name))
    GROUP  BY 1
  LOOP
    SELECT recorded_owner_id INTO v_canonical
    FROM   public.recorded_owners WHERE name = g.stripped LIMIT 1;
    IF v_canonical IS NULL THEN
      v_canonical := g.ids[1];
      v_drop := g.ids[2:array_length(g.ids,1)];
    ELSE
      v_drop := g.ids;
    END IF;
    IF v_drop IS NOT NULL AND array_length(v_drop, 1) > 0 THEN
      UPDATE public.available_listings  SET recorded_owner_id = v_canonical WHERE recorded_owner_id = ANY(v_drop);
      UPDATE public.loans               SET recorded_owner_id = v_canonical WHERE recorded_owner_id = ANY(v_drop);
      UPDATE public.medicare_clinics    SET recorded_owner_id = v_canonical WHERE recorded_owner_id = ANY(v_drop);
      UPDATE public.ownership_history   SET recorded_owner_id = v_canonical WHERE recorded_owner_id = ANY(v_drop);
      UPDATE public.properties          SET recorded_owner_id = v_canonical WHERE recorded_owner_id = ANY(v_drop);
      UPDATE public.registered_entities SET recorded_owner_id = v_canonical WHERE recorded_owner_id = ANY(v_drop);
      UPDATE public.sales_transactions  SET recorded_owner_id = v_canonical WHERE recorded_owner_id = ANY(v_drop);
      UPDATE public.sales_transactions  SET seller_id         = v_canonical WHERE seller_id         = ANY(v_drop);
      DELETE FROM public.llc_research_queue WHERE recorded_owner_id = ANY(v_drop);
      DELETE FROM public.recorded_owners    WHERE recorded_owner_id = ANY(v_drop);
    END IF;
    UPDATE public.recorded_owners SET name = g.stripped, normalized_name = NULL
     WHERE recorded_owner_id = v_canonical AND name <> g.stripped;
  END LOOP;

  FOR g IN
    SELECT trim(public.dia_strip_broker_suffix(name)) AS stripped,
           array_agg(true_owner_id) AS ids
    FROM   public.true_owners
    WHERE  name IS DISTINCT FROM trim(public.dia_strip_broker_suffix(name))
    GROUP  BY 1
  LOOP
    SELECT true_owner_id INTO v_canonical FROM public.true_owners WHERE name = g.stripped LIMIT 1;
    IF v_canonical IS NULL THEN
      v_canonical := g.ids[1];
      v_drop := g.ids[2:array_length(g.ids,1)];
    ELSE
      v_drop := g.ids;
    END IF;
    IF v_drop IS NOT NULL AND array_length(v_drop, 1) > 0 THEN
      UPDATE public.broker_market_coverage SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      UPDATE public.call_outcomes          SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      UPDATE public.contacts               SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      UPDATE public.deal_outcomes          SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      UPDATE public.guarantors             SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      UPDATE public.investment_targets     SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      UPDATE public.recorded_owners        SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      UPDATE public.registered_entities    SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      UPDATE public.user_interactions      SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      UPDATE public.ownership_history      SET true_owner_uuid = v_canonical,
                                               true_owner_id   = v_canonical
                                          WHERE true_owner_uuid = ANY(v_drop) OR true_owner_id = ANY(v_drop);
      UPDATE public.sales_transactions     SET true_owner_id = v_canonical WHERE true_owner_id = ANY(v_drop);
      DELETE FROM public.developer_scorecard WHERE true_owner_id = ANY(v_drop);
      DELETE FROM public.ownership_insights  WHERE true_owner_id = ANY(v_drop);
      DELETE FROM public.touchpoint_schedule WHERE true_owner_id = ANY(v_drop);
      DELETE FROM public.true_owners         WHERE true_owner_id = ANY(v_drop);
    END IF;
    UPDATE public.true_owners SET name = g.stripped, normalized_name = NULL
     WHERE true_owner_id = v_canonical AND name <> g.stripped;
  END LOOP;
END
$$;

-- Tsoumpas variant merge — "Carolin Grp" → "North Carolina Group".
-- The by-suffix variants are already folded by the merge above. This
-- handles the longer-form abbreviation collapse the suffix-strip can't
-- catch (Carolin → North Carolina, GRP → Group).
DO $$
DECLARE
  v_keep_rec  uuid := '0e8d58d7-6365-4594-a60a-6e6f78d4d4a8'::uuid;
  v_keep_true uuid := 'e016f6f7-737d-4090-ac00-143d68c6e087'::uuid;
  v_drop_rec  uuid[];
  v_drop_true uuid[];
BEGIN
  SELECT array_agg(recorded_owner_id) INTO v_drop_rec
  FROM   public.recorded_owners
  WHERE  recorded_owner_id <> v_keep_rec
    AND  (lower(name) LIKE 'tsoumpas%carolin%grp%'
       OR lower(name) LIKE 'tsoumpas%carolin%group%');

  SELECT array_agg(true_owner_id) INTO v_drop_true
  FROM   public.true_owners
  WHERE  true_owner_id <> v_keep_true
    AND  (lower(name) LIKE 'tsoumpas%carolin%grp%'
       OR lower(name) LIKE 'tsoumpas%carolin%group%');

  IF v_drop_rec IS NOT NULL AND array_length(v_drop_rec, 1) > 0 THEN
    UPDATE public.available_listings  SET recorded_owner_id = v_keep_rec WHERE recorded_owner_id = ANY(v_drop_rec);
    UPDATE public.loans               SET recorded_owner_id = v_keep_rec WHERE recorded_owner_id = ANY(v_drop_rec);
    UPDATE public.medicare_clinics    SET recorded_owner_id = v_keep_rec WHERE recorded_owner_id = ANY(v_drop_rec);
    UPDATE public.ownership_history   SET recorded_owner_id = v_keep_rec WHERE recorded_owner_id = ANY(v_drop_rec);
    UPDATE public.properties          SET recorded_owner_id = v_keep_rec WHERE recorded_owner_id = ANY(v_drop_rec);
    UPDATE public.registered_entities SET recorded_owner_id = v_keep_rec WHERE recorded_owner_id = ANY(v_drop_rec);
    UPDATE public.sales_transactions  SET recorded_owner_id = v_keep_rec WHERE recorded_owner_id = ANY(v_drop_rec);
    UPDATE public.sales_transactions  SET seller_id         = v_keep_rec WHERE seller_id         = ANY(v_drop_rec);
    DELETE FROM public.llc_research_queue WHERE recorded_owner_id = ANY(v_drop_rec);
    DELETE FROM public.recorded_owners    WHERE recorded_owner_id = ANY(v_drop_rec);
  END IF;

  IF v_drop_true IS NOT NULL AND array_length(v_drop_true, 1) > 0 THEN
    UPDATE public.broker_market_coverage SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    UPDATE public.call_outcomes          SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    UPDATE public.contacts               SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    UPDATE public.deal_outcomes          SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    UPDATE public.guarantors             SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    UPDATE public.investment_targets     SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    UPDATE public.recorded_owners        SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    UPDATE public.registered_entities    SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    UPDATE public.user_interactions      SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    UPDATE public.ownership_history      SET true_owner_uuid = v_keep_true,
                                             true_owner_id   = v_keep_true
                                          WHERE true_owner_uuid = ANY(v_drop_true) OR true_owner_id = ANY(v_drop_true);
    UPDATE public.sales_transactions     SET true_owner_id = v_keep_true WHERE true_owner_id = ANY(v_drop_true);
    DELETE FROM public.developer_scorecard WHERE true_owner_id = ANY(v_drop_true);
    DELETE FROM public.ownership_insights  WHERE true_owner_id = ANY(v_drop_true);
    DELETE FROM public.touchpoint_schedule WHERE true_owner_id = ANY(v_drop_true);
    DELETE FROM public.true_owners         WHERE true_owner_id = ANY(v_drop_true);
  END IF;
END
$$;

-- Retire ownership_history 317 — legacy back-fill superseded by 14287
-- which the sidebar pipeline rebuilt with full provenance. Delete the
-- duplicate first so the unique(sale_id) constraint lets us promote
-- 14287 onto the same sale_id.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ownership_history WHERE id = 14287)
   AND EXISTS (SELECT 1 FROM public.ownership_history WHERE id = 317 AND sale_id = 223) THEN
    DELETE FROM public.ownership_history WHERE id = 317 AND property_id = 23146;
    UPDATE public.ownership_history
       SET sale_id = 223
     WHERE id = 14287 AND property_id = 23146 AND sale_id IS NULL;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- R5-DQ-3: junk OM section-header addresses
-- ---------------------------------------------------------------------------
-- Four properties whose `address` is an OM table-of-contents header rather
-- than a street address. 37376 is CMS-linked (CCN 392614 / DaVita Abington);
-- its facility_patient_counts rows belong to canonical property 28431.
-- Going forward, isJunkAddress() in api/_handlers/sidebar-pipeline.js
-- rejects these patterns at write time.
DO $$
DECLARE v_pair RECORD;
BEGIN
  FOR v_pair IN
    SELECT * FROM (VALUES
      (42748, 23146),   -- "2 Lease Summary 110 Enterprise Dr"  → 110 Enterprise Dr, Rocky Mount NC
      (47533, 29984),   -- "2 Davita Lease Summary 3071 Gold Canal Dr" → 3071 Gold Canal Dr, Rancho Cordova CA
      (42226, 26952),   -- "38702 1 Offering Memorandum 1425 Hampton Ave" → 1425 Hampton Ave, Saint Louis MO
      (37376, 28431)    -- "19090 View Property Video Table Of Contents..." → DaVita Abington (CCN 392614)
    ) AS t(junk_id, real_id)
  LOOP
    -- Repoint available_listings to the real property unless that creates
    -- a duplicate URL+date pairing; otherwise drop the listing shell.
    IF v_pair.real_id IS NOT NULL THEN
      UPDATE public.available_listings al
         SET property_id = v_pair.real_id
       WHERE al.property_id = v_pair.junk_id
         AND NOT EXISTS (
           SELECT 1 FROM public.available_listings al2
            WHERE al2.property_id = v_pair.real_id
              AND COALESCE(al2.listing_url,'') = COALESCE(al.listing_url,'')
              AND COALESCE(al2.listing_date::text,'') = COALESCE(al.listing_date::text,'')
              AND al2.listing_id <> al.listing_id
         );
    END IF;
    DELETE FROM public.available_listings WHERE property_id = v_pair.junk_id;

    -- Junk parcel/tax records carry no APN, owner, or assessed value.
    DELETE FROM public.parcel_records
     WHERE id IN (SELECT record_id FROM public.property_public_records
                   WHERE property_id = v_pair.junk_id AND record_type = 'parcel');
    DELETE FROM public.tax_records
     WHERE id IN (SELECT record_id FROM public.property_public_records
                   WHERE property_id = v_pair.junk_id AND record_type = 'tax');
    DELETE FROM public.property_public_records WHERE property_id = v_pair.junk_id;

    -- CMS census rows: repoint to canonical when no
    -- (medicare_id, snapshot_date) collision exists; otherwise drop.
    UPDATE public.facility_patient_counts fpc
       SET property_id = v_pair.real_id
     WHERE fpc.property_id = v_pair.junk_id
       AND v_pair.real_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.facility_patient_counts fpc2
          WHERE fpc2.medicare_id = fpc.medicare_id
            AND fpc2.snapshot_date = fpc.snapshot_date
            AND fpc2.id <> fpc.id
       );
    DELETE FROM public.facility_patient_counts WHERE property_id = v_pair.junk_id;

    -- Embeddings are derived; drop and let the cron regenerate.
    DELETE FROM public.property_embeddings WHERE property_id = v_pair.junk_id;

    DELETE FROM public.properties WHERE property_id = v_pair.junk_id;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- R5-DQ-4: expose extra columns on v_ownership_chain so the detail.js
-- ownership drawer can render the Northmarq indicator as a separate badge
-- (instead of appending " by Northmarq" inline to the owner name) and
-- dedup chain rows by recorded_owner_id. The four new columns are
-- appended at the END of the SELECT list — CREATE OR REPLACE VIEW
-- requires that existing column order/types be preserved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ownership_chain AS
 SELECT oh.id AS ownership_id,
    oh.property_id,
    oh.medicare_id,
    oh.ownership_start AS transfer_date,
    oh.ownership_end,
    oh.sold_price AS sale_price,
    COALESCE(oh.cap_rate, st.cap_rate) AS cap_rate,
    COALESCE(oh.rent, st.rent_at_sale) AS rent,
    oh.ownership_source,
    oh.ownership_type,
    oh.owner_type,
    norm_text(ro.name) AS recorded_owner_name,
    norm_text(COALESCE(tru.name, tru2.name)) AS true_owner_name,
    COALESCE(tru.owner_type, tru2.owner_type) AS true_owner_type,
    COALESCE(tru.true_owner_id, tru2.true_owner_id) AS true_owner_id,
    COALESCE(tru.salesforce_id, tru2.salesforce_id) AS salesforce_id,
    COALESCE(tru.prospecting_status, tru2.prospecting_status) AS prospecting_status,
    COALESCE(tru.last_contact_date, tru2.last_contact_date) AS last_contact_date,
    oh.sale_id,
    st.listing_broker,
    st.procuring_broker,
    st.buyer_name,
    st.seller_name,
    st.stated_cap_rate,
    st.calculated_cap_rate,
    -- R5-DQ-4 additions ---------------------------------------------------
    oh.recorded_owner_id,
    st.cap_rate_confidence,
    st.exclude_from_market_metrics,
    st.is_northmarq
   FROM ownership_history oh
     LEFT JOIN recorded_owners ro  ON ro.recorded_owner_id = oh.recorded_owner_id
     LEFT JOIN true_owners     tru ON tru.true_owner_id    = oh.true_owner_uuid
     LEFT JOIN true_owners     tru2 ON tru2.true_owner_id  = ro.true_owner_id
                                   AND oh.true_owner_uuid IS NULL
     LEFT JOIN sales_transactions st ON st.sale_id = oh.sale_id
  WHERE COALESCE(oh.ownership_source, ''::text) <> 'cms_operator_chain'::text
  ORDER BY oh.property_id, oh.ownership_start DESC NULLS LAST;
