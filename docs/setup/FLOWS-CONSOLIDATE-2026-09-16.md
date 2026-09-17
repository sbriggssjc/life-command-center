# FLOWS-consolidate — one flow owns the flagged-email lifecycle (S4 = option b), step by step

**For:** Scott, in the Power Automate portal. **Decision:** S4 (2026-09-16) — *one flow owns the message
lifecycle*. **Evidence:** the two exported definitions in `private/power-automate/exports-2026-09-16/`
(`LCCFlaggedEmailIntake_…zip`, `LCC-OutlookIntaketoTeams(Hardened)_…zip`) and `api/_handlers/move-queue.js`
(P120). **Tracked in:** `OPERATOR-CHECKLIST.md` row **F8**; backlog `FLOWS-consolidate`.

## What the two flows do today (read from the exports, not assumed)

Both trigger on **`When an email is flagged (V3)`** on the same mailbox folder.

| step | LCC Flagged Email Intake | LCC – Outlook Intake to Teams (Hardened) |
|---|---|---|
| read the message | `Get email (V2)` | `HTTP GetEmailWebLink` (Graph, `$select=webLink`) |
| attachments | for each: `POST /api/intake/prepare-upload` → `PUT` bytes | — |
| tell LCC | `POST /api/intake?_route=outlook-message` | `POST /api/intake-outlook-message` (same handler, same JSON back) |
| Teams | — | `GET /api/intake-summary?correlation_id=…` → `Post card in a chat or channel` |
| completion | — | `Condition` (target_folder not empty) → `POST /api/webhooks/processing-complete` → LCC relays to the *Processing Complete → Move Message* flow, which flags + moves |
| its own move | **`Flag email (V2)` → `Mark as read or unread (V3)` → `Move email (V2)` → Terminate** | — |
| failure | `PostDeadLetter` (`lcc_record_flow_failure`) → Terminate | — |

So one message is posted to LCC twice (idempotent, so harmless), the Teams card comes only from the
Hardened flow, and it is **moved by two different movers**: the Flagged flow's own `Move email (V2)` and
the Move Message flow that LCC calls after the card. Whichever runs second finds the message gone —
that is the FLOWS1 404 / PreconditionFailed class, and `move-queue.js` (P120) already says the intake
flow must not move at classification time.

## End state

**One flow — `LCC Flagged Email Intake` — does everything: attachments, intake, web link, card,
processing-complete. It does not move the message.** The move stays where the design puts it: LCC
records the decision, the *Processing Complete → Move Message* flow (F4, already fixed to flag-then-
move) performs the single move. The Hardened flow is turned **off** (not deleted) for one digest cycle,
then deleted.

## Steps (designer, ~20 minutes)

**Pre-check (1 minute).** My flows → search **"Move Queue"**. If a flow called *LCC Move Queue
Executor* (reads `/api/move-queue-worklist`) exists **and is on**, tell Cowork before continuing — that
would be a third mover and the steps below change (it would take over the move and F4's flow would be
turned off too). If it does not exist, continue.

**1. Copy the four actions out of the Hardened flow.** Open *LCC – Outlook Intake to Teams (Hardened)*
→ Edit. For each of these, click the action → **⋯ → Copy to my clipboard**: `HTTP GetEmailWebLink`,
`HTTP GetIntakeSummary`, `Post card in a chat or channel`, `Condition` (copying the Condition brings
`HTTP ProcessingComplete` inside it). Close without saving.

**2. Open *LCC Flagged Email Intake* → Edit.** Expand the `Condition` after `HTTP - outlook-message`.
In the **If yes** branch you will see `Flag email (V2)` → `Mark as read or unread (V3)` → `Move email
(V2)` → `Terminate`.

**3. Remove the flow's own move.** Click **`Move email (V2)`** → **⋯ → Delete** (confirm). Click
**`Terminate`** → **⋯ → Delete**. Leave `Flag email (V2)` and `Mark as read or unread (V3)` — they only
clear the flag and mark read; F4's flow tolerates both.

**4. Paste the copied actions, in this order, after `Mark as read or unread (V3)`:** click **+ Insert a
new step** below it → **My clipboard** tab → `HTTP GetEmailWebLink`; then below that `HTTP
GetIntakeSummary`; then `Post card in a chat or channel`; then `Condition`.

**5. Re-point the three expressions** that refer to the Hardened flow's intake action. In this flow the
intake action is named **`HTTP - outlook-message`**, so every `body('HTTP_PostIntakeMessage')` must
become `body('HTTP_-_outlook-message')`:
- `HTTP GetIntakeSummary` → URI: `…/api/intake-summary?correlation_id=@{body('HTTP_-_outlook-message')?['correlation_id']}&limit=1`
- the pasted `Condition` → left value: `body('HTTP_-_outlook-message')?['processing_complete']?['target_folder']` (is not equal to empty)
- `HTTP ProcessingComplete` (inside the Condition) → Body: the three `@{body('HTTP_PostIntakeMessage')?['processing_complete']?['…']}` references → `HTTP_-_outlook-message`.
Click each field, delete the old token, and pick the value from **Dynamic content → HTTP - outlook-message**
(the designer shows the body fields once the action has run once; if it does not, paste the expression
text via **Expression**). `HTTP GetEmailWebLink` and the card's `triggerOutputs()` references need no change.

**6. Keep the safety nets.** Click `HTTP GetEmailWebLink` → **⋯ → Settings → Retry policy → Exponential,
3, PT20S**. Click `HTTP GetIntakeSummary` → **⋯ → Configure run after** → tick *is successful* **and**
*has failed* on `HTTP GetEmailWebLink` (a missing web link must never block the card).

**7. Save. Test:** flag one email with one attachment. Expected: run succeeds; the artifact appears in
LCC (`/api/intake-summary` shows it); one Teams card; the message is moved **once**, by the *Processing
Complete → Move Message* flow (check its run history — one run, succeeded); no 404, no PreconditionFailed.

**8. Turn the Hardened flow off.** My flows → *LCC – Outlook Intake to Teams (Hardened)* → **⋯ → Turn
off**. Do not delete yet.

**9. Export the edited Flagged flow** (⋯ → Export → Package) into `docs/claude-code/SB notes/` so Cowork
can verify the definition, as with F1c.

## Verify

Next Saturday digest: 0 failures for *Outlook Intake to Teams* (it is off), 0 for *Flagged Email
Intake*, 0 PreconditionFailed on *Processing Complete → Move Message*. Then delete the Hardened flow.

## Not in scope

`docs/claude-code/prompts/…FLOWS1-order…` was refuted and stays refuted — no LCC change is needed for
this. If the pre-check finds a Move Queue Executor, Cowork rewrites steps 3 and 8 before you edit.
