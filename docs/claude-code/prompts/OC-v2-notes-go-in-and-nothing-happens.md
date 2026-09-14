# OC-v2 — The operator funnel accepts notes and nothing processes them

**Repo: `life-command-center`.** Small, and it finishes one of the three things Scott actually asked for
back at the start of P18: *"a great way for me to email or chat with and include notes on ideas or bugs
or errors or other things I notice… Large funnel that sorts to the same one to-do list."*

**Read first:** `docs/os/PLANNED-BACKLOG.md` **OC-v, OC2, OC4** ·
`docs/architecture/EXEC-BRIEFS-SPEC.md` **§6** · `api/_handlers/operator-triage-tick.js` ·
the `OPERATOR_NOTE_TRIAGE` references in `feature_flags_registry` usage.

## What is actually true right now (Cowork, measured live 2026-09-14)

OC-v's blocker #1 is **resolved** — the standalone MCP redeploy happened. `log_operator_note` and
`get_operator_inbox` are both live and answer. The funnel's intake half works end to end.

**But nothing consumes the queue:**

| check | live value |
|---|---|
| `operator_notes` rows | **1** |
| that note's age | filed 2026-09-12, still there 2026-09-14 |
| `disposition` / `note_type` / `routed_to` | `open` / **null** / **null** |
| `OPERATOR_NOTE_TRIAGE` row in `feature_flags_registry` | **does not exist** (0 rows) |
| triage cron in `cron.job` | **none** |

So a note goes in, and **nothing happens to it, ever**. The flag cannot even be switched on, because the
registry row was never created — OC2 shipped the handler and the flag was never registered.

⚠️ **This is worse than not having the funnel.** Scott was told the funnel is live, so a note filed
there looks captured. It is captured — and then silently ignored. An intake with no consumer is the
same failure class as a dead feed that reports healthy: the surface says "received", the system does
nothing, and nobody finds out until someone goes looking. Treat that as the defect, not the missing
cron.

## What to do

1. **Register the flag properly, in a migration** (`feature_flags_registry` row for
   `OPERATOR_NOTE_TRIAGE`, default OFF, with `purpose`/`surface`/`env_var`/`owner` filled like its
   neighbours). Do not hand-insert it live — the repo owns LCC Opps objects.
2. **Schedule the triage tick** via `cron.schedule` + the repo's `lcc_cron_post()` pattern, on a free
   minute (check `cron.job` first — 06:xx and 10:xx are crowded). Unschedule-then-reschedule so it is
   idempotent, and carry a reversal runbook like the MB2a/FEED2 migrations do.
3. **Run it once against the one real note and report what it did** — `note_type`, `lane`, `severity`,
   `routed_to`, `disposition`. That note is deliberately a throwaway ("safe to resolve or delete"), so
   it is a free live test.
4. **Then flip the flag only if the classification is honest.** Prior sessions recorded triage
   returning `unclassified`, which is the CORRECT behaviour for an unclear note — do not tune the
   rules to manufacture a confident label. Per the standing rule: render "Not on file" / "Derived" /
   "Conflict", never a guess.
5. **Close the loop with a visible count.** Per **OC4** and I11's lesson: if the queue has open notes
   older than N days, that must surface somewhere Scott sees — otherwise this silently regresses to
   exactly today's state. The `market_brief_feed_no_contribution` monitor MB2e just shipped is the
   pattern to copy: a distinct, named alert for "intake works, nothing consumed it".

## What NOT to do

Don't build a new UI. Don't touch the market-brief producers, feeds, or `MARKET_BRIEF_PRSS`. Don't
delete the test note — resolve it through the normal disposition path so the path itself gets
exercised. Don't turn the flag on before step 3's output has been read.

## Ship + record

Deploy note: this is Railway + DB, **not** an edge function — per the standing rule, redeploy **both**
Railway services (`tranquil-delight` and the standalone MCP) and confirm `/version` moved before
claiming it is live. Merged is not running; that lesson has now cost this program three separate rounds.
Update `docs/os/PLANNED-BACKLOG.md` (**OC-v**, **OC2**, **OC4**) and `STATUS.md` (≤12 lines). Report the
triage output table for the real note — that is the deliverable, not the diff.
