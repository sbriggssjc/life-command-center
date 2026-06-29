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

## Client routing (UI Phase 1) — hash is the source of truth

The SPA uses **hash routing** (`location.hash`, not History clean URLs) so the
Railway static/Express server needs **no catch-all rewrite**. The hash mirrors
the current `{page, open-detail}`; existing in-app click handlers still work but
now also drive the hash. Empty/unknown hash ⇒ Today (no regression). No PII in
the URL — ids/tab/domain only, never names/emails/addresses.

- **Scheme:** `#/<page-slug>[?d=<detail-token>]`
  - detail-token `prop:<db>:<propertyId>:<encodedTab>` (→ `openUnifiedDetail`)
    or `entity:<entityId>` (→ `openEntityDetail`). Tabs are `encodeURIComponent`'d.
  - Example: `#/dia?d=prop:dia:24703:Overview`.
- **slug↔pageId map:** `ROUTE_SLUG_TO_PAGE` in `app.js` (single source; reverse
  `ROUTE_PAGE_TO_SLUG`; legacy aliases `ROUTE_PAGE_ALIAS` e.g. pageMyWork→pagePipeline).
  `dia`/`gov` are bnav shortcuts that render `pageBiz`. Legacy PWA `#page=<id>`
  (manifest.json shortcuts) is still parsed.
- **Router entry points (`app.js`):**
  - WRITE side: `navToFromMore` + the `.bnav` click handler call `_routeSetPageHash`;
    `openUnifiedDetail`/`openEntityDetail` (detail.js) call `_routeSetDetailHash`;
    `switchUnifiedTab` (detail.js) calls `_routeUpdateTabHash` (replace, so reload
    keeps the tab); `closeDetail` (app.js) calls `_routeClearDetailHash`.
  - READ side: `applyRoute()` is the single `hashchange` + initial-load handler.
    It parses the hash (`_routeParseHash`, never throws) and drives the page via
    `navTo` + the detail via `openUnifiedDetail`/`openEntityDetail`/`switchUnifiedTab`
    — it does NOT duplicate the render paths.
- **Loop guard:** `_routerApplying` is true while `applyRoute` runs, so the WRITE
  helpers no-op; writers also skip when the desired hash equals the current one
  (assigning an equal hash never re-fires `hashchange`). Opening a detail is a
  PUSH; Back from an open detail removes the `?d=` segment → `applyRoute` closes
  it (does not exit the app). Tab changes + closes use REPLACE (no history noise).
- **Phase 4 Slice 4A (BUILT) — back-stack + breadcrumb (the zoom model):**
  `_detailStack` (app.js) mirrors the chain of open detail levels — each entry is
  a re-openable descriptor (`{kind,db,id,tab}`, the detail-token shape) + a human
  `label` captured from the rendered title (labels can't ride the hash — no PII).
  One stack level == one `?d=` history entry: every open already PUSHes via
  `_routeSetDetailHash`, so the in-panel **"← Back"** (`detailBack()`) and the
  breadcrumb crumbs drive `history.back()`/`history.go()`, and `applyRoute` (the
  single hashchange reader) reconciles the stack from the incoming descriptor —
  match → truncate (a Back/jump), else → push (a Forward / new lateral hop).
  Reconciliation (`_detailStackSync`) is idempotent on the current top, so a
  direct click (which syncs synchronously for an instant breadcrumb) and the async
  `applyRoute` it provokes never double-mutate. `openUnifiedDetail` +
  `openEntityDetail` call `_detailStackSync` at open (and `_detailStackSetLabel`
  after the real title loads); their in-header `.detail-back` now calls
  `detailBack()` (was `closeDetail` — the bug 4A fixes). `closeDetail` (×) and a
  page nav (`_routeSetPageHash`) call `_detailStackReset()` → clears the trail.
  The breadcrumb (`#detailBreadcrumb`, a central bar that survives header
  re-renders) is hidden at depth ≤ 1, collapses the middle to `… ▸ prev ▸ current`
  when deep. **Deeper-than-top levels are not persisted across reload** (the hash
  holds only the top descriptor — best-effort by design).
- **Phase 4 Slice 4B (BUILT) — entity/owner detail parity (one detail grammar):**
  `openEntityDetail(entityId, initialTab)` (detail.js) now renders the SAME
  slide-over shell as `openUnifiedDetail`: real `#detailTabs` (Overview · Portfolio
  · Contacts · Activity via `switchEntityTab`, name-keyed like `switchUnifiedTab`),
  the shared completeness rail (`#detailCompletenessRail`) + Next-Step
  (`#detailNextStep`), and it rides the SAME 4A back-stack/breadcrumb. The entity
  detail-token now carries a tab segment — `entity:<id>[:<encodedTab>]` (parsed in
  `_routeParseDetail`, written in `_routeSetDetailHash`); `_routeUpdateTabHash`
  generalized to prop+entity (replace, so reload keeps the tab); `applyRoute`
  passes the tab to `openEntityDetail` + drives a same-detail tab change through
  `switchEntityTab`. **Portfolio is authoritative** — sourced from the BD spine
  via `GET /api/entities?action=portfolio&id=<uuid>` (entities-handler:
  `lcc_entity_portfolio_facts` ⋈ `lcc_property_attributes` for the per-property
  rows + `v_entity_portfolio_all` for the rollup), NOT the old fuzzy
  `v_ownership_current true_owner=ilike` name-match (SPEs / renamed owners
  mismatched). Each portfolio row is a 4A zoom target (`openUnifiedDetail` PUSHes).
  **Next-Step reads `v_priority_queue_enriched`** via `/api/priority-band?entity_id=`
  — the SAME truth as the Priority Queue / Decision Center (Resolve ownership &
  control · Select prospecting contact · Open Government Buyer · Cadence touch due ·
  Lead is live · Connected — no action). The Contacts tab's acquire CTA reuses the
  P-CONTACT/buyer picker endpoints (`?action=buyer_contacts` →
  `select_prospecting_contact`; a `no_active_cadence` reply is a soft success — the
  person→entity link is the connect). No new api/*.js (≤12); no migration.
- **Phase 4 Slice 4C (BUILT, 2026-06-24) — sub-record drill (lease/sale) +
  source-document access (L5) + zoom polish. The zoom model (4A–4C) is COMPLETE.**
  Client-only (`detail.js` + `app.js`); no api/*.js (≤12); no migration.
  - **Unit 1 — source-document access (L5):** `_udSourceLink(record)` (detail.js)
    returns a uniform "View source ↗" affordance that opens the ACTUAL doc/record,
    surfacing ONLY sources already on the record (never fabricated; `''` when none):
    `intake_artifact_path`→`openIntakeArtifact` (1-hour signed PDF), the first real
    https `source_url`/`listing_url`/`url`/`deed_url`/`document_url`/`tracked_urls[0]`
    → new tab, or `sf_account_id`/`salesforce_id` → SF Lightning deep-link
    (`_SF_BASE`). Each link `stopPropagation`s so it never triggers the Unit-2 row
    drill. Wired into `_salesRenderSale` + `_salesRenderCombined` (Deal History
    sales) and the lease sub-detail; listings already surface source via
    `buildCollateralIcons`.
  - **Unit 2 — drill lease/sale onto the 4A stack:** a new descriptor kind
    `sub:<recordKind>:<db>:<id>` (`lease`|`sale`), parseable like the prop/entity
    tokens (`_routeParseDetail`/`_routeSetDetailHash`/`_routeSameDetail`/`_stackSame`/
    `_stackDefaultLabel`/`_detailStackSync` push all handle it; `applyRoute`
    dispatches `kind==='sub'` → `openSubDetail`). `openSubDetail(recordKind,db,id)`
    (detail.js) repaints the SAME slide-over (header `← Back` + cleared tab bar +
    body), PUSHes the `?d=` entry, and `_detailStackSync`s so the breadcrumb grows
    and Back/breadcrumb ascend to the parent. The record resolves from the parent's
    in-memory caches (`_udCache.leases` / `_salesCache.transactions`) when drilled
    in-app (no fetch); a cold deep-link best-effort fetches (`v_lease_detail` /
    `sales_transactions`→`property_sale_events`). The parent `_udCache` is left
    intact so ascending re-renders the property. **Deeper-than-top levels are not
    persisted across reload** (the hash holds only the top descriptor — same
    best-effort design as 4A). A Rent Roll tenant header → `Open ↗`
    (`_udRenderLeaseSubDetail`: full terms / escalations / guarantor / expiration +
    Unit-1 source). A Deal History sale row → `Open detail ↗`
    (`_udRenderSaleSubDetail`: entity-linked parties + price + cap-rate provenance
    [`cap_rate_quality`/`cap_rate_noi_source_table`] + Unit-1 source). Contacts +
    related-properties already drill via 4B — left as-is.
  - **Unit 3 — zoom polish:** drill rows are `.ud-zoom-link[tabindex=0][data-zoom]`;
    a detail.js keydown handler opens the sub-detail on Enter/Space (mirrors the
    owner/tenant-link pattern). The global Escape handler (app.js) now routes to
    `detailBack()` when the detail panel is open (zoom OUT one level; closes at
    depth 1) instead of a hard `closeDetail()`. The iOS back-gesture rides the 4A
    history integration (each open PUSHes a hash entry → `history.back` →
    `applyRoute` reconciles the stack → ascends one level, not exit).
  - **Deferred (low-ROI, NOT built):** full standalone detail "pages" per
    sub-record type, and per-sub-record next-actions (the property + owner already
    carry the 4B completeness-rail + Next-Step). The descriptor stays parseable if
    revisited.

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
- **Nearby owners** (BUILT — R50) — `<dom>_nearby_same_owner` finds
  properties owned by the same owner within N miles, for outreach lists.
- **Competitor analysis** (BUILT — R50) — `<dom>_nearby_competitors`;
  dia = nearest dialysis facilities (same_operator = concentration /
  replacement risk), gov = nearest gov-leased assets (same_agency).
- **Nearby sales** (BUILT — R50) — `<dom>_nearby_sales`, recent sales
  within N miles + time window for a price/SF + cap-rate anchor.

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

## Producer/Consumer (Consumption Layer) doctrine

LCC produces work (research tasks, cadences, decisions, queue rows, inbox items) at ingestion
scale and historically under-consumed it, so operator surfaces filled with un-worked noise
that buried the actionable few (the worst failure mode: a 5,447 / 999+ badge that is mostly
noise trains the operator to ignore the surface). Every code path that emits operator-facing
work MUST satisfy all five invariants:

1. **Value-gate the producer.** Emit a work item only above an actionability/value floor —
   never one item per captured row. The floor is a single tunable knob (e.g. R60
   `$500k` chain-task floor; R63 `CADENCE_SIGNAL_MIN_VALUE`).
2. **Auto-retire + auto-resolve.** A scheduled sweep closes items whose premise has cleared
   (data self-resolved) and auto-resolves the high-confidence subset, leaving only genuine
   judgment calls for a human. Model: `lcc_refresh_decisions` auto-supersede. Reversible —
   pause/skip with a reason, never hard-delete.
3. **Surface actionable-only, value-ranked, capped.** The operator surface defaults to the
   workable set (signal-bearing, value-ranked, top-N) with a "show all" toggle. A surfaced
   count must reflect ACTIONABLE work, not raw producer output.
4. **Close the loop from real activity.** Where an operator activity stream exists (Salesforce
   / Outlook), drive the consumer from it (e.g. OUTREACH#1 SF-activity → cadence advance)
   rather than a separate manual queue.
5. **Honest counts.** Every badge/number is actionable work, not raw output.

**No new producer ships without:** (a) a named consumer (human verdict, worker, or auto-sweep
— if none, don't build the producer); (b) a value-gate; (c) an auto-retire predicate (+ which
subset auto-resolves); (d) a ranked, capped surface whose count is actionable-only; (e) where
possible, reality-driven advance. Instances: R60 (research), R62 (queue cadence), R63
(cadence), R64 (Decision Center verdict lanes). A healthy worklist (inbox triage,
match_disambiguation) is one whose consumer keeps pace; a graveyard is one without.

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

## R34 — cadence dashboard value-rank + small hygiene (2026-06-16)

Grounded live before touching anything: the cadence table is HEALTHY — 437
active cadences, **0 entities with duplicate active cadences** (the "Karinna
Cassidy appeared twice" was a VIEW fanout, not real dup rows), 0
`owner_role='broker'` cadences, 1 stale row >180d overdue. So R34 is hygiene +
presentation, NOT a cleanup. One migration
(`20260616150000_lcc_r34_cadence_dashboard_value_rank.sql`, LCC Opps, applied
live) + thin JS (`operations.js` order/filter, `ops.js` render). All three units
verified live.

### Unit 1 — fanout-proof `v_bd_cadence_dashboard`
All current joins are 1:≤1 (`v_entity_portfolio_all` is GROUP BY e.id; the
contact + entity joins are on the PK), so the raw view already returned one row
per cadence (437=437). Made it an INVARIANT — the SELECT is now `DISTINCT ON
(c.id)` (+ `ORDER BY c.id`) — so no future join target that isn't unique-per-
entity can reintroduce fanout. **`v_priority_queue_enriched` carries 153
duplicate entity_ids and must NEVER be joined to the dashboard naively** — that
is exactly why Unit 2 does not use it.

### Unit 2 — value-rank the dashboard (the real lever)
The view had no value column, so the operator couldn't sort by relationship
value — low-value contacts surfaced at the top of the "ready to send" list. New
append-only columns: `rank_value` = `COALESCE(NULLIF(portfolio_rollup,0),
connected_value)` reusing the SAME sources that feed the priority queue's
`rank_annual_rent` — the portfolio rollup (`v_entity_portfolio_all`, unique) and
the R17 connected-property value (`lcc_entity_connected_value`, **PK per
entity** → fanout-safe new LEFT JOIN). `rank_property_count` = the count behind
whichever value won. The dashboard API/UI orders by `rank_value DESC NULLS
LAST`, then `days_overdue DESC`. High-value owner relationships now lead
(Northwestern Mutual $26.1M, Foulger Pratt $24.3M, Jamestown $22.8M, Akridge…);
brokers/small contacts fall below — **no exclusion, just honest ranking**.
Genuinely value-less cadences sort NULLS-LAST (no faked rank). The card shows
`$X (N properties)`. 69/437 carry value (the dominant signal is connected value:
the cadence owners are CoStar-captured `person`-typed owner contacts with linked
assets, not portfolio-edge orgs).

### Unit 3 — retire the stale row + light staleness guard
Paused the single >180d-overdue abandoned onboarding cadence (Steve Gonzalez,
next_touch_due 2022-11-10 = 1,314 days, last touched 2022-10-13 — historical-
import dead air) → `phase='paused'`, prior phase + reason stashed in
`metadata` (reversible, NOT a hard delete). New append-only `review_flag`
boolean marks any ACTIVE cadence silently >90 days overdue so the UI surfaces a
"⚠ review" badge — **it surfaces, it does NOT auto-expire** (the goal is to
prevent a future 1,314-day row, not mass-expire). `getCadenceDashboard` now
excludes `paused`/`unsubscribed` from the default list (so the paused row leaves
the active set); `converted` (engaged) and `dormant` (annual) stay visible.

### Verified live (read-only + 1 reversible row) 2026-06-16
Invariant: `count(*)`=437=`count(distinct cadence_id)`. Steve → `paused`,
`max_active_overdue` 1314 → **29** (gone from the active set). `review_flag`=0
(no active row currently >90d overdue — the guard lights when one drifts).
Dashboard-shape query leads with the high-value owners above, paused row
excluded. `node --check` clean (operations.js, ops.js); `ls api/*.js | wc -l`=12;
full suite 969 pass / 0 fail / 6 skipped. Migration additive + cache-or-live
safe; JS ships on the Railway redeploy. Did NOT touch the cadence engine, the
reachability gate (R10/R20), or purge any broker cadence.

### Bigger picture (for Scott — NOT in this change)
R34 fixes the dashboard's ORDER. But the highest-value targets (P-BUYER parents
like Boyd Watterson Global $163M) are not email-reachable from the cadence
table — they run the P-BUYER buy-side contact-pick path. The real "first sends"
lever is working P-BUYER buy-side in-app + R16 SF contact-acquisition for
high-value owners, not the (already healthy) cadence table.

## R35 — reconcile external_identities asset links (the table R22/R23 missed) (2026-06-16)

The capstone on the cross-DB integrity work (AUDIT 2026-06-16). R22/R23 made the
property-keyed VALUE mirrors a true reflection of the domains, but the ONE table
they never reconciled was `external_identities` asset rows
(`source_type='asset'`) — the entity-graph linkage between a property-anchor
entity and its domain property. Grounding refined the audit's three classes:

### Unit 1 — retype the dia CCN-mislabels (don't delete; the CCN values are valid)
359 dia asset rows had a 6-digit `external_id`. Cross-checking dia: **345 are CMS
Medicare CCNs** (in `dia.medicare_clinics.medicare_id`, NOT `dia.properties`) —
the mislabels; the other **14 are real 6-digit dia property_ids** (kept as asset).
**The audit premise that these were "valid clinic identities on valid entities"
did NOT hold:** 343 of the 345 hang off a SINGLE junk-named entity **"Property
link approved"** (a captured UI status string), +2 on "Clinic lead outcome
recorded"/"Research outcome saved". Root cause: `api/operations.js`
`bridgeLogActivity` minted a `(dia, asset, <external_id>)` identity from the
activity TITLE, fed by `dialysis.js` property-review `log_activity` calls passing
the clinic **CCN** as `external_id` (all collapsing to one entity by
canonical_name).
- **Retype (reversible relabel, never delete):** the 345 CCN-only rows →
  `(source_system='cms', source_type='medicare_ccn')` — records the true CMS
  clinic identity AND removes them from the `(dia, asset, *)` space so Unit 2's
  census prune can't falsely treat a CCN (not a property_id ⇒ absent from the
  property census) as a hard-gone orphan. Migration
  `20260616160000_lcc_r35_unit1_retype_ccn_asset_identities.sql` (embeds the
  grounded 345-CCN list; idempotent). `cms` added to the LIVE + VALIDATED
  `chk_external_identities_source_system` allow-list first
  (`20260616155000`, mirrored into the canonical `20260604121000`) — the
  constraint is applied + validated (NOT "deferred"), so the retype 23514s
  without the widen.
- **Forward guard (R4-A choke point):** new `resolveOnly` option on
  `ensureEntityLink` (`entity-link.js`) — resolve by entity_id / existing
  external-identity ONLY, never create an entity, never write an
  external_identities row. `bridgeLogActivity` passes `resolveOnly:true`, so a
  log_activity can never again mint a `(dia,asset,<anything>)` identity from an
  activity title, regardless of id shape. The 3 dia property-review callers also
  fixed to pass the real `property_id` (the actual asset), not the clinic CCN.
- The junk entity "Property link approved" itself is a writer-bug artifact —
  **surfaced for Scott, NOT touched** (its 343 cms identities still point at it;
  separate cleanup).

### Unit 2 + 3 — prune true orphans (census-based, reversible) + forward reconcile
Folded an `external_identities` asset-orphan prune into the EXISTING R22/R23
reconcile (`lcc_reconcile_mirrors_apply`, migration
`20260616161000_lcc_r35_unit2_external_identities_asset_reconcile.sql`,
`CREATE OR REPLACE` — same signature/return shape, just more `RETURN NEXT`
rows tagged `mirror='external_identities_asset'`). So it rides the EXISTING daily
cron (`lcc-mirror-reconcile-fetch` 05:10 / `-apply` 05:15) — Unit 3 done, no new
cron, no extra pg_net (consumes the same census fetch).
- **⚠️ The critical safety rule (the sweep proved it):** the orphan test is the
  all-status `v_property_id_census`, **NOT `lcc_property_attributes`** — the
  audit's "~17 gov flagged" was the mirror test, which flags ACTIVE gov
  properties (the mirror has coverage gaps). Against the census, gov true orphans
  = **4** (the active ones are present ⇒ kept).
- **Doctrine difference vs R23:** the entity-graph linkage uses the **FULL
  all-status census** as its KEEP set (`_r22_live ∪ _r23_archived`) — an ARCHIVED
  property's entity-link is meaningful history and is **NOT** pruned (R23 prunes
  archived only from the value-ranking mirrors). Confirmed live: the
  `external_identities_asset` row reports `live_ids`=19,152 (full gov census) vs
  12,495 for the value mirrors.
- Reuses every R22/R23 guard (completeness, sanity floor 1000, anomaly cap 0.5,
  reversible snapshot to `lcc_mirror_reconcile_deletions`).

### Verified live 2026-06-16 (applied to LCC Opps)
Unit 1: 345 retyped dia/asset → cms/medicare_ccn; 14 real 6-digit properties
kept; dia/asset 2172→1827. Unit 2 real apply pruned **279 asset orphans** (dia
275, gov 4) = **57 malformed_uuid + 222 hard_gone**, all snapshotted (reversible,
tagged in `note`). Property mirrors clean (R22/R23 holding). **Idempotent** — a
re-fetch + re-apply finds **0 orphans / clean** both domains. **Load-bearing
intact** — `lcc_refresh_entity_connected_value()` (2,980) +
`lcc_refresh_priority_queue_resolved()` (1,292) rebuild cleanly post-prune. dia
property census 12,279; gov full census 19,152 (active+archived 12,495 active).
`node --check` clean (entity-link.js, operations.js, dialysis.js); full suite
**969 pass / 0 fail / 6 skipped**; `ls api/*.js | wc -l`=12.

### Surfaced (NOT fixed here)
- **gov mirror-coverage gap:** **14** active gov properties carry an
  `external_identities` asset row but NO `lcc_property_attributes` row (present in
  census ⇒ NOT orphans, correctly kept) — a separate sync-coverage round.
- The junk entity **"Property link approved"** (+2 status-string asset entities)
  still hold the 343/2 now-`cms` identities — a writer-bug artifact for a
  separate cleanup (the forward guard stops new ones).

## R39 — contact/entity dedup: email as a write-time key + auto-work merge candidates (2026-06-16)

Completes the dedup-at-source sweep after R37 (sales) / R38 (listings). The
entity graph had the same re-capture duplication shape at modest scale, and the
merge machinery already existed — so this is a wiring/adoption fix, not a new
build. Grounded live 2026-06-16 (audit premise refined down from "898/436"):
**251 non-generic email groups / 682 active person entities share an email**
(`ensureEntityLink` resolved by canonical_name / external_identity but NOT by
email, so the same person captured under a slightly-different name with the same
email minted a fresh duplicate, ~11/week). `v_lcc_merge_candidates` is
**org-only**, so persons were never surfaced for merge.

### Unit 1 — email as a write-time resolution key (prevent-at-write, the leverage)
`api/_shared/entity-link.js`: new `normalizeEmail()` + `isGenericInboxEmail()`
(role-inbox denylist: info/sales/leasing/…, plus-addressing aware) and an
**email-resolution tier** in `ensureEntityLink` — after the canonical_name match,
before create. When a **person** carries an email that already belongs to an
active person entity, it ATTACHES (picks up the inbound external identity) instead
of minting a duplicate. Conservative: persons only (a shared firm inbox identifies
an org mailbox, not a person), generic/role inboxes skipped, implausible names
never resolved here. ilike is case-insensitive so the match is re-verified exactly
in JS (`_` is a LIKE wildcard and legal in a local-part). Return payload gains
`resolvedByEmail`. Stops the recurring inflow at the choke point.

### Unit 0 (engine) — make `lcc_merge_entity` person-complete (grounding refuted the premise)
The audit assumed "lcc_merge_entity already snapshots backrefs / just reuse it,"
but live grounding showed the engine moved only `lcc_entity_portfolio_facts` +
`external_identities`, while **ALL 682 dup persons carry `entity_relationships`
and 74 are cadence contacts** — a naive person merge would ORPHAN those edges and
leave cadences pointing at a tombstoned loser. The engine now ALSO dedup-safe
repoints `entity_relationships` (both directions, content-dedup + self-loop drop),
`watchers` (unique on workspace,user,entity → dedup), and blind-repoints
`touchpoint_cadence.contact_id` / `activity_events` / `action_items` /
`inbox_items` / `research_tasks` / `entity_aliases` (no unique on entity_id). The
portfolio/external_identities/`merged_into` logic and the **2-col return signature
are byte-identical**, so the org auto-merge cron / exact-merge worker / Decision
Center org-merge lane are unaffected (and strictly more correct — orgs also carry
relationships). Validated on synthetic persons in a rolled-back tx (0 residue):
relationships repointed+deduped, self-loop dropped, cadence contact repointed, SF
identity moved, loser tombstoned — all assertions pass.

### Unit 2 — auto-work the high-confidence slice; route the rest to review
Migration `20260719140000_lcc_r39_contact_email_dedup.sql` (LCC Opps, applied
live, idempotent): `lcc_normalize_person_name()`,
**`v_lcc_person_email_merge_candidates`** (person email groups, generic-inbox +
junk-name excluded, winner = richest [SF-linked > completeness > longest name],
`name_compatible` = no multi-person composite in the group AND every loser's
normalized name equals / is a ≥4-char substring of the winner's), and
**`lcc_apply_person_email_merges(dry_run default true)`**. Ran the one-shot live
for the **name-compatible slice = 36 groups / 36 persons** (active persons
4001→3965); the **multi-person composite** case (`"Daniel Chumbley, Sean Sharko,
Austin Weisenbeck"` sharing an email with `"Daniel Chumbley"`) is deliberately
routed to review, not auto-merged. **208 ambiguous groups** remain for human
judgment. Verified: 0 relationships/cadences left on a just-merged tombstone; the
three load-bearing caches (`lcc_refresh_priority_queue_resolved` 1279,
`_entity_connected_value` 2975, `_buyer_spe_resolved` 596) rebuild cleanly. No
auto-merge cron — Unit 1 + the candidates view keep it clean going forward.

### Unit 3 — surface the ambiguous remainder in the Decision Center
`api/admin.js`: the existing **`merge_duplicate_entities`** lane now ALSO lists
`v_lcc_person_email_merge_candidates?name_compatible=eq.false` (subject_ref
`mergegrp:<winner_id>`, context `kind:'person_email'`); the `merge` verdict
re-fetches the fresh loser set from the person view for those subjects and rides
the now-person-complete `lcc_merge_entity`. `keep_separate`/`research` unchanged.

### Verified (headless 2026-06-16)
`test/entity-link.test.js` +5 (normalizeEmail/isGenericInboxEmail; email-attach
to existing person = no new entity, `resolvedByEmail`; generic inbox → mints new,
no email lookup). `node --check` clean (entity-link.js, admin.js); `ls api/*.js |
wc -l`=12; full suite **992 pass / 0 fail / 6 skipped**. JS ships on the Railway
redeploy; DB applied live + committed.

### Follow-ups (NOT in R39)
The 208 ambiguous person-email groups are operator-worked via the lane (not
auto-merged). dia/gov domain `contacts` tables are the upstream feeders (via the
sidebar → entities); fixing the `ensureEntityLink` choke point is the leverage
point, but a domain-contacts-level dedup pass is a separate follow-up if the
upstream is also duplicating.

## R40 — reconcile historical merge-orphans + consolidate cadence on merge (2026-06-16)

R39 made `lcc_merge_entity` person-complete, so NEW merges repoint backrefs
correctly — but the engine was incomplete historically (it moved only
`portfolio_facts` + `external_identities`, and **never repointed
`touchpoint_cadence.entity_id` at all**), so the 862 historical tombstones left
backrefs dangling on dead nodes. These don't leak into the priority queue /
cadence dashboard (those filter `merged_into_entity_id IS NULL`), so it wasn't a
visible bug — but the entity graph was INACCURATE, and anything traversing
relationships directly (context packets, MCP, owner→asset rollups) hit dead
nodes. R40 reconciles every backref to its **final** survivor, reversibly.

### Grounded live 2026-06-16 (refined the audit premise)
862 tombstones (chain depth ≤ 2, all resolve to a real non-tombstone survivor).
Dangling-on-tombstone: `entity_relationships` 6,123 (the big one; +12 rows with
BOTH endpoints tombstoned), `lcc_entity_portfolio_facts` **45** (audit didn't
flag these — the engine moves them but old merges left orphans),
`touchpoint_cadence.entity_id` 19 (**14 the survivor ALSO has a cadence →
consolidate; 5 → repoint**), `activity_events` 17, `inbox_items` 13,
`research_tasks` 1, `external_identities` 5, `touchpoint_cadence.contact_id` 0,
`watchers`/`action_items`/`entity_aliases` 0, merged_into chains 2. Also surfaced
(NOT in the audit list but real stale refs): `lcc_buyer_parents` 1 +
`lcc_operator_affiliate_patterns` 3 — all one clean UIRC duplicate (survivor
absent from both registries → safe to follow the survivor).

### Single source of truth (the design rule the task demanded)
**`lcc_reconcile_tombstone_backrefs(p_loser, p_winner, p_snapshot)`** is the ONE
place "move backrefs loser→winner" lives. It does the merge engine's dedup-safe
move set (portfolio_facts, external_identities, entity_relationships [self-loop
drop + both-direction content-dedup + repoint], watchers, contact_id blind
repoint, activity/action/inbox/research/aliases blind repoints) **plus the NEW
`entity_id` consolidate-or-repoint** (Unit 2). Returns a jsonb of per-table
counts. `p_snapshot` (default false) writes the reversible
`r40_merge_reconcile_backup` ledger; cadence-consolidation DELETEs snapshot
**unconditionally** (the one destructive drop, so even forward merges are
reversible). **`lcc_merge_entity` is now a thin wrapper** over the helper —
**byte-identical 2-col return** (`portfolio_edges_moved`/
`external_identities_moved`), so the org auto-merge cron / exact-merge worker /
Decision Center merge lane / R39 person-email merges are unaffected, and the
forward merge now ALSO consolidates `entity_id` cadences (no future tombstone can
leave a cadence dangling). Migration `20260719150000_lcc_r40_merge_orphan_reconcile.sql`.

### Unit 1 — the one-time historical pass
**`lcc_r40_reconcile_merge_orphans(p_dry_run default TRUE)`** — resolves every
tombstone to its **final** survivor via a cycle-guarded, depth-capped (50)
recursive CTE (handles the 2 chains; aborts if any survivor is unresolved/cyclic/
still-a-tombstone), then loops the helper per tombstone (`p_snapshot=true`),
reconciles the registry refs (`lcc_buyer_parents` dedup-then-move,
`lcc_operator_affiliate_patterns` + `lcc_cre_properties` repoint), collapses the
2 merged_into chains to the final survivor, and refreshes the priority-queue
cache. Dry-run writes NOTHING and returns the per-table report. **Reversible**
(every change snapshotted), **idempotent** (re-run finds 0), **chain/cycle-safe**,
**content-dedup** (a repoint never creates a duplicate edge or a `(C,C)`
self-loop — loser self-loops + both-→-same-survivor edges are dropped).

### Unit 2 — consolidate cadence on merge (engine + the existing 19)
The uq index `uq_cadence_contact_property` keys on `(COALESCE(entity_id,zero),
COALESCE(property_id,zero), COALESCE(sf_contact_id,''))`, so a blind `entity_id`
repoint 23505s when the survivor already carries a cadence with the same
(property,sf) key. The helper instead **folds the loser's engagement into the
survivor** (sum emails/calls/meetings, `GREATEST` current_touch + last_touch_at/
flyer/meeting, keep the further-along `phase` via `lcc_cadence_phase_rank`,
`COALESCE` bd_opportunity_id) then DROPs the loser cadence (snapshotted). When
the survivor has no colliding cadence it blind-repoints (the existing 5 case).

### Verified live 2026-06-16 (applied to LCC Opps)
Dry-run report matched grounding exactly. Forward-engine synthetic test (DO block
that RAISEs to self-rollback — **0 residue**): two persons each with a colliding
cadence + a duplicate relationship + an SF id → merge folded counters
(emails 5+2=7, touch GREATEST=3, phase kept onboarding), loser cadence gone,
relationship deduped, SF id moved, 1 `cadence_consolidate` backup row, 2-col
return intact. **Real one-time apply:** reconciled 6,135 ER / 5 xid / 45
portfolio / 19 cadence (14 consolidate / 5 repoint) / 17 activity / 13 inbox / 1
research / 1 buyer_parent / 3 affiliate / 2 chain — **6,229 reversible backup
rows** (5,553 repoint, 655 dedup_delete, 14 cadence_consolidate, 5 cadence_repoint,
2 chain_collapse; 0 self_loop_delete — no two tombstones sharing an edge merged to
the same survivor). After: **0 dangling across every table, 0 chains remaining**;
**idempotent** re-run = 0; load-bearing caches rebuild cleanly
(`lcc_refresh_priority_queue_resolved` 1,284, `_entity_connected_value` 2,928,
`_buyer_spe_resolved` 633); UIRC survivor now in both registries; **R40 created
ZERO self-loops** (the 99 pre-existing `from=to` rows are untouched — separate
old-data matter). `node --check` clean; suite 992 pass / 0 fail / 6 skipped;
`ls api/*.js | wc -l`=12. LCC-Opps only — no dia/gov writes, auth schema
untouched. Reverse any change from `r40_merge_reconcile_backup`.

### Surfaced (NOT fixed here)
99 pre-existing `entity_relationships` self-loops (`from_entity_id =
to_entity_id`) — an entity related to itself, from old captures, unrelated to the
merge graph. A separate dedup/cleanup round.

## CONNECTIVITY #3 — reconcile the two Salesforce link stores (2026-06-18)

Remediation #3 of `CONNECTIVITY_GAP_AUDIT_2026-06-17.md` (after the #1 owner
bridge + #2/#4 owner-resolution passes). The domain DBs hold ~768 owner→SF
ACCOUNT links the BD graph couldn't see — the link lived on `true_owners` (dia
`salesforce_id` / gov `sf_account_id`) but was never mirrored onto the bridged
LCC owner entity. This round makes the two stores agree: one canonical,
BD-actionable SF Account link per owner. Receipts-first, capped, reversible,
ambiguity surfaced (never guessed). JS ships on the Railway redeploy; the cron
migration is applied AFTER the first gated drain.

### Grounding (live 2026-06-18)
- LCC `external_identities(salesforce, Account)` = 2,027, **all 18-char**;
  `(salesforce, Contact)` = 864. Bridge `external_identities(<dia|gov>,
  true_owner, external_id=true_owner_id)` = 6,406 dia / 8,234 gov, one workspace.
- **dia active true_owners** `salesforce_id`: 326 Account (001) + 360 Contact
  (003), 0 other. **gov** `sf_account_id`: 442, all Account, mixed 15/18 (301/141).
- **Id-length mismatch is the trap:** domain ids are 15-char case-sensitive (a
  few 18); LCC is uniformly 18. Raw `=` reads every real match as a mismatch.
- dia 250-owner cross-DB sample: 235 bridged, 36 already carry an SF Account
  link → 30 MATCH (15↔18), 6 CONFLICT. Validated the whole join.

### Unit 0 — the matching helper (`api/_shared/sf-id.js`, ONE place)
`sf15` (15-char base), `sfIdsMatch` (compare by left-15, case-sensitive, 15↔18
safe), `toSf18` (standard SF checksum — what we WRITE so the store stays 18;
anchored against live ids `0011I00000h7mHE→…QAY`, `0011I00000h7yOi→…QAI`),
`classifySfId`/`isAccountId`/`isContactId` (key-prefix object type). **Only
Account (001) ids flow into the reconcile** — the classifier is what keeps a
Contact (003) id out of the Account store.

### Unit 1-3 — the worker (`api/_handlers/sf-link-reconcile.js`, no new api/*.js)
`?_route=sf-link-reconcile-tick` (sub-route of operations.js). GET=dry-run /
POST=drain, capped (`limit`, default 25) + wall-clock-budgeted (~22s). Per domain:
walk Account-id active true_owners → resolve the bridged owner entity →
`planSfLinkReconcile` (pure, unit-tested) classifies each:
- **ATTACH** (Unit 1, the win) — bridged owner, no SF link, id not on any other
  entity → `ensureEntityLink(entityId, salesforce/Account, toSf18(id))`.
  Fill-blanks (skips an entity that already has a link); reversible via
  `external_identities.metadata.batch_tag`. Attaching makes the owner
  "connected" (R6) → it can leave P0.4, so a drain refreshes the queue cache.
- **CONFLICT** (Unit 2) — entity already linked to a DIFFERENT account → seeded
  `sf_link_conflict` decision (never auto-overwrite).
- **COLLISION** (Unit 1) — the id already lives on a different entity → seeded
  `sf_link_collision` decision (same owner, two entities → merge); NOT a second
  link, NOT a blind merge.
- **DUP-SFID** (Unit 3) — one SF id on >1 domain owner → distinct entities →
  seeded `sf_link_collision`. (Two owners → the SAME entity attaches once, not a
  dup — deduped by entity in the per-owner pass.)
- **dia Contact (003) ids** (Unit 3) — NOT Account links; reported as a
  data-quality `contact_id_class` count and DEFERRED (a future pass can
  reconcile them to `external_identities(salesforce, Contact)`); never forced
  into the Account store.

### Decision Center — two new SEEDED lanes (free-form decision_type, no schema)
`admin.js` verdict dispatch:
- `sf_link_conflict`: `keep_current` (record-only) / `accept_domain` (ADDITIVELY
  attach the domain id via ensureEntityLink — existing link never deleted) /
  `research`. Idempotent producer subject_ref `sfconf:<entity_id>`.
- `sf_link_collision`: `merge` (operator picks `winner_entity_id`; every OTHER
  context entity is merged in via `lcc_merge_entity`) / `keep_separate` /
  `research`. subject_ref `sfcoll:<entity_id>` (collision) / `sfdup:<dom>:<sf15>`
  (dup). `ops.js` renders both cards (`_dcCardHTML`) + SUBLANES + titles/intros;
  `?v=` bumped. `v_lcc_decision_open_counts` counts all open types, so the chips
  appear automatically.

### Steady state / rollout
Cron `lcc-sf-link-reconcile` (daily 06:40, `?domain=both&limit=100`) — migration
`20260719170000`, **applied AFTER the first gated drain** (it auto-drains, so it
must not fire before the human-gated capped pass). Reversible: revert a batch via
`DELETE FROM external_identities WHERE source_system='salesforce' AND
source_type='Account' AND metadata->>'via'='sf_link_reconcile' AND
metadata->>'batch_tag'=<tag>`.

### Out of scope (documented)
Owners with NO domain SF id (connector-gated live SF lookup); the dia Contact-id
class (deferred — surfaced as a count); `lcc_canonical_entity_id` (#5);
orphan/cms cleanup (#6).

### Verified (headless 2026-06-18)
`test/sf-id.test.mjs` (sf15/toSf18 checksum anchored to live ids/sfIdsMatch
case-sensitive/classify) + `test/sf-link-reconcile.test.mjs` (planSfLinkReconcile:
attach / already-linked 15↔18 / conflict / collision / dup-sfid / same-entity
attaches-once / unbridged). `node --check` clean (sf-id, sf-link-reconcile,
operations, admin, ops, server); `ls api/*.js | wc -l`=12; vercel.json valid;
full suite 1017 pass / 0 fail / 6 skipped.

## CONNECTIVITY #5 + #6 — retire the dormant back-ref column + surface the residue (2026-06-19)

Closes the connectivity arc (`CONNECTIVITY_GAP_AUDIT_2026-06-17.md`) after #1 (bridge),
#2/#4 (owner resolution), #3 (SF reconcile). Both are small, reversible, **zero
hard-deletes**. Grounded live across dia (`zqzrriwuavgrquhisnoa`), gov
(`scknotsqkcheojiaewwh`), LCC Opps (`xengecqvemvfknjvbvrq`); DB applied live + committed.

### #5 — `true_owners.lcc_canonical_entity_id`: RETIRE (document deprecated, do NOT drop)
Grounded **0% populated** (0/6,821 dia, 0/15,394 gov — never written). The canonical
true_owner→LCC-entity back-reference lives AUTHORITATIVELY on LCC Opps in
`external_identities(source_system='dia'|'gov', source_type='true_owner',
external_id=true_owner_id)` (the #1 bridge). A domain-side denormalized copy was rejected:
cross-DB LCC→domain write + merge drift, for a value already derivable by joining
`external_identities`. **Decision: deprecate, keep the column** — grep found NO live
`api/*.js`/server reader; the only references are the passthrough view
`v_true_owners_effective_role` and the one-shot `scripts/A9b_dia_property_unified_id.mjs`
(which already handles it empty), so per the audit rule it is NOT dropped. Metadata-only
`COMMENT` applied live to both domains marking it deprecated (migrations
`Dialysis/.../20260619_dia_connectivity5_deprecate_lcc_canonical_entity_id.sql`,
`government-lease/sql/20260619_gov_connectivity5_…`). The column, its index, and the view
are retained; add no new readers.

### #6 — clean the residue (surface, don't mislabel; reversible; no hard-delete)
Grounding **refuted two audit premises**, so #6 is surface-first, not bulk row-flagging:

1. **The artifact-name guard over-matches legitimate owners.** `*_is_artifact_owner_name`
   (a conservative MINT-TIME reject) catches real trusts via its date rule ("1984 Levin
   Living Trust Dated July 31, 1984", "Andrew S Pappas Family Trust Dated August 29, 2022")
   and real names via its `by <word>` rule ("Development By Blue Heron LLC", "Down By The
   Riverside LP", "Riverside By Sy LLC"). Flagging those as junk would mislabel real owners.
   AND every artifact-named active owner is **already bridge-excluded** (the bridge bakes the
   same guard — verified: dia 116 artifact-named active, **0** in `v_bridge_eligible_owners`).
   → So instead of a junk verdict, a new **`<domain>.v_owner_residue_review`** view
   CATALOGUES the residue (no row mutation), sub-classifying each artifact match as
   `strong_junk` (unambiguous garbage — numeric / N/A / $-amount / CMBS-code / 1031-buyer /
   phone-email, via new `*_is_strong_junk_owner_name`) vs `needs_review` (the date-trust /
   `by`-name false positives). dia: 116 artifact (59 strong / 57 review) + 2 recorded-owner
   stragglers + 79 orphans. gov: 17 artifact (**only 3 strong / 14 review** — most are legit
   trusts) + 22 recorded-owner stragglers + 5 merged-recorded props + orphans. For
   human/Decision-Center disposition; drop the view → zero trace. Migrations
   `Dialysis/.../20260619_dia_connectivity6_owner_residue_review.sql`,
   `government-lease/sql/20260619_gov_connectivity6_…`.

2. **Orphan true_owners — truly-unreferenced (no row in ANY uuid base table that carries
   `true_owner_id`):** dia **93** (14 carry `salesforce_id` → KEEP, CRM-tracked; 79 no-SF);
   gov **3,249** (30 SF → KEEP; 3,219 no-SF). The audit's dia 196/177 used a narrow 3-table
   definition; the truly-unreferenced set is the defensible "unused" one. **gov's 3,219 is a
   LARGE legacy-ingest residue, NOT the small set symmetric to dia the audit assumed** (gov's
   model differs — `recorded_owners` has no true_owner FK; the Excel master minted a
   true_owner per owner string, many never referenced). Per doctrine (ground-before-acting;
   surface, don't rush a separate job) the full set is SURFACED in the review view for a
   **dedicated future dispositioning round**, not bulk-mutated now. **All SF-linked orphans
   are excluded from the view → untouched.**

3. **cms writer-bug junk entities (LCC Opps) — the one clean disposition.** R35 retyped 345
   dia Medicare CCN identities onto 3 placeholder ASSET entities ("property link approved"
   343, "clinic lead outcome recorded" 1, "research outcome saved" 1) and left them. Grounded
   each has **zero other footprint** (no non-cms identity, no relationship/portfolio/cadence)
   → soft-flagged `metadata.junk_name_flagged=true` + `junk_name_reviewed=true` (so the junk
   lane doesn't re-ask) + `junk_name_source='connectivity6_cms_writer_artifact'` (reversible
   by tag). Migration `20260619120000_lcc_connectivity6_cms_junk_entity_flag.sql`. The **345
   (cms, medicare_ccn) ids are VALID and LEFT PARKED** (not deleted).

### Follow-ups (documented, NOT in this pass)
- **cms CCN re-homing** — attach each of the 345 (cms, medicare_ccn) ids to its real
  clinic/property entity (`dia.medicare_clinics.medicare_id` → the property's asset entity),
  then merge away the 3 placeholders. A distinct, separately-grounded job.
- **gov orphan true_owner dispositioning** — the 3,219 no-SF legacy orphans (surfaced in
  `gov.v_owner_residue_review`) need their own grounded round (merge dups / confirm / retire);
  gov's ownership model makes this materially larger than dia's.
- The artifact `needs_review` rows (legit trusts / `by`-names) want a human pass to rescue
  the false positives and confirm the genuine junk.

### Verified live (read-only / reversible) 2026-06-19
#5: deprecation COMMENT on both domains. #6: dia/gov `v_owner_residue_review` reconcile to
grounding (dia 116/2/79; gov 17/22/5/3,212); the 3 cms entities flagged with the 345 CCN ids
preserved; SF-linked orphans untouched. ZERO hard-deletes; every change reversible by tag /
DROP. No `api/*.js` change (pure DB + docs); `ls api/*.js | wc -l`=12.

## OUTREACH #1 — close the SF-activity → cadence-advance loop (Scott's workflow) (2026-06-19)

Scott does outreach in Outlook/Salesforce, NOT in-app. The cadence engine
(R10/R16/R20/R24) is built + data-ready (521 cadences) but had produced ~0 sends
and ~4 touches ever, because the one link his workflow depends on — SF-logged
outreach advancing the matching cadence — was broken. Grounded live 2026-06-19
(receipts, not the audit premise).

### Unit 1 — root cause (receipts on the real misses)
- **RC1 (dominant, currently biting):** Scott logs most real outreach in SF as
  PLAIN Tasks (`sf_type='Task'`, no `TaskSubtype`). `mapSfTypeToCategory`
  collapsed those to category `note`, and the advance trigger
  `lcc_activity_event_advance_cadence` explicitly skips `note`. Receipts: 31/44
  recent SF events are `note`, **29/31 are real outreach** ("Sent RE: …", "…
  sent Re: …", "Call"), **14 resolve directly onto an active cadence** (+6 onto a
  cadence's `contact_id`). Those advances were silently lost.
- **RC3 (latent structural):** the trigger resolved a cadence ONLY by
  `entity_id` (+ the R10 Unit-2 asset→owner `owns` hop) — **never by
  `contact_id`**. The SF ingest resolves an event's entity to the SF
  Contact/Account, which is frequently the cadence's CONTACT person, not its
  owner `entity_id` (22 active cadences carry `contact_id <> entity_id`).
- **NOT timing / NOT silent-exception:** the happy-path call/email events DID
  advance (thomas gorman emails_sent=4; albert muller calls_made=7) — entity_id
  was set at insert, trigger fired, `lcc_advance_onboarding_cadence` did not
  throw. (The prompt's "clear case" — albert's `last_touch=2026-05-19` — was the
  correct latest-call date, not a miss.) Made the swallow observable anyway.

### Unit 2 — fixes (reuse `lcc_advance_onboarding_cadence` + the single-advance owner)
- **RC3 fix (the gate's core):** migration `20260719180000` adds ONE lookup tier
  to the trigger — a cadence whose `contact_id = NEW.entity_id` — after the
  entity/owns tiers (single place, conservative; reproduces the R10 Unit-2 body
  verbatim). Mirrored in JS `cadence-engine.resolveCadenceForEntity` (the reply
  path) so the two agree. In-app advance path (`advanceCadence`) untouched.
- **RC1 fix:** `sf-activity-ingest.js` `deriveSfCategory(type, subject)` —
  when the SF type collapses to `note` AND it is a generic Task (not an explicit
  SF `Note` object), infer the real channel from the subject (email markers
  `sent`/`Re:`/`Fw:` first, then call markers `Call`/voicemail), else stay
  `note`. Genuine internal notes ("2 - Medical Buyer/Portfolio") stay `note`.
  The handler now categorizes with this, so a Task that is really an email/call
  advances the cadence going forward.
- **Observability:** the trigger's `EXCEPTION WHEN OTHERS` now records the
  swallowed error in a bounded `lcc_cadence_advance_failures` table (the
  activity insert still succeeds — advance stays best-effort).
- **Backfill (reversible):** migration `20260719181000`
  `lcc_backfill_sf_cadence_advances(dry_run default true)` advances each active
  cadence (via the SAME advance fn) once per real SF outreach event that
  resolves to it (entity/contact/owns) and occurred AFTER its `last_touch_at`
  watermark — so trigger-advanced events never double-count and same-day
  duplicate Tasks collapse. Snapshots pre-state into `lcc_sf_cadence_backfill_log`
  + stamps `metadata.cadence_backfilled`. (NOTE: Postgres ARE uses `\y` for word
  boundary, not `\b` = backspace — the first regex draft missed every match.)

### Verified live 2026-06-19
- **RC3 (gate):** synthetic SF call logged on the CONTACT person advanced the
  OWNER's cadence (touch 2→3, calls 0→1, last_touch→today, rescheduled out of
  overdue). 0 residue.
- **Backfill:** real apply fixed **albert muller** — 2 distinct Task-outreach
  days (06-12, 06-17) that never advanced now reflected (`last_touch`
  05-19→06-17, `next_due`→09-16); reversible via the log. Synthetic note event
  advanced then reverted from its snapshot (touch→2, last_touch→original);
  same-day duplicates correctly collapsed (6 events → 2 advances). 0 synthetic
  residue (2 albert log rows kept as the reversible record).
- **No stale residue:** 0 active cadences sit overdue behind a real SF outreach
  event after the fix; `lcc_cadence_advance_failures`=0 (no silent throws).
- Full suite **1023 pass / 0 fail / 6 skipped**; `node --check` clean; `ls
  api/*.js | wc -l`=12. DB applied live + committed; JS ships on the Railway
  redeploy. LCC-Opps only; no dia/gov writes; auth schema untouched.

### Scope / follow-ups
ADVANCE half only (Scott's blocker). The DRAFT half (in-app sender) is
deliberately untouched. Reverse any backfill from `lcc_sf_cadence_backfill_log`.
Follow-up: a small number of SF Account-resolved org events (alliant/primax) have
no cadence at all (lender/buyer, not prospects) — correct no-op, not a miss.

## NBT Phase 2 — SF activity ingest for Tasks (all statuses) + Events (2026-06-20)

Scott does outreach in Outlook/Salesforce, not in-app, and the "progress with
accounts" signal is his Salesforce **Tasks AND Events**, deal-linked or not,
**including completed Tasks** (the completed ones ARE the prospecting history —
which contacts have been worked). This extends the OUTREACH#1 ingest
(`api/_handlers/sf-activity-ingest.js`) so that history becomes `activity_events`
that drive the next-best-touchpoint engine + the cadence advance. **Reuse, not
fork** — same handler, `deriveSfCategory`, the OUTREACH#1 contact-hop trigger,
and `lcc_cadence_advance_failures`. No new api/*.js (still 12); no migration —
the marker the NBT engine reads already exists (`v_next_best_touchpoint`'s
`last_touch_at` falls back to the latest SF `activity_event` for the entity, so
writing the row IS the "already-prospected" signal).

### Unit 1 — Tasks of ALL statuses (open + completed, deal-linked or not)
The handler already ingested regardless of status; this hardens it:
- A COMPLETED Task is the prospecting RECORD and is never dropped (verified — a
  completed deal-linked Task AND a standalone deal-unlinked one both ingest,
  null WhatId tolerated). `Status` / `IsClosed` / `CompletedDateTime` ride in
  metadata (`sf_status`/`sf_is_closed`/`sf_completed_at`) as a **SOFT** signal.
- **Completion is never read as "successfully worked"** — an admin bulk
  auto-completed Scott's open Tasks, so `IsClosed=true` ≠ contacted/responded.
  `tagBulkCompleted()` flags any group of ≥5 closed Tasks sharing an exact
  `(LastModifiedById, LastModifiedDate)` signature `metadata.bulk_completed=true`
  so the engine can discount them; nothing acts on completion to claim a touch.
- Each Task still writes an `activity_events` row (source `salesforce`); the
  OUTREACH#1 trigger advances the matching cadence (entity / owns-hop /
  contact-hop) on email/call/meeting — which, with the activity row, IS the
  "this contact is already prospected" signal NBT reads.

### Unit 2 — Events (meetings), a different shape than Tasks
- `sfRecordKind(rec)` classifies Event vs Task (explicit `attributes.type` /
  object discriminator → bare `Type` of event/task → field shape: Event-only
  fields present AND no `Status`/`IsClosed`). Defaults to `task`, so every
  existing canonical Task shape is byte-identical.
- Events are categorized `meeting` **directly** (never the Task subject-inference
  — an Event titled "RE: ..." is a meeting, not a miscalled email), and
  `resolveSfOccurredAt` anchors them on `StartDateTime` (fallback ActivityDate →
  CreatedDate) instead of stamping now(). The SQL trigger advances the cadence on
  `meeting` via the same contact-hop — no JS advance needed. **The flow-side
  Event pull is added to PA only AFTER this ingest ships** (so we never POST
  Events the ingest can't parse).

### Unit 3 — the archived deep-history limitation (surfaced, NOT faked)
Salesforce ARCHIVES completed Activities older than ~1 year and EXCLUDES them
from the standard SOQL/connector query (need `isArchived=true`/`queryAll`), so
the widened watermark (now−10y) still only reaches ~89 records / ~8 owners.
Options reported in `docs/SF_ACTIVITY_ARCHIVED_HISTORY.md`: (a) a one-time
`queryAll`/Bulk-API pull (the standard PA "Get records" step can't do it — needs
a custom SOQL HTTP action) or (b) go-forward capture (reliable). Recommendation:
ship (b); pursue (a) only as a deliberate one-shot. **Not pretended to be
solvable by a wider watermark.**

### Verified (headless 2026-06-20)
`test/sf-activity-ingest.test.mjs` 23 → 34 (`sfRecordKind` event/task;
`resolveSfOccurredAt` Event-StartDateTime vs Task-ActivityDate; completed
deal-linked + standalone Tasks ingest with soft completion captured;
admin-bulk-completion flag + below-threshold no-flag; Event → meeting anchored on
StartDateTime, never the "RE:" email miscategorization, WhatId fallback). `node
--check` clean; `ls api/*.js | wc -l`=12; full suite **1034 pass / 0 fail / 6
skipped**. JS ships on the Railway redeploy; no DB change.

## CONTACT-SELECTION Slice 1 — the ranked decision-maker bench + active pick (2026-06-20)

Implements `CONTACT_SELECTION_STANDARD`: for each owner, target the
DECISION-MAKER first (signatory > controlling-role > economic owner > registered
agent > captured), surface the bench, pick ONE active contact, and route the
contactless to the right enrichment. **Slice 1 is READ-ONLY and GATED — Slices 2
(pivot state + feedback re-rank) and 3 (deed/SOS/address enrichment workers) are
NOT built; they wait on Scott's gate.** DB applied live + committed; no JS / no
api/*.js change (≤12 holds).

### Grounding refuted two prompt premises (receipts, 2026-06-20)
- The 656 NBT `acquire_contact` owners carry **0** LCC-native human signals
  (0 related persons, 0 SF Contacts) — so the candidate signals MUST come from
  the DOMAIN DBs. Mandatory mirror.
- **gov `loans.cmbs_sponsor` is NOT a signatory/principal** — the values are CMBS
  securitization SHELF codes (BBCMS / CGCMT / COMM / CSAIL / DBJPM / GS / CITI),
  the bond trust, not a person to call (the `isImplausiblePersonName` guard
  already treats them as junk). **Dropped the gov loan-sponsor tier.** gov
  authority-1 (signatory) is genuinely absent from structured data → it is
  `parse_deed_signatory` enrichment (Slice 3) territory. Named-bench reality:
  gov 30 owners (recorded-owner manager/agent), dia 134 (true_owner economic
  contacts + manager). 382 gov / 277 dia of the 656 are bridged → signals attach.

### What shipped (all additive / reversible — drop the artifacts → zero trace)
- **Domain anon views** `v_owner_contact_signals_portfolio` (gov
  `government/20260620120000`, dia `dialysis/20260620120000`) — owner-grained,
  one row per `true_owner` with a `candidates` jsonb bench
  (`[{name,role,authority,source,n_props}]`) + a `has_reg_address` boolean
  (address-reverse-lookup hint). NAMES ONLY (same PII posture as the existing
  `v_property_owner_facts_portfolio`); addresses exposed only as a boolean.
  Owner=postgres so anon bypasses RLS. Candidate sources → authority ladder:
  recorded_owner manager (2), registered agent (4); dia adds true_owner economic
  contacts (3). **cmbs_sponsor EXCLUDED** (see above).
- **Owner-keyed mirror + isolated sync** (LCC `20260620120000`):
  `lcc_owner_contact_signals` (PK `(source_domain, source_true_owner_id)` = the
  domain true_owner uuid the `external_identities(<dia|gov>,true_owner)` bridge
  carries) + `lcc_sync_owner_contact_signals` / `_finalize` (pg_net, 1000/page,
  vault secrets, graceful-empty) + gentle daily cron
  `lcc-owner-contact-signals-sync`/`-finalize` (05:00/05:05, after owner-facts,
  before the mirror reconcile). Modelled on `lcc_sync_property_owner_facts`;
  ISOLATED so a failure can't touch a working path. Live: **gov 30 + dia 266 =
  296 owner rows** (164 named, the rest carry an address for routing).
- **Candidate + active views + SQL guards** (LCC `20260620121000`):
  - `lcc_looks_like_person` / `lcc_is_rejected_contact_name` /
    `lcc_is_operator_owner_name` — SQL mirrors of the `entity-link.js` write-time
    guards (junk / CMBS code / broker `by` / verification-footnote sentence /
    federal anti-pattern / dialysis OPERATOR). They gate the READ-TIME bench;
    Slice 3 enrichment still mints through `ensureEntityLink` (the JS choke
    point).
  - `v_owner_contact_candidates` — one row per candidate per bridged owner
    (domain mirror + LCC-native related persons), `authority_level` +
    `is_named_individual` + cross-property `n_props` recurrence. Live: **200 rows
    / 91 owners** (56 controlling, 62 economic, 47 agent, 35 captured; 148 named
    individuals).
  - `v_owner_active_contact` — ONE active per owner (top by authority → named →
    recurrence) + the full bench + `confidence` + `partnership` flag +
    `enrichment_action` for the contactless (`sos_manager_lookup` for an LLC,
    `address_reverse_lookup` when a registered/notice address exists, else
    `manual_research`; `parse_deed_signatory` is Slice 3).

### Gate (read-only, 2026-06-20) — PASS, with one fix + one deferral
- **Distribution:** 172 owners; 88 with an active decision-maker (40 controlling,
  46 economic, **0 registered-agent ever chosen as active** — agents only sit in
  the bench, per the standard's low rank), 84 contactless routed (40 SOS / 44
  address / 0 manual), 10 genuine partnerships, **0 operator leak**.
- **Fix applied during the gate:** dia operator-as-true_owner entities
  (Fresenius/DaVita/American Renal — the R8 artifact) surfaced as "owners" with a
  noisy 15-manager bench + a FALSE `partnership=true`. Added
  `lcc_is_operator_owner_name` and excluded operator-owner entities from both
  views (the standard forbids surfacing an operator as an owner contact).
- **Surfaced (NOT fixed):** (a) ~74 of 164 named domain owners are **unbridged**
  to an LCC owner entity (gov has only ~53% of true_owners bridged) — a
  bridging-coverage gap; (b) a few **public institutions** (MassMutual, Agree
  Realty, public REITs) mis-route to SOS/address enrichment when their real path
  is known IR contacts — a Slice-3 public-company refinement.

### Slices 2 & 3 (NOT in this slice — gated)
- **Slice 2:** `owner_contact_pivot` (active pick + bench + `pivot_history`),
  cross-property recurrence lock, and feedback re-rank from the SF-activity
  ingest (referral → pivot, no-response → down-bench, bounce → demote, two-way →
  lock).
- **Slice 3:** the enrichment workers (`parse_deed_signatory`,
  `sos_manager_lookup` free-SOS-direct over paid, `address_reverse_lookup`) that
  resolve a person → `ensureEntityLink` → attach with `contact_role`, draining
  the ~496 contactless owners; plus wiring `v_owner_active_contact` into the NBT
  `acquire_contact` next-action.

## CONTACT-SELECTION Slice 2 — pivot state + feedback re-rank (2026-06-20)

The active contact is a HYPOTHESIS that pivots as research + outbound feedback
arrive. Builds on Slice 1; DB applied live + committed; one best-effort JS
producer hook (ships on Railway redeploy). Reversible — `pivot_history` is the
audit trail, never a hard-delete. Also folds in two Slice-1 view refinements
(Scott's gate asks).

### View refinements (`v_owner_active_contact`, migration `20260620122000`)
- **`&`-detector tightened** — partnership now fires only on genuine
  multi-principal: `n_managers>=2` OR `jv/joint venture` OR `\m\w+ & \w+\M`
  between non-firm tokens. Live: **10 → 3** (dropped 7 false positives like
  "AT&T"/"Smith & Co LLC").
- **Public-company IR carve-out** — `lcc_is_public_company_name` (REIT / "*
  Trust" / known net-lease REITs + insurers / Bancorp) routes those to
  `enrichment_action='public_company_ir'` (known IR/asset-mgmt contact path), NOT
  SOS/address. Live: **6 carved out** (MassMutual, Agree Realty, Community
  Healthcare Trust …); sos 40→36, addr 44→42.

### Pivot state (`owner_contact_pivot`, LCC Opps)
- One row per owner: `active_contact_name`/`_entity_id`, `bench`, `confidence`,
  `enrichment_action`, `consumed`/`demoted` (names tried/demoted),
  `recurrence_locked`, `status` (`active|locked|exhausted|superseded`),
  `pivot_history` jsonb. Drop the table → zero trace.
- **`lcc_seed_owner_contact_pivots`** (idempotent — INSERTs missing owners,
  NEVER clobbers an existing active pick) + **`lcc_ensure_owner_pivot`**
  (seed-on-demand). Seeded 172.
- **`lcc_apply_contact_feedback(entity, kind, detail, source)`** — the single
  re-ranker. kinds: `referral` (pivot to the named person, prepend to bench) /
  `no_response` (advance DOWN the bench, current → `consumed`) /
  `bounce`|`wrong_person` (demote current → `demoted`, advance) /
  `two_way`|`positive` (LOCK — engaged, human takes over; blocks further
  auto-moves) / `recurrence` (set `recurrence_locked`). Every change appends
  `pivot_history {at,kind,reason,source,from,to}`.
- **`lcc_detect_contact_recurrence`** — passive research re-rank: locks owners
  whose active contact recurs across ≥2 of their properties (`n_props>=2`). Live:
  3 locked. Cron `lcc-owner-contact-pivot-refresh` (05:20 daily — seed +
  recurrence).

### JS producer (the active-feedback feed)
`sf-activity-ingest.js` — on a freshly-inserted **inbound reply**, after the
cadence advance, calls `lcc_apply_contact_feedback(owner, 'two_way')`
(best-effort, deps-injectable, no-op for a non-owner entity) so a real reply
LOCKS the owner's active pick. Reuses the existing `isInboundReply` detection +
the cadence owner-hop (`cad.entity_id`). referral/no_response/bounce remain
API-driven (operator or a future SF-note parser); the mechanism is built.

### Gate (synthetic, 0 residue) 2026-06-20
A throwaway 3-candidate pivot exercised the full chain: `Alice →(no_response)→
Bob →(referral)→ Dave →(bounce)→ Bob →(two_way)→ LOCKED`; `consumed=[Alice]`,
`demoted=[Dave]`, post-lock `no_response` is a no-op, `pivot_history` carries all
5 reasons. Recurrence auto-lock fired on 3 real owners. Synthetic row deleted (0
residue). `node --check` clean; 12 api files.

## CONTACT-SELECTION Slice 3 — enrichment workers + NBT wiring (2026-06-20)

Drains the bench into REAL connected contacts and wires the resolved
decision-maker into the NBT `acquire_contact` action. No new api/*.js (worker is
a sub-route of operations.js — still 12). DB cron applied live; JS ships on the
Railway redeploy. Reversible (an attach = a relationship row + the pivot pointer).

### The worker — `?_route=owner-contact-enrich-tick` (`_handlers/owner-contact-enrich.js`)
GET=dry-run / POST=drain, capped (`limit`, default 25) + ~20s budget, internal
auth. `processOwnerEnrichmentRow` (pure, deps-injected, unit-tested) per owner
pivot, three classes / one core:
- **(a) ATTACH a named decision-maker** (the free drainer) — when the active pick
  is a real person (`looksLikePersonName`): `ensureEntityLink` the person (the JS
  guards — junk/implausible/firm-retype — apply, so garbage is never minted) →
  `linkPersonToEntity(owner)` (`associated_with`) → `stampContactOnActiveCadence(
  onlyContactless)` (never clobbers an existing contact) → point
  `owner_contact_pivot.active_contact_entity_id` at it. The owner becomes
  connected/reachable and LEAVES `acquire_contact`.
- **(b) MANAGER-ENTITY DRILL-THROUGH** — when the controlling-role pick is a FIRM
  (a management company, not a person): register the manager as an `organization`
  + a `manager`/`managed_by` edge, and re-route the pivot
  `enrichment_action='find_person_at_manager'` (find a PERSON at the manager via
  SOS) — never mints the firm as a person.
- **(c) EXTERNAL ENRICHMENT** for the contactless — `sos_manager_lookup` /
  `address_reverse_lookup` / `parse_deed_signatory` adapters (feature-flagged on
  `OWNER_ENRICH_SOS_URL` / `_ADDRESS_URL` / `_DEED_URL`; **no-op `unconfigured`
  until set** — the find_contacts_by_account rollout pattern; free SOS-direct
  preferred). A configured resolve routes back through the same attach path.
  `public_company_ir` → `public_ir_manual` (known IR-contact path, no scraper).
- Cron `lcc-owner-contact-enrich` (05:25 daily, limit 25, migration
  `20260620123000`) — no-ops until operations.js ships (endpoint 404s; same
  posture as the R16 cron).

### NBT wiring (`operations.js getNextBestTouchpoint`)
After loading `v_next_best_touchpoint`, overlays each row with the pivot's
`active_contact_name` / `_role` / `_authority_level` / `contact_confidence` /
`enrichment_action` / `active_contact_entity_id` (best-effort second query, no
join) — so an `acquire_contact` card shows WHO to acquire (or which enrichment to
run), not just "no contact".

### Dry-run distribution (live 2026-06-20)
170 unlinked owners: **attach_person 67 + manager_drillthrough 15 = 82 drain for
free now**; sos 36 + address 42 = 78 await an enrichment adapter; public_ir 6;
manual 4.

### Gate (2026-06-20)
- `test/owner-contact-enrich.test.mjs` (7): attach / already-linked short-circuit
  / firm-manager drill-through / guard-rejection / sos-unconfigured no-op /
  sos-resolve→attach / public_ir. Uses the REAL `looksLikePersonName` so the
  person-vs-firm split matches production.
- **Live attach round-trip (reversible, 0 residue):** attached
  "Next Generation Capital LLC → LOMANGINO CHARLES" → NBT next_action flipped
  `acquire_contact → cadence_touch` (connected); reverted (delete person +
  relationship + null pivot) → back to `acquire_contact`, 0 residue.
- `node --check` clean (operations.js, server.js, owner-contact-enrich.js);
  vercel.json valid; `ls api/*.js | wc -l`=12; full suite **1041 pass / 0 fail /
  6 skipped**.

### Follow-ups (NOT in this slice)
The actual free SOS-direct / address-reverse / deed-signature adapters behind the
flagged hooks (the volume for the 78 contactless); rendering the resolved/pivoted
contact in the entity-detail Next-Step banner + the Decision Center buyer lane
(the full "one truth, three renderings"); the no_response/bounce/referral SF-note
parsers feeding `lcc_apply_contact_feedback` (the mechanism is built, two_way is
wired).

## R50 — geographic BD features on the existing geocode coverage (2026-06-20)

The geocode investment (Round 76gn) delivered the COVERAGE (gov ~96.6%, dia
~86.4% lat/lng) but its payoff features were never built — the only consumer of
lat/lng was the lease-comps export. R50 turns the dormant spatial layer into live
BD signal: nearby-owner outreach cohorts, nearby-sales comp anchors (filling the
MCP context-packet comps gap), and distance-based competitor/concentration
analysis — all on ONE shared haversine primitive, additive + READ-ONLY, wired
into the property detail page and the agent context layer.

### Domain SQL (gov + dia, applied live + committed)
One shared `<dom>_haversine_miles` (matches the JS `_udHaversineMiles`,
R=3958.7613 mi) + one nearest-neighbor primitive `<dom>_nearby_properties`
(bounding-box prefilter -> haversine, excludes self/archived, ungeocoded subject
-> EMPTY) reused by the three features:
- `<dom>_nearby_same_owner` (Unit 1) — same owner (true/recorded owner id or
  `<dom>_norm_owner_name` fallback) within radius. gov returns annual_rent +
  agency; dia returns tenant + operator.
- `<dom>_nearby_sales` (Unit 2) — recent sales within radius + months window.
  **gov cap rate prefers the derived `cap_rate_history` value** (income_confidence
  ladder high>medium>low) then ingested `sold_cap_rate`; **dia coalesces**
  cap_rate_final -> cap_rate -> calculated -> stated and drops
  `exclude_from_market_metrics`. `cap_rate_source` records which.
- `<dom>_nearby_competitors` (Unit 3) — gov: nearest gov-leased assets
  (`same_agency`); dia: nearest dialysis facilities from the geocoded PROPERTIES
  book (`same_operator`) — **medicare_clinics has 0 geocoded rows** (the geocode
  cron pulls from properties), so distance ranking is over properties; detail.js
  keeps same-county CMS as the ungeocoded fallback.

All `SECURITY DEFINER` + `GRANT EXECUTE TO anon, authenticated, service_role`
(same posture as the `v_*_portfolio` anon views — RLS-protected base tables stay
protected). Migrations: `government-lease/sql/20260620_gov_r50_geographic_features.sql`,
`Dialysis/supabase/migrations/20260620_dia_r50_geographic_features.sql`.
Reversible (DROP FUNCTION -> zero trace). No writes to curated data.

### LCC wiring (`api/operations.js`, ships on Railway redeploy)
- `domainRpc(domain, fn, args)` — server-side POST to a domain `rpc/<fn>`.
- `GET /api/operations?action=property_geo&domain=&property_id=` -> `getPropertyGeo`:
  `{nearby_owners, nearby_sales, nearby_competitors, subject_geocoded, radius}`.
  Heavy scan stays in the DB; LCC fans out the three RPCs + reports the
  geocode-coverage caveat (the ~3.4% gov / ~13.6% dia ungeocoded tail -> empty
  sets + `coverage_note`, the honest answer, not "broken").
- **`assemblePropertyPacket` comps gap CLOSED** — the long-deferred
  `fields_missing.push('comps')` placeholder now fills `comps` from
  `<dom>_nearby_sales` (radius 10mi / 36mo / top 8) when the subject is geocoded;
  records comps missing only on empty/error. So the property context packet AND
  the MCP/agent layer now carry nearby comps. (`deps.domainRpc` injectable for
  tests.)

### UI (`detail.js` + `gov.js`)
- `_udLoadPropertyGeo` + `_udRenderGeoSection` (shared nearby owners + sales
  tables). dia operations tab renders the geo cohort and **switches the
  competitor view from same-county to lat/lng distance**, same-county CMS list as
  the ungeocoded fallback. gov ownership detail gets an async geo filler
  (`_govFillGeoSection`) — nearby owner cohort + nearby sales + a NEW
  nearest-gov-leased competitor table.

### Verified
SQL spot-checked live on real geocoded subjects (gov Arlington/Bronx — sales,
competitors, same-owner cohort, cap-rate provenance `cap_rate_history:high/medium`;
dia clinic — distance competitors with `same_operator`; ungeocoded subject ->
empty). `test/property-context-packet.test.mjs` +3 (comps fill via injectable
domainRpc; honest fields_missing on empty/error). `node --check` clean
(operations.js, detail.js, gov.js); `ls api/*.js | wc -l`=12; full suite
**1044 pass / 0 fail / 6 skipped**.

### Coverage caveat (reported, not hidden)
Subjects in the ungeocoded tail (~3.4% gov / ~13.6% dia) or whose radius has no
geocoded neighbors return empty sets — `subject_geocoded:false` /
`coverage_note:'subject_not_geocoded'`. dia competitors fall back to same-county.

### Follow-ups (NOT in R50)
PostGIS/earthdistance + GiST index (not needed at ~12-19k rows/domain — brute
haversine + the new `idx_<dom>_properties_lat_lng` bbox index suffices);
owner-cohort -> BD spine outreach-list generation; geo on the Today/queue
surfaces.

## R51 — make the deed grantee win the owner conflict (2026-06-20)

The recorded deed grantee — the authoritative "who took title" — is captured on
5,829 gov props (1,711 dia) but could never win and never propagated, so ~630-920
gov props (164 dia) show a stale / broker-as-owner recorded_owner vs
`latest_deed_grantee`. Root cause: `field_source_priority` had only
`costar_sidebar` (60) for `gov.properties.recorded_owner_name` and **no rule at
all** for `gov.properties.recorded_owner_id` — no `recorded_deed`/`county_records`
above the aggregator. dia was already wired (county_records=10 beats costar).
Scope A (Scott): wire + forward-propagate now; surface the backlog to a
value-ranked lane; identify the high-confidence auto-subset in a dry-run Scott
blesses before any bulk write. **Deed grantee is authoritative for `recorded_owner`
(legal title) ONLY — `true_owner` is NEVER written directly (it is the R47-resolved
parent; it re-resolves from the new recorded_owner via the owner-facts mirror /
R47 cron).**

### Unit 1 — wire the gov owner priority (mirror dia)
Migration `20260620140000_lcc_r51_unit1_owner_deed_priority.sql` (LCC Opps,
idempotent ON CONFLICT DO NOTHING): adds `gov.properties.recorded_owner_name`
(manual 1 / **recorded_deed 3** / county_records 10, above the existing costar 60)
and the full `gov.properties.recorded_owner_id` ladder (manual 1 / recorded_deed 3
/ county 10 / costar 50 / rca 50 / crexi 55 / crexi_desc 60 — mirroring dia), plus
the explicit `recorded_deed` (3) source on **both** domains' properties owner
fields so the Unit-2 propagation resolves deterministically and
`v_field_provenance_unranked` stays 0. Verified live: `lcc_merge_field` on a
synthetic pk — recorded_deed BEATS costar_sidebar (`write`), and manual_edit HOLDS
(recorded_deed → `skip`, current_source=manual_edit). 0 residue.

### Unit 2 — propagate deed grantee → recorded_owner (forward, authoritative-only)
`api/_handlers/sidebar-pipeline.js`:
- **`granteePassesOwnerGuards(name)`** (exported) — rejects a brokerage
  (`isCompetitorBroker`, incl. the " by <Broker>" form via `sanitizeOwnerName`),
  federal anti-pattern (`isFederalOwnerAntiPattern`), and structural junk
  (`isJunkEntityName` — **org-safe**, does NOT reject firm suffixes, so an LLC/LP
  owner passes; do NOT use `isImplausiblePersonName` here — it rejects every LLC).
- **`propagateDeedGranteeToOwner(args, deps)`** (exported, deps-injected for tests)
  — resolves/creates the recorded_owner for the grantee, then writes
  `properties.recorded_owner_id` (+ `recorded_owner_name` on dia, which has the
  denormalized column; gov does not) **THROUGH the `shouldWriteField` priority
  gate** (`source='recorded_deed'`): recorded_deed(3) outranks the aggregators but
  can NEVER clobber manual_resolution/manual_edit(1). NEVER writes `true_owner_id`.
- **`latestDeedGranteeFromMetadata(metadata)`** picks the newest non-mortgage deed
  buyer. Wired into `propagateToDomainDbDirect` (Step 5b4) AFTER both deed writers,
  best-effort (a failure never blocks the capture). So a new CoStar/RCA capture
  self-corrects a stale / broker-as-owner recorded_owner.

### Unit 3 — detection view + Decision Center lane + dry-run-gated auto-subset
- **`v_owner_source_conflict`** (gov `government-lease/sql/20260620_gov_…`, dia
  `Dialysis/supabase/migrations/20260620_dia_…`, names only, read-only) — props
  where recorded_owner ≠ latest_deed_grantee, classified `conflict_kind`:
  `broker_as_owner` / `stale_seller` (recorded_owner = the SELLER of a recorded
  sale whose buyer == the grantee) / `spe_vs_parent` (recorded_owner == the
  resolved true_owner = the parent — legit, default KEEP) / `deed_newer_stale`
  (default). `auto_fixable` = broker_as_owner | stale_seller | (deed_newer_stale +
  dated) AND grantee_passes_guards AND not spe_vs_parent. Live: gov 575 stale (189
  auto) + 315 spe_vs_parent (kept) + 17 broker + 13 seller; dia 126 stale (106
  auto) + 29 spe + 6 seller + 3 broker.
- **Decision Center lane** `decision_type='owner_source_conflict'` (`admin.js`
  federated fetch + verdict dispatch, `ops.js` card). value-ranked by rent;
  spe_vs_parent excluded. Verdicts: `accept_deed`/`broker_not_owner` →
  `propagateDeedGranteeToOwner` (effect-first; a non-applied propagation 502s +
  keeps the decision open), `keep_current` (record-only), `research`.
- **High-confidence auto-subset** `?_route=owner-deed-autofix` (`admin.js`
  `handleOwnerDeedAutofix`): **GET = dry-run** (lists `auto_fixable` rows +
  before/after, NO writes); **POST = apply, gated on env `DECISION_OWNER_DEED_WINS`**
  (default off → 403) — drives each row through the same Unit-2 propagation (so the
  per-row priority gate + guards still apply). Do NOT bulk-write without the
  dry-run blessing.

### Verified (headless + live read-only 2026-06-20)
`test/owner-deed-propagation.test.mjs` (10): guard accepts LLC/trust, rejects
broker (bare + " by ")/junk/federal/short; latest-grantee picker skips mortgages;
propagation applies (gov no name col, dia sets name, true_owner never written),
broker grantee never writes, manual-held field blocks (skip), already-current
no-op. `node --check` clean (sidebar-pipeline, admin, ops); `ls api/*.js | wc -l`=12;
full suite 1106 pass / 0 fail / 6 skipped. DB (priority rows + both views) applied
live; JS ships on the Railway redeploy. dia/gov pipelines otherwise untouched.

### Activation / follow-ups
The bulk auto-fix is OFF until `DECISION_OWNER_DEED_WINS=on` in the Railway env
(run a GET dry-run first). The Decision-Center per-row verdicts work without it.
The forward propagation (Unit 2) is live on every new deed capture once the JS
deploys. A county-records sync producer could call the same helper later.

## R53 — ownership change → suspected-sale + research signal (GSA lessor + deed) (2026-06-20)

An owner/landlord change across our four owner sources (recorded_owner, deed
grantee, GSA lessor, sale buyer) is the same tell — a likely transfer we never
recorded. R53 links the orphaned GSA events, elevates the buried lessor change,
turns deed/lessor/owner conflicts into value-ranked **suspected-sale** research +
candidates, corroborates ownership across the four sources, and surfaces the
stale-diff runbook. Builds on R51 (`v_owner_source_conflict`) + reuses the R7
federated Decision-Center machinery. **gov-focused** (the lessor signal is
gov-only; dia deed-conflict is a parallel follow-up). Never auto-writes a
`sales_transactions` row — a suspected sale is a LEAD, confirmed only with an
operator-supplied price. DB applied live to gov + LCC Opps; JS ships on the
Railway redeploy.

### Grounding refuted the audit's volume premises (receipts, 2026-06-20)
- `gsa_lease_events`: 261,254 rows, **100% `property_id` NULL** (orphaned),
  joinable via `lease_number → gsa_leases.property_id` (7,494/7,495 GSA leases
  carry a property_id).
- `changed_fields` is **double-encoded** (a JSON string in the jsonb column, via
  `json.dumps`) — `? 'lessor_name'` returns 0; must unwrap `(#>>'{}')::jsonb`.
- The raw lessor "changes" are **mostly case/whitespace/legal-form churn**
  ("BOLLINGER PROPERTIES, LLC"→"Bollinger Properties, LLC"; "CO, LLC"→"COMPANY,
  LLC"; "Red Cross"→"Red Cross, The"). Of 18,566 lessor field-changes only ~10k
  survive alnum-normalization, and only **763** survive the stricter
  legal-form-core normalizer below AND lack a recorded sale — so the
  suspected-sale set is precise, not a 10k-row flood.

### Unit 1 — link gsa_lease_events → properties (prerequisite)
gov `sql/20260620_gov_r53_unit1_link_gsa_events.sql` — one-time backfill
`property_id` from `gsa_leases` (**0% → 61.3% linked**, 160,258 events; the NULL
remainder are events whose lease has no property-matched GSA lease — the honest
join ceiling) + a partial index. Forward path: `src/gsa_monthly_diff.py` now
builds a `lease_number→property_id` map and stamps `property_id` on every event
insert (logs `Events with property_id: N/M`). Reversible (`SET property_id=NULL`).

### Unit 2 — elevate the GSA lessor change → suspected sale
gov `sql/20260620_gov_r53_unit2_suspected_sale.sql`:
- `gov_norm_owner_core(text)` — dense (strip-all-punct) + trailing legal-form
  strip (llc/lp/inc/co/company/corp/ltd/na/dst/the/…) so form/article variants
  reduce to the SAME core (NOT a sale) while genuine owner changes (Morgan Chase
  Bank→USPS, School Street Associates→Boyd DC II GSA) differ. "trust" deliberately
  NOT stripped.
- `v_gsa_lessor_change` — most-recent GENUINE lessor change per property
  (core-norm old≠new), value-ranked by rent, with a `has_matching_sale` (±12mo)
  flag. The buried `changed_fields.lessor_name` is now a first-class signal (a
  view, not a new event_type — lower-risk than touching the diff's enum).

### Unit 3 — suspected-sale candidates + Decision Center lane
- `v_suspected_sale` (gov) — the unified CANDIDATE feed (mirrors
  `v_owner_source_conflict`'s shape): lessor-change-with-no-sale (**763**) +
  R51 `deed_newer_stale`-with-no-sale (**21**) = **784**, value-ranked, names
  only. Each row is a LEAD (suspected_grantor→grantee + suspected_sale_date).
- `gov_confirm_suspected_sale(property_id, sale_date, sold_price, buyer, seller,
  actor, dry_run default true)` — SECURITY DEFINER, **service_role only**. The
  ONLY path that records a suspected sale, and ONLY with an operator-supplied
  price (≥$50k floor; never fabricated). Writes through the NORMAL
  `sales_transactions` insert so the cap-rate trigger fires. `dry_run` DEFAULTS
  TRUE; idempotent (same price within 31d → `already_exists`).
- **LCC Decision Center lane** `decision_type='suspected_sale'` (list-federated,
  reuses R7 machinery — `admin.js` FEDERATED set + `federatedSubjectRef`
  (`susp:gov:<pid>:<signal>`) + `fetchFederatedSource` (gov `v_suspected_sale`,
  value-ranked) + verdict dispatch; `ops.js` lane card + `dcConfirmSuspectedSale`
  price/date prompt). Verdicts: **confirm_sale** (operator price → the gov RPC →
  real sales row; effect-first, a non-applied RPC 502s + keeps the decision
  open), **not_a_sale** (record-only → the `lcc_decisions` anti-join stops asking
  — refi/correction), **research** (`createResearchTask` research_type
  `trace_unrecorded_sale`). Minted only at verdict time (anti-bloat); the 784
  backlog is NOT seeded.

### Unit 4 — corroborate the four owner sources + owner ladder
- gov `sql/20260620_gov_r53_unit4_owner_corroboration.sql` —
  `v_owner_source_corroboration` aligns recorded_owner / latest_deed_grantee /
  current GSA lessor / latest sale buyer (normalized) and classifies:
  **all_agree 6,956 / insufficient 3,828 / all_disagree 1,332 (→ research) /
  deed_lessor_agree_owner_stale 428** (deed grantee == GSA lessor, both disagree
  with a stale recorded_owner → the HIGH-CONFIDENCE two-source-corroborated subset
  of R51's deed-wins auto-reconcile; rides the existing R51 `owner-deed-autofix` /
  lane).
- LCC `20260620160000_lcc_r53_gsa_lessor_owner_priority.sql` — registers
  `gsa_lessor` in `field_source_priority` at **priority 20** (corroborating —
  below recorded_deed=3/county=10, above aggregators=50) for
  `gov.properties.recorded_owner_name`/`_id`, so a future gsa-lessor sync producer
  that pushes the lessor via `lcc_merge_field` ranks correctly (keeps
  `v_field_provenance_unranked` at 0). No heavy writer this round.

### Unit 5 — stale GSA diff (operational)
`docs/RUNBOOK_gsa_monthly_diff.md` — snapshots are current (through 2026-06-01)
but the diff only ran through 2026-03-01 (three un-diffed transitions). Root
cause: the diff is a side-effect of `run_pipeline.ingest_and_diff`, not a
standalone job. Runbook: diagnostic (latest_snapshot vs latest_event_diff),
catch-up via `python -m src.gsa_monthly_diff --diff PREV CURR` per pair, and the
go-forward guard.

### Verified live 2026-06-20
Unit 1 link 0%→61.3%. Suspected-sale set 784 (763 lessor + 21 deed), value-ranked
top is genuine owner changes (Morgan Chase→USPS, CIM→Washington DC III FGF, School
Street→Boyd DC II GSA) after the core-norm precision pass (1018→784). Corroboration
distribution as above. `gov_confirm_suspected_sale`: dry-run wrote nothing; real
write on a synthetic throwaway gov property created exactly ONE sales row
(`data_source='suspected_sale_confirmed'`, trigger fired clean), idempotent re-run
`already_exists`, **all synthetic fixtures deleted — 0 residue**. `node --check`
clean (admin.js, ops.js); `python3 -m py_compile` clean (gsa_monthly_diff.py);
`ls api/*.js | wc -l`=12; full suite **1106 pass / 0 fail / 6 skipped**.

### Follow-ups (NOT in R53)
dia parallel (deed-conflict suspected sales — dia has no GSA lessor); a gsa-lessor
sync producer that pushes the current lessor into `recorded_owner` via
`lcc_merge_field` (the priority slot is registered); auto-reconcile the 428
deed_lessor_agree_owner_stale via the R51 owner-deed-autofix (gated on
`DECISION_OWNER_DEED_WINS`); fold the catch-up diff into the recurring schedule.

## R54 — loan maturity (+ distress) as a value-ranked BD trigger (2026-06-20)

A loan maturity is the classic CRE BD trigger — the owner must refinance or sell
— and we capture it but ignored it. Grounded live: gov 1,500 loans / 372 with a
`maturity_date`; using **current-debt semantics** (the property's latest-maturing
loan, so a refinanced property whose newest loan matures >24mo correctly drops
out) **154 gov properties** have their current debt maturing within 24mo (48
matured + 106 within) carrying ~$139M annual rent; **dia 18** (thin — dia carries
far less debt data). R54 turns the dormant debt layer into a value-ranked BD
signal wired into the operator's surfaces, exactly as R50 lit up the geocode
layer. gov-focused; dia built in parallel. Additive / read-only — no writes to
curated data. DB applied live; JS ships on the Railway redeploy.

### Unit 1 — the maturity-watch view (the BD trigger source)
`v_loan_maturity_watch` (gov `government-lease/sql/20260620_gov_r54_loan_maturity_watch.sql`,
dia `Dialysis/supabase/migrations/20260620_dia_r54_loan_maturity_watch.sql`) —
one row per property whose **current debt** (its latest-maturing loan, picked via
`DISTINCT ON (property_id) ORDER BY maturity_date DESC`) matures within 24mo OR is
matured. Carries `maturity_date`, `months_to_maturity` (negative = matured — note
`age()` already returns a negative interval for a past date, so NO sign flip),
`maturity_band` (matured / <=6mo / <=12mo / <=24mo), `loan_balance`, `annual_rent`
(gov `gross_rent`; **dia projects the primary lease to CURRENT_DATE via
`dia_project_rent_at_date`**, the dia rent doctrine), the resolved owner
(`COALESCE(true,recorded)` = who to call), and the distress columns +
`is_distressed` / `distress_reason`. `SECURITY INVOKER` views, `GRANT SELECT` to
anon/authenticated/service_role (names-only, same PII posture as the sibling
`v_*_portfolio` views). gov excludes archived; dia has no status. Value-ranked
`ORDER BY is_distressed DESC, maturity_date ASC, rent DESC NULLS LAST`. Verified
live: gov 154 (12 <=6mo / 10 <=12mo / 84 <=24mo / 48 matured; 103 w/rent, 137
w/owner), dia 18 (16 w/rent, 18 w/owner); top gov = property 14239 USGBF NSF LLC /
Affinius Capital, $24M rent / $123M balance, matures 2027-12.

### Unit 2 — surfaced as a value-ranked BD action (the headline)
- **Decision Center lane** `decision_type='loan_maturity'` (federated — reuses the
  R7/R51/R53 machinery; no schema, free-form type). `api/admin.js`:
  `FEDERATED_DECISION_TYPES` + `federatedSubjectRef` (`loanmat:<dom>:<property_id>`)
  + `fetchFederatedSource` (GET gov+dia `v_loan_maturity_watch`, value-ranked,
  **distressed first** via `rank_value = is_distressed?1e12:0 + annual_rent`) +
  verdict dispatch. Verdicts (effect-first / outcome-truthful): **pursue_refi**
  (refi/advisory outreach research signal on the owner — `research_type
  loan_maturity_refi`), **pursue_disposition** (owner may sell — `loan_maturity_
  disposition`), **research** (`loan_maturity_research`), **not_relevant**
  (record-only → the `lcc_decisions` anti-join stops asking). All outreach
  verdicts spawn a `research_tasks` row via the existing `createResearchTask`
  (a failed write 502s + keeps the decision open). **No domain write — a maturity
  is a BD signal, never a fact** (unlike R53's `confirm_sale`). `ops.js`: lane
  registration + `_DC_FED_META` intro + `_fedCardHTML` card (maturity badge,
  distress badge, owner, balance, the 4 verdict buttons).
- **Property detail + context packet**: `getPropertyGeo` (`action=property_geo`)
  now also fans `v_loan_maturity_watch?property_id=eq.<id>` and returns
  `loan_maturity` (null when not on the watch). `assemblePropertyPacket` adds a
  `loan_maturity` field (MCP/agent layer). `detail.js _udRenderGeoSection`
  renders a **"Loan Maturity — BD trigger"** banner (independent of geocoding —
  shows even on ungeocoded / no-comp subjects); `gov.js _govFillGeoSection`
  reuses `_udRenderGeoSection`, so gov detail inherits it.

### Unit 3 — populate the distress flags (the honest finding: case b, no writer fix)
Investigated the Round-76ek CMBS loan pipeline end to end. **The writer is already
correct.** `extension/content/costar.js parseCmbsLoanDetail` captures the distress
flags from CoStar's CMBS "Performance" section (`num_delinquent` / `special_
servicing` / `watchlist` / `modification`) and "Contacts" section (`servicer` /
`special_servicer`); `sidebar-pipeline.js upsertLoanRecords` maps **every** one of
them into `loans` (through the `field_source_priority` gate). DSCR is captured onto
the loan **SNAPSHOT** (`snapshot.noi_dscr` → `loan_snapshots`), NOT `loans.dscr` —
correctly, since DSCR is a point-in-time snapshot metric. Live state: gov
`watchlist`=0, `special_servicing`=0, `num_delinquent`=0, `dscr`=0;
`special_servicer`=110 (but that is **deal metadata** — every CMBS loan carries a
designated special servicer at securitization, performing or not, so the view
deliberately does NOT treat a bare special_servicer name as distress);
`loan_snapshots`=**0 rows** (so DSCR is unavailable anywhere). Conclusion: **the
source rows we have don't carry the Performance-section distress data** (the
captures so far are the basic loan layout, not the full CMBS Performance/snapshot
walk) — case (b), documented, **nothing fabricated and no writer change**. When
richer CMBS Performance captures land, the flags persist (writer, already wired)
AND the watch's `is_distressed` ranks them at the TOP of the lane (view, already
wired). So `is_distressed` is FALSE for every current row today — the honest
state.

### Unit 4 — maturity/leverage grade-factor: DEFERRED (gated, R49 pattern)
Not built — per the round scope the BD trigger is the value; a maturity/leverage
signal in the score is a gated R49-style follow-up.

### Verified (headless + live read-only 2026-06-20)
Views applied live to gov + dia; counts/owner-resolution/sign all confirmed (gov
154, dia 18; matured `months_to_maturity` negative; top gov USGBF NSF LLC $24M,
top dia MARKDEY DV LA MIRADA / DaVita matured). Lane source query (exact federated
column set + ordering) resolves on both DBs. Verdict round-trip at the DB layer
(`lcc_open_decision('loan_maturity', subject 'loanmat:gov:14239') →
lcc_record_decision_verdict('pursue_refi','decided') → delete`) — **0 residue**.
`test/property-context-packet.test.mjs` +2 (packet surfaces `loan_maturity` when
the watch returns a row; null when absent — no throw). `node --check` clean
(admin.js, operations.js, ops.js, detail.js, gov.js); `ls api/*.js | wc -l`=12;
full suite **1140 pass / 0 fail / 6 skipped**.

### Follow-ups (NOT in R54)
The grade-factor (Unit 4, gated); richer CMBS Performance/snapshot captures to
populate the distress flags (writer + view already ready); a cron that seeds the
top maturity-watch rows as decisions (kept list-federated / mint-at-verdict for
now, anti-bloat).

## UW#2 — activate the lease-document extractor (Scott's blessing, 2026-06-20)

From the underwriting data-quality audit: the lease ECONOMICS that aren't in a
public feed (escalation %, guarantor, renewal terms, expiration, expense
structure) live in the lease PDFs we already hold in SharePoint. The Stage B
lease extractor was BUILT and PAUSED ("Widen — still PAUSED"). Scott blessed the
widen. This round is the **disciplined activation** (capped → gate → drain), NOT
new build — every artifact was already merged (Stage B Unit 1 + the
location-agreement / draft-document guards). **The code is complete and wired;
activation is operational** (an env flag + a capped→broad drain via the live
Railway endpoint + SharePoint Get flow + the extraction AI), so the durable
deliverable here is the grounded gate evidence + the runbook, not a code diff.

### What is already wired (verified, no change needed)
- **Auto-route (steady-state):** `folder-feed.js` routes an in-domain
  (`subject_hint.vertical` dia/gov) `detected_type='lease'` doc in **enrich mode**
  through `attachLeaseDoc` (extract → resolve → enrich), gated on
  **`FOLDER_FEED_LEASE_EXTRACT='true'`** (global) or a per-folder `?lease_extract=1`
  override (the find_contacts_by_account rollout pattern). Out-of-domain leases
  (no dia/gov cue) keep the light-attach/CRE path — no AI wasted on the
  office/retail book.
- **Corpus drainer:** `?_route=lease-backfill` (sub-route of intake.js — still 12
  api/*.js). **GET = dry-run** (lists the eligible queue, no byte/AI),
  **POST = drain** (capped `?limit`, default 15 / hard cap 50). Idempotent by a
  `subject_hint.lease_backfilled_at` marker; dead-letters transient failures at
  `LEASE_BACKFILL_MAX_ATTEMPTS=3`.
- **The `property_financials` #64 leg** is part of the widen and wired
  (`insertPropertyFinancials` in `buildRealLeaseDeps`): the lease expense schedule
  → `property_financials` rows stamped `is_actual=false`, `noi=null`,
  `source='folder_feed_lease'` — so the gov cap-rate provenance ladder
  (`resolveCapRateProvenance` Tier 2, which requires `is_actual=true AND noi NOT
  NULL`) **structurally cannot consume them**. Boundary intact.
- **All four guards hold at the shared `attachLeaseDoc` choke point**:
  multi-tenant/portfolio deal-folder, draft/unexecuted (`/Drafts/` segment +
  blackline/redline/draft/vN filename), location-agreement (folder-anchor
  city/state vs property → `location_mismatch` → match_disambiguation), and
  operator-family. Plus fill-blanks-only (true-fill against the live column, not
  the provenance decision), one-active-lease dedupe, provenance
  `source='folder_feed_lease'` (lease-economics fields `enforce_mode='warn'` →
  conflicts to the Decision Center, never a clobber).

### Gate receipts (grounded live, read-only, 2026-06-20)
- **Code health:** `node --check` clean (lease-extractor / lease-backfill /
  folder-feed); `ls api/*.js | wc -l`=12; `test/lease-extractor.test.mjs` +
  `test/lease-location-draft-guard.test.mjs` **75 pass / 0 fail**.
- **Registry readiness (LCC Opps):** 40 `field_source_priority` rows for
  `source='folder_feed_lease'` (priority 45) — lease-economics fields `warn`,
  TI/financials/property_documents `record_only`. `v_field_provenance_unranked`
  coverage complete (no drift).
- **Prior corpus drain already ran — 298 docs** (`folder_feed_seen.detected_type=
  'lease'`, `lease_backfilled_at` set), outcomes: **88 enriched** (151 fields
  filled, **314 conflicts routed to the Decision Center — 0 clobbers**, 7 leases
  created), **160 `needs_ocr`**, 37 `ambiguous`, 6 `draft_not_executed`, 5
  `enrich_create_rejected`, 2 `error_dead_letter`. **0 wrong-property / HQ / draft
  writes.**
- **Guards validated live:** the 8 location-guard held docs (Stage B location
  round Unit 3) re-drained exactly as predicted — **6374/7004 → `ambiguous`**
  (the FL/Gardena memoranda → `location_mismatch` → match_disambiguation, never a
  write to the CO HQ) and **19517/19522/19524/19526/19530/19541 →
  `draft_not_executed`** (the Federal Way `…/PSA/Drafts/` redline/blackline files
  → no phantom lease on 3353605).
- **Remaining eligible queue (the next capped batch): 62** (dia 58, gov 4) —
  real DaVita/GSA lease agreements + estoppels + amendments with city/state
  anchors (Tallahassee, Somerset, Weslaco, Oshkosh, Gladstone, Modesto, Corpus
  Christi, Florence, …). These are new/late arrivals captured under the light
  path; idempotent to re-run.

### The honest ceiling (report, don't fake)
The extractor needs a **text layer**. **160 of 298 (54%) of executed leases are
scanned image-only PDFs → `needs_ocr` → 0 fields filled.** So the widen — even
fully drained — lifts dia escalation/guarantor/renewal off the floor only for the
text-bearing minority; the scanned tail stays blank until an OCR pass lands. The
floor numbers in the audit (dia escalation 2%, guarantor 5%, renewal 15%) will
improve, but the structural lift is gated on OCR, not on the extractor. This is a
known, surfaced limitation — `needs_ocr` is recorded terminal with `text_len`, so
the OCR follow-up is sized and queued.

### Activation runbook (operational — live Railway endpoint, NOT runnable from the
### remote sandbox; handed to Scott)
1. **Capped DRY-RUN** (safe, no writes): `GET /api/lease-backfill?limit=25` —
   confirms the eligible queue (≈62) and the sample. (The DB-side equivalent was
   produced above as the gate receipt.)
2. **Capped REAL drain on a small batch:** `POST /api/lease-backfill?limit=25` —
   requires `SHAREPOINT_FETCH_URL` configured + the extraction AI. Read the
   response receipts: `enriched` / `fields_filled_total` / `conflicts_total` /
   `leases_created` / `guaranteed_by_edges`, and the terminal buckets
   (`needs_ocr` / `ambiguous` / `draft_not_executed`). Gate = fields filled from
   real PDFs, leases created where absent **without orphaning a guarantor**, every
   guard held (0 wrong-property / HQ / draft writes), provenance written,
   idempotent.
3. **Broad drain:** repeat `POST …?limit=50` until the queue drains (the cap +
   dead-letter prevent head-of-line block; re-runs are idempotent).
4. **Steady-state auto-route:** set **`FOLDER_FEED_LEASE_EXTRACT='true'`** in the
   Railway env so the enrich crawl (`lcc-folder-feed-crawl`, mode=enrich) enriches
   NEW in-domain lease docs on arrival. Do this AFTER the capped real drain gate
   passes (the per-folder `?lease_extract=1` override exists for a single-folder
   first drain before the global flip).

### Boundaries
Fill-blanks only; provenance-gated (conflicts → Decision Center, never a
clobber); reversible; ≤12 api/*.js; no fabrication (a field the doc doesn't state
stays blank); dia/gov pipelines otherwise untouched. No new migration (registry +
guards already applied). No env flag flipped in code (the gate is Scott's
operational switch, by design).

## R58 — OCR/text foundation + wire the orphaned deed parser (read the docs we hold) (2026-06-20)

The document layer was a filing cabinet: 1,975 `property_documents` filed but only
OMs deeply extracted. raw_text empty on deed/lease/other (`url_captured` = filed,
unread). The deed parser (`api/_handlers/deed-parser.js`
`parseDeedText`/`crossReferenceDeed`/`processDeedDocument`) was BUILT but had ZERO
callers — and grounding showed it was ALSO schema-stale (written against an
assumed CA-style schema that matched NEITHER live DB). Root blocker: nothing OCR'd
the PDFs we already hold (OCR lived only in the OM intake pipeline). R58 adds the
shared text/OCR foundation, wires the deed parser into R51, and clears the lease
OCR tail. **Code complete + headless-verified + live schema-gated (0 residue); the
live OCR/CDN drain is operational (env + endpoint), handed to Scott like UW#2 —
the remote sandbox has no OpenAI key / CoStar-CDN reach.**

### Grounding (live 2026-06-20) — refuted the audit's schema premise
- dia + gov `property_documents`: PK `document_id`, cols `raw_text`,
  `ingestion_status`, `extracted_data` (jsonb) — **no `metadata` column** (the
  orphaned parser's `metadata` + `id` PATCH was a silent no-op on both).
- Deeds: dia 158 + gov 159 = ~317, ALL empty raw_text. `source_url` is a **CoStar
  CDN** download (`ahprd1cdn.csgpimgs.com/…`), NOT a SharePoint ref — so the byte
  fetch must support direct https, not only the PA Get flow.
- `sales_transactions`: PK `sale_id` (dia int / gov uuid), keyed on `property_id`;
  **no `id`, no `data_confidence`** on either; gov has no `notes` (the parser used
  all four). `recorded_owners` name col is `name` (parser used `owner_name`);
  gov `properties` has **no `recorded_owner_name`** (joins `recorded_owners`),
  parser's `select=recorded_owner_name` 400'd on gov. gov `deed_records` keys on
  `parcel_id` uuid + requires `county`/`state_code` NOT NULL (deed PK gov
  `deed_id` / dia `id`); dia `deed_records` has a `data_hash` min-len CHECK + a FK
  to `properties`.
- R51's `v_owner_source_conflict` reads `properties.latest_deed_grantee` /
  `latest_deed_date` (present on BOTH) — NOT `deed_records`. So "feed R51" =
  update those property columns.

### Unit 1 — shared document-text/OCR foundation (`api/_shared/document-text.js`)
`extractDocumentText({sourceUrl, storageRef, mediaType, allowOcr}, deps)` (pure,
deps-injected): fetch bytes (URL-shape aware — absolute https → direct fetch for
CoStar CDN deeds; server-relative ref → `fetchSharepointBytes`) → digital text via
`pdf-parse` (the `createRequire` ESM dodge) → **OCR fallback on a zero-text PDF via
`invokeVisionExtractionAI`** (the SAME gpt-4o vision that rescued the Fresenius OM,
re-prompted to transcribe VERBATIM, not extract JSON), gated on `OPENAI_API_KEY` +
`INTAKE_OCR_MAX_BYTES` (~12 MB). Returns `{method:'pdf_text'|'ocr'|'text_decode',
text_len}` or a truthful terminal `needs_ocr` (distinct from a transient
`ok:false` fetch failure). No writes — callers persist `raw_text`.

### Unit 1 + 2 — the worker (`api/_handlers/document-text.js`, sub-route of intake.js)
`?_route=document-text-tick` (rewritten `/api/document-text-tick`). GET=dry-run /
POST=drain, capped (`?limit`, default 15 / hard cap 50) + wall-clock budgeted,
`?domain=both&doctype=deed` default. Selects `property_documents` with NULL
raw_text (idempotent — a filled row drops out), writes `raw_text` +
`ingestion_status` (`text_extracted` / `needs_ocr`); for deed docs runs
`processDeedDocument`. Value-rank NOTE: ordered `document_id DESC` (recency proxy —
docs carry no rent and a clean cross-domain rent join is heavier than the OCR it
would prioritize; the cap+repeat-tick model drains the whole set). Cron
`lcc-document-text` (`*/30`, migration `20260620170000`) — gentle (artifact-offload
lesson); endpoint 404s until deploy (GET dry-run to verify, lcc-folder-feed
posture).

### Unit 2 — wire the deed parser, SCHEMA-CORRECT + R51 feed (`deed-parser.js`)
Reworked `crossReferenceDeed` + `processDeedDocument` (deps-injectable):
- **property_documents** → `extracted_data` (not `metadata`) keyed by
  `document_id` (was a silent no-op).
- **deed_records** archival insert — per-domain PK/cols (dia `id`/`property_id`/
  `state`; gov `deed_id`/`state_code`, no property link). gov requires
  `county`+`state_code` NOT NULL → new **county extraction** in `parseDeedText`
  (deeds reliably name their county); gov insert is SKIPPED (not 400'd) when
  county+state are absent — the R51 feed + extracted_data (the BD value) still run.
- **FEED R51** — `processDeedDocument` writes the grantee to
  `properties.latest_deed_grantee`/`_date` (fill-blanks or NEWER only, never
  clobbers a more-recent recorded grantee, `granteeIsPlausible` guard), so the
  existing `v_owner_source_conflict` + `owner-deed-autofix` lane (R51) pick it up.
- **sales cross-ref** keyed on `property_id` (both); a price match records the
  verification (`upgradedTransactions` — there's NO `data_confidence` column, so
  "deed_verified" lives in `extracted_data` + the count). Implied price (transfer-
  tax estimate) supplied as a CANDIDATE on a NULL-price matching sale ONLY when
  `DEED_IMPLIED_PRICE_FILL` is on (env-gated, fill-blanks `sold_price=is.null`
  guard) — a curated price is NEVER overwritten (R51/R53 gated-write doctrine).
  owner cross-check resolves `recorded_owner_id`→`recorded_owners.name` (works on
  both; gov has no denormalized name).

### Unit 3 — clear the lease OCR tail (`lease-extractor.js`)
`runLeaseExtraction` now, on a zero-text (scanned) lease PDF, runs the SAME
`ocrPdfToText` foundation before parking `needs_ocr` (UW#2's 160/298 scanned
tail). Gated on `OPENAI_API_KEY` (helper 503s without it → exact prior graceful
`needs_ocr`, deploy-order-safe) + `LEASE_EXTRACT_OCR` (default on). `source` →
`ai_ocr` when OCR fed the prompt. No new route — the existing `lease-backfill`
drains the tail once OCR is available.

### Unit 4 — rent-roll + dd/bov (DEFERRED, document-only)
The `raw_text` foundation supports them (a rent-roll extractor: tenant/SF/rent/
expiration per suite → lease economics + NOI; dd/bov parsing). NOT built this
round — the foundation is confirmed sufficient.

### Verified
- `test/document-text.test.mjs` (8: url-shape, pdf_text, OCR fallback, needs_ocr,
  allowOcr=false, fetch-fail transient, text_decode, fetchDocBytes routing) +
  `test/deed-parser.test.mjs` (9: parse grantor/grantee/CA-implied-price/county/
  non-CA-no-price; extracted_data-not-metadata; per-domain dedup PK; R51 fill-
  blanks feed; R51 never-clobber-newer; sale verify; gated price fill ON/OFF;
  no-meaningful-parse → no writes). `node --check` clean; full suite **1162 pass /
  0 fail / 6 skipped**; `ls api/*.js | wc -l`=12; vercel.json valid.
- **Live schema gate (0 residue):** gov `deed_records` insert (exact write shape)
  → ok → deleted; the R51 round-trip on a synthetic gov property (set
  `latest_deed_grantee` → `v_owner_source_conflict` surfaced it,
  `conflict_kind=deed_newer_stale`, `grantee_passes_guards=true`) → all deleted;
  dia `deed_records` insert (PK `id`, FK + data_hash CHECK satisfied) → ok →
  deleted. All three DBs back to 0 residue.

### Activation runbook (operational — handed to Scott, like UW#2)
1. `GET /api/document-text-tick?doctype=deed&limit=10` — dry-run, lists eligible.
2. `POST /api/document-text-tick?doctype=deed&limit=10` — capped real drain;
   needs `OPENAI_API_KEY` (scanned-deed OCR) + outbound reach to the CoStar CDN.
   Read receipts: `text_extracted`/`deed_parsed`/`needs_ocr`, `deed_records_created`,
   `r51_fed`, `sales_verified`. Confirm grantees flow into the R51
   `owner_source_conflict` lane.
3. Repeat to drain ~317 deeds; the `*/30` cron then maintains coverage.
4. Lease OCR tail: `OPENAI_API_KEY` set → re-`POST /api/lease-backfill` drains the
   160 `needs_ocr` leases (now OCR'd before the lease prompt).
5. Implied-price fill stays a recorded candidate until `DEED_IMPLIED_PRICE_FILL`
   is set (Scott's gate); never overwrites a curated price.

### Boundaries
Fill-blanks / newer-only (never clobber a curated price or a newer grantee);
confirm-gated price write; additive (no domain migration — raw_text/
ingestion_status/extracted_data already exist); ≤12 api/*.js; dia/gov pipelines
otherwise untouched. JS ships on the Railway redeploy; the cron migration applies
on LCC Opps (no-ops until the endpoint ships).

## UW#4b — OCR engine cost optimization (lease path only) (2026-06-21)

Follow-up to UW#4 (free-first lease OCR). A cost exploration (grounded 2026-06-20)
found gpt-4o vision is the most EXPENSIVE OCR path by 6–14× and purpose-built OCR
is near-free at our volume. UW#4b re-points the **engine economics** of the
lease-OCR tier — same extractor, same four guards, same fill-blanks, same
`source='folder_feed_lease'` provenance, same confidence tagging; **only the OCR
engine choices change.** Licenses we already pay for don't help (M365 Copilot has
no batch-OCR API — Microsoft's OCR product is Azure DI, separately metered;
Claude/ChatGPT chat seats can't batch through the API). Corpus ≈ 860 scanned
leases / 15k–35k pages, one-time.

### Scope guard (the critical boundary)
`ocrPdfToTextTiered` is called ONLY by `lease-extractor.js`. **R58's other OCR
paths (deeds) call `ocrPdfToText` directly and are UNTOUCHED** — UW#4b does not
regress R58. ≤12 api/*.js; no migration (confidence/tier ride existing jsonb); no
new always-on server dependency (OSS engine in the workstation drainer; cheap
cloud is a config'd HTTP seam).

### Unit 1 — free tier = the workhorse, upgraded (`scripts/lease-ocr-backfill.mjs`)
Default engine is now **`auto`**, which prefers a purpose-built OCR engine
(**Surya → PaddleOCR** — markedly better on the rent-schedule / exhibit TABLES in
NNN leases, still $0) and FALLS BACK to **ocrmypdf → Tesseract** when the better
engine isn't installed (`resolveEngine` cascade by `binaryAvailable`). New engine
runners `suryaOcr` / `paddleOcr` + the version-tolerant pure parsers
`textAndConfFromSuryaJson` / `textAndConfFromPaddleJson` (per-line text + 0-1→0-100
confidence; defensive against CLI shape drift). `--engine`/`--ocr-cmd` pin a
version-specific invocation. Existing Tesseract/ocrmypdf paths extracted into
`tesseractOcr`/`ocrmypdfOcr` helpers (byte-identical).

### Unit 2 — cheap cloud as the escalation, NOT gpt-4o (`document-text.js`)
The paid escalation order in `ocrPdfToTextTiered` is now: free →
**`cloud_cheap`** (Google Document AI / Azure DI Read, ~$1.50/1k pp, the PREFERRED
paid tier) → **gpt-4o vision LAST RESORT, explicit opt-in only**. New
`ocrCloudCheap({buffer,mediaType,fetchImpl})` POSTs base64 to `OCR_CLOUD_OCR_URL`
(a thin Doc AI / Azure DI flow — the SHAREPOINT_FETCH_URL webhook-adapter pattern,
zero new SDK) and reads back `{text, confidence?}`. **Default = ZERO SPEND,
free-only:** with no cheap provider configured AND no gpt-4o last-resort flag the
paid tiers are inert (a server free miss → `needs_ocr`; the corpus drains via the
workstation free OCR). Env: `OCR_CLOUD_ESCALATION` (master kill-switch, default
on), `OCR_CLOUD_PROVIDER` (`google_docai`/`azure_di`/`webhook` via the URL, or
`gpt4o`), `OCR_CLOUD_OCR_URL`(+`OCR_CLOUD_OCR_KEY`), `OCR_CLOUD_GPT4O_LASTRESORT`.
Google's $300 new-account credit covers the whole backfill at ~$0.

### Unit 3 — measure to size the spend
The drainer summary now prints the **free-tier hit RATE** (free OK / OCR-attempted)
so a capped gate batch reveals the paid escalation volume before any broad drain —
if the OSS engine clears most leases, the paid tail is trivial; if not, Doc AI at
~$30 (or $0 under the credit) covers the rest.

### Verified (headless 2026-06-21)
`test/document-text.test.mjs` UW#4 tiered block rewritten for UW#4b (cheap-cloud
preferred; gpt-4o reached ONLY behind the explicit flag; default zero-spend;
`ocrCloudCheap` webhook seam) + `test/lease-ocr-backfill.test.mjs` (+Surya/Paddle
parser cases). `node --check` clean (document-text, lease-extractor,
lease-ocr-backfill); `ls api/*.js | wc -l`=12; full suite 1193 pass / 0 fail / 6
skipped. JS ships on the Railway redeploy. Doc: `docs/UW4_LEASE_OCR.md` (cost
table, engine install notes, cheap-cloud config + Google $300-credit path).

## UW#4c — wire Google Document AI as the cheap-cloud OCR (2026-06-21)

Realizes the cheap-cloud seam UW#4b left unwired (built the tier, no creds).
Decision (Scott): Document AI is at-least-equal quality to gpt-4o for typed/
printed scanned deeds + leases and ~20–60× cheaper (~$1.50/1k pages; $0 under
Google's $300 new-account credit), so it's the cheap-cloud PRIMARY; gpt-4o stays
the gated last resort for the hard tail (handwriting / poor scans). **Reuse the
existing tiered seam — no routing-logic change.** ≤12 api/*.js (the wrapper is a
Supabase Edge Function, NOT a new api/*.js). JS ships on the Railway redeploy;
the wrapper deploys to the LCC Opps Supabase project.

### The wrapper — `supabase/functions/docai-ocr/index.ts`
Thin Document AI HTTP wrapper (the SHAREPOINT_FETCH_URL webhook pattern):
`POST { content_base64, mime_type? | media_type? }` → mint a short-lived GCP
OAuth2 access token from a server-side service-account key (RS256 JWT via Web
Crypto, cached in-process until ~1 min before expiry) → call the **Enterprise
Document OCR** processor (`documents:process`) → return `{ ok, text, confidence,
pages, engine:'google_docai' }` — the exact shape `ocrCloudCheap` already reads.
Tolerant of both `mime_type` (documented) and `media_type` (what the seam sends).
`GET` = health probe (`{ready, configured, missing}`, no GCP call / no spend).
Auth mirrors `_shared/auth.ts` (Bearer `DOCAI_SHARED_SECRET`/`OCR_CLOUD_OCR_KEY`/
`LCC_API_KEY`, or X-LCC-Key; transitional-open + warn when unset). Confidence =
mean Document AI token (→block→line) layout confidence × 100, else null. Per-
request cost guards: `DOCAI_MAX_PAGES` (15 — the sync processor cap) /
`DOCAI_MAX_BYTES` (20 MB); `PAGE_LIMIT_EXCEEDED` → `over_page_cap` so the seam
falls through to gpt-4o.

### Point the seam at it (Railway env, no code change to routing)
`OCR_CLOUD_OCR_URL=https://<ops-ref>.supabase.co/functions/v1/docai-ocr`,
`OCR_CLOUD_PROVIDER=google_docai`, `OCR_CLOUD_OCR_KEY`==the wrapper's
`DOCAI_SHARED_SECRET`. Wrapper secrets: `GOOGLE_DOCAI_SA_KEY` (SA JSON),
`GOOGLE_DOCAI_PROCESSOR` (full resource name) or
`GOOGLE_DOCAI_PROJECT_ID`/`_LOCATION`/`_PROCESSOR_ID`. Tiering UNCHANGED: free
OSS (workstation) → Document AI (cheap cloud) → gpt-4o ONLY on a Document AI miss
(`OCR_CLOUD_GPT4O_LASTRESORT`); `OCR_CLOUD_ESCALATION='false'` kills all paid OCR.
**Lights up deeds too:** the R58 `document-text-tick` worker already runs
`extractDocumentText(..., ocrTiered:true)` (UW#6), so scanned deeds route through
the SAME seam → Document AI once configured. R58's `ocrPdfToText`-direct path
(other deed callers) stays gpt-4o — **only the tiered seam's cheap-cloud provider
was filled in** (UW#4b scope guard holds).

### Per-page cost observability (Document AI bills per page)
The wrapper returns `pages`; threaded `ocrCloudCheap.pages` →
`ocrPdfToTextTiered.pages` → `extractDocumentText.ocr_pages` / lease-extractor
`ocr_pages`/`ocr_engine` → both drain workers. `lease-backfill` +
`document-text-tick` responses carry `ocr_pages_total` + `ocr_by_engine`
(`{google_docai:N}`); each tick that ran cloud OCR logs `[…] OCR cost: <N> pages
{…}`. A capped gate batch shows the Document AI page count BEFORE any broad drain.
`ocrCloudCheap` now also honors a wrapper `{ok:false,reason}` (e.g.
`over_page_cap`) so the structured failure falls through to the last resort.

### Verified (headless 2026-06-21)
`test/document-text.test.mjs` (+UW#4c: `ocrPdfToTextTiered` surfaces `pages` on
cloud_cheap; `ocrCloudCheap` reads back `pages` + sends `mime_type`; a wrapper
`{ok:false}` falls through). `node --check` clean (document-text + the two drain
handlers + lease-extractor); `ls api/*.js | wc -l`=12; full suite 1264 pass / 0
fail / 6 skipped. The live deed/lease drain (routes to Document AI, gpt-4o only
on misses, cost log shows pages) is operational — gated on Scott's GCP creds +
the env, handed off like UW#2/R58. Doc: `docs/UW4_LEASE_OCR.md` (UW#4c wrapper +
GCP setup + cost telemetry).

## UW#5 — lease extractor OCRs thin-text scanned PDFs, not just zero-text (2026-06-22)

Document AI is wired + confirmed end-to-end (`ocr_engine: google_docai`, ~95%
conf — El Paso 5566 / Kerrville 6152 OCR'd + enriched real records). But the
lease corpus wouldn't fully reach OCR: `runLeaseExtraction`'s OCR branch only
fired on a COMPLETELY EMPTY text layer (`!text`). Most scanned executed leases
are NOT zero-text — they carry a thin junk layer (recording stamp / page no. /
OCR bleed), so `!text` is false and OCR never ran (live: Walterboro estoppel
2835 → `text_len:143` / `reason:thin_text_layer`, marked `needs_ocr` without ever
calling OCR). The deed path already discards a sub-floor PDF text layer before
its OCR decision (`document-text.js::extractDocumentText`, `meaningfulTextLen <
DOC_TEXT_MIN_CHARS`); the lease path now uses the SAME floor.

### Unit 1 — the surgical fix (`api/_handlers/lease-extractor.js`)
After `leaseTextFromBytes` and BEFORE the existing OCR gate, `runLeaseExtraction`
discards a sub-floor PDF text layer so the OCR branch runs and the junk NEVER
reaches the lease prompt: `isPdf && text && floor>0 && meaningfulTextLen(text) <
floor → text=''` (PDF-only — docx/xlsx/text salvage are taken at face value, so a
short legitimate text doc is never force-OCR'd). Reuses the shared
`meaningfulTextLen` + `DOC_TEXT_MIN_CHARS` (now EXPORTED from `document-text.js` —
no duplicated threshold; env knob `LEASE_TEXT_MIN_CHARS`, default 200). The junk
is DISCARDED (set to `''`), never concatenated, so the OCR'd text (or `needs_ocr`)
is what flows on. Everything downstream is unchanged: the tiered OCR call
(Surya/Paddle → Doc AI cheap-cloud → gpt-4o last resort), the four guards
(location / draft / multi-tenant / operator), fill-blanks-only,
`source='folder_feed_lease'` provenance, one-active-lease dedupe, the graceful
`needs_ocr` fallback, and the `ocr_tier`/`ocr_engine`/`ocr_pages` telemetry.
`runLeaseExtraction` gains injectable `textFromBytesImpl`/`ocrTieredImpl` deps
(default to the module fns — the codebase's deps-first testability pattern); the
two production callers are unchanged.

### Unit 2 — re-process the parked backlog (versioned reparse, R58c pattern)
The previously-parked `thin_text_layer` leases carry the terminal
`lease_backfilled_at` marker, so the eligible queue excludes them. New
`?_route=lease-backfill&mode=reparse` (GET dry-run / POST drain) selects via
`fetchThinTextReparseDocs` — rows with `lease_backfill.reason='thin_text_layer'`
NOT yet at the current `reparse_version` (`THIN_TEXT_REPARSE_VERSION='uw5'`) — and
re-runs the SAME `attachLeaseDoc` machinery (now with the discard + server OCR). A
re-run either ENRICHES (reason changes → drops out) or, for a genuinely near-blank
scan that OCRs back to still-thin text, is re-marked at version `uw5` and excluded
going forward — the R58c never-re-hammer guard (`markBackfilled` stamps
`reparse_version` on every terminal mark in reparse mode). No migration (marker
rides existing `subject_hint` jsonb); no new api/*.js (sub-route of intake.js).

### Verified (headless 2026-06-22)
`test/lease-extractor.test.mjs` 75 → 80 (UW#5: thin PDF junk discarded → routed to
OCR, junk never sent to the AI; OCR-success text feeds the prompt; >floor PDF text
used directly, OCR never called; short non-PDF docx/text NOT force-OCR'd; true
zero-text PDF still OCRs — no regression). `node --check` clean (lease-extractor,
lease-backfill, document-text); `ls api/*.js | wc -l`=12; full suite **1287 pass /
0 fail / 6 skipped**. JS ships on the Railway redeploy; no migration.

### After deploy (operational, handed to Scott)
A capped `POST /api/lease-backfill?mode=reparse&limit=25` over the re-included
`thin_text_layer` set should flip those leases from `thin_text_layer` → `enriched`
with `ocr_engine: google_docai` (fills lease fields / routes conflicts to the
Decision Center), exactly like the El Paso memorandum. Needs `SHAREPOINT_FETCH_URL`
+ the configured Document AI seam (`OCR_CLOUD_*`).

## R59 — propagate document-extraction into the BD spine (deed/lease) (2026-06-22)

The OCR unlock (UW#4c/UW#5 + R58c) yields rich structured deed/lease data at
scale, but the extraction LANDED without UPDATING the rest of the system.
Grounded live on the real $13.3M transfer (deed doc 3964 → dia property 24703,
grantor Oldsmar Retail Development LLC → grantee Deltona Wellness, LP, 2020-01-21):
sale 14751 had buyer_name/seller_name NULL, property 24703 had 0 ownership_history
rows, no prospect for the new owner, no research prompt. R59 closes those gaps —
additive / fill-blanks / append-only / reversible / gated, reusing R5/R6/R51/R53
machinery. All four units hang off the SAME confident deed→sale/property match
already resolved inside `processDeedDocument` (`deed-parser.js` Step 6). ≤12
api/*.js; JS ships on the Railway redeploy; no migration.

### Grounding that shaped the design (live 2026-06-22)
- **Party columns DIFFER by domain:** dia `sales_transactions.buyer_name`/
  `seller_name`; gov `buyer`/`seller`. **ownership_history schemas DIFFER:** dia
  `ownership_start`/`sold_price`/`acquisition_method`, bigint sale_id, PK `id`; gov
  `transfer_date`/`change_type`/`data_source`, uuid sale_id, PK `ownership_id`
  (auto uuid). gov `change_type='deed'` already exists, no CHECK on the table.
- **dia `ownership_history.ownership_id`** is integer NOT NULL with **no default
  and no trigger** in information_schema, BUT a bare insert auto-fills it (verified
  live) — so the writer NEVER supplies it (mirrors the sidebar writer).
- **The 2% price-match is too tight.** Deed consideration $13.33M vs recorded sale
  $13.70M = 2.7% (closing-cost/doc-stamp rounding), but the dates are 5 days
  apart. So Unit 1's "confident sale" = price-matched **OR** date-proximate
  (`saleCandidate.sale_date` within 18mo of the deed date). `crossReferenceDeed`'s
  `saleCandidate` now carries `sale_date` + `price_matched`.
- **A seeded `suspected_sale` decision is INVISIBLE** — that lane lists ONLY from
  gov `v_suspected_sale`. So gov owner-conflicting deeds surface via the EXISTING
  Step-4 R51 `latest_deed_grantee` feed → `v_suspected_sale` (no new code); the
  universally-visible Unit-2 producer is a **research task** (both domains).

### What shipped (all gated on optional deps → R58 behavior byte-identical)
`processDeedDocument` Step 6 `propagateDeedToBd(...)` (deed-parser.js); the worker
`document-text.js` injects the production deps in `PROD_DEPS` (so the deed Units
light up live; absent-dep unit tests keep the exact pre-R59 deed flow). New shared
producer **`api/_shared/research-task.js openResearchTask()`** — idempotent on the
live partial unique index `uq_research_tasks_open_source(source_table,
source_record_id, research_type, domain)` (pre-check + 409-tolerant), workspace
resolved (oldest). New exported `resolveDeedRecordedOwner()` on sidebar-pipeline.js
(thin wrapper over the R51 `resolveOrCreateRecordedOwnerForDeed`).

- **Unit 1(a)** — on a confident sale match, fill the sale's parties from
  grantee→buyer / grantor→seller, **fill-blanks** (per-column `=is.null` guard,
  per-domain columns), each run through `granteePassesOwnerGuards` (rejects
  brokerage/federal/junk; works for grantor too — NOT `isImplausiblePersonName`
  which rejects every LLC).
- **Unit 1(b)** — append ONE `ownership_history` event (recorded deed = canonical
  transfer). Resolve/create the grantee's recorded_owner (R51 resolver), per-domain
  row shape, `change_type/acquisition_method='deed'`, `data_source/ownership_source=
  'deed_extraction'`, `ownership_state='active'`, sale_id linked only when the
  matched sale's PK type fits the domain column (uuid gov / int dia). Idempotent —
  dedup on (property_id, recorded_owner_id, date). **NEVER** writes
  `properties.recorded_owner_id`/`true_owner_id` (that stays R51/R47-gated).
- **Unit 2** — a deed with consideration ($price) + date but NO confident sale →
  `confirm_deed_transfer_sale` research task (idempotent on property). Never writes
  a sales row (a suspected sale is a LEAD; gov also flows the owner-conflict subset
  into `v_suspected_sale` via the R51 feed).
- **Unit 3** — grantee → BD entity via `ensureEntityLink` (domain dia/gov,
  sourceType `true_owner`, name-dedup; the junk/implausible/federal guards apply) +
  an `owns` edge owner→asset (asset resolved `resolveOnly` — never invents an
  asset; dupe-guarded). **NEVER opens an opportunity** (the R5 BEFORE-INSERT
  trigger + gate own that; a buyer-SPE grantee gets no prospect opp).
- **Unit 4** — research producers on the ambiguous cases: deed grantee that is a
  private LLC NOT resolving to a known parent (`resolveBuyerParent` → null) →
  `trace_grantee_to_parent`; (lease, `lease-extractor.js applyLeaseEnrichment`,
  gated on `openResearchTask`/`getPropertyTenant` deps) extracted tenant ≠ the
  property's recorded tenant → `confirm_tenant_mismatch` (dia only — gov "tenant"
  is the agency); an extracted guarantor that didn't resolve to an entity (and
  wasn't a withheld contamination) → `resolve_lease_guarantor`. Each idempotent on
  (research_type, property_id); none fires when the fact resolves cleanly.

### Verified (headless + live schema-gate, 0 residue) 2026-06-22
`test/deed-parser.test.mjs` 19 → **29** (Unit 1a per-domain party fill on a
date-proximate sale; 1b OH append + dedup + no-`ownership_id`; Unit 2 research
task + no sale write; Unit 3 mint+owns-edge + no-opp + asset-not-resolved → no
edge; Unit 4 trace task on/off; broker grantee writes nothing), `test/lease-
extractor.test.mjs` 80 → **84** (tenant-mismatch on/off, guarantor-unresolved,
byte-identical when the dep is absent), new `test/research-task.test.mjs` (4:
create / idempotent-open / 409-race / missing-input). **Live schema gate** — the
exact dia (24703/sale 14751) + gov Unit-1 writes exercised in self-rolling-back
DO blocks on the real DBs: dia buyer/seller guards matched (`buyer_patched=1`), OH
appended (ownership_id auto-filled 22316); gov shapes valid, `buyer_patched=0` (the
fill-blanks guard correctly did NOT overwrite an existing buyer). **0 residue on
both DBs** (sale 14751 buyer still NULL). `node --check` clean (research-task,
deed-parser, document-text, sidebar-pipeline, lease-extractor); `ls api/*.js | wc
-l`=12.

### Reversibility / boundaries
Every write is fill-blanks / append-only / identity-link. Revert: null the filled
`buyer_name`/`seller_name`/`buyer`/`seller`; delete `ownership_history` rows
`WHERE data_source='deed_extraction'` (gov) / `ownership_source='deed_extraction'`
(dia); the Unit-3 entity+edge and the research_tasks are deletable. No domain
migration (all columns pre-exist); dia/gov pipelines otherwise untouched; auth
schema untouched.

### Follow-ups (NOT in R59)
Connecting each historical chain owner (entity-link) is the existing R6 phase-3(c)
machinery; a dia suspected-sale lane (R53 is gov-only — dia uses the research
task); premises-address-preference at extraction time (R58c folder-anchor guard is
the current safety net).

## R60 — stop the research-task backlog runaway (value-gate the chain producers) (2026-06-22)

Grounded live 2026-06-22 (Today-page audit): **5,447 queued `research_tasks`**,
growing ~16× faster than worked (+4,061/7d vs 254 closed). Two producers fired
into a void — **63% of the queue**:
`establish_ownership_history` (2,192; gov 2,145 / dia 47 — **no consumer**) +
`trace_ownership_to_developer` (1,252; gov 764 / dia 488 — consumer clears ~5%).
Both come from the R46/R6 `lcc_generate_chain_research_tasks`, which seeds ONE
task per incomplete chain (gov 2,987) regardless of value or resolvability.
**Grounding refined the audit premise:** ALL 3,444 flood tasks are genuinely
still-incomplete chains, so the existing chain-complete sweep closes **0** of
them (none have resolved); the `trace` consumer's UW#7 cron already existed
(gov daily) — the "0 completed" is the endpoint not being deployed, not a missing
cron. Doctrine: a research task is only worklist if it is ACTIONABLE high-value.

### Unit 3 + Unit 2 (the headline) — value-gate the producer + bulk-close (DB, applied live)
Migration `20260622120000_lcc_r60_research_task_flood_control.sql` rewrites
`lcc_generate_chain_research_tasks(p_limit int, p_min_value numeric DEFAULT 500000)`
— `p_min_value` ($500k/yr rent) is the single tuning knob:
- **Sweep A [Unit 2A]** (existing, retained) — close open chain tasks no longer in
  `v_ownership_chain_worklist` (chain completed / gap changed). This is the
  "property now has ownership_history → portfolio mirror grows owner_links → gap
  clears → close" path (R59 deed propagation feeds the mirror; the LCC sweep can't
  read domain ownership_history cross-DB, so it closes via the chain-completeness
  view).
- **Sweep B [Unit 3 value-gate / Unit 2 bulk-close]** (NEW) — close open chain
  tasks whose live worklist `rank_value` < floor → `skipped`, reason
  `below_value_floor`. Reversible; never re-seeded (the seed also gates on the floor).
- **Seed** (existing, gated) — only above-floor incomplete chains, value-ranked;
  EXCLUDES properties carrying an OPEN task (idempotent) OR a consumer-judged
  TERMINAL skip (`outcome.terminal='true'`) so a structurally-unresolvable chain is
  never re-seeded (no churn).
- Producer cron re-registered with the explicit floor; consumer cron
  `lcc-uw7-developer-chain` bumped to every 6h / limit 50 (gentle — artifact-offload
  connection-budget lesson) so resolvable trace tasks complete + unresolvable ones
  close going forward.

**Verified live (applied + run, reversible):** total queued **5,447 → 2,917**
(−2,530); flood **3,444 → 914** — kept exactly the ≥$500k set (gov establish 645,
gov trace 250, dia trace 19; matches `v_ownership_chain_worklist` ge_500k=914),
all below-floor closed `below_value_floor`. **Idempotent** — re-run seeded 0, no
further change. The healthy types (`property_missing_recorded_owner` 841 closed/7d,
`true_owner_needs_salesforce` 334/7d) were untouched.

### Unit 2B (JS, ships on Railway redeploy) — consumer closes the unresolvable
`api/_handlers/developer-chain-resolve.js`: a not-resolved task is now either
**terminal** (close as `skipped` + `outcome.terminal=true` → the producer never
re-seeds it) or **retry** (transient/contingent → keep queued + markAttempted).
New pure `chainResolveDisposition(reason,{externalResearch})`: terminal for
`origin_is_person / origin_not_developer / origin_equals_current / no_chain /
guard_rejected / entity_guard_rejected / already_resolved`; `ambiguous_generic_org`
is terminal ONLY when no external developer-research source is configured (env
`DEVELOPER_CHAIN_EXTERNAL_RESEARCH`); `blocked_by_provenance / write_failed` stay
retryable. So the gov `trace` backlog drains (resolve or close) as the 6h cron
runs post-deploy. Tick summary gains `terminal_closed`.

### Unit 1 — drain the resolvable
The UW#7 consumer cron already existed; R60 re-registers it gentler (every 6h /
limit 50, gov). The live drain (resolvable → completed, unresolvable → terminal
close) is operational on the Railway redeploy (endpoint 404s until then — same
posture as UW#7/R58). The dry-run earlier showed only ~12/250 trace tasks are
internally resolvable; the rest need external research and now terminal-close
instead of queuing forever.

### Grounded scope decision — dia developer-resolution consumer DEFERRED
The audit asked to "add the dia leg" (488 dia trace). But value-gating drops dia
establish 47→0 and dia trace 488→**19**, and dia has no gov-style
`v_developer_chain_candidate` view (thin developer signal — operators dominate dia
true_owners, R8). A full dia resolution-consumer is not warranted for 19 tasks; the
19 ride the same value-ranked worklist and auto-close via Sweep A as their chains
complete. Documented follow-up, consistent with the existing gov-only consumer.

### Verified (headless 2026-06-22)
`test/developer-chain-resolve.test.mjs` 19 → 24 (R60 `chainResolveDisposition`:
terminal vs retry buckets; ambiguous gated on external-research; every classifier
not-resolve reason maps; a resolvable origin is never a terminal close). `node
--check` clean; `ls api/*.js | wc -l`=12; full suite **1,323 pass / 0 fail / 6
skipped**. DB applied live + committed; JS ships on the Railway redeploy.

### Reversibility / boundaries
All closes are status-only (`skipped`, reason in `outcome`) — lower the floor and
the producer re-seeds the still-incomplete above-floor chains. LCC-Opps only; no
domain writes; no auth-schema touch.

## R63 — make cadence track REAL relationships, not captured noise (2026-06-23)

The cadence machinery (engine, draft, advance, reachability R10/R20,
contact-acquisition R16, value-rank R34, the OUTREACH#1 SF-activity→advance
bridge) is correct and complete — it was pointed at the wrong population.
Grounded live on LCC Opps: **318 active cadences** (304 prospecting) + 519
already paused; all 304 prospecting overdue, only 3 ever touched. Of the 318,
only **133 carry any real BD signal** (126 SF-linked, 6 open opp, 4
connected-value, 2 SF activity); ~185 were pure CoStar-capture noise (no SF
link, no value, no opp, never contacted). Scott's real outreach reaches ~16
distinct entities/60d — and those 3 were exactly the 3 ever touched. Same
producer-gate + auto-retire doctrine as R60 (research) / R62 (queue). Companion
to R62 (which moved cadence-touch bands OUT of the priority queue, making the
Cadence Dashboard the sole home for cadence work).

### The one signal predicate (single source of truth)
`api/_shared/cadence-engine.js` `bdSignalFromFacts()` (pure) + `entityHasBdSignal()`
(deps-injected gatherer, **fails CLOSED** on a gather error). REAL = any of: a
Salesforce identity, connected/portfolio value ≥ floor (`CADENCE_SIGNAL_MIN_VALUE`,
default $500k — the R60 knob shape), an open `bd_opportunity`, real SF activity,
or a `buy_side` cadence (a P-BUYER relationship, real by construction). The
producer gate, the grow path, and the SQL pause sweep all key on this predicate.

### Unit 1 — gate the producer (stop seeding noise)
The bulk producer of prospecting noise is `sidebar-pipeline.js`'s
contact-cadence-seed (every new CoStar-captured **person** got a prospecting
cadence via `getCadenceState`). Now it seeds a cadence ONLY when
`entityHasBdSignal(entityId)` is true; a bare captured contact still lands in the
**inbox triage** (so Scott can promote it) but gets NO auto-cadence — it earns
one when promoted (open opp / SF-link / value) or from real outreach (Unit 3).
The intentional producers are untouched: `bridgeInitiateCadence` (explicit
operator BD action), `lcc_seed_onboarding_cadence` (fires on a prospect opp =
signal), `lcc_seed_buyer_cadence` (buy_side = signal). The R5 buyer-SPE gate
stays.

### Unit 2 — pause the pure-capture noise (reversible sweep, applied live)
Migration `20260623130000_lcc_r63_pause_no_signal_cadences.sql` —
`lcc_r63_pause_no_signal_cadences(p_dry_run default true, p_floor default 500000)`
pauses the no-signal, **never-touched**, active, non-buy_side set →
`phase='paused'`, `metadata.pause_reason='no_bd_signal'`, prior phase stashed.
Reversible (never a delete; reverse via the `pause_reason` tag), idempotent (the
active-phase predicate excludes already-paused). SQL predicate mirrors Unit 1.
**Applied live 2026-06-23:** dry-run 184 → real **184 paused**; active **318 →
135** (the 133 signal-bearing + 1 buy_side + 1 touched); re-run dry-run = **0**
(idempotent). After this the dashboard's "overdue" is a real signal, not
99%-of-everything.

### Unit 3 — grow the cadence from real outreach (the inversion)
`sf-activity-ingest.js` `processSfActivityBatch`: on a freshly-inserted,
non-reply outreach event (email/call/meeting) where **no cadence resolves** AND
`entityHasBdSignal(entity)` is true, it SEEDS a cadence (`getCadenceState`) and
ADVANCES it once (the R10 single advance owner; `call→phone` map). No
double-advance — the SQL trigger already no-op'd on the insert (no cadence
existed); an entity that ALREADY has a cadence is advanced by the trigger and JS
skips. Best-effort, deps-injectable. So the cadence table GROWS from the people
Scott actually contacts (small today ~16, but the correct forward mechanism).
Summary gains `cadences_grown`.

### Unit 4 — honest dashboard
`getCadenceDashboard` default is now the **actionable** set (non-paused AND
`contact_id IS NOT NULL` — outreach-ready; a contactless cadence is P-CONTACT
acquisition work, not a draftable touch), value-ranked by `rank_value` (R34).
`?include_all=1` (ops.js "Show all cadences" toggle) reveals everything (paused /
no-signal / contactless). Response carries `mode`. Live actionable default =
**119** (was ~318 noise).

### Verified
`test/cadence-signal-gate.test.mjs` (15 — pure classifier across every signal
class + floor boundary; deps-injected gatherer signal/no-signal/fail-closed; env
floor knob) + `test/sf-activity-ingest.test.mjs` +3 (Unit 3 grows for a real
target / no-grow for a bare contact / no-grow when a cadence exists). `node
--check` clean; `ls api/*.js | wc -l`=12; full suite **1349 pass / 0 fail / 6
skipped**. DB sweep applied live (after dry-run) + committed; JS ships on the
Railway redeploy. LCC-Opps only; no dia/gov writes; auth schema untouched.
Reverse the sweep via `metadata.pause_reason='no_bd_signal'`.

## R64 — Decision Center: surface actionable verdicts, gate the federated noise (Consumption Layer #4) (2026-06-23)

First fix written explicitly against the Producer/Consumer doctrine. The Decision
Center's auto-supersede lanes are HEALTHY (match_disambiguation 978 superseded /
30 open; junk_entity_name 588 superseded + 1,082 skipped / 198 open — leave them),
but its VERDICT lanes ACCUMULATED (decided_7d=0) because the **999+ nav badge was
the federated DQ universe** (provenance_conflict ~3k + property_merge ~7k, list-
federated/worked-on-demand) burying the ~451 genuinely-actionable verdicts. Same
producer-gate + auto-resolve doctrine as R60/R62/R63.

### Unit 1 + 4 — separate the surfaces, honest badge (JS, ships on Railway)
`ops.js`: new `_DC_FEDERATED` set (kept in sync with `admin.js`
`FEDERATED_DECISION_TYPES` — `test/decision-center-partition.test.mjs` guards the
two match). `renderReviewConsolePage` now renders **two sections**: "Decisions
that need you" (the bounded, seeded VERDICT lanes — its count drives the nav
badge) and "Data-quality review · on demand" (the large/churning FEDERATED source-
view lanes, its OWN honest count). `setReviewNavBadge`/`refreshReviewNavBadge` sum
ONLY the verdict lanes (+ the SOS worklist) — the federated DQ backlog can never
inflate the badge again (no more 999+). Badge 999+ → ~451 actionable.

### Unit 2 — value-rank + cap (already satisfied)
Seeded verdict lanes are already `order=rank_value.desc.nullslast` in
`handleDecisionsList` and `renderDecisionLane` caps at top-50 with "X shown · N in
this lane". No change needed — the operator works the highest-value owners first.

### Unit 3 — auto-resolve the mechanically-SAFE subset (DB, applied live)
`lcc_r64_auto_resolve_decisions(p_dry_run default true)` (migration
`20260623140000`, isolated from `lcc_refresh_decisions` — it MERGES entities, so a
failure must never break the auth-critical refresh sweep) + gentle cron
`lcc-decision-auto-resolve` (`40 */6 * * *`). Reversible, idempotent, dry-run-first:
- **sf_link_collision** — a 2-entity collision whose two entities normalize to the
  SAME owner name (true duplicate, one SF id on a second shell) auto-MERGES the
  sf_linked entity INTO the domain-owner via `lcc_merge_entity` (moves the SF id
  onto the bridged owner). Distinct-name / >2-entity collisions ("which owner?")
  stay open. **114 → 30** (84 auto-merged).
- **map_sf_parent_account** — when the parent entity ALREADY carries exactly ONE
  salesforce Account identity but `lcc_buyer_parents.sf_account_id` is null (a pure
  wiring gap, no SF lookup), auto-MAPS it + clears `needs_sf_mapping` (releases the
  held government_buyer sync). 0/>1 candidates stay open. **17 → 11** (6 auto-mapped).
- **confirm_true_owner — KEPT HUMAN** (175, untouched) — never auto-confirm
  ownership (the deliberate exception; value-ranking via Unit 2 is the only change).

Verified live 2026-06-23: dry-run 84/6 → real apply 84 merges + 6 maps; idempotent
re-run 0/0; load-bearing caches rebuild clean (priority_queue 1104,
connected_value 3003, buyer_spe 754); spot-check (Western Nephrology) — loser
tombstoned into winner, SF id moved to the bridged owner. Reverse a merge via the
standard `merged_into_entity_id` tombstone path; reverse a map via
`sf_account_id=null, needs_sf_mapping=true` (prior value in `effects`). `node
--check` clean; `ls api/*.js | wc -l`=12; full suite 1351 pass / 0 fail / 6 skipped.
LCC-Opps only; no dia/gov writes; auth schema untouched.

## UI Phase 2 — Overview parity (dia ↔ gov, value-first) (2026-06-23)

The two domain Overview pages now read the SAME way, top-to-bottom, with one
section grammar. The **unified Overview block order (BOTH domains)** —
`renderDiaOverview` (`dialysis.js`) + `renderGovOverview` (`gov.js`):

1. **Action Items** (BD + data-quality, value-ranked, capped)
2. **Portfolio at a Glance** — active property count, SF, gross/projected rent,
   NOI, avg rent/SF, operators-or-agencies tracked, contacts
3. **Lease Expiration Risk** — <6mo / <1yr / expired-holdover / 2–5yr / 5+yr +
   a distribution bar over dated leases
4. **Market Activity** — TTM Sales · Northmarq Performance · On Market (dia folds
   its SJC Deal Book in here)
5. **Pipeline Snapshot** — gov: leads by temperature/grade + pipeline value;
   dia: Team Outreach & Touchpoints (its BD-activity surface)
6. **Operator (dia) / Agency (gov) + Geographic Breakdown**
7. **Data Health & Coverage** (ops — at the BOTTOM, under a labelled group
   divider). dia: Database Health, Clinical Metrics, Clinic Financials,
   Ownership Coverage, Listings-confirm, LLC queue, Research pipeline. gov:
   Listings-confirm, LLC queue, Ownership Coverage (GSA Lease Intel sits above
   the footer as market intel).

**Keep future Overview edits value-first + mirrored** — new blocks go in the
order above on BOTH pages; ops/data-quality stays in the bottom "Data Health &
Coverage" group.

### Honest, comparable denominators
- Both Overviews headline **ACTIVE properties**. gov's "Total Properties" now
  prefers `mv_gov_overview_stats.total_properties` (archived excluded, ~12.6k)
  whenever the MV is loaded — not only on the fast path — so the headline never
  flips to the all-status ~19.9k once the full portfolio loads. dia headlines
  its ~12.3k active properties (dia has no archived class); CMS-clinic count
  (~8.5k) is a SECONDARY metric, not the headline.
- dia rent is **projected to CURRENT_DATE** (the dia doctrine), sourced from
  `v_property_attributes_portfolio` (`dia_project_rent_at_date` over the primary
  lease), never raw Y1 `leases.annual_rent`. dia is NNN, so net rent ≈ NOI —
  labelled honestly ("Net Rent ≈ NOI").

### dia data source — `mv_dia_overview_stats` (NEW, mirrors gov's MV)
`renderDiaOverview` loads a single-row materialized view
`public.mv_dia_overview_stats` (dia DB) via `diaQuery('mv_dia_overview_stats',
…)` into the `diaOverviewStats` global (mirrors gov's `mv_gov_overview_stats` /
`govOverviewStats` fast-path), and fills the value-first placeholder divs
(`#diaPortfolioGlance`, `#diaLeaseExpRisk`, `#diaBreakdown`) when it resolves.
The MV exposes: portfolio totals (active property count, cms_clinics secondary,
SF, projected total_rent, total_noi=total_rent, operators_tracked, avg_rent_psf,
contacts), lease-expiration buckets + `lease_distribution_by_expiry` jsonb, and
`top_operators_by_count`/`_by_rent` + `top_states_by_count`/`_by_rent` jsonb.
- Migration: `Dialysis/supabase/migrations/20260630_dia_mv_overview_stats.sql`
  (applied live to dia `zqzrriwuavgrquhisnoa`). Unique singleton index for
  CONCURRENTLY refresh; **pg_cron `dia-refresh-overview-stats` daily 01:00**
  (parity with gov's `refresh-gov-overview-stats`).
- Empty/unavailable MV ⇒ the value blocks show a graceful skeleton/“unavailable”,
  never a crash (cache-or-live safe). Every other dia Overview section is
  unchanged — just reordered.

### Shared card grammar
dia's `infoCard`/`sectionHeader`/`.dia-info-card` and gov's
`govCard`/`govSectionHeader`/`.gov-info-card` render identically (same grid
classes, same card/bar CSS). The new dia breakdown blocks use `diaInlineBar`
(a verbatim mirror of gov's `inlineBar`) so the mirrored Operator/Agency +
Geographic blocks look the same across domains. Both pages emit the same
"Market Activity" / "Pipeline Snapshot" / "Data Health & Coverage" group
dividers. Bar colours match gov's palette so dia↔gov reconcile visually.

### Boundaries / verified
Client render only (`dialysis.js`, `gov.js`) + one additive dia MV migration; no
new api/*.js (`ls api/*.js | wc -l`=12); reversible (drop the MV → dia value
blocks degrade to skeleton, every other section unchanged). `node --check` clean
(dialysis.js, gov.js); full suite **1356 pass / 0 fail / 6 skipped**. JS ships on
the Railway redeploy; the dia MV + cron are live on the dia DB.

## UI Phase 3 — tab set + naming unification (dia ↔ gov) (2026-06-24, COMPLETE)

Both domain pages now navigate identically — one grouping tier, one order, one
name per concept. Client-only (`app.js`, `index.html`, `dialysis.js`, `gov.js`);
no migration; no new api/*.js (`ls api/*.js | wc -l`=12). Page-level hash routing
(Phase 1) is unaffected — `data-*-tab` dispatch ids are STABLE; only display text
+ group membership changed, plus a few additive tabs.

### The unified grouping tier (BOTH domains — `GOV_TAB_GROUPS`/`DIA_TAB_GROUPS` in app.js)
`overview` → Overview · `deals` → Pipeline · Sales · Leases · Loans · Ownership ·
Players (gov also: Leads) · `inventory` → Properties · Search · `research` →
Research · Activity · `reference` → (dia: CMS Data · Inventory Changes · NPI
Intel; gov: GSA / FRPP Intel) · `capital-markets` → Capital Markets. The pills are
identical; only the domain-specific REFERENCE group differs. **Future tab work
stays mirrored** — new tabs go in this order on BOTH pages; domain-only surfaces
go under REFERENCE.

### Pipeline / Leads mapping (the one cross-domain naming decision — Scott, 2026-06-24)
"Pipeline" = the SHARED prospect triage (`renderDomainProspects`, tab id
**`prospects`**) on both domains (Unit 1 relabel: dia's old "Prospects" →
"Pipeline"). gov keeps its richer scored-leads surface (`renderGovPipeline`, tab
id **`pipeline`**) as a gov-only **"Leads"** tab in DEALS — an honest
specialization, not a duplicate. Tab ids unchanged so the gov tab-click
special-case (`currentGovTab==='prospects'` → renderDomainProspects) still routes
correctly.

### New / promoted tabs
- **dia Ownership** (Unit 2, DEALS) — `case 'ownership'` in `renderDiaTab` renders
  the existing `renderDiaOwnershipResearch()` panel standalone (it self-binds +
  re-renders via `renderDiaTab`). The Research-workbench ownership MODE
  (`diaResearchMode='ownership'`) still works unchanged.
- **gov Properties** (Unit 3, INVENTORY) — new `renderGovProperties()` (gov.js):
  paginated inventory via `govQuery('properties', …)`, **value-first default order
  `gross_rent DESC`** (consumption-layer doctrine), search + sort pills +
  pagination, row → `openUnifiedDetail('gov',{property_id})`. Excludes archived
  (`status=neq.archived`) to match the Overview "active" headline. State vars
  `govProperties*` + `_govPropsOrder`/`_govPropsFilters` mirror the dia pattern.
- **gov Activity** (Unit 4, RESEARCH) — `case 'activity'` renders the existing
  `renderGovOutreachInner()` (the Government-Outreach block) standalone.
- **gov GSA / FRPP Intel** (Unit 6, REFERENCE) — new `renderGovGsaIntel()` (gov.js)
  recomputes the Overview §11 GSA section from the same globals (govOverviewStats
  MV + govData.* arrays). The Overview section is **kept** too (UI Phase 2 doctrine
  — GSA Intel sits above the footer); the tab is an additional surface. **Lease
  Events** (gsa_lease_events, the gov mirror of dia Inventory Changes) was
  DEFERRED per Scott (deferrable; not a light lift).

### Unit 0 — dia-tile residuals (DIA_OVERVIEW_TILE_AUDIT_2026-06-23)
- **0a** — all three "need lease backfill" surfaces now read the count=exact
  backlog (`diaData.leaseBackfillCount`, v_clinic_lease_backfill_candidates,
  ~3,035), never the 1,000-row capped page: the Lease Coverage card sub
  (treats a 0/null probe as "not loaded" → capped fallback, never a misleading
  "0"), the Research-Pipeline "Lease Backfill" tile, and the Action Item
  highlight (new `leaseBackfillExact` var). Falls back to the capped length only
  when the probe didn't load.
- **0b** — `#sjcRecentDeals` clickable rows now use the shared `.clickable-row`
  class (cursor:pointer + hover). Root cause: the old inline `style="cursor:pointer"`
  was a SECOND `style` attribute on a `<tr>` that already had `style="border-top…"`,
  so the browser ignored it.

### Verified
`node --check` clean (app.js, gov.js, dialysis.js); `ls api/*.js | wc -l`=12.
Live after redeploy: both domains show the same tab strip + groups + order; dia
"Pipeline" (was Prospects) renders the prospect triage; dia "Ownership" tab
renders the ownership panel; gov "Properties" lists properties value-first; gov
"Activity" shows the outreach feed; gov "GSA / FRPP Intel" renders the intel
section; gov "Leads" (was Pipeline) renders the scored-lead pipeline; Unit 0 lease
count reads ~3,035 consistently + recent-sale rows show a pointer cursor.

## UI Phase 5 — "Owners Missing a Contact" value-ranked BD worklist (2026-06-24)

The #1 direct-BD gap: the BD spine is owner-centric, but valued owners with NO
human to call were surfaced nowhere as a ranked worklist. P-CONTACT only covers
cadence-bearing contactless owners; `v_owner_active_contact` only the
bridged-with-domain-signals slice — the big value-bearing middle (valued owner,
no cadence, no contact) was invisible. Grounded live 2026-06-24: **3,826 owners
with a current portfolio rollup rent > 0 carry no linked person AND no Salesforce
Contact; 507 of those ≥ $1M.** After the honest exclusions the clean worklist is
**3,521 (358 ≥ $1M)**. **Floating persons = 12** (R39/R40 dedup + entity-link
solved the audit's ~4,447) — NOT a Phase-5 workstream. The acquisition engine
already exists (the CONTACT-SELECTION picker + the owner-contact-enrich worker) —
Phase 5 adds the **value-ranked worklist VIEW + the operator SURFACE**, not new
acquisition logic. Consumption-Layer doctrine throughout. Client + one additive
LCC-Opps view; no new api/*.js (≤12).

### Unit 1 — the worklist view (LCC Opps, additive, applied live)
`v_owner_contact_worklist` (migration
`20260721130000_lcc_phase5_owner_contact_worklist.sql`, SECURITY INVOKER,
read-only): one row per contactless valued owner.
- **value-GATE:** `v_entity_portfolio_all.current_annual_rent_total > 0`.
- **contactless:** NO `entity_relationships` edge to a `person` entity via
  `associated_with`/`contact_at`/`works_at` AND no
  `external_identities(salesforce, Contact)`.
- **rank_value** = `COALESCE(NULLIF(rollup,0), lcc_entity_connected_value)` (R34
  value sources); ordered `rank_value DESC NULLS LAST`. Carries `property_count`,
  `primary_domain`/`is_cross_vertical`, `enrichment_action` + `bench_size`
  (LEFT JOIN `v_owner_active_contact` — the CONTACT-SELECTION hint when the owner
  is bridged with domain signals; NULL ⇒ acquire/research).
- **Exclusions (honest worklist):** `lcc_is_operator_owner_name` (the R8
  operator-as-owner artifact), `metadata.junk_name_flagged`, and **buyer-SPE /
  buyer-parent** (`lcc_buyer_spe_resolved` / `lcc_buyer_parents` — they run the
  P-BUYER buy-side flow, not prospecting). So the worklist does NOT carry an
  `is_buyer_parent` column — those rows are excluded outright (the P-BUYER lane
  is their surface), which is why the column the prompt listed is intentionally
  absent.
- **Auto-retire is structural** (a view): an owner that gains a person link / SF
  Contact drops out on the next read — no sweep needed. Drop the view → zero trace.

### Unit 2 + 3 — the surface + the action (client only)
- **Read endpoint:** `GET /api/entities?action=owner_worklist[&min_value=&limit=&offset=]`
  (`entities-handler.js`, the LCC-Opps/`opsQuery` reader, workspace-scoped) →
  `{rows, actionable_count, universe_count, min_value, limit, offset}`. Defaults to
  the workable high-value set; returns BOTH the filtered actionable count and the
  full clean universe so the surface shows an honest "X of N" (Consumption-Layer).
  `owner_worklist` added to entity-hub's `entityActions` set.
- **Surface:** `contacts-ui.js` — the Contacts/Entities page now LEADS with an
  **"Owners Missing a Contact"** tab (`subTab` default `'worklist'`); the existing
  All Contacts / Hot Leads / Merge Queue / Data Quality become secondary tabs.
  Each row: owner name · domain · property count · the enrichment hint · value
  (rank_value). Defaults to **≥ $1M** with a **"Show all"** toggle; the headline
  count is actionable (e.g. "358 valued owners ≥ $1M need a contact · 3,521 total
  contactless"), NEVER the raw producer output.
- **Action (no duplicate engine):** a row click → `openEntityDetail(entity_id,
  'Contacts')` — the 4B owner detail Contacts tab, where the EXISTING
  CONTACT-SELECTION acquire CTA (`?action=buyer_contacts` →
  `select_prospecting_contact`) already lives. Acquiring/linking a contact retires
  the row (the Unit-1 view drops it on the next read; `openWorklistOwner` marks the
  worklist stale so the revisit re-reads). The `enrichment_action` hint surfaces
  the suggested next step (sos_manager_lookup / address_reverse_lookup /
  public_company_ir / …) where the owner-contact-enrich worker handles it.

### Verified (2026-06-24)
View applied live (universe 3,521 / ≥$1M 358 / 37 with an enrichment hint); top
rows are real high-value contactless owners (Cira Square Master Tenant $34.4M,
LCPC Pentagon $34.3M, Two Independence Hana $29.5M …) with `rank_value` matching
`v_entity_portfolio_all`. `node --check` clean (entities-handler, entity-hub,
contacts-ui); `ls api/*.js | wc -l`=12; full suite **1395 pass / 0 fail / 6
skipped**. Migration additive + reversible (DROP VIEW → zero trace); JS ships on
the Railway redeploy. LCC-Opps only; no dia/gov writes; auth schema untouched.
The acquisition engine + floating-person linking (12 remain) are already done —
this is the missing surface. Phase 5 done.

### Phase 5b — one-click-run the owner-contact-enrich worker from a worklist row (2026-06-24)

Closes the loop on the worklist owners where there's no SF contact to pick but an
automated lookup exists. Grounded live: of the 3,521 clean worklist owners, **37
carry a runnable enrichment hint** (20 `sos_manager_lookup`, 16
`address_reverse_lookup`, 1 `public_company_ir`) — all 37 already have an
`owner_contact_pivot` row. The operator clicks **"Run lookup"** on the row and the
EXISTING owner-contact-enrich worker runs for that one owner.

- **Single-owner mode (reuse, not fork)** — `handleOwnerContactEnrichTick`
  (`owner-contact-enrich.js`) gains an `entity_id` branch: `POST
  /api/owner-contact-enrich-tick?entity_id=<uuid>` ensures the owner's pivot
  (`rpc/lcc_ensure_owner_pivot`, idempotent — seeds from `v_owner_active_contact`)
  then runs the SAME `processOwnerEnrichmentRow` on that ONE row; `GET
  &entity_id=` is a non-mutating preview (`classifyEnrichRow`). The batch
  drain/cron path is byte-identical. New exported `classifyEnrichRow(row)` is the
  single classifier shared by the batch dry-run AND the single-owner preview (no
  drift). Safe by construction: the worker only attaches a guard-passed person or
  queues research — never guess-fills.
- **The CTA** (`contacts-ui.js`) — worklist rows whose `enrichment_action` is in
  `WORKLIST_RUNNABLE` (sos / address / public_ir / find_person_at_manager / deed)
  render a **"Run lookup"** button (`stopPropagation` so it doesn't open the
  detail). `runWorklistEnrich` POSTs the single-owner endpoint; on `attached` it
  retires the row (drops it + decrements the counts) and refreshes the queue
  cache; `worklistEnrichMessage` is **honest** about the not-yet-configured
  external adapters (a SOS/address run today → `manual_research_queued` →
  "Automated lookup not configured yet — queued for manual research"; public_ir →
  the manual IR path). Rows with no automated lookup keep the manual "Select
  contact →" pick (the Phase-5 flow).
- **Activation:** the SOS / address / deed / web-search adapters stay
  feature-flagged on `OWNER_ENRICH_SOS_URL` / `_ADDRESS_URL` / `_DEED_URL` /
  `_WEBSEARCH_URL` (the find_contacts_by_account rollout pattern) — until those PA
  webhooks land, a one-click run queues manual research (the loop is wired; the
  external egress is the post-deploy piece). The attach-named-person /
  manager-drill-through classes resolve today with no config.

### Verified (2026-06-24)
Live read-only: all 37 runnable worklist rows resolve a pivot
(`active_contact_entity_id` null) so the single-owner run has a row to process;
`classifyEnrichRow` returns the enrichment_action. `test/owner-contact-enrich.test.mjs`
12 → 17 (+`classifyEnrichRow`: already-linked / attach_person / manager_drillthrough
/ sos hint / manual_research). `node --check` clean (owner-contact-enrich,
contacts-ui); `ls api/*.js | wc -l`=12. No new api/*.js; no migration; reversible
(every attach is a relationship row + the pivot pointer). JS ships on the Railway
redeploy. LCC-Opps only; no dia/gov writes.

## CM market-entry date — ONE canonical field: `on_market_date` (T4c Item 3, 2026-06-24)

**`available_listings.on_market_date` is THE authoritative market-entry date** on both
dia (`zqzrriwuavgrquhisnoa`) + gov (`scknotsqkcheojiaewwh`). Every consumer that means
"when did this come to market" — the Capital-Markets **timing / DOM / added / new-to-market
/ inventory-ramp** series, exports, and any cap-markets calc — reads `on_market_date`, NOT
`listing_date`. `listing_date` is **raw capture (may be ingest-clock/fake) — audit /
reversibility only**; never read it for market timing. Column COMMENTs on both DBs encode
this contract; **do NOT add a `listing_date` fallback to any timing path** (that re-imports
the fake ingest-clock surge). `on_market_date` already materializes the synthetic /
sale-anchor / curated / historical dates, so no fallback is needed; rows with
`on_market_date IS NULL` (the unrecoverable HELD set) drop off the time axis (de-surge) —
a NULL is honest.

**Doctrine (Scott, 2026-06-24) — the ONE exception:** the **point-in-time CURRENT
active/available STOCK count** ("how many on the market now") stays on the **freshness
gate** (active status + `last_verified_at` recency + `consecutive_check_failures` < 3),
NOT `on_market_date`. So:
- **Point-in-time available count** (dia `cm_dialysis_active_listings_m/_q` membership →
  the canonical ~119; gov `cm_gov_available_by_term_summary` / `cm_gov_available_cap_dot`,
  `off_market_date IS NULL` → ~44) keeps its **listing_date freshness gate** — do NOT
  switch membership to `on_market_date`. **⚠️ SUPERSEDED FOR dia by T9d (2026-06-27):**
  the dia `cm_dialysis_active_listings_m/_q` membership now keys on `on_market_date` +
  exits + a generous DOM age-out (the freshness gate's `last_seen` was phantom-stamped and
  the `listing_date` was a fake `capture_date_fallback` — both inflated the count). The
  canonical dia count was deliberately RESTATED (Q1-2026 ~119/122 → ~195). The **gov**
  freshness gate is UNCHANGED (this exception still holds for gov). See the T9d section.
- **`on_market_date` drives** the flow/timing metrics AND the **historical active-over-time
  SPAN** (each listing active across `on_market_date → off_market_date`): gov
  `cm_gov_market_turnover_m` + `cm_gov_inventory_backlog_m` `active_count` (eff windows),
  the `added_*` ramp, `cm_*_new_to_market_q`, and DOM
  (`cm_dialysis_dom_pct_ask_m/_q`; `cm_dialysis_active_listings_m/_q.days_on_market` =
  `period_end - on_market_date`).

**Published history is NOT frozen** (Scott's explicit call, 2026-06-24, "let real dates
rewrite history"): recovered Salesforce on-market dates plot at their TRUE month even when
that lands in an already-published quarter — so the new-to-market / added / ramp / DOM /
gov-active-span series shift in published months as the now-known dates become visible
(gov added ~+2,700 across ~135 months, etc.). This is intentional; do not re-freeze.

**Migrations:** `supabase/migrations/20260624_cm_t4c_item3_{gov,dia}_on_market_date_timing.sql`
(view defs only — reversible by re-creating the prior `listing_date`-anchored bodies; no
domain-row writes). **Operational/audit readers of `listing_date` are intentionally LEFT
as-is** (they are not market-timing): `cm_dialysis_listing_verification_status` /
`_listings_review_queue` (listing age for verification), `cm_dialysis_inventory_snapshot_kpis`
(passthrough column; its DOM rides `active_listings`), gov `cm_gov_available_by_term_summary`
/ `_available_cap_dot` (passthrough columns), and the `v_*` data-quality / verification /
next-best-action / consolidate-candidate / round68 views. The CM export builders
(`api/capital-markets.js` `fetchView`, `api/_shared/cm-excel-export.js`,
`cm-native-chart-injector.js`) read the cm_* views BY NAME and carry **no direct
`listing_date`** read — repointing the views is the single lever.

**FOLLOW-UP (surfaced, not built):** dia has no `on_market_date → off_market_date`
active-over-time SPAN series like gov's (`cm_dialysis_inventory_backlog_m.active_count`
derives from the canonical point-in-time `active_listings` per the 2026-06-22 chart audit).
Adding a dedicated dia span line (gov's eff CTE is the template) without re-diverging the
canonical available count is a separate call.

## dia Overview patient tiles — honest CMS reporting-period labeling (2026-06-25)

`public.facility_patient_counts` (Dialysis_DB `zqzrriwuavgrquhisnoa`) is a CMS
**reporting-period** time-series, NOT a nightly feed. Grounded live 2026-06-25:
the newest GENUINE CMS reporting period is **~2025-03** (snapshot `2025-03-01`);
the later `snapshot_date`s that end in **`12-31`** (`2025-12-31`, `2026-12-31`,
`2024-12-31`) are annual claims-window-END **re-stamps** carrying near-identical
data (only 63/123/164 of ~7,554 facilities differ — <2%; deltas ±135). CMS
publishes this dataset roughly **annually**; re-running ingestion only adds rows
when a genuinely-new `claims_date`→`snapshot_date` lands (see the Dialysis-repo
CLAUDE.md note). So the patient tiles must NOT imply a stale nightly feed.

- **`v_facility_patient_counts_mom` (rewritten, dia migration
  `supabase/migrations/dialysis/20260625_dia_patient_counts_mom_genuine_period.sql`,
  applied live):** compares the **two most recent GENUINE monthly periods**
  system-wide (top-2 distinct `snapshot_date` with `to_char(...,'MM-DD')<>'12-31'`)
  — a fixed-pair, NOT per-facility `lag` over the raw series (which picked up the
  interleaved year-end re-stamps). Column shape is **byte-identical** (all
  consumers unchanged: the Overview Top Movers tile, `copilot-chat`, the
  `api/operations.js` daily briefing). Today returns **0 non-zero deltas**
  (2025-03-01 vs 2025-02-01 are identical) — the honest "no new period" state —
  and **auto-populates** when CMS publishes a real new period (the top-2 shift).
  `snapshot_date` on the view = the newest genuine period = the "as of" date.
  Reversible (re-create the prior body).
- **`dialysis.js` (client only):** loads the as-of period from the mom view's
  `snapshot_date` (`diaData.patientAsOf`; `_diaPatientAsOfLabel()` → e.g.
  "Mar 2025"). The Clinical Metrics section + "Clinics Reporting" card are
  captioned "CMS patient data as of <period> · published periodically (≈annually),
  not nightly". The **Top Movers** tile renders an honest empty-state ("No new CMS
  reporting period since <period> — patient volumes unchanged …") instead of
  ranking <1% re-stamp noise; it re-populates automatically on a new period.
- **No active ">60d stale patient" alarm existed on the Overview** (grounding
  refined the premise): `v_source_health_dashboard.cms_patient_counts` is
  `never_run`/Unknown and `dialysis.js` surfaced no patient "as of"/staleness
  indicator — the fix is honest LABELING + the empty-state, not removing an alarm.
  The clinic/listing/sales nightly freshness surfaces are untouched.
- **Do NOT** fabricate a synthetic newer snapshot, rank `12-31` re-stamp deltas,
  or label patient data by the nightly-ingestion timestamp.

## Outreach work-surface — Today on-ramp + focus-mode session (2026-06-26)

The outreach PLUMBING was verified working (advance bridge 0 failures; correctly-
categorized SF events advance 27/27; OUTREACH#1 categorization fix live). The gap
was WORK, not mechanics: ~197 actionable cadences, ~190 overdue, but only ~9 ever
touched — the value-ranked prospect list was sitting unworked. This round makes it
a daily-driver surface. **Reuses R10 Unit 4 (`cadence_dashboard` action +
`cadDraft`/`cadMarkSent`/`cadLogTouch` + the `?_route=draft` generate/record_send
endpoints) + R34 value-ranking + the single `advanceCadence` advance owner.** No
new api/*.js (≤12); no migration; no sending integration (mailto/copy — Scott
sends from his mail client, "Mark sent" records the touch).

### Grounding refuted two prompt premises (live LCC Opps 2026-06-26)
- **Unit 2 recipient gap is already closed** — all 197 actionable cadences carry a
  resolved `contact_email` (R20 Unit 3). The "~32% have no recipient" premise does
  NOT hold for the has-contact actionable set. Kept Unit 2 only as a robustness
  safety net (inline add-email) for the rare phone-only contact.
- **Value premise differs** — the actionable (draftable) cadence set is mostly
  low/no-value person contacts (top $598k, sum ~$1.35M; 0 ≥ $1M). The high-value
  owners ($27M+) are the **contactLESS** set — the "Owners Missing a Contact"
  worklist (UI Phase 5), NOT the cadence focus list. So the Today on-ramp shows
  HONEST numbers (overdue count + in-reach $ of the focus set), never a fabricated
  $27M. The two surfaces stay distinct (a contactless high-value owner is
  acquisition work, not a draftable touch).

### Unit 1 — Today on-ramp ("Work Your Outreach")
First widget on the Home page (`index.html` `#outreachOnrampWidget`); `app.js`
`renderOutreachOnramp()` reads the `cadence_dashboard` action (the actionable set),
shows the HONEST count — **N due** (overdue actionable) + **$X in reach** (sum
`rank_value`, null→0, shown only when > 0) — and a **"▶ Start working →"** button
that navigates to the Priority Queue page and lands DIRECTLY in the focus session
(`renderOutreachFocus`), not the generic dashboard. Wired into
`handlePageLoad('pageHome')` + the boot paths.

### Unit 3 — focus-mode session (`ops.js` `renderOutreachFocus`)
Renders into `priorityQueueContent` (reached from the Today on-ramp OR the new
**"▶ Focus mode"** button on the Cadence Dashboard header). One card at a time,
highest `rank_value` first (the server already orders the dashboard):
- The card shows WHO + WHY (value · phase · touch N · overdue · last touch).
- **Email-next** → `cadDraft` (subject + editable body + the R20-resolved
  recipient) → Copy / Open in mail (`mailto:`) / **Mark sent** → `cadMarkSent` →
  `record_send` → `advanceCadence` (the single advance owner; record_send writes no
  activity row, so no trigger double-advance) → **auto-advances to the next card**.
- **Call/VM-next** → **Log <type>** → `cadLogTouch` → `advance_cadence` → next.
- **Skip / snooze** → `focusSkip` → `snooze_cadence` (defers `next_touch_due` 5d,
  records `metadata.snooze` reason — NOT a touch, never bumps engagement counters)
  → advances WITHOUT crediting value, so a skipped card doesn't silently re-serve.
- Session progress: `_focusProgressBar` ("worked / total · $ touched · on #k") with
  a fill bar; the end shows a completion summary + "Reload outreach".
- **The advance hook (`_focusActionDone`) lives in the SHARED `cadMarkSent` /
  `cadLogTouch`** (one guarded call each), firing only when the settled card is
  inside `#focusCardSlot` — so the plain Cadence Dashboard keeps its in-place
  settle behavior (no auto-advance there). Single advance owner preserved.

### Unit 2 — recipient resolution robustness (rarely hit today)
`cadDraft` now threads the contact entity id (`contact_id`, fallback to the
cadence entity). When the contact carries no email, the draft renders an inline
**"add recipient email"** input + Save (`cadSaveEmail` → POST
`?action=set_contact_email` → PATCH `entities.email`) instead of a dead `mailto:`;
on save the "To:" line + the mailto link refresh. Copy is always available. Never
fabricates an address — only stores what the operator types.

### New backend actions (`api/operations.js`, no new api/*.js)
- `POST ?action=snooze_cadence {cadence_id, days=5, reason}` →
  `bridgeSnoozeCadence`: PATCH `touchpoint_cadence` `next_touch_due`/`metadata.snooze`
  + refresh the queue cache (Slice-1 staleness). Reversible (clear the snooze /
  reset `next_touch_due`); never advances a touch.
- `POST ?action=set_contact_email {entity_id, email}` → `bridgeSetContactEmail`:
  PATCH `entities.email` (validated). Workspace-scoped.

### Verified
`node --check` clean (operations.js, ops.js, app.js); `ls api/*.js | wc -l`=12;
full suite **1542 pass / 0 fail / 6 skipped**. Live column gate on LCC Opps:
`touchpoint_cadence.next_touch_due`/`metadata` + `entities.email` all present,
nullable, correct types (the snooze PATCH mirrors `bridgeAdvanceCadence`; the email
PATCH mirrors `bridgeUpdateEntity`). LCC-Opps only; no dia/gov writes; auth schema
untouched. JS ships on the Railway redeploy.

### Follow-up (low ROI — NOT done)
~52 pre-2026-06-19 `note` backlog SF events (correspondence predating the
OUTREACH#1 categorization fix) never advanced their cadences; most are admin/
deal-execution emails, so a one-shot re-categorize+advance is marginal. Skipped.

## Contact-acquisition → cadence seed — make high-value owners workable outreach (2026-06-26)

The outreach work-surface (the focus session) and contact-acquisition both exist
but didn't connect for the owners that MATTER. Grounded live: the
draftable/active cadence set is the low-value person tail (top ~$598k, **0
cadences ≥ $1M**), while **357 owners ≥ $1M are contactless** (the "Owners Missing
a Contact" worklist, top ~$27M). Contact-acquisition (the owner-contact-enrich
worker, the worklist/P-CONTACT picker, contact-qualify) *links a person* to an
owner then stamps the contact onto an **existing** active cadence
(`stampContactOnActiveCadence`, `onlyContactless`) — **but a high-value owner has
no cadence to stamp**, so after it gains a contact it sits connected/reachable yet
ABSENT from the value-ranked focus session. The supply (contacts) and the consumer
(the focus surface) existed; the wire did not.

### The one rule (one place, all acquisition paths inherit it)
`api/_shared/contact-attach.js` — when `stampContactOnActiveCadence` finds **no
active cadence**, it now seeds ONE prospecting cadence via
`maybeSeedValuableCadence` (default on; `seedIfValuable=true`). All three
acquisition callers route through this single choke point and inherit it
unchanged: `owner-contact-enrich.js attachPersonToOwner` (worklist enrichment),
`operations.js bridgeSelectProspectingContact` (worklist/P-CONTACT picker), and
`operations.js performContactQualify`'s `stampCadence` dep.
- **Value-gate (REUSE, not invent):** `entityHasBdSignal` — the SAME R63
  predicate (Salesforce identity / open opp / SF activity / connected or portfolio
  value ≥ `CADENCE_SIGNAL_MIN_VALUE`, default $500k). A newly-contacted high-value
  owner passes by construction (it has value). Below the floor → NO seed (no
  low-value cadence spam — preserves R63). **Fails CLOSED** on a signal-check error.
- **Seed via the EXISTING path** (`getCadenceState`): phase `prospecting`,
  `contact_id`/`sf_contact_id` set so it's immediately reachable + draftable,
  `next_touch_due = now()` so it surfaces in the focus session.
- **Idempotent / never a duplicate:** `getCadenceState` GET-first + the
  unique-index race-retry means an existing cadence (even a paused / converted
  one) is FOUND, not duplicated; only a freshly-CREATED row (`is_new`) counts as a
  seed (`maybeSeedValuableCadence` returns `no_active_cadence` for a found
  non-active row → that paused/converted cadence is left UNTOUCHED, the prior
  no-action behaviour). No `ON CONFLICT` reactivation of a deliberately-paused row.
- **Single advance owner preserved** — seeding only CREATES the cadence; every
  advance still goes through `advanceCadence` exclusively.
- A below-floor owner still gets the person LINK (that happened upstream); the
  stamp returns `no_active_cadence` exactly as before (e.g. `bridgeSelectProspectingContact`'s
  404, `performContactQualify`'s self-stamp fallback) — byte-identical for the
  low-value path.

### Boundaries / verified (headless 2026-06-26)
LCC-Opps only; no dia/gov writes; auth schema untouched. No new api/*.js
(`ls api/*.js | wc -l`=12); no migration (cadence columns + the
`uq_cadence_contact_property` index pre-exist). `node --check` clean
(contact-attach, cadence-engine, operations, owner-contact-enrich,
contact-acquisition); no circular import (contact-attach → cadence-engine only).
`test/contact-qualify.test.mjs` +8 (`maybeSeedValuableCadence`: high-value →
exactly one prospecting cadence with the contact set + `next_touch_due`;
low-value → no seed [`below_value_floor`, seed never attempted]; existing paused
cadence → not a seed, untouched; signal-check error → fails closed; +
`stampContactOnActiveCadence` seed-branch wiring: seeds when valuable, no-seed
below floor, `seedIfValuable:false` never seeds, existing active cadence → stamp
not seed). Full suite **1550 pass / 0 fail / 6 skipped**. JS ships on the Railway
redeploy.

### After deploy (verify live)
Run the free-attach drain + this wire: a ≥$1M contactless owner, once it gains a
contact, gets a prospecting cadence and appears value-ranked at/near the TOP of
the outreach focus surface — the focus list's top value rises from ~$598k toward
the $1M+ owners. The acquire-contact worklist → workable-cadence focus chain is
now whole: contactless $1M+ owner → acquire contact → seed cadence → value-ranked
focus card → worked.

## Web-search enrichment service — the search proxy that unlocks high-value contact acquisition (2026-06-27)

The owner-contact-enrich worker's web-search adapter
(`api/_shared/web-search-enrich.js::buildWebSearchAdapter` /
`extractPrincipalCandidates`) is the worker's **catch-all enrichment step**
(step 5 in `owner-contact-enrich.js`, AFTER the routed sos/address/deed
adapters). It does deterministic, **labeled-role-cue-anchored**, human-name-
guarded (`looksLikePersonName` + `isImplausiblePersonName`) principal extraction
over a normalized search-result list — **no LLM, no snippet name-grabbing, no
guess-attach** (a confident labeled hit ⇒ attach a guard-checked contact; no
confident match ⇒ the owner falls to the manual worklist). It just needed its
deferred `search()` fetcher wired to a real provider. Because web-search is the
catch-all, configuring it covers ALL `enrichment_action` types (sos + address +
deed + web), unlocking the **357 ≥$1M contactless owners** (and the broader
~3,520 tail).

### The proxy — `supabase/functions/owner-contact-websearch/` (edge fn, NOT api/*.js)
A thin free-tier search proxy (the docai-ocr / SHAREPOINT_FETCH_URL webhook
pattern). It does NOT parse names / call an LLM — the LCC parser does that. Its
only job is to run a web search and return `[{title,snippet,url}]`.
- **Contract:** `webhookFetcher('OWNER_ENRICH_WEBSEARCH_URL')`
  (`owner-contact-enrich.js`) POSTs `{ args: [query, row] }` and feeds the JSON
  response straight into `extractPrincipalCandidates`, so the response is a
  **BARE array** `[{title,snippet,url}]` (top ~10), NOT an object. The query is
  already composed by the adapter (`"<owner> <state> <city> manager managing
  member registered agent"`).
- **`normalize.js`** (pure ESM, no Deno/Node APIs — imported by BOTH `index.ts`
  AND the node test, no drift): `normalizeBraveResults` / `normalizeSerperResults`
  / `normalizeProviderResults(provider, json, max)`. Brave `web.results[]`
  (`title`/`description`→snippet/`url`) is the default; Serper `organic[]`
  (`title`/`snippet`/`link`→url) is the alternative — provider is a small switch
  on `WEBSEARCH_PROVIDER`. Malformed/unknown → `[]`.
- **`index.ts`** (`Deno.serve`): `GET` = health (`{ok,ready,configured}`, no
  spend); `POST` = read `args[0]` query → run the provider search (~8s timeout)
  → `normalizeProviderResults` → return the array. **Resilient:** unconfigured /
  provider error / rate-limit / empty / bad-JSON → `[]` (200), never throws into
  the worker. **Auth:** `webhookFetcher` sends no header, so the shared secret
  rides in the configured URL's `?key=<secret>` (checked against
  `OWNER_ENRICH_WEBSEARCH_SECRET`); deploy `--no-verify-jwt`. No secret env ⇒
  transitional-open + warn (docai-ocr posture). A bad key → 401 (visible
  misconfig → adapter `search_error`).

### Env / activation (post-merge, Scott + Cowork)
Scott provisions a free **Brave Search API** key (`BRAVE_SEARCH_API_KEY`; ~2,000
q/mo free — or Serper via `SERPER_API_KEY` + `WEBSEARCH_PROVIDER=serper`); Cowork
deploys the edge fn (Supabase MCP, `--no-verify-jwt`) and Scott sets the function
secret + `OWNER_ENRICH_WEBSEARCH_SECRET`, then on Railway sets
`OWNER_ENRICH_WEBSEARCH_URL=https://<ops-ref>.supabase.co/functions/v1/owner-contact-websearch?key=<secret>`.
Until then the adapter stays `unconfigured` (exact current behavior —
deploy-order safe). Optional knobs: `WEBSEARCH_MAX_RESULTS` (10),
`WEBSEARCH_TIMEOUT_MS` (8000), `WEBSEARCH_COUNTRY` (us).

### Verify live (Cowork, after activation)
Fire `lcc_cron_post('/api/owner-contact-enrich-tick?limit=25', …)`: the web step
returns results for a real high-value owner, the parser extracts a labeled
principal (or abstains → manual), the worker attaches a guard-passed contact, a
value-floor owner gets a seeded cadence, and a ≥$1M owner appears in the
work-surface focus session (top value climbing toward the $1M+ owners).
Spot-check a couple of attached names against their source URL (no wrong-person
attaches).

### Boundaries / verified (headless 2026-06-27)
The LCC parser/guards/confidence are DONE — the proxy is ONLY a search fetcher
(do not rebuild/loosen them). Free-tier provider; resilient to failure;
reversible (each attach = a person entity + relationship + pivot pointer; unset
the env to disable). `test/owner-contact-websearch.test.mjs` (12: Brave/Serper
field-mapping, cap, malformed→[], provider switch, never-throws, end-to-end
proxy→parser). `node --check` clean (normalize.js); `ls api/*.js | wc -l`=12 (the
edge fn is NOT an api/*.js); no migration; full suite **1562 pass / 0 fail / 6
skipped**.

## Owner cross-reference resolver — reuse a contact from a RELATED owner (2026-06-27)

The FRONT of Scott's ownership-resolution chain, done FREE on the records we
already hold. Scott's real method for an owner's decision-maker is a public-records
chain: County (LLC → owner + address) → State SOS (managing member / registered
agent) → **cross-match the overlapping names/addresses against our existing
contact/company records + naming structure** → web/people-search only LAST (for
phone/email, once identity is known). The owner-contact-enrich worker's cross-ref
step (step 1 of external enrichment, ahead of SOS/address/deed/web) was a no-op
stub; this round makes it real. Web search (Brave) stays the parked last step.

### The resolver (DB engine + JS adapter)
- **`lcc_resolve_owner_cross_reference(p_entity_id uuid)`** (LCC Opps, migration
  `20260722140000`): for a CONTACTLESS owner, returns the SINGLE best reusable
  person from a RELATED owner, or no row. Three strategies, priority order:
  - **`same_asset`** — a co-owner of the SAME property (`owns`-edge to a shared
    asset entity). The LCC-grounded form of "shared records/address" (see below).
  - **`same_parent`** — the R5/R6 `lcc_resolve_buyer_parent` parent / SPE family.
  - **`naming_core`** — a DISTINCTIVE shared name-core (whole-token overlap):
    multi-token core OR a distinctive single token (≥ 8 chars, not in an
    industry/geo denylist). Picks the SOURCE owner's own designated active contact
    (its pivot `active_contact_entity_id`) first, then a title-seniority-ranked
    BD/principal (Starwood REIT reuses Starwood Capital Group's designated contact).
  - Guarded in SQL (`lcc_looks_like_person` / `lcc_is_rejected_contact_name`,
    never reuses an operator's contacts) AND the JS adapter re-applies
    `looksLikePersonName`/`isImplausiblePersonName` (defense-in-depth). No confident
    match ⇒ `no_sibling` → the worker flows on to SOS/web/manual, never a guess.
  - **R7 caching:** the guards are per-row-expensive, so the reusable-contact set
    is materialized into `lcc_reusable_owner_contacts` (cache table, ~599 rows,
    `first_token`-indexed for the naming prefilter) refreshed by cron
    `lcc-reusable-owner-contacts-refresh` (hourly :23). Empty cache ⇒ resolver
    returns nothing (cache-or-live safe; a stalled cron only costs YIELD).
- **`api/_shared/owner-cross-reference.js`** — `buildCrossRefAdapter({opsQuery})`
  (the worker's `crossRef` dep; calls the RPC + JS guards) + `crossRefDryRun`
  (sizing) + pure naming-policy helpers (`sharedCoreOf` / `isDistinctiveSharedCore`
  / `namingCoreMatches` / `isReusablePersonName`, unit-tested). Wired into
  `owner-contact-enrich.js` `buildDeps()`; an attach records
  `via='cross_reference:<strategy>'` + the source entity for provenance.
- **Dry-run** (`GET /api/owner-contact-enrich-tick?xref_dryrun=1[&min_value=&limit=]`
  → `lcc_cross_reference_worklist_preview`): sizes the per-strategy yield over the
  value-ranked contactless worklist (no writes) + a sample of (owner → reused
  contact, source) pairs, BEFORE any real run. Bounded to the value-ranked head
  (`same_parent`'s per-row buyer-parent resolution makes a full 3,519-row sweep
  ~53s; the ≥$1M head [357] is ~6.5s — use min_value to bound it).

### Unit 2 — extend pivot-ensure to non-bridged high-value worklist owners
Grounded: the naming-resolvable owners (Starwood ×2, Palestra) are bridged but
carry NO captured manager/agent signal, so they were NOT in `v_owner_active_contact`
and `lcc_ensure_owner_pivot` was a no-op for them → the enrichment worker (and its
cross-ref step) could never reach them. `lcc_ensure_owner_pivot` now falls back to
a minimal `manual_research` pivot (`active_source='worklist_fallback'`) for a
valued contactless WORKLIST owner with no signals — additive (only creates MORE
pivots), bounded to worklist owners, reversible. (The original Unit-2 premise —
"pull captured signals into pivots for high-value owners" — was already satisfied:
0 of the 49 signal-bearing worklist owners lacked a pivot.)

### Grounded yield (honest — small today, correct mechanism)
Live 2026-06-27: owner entities carry NO notice/recorded address in LCC (0/3,519),
so "shared address" is reinterpreted as same_asset (0 on the worklist — assets are
single-owner). Only ~66 owner entities have any reusable person contact (mostly
buyer parents, EXCLUDED from the worklist), so same_parent ≈ 0 on the worklist.
**naming_core is the real, SAFE yield: Starwood REIT/Property Trust → Starwood
Capital Group (Adam Kamlet); Palestra Properties → Palestra Real Estate Partners
(Vincent Curran)** — ≥$1M = 2, full worklist = 3. The guard correctly REJECTS the
wrong-family single-common-token matches grounding surfaced (Thomas Properties →
Thomas Taft Jr; Healthcare Trust → Healthcare Property Advisors; Sage Hills → Sage
Capital). The yield grows as the contact graph densifies (web-search / SF
acquisition attach contacts to more owners) and across the broader/pivot population.

### Verified live (2026-06-27, reversible / 0 residue)
Resolver resolves the 3 owners (all naming_core; Starwood reuses Starwood Capital's
OWN designated decision-maker). Attach round-trip: with the reused-contact edge,
Palestra LEAVES the contactless worklist (`in_worklist_with_contact=false`);
reverting restores it; 0 residue (edge + fallback pivot deleted). Unit-2 ensure
creates a reachable fallback pivot for the non-signal owner.
`test/owner-cross-reference.test.mjs` (25: naming policy keeps Starwood/Palestra,
rejects Thomas/Healthcare/Sage; adapter hit/no_sibling/guard_rejected/no_entity/
error; dry-run tally + guard-drop). `node --check` clean; `ls api/*.js | wc -l`=12;
full suite **1587 pass / 0 fail / 6 skipped**. DB applied live + committed; JS
ships on the Railway redeploy. LCC-Opps only; no dia/gov writes; auth schema
untouched.

### After deploy (Cowork verifies live)
`GET /api/owner-contact-enrich-tick?xref_dryrun=1&min_value=0` sizes the yield;
the worker's batch/Phase-5b run attaches the Starwood/Palestra reused contacts to
the high-value owners, seeds a cadence (the `maybeSeedValuableCadence` wire), and
they surface in the outreach focus session. Spot-check the reused person against
its source owner (no wrong-family reuse). Reverse a batch via the
`via='cross_reference:*'` relationship metadata + the `worklist_fallback` pivots.
## T9d — provenance-first dia listing currency: recover dates, keep every evidenced deal (2026-06-27)

Replaces the rejected exclusion-based T9d (reverted). **Doctrine (Scott, 2026-06-26):** a
listing is an "available for sale" deal if we hold ANY real source (OM / flyer / email /
fax / comp / CoStar-RCA capture). A live URL is NOT required (commercial has no MLS — never
100%). So: KEEP every provenance-backed listing, recover its true on-market date from the
document, infer exits conservatively, and window currency = **entry + exit + a generous
age-out backstop** (NOT a live re-check — 0/323 dia listings were ever URL-checked). dia
`zqzrriwuavgrquhisnoa`. Constructive, reversible, no fabricated dates, dia only, ≤12 api/*.js.

### The recovery key (grounded live 2026-06-27)
OM/flyer artifacts are stored at intake under `lcc-om-uploads/YYYY-MM-DD/<uuid>-…` where the
date segment is the OM's **receipt date**. **242/242** NULL-`on_market_date` listings that
carry an artifact have a parseable path date (their `created_at` is NULL; their `listing_date`
is the fake `capture_date_fallback`). The path date is real evidence recoverable **entirely
within dia** — no cross-DB lookup to LCC `staged_intake_items` needed.

### Unit 1 — recover on_market_date from provenance (dia migration `20260627_dia_t9d_…`)
- **`om_receipt`** (NEW source, confidence `medium`): fill `on_market_date` for the 242 held
  (`unestablished`) rows from the artifact path date (T4c `sf_on_market_date` rows kept as-is;
  genuine capture / `unestablished_historical` untouched).
- **`date_uncertain`** (NEW source, confidence `none`): the provenance-backed-but-undated
  remainder (270 rows — intake-artifact-type / OM-email-harvest `listing_date_source` /
  data_source / seller / broker / raw_text) is KEPT + flagged, `on_market_date` left NULL so
  it drops off the time axis **honestly, never deleted**. Rows with NO provenance at all
  (270, 24 of them active) stay `unestablished` — the only excludable set.
- `listing_date` is LEFT RAW/audit (never overwritten). Reversible: full prior mutable state
  in `t9d_listing_omd_backup` (782 rows). Idempotent (a replay recovers 0).

### Unit 2 — currency model: keep every deal, window it (membership rebuild)
`cm_dialysis_active_listings_m`/`_q` membership is now: **`on_market_date` present + non-
synthetic (real provenance) AND `on_market_date <= period_end` AND no exit by `period_end`
(`off_market_date`/`sold_date`) AND `(period_end - on_market_date) <= 1356d`** (the p90 closed
DOM — a generous lost-track AGE-OUT backstop, NOT a pruner). **RETIRED:** the
`last_seen`/`url_last_checked`/`last_verified_at`/`listing_date` currency PROXY, the
`listing_date` entry gate, AND the `is_active`/status TODAY-state gate (verified 0 closed-
no-exit rows sneak in; point-in-time availability = entry + exits). **KEPT:** the synthetic
guards (`data_source<>'synthetic_from_sale'`, `listing_date_source NOT LIKE 'sale_anchor%'`)
+ a NEW `on_market_date_source NOT LIKE 'synth%'` guard (catches the 571 `…_held` synth-dated
rows the data_source guard misses). `days_on_market = period_end - on_market_date` is now
honest. **This supersedes the 2026-06-24 "keep the dia freshness gate" exception (gov
unchanged).**

### Unit 3 — fix the ingest path so this stays accurate (the durable half)
`api/_shared/listing-date.js` `omReceiptDateFromArtifactPath(storagePath)` (pure, tested);
`intake-promoter.js` `buildDiaListingRow` + `buildGovListingRow` now, when `deriveOnMarketDate`
HOLDs (no snapshot signal), fall back to the artifact storage-path receipt date
(`om_receipt`/`medium`) instead of leaving it HELD — so a newly-ingested OM lands at its real
on-market date and the `capture_date_fallback` surge cannot re-form. Never a future date.

### Unit 4 — close-on-sale landmine + orphan repair
`fn_listing_close_if_sold` hardened: anchor the sale-match window on `COALESCE(on_market_date,
listing_date)` (was "any past sale" when `on_market_date` was NULL → could close against an
old/unrelated pre-market-entry sale); `v_ref IS NULL ⇒ never auto-close`; bound the match
BOTH sides (`v_ref-90d … LEAST(today, v_ref+1356+180d)`); guard a dangling txn id. Repaired
the orphaned `property_sale_events.sales_transaction_id=5701` (NULLed; 414 such danglers total
— surfaced for a separate sweep).

### Verified live (2026-06-27)
0 rows deleted (5080 → 5080). Recovery: 242 `om_receipt`, 270 `date_uncertain` (kept), 270
no-provenance `unestablished`; 0 surprise auto-closes during recovery; orphan 5701 repaired;
re-run recovers 0 (idempotent). **2026-03-31** (the published quarter): 122 → **195** distinct
properties — a deliberate, footnoted **restatement** (Scott: 122 was "fabricated"); the
canonical Round-74 set reconciles at 195 across `inventory_backlog_m.active_count` /
`available_market_size_q` / `available_by_term_bucket`. **2026-06-30** (impending): the fake
surge 273 → **230** honest (92 `om_receipt` real recent OMs + 28 sf + ~108 historical; the
no-recoverable-date rows correctly drop off the axis but are KEPT/surfaced as `date_uncertain`).
DOM at 2026-03-31: median 504.5d (was ~1328), p90 1052, max 1329 (≤ cap); cap median 6.48%.
`node --check` clean (listing-date.js, intake-promoter.js); listing tests 42/42; ≤12 api/*.js.
DB applied live + committed; JS ships on the Railway redeploy.

### Reversibility / boundaries
Reverse rows from `t9d_listing_omd_backup`; restore the prior view bodies (Round 74 / T4c) +
the prior `fn_listing_close_if_sold` + re-set pse 5701. No domain deletions; gov pipelines +
gov CM views untouched; auth schema untouched. The 270 `date_uncertain` + the 414 remaining
orphan pse danglers are SURFACED for follow-up, not silently dropped.

## ORE Phase 1 Unit C — capture deed grantee/grantor mailing addresses (2026-06-27)

Owner mailing/notice addresses — the signal Scott's ownership cross-match keys on — existed for
<1% of owners even though we parse deeds constantly: `parseDeedText` (`api/_handlers/deed-parser.js`)
FOUND the "whose address is" / "after recording return to" addresses, then `leadingEntityName()`
**stripped** them during party-name extraction, and `deed_records` had no address column — so
~100% of deed-borne owner addresses were discarded. This is the address dimension that made the
CONTACT-SELECTION cross-reference resolver's `same_address` strategy return 0.

### Keep, don't strip (parser)
A new shared `partySpanBeforeMarker()` feeds BOTH the name extractor (`leadingEntityName` →
cleaned NAME, **byte-identical** — the R59b OCR-trim + deed-of-trust-null tests still pass) AND a
new `extractPartyAddress()` (the "whose address is …" tail). `extractReturnToAddress()` is a
GUARDED grantee fallback for the "after recording return to / mail tax statements to" block
(rejects title/escrow-company blocks; stops at a secondary directive header like "Send Tax Bills
to"). `parseAddressParts()` best-effort-splits {street,city,state,zip}; the full string is always
kept. `parseDeedText` now sets `grantee_address`/`grantor_address` (+ `_parsed`).

### Store (audit) + propagate (actionable)
- `processDeedDocument` Step 3 writes the full strings to `deed_records.grantee_address`/
  `.grantor_address`; the structured parts already ride `extracted_data.deed_extraction`.
- `propagateDeedToBd` Unit C: the grantee owner is resolved once (shared with the Unit-1b
  ownership_history append), then `writeOwnerMailingAddress` (`sidebar-pipeline.js`, wired into the
  `document-text.js` PROD_DEPS) fills the owner mailing address **fill-blanks** + provenance
  `source='recorded_deed'` via `shouldWriteField`: **gov** → new `recorded_owners.mailing_address`;
  **dia** → the existing `recorded_owners.address`/`city`/`state`. Gated on the dep (absent ⇒
  no-op, byte-identical to pre-Unit-C) AND a guard-passed grantee (`granteePassesOwnerGuards` — a
  brokerage/federal/junk grantee never gets an owner write). Reversible; idempotent.

### Migrations (additive, applied live)
gov `government-lease/sql/20260627_gov_ore_phase1c_deed_party_addresses.sql` (deed_records
addr cols + recorded_owners.mailing_address), dia
`Dialysis/supabase/migrations/20260627_dia_ore_phase1c_deed_party_addresses.sql` (deed_records
addr cols), LCC `supabase/migrations/20260627120000_lcc_ore_phase1c_deed_address_priority.sql`
(`recorded_deed`=3 field_source_priority on gov.recorded_owners.mailing_address +
dia.recorded_owners.address/city/state). DB-first (apply before the Railway redeploy of the
parser); `v_field_provenance_unranked` unchanged.

### Re-parse rides the deed OCR backfill
Forward deeds capture addresses automatically. The existing corpus needs the R58
`document-text-tick` deed drain (OCR scanned deeds → re-run the now-address-capturing parser);
gated on `OPENAI_API_KEY`/Document AI + CoStar-CDN reach (operational, handed to Scott) — Unit C
does NOT duplicate it.

### Verified (2026-06-27)
Dry-run (read-only) re-parsed the 11 dia deeds carrying an address marker → 5/11 grantee + 1/11
grantor addresses, all clean + correctly parsed; caught + fixed a return-to over-capture (deed
1797). `test/deed-parser.test.mjs` (+address capture, name-no-regression, Unit C propagation) +
`test/owner-deed-propagation.test.mjs` (+`writeOwnerMailingAddress`). `node --check` clean; `ls
api/*.js | wc -l`=12; full suite **1607 pass / 0 fail / 6 skipped**. JS ships on the Railway
redeploy. Full design: `government-lease/docs/OWNERSHIP_RESOLUTION_ENGINE.md` (Phase 1 Unit C).
## T9d FIX — om_receipt was the IMPORT date, not the market-entry date (2026-06-27)

The first T9d round (above) recovered `on_market_date` for 242 held dia listings
from the artifact storage path `lcc-om-uploads/YYYY-MM-DD/…`. **That path date is
the IMPORT date, not the OM's true email date** — for the mass-forwarded historical
batch all 242 landed 2026-04-25 → 2026-06-23, **re-creating the very surge T9d set
out to remove** (92 inflated the impending 2026-06-30 count). The true original
email date is NOT recoverable: `staged_intake_items.source_email_date` is empty for
the historical batch (populated only for the 8 new-flow items). dia
`zqzrriwuavgrquhisnoa`. Reversible, no fabricated dates, dia only, ≤12 api/*.js.
**Kept T9d2 Unit 2 (entry/exit/cap model) + Unit 4 (close-on-sale + pse 5701) as-is.**

### Unit 1 FIX — reclassify the 242 `om_receipt` rows → `date_uncertain`
Migration `supabase/migrations/dialysis/20260627_dia_t9d_fix_om_receipt_date_uncertain.sql`
(applied live): NULL `on_market_date`, set `on_market_date_source='date_uncertain'`
(confidence `none`) — KEPT as evidenced inventory (we hold the OM) but OFF the time
axis. **Never use the upload/path/`capture_date_fallback` date as a market-entry
date.** Reversible from `t9d_listing_omd_backup` (NEW `batch_tag='t9d_fix'`,
change_kind `fix_om_receipt_to_date_uncertain`, 242 rows). Idempotent (a re-run
reclassifies 0 / inserts 0).

### Unit 2b — surface the cap inference (confirmed vs assumed_active)
`cm_dialysis_active_listings_m`/`_q` gain an APPENDED `currency_basis` column (the
entry/exit/cap membership model is UNCHANGED; only the inner CTE now carries
`off_market_date`/`sold_date` to compute it):
- **`confirmed`** = a recorded exit AFTER period_end (`off_market_date`/`sold_date`
  > period_end) → positively observed on-market at period_end (entered ≤ pe, left
  > pe). The cap is irrelevant to these.
- **`assumed_active`** = no recorded exit → membership rests on "we never saw it
  leave," bounded solely by the 1356d age-out cap. These are the cap-dependent
  rows the report now makes visible.
New summary view **`cm_dialysis_currency_basis_m`** (period_end → confirmed /
assumed_active counts, both listing- and distinct-property-grained) so the
cap-dependent set is a first-class, visible number, not hidden.

### Unit 3 FIX — ingest is forward-safe (never the upload path / clock)
`api/_shared/listing-date.js`: **`omReceiptDateFromArtifactPath` REMOVED** (the
rejected path-date helper). `api/_handlers/intake-promoter.js`: `promoteListing`
fetches `staged_intake_items.source_email_date` and threads it to
`buildDia/GovListingRow`; the builders derive `on_market_date` from a GENUINE
signal only — explicit on-market date / DOM / `source_email_date` (all via
`deriveOnMarketDate`) — and HOLD as `date_uncertain` otherwise. **Never the upload
path / `capture_date_fallback` / today**, so the surge cannot re-form.

### Verified live (2026-06-27)
`om_receipt` 242 → **0** (0 dated 2026); `date_uncertain` 270 → **512** (+242);
total listings **5080 → 5080 (0 evidenced deals dropped)**; backup `t9d_fix` = 242
(reversible); idempotent re-run = 0/0. **2026-03-31** (published quarter):
**195 distinct properties** (canonical Round-74 count intact) — **61 confirmed /
134 assumed_active** (the auditor's "~87 cap-dependent" was an estimate; the actual
no-recorded-exit count is 134, reported honestly). **2026-06-30** (impending): the
fake surge **230 → 138** properties — gone. `node --check` clean (intake-promoter,
listing-date); listing tests green; full suite **1589 pass / 0 fail / 6 skipped**;
`ls api/*.js | wc -l`=12. DB applied live + committed; JS ships on the Railway
redeploy.

### Reversibility / boundaries
Reverse via `t9d_listing_omd_backup` (`batch_tag='t9d_fix'`) + `DROP VIEW
cm_dialysis_currency_basis_m` + re-create the two membership views from the prior
T9d migration. No domain deletions; gov untouched; auth schema untouched.

## ORE Phase 1 Units B+D — capture owner phone/email (stop dropping it) (2026-06-28)

We already RECEIVE owner phone/email/(mailing) address in CoStar captures but
dropped them TWICE — once at the sidebar (owner write was name+address only) and
once at the entity layer (the field whitelist deleted phone/email for every
non-person entity). Owners are `organization` entities, so a captured owner
decision-maker's contact details never landed. These two units lift both drops so
the owners we capture are REACHABLE (feeds CONTACT-SELECTION, the outreach-draft
recipient resolution, and the cross-reference resolver). Free, guarded,
fill-blanks, reversible. LCC + gov writes only; no new api/*.js (≤12); no
migration (every column already exists — see below).

### Unit B — owner ORGANIZATION entities carry phone/email/(mailing) address
`api/_shared/entity-link.js`:
- **`pickSeedFields` (the choke point)** — the `if (entityType !== 'person')
  { delete phone/email }` + address-person/asset-only gates are lifted for
  **`organization`**: an org now RETAINS `phone`/`email`/`address`/`city`/`state`/
  `zip`/`county`. Persons unchanged; **assets still drop phone/email** (an asset
  is not a contact). Org contact VALUES are guarded — a malformed email
  (`normalizeEmail` fails) or a no-/few-digit phone (`looksLikeContactPhone`,
  7–15 digits) is dropped, never stored as junk. The LCC `entities` table already
  has `phone`/`email`/`address`/`city`/`state`/`zip`/`county` (verified live) — so
  **no migration**, just the type-gate lift.
- **`inferEntityType`** — an EXPLICIT `company`/`organization`/`org` sourceType now
  maps to `organization` BEFORE the `email||phone||first||last → person` heuristic,
  so a captured owner org carrying phone/email (now seeded — Unit D) is not
  mis-inferred as a person. The firm-suffix person→org retype in `ensureEntityLink`
  is unchanged (still catches firm-suffixed person mistypes). New exported helper
  `looksLikeContactPhone`; `pickSeedFields` exported for unit testing.

### Unit D — carry CoStar owner phone/email through to the owner write
`api/_handlers/sidebar-pipeline.js`:
- **`contactSeedFields`** — emits `email`/`phone` for **organization** contacts
  (was person-only), so `unpackContacts` → `ensureEntityLink` carries an owner
  org's phone/email onto the org ENTITY (Unit B retains it). This is the BD-graph
  leverage point — the entity is what the outreach draft / cross-ref read.
- **`selectAuthoritativeOwner`** (exported) — now decorates the chosen owner with
  a uniform normalized `{ phone, email, address }` (`ownerReachableDetails`):
  first VALID phone from `phones[]`/`phone`, `normalizeEmail`'d email **dropping a
  generic/role inbox** (`isGenericInboxEmail` — info@/sales@ is a firm mailbox,
  not the owner decision-maker), and the trimmed address. A sales-history buyer
  fallback carries name+address only (no contact details). The owner NAME stays
  federal/junk-guarded upstream.
- **`ensureRecordedOwner(name, address, contact)`** — the optional `contact`
  (`{phone,email}`, guarded again inside) is persisted on the owner record:
  **gov** → the existing `contact_info` jsonb (now `{address,city,state,phone,
  email}`; built whenever ANY reachable detail exists, even with no address — a
  phone-only owner still gets `contact_info`). Threaded from both real call sites
  (the role=owner contacts loop via `ownerReachableDetails`, and the
  authoritative-owner history block). Sale buyer/seller calls pass no contact
  (name only). `contactSeedFields` exported for unit testing.

### dia recorded_owners — phone/email land on the ENTITY, not the domain row
`dia.recorded_owners` has `address`/`city`/`state` but **no phone/email column**
(gov has the `contact_info` jsonb). Per the task's "phone/email columns if
present" clause, dia owners' phone/email are captured on the LCC **entity** (Unit
B, both domains uniformly — that is the surface outreach/cross-ref consume), and
the dia row gets address only (unchanged). **Follow-up (NOT in this round):** an
additive `dia.recorded_owners.phone`/`email` migration + `field_source_priority`
rows (+ provenance wiring) would make the dia domain row symmetric with gov — a
separate blessed change (touches the provenance registry / drift detector).

### Boundaries / verified (headless 2026-06-28)
Fill-blanks, guarded (junk/broker/federal name guards unchanged; generic-inbox +
malformed-value guards added for phone/email), reversible (entity rows; gov
contact_info). No new api/*.js (`ls api/*.js | wc -l`=12); no migration (all
columns pre-exist). `test/entity-link.test.js` (+Unit B: org retains phone/email/
address, drops malformed values; person/asset unchanged; `looksLikeContactPhone`)
+ new `test/owner-contact-capture.test.mjs` (Unit D: `selectAuthoritativeOwner`
carries phone/email/address, drops generic-inbox + malformed phone, picks first
valid phone, federal-fallback, sales-history name-only; `contactSeedFields` emits
org phone/email). `node --check` clean (entity-link, sidebar-pipeline); full suite
green. JS ships on the Railway redeploy; dia/gov pipelines otherwise untouched;
auth schema untouched.

### Live proof (Cowork, after deploy)
A new CoStar owner capture with a phone/email lands on the owner ENTITY (both
domains) + the gov `recorded_owners.contact_info`; a spot-check owner that was
name-only before now shows a reachable phone/email.
