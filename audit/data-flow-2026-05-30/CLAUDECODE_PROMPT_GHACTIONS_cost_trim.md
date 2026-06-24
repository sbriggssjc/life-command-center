# Claude Code — GitHub Actions minute trim (account at 90% of included minutes)

## Why (GitHub billing email 2026-06-23: 90% of Actions minutes used, sbriggssjc account)
Account-level Actions minutes are nearly exhausted. Grounded across all repos:
- **Ingestion is already off GitHub** — CMS + public-record daily ingests are `workflow_dispatch`-
  only; their schedule runs on a **Railway cron service**. Not the drain. (Leave them.)
- **life-command-center has NO per-push CI** — only 4 daily check workflows. Not a big drain, but
  trimmable.
- **The actual GH-minute consumers:** (1) **DialysisProject `ci.yml`** runs on BOTH `push` AND
  `pull_request` to `main`/`develop` → ~2 full runs per merged change, no concurrency cancel;
  (2) the **4 life-command-center daily check workflows** (4 separate runner startups/day); (3) the
  **60-minute manual ingestion runs** (CMS/public-record fallback) — the biggest spikes, especially
  when a CMS run hangs to the 60-min timeout (the Railway cron has been hanging since May 13). #3 is
  fixed by merging the hang-guard (DialysisProject PR #7319, fails in ≤15 min) + restoring the
  Railway cron — **out of scope here** (referenced, not rebuilt). This prompt does the two
  structural CI/workflow trims.

All workflow-config only; no app code, no migration; reversible.

## Unit 1 — DialysisProject `ci.yml`: skip needless runs
`.github/workflows/ci.yml` currently:
```
on:
  push:        { branches: [main, develop] }
  pull_request:{ branches: [main, develop] }
```
- **Add `paths-ignore`** to BOTH triggers so docs/audit-only changes don't run the full suite:
  `paths-ignore: ['**/*.md', 'docs/**', 'audit/**', '**/*.txt']` (keep it conservative — only docs).
- **Add concurrency cancel-in-progress** so a newer push/PR-sync cancels the superseded run:
  ```
  concurrency:
    group: ci-${{ github.ref }}
    cancel-in-progress: true
  ```
- **De-duplicate push vs PR:** a change merged via PR is CI'd once as the PR, then AGAIN on the
  push to main — double cost. Prefer dropping `push` to just `pull_request` (+ keep `push` to
  `main` only if a required post-merge gate is needed). If `push` must stay, the concurrency group
  above at least cancels rapid successive pushes.
- **⚠️ Branch-protection caveat:** if CI is a **required status check** for merging, a
  `paths-ignore`-skipped run reports no status and can BLOCK the merge. Check repo Settings →
  Branches. If required, either (a) keep CI required but add a tiny always-runs companion job that
  no-ops on doc-only paths and reports success, or (b) make CI non-required and rely on the PR run.
  Document which you chose.

## Unit 2 — life-command-center: consolidate the 4 daily checks into 1 workflow
Four separate daily workflows each spin their own runner (checkout + setup + run):
`address-normalize-drift-check.yml` (13:00), `field-source-priority-schema-check.yml` (13:15),
`cron-heartbeat-check.yml` (13:30), `supabase-advisor-check.yml` (14:00).
- Merge into ONE `daily-db-checks.yml` on a single daily cron (e.g. `0 13 * * *`) with the four
  checks as **sequential steps in one job**, each `if: always()` so a failure in one doesn't skip
  the rest. **Preserve each check's existing GitHub-issue alerting** (the open/close-issue logic
  per check) — that's the reason they're on GH, don't lose it. One runner startup instead of four.
- Keep each check's `workflow_dispatch` ability (a single dispatch that can run all, or keep
  per-check dispatch via inputs — optional).
- Retire the 4 original workflow files (or leave them `workflow_dispatch:`-only as manual escape
  hatches with the `schedule:` removed, so only the consolidated one is scheduled — pick one,
  document it). Net: 4 scheduled runner-startups/day → 1.

## Boundaries / verify
- `.github/workflows/*.yml` only (DialysisProject + life-command-center); no app code; no
  migration; reversible. Don't touch the Railway-backed ingestion workflows (CMS/public-record
  stay `workflow_dispatch`-only).
- Verify: `ci.yml` skips on a docs-only PR (and still runs on a code PR); concurrency cancels a
  superseded run; the consolidated `daily-db-checks.yml` runs all four checks in one job and still
  opens/closes the same GitHub issues on failure/recovery; the 4 old schedules no longer fire.
- YAML lint clean; each repo's normal (non-doc) CI still runs.

## Out of scope (the bigger ingestion-minute lever — reference only)
The 60-min manual ingestion runs are the largest spikes. Fix separately by: merging the CMS
hang-guard (DialysisProject PR #7319) so a stalled run fails in ≤15 min not 60, and restoring the
Railway CMS cron so the GH fallback isn't needed. Not part of this config trim.

## Bottom line
Stop paying for CI on doc-only changes and superseded runs, and collapse 4 daily runner startups
into 1 — the two structural GH-minute trims. The ingestion spikes are handled by the hang-guard +
Railway cron (separate). Ingestion is already correctly off GitHub.
