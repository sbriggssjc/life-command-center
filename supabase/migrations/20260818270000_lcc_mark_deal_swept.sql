-- ============================================================================
-- lcc_mark_deal_swept — stamp a deal as correspondence-swept so the backfill
-- worker can page through deals in timeout-safe batches (missing_only mode) and
-- converge to full coverage. Also the hook a future cadence run uses to know
-- when a deal was last swept. Merges into bd_opportunities.metadata (non-destructive).
--
-- Why: a full ~40-deal serial flow-sweep exceeds the platform request timeout
-- (~88s -> 502), and an un-paged worker always restarts from the top so it never
-- reaches the tail. The worker's missing_only=1 mode selects open deals where
-- metadata.correspondence_swept_at is null and stamps each once searched (even on
-- 0 messages, a true negative), so repeated small-limit calls converge.
-- ============================================================================
create or replace function public.lcc_mark_deal_swept(
  p_entity_id uuid,
  p_count     int default 0
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0;
begin
  if p_entity_id is null then
    return jsonb_build_object('ok', true, 'note', 'no_entity', 'updated', 0);
  end if;
  update public.bd_opportunities o
     set metadata = coalesce(o.metadata,'{}'::jsonb)
                    || jsonb_build_object(
                         'correspondence_swept_at',   now(),
                         'correspondence_last_count', coalesce(p_count,0))
   where o.entity_id = p_entity_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'entity_id', p_entity_id, 'updated', v_n);
end
$function$;

grant execute on function public.lcc_mark_deal_swept(uuid,int) to anon, authenticated, service_role;

comment on function public.lcc_mark_deal_swept(uuid,int) is
'Stamps bd_opportunities.metadata.correspondence_swept_at (+last_count) so the deal-correspondence backfill worker can page unswept deals in batches (missing_only) and a cadence run can tell when a deal was last swept.';
