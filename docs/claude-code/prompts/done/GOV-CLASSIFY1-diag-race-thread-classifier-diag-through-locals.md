# GOV-CLASSIFY1-diag-race — concurrent sidebar runs overwrite each other's classifier diagnostics

Backlog: `GOV-CLASSIFY1-diag-race`. Source: POSTSHIP-R73 (CC, 2026-09-24). CC measured it during the re-runs.

## Measured

- `_lastClassifierDiag` in `api/_handlers/sidebar-pipeline.js` is a **module-level global**.
- During POSTSHIP-R73, six force re-runs overlapped Scott's save of 910 4th Ave, Asbury Park (`82f261fe…`). Saginaw `6c85fe57…` ended up storing a `_classifier_diag` whose `existingRecord` and `fieldSources` belong to the Asbury Park run (gov 16239).
- The domain decision is unaffected (it uses locals). But the diagnostics also feed `shouldAlertPipelineFailure` (thin no_domain alert suppression) and `domain_mismatch_warning` in the response. So one run can suppress or raise another run's alert, and the stored diagnostics can lie.

## Ask

1. Return the diagnostics from `classifyDomainWithDiag` and thread them through `classifyAndUpdateDomain` → the pipeline summary → `shouldAlertPipelineFailure` / `domain_mismatch_warning`. Remove the global.
2. Grep for any other module-level `_last*` state in `sidebar-pipeline.js` and its `_shared` imports that a request writes and a later step reads. List each; fix it the same way where it's per-run data.
3. **Test** with two interleaved runs (awaited promises with injected delays): each run's stored diag and alert decision must be its own. The mutation that re-introduces the global must turn the test red.
4. **Re-stamp Saginaw.** Re-run `6c85fe57…` once after the deploy, so its stored `_classifier_diag` describes Saginaw itself. It must stay `no_domain` (the twin pair is Scott's call, Q58).

## Done means

- Backlog row updated with the evidence.
- Deploy = redeploy BOTH Railway services.
- Doesn't touch `api/admin.js` merge code (`CONSOLIDATE-REVERSIBLE` runs in parallel). Edit only your own backlog rows.
