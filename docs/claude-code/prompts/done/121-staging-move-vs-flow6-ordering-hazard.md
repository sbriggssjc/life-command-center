# Prompt 121 — Close the staging→Processed ordering hazard (Flow 6 vs the mirror race)

**Status:** DRAFT 2026-08-20 (Cowork; now LIVE-reachable — P120's move-queue executor went on today and is
filling the staging folder, so this latent race is no longer theoretical)

Grounding: `api/sync.js` `todo-completion-poll` route (~L2506+) and its `markFiled` (~L2600, flips
`processing_log.outcome staged→filed`, `move_status='moved'`, guarded `outcome=eq.staged`),
`api/_shared/todo-completion.js`, the W7.6 mirror `api/_handlers/mailbox-reconcile.js` (worklist view
`v_lcc_mailbox_reconcile_worklist`, ledger `lcc_mailbox_reconcile_ledger`, gated on
`processing_log.outcome='staged'`), P119 (mirror terminal semantics), P120 (`move-queue-executor.md` §"Known
ordering hazard"). Doctrine: **one owner per folder transition**, and the codebase's recurring **"looks like
success but did nothing"** failure mode.

## The hazard (now reachable, was latent while staging was empty)

Two consumers react to the same event — a staged email's To Do completing — and **both key on the transient
`processing_log.outcome='staged'`:**

- **Flow 6** (`todo-completion-poll` → `markFiled`) flips `outcome staged→filed` and stamps
  `move_status='moved'`. It only **records** — its own comment says "PA already moved the email there." It does
  **not** perform a Graph move.
- **The W7.6 mirror** actually performs the **staging → `Processed/*`** move, and its worklist is gated on
  `outcome='staged'`.

So it's a race on one field. **If Flow 6 wins**, `outcome` becomes `filed`, the mirror's worklist drops the row,
**the message sits in "Intake Staged, Not Completed" forever while the DB reads `filed`/`moved`** — the exact
false-success trap this codebase keeps hitting. If the mirror wins, all is well. Nothing enforces the order.

## The ask

1. **Make the staging→Processed move survive the `outcome` flip — single owner.** Decouple the mirror's
   worklist from the transient `outcome='staged'`. Anchor it instead on a durable "this message entered staging
   and the mirror has not yet moved it" signal (e.g. the mirror **ledger** `lcc_mailbox_reconcile_ledger`, or a
   `move_status`/staging-state column), so a row whose To Do completed and which Flow 6 flipped to `filed` is
   STILL on the mirror's worklist until the mirror records an actual `moved` (or terminal `already_out`). Decide
   and state the one owner of the staging→Processed transition; make the other side purely informational.
2. **Don't let Flow 6 assert a move it didn't make.** `markFiled` stamping `move_status='moved'` is the lie that
   hides the stranded message. Either gate Flow 6 behind the mirror's ack, or have it record disposition without
   claiming the mailbox action — whichever preserves the single-owner rule from (1). Keep the flip idempotent.
3. **Heal anything already stranded.** Now that the executor is live, detect rows that are in staging but read
   `filed`/`moved` with no mirror `moved`/`already_out` ledger entry, and re-enqueue them for the mirror
   (reversible, tagged). Report the count — it should be small today but will grow the moment a staged item's To
   Do completes before this ships.
4. **Verify by state delta, not tallies.** Prove: a staged email whose To Do completes reaches `Processed/*`
   (message actually relocated) even when Flow 6 runs first; the mirror worklist no longer drops
   flipped-but-unmoved rows; 0 messages left in staging reading `filed/moved`. Reuse P119's terminal-success
   classifier — never reinvent it in JS.

## Close-out
- Update `STATUS.md`, `docs/architecture/flows/move-queue-executor.md` (§ordering hazard → resolved),
  `todo-completion-poll.md`, and the mirror runbook. If a new state column/flag is added, register it.
- Migrations on LCC Opps are live-immediate; any `api/*` change ships on the Railway redeploy — call the deploy
  gate out explicitly.
