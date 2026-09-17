# GUARD-CLOBBER1 — a CI guard that fails any PR which silently deletes STATUS entries or backlog rows (the second clobber, this time by a Claude Code round)

**Filed:** 2026-09-17 (Cowork), from `PROCESS-MERGE-CLOBBER` (its "CI guard open" half) after the
second instance. **Owner:** LCC `test/` + `.github/workflows/test-suite.yml`. **Read first:**
`test/status-header-integrity.test.mjs`, `test/status-line-budget.test.mjs`,
`test/backlog-id-uniqueness.test.mjs` (the three guards this one joins), backlog row
`PROCESS-MERGE-CLOBBER`, `docs/claude-code/README.md` (the loop), `docs/os/BUILD-TURN-PROTOCOL.md` ⑤-CC.

## What happened (measured from git, 2026-09-17)

PR **#2563** (`docs/hcris-timeout-7-verify`, commit `70ae2e82`, a Claude Code session) has parent
`0ca02c77` (= main after Cowork round 25) but committed **whole-file contents of `STATUS.md` and
`PLANNED-BACKLOG.md` taken from `0304aa8b`** (main as of the HCRIS-TIMEOUT-6 merge, seven Cowork rounds
earlier) plus its own two HCRIS row edits and one STATUS entry. Net effect on `main`, with no conflict
and a green CI: **7 STATUS entries deleted** (rounds 19–25 of 2026-09-17), **11 backlog rows deleted**
(`DEPLOY2-stale-body`, `BR4-b`, `DIA-DUP1`, `OWNER-WRITERS1`, `EDGE-GATES1`, `PRI2-on`,
`FLOWS-consolidate-lcc`, `INVENTORY-review-2026-09-17`, `INVENTORY2`, `PROCESS-ROW-CELLS`,
`PROCESS-PARKING-LOT`) and **84 backlog rows reverted** to week-old text (every "→ checklist Qn"
pointer from round 23, every ✅ from rounds 19–25). Verified: `main`'s backlog = `0304aa8b`'s backlog +
exactly the two HCRIS rows. Cowork restored both files in round 26 (PR after this one) by taking
`0ca02c77`'s content and re-applying #2563's real edits.

The first instance (PR #2537, round 8, Cowork's own scripts) was fixed on Cowork's side (3-way
patches since round 17). This instance came from the other direction and **no guard existed to catch
either** — the line-budget test only bounds growth, the header test only checks line 1.

## Build

One test file, `test/doc-clobber-guard.test.mjs`, run by the existing test-suite workflow on every PR
(and runnable locally with `node --test`). It compares the PR head against the **merge base with
`origin/main`** (`git merge-base HEAD origin/main`; in CI use `github.event.pull_request.base.sha`
via an env var, fall back to `origin/main` locally; on `main` itself compare `HEAD~1`). Rules:

1. **STATUS.md entries are append-only.** Every `## ` heading present at the base must be present at
   HEAD, byte-identical — unless the same commit adds or extends a file under `docs/history/` whose
   name starts with `STATUS_claude-code_` (the archive path the line-budget test already documents).
   Report the missing headings.
2. **Open-threads rows are never removed.** Every `| **<thread>** |` row-id in the Open-threads table
   at the base exists at HEAD (text may change).
3. **PLANNED-BACKLOG.md rows are never removed.** Every row id (first cell, the same parser
   `backlog-id-uniqueness` uses) at the base exists at HEAD. Rows may move, merge into a section,
   or change state; a row that must genuinely go is renamed with `~~strike~~` and a reason, not deleted.
4. **Reverted narrative is a failure, not a warning.** For each backlog row present in both, if HEAD's
   Item cell is a strict *prefix* of the base's Item cell (text was cut off the end — the signature of
   an older snapshot, since the loop only ever appends), fail with the row id. Skip rows shorter than
   80 characters.
5. The four existing guards keep running; this one joins the same `node --test` line in
   `test-suite.yml` and in `commit-round<N>.ps1`'s guard step (README step ⑤).

Also add one line to `docs/os/BUILD-TURN-PROTOCOL.md` ⑤-CC and `docs/claude-code/README.md`: *a CC
round edits `STATUS.md` / `PLANNED-BACKLOG.md` only by inserting its own entry and editing its own rows
in the file as it is on `origin/main` at commit time — never from a copy read earlier in the session;
if the branch is behind, rebase first. The doc-clobber guard fails the PR otherwise.*

Test the guard against history: with base `0ca02c77` and head `8eed3576` it must fail with the 7
headings and 11 row ids above; with base `7611e966` and head `0ca02c77` (round 25) it must pass.

## Prohibitions

⛔ No edits to the content of STATUS.md or PLANNED-BACKLOG.md beyond the two protocol lines. ⛔ No new
workflow file — extend `test-suite.yml`. ⛔ Do not touch the other four guards' logic.

## Reporting

The guard's output on the two historical pairs; the workflow diff; one STATUS entry (⑤-CC) and this
row's state. **Parked:** anything noticed out of scope, one line each.
