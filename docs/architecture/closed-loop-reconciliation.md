# BD Copilot — Closed-Loop Reconciliation (analysis + status, 2026-07-31)

Scott's copilot loop: **suggest → draft → broker SENDS → capture the sent mail → log the action in
the LCC + log the call in Salesforce + reschedule the open task in the LCC AND Salesforce per the
cadence.** This is the review + reconciliation of the two write paths that implement it, what was
confirmed live, what shipped, and the one change that's deliberately staged behind live testing.

## The two write paths (as-built)

**Path A — `draft_and_log` (`api/operations.js` `bridgeDraftAndLog`), fires at DRAFT time.**
Renders the template, creates the Outlook draft (`createOutlookDraftViaPA`), logs a **COMPLETED** SF
activity (`logSalesforceActivity`, optimistic), records the template send, and **advances the cadence in
JS** (`advanceCadence`). Anchored to the **contact/cadence entity** (`cadence.entity_id`).

**Path B — `handleOutlookSent` (`api/intake.js`), fires at SENT capture.**
Inserts the sent email as an outbound `email` `activity_events` row (dedup on `internet_message_id`),
then runs `lcc_advance_todos` + `lcc_reconcile_deal_todo`. Anchored to the **deal/asset entity**
(`dealEntityId`, resolved by "a recipient is a correspondent on an open deal").

## What was confirmed live (this session)

- **A cadence-advance TRIGGER exists** on `activity_events`: `activity_event_advance_cadence` →
  `lcc_activity_event_advance_cadence` (enabled). On any inserted `email`/`call`/`meeting` row it looks up
  a `touchpoint_cadence` (by the activity's `entity_id`, then owns-graph, then `contact_id`) and calls
  `lcc_advance_onboarding_cadence`. **So Path B advances the cadence via this trigger** — not in JS.
- **The trigger honors an escape hatch:** `IF metadata->>'skip_cadence_advance' = 'true' THEN RETURN`.
  This is the clean lever for making exactly one path authoritative.

## The reconciliation finding (why a blind "sent = truth" flip is unsafe)

Naively, Path A (JS advance at draft) **and** Path B (trigger advance at send) both advance the same
cadence → a **double-advance** (one logical touch skips two). The instinct is to remove Path A's JS
advance and let the sent trigger own it (matches Scott's doctrine: the cadence should move when the touch
*actually happens*, i.e. on send).

**But the two paths anchor to different entities.** Path B's sent activity is anchored to the **deal
entity**; the prospecting cadence is keyed to the **contact/owner entity**. The trigger's lookup only
reaches that cadence through its fallbacks (owns-graph / `contact_id`), which don't fire for every
prospecting contact. So for many prospecting touches the sent trigger will **not** hit the cadence Path A
advanced — meaning the double-advance is **conditional**, and removing Path A's advance would leave those
cadences **un-advanced on send**. That's why flipping advance-ownership can't be done blind — it needs the
live Outlook sent-capture to verify which cadences the trigger actually reaches.

## Shipped this turn (safe + additive + testable)

**SF task RESCHEDULE in `draft_and_log` (step 6b).** Scott's ask was to reschedule the open task "in the
LCC **and** Salesforce." The LCC side already happens (the cadence advance moves `next_touch_due`); the
**Salesforce side did not** — Path A logged a *completed* SF task but never opened the *next* one. Added:
after the cadence advances, create the **next OPEN SF task** (`createSalesforceTask`, `status:'Open'`,
`activity_date` = the freshly-advanced `next_touch_due`, BD subject/privacy posture), **idempotent** on
`dlnext:<cadence>:<due-ymd>` so a re-draft to the same date can't stack tasks. Best-effort +
feature-flagged: no-ops honestly (`sf_not_configured`) until the PA `create_opportunity` case honors
`status:'Open'`. The endpoint response now carries `sf_reschedule: {created, task_id, reason, due}`.
Purely additive — touches no existing logging/advance behavior. `node --check` clean; the SF import
resolves.

## Staged behind live testing (the advance-ownership migration — do NOT flip blind)

To make **sent the single source of truth** end-to-end (Scott's doctrine), the test-gated plan:
1. **Make the sent trigger the sole advance owner.** Have Path A stamp its (future) LCC spine row — or
   its SF/cadence intent — so the cadence advances only on the real send. Concretely: either (a) Path A
   stops calling `advanceCadence` and relies on the sent trigger, OR (b) Path A keeps advancing but the
   sent activity carries `skip_cadence_advance:true` when it corresponds to an already-advanced draft
   (dedup by a draft→sent correlation id). Decide **after** confirming, live, which cadences the sent
   trigger actually reaches given the deal-vs-contact anchor.
2. **Move the SF completed-activity log to the sent capture** (or dedup it against Path A's optimistic log
   via the existing idempotency key) so SF reflects touches that truly went out.
3. **Fix the anchor gap:** when the sent activity maps to a prospecting contact, also stamp/return the
   contact entity so the trigger (or an explicit call) advances the *contact* cadence, not just the deal.

Each of these changes a working write path whose external effects (SF writes, Outlook sent-capture)
cannot be exercised from the backend session — so they ship only with Scott able to test a real send.

## Open, related
- The `finances`-edge pollution (brokerages logged as lenders) noted in the sidebar doc is upstream of
  this and unrelated to the loop.
- `handleOutlookSent` resolves the deal by recipient-correspondent; a touch to a brand-new prospect with
  no prior correspondence won't resolve a deal (logs unattached) — another reason the contact-anchored
  cadence advance (Path A) still earns its place today.
