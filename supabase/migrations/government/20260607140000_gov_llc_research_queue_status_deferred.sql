-- ============================================================================
-- R7 Phase 2.3 — widen llc_research_queue.status CHECK (government)
-- ============================================================================
-- The llc-research tick (api/admin.js handleLlcResearchTick) writes status
-- 'deferred' after the no-handler attempt cap (2026-05-31), but the CHECK
-- vocabulary never included it → every such PATCH 23514'd, the row stayed
-- 'in_progress', the staleness reclaim resurrected it, and each cycle logged an
-- ingest_write_failures row (the "32k recent" storm). Widen the vocabulary to
-- include 'deferred' (soft park) + 'dead' (hard dead-letter, set by the tick's
-- max-attempts guard). Widening only — deploy-safe, idempotent. Also parks any
-- currently-stranded in_progress rows so the bleed stops immediately.
-- ============================================================================
ALTER TABLE public.llc_research_queue DROP CONSTRAINT IF EXISTS llc_research_queue_status_check;
ALTER TABLE public.llc_research_queue ADD CONSTRAINT llc_research_queue_status_check
  CHECK (status = ANY (ARRAY['queued','in_progress','done','failed','unsupported_state','no_match','skipped_public_reit','skipped_dupe','deferred','dead']));

UPDATE public.llc_research_queue
   SET status='deferred', last_error=COALESCE(last_error,'no_handler_configured'), resolved_at=now()
 WHERE status='in_progress' AND COALESCE(attempts,0) >= 3;
