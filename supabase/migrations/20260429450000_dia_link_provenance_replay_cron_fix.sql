-- FU6 hotfix: correct the dia-link-provenance-replay cron URL format
-- (PR #517 follow-up).
--
-- The original migration scheduled the cron with:
--   public.lcc_cron_post('admin?_route=dia-link-provenance-replay&limit=200')
-- which produced URL '<railway>admin?_route=...' (no leading slash, no
-- /api/ prefix). pg_net responses showed "Couldn't resolve host name"
-- on every invocation. Pattern that the merge-log-reconcile and other
-- working crons use is:
--   public.lcc_cron_post(
--     '/api/admin?_route=...',
--     '{}'::jsonb,
--     'vercel'
--   )

select cron.unschedule('dia-link-provenance-replay');

select cron.schedule(
  'dia-link-provenance-replay',
  '*/5 * * * *',
  $$
    select public.lcc_cron_post(
      '/api/admin?_route=dia-link-provenance-replay&limit=200',
      '{}'::jsonb,
      'vercel'
    )
  $$
);
