-- A9b phase 1a (2026-05-27): schema parity for the gov→hub contacts cutover.
-- contacts-handler.js references these 4 gov-only columns (incl. filter
-- queries like ?teams_user_id=eq.X). Add them to the LCC Opps hub so the
-- eventual govQuery→opsQuery repoint doesn't 400 on "column does not exist".
-- Types + defaults mirror gov.unified_contacts exactly. Values are backfilled
-- separately (scripts/A9b_backfill_parity_cols.mjs); teams_user_id is all-null
-- on gov so it needs no backfill.
--
-- Applied to LCC Opps (xengecqvemvfknjvbvrq) 2026-05-29. Idempotent.
ALTER TABLE public.unified_contacts
  ADD COLUMN IF NOT EXISTS teams_user_id      text,
  ADD COLUMN IF NOT EXISTS email_aliases      text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS last_activity_date date,
  ADD COLUMN IF NOT EXISTS total_touches      integer DEFAULT 0;
