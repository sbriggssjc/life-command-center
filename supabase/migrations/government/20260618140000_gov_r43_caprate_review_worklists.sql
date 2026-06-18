-- R43 (2026-06-18): value-ranked worklists for the parked cap-rate review queue
-- + the bad-rent leases the recompute surfaced (gov).
--
-- R42.1 applied the clean cap corrections and PARKED the suspect movers in
-- public.caprate_recompute_review (gov 169 = 103 low_confidence / 47 out_of_band
-- / 19 implausible_yield/bad_rent). Those rows just sit there unless a human can
-- find + work them. R43 surfaces two value-ranked worklists:
--
--   Unit 1 — v_caprate_review_worklist: the suspect movers (low_confidence +
--     out_of_band), ranked by $ impact = price * |old_cap - recomputed_cap|
--     (dollars-of-value the cap discrepancy moves). The Decision Center
--     `caprate_review` lane drives apply / keep_old / needs_rent_fix.
--   Unit 2 — v_bad_rent_leases: the implausible-yield (bad_rent) rows, with the
--     implied gross yield + the plausible rent band (price * [band_lo, band_hi]),
--     ranked by $ value. The `bad_rent_lease` lane links the operator to the
--     lease so the rent is corrected AT SOURCE — never auto-corrected.
--
-- Plus gov_apply_caprate_review(): the "apply" verdict's bounded write path —
-- it reuses the EXISTING R42 Unit-1 recompute (gov_recompute_caps_for_property,
-- reversible via cap_recompute_backup) and stamps the review row resolved. No new
-- compute logic. Read-mostly, additive, idempotent.

-- ---------------------------------------------------------------------------
-- Unit 1 — suspect-cap review worklist (value-ranked by $ impact).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_caprate_review_worklist AS
SELECT
  r.id                                              AS review_id,
  r.property_id,
  p.address, p.city, p.state,
  p.agency                                          AS label,
  r.event_type, r.event_date, r.price,
  r.old_cap, r.recomputed_cap,
  round(r.recomputed_cap - r.old_cap, 4)            AS cap_drift,
  r.reason, r.tag, r.rent_used, r.gross_yield, r.income_confidence,
  -- $ impact: dollars-of-value the cap discrepancy moves on this event.
  round(r.price * abs(r.old_cap - r.recomputed_cap)) AS dollar_impact,
  r.run_tag, r.first_seen, r.last_seen
FROM public.caprate_recompute_review r
LEFT JOIN public.properties p ON p.property_id = r.property_id
WHERE r.resolved_at IS NULL
  AND r.reason IN ('low_confidence', 'out_of_band')
ORDER BY round(r.price * abs(r.old_cap - r.recomputed_cap)) DESC NULLS LAST,
         abs(r.recomputed_cap - r.old_cap) DESC NULLS LAST;

COMMENT ON VIEW public.v_caprate_review_worklist IS
  'R43 Unit 1: parked suspect cap-rate movers (low_confidence + out_of_band) ranked by $ impact = price*|old_cap-recomputed_cap|. Drives the Decision Center caprate_review lane (apply / keep_old / needs_rent_fix). Excludes resolved + bad_rent (those go to v_bad_rent_leases).';

-- ---------------------------------------------------------------------------
-- Unit 2 — bad-rent lease-fix worklist (value-ranked; fix the SOURCE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_bad_rent_leases AS
WITH lease_pick AS (
  SELECT DISTINCT ON (l.property_id)
    l.property_id, l.lease_id, l.annual_rent
  FROM public.leases l
  WHERE l.superseded_at IS NULL
  ORDER BY l.property_id, l.commencement_date DESC NULLS LAST, l.lease_id
)
SELECT
  r.id                                  AS review_id,
  r.property_id,
  p.address, p.city, p.state,
  p.agency                              AS label,
  r.event_type, r.event_date, r.price,
  r.old_cap, r.recomputed_cap,
  r.rent_used,
  r.gross_yield                         AS implied_gross_yield,
  lp.lease_id, lp.annual_rent           AS lease_annual_rent,
  -- The rent band that WOULD produce a sane (in-band) cap at this price —
  -- gov default band [0.04, 0.12]. The operator's anchor for the fix.
  round(r.price * 0.04)                 AS plausible_rent_low,
  round(r.price * 0.12)                 AS plausible_rent_high,
  r.income_confidence, r.run_tag, r.first_seen, r.last_seen
FROM public.caprate_recompute_review r
LEFT JOIN public.properties p   ON p.property_id = r.property_id
LEFT JOIN lease_pick lp         ON lp.property_id = r.property_id
WHERE r.resolved_at IS NULL
  AND (r.reason = 'implausible_yield' OR r.tag = 'bad_rent')
ORDER BY r.price DESC NULLS LAST;

COMMENT ON VIEW public.v_bad_rent_leases IS
  'R43 Unit 2: cap-review rows the recompute flagged as bad RENT (implausible gross yield), with implied yield + the plausible rent band (price*[0.04,0.12]) + the offending lease, ranked by $ value. Drives the bad_rent_lease lane: the rent is fixed AT SOURCE (never auto-corrected); the R42 recompute-on-rent-change then refreshes the caps.';

-- ---------------------------------------------------------------------------
-- The "apply" verdict's bounded write path. Reuses the R42 Unit-1 recompute
-- (reversible via cap_recompute_backup) and stamps the review row resolved.
-- Idempotent: a row already resolved is a no-op. SECURITY DEFINER so the
-- Decision Center key can drive it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gov_apply_caprate_review(
  p_review_id bigint,
  p_actor     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_tag   text;
  v_res   jsonb;
BEGIN
  SELECT * INTO r FROM public.caprate_recompute_review WHERE id = p_review_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'review_not_found', 'review_id', p_review_id);
  END IF;
  IF r.resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_resolved', true,
      'review_id', p_review_id, 'resolution', r.resolution);
  END IF;
  IF r.property_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_property', 'review_id', p_review_id);
  END IF;

  v_tag := 'r43_review_apply_' || to_char(now(),'YYYYMMDDHH24MISS') || '_' || p_review_id;
  -- The bounded path: recompute via the authoritative gov_compute_cap_rate and
  -- write the derived ledger, snapshotting prior values to cap_recompute_backup.
  v_res := public.gov_recompute_caps_for_property(r.property_id, v_tag);

  UPDATE public.caprate_recompute_review
     SET resolved_at = now(), resolution = 'applied'
   WHERE id = p_review_id;

  RETURN jsonb_build_object('ok', true, 'review_id', p_review_id,
    'property_id', r.property_id, 'old_cap', r.old_cap, 'recomputed_cap', r.recomputed_cap,
    'recompute', v_res, 'run_tag', v_tag, 'actor', p_actor);
END $$;

COMMENT ON FUNCTION public.gov_apply_caprate_review IS
  'R43: apply a parked cap-review row by recomputing the property''s derived caps via the R42 Unit-1 path (reversible; tagged in cap_recompute_backup as r43_review_apply_*) and stamping the review row resolved=applied. Idempotent (already-resolved = no-op).';

GRANT EXECUTE ON FUNCTION public.gov_apply_caprate_review(bigint, text)
  TO anon, authenticated, service_role;
