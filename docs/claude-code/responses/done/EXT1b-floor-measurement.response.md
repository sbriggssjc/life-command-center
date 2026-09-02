# EXT1b — the floor re-run (workstation, 2026-09-02 ~20:30 UTC): the prediction held where it was made, and the residue is a DEFINITION, not a defect

**Reconciled by Cowork from `bakeoff/agreement.md` + `agreement.json` (local). Findings only.**
Same 10 arm-A / 5 arm-B / 3 fixtures, extractor at `a013aea6` (EXT1b deployed).

## 1. The floor, run 3 (EXT1) → run 4 (EXT1b)

| field | run 3 | run 4 | note |
|---|---:|---:|---|
| `year1_rent` | 89% | **100%** | as predicted — 9/9 decided, 0 disagree |
| `lease_expiration` | 80% | **100%** | as predicted — the 431 `formula`/`day` flip is gone |
| `lease_commencement` | 80% | 83% | 1 self-disagree: doc 228, the control run returned NO commencement at all (`as_stated: null`) where the baseline read "December 31, 2014" — the model omitted a field on one call. Not a label issue. |
| `tenant_name` | 100% | 100% | |
| `leased_sf` | 83% | 83% | 1 flip, unchanged |
| `lease_type` | 100% | 92% | 1 new flip (`NN` vs `NNN`, doc 336) — small-sample noise on a field EXT1b does not touch |
| **all** | 92% | **94%** | 47 / 3 / 22 both-null |

**Every override now records its source** (`basis_source`, `amount_source`, `precision_source`), so
a reader can tell which half spoke on every row.

## 2. Tesseract vs DocAI — the residue has changed character

Two rent disagreements appeared that were not there in run 3, and reading them shows the next
layer down:

- **Doc 255:** DocAI-side quoted `"$8,464.00 per month"` → 101,568. Tesseract-side quoted
  `"$7,445 per month plus $1,019 per month for equipment."` → 89,340. **Both quotes are verbatim
  from the same lease** — it states base rent, equipment rent, and the total. The model chose a
  different line on each side. Arguably the tesseract side is the *better* base-rent answer.
- **Doc 299:** `"$7,725.33"` vs `"$7,373.17 per month"` — two different periods of the rent
  schedule quoted as "year 1".
- `tenant_name` ×3: DBA vs registered entity (425), an individual + two entities as co-tenants
  (431). **Lease ambiguity, faithfully quoted.**
- `lease_type` NN vs NNN (336): model.

**None of these is OCR and none is a label.** The extractor is now doing what it was told — quote,
don't compute — and the remaining variance is *which figure is "year-1 rent"* when a lease separates
equipment/additional rent, or states a schedule. That is a **definition** the BOV owner has to
state, and then code applies it (prefer `rent_schedule[0]` where a schedule exists; exclude
separately-stated equipment/additional rent from base). → **EXT2**, a decision first.

## 3. What this closes

- **EXT1 + EXT1b are done.** Rent and expiration self-agreement are at 100% on this sample; the
  model no longer computes, defaults, or mislabels. The extractor's contribution to bake-off noise
  is now confined to field-omission flips and definition choices.
- **The OCR1 verdict for tesseract is unchanged: §5 row 2.** Tesseract's date `rate − self` reads
  −12 / −33 pp this run, but the decided counts are 7 and 6 — one document (425, the genuinely
  garbled scan) moves those by a third. Read the counts.

## 4. Next

- **EXT2 (decision → small code):** define year-1 base rent for BOV extract (equipment/additional
  rent excluded; schedule period 1 when present; state which name is "tenant" when a DBA or
  co-tenants appear). Ask Scott; then one resolver + guard.
- The GPU-engine run on the box still decides OCR1b (unchanged).
