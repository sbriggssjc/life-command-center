-- Round 76gn.d (2026-05-08): geocode-tick cursor pagination state.
-- Mirrors the dia migration. See
--   supabase/migrations/dialysis/20260508130000_dia_round_76gn_d_geocode_cursor.sql
-- for full context.

CREATE TABLE IF NOT EXISTS public.geocode_cursor (
  id smallint PRIMARY KEY DEFAULT 1,
  last_seen_property_id bigint NOT NULL DEFAULT 0,
  loops_completed integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geocode_cursor_singleton CHECK (id = 1)
);

INSERT INTO public.geocode_cursor (id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT, UPDATE ON public.geocode_cursor TO service_role;
GRANT SELECT, UPDATE ON public.geocode_cursor TO authenticated;

COMMENT ON TABLE public.geocode_cursor IS
  'Singleton cursor for the geocode-tick cron. Tracks last_seen_property_id so each tick advances past head-of-queue failures instead of re-reading them. See api/_handlers/geocode-backfill.js. Round 76gn.d.';
