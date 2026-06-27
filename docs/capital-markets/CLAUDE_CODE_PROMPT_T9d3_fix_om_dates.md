# Claude Code prompt — T9d (fix): OM dates are NOT the bucket-upload date — date_uncertain + forward-safe ingest

> T9d2 recovered the wrong date: `om_receipt` used the `lcc-om-uploads/YYYY-MM-DD/` **bucket-upload** date,
> which for the mass-forwarded historical batch is the **2026 import date** — all 242 landed 2026-04-25→06-23,
> re-creating the surge (92 still inflate 2026-06-30, mislabeled "recovered"). The true original email date is
> **unrecoverable** for the historical batch (`staged_intake_items.source_email_date` is populated for only 8
> of 7,679 items — the new-flow ones). Doctrine (Scott): don't make anything up; keep evidenced deals; accept
> the count is best-effort. dia `zqzrriwuavgrquhisnoa`. Reversible (T9d2 backup); ≤12 api/*.js. Keep T9d2
> Units 2 & 4.

## Receipts (grounded live 2026-06-27)
- `available_listings.on_market_date_source='om_receipt'`: n=242, **ALL dated 2026-04-25 → 06-23** (187 in
  May–June, 0 before 2025) = the bucket-upload date of the 2026 mass import, NOT the OM's original receipt date.
- At 2026-06-30 the active set = 230, of which **92 are these `om_receipt` fake-2026 rows** → the "273→230
  de-surge" is illusory; the surge is renamed, not fixed.
- `staged_intake_items.source_email_date`: 8 of 7,679 populated (all 2026-06-24/26 — the new intake flow). The
  historical mass-import batch has it empty; `created_at` is the 2026 ingest date. So the true date is not
  stored anywhere recoverable for the batch.

## Unit 1 — re-classify the 242 `om_receipt` rows to `date_uncertain` (the honest fix)
Set `on_market_date = NULL`, `on_market_date_source = 'date_uncertain'` (+ a note) on the 242 rows currently
`on_market_date_source='om_receipt'`. They are KEPT as evidenced inventory (the OM is real) but OFF the time
axis — known-deal-of-unknown-date, NOT placed on the timeline with the 2026 upload date. **Never** use the
upload/path/`capture_date_fallback` date as a market-entry date. Reversible from the T9d2 backup table.
- Result: 2026-06-30 active drops ~230 → ~138 (the fake-2026 surge is gone); 0 deals deleted; the
  `date_uncertain` bucket grows by 242 (existing 270 → ~512), surfaced separately.

## Unit 3 — ingest path forward-safe (the "stays accurate" half)
In `buildDiaListingRow` / `buildGovListingRow`, set `on_market_date` at promotion from, in order:
1. a genuine snapshot/market signal (CoStar/RCA capture date, SF on-market) if present;
2. **`staged_intake_items.source_email_date`** — the real original email date the new intake flow now captures
   (works on the 8 new-flow items; this is the durable fix so new OMs land at their true date);
3. else **`date_uncertain`** (NULL on_market, source `date_uncertain`).
**Do NOT** fall back to the `lcc-om-uploads` upload path, `capture_date_fallback`, or `today()`. Remove the
`omReceiptDateFromArtifactPath` upload-date fallback that T9d2 added (it is the bug).

## Unit 2b — surface the cap inference (accuracy, not hiding it)
Keep the evidence-based **p90 (1356d) age cap** (do NOT arbitrarily tighten — that would impose a shorter life
than observed closed DOM and drop genuine long-DOM deals). But split the active membership into:
- **confirmed** — real `on_market_date`, `(period − on_market_date) <= cap`, no recorded exit; AND
- **assumed_active** — no recorded exit, counted ONLY because it's within the cap window (e.g. on-market
  beyond ~18mo with no exit signal).
Expose both in `cm_dialysis_active_listings_m`/`_q` (a flag column) + the KPI snapshot, so the ~87 cap-dependent
rows at 2026-03 are visible as "assumed active (no exit confirmed)," not silently full-confidence. Report the
confirmed/assumed split per period.

## Keep (unchanged from T9d2)
- Unit 2 entry/exit/cap currency model; Unit 4 close-on-sale hardening + orphan `5701` repair; the 270
  existing `date_uncertain`; the `unestablished_historical` (real T4c dates) + `sf_on_market_date` rows.

## Gate (verify live)
- 0 rows remain `on_market_date_source='om_receipt'` / dated 2026 from the upload path; the 242 are
  `date_uncertain` (NULL on_market), kept (not deleted).
- 2026-06-30 surge gone (~138, no fake-2026 OM rows); 2026-03 reports a confirmed-vs-assumed_active split
  (assumed ≈ the 87 cap-dependent); `date_uncertain` total ≈ 512, surfaced.
- Ingest: a new OM with a `source_email_date` lands at that real date; without one → `date_uncertain`, never
  the upload/today date. (Test both paths.)
- 0 evidenced deals dropped; reversible; idempotent; dia only; ≤12 api/*.js.

## Boundaries
- Constructive + honest: keep every evidenced deal, date it only from a REAL signal, mark the rest
  date_uncertain (off-axis) rather than inventing a date. The age cap stays evidence-based (p90) and its
  inference is surfaced, not hidden. Historical true-date recovery (OM-PDF parse / Gmail re-harvest) is a
  separate optional project to move `date_uncertain` → dated later — do NOT fabricate dates to avoid it.
