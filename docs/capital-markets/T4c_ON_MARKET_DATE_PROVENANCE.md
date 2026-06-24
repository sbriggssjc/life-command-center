# T4c — on-market-date PROVENANCE model + mass-forward guard (2026-06-24)

Supersedes T4b. Models on-market date as a first-class, **source-ranked** field
sourced from EVIDENCE — never the OM processing/ingest clock — and HOLDs the
genuinely-unrecoverable rather than fabricating a load-date.

## What shipped (this session — committed + applied live)

### The model (3 DBs, additive, reversible — DROP columns to revert)
- **dia + gov `available_listings`** gain `on_market_date` (date),
  `on_market_date_source` (text), `on_market_date_confidence`
  (`high|medium|low|none`). `listing_date` is UNTOUCHED (kept for operational
  use); `on_market_date` is the TIMING truth the supply-side / DOM charts read.
  Migrations `supabase/migrations/{dialysis,government}/20260624_*_t4c_on_market_date_model.sql`.
- **LCC Opps `staged_intake_items`** gains `source_email_date` (timestamptz) —
  the email's true Date captured at ingest. Migration
  `supabase/migrations/20260624120000_lcc_t4c_source_email_date.sql`.

### The deriver (single source of truth)
`api/_shared/listing-date.js::deriveOnMarketDate(metadata, {nowMs, massForward})`
→ `{on_market_date, source, confidence}`. Ladder (clock is NOT on it):
1. explicit on-market date (`metadata.listing_date` ≤ capture) → **high**
2. platform days-on-market → **medium**
3. the email Date the OM arrived on (`source_email_date`, ≤ capture) → **medium**
4. else **HELD** → `{on_market_date:null, source:'unestablished',
   confidence:'none'}`

**Mass-forward guard:** `{massForward:true}` suppresses the email-date tier and
HOLDs — a re-forward of the whole mailbox (which clusters `created_at`) can never
move a market date. Explicit on-market/DOM evidence still passes.

### Writers wired (ship on Railway redeploy; DB columns already live, deploy-safe)
- OM promoter (`intake-promoter.js` dia+gov rows), CoStar sidebar
  (`sidebar-pipeline.js` dia+gov listing writers), and the entities-handler
  verify path now populate the three on_market_date columns. The verify path
  has no evidence → HELD.
- **Ingest-time email-date capture** (`intake-om-pipeline.js` +
  `intake.js`): the flagged-email PA flow's RAW received date (never the
  `now()`-coalesced fallback) → `staged_intake_items.source_email_date`, and
  `internet_message_id` is now persisted (was hard-coded NULL) so future emails
  are Gmail-traceable. So ladder step 1 becomes a LOCAL read going forward.

### Backfill result (live, verified — Scott's corrected `unestablished` predicate)
The held predicate (Scott, 2026-06-24): `listing_date_source IN
('capture_date_fallback','date_unknown_r70b34','date_unknown','om_lease_inference',
NULL)` **scoped to** `listing_source IN ('lcc_intake_om','email_om',
'om_extraction','crexi','salesforce_ascendix','costar_sidebar')` — **NOT**
`synthetic_from_sale` / `master_curated_sale` (keep their dates). Artifact-dated
held set → `on_market_date=NULL`, `source='unestablished'`.

**Byte-identical-published refinement** (layered on top, so completed months
≤ 2026-03-31 are unchanged): R70-B3 already excluded capture/unknown from the
added/DOM counts, so those are HELD at **all** dates. `om_lease_inference` +
NULL-source rows WERE counted by R70, so only the **surge window** (`listing_date
≥ 2026-04-01`) is HELD; earlier rows keep their date as `unestablished_historical`
(low). Live distribution (the migrations reproduce it exactly):

- **dia** — `unestablished` **1686** (capture 550 + `date_unknown_r70b34` 107
  held all-dates; + NULL-source 1006 & `om_lease_inference` 23 in the surge
  window) · `unestablished_historical` **1497** (NULL-source 1393 +
  `om_lease_inference` 104, pre-2026-04, kept dated) · `synth_*`/`sale_anchor`/
  `costar_days_on_market` promoted (1199 + 8 + 684 + 2). dia has **no
  `listing_source`** column, so its held set keys purely on `listing_date_source`
  (the `synth_*` tags are real-evidence, never held).
- **gov** — `unestablished` **915** (capture/unknown scoped held all-dates 901 +
  `om_lease_inference` surge 2 + NULL-source/no-date 12) · `unestablished_historical`
  **55** (scoped `om_lease_inference` 46 + NULL-source 9, pre-2026-04) ·
  `synthetic_from_sale` **1391** kept (low — its `listing_date_source` is NULL, so
  the provenance tag comes from `listing_source`) · `master_curated` **692** kept
  (medium). The gov held set is **scoped by `listing_source`** so the
  sold-anchored / curated channels are never held.
- Point-in-time active count unchanged on both. The timing series shows **no
  Q2-2026 step** (the artifact set is HELD, not fabricated).

## Grounding corrections (premises the task assumed, refuted by the live data)
1. **`internet_message_id` is NULL on ALL `staged_intake_items`** and
   `raw_payload` carries no `receivedDateTime`/`sentDateTime`/email date — so the
   Phase-1 "trace via message-id → Gmail" path has no key today. (Fixed
   going-forward: both are now captured at ingest.)
2. **The artifact-path date is itself a June ingest cluster** — 294 of 356
   dated `lcc-om-uploads/YYYY-MM-DD/` paths are in 2026-06. Using it would just
   relabel the surge "June ingest," which the task forbids → NOT used as a proxy.
   The unrecoverable bulk is HELD per the task's own doctrine.
3. The "added-per-month" surge was already gated (R70-B3 excludes
   `capture_date_fallback`/`date_unknown_*`); T4c makes the on-market date a
   first-class provenance field + captures the email date so a real-date recovery
   can later slot rows into their TRUE month.

## Remaining wires (operational / handed off — not runnable in this environment)
- **The recovery ladder for the 657/901 HELD set** (Gmail message-id traceback,
  CoStar/RCA "date listed", Salesforce list date) needs Gmail/platform/SF reach
  (none available here). When run, write the recovered date to `on_market_date`
  + the matching `on_market_date_source`/confidence; de-dup OM-intake vs CoStar on
  `property_id`. The model + columns are ready; the manual worklist
  (`OM_Intake_OnMarket_Date_Research.xlsx`) is the catch-net.
- **PA flow change**: have the flagged-email "Http -> PUT" send
  `received_date_time`/`sent_date_time`; the ingest now persists it the moment it
  arrives (no code change needed — `intake.js` already reads those keys).
- **CM timing-view read-switch (item 3 — PROVEN-NOT-BYTE-IDENTICAL, handed off,
  NOT shipped live).** The supply-side / DOM views still key on `listing_date`
  (+ the R70-B3 source-exclusion gate). The intended switch is: point the
  added-per-month / DOM / ramp views at `on_market_date` (held NULL rows drop off
  the time axis; the point-in-time active count keeps the freshness gate,
  unchanged). **The naive repoint is NOT byte-identical** and was deliberately
  NOT applied this session (project doctrine: never silently corrupt published CM
  exports):
  - The view's `eff_start = COALESCE(listing_date, (sold_date OR
    off_market_date) − 196 days)` — a synthetic anchor for NULL-`listing_date`
    sold rows. Swapping the first arg to `on_market_date` drops the
    sold-anchored reconstructions that previously fell through to the −196d
    branch, changing completed months.
  - Empirically: a naive repoint dropped **639** pre-2026-03 rows; a refined
    predicate (`eff_start = COALESCE(on_market_date, sold-196d)` + an addable
    sold-anchor branch) reduced it to **109** — still not 0.
  - **Gate before shipping the repoint:** `dropped_pub = 0` (a per-month diff of
    the published series ≤ 2026-03-31 must be byte-identical), reconciling the
    residual ~109 sold-anchored edges case-by-case. Confirm with Scott before any
    live CM-view edit. The model + columns are the prerequisite and are in place;
    the repoint is the remaining, carefully-grounded step.
- **promoter on-market email tier**: `source_email_date` is mirrored into
  `raw_payload.seed_data.source_email_date`; threading it onto the extraction
  `snapshot` (so `deriveOnMarketDate` uses it for email-channel OM listings) is a
  small remaining wire in the extractor→promoter chain.

## Boundaries
On-market date is sourced from evidence (on-market/DOM/email/platform/SF), never
the processing clock; the unrecoverable is HELD (NULL), never invented;
`last_seen` is freshness, not market entry. Reversible (drop the columns). No
change to published completed-quarter history. ≤12 api/*.js.
