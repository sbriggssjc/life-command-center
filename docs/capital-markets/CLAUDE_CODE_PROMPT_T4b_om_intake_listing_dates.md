# Claude Code prompt — T4b: backfill TRUE on-market dates for OM-intake-derived listings (kill the surge at the source)

> Scott's directive (2026-06-23): rather than annotate the Q2-2026 coverage step, **recover each
> bulk-loaded listing's actual on-market date** so the inventory builds organically and the surge never
> exists. Grounded receipts-first on dia `zqzrriwuavgrquhisnoa` — the dates ARE recoverable because the
> batch is OM-intake-derived, not CoStar. Apply the same to gov `scknotsqkcheojiaewwh`.

## Receipts (the June batch is OM intake, not CoStar — verified live)
The ~462 dia "active" listings dated 2026-06-06..06-11 (the artifact behind the ~118→~590 step):
- `listing_date_source = 'capture_date_fallback'` (434) / `'date_unknown_r70b34'` (28) — the date is
  the **load date, not the real list date**.
- `data_source = NULL` (all 462); only 26 have a URL, 2 have raw_text — so there's nothing to re-scrape.
- BUT `intake_artifact_type` shows the real origin: **`om` (151), `marketing_brochure` (10), `flyer`
  (9), `offering_memorandum` (3)**, etc. — these were created by the **OM/flyer intake pipeline**. A few
  carry artifact paths like `lcc-om-uploads/2026-04-26/…DaVita-Dialysis-Kenton-OH….pdf` — **April dates,
  not June** — confirming the true "came to market" timing is spread across prior months.

## The fix — set `listing_date` to the true intake/received date, per listing
1. **Trace each of these `available_listings` rows to its OM-intake origin** (via `property_id` →
   `staged_intake_items` / the OM promoter linkage, the artifact path, or whatever key the OM-intake
   promoter used to create the listing). Recover the **true received/marketed date** = the intake
   `received_at`/`created_at` (or the artifact upload date in the `lcc-om-uploads/<date>/…` path, or the
   OM's stated marketing date if the extractor captured it).
2. **Backfill `listing_date`** from that true date and set `listing_date_source` to a distinct,
   auditable value (e.g. `om_intake_received`), REPLACING the `capture_date_fallback`/`date_unknown`
   June stamp. Now each listing enters the active series from its real month → the inventory ramps
   organically and the June surge disappears with no annotation needed.
3. **Where the true date genuinely can't be recovered** (no linkable intake record, no artifact date):
   report the count and HOLD those (keep them flagged, excluded from the date-dependent series) rather
   than inventing a date or leaving the fake June one. Don't fabricate.
4. **Re-confirm the active count after backfill** — the point-in-time series should now show a smooth
   organic rise (no one-quarter step); the "added per month" should distribute across the real months
   (~25-29/mo trend, no June spike); DOM should compute off the real dates.

## Methodology guard (surface, don't silently merge)
These OM-intake deals and CoStar-captured listings may be **two overlapping populations** of "on-market"
inventory. Confirm a deal isn't **double-counted** (an OM-intake listing + a CoStar listing for the same
property both counted active). De-dupe to one active record per property (the canonical de-dupe already
keys on `property_id` — verify it collapses these correctly). Report whether OM-intake materially
overlaps the CoStar active set or is largely additive.

## Apply to gov + keep the freshness gate
- Run the same OM-intake date-recovery on gov's equivalent bulk rows.
- Keep the T4 freshness gate (`last_verified_at >= now()−12mo` AND `consecutive_check_failures < 3`) —
  the date backfill fixes the timing; the freshness gate keeps the count honest as listings age.

## Gate (verify live)
- The ~462 June-stamped dia listings now carry real, spread `listing_date`s (April+ 2026, per their OM
  intake), `listing_date_source='om_intake_received'`; the count ramps organically, NO ~118→590 step.
- "Added per month" shows no June spike; DOM is off real dates. Unrecoverable subset is reported + held.
- No double-count of OM-intake vs CoStar for the same property. Reversible (prior values logged).

## Boundaries
Recover real dates from intake metadata; never fabricate a date. Hold the genuinely-unrecoverable rather
than guess. De-dupe, don't double-count. Reversible. dia + gov.
