# `docs/claude-code/` — the work queue between Cowork and Claude Code

This folder is the **async loop** between the LCC design chats (Cowork: measures, decides, documents) and
**Claude Code** (repo + Supabase + deploy access: builds). Cowork drafts prompts here; Scott runs them in
Claude Code and saves the reply here; the next Cowork turn reconciles the reply against **live state**,
updates the canonical docs, and drafts what comes next. Rewritten 2026-09-16 to match how the loop
actually runs; the previous `NN-slug` / `.response.md` conventions are retired.

## Folders

| path | what lives there | who writes |
|---|---|---|
| `prompts/` | **open** prompts, one Markdown file each, `<ID>-<slug>.md` (`GOVDEED5b-…`, `HOME1-…`). Self-contained: read-first list, measured facts, what to build, prohibitions, reporting. | Cowork |
| `prompts/done/` | prompts whose response has been reconciled | Cowork moves |
| `responses/` | Claude Code's reply, saved by Scott as `<ID> desktop response.docx` (gitignored — the reconciliation is the durable record) | Scott |
| `responses/done/` | reconciled responses (plain move, gitignored) | Cowork moves |
| `SB notes/` | Scott's in-app observations (docx with screenshots, forwarded `.eml`, anything). `README.md` there is the intake protocol; `TRIAGE.md` is the ledger (`SBN-n`). Processed files go to `SB notes/done/` (`.docx` is gitignored; `.eml`/images are tracked). | Scott drops; Cowork triages |
| `OPERATOR-CHECKLIST.md` | the one list of manual steps only Scott can do (edge-function deploys, Power Automate edits, hand-fetched payloads). Cowork adds; Scott ticks; Cowork verifies and removes. | Cowork |
| `STATUS.md` | the running narrative, newest-first, with the Open-threads table at the top. Line-budgeted (3,000) and header-guarded by `test/status-*.test.mjs`; archive verbatim to `docs/history/` before you push. | Cowork |

The **canonical open-work list is `docs/os/PLANNED-BACKLOG.md`**, not this folder: every prompt has a
backlog row carrying its id, the decision, the numbers, and the options not chosen. `STATUS.md` is the
story; the backlog is the state; `docs/os/CURRENT-STATE.md` is the one-page "where are we".

## Every Cowork turn that touches LCC

1. `git fetch`; note `origin/main`'s head and any PR merged since the last entry.
2. **Check `responses/`** for files not in `done/`. Read each in full (`pandoc … -t plain`).
3. **Check `SB notes/`** for files not in `done/`. Triage per `SB notes/README.md` → `TRIAGE.md` rows.
4. **Reconcile each response against live state, not against its own summary**: run the numbers on the
   database the round touched (`pg_proc`, `cron.job`, counts). Two rounds on 2026-09-16 reported true
   after-states that a cron undid within twenty minutes; the reconciliation caught it, the summary
   could not. Record deviations from the prompt (narrower / wider / skipped) as findings.
   When checking whether a past prompt "left a trace", look in `supabase/migrations/`, `test/`, `api/`,
   `docs/claude-code/responses/` and `docs/os/CURRENT-STATE.md` as well as the docs — INVENTORY1's
   "132 untraced prompts" was a search over four directories; 30 of 30 sampled had shipped.
5. **Update in the same change**: the backlog row (status + measured outcome), `STATUS.md` (one
   entry, Open-threads row), `CURRENT-STATE.md` when a subsystem's state changed, `CLAUDE.md` when a
   doctrine was earned, the topic page when its topic moved. Move the prompt and response to `done/`.
6. **Draft what the response exposed**: a follow-up prompt for anything skipped or newly found; a
   handoff prompt when the fix belongs to another repo (`government-lease`, `DialysisProject`) —
   handoffs say so in their header and nothing in them is applied from here.
7. Run the doc guards (`test/status-header-integrity`, `status-line-budget`, `backlog-id-uniqueness`,
   `backlog-table-shape`) before committing. Branch → PR → CI → merge; never push to `main`.

## Rules that do not bend

- **Never fabricate a response.** Act only on what Scott actually saved in `responses/`.
- **Never reword Scott's observation** in `SB notes/` into something easier to fix.
- **Every number in a prompt is measured**, with the query or file:line beside it. "Expected" numbers
  are labelled as expectations and the round is told to measure, not predict.
- **Prompts name their owner.** Engine/DB objects belong to the repo that owns the database
  (`CLAUDE.md` → "One repo owns each database's objects"); a prompt for another repo is a handoff.
- **A round that says "applied live" is re-measured here before its row turns green.**
