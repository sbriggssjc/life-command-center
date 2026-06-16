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
    (`next:{action:'connect',…}`); `research` → **research_tasks** row (effect
    written FIRST and gated — on a failed write the decision stays `open` with
    `effects.research_task=false`, never a false `decided`); `skip`.
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

## R7 Phase 1 — Slice 3: gated gov true_owner write-back (2026-06-07)

The Decision Center's **"Stale — new owner is…"** verdict (decision_type
`confirm_true_owner`) corrects the curated gov `properties.true_owner_id` when
Scott judges the domain owner stale (pre-acquisition). Gov side landed first
(R6 rule); the write goes through the **existing gov provenance path** with the
`manual_decision` origin. Applied live to the gov DB 2026-06-07; gov migration
committed (`supabase/migrations/government/20260607123000_…`).

### Gov RPC (the write path)
`public.gov_apply_manual_true_owner(p_property_id, p_new_owner_name, p_actor,
p_idempotency_key, p_dry_run default TRUE)` — SECURITY DEFINER, EXECUTE granted
to **service_role only** (REVOKEd from anon/authenticated, so the anon BD pulls
can't reach it). On a real write it:
- resolves/creates the `true_owners` row, sets `properties.true_owner_id`;
- writes **`manual_change_events`** (`source_action='save_ownership_resolution'`,
  `source_app='lcc'`, `status='applied'`, `actor_context.provenance_source=
  'manual_decision'`, idempotency_key) — the gov vocab is CHECK-constrained, so
  the `manual_decision` origin rides in `actor_context` + the log below;
- upserts **`field_value_provenance`** (`authority_source='manual'`,
  `authority_rank=90` top-of-ladder, `manual_override=true`);
- writes **`provenance_event_log`** (`source='manual_decision'`,
  `target_database='gov_db'`, flushes to LCC Opps — the authoritative
  manual_decision provenance);
- appends **`ownership_history`** (`change_type='manual_correction'`,
  `data_source='manual_decision'`, `ownership_state='active'`).
**Safe by construction:** `p_dry_run` DEFAULTS TRUE (a call without explicit
`dry_run=false` writes nothing); idempotent on `idempotency_key`
(`already_applied` no-op). Gotchas hit + fixed: `#variable_conflict use_column`
(property_id/change_event_id OUT params clash columns); the three constrained
vocabularies above.

### LCC side (gated)
`api/admin.js` `decision-verdict` `stale` branch:
- **`payload.dry_run`** → calls the RPC dry-run, returns the preview, records
  nothing (always safe, no flag needed).
- **Real write requires BOTH** `DECISION_GOV_WRITEBACK` enabled (env, Scott's
  blessing) **and** a gov property subject. Otherwise → record-only
  (`verdict='stale_pending_writeback'`, `effects.writeback=
  'deferred_pending_blessing'`), exactly the Slice-2 behavior.
- When blessed: effect FIRST via `domainQuery('government','POST',
  'rpc/gov_apply_manual_true_owner', {…dry_run:false})`; on success patches the
  LCC `lcc_property_owner_facts` mirror (resolver re-runs immediately) +
  `lcc_refresh_priority_queue_resolved()`, records `verdict='stale_applied'`;
  on failure records `effects.writeback=false` and KEEPS the decision open (502).

### Activation
**The write-back is OFF until `DECISION_GOV_WRITEBACK` is set in the Railway
env** (default unset ⇒ record-only). dia property subjects fall through to
record-only (dia owner-facts leg deferred, mirrors R6).

### Verified live 2026-06-07 (test row only)
Synthetic gov property (990000001) → dry-run wrote nothing
(`would_create_owner_and_write`); real write set the owner + all four
provenance rows (`manual_change_events` save_ownership_resolution/lcc/applied,
`field_value_provenance` manual/90/override, `provenance_event_log`
manual_decision/gov_db, `ownership_history` manual_correction); idempotent
re-run `already_applied`. **All test fixtures deleted (0 residue).** No real
gov row (Shooshan/ARLINGTON included) was touched. `node --check` clean; 12
functions.

## R7 Phase 2 — convert the legacy lanes + surface the surfaceless (2026-06-07)

Folds the remaining Review Console lanes into the Decision Center anatomy
(question → subject+context card → 2-4 one-click verdicts) and adds the three
decision types that had no surface. "More review work" is gone; every lane is a
real decision lane. Builds on Phase 1's `lcc_decisions` + verdict recorder.

### Two lane modes (the anti-bloat rule — decided first, applied consistently)
- **Seeded** — bounded, stable universes where every row is a real ask and the
  source won't retract it tomorrow. Seeded into `lcc_decisions` by
  `lcc_refresh_decisions()` (cron */15). Lanes: `confirm_true_owner` (142),
  buyer parents (18), **`junk_entity_name` (41, NEW this phase)**.
- **List-federated** — large/churning universes. The lane LISTS top-N by value
  straight from its source view; a `lcc_decisions` row is minted only at VERDICT
  time (`lcc_open_decision` + record). `lcc_decisions` stays the bounded audit
  trail of judgments MADE (201 open rows total — seeded only), never a 14k-row
  mirror of the backlog (the disk-incident lesson). Lanes: `intake_disposition`
  (542), `property_merge` (gov 6,914 + dia 42), `provenance_conflict`
  (14,155 + dia xref 67), `pending_update` (gov 2,087), `cms_link_suspect`
  (dia 269), `implausible_value` (gov 26 + dia 10). The deciding question isn't
  count — it's "would seeding strand a stale row when the source self-resolves?"

### Three invariants federated mode gets right (verified)
1. **Idempotent on (decision_type, subject_ref)** — `lcc_open_decision` returns
   the same open id on repeat (verified: two calls → 4853/4853); the verdict
   path also short-circuits with `already_decided` (409) if a prior terminal
   decision exists.
2. **List excludes already-decided subjects** — `handleDecisionsList` anti-joins
   `lcc_decisions` (status≠open) by `subject_ref`, so a verdict drops the item
   out of top-N immediately (lane self-propels / drains). Verified: a decided
   row's `subject_ref` is returned by the exact `fetchExcludedRefs` query.
3. **Honest counts** — federated lanes report source-view workable count
   (universe − decided); the summary payload labels each lane's `mode`.

### Source-view artifacts (read-only, additive, applied live)
- **LCC Opps** `20260607130000_lcc_r7_phase2_junk_entity_lane.sql` — extends
  `lcc_refresh_decisions()` to seed + sweep the `junk_entity_name` lane (DROP +
  CREATE because the return signature gains `seeded_junk_entity`).
- **dia/gov** `20260607130000_*_r7_phase2_implausible_sale_values.sql` — new
  `v_implausible_sale_values` view (sales over the $50M dia / $250M gov
  magnitude soft-ceiling, retained for review — mirrors
  `SALE_PRICE_BLEED_CEILING`). All other federated lanes reuse EXISTING source
  views (`staged_intake_items`, `v_data_quality_issues`,
  `v_field_provenance_actionable`, gov `pending_updates`,
  `v_property_cms_link_suspect`) — no new domain artifacts.

### API (`api/admin.js`, no new function files — still 12)
- `GET /api/decisions?type=<federated>` lists from the source view (excluding
  decided); `?summary=1` merges seeded open-counts + federated workable counts.
- `POST /api/decision-verdict` accepts EITHER `{decision_id}` (seeded) OR
  `{type, subject}` (federated — mints the decision at verdict time). Dispatch
  by `(decision_type, verdict)`; every effect is effect-FIRST + outcome-truthful
  (a failed write keeps the decision open + records `effects.*=false`, never a
  false `decided`). Verdicts ride EXISTING machinery only:
  - junk_entity_name: rename (entities PATCH, clears the flag) / merge
    (`lcc_merge_entity`) / leave_flagged / research.
  - intake_disposition: dismiss (safe) / create_property + reextract (hand-off
    `next` → existing `/api/intake` routes) / research.
  - property_merge: not_duplicate (safe) / merge (`dia_merge_property` /
    `gov_merge_property`) / research. The UI's "Compare & merge →" opens the
    existing consolidate surface (keep/drop is Scott's BD judgment).
  - provenance_conflict: keep_current (safe) / accept_attempted (queues a
    research task — no silent domain overwrite) / research / skip.
  - pending_update: apply (→ status `approved`) / reject (→ `rejected`) —
    the existing gov state-machine transitions, no new states / research.
  - cms_link_suspect: link_correct (safe) / break_link (hand-off → existing
    `/api/cms-match` DELETE) / research.
  - implausible_value: confirm_as_is (safe) / correct (PATCH `sold_price`) /
    void (queues a task — never a silent delete) / research.

### UI (`ops.js`)
- `renderReviewConsolePage` now renders ALL lanes as decision lanes (seeded +
  federated + the existing SOS owner-contact worklist), ordered ownership-first
  then by workable value. `renderFederatedLane(type)` + `_fedCardHTML` +
  `dcFed(i, verdict)` post `{type, subject, verdict}`; self-propelling advance
  (`_dcAdvanceFed`) mirrors the seeded `_dcAdvance`. `junk_entity_name` rides
  the seeded `renderDecisionLane`/`_dcCardHTML` path.

### Verified live (read-only + synthetic, 2026-06-07)
- Seeded re-seed: 142 true_owner / 18 buyer / **41 junk_entity** / 0 superseded;
  `lcc_decisions` = 201 open (seeded only — federated backlog NOT mirrored).
- Federated invariants proven at the DB layer (idempotent mint 4853/4853;
  decided `subject_ref` returned by the exclusion query). All synthetic test
  rows deleted — **0 residue**.
- Source views live: dia/gov `v_implausible_sale_values` = 10 / 26 rows.
- Workable counts per lane (universe; minus decided once worked): intake 542,
  property_merge 6,956 (gov 6,914 + dia 42), provenance 14,222 (LCC 14,155 +
  dia xref 67), pending_update 2,087, cms_link_suspect 269, junk_entity 41,
  implausible_value 36, owner-contact (SOS) 44.
- `node --check` clean (admin.js, ops.js, server.js); `ls api/*.js | wc -l`=12.
  No new routes (decisions / decision-verdict already routed in Phase 1).

### Destructive verdicts — plumbing verified, real applies left to Scott
Merge / Apply / Break-link / Keep-B(accept_attempted) / Correct / Void ride
existing domain machinery and are wired, but were NOT exercised on real data
this session (Scott is actively working the lanes). They are verified for
plumbing correctness (the verdict reaches the right machinery and records
honestly); the safe verdicts (research / dismiss / keep_current / not_duplicate
/ confirm_as_is / link_correct) exercise the full record-the-decision path. Live
applies are Scott's first real use — same posture as the gov true_owner
write-back.

### Follow-ups (NOT in this phase)
- provenance `accept_attempted` queues a research task rather than writing
  through `lcc_merge_field` + adjusting `field_source_priority` (the registry
  "learning" loop) — deferred (touching the shared priority registry is its own
  blessed change).
- junk `leave_flagged` records `skipped` but re-surfaces on the next refresh
  (the entity is still flagged) — same soft-disposition semantics as Phase-1
  skip; a true "stop asking" would set `metadata.junk_name_reviewed` + exclude
  it from the seed.
- federated destructive verdicts have no preview/dry-run yet (except where the
  underlying RPC provides one); add per-lane dry-run where the machinery allows.

## R7 Phase 2.4 — P-BUYER contact step + buy-side cadence (2026-06-07)

After "Open Government Buyer" succeeds on a mapped parent the P-BUYER card used
to dead-end at a badge. Doctrine: an opportunity is tied to a specific CONTACT
at the company — the account-level opp is fine, but the next action is selecting
the prospecting contact, then a BUY-SIDE cadence (showings + buy-side outreach),
NOT the onboarding ladder (R5 deliberately excludes buyer opps from the prospect
auto-seed trigger).

### DB (LCC Opps, migration `20260607150000`, applied live)
- `touchpoint_cadence.phase` CHECK widened with **`buy_side`** (widening only).
- **`lcc_seed_buyer_cadence(opp, entity, contact_id, sf_contact_id, name, owner,
  domain, interval)`** — seeds a `phase='buy_side'`, `priority_tier='A'`,
  `next_touch_type='outreach'` row. ON CONFLICTs on the **uq_cadence_contact_property
  INDEX expression** (the E2E#6 rule — index-inference form, not a constraint
  name) so re-selecting a contact relinks the existing row instead of 23505'ing.
  Verified: two calls on one parent (no sf id) → 1 row, contact swapped, phase
  buy_side; synthetic fixtures deleted (0 residue).

### SF (`api/_shared/salesforce.js`)
- `getSalesforceContactsByAccount(accountId)` — `find_contacts_by_account` flow
  op; tolerant of flows that don't implement it (falls back to entity-graph
  candidates).

### API (`api/operations.js`, no new function files)
- `GET ?action=buyer_contacts&entity_id=<parent>` — candidate contacts from three
  sources: (a) person entities related to the parent (`entity_relationships`
  associated_with), (b) Salesforce contacts on the mapped account, (c)
  name-matched person entities (core token, e.g. the captured "Boyd" persons).
- `POST ?action=select_buyer_contact` — resolve/create the person, link
  person→parent (`associated_with`, dupe-guarded — no unique index), seed the
  buy-side cadence (effect-first; a failed seed 502s + records nothing), record
  `metadata.primary_contact` on the opp, refresh the queue cache.

### UI (`ops.js`)
- `_pqAdvanceGovBuyerCard` mapped branch → **"Select prospecting contact →"** CTA
  (was a terminal badge). `pqSelectBuyerContact` opens an inline picker
  (related / SF / name-matched / + Add new); on select the card settles to
  **"✓ On buy-side cadence with <name> — next touch <date>"** and the parent ages
  out of "to decide" into the cadence bands. Boyd Watterson Global is already
  SF-mapped, so the contact step is its live next action.

### Follow-ups (NOT in this phase)
- The buy-side cadence row is the truth; rendering that state in the entity
  detail Next-Step banner + the Decision Center buyer lane (the full "one truth,
  three renderings") is deferred — the queue card flow is the surface Scott hit.
- Unmapped parents still route to the map card first; the contact step appears on
  the next P-BUYER open (already_open + mapped).

## R7 Phase 2.3 — LLC-tick 23514 storm + honest write-failure health (2026-06-07)

Covered in the commit log; summary: the llc-research tick wrote `status='deferred'`
(no-handler cap, 2026-05-31) but `llc_research_queue_status_check` lacked it →
23514 on every such PATCH, row stuck `in_progress`, reclaimed every 15min, each
cycle logging an `ingest_write_failures` row (100% of recent failures; 2,350/24h
per domain). Fix: widen the CHECK (+`deferred`,`dead`) on dia+gov + park stranded
rows; tick gains a `LLC_MAX_ATTEMPTS=8` dead-letter cap. Ops Health now shows a
**24h** window + the top offender path (was a 7d total mislabeled "recent");
`lcc_check_write_failures()` + cron `lcc-write-failure-check` (hourly :55) opens a
`write_failure_spike` alert per over-threshold path (and prunes >30d). Migrations:
LCC `20260607140000`, dia/gov `20260607140000`.

## R7 Phase 2.5 — buyer contact picker: person-plausibility + honest SF (2026-06-07)

Two bugs Scott hit on the Boyd buy-side picker: the name-match source surfaced
18 capture artifacts as "persons" ("Boyd Watterson by NAI Capital", "... JV
...", "... BBCMS 2021-C10 ($5.0m approx)", "... GSA Fund", bare "Boyd"), and the
Salesforce section was silently empty (the real Boyd humans live in SF).

### Root cause + writer fix (the data, not just the view)
The sale-event/capture writer (`sidebar-pipeline.js` buyer/seller) classifies
any owner string WITHOUT a firm suffix as a PERSON, so attribution/deal strings
got minted as person entities. New guards in `api/_shared/entity-link.js`:
- **`isImplausiblePersonName(name)`** — strong negative signals a human name
  never has: `by <broker>`, `JV`, CMBS codes (CMBS/BBCMS/CDCMT/ML-CFC), series
  (`2021-C10`), `$`/`approx`/parenthesized amounts, firm suffixes (LLC/LP/Inc/
  Trust/Fund/Capital/Partners/…). Wired into **`ensureEntityLink`** (the choke
  point, beside the R4-A junk guard): an inferred `person` whose name is
  implausible is rejected (`skipped:'implausible_person_name'`), so the artifacts
  never become person entities going forward.
- **`looksLikePersonName(name)`** — strict positive first+last shape (2-5 alpha
  tokens, no digits/firm/deal tokens). Used by the picker so name-matches are
  only selectable humans.

### Existing rows → junk lane (don't hard-delete)
Migration `20260607160000` soft-flags the ~1,009 mistyped person rows
(`metadata.junk_name_flagged=true`, `junk_name_source=r7_phase2_5_*`) → they
enter the **junk_entity_name** Decision Center lane for disposition (rename /
merge / retype). Junk lane went 41 → 1,050. Idempotent; preserves metadata.

### Picker (`api/operations.js` getBuyerContacts)
- name_matches: `looksLikePersonName` + exclude junk-flagged + exclude the firm
  name itself mistyped as a person (candidate ⊆/⊇ parent name — drops "Boyd
  Watterson"/"Boyd Watterson Global"). Related persons also drop junk-flagged.
- **`sf_status`** is honest: `no_account` / `not_configured` / `unavailable`
  (flow op `find_contacts_by_account` not implemented) / `no_contacts` / `ok`.
  `ops.js` renders the truthful message — never a silent empty SF section.
- Ordering: related → SF → plausible name-matches → Add new. "Add new" is always
  a selectable path, so the list is never zero actionable.

### Follow-up
- Implement the `find_contacts_by_account` SF flow op (preferred — the real Boyd
  humans + activity history live in SF); until then the picker says so and offers
  manual add. Order: related → SF → name-matches → add new.

## R8 — dia owner-facts leg + Decision Center Phase 3 (2026-06-08)

### Unit 1 — dia owner-facts leg (closes the R6 gap)
R6 shipped tier-0 domain-truth resolution for gov only; dia is now wired the
same way. dia `v_property_owner_facts_portfolio` anon view (names only — no PII,
**no tenant/operator**) mirrors the gov view; `lcc_sync_property_owner_facts`
gained the dia leg (**1000/page** — Supabase PostgREST caps responses at 1000
rows regardless of `limit`, so any larger stride silently skips rows; this bit
the first dia pull which loaded only 6,196 of 12,196), `lcc_finalize_property_
owner_facts` is now domain-agnostic, cron syncs `'both'`.
`v_lcc_ownership_chain_completeness` + `lcc_generate_chain_research_tasks` now
cover dia AND gov. Migrations: dia `20260608130000_dia_v_property_owner_facts_
portfolio.sql` (apply FIRST), LCC `20260608130000_lcc_r8_dia_owner_facts_leg.sql`.
Verified live: dia mirror 12,196 rows (9,301 true_owner). **dia caveat:** dia
`true_owner` frequently carries the dialysis OPERATOR (DaVita/Fresenius), which
are correctly NOT registered buyer parents (no spurious P-BUYER promotions), and
dia "owners" are often multi-property developers — so tier-0 yields only a few
dia SPE→parent links (Choice One Development / Incommercial → Elliott Bay;
EIG Wadsworth → Massmutual). Membership shift is small + conservative by design.
Follow-up: the resolver's tier-0 `LIMIT 1` picks one of a multi-property
developer's buyers somewhat arbitrarily — fine for gov (one property per SPE),
noisier for dia developers; refine if dia P-BUYER mislabels developers.

### Unit 3 — automation → decision-lane funnel (Decision Center Phase 3b)
**Producer pattern (the rule):** when an engine can't decide, it calls
`lcc_open_decision()` (idempotent on `subject_ref`) instead of parking work in a
hidden status; `lcc_refresh_decisions()` auto-supersedes the decision when its
predicate clears; verdicts ride existing machinery. Three bounded producers wired
(migration `20260608140000_lcc_r8_decision_producers.sql`):
- **`availability_checker_botblock`** — SEEDED from open `lcc_health_alerts`
  (the Round 76ej.h RPC already opens/auto-resolves the alert); refresh sweep
  supersedes when the alert clears. Verdicts: `verify` (deep-link, record-only) /
  `acknowledge` (resolves the alert). Pure-DB; no RPC/Edge change.
- **`match_disambiguation`** — producer is `intake-matcher.js`
  (`collectAmbiguousCandidates` + `emitMatchDisambiguation`): on the UNMATCHED
  single-address path, if ≥2 near-miss candidates (dist≤5) exist, emit instead of
  parking unmatched (never touches confident matches). Refresh sweep supersedes
  once the intake leaves `review_required`. Verdicts: `pick` (writes the
  confirmed match so the existing promoter takes over) / `create_property`
  (F4 hand-off) / `research`.
- **`llc_research_dead`** — producer is the llc-research tick dead-letter block
  (`handleLlcResearchTick`): each row parked `dead` (LLC_MAX_ATTEMPTS cap) emits a
  decision. Source lives in the domain DB (not LCC Opps) so there is NO
  refresh-sweep — verdict-driven (`retry` requeues the domain row / `resolve_
  manually` spawns a SOS research task / `park`). Bounded by the dead-letter cap.
`api/admin.js decision-verdict` gained the three dispatch branches (effect-first,
outcome-truthful); `createResearchTask` now falls back to the primary/oldest
workspace when a producer decision has a null workspace. `ops.js` renders the
three lanes (seeded-style, `dcPickCandidate` for candidate picks). Verified live:
botblock seed→sweep round-trip (open→superseded, 0 residue); match_disambiguation
sweep (stays open for a live review_required intake, supersedes for a resolved
one). New lane types are type-ready (0 open today — they appear when an engine
hits ambiguity).

## R10 — close the cadence → outreach loop (2026-06-07)

The 2026-06-07 outreach audit found the cadence engine built but the loop had
never closed once (392 rows, 383 overdue, `last_touch_at` NULL on every row).
Five independent breaks. R10 fixes them unit by unit; Unit 1 ships first.

### Unit 1 — fix the advance path (shipped)
Three breaks, one surgical fix each:

1. **Queue CTA hit the wrong router.** `ops.js pqLogTouch` POSTs
   `/api/operations?action=advance_cadence`, but `advance_cadence` only existed
   under the `?_route=draft` sub-router, so every "Log touch" 400'd. Fix:
   `advance_cadence` is now a first-class case in the **main** POST action
   router (`api/operations.js`), handled by **`bridgeAdvanceCadence`**. The
   Copilot `?_route=draft&action=advance_cadence` alias still works (unchanged)
   for the agent registry.

2. **`advanceCadence` didn't reschedule.** `api/_shared/cadence-engine.js`
   guarded the reschedule on `if (nextRec.template)` — but PROSPECTING_SEQUENCE
   phone touches (2/4/6) carry a **null template**, so `next_touch_due` stayed
   frozen and the card never left the band. Fix: reschedule on any non-blocked
   recommendation (`if (!nextRec.blocked && nextRec.due_at)`), null template is
   valid. Regression test: `test/cadence-advance.test.mjs` asserts
   `next_touch_due > now()` after a null-template phone advance.

3. **No activity row / double-advance risk.** `bridgeAdvanceCadence` now writes
   an `activity_events` row with the **real category** (generic `touch` → `call`;
   email/meeting pass through) and the cadence's `entity_id`, so the touch
   renders in history. A successful advance also calls
   `lcc_refresh_priority_queue_resolved()` so the card leaves its band within
   the request (Slice-1 staleness contract).

**Single advance owner (the doctrine — documented per the audit ask):** the JS
`advanceCadence()` function is the **single owner** of the advance. Every JS
human-touch writer that advances a cadence itself tags its `activity_events`
row `metadata.skip_cadence_advance='true'`. The SQL AFTER-INSERT trigger
`lcc_activity_event_advance_cadence` now **skips** those tagged rows (migration
`20260608150000_lcc_r10_unit1_cadence_advance_skip_guard.sql`, applied live —
safe DB-first, no deployed writer set the flag yet), so each activity advances
the cadence **exactly once**: the JS path owns its own advance, and the trigger
remains the advance owner only for **unflagged organic** activities (Unit 2 —
calls/emails logged outside `bridgeAdvanceCadence`).

**Vocabulary note (pre-existing dual system):** JS `advanceCadence` advances on
the `PROSPECTING_SEQUENCE` (phases `prospecting`/`maintenance`, `T-*` templates);
the trigger's organic path advances via SQL `lcc_advance_onboarding_cadence`
(phases `onboarding`/`steady_state`, `onboarding_*` templates), so an organic
touch on a `prospecting` row flips it to `onboarding`. Unifying the two
vocabularies is a deferred follow-up; both reschedule correctly, so the loop
closes either way.

Verified live (synthetic rows, 0 residue): a `skip_cadence_advance` call left
the cadence untouched (touch unchanged, due stays past); an unflagged email
advanced it (touch +1, `next_touch_due` into the future). `node --check` clean;
12 functions; full suite green except 2 pre-existing CM chart failures.

### Unit 2 — close the organic loop (shipped)
Two structural gaps that meant an organically-logged touch never advanced a
cadence:

1. **Asset→owner hop (the trigger).** A human touch logged from a property
   detail page (`bridgeLogCall` etc.) resolves its entity to the **asset**
   (`sourceType='asset'`), but cadences live on the **owner** (person/org) that
   `owns` the asset. The advance trigger looked the cadence up on the asset,
   found none, and no-op'd. Now, when no cadence is found on the activity's
   entity directly, the trigger follows the `owns` relationship (owner =
   `from_entity`, asset = `to_entity`) to an active owner cadence — implemented
   in **one place** (the trigger), restricted to `owns` (true ownership, not
   brokerage/sale-side edges). Migration
   `20260608151000_lcc_r10_unit2_cadence_asset_owner_hop.sql` (live).

2. **Off-sequence touches now advance.** The trigger previously only
   rescheduled when the logged type matched `next_touch_type`; a mismatch
   (e.g. a call against an email-next cadence) bumped counters only, so the
   card stayed overdue. Doctrine: **any human touch is a touch** — the trigger
   now always calls `lcc_advance_onboarding_cadence` (which reschedules +
   handles counters) on email/call/meeting.

Swept writers (emit real categories on the right entity): `bridgeLogCall`
(`call`, asset entity → hop), `bridgeLogActivity` (passthrough
`email`/`call`/`meeting`). The Today-page SF reschedule flow (`app.js`) advances
directly via the draft route keyed by `sf_contact_id` — a separate path, left
as-is.

Verified live (synthetic, 0 residue): a **call logged on an asset** whose owner
had an overdue email-next cadence advanced the **owner's** cadence (touch 2→3)
and moved `next_touch_due` into the future.

### Unit 3 — cadence universe hygiene (shipped)
Doctrine (Scott): a cadence without a reachable contact is not a next action —
it is contact-resolution work. The 2026-06-07 audit found ~381 contactless
`prospecting` cadences born overdue, flooding **P7** with "email a shell with no
address" cards. Run order matters: **retype BEFORE the gate** (the gate's
"person-contact relationship" predicate + the contact picker both key on
person-vs-org).

1. **Retype pass (Unit 3a, reversible).** Migration
   `20260608152000_lcc_r10_unit3a_retype_firm_persons.sql` retypes cadence-bearing
   `person` entities whose NAME carries a firm suffix (SQL mirror of
   `entity-link.js` `ENTITY_FIRM_SUFFIX_RE`) → `organization`. Prior type stashed
   in `metadata.retyped_from` / `retype_source='r10_unit3'` (soft, reversible, no
   hard delete). **75 retyped** live. Names with no recognized suffix (e.g.
   "Prologis") stay `person` — the gate parks them anyway and the picker offers
   "add contact" regardless of type.

2. **Reachability gate + P-CONTACT lane (Unit 3b).** Migration
   `20260608153000_lcc_r10_unit3b_cadence_reachability_gate.sql` re-gates the
   three cadence bands (P0 `developer_overdue`, P6 `onboarding_step_due`, P7
   `steady_state_cadence_due`) in `v_priority_queue_live` on **reachability**:
   `cadence has sf_contact_id OR contact_id OR the entity is "connected"
   (Salesforce identity, or a relationship to a person-typed entity)`. Unreachable
   overdue cadences move to a new **P-CONTACT** band (`select_prospecting_contact`).
   **The gate lives in the VIEW, not a row mutation — so it is re-seed-proof by
   construction**: a future cadence-seed pass cannot resurrect a contactless row
   into P7; the live predicate always re-evaluates. P-CONTACT (and surviving
   cards) rank by portfolio rent via the existing enriched rollup join.
   - **Gotcha fixed:** the P-CONTACT branch first used `NOT IN (reachable)`, and
     `reachable` can contain a NULL entity_id (one cadence has a null entity) →
     `NOT IN` collapsed to zero rows. Switched to `NOT EXISTS` + `entity_id IS
     NOT NULL`. The gated bands use `IN` (NULL-safe), so only P-CONTACT was hit.
   - Verified live post-refresh: **P7 379→68** (the reachable set — the expected
     honest collapse), **P6 4→1**, **P0 2→0**, **P-CONTACT = 314**. All
     non-cadence bands byte-identical (P0.4=498, P0.5=74, P1–P8, P-BUYER) — no
     collateral. Spot-checks: parked = 29th Street Capital / Acquest Development
     (firms), Adelaide Polsinelli / AJ Tolbert / Akram A. Abdeljaber (people with
     no contact info); survivors = Adam D. Portnoy / Adam Meyer (reachable via SF).

3. **JS — the P-CONTACT CTA (generalizes the P-BUYER picker).** `ops.js`:
   `_pqCtaState` → `select_contact` for P-CONTACT; **"Select prospecting contact
   →"** opens the same contact picker the P-BUYER lane uses
   (`pqSelectProspectingContact` reuses the `?action=buyer_contacts` candidate
   loader + `_pqBuyerContactHTML`; `_pqBuyerContactSubmit` branches on
   `ctx.mode`). New endpoint `api/operations.js` `select_prospecting_contact`
   (`bridgeSelectProspectingContact`): resolve/create the person, link
   person→entity (`associated_with` → makes the entity "connected"), stamp the
   contact onto the entity's **existing** active cadence (`contact_id` has no FK;
   `sf_contact_id` is free text) — does NOT seed a buy-side cadence (that's
   P-BUYER) — then refresh the queue. `admin.js` `BAND_ORDER` adds `P-CONTACT`
   (after P7). Verified live (synthetic, 0 residue): attaching a contact moved
   the row **P-CONTACT → P7**.

### Unit 4 — minimum outreach surface (shipped)
The smallest loop that lets the operator work a touch end to end, with **no
sending integration and no new function files** (scope floor):

- **Cadence dashboard.** New GET `api/operations.js?action=cadence_dashboard`
  reads `v_bd_cadence_dashboard` (workspace-scoped, most-overdue first). `ops.js`
  `renderCadenceDashboard()` renders one row per active cadence (phase, touch N,
  due/overdue, last outcome, engagement, portfolio context), reached from a
  "Cadence dashboard →" button on the Priority Queue header. The view has **no
  phase filter**, so it is also the visible home for the parked/contactless
  prospecting rows AND any `buy_side` cadence the P-BUYER contact step seeds —
  the dashboard renders those automatically once they exist.
- **Draft → copy/mailto → Mark sent.** Email-next rows get **"Draft email →"**
  (`cadDraft`) → POST `?_route=draft&action=generate` with the row's
  `next_touch_template` + entity context → renders subject + editable body inline
  with **Copy** (clipboard), **Open in mail** (`mailto:`), and **Mark sent →**.
  `cadMarkSent` → POST `?_route=draft&action=record_send` → which advances the
  cadence via **`advanceCadence` — the Unit-1 single advance owner** (record_send
  writes no activity row, so there is no trigger double-advance). The card
  settles to "✓ Sent & recorded — cadence advanced".
- **Non-email touches.** call/vm-next rows get **"Log touch →"** (`cadLogTouch`)
  → POST `?action=advance_cadence` (the Unit-1 endpoint) — same single advance
  path, never a second owner.

Verified: dashboard query returns real cadences with templates (Acquest
Development / Duchene Family Trust …); `record_send` confirmed to advance through
`advanceCadence` (no second advance owner); `node --check` clean; 12 functions;
suite green except 2 pre-existing CM chart failures. The live end-to-end (draft →
mark sent → cadence advances → card clears) is verified on the deployed app after
merge (the draft/record_send routes need the running server).

### Follow-ups (not in R10)
- Unify the prospecting (`T-*`) and onboarding (`onboarding_*`) cadence
  vocabularies (both reschedule correctly today; the trigger's organic path flips
  prospecting→onboarding).
- Resolve recipient email for the draft `mailto:` (entities carry no email; the
  contact picker's SF path is the eventual source) — today `mailto:` opens with an
  empty `to:` for the operator to fill, Copy is always available.
- Render the cadence/buy-side state in the entity-detail Next-Step banner (the
  full "one truth, three renderings").

## R11 — value-ranking integrity (the queue was ranking on missing rent, 2026-06-08)

The priority queue, P-CONTACT lane, Decision Center, and buyer rollups all rank
on `current_annual_rent_total` — which was **$0 on the entire dia book** and on
the gov ownership-resolution band, so "work the highest-value first" was ordering
by noise. Grounded live 2026-06-08: dia 0/887 current portfolio edges carried
rent (gov 2,700/3,324); P-CONTACT 304/306, P0.4 415/499, P0.5 70/73 rank-zero.

### Unit 1 — dia portfolio rent (the rollup rank)
Root cause: the portfolio sync's dia leg pulled the **raw** `dia.ownership_history`
table and read its `rent` column — NULL on all 7,772 rows (no writer ever
populated it). dia rent lives in `leases.annual_rent`, projected to CURRENT_DATE
per the dia doctrine.
- **dia `v_ownership_history_portfolio`** (dia `20260608170000`, apply FIRST) —
  mirrors the gov anon view; joins the property's **primary lease** rent
  (active → largest `leased_area` → most recent `lease_start`) projected to
  CURRENT_DATE via `dia_project_rent_at_date` (same math as `v_sales_comps`).
  Exposes `ownership_end_date` too — dia uses **explicit** start/end dates and
  44% of dia rows have a NULL `transfer_date`, so gov's "latest transfer =
  current" window would misclassify dia. **The branches were deliberately NOT
  collapsed**: dia keeps its explicit-end aggregation, so the round ADDS rent and
  reclassifies NOTHING.
- **LCC sync repoint** (`20260608170000`) — dia leg → the view; dia finalize
  reads the gov-aligned column names; **gov branch byte-identical** (no
  regression). Verified live: dia current edges held at 887 (no reclassification),
  `current_with_rent` **0 → 614**; gov unchanged (3,324/2,700). End-to-end traced
  (AEI Capital Corp / dia prop 26955: lease $2.27M → view → portfolio fact →
  rollup $5.80M → P-BUYER card). Bands that rank on the rollup improved
  (P-BUYER rank-zero 18→9, P5 21→9, P4 2→0).

### Unit 2 — representative-property rent (the fallback rank)
P0.4 resolution entities carry no portfolio edge — they have a single
**representative property** instead. 102 gov P0.4 rows (the audit's "117 $0 rows
that are NOT dia") + 1 dia ranked $0 for this reason; `lcc_property_attributes`
had no rent column.
- **gov `v_property_attributes_portfolio`** (gov `20260608170000`) — append
  `annual_rent` (= `gross_rent`) + `noi`. **dia `v_property_attributes_portfolio`**
  (dia `20260608171000`) — NEW view (projected primary-lease rent + raw
  attributes; replaces the raw-`properties` pull the audit flagged as wrong PII
  posture; `noi` NULL — dia is NNN).
- **LCC** (`20260608171000`) — `lcc_property_attributes` gains `annual_rent`/`noi`;
  dia attributes leg repointed to the view; both finalize legs write rent;
  `v_priority_queue_enriched` **appends** `source_property_rent`,
  `source_property_noi`, and **`rank_annual_rent` = COALESCE(NULLIF(rollup,0),
  representative-property rent, P-BUYER SPE rollup)** — the column the operator
  console now orders by. The pa join already existed, so the fallback is free on
  the hot path (the Slice-1 "push into the refresh" contingency was not needed;
  items-page ~1.0–1.3s, dominated by the **pre-existing** `rs` connection-check
  LATERAL — R11 adds ~0).
- **JS** (Railway redeploy): `admin.js` orders the items page + band detail by
  `rank_annual_rent`, selects `source_property_rent`/`rank_annual_rent`; `ops.js`
  card falls back to "$X rent (subject property)" when the rollup is $0.
- Verified live: band rank-zero on the coalesced value — **P0.4 415→298**
  (the 102 gov repr-property rows now ranked), **P-BUYER 18→1**, **P1/P2/P3/P5/P8
  → 0**. Remaining zeros (P0.4 298 owner-level, P0.5 70, P-CONTACT 304, P7 68)
  are genuinely **property-less** — honest zeros / Unit 3.

### Unit 3 — the orphan persons (the audit premise didn't hold)
The audit expected ~99 dia P-CONTACT persons with **no** linkage to flag as
import residue. Live data refuted it: of the 304 property-less P-CONTACT rows,
**0** are strict residue — 303 carry asset relationships (`owns`/`purchases`/
`brokers`/`associated_with`), just not to persons/SF (which is exactly why the
R10 reachability gate parks them). The named examples (Jim Colburn, Scott E.
Elliott) both have asset edges. So they are **real CoStar-captured
contacts/brokers, not residue** — flagging them junk would be wrong. They already
rank LAST via `rank_annual_rent … NULLS LAST` (no rank faked), and the 41
junk-NAMED ones already route through the existing `junk_entity_name` Decision
Center lane. **No new bucket, no migration, no hard-deletes** — classify, don't
bury. Follow-up for Scott: optionally exclude `junk_name_flagged` entities from
the P-CONTACT band so the contact worklist is cleaner (the junk lane handles
their disposition either way).

### Deploy / ranking note
DB applied live in filename order (domain views BEFORE the LCC sync repoints).
The `*/4h` portfolio + `daily` attribute crons keep both fresh; band-moving
verdicts already call `lcc_refresh_priority_queue_resolved()`. The JS rank switch
(`current_annual_rent_total` → `rank_annual_rent`) ships on the Railway redeploy;
until then the live app keeps the old ordering — graceful, deploy-order safe.

## R13 — Decision Center lane health (2026-06-08)

Audit grounded live 2026-06-08. The verdict/effect machinery is healthy (all 13
`decision_type` branches present, effect-first/outcome-truthful, idempotent mint
+ `already_decided` 409, honest federated counts). This round is one high-value
de-noise + two follow-ups. JS ships on the Railway redeploy; DB applied live.

### Unit 1 — de-noise the provenance_conflict lane (the headline)
`provenance_conflict` reported 14,742, but `v_field_provenance_actionable` by
decision is **78% `skip`** (11,518: registry correctly chose a higher-priority
source and skipped a lower-priority write — that is warn/strict-mode TELEMETRY,
not a human decision). Only `decision='conflict'` (3,163 — same-priority
disagreements) needs Scott's judgment. **94% of those conflicts are same-source**
(costar/costar 2,785, rca/rca 187), 6% different-source equal-priority ties.

Fix (`api/admin.js` `fetchFederatedSource`): the `provenance_conflict` lane pull
+ `opsCnt` now filter `v_field_provenance_actionable?decision=eq.conflict`. The
dia `sales_price_xref_conflict` leg is kept (genuine). Lane drops 14,742 →
~3,163 (+ ~67 dia xref). The skip telemetry stays available via the view /
provenance panels — just not in the operator decision lane. Verified live:
`decision='conflict'` = 3,163; 5 spot-checks are real same-priority ties
(current_source vs attempted_source at equal priority). Read-only filter,
cache-or-live safe.

### Unit 2 — registry learning loop for accept_attempted (BLESSED, flag-gated)
Even on genuine conflicts, `accept_attempted` only queued a research task — it
never taught the registry, so the same field re-litigates forever. Now, gated on
env **`DECISION_PROVENANCE_LEARN`** (default OFF ⇒ unchanged research-task
behavior), on a field-provenance conflict the verdict:
1. **Registry learning FIRST** — upserts a per-`(target_table, field_name)`
   `field_source_priority` rule for `source='manual_decision'` at **priority 1**
   (idempotent on the unique key). Scoped to the exact field — it NEVER re-ranks
   the aggregator sources (costar/rca/om) against each other, so there is **no
   mass re-ranking** (and a re-rank couldn't break a same-source tie anyway).
2. **Applies the attempted value** as that manual authority via the existing
   `lcc_merge_field` path (`source='manual_decision'`, confidence 1, effect-first;
   gated on the actual `decision='write'` — a non-write keeps the decision open
   + 502). dia xref / non-field-provenance subjects fall through to the
   research-task path. `keep_current`/`skip` unchanged.

Why this drains the class: after a manual resolution, a future capture to that
record+field resolves to `'skip'` (lower-priority source can't override
`manual_decision@1`), **not `'conflict'`** — so Unit 1's filter hides it and the
field stops re-surfacing. JS-only (no migration — the rule is minted on demand;
`lcc_merge_field` already exists). Exercised live on ONE real conflict
(`gov.tax_records.assessed_value`): `lcc_merge_field` → `write` (manual@1 beats
costar@55); current authoritative became the manual value; a simulated future
costar write returned `skip` ("cannot override manual_decision (1)"); aggregator
priorities unchanged (only `manual_decision@1` added). **Fully reverted — 0
residue** (original value 739396 restored, conflicts back to 3,163). Activation
is Scott's: set `DECISION_PROVENANCE_LEARN` when ready.

### Unit 3 — junk 'leave_flagged' stops re-surfacing
`junk_entity_name` had 747 open decisions, but `leave_flagged` recorded
`skipped` while the entity stayed `metadata.junk_name_flagged=true`, so
`lcc_refresh_decisions` re-seeded a fresh open decision every */15 — the operator
re-saw dismissed rows. Fix (the "stop asking" hook):
- `api/admin.js` — `leave_flagged` now sets `metadata.junk_name_reviewed=true`
  on the entity (effect-first; failed write keeps the decision open) before
  recording `skipped`. `skip` stays a transient re-surfacing dismissal.
- Migration `20260609190000_lcc_r13_unit3_junk_reviewed_stop_asking.sql` (LCC
  Opps, applied live) — `lcc_refresh_decisions` SEED excludes reviewed entities;
  SWEEP also supersedes any still-open junk decision whose entity is now reviewed
  (robustness). The entity stays `junk_name_flagged` (its name IS junk);
  `junk_name_reviewed` records the orthogonal "keep it, don't re-ask" judgment.
  `CREATE OR REPLACE` (OUT-row signature unchanged) → keeps the cron binding.
  Verified live: the 1 pre-existing reviewed entity's stale open decision swept
  (747→746); synthetic round-trip (seed→open, leave_flagged→reviewed+skipped,
  re-refresh→no re-mint), 0 residue. `node --check` clean; 12 functions; suite
  green except the 2 pre-existing CM chart failures.

## R15 — cron/automation health sweep + artifact-offload disk runbook (2026-06-08)

Audit grounded live across all three DBs: the automation layer is healthy
(~120 crons, pg_net 201/201 = HTTP 200 in 12h; "server restarted" entries are
Supabase infra noise). The health-alert pipeline surfaced three real issues.

### Unit 1 (HIGH) — artifact-offload cron + the disk-pressure runbook
The `lcc-artifact-offload` cron was **deliberately disabled** by migration
`20260529160000_lcc_disable_artifact_offload_crons.sql` after the every-5-minute
variant (migration `…150000`) exhausted the LCC Opps connection budget (small
tier, `max_connections=60`) during a CoStar burst and took the origin
read-unavailable. With no offload running, `staged_intake_artifacts` grew to
~9.5 GB (86% of the DB), 1,400+ artifacts still holding ~9 GB of base64
`inline_data`, **0 offloaded**, and the DB crossed the disk-pressure warn
threshold toward the ~13 GB read-only ceiling. **Auth lives on LCC Opps — a
disk-full read-only here locks out ALL sign-in.**

Durably fixed by `20260608210000_lcc_r15_reenable_artifact_offload_cron.sql`:
re-enables `lcc-artifact-offload` at the **gentle** cadence (`2-59/10 * * * *`,
limit 15, grace 15) — NOT every-5-min — and keeps the finalize-watch /
vacuum-run jobs OFF (the every-5-min jobs that caused the incident). Idempotent
(unschedule-then-schedule); supersedes the disable migration as the live source
of truth, so a future replay/rebuild can't silently leave the offload off.

**Accelerated DB-local drain + ingest-to-Storage root-cause fix (2026-06-09).**
The Railway-round-trip cron (above) only does ~2 large files/tick and, run
frequently, caused the connection incident — so two follow-ups:

1. **Edge drainer.** `supabase/functions/artifact-offload` (Deno) does the same
   offload but IN-REGION (DB + Storage both on Supabase; multi-MB bytes never
   leave the Supabase network). Cron `lcc-artifact-offload-edge` (`*/10`,
   `limit=10`) replaces the Railway-round-trip cron (migration
   `20260609200000`). Per-tick limit is bounded by the Edge ~256 MB MEMORY cap,
   not time: each ~8 MB OM decodes through base64+binary strings (~40 MB
   transient/file), so batches > ~12 hit a 546 memory kill (verified: limit 10 →
   clean 200 in ~19s; ~14-16 → 546). 10/tick × 6/hr = 60/hr outpaces the
   ~14/hr inflow, drains the backlog AND keeps the TOAST free-list populated so
   new inflow reuses freed space — **this halts physical growth even before the
   (deferred) VACUUM FULL.** For a faster one-shot drain, invoke the function
   directly more often, keeping each call's `limit ≤ 12`.
2. **Ingest-to-Storage (root cause).** `intake-om-pipeline.js` now writes inline
   OM payloads > `OM_INGEST_STORAGE_MIN_BYTES` (256 KB) straight to the
   `lcc-om-uploads` bucket at ingest (`storage_path`, no `inline_data`), so new
   OMs never re-form the backlog. Best-effort with inline fallback so ingestion
   is never blocked. Shared `api/_shared/artifact-storage.js` builds the
   deterministic object path used by both the ingest and offload paths; the
   extractor reads `storage_path` transparently. Ships on the Railway redeploy.

**VACUUM FULL reclamation — MANUAL, Scott, low-traffic window.** Per Scott's
R15 direction, **do NOT VACUUM FULL until the disk is provisioned and the
backlog is offloaded** — the edge cron is draining the backlog; the manual
VACUUM is the final reclamation step once provisioning lands. Nulling
`inline_data` is a LOGICAL clear; the TOAST bytes are not returned to the OS
until `VACUUM FULL`. The `disk_pressure` alert reads physical
`pg_database_size`, so it will NOT drop until the VACUUM FULL runs.
`VACUUM FULL` can't run in a migration/transaction and takes an ACCESS EXCLUSIVE
lock on `staged_intake_artifacts` (blocks OM intake to that table for the few
minutes of the rewrite — auth is unaffected, it's a different schema), so it is
a manual op, not an auto-fired cron.

```sql
-- Optional: confirm how much is reclaimable right now
SELECT pg_size_pretty(pg_total_relation_size('public.staged_intake_artifacts')) AS physical,
       pg_size_pretty(coalesce(sum(size_bytes) FILTER (WHERE inline_data IS NOT NULL AND storage_path IS NULL),0)) AS live_inline
FROM public.staged_intake_artifacts;

-- The reclamation (low-traffic window):
VACUUM FULL public.staged_intake_artifacts;   -- ACCESS EXCLUSIVE; ~minutes on ~9.5 GB
```

**Ordering is mandatory — drain FIRST, then VACUUM FULL (proven 2026-06-08).**
A VACUUM FULL run BEFORE the backlog drains is a NO-OP. Empirically: at DB
12.631 GB a VACUUM FULL reclaimed ~0 (table stayed 9514 MB) because the ~9 GB
is **live** base64 `inline_data`, not dead space — the 1,411 rows still holding
`inline_data` measured **8,972 MB on disk** (`sum(pg_column_size(inline_data))`),
i.e. essentially the whole table. The 708 already-offloaded rows had their
`inline_data` nulled but were the SMALL tail and freed almost nothing. (A naive
`pg_total_relation_size` 9.5 GB vs `sum(size_bytes)` 6.8 GB comparison looks
like 2.7 GB is reclaimable, but that gap is just **base64 inflation** —
`size_bytes` is the binary artifact size; the stored base64 is ~1.33× = ~9 GB.
Don't size the reclaim off `size_bytes`.) So the disk does not drop until the
LARGE `inline_data` rows are actually offloaded to Storage and nulled, and only
THEN does VACUUM FULL return the ~9 GB to the OS (DB → ~3-4 GB).

Inflow is heavy (~1.5 GB/day, ~330 large files/day) and the gentle cron's
per-tick time budget (~7s ⇒ ~2-3 large files/tick × 6 ticks/hr ≈ 290-430
large/day) is roughly **break-even with inflow** — so the cron holds the
backlog steady but won't drain it quickly. For real relief, do a **one-shot
higher-budget drain from a workstation** (Scott's DIA/GOV/LCC service keys,
controlling concurrency so it stays gentle on the 60-connection tier), then a
SINGLE VACUUM FULL. Do NOT raise the cron frequency to drain faster — the
every-5-min variant is exactly what caused the 2026-05-29 connection-exhaustion
incident.

### Unit 2 — gov `mv_gov_overview_stats` stale (CONCURRENTLY needs a unique index)
The gov cron `refresh-gov-overview-stats` (daily 01:00) ran `REFRESH
MATERIALIZED VIEW CONCURRENTLY` on an MV with only a non-unique index →
errored every run → stale stats. `mv_gov_overview_stats` is a single-row MV;
gov migration `sql/20260608_gov_mv_overview_stats_unique_index.sql` drops the
non-unique `computed_at` index and adds a UNIQUE one (no WHERE). Verified live:
CONCURRENTLY refresh now succeeds and the MV is current.

### Unit 3 — stale benign flow_failure alert (single-failure TTL)
`lcc_autoresolve_recovered_flow_failures()` only closed a flow_failure alert
after an 18h quiet window, so a one-off benign failure (e.g. a single
"HTTP-Switch" run) sat open up to 18h and trained the operator to ignore the
panel. Migration `20260608210500_lcc_r15_flow_failure_single_ttl.sql` adds a
6h **single-failure TTL** path (≤1 failure in the 18h window AND none in the
last 6h ⇒ resolve) alongside the existing full-recovery path. Recurring
failures (≥2 in the window) still only clear via full recovery, so genuinely-
broken flows stay alerted. Same signature ⇒ cron unchanged. Verified live: the
stuck HTTP-Switch alert (id 531) cleared with the TTL note.

## Phase 2 — SharePoint folder-feed worker (Slice 1, 2026-06-09)

Turns the EXISTING Team Briggs Documents tree into an ingestion channel that
flows through the SAME extract → match → promote pipeline as the email-OM
channel. **Read the tree as-is; never reorganize it; never write into it.**
Design: `audit/data-flow-2026-05-30/ARCHITECTURE_PHASE2_folder_feed.md`.

### Locked conventions (Scott, 2026-06-09)
- **DB-only tracking** — the feed records what it has SEEN in
  `public.folder_feed_seen` (LCC Opps) and writes **nothing** into the team
  tree (no sidecar, no moves). Drop the table → zero trace.
- **One pipeline, many channels** — emits a normalized payload to the EXISTING
  promoter (`stageOmIntake`); never writes dia/gov tables directly.
- **Reuse Phase 1, don't re-upload** — folder-feed files already live in
  SharePoint, so the artifact row just POINTS at the existing path
  (`storage_backend='sharepoint_pa'`, `storage_ref=<server_relative_path>`,
  `inline_data=NULL`). Extraction reads the bytes back via the Phase-1 "Get
  file content" PA flow (`SHAREPOINT_FETCH_URL`). The only NEW PA dependency is
  a **"List folder"** flow (`SHAREPOINT_LIST_URL`).

### What shipped
- **`folder_feed_seen`** (migration `20260718120000`) — `(server_relative_path,
  content_hash)` unique; `status seen|staged|promoted|skipped|error|stale`;
  `subject_hint` jsonb; `detected_type`; soft `intake_id` pointer. `content_hash`
  is an etag/size/modified change-signature for the cloud worker, a true sha256
  for the local backfill. Additive, cache-or-live-safe.
- **Worker** `?_route=folder-feed-tick` (sub-route of **intake.js** — still 12
  api/*.js; handler `api/_handlers/folder-feed.js`). GET=dry-run, POST=drain.
  Per tick (time-budgeted ~22s, bounded `limit_folders`): List each configured
  root → diff vs `folder_feed_seen` by `(path, change-hash)` → classify by
  filename → **OM/flyer PDFs** go through `stageOmIntake` (sharepoint pointer),
  everything else records `status='skipped'` + `detected_type` (lease/master/
  comp/bov/dd/unknown — NOT parsed this slice). Idempotent on `(path, hash)`; a
  vanished path → `status='stale'` (never deletes derived data, never mass-stales
  on an empty/failed listing). **Feature-flagged**: no-ops cleanly until
  `SHAREPOINT_LIST_URL` is set (the find_contacts_by_account rollout pattern).
- **Path → subject_hint anchor** (`api/_shared/folder-feed-classify.js`, pure,
  shared by worker + script) — from `PROPERTIES/<bucket>/<TENANT/BRAND>[/<City,
  ST>]/…`: tenant_brand, city/state (`^(.+),\s*([A-Z]{2})$`), vertical (tenant
  cues / research-root). **Fed into the EXISTING matcher** via
  `runDownstreamPipeline` (intake-extractor.js): backfills the matcher's
  missing `city`/`state`/`tenant_name` from `seed_data.subject_hint` before the
  match pass (fill-blanks only — the address still comes from the document; path
  beats a missing cover-page field). Unresolved → the existing
  `match_disambiguation` lane, never a guess-write. No-op for other channels.
- **`stageOmIntake` extension** (`intake-om-pipeline.js`) — accepts a
  SharePoint-resident artifact (`storage_backend='sharepoint_pa'` +
  `storage_ref`, no bytes/upload); records `inline_data=NULL`, `storage_path=NULL`,
  `storage_backend/ref` set. The extractor's Path-3 sharepoint branch already
  reads these.
- **Local backfill** `scripts/folder-feed-backfill.mjs` — one-time legacy sweep
  from the synced library on disk (`C:\Users\scott\NorthMarq Capital, LLC\Team
  Briggs - Documents`); walks the tree, classifies, and for OM PDFs uploads
  bytes directly via `/api/intake/stage-om` (bytes are local — sanctioned for
  the backfill). Resumable via a local manifest; gentle concurrency (default 3).
  Steady-state new files ride the cron + List flow (reference mode, no re-upload).
- **Cron** `lcc-folder-feed` (migration `20260718121000`, `*/30`) →
  `lcc_cron_post('/api/folder-feed-tick?limit_folders=8', …, 'vercel')`. GENTLE
  cadence (artifact-offload lesson). No-ops until `SHAREPOINT_LIST_URL` is set;
  the endpoint 404s until intake.js ships (verify post-deploy with a GET
  dry-run, same posture as lcc-artifact-offload).

### Env
- `SHAREPOINT_LIST_URL` — PA "List folder" flow (NEW; the worker no-ops without
  it). `SHAREPOINT_FETCH_URL` — Phase-1 "Get file content" flow (already exists;
  extraction read-back). `FOLDER_FEED_ROOTS` — comma-separated folder roots
  (else the handler defaults: `Storage OM's`, `Gv't Leased Research`, `Dialysis
  Research`).

### Verified (headless 2026-06-09)
Classifier + path anchor unit-tested (`test/folder-feed-classify.test.mjs`, 9
cases). `node --check` clean; `ls api/*.js | wc -l`=12; vercel.json valid; full
suite 548 pass / 0 fail.

### Out of scope (later units)
Lease-abstract / master-sheet / comp-export extractors · LCC-output write-back
to Memos/Comps with `[LCC]` tagging · the `promoted` status reconcile ·
correspondence/notes (Phase 3) · the shared-context MCP service (Phase 4).

## Phase 2 Slice 2a — PROPERTIES enrich-read channel (2026-06-10)

Adds the PROPERTIES tree as a SECOND folder-feed channel with **enrich-only**
semantics: extract → match an EXISTING property via the path anchor → enhance it
(fill blanks + attach the doc + write provenance). It **never creates a property**
and **never writes listings/sales/contacts**; an unresolved file routes to the
existing `match_disambiguation` decision lane. Same extract→match machinery as the
On Market ingest channel (Slice 1d), different write policy. DB-only tracking is
unchanged — nothing is written into the SharePoint tree.

### The two write policies, one pipeline
- **ingest** (On Market roots) — full create/update promoter (Slice 1). May
  create a property/listing.
- **enrich** (PROPERTIES roots) — `runEnrichOnlyPromotion` in
  `intake-promoter.js`: requires a confident EXISTING match; runs only
  `promotePropertyFinancials` (fill-blanks-only), attaches the OM/flyer as a
  `property_documents` row, and records `field_provenance`
  (`source='folder_feed_properties'`). No listing/sale/contact/lead writes. No
  match → `emitMatchDisambiguation` (idempotent on the intake), never a create.

### Mode threading
`folder-feed.js` walks **ingest roots FIRST, then enrich roots** with a separate
small `enrich_limit_folders` budget (default 4) so a deep ~27-bucket PROPERTIES
pass never starves the ingest channel in a shared tick. Each file is tagged with
its `mode` (carried down the per-phase BFS queue), passed into
`seed_data.mode`, and recorded on `folder_feed_seen.mode`. The mode flows
`seed_data.mode` → `runDownstreamPipeline` → `promoteIntakeToDomainListing`'s
`context.promoteMode` (default `'ingest'` — every other channel is unchanged /
byte-identical). The path `subject_hint` already backfills the matcher's
city/state/tenant before the match pass (Slice 1), so an OM whose cover page
omitted the city still resolves.

### folder_feed_seen status for enrich
A resolved+enriched file AND an unresolved-but-disambiguated file BOTH record
`status='staged'` (the disambiguation decision IS the handled outcome) — never
`error`. The intake carries `extraction_result.enrich_ok` + `enrich_fields_filled`.

### SAFETY / rollout (matches Slice 1)
- **Feature-flagged**: with `FOLDER_FEED_ENRICH_ROOTS` **unset** the enrich
  channel is INERT (the cron walks ingest roots only — `enrich_roots=0`). Set the
  env (present-but-empty falls back to the PROPERTIES default) to engage it.
  Manual capped drains target either channel via `?folders=<dir>&mode=enrich`
  (`?folders=` splits on comma, so target the comma-free tenant folder and let
  BFS recurse into `City, ST`).
- The cron stays ingest-only until Scott + Claude/Cowork run a capped dry-run
  then a capped real drain on ONE PROPERTIES folder and confirm it ENRICHED an
  existing record (no new property, fill-blanks only, provenance written) — same
  first-drain discipline as On Market. Only then add the enrich roots to the env.

### Migrations (LCC Opps, additive)
- `20260718123000_lcc_phase2_folder_feed_mode.sql` — `folder_feed_seen.mode`
  (`ingest`|`enrich`, default `ingest`).
- `20260718124000_lcc_phase2_folder_feed_properties_priority.sql` —
  `field_source_priority` rows for `source='folder_feed_properties'` (priority 50,
  parallel to `om_extraction`) on the gov/dia properties + property_documents
  fields the enrich path writes (else `v_field_provenance_unranked` flags drift).

### Env
- `FOLDER_FEED_ENRICH_ROOTS` — comma-separated PROPERTIES roots (full
  server-relative, single apostrophes). Unset ⇒ enrich inert. Default value when
  present-but-empty: `/sites/TeamBriggs20/Shared Documents/PROPERTIES`.

### Verified (headless 2026-06-10)
`test/folder-feed-enrich-mode.test.mjs` (promoter: enrich+match fills blanks +
attaches doc + provenance, no listing/sale/property-create; enrich+no-match emits
disambiguation, creates nothing; ingest writes a listing) + `test/folder-feed-
enrich-channel.test.mjs` (mode tagging on `folder_feed_seen`; enrich inert when
the env is unset). `node --check` clean; `ls api/*.js | wc -l`=12; full suite 576
pass / 0 fail / 6 skipped.

## Phase 2 Slice 2b — write LCC-generated docs back into property folders (2026-06-10)

The WRITE side of the PROPERTIES channel (Slice 2a was the READ side). An
LCC-generated deliverable (BOV / OM / client memo / master sheet) is written
INTO the matched property's own SharePoint folder, tagged `[LCC]` so re-ingest
knows it's our authoritative work, and linked to the property record — the
folder + the DB become one connected object. Built as the **mechanism** (one
entrypoint any producer calls), not a specific producer integration. DB-only
tracking unchanged — nothing else is written into the tree.

### Doctrine / safety
- **Tag every LCC-authored file** `… [LCC].<ext>` AND link a `property_documents`
  row with `source='lcc_generated'` (top-trust). The folder-feed read path SKIPS
  re-ingesting `[LCC]`-tagged files (`classifyFile` returns
  `{type:'lcc_generated',isOm:false}` FIRST, before the OM branch, so an
  `… OM [LCC].pdf` is recorded `status='skipped'`/`detected_type='lcc_generated'`,
  never re-extracted).
- **Never overwrite** — `dedupeFileName` appends ` (YYYY-MM-DD)` (then `-N`) on a
  name collision in the destination folder; write-back is additive.
- **Resolve the folder confidently or REFUSE** (422 `folder_unresolved`) — no
  guessed writes into the wrong property folder.
- **Feature-flagged on `SHAREPOINT_UPLOAD_URL`** — clear 503 until the PA upload
  flow is wired (storage-adapter / find_contacts_by_account rollout pattern).

### What shipped
- **PA flow (Scott, native browser):** "Http -> Upload file (LCC Put Artifact)"
  — HTTP trigger body `{folder_path, file_name, content_base64}` → SharePoint
  **Create file** (Folder Path = `triggerBody()?['folder_path']`, File Content =
  `base64ToBinary(triggerBody()?['content_base64'])`) → response wraps
  `body('Create_file')?['Path']` into `{ok:true, server_relative_url}`. URL →
  `SHAREPOINT_UPLOAD_URL` env.
- **`api/_shared/storage-adapter.js` `uploadDocToFolder({folderPath, fileName,
  bytes, fetchImpl})`** → POSTs `SHAREPOINT_UPLOAD_URL`; returns `{ok,
  server_relative_url, status, detail}`. 503 when env unset; never throws (a
  failure ⇒ caller writes nothing to the DB).
- **`api/_shared/property-folder-resolver.js`** — resolve `(domain, property_id)`
  → PROPERTIES folder. **Priority:** (1) KNOWN — parent dir of the most recent
  `property_documents.source_url` under a case-sensitive `/PROPERTIES/` subtree
  (Slice 2a populates these; absolute vendor URLs like crexi `/properties/` are
  rejected); (2) DERIVED — `PROPERTIES/<bucket>/<tenant>/<City, ST>` (bucket =
  first alnum of tenant, A–Z else digit; dia tenant / gov agency), used ONLY
  when verified to exist via the List flow; (3) UNRESOLVED → refuse. Pure helpers
  (`bucketOf`/`deriveFolderCandidates`/`parentOfPropertiesUrl`) + an injectable-
  deps `resolvePropertyFolder` for testing.
- **`api/_handlers/property-doc-writeback.js` → `POST /api/property-doc-writeback`**
  (sub-route of intake.js, `?_route=property-doc-writeback` + vercel rewrite — no
  new api/*.js, still 12). Body `{domain, property_id, file_name, doc_type,
  content_base64}`. Flow: resolve folder → `[LCC]` tag + de-dup → `uploadDocToFolder`
  (502 + no DB write on failure) → insert `property_documents`
  (`source='lcc_generated'`, `source_url`=returned path) + `field_provenance`
  (`source='lcc_generated'`, confidence 1.0). **Effect-first / outcome-truthful:**
  a DB-link failure AFTER a successful upload returns **207** with the uploaded
  path so the file isn't lost. Core extracted to `performDocWriteback(args, deps)`
  for unit testing.
- **`[LCC]` marker single source of truth** in `folder-feed-classify.js`
  (`LCC_TAG`/`hasLccTag`/`ensureLccTag`/`dedupeFileName`) so the re-ingest guard
  and the tagger can't diverge.
- **Migration** `20260718125000_lcc_phase2_slice2b_lcc_generated_priority.sql`
  (LCC Opps, additive) — `field_source_priority` rows for `source='lcc_generated'`
  on gov/dia `property_documents` (file_name/document_type/source_url) at
  **priority 1** (top — our own work product; else `v_field_provenance_unranked`
  flags drift). `record_only` mode, idempotent.

### Env
- `SHAREPOINT_UPLOAD_URL` — PA "LCC Put Artifact" upload flow (NEW; write-back is
  a 503 no-op without it). `SHAREPOINT_LIST_URL` (existing) — used to verify a
  derived folder exists + to list names for de-dup. `FOLDER_FEED_PROPERTIES_ROOT`
  (optional) — derived-fallback PROPERTIES root override.

### Verified (headless 2026-06-10)
`test/property-folder-resolver.test.mjs` (bucket/derive/parent helpers; resolver
known-path / derived-verified / refusal / missing-input) +
`test/property-doc-writeback.test.mjs` (tag idempotency; de-dup dated+counter;
re-ingest guard classifies `[LCC]` as skipped; `performDocWriteback` 200 / 422
refuse-no-write / 502 upload-fail-no-DB / 207 upload-ok+DB-fail). `node --check`
clean; `ls api/*.js | wc -l`=12; vercel.json valid; full suite 607 pass / 0 fail
/ 6 skipped. Ships on the Railway redeploy.

### After deploy
Once `SHAREPOINT_UPLOAD_URL` is set, Scott calls `/api/property-doc-writeback`
with a small test doc against the already-mapped DaVita Chilton property (29841):
confirm it lands in that property's folder as `… [LCC].pdf`, links an
`lcc_generated` property_documents row, and is NOT re-ingested by the next enrich
tick.

### Out of scope (Slice 3, later)
The context layer — linking property + docs to email / SF notes / conversation
notes / LLC research (the shared-context service). Separate prompt.

## Phase 2 Slice 2f — On Market ingest on the frontier cursor + archive/working exclusion (2026-06-11)

71 On Market OMs were stuck in `folder_feed_seen.status='seen'` (deferred) and
never re-reached: the ingest cron (`/api/folder-feed-tick?limit_folders=8`,
mode=ingest) used the legacy `walkPhase` whose `queue = rootList.slice()`
RESTARTS the BFS from the roots every tick and is bounded to 8 folders — so it
re-walked the top On Market folders forever and never descended to the deep
subfolders where the deferred OMs lived. Same no-cursor bug Slice 2d fixed for
ENRICH; the INGEST path is now on the same `folder_feed_frontier` cursor.

### Unit 1 — ingest rides the frontier (structural fix)
`api/_handlers/folder-feed.js` `?source=frontier` now drives **one channel per
tick** keyed by `&mode=`: `mode=ingest` crawls the On Market (ingest) roots via
the durable cursor and stages OMs through the SAME `stageOmIntake` ingest path;
`mode` unset defaults to **enrich** (byte-identical to the Slice-2d enrich crawl
+ its dry-run shape). One mode per tick keeps the ingest/enrich budgets separate
(Slice 2a.1 lesson) — a dedicated tick gets the FULL time budget, no reserve.
`crawlFrontier`/`processFolder` already branch on the frontier row's `mode`, so
ingest rows stage (not enrich-attach). Deferred `'seen'` rows re-stage
automatically once the frontier reaches their folder (the worker already falls
through `'seen'` → re-attempt). Cron change (migration
`20260718129000_lcc_phase2_slice2f_ingest_frontier_cron.sql`): RETIRE the legacy
cursorless `lcc-folder-feed` tick; SCHEDULE `lcc-folder-feed-crawl-ingest`
(`0,30 * * * *` → `?source=frontier&mode=ingest&limit_folders=10`), offset from
the enrich crawl (`lcc-folder-feed-crawl`, `:10/:40`, unchanged). **No schema
migration** — `folder_feed_frontier` already allows `mode='ingest'` and
`folder_feed_seen` already allows `status='skipped'`.

### Unit 2 — exclude archive + working subfolders
New shared helper `isExcludedFolderPath()` (`folder-feed-classify.js`,
`EXCLUDED_FOLDER_SEGMENT_RES` named constant): excludes any path whose whole
SEGMENT is `OLD`/`Archive`/`Archived` OR starts with `_` (leading-underscore
working/staging folders). Segment-anchored so a tenant named "Old Dominion …"
(segment "Old Dominion" ≠ "OLD") is NOT caught. Applied in BOTH places in
`processFolder`: the subfolder ENQUEUE loop (excluded subfolders are never
descended into — no frontier/queue row) AND the per-file loop (defense-in-depth:
a file in an excluded folder is recorded `skipped`/`detected_type=
'excluded_archive_or_working'`, never staged). When an excluded subfolder is
discovered, `skipExcludedSubtree()` flips any existing `(seen,error)` backlog rows
under it to `skipped` via one bounded, idempotent PATCH — so the 56 `On Market/OLD`
+ 15 `_added or updated in comps spreadsheet` deferred rows drain WITHOUT ever
re-listing the folder, and the stale-sweep (never lists the excluded parent)
leaves them alone. New `report.files_excluded` counter.

### Verified (headless 2026-06-11)
`test/folder-feed-classify.test.mjs` (+`isExcludedFolderPath` cases: OLD/Archive/
Archived/leading-underscore excluded; "Live Deal" + "Old Dominion" NOT) +
`test/folder-feed-ingest-frontier.test.mjs` (ingest frontier descends On Market,
enqueues only live subfolders w/ mode=ingest, stages an OM via the ingest path,
SKIPS a non-OM lease per ingest policy — not enrich attach; OLD + `_working`
never enqueued and their backlog rows flipped to skipped; GET dry-run reports
ingest cursor counts without mutating). `node --check` clean; `ls api/*.js | wc
-l`=12; full suite 699 pass / 0 fail / 6 skipped. Ships on the Railway redeploy.

## R15 — generic CRE property registry (the "high-value middle", Phase 1, 2026-06-11)

LCC is two deep verticals (dia = CMS, gov = GSA), but the PROPERTIES SharePoint
tree is Briggs's WHOLE net-lease book — office (Vervent/Vistra), retail, bank
(Santander), entertainment (Top Golf), MOB. ~84% of enrich docs are these other
asset classes; they correctly PARKED (`skip_reason='out_of_domain_asset_class'`)
because they had no home DB. R15 builds the **lightweight middle**: a generic CRE
registry so the BD spine (entities → owner) covers these owners WITHOUT a third
underwriting engine. **The value is the OWNER, not the underwriting** — no
scoring / NOI / cap-rate columns, deliberately (no public-data equivalent exists
for office/retail; these are relationship-tracked, not underwritten).

### What shipped (Phase 1 = store + register-by-path + owner-entity + doc-attach)
- **Store (LCC Opps, migration `20260718130000_lcc_r15_cre_registry.sql`,
  additive):** `lcc_cre_properties` (id, normalized_address, address, city, state,
  tenant_brand, `asset_class` text, `owner_entity_id` uuid→entities(id),
  source_path, metadata) + `lcc_cre_property_documents` (doc-attach, mirrors
  dia/gov property_documents). Natural-key dedupe = partial unique indexes on
  `(normalized_address, upper(state))` and `(lower(tenant_brand), lower(city),
  upper(state))` (the tenant+city fallback when no address yet). NO
  scoring/financial columns by design. `field_source_priority` rows for
  `source='folder_feed_cre'` (priority 50) registered so
  `v_field_provenance_unranked` stays at 0. Drop the two tables → zero trace.
- **The core (`api/_shared/cre-registry.js`):** `performCreRegister(args, deps)`
  (deps-injected, unit-tested) → match-or-create the CRE property by natural key
  (fill-blanks only), resolve the OWNER → entity, attach the doc, write
  provenance. `registerCreProperty(args)` wires the production deps (opsQuery +
  ensureEntityLink + lcc_merge_field). **Owner is minted via `ensureEntityLink`
  with `domain='cre'`, deduped by canonical_name** (NO novel `external_identities`
  source_system — the composite-person path mints the same way, so the deferred
  R4-A source_system CHECK can't break it). The shared junk / implausible-person /
  federal-anti-pattern guards (domain-agnostic) reject garbage → owner left
  pending, **never invents an owner**. `entities.domain='cre'` has no CHECK
  constraint (verified live) and `canonicalEntityDomain` preserves it.
- **Two entry points, one core:**
  - **OM/master-sheet enrich path** (`intake-promoter.js runEnrichOnlyPromotion`):
    on an unmatched enrich intake whose `subject_hint.vertical` is NOT dia/gov →
    `registerCreProperty(snapshot)` instead of churning the match_disambiguation
    lane. The extraction snapshot supplies the OWNER (seller/owner name) — the BD
    payoff. A genuine dia/gov miss (vertical cue present) still routes to
    disambiguation. Returns `{cre_registered, cre_property_id, owner_entity_id,
    owner_pending}`.
  - **Light-attach path** (`folder-feed-attach.js attachRecognizedDoc`): the
    out-of-domain (no dia/gov cue) branch registers by PATH ANCHOR (tenant/city,
    no extraction → owner pending for the Phase-2 backfill) instead of parking.
    PARKS only when the anchor is too weak (no tenant + no address) →
    `registered:false`, the old honest out-of-domain park. `folder-feed.js`
    records `status='attached'` + stamps `subject_hint.cre_property_id` /
    `owner_pending`; new `report.files_cre_registered` counter.
- **dia/gov pipelines UNCHANGED** — the CRE branch only fires on the
  `out_of_domain_asset_class` set that parks today (gated on no dia/gov vertical
  cue). **No scoring/underwriting.** ≤12 api/*.js (CRE branch lives in the
  existing handler/_shared modules, no new api/*.js).

### Queue/cadence (by construction, no per-band change)
A bare `domain='cre'` owner entity has no `lcc_entity_portfolio_facts` edge, no
`bd_opportunity`, no cadence — so it does NOT appear in the property-driven or
relationship bands until it earns one (no crash, no rank-zero pollution — the
queue is driven by portfolio/cadence/opp a bare CRE entity lacks). Surfacing CRE
owners in relationship bands (a CRE portfolio sync) + the context-packet variant
+ owner backfill for path-registered rows are **Phase 2**.

### Verified (headless 2026-06-11)
`test/cre-registry.test.mjs` (core: with-owner → property+owner+doc; no-owner →
registers + owner pending, never invents; junk owner → pending; weak anchor →
registered:false PARK; existing property → fill-blanks, no dup) +
`test/folder-feed-attach.test.mjs` updated (out-of-domain → CRE register, never a
disambiguation; no-anchor → park). Migration validated against live LCC Opps in a
rolled-back tx (FK + both natural keys + fsp insert OK; **0 residue**). `node
--check` clean; `ls api/*.js | wc -l`=12; full suite 747 pass / 0 fail / 6
skipped. DB migration is additive (apply anytime); JS ships on the Railway
redeploy.

### Phase 2 (follow-ups, not in this phase)
Owner backfill for path-registered rows (re-extract the doc for the owner) ·
a CRE portfolio sync so cross-asset-class owners (a Vervent/Top Golf owner that
ALSO owns dia/gov) surface a unified portfolio in the queue · the CRE context
packet variant for MCP/agents · asset-class refinement.

## Stage B Unit 1 — fix the lease-less-property gap + re-gate (2026-06-13)

The Unit 1 boundary was already proven (dry-run + real-write both
`boundary_ok:true`/`reported_targets:[]`, DB-level CHECK/registry/byte-identical
view) and the resolve worked (caller-pinned → gov 30430). But the live gate
surfaced a real gap on **30430** (a property with NO existing lease row): the
real-write returned `fields_filled:0, ti_rows:0` and minted an **orphan
guarantor entity**. Root cause: the enricher fill-blanks-PATCHed an existing
lease row and never CREATED one when absent, so at scale most lease-less
properties would go unenriched and accumulate orphan guarantors.

### The fix (`api/_handlers/lease-extractor.js`)
- **Create the lease when none exists.** New `ensureLeaseRow` dep
  (`buildRealLeaseDeps`) resolves the property's active lease or, when genuinely
  absent, CREATES one from the extracted facts (`data_source='folder_feed_lease'`;
  dia sets `status='active'`/`is_active=true`, gov has neither — active ==
  `superseded_at IS NULL`). Dedupes against any existing active lease via
  `activeLeaseQuery(domain)` — **one-active-lease-per-property, never a
  duplicate**. The lease doc IS the lease.
- **Never orphan the guarantor.** `applyLeaseEnrichment` now resolves/creates
  the lease FIRST; if it can't be created/linked it returns `ok:false` +
  `warnings:[lease_unresolved:…]` **before** the guarantor mint — no guarantor
  without a lease/edge to attach to. TI rows + the `guaranteed_by` edge only run
  once the lease exists, so the edge forms naturally. On the create path the
  factual fields land at insert (provenance recorded for observability); the
  existing-lease patch path is unchanged (provenance-first per field).
- **Boundary intact.** The create-path writes only the factual lease columns
  (`planLeaseWrites` map + the `isReportedField` guard) — never price/cap
  advisories. The four guards still apply.
- **Two latent write bugs fixed along the way** (the re-gate would have failed
  on them): (a) `gov.lease_ti_amortization.lease_id` was `bigint` but
  `gov.leases.lease_id` is **uuid** → TI could never link; corrective gov
  migration `government/20260613_gov_stageB_unit1_lease_ti_lease_id_uuid.sql`
  (table empty, applied live). (b) The TI `uq_lease_ti_lease_year` was a
  `COALESCE()` expression index that PostgREST's
  `on_conflict=lease_id,property_id,schedule_year` can't infer (42P10) → replaced
  with a plain unique index `NULLS NOT DISTINCT` on both domains (gov above +
  dia `dialysis/20260613_dia_stageB_unit1_lease_ti_uq_fix.sql`). (c) the real
  `mergeField` dep omitted the **required** `p_source_run_id` (no default) and
  passed `p_value` as a String not jsonb → `lcc_merge_field` failed to resolve
  and provenance silently never recorded; fixed to the canonical
  `field-priority-guard.js` convention.

### Re-gate (gated; synthetic throwaway gov property, 0 residue)
Exercised every write the production path performs on synthetic gov property
990000777 (sanctioned throwaway), then deleted all rows across gov + LCC Opps
(verified 0 residue): lease CREATED (uuid `e552…`), **`fields_filled=11`**,
**`ti_rows=1`** linked to the uuid lease_id (on_conflict inference works,
idempotent on re-tick), dedupe holds (1 active lease — a re-run is
created:false, no duplicate), `lcc_merge_field` returned `decision='write'`,
`new_priority=45`, `enforce_mode='record_only'` and wrote 2 `folder_feed_lease`
`field_provenance` rows on `gov.leases` (conflicts → Decision Center, no
clobber), and the **`guaranteed_by` edge formed** (guarantor → asset). The gap
30430 couldn't exercise is closed.

### Verified (headless 2026-06-13)
`test/lease-extractor.test.mjs` 13 → **16** (new: create-path fills+TI+guarantor;
no-orphan gate — lease unresolved ⇒ `ok:false`, no guarantor, no TI; existing
active lease reused via the patch path, no duplicate). `node --check` clean;
`ls api/*.js | wc -l`=12; full suite **779 / 773 pass / 0 fail / 6 skipped**.
Both corrective migrations applied live (gov TI lease_id now uuid; both uq
indexes plain `NULLS NOT DISTINCT`). JS ships on the Railway redeploy.

### Widen — still PAUSED (next, gated)
Auto-route `detected_type='lease'` through the extractor + the
`property_financials` #64 leg + the MCP search surface remain paused until this
fix is merged and Scott blesses the widen.

## R16 — unlock the outreach loop: auto-acquire SF contacts + tighten reachability (2026-06-13)

The conversion point of the whole system. Grounded live 2026-06-13: 409
cadences, only 3 ever touched, 400 overdue — not a cadence-mechanics problem,
there was no one to contact (395 prospecting cadences, 0 with a `contact_id`/
`sf_contact_id`). Of the 395, **67 carry a Salesforce ACCOUNT identity**
(`external_identities source_system='salesforce', source_type='Account'`) — the
human contacts almost certainly already exist in SF and just weren't pulled into
LCC. The other 328 (no SF, no person) are cold contact-acquisition — **out of
scope** (research/CoStar capture, separate track).

### Unit 1 — the contact-acquisition worker (shipped)
`?_route=contact-acquisition-tick` (sub-route of **operations.js** — no new
api/*.js; handler `api/_handlers/contact-acquisition.js`). GET=dry-run /
POST=drain. Per tick (bounded `limit` default 25 + a ~20s wall-clock budget):
1. **Select** contactless overdue active cadences (`contact_id IS NULL AND
   sf_contact_id IS NULL`, `next_touch_due<=now`, active phases), one per entity.
2. **Map** which of those entities carry an SF **Account** identity (+ the
   entity's workspace) — the 67 set; entities with no SF account are skipped
   (the cold 328).
3. For each: call the EXISTING **`getSalesforceContactsByAccount`**
   (`find_contacts_by_account` flow), create each returned contact as a person
   via **`ensureEntityLink`** (`sourceSystem='salesforce'`,`sourceType='Contact'`
   → guards + SF-identity mirror, never invents garbage), **link** person→entity
   (`associated_with`), and **stamp the PRIMARY** contact onto the cadence
   (`contact_id`/`sf_contact_id`) → outreach-ready.
- **Reuse, not fork:** the link + cadence-stamp logic lives once in
  `api/_shared/contact-attach.js` (`linkPersonToEntity`,
  `stampCadenceContactById`, `stampContactOnActiveCadence`), shared by the worker
  AND the interactive P-CONTACT picker (`bridgeSelectProspectingContact` was
  refactored onto it). The worker does NOT fire SF Tasks per contact — the
  operator fires the task when they work the touch (R10 Unit 4 draft/log-touch).
- **Don't re-hammer / outcome-truthful:** SF-no-contacts and capped-transient
  outages are recorded under the NEW `touchpoint_cadence.metadata` jsonb
  (`contact_acquisition: {status, attempts, last_attempt_at}`); `isAcqExhausted`
  excludes them from the next tick. An acquired cadence carries contact ids so it
  naturally leaves the contactless set. A no-contacts entity falls to P-CONTACT
  (Unit 2) for manual acquisition. Acquired ⇒ one
  `lcc_refresh_priority_queue_resolved()` at tick end (Slice-1 staleness hook).
- **Feature-flagged:** no-ops cleanly when `SF_LOOKUP_WEBHOOK_URL` is unset
  (same posture as the buyer picker / folder-feed). Migrations: metadata column
  `20260719122000`; gentle cron `lcc-contact-acquisition` (`*/30`)
  `20260719122500` (no-ops until the SF flow + JS deploy; endpoint 404s until
  operations.js ships — verify post-deploy with a GET dry-run).

### Unit 2 — reachability gate: SF account identity is NOT a reachable human
Migration `20260719123000` (`CREATE OR REPLACE v_priority_queue_live` +
queue-cache refresh). R10 Unit 3b counted a bare SF **account** identity as
"connected" ⇒ the 67 sat in the OUTREACH bands (P0/P6/P7) with no person to
email. Now reachability requires a real human: a new `person_connected_entities`
CTE (the two person-relationship branches, **minus** the SF-identity branch)
drives `reachable_cadence`; a cadence is reachable iff `sf_contact_id`/
`contact_id` OR a person relationship. **Scope:** ONLY the cadence reachability
predicate changed — P0.4/P0.5 keep the original `connected_entities` (SF account
identity legitimately = "connected" for the R6 ownership-resolution question, a
different question). So SF-mapped-but-contactless entities correctly sit in
P-CONTACT until Unit 1 (or a human) attaches a contact.
- **DEPLOY ORDER:** apply Unit 2 AFTER running the Unit 1 drain, so the 67
  acquire contacts first instead of all dumping into P-CONTACT. Applying earlier
  is still SAFE (P-CONTACT IS the honest state) — just more visible manual work
  until the worker drains.

### Boundaries / verified (headless 2026-06-13)
dia/gov pipelines untouched (reads SF contacts, writes LCC person entities +
cadence links). `test/contact-acquisition.test.mjs` (8): acquired path
(persons created+linked, primary stamped); no-contacts → recorded, nothing
stamped, falls to P-CONTACT; all-guard-rejected → no_usable_contacts (never
invents); SF unavailable → retryable with incremented attempts;
`isAcqExhausted` re-hammer guard; contact-attach metadata-merge + dupe-guard.
`node --check` clean; `ls api/*.js | wc -l`=12; vercel.json valid; full suite
811 pass / 0 fail / 6 skipped. JS ships on the Railway redeploy.

### After deploy (verify live)
With `SF_LOOKUP_WEBHOOK_URL` set: GET dry-run, then POST drain — the 67
SF-mapped contactless cadences acquire contacts and become outreach-ready
(`contact_id`/`sf_contact_id` set); touchable cadences jump from ~3 toward ~70.
Then the R10 Unit 4 draft → mark-sent → advance loop closes on a real recipient.
Apply the Unit 2 gate after the drain; confirm no outreach card shows an empty
recipient.

## R17 — value-rank the connect-the-data work (P0.4 + P-CONTACT) (2026-06-13)

The app guides the operator to the right KIND of work (connect-the-data vs
next-touch), and the touch bands (P1-P8, P-BUYER) are value-ranked via
`rank_annual_rent` (R11 + R14). But the two big CONNECT bands were NOT
value-ranked, so the app couldn't tell the user WHICH connection matters most.
Grounded live 2026-06-13: **P0.4** (resolve ownership) 543 rows, 59% rank-zero;
**P-CONTACT** (select prospecting contact) 316 rows, 99% rank-zero. Connect-work
is ~87% of all surfaced work — the larger half of "guide where to spend time" was
sorting NULLS-LAST (noise).

### The fix — a relationship-graph fallback tier in `rank_annual_rent`
The rank-zero connect entities lack an `lcc_entity_portfolio_facts` edge (so no
rollup, no representative property), but many carry **owns / purchases / leases**
edges in `entity_relationships` to ASSET entities, and those assets have value in
`lcc_property_attributes` (annual_rent, fallback noi). The value existed; it was
never joined into the connect-band rank.
- **Linkage (verified live):** owner = `from_entity`, asset = `to_entity` for
  owns/purchases/leases. The asset entity carries an `external_identities` row
  (`source_type='asset'`, `source_system`=domain, `external_id`=property_id) →
  `lcc_property_attributes(source_domain, source_property_id)`. brokers/sells/
  finances are **excluded** (past/agency edges, not control).
- **Connected-property value** = SUM over the DISTINCT controlled properties of
  `COALESCE(NULLIF(annual_rent,0), noi)` (dedup so owns+purchases to the same
  asset counts once).
- **New COALESCE chain** (`v_priority_queue_enriched.rank_annual_rent`): trigger
  rollup → portfolio rollup → representative-property rent → **connected-property
  value** → P-BUYER rollup → NULLS LAST.

### Bounding the cost (the R7 caching doctrine)
The aggregation walks ~45k owns/purchases/leases edges → external_identities →
lcc_property_attributes (~270ms standalone) — too costly to add live to every
items-page enriched read. So it is **materialized** into a small cron-refreshed
cache table **`lcc_entity_connected_value`** (~2,948 rows: entity_id PK,
connected_property_value, connected_property_count) and the enriched view
hash-joins it cheaply — exactly how `lcc_property_attributes` bounds the
representative-property join. `lcc_refresh_entity_connected_value()` +
cron **`lcc-entity-connected-value-refresh`** (`17 * * * *` — connected value is
a slow-moving signal; a band-moving connect verdict moves the row out of the band
regardless, so it doesn't need the */5 queue cadence). ANALYZE baked in;
autovacuum hardened (full-replace each tick).

### Safe by construction / scope guards
- **Empty cache ⇒ pre-R17 behavior** (connected_property_value NULL ⇒ the tier is
  inert ⇒ connect rows sort NULLS-LAST). DB-vs-Railway deploy order is irrelevant;
  a stalled cron only ever costs ranking quality, never correctness.
- The cv join is **GATED on `priority_band IN ('P0.4','P-CONTACT')`**, so the
  touch bands (P1-P8, P-BUYER) **and P0.5** are byte-identical — verified live by
  md5 of each band's ordered (entity_id, rank) set (all 11 non-target bands match
  pre/post exactly).
- Genuinely value-less entities (no portfolio, no representative property, no
  connected assets) still sort NULLS-LAST — correct. The relationship→property
  mapping is conservative: an unresolvable asset contributes 0, never an error.
- dia/gov pipelines untouched. ≤12 api/*.js.

### Migration / JS
- LCC Opps migration `20260613200000_lcc_r17_connect_band_connected_value_rank.sql`
  (additive table + refresh fn + cron + `CREATE OR REPLACE VIEW` that appends two
  columns at the END and extends the one rank expression). Applied live.
- `api/admin.js` selects `connected_property_value` / `connected_property_count`
  on the items page + detail band (the ORDER BY already keys on
  `rank_annual_rent`, so ranking improves with **zero JS change** the moment the
  migration lands). `ops.js` card falls back to "$X rent (N connected properties)"
  when there's no portfolio/subject-property rent. Ships on the Railway redeploy.

### Verified live (read-only) 2026-06-13
- All 10 touch bands (P1-P8, P-BUYER) + P0.5 **byte-identical** (count AND md5 of
  the ordered (entity_id, rank) set).
- **P0.4** rank-zero 317 → 313 (only 4 rescued — the data refuted the premise
  that rank-zero P0.4 carry rich edges: of 317, only 20 have ANY edge and 4 reach
  a valued property; the other 313 are genuine orphan owners → correctly
  NULLS-LAST). **P-CONTACT** rank-zero 314 → 254 (60 rescued). Top rescues now at
  the band head: Northwestern Mutual $26.1M, Foulger Pratt $24.3M (2 props),
  Jamestown $22.8M, Akridge, MetLife — previously buried NULLS-LAST.
- Items-page query (enriched + ORDER BY + LIMIT 150) **90ms** (gated cache join is
  negligible). `node --check` clean; 12 functions; suite 824 pass / 0 fail / 6
  skipped.

### Secondary (junk lane) — already satisfied
The `junk_entity_name` lane (746 open) is already positioned at slot #9 in the
Decision Center ordering (`renderReviewConsolePage`), below the ownership/contact
connect-work (confirm_true_owner #1, buyer parents #2) — not peer-to-peer with
high-value ownership resolution. No change made.

### Follow-ups (not in R17)
The rendering of the connected-value state in the entity-detail Next-Step banner
(the full "one truth, three renderings"); optional `owns`-weighted tiering of the
connected value (kept a flat SUM here — "dollars of property controlled" is the
honest, explainable signal).

## R18 — durable DB-growth prevention: close the whack-a-mole (2026-06-15)

DB-size bloat caused two near-auth-lockout incidents (May: `sf_sync_log` 5.5 GB;
June: `staged_intake_artifacts` 9.85 GB). **Auth lives on LCC Opps — disk-full
there = read-only = total sign-in lockout.** Audit verdict 2026-06-15:

- The two incident tables are durably **source-fixed** (payloads externalized —
  `sf_sync_log` no longer stores `payload` on `ok` rows; OM artifacts now write
  to SharePoint/Storage at ingest). They won't re-bloat.
- Every big table has a **retention prune** (sf_sync_log 30d, context_packets
  7d, staged_intake_artifacts 50d, field_provenance 90d) → growth is bounded.
- The remaining systemic exposure was **"a disabled maintenance cron goes
  unnoticed"** (the June root cause: artifact-offload was deliberately disabled
  after a connection incident and silently stayed off while the backlog grew —
  the hourly `lcc-cron-health-check` watches for run FAILURES, not for jobs
  switched OFF). R18 closes it.
- **VACUUM FULL stays a rare manual tool** (only after a bloat event). Runbook
  note: VACUUM FULL scratch space ≈ **LIVE** data size, not total table size —
  so a bloated-but-mostly-dead table (like the June artifacts once offloaded +
  nulled) can be reclaimed even at low headroom.

### Unit 1 — autovacuum hardening parity (repo migration)
The live autovacuum hardening (applied 2026-06-15 so prune-freed space is
reused and churn-driven file growth is capped) is now committed as
`20260615120000_lcc_r18_unit1_autovacuum_hardening_parity.sql` (idempotent
`ALTER TABLE ... SET`, `to_regclass`-guarded) so a rebuild/replay keeps it:
`field_provenance` (0.05/0.05/threshold 10000), `perf_metrics` (0.05/0.05/5000),
`signals` (0.05/0.05/5000), `staged_intake_artifacts` (0.05/0.05/500).
`context_packets` + `sf_sync_log` already carry theirs from prior migrations.

### Unit 2 — alert when a CRITICAL maintenance cron is disabled
`public.lcc_check_disabled_critical_crons()` (migration
`20260615121000_lcc_r18_unit2_disabled_critical_cron_alert.sql`) checks a small
allowlist of maintenance/retention/offload crons whose absence causes silent
bloat/disk risk: `lcc-artifact-offload-edge`, `sf-sync-log-prune`,
`field-provenance-prune`, `lcc-context-packet-prune`,
`lcc-staged-intake-artifacts-prune`, `lcc-disk-health-check`,
`lcc-pg-net-response-cleanup`. Any allowlisted job that is **missing OR
`active=false`** opens a `maintenance_cron_disabled` alert in
`lcc_health_alerts` (severity warn, one open per jobname, idempotent via
NOT-EXISTS-open); auto-resolves when the job is active again. Conservative —
maintenance jobs ONLY, so a deliberately-disabled feature cron never alerts.
**Folded into the EXISTING `lcc-cron-health-check` tick (:15)** rather than a new
cron (a new watcher could itself be silently disabled — the very failure mode
being closed); the migration sorts after the original monitor migration so a
replay re-establishes the combined command last. Surfaced by
`v_cron_health_summary` + the daily briefing + the Teams health push.

### Verified live (read-only / rolled-back, 0 residue) 2026-06-15
Unit 1 reloptions match the live-applied values exactly. Unit 2: healthy state
(all 7 maintenance crons active) → `new_alerts=0, resolved=0, down=[]` (no false
alarms); a simulated missing job is detected `down=true` while an active one is
`down=false`; a seeded stale open alert on an active job auto-resolved. Both
applied live to LCC Opps; the `lcc-cron-health-check` command now runs both
functions. DB-only, no Railway dependency; auth schema untouched.

## R20 — a person is their own contact (the near-free outreach unlock, 2026-06-15)

R16 unlocked the 67 SF-mapped prospecting cadences by pulling SF contacts.
Auditing the remaining "cold" cadences live 2026-06-15 found ~200 of them are
NOT cold: the cadence is seeded ON an individual (the owner IS a person), the
person already carries an email/phone on the entity record, but the cadence's
`contact_id`/`sf_contact_id` is null — so the R16 reachability gate parked them
in P-CONTACT even though there is a real recipient (the person themself). Pure
wiring gap. Combined with R16's SF-acquired set, this takes outreach-ready from
~22 toward ~180 with zero research cost. (The genuine-cold tail — ~100 persons
with no contact info + ~69 orgs with no person — is separate research work, NOT
this round.)

### Unit 1 — reachability: a person with email/phone IS reachable
Migration `20260719124000_lcc_r20_person_self_contact_reachability.sql` adds a
third reachability tier to `v_priority_queue_live` (alongside the held R16 Unit 2
gate — the migration reproduces the R16 Unit 2 body verbatim and ADDS one CTE +
one OR, so applying it lands both reachability changes together and
consistently). New `self_contactable_person_entities` CTE: `entity_type='person'`
AND (email OR phone) AND not junk/orphan-flagged AND a plausible human name
(2-5 words, no digits, length 3-60, no firm suffix — SQL mirror of
`looksLikePersonName`/`ENTITY_FIRM_SUFFIX_RE`). `reachable_cadence` now also
passes when the cadence's entity is in that set. Those cadences move out of
P-CONTACT into the real outreach bands. **Scope:** ONLY the cadence reachability
predicate changed — P0.4/P0.5 keep `connected_entities` unchanged; the column
shape is unchanged; touch/value bands unaffected (they don't depend on
reachability). Validated live (read-only): 196 of 380 contactless-overdue
cadences become reachable via the new tier; the post-CTE view body is
byte-identical to R16 Unit 2.

### Unit 2 — self-stamp the contact so the draft path has a recipient
`api/_handlers/contact-acquisition.js` gains a **Pass 1** that runs on EVERY tick
**before** (and independent of) the SF-acquisition pass — it needs no Salesforce,
so it drains even when `SF_LOOKUP_WEBHOOK_URL` is unset. For each contactless
overdue cadence whose entity `isSelfContactablePerson` (the same guard as Unit 1,
reused so gate + stamp agree), it stamps `contact_id = entity_id` (the person is
their own contact) via the shared `stampCadenceContactById` helper (R16,
single-sourced). Idempotent (the fetch is gated on `contact_id IS NULL`; a
stamped row leaves the contactless set). Bounded by `CONTACT_ACQ_SELF_STAMP_LIMIT`
(default 100/tick) + the existing wall-clock budget. Backfill + forward path in
one place — new person-with-contact cadences are caught automatically. The SF
pass (Unit 2 of R16) is unchanged except it now skips entities already
self-stamped this tick. The tick response gains `self_stamp_eligible` /
`self_stamped`. **Never fabricates contact data — only wires what's already on
the record. An org never self-stamps; a firm mistyped as a person is rejected by
`looksLikePersonName`.** dia/gov pipelines untouched (LCC-side cadence/queue
wiring only).

### Unit 3 — draft resolves the recipient from the person's own email
`v_bd_cadence_dashboard` (migration `20260719124500`, append-only) now exposes
`contact_id` + the resolved `contact_email` (LEFT JOIN `entities ce ON
ce.id = c.contact_id`). `ops.js cadDraft` populates the mailto `to:` from it and
renders a "To:" line. Resolves identically whether the contact is a separately-
linked person OR the cadence's own person self-stamped as its own contact
(`contact_id = entity_id`) — the draft "just works" without assuming a separate
contact row. Phone-only persons (no email) fall back to the prior empty-`to:`
behavior (still draftable; the operator fills the recipient).

### Verified (headless 2026-06-15)
`test/contact-acquisition.test.mjs` 15 → 22 (new `isSelfContactablePerson` cases:
person+email/phone → self-stamps; person no-contact → cold; org → never;
firm-suffixed mistyped-person → rejected; junk/orphan-flagged → excluded;
whitespace-only contact → false). `node --check` clean; `ls api/*.js | wc -l`=12;
full suite 856 pass / 0 fail / 6 skipped. DB migrations additive + cache-or-live
safe; JS ships on the Railway redeploy.

### After deploy (verify live)
The ~196 person-with-contact cadences self-stamp (Pass 1 of the */30 cron) and
leave P-CONTACT for the outreach bands; outreach-ready jumps from ~22 toward
~180. A draft for one of them resolves the recipient from the person's own email.
P-CONTACT shrinks to the genuinely-cold remainder (no-contact persons + orgs).
DEPLOY ORDER: apply the gate after a worker drain so contacts stamp before the
rows surface in outreach bands (applying earlier is still safe — P-CONTACT is the
honest interim state).

## R22 — cross-DB mirror deletion propagation (orphan reconcile) (2026-06-15)

The dia/gov → LCC mirror syncs (`lcc_sync_property_attributes`,
`lcc_sync_property_owner_facts`, `lcc_sync_entity_portfolios`) were
insert/update-only — they never DELETE a mirror row when its source property is
merged/removed in domain dedup, so the property-keyed LCC mirrors accumulate
orphans. R22 reconciles them and makes the sync deletion-aware so the mirrors
stay a true reflection of the domains. Applied live 2026-06-15; migrations
committed (idempotent).

### Audit-premise correction (grounded live)
The audit estimated "gov ~22, owner_facts clean." Grounding refined it:
- **dia hard-deletes** on merge (no `status` column) → 783 `lcc_property_attributes`
  orphans, 1 owner_facts, 38 portfolio_facts.
- **gov SOFT-deletes via `status='archived'`** (6,662 archived). The gov anon
  portfolio views the syncs read (`v_property_attributes_portfolio` /
  `v_property_owner_facts_portfolio`) **already exclude archived** (return 12,472
  of 19,134), so reconciling against *those* would prune ~6,658 soft-archived
  rows. The audit's own number (22) came from comparing the mirror to the
  all-status `properties` base and it explicitly scoped the delete to rows
  "genuinely gone, **not soft state**." So R22 reconciles against an **all-status
  id-only census** and prunes **only hard-gone rows**: gov 6 + 6 + 0. The 6,662
  soft-archived gov rows are **deliberately kept** (see follow-up).

### What shipped
- **Domain census views** (`gov`/`dia` `v_property_id_census`, migrations
  `government/20260615_gov_r22_property_id_census.sql` +
  `dialysis/20260615_dia_r22_property_id_census.sql`) — id-only, **ALL-status**
  (incl. archived), PII-free, owner=postgres so anon bypasses RLS like the
  sibling `v_*_portfolio` views. **Apply FIRST** (the reconcile fetch 404s
  gracefully without them → no prune).
- **LCC reconcile** (migration `20260615123000_lcc_r22_mirror_orphan_reconcile.sql`):
  - `lcc_mirror_reconcile_inflight` (pg_net tracking) +
    `lcc_mirror_reconcile_deletions` (full-row-snapshot backup of every pruned
    orphan — reversible undo path).
  - `lcc_reconcile_mirrors_fetch(domain)` — pages the census at **1000/page**
    (PostgREST cap), 31 pages (31k headroom) into the inflight tracker.
  - `lcc_reconcile_mirrors_apply(p_dry_run default true, …)` — assembles the
    full live id set, guards, anti-joins each property-keyed mirror
    (property_attributes / owner_facts / portfolio_facts), snapshots + DELETEs
    confirmed orphans (or counts on dry-run), then ANALYZEs. Dry-run is
    **non-destructive** (leaves the census for a follow-up real apply).
  - **Crons** `lcc-mirror-reconcile-fetch` (05:10) + `lcc-mirror-reconcile-apply`
    (05:15, REAL) — runs daily after the attribute/owner-facts syncs so orphans
    can't re-accumulate.
- **Safe by construction** (a partial/failed census fetch can NEVER mass-delete):
  (1) completeness — every fired page HTTP 200 AND the max-offset page came back
  EMPTY (proves we paged past the end); (2) sanity floor — assembled live count
  ≥ `p_min_live` (1000); (3) anomaly cap — never prune a mirror by > 50% in one
  pass (a truncated-source regression is skipped + logged, never applied). Any
  guard failure SKIPS the prune (mirror untouched). The upsert syncs are
  untouched, so a skipped reconcile only ever costs staleness, never correctness.
  `lcc_listing_events` (a 30-day event log keyed by sale_id, not a current-state
  mirror) is intentionally **out of scope** — historical events are not pruned.

### Verified live 2026-06-15
fetch→dry-run grounded the exact hard-orphan set; real apply pruned **834 rows**
(dia 783/1/38, gov 6/6/0), all snapshotted to `lcc_mirror_reconcile_deletions`.
After: dia `lcc_property_attributes` 13,060→12,277 (orphans **0**; the 1-row gap
to the 12,278 live census is inflow lag, the next attribute sync closes it),
gov 19,130→19,124. **Idempotent** — a re-fetch + reconcile finds **0 orphans /
all `clean`** (no re-accumulation). **Load-bearing intact** —
`lcc_refresh_entity_connected_value()` (2,960) + `lcc_refresh_priority_queue_resolved()`
(1,308) both rebuild cleanly post-prune (the prune only removed phantom
references to deleted properties). dia/gov pipelines untouched; ≤12 api/*.js.

### Follow-up (NOT in R22, surfaced not buried)
The 6,662 **soft-archived gov properties** still sit in `lcc_property_attributes`
/ `lcc_property_owner_facts` (R22 keeps soft state per the audit's intent). They
can't be refreshed by the syncs (the anon views exclude archived) and could feed
stale value into the R17 representative-property / connected-value rank. Two
clean options for a future round: (a) filter `status='archived'` at the rank, or
(b) reconcile owner_facts/property_attributes against the archived-filtered view
once Scott blesses pruning soft state. Deferred deliberately — it's a separate
judgment call from "prune genuinely-gone."

## R23 — exclude soft-archived gov properties from the value-ranking mirror (2026-06-16)

The materially-bigger sibling of R22. R22 cleared 834 genuinely-gone rows and
DELIBERATELY kept gov's soft-archived rows. But ~6,662 archived gov properties
(~35% of the gov mirror) carried full attributes (rent) in
`lcc_property_attributes` / `lcc_property_owner_facts` and fed the R17
connected-value tier, the representative-property rent fallback, and the
queue/Decision-Center value ranking — so a gov owner who SOLD / merged / archived
properties still ranked by those dead assets. The syncs can't self-heal these:
the gov anon view they read (`v_property_attributes_portfolio`) ALREADY excludes
archived, so once a synced property is archived in gov it is never refreshed AND
never returned for removal — permanently stale, distorting 35% of the gov value
signal. dia HARD-deletes on merge (no soft-archive class) → R22 already covers
dia; this is gov-specific.

**Doctrine:** archived = NOT a current BD asset. Exclude it from the LCC
value-ranking mirror (treat archived like gone FOR THE MIRROR). The owner
RELATIONSHIP persists via their ACTIVE properties; an owner with ALL properties
archived correctly drops to no-portfolio-value (NULLS-LAST). cmbs_discovery (38)
+ inactive (2) are KEPT — only `archived` is the clear exclude.

### Implementation (recommended approach #1 — extend the R22 reconcile)
- **Census views carry `status`** — `gov`/`dia` `v_property_id_census` migrations
  `government/20260616_gov_r23_property_id_census_status.sql` (real gov status) +
  `dialysis/20260616_dia_r23_property_id_census_status.sql` (constant NULL — dia
  has no status). **Apply FIRST** (the new fetch's `select=property_id,status`
  400s without them → completeness guard fails → no prune, graceful).
- **LCC reconcile** `20260616120000_lcc_r23_archived_mirror_reconcile.sql` — the
  R22 `lcc_reconcile_mirrors_fetch` now selects `property_id,status`; the apply
  builds its KEEP set as **`status IS DISTINCT FROM 'archived'`** + a separate
  ARCHIVED set for reason-tagging. The EXISTING anti-join ("mirror row whose
  `source_property_id` is NOT in the KEEP set") then prunes BOTH archived AND
  hard-gone in one pass — reusing all of R22's machinery (paged 1000/row fetch,
  guards, reversible snapshot to `lcc_mirror_reconcile_deletions`, crons). The
  apply gains `orphans_gone` / `orphans_archived` return columns (DROP+CREATE; the
  cron `…apply(false)` ignores result rows). Snapshot rows are tagged `archived`
  vs `hard_gone` in `note`.
- **Refined caps (the two prune reasons split):** the R22 anomaly cap
  (`p_max_prune_frac`, 0.5) now governs the **hard-gone** class ONLY — the
  truncation-risk class (a census narrowed by accident would make rows look
  absent), so a legitimate ~35% archived prune no longer trips it. A constant
  **0.95 archived backstop** guards against a census redefinition that flags
  ~everything archived (archived is otherwise census-authoritative + complete).
  Completeness/sanity guards unchanged. Any guard failure SKIPS that mirror's
  prune; the upsert syncs are untouched (a skipped reconcile only costs
  staleness). dia stays byte-identical to R22 (its archived set is empty).
- Going forward, the daily reconcile (`lcc-mirror-reconcile-fetch` 05:10 /
  `-apply` 05:15) removes a gov property from the mirror the moment it's archived.

### Verified live 2026-06-16 (applied to all three DBs)
fetch→dry-run grounded the exact split: gov `property_attributes` + `owner_facts`
each **6,662 orphans, ALL archived** (gone=0), KEEP=12,473 (active 12,433 +
cmbs_discovery 38 + inactive 2); gov `portfolio_facts` **clean** (no current edge
points at an archived property); dia all clean. Real apply pruned **13,324 rows**
(6,662 + 6,662), all snapshotted + tagged `archived` (reversible). After: gov
`property_attributes`/`owner_facts` 19,124 → **12,462** (the 11-row gap to KEEP is
inflow lag); gov `portfolio_facts` 4,274 unchanged; **dia untouched**. Idempotent
re-fetch+reconcile → **0 orphans / all clean** (0 archived remain). Spot-check:
archived gov ids 16589–16593 are GONE from `lcc_property_attributes` but PRESENT
in the snapshot backup; active ids 1/10/100/1000 remain. Load-bearing intact —
`lcc_refresh_entity_connected_value()` (2,961) + `lcc_refresh_priority_queue_resolved()`
(1,308) both rebuilt cleanly post-prune (no orphaned portfolio edges). Migrations
additive/idempotent; ≤12 api/*.js (pure-DB round, no JS). Closes R22's deferred
soft-archive follow-up.

## R24 — close the self-improvement loops: wire the producers (2026-06-16)

With outreach unblocked (R16/R20: ~217 reachable cadences, 217/412 carrying a
contact), the template + engagement learning loops should make outreach get
better over time. They were OPEN: the scaffolds + consumers existed but the
PRODUCERS weren't wired. Grounded live 2026-06-16: `template_sends`=0,
`template_refinements`=0, `high_performing_templates` empty, every cadence's
`last_touch_at` NULL.

### Unit 1 (the headline root cause) — `recordTemplateSend` wrote phantom columns
`template_sends` is the feed for the whole template loop (the
`high_performing_templates` signals view + the weekly `lcc-template-health-rollup`
→ `template_health_history`). But `recordTemplateSend` (both
`api/_shared/templates.js` AND the `template-service` edge function) POSTed
`user_id`/`domain`/`context_packet_id`/`rendered_*`/`final_*` — **none of which
exist** on the live table (canonical cols: `sent_by`/`contact_id`/`entity_type`/
`packet_snapshot_id`/`subject_line_used`). So EVERY send POST 500'd on a PGRST204
and `recordTemplateSend` returned **before** even writing the `template_sent`
signal → both the table AND the signal view stayed at 0. ("The one real send
didn't write template_sends" = it errored.) Fix: re-map to the canonical columns
in both writers; add `domain` ADDITIVELY (migration
`20260616140000_lcc_r24_template_sends_domain.sql`, applied live — the
`?action=performance` select + the signal payload key on it). Also fixes the
`performance` action's `select=…,domain` that 400'd on the same missing column.

**Co-location (can't-diverge):** `advanceCadence` (the R10 single advance owner)
now writes a `template_sends` row on every email advance, in the SAME path that
bumps `emails_sent`, via `recordTemplateSend` (the single template_sends/signal
writer). Template = `touchData.template_id || cadence.last_touch_template ||
next_touch_template`. `record_send` already writes a rich row directly, so it
passes **`skip_template_send: true`** to its `advanceCadence` call — the two
writers never both fire for one send. Fire-and-forget; never blocks the advance.
So ANY email advance (record_send, a `Log touch` of type email, …) feeds the
loop, not just the draft `record_send`.

### Unit 2 — reply capture → `emails_replied` + the engagement/pause branch
A reply is a high-signal INBOUND touch, not an outbound send. `advanceCadence`
gains a **reply branch** (`outcome==='replied' || type==='reply' ||
direction==='inbound'`): bumps `emails_replied`, resets `consecutive_unopened`,
and moves the cadence to **`phase='converted'`** (the engine's active-engagement
state) so the cold prospecting sequence PAUSES and the human takes over — a
converted cadence drops out of the P0/P6/P7 outreach bands
(`ACTIVE_CADENCE_PHASES` excludes `converted`) but stays on the cadence
dashboard. It NEVER increments `emails_sent`/`current_touch` or writes a
`template_sends` row. Producer: `sf-activity-ingest.js` detects an inbound reply
(`isInboundReply` — explicit `Incoming`/`direction` flag OR an `RE:`/`AW:`/…
subject, email category only), tags the mirrored activity
`metadata.skip_cadence_advance='true'` + `is_reply` (so the SQL trigger does NOT
also advance — R10 single-advance-owner doctrine), then resolves the cadence
(`resolveCadenceForEntity` — direct, then the asset→owner `owns` hop the trigger
uses) and advances it via the single JS owner. Only on a freshly-INSERTED reply
(never a deduped re-POST). Best-effort: no cadence ⇒ the activity is still
mirrored, just no advance. The same helpers are reusable for `email_intake`
inbound replies (follow-up; the SF mirror is the built feed today).

### Unit 3 (correctness guard) — don't penalize "unopened" without open tracking
The mailto/copy send path has NO open signal, so treating every send as
`consecutive_unopened++` would wrongly trip the `>=2` phone-recovery
deprioritization on engaged contacts. `advanceCadence` now only moves the open
counters when the send carries a REAL open signal (an explicit `opened` boolean
OR `touchData.open_tracking===true`); a no-open-tracking send leaves
`consecutive_unopened` untouched. AND `recommendNextTouch` gates the `>=2`
phone-recovery branch on `openTrackingActive()` (env
**`CADENCE_OPEN_TRACKING_ACTIVE`**, default **false**; per-call override via
`options.open_tracking`). So the engine reacts to real unopened signals, never to
the absence of one. (The SQL organic path's own `email_opened`-NULL→unopened++
behavior is unchanged — out of scope; the JS send path is the one that ramps.)

### Unit 4 — performance-aware template selection (ships dark)
`chooseBestTemplate(defaultTemplateId)` (`templates.js`) prefers the
best-`response_rate_pct` template **of the same category** as the recommended
default, among candidates that cleared a min-sends floor (default 3 = the
`high_performing_templates` HAVING floor); cold-start safe (empty perf ⇒ returns
the default, never crosses category). Wired into the draft `generate` path gated
on env **`CADENCE_TEMPLATE_AUTOSELECT`** (default OFF) so it ships dark and Scott
flips it on AFTER Unit 1's sends accrue real data — no point selecting on empty
performance. When it swaps, the response carries `template_autoselected_from`.

### Unit 5 — enable provenance learning (activation only, Scott's blessing)
The registry learning loop for `provenance_conflict` `accept_attempted` is built
+ verified (R13 Unit 2) but flag-OFF. To activate: set
**`DECISION_PROVENANCE_LEARN`** in the Railway env. On a field-provenance
conflict it then upserts a per-`(target_table, field_name)`
`manual_decision`@priority-1 rule and applies the attempted value via
`lcc_merge_field`, so the field stops re-litigating (future captures resolve to
`skip`, not `conflict`). No R24 code change — documented activation, gated on
Scott (it writes to the shared priority registry).

### Boundaries / verified (headless 2026-06-16)
No ESP/open-tracking built (Unit 3 makes the engine correct WITHOUT it).
dia/gov pipelines untouched (LCC-side cadence/template/signal wiring only). Reused
the existing send/activity/advance plumbing — `recordTemplateSend` stays the
single template_sends writer; `advanceCadence` stays the single advance owner.
`test/cadence-self-improve.test.mjs` (Units 1-3: co-located template_sends + skip
flag + reply branch + open-tracking-aware counters + the gated recovery branch),
`test/sf-activity-ingest.test.mjs` (+`isInboundReply` + reply-advance/skip-tag),
`test/template-select.test.mjs` (Unit 4 cold-start/same-category/min-sends).
`node --check` clean; `ls api/*.js | wc -l`=12; full suite **899 / 893 pass / 0
fail / 6 skipped**. Migration additive + cache-or-live safe; JS ships on the
Railway redeploy. After deploy: a draft `Mark sent` writes a `template_sends`
row + the `template_sent` signal; once ≥3 sends/template land,
`high_performing_templates` populates and the weekly rollup has data; a logged
reply bumps `emails_replied` and pauses the cadence (`converted`).

## R25 — daily-driver UX last-mile + the two-cockpit doctrine (2026-06-15)

The value-ranking backend (R11/R14/R17) was all built and DISPLAYED but didn't drive
in-band display order, and junk polluted the prospecting list. R25 is the last mile of
presentation (PR #1209, branch `claude/keen-fermat-6cw4sl`): Unit 1 — connect bands
(P0.4 / P-CONTACT) ordered by `rank_annual_rent DESC NULLS LAST` in `admin.js` so the
highest-value targets the cards already show sit at the top; Unit 2 —
`isJunkProspectName()` (`entity-link.js`) + migration `20260615210000` excludes
`junk_name_flagged` from the P-CONTACT branch of `v_priority_queue_live` (the
long-deferred R11 follow-up); Unit 3 — both Today sync-error widgets read the bounded
live count (no more stale all-time 2,638); Unit 4 — the daily briefing no longer shows
perpetual "Partial · Unavailable" for the unconfigured market-intel feed. DB views for
Units 1-2 applied live; JS ships on the Railway redeploy of merged `main`.

### NBA doctrine — DECIDED (Scott, 2026-06-15): two distinct cockpits, kept separate
The Today **"NEXT BEST ACTION"** rail and the Priority Queue **"DO THIS FIRST"** hero led
with DIFFERENT "first" actions (Today: data-fix tasks ranked by PROPERTY value — agency
drift, research owner; Queue: P-BUYER outreach ranked by RELATIONSHIP value). This is NOT
a coherence bug to fix by converging them. **Decision: they answer different questions and
stay distinct.** The Today rail is structurally a **data-quality gap queue** (reads
`research_tasks` / data-gap views; it never contains an outreach action), correctly ranked
by property value — so it was RELABELED to be honest ("Top Data Gaps to Close", subhead
"Highest-value records missing ownership / agency data") rather than re-ranked. The
Priority Queue stays the **BD-action cockpit** (who to pursue), value-ranked by
relationship value, unchanged. **Do NOT** blend outreach into the Today rail, re-rank the
NBA by BD value, or try to make the two surfaces agree on one "first" action — that
separation is intentional. Today = "what data should I connect"; Queue = "who should I
pursue". Unit 5 was copy/label only (`index.html`/`styles.css`/`app.js`, commit
`cb4e873`); the property-value ranking + internal `nba`/`next-best-action` identifiers
were left untouched.

## Stage B — location-agreement guard + draft-document policy (2026-06-16)

The corpus lease backfill is COMPLETE and the end-gate held the structural
invariants (no dup leases/edges, no clobber, operator gate held on
cross-operator). But the end-gate surfaced two mis-match classes the operator
gate by design cannot catch — a same-operator WRONG-LOCATION match and an
UNEXECUTED-draft enrich. Two wrong-property leases were already reverted under
the gate (dia 25325 on 30705 = DaVita HQ; dia 25330 on 3353605 = 160k-SF non-
clinic). This round closes the matcher hole + sets the draft policy. The
backfill drain stays DONE — do NOT re-drain the corpus until this guard deploys.

### Unit 1 — location-agreement guard (`lease-extractor.js`)
The corporate-notice-address mis-match: a ground lease / commencement-date
memorandum carries the tenant's corporate NOTICE address in its boilerplate, and
the matcher latched onto THAT instead of the leased premises — landing a "The
Villages, FL" ground lease on DaVita's Denver, CO HEADQUARTERS (property 30705).
Same operator (DaVita==DaVita) ⇒ the operator gate PASSES; only a LOCATION gate
catches it. New pure `locationContradicts({docCity,docState,propCity,propState})`
(exported) mirrors `operatorFamiliesContradict`: **(1) STATE — both known AND
different → contradict** (the robust primary signal, catches FL→CO); **(2) CITY —
both states known AND EQUAL, both cities normalized-different → contradict**
(same-state wrong-city; St./Saint + Ft/Fort normalize equal so an abbreviation
variant never false-blocks). Agreement OR unknown-on-either-side passes. Wired
into `attachLeaseDoc`'s matched block **BEFORE** the operator gate (location is
the more fundamental signal AND the HQ case passes the operator gate), gated on a
new `getPropertyLocation` dep (dia+gov `properties.city/state`, domain-agnostic).
The **FOLDER anchor (`subject_hint.city/state`) is the trusted independent
location signal** — it's how the human filed the deal, so it survives the notice-
block bleed; falls back per-field to the in-file `property_identity` only when the
folder lacks it. A clear contradiction routes the single wrong-location candidate
to the EXISTING `match_disambiguation` lane (reason `location_mismatch`,
`context.location_mismatch=true`) — never a wrong-property hard write; dry-run
reports it and emits/writes nothing. Legacy deps without `getPropertyLocation`
skip the gate (backward compatible). In the backfill, `location_mismatch` rides
the existing `emitted_disambiguation` → `outcome='ambiguous', reason='location_mismatch'`.

**Premises-address preference (the deeper cure) is NOT yet done** — the extractor
still matches on whatever address it pulled (which can be the notice/corporate
block). The folder-anchor-first location gate is the safety net that catches the
corruption; preferring the demised/leased-premises address over the notice block
at extraction time, and rejecting a match to the tenant's known corporate HQ, is
the follow-up cure.

### Unit 2 — draft-document policy (`folder-feed-classify.js` + the choke point)
A doc under a `/Drafts/` path SEGMENT, or whose FILENAME carries a
blackline/redline/draft/"changed pages"/version(vN) marker, is UNEXECUTED and
must NEVER mint an authoritative `data_source='folder_feed_lease'` lease (the
Federal Way `…/PSA/Drafts/` redline/blackline files that built the phantom
160k-SF / $4M lease on 3353605). New pure `isDraftDocumentPath(pathRef)` +
`filenameLooksDraft(name)` (exported) mirror `isMultiTenantDealFolderPath` —
whole-segment `/Drafts?/` + anchored filename markers. Strong markers
(blackline/redline/draft/changed pages) always match; a bare `v\d+` version tag
counts only when the name carries no executed/final/signed cue (so "… Fully
Executed v2.pdf" passes). Wired in THREE places, single source of truth:
- `classifyFile` returns `{type:'draft_not_executed', isOm:false}` for a draft
  FILENAME — checked BEFORE the OM/lease branches (an "OM redline.pdf" is recorded
  draft, never re-ingested as an OM).
- `attachLeaseDoc` refuses at the SHARED choke point (right after the multi-tenant
  gate) — BEFORE any byte fetch / resolve — returning terminal
  `{draft_not_executed:true, skip_reason:'draft_not_executed'}`, so every caller
  (crawl auto-route + corpus backfill) inherits it. `lease-backfill.js` maps it to
  a TERMINAL `outcome='draft_not_executed'` (marked, drops out of the queue).
- The folder-feed worker forces `cls={type:'draft_not_executed'}` when
  `isDraftDocumentPath(item.path)` (catches a `/Drafts/` segment a clean filename
  can't reveal) and excludes the type from `attachEligible` → recorded
  skipped/draft_not_executed, no stage / attach / extractor.

### Unit 3 — re-process the held docs (POST-DEPLOY runbook, NOT done here)
The 8 source docs (6374, 7004, 19517, 19522, 19524, 19526, 19530, 19541) are HELD
(`subject_hint.lease_backfill_reverted=true`, `lease_backfilled_at` set ⇒ out of
the eligible queue). **After this guard deploys (Railway redeploy of merged
`main`) AND a synthetic FL-doc→CO-property gate-verify**, reset their markers
(clear `lease_backfilled_at` + `lease_backfill*`) and re-drain via
`?_route=lease-backfill`. Expected: the FL/Gardena memoranda →
`location_mismatch` → `match_disambiguation` (NO write to 30705); the Federal Way
drafts → `draft_not_executed` (no write to 3353605). None re-creates a lease on
the wrong/HQ/non-clinic property. Do NOT reset the markers before the deploy.

### Unit 4 — Decision Center data-quality rows (surface, don't bury — LIVE op)
Open `lcc_open_decision`/data-quality rows (a LIVE LCC-Opps op, separate from
this code change) for: **30680** phantom address (1221 S Capitol vs CMS 1450
Kooser Rd); stray **medicare_clinics 552652 → property 30680** property_id mis-
link; **30705** = DaVita HQ mis-ingested into the dia clinic book; **3353605** =
160k-SF non-clinic (verify real DaVita facility vs mis-ingestion); **25323**
landlord-as-tenant (WellSpan → should be DaVita) on property **22640**.

### Verified (headless 2026-06-16)
`test/lease-location-draft-guard.test.mjs` (locationContradicts cases; the
location gate blocks FL→CO/HQ with operator gate PASSING + emits to
match_disambiguation + writes nothing; dry-run; correctly-located still enriches;
legacy-deps backward compat; draft choke point + backfill terminal mapping) +
`test/folder-feed-classify.test.mjs` (classifyFile draft branch;
filenameLooksDraft executed-override; isDraftDocumentPath segment+filename).
`node --check` clean; `ls api/*.js | wc -l`=12; full suite 925 pass / 0 fail / 6
skipped. JS ships on the Railway redeploy; the held docs (Unit 3) + the Decision
Center rows (Unit 4) are post-deploy/live steps, NOT in this commit. The cleaned/
reverted records (dia 25312/19530/14365; superseded provenance incl. 25325/25330;
canonical guaranteed_by edges) were not touched.
