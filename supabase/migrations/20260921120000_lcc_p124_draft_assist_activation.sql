-- ============================================================================
-- P124 — draft-assist end-to-end activation gates.
--
-- Two registry changes, both additive / idempotent / reversible:
--
--  1. Registers PA_OUTLOOK_DRAFT_URL — the Power-Automate "LCC Create Outlook
--     Draft" flow. This is a whole capability that NO-OPS when unset (the seam
--     returns an honest "not configured" and creates nothing), which is exactly
--     the class CLAUDE.md §Inert-feature-registry says must be visible in the
--     daily Dormant Capabilities digest. It was never registered, so the single
--     dependency the DRAFT_ASSIST flag rests on was invisible.
--
--  2. Re-states the DRAFT_ASSIST notes with the P124 verification gate.
--
-- ⚠️ RE-MEASURED 2026-08-21: DRAFT_ASSIST.state IS ALREADY 'on' (since
--    2026-08-14 20:26 UTC, off_since NULL). The originating prompt assumed it
--    was still gated off — exactly the dated-blocker trap CLAUDE.md warns
--    about. Consequence: POST /api/draft-assist?save=true has been UNGATED for
--    a week, so the pre-P124 defects were live, not latent — a cold_bd draft
--    would have been voiced on personal/family mail, and no saved draft
--    threaded into its conversation. Both are fixed in the P124 code, which
--    ships on the next Railway redeploy of merged main.
--
-- ⚠️ NEITHER FLAG IS TURNED ON HERE. `state` is deliberately absent from both
--    ON CONFLICT DO UPDATE column lists, so re-running this migration can never
--    flip a live flag on or off — `state` stays operator-curated (CLAUDE.md).
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
--
-- REVERSAL:
--   DELETE FROM feature_flags_registry WHERE flag = 'PA_OUTLOOK_DRAFT_FLOW';
--   -- (DRAFT_ASSIST's row predates this migration; restore its notes from
--   --  20260901120000_lcc_w10_2_draft_assist_flag.sql if needed.)
-- ============================================================================

BEGIN;

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'PA_OUTLOOK_DRAFT_FLOW',
  'Org-sanctioned save-not-send outbound path: LCC POSTs a rendered draft to the Power-Automate "LCC Create Outlook Draft" flow, which creates a DRAFT in Scott''s Outlook under his own M365 connection (no tenant-admin app registration, no Graph /sendMail anywhere). P124 added a branch on in_reply_to so the draft threads into the live conversation via Graph createReply instead of landing as an orphan new thread.',
  'api/_shared/outlook-draft.js::createOutlookDraftViaPA — consumed by api/draft-assist.js (POST save) and the offer-submission skill',
  'PA_OUTLOOK_DRAFT_URL',
  'off', DATE '2026-08-21', 'Scott Briggs',
  'UNVERIFIED AGAINST A LIVE TENANT as of 2026-08-21. The flow definition lives at flow-lcc-create-outlook-draft.json; import + wiring steps, the acceptance test, and the known gaps are in docs/architecture/flows/outlook-draft-reply-executor.md. Optional shared secret: PA_OUTLOOK_DRAFT_SECRET (sent as X-LCC-Flow-Secret). Confirm live via GET /api/diag?kind=env. While unset, POST /api/draft-assist returns an honest not-configured error and creates nothing — it never falls back to sending.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes, updated_at = now();

UPDATE public.feature_flags_registry
   SET notes = 'GET /api/draft-assist is a dry-run and works regardless of this flag. POST save-to-Outlook is gated ON this flag AND on PA_OUTLOOK_DRAFT_FLOW (PA_OUTLOOK_DRAFT_URL) being configured. On-prem generation requires OLLAMA_URL and fails CLOSED — there is no cloud fallback for this surface. '
                'STATE NOTE: this flag has been ON since 2026-08-14; it was NOT flipped by P124 and P124 did not turn it off (that is Scott''s call). '
                'P124 VERIFICATION GATE — run these now that it is live, in order: (1) run the GET dry-run for 3-5 real counterparties and confirm retrieval.excluded_personal_or_unclassified is NON-ZERO — that is the P124 guard keeping Scott''s family mail out of the cold-BD voice bucket; (2) confirm reply_to is non-null and names a thread you recognise; (3) confirm voice_confidence claims FULL-BODY grounding (the corpus has been 100% full bodies since 2026-08-21, so a preview-era caveat means something regressed); (4) Scott reads the drafts and approves the voice; (5) save ONE draft and verify it is in Drafts and that SENT ITEMS GAINED NOTHING. If any step fails, set state=''off'' until it passes. Full runbook: docs/architecture/flows/outlook-draft-reply-executor.md.',
       updated_at = now()
 WHERE flag = 'DRAFT_ASSIST';

COMMIT;
