# Branch inventory and prune — 2026-09-14 (Cowork)

> **Why this file exists.** The local checkout had accumulated **620 branches**. Before deleting any of
> them, every branch holding work that exists *nowhere else* was identified and recorded here, with its
> commit SHAs, so that even if a branch is later deleted the work can still be found (`git show <sha>`)
> or recovered from the reflog. Nothing in this prune was decided by name or by age — only by whether
> the content is reachable from `origin/main`.

## Method (reproducible)

```
git branch --merged   origin/main     # content already in main  -> safe to delete
git branch --no-merged origin/main    # unique commits           -> keep, adjudicate
git ls-remote --heads origin <branch> # is it preserved off-machine?
```

## Result

| class | count | action |
|---|---:|---|
| Merged into `origin/main` | **605** | deleted with `git branch -d` (refuses anything unmerged, so the safety is git's, not ours) |
| Unmerged, **also on origin** | 5 | kept locally; safe regardless — origin holds a copy |
| Unmerged, **local-only** | **9** | ⚠️ **kept**; 8 pushed to origin to preserve them. The 9th (`backup/secret-fix-20260415`) is **deliberately NOT pushed** — it contains a live secret and push protection correctly rejected it. |

## ⚠️ The 9 local-only branches — the only copy of this work

Each was verified with `git ls-remote --heads origin <branch>` returning nothing. Pushed to origin so
the work is preserved off this machine before any cleanup touches them.

| branch | commits | date | subject / content |
|---|---|---|---|
| `fix-ownership-ladder-activity-cache` | `2744d11e` | 2026-08-01 | **"operator never shown as true owner; strict property-data activity log; broker docks; SW bump"** — `detail.js` +31/-6, `sw.js`. ⭐ Substantive, and touches the same true-owner question as the OWNERGAP / PDR2 thread. **Adjudicate before deleting.** |
| `claude/cm-gov-monthly-mappers-m2-f0348e` | `e9c13bd0` | 2026-05-07 | capital-markets gov monthly mappers + `cap_rate_by_credit` chart config — `cm-chart-image-renderer.js`, `capital-markets.js`, +119/-21 |
| `claude/cm-round13-step-plot-and-history-padding-f0348e` | `4cdd5b45`, `458d83d0` | 2026-05-11 | CM Round 13 step-plot on TTM plateau charts + history to 2001, **including a migration** `20260606_cm_round13_history_padding.sql` |
| `claude/cm-round6c-fresh-f0348e` | `c11b4ca9` | 2026-05-08 | CM Round 6c floating-label root-cause + 3-point annotations + year-clip, +43/-1 |
| `claude/lease-comps-export-oBnLH` | `e63ab4bc` | 2026-05-11 | regenerated `dialysis-lease-comps-template.xlsx` (4,063 → 10,751 bytes) — **binary, not recoverable by retyping** |
| `docs/buy0-om-sourcing-layer` | `f410bac5` | 2026-09-11 | BUY0 OM sourcing layer for Focused candidates (spec 4.7, gap BUY-G3) + CoStar For-Sale layout note, +21/-2 |
| `docs/consolidate3-headroom-and-table-fix-2026-09-12` | `14e1efa7` | 2026-09-12 | CONSOLIDATE3 items 1+3 — STATUS headroom + table-placement bug, `status-line-budget.test.mjs` +60. **Likely superseded** by the CONSOLIDATE3 that shipped the same day — verify by diff before discarding. |
| `docs/pdr14b-file-to-done` | `5deddd57` | 2026-09-11 | files the PDR14b prompt/response to `done/`. **Likely superseded** — PDR14b is already in `done/`. |
| `backup/secret-fix-20260415` | `a2018394`, `e633072d` | 2026-04-15 | 🚫 **DO NOT PUSH — contains a live secret.** GitHub push protection rejected it: commit `e633072d` carries an **Azure Form Recognizer Key** inside `.tmp_flow_audit/Work - Power Automate Flows/Button-SendanHTTPrequest_.../definition.json`. **Verified the secret has NEVER reached GitHub** — not in `origin/main`, and `merge-base --is-ancestor` confirms `e633072d` is unreachable from it. `.tmp_flow_audit/` is already in `.gitignore` (line 10), so the commit predates that rule. Keep local, never push, and **do not use GitHub's unblock URL**. It survives the prune automatically because it is unmerged and `-d` refuses it. New instance of **SEC3**. |

## Unmerged but already on origin (no action needed)

`claude/bump-appjs-cachebuster`, `claude/cm-round45-pace-and-credit-mappers`,
`claude/sales-loans-dedupe`, `codex/power-automate-route-triage`, `docs/c2g-40-diagnosed-2026-09-12`.

## Second pass — the 8 branches `-d` refused, and why the rule needed correcting

The prune took the checkout from **621 → 24**. `git branch -d` refused 8, in two classes. **Both were
false alarms relative to our actual criterion**, verified individually rather than assumed:

**(a) Six refused against their UPSTREAM, not against main** — `claude/c4a-landlord-gap-sized`,
`claude/p134-note-lead-rule-correction`, `claude/p136-ownership-workbook`,
`docs/doc14-blocked-doc13-answered`, `docs/hp1-badge-prompt`, `docs/own-t0a-reinvestigate`.
`-d` compares a branch to its configured upstream (`origin/<same-name>`), **not** to `origin/main`.
Those upstream refs have diverged, so `-d` refused — but `merge-base --is-ancestor <branch> origin/main`
succeeds for all six and `rev-list --count origin/main..<branch>` is **0**. The content is in `main`.

**(b) Two held by worktrees** — `docs/mb2bc-prompt` and `docs/id2b-reconcile-clean`, also ancestors of
`origin/main` with 0 unique commits. See the hazard below.

### ⚠️ Correction to the rule as first written

The original wording said *"`-d` never `-D`"*. That is too strong, and stating it as absolute was wrong.
The real rule is:

> **A branch is prunable only when its content is provably reachable from `origin/main`.** `-d` is the
> default because it refuses *without* proof. `-D` is acceptable **only after** that reachability is
> proven independently — `merge-base --is-ancestor <branch> origin/main` **and**
> `rev-list --count origin/main..<branch>` returning `0`. A `-d` refusal is a prompt to go get the
> proof, not permission to skip it, and not by itself a reason to keep the branch.

The distinction matters because `-d`'s check answers a *different question* than the one we care about.
Treating its refusal as authoritative would have stranded 8 branches permanently.

### ⚠️ Hazard: worktrees created from the Cowork bridge

Three worktrees were registered at **Linux paths** (`/sessions/<session-id>/…`), created from the bridge
VM — including `.worktrees/cowork-mb2bc`, created during this session while fighting `.git` lock
contention. Those paths **do not exist on Windows** and vanish when the session ends, leaving stale
worktree metadata in `.git` that blocks branch deletion and confuses `git worktree list` afterwards.
**Do not create git worktrees inside the user's repo from the bridge VM.** Clean up with
`git worktree unlock <path>` then `git worktree prune`.
