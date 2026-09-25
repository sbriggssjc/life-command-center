-- REVIEW-LANES1 (2026-09-25) — the lanes' own tick. Twice a day it auto-resolves the safe classes
-- on every domain (dia/gov listing↔sale, gov owner reviews, asset relinks a merge ledger settles)
-- and records each lane's open count for the review_lane_backlog alert.
--
-- ⚠️ Apply AFTER the Railway deploy that serves /api/review-lanes-tick (check /version against the
-- merge SHA). Before that the route is an API-scoped 404 and every run would fail.
SELECT cron.schedule('lcc-review-lanes1-tick', '17 6,18 * * *',
  $$SELECT public.lcc_cron_post('/api/review-lanes-tick', '{"trigger_source":"cron"}'::jsonb, 'railway');$$);
