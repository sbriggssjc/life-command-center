# Claude Code prompt — R2-D: recover real on-market dates for the date_uncertain OMs (investigation → recovery)

> Scott prioritized this (June-29). After T9d, ~512 dia listings are `date_uncertain` (provenance-backed OMs
> with no recoverable date — they were bulk-forwarded to LCC intake in 2026, so the upload/ingest date is fake
> and `staged_intake_items.source_email_date` is empty for the batch). Recent inventory looks sparse because
> they're off the time axis. **Recover their TRUE on-market date from the source, move them onto the timeline,
> keep the unrecoverable ones date_uncertain.** Constructive (like T4c's SF recovery), reversible, NO fabricated
> dates. dia `zqzrriwuavgrquhisnoa` + LCC `xengecqvemvfknjvbvrq` (artifacts). ≤12 api/*.js.

## Phase 1 — INVESTIGATE recoverable sources + report yield BEFORE applying
For the ~512 `date_uncertain` listings (and any `om_receipt`-era rows), assess each candidate date source and
report how many can be dated by each (do NOT write yet):
1. **Forwarded-email original `Date:` header** — when the teambriggsdialysis@gmail.com OMs were bulk-forwarded
   to LCC intake, the ORIGINAL received date is usually embedded in the forwarded body ("---------- Forwarded
   message --------- From: … Date: …"). Check `staged_intake_artifacts` (raw email text / the synthesized
   text/plain body artifact) + `staged_intake_items` for a parseable original Date. This is the strongest
   in-system source (the real "earliest date the email was received").
2. **`internet_message_id`** — sometimes carries a date token; low-confidence, corroboration only.
3. **The OM PDF's own date** — many OMs/flyers state a date ("Offered … <date>", a flyer date, "available as
   of"). Parse the OM artifact text (the extractor already pulls OM text) for a stated listing/flyer date.
4. **Salesforce** — already recovered where an SF link exists (`sf_on_market_date`, T4c); confirm none of the
   date_uncertain set actually has an SF date now.
5. **CoStar/LoopNet/RCA** — external; out of scope for the first pass unless an in-system capture date exists.
**Report:** per-source recoverable count, overlap, and the residual that stays date_uncertain. Pick the
**earliest credible real date** per listing (Scott's rule), with a confidence + a new `on_market_date_source`
value per source (`email_forward_header`, `om_document_date`, etc.).

## Phase 2 — RECOVER + apply (after the Phase-1 yield is reviewed)
For each date_uncertain listing with a recovered real date: set `on_market_date` + `on_market_date_source` +
confidence, moving it onto the time axis. **Guards:** never the upload/ingest/`capture_date_fallback`/today
date; a recovered date must be a real evidenced date (email-received / OM-stated / SF); flag confidence;
reversible (backup table). Listings still unrecoverable stay `date_uncertain` (off-axis, kept) — honest.
- The recovered listings then flow into the membership model (T9d Unit 2: on_market + exit + age cap) and
  refill recent inventory (dia Inventory_Backlog) + the recent 10+/core cohort (R2-C Unit 1) at their TRUE
  months — confirm recent 2025-12→2026-03 inventory + cohort metrics populate with recovered dates.

## Phase 3 — make ingestion forward-safe (so it never recurs)
Confirm the new intake flow captures `source_email_date` (it does for the 8 new-flow items) and that
`buildDia/GovListingRow` uses it (R2/T9d3 Unit 3). For the forwarded-email channel specifically, add parsing
of the forwarded original `Date:` header at ingest so a future bulk-forward doesn't lose the real date.

## Gate
- Phase-1 yield reported per source BEFORE any write (recoverable vs residual date_uncertain).
- Phase-2: recovered listings carry a REAL `on_market_date` (no fabricated/upload dates), flagged + reversible;
  unrecoverable stay date_uncertain; recent inventory + the 10+/core cohort refill at true months — report
  before/after counts (e.g. dia Inventory_Backlog late-2025/2026; the R2-C cohort gap).
- Phase-3: forwarded-Date parsing wired at ingest (forward-safe).
- Reversible (backup); dia + LCC artifacts; ≤12 api/*.js. No fabricated dates anywhere.

## Boundaries / sequencing
Investigation FIRST (report yield, no blind writes) — this is the accuracy-first recovery, not a date
invention. It's the largest R2 item; expect multiple passes. The recovered dates retroactively improve the
recent-inventory + cohort charts (R2-C Unit 1's gaps fill in for the recovered subset; the rest stay honestly
gapped). Coordinate with R2-A/B/C (data layer) but this is the deepest workstream.
