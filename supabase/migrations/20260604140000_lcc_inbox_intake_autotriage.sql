-- R4-C §1: Inbox ↔ staged-intake auto-triage (LCC Opps)
-- ---------------------------------------------------------------------------
-- The Inbox showed ~6,800 "new" items, but most were OM emails the intake
-- pipeline had already auto-extracted / matched / promoted (or discarded as
-- non-deal docs). Two parallel representations of one email stream; automation
-- outcomes never reflected back, producing a fake backlog and double-triage.
--
-- This migration closes the loop at the data layer so it stays closed:
--   1. A trigger on staged_intake_items advances the linked inbox row out of
--      "new" the moment the intake reaches a terminal verdict.
--   2. A one-time backfill applies the same rule to the existing backlog.
--
-- Mapping (only ever touches rows still in 'new', so human triage is never
-- overridden, and the verdict is recorded in metadata for the UI / audit):
--   intake finalized | matched   -> inbox 'triaged'  (verdict 'processed')
--   intake discarded             -> inbox 'archived'  (verdict 'archived')
--   intake review_required|failed-> left in 'new'     (genuinely actionable)
--   anything else (queued/...)   -> left in 'new'     (still in flight)
--
-- Lineage key: staged_intake_items.intake_id = inbox_items.id, with the legacy
-- metadata.bridged_to_intake_id as a fallback link. Idempotent.

create or replace function public.lcc_inbox_autotriage_from_intake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_status text;
  v_verdict    text;
begin
  if new.status in ('finalized','matched') then
    v_new_status := 'triaged'; v_verdict := 'processed';
  elsif new.status = 'discarded' then
    v_new_status := 'archived'; v_verdict := 'archived';
  else
    -- review_required / failed / queued / processing / no_match: leave the
    -- inbox row in 'new' — it is genuinely pending human attention.
    return new;
  end if;

  update public.inbox_items i
     set status     = v_new_status::inbox_status,
         triaged_at = coalesce(i.triaged_at, now()),
         updated_at = now(),
         metadata   = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
           'intake_verdict',  v_verdict,
           'intake_status',   new.status,
           'auto_triaged_at', now(),
           'auto_triaged_by', 'intake_autotriage'
         )
   where i.status = 'new'
     and ( i.id = new.intake_id
        or (i.metadata->>'bridged_to_intake_id') = new.intake_id::text );

  return new;
end;
$$;

drop trigger if exists trg_inbox_autotriage_from_intake on public.staged_intake_items;
create trigger trg_inbox_autotriage_from_intake
  after insert or update of status on public.staged_intake_items
  for each row execute function public.lcc_inbox_autotriage_from_intake();

-- ── One-time backfill over the existing 'new' backlog ──────────────────────
-- Processed (finalized | matched) -> triaged. Run first so it wins over any
-- ambiguous double-link with a discarded sibling.
update public.inbox_items i
   set status     = 'triaged'::inbox_status,
       triaged_at = coalesce(i.triaged_at, now()),
       updated_at = now(),
       metadata   = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
         'intake_verdict',  'processed',
         'intake_status',   s.status,
         'auto_triaged_at', now(),
         'auto_triaged_by', 'intake_autotriage_backfill'
       )
  from public.staged_intake_items s
 where i.status = 'new'
   and s.status in ('finalized','matched')
   and ( s.intake_id = i.id
      or s.intake_id::text = (i.metadata->>'bridged_to_intake_id') );

-- Non-deal (discarded) -> archived.
update public.inbox_items i
   set status     = 'archived'::inbox_status,
       updated_at = now(),
       metadata   = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
         'intake_verdict',  'archived',
         'intake_status',   s.status,
         'auto_triaged_at', now(),
         'auto_triaged_by', 'intake_autotriage_backfill'
       )
  from public.staged_intake_items s
 where i.status = 'new'
   and s.status = 'discarded'
   and ( s.intake_id = i.id
      or s.intake_id::text = (i.metadata->>'bridged_to_intake_id') );
