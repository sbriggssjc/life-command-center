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
