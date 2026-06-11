# Claude Code — commit the activity_events dedup unique index as a repo migration

## Why (grounded live 2026-06-11)
`appendActivityEvent` (`api/_shared/activity-events.js`) POSTs with
`on_conflict=workspace_id,source_type,external_id`, but **no matching unique index
existed** on `activity_events` (only the `id` PK). Result: every dedup insert
returned **400** ("no unique or exclusion constraint matching the ON CONFLICT
specification") — so the writer had never actually worked via its dedup path. This
blocked Slice 3b (SF-activity ingest 400'd on insert until the index was added).

The fix was **applied LIVE to LCC Opps** (dedup 21 pre-existing collisions + create
the unique index), and the SF-activity handler now inserts + dedups correctly. But
the change exists only in the live DB + Supabase migration history — it must be a
**repo migration file** so a rebuild/replay/CI can't lose this critical index.

## The change — add the migration file (LCC Opps)
Create `supabase/migrations/<next-timestamp>_lcc_activity_events_dedup_unique_index.sql`
with EXACTLY what was applied live (idempotent — safe to re-run against the live DB
where it already exists):

```sql
-- appendActivityEvent dedups via on_conflict=(workspace_id, source_type, external_id);
-- this index is what makes that dedup work. Applied live 2026-06-11; committed here
-- for repo/replay consistency.

-- 1) Remove pre-existing collisions so the unique index can be created (keep the
--    earliest row per group). No-op once deduped.
DELETE FROM public.activity_events a
USING (
  SELECT id, row_number() OVER (
    PARTITION BY workspace_id, source_type, external_id
    ORDER BY created_at ASC, id ASC
  ) AS rn
  FROM public.activity_events
  WHERE external_id IS NOT NULL
) d
WHERE a.id = d.id AND d.rn > 1;

-- 2) The dedup key. NULL external_id rows stay distinct (insert every time) per the
--    writer contract; non-null (workspace, source_type, external_id) triples dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_events_workspace_source_external
  ON public.activity_events (workspace_id, source_type, external_id);

COMMENT ON INDEX public.uq_activity_events_workspace_source_external IS
  'Dedup key for appendActivityEvent (workspace_id, source_type, external_id).';
```

## House rules
Migration-only change (no JS). Idempotent (`IF NOT EXISTS` + the dedup is a no-op
once clean). Use the project's next migration timestamp. No `api/*.js` touched.
