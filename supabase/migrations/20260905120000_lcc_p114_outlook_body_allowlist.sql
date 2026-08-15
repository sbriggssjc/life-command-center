-- ============================================================================
-- Prompt 114 — let the FULL Outlook message body survive ingest into the voice
--               corpus (email_bodies).
-- ----------------------------------------------------------------------------
-- THE BLOCKER (grounded live 2026-08-15): the voice corpus source `email_bodies`
-- is written by exactly one path — the bridge handler
-- `handleOutlookMessageExtract` (api/_shared/bridge-handlers-outlook.js), which
-- reads the full Graph body via `p.body.contentType` + `p.body.content`. But the
-- ingest receiver (api/bridges.js -> applyAllowlist) STRIPS any field not on the
-- `outlook.messages` bridge's per-object allowlist BEFORE the job is enqueued.
-- That allowlist for object `Message` did NOT include `body`, so the full body
-- was dropped at ingest and every one of the 23,169 `email_bodies` rows landed
-- with body_text = body_html = NULL (only body_preview survived). No amount of
-- re-sweeping could ever fill the corpus while `body` is stripped.
--
-- FIX (additive, idempotent, reversible): add `body` to the Message allowlist so
-- the Graph `body:{contentType,content}` object survives ingest and the writer
-- can persist body_text / body_html. This is a live-immediately config change on
-- `connector_bridges` (no code deploy needed) — it is the enablement Option A of
-- Prompt 114 depends on. The writer itself is UNCHANGED.
--
-- Backward fill then happens for free: the upsert is
-- `on_conflict=(workspace_id, internet_message_id)` with
-- `Prefer: resolution=merge-duplicates`, so re-sweeping historical Sent/Inbox
-- messages UPDATES the existing empty-body rows with their real body.
--
-- REVERSAL:
--   update connector_bridges
--      set allowlist = jsonb_set(allowlist, '{Message}',
--            (allowlist->'Message') - 'body')
--    where bridge_key = 'outlook.messages';
-- ============================================================================

update connector_bridges
   set allowlist = jsonb_set(
         allowlist,
         '{Message}',
         (allowlist->'Message') || '["body"]'::jsonb
       ),
       updated_at = now()
 where bridge_key = 'outlook.messages'
   and jsonb_typeof(allowlist->'Message') = 'array'
   and not (allowlist->'Message' @> '["body"]'::jsonb);
