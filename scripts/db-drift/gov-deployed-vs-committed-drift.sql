-- I16 drift detector — deployed-vs-committed definition drift for the government database.
--
-- STATUS: NOT YET RUN under real credentials. This sandbox has no network access to Supabase
-- (see docs/architecture/data-coherence-invariants.md I16 and docs/claude-code/STATUS.md,
-- 2026-09-12 entry). Do NOT fabricate a result for this script — run it for real against the
-- government Supabase project (ref `scknotsqkcheojiaewwh`) first, record what it finds, and
-- only then consider wiring it into the I11 alert path (cron/pg_cron), per this repo's own
-- "a new job is not shipped until it has been green once" rule.
--
-- WHAT THIS DOES
-- Every routine, view, and trigger function that `government-lease`'s migrations define is
-- hashed from the LIVE, deployed definition (via pg_get_functiondef / pg_get_viewdef) and
-- compared against a hash of what the OWNING repo's migrations would produce. A mismatch means
-- the deployed object has drifted from its committed source — exactly the state that let
-- ID3a-b's fix ship live and never get committed, and that let this repo's own stale
-- `canonicalize_agency()` copy sit undetected for months.
--
-- WHY THIS RUNS AS TWO STEPS, NOT ONE QUERY
-- The database cannot see government-lease's git history — it can only see what is currently
-- deployed. So the comparison has to happen OUTSIDE Postgres: this script produces the "live"
-- side of the diff (one hash per object, computed live), and a companion step (§3 below)
-- produces the "expected" side by replaying government-lease's migrations against a scratch
-- database (or, cheaper for a first pass, by hashing the CREATE OR REPLACE body of the LATEST
-- migration that touches each object name). The two hash lists are then diffed by a human or a
-- small script — this SQL file only emits the live half.
--
-- HOW TO RUN THIS (against the government Supabase project, with real credentials)
--
--   1. Run this file against the LIVE government database (via `psql`, the Supabase SQL editor,
--      or `mcp__Supabase__execute_sql` with `project_id` pointed at the government project) and
--      save the result as `live_object_hashes.csv` (or similar).
--
--   2. In a checkout of `government-lease`, for each object name found in step 1, grep its
--      migrations for the MOST RECENT `CREATE OR REPLACE FUNCTION <name>` / `CREATE OR REPLACE
--      VIEW <name>` / `CREATE TRIGGER <name>` block, extract that block's body text, and hash it
--      with the SAME algorithm this script uses (md5 of the whitespace-normalized body — see
--      the `normalize_definition()` helper below, which the companion script must mirror
--      exactly or every comparison will show spurious drift from formatting alone).
--
--      A minimal companion script (Node, no DB needed) would:
--        - glob government-lease's `sql/*.sql`
--        - for each file (sorted by the migration's date prefix, oldest first), scan for
--          `CREATE (OR REPLACE)? (FUNCTION|VIEW|TRIGGER) <name>` and `CREATE FUNCTION <name>`
--        - keep the LAST (most recent) full statement body seen per object name — later
--          `CREATE OR REPLACE` wins, matching how Postgres itself resolves the "current"
--          definition after replaying the migration history
--        - md5-hash the same normalized text this SQL file hashes
--      This mirrors exactly how the deployed object got to its current state (a monotonic
--      replay of CREATE OR REPLACE statements), so a match here really does mean "the deployed
--      object is what government-lease's migrations, replayed in order, would produce" — not
--      merely "the deployed object matches SOME migration file".
--
--   3. Diff the two hash lists by object name. Any name present in one list and absent from the
--      other, or present in both with different hashes, is drift and gets reported by name,
--      object kind, and (where the two texts are available) the actual differing lines.
--
-- WHY NOT A SINGLE LIVE QUERY
-- Postgres cannot read government-lease's git repository. A `dblink`/`postgres_fdw` approach
-- that points at a SCRATCH database rebuilt from government-lease's migrations, then diffs
-- `pg_get_functiondef` between the live project and the scratch rebuild, would let step 2 above
-- also run in SQL — but that scratch rebuild is itself a real operational step (spin up a
-- throwaway Supabase branch or local Postgres, apply every government-lease migration in order,
-- then run the SAME query below against it) that needs real credentials and a CI runner with
-- egress. That is the recommended EVENTUAL shape once this has been run manually and found
-- useful; it is out of scope to build here without being able to prove it works.
--
-- NORMALIZATION RULE (must be mirrored by the companion script — see step 2)
-- Trailing whitespace and a single blank line between statements can differ between how
-- Postgres re-serializes a definition and how it appears in a migration file, without the
-- definition being materially different. `normalize_definition()` collapses runs of whitespace
-- to a single space and trims, so the hash is stable across those cosmetic differences while
-- still catching a real change to the body (a changed WHEN clause, a changed branch order, an
-- added/removed guard — exactly ID3a-b's failure mode).

-- ---------------------------------------------------------------------------
-- 1. Normalization helper (session-scoped; safe to run read-only, defines nothing persistent
--    if run as a plain SELECT with a CTE — see the query below, which inlines the same logic
--    via regexp_replace rather than creating a function, so this script never writes to the
--    database it is auditing).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 2. Live object hashes — routines (functions/procedures).
-- ---------------------------------------------------------------------------
WITH live_functions AS (
  SELECT
    n.nspname                                            AS schema_name,
    p.proname                                             AS object_name,
    'function'::text                                      AS object_kind,
    pg_get_functiondef(p.oid)                             AS definition_raw,
    md5(
      regexp_replace(
        trim(pg_get_functiondef(p.oid)),
        '\s+', ' ', 'g'
      )
    )                                                      AS definition_hash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    -- Exclude internal/extension-owned functions; keep only user-defined routines, which is
    -- what a migration could plausibly define. Adjust this filter if government-lease's
    -- migrations define objects in a non-public schema.
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.objid = p.oid AND d.deptype = 'e'
    )
),

-- ---------------------------------------------------------------------------
-- 3. Live object hashes — views (including materialized views, hashed the same way; a
--    materialized view's DEFINITION can drift from its migration even though its DATA is
--    refreshed separately, which is exactly the class of drift I16 cares about).
-- ---------------------------------------------------------------------------
live_views AS (
  SELECT
    n.nspname                                            AS schema_name,
    c.relname                                             AS object_name,
    CASE c.relkind WHEN 'm' THEN 'materialized_view' ELSE 'view' END AS object_kind,
    pg_get_viewdef(c.oid, true)                           AS definition_raw,
    md5(
      regexp_replace(
        trim(pg_get_viewdef(c.oid, true)),
        '\s+', ' ', 'g'
      )
    )                                                      AS definition_hash
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('v', 'm')
),

-- ---------------------------------------------------------------------------
-- 4. Live object hashes — trigger definitions (the trigger's own CREATE TRIGGER clause, e.g.
--    BEFORE/AFTER, event, timing — a trigger can drift by having its FIRING CONDITION changed
--    even if the underlying function body did not, which is a distinct and equally dangerous
--    class of drift from a routine's body changing).
-- ---------------------------------------------------------------------------
live_triggers AS (
  SELECT
    n.nspname                                            AS schema_name,
    t.tgname                                              AS object_name,
    'trigger'::text                                       AS object_kind,
    pg_get_triggerdef(t.oid, true)                        AS definition_raw,
    md5(
      regexp_replace(
        trim(pg_get_triggerdef(t.oid, true)),
        '\s+', ' ', 'g'
      )
    )                                                      AS definition_hash
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
)

SELECT schema_name, object_kind, object_name, definition_hash, definition_raw
FROM live_functions
UNION ALL
SELECT schema_name, object_kind, object_name, definition_hash, definition_raw
FROM live_views
UNION ALL
SELECT schema_name, object_kind, object_name, definition_hash, definition_raw
FROM live_triggers
ORDER BY object_kind, object_name;

-- ---------------------------------------------------------------------------
-- 5. Once you have the companion "expected" hash list (from replaying government-lease's
--    migrations, see step 2 in the header comment), the diff itself is a plain outer join on
--    (object_kind, object_name), comparing definition_hash. Example shape (run OUTSIDE the
--    live database, e.g. in the small companion script, once both CSVs exist):
--
--   SELECT
--     COALESCE(live.object_name, expected.object_name)  AS object_name,
--     COALESCE(live.object_kind, expected.object_kind)  AS object_kind,
--     CASE
--       WHEN live.object_name IS NULL THEN 'expected_but_not_deployed'
--       WHEN expected.object_name IS NULL THEN 'deployed_but_not_in_migrations'
--       WHEN live.definition_hash IS DISTINCT FROM expected.definition_hash THEN 'drifted'
--       ELSE 'match'
--     END AS verdict
--   FROM live_hashes live
--   FULL OUTER JOIN expected_hashes expected
--     ON expected.object_kind = live.object_kind AND expected.object_name = live.object_name
--   WHERE live.definition_hash IS DISTINCT FROM expected.definition_hash
--      OR live.object_name IS NULL OR expected.object_name IS NULL;
--
--   Only rows with verdict <> 'match' are interesting. 'deployed_but_not_in_migrations' is
--   NOT necessarily a bug (an ad-hoc admin function, an extension-created object the filter in
--   §2 missed) — triage before alerting on it. 'drifted' and 'expected_but_not_deployed' are
--   the two verdicts worth an I11 alert.
-- ---------------------------------------------------------------------------
