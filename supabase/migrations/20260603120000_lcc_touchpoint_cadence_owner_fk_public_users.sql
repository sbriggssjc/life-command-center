-- ============================================================================
-- 20260603120000_lcc_touchpoint_cadence_owner_fk_public_users.sql
--
-- Fix: "Open opportunity →" on the Priority Queue (P0.5 rows) toasted
-- `open_opportunity_failed`. Root cause (live, 2026-06-03):
--
--   23503: insert or update on table "touchpoint_cadence" violates foreign
--   key constraint "touchpoint_cadence_owner_user_id_fkey".
--   Key (owner_user_id)=(b0000000-0000-0000-0000-000000000001) is not
--   present in table "users".   <-- auth.users
--
-- `lcc_open_prospect_opportunity` inserts a bd_opportunities row -> the
-- bd_opportunity_auto_seed_cadence trigger inserts a touchpoint_cadence row
-- with owner_user_id = <caller's user.id> -> FK violation -> whole txn rolls
-- back. The constraint pointed at auth.users(id), but the app's owner ids
-- live in public.users (the seeded/dev owner b0000000-...-0001 exists in
-- public.users + workspace_memberships but never went through Supabase auth
-- signup, so it has no auth.users row).
--
-- This was the ONLY BD-engine owner FK pointing at auth.users -- the verified
-- outlier audit (every public-schema FK whose def references auth.users)
-- returns exactly this one constraint. bd_opportunities, activity_events,
-- bd_opportunity_history, and lcc_onboarding_schedule have no owner FK at all.
-- Blast radius: open_opportunity / initiate_cadence hard-fail; create_lead
-- silently drops the opportunity + cadence (opp insert logged non-fatal).
-- bd_opportunities had 0 rows -- opening an opportunity never once succeeded.
--
-- Safe to re-point: 305 touchpoint_cadence rows, 0 with an owner_user_id
-- absent from public.users -- the new constraint validates cleanly.
--
-- Behavior preserved: column stays nullable; delete behavior stays NO ACTION
-- (the engine's other owner columns carry no FK, so there is nothing to match
-- against -- a minimal re-point is the faithful change). Idempotent: DROP IF
-- EXISTS removes whichever variant is present, then re-ADD points at
-- public.users; re-running is a no-op.
--
-- Apply to: LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

ALTER TABLE public.touchpoint_cadence
  DROP CONSTRAINT IF EXISTS touchpoint_cadence_owner_user_id_fkey;

ALTER TABLE public.touchpoint_cadence
  ADD CONSTRAINT touchpoint_cadence_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES public.users(id);
