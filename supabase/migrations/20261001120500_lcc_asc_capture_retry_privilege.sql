-- The capture RPC uses ON CONFLICT DO UPDATE only to refresh source_url when
-- an identical payload is retried. PostgreSQL checks UPDATE privilege for
-- that statement even when the first execution takes the INSERT path.
-- Preserve the append-only boundary by granting access to that one column.

grant update (source_url)
  on public.healthcare_research_captures
  to service_role;

notify pgrst, 'reload schema';
