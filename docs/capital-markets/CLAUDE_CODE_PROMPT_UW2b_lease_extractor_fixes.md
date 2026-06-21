# Claude Code prompt — UW#2b: lease-extractor fixes from the first live drain audit

> The first capped lease drain (3 docs, `POST /api/lease-backfill?limit=25`, 2026-06-21) ran clean
> and SAFE — 0 clobbers, all 19 conflicts correctly surfaced to review, guarantor/TI edges formed.
> The audit (live DB) surfaced two real issues to fix before the broad drain plus one minor cleanup.
> These make the remaining ~295 docs produce CORRECT values and a MATERIAL-ONLY review queue.
> Receipts-first; reuse the existing extractor + conflict path; fill-blanks + the four guards stay
> exactly as they are — this only fixes value-normalization and conflict-noise.

## Grounded receipts from the drain (real conflict rows, dia DaVita Tallahassee + gov GSA 8112)
- **Unit bug:** extractor wrote `rent_per_sf=1.81` while `annual_rent=141180`, area 6500. 141180 ÷
  6500 ≈ $21.72/yr, and 1.81 × 12 × 6500 ≈ 141180 → **the extractor put MONTHLY $/SF into the annual
  rent_per_sf field.** The curated coherent values (annual_rent 316980 / area 17100 / rent_per_sf
  18.54) were correctly NOT overwritten.
- **Noise:** cosmetic conflicts dominated — `total_term_years 15.01 vs 15`, `firm_term_years 10.01 vs
  10`, `guarantor "DaVita, Inc" vs "DaVita, Inc."`, `renewal_options "Three 5-year options" vs
  "Three additional periods of five years each"`.
- **Double-process:** the same executed estoppel was processed twice (filed under `/Lease/` and
  `/Estoppel/`, folder_feed_seen ids 28518 + 28522) → duplicate conflict rows.

## Fix 1 — rent-per-SF unit normalization (the value fix)
In the lease extractor's rent handling: **normalize `rent_per_sf` to ANNUAL** and reconcile it
against `annual_rent` / `leased_area` before it's used in the fill-blanks/conflict comparison:
- If a `rent_per_sf` candidate × `leased_area` ≈ `annual_rent` (within ~5%), accept as annual.
- If `rent_per_sf` × 12 × `leased_area` ≈ `annual_rent` (within ~5%), it's MONTHLY → multiply by 12.
- If neither reconciles, prefer the derived `annual_rent / leased_area` and flag the extracted
  rent_per_sf as low-confidence (don't emit a spurious conflict on an unreconcilable figure).
- Apply the same monthly/annual reconciliation to `annual_rent` itself if the doc states a monthly
  rent. The goal: every emitted rent figure is annual and internally consistent
  (`rent_per_sf × area ≈ annual_rent`). No fabrication — if nothing reconciles, leave blank /
  low-confidence, don't guess.

## Fix 2 — conflict normalization / tolerance (the noise fix)
Before recording a `decision='conflict'` in `field_provenance` (the lease-backfill conflict path),
apply value-type-aware equivalence so only MATERIAL disagreements surface:
- **Numeric fields** (rent, area, term, psf, cap): treat as equal within a small tolerance —
  relative ~1% (or an absolute floor) AND round term-years to whole/one-decimal. `15.01 vs 15` and
  `10.01 vs 10` become non-conflicts.
- **String fields**: compare case-insensitive, trimmed, punctuation-normalized (strip `.,` and
  collapse whitespace) so `"DaVita, Inc" ≡ "DaVita, Inc."`.
- **Known synonyms** (small, explicit, conservative map): expense structure `NNN ≡ triple net`,
  `NN ≡ double net`; and a light renewal-options normalizer (e.g. compare extracted option
  count + term length rather than freeform prose) so `"Three 5-year options" ≡ "Three additional
  periods of five years each"` doesn't fire. Keep the map tight and documented — do NOT collapse
  genuinely different structures (NN ≠ NNN must STILL conflict — that one is material).
- A normalized-equal value is NOT a conflict and (if the field is blank) may fill-blank as today;
  a still-different value records the conflict exactly as now (current vs attempted + reason).
- **Material conflicts must still surface** — leased_area 17100 vs 6500, expense_structure Double
  Net vs NNN, annual_rent 723k vs 791k, lease_start 2019 vs 1999 are real and must stay in the
  Decision Center.

## Fix 3 (minor) — content-hash dedupe
Skip re-processing a lease doc whose content_hash already produced a backfill outcome on the SAME
property (the estoppel filed under two folders). Dedupe per (property_id, content_hash) so the same
executed instrument doesn't double-write conflicts. Keep distinct documents (a real amendment vs the
base lease) separate.

## Boundaries / gate
- Reuse the existing extractor + lease-backfill conflict path; the four guards (location / draft /
  operator / multitenant), fill-blanks, provenance `source='folder_feed_lease'`, and the guarantor/
  TI logic are UNCHANGED. ≤12 api/*.js. No fabrication. Reversible. dia/gov pipelines otherwise
  untouched.
- Add unit tests: the monthly→annual reconciliation (1.81/mo → 21.72/yr case), the numeric
  tolerance (15.01≡15), the string/punctuation normalize (DaVita Inc), the NN≠NNN still-conflicts
  case, and the content-hash dedupe.
- My gate: re-run a capped drain after deploy — the rent_per_sf conflicts reconcile to annual, the
  cosmetic conflicts (15.01/punctuation/synonyms) no longer appear, the material conflicts
  (area/NN-vs-NNN/escalation) STILL surface, the double-filed estoppel processes once, 0 clobbers,
  suite green. Then we broad-drain the ~295 with a clean queue.
