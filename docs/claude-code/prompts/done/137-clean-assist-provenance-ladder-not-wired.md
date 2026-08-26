# Prompt 137 — clean-assist `provenance_conflict` punts: `current_priority` is never populated

## Finding (Cowork re-grade + root-cause, 2026-08-26)
P134 shipped and the `OLLAMA_CLEAN_ASSIST` re-grade PASSED overall (8/14 grounded, sf_link excellent incl.
a `merge@0.99`, property_merge noise gone via the evidence gate). **But all 4 `provenance_conflict`
proposals still punt** with "the evidence does not specify which source is more authoritative" — the exact
symptom P134 was meant to cure.

Root cause: the enrichment's **consumer** side is correct but the **producer** side is missing.
`api/_shared/clean-assist-context.js::assessProvenanceConflict` computes
`ladder_says = laddersSay(c.attempted_priority, c.current_priority)` and reads `c.priority_ladder` — but
**nothing in `api/admin.js` ever populates `current_priority` or `priority_ladder`** on the item. The lane
reads `v_field_provenance_conflict_classified`, which carries `attempted_priority` but **has no
`current_priority` column** and no ladder. So `c.current_priority` is always undefined →
`laddersSay(ap, null)` → `unregistered_source_no_ladder_answer` → the model correctly refuses to guess.

The join P134's writeup described ("resolves the current source's rung on field_source_priority, 454/454")
was never wired into the data path.

## Measured — the join works and is worth doing
Joining `field_source_priority` on `(target_table, field_name, source = current_source)` over the 454
cross-source conflicts:

- **454 / 454** resolve a `current_priority` (0 unresolved — every current source is registered).
- **433** are ladder-**decidable** (`current_priority <> attempted_priority` → the ladder names a winner).
- **21** are genuine ties (equal priority → correctly stays `uncertain`).

So wiring this turns ~95% of the provenance lane from "punt" into a grounded keep_current/accept_attempted
recommendation, and the remaining 21 correctly abstain.

## Fix (two parts — the P134 "diff the view's columns against the handler's select" lesson)
1. **Add the columns to the source view** `v_field_provenance_conflict_classified` (append at END per the
   `CREATE OR REPLACE VIEW` column-append rule):
   - `current_priority` — `LEFT JOIN field_source_priority fsp ON fsp.target_table = v.target_table AND
     fsp.field_name = v.field_name AND fsp.source = v.current_source` → `fsp.priority`.
   - `priority_ladder` — a JSON array of `{source, priority}` for that `(target_table, field_name)`,
     ordered by priority asc, so the model sees the whole ladder (LOWER priority = HIGHER trust). Aggregate
     from `field_source_priority` for the field.
   Keep `attempted_priority` as-is. (Mirror on gov/dia only if those projects host the same view; this lane
   is cross-source on LCC Opps.)
2. **Add both columns to the handler's `select=`** for the provenance lane in `api/admin.js` (the
   `listFederatedLane('provenance_conflict', …)` / Overview `v_field_provenance_conflict_classified` pull),
   so `current_priority` and `priority_ladder` actually reach `assessProvenanceConflict`. This is the exact
   gap the P134 note warned about — "diff the view's columns against the handler's select."

No change needed in `clean-assist-context.js` — it already reads both fields and states the rule
(`ladder_says` + "LOWER priority number = HIGHER trust"). Confirm `laddersSay` returns a decisive token
(attempted-wins / current-wins) when priorities differ, and `equal_priority_ladder_cannot_decide` on a tie.

## Verify
- After deploy, re-run `POST /api/ollama-clean-assist-tick?limit=20` and grade: `provenance_conflict`
  proposals should now carry `keep_current` / `accept_attempted` verdicts that CITE the ladder
  (`ladder_says` = current-wins/attempted-wins), with `uncertain` only on the ~21 genuine ties.
- Assert the join resolves: a quick check that `current_priority` is non-null for cross-source rows
  (measured 454/454 today).
- Still annotation-only; verdicts remain human-confirmed.

## Deploy
Additive view migration FIRST (LCC Opps), then the JS `select=` change on the Railway redeploy (schema
before writer/reader). Commit with the repo trailer. Small, self-contained — closes the last
production-health follow-up before the R8 net-new build.
