-- User feedback (2026-05-07): "all of these charts display data through
-- the 2Q of 2026. When updating for anything, we want to ensure the
-- newest reported period as already passed. For instance, if we export
-- the data on May 7, 2026 (today), we would only have the charts display
-- and report through 3/31/2026 or the first quarter since we are still
-- in the second quarter and its not yet completed."
--
-- This adds two SQL helpers used by every cm_*_master_m / cm_*_market_quarterly
-- view to clamp the latest displayed period to the last fully completed
-- quarter / month. The dialysis Round 2 fix only excluded the in-progress
-- month — but on 2026-05-07 a 2026-04-30 month_end still maps to the
-- in-progress Q2-2026 fiscal_quarter label, which is what the user saw.
--
-- The helpers are mirrored in the gov DB and dialysis DB by parallel
-- migrations (each domain's master_m view needs them locally).

create or replace function public.cm_last_completed_quarter_end()
returns date
language sql
stable
as $$
  -- The most recent quarter-end date that has already passed.
  -- Examples (note the assumption: a quarter-end date itself counts as
  -- "completed" only the day after — we want strictly past quarters):
  --   on 2026-05-07 → 2026-03-31  (Q1 closed; Q2 in progress)
  --   on 2026-06-30 → 2026-03-31  (Q2 still in progress on its last day)
  --   on 2026-07-01 → 2026-06-30  (Q2 just closed)
  --   on 2026-01-15 → 2025-12-31  (Q4 2025 closed; Q1 2026 in progress)
  select (
    date_trunc('quarter', current_date::timestamptz) - interval '1 day'
  )::date
$$;

create or replace function public.cm_last_completed_month_end()
returns date
language sql
stable
as $$
  -- The most recent month-end date that has already passed.
  -- Examples:
  --   on 2026-05-07 → 2026-04-30
  --   on 2026-04-30 → 2026-03-31  (April still in progress on its last day)
  --   on 2026-05-01 → 2026-04-30  (April just closed)
  select (
    date_trunc('month', current_date::timestamptz) - interval '1 day'
  )::date
$$;

comment on function public.cm_last_completed_quarter_end() is
  'Returns the date of the most recent quarter-end that has already passed. '
  'Used by cm_*_master_m and cm_*_market_quarterly views to exclude in-progress '
  'quarters from chart axes. On 2026-05-07 returns 2026-03-31.';

comment on function public.cm_last_completed_month_end() is
  'Returns the date of the most recent month-end that has already passed. '
  'Used internally by master_m views; usually you want '
  'cm_last_completed_quarter_end() instead since chart x-axes show fiscal '
  'quarter labels.';

grant execute on function public.cm_last_completed_quarter_end()
  to anon, authenticated, service_role;
grant execute on function public.cm_last_completed_month_end()
  to anon, authenticated, service_role;
