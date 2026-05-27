# Claude Code / Cowork Instructions — Life Command Center

> **CRITICAL: Read .github/AI_INSTRUCTIONS.md before modifying any files in /api/.**

## Vercel Hobby Plan Constraint

HARD LIMIT: 12 serverless functions max (12 .js files in /api/).
Currently at 9 functions (Phase 4b freed 3 slots via edge migration).
data-proxy, daily-briefing, diagnostics absorbed into admin.js + Supabase Edge Functions.

## Rules

0. LCC_API_KEY auth is production-ready (Phase 6b). Frontend auth.js auto-injects X-LCC-Key via global fetch interceptor. To enforce: set LCC_API_KEY + LCC_ENV=production in Vercel.
1. NEVER create new .js files directly in /api/
2. Add new endpoints as sub-routes (use ?action= or ?_route= query param patterns)
3. New utility/handler code goes in /api/_shared/ or /api/_handlers/
4. After ANY /api/ change, verify: `ls api/*.js | wc -l` must be <= 12
5. Update vercel.json rewrites when adding new sub-routes
6. Use descriptive Round-numbered commit messages, never generic "GPT changes"
7. See .github/AI_INSTRUCTIONS.md for full architecture and routing patterns

## Architecture Quick Reference

- LCC orchestrates, domain Supabase backends execute domain logic
- Contacts + Entities consolidated into entity-hub.js (routes to _handlers/)
- Bridge + Workflows consolidated into operations.js
- Intake functions consolidated into intake.js
- admin.js: workspaces, members, flags, connectors, diagnostics (config/diag/treasury), edge proxies (data-query, daily-briefing)
- Supabase Edge Functions:
  - **`data-query`** + **`daily-briefing`** are deployed on the **Dialysis_DB** project (ref `zqzrriwuavgrquhisnoa`) — `api/admin.js` `DATA_QUERY_EDGE_URL` hard-codes that ref. When you bump the data-query allowlist (e.g. to add a new RPC), deploy to that project, not LCC Opps.
  - `availability-checker` (periodic listing URL probe — Round 76ej.g) lives on **LCC Opps** (`xengecqvemvfknjvbvrq`).
- pg_cron on LCC Opps: scheduled jobs — `refresh_work_counts` (5min), nightly preassemble/cross-domain-match, daily briefing, weekly report, history cleanup, `lcc-cleanup-orphan-om-uploads` (storage hygiene), `matcher-accuracy-rollup`, `lcc-merge-log-reconcile` (15min — patches LCC entity backrefs after dia/gov property merges, Round 76ee Phase 2), `lcc-auto-scrape-listings` (every 6h on the hour — sweeps overdue active listings, auto-marks Sold via sales_transactions match, Round 76cx Phase 4b), `lcc-availability-checker` (every 6h at :30 — Edge Function probes listing URLs and writes off_market/withdrawn via lcc_record_listing_check, Round 76ej.g), `lcc-availability-promotion-sweep` (every 6h at :45 — re-checks the availability-checker's `unverified_assumed_off` listings against sales_transactions and upgrades to Sold on a deed match, Round 76ej.h), `lcc-cron-health-check` (every hour at :15 — surfaces cron failures, pg_net non-2xx responses, and availability-checker bot-block alerts in `lcc_health_alerts`), `lcc-briefing-intel-snapshot` (10:00 UTC Mon-Fri — Edge Function builds the daily market/news/AI snapshot that drives the executive briefing email; migration `20260527120000_lcc_briefing_intel_snapshot_cron.sql`)
- `lcc_cron_post()` helper reads API key from Supabase Vault, POSTs via pg_net to Vercel or Edge endpoints
- All rewrites defined in vercel.json — order matters (specific before catch-all)

## OM Intake Pipeline — three channels, one shared path

All three OM intake channels converge on `api/_shared/intake-om-pipeline.js::stageOmIntake`:

1. **Email** (Power Automate flagged-email) → `POST /api/intake?_route=outlook-message`
2. **Sidebar** (Chrome extension / CoStar capture) → `api/_handlers/sidebar-pipeline.js` (does NOT go through stageOmIntake; writes domain DBs directly — Phase 2.2 instrumentation pending)
3. **Copilot Studio** (agent action) → `POST /api/intake/stage-om` → action_id `intake.stage.om.v1` → `handleIntakeStageOm`

Email flow REQUIRES the PA HTTP PUT body to use `base64ToBinary(items('Apply_to_each')['contentBytes'])` — passing raw `contentBytes` writes base64-text instead of binary (Bug E, fixed 2026-04-25). The extractor has a `recoverIfBase64Wrapped` safety net.

When an email has no OM-eligible attachment, `handleOutlookMessage` synthesizes a `text/plain` artifact from subject+body so the email body itself is ingested. The extractor handles `text/*` mime types by skipping pdf-parse and feeding the decoded text directly to AI.

See `docs/architecture/om_intake_pipeline.md` for the full reference.

## Multi-model AI fallback for extraction (2026-04-25)

The OM extractor (`api/_handlers/intake-extractor.js::callAiExtraction`) routes through `invokeExtractionAI` in `_shared/ai.js` rather than `invokeChatProvider` directly. The fallback chain:

1. **Primary** — whatever `invokeChatProvider` routes to (typically Claude via the Supabase edge function)
2. **On 429 / 5xx** — walk the `AI_EXTRACTION_FALLBACK_CHAIN` env (JSON array of `{provider, model}`); default is `[{"provider":"openai","model":"gpt-4o-mini"}]`. OpenAI sits in a separate rate-limit pool from Claude.
3. **On final failure** — sleep 35s, retry primary once
4. Returns the result with a `tried` array describing which providers/models were attempted

Each per-artifact diagnostic now records `ai_chain`, `ai_fell_back`, `ai_final_provider`, `ai_final_model` so the SQL audit can see fallback frequency:

```sql
SELECT
  intake_id,
  raw_payload->'extraction_result' AS extraction
FROM staged_intake_items
WHERE raw_payload->'extraction_result'->'diagnostics'->0->>'ai_fell_back' = 'true';
```

Required env: `OPENAI_API_KEY` in Vercel. Override the chain with `AI_EXTRACTION_FALLBACK_CHAIN='[{"provider":"openai","model":"gpt-4o"}]'` to use a different fallback model.

Also: text/plain artifacts (email-body intakes) are capped at 80K chars vs 200K for PDFs — most flyer emails have all the deal data in the first 30-50K chars; the rest is signature blocks and forwarded thread history that burns tokens for no extraction value.

## Field-level data provenance (Phase 1, 2026-04-25)

LCC Opps now has three artifacts that observe every cross-table field write to curated tables:

- **`field_provenance`** — append-only log keyed on `(target_database, target_table, record_pk_value, field_name)`. Records source, confidence, source_run_id, decision (`write|skip|conflict|superseded`).
- **`field_source_priority`** — per-field source ranking. Lower priority = higher trust. Seeded with rules like `county_records` (10) beats `om_extraction` (50) for `dia.properties.address`; `om_extraction` (30) beats `costar_sidebar` (70) for `dia.leases.rent`. `enforce_mode` is `record_only | warn | strict` for gradual rollout. Phase 3 starter (2026-04-26): 24 rules flipped to `warn` for `costar_sidebar` writes to `dia.deed_records`, `gov.deed_records`, `dia.parcel_records`, `gov.parcel_records`, `dia.tax_records`, `gov.tax_records`. Remaining 438 rules still `record_only` (462 total / 133 distinct fields after Phase 4 drift remediation). In warn mode, the JS-side `recordFieldProvenance()` helper logs `console.warn('[field-provenance:warn] skip on dia.deed_records.grantor record=12345...')` to Vercel function logs whenever the lcc_merge_field decision would block the write under strict mode.
- **`v_field_provenance_actionable`** — Phase 3 view; surfaces skip/conflict decisions where the rule is in warn or strict mode. Drives the LCC UI's "Provenance conflicts" panel.
- **`v_field_provenance_unranked`** — Phase 4 schema-drift detector; surfaces (target_table, field_name, source) triples writing to field_provenance that aren't in field_source_priority. Drives the LCC UI's "Unranked fields" panel. Should normally return 0 rows — non-zero = a new writer path was added without a corresponding priority entry.
- **`lcc_merge_field()`** — single SQL function that records provenance and returns the decision. Application write paths consult the decision; in record_only mode UPDATEs still run unchanged.
- Views: `v_field_provenance_current` (latest authoritative per field), `v_field_provenance_conflicts` (open same-priority disagreements pending review).

Currently instrumented: OM intake promoter (Phase 2.1), CoStar sidebar (Phase 2.2 — full coverage: properties, available_listings, leases, sales_transactions, contacts, parcel_records, tax_records, recorded_owners, ownership_history, brokers, deed_records, loans, property_documents). Pending: CMS sync, county records sync, manual edits, Salesforce.

Sidebar instrumentation (Phase 2.2.b + 2.2.c, 2026-04-26): writers `upsertDomainLeases`, `upsertDomainSales`, `upsertSidebarContacts`, `upsertPublicRecords`, `upsertDocumentLinks`, `upsertDialysisBrokerLinks`, `upsertGovBrokers`, `upsertDialysisDeedRecords`, `upsertGovernmentDeedRecords`, `upsertDomainLoans`, `upsertDomainOwners` accept an optional `provCollect` array and push `{table, recordPk, fields}` per successful INSERT/PATCH. `propagateToDomainDbDirect` flushes the array through `recordCoStarFieldsProvenance` after all writers run. Default confidence 0.6 (CoStar aggregator-quality). Priority registry covers 24 tables × 111 fields: see migrations `20260426110000_field_source_priority_phase_22b_extension.sql` and `20260426120000_field_source_priority_phase_22c_extension.sql`.

See `docs/architecture/data_quality_self_learning_loop.md` for the Phase 1-4 rollout plan and `supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql` for the schema.

## OM promoter: doctype normalizer + tenant back-write (2026-04-27)

Two follow-ups from the 24-48h ingestion audit:

1. **Doctype normalization** — `intake-promoter.js` now exposes `normalizeDocType()` which maps extractor synonyms (`'offering_memorandum'`, `'offering memorandum'`, `'OFFERRING MEMORANDUM'` typo, `'broker_package'`, etc.) back to canonical short forms (`'om'`, `'flyer'`, `'marketing_brochure'`). Before the fix, ~22 of 30 OMs in a 24h audit window were rejected at the `not_a_listing_doc` guard because the AI returned the long form. Also added `snapshotLooksLikeListing()` fallback: when doctype is null/unknown but the snapshot has asking_price + tenant + ≥1 supporting field (cap_rate/SF/term), promote anyway and tag as inferred 'om'.

2. **Tenant back-write** — `promoteDiaPropertyFromOm` now patches `properties.tenant` from `snapshot.tenant_name` when the property's tenant is currently NULL. CSV-imported properties often had tenant left blank, and the OM is the first authoritative source for the operator name. Same conservative rule as other fields: only fill blanks, never clobber curated data.

## sales_transactions.sale_date NOT NULL (2026-04-27)

Audit 2026-04-27 found 363 `dia.sales_transactions` rows with `sale_date=NULL`, all from legacy CSV import (`data_source=NULL`). They corrupted cap-rate analysis (some carried OM asking prices misread as sale prices) and created phantom duplicate sales. Cleanup recovered 9 dates from notes-as-date strings, severed 12 ownership_history links to phantom sales, and bulk-deleted 350 unrecoverable rows. Then added `CHECK (sale_date IS NOT NULL)` constraint via migration `20260427000000_dia_sales_transactions_sale_date_not_null.sql`. Both active writers (sidebar `upsertDomainSales`, OM promoter — which doesn't write to sales_transactions) now fail loudly if a writer ever forgets to populate sale_date.

## Auto-correction triggers + data quality views (2026-04-25)

Dialysis DB has two new artifacts for self-cleaning:

- **`auto_supersede_expired_leases()`** trigger on `dia.leases` (AFTER INSERT OR UPDATE OF is_active, lease_start) — when a new active lease lands, marks any other active lease on the same property whose `lease_expiration < new lease.lease_start` as `superseded`. Conservative: doesn't touch overlapping leases (those need human review). Migration: `20260425230000_dia_lease_auto_supersede_on_insert.sql`.

- **`v_data_quality_issues`** + **`v_data_quality_summary`** views (dia DB) — surface patterns the triggers can't safely auto-correct:
  - `duplicate_property_address` — same normalized address+state used by multiple property_ids (1,061 rows in audit; merge candidates need human review)
  - `multi_active_lease` — properties with >1 active lease that the auto-supersede couldn't resolve (1,007 properties)
  - `listing_after_sale` — active listings whose property has a sale recorded BEFORE the listing_date (the close_listing_on_sale trigger missed)
  - `orphan_listing` — listings whose property_id no longer exists
  - `lease_no_dates` — active leases with neither lease_start nor lease_expiration (947 placeholder rows)

  Migration: `20260425230500_dia_v_data_quality_issues.sql`. Use from a triage UI:
  ```sql
  SELECT * FROM v_data_quality_summary;
  SELECT * FROM v_data_quality_issues WHERE issue_kind='multi_active_lease' ORDER BY severity DESC;
  ```

## Listing availability checker (Round 76ej.g, 2026-05-05)

Two crons now share the listing-verification queue. They cover different
evidence channels and are wired so they don't double-write:

- **`lcc-auto-scrape-listings`** (every 6h on the hour, `api/admin.js
  handleAutoScrapeListings`) — owns the **sold path**. Walks overdue
  active listings and looks for a matching `sales_transactions` row in
  the property's ±3-year window. When it finds one, calls
  `lcc_record_listing_check(check_result='sold')`. When it doesn't, calls
  `inferred_active` — narrow timer advance, no URL probe.

- **`lcc-availability-checker`** (every 6h at :30, Supabase Edge Function
  `supabase/functions/availability-checker/index.ts`) — owns the **URL
  probe path**. Pulls 25 overdue listings per tick, fetches each
  `listing_url` (or gov `source_url` / `tracked_urls[0]`) with a
  browser-shaped User-Agent at concurrency=3 with 2-3s jitter, and runs
  per-site parsers (CREXi / CoStar / LoopNet) over the response body.
  Markers it looks for: "no longer available", "off market", "withdrawn",
  "removed from the market", "under contract", JSON-LD
  `availability=SoldOut`, plus per-site redirect-to-search fingerprints.
  - Writes `lcc_record_listing_check(check_result='off_market',
    off_market_reason='withdrawn')` for clean off-market hits.
  - **Never writes `check_result='sold'`** — even when the page banner
    reads "Sold". Sold-flavored pages are recorded as `off_market` with
    `off_market_reason='unverified_assumed_off'` so the
    sales_transactions watcher (or a human) can promote them later.
  - 4xx/5xx/bot-block responses → `check_result='unreachable'`. The
    helper increments `consecutive_check_failures` instead of changing
    status. Once the count crosses **3**, the worker promotes that pass
    to `off_market` / `unverified_assumed_off`.
  - Writes a `field_provenance` row tagged `source='availability_scraper'`
    via `public.lcc_merge_field` for every `url_status` change.
    `field_source_priority` priority is **65** (aggregator-quality, below
    sidebar_capture=40 and sales_transactions=45, parallel to
    costar_sidebar). Migration:
    `supabase/migrations/20260505100000_lcc_availability_checker_cron.sql`.

`pg_cron` schedule:
```
SELECT cron.schedule(
  'lcc-availability-checker',
  '30 */6 * * *',
  $$SELECT public.lcc_cron_post('/availability-checker',
      '{"domain":"both","limit":25}'::jsonb, 'edge')$$
);
```

Debug endpoint (POST, no DB writes):
```
POST {EDGE_BASE}/availability-checker?action=check_url
{"url":"https://www.crexi.com/properties/12345/sample-listing"}
```

Returns the parser verdict, final URL, http status, and matched marker.

### Bot-block self-alert (Round 76ej.h, 2026-05-05)

After each domain run the Edge Function calls
`public.lcc_record_availability_botblock(domain, scanned, unreachable,
share)` on LCC Opps. If the unreachable share is ≥ 30% AND `scanned ≥ 5`,
the RPC opens an `availability_checker_botblock` row in
`lcc_health_alerts` (no-op if one is already open for that domain). On a
subsequent run with the share back below threshold the RPC
auto-resolves the open alert. The hourly `lcc-cron-health-check` cron
already surfaces unresolved rows in the daily briefing — no extra wiring
needed.

Triage queries (run on the affected domain DB):
```sql
SELECT * FROM v_availability_checker_health_24h;             -- last 24h
                                                              -- by check_result
SELECT listing_id, source_url, http_status, response_summary, verified_at
FROM   listing_verification_history
WHERE  method='auto_scrape' AND notes LIKE 'availability-checker%'
  AND  check_result='unreachable'
  AND  verified_at > now() - interval '6 hours'
ORDER  BY verified_at DESC;
```

Open alert? Inspect on LCC Opps:
```sql
SELECT * FROM v_cron_health_summary
 WHERE alert_kind='availability_checker_botblock';
```

### Promotion sweep (Round 76ej.h, 2026-05-05)

`api/admin.js handleAvailabilityPromotionSweep`, exposed as
`?_route=availability-promotion-sweep`, closes the loop on listings the
availability-checker stamped `unverified_assumed_off`. Sequence each 6h
tick:

```
:00  lcc-auto-scrape-listings        (active listings → 'sold' on deed match)
:30  lcc-availability-checker        (URL probe → 'off_market'/'unverified_assumed_off')
:45  lcc-availability-promotion-sweep (re-checks unverified set → 'sold' on deed match)
```

The sweep only looks at listings whose `off_market_date` is within the
last 90 days (`max_age_days` query param, capped at 180). Older listings
fall back to manual research — at that point the absence of a deed match
is a real-world signal, not a sweep oversight.

Acceptance script (live, no DB writes — uses the debug endpoint):
```bash
EDGE_BASE=https://<ops-ref>.supabase.co/functions/v1 \
LCC_API_KEY=... \
node scripts/availability-checker-acceptance.mjs \
  --samples scripts/availability-checker-samples.json
```
Exits 0 when ≥ 8/10 sample URLs match their `expected` label, 1 otherwise.

## Junk-value filters (sidebar parser defense)

`api/_handlers/sidebar-pipeline.js::upsertDomainLeases` has an `isJunkTenant()` filter that rejects bad tenant names BEFORE writing to `leases`. It catches:

- Demographics (`population`, `median age`, `daytime employees`, `traffic vol`)
- Street name fragments (`Foo Ave N`, `Bar St SW`)
- OM table-of-contents headers (`Loan`, `Financials`, `Changes`, `Recent Changes`, `Investment Highlights`, etc.)
- NAICS sector names (`Health Care and Social Assistance`, `Retail Trade`, etc.)
- CoStar UI labels (`Smallest Space`, `Max Contiguous`, `Office Avail`, `Retail Avail`, `Tenancy`, `Owner Occupied`, `Rent`, `Service Type`, `For Lease at Sale`)

When extending: keep the regexes anchored `^...$` so legitimate tenant names containing these words aren't false-positived (e.g., "First National Bank" is fine; bare "Financials" is not).

## Dialysis `v_sales_comps` — `rent` semantics

As of `supabase/migrations/20260416120000_v_sales_comps_projected_rent.sql`,
the dialysis `v_sales_comps` view returns rent *projected to CURRENT_DATE*,
not Year-1 base rent. Consumers need to know:

- `rent` — current rent, escalated from the anchor (property `anchor_rent` when
  `anchor_rent_source IN ('lease_confirmed','om_confirmed')`, else
  `leases.annual_rent`) through `properties.lease_bump_pct` /
  `lease_bump_interval_mo`. Projection math lives in
  `api/_shared/rent-projection.js` (`projectRentAtDate`) and is mirrored in
  SQL by the `public.dia_project_rent_at_date()` helper.
- `base_rent` — the Y1 `leases.annual_rent` figure (what `rent` used to be).
  Render it as a secondary value when you need to show the unescalated rent.
- `rent_per_sf` — projected rent / `leases.leased_area`, NOT the Y1 figure.

Downstream writers that still need Y1 rent should pull `base_rent`. The
current dialysis.js Sales Comps loader (`loadDiaSalesCompsFromTxns`) bypasses
the view and assembles rows from `sales_transactions` + `leases` directly, so
it continues to show Y1 rent until switched over to the view.

## Geocode backfill (Round 76gn, 2026-05-08)

The lease-comps export (Briggs template, `_udExportLeaseComps` in
`detail.js`) ranks comparables by haversine distance from the subject
property's lat/lng. An audit on 2026-05-08 found that essentially zero
rows in `dia.properties` (and likely `gov.properties`) had
`latitude`/`longitude` populated — legacy CSV / CMS imports, OM intake,
and CoStar capture all wrote rows without geocoding them. Result: every
Export Lease Comps click fell through to "no comps near this subject."

Two artifacts now keep coverage current:

1. **`api/_handlers/geocode-backfill.js` → `?_route=geocode-tick`**
   (also rewritten to `/api/geocode-tick`). Pulls up to `limit` rows
   per domain WHERE `latitude IS NULL`, geocodes each via the US
   Census Bureau onelineaddress API (free, no key, no rate limit, US-
   only), and PATCHes the result back. Cron-friendly — defaults to
   `limit=60` so a tick fits inside Vercel's function budget. Returns
   `{by_domain: {dia/gov: {scanned, patched, missed, skipped, errored}}}`.
   No Nominatim fallback in the cron path (TOS rate cap would push tick
   duration over budget); the long-tail OSM fallback lives only in the
   one-shot script.

2. **`pg_cron lcc-geocode-backfill`** (`*/10 * * * *`,
   `supabase/migrations/20260508120000_lcc_geocode_backfill_cron.sql`).
   Calls the handler via `lcc_cron_post('/api/geocode-tick?...', ...,
   'vercel')`. At 60 rows/tick × 6 ticks/hr = 360 rows/hr the per-domain
   backlog drains in ~14h; afterwards the cron just maintains coverage
   as new rows arrive.

For a one-shot fast backfill (~25 min for 5000 rows, Census-only),
run `scripts/geocode-properties-backfill.mjs` from a workstation with
`DIA_SUPABASE_URL` / `DIA_SUPABASE_SERVICE_KEY` (and the GOV pair) in
env. The script also has a Nominatim fallback enabled by default for
addresses Census can't resolve (PO boxes, recent construction, etc.).
Use `--skip-nominatim` for Census-only.

### Google Maps fallback (Round 76gn.b, 2026-05-08)

The Round 76gn launch used Census-only geocoding and got ~70-80% hit
rate on gov + ~20% on dia (dia has widespread address-corruption from
the legacy CMS/CSV import — wrong city paired with real street). To
lift dia coverage without source-data cleanup, the cron handler now
falls back to **Google Maps Geocoding API** on every Census miss.

Configuration:
- Set `GOOGLE_MAPS_API_KEY` in the Railway env. The handler reads it on
  every invocation; no redeploy needed after adding the key.
- When the key is absent, the handler logs a one-line warning at cold
  start and gracefully runs Census-only (identical to the Round 76gn
  launch behavior — no errors, no missed ticks).
- Cost ≈ $5 per 1,000 calls. Engaged ONLY on Census miss, so the
  marginal cost on a fully-geocoded universe is near zero (only new
  rows trigger calls); backfilling the dia long tail (~8,000 chronic
  Census misses) costs ~$40 one-time.

Telemetry: tick response now includes
`patched_census` + `patched_google` per-domain so cron logs reveal
the cascade ratio. After a few hundred dia ticks you can run

```sql
SELECT
  jsonb_path_query(content, '$.by_domain.dia.patched_census')::int AS dia_census,
  jsonb_path_query(content, '$.by_domain.dia.patched_google')::int AS dia_google
FROM net._http_response
WHERE created > now() - interval '2 hours'
  AND content::jsonb ? 'google_fallback'
ORDER BY id DESC LIMIT 10;
```

to confirm Google is contributing. Expected pattern: census 50-70% of
patches on the corrupted-data dia rows, google making up the rest.

### Why the geocoding investment matters beyond lease-comps

Several upcoming features depend on lat/lng coverage being high enough
that haversine ranking is meaningful, not "no comps near this subject":

- **Lease comps export** (the one this round was built for) — already
  uses lat/lng + haversine in `_udExportLeaseComps`.
- **Nearby owners** (planned) — find all properties owned by the same
  recorded_owner within N miles of the subject, for outreach lists.
- **Competitor analysis** (planned) — for a dialysis subject, what are
  the next 5 nearest dialysis facilities? Useful for tenant
  concentration / replacement risk.
- **Nearby sales** (planned) — recently-closed sales_transactions
  within N miles for a price/SF anchor.

Anything that ranks "near this subject" needs a critical mass of
geocoded comparables. Below ~70% domain coverage, most subjects
return empty result sets and the feature looks broken even though
the SQL is correct. That's why the cron + Google fallback is worth
the spend even at $40 backfill + ~$5/month steady-state.

### medicare_clinics city un-truncation (Round 76gn.c, 2026-05-08)

Pre-flight investigation of "what if we sync property city/state from
the linked CMS facility?" turned up the opposite problem: a historical
CMS ingest had truncated `medicare_clinics.city` to ~11 characters
(`STATEN ISLA`, `OKLAHOMA CI`, `RAINBOW CIT`, etc.) for 1,026 rows,
while the property records carried the un-truncated values from a
different pipeline. We did a one-shot data fix that propagates the
property's city back to medicare_clinics for every (mc, p) pair where
mc.city is a strict case-insensitive prefix of p.city, length(mc.city)
>= 6, and states match. **Direction is property → CMS, not the other
way around** — properties are the trusted side.

Result: 1,026 medicare_clinics rows fixed, leaving 215 (177 city_diff
+ 38 state_diff) for human review via a new
`v_property_cms_link_suspect` view. That view scores each row with
`suspect_kind` (`state_diff` is highest concern), `street_looks_unrelated`
(first 6 alnum chars of address differ — strong bad-link signal), and
`zip5_matches` (cities differ but zip+street match → likely
neighborhood-vs-municipality alias, low concern).

Migration:
`supabase/migrations/dialysis/20260508120000_dia_round_76gn_c_cms_property_link_suspect.sql`.

The fix does **not** directly improve the geocode-tick cron's hit rate
— that cron pulls from `properties`, not `medicare_clinics`. The value
is downstream: every `v_clinic_*` view now shows clean city names, and
the medicare_clinics rows can serve as a clean address source for any
future CMS-seeded geocoding pass.


## CMBS loan-history + LLC research pipeline (Round 76ek series, 2026-05-08)

End-to-end ingestion for CoStar's CMBS Loan Detail and Financials tabs,
plus owner-LLC research enrichment. Schema, parsers, writers, and worker
endpoint all in place; tested via real captures, observable via
`v_cmbs_pipeline_health` views on each domain.

### What lands where

- **CoStar `/detail/lookup/{N}/loan` (CMBS Loan Detail tab)** →
  `data.loan_records[]` → `upsertLoanRecords` writes:
  - `loans` row (extended with servicer, special_servicer, sponsor,
    originator, num_delinquent, modification, watchlist,
    special_servicing, status_at_disposal, balloon_maturity,
    pay_frequency, num_collateral, pct_of_total_loan,
    origination_appraisal, appraisal_date, costar_loan_id, source_url).
  - `loan_snapshots` row keyed by (loan_id, as_of_date) — gov always;
    dia gated on `dia.properties.track_cmbs_snapshots`.
  - `loan_top_tenants` rent-roll snapshot per loan_snapshot.
  - `loan_commentary` rows from the section walker AND the auto-pager
    (Round 76ek.d clicks through "X of N Commentary Entries").
- **CoStar `/detail/lookup/{N}/loan` simple non-CMBS layout** → same
  `data.loan_records[]` envelope; parser also captures Borrower into
  `loans.recorded_owner_id` via lookup-only (no auto-create).
- **CoStar `/detail/lookup/{N}/cmbs-financials` Property+Totals mode**
  → `data.property_financials[]` → `upsertPropertyFinancials` writes
  `property_financials` rows. Drops Market mode and Per-SF mode at the
  source, skips Underwritten column (lender pro-forma, not actual),
  tags YTD partial-year columns with `months_covered<12`.

### Critical schema gotcha (Round 76ek.k, 2026-05-08)

`gov.property_financials` had a pre-existing 98k-row legacy table with a
totally different column set (`financial_id` PK; `total_re_taxes` /
`total_opex` / `noi_psf`; no `is_actual`, `gross_income`, `vacancy`,
`source`). Round 76ek.a's CREATE TABLE IF NOT EXISTS was a silent no-op
against it; Round 76ek.e's writer was silently failing on every gov
capture. Round 76ek.k aligned the schemas via ADD COLUMN and made the
writer + cap-rate provenance helper PK-aware (`financial_id` for gov,
`id` for dia). Migration:
`supabase/migrations/government/20260508130000_gov_round_76ek_k_pipeline_health_views.sql`.

### LLC research enrichment

`recorded_owners` extended with `manager_name`, `manager_role`,
`registered_agent_name`, `registered_agent_address`, `filing_state`
(gov) / `state_of_incorporation` (dia), `filing_id`, `filing_date`,
`filing_status`, `llc_research_at`, `llc_research_source`. Per-domain
`llc_research_queue` table populated automatically by `upsertDomainOwners`
when a new private-LLC owner gets created (filtered by suffix:
LLC / LP / LLP / Inc / Corp / Trust / Holdings / etc., excluding
federal-government anti-pattern names).

Worker endpoint: `?_route=llc-research-tick` (rewritten to
`/api/llc-research-tick`). GET = dry-run, POST = drain. Feature-flagged
on `OPENCORPORATES_API_KEY`; without the key, queue rows stay queued so
a later run resumes when the key (or a free SOS-direct handler) lands.
**User preference: free SOS-direct scrapers over paid OpenCorporates** —
deferred to a future round.

### Federal-government anti-pattern guard (Round 76ek.i)

CoStar's "Recorded Owner" / "Current Owner" panel sometimes pulls from
county personal-property records (federal agencies leasing equipment in
the building) rather than real-property records. When a federal-leased
office shows up with "U S A" / "Government" as the recorded owner but a
private LLC in deed_records / sales_history, the USA candidate is the
personal-property bleed-through and would otherwise overwrite the real
owner. `selectAuthoritativeOwner()` and `isFederalOwnerAntiPattern()` in
`api/_handlers/sidebar-pipeline.js` filter these unless they're the only
candidate (genuinely federally-owned buildings still come through).

### Cap-rate NOI provenance (Round 76ek.f)

Each gov sale's `cap_rate` now carries `cap_rate_noi_source_table`,
`cap_rate_noi_source_id`, and `cap_rate_quality` (`cmbs_audited` /
`om_actual` / `om_pro_forma` / `market_implied`). Resolved by
`resolveCapRateProvenance()` walking a four-tier ladder: CMBS loan
snapshot in the 18 months before the sale → property_financials actuals
in the same FY or year-prior → metadata.noi presence (pro-forma) →
fallback market_implied. Restricted to gov; dia cap rates come from
net rent (NNN structure), not NOI.

### Junk-value filters added in this series

Extending the existing `isJunkTenant()` / `isJunkContactName()` /
`isContactNameGarbage()` filters:

- **Industry-role tenants** (Round 76ek.g): "Retailer" / "Wholesaler" /
  "Distributor" / "Operator" / "Service Provider" — bare role labels
  CoStar emits in tenant-mix columns. Anchored ^...$ so legit names
  like "Joe's Retailer LLC" still pass.
- **Verification footnote sentences** (Round 76ek.g): "The sale price
  RBA were verified with listing broker", "The deed was unavailable at
  the time of publication." — sentence-shape detector for any 4+-token
  string starting with a determiner (the/this/a/an/it) and containing
  a tense marker (was/were/is/are/has/have/verified/unavailable/...).
- **"SF Avail" property_type leak** (Round 76ek.g): two-layer fix at
  the parser (extractFields next-line filter) + sidepanel.js asset_type
  derivation. Rejects `\b(avail|available)\b` + leasing-status labels
  (for lease, asking, smallest space, max contiguous, vacant).

### Pipeline observability

```sql
-- Top-of-funnel: count what's been captured
SELECT * FROM v_cmbs_pipeline_health;

-- Queue depth + retry health
SELECT * FROM v_llc_research_queue_health;

-- Cap-rate quality distribution (gov DB; dia normally all NULL)
SELECT cap_rate_quality, count(*)
FROM sales_transactions
GROUP BY cap_rate_quality
ORDER BY 2 DESC;
```

Both views live on gov + dia DBs.


## BD Engine — Developer / Owner / Listing-Event Doctrine (2026-05-22)

End-to-end BD data layer shipped in topics 10–20 across a single
session. See `docs/BD_ENGINE_POST_WORK_AUDIT_2026-05-22.md` for the
post-work audit and `DEVELOPER_BD_AUDIT_v3.md` §11.22 – §11.37 for the
full per-topic implementation log.

### Core artifacts (LCC Opps)

**Tables:**
- `lcc_entity_portfolio_facts` (5,888 edges) — per (entity, source_domain, source_property_id) ownership row
- `lcc_property_attributes` (30,625 rows) — synced address, lat/lng, size, year, lease, SAM/federal-award signals
- `lcc_listing_events` (293 backfill rows) — pulled from dia + gov sales_transactions
- `lcc_operator_affiliate_patterns` (18 rules) — operator → subsidiary-name patterns
- `lcc_onboarding_schedule` (7 rows) — 7-touch onboarding cadence rules
- `lcc_*_sync_inflight` (4 tables) — pg_net request tracking

**Views (all SECURITY INVOKER):**
- `v_priority_queue` — 8 doctrinal bands (P0/P0.5/P1/P2/P3/P4/P5/P6/P7/P8)
- `v_priority_queue_enriched` — queue + portfolio rollup + property context
- `v_entity_portfolio_all` — per-entity portfolio rollup (cross-vertical aware)
- `v_bd_cadence_dashboard` — per-cadence dashboard with portfolio context
- `v_lcc_listing_event_queue` — listing events + resolved buyer/seller +
  `is_sale_leaseback`
- `v_lcc_operator_affiliates` / `v_lcc_operator_effective_portfolio` —
  affiliate resolution + concentration math
- `v_lcc_merge_candidates` — fuzzy duplicate candidates for review

**Functions:**
- Sync pairs (4): `lcc_sync_*` + `lcc_finalize_*` for entity, portfolio,
  property attributes, listing events
- Fan-out functions (3): `lcc_listing_same_owner_cohort` /
  `_buyer_cohort` / `_geographic_neighbors`
- Cadence: `lcc_seed_onboarding_cadence`, `lcc_advance_onboarding_cadence`,
  `lcc_steady_state_interval_days`, `lcc_open_prospect_opportunity`,
  `lcc_mark_listing_event_processed`
- Entity ops: `lcc_normalize_entity_name`, `lcc_merge_entity`,
  `lcc_apply_fuzzy_merges`

**Triggers:**
- `bd_opportunity_auto_seed_cadence` on `bd_opportunities` — seeds cadence
- `activity_event_advance_cadence` on `activity_events` — advances cadence
  on email/call/meeting

**pg_cron (all UTC, registered + `active=true`):**
- `:05/:10` every 4h — entity sync (true_owners → entities)
- `:15/:20` every 4h — portfolio sync (ownership_history → portfolio_facts)
- `:25/:30` every 4h — listing events (sales_transactions → listing_events)
- `:35/:40` daily at 4am — property attributes
- `:45` hourly — pg_net response cleanup (>24h)

### Activation requirement

All four pg_net sync functions read from `vault.decrypted_secrets`:
- `dia_supabase_url` / `dia_supabase_anon_key`
- `gov_supabase_url` / `gov_supabase_anon_key`

If a secret is missing, the sync function logs a NOTICE and skips.
Cron jobs run idempotently on the no-op path until secrets land.

### Gov-side anon-readable views

Three slim views expose non-PII slices of RLS-protected gov tables so
LCC's pg_net pulls work as anon:
- `gov.v_ownership_history_portfolio`
- `gov.v_property_attributes_portfolio`
- `gov.v_sales_transactions_portfolio`

When adding new BD-relevant columns to gov, extend these views (not
the underlying tables) to avoid loosening RLS on PII fields.

### Architectural gotchas (learned during the session)

1. **`CREATE OR REPLACE VIEW` is append-only** for columns. Postgres
   42P16 if you try to insert columns in the middle. All BD views
   add new columns at the end of the SELECT.

2. **`lcc_merge_entity` uses two-step DELETE-then-UPDATE** (not a
   single CTE) because the CTE form's pre-snapshot semantics caused
   PK collisions on portfolio_facts. See migration
   `20260522305000_lcc_merge_entity_dedupe_fix.sql`.

3. **PL/pgSQL `#variable_conflict use_column`** required in every
   function with a `RETURNS TABLE` whose OUT params share names with
   column names (most BD functions hit this).

4. **`days_overdue` is overloaded** in the priority queue. P0/P6/P7
   carry literal days. P4 carries acquisition streak count. P5 carries
   building age in years. P8 carries SAM solicitations count.
   The `reason` column disambiguates; operator console should
   interpret per band.

5. **`bd_opportunities.is_open`** is `GENERATED ALWAYS AS (closed_at
   IS NULL)` — omit from INSERT.

6. **`lcc_entity_portfolio_facts.is_current`** is `GENERATED ALWAYS
   AS (ownership_end_date IS NULL) STORED` — same constraint.

### Quick-reference queries

```sql
-- Priority queue snapshot
SELECT priority_band, COUNT(*) FROM v_priority_queue GROUP BY 1 ORDER BY 1;

-- Operator dashboard for an entity
SELECT * FROM v_bd_cadence_dashboard WHERE entity_name ILIKE '%elliott bay%';

-- Listing event fan-out for any property (Lanes 1/2/3)
SELECT * FROM lcc_listing_same_owner_cohort('dia', '26621');
SELECT * FROM lcc_listing_buyer_cohort('dia', '30281', 50, 36, 15);
SELECT * FROM lcc_listing_geographic_neighbors('dia', '26621', 10, 20);

-- New sales events to triage
SELECT * FROM v_lcc_listing_event_queue
WHERE processed_at IS NULL ORDER BY event_date DESC LIMIT 20;

-- Cron job health
SELECT jobname, status, return_message, start_time
FROM cron.job_run_details
WHERE jobname LIKE 'lcc-%-sync%'
ORDER BY start_time DESC LIMIT 10;
```
