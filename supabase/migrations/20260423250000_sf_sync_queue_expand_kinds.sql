-- ============================================================================
-- Migration: expand sf_sync_queue.kind CHECK to support the full
--            multi-flow Power Automate roadmap.
--
-- Target:    LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Context (2026-04-23): Scott's SF org stores "Opportunities" as standard
-- Task records with a custom NMType='Opportunity' picklist value and a
-- future ActivityDate. The original CHECK constraint targeted SF's standard
-- Opportunity object and was too narrow for the multi-flow architecture
-- agreed on in the PA walkthrough.
--
-- Multi-flow breakdown (each kind handled by a different PA flow, all
-- polling this same table):
--
--   Flow 1 — Link Contacts & Companies
--     find_account, find_contact, link_account, link_contact
--
--   Flow 2 — Create Contacts & Companies
--     create_account, create_contact, update_account, update_contact
--
--   Flow 3 — Log Calls
--     log_call
--
--   Flow 4 — Create Activities (Tasks, incl. Opportunities as NMType='Opportunity')
--     create_task, create_opportunity
--
--   Flow 5 — Edit Activities
--     update_task_date, complete_task, advance_opportunity_stage
--
--   Flow 6 — Merge Contacts & Companies
--     merge_accounts, merge_contacts
-- ============================================================================

ALTER TABLE public.sf_sync_queue DROP CONSTRAINT IF EXISTS sf_sync_queue_kind_check;

ALTER TABLE public.sf_sync_queue
  ADD CONSTRAINT sf_sync_queue_kind_check CHECK (kind IN (
    -- Flow 1: Link
    'find_account',
    'find_contact',
    'link_account',
    'link_contact',
    -- Flow 2: Create / Update
    'create_account',
    'create_contact',
    'update_account',
    'update_contact',
    -- Flow 3: Log Calls
    'log_call',
    -- Flow 4: Activities (Tasks)
    'create_task',
    'create_opportunity',
    -- Flow 5: Edit Activities
    'update_task_date',
    'complete_task',
    'advance_opportunity_stage',
    -- Flow 6: Merge
    'merge_accounts',
    'merge_contacts'
  ));

COMMENT ON COLUMN public.sf_sync_queue.kind IS
  'The SF operation the Power Automate flow should execute. Split across six focused flows each polling for a subset of kinds. NOTE: create_opportunity = create a Task with NMType=Opportunity (per Northmarq''s NMType picklist convention, not a standard SF Opportunity record).';
