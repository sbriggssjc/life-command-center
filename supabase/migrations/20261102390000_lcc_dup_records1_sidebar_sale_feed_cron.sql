-- DUP-RECORDS1 / SALE-PROMOTER1-sidebar-feed (2026-09-26) — the feed's schedule.
-- 05:40 UTC: before gov-sale-promoter (05:50) and dia-sale-promoter (05:52), after the :41 SF refresh of
-- the previous hour. The route stages rows; the promoters decide.
--
-- ⚠️ Apply AFTER the Railway deploy that serves /api/sidebar-sale-feed (check /version against the
-- merge SHA). Before that the route is an API-scoped 404 and every run would fail.
SELECT cron.schedule('lcc-sidebar-sale-feed', '40 5 * * *',
  $$SELECT public.lcc_cron_post('/api/sidebar-sale-feed', '{"trigger_source":"cron"}'::jsonb, 'railway');$$);
