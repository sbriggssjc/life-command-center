-- =====================================================================
-- B6d — retiring an expectation must CLOSE its alert, legibly
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-29.
-- =====================================================================
-- THE DEFECT. The auto-resolve arm was:
--     ... AND EXISTS (SELECT 1 FROM _ff_cur c
--                      WHERE c.source_key = a.source AND NOT c.is_stale)
-- It requires the feed to be PRESENT in _ff_cur and not stale. A feed whose
-- expectation is retired leaves _ff_cur entirely, so that EXISTS can never be
-- satisfied and its open alert is stranded FOREVER -- with no reason attached,
-- on a surface whose whole purpose is that every open row is worth reading.
--
-- Not hypothetical: B6c-dup retired property_sale_events on 2026-08-29 by
-- setting is_active = false, and alert 5376 was left open and unresolvable by
-- any automatic path. Retiring an expectation made its alert PERMANENT.
--
-- THE FIX, in two halves:
--   1. (the gov/dia/lcc grading migrations) a retired feed keeps EMITTING, with
--      a NULL bound. Absence is never the signal; a NULL bound is a positive
--      statement someone recorded, with a mandatory unwatched_reason behind it.
--   2. (here) a second resolve arm that closes an alert when its feed says, in a
--      snapshot we currently trust, that it is deliberately unwatched -- with a
--      resolved_note saying so and pointing at where the reason lives.
--
-- WHY IT KEYS ON A NULL BOUND AND NOT ON ABSENCE. Inferring retirement from
-- absence would resolve alerts for feeds that vanished because their query
-- ERRORED, or because their domain's mirror went blind -- "I cannot see this
-- feed" closing as "this feed is fine", the exact confusion the _ff_blind
-- machinery exists to prevent. compute_feed_freshness carries the registry's
-- bound through even when the per-feed query throws, so an erroring feed still
-- has a non-NULL bound and is never matched here.
--
-- AND THE RESIDUAL CASE IS REPORTED, NOT SILENT. An alert whose feed is neither
-- evaluable nor explicitly unwatched (deregistered outright, or hard-deleted) is
-- counted as `alerts_orphaned` and named in the payload. It is deliberately NOT
-- auto-resolved -- a decision and a disappearance are not the same fact and must
-- not close identically -- but it can no longer sit there unnoticed.
--
-- CONTROLS RUN LIVE 2026-08-29 (each in a rolled-back transaction):
--   opm_workforce @199d (inside its new 200d bound) -> new_alerts 0
--   opm_workforce @205d                             -> new_alerts 1
--   gsa_leases_snapshot @95d (new 90d bound)        -> new_alerts 1
--   property_sale_events @1800d, unwatched          -> new_alerts 0, orphaned 0
--   medicare_clinics mirror row deleted             -> orphaned 1, named
-- Live effect: open feed_stale 4 -> 2, both survivors genuine breaks.

BEGIN;

CREATE OR REPLACE FUNCTION public.lcc_check_feed_freshness(p_mirror_max_age interval DEFAULT '3 days'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new int := 0; v_resolved int := 0; v_mirror_new int := 0; v_mirror_resolved int := 0;
  v_unwatched_resolved int := 0; v_orphaned int := 0;
  v_stale jsonb; v_evaluated int; v_excluded int; v_mirror jsonb; v_stale_n int;
  v_unwatched jsonb; v_orphans jsonb;
  c_cap constant int := 25;
BEGIN
  CREATE TEMP TABLE _ff_cur ON COMMIT DROP AS
  WITH lcc_local AS (
    SELECT 'lcc'::text AS dom, feed_name, latest, expected_max_age_days,
           (now()::date - latest::date) AS age_days
      FROM public.v_feed_freshness
     WHERE status = 'ok' AND latest IS NOT NULL
  ),
  domain_mirror AS (
    SELECT source_domain AS dom, feed_name, latest, expected_max_age_days,
           (now()::date - latest::date) AS age_days
      FROM public.lcc_domain_feed_freshness
     WHERE latest IS NOT NULL
       AND expected_max_age_days IS NOT NULL
       AND synced_at > now() - p_mirror_max_age
  )
  SELECT u.dom, u.feed_name, u.latest, u.expected_max_age_days, u.age_days,
         (u.age_days > u.expected_max_age_days) AS is_stale,
         ('feed:' || u.dom || ':' || u.feed_name) AS source_key
    FROM (SELECT * FROM lcc_local UNION ALL SELECT * FROM domain_mirror) u;

  -- B6d. Feeds that POSITIVELY state "no expectation". A NULL bound on an
  -- emitted row is a decision someone recorded, with a mandatory
  -- unwatched_reason behind it in the owning registry.
  CREATE TEMP TABLE _ff_unwatched ON COMMIT DROP AS
  SELECT ('feed:lcc:' || feed_name) AS source_key, 'lcc'::text AS dom, feed_name
    FROM public.feed_freshness_registry
   WHERE is_active AND expected_max_age_days IS NULL
  UNION ALL
  SELECT ('feed:' || source_domain || ':' || feed_name), source_domain, feed_name
    FROM public.lcc_domain_feed_freshness
   WHERE expected_max_age_days IS NULL
     AND synced_at > now() - p_mirror_max_age;

  CREATE TEMP TABLE _ff_blind ON COMMIT DROP AS
  SELECT d.dom,
         (SELECT count(*) FROM public.lcc_domain_feed_freshness m WHERE m.source_domain = d.dom) AS mirror_rows,
         (SELECT max(m.synced_at) FROM public.lcc_domain_feed_freshness m WHERE m.source_domain = d.dom) AS synced_at,
         s.last_outcome, s.last_status_code, s.last_error, s.last_success_at, s.consecutive_failures
    FROM (VALUES ('gov'),('dia')) d(dom)
    LEFT JOIN public.lcc_feed_freshness_sync_status s ON s.source_domain = d.dom
   WHERE (SELECT count(*) FROM public.lcc_domain_feed_freshness m
           WHERE m.source_domain = d.dom AND m.synced_at > now() - p_mirror_max_age) = 0;

  SELECT count(*) INTO v_evaluated FROM _ff_cur;
  SELECT coalesce(sum(mirror_rows), 0) INTO v_excluded FROM _ff_blind;

  WITH ins AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'feed_stale', c.source_key,
           CASE WHEN c.age_days > 2 * c.expected_max_age_days THEN 'error' ELSE 'warn' END,
           'Ingestion feed ' || c.feed_name || ' (' || c.dom || ') is STALE: last data '
             || c.latest::date || ' = ' || c.age_days || 'd old (SLA '
             || c.expected_max_age_days || 'd). The feed may have stopped -- investigate.',
           jsonb_build_object('domain', c.dom, 'feed', c.feed_name, 'latest', c.latest,
                              'age_days', c.age_days, 'sla_days', c.expected_max_age_days)
      FROM _ff_cur c
     WHERE c.is_stale
       AND NOT EXISTS (
         SELECT 1 FROM public.lcc_health_alerts a
          WHERE a.alert_kind = 'feed_stale' AND a.source = c.source_key AND a.resolved_at IS NULL)
    RETURNING 1
  )
  SELECT count(*) INTO v_new FROM ins;

  WITH ins AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'feed_mirror_stale', 'feed_mirror:' || b.dom,
           CASE WHEN b.synced_at IS NULL OR b.synced_at < now() - interval '7 days' THEN 'error' ELSE 'warn' END,
           'Feed-freshness mirror for ' || b.dom || ' is UNEVALUABLE'
             || CASE WHEN b.synced_at IS NULL THEN ' (no snapshot has ever landed)'
                     ELSE ' (last synced ' || b.synced_at::date || ' = '
                          || (now()::date - b.synced_at::date) || 'd ago)' END
             || '. ' || b.mirror_rows || ' feed(s) are NOT BEING CHECKED, so a stalled '
             || b.dom || ' feed cannot raise feed_stale. Last leg outcome: '
             || coalesce(b.last_outcome, '(never recorded)')
             || coalesce(' HTTP ' || b.last_status_code::text, '')
             || coalesce(' -- ' || left(b.last_error, 200), '') || '.',
           jsonb_build_object('domain', b.dom, 'mirror_rows', b.mirror_rows,
                              'synced_at', b.synced_at, 'last_outcome', b.last_outcome,
                              'last_status_code', b.last_status_code,
                              'last_error', left(b.last_error, 400),
                              'last_success_at', b.last_success_at,
                              'consecutive_failures', b.consecutive_failures)
      FROM _ff_blind b
     WHERE NOT EXISTS (
       SELECT 1 FROM public.lcc_health_alerts a
        WHERE a.alert_kind = 'feed_mirror_stale' AND a.source = 'feed_mirror:' || b.dom
          AND a.resolved_at IS NULL)
    RETURNING 1
  )
  SELECT count(*) INTO v_mirror_new FROM ins;

  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved: feed-freshness mirror refreshed within SLA'
   WHERE a.alert_kind = 'feed_mirror_stale' AND a.resolved_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM _ff_blind b WHERE 'feed_mirror:' || b.dom = a.source);
  GET DIAGNOSTICS v_mirror_resolved = row_count;

  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved: feed refreshed within SLA'
   WHERE a.alert_kind = 'feed_stale' AND a.resolved_at IS NULL
     AND EXISTS (SELECT 1 FROM _ff_cur c WHERE c.source_key = a.source AND NOT c.is_stale);
  GET DIAGNOSTICS v_resolved = row_count;

  -- B6d. The expectation was retired, so the alert describes a decision rather
  -- than a break. Closed with a note that says which, and where the reason is.
  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved (B6d): the freshness EXPECTATION for this feed was '
           || 'deliberately retired, so this alert described a decision rather than a break. '
           || 'The feed still reports its age; nothing is watching it. The reason is recorded '
           || 'in feed_freshness_registry.unwatched_reason on the owning database.'
   WHERE a.alert_kind = 'feed_stale' AND a.resolved_at IS NULL
     AND EXISTS (SELECT 1 FROM _ff_unwatched u WHERE u.source_key = a.source);
  GET DIAGNOSTICS v_unwatched_resolved = row_count;

  -- Neither evaluable nor explicitly unwatched: the feed left the surface without
  -- saying so. Reported, never auto-resolved -- a decision and a disappearance are
  -- not the same fact and must not close identically.
  SELECT count(*), coalesce(jsonb_agg(jsonb_build_object(
           'source', a.source, 'detected_at', a.detected_at::date) ORDER BY a.detected_at), '[]'::jsonb)
    INTO v_orphaned, v_orphans
    FROM public.lcc_health_alerts a
   WHERE a.alert_kind = 'feed_stale' AND a.resolved_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM _ff_cur c WHERE c.source_key = a.source)
     AND NOT EXISTS (SELECT 1 FROM _ff_unwatched u WHERE u.source_key = a.source)
     AND NOT EXISTS (SELECT 1 FROM _ff_blind b WHERE b.dom = split_part(a.source, ':', 2));

  SELECT count(*) INTO v_stale_n FROM _ff_cur WHERE is_stale;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'domain', dom, 'feed', feed_name, 'age_days', age_days,
           'sla_days', expected_max_age_days, 'latest', latest::date) ORDER BY age_days DESC),
         '[]'::jsonb)
    INTO v_stale
    FROM (SELECT * FROM _ff_cur WHERE is_stale ORDER BY age_days DESC LIMIT c_cap) z;

  SELECT coalesce(jsonb_agg(jsonb_build_object('domain', dom, 'feed', feed_name) ORDER BY dom, feed_name), '[]'::jsonb)
    INTO v_unwatched FROM _ff_unwatched;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'domain', dom, 'unevaluated_feeds', mirror_rows, 'synced_at', synced_at,
           'last_outcome', last_outcome, 'last_status_code', last_status_code)
         ORDER BY dom), '[]'::jsonb)
    INTO v_mirror FROM _ff_blind;

  RETURN jsonb_build_object(
    'new_alerts', v_new, 'resolved', v_resolved,
    'feeds_evaluated', v_evaluated,
    'feeds_excluded_stale_mirror', v_excluded,
    'mirror_alerts_new', v_mirror_new, 'mirror_alerts_resolved', v_mirror_resolved,
    'mirror_unevaluable', v_mirror,
    'unwatched_alerts_resolved', v_unwatched_resolved,
    'feeds_unwatched_by_decision', v_unwatched,
    'alerts_orphaned', v_orphaned,
    'orphaned_alerts', v_orphans,
    'stale_total', v_stale_n,
    'stale_omitted', greatest(v_stale_n - c_cap, 0),
    'stale', v_stale,
    'evaluated', v_evaluated);
END;
$function$;

COMMIT;
