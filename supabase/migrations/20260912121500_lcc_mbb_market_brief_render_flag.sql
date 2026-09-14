-- ============================================================================
-- MB-b — feature_flags_registry row for MARKET_BRIEF_RENDER (spec §7:
-- "each step flag-gated OFF until verified live"). Gates:
--   - the daily email's "Lane Briefs" block (briefing-email-handler.js —
--     when off, the block is simply absent, no other section changes)
--   - the homepage Market Briefs tab's DATA (GET /api/market-brief-tab —
--     when off, it returns { enabled: false } rather than a 404/500, so the
--     tab itself can render an honest "not live yet" state)
--
-- Off by default. Flip only after §5's live-verify sequence: run the P-SQL
-- tick, review the rendered block/tab, confirm no fabricated numbers, THEN
-- flip MARKET_BRIEF_PSQL/MARKET_BRIEF_PRSS live long enough to accumulate
-- real facts, THEN flip this one.
--
-- REVERSAL RUNBOOK:
--   DELETE FROM public.feature_flags_registry WHERE flag = 'MARKET_BRIEF_RENDER';
-- ============================================================================

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'MARKET_BRIEF_RENDER',
  'MB-b — render the daily "Lane Briefs" email block and serve live data to the homepage Market Briefs tab (#/briefs/<lane>). Both surfaces read market_brief_facts/market_brief_issues ONLY — never recompute a number.',
  'briefing-email-handler.js (Lane Briefs block, freezes a market_brief_issues row per render) + GET /api/market-brief-tab (#/briefs/<lane> data)',
  'MARKET_BRIEF_RENDER',
  'off',
  CURRENT_DATE,
  'scott',
  'MB-b. Off by default. The daily email simply omits the block while off (no gap message, no fabricated section). The homepage tab returns {enabled:false, hint:...} while off, never a 404/500 — so the client can render an honest degraded state. Flip only after the P-SQL/P-RSS producers (MARKET_BRIEF_PSQL/MARKET_BRIEF_PRSS) have real facts and the rendered block has been reviewed (spec §5).'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var, notes = EXCLUDED.notes;
