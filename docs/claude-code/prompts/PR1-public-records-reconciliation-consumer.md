# PR1 — the public-records lane has never written a field. Build its consumer.

**Repos:** LCC (`life-command-center`) for the reconciliation path; DBs **Dialysis_DB
`zqzrriwuavgrquhisnoa`**, **Government `scknotsqkcheojiaewwh`**, **LCC Opps `xengecqvemvfknjvbvrq`**.

**Read first:** `docs/architecture/public-records-source-lane.md` (canonical), then
`docs/architecture/data_quality_self_learning_loop.md` for the ladder mechanics.

## The finding

Scott's framing, and it is the design requirement: *assessor/public-record data is an independent
source carrying physical stats, ownership, ownership history and sales. It is its own lane that
populates **all** properties, which later code evaluates per field to find the most accurate
representation.*

**That lane is already built and has never written one field.**

| fact | measured 2026-09-01 |
|---|---|
| `county_records` on the authority ladder | **priority 5, 93 field rungs, BOTH domains** |
| `county_records` rows in `field_provenance` | **0. Ever.** |
| positive control (`recorded_deed`) | 2,681 rows / 371 writes — the detector fires |
| `property_public_records` | **23,728 rows / 9,166 properties = 78% of dia's 11,802** |
| `tax_records` / `parcel_records` / `deed_records` | 25,621 / 1,604 / 178 |
| producer | **live — fetched 2026-08-31** |
| `dia.properties.year_built` provenance | 3,586 rows, **only source = `salesforce`@20** |

The registered rungs already cover `dia.properties.year_built / building_size / land_area / lot_sf /
zoning / assessed_value / parcel_number / recorded_owner_id / recorded_owner_name`,
`dia.ownership_history.*`, `dia.sales_transactions.*`, and the full gov mirror.

## What is being asked

**Build the reconciliation consumer. Nothing else.** No new acquisition, no new schema, no new
ladder entry — read `parcel_records` / `tax_records` (joined to properties through
`property_public_records`) and put each field through **`lcc_merge_field`** against the rungs that
are already registered.

### Scope and guardrails

- ⚠️ **Populate ALL properties, never a queue's gap list.** The immediate population is the **9,166
  linked properties**, not the 662-row `property_metadata_backfill_queue`. **Do not gate on listing
  status, sale status, or prior ingestion** — scoping this source to one consumer's gaps is the
  error this prompt exists to correct.
- ⚠️ **I12 — acres vs square feet.** `parcel_records.lot_sf` is square feet; `dia.properties` holds
  **both `land_area` (acres) and `lot_sf`**. Measured: 3,702 paired rows, **0 equal**, ratio exactly
  **43,560 ±1 on 91.1%**, with **27 genuine disagreements (0.8%)**. **Write one and derive the
  other** — never populate whichever the source happened to express — and **fill-blanks only**, never
  overwriting a populated value.
- **Priority-gated, per the existing ladder.** `county_records`@5 may legitimately supersede
  `om_extraction`(30–50) and the sidebars(45–60); it must **not** overwrite `manual_edit`@1,
  `manual_resolution`@1 or `recorded_deed`@3. `lcc_merge_field` already owns that decision — call it,
  do not re-implement the comparison.
- **Dry-run first and report the WRITE / SKIP / CONFLICT split before applying.** A run that is all
  writes means the gate is not engaging; a run that is all skips means the source is adding nothing.
  Both are findings.
- **Never fabricate.** These tables carry `raw_payload` and `data_hash` — a field the record does not
  state stays blank. ⚠️ The retired `assessor_enrichment.py` had **no county HTTP call at all** and
  asked gpt-4o to recall parcel facts; **no model may author a value in this lane.**
- **Reversible and batch-tagged**, per standing doctrine.

### Report back

1. The dry-run write/skip/conflict split **per field and per domain**.
2. **Where `county_records`@5 would supersede a lower-authority value, and how often** — especially
   `year_built`, which today fills from `salesforce`@20 alone. Name a few rows with both values.
3. Whether gov's mirror behaves the same or differs (it has its own `parcel_records` /
   `tax_records`; gov `properties` uses `rba` / `land_acres`, not `building_size` / `land_area`).
4. Anything the sweep turns up that outranks the task.

## Verification

**Assert on `field_provenance where source='county_records'` going non-zero, and on the write/skip/
conflict split — never on rows fetched or on the producer being green.** That distinction is the
entire point: the tables have been filling for months while the ladder recorded nothing.

Also report the delta in `dia.properties` non-null counts for the affected fields, and confirm
**0 rows** where `land_area` and `lot_sf` disagree beyond the 27 known.

## Related, deliberately NOT in scope

- **PR2** — why the same live producer returns tax rows for 9,107 properties and parcel stats for
  **41**. That is a fetcher question and it is separate; **do not bundle it**, or it will be
  impossible to tell which change moved which number.
- **PR3** — `property_public_records.confidence` is the constant 1.000 on all 23,728 rows and
  `verified` is false on every one. ⚠️ **Do not rank on that column until PR3 decides it** — a
  constant is not a signal.
- **PR5** — 39 of 67 registered ladder sources have never written a field. PR1 is the largest and
  best-evidenced one; the triage of the rest is its own pass.
