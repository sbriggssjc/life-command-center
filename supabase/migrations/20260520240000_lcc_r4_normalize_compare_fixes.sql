-- ============================================================================
-- R4 follow-up: normalize ISO dates + fix integer trailing-zero strip
--
-- Target: LCC Opps (xengecqvemvfknjvbvrq)
-- Companion to: 20260520220000_lcc_r4_phase4a_resolution.sql
--
-- Two bugs in lcc_value_normalize_for_compare surfaced once the
-- Provenance Review Queue widget was live and visible:
--
-- (1) ISO 8601 datetime strings ("2016-06-01T00:00:00.000Z") didn't
--     compare equal to bare date strings ("2016-06-01"), producing
--     ~22 same-priority conflicts on dia.leases.lease_start /
--     lease_expiration / etc. that were format-only.
--
-- (2) The number branch ran `regexp_replace(..., '0+$', '')`
--     UNCONDITIONALLY -- intended to canonicalize decimals like
--     3.50 -> 3.5, but applied to integers it silently corrupted
--     them: 2020 -> "202", 200 -> "2", 100 -> "1". So a JSON number
--     2020 from OM never compared equal to a JSON string "2020"
--     from CoStar/RCA, producing fake conflicts on
--     dia.properties.year_built and dia.leases.renewal_options.
--
-- The view's filter is `lcc_value_normalize_for_compare(a) IS
-- DISTINCT FROM lcc_value_normalize_for_compare(b)`, so the existing
-- log rows auto-drop from v_field_provenance_review_queue once the
-- function returns matching normalized forms. No domain DB writes;
-- no field_provenance rewrites.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_value_normalize_for_compare(p_value jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_value IS NULL OR p_value = 'null'::jsonb THEN NULL
    WHEN jsonb_typeof(p_value) = 'number' THEN
      -- Only strip trailing zeros when there's a decimal point. Drop
      -- the bare dot if all the fractional digits got stripped.
      CASE
        WHEN (p_value #>> '{}') ~ '\.'
        THEN regexp_replace(
               regexp_replace((p_value #>> '{}'), '0+$', ''),
               '\.$', ''
             )
        ELSE (p_value #>> '{}')
      END
    WHEN jsonb_typeof(p_value) = 'string' THEN
      lower(
        CASE
          -- ISO 8601 datetime: collapse to the YYYY-MM-DD prefix so
          -- "2016-06-01T00:00:00.000Z" ≡ "2016-06-01".
          WHEN trim(p_value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}T'
            THEN substring(trim(p_value #>> '{}') from '^\d{4}-\d{2}-\d{2}')
          ELSE
            -- Existing chain: whitespace + US street-suffix
            -- canonicalization for addresses.
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
              trim(p_value #>> '{}')
            , '\s+', ' ', 'g')
            , '\s+(road|rd\.?)$', ' rd', 'i')
            , '\s+(street|st\.?)$', ' st', 'i')
            , '\s+(avenue|ave\.?)$', ' ave', 'i')
            , '\s+(boulevard|blvd\.?)$', ' blvd', 'i')
            , '\s+(drive|dr\.?)$', ' dr', 'i')
            , '\s+(highway|hwy\.?)$', ' hwy', 'i')
            , '\s+(parkway|pkwy\.?)$', ' pkwy', 'i')
        END
      )
    ELSE trim(p_value::text)
  END;
$function$;

COMMENT ON FUNCTION public.lcc_value_normalize_for_compare IS
  'Canonicalize a JSONB value for cross-source comparison. Numbers '
  'canonicalize decimals (3.50 -> 3.5, 3.0 -> 3) without corrupting '
  'integers (2020 stays 2020). String branch extracts the date '
  'prefix from ISO datetimes; otherwise applies address-suffix '
  'normalization (rd / st / ave / blvd / dr / hwy / pkwy).';
