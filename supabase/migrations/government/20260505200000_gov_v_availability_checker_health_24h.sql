-- ============================================================================
-- Round 76ej.h (gov) — mirror of the dia v_availability_checker_health_24h
-- view. Same shape; gov listing_verification_history has the same column
-- set, just with uuid listing_id instead of integer.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_availability_checker_health_24h AS
WITH base AS (
  SELECT vh.id,
         vh.listing_id,
         vh.verified_at,
         vh.check_result,
         vh.http_status,
         vh.source_url
  FROM   public.listing_verification_history vh
  WHERE  vh.method = 'auto_scrape'
    AND  vh.notes LIKE 'availability-checker%'
    AND  vh.verified_at > now() - interval '24 hours'
)
SELECT b.check_result,
       count(*)                                                AS n,
       count(*) FILTER (WHERE b.http_status BETWEEN 200 AND 299) AS http_2xx,
       count(*) FILTER (WHERE b.http_status BETWEEN 400 AND 499) AS http_4xx,
       count(*) FILTER (WHERE b.http_status >= 500)            AS http_5xx,
       count(*) FILTER (WHERE b.http_status IS NULL OR b.http_status = 0) AS http_unknown,
       (array_agg(DISTINCT b.source_url) FILTER (WHERE b.source_url IS NOT NULL))[1:5]
                                                              AS sample_urls,
       max(b.verified_at)                                      AS last_seen
FROM   base b
GROUP  BY b.check_result
ORDER  BY n DESC;

COMMENT ON VIEW public.v_availability_checker_health_24h IS
  'Round 76ej.h — last 24h breakdown of availability-checker outcomes.
   See dia migration for usage notes.';
