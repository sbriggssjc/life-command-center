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

## Pre-check result (2026-09-17) — the Move Queue Executor exists, is on, and is the right mover

Scott exported it (`LCC-MoveQueueExecutor_20260917133632.zip`). Read from the definition: a
**15-minute recurrence** that `GET /api/move-queue-worklist?limit=25`, finds each message by
**`internetMessageId`** (Graph `$filter` — immune to the id change a move causes), clears the flag when
LCC says so, moves it to the folder LCC names (`Intake Staged, Not Completed` / `Processed/Duplicates`),
and `POST /api/move-queue-ack`s the outcome. Live on LCC Opps: **118 moves in the last 14 days,
latest 11:45 UTC today; only 2 `already_out`** (a message some other mover had already taken). That is
P120's single mover, working. So the message has **three** movers today, not two: the Flagged flow's
own `Move email (V2)`, the *Processing Complete → Move Message* flow that LCC's webhook relay pushes to
after the Teams card, and the Executor. The end state keeps only the Executor.

## End state (revised for the pre-check)

**One trigger flow — `LCC Flagged Email Intake` — does attachments, intake, web link and card. It does
not move, does not clear the flag, and does not call the processing-complete webhook** (intake itself
already records the decision that the Executor drains — `move-queue.js`). **The Executor is the only
mover.** The Hardened flow and the *Processing Complete → Move Message* flow are turned **off** (not
deleted) for one digest cycle, then deleted.

## Steps (designer, ~15 minutes)

**1. Copy three actions out of the Hardened flow** — not four. Open *LCC – Outlook Intake to Teams
(Hardened)* → Edit. For each of `HTTP GetEmailWebLink`, `HTTP GetIntakeSummary`, `Post card in a chat
or channel`: click → **⋯ → Copy to my clipboard**. Leave the `Condition` / `HTTP ProcessingComplete`
behind — that is the push relay to the second mover. Close without saving.

**2. Open *LCC Flagged Email Intake* → Edit.** Expand the `Condition` after `HTTP - outlook-message`.
In **If yes**: `Flag email (V2)` → `Mark as read or unread (V3)` → `Move email (V2)` → `Terminate`.

**3. Remove the flow's own move and flag handling.** Delete **`Move email (V2)`**, **`Flag email
(V2)`** and **`Terminate`** (⋯ → Delete each). Keep `Mark as read or unread (V3)`. (The Executor clears
the flag itself when LCC's worklist says `clear_flag`, and the flag is what the trigger keys on — the
intake flow clearing it early is how a second run and the 404s began.)

**4. Paste the three copied actions, in this order, after `Mark as read or unread (V3)`:** **+ Insert a
new step → My clipboard** → `HTTP GetEmailWebLink`; then `HTTP GetIntakeSummary`; then `Post card in
a chat or channel`.

**5. Re-point one expression.** `HTTP GetIntakeSummary` → URI: replace `body('HTTP_PostIntakeMessage')`
with `body('HTTP_-_outlook-message')` →
`…/api/intake-summary?correlation_id=@{body('HTTP_-_outlook-message')?['correlation_id']}&limit=1`.
`HTTP GetEmailWebLink` and the card use `triggerOutputs()` and `body('HTTP_GetIntakeSummary')` only —
no change.

**6. Safety nets.** `HTTP GetEmailWebLink` → ⋯ → Settings → Retry policy **Exponential, 3, PT20S**.
`HTTP GetIntakeSummary` → ⋯ → Configure run after → tick *is successful* **and** *has failed* (a missing
web link never blocks the card).

**7. Save. Test:** flag one email with one attachment. Expected within 15 minutes: the run succeeds,
the artifact shows in LCC (`/api/intake-summary`), one Teams card, and the **Executor's** next run
moves the message once (its run history shows one run with one item; `processing_log` gets
`move_outcome = 'moved'`). No 404, no PreconditionFailed anywhere.

**8. Turn two flows off.** My flows → *LCC – Outlook Intake to Teams (Hardened)* → ⋯ → **Turn off**;
My flows → *LCC Processing Complete → Move Message* → ⋯ → **Turn off** (nothing calls it once the
webhook step is gone; LCC's relay to it becomes dead code — filed as `FLOWS-consolidate-lcc`). Delete
neither until one clean Saturday digest.

**9. Export the edited Flagged flow** (⋯ → Export → Package) into `docs/claude-code/SB notes/` so Cowork
can verify the definition, as with F1c.

## Verify

Next Saturday digest: 0 failures for *Outlook Intake to Teams* and *Processing Complete → Move
Message* (both off), 0 for *Flagged Email Intake*, Executor green. `processing_log`: every intake since
the edit carries `move_outcome = 'moved'` from the Executor and **no `already_out`** — the count of
`already_out` is the count of races, and it should stop at 2.

## Not in scope

`docs/claude-code/prompts/…FLOWS1-order…` was refuted and stays refuted. The one LCC change this leaves
behind — retiring the webhook→Move-Message push relay (`api/sync.js handleProcessingComplete` →
`pa-move-message.js`, `PA_MOVE_MESSAGE_WEBHOOK_URL`) once nothing calls it — is `FLOWS-consolidate-lcc`,
low, after the digest confirms.
