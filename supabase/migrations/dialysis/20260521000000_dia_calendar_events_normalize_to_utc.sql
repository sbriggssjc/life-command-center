-- Round 76gp — Calendar events timezone normalization (Dialysis_DB project)
--
-- Historical Power Automate flows wrote calendar event times as naive Central
-- wall-time strings that Postgres silently coerced to timestamptz with a +00:00
-- offset. The frontend's stripTZ() hack compensated for this on render. Going
-- forward (ai-copilot edge function v53) every event lands as TRUE UTC, so the
-- legacy rows must be shifted forward by the Central offset they implicitly
-- carried at the time of the event (CDT or CST — Postgres handles DST via
-- AT TIME ZONE 'America/Chicago').
--
-- Idempotence: gated on a flag column `tz_normalized_at`. Rows already touched
-- by the new edge function (which sets tz_normalized_at on insert) are skipped.
-- Run order:
--   1. Apply this migration BEFORE deploying the new frontend so the new
--      Intl-based renderer reads true-UTC values.
--   2. Deploy the new edge function so subsequent syncs preserve UTC.
--   3. Trigger Power Automate calendar flows to re-sync from source of truth.

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS tz_normalized_at timestamptz;

WITH legacy AS (
  SELECT id
  FROM public.calendar_events
  WHERE tz_normalized_at IS NULL
    AND start_time IS NOT NULL
)
UPDATE public.calendar_events ce
SET
  start_time = (ce.start_time AT TIME ZONE 'UTC')::timestamp
                  AT TIME ZONE 'America/Chicago',
  end_time   = CASE
                 WHEN ce.end_time IS NULL THEN NULL
                 ELSE (ce.end_time AT TIME ZONE 'UTC')::timestamp
                        AT TIME ZONE 'America/Chicago'
               END,
  tz_normalized_at = now()
FROM legacy
WHERE ce.id = legacy.id;

COMMENT ON COLUMN public.calendar_events.tz_normalized_at IS
  'Set when the row''s start_time/end_time were converted from naive-Central-stored-as-UTC to true UTC. Rows synced by ai-copilot v53+ are set on insert. Used to prevent double-shifting if this migration is re-run.';
