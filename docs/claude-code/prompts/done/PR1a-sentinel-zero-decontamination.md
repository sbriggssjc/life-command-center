# PR1a/PR1b — the model leg's no-data sentinel is sitting in curated columns as a measurement

**Repo:** `Dialysis`. **DB:** Dialysis_DB `zqzrriwuavgrquhisnoa` (check gov
`scknotsqkcheojiaewwh` for the mirror before assuming it is dia-only).

**Read first:** `docs/architecture/public-records-source-lane.md` §2a in `life-command-center`
(canonical). PR1 established the mechanism; this prompt cleans up what it left in the data.

## The finding

`public_record_ingest.py` has no county fetch — it asks gpt-4o — and **it does not fabricate
plausible numbers. It emits almost nothing, as zeros.** Those zeros then propagate into curated
columns, where a `0` is a **positive assertion** ("assessed at $0", "tax of $0") that reads as
measured. A NULL would have been honest.

Verified live 2026-09-01:

| curated column | zeros | positives |
|---|---:|---:|
| `dia.properties.assessed_value` | **8,700** | 262 — and those 262 are exactly the CoStar-traced rows |
| `dia.properties.tax_amount` | **9,025** | **1** |
| `dia.properties.tax_delinquent` | **`false` on 11,802 of 11,802** | — |

Two writers put the numbers there, neither recording provenance:
`src/sync_properties_from_sources.py` (tax fields, latest `tax_year`) and
`trg_parcel_propagate_to_property` (physical stats, fill-blanks).
⚠️ **Physical-stats damage is negligible — 2 / 3 / 1 properties. The tax and assessed damage is
~8,800.** Scope accordingly; do not treat this as a whole-table rewrite.

## Unit 1 (PR1b) — `tax_delinquent`, first, because it is the worst

`write_tax_record` had `bool(data.get("is_delinquent"))`, and **`bool(None) is False`** — so *"the
source did not say"* was recorded as *"this property is not tax-delinquent"*, **on every property in
the portfolio**. The writer is already fixed tri-state. **The 11,802 existing rows are not.**

- ⚠️ **This field can reach a BOV or an OM. A false "not delinquent" is materially worse than a
  blank** — it is a negative *finding* asserted at 100% coverage that was never once measured.
- **Backfill to NULL wherever the assertion traces to the model leg.**
- ⚠️ **Positive-control that a genuine `false` from a real source survives the backfill.** If the
  answer is "there are none", say so explicitly — that is a finding about coverage, not a reason to
  skip the control.

## Unit 2 (PR1a) — the sentinel zeros

- **Null the sentinel-sourced values** in `dia.properties.assessed_value` and `tax_amount` where the
  value traces to the model leg. Reversible, batch-tagged, provenance-recorded.
- ⚠️ **Read `traced_value_is_zero` on `v_dia_curated_field_ai_provenance`, never the row count** —
  the count includes `tax_year`, which carries real years (2025/26) and is **not** contaminated.
- **Stop both writers from propagating a `0` as a fact.** A source that returns nothing must write
  NULL, not zero. ⚠️ **Fix the writers in the same change** — a one-shot cleanup of a live producer
  is a chore repeated silently forever (Class 8), and this producer runs daily.
- ⚠️ **Do not touch the 262 positive `assessed_value` rows** — they are CoStar-traced and real.
  Verify that separation holds before writing; if any positive value traces to the model leg, stop
  and report rather than deciding it.

## Guardrails

- **A `0` and a NULL are different claims.** The whole defect is treating "no data" as a measured
  value; do not re-introduce it in the fix by defaulting anything.
- **Never fabricate a replacement.** These rows go to NULL, not to an estimate, not to a model call.
- **Reversible + batch-tagged**, per standing doctrine, with the reversal **run once** before the
  batch (a reversal path that has never executed is a claim, not a capability).
- ⚠️ **Check gov for the same shape before declaring this dia-only.** gov `parcel_records` is
  **11,529 rows of which 9,264 are exactly `0.00`** — the same sentinel, and whether it has reached
  gov's curated columns is unmeasured.

## Verification

**Assert on the state delta**: zeros in each curated column before/after, positives unchanged at
262 / 1, `tax_delinquent` NULL count moving off 0, and **the writers no longer emitting a 0 on the
next producer run** — that last one is what distinguishes a fixed producer from a one-shot backfill.

⚠️ **Do NOT verify via `field_provenance` source names** until **PR8** is resolved:
`lcc_flush_provenance_events()` relabels any source off its 4-item allowlist to `domain_trigger`, so
a source-name assertion can read zero on a perfectly correct write.

## Report back

The per-column before/after, the gov answer (same shape or not), whether any positive value traced
to the model leg, and anything the sweep turns up that outranks the task.
