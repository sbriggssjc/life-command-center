-- ============================================================================
-- MB2b — market_brief_feed_health.item_count records PARSING, not
-- CONTRIBUTION.
--
-- Federal Register (ESRD) returned HTTP 200 with 3 parsed <item> entries on
-- every check, so `ok=true, item_count=3` read as a healthy feed — while
-- every one of the 3 was older than the 72h cutoff, so it contributed 0
-- items to the brief on every run, forever. The health row could not tell
-- "parsed 3, kept 0" from "parsed 3, kept 3": that is exactly the invisible
-- failure invariant I11 exists to name.
--
-- Fix (JS half, `briefing-intel-snapshot/index.ts`): fetchSectorNews() now
-- computes each feed's own after-cutoff survivor count and passes it through
-- recordFeedHealth(). This migration is the additive DB half — a new NULLable
-- column, never a redefinition of `item_count`, which keeps its existing
-- meaning for any existing consumer.
--
-- NULL, not 0, for rows written before this migration (and for any future
-- writer that has not been updated) -- "we don't know" is not the same fact
-- as "zero survived the cutoff" (P180: NULL is not zero).
--
-- REVERSAL RUNBOOK: `ALTER TABLE public.market_brief_feed_health DROP COLUMN
-- items_after_cutoff;` -- purely additive, no other object depends on it yet.
-- ============================================================================

ALTER TABLE public.market_brief_feed_health
  ADD COLUMN IF NOT EXISTS items_after_cutoff integer;

COMMENT ON COLUMN public.market_brief_feed_health.items_after_cutoff IS
  'MB2b: parsed <item>/<entry> entries that survived this feed''s own cutoff window (maxAgeHours override, default 72h) and were therefore added to the brief. NULL for rows written before this column existed or by a writer not yet updated -- never conflate with 0, which means the feed parsed items and none survived the window (see market_brief-intel-snapshot RSS_FEEDS comment for the Federal Register (ESRD) case this closes).';
