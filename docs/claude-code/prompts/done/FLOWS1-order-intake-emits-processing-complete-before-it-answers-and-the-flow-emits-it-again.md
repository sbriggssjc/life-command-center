# FLOWS1-order — `api/intake.js` emits processing-complete before it answers the intake flow, and the flow emits it again at its end

**Filed:** 2026-09-16 (Cowork). **Owner:** LCC (`api/intake.js`, `api/_shared/processing-complete.js`,
`api/_shared/pa-move-message.js`). **Evidence:** the FLOWS1 screenshots + Scott's exported
`LCC-OutlookIntaketoTeams(Hardened)` definition (2026-09-16) + a code read.

## The two facts

1. **LCC moves the mail while the intake flow is still waiting on LCC.** `api/intake.js` builds
   `emitPC` (l.701) and **awaits it before returning** on every outcome path (l.807, 832, 1027, 1142,
   1171, 1342 — `const processing_complete = await emitPC(...)`). `emitProcessingComplete` records the
   decision **and** (`pa-move-message.js`) POSTs the move instruction to the *Processing Complete →
   Move Message* flow **immediately**. That flow moves the message. Meanwhile the intake flow's
   `HTTP PostIntakeMessage` is still awaiting our response; its next steps (`GetIntakeSummary`, the
   Teams card, and — before Scott's reorder — `GetEmailWebLink`) then reference a moved message.
   Scott's F2 reorder (web link fetched first) removes the visible 404; the ordering itself remains.
2. **The flow emits processing-complete too.** The exported definition ends with
   `Condition → HTTP_ProcessingComplete` after the Teams card is posted. So the same event is emitted
   twice: once by LCC inside the intake response, once by the flow after the card. `emitProcessingComplete`
   is first-wins idempotent per `internet_message_id`, so the second is a no-op — which means the
   flow's *intended* sequencing (move after the card) never wins; LCC's early emit always does.

## What to build

1. **LCC stops relaying the move from inside the intake response.** Keep recording the decision
   (`processing_log` / the pending-decision row the flow reads) but **do not POST to the Move flow from
   `intake.js`**. The flow's own `HTTP_ProcessingComplete` step, which runs after the card, becomes the
   single trigger of the move — the design `docs/architecture/flows/closing-the-loop-overview.md` describes.
   If some intake channel has no flow behind it (a direct API intake, the sidebar), that channel's
   caller emits explicitly after it is done — name each channel and its emit point.
2. **The response still carries the event** (`processing_complete` in the intake JSON) so the flow
   can log it; only the outbound relay moves.
3. **Duplicates channel**: the `duplicate` outcome (l.807) also relays immediately today; same rule.
4. Tests: intake response returns before any Move POST; the Move POST happens exactly once per
   message, from the flow-driven path; a replayed flag never enqueues a second move.
5. Measure after: `v_flow_run_failures_open` and the next digest for *Outlook Intake* and *Flagged
   Email Intake* (should be 0 for the 404 class), and the `processing_log` timestamps showing move
   after card.

## Prohibitions

- ⛔ Do not change the flow (Scott's F2 is already applied); this is the LCC half.
- ⛔ Keep the idempotency guard; do not replace it with a delay.
- ⛔ Redeploy both Railway services and confirm `/version`.
