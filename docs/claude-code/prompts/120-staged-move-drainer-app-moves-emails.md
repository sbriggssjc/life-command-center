# Prompt 120 — Make the app actually move emails: drain the processing_log move queue (staged → folder)

**Status:** DRAFT 2026-08-20 (Cowork-diagnosed; follows P119, which fixed the mirror's staging→Processed leg
but surfaced that nothing populates the staging folder in the first place)

Goal (Scott, explicit): **we want the app to move emails.** The plumbing to decide *where* each processed
email should go already exists and is populated — what's missing is the executor that carries the move out in
Outlook and stamps it done. This prompt builds/repairs that one leg.

Grounding: `api/_shared/processing-complete.js` (computes `target_folder` + sets `move_status='pending'` per
processed email: `staged`→"Intake Staged, Not Completed", `filed`/`duplicate`→under `Processed/`),
`processing_log` (the queue — cols `internet_message_id, graph_rest_id, outcome, target_folder, move_status,
moved_at, move_error, final_target_folder`), `docs/architecture/flows/closing-the-loop-overview.md`
(Flow 1 "Processing Complete → Move Message" and Flow 6 "To Do Completion Poll"), `docs/architecture/flows/
processing-complete-move-message.md`, and P119's now-fixed `mailbox-reconcile.js` (owns staging→Processed).
Doctrines: **Consumption-Layer** (honest counts, auto-retire), and P119's **`not_found`=terminal-success**
(a move whose email already left the source is DONE, not a retry/park).

## The gap (measured live 2026-08-20)

`processing_log` outcome/move_status split: **`filed/moved` 16 · `staged/pending` 323 · `duplicate/pending`
15 · `needs_review/skipped` 47.** So the queue is populated and correct, but **only 16 emails were ever
actually moved (filed, two days last July); the 323 staged + 15 duplicate pending moves have never executed**
(oldest 2026-07-21). Because nothing moves `staged` emails into "Intake Staged, Not Completed", that folder is
empty, and the P119 mirror correctly-but-uselessly acks every candidate `already_out`. The loop is open at the
move-executor.

## The ask

1. **Diagnose the executor.** Determine what was supposed to drain `processing_log.move_status='pending'` and
   why it stopped after the 16 July `filed` rows. Confirm whether Flow 1 ("Processing Complete → Move Message")
   exists and runs, whether `processing-complete.js` exposes a **pending-moves queue endpoint** PA can poll (or
   only emits per-message at classification time), and whether a **stamp-back path** (`move_status='moved'`/
   `'error'` + `moved_at`/`move_error`) exists. Report the real break, don't assume.
2. **Build/repair the drainer (the app moves the email).** LCC side: a sub-route (per repo rule — no new
   top-level `api/*.js`) that returns the pending-move batch (`internet_message_id`/`graph_rest_id` +
   `target_folder`) and a callback that stamps the result. PA side: a scheduled flow that fetches the batch,
   executes the Graph move to `target_folder`, and stamps back. Idempotent on `internet_message_id`.
3. **Reuse P119 semantics, don't reinvent them.** A move whose email is already out of the source folder =
   **terminal success** (`moved`, via the same `lcc_mailbox_mirror_error_is_terminal` allowlist), never a
   retry/park. A **destination**-folder-not-found is a real error → bounded retry → alert. Auto-retire for
   cleared rows. Honest counts (moved vs already-there vs genuinely stuck) — never a send-counter.
4. **Close the loop end-to-end.** `staged` → "Intake Staged, Not Completed" (this drainer) → work completes →
   Processed (Flow 6 / the P119 mirror). Confirm the two owners don't collide (P119 ownership rule: intake flow
   owns Inbox→Processed and Inbox→staging; mirror owns staging→Processed). If the intake flow should do the
   Inbox→staging move itself at classification time rather than via this queue, say so and reconcile — one owner.
5. **Verify live:** the 323-row backlog drains into staging (or is correctly retired as already-moved); a fresh
   intake email lands in the right folder with `move_status='moved'`; then completing its To Do moves it to
   Processed. Report the move-delta (rows actually relocated), not the queue-drain count.

## Close-out
- Update `docs/claude-code/STATUS.md`, `closing-the-loop-overview.md`, and the mailbox-mirror runbook; register
  any new flag in `feature_flags_registry`. Note this is the piece that finally makes intake→folder hygiene real.
- Migrations on LCC Opps are live-immediate; a new/edited `api/*` sub-route ships on the Railway redeploy —
  call out the deploy gate explicitly if any runtime code changes.
