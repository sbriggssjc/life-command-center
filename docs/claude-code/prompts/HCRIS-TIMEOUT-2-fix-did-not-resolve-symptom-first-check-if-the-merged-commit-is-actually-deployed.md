# HCRIS-TIMEOUT-2 — the merged fix did not resolve the symptom; first confirm the deployed code is actually the merged commit before re-diagnosing

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention. **Direct follow-up to `HCRIS-TIMEOUT`, whose fix was merged 2026-09-14 (PR on branch
`claude/hcris-timeout-fix-01BWJTdN`) but has now been live-verified to NOT have resolved the reported
symptom.** Read this section before re-diagnosing the timeout logic — the first job is to find out whether
the fixed code is even the code that ran.

## 0. What was live-verified after the merge

Scott confirmed the `Dialysis` PR merged, then triggered a fresh CMS ingestion run. That run
(`ingestion_tracker` row `84e215c3-b133-47d8-9854-b55de7463dcb`, `started_at` **2026-09-14 13:35:03 UTC** —
started well after the confirmed merge, not a stale pre-fix run) took **64,732 seconds = 17.98 hours** to
finish, and its `run_log` "CMS ingestion partial" summary reads the **exact same** failure signature as
every pre-fix run: `"Failed steps: hcris_cost_reports, hcris_propagation, run_timeout"`. That's not just
unfixed — it's *longer* than any pre-fix cycle (13.6h and 14.9h were the two immediately before the fix),
the opposite of what a working fix (bounded timeouts, faster batched writes) should produce.
`facility_cost_reports` remains frozen at its pre-existing `updated_at` of **2026-03-16** — now 183 days,
zero rows touched in the 24 hours around and after this run.

## 1. The catalog — in this order, don't skip to (b)

**(a) First: confirm whether the code that ran is actually the merged fix.** Check the actual deployed
commit SHA on the Railway service that runs `run_cms_ingestion` against the merge commit SHA for
`claude/hcris-timeout-fix-01BWJTdN` on `main`. If there's a mismatch — deploy never triggered, deployed a
stale image, wrong service redeployed, etc. — say so plainly and stop there; that's the actual defect this
round, not a residual bug in already-correct code. Do not proceed to re-diagnosing the timeout logic until
this is checked and the answer is reported.

**(b) If the deployed code genuinely is the merged fix, find out why the symptom is unchanged (and worse).**
Re-read the actual `_download_and_extract` and `save_estimates_batch()` code as it exists in the deployed
commit — not from memory of what the previous round's response described — and trace what would actually
happen given this run's real behavior (18 hours, same three-item failure list). Candidates to check, not
assume: did the bounded timeout get wired to the actual `requests` call used in production, or a different
code path; does `save_estimates_batch()` actually get invoked by `hcris_propagation`, or does the module
still call the old per-row `save_estimate()` somewhere; is the "sized per-step timeout override" (1800s)
actually being read/applied at runtime, or defaulting back to something larger. Get the real answer from
the code and, ideally, from whatever logging exists for this specific run, not a repeat of "should now be
fixed."

**(c) Whichever of (a)/(b) is the actual cause, fix it and get real live proof this time — not test-suite
green.** The bar this arc has held throughout: a subsequent live run's `run_log` summary either completes
`hcris_cost_reports`/`hcris_propagation` cleanly, or fails distinctly faster and differently than an
18-hour timeout, and `facility_cost_reports.updated_at` actually advances past 2026-03-16. Trigger or wait
for a real run if at all possible and report the actual result — not a projection of what should happen.

## Out of scope

- Re-litigating the original root-cause analysis from `HCRIS-TIMEOUT`'s first round unless (b) shows it was
  wrong — it may still be correct even though the deployed fix didn't take effect as intended.
- Any other pipeline step, `PRI` arc mechanics, `ownership_linker`, `census_demographics` — all unaffected.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- (a): the actual deployed commit SHA vs. the merge SHA, stated plainly — match or mismatch, not a guess.
- (b) (only if (a) confirms the fix is deployed): the real reason the symptom persisted, quoted from the
  actual deployed code.
- (c): live proof from an actual subsequent run — not "should be fixed now," not test-suite results alone.
