-- Prompt 31 (gov) - property-record consolidation + multi-source same-event sales.
--
-- Additive, dry-run-first infrastructure. Nothing in this migration applies data
-- changes automatically. Operators inspect:
--   select * from public.v_p31_property_consolidation_plan;
--   select * from public.v_p31_same_event_sale_plan;
-- and only then call the apply RPCs with p_dry_run := false.

CREATE TABLE IF NOT EXISTS public.p31_property_consolidation_log (
  id bigserial PRIMARY KEY,
  batch_tag text NOT NULL,
  keep_id integer NOT NULL,
  drop_id integer NOT NULL,
  confidence numeric,
  decision text NOT NULL DEFAULT 'pending',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  keep_snapshot jsonb,
  drop_snapshot jsonb,
  merge_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (batch_tag, keep_id, drop_id)
);

COMMENT ON TABLE public.p31_property_consolidation_log IS
  'Prompt 31 reversible ledger for gov property-record consolidation. Stores keep/drop property snapshots and merge evidence before calling gov_merge_property.';

CREATE OR REPLACE VIEW public.v_p31_property_consolidation_groups AS
WITH prop AS (
  SELECT
    p.*,
    lower(coalesce(p.state::text, '')) AS norm_state,
    public.gov_normalize_address(p.address) AS norm_address,
    lower(NULLIF(btrim(coalesce(p.agency_canonical, p.agency, p.agency_full_name, '')), '')) AS agency_key
  FROM public.properties p
  WHERE p.address IS NOT NULL
    AND p.address ~ '\d'
    AND NOT public.lcc_addr_is_placeholder(p.address)
),
grp AS (
  SELECT
    norm_state,
    norm_address,
    min(city) AS sample_city,
    count(*) AS property_count,
    array_agg(property_id ORDER BY property_id) AS property_ids,
    count(*) FILTER (WHERE agency_key IS NULL) AS null_agency_count,
    count(DISTINCT agency_key) FILTER (WHERE agency_key IS NOT NULL) AS distinct_agency_count,
    count(DISTINCT lease_number) FILTER (WHERE lease_number IS NOT NULL) AS distinct_lease_number_count
  FROM prop
  WHERE norm_state <> '' AND norm_address <> ''
  GROUP BY 1, 2
  HAVING count(*) > 1
)
SELECT * FROM grp;

CREATE OR REPLACE VIEW public.v_p31_property_consolidation_plan AS
WITH candidates AS (
  SELECT
    g.*,
    p.property_id,
    p.address,
    p.city,
    p.state,
    p.agency,
    p.agency_canonical,
    p.lease_number,
    (
      (p.address IS NOT NULL)::int +
      (p.city IS NOT NULL)::int +
      (p.state IS NOT NULL)::int +
      (p.zip_code IS NOT NULL)::int +
      (p.latitude IS NOT NULL AND p.longitude IS NOT NULL)::int +
      (p.rba IS NOT NULL)::int +
      (p.agency IS NOT NULL)::int +
      (p.lease_number IS NOT NULL)::int +
      (SELECT least(count(*), 5)::int FROM public.sales_transactions s WHERE s.property_id = p.property_id) +
      (SELECT least(count(*), 5)::int FROM public.leases l WHERE l.property_id = p.property_id) +
      (SELECT least(count(*), 5)::int FROM public.available_listings al WHERE al.property_id = p.property_id)
    ) AS completeness_score
  FROM public.v_p31_property_consolidation_groups g
  JOIN public.properties p
    ON lower(coalesce(p.state::text, '')) = g.norm_state
   AND public.gov_normalize_address(p.address) = g.norm_address
),
ranked AS (
  SELECT
    c.*,
    first_value(property_id) OVER w AS keep_id,
    row_number() OVER w AS rn,
    CASE
      WHEN property_count <= 4
       AND null_agency_count = 0
       AND distinct_agency_count <= 1
       AND distinct_lease_number_count <= 1 THEN 0.98
      WHEN property_count <= 4
       AND distinct_agency_count <= 1
       AND distinct_lease_number_count <= 1 THEN 0.90
      ELSE 0.70
    END AS confidence,
    CASE
      WHEN property_count <= 4
       AND null_agency_count = 0
       AND distinct_agency_count <= 1
       AND distinct_lease_number_count <= 1 THEN 'auto_merge'
      ELSE 'review'
    END AS lane
  FROM candidates c
  WINDOW w AS (
    PARTITION BY norm_state, norm_address
    ORDER BY completeness_score DESC, property_id ASC
  )
)
SELECT
  norm_state,
  norm_address,
  sample_city,
  property_count,
  property_ids,
  keep_id,
  property_id AS drop_id,
  confidence,
  lane,
  jsonb_build_object(
    'property_count', property_count,
    'property_ids', property_ids,
    'distinct_agency_count', distinct_agency_count,
    'null_agency_count', null_agency_count,
    'distinct_lease_number_count', distinct_lease_number_count,
    'drop_address', address,
    'drop_city', city,
    'drop_state', state,
    'drop_agency', coalesce(agency_canonical, agency),
    'drop_lease_number', lease_number,
    'drop_completeness_score', completeness_score
  ) AS evidence
FROM ranked
WHERE rn > 1;

COMMENT ON VIEW public.v_p31_property_consolidation_plan IS
  'Prompt 31 dry-run plan for gov same-address/different-property_id consolidation. lane=auto_merge is conservative; lane=review is not applied by the RPC.';

CREATE OR REPLACE VIEW public.v_p31_property_consolidation_review AS
SELECT *
FROM public.v_p31_property_consolidation_plan
WHERE lane <> 'auto_merge';

CREATE OR REPLACE FUNCTION public.p31_property_consolidation_apply(
  p_dry_run boolean DEFAULT true,
  p_batch_tag text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_batch text := coalesce(NULLIF(p_batch_tag, ''), 'p31_gov_property_consolidation_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_candidate_count integer := 0;
  v_applied integer := 0;
  v_rec record;
  v_result jsonb;
BEGIN
  SELECT count(*) INTO v_candidate_count
  FROM public.v_p31_property_consolidation_plan
  WHERE lane = 'auto_merge';

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'batch_tag', v_batch,
      'auto_merge_candidates', v_candidate_count,
      'review_candidates', (SELECT count(*) FROM public.v_p31_property_consolidation_review),
      'plan_view', 'public.v_p31_property_consolidation_plan'
    );
  END IF;

  FOR v_rec IN
    SELECT * FROM public.v_p31_property_consolidation_plan
    WHERE lane = 'auto_merge'
    ORDER BY norm_state, norm_address, drop_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.p31_property_consolidation_log
      WHERE batch_tag = v_batch AND keep_id = v_rec.keep_id AND drop_id = v_rec.drop_id AND decision = 'applied'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.p31_property_consolidation_log
      (batch_tag, keep_id, drop_id, confidence, decision, evidence, keep_snapshot, drop_snapshot)
    SELECT
      v_batch,
      v_rec.keep_id,
      v_rec.drop_id,
      v_rec.confidence,
      'started',
      v_rec.evidence,
      (SELECT to_jsonb(p) FROM public.properties p WHERE p.property_id = v_rec.keep_id),
      (SELECT to_jsonb(p) FROM public.properties p WHERE p.property_id = v_rec.drop_id)
    ON CONFLICT (batch_tag, keep_id, drop_id) DO UPDATE
      SET confidence = EXCLUDED.confidence,
          evidence = EXCLUDED.evidence,
          keep_snapshot = EXCLUDED.keep_snapshot,
          drop_snapshot = EXCLUDED.drop_snapshot;

    v_result := public.gov_merge_property(v_rec.keep_id, v_rec.drop_id);

    UPDATE public.p31_property_consolidation_log
       SET decision = 'applied',
           merge_result = v_result,
           applied_at = now()
     WHERE batch_tag = v_batch AND keep_id = v_rec.keep_id AND drop_id = v_rec.drop_id;

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', false,
    'batch_tag', v_batch,
    'auto_merge_candidates_at_start', v_candidate_count,
    'applied', v_applied,
    'review_candidates_remaining', (SELECT count(*) FROM public.v_p31_property_consolidation_review)
  );
END;
$$;

COMMENT ON FUNCTION public.p31_property_consolidation_apply(boolean, text) IS
  'Prompt 31 gov property consolidation RPC. Dry-run by default. On apply, backs up keep/drop property rows to p31_property_consolidation_log, then calls gov_merge_property for high-confidence lane only.';

CREATE OR REPLACE FUNCTION public.p31_find_existing_property_by_address(
  p_address text,
  p_state text DEFAULT NULL,
  p_city text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_norm_address text := public.gov_normalize_address(p_address);
  v_norm_state text := lower(coalesce(p_state, ''));
  v_matches jsonb;
  v_count integer;
BEGIN
  IF v_norm_address IS NULL OR v_norm_address = '' THEN
    RETURN jsonb_build_object('status', 'unmatched', 'reason', 'missing_address');
  END IF;

  WITH matched AS (
    SELECT p.property_id, p.address, p.city, p.state, p.agency, p.agency_canonical, p.lease_number
    FROM public.properties p
    WHERE public.gov_normalize_address(p.address) = v_norm_address
      AND (v_norm_state IS NULL OR v_norm_state = '' OR lower(coalesce(p.state::text, '')) = v_norm_state)
      AND (p_city IS NULL OR p.city ILIKE p_city)
    ORDER BY p.property_id
    LIMIT 5
  )
  SELECT count(*), coalesce(jsonb_agg(to_jsonb(matched)), '[]'::jsonb)
    INTO v_count, v_matches
  FROM matched;

  IF v_count = 1 THEN
    RETURN jsonb_build_object('status', 'matched', 'property_id', (v_matches->0->>'property_id')::integer, 'candidate_count', v_count, 'candidates', v_matches);
  ELSIF v_count > 1 THEN
    RETURN jsonb_build_object('status', 'ambiguous', 'candidate_count', v_count, 'candidates', v_matches);
  END IF;

  RETURN jsonb_build_object('status', 'unmatched', 'candidate_count', 0, 'candidates', '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.p31_find_existing_property_by_address(text, text, text) IS
  'Prompt 31 recurrence guard for gov writers: resolve by database-normalized address/state before inserting a new property. Multiple matches return ambiguous so callers do not create another duplicate.';

CREATE TABLE IF NOT EXISTS public.p31_same_event_sale_reconciliation_log (
  loser_sale_id uuid PRIMARY KEY,
  survivor_sale_id uuid NOT NULL,
  batch_tag text NOT NULL,
  property_id integer NOT NULL,
  loser_sale_date date,
  survivor_sale_date date,
  loser_price numeric,
  survivor_price numeric,
  loser_data_source text,
  survivor_data_source text,
  reason text NOT NULL DEFAULT 'p31_multi_source_same_event',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_superseded_at timestamptz NOT NULL DEFAULT now(),
  last_superseded_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.p31_same_event_sale_reconciliation_log IS
  'Prompt 31 reversible ledger for gov multi-source same-event sale demotions. Reverse by setting logged loser_sale_id rows back to transaction_state=live and dedup_group_id=null.';

CREATE OR REPLACE VIEW public.v_p31_same_event_sale_ranked AS
WITH base AS (
  SELECT
    s.sale_id,
    s.property_id,
    s.sale_date,
    s.sold_price,
    s.data_source,
    s.buyer,
    s.seller,
    s.cap_rate_quality,
    s.updated_at,
    lower(regexp_replace(coalesce(s.buyer, ''), '[^a-z0-9]', '', 'g')) AS buyer_key,
    lower(regexp_replace(coalesce(s.seller, ''), '[^a-z0-9]', '', 'g')) AS seller_key,
    CASE
      WHEN coalesce(s.cap_rate_quality,'') ~ 'implausible' THEN 4
      WHEN coalesce(s.cap_rate_quality,'') IN ('validated','cmbs_audited','om_actual','om_confirmed','deed_verified','confirmed','lease_confirmed') THEN 1
      WHEN s.cap_rate_quality IS NOT NULL THEN 2
      ELSE 3
    END AS quality_rank,
    CASE
      WHEN s.data_source LIKE 'county_deed:%' THEN 1
      WHEN s.data_source = 'excel_master' OR s.data_source LIKE 'master_xlsx_backfill%' THEN 2
      WHEN s.data_source = 'salesforce' OR s.data_source LIKE 'sf_%' OR s.data_source LIKE 'salesforce_%' THEN 3
      WHEN s.data_source = 'sjc_track_record_v2' THEN 4
      WHEN s.data_source = 'historical_csv_import' THEN 5
      WHEN s.data_source = 'costar_export' THEN 6
      WHEN s.data_source = 'costar_sidebar' THEN 7
      WHEN s.data_source LIKE 'rca_sidebar%' THEN 8
      WHEN s.data_source IS NULL THEN 9
      ELSE 10
    END AS source_rank,
    5 AS conf_rank
  FROM public.sales_transactions s
  WHERE s.transaction_state = 'live'
    AND s.property_id IS NOT NULL
    AND s.sale_date IS NOT NULL
    AND s.sold_price IS NOT NULL
    AND s.sold_price > 0
    AND coalesce(s.data_source,'') NOT LIKE 'ownership_change_stub%'
),
pairs AS (
  SELECT
    b.sale_id AS loser_sale_id,
    a.sale_id AS survivor_sale_id,
    b.property_id,
    abs(a.sale_date - b.sale_date) AS days_apart,
    abs(a.sold_price - b.sold_price) AS price_delta,
    abs(a.sold_price - b.sold_price) / greatest(a.sold_price, b.sold_price) AS price_delta_pct,
    b.buyer_key,
    jsonb_build_object(
      'loser_data_source', b.data_source,
      'survivor_data_source', a.data_source,
      'loser_buyer', b.buyer,
      'survivor_buyer', a.buyer,
      'loser_seller', b.seller,
      'survivor_seller', a.seller,
      'days_apart', abs(a.sale_date - b.sale_date),
      'price_delta', abs(a.sold_price - b.sold_price),
      'price_delta_pct', abs(a.sold_price - b.sold_price) / greatest(a.sold_price, b.sold_price)
    ) AS evidence,
    row_number() OVER (
      PARTITION BY b.sale_id
      ORDER BY a.quality_rank, a.source_rank, a.conf_rank, a.updated_at DESC NULLS LAST, a.sale_id::text
    ) AS choice_rank
  FROM base b
  JOIN base a
    ON a.property_id = b.property_id
   AND a.sale_id <> b.sale_id
   AND coalesce(a.data_source, '') IS DISTINCT FROM coalesce(b.data_source, '')
   AND abs(a.sale_date - b.sale_date) <= 120
   AND abs(a.sold_price - b.sold_price) <= greatest(1000::numeric, greatest(a.sold_price, b.sold_price) * 0.03)
   AND length(a.buyer_key) >= 4
   AND a.buyer_key = b.buyer_key
   AND (
      a.quality_rank < b.quality_rank
      OR (a.quality_rank = b.quality_rank AND a.source_rank < b.source_rank)
      OR (a.quality_rank = b.quality_rank AND a.source_rank = b.source_rank AND a.conf_rank < b.conf_rank)
      OR (a.quality_rank = b.quality_rank AND a.source_rank = b.source_rank AND a.conf_rank = b.conf_rank AND a.updated_at > b.updated_at)
      OR (a.quality_rank = b.quality_rank AND a.source_rank = b.source_rank AND a.conf_rank = b.conf_rank AND a.updated_at IS NOT DISTINCT FROM b.updated_at AND a.sale_id::text < b.sale_id::text)
   )
)
SELECT
  p.*,
  l.sale_date AS loser_sale_date,
  s.sale_date AS survivor_sale_date,
  l.sold_price AS loser_price,
  s.sold_price AS survivor_price,
  l.data_source AS loser_data_source,
  s.data_source AS survivor_data_source
FROM pairs p
JOIN base l ON l.sale_id = p.loser_sale_id
JOIN base s ON s.sale_id = p.survivor_sale_id
WHERE p.choice_rank = 1;

CREATE OR REPLACE VIEW public.v_p31_same_event_sale_plan AS
SELECT
  *,
  'auto_supersede'::text AS lane,
  'p31_multi_source_same_event'::text AS reason
FROM public.v_p31_same_event_sale_ranked;

COMMENT ON VIEW public.v_p31_same_event_sale_plan IS
  'Prompt 31 dry-run plan for gov multi-source same-event sale reconciliation. Conservative: same property, same normalized buyer, different source, <=120 days, <=3% or $1k price delta. Repeat sales outside this window remain distinct.';

CREATE OR REPLACE VIEW public.v_p31_same_event_sale_review AS
WITH live AS (
  SELECT
    property_id,
    lower(regexp_replace(coalesce(buyer, ''), '[^a-z0-9]', '', 'g')) AS buyer_key,
    count(*) AS row_count,
    min(sale_date) AS first_sale_date,
    max(sale_date) AS last_sale_date,
    min(sold_price) AS min_price,
    max(sold_price) AS max_price,
    count(DISTINCT coalesce(data_source, '<null>')) AS source_count,
    array_agg(sale_id ORDER BY sale_date, sale_id::text) AS sale_ids
  FROM public.sales_transactions
  WHERE transaction_state = 'live'
    AND property_id IS NOT NULL
    AND sale_date IS NOT NULL
    AND sold_price IS NOT NULL
    AND sold_price > 0
  GROUP BY 1, 2
  HAVING count(*) > 1
     AND count(DISTINCT coalesce(data_source, '<null>')) > 1
     AND max(sale_date) - min(sale_date) <= 365
     AND max(sale_date) - min(sale_date) > 120
)
SELECT
  *,
  'multi_source_nearby_but_outside_auto_window'::text AS review_reason
FROM live
WHERE length(buyer_key) >= 4
  AND NOT EXISTS (
    SELECT 1 FROM public.v_p31_same_event_sale_plan p
    WHERE p.property_id = live.property_id
      AND p.buyer_key = live.buyer_key
  );

CREATE OR REPLACE FUNCTION public.p31_same_event_sales_apply(
  p_dry_run boolean DEFAULT true,
  p_batch_tag text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_batch text := coalesce(NULLIF(p_batch_tag, ''), 'p31_gov_same_event_sales_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_candidates integer := 0;
  v_applied integer := 0;
BEGIN
  SELECT count(*) INTO v_candidates FROM public.v_p31_same_event_sale_plan;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'batch_tag', v_batch,
      'auto_supersede_candidates', v_candidates,
      'review_candidates', (SELECT count(*) FROM public.v_p31_same_event_sale_review),
      'plan_view', 'public.v_p31_same_event_sale_plan'
    );
  END IF;

  WITH losers AS (
    SELECT * FROM public.v_p31_same_event_sale_plan
  ),
  patched AS (
    UPDATE public.sales_transactions s
       SET transaction_state = 'duplicate_superseded',
           dedup_group_id = l.survivor_sale_id,
           updated_at = now()
      FROM losers l
     WHERE s.sale_id = l.loser_sale_id
       AND s.transaction_state = 'live'
    RETURNING
      s.sale_id AS loser_sale_id,
      l.survivor_sale_id,
      l.property_id,
      l.loser_sale_date,
      l.survivor_sale_date,
      l.loser_price,
      l.survivor_price,
      l.loser_data_source,
      l.survivor_data_source,
      l.evidence
  ),
  logged AS (
    INSERT INTO public.p31_same_event_sale_reconciliation_log
      (loser_sale_id, survivor_sale_id, batch_tag, property_id, loser_sale_date, survivor_sale_date,
       loser_price, survivor_price, loser_data_source, survivor_data_source, reason, evidence, last_superseded_at)
    SELECT
      loser_sale_id, survivor_sale_id, v_batch, property_id, loser_sale_date, survivor_sale_date,
      loser_price, survivor_price, loser_data_source, survivor_data_source,
      'p31_multi_source_same_event', evidence, now()
    FROM patched
    ON CONFLICT (loser_sale_id) DO UPDATE
      SET survivor_sale_id = EXCLUDED.survivor_sale_id,
          batch_tag = EXCLUDED.batch_tag,
          evidence = EXCLUDED.evidence,
          last_superseded_at = now()
    RETURNING loser_sale_id
  )
  SELECT count(*) INTO v_applied FROM logged;

  RETURN jsonb_build_object(
    'dry_run', false,
    'batch_tag', v_batch,
    'auto_supersede_candidates_at_start', v_candidates,
    'applied', v_applied,
    'review_candidates_remaining', (SELECT count(*) FROM public.v_p31_same_event_sale_review)
  );
END;
$$;

COMMENT ON FUNCTION public.p31_same_event_sales_apply(boolean, text) IS
  'Prompt 31 gov same-event sale reconciliation RPC. Dry-run by default. On apply, soft-demotes multi-source same-event losers to duplicate_superseded and logs every loser.';

CREATE OR REPLACE VIEW public.v_p31_sale_history_live AS
SELECT
  s.property_id,
  s.sale_id,
  s.sale_date,
  s.sold_price,
  s.buyer,
  s.seller,
  s.data_source,
  s.transaction_state,
  row_number() OVER (PARTITION BY s.property_id ORDER BY s.sale_date DESC NULLS LAST, s.sale_id::text DESC) AS recency_rank
FROM public.sales_transactions s
WHERE s.transaction_state = 'live'
  AND s.property_id IS NOT NULL
ORDER BY s.property_id, s.sale_date DESC NULLS LAST;

COMMENT ON VIEW public.v_p31_sale_history_live IS
  'Prompt 31 sale-history view for gov: all live sale rows remain available, with recency_rank=1 identifying the most recent sale per property for appraisal-style pulls.';

CREATE OR REPLACE VIEW public.v_p31_repeat_sale_census AS
WITH ordered AS (
  SELECT
    property_id,
    sale_id,
    sale_date,
    sold_price,
    lag(sale_date) OVER (PARTITION BY property_id ORDER BY sale_date, sale_id::text) AS prev_sale_date,
    lag(sold_price) OVER (PARTITION BY property_id ORDER BY sale_date, sale_id::text) AS prev_sold_price
  FROM public.sales_transactions
  WHERE transaction_state = 'live'
    AND property_id IS NOT NULL
    AND sale_date IS NOT NULL
)
SELECT
  *,
  (sale_date - prev_sale_date) AS days_since_prev_sale,
  CASE
    WHEN prev_sale_date IS NULL THEN 'first_sale'
    WHEN sale_date - prev_sale_date > 365 THEN 'repeat_sale_keep'
    WHEN sold_price IS NOT NULL AND prev_sold_price IS NOT NULL
      AND abs(sold_price - prev_sold_price) / greatest(sold_price, prev_sold_price) > 0.10 THEN 'materially_different_keep_or_review'
    ELSE 'nearby_sale_review'
  END AS p31_classification
FROM ordered;

COMMENT ON VIEW public.v_p31_repeat_sale_census IS
  'Prompt 31 verification view for gov: repeat sales over one year apart are classified as repeat_sale_keep, not dedup candidates.';

GRANT SELECT ON public.v_p31_property_consolidation_groups TO anon, authenticated, service_role;
GRANT SELECT ON public.v_p31_property_consolidation_plan TO anon, authenticated, service_role;
GRANT SELECT ON public.v_p31_property_consolidation_review TO anon, authenticated, service_role;
GRANT SELECT ON public.p31_property_consolidation_log TO anon, authenticated, service_role;
GRANT SELECT ON public.v_p31_same_event_sale_ranked TO anon, authenticated, service_role;
GRANT SELECT ON public.v_p31_same_event_sale_plan TO anon, authenticated, service_role;
GRANT SELECT ON public.v_p31_same_event_sale_review TO anon, authenticated, service_role;
GRANT SELECT ON public.p31_same_event_sale_reconciliation_log TO anon, authenticated, service_role;
GRANT SELECT ON public.v_p31_sale_history_live TO anon, authenticated, service_role;
GRANT SELECT ON public.v_p31_repeat_sale_census TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p31_property_consolidation_apply(boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p31_find_existing_property_by_address(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.p31_same_event_sales_apply(boolean, text) TO authenticated, service_role;
