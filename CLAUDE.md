# Claude Code / Cowork Instructions — Life Command Center

> **CRITICAL: Read .github/AI_INSTRUCTIONS.md before modifying any files in /api/.**

## ⚠️ PRODUCTION RUNS ON RAILWAY, NOT VERCEL (confirmed 2026-06-04)

The live app is the **Railway Express server**: `server.js` mounts the /api/*
handlers directly (e.g. `app.all('/api/capital-markets', capitalMarketsHandler)`);
build config in `nixpacks.toml` + `railway.json` (healthcheck `/health`).
`vercel.json` is LEGACY for the live app. Practical consequences:

- **JS/code changes ship via a Railway redeploy of merged `main`** — telling the
  user to "deploy to Vercel" does nothing for the live export path. (This caused
  a full day of stale Capital-Markets exports on 2026-06-03/04: views were fixed
  live, but Railway served an old JS build with since-removed master_m mappers.)
- **Supabase view/migration changes are live immediately** — the CM export reads
  views per request (`no-store`), no deploy needed for data-layer fixes.
- The Vercel sections below (12-function limit, vercel.json rewrites) are kept
  for the legacy config; don't let them imply Vercel is the deploy target.

## Vercel Hobby Plan Constraint

HARD LIMIT: 12 serverless functions max (12 .js files in /api/).
Currently at 9 functions (Phase 4b freed 3 slots via edge migration).
data-proxy, daily-briefing, diagnostics absorbed into admin.js + Supabase Edge Functions.

## Rules

0. LCC_API_KEY auth is production-ready (Phase 6b). Frontend auth.js auto-injects X-LCC-Key via global fetch interceptor. To enforce: set LCC_API_KEY + LCC_ENV=production in Vercel — **in that order**. Flipping LCC_ENV first (key empty, no OPS_SUPABASE_URL JWT path) 401s every request = total sign-in lockout. Verify readiness first via `GET /api/diag?kind=auth-ready` (`would_pass_in_production` must be true). Full rollout/rollback runbook + blast radius: `docs/AUTH_ENFORCEMENT_ROLLOUT.md`. A cold-start `console.error` guard in `auth.js` warns if enforcement is on with no credential source.
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

7. **`vertical` / `source_domain` are canonical short-form `dia`/`gov`**
   (E2E#5, 2026-06-03 — third dia/gov alias bug after `getDomainCredentials`
   and QA#9). Writers normalize on the way in: `bridgeCreateLead` writes
   `normDomain`, `lcc_open_prospect_opportunity` and `lcc_seed_onboarding_cadence`
   CASE-map `dialysis→dia`/`government→gov` (the cadence the auto-seed trigger
   spawns inherits the canonical `bd_opportunities.vertical`).
   `v_priority_queue_enriched` re-normalizes at the view boundary AND guards
   `WHERE entity_id IS NOT NULL AND <normalized vertical> IS NOT NULL` so orphan
   seed cadences (NULL domain, no portfolio/opp/contact) can't pollute the
   bands. `entities.domain` also carries a legit third value `lcc` (LCC-internal
   entities) — never remap that. Consumers filtering `source_domain` should
   accept both forms during transition (`in.(dia,dialysis)`), as
   `handlePriorityBand` now does. Migration:
   `20260603130000_lcc_bd_vertical_domain_canonicalize.sql`.

8. **`lcc_seed_onboarding_cadence` must ON CONFLICT on the unique INDEX,
   not a constraint** (E2E#6 blocker, 2026-06-03). The seed's idempotency
   probe keys on `(entity_id, bd_opportunity_id)`, but `touchpoint_cadence`'s
   real uniqueness is the **unique INDEX** `uq_cadence_contact_property` on
   `(COALESCE(entity_id,zero), COALESCE(property_id,zero), COALESCE(sf_contact_id,''))`.
   Any entity carrying one of the ~305 pre-seeded BD-engine cadence rows
   (property/sf NULL, different/NULL `bd_opportunity_id`) was invisible to the
   probe but collided on the index → the seed `INSERT` raised `23505` → the
   `AFTER INSERT` `bd_opportunity_auto_seed_cadence` trigger aborted the parent
   `bd_opportunities` INSERT, so create_lead/open_opportunity silently produced
   no opportunity for a wide class of entities. Fix: the seed INSERT now carries
   `ON CONFLICT (<the index expression>) DO UPDATE` that reactivate-and-links
   the pre-existing row to the new opportunity (set `bd_opportunity_id`, revive
   `phase='onboarding'`, reset touch, `next_touch_due=now()`). Because it's a
   `CREATE UNIQUE INDEX` (not a table constraint), you MUST use the
   index-inference / expression form — `ON CONFLICT ON CONSTRAINT
   uq_cadence_contact_property` errors `42704`. Migration:
   `20260603150000_lcc_seed_cadence_on_conflict_link.sql`.

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

## sf_sync_log retention + disk-pressure alert (2026-05-29 outage fix)

Sign-in to LCC broke with HTTP 500 "Database error granting user". Root
cause: the **LCC Opps** DB filled its disk and Supabase forced it
**read-only**, so GoTrue (auth) could not INSERT session / refresh-token
rows (`SQLSTATE 25006: cannot execute INSERT in a read-only transaction`).
Reads kept working, so only sign-in appeared broken. **LCC auth lives on
this DB — disk-full here = total sign-in lockout, not a degraded feature.**

What filled it: a one-time Salesforce backfill (May 15-27) wrote 126k
`object_intake` rows to `public.sf_sync_log`. Live `payload` was only
~292 MB, but the table bloated to 5.5 GB (4 GB TOAST + 1.3 GB heap)
because **autovacuum never ran on it** (`last_autovacuum = null`) and
there was no retention policy.

Fixes (migration `20260529120000_lcc_sf_sync_log_retention_and_disk_health.sql`,
LCC Opps + edge-function change):

- **Source trim** — `intake-salesforce/index.ts` no longer stores
  `payload` on `status='ok'` rows. payload is only read back by
  `handleRetry` (`status='error'` rows); success rows keep their ID
  columns for audit. Stops payload from TOASTing going forward.
- **`sf_sync_log_prune(interval, boolean)`** + cron `sf-sync-log-prune`
  (04:50 UTC) — deletes terminal `object_intake` rows (`ok`/`skipped`)
  older than 30d. NEVER touches `crawl_run` (watermark), `error` (retry
  queue), `dead` (manual queue), or `link_all`. Bounds row count.
- **Autovacuum hardening** on `sf_sync_log` (heap + TOAST scale_factor
  0.05) so churn is reclaimed instead of bloating again.
- **`lcc_check_disk_health(warn_gb, crit_gb)`** + cron
  `lcc-disk-health-check` (hourly :50) — opens a `disk_pressure` alert in
  `lcc_health_alerts` (surfaced by `v_cron_health_summary` + daily
  briefing) when DB size crosses thresholds; auto-resolves when it drops.
  Postgres can't read the disk cap, so defaults (warn 11 / crit 12.5 GB)
  are tuned to the ~13 GB read-only point — **raise them after provisioning
  more disk.**

One-time reclamation (NOT in the migration — `VACUUM FULL` can't run in a
migration tx; non-destructive, keeps every row, run in a low-traffic
window):
```sql
UPDATE public.sf_sync_log SET payload = NULL
 WHERE sync_type='object_intake' AND status IN ('ok','skipped') AND payload IS NOT NULL;
VACUUM FULL public.sf_sync_log;   -- reclaims ~5 GB to the OS
```

### Artifact inline_data → Storage offload (follow-up)

`staged_intake_artifacts` (~6 GB) is the next-largest consumer: large
email/copilot OM files are stored base64 in `inline_data` at ingest
(`intake-om-pipeline.js`, no `storage_path`). Rather than delete them
(irreversible loss of the raw OM), they're offloaded to the
`lcc-om-uploads` Storage bucket with `inline_data` cleared — transparent to
readers (`intake-extractor.js` getArtifactBytes + the download handler fall
back to `storage_path`).

- Worker: `api/admin.js handleArtifactOffload` → `/api/artifact-offload`
  (GET = dry-run, POST = drain). Eligible = `inline_data` not null,
  `storage_path` null, older than `grace_minutes` (default 15, so the
  inline-based initial extraction finishes first). Uploads with
  `x-upsert` to a deterministic per-row path, then PATCHes
  `storage_path`/`inline_data` guarded on `storage_path IS NULL` — so
  partial failures and re-ticks are no-ops, never duplicates or data loss.
  Time-budgeted (~7s) for the Vercel function limit.
- Cron `lcc-artifact-offload` (`2-59/10 * * * *`, migration
  `20260529130000_lcc_artifact_offload_cron.sql`) drains ~15/tick; the ~1k
  large rows clear in ~11h, then it just offloads new inline artifacts as
  they arrive (caps growth). **The cron + endpoint go live together on
  deploy** — the endpoint 404s until `admin.js` ships, so don't apply the
  cron migration ahead of the Vercel deploy. Verify post-deploy with a GET
  dry-run before relying on the cron.

## external_identities canonicalization (R4-A, 2026-06-04)

`public.external_identities` (LCC Opps) had **five** source_system spellings
and two source_type conventions for the **same two concepts**, fragmenting the
entity graph (4th dia/gov alias-class bug, worst form). The canonical scheme —
now the single source of truth — is:

| concept | source_system | source_type | external_id |
|---|---|---|---|
| domain property-anchor entity (the "asset") | `dia` / `gov` | `asset` | domain `properties.property_id` |
| domain owner entity | `dia` / `gov` | `true_owner` | `true_owner` id (UUID = entity id) |
| vendor / channel rows | `costar` / `rca` / `crexi` / `loopnet` / `salesforce` / `email_intake` … | as-is | vendor id |

- **`asset` and `property` mean the same thing for domain rows** — collapsed to
  `asset` (matches `entities.entity_type='asset'` and the
  `20260603140000` create-lead cleanup convention). `clinic`/`facility` are
  also synonyms → `asset`. Vendor `property` rows (costar/rca/crexi listing
  ids) are **left as `property`** — they are not domain rows.
- Deprecated spellings now banned: `dia_db`, `dia_supabase`, `dialysis`,
  `gov_db`, `gov_supabase`, `government`.
- **`email_intake` is NOT a domain DB** — its `external_id` is a
  `staged_intake_items.intake_id` (UUID), not a domain property id (verified:
  231/231 UUIDs). It is a distinct intake-channel identity and is left as-is.

### The one choke point

Every `external_identities` writer routes its `source_system`/`source_type`
through **`canonicalIdentitySystem()` + `canonicalDomainSourceType()`** in
`api/_shared/entity-link.js`. `ensureEntityLink` calls them on every write, and
the three direct-`POST` paths (`sidebar-pipeline.js` domain bridge,
`domains.js` connector sync, `entities-handler.js` `?action=link`) call
`canonicalIdentitySystem()` explicitly. The BD owner-sync SQL function
`lcc_finalize_classified_owners()` writes the canonical `v_domain` (`dia`/`gov`)
directly (was `v_domain || '_supabase'`). **Add a 6th spelling nowhere else —
funnel through the helper.**

A `CHECK (source_system IN (canonical + vendor allow-list))` constraint
(`chk_external_identities_source_system`) enforces this at the DB. ⚠️ It lives
in migration `20260604121000` and **must be applied only AFTER the Railway
redeploy** of the canonical JS writers — the currently-deployed writers still
emit `dia_db`/`gov_db`, so applying it early would 500 every CoStar capture /
intake promotion. Same deploy-ordering rule as always: constraint after writer
deploy.

### Junk entity-name guard

`isJunkEntityName()` (entity-link.js) rejects structural garbage at the entity
creation/sync boundary — embedded phone numbers, emails, `(p)/(c)/(m)/(f)`
phone-type labels, and CoStar "Buyer/Seller Contacts" panel-header
bleed-through (e.g. P0.5's `Seller ContactsCraig Burrows(916) 768-5544 (p)`).
Unlike the sidebar's `isJunkContactName`, it does **not** reject firm-suffix
names, so it is safe to run on `organization` entities. `ensureEntityLink`
returns `{ok:false, skipped:'junk_entity_name'}` instead of minting the entity;
`lcc_finalize_classified_owners()` filters the same patterns in SQL. Existing
junk entities were soft-flagged (`entities.metadata.junk_name_flagged=true`),
never hard-deleted.

### Migrations / one-time normalization (applied live to LCC Opps 2026-06-04)

- `20260604120000_lcc_external_identities_canonicalize.sql` — dedup (keep
  oldest per canonical key), collapse `property→asset` (2,521 rows), normalize
  source_system (6,900 rows; 2 collisions removed), soft-flag junk entities
  (41). Idempotent.
- `20260604120500_lcc_finalize_classified_owners_canonical.sql` — writer fix +
  junk filter on the BD owner-sync function (safe to apply anytime).
- `20260604121000_lcc_external_identities_source_system_check.sql` — CHECK
  constraint, **deferred to post-Railway-deploy**.

Audit: `SELECT source_system, source_type, count(*) FROM external_identities
GROUP BY 1,2` should show only canonical (`dia`/`gov`) + vendor systems.

## R5 — SPE→parent reconciliation + buyer-vs-prospect doctrine (2026-06-05)

Repeat-buyer SPE shells (NGP/Easterly/Boyd/UIRC… on gov; Elliott Bay/SMBC/
AEI… on dia) were polluting the top of the **P0.5** "needs an opportunity"
band — 86 of 491 P0.5 rows were buyer SPEs. Doctrine (Scott, grounded live
2026-06-05): **one buyer, one account**; top repeat buyers are *buy-side
relationships* (showings + buy-side outreach), never standard prospect
opportunities; any buyer opportunity goes on the actual **parent** account in
Salesforce, never the subsidiary SPE; SPE→parent reconciliation is a GATE that
runs BEFORE opening. Landed before the "⚡ Open top 20" bulk action got real use.

### What shipped (LCC Opps — applied live 2026-06-05)

- Migrations `20260605120000_lcc_r5_buyer_parent_registry.sql` (registry,
  read-only/additive) + `20260605120500_lcc_r5_buyer_gate_and_queue.sql` (gate +
  queue). Both idempotent.
- **Extends the operator-affiliate machinery, doesn't fork it.**
  `lcc_operator_affiliate_patterns` gained a `relationship` column
  (`operator` default | `buyer_parent`). The three existing OPERATOR consumers
  (`v_lcc_operator_affiliates`, `v_lcc_operator_effective_portfolio`,
  `v_lcc_listing_event_queue`) are now scoped `relationship='operator'` so
  buyer patterns can't corrupt operator concentration / sale-leaseback logic.
  **Any new operator consumer of that table MUST filter `relationship='operator'`.**
- **24 buyer parents** registered in new table `lcc_buyer_parents`
  (parent_entity_id PK, domain, sf_account_id, needs_sf_mapping, …). The seed
  reuses the cleanest existing org entity per buyer, creating one only where
  absent (UIRC, US Federal Properties Trust, USGBF). **USGBF sponsor is
  unconfirmed — flagged `needs_sf_mapping` + a note for Scott to confirm.**
  SF parent-account ids prefilled from `external_identities (salesforce,
  Account)` (7/24 mapped).
- **Classification (inspectable):** `v_lcc_buyer_spe_candidates` (prefix tier +
  empirical-portfolio tier — the entity's current property's latest sale lists a
  registered parent as buyer), `v_lcc_buyer_spe_entities` (+ parent_self for the
  gate), `v_lcc_buyer_parent_rollup` (SPE portfolio rolled up per parent),
  `v_lcc_buyer_name_canonical` (buyer-name fragmentation normalizer for
  analytics). Resolver: `lcc_resolve_buyer_parent(entity)`.
- **The GATE.** `lcc_open_prospect_opportunity` now returns an APPENDED refusal
  payload `(…, blocked, parent_entity_id, parent_name)` — backward-compatible,
  so DB-first or JS-first deploy is both safe. A **BEFORE-INSERT trigger**
  `trg_bd_block_repeat_buyer_prospect` on `bd_opportunities` is the hard
  guarantee: a `type='prospect'` opp can never be created for a buyer
  parent/SPE on ANY path (incl. `bridgeCreateLead`'s direct insert), so the gate
  is deploy-order-proof. `bridgeCreateLead` already treats opp-insert failure as
  non-fatal.
- **Government Buyer opportunity.** `bd_opportunities.type` CHECK widened to add
  `government_buyer` (widening only — deploy-safe). `lcc_open_government_buyer_opportunity(entity)`
  resolves an SPE to its parent, idempotently opens ONE open `government_buyer`
  on the PARENT, and reports `needs_sf_mapping`. Does NOT auto-seed a cadence
  (the cadence trigger only fires on `type='prospect'`).
- **Queue lane.** `v_priority_queue` drops buyer SPEs out of P0.5
  (`NOT IN v_lcc_buyer_spe_entities`) and adds a **P-BUYER** lane: one row per
  parent with the SPE portfolio rolled up (count / rent / last acquisition).
  `v_priority_queue_enriched` gained appended `buyer_*` columns.
  `v_priority_queue_band_counts` surfaces P-BUYER automatically.
- **SF routing.** `lcc_buyer_parents.sf_account_id` is the routing source of
  truth. `v_lcc_government_buyer_sync_health` reports each open government_buyer
  as `synced` / `ready_to_sync` / `hold_unmapped`. The opportunity sync MUST use
  the mapped PARENT sf_account_id and HOLD when unmapped — never route to a
  subsidiary. Unmapped opens log a research task ("map <Parent> to SF parent
  account") via `activity_events`.

### JS (ships on Railway redeploy of merged `main`)

- `api/operations.js`: `resolveBuyerParent()` helper; create_lead GATE (refuses
  before any lead/opp); `open_opportunity` surfaces the refusal; new
  `open_government_buyer` action (logs the SF-mapping research task when unmapped).
- `ops.js`: bulk "Open top N" skip-and-reports repeat buyers (never fails the
  batch); P-BUYER lane renders the rollup + a single "Open Government Buyer
  opportunity →" CTA; refusal on a P0.5 open reroutes to the buy-side path.
- `api/admin.js`: `BAND_ORDER` includes `P-BUYER`; queue select carries the
  `buyer_*` rollup columns.
- `detail.js`: property-flow create-lead handles the refusal (offers the
  Government Buyer path on the parent).

### Verified live 2026-06-05
86/491 P0.5 → buyer SPEs (NGP 31, Easterly 21, Boyd 15, UIRC 14…); after rewrite
P0.5 = 402, **0 buyer SPEs remain in P0.5**, P-BUYER = 18 parents. Gate test:
`open_opportunity` on "NGP VI FALLS CHURCH VA LLC" → `blocked=repeat_buyer_spe`,
parent=NGP Capital. `open_government_buyer` from the SPE → one opp on NGP parent;
second call → `already_open`. Trigger blocks a direct prospect insert on a buyer
SPE. Zero open prospect opps leaked onto buyer entities (clean ground). Test
artifacts cleaned up.

## R6 — ownership-resolution gating + chain-to-developer doctrine (2026-06-06)

Refines R5. The Priority tab is a ranked hierarchy of *next best actions*. An
opportunity is only the next action when the control structure is **already
resolved AND connected**. R5's gate worked, but P0.5 still showed "Open
opportunity →" on entities whose ownership wasn't resolved/connected. Grounded
live 2026-06-06: of 402 P0.5 entities only **16** carry any Salesforce identity
and **0** carry a linked contact — ~386 were mis-CTA'd.

### Doctrine
- An SPE shell must reconcile to its true owner/parent BEFORE an opportunity.
- **Per-row domain truth OUTRANKS name patterns.** Live gov data refuted the
  literal R6 ask: "* FGF *" splits across Boyd Watterson, **The Shooshan Company
  (incl. the headline "ARLINGTON VA I FGF")**, Hyundai Securities, Lexington,
  Mountain Real Estate, Princeton Holdings, The Boyer Co., …; "OPI WF OWNER LLC"
  → **RMR** (not GPT). So NO blind `% FGF%`→Boyd / `OPI %`→GPT entity-name
  patterns were registered — tier-0 consumes the domain `true_owner` per
  property instead, resolving only to a REGISTERED parent.

### What shipped (LCC Opps — migrations, applied in filename order)
- `government/20260606120000_gov_v_property_owner_facts_portfolio.sql` — new
  anon view exposing per-property `recorded_owner_name` / `true_owner_name` /
  `developer_name` (names only, PII-free). **Apply FIRST** (before the LCC sync).
- `20260606121000_lcc_r6_owner_facts_and_resolution.sql` — `lcc_property_owner_facts`
  mirror; `lcc_match_buyer_parent_by_name()`; `lcc_is_spe_shell_name()`;
  **tier-0** prepended to `lcc_resolve_buyer_parent()` (same signature → R5 gate
  trigger + JS + queue inherit it); tier-0 UNION added to `v_lcc_buyer_spe_entities`
  / `_candidates` (so domain-truth matches roll into **P-BUYER**); RMR true_owner
  aliases (`rmr`, `the rmr group`); inspectable `v_lcc_entity_resolution_state`.
- `20260606121500_lcc_r6_priority_queue_p04_gate.sql` — new **P0.4 "Resolve
  ownership & control"** band AHEAD of P0.5. **Gate = entity-level connection**
  (Salesforce Account identity OR a linked person/contact). Connected (16) stay
  P0.5; the rest (386) move to P0.4 with a representative property attached
  (229 routable into the resolution ladder, 157 owner-level). Enriched view
  appends `resolve_reason` / `resolve_true_owner_name` / `resolve_is_connected`
  cheaply (no resolver on the hot path). **Apply AFTER the 121000 file.**
- `20260606122000_lcc_r6_owner_facts_sync.sql` — isolated cross-DB sync
  (`lcc_sync_property_owner_facts` / `_finalize` + crons `lcc-r6-owner-facts-
  sync`/`-finalize`). gov only; dia deferred. Graceful: empty mirror ⇒ resolver
  + views behave exactly as R5 (no regression). **Apply AFTER the gov view.**
- `20260606122500_lcc_r6_ownership_chain_and_research.sql` — Task 3(a)/(b):
  `v_lcc_ownership_chain_completeness` (gov; current owner is a categorized
  buyer ⇒ should trace back to a developer; `chain_complete` /
  `earliest_known_owner` / `missing_segments`) + `lcc_generate_chain_research_
  tasks()` writing `research_tasks(research_type='trace_ownership_to_developer')`
  prioritized by rent (cron `lcc-r6-chain-research`). Phase 3(c) — connecting
  each historical chain owner (ensureEntityLink + contact) — **DEFERRED** to the
  existing entity-link machinery.

### JS (Railway redeploy of merged `main`)
- `api/admin.js`: `BAND_ORDER` adds `P0.4`; both queue handlers select the
  `resolve_*` columns; `/api/priority-band` returns them for the detail banner.
- `ops.js`: `_pqReason` (`resolve_ownership_control` → "Resolve ownership &
  control"), `_pqCtaState` new `'resolve'` state, P0.4 row context ("True owner:
  X — connect" / "Recorded owner shell — true owner unresolved"), **"Resolve
  owner →"** CTA (routes to the property Ownership&CRM ladder, or `pqResolveOwner`
  for owner-level rows). P0.4 stays OUT of the bulk "Open top N" set.
- `detail.js`: Next-Step banner inserts a "Resolve ownership & control" step
  (before "Create the lead") when the band is P0.4 and `resolve_is_connected` is
  false — same state source as the queue (R4-C pattern).

### Verified live (read-only, 2026-06-06)
P0.5 402 → after gate **16 stay / 386 → P0.4** (229 with a representative
property). Tier-0 name-match: `Boyd Watterson`→`Boyd Watterson Global`;
`The Shooshan Company`/`Mountain Real Estate`→null (ARLINGTON correctly does NOT
roll to Boyd — stays P0.4); `RMR`/`The RMR Group`→`RMR Group` (OPI-WF resolves
once the mirror is populated). Shell detector: FGF/OWNER-LLC shells true;
Avalon/Truist/Embree/Boyd false. No R5 regression (empty mirror ⇒ R5 behaviour;
buyer-SPE gate + P-BUYER intact). `node --check` clean; `ls api/*.js | wc -l`=12.

### NOTE FOR SCOTT
- The OPI/GPT anchor was **not** auto-renamed. Domain truth shows OPI WF → RMR
  (already registered), so "Office Properties Income Trust (OPI)" as a GPT alias
  isn't warranted by the data. Rename explicitly if you still want it.
- dia owner-facts leg + chain phase 3(c) are the obvious follow-ups.

## R7 Phase 0 — Decision Center perf prerequisite (Slice 1, 2026-06-07)

The priority queue read floor was ~5-7s unfiltered (PR #1062), which gated the
forthcoming Decision Center (it reads the same state). Slice 1 of R7 fixes the
floor with two cache tables on LCC Opps — both the proven cache-or-live pattern
(empty cache ⇒ exact live behavior, so deploy ordering is irrelevant and a
stalled cron only ever costs latency, never correctness). Applied live
2026-06-07; migrations committed too (idempotent re-apply safe).

### What shipped
- **`lcc_buyer_spe_resolved`** (migration `20260607120000`) — materializes
  `v_lcc_buyer_spe_entities` (~598 rows). That view's 4-branch UNION
  (`lcc_match_buyer_parent_by_name` LATERAL + a 9,934-org × 55-pattern LIKE
  nested loop) cost ~1.2s AND was mis-estimated at ~1.05M rows; it is consumed
  3× inside `v_priority_queue` (two NOT IN gates + the P-BUYER rollup) plus
  again in the enriched view, so the cardinality lie poisoned every downstream
  plan. The view is repointed at the cache; `v_lcc_buyer_spe_entities_live`
  holds the verbatim live body for the fallback + the refresh source.
  `lcc_refresh_buyer_spe_resolved()` + cron `lcc-buyer-spe-refresh` (*/15).
- **`lcc_priority_queue_resolved`** (migration `20260607120500`) — materializes
  `v_priority_queue` itself (~1,041 rows, exact 17-col shape).
  `v_priority_queue_band_counts` and `v_priority_queue_enriched` read
  `v_priority_queue` by name, so they inherit the speed-up with **no change to
  their own definitions**, and the planner — now seeing a real analyzed
  1,041-row table — switches the enriched portfolio/property joins from
  nested-loop-rescan to hash joins. `v_priority_queue_live` holds the full
  11-branch body (captured via a guarded dynamic copy — idempotent, no
  recursion on re-apply). `lcc_refresh_priority_queue_resolved()` + cron
  `lcc-priority-queue-refresh` (*/5, parity with `refresh_work_counts`).
- Both refreshes `ANALYZE` at the end (PR #1062 lesson). Both cache tables have
  autovacuum hardened (`scale_factor=0`, `threshold=500`) because the crons
  full-replace them each tick (sf_sync_log churn lesson). Tiny (≤480 kB).
- **`api/admin.js`** — the R6 hotfix's 25s timeout band-aid in
  `handlePriorityQueueList` is removed (`HEAVY` back to `{countMode:'none'}`,
  default fetch budget). This JS change ships on the Railway redeploy; it is
  safe in any order because the DB is already fast (applied live first).

### Verified live (read-only) 2026-06-07
- Latency: unfiltered enriched 5,785ms → ~1,140ms raw; items page (enriched +
  ORDER BY + LIMIT 150) ~866ms (`EXPLAIN ANALYZE, TIMING OFF`); band counts
  627ms → 68ms. Gate (queue API <1.5s, band counts <300ms) met.
- **Band membership byte-identical** pre/post: all 12 bands match on both count
  AND an md5 of the ordered entity-id set (P0.4=348, P0.5=16, P-BUYER=21, …).
- R5 gate intact: `lcc_resolve_buyer_parent('NGP VI FALLS CHURCH VA LLC')` →
  NGP Capital (domain_true_owner) → prospect refusal stands. R6 intact:
  ARLINGTON VA I FGF resolves to NULL and stays in P0.4 (not P0.5, not rolled
  to Boyd).
- Auth blast radius: nothing here touches the auth schema / GoTrue /
  public.users / workspace_memberships; no long locks; bounded-size tables.
  DB 9.6 GB, well under the 11/12.5 GB disk-health thresholds.

### Staleness contract (worklist, not real-time)
The queue cache refreshes every 5 min; band transitions keyed on
`next_touch_due<=now()` (P0/P6/P7) or connection/SPE/opp state
(P0.4/P0.5/P-BUYER) land within one interval. `days_overdue` is frozen at
refresh time (measured in days; minutes of lag are noise). A connect/verdict
action that should move a row out of a band can call
`lcc_refresh_priority_queue_resolved()` to update immediately — wire that in
Slice 2/3 when those actions land.

### Slice 2/3 (NOT in this slice)
`lcc_decisions` + `lcc_open_decision()` + Decision Center shell/lanes (Slice 2)
and the cross-domain gov `true_owner` write-back (Slice 3) come after Slice 1
is verified live. Connection-predicate caching was evaluated and **deferred**:
the predicate measured 95ms standalone and is not on the critical path once the
queue is materialized — not worth a trigger on the hot `external_identities` /
`entity_relationships` write paths.

## R7 Phase 1 — Decision Center shell + first two lanes (Slice 2, 2026-06-07)

The Review Console becomes the **Decision Center** (same nav slot, renamed):
one surface, lanes keyed by the QUESTION being asked. The decision record is
first-class; verdicts ride existing machinery — the surface is a router +
recorder, not a new pipeline. Builds on Slice 1's materialized queue. Applied
live 2026-06-07; migration committed (idempotent).

### DB (migration `20260607121000`, LCC Opps)
- **`lcc_decisions`** — soft-disposition record (`open|decided|skipped|
  superseded`, never hard-deleted; the audit trail for "why is this in this
  bucket"). `context` jsonb is **ids + scalar facts only** (no inline docs —
  the artifact-offload lesson). Partial unique index = one open decision per
  `(decision_type, subject)`.
- **`lcc_open_decision()`** — the one funnel engines/seeders call (idempotent on
  the open-subject key). **`lcc_record_decision_verdict()`** stamps verdict +
  effects and moves the row off `open`. **`lcc_refresh_decisions()`** seeds +
  sweeps (auto-closes decisions whose subject no longer meets the predicate);
  cron `lcc-decision-refresh` (*/15). **`v_lcc_decision_open_counts`** drives
  the lane chips.
- Seeded: **confirm_true_owner = 142** (P0.4 `true_owner_known_connect`),
  **map_sf_parent_account = 17**, **confirm_buyer_parent = 1** (USGBF —
  name-flagged unconfirmed sponsor; the other 17 need_sf_mapping parents ask
  the mapping question).

### API (`api/admin.js` + `server.js` + `vercel.json`)
- `GET  /api/decisions?type=<dt>` — workable top-N by `rank_value` ($ value) +
  universe count; `?summary=1` → per-lane open counts.
- `POST /api/decision-verdict {decision_id, verdict, payload}` — dispatches by
  `(decision_type, verdict)` to the **LCC-local** effect and records it:
  - confirm_true_owner: `correct` → confirm + hand off to the connect ladder
    (`next:{action:'connect',…}`); `research` → activity_events task; `skip`.
    **`stale` is RECORD-ONLY** (`verdict='stale_pending_writeback'`,
    `effects.writeback='deferred_slice3'`) — no domain DB is touched; the gov
    `true_owner` write-back is **Slice 3** behind Scott's blessing.
  - confirm_buyer_parent: `confirm_sponsor` → sets `lcc_buyer_parents.
    confirmed_*`. map_sf_parent_account: `map` → sets `sf_account_id` +
    `needs_sf_mapping=false` (releases held government_buyer syncs) and mirrors
    a Salesforce identity via `ensureEntityLink` (best-effort); `create_later`.
    Re-parent / rename anchor deferred.
- `GET /api/decision-sf-search?name=` — `findSalesforceAccountByName` typeahead.
- **Staleness hook (Slice-1 contract):** band-moving verdicts call
  `lcc_refresh_priority_queue_resolved()` so the queue updates immediately
  instead of waiting the 5-min tick.

### UI (`ops.js`, `index.html`)
- Nav label + page H2 → **Decision Center**. Two decision lanes render on top
  ("Confirm the true owner", "Buyer parents & SF mapping"); legacy review-count
  lanes move under "More review work" (Phase 2 converts them). Each lane:
  question → subject+context card → one-click verdicts → self-propelling
  advance (the SOS-lane model). The map card runs the SF typeahead inline.

### Verified headless 2026-06-07
160 decisions seeded (142/17/1), 0 residue; `lcc_record_decision_verdict`
transitions open→decided; list ranks by rollup rent (Boyd $174M, Easterly
$118M, NGP $80M). `node --check` clean (admin.js, server.js, ops.js); 12
functions; vercel.json valid.

### Slice 3 (next, gated)
The "Stale — new owner is…" cross-domain gov `true_owner` write-back: gov
migration first (R6 rule), write through the existing gov-write edge path with
`source='manual_decision'` provenance, exercised on a TEST row only until Scott
blesses it. Everything else in Phase 1 works without it.
