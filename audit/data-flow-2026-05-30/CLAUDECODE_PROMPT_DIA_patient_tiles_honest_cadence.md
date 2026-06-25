# Claude Code (life-command-center) — reframe the dia patient tiles to the REAL CMS cadence (honest, not stale-implying)

## Why (grounded live on Dialysis_DB `zqzrriwuavgrquhisnoa`, 2026-06-25)

The CMS ingestion is now healthy (hang fixed, `medicare_ingestion` 4.8h→35min,
`patient_counts` batched). The DIAGNOSIS that closed the loop: **`facility_patient_counts`
is a CMS-reporting-period series, and CMS has published nothing newer than
`~2025-03`.** Re-running ingestion correctly adds no rows. So the dia Overview
patient tiles are mislabeled, not under-fed — this round makes them honest. Two
load-bearing facts, both verified independently:

1. **The newest GENUINE CMS period is `2025-03-01`.** The `snapshot_date` values
   after it (`2025-12-31`, `2026-12-31`) are **near-duplicate re-stamps**, not new
   reporting periods: only **25 of 7,502** facilities differ between `2025-03-01`
   and `2026-12-31` (0.3%), and **92** differ between `2026-12-31` and
   `2025-12-31` (~1%). Aggregate patient totals are within 0.3% across all three.
2. **`v_facility_patient_counts_mom` compares each facility's two newest
   `snapshot_date`s** — i.e. `2026-12-31` vs `2025-12-31`, two re-stamp markers.
   So "Top Movers" ranks sub-1% backfill artifacts (≈180 nonzero rows of noise),
   and any "as of" date read from the latest snapshot shows a synthetic
   `2026-12-31`, not the real `~2025-03` publication.

Net: the patient tiles imply a live monthly feed that doesn't exist. The fix is
**honest labeling + a movers surface that only shows real movement** — never
fabricate freshness, never rank re-stamp noise.

## Scope

Client-side dia Overview (`dialysis.js`), plus optionally the `v_facility_patient_counts_mom`
view if the cleanest fix is at the data layer (your call — see Unit 2). The
nightly pipeline DOES refresh clinics/listings/sales; do NOT relabel those as
stale. This is only the **patient-count** tiles (Top Movers + patient-data
freshness/staleness).

## Unit 0 — ground the marker semantics before deciding (read-only)

Confirm what `2025-12-31` / `2026-12-31` are (the backfill's intent): a genuine
annual rollup, or synthetic year-end re-stamps of the `2025-03` monthly pull.
Check the dia ingestion code (`patient_count_ingestor.py` / `ingest_patient_counts`)
for how those dates get written, and confirm against the data (the <1% diffs
above strongly indicate re-stamps). Report which it is — it decides Unit 2.

## Unit 1 — honest "as of" labeling (the core fix)

Wherever the dia Overview shows patient-data freshness / "last updated" / a
">60d stale patient data" style indicator:
- Derive the **as-of date from the latest GENUINE CMS reporting period**, not from
  `created_at` and not from a synthetic year-end marker. Label it plainly, e.g.
  "CMS patient data as of <period>" (it will read ~`2025-03`). The CMS dataset is
  published periodically (roughly annually), NOT nightly.
- **Decouple patient-data freshness from the nightly-ingestion timestamp.** The
  "ingestion hasn't run since …" / ">60d stale" framing conflates the nightly
  clinic/listing/sales refresh (current) with the periodic patient series
  (as-current-as-CMS-publishes). Remove or rescope the patient-staleness alarm so
  it measures against CMS's real publication cadence — an annual dataset being
  >60 days old is normal, not an alert.

## Unit 2 — make "Top Movers" show only REAL movement (no re-stamp noise)

The tile must never rank backfill artifacts. Pick the cleaner of:

- **(a) Data-layer (preferred if Unit 0 confirms the year markers are re-stamps):**
  fix `v_facility_patient_counts_mom` to compare the two newest **genuine** CMS
  periods — exclude the synthetic year-end re-stamp markers (e.g. restrict to real
  monthly `snapshot_date`s, or to distinct published periods). Then the view
  yields real period-over-period deltas (today that's an older `2025-03` vs prior,
  honestly labeled with the as-of date), and it **auto-lights-up** when a genuinely
  new CMS period lands. Apply as a migration to `zqzrriwuavgrquhisnoa`.
- **(b) Tile-layer:** if you'd rather not touch the view, gate the tile in
  `dialysis.js`: when there is no new genuine period to compare (the current
  state), render an honest empty-state — "No new CMS reporting period since
  <as-of date> — patient volumes unchanged" — instead of a blank tile or a list
  of sub-1% noise. Surface real movers only when a real period delta exists.

Either way: a "mover" must reflect a real change between real CMS periods, the
tile is honestly labeled with the as-of period, and it comes alive automatically
when CMS publishes new data (no code change needed then).

## Boundaries / verify

- life-command-center; feature branch per CLAUDE.md; `node --check` on touched JS;
  if you change the view, it's a dia-DB migration (additive/reversible) — keep the
  column shape so `dialysis.js` consumers don't break.
- No fabricated freshness, no synthetic snapshot, no ranking of <1% re-stamp
  deltas. Don't touch the clinic/listing/sales freshness (those are genuinely
  nightly).
- Live proof on the dia Overview: the patient-data tile reads "as of ~2025-03"
  (the real period), the ">60d stale patient" alarm no longer fires against the
  periodic dataset, and "Top Movers" shows either real period-over-period movers
  or an honest "no new CMS period" empty-state — not a noise list.

## Documentation

Update life-command-center CLAUDE.md (dia Overview / CMS note): `facility_patient_counts`
is a CMS-reporting-period series (newest real period ~2025-03; later year-end
`snapshot_date`s are re-stamps); patient-data freshness is labeled by the real CMS
period and decoupled from nightly-ingestion timestamps; Top Movers ranks only real
period-over-period movement and auto-populates when CMS publishes a new period.

## Bottom line

The ingestion is correct and there is no new CMS patient data — so stop implying a
stale nightly feed. Label patient data by its real CMS period (~2025-03), drop the
mismatched >60d staleness alarm, and make Top Movers show real movement (or an
honest empty-state) instead of ranking <1% backfill re-stamp noise. It lights up
on its own when CMS next publishes.
