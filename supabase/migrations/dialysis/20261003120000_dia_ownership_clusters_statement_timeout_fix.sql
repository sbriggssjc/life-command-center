-- ============================================================================
-- dia — Deals > Ownership renders empty because the view TIMES OUT, not because
--       it is empty. Materialize the canonical on `recorded_owners`.
--
-- SYMPTOM (screenshot 2026-08-28 19:40 CDT): Dialysis > Deals > Ownership shows
-- CANONICAL CLUSTERS 0 / PROPERTIES COVERED 0 / TOTAL VARIANTS 0 / TOP-5 0 and
-- the empty state "No canonical clusters yet — v_recorded_owner_canonical_clusters
-- returned 0 rows. Run dia_unify_canonical_true_owners on the DB to seed."
--
-- ROOT CAUSE, measured live on zqzrriwuavgrquhisnoa 2026-08-29. The exact request
-- the SPA issues, from dia edge_logs at the minute on the screenshot's clock:
--
--   GET | 500 | /rest/v1/v_recorded_owner_canonical_clusters
--                 ?select=*&order=canonical_total_properties.desc&limit=500&offset=0
--                 | Deno/2.1.4 (SupabaseEdgeRuntime/1.74.3)   @ 00:39:57.775Z
--
-- and in postgres_logs 8 seconds later:
--   "canceling statement due to statement timeout"            @ 00:40:05.798Z
--
-- PostgREST connects as `authenticator`, whose role config is
-- `statement_timeout=8s` (anon 3s, authenticated 8s, service_role inherits the
-- authenticator session). EXPLAIN ANALYZE of that exact query: **13,923 ms**.
-- The statement is killed at 8 s, PostgREST answers HTTP 500, and the client
-- helper `diaQuery()` returns `[]` on ANY non-OK response — so the tab renders
-- its "no rows" empty state and every tile reads 0. A 500 and a genuinely empty
-- view are the same pixels. 63 such cancellations were logged in 24 h.
--
-- ⚠️ The data was never missing and the empty state's advice was wrong:
-- `dia_unify_canonical_true_owners` exists, so "run the seeder" looks plausible,
-- but the view holds 61 rows (16 canonicals, 500 properties, top cluster
-- "SMBC Leasing & Finance Inc" — 13 variants / 165 properties). Running it would
-- have been a real owner-merge write performed for no reason.
--
-- WHERE THE 13.9 s GOES — measured per component, not assumed:
--   select count(dia_canonicalize_owner_name(name)) from recorded_owners
--                                                        -> 8,137 ms (7,255 rows)
--   select count(*) from recorded_owners where not is_known_operator(name)
--                                                        ->    55 ms
-- The canonicalizer is the entire budget. It is plpgsql and runs
-- `SELECT canonical FROM owner_canonical_patterns WHERE s ~ match_regex` — 38
-- regexes — once PER ROW: 7,255 x 38 = 275,618 regex evaluations at ~24 us each.
-- Only 72 of those 275,618 pairs match at all.
--
-- Three rewrites were implemented and MEASURED before being rejected:
--   * drop the redundant correlated EXISTS (the plan showed SubPlan 3 at
--     loops=7240; it is equivalent to the window's own cluster_size > 1)
--                                                              -> 13.5 s
--   * replace the per-row function with a LATERAL join on the pattern table
--                                                              ->  7.1 s
--   * drive the join from the 38 patterns instead of the 7,255 owners
--                                                              ->  6.7 s
-- None clears 8 s with margin. The regex work is irreducible at read time, so it
-- has to move out of read time.
--
-- FIX: `recorded_owners.canonical_name`, written by a BEFORE INSERT OR UPDATE OF
-- name trigger that is its SINGLE writer, plus a backfill. The view then groups
-- on a stored, indexed column. Writes pay canonicalization once per row instead
-- of every reader paying for all 7,255.
--   AFTER: 13,923 ms -> **133 ms** (105x), and 61 rows still return with
--   `statement_timeout = 8s` set explicitly.
--   Equivalence: 0-row diff BOTH directions against a pre-change snapshot
--   (61 = 61, `except all` empty each way).
--
-- The redundant correlated EXISTS is dropped in the same rebuild.
-- `canonical IS NOT NULL` is stated EXPLICITLY: the old EXISTS excluded NULL
-- canonicals for free because `NULL = NULL` is not true, while
-- `PARTITION BY canonical` groups NULLs together — without that predicate the
-- rewrite would ADD rows.
--
-- ⚠️ STALENESS, stated rather than assumed: the stored value tracks `name`, not
-- `owner_canonical_patterns`. Editing a pattern does NOT retro-fix stored rows.
-- Run `select * from dia_recanonicalize_recorded_owners(false);` after any
-- INSERT/UPDATE/DELETE on that table. `v_dia_canonical_name_drift` is the
-- standing detector (a one-shot backfill and a fixed producer are
-- indistinguishable until the producer runs again — playbook Class 8).
--
-- ⚠️ dia_canonicalize_owner_name was declared IMMUTABLE while reading a table.
-- That is a lie to the planner (it licenses folding a result across an edit to
-- owner_canonical_patterns) and it is corrected to STABLE here. Checked before
-- changing: NO functional index and NO generated column depends on it — either
-- would have required IMMUTABLE. Everything else about the function is
-- unchanged, byte for byte.
--
-- ⚠️ Deliberately NOT changed, having been measured: the two ownership views
-- carry `security_invoker=on`, which makes them return 0 rows to `anon` and (for
-- the clusters view, whose canonicalizer cannot read the RLS-protected pattern
-- table as anon) silently canonicalize every name to itself. That is a real
-- latent hazard and it is NOT this bug: the data-query proxy reads as
-- service_role, which bypasses RLS, and the pre-fix view returns 61 rows to
-- service_role. Flipping it would widen anon's access to owner/property data for
-- no benefit here. Left as found, named for whoever needs it.
--
-- Additive and reversible:
--   -- restore the previous view body from git, then:
--   drop trigger trg_dia_recorded_owner_canonical_name on public.recorded_owners;
--   drop function public.dia_recorded_owner_set_canonical_name();
--   drop function public.dia_recanonicalize_recorded_owners(boolean);
--   drop view public.v_dia_canonical_name_drift;
--   alter table public.recorded_owners drop column canonical_name;
--   -- and set dia_canonicalize_owner_name back to IMMUTABLE if truly wanted.
-- ============================================================================

-- ── honest volatility on the canonicalizer (it reads a table) ──────────────
CREATE OR REPLACE FUNCTION public.dia_canonicalize_owner_name(raw text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  s text;
  v_canonical text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := lower(btrim(raw));
  IF s = '' THEN RETURN NULL; END IF;
  SELECT canonical INTO v_canonical
  FROM public.owner_canonical_patterns
  WHERE s ~ match_regex
  ORDER BY priority ASC
  LIMIT 1;
  IF v_canonical IS NOT NULL THEN RETURN v_canonical; END IF;
  RETURN btrim(raw);
END;
$function$;

ALTER TABLE public.recorded_owners
  ADD COLUMN IF NOT EXISTS canonical_name text;

COMMENT ON COLUMN public.recorded_owners.canonical_name IS
  'dia_canonicalize_owner_name(name), materialized at write time. Single writer: '
  'trg_dia_recorded_owner_canonical_name. Read this instead of calling the '
  'function per row — the function costs ~1.1 ms/call (38 regexes over '
  'owner_canonical_patterns) and reading it live blows PostgREST''s 8 s '
  'statement_timeout. Re-run dia_recanonicalize_recorded_owners() after editing '
  'owner_canonical_patterns.';

CREATE INDEX IF NOT EXISTS idx_recorded_owners_canonical_name
  ON public.recorded_owners (canonical_name)
  WHERE canonical_name IS NOT NULL;

-- ── single writer ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dia_recorded_owner_set_canonical_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
  -- Deliberately NOT fill-blanks. canonical_name is DERIVED from name so it must
  -- track it; the sibling trigger dia_owner_set_normalized_name is fill-blanks
  -- because normalized_name is curatable and this is not.
  NEW.canonical_name := public.dia_canonicalize_owner_name(NEW.name);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_dia_recorded_owner_canonical_name ON public.recorded_owners;
CREATE TRIGGER trg_dia_recorded_owner_canonical_name
  BEFORE INSERT OR UPDATE OF name ON public.recorded_owners
  FOR EACH ROW EXECUTE FUNCTION public.dia_recorded_owner_set_canonical_name();

-- ── re-run after a pattern edit ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dia_recanonicalize_recorded_owners(
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(scanned bigint, changed bigint, dry_run boolean)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_scanned bigint; v_changed bigint;
BEGIN
  CREATE TEMP TABLE _recanon ON COMMIT DROP AS
    SELECT recorded_owner_id,
           canonical_name AS old_canonical,
           public.dia_canonicalize_owner_name(name) AS new_canonical
    FROM public.recorded_owners;

  SELECT count(*), count(*) FILTER (WHERE old_canonical IS DISTINCT FROM new_canonical)
    INTO v_scanned, v_changed FROM _recanon;

  IF NOT p_dry_run THEN
    UPDATE public.recorded_owners ro
       SET canonical_name = r.new_canonical
      FROM _recanon r
     WHERE r.recorded_owner_id = ro.recorded_owner_id
       AND ro.canonical_name IS DISTINCT FROM r.new_canonical;
  END IF;

  RETURN QUERY SELECT v_scanned, v_changed, p_dry_run;
END;
$fn$;

-- ── backfill (~8 s; run by the migration role, which has no statement_timeout;
--    UPDATE OF name does not fire, so this does not recurse) ────────────────
UPDATE public.recorded_owners
   SET canonical_name = public.dia_canonicalize_owner_name(name);

ANALYZE public.recorded_owners;

-- ── the view, reading the stored column ────────────────────────────────────
-- Column list, order and types are unchanged (CREATE OR REPLACE VIEW is
-- append-only for columns): canonical, recorded_owner_id, recorded_owner_name,
-- properties, cluster_size, canonical_total_properties. security_invoker is
-- restated as found (see the note in the header).
CREATE OR REPLACE VIEW public.v_recorded_owner_canonical_clusters
WITH (security_invoker = on) AS
WITH ranked AS (
  SELECT ro.recorded_owner_id,
         ro.name AS recorded_owner_name,
         ro.canonical_name AS canonical,
         (SELECT count(*) FROM public.properties p
           WHERE p.recorded_owner_id = ro.recorded_owner_id) AS properties
  FROM public.recorded_owners ro
  WHERE NOT public.is_known_operator(ro.name)
    AND ro.name IS NOT NULL
    AND ro.canonical_name IS NOT NULL          -- see the NULL note in the header
    AND lower(btrim(ro.name)) <> ALL (ARRAY[
      'independent','unknown','other','none','n/a','tbd','various','--','---','—'
    ])
), windowed AS (
  SELECT ranked.canonical,
         ranked.recorded_owner_id,
         ranked.recorded_owner_name,
         ranked.properties,
         count(*)               OVER (PARTITION BY ranked.canonical) AS cluster_size,
         sum(ranked.properties) OVER (PARTITION BY ranked.canonical) AS canonical_total_properties
  FROM ranked
)
SELECT canonical, recorded_owner_id, recorded_owner_name, properties,
       cluster_size, canonical_total_properties
FROM windowed
WHERE cluster_size > 1
ORDER BY canonical_total_properties DESC, canonical, properties DESC;

GRANT SELECT ON public.v_recorded_owner_canonical_clusters TO anon, authenticated, service_role;

-- ── standing drift detector ────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_dia_canonical_name_drift
WITH (security_invoker = on) AS
SELECT ro.recorded_owner_id,
       ro.name,
       ro.canonical_name                            AS stored_canonical,
       public.dia_canonicalize_owner_name(ro.name)  AS computed_canonical
FROM public.recorded_owners ro
WHERE ro.canonical_name IS DISTINCT FROM public.dia_canonicalize_owner_name(ro.name);

COMMENT ON VIEW public.v_dia_canonical_name_drift IS
  'Must return 0 rows. A row means either owner_canonical_patterns changed '
  'without a dia_recanonicalize_recorded_owners(false) run, or a writer escaped '
  'trg_dia_recorded_owner_canonical_name. It is a full scan calling the '
  'canonicalizer per row (~8 s) — run it as a role without the 8 s '
  'statement_timeout, and positive-control it before trusting a zero.';

GRANT SELECT ON public.v_dia_canonical_name_drift TO service_role;

-- VERIFY (all four run and passed on 2026-08-29):
--   1. survives the real timeout:
--        begin; set local statement_timeout='8s'; set local role service_role;
--        select count(*) from (select * from public.v_recorded_owner_canonical_clusters
--          order by canonical_total_properties desc limit 500 offset 0) t;  -- 61
--        rollback;
--   2. equivalence, both directions, against a snapshot of the old view -> 0 / 0
--   3. drift is 0 AND the detector can fire (positive control): corrupt one
--      canonical_name inside a rolled-back tx -> the view returns 1 row.
--   4. the trigger is the single writer: insert a row named
--      'SMBC LEASING AND FINANCE, INC.' inside a rolled-back tx ->
--      canonical_name = 'SMBC Leasing & Finance Inc'.
