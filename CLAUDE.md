# Claude Code / Cowork Instructions — Life Command Center

> **🧭 START HERE for architecture: [`LCC-OS.md`](LCC-OS.md) → `docs/os/README.md`.**
> **Operational reference (surfaces, comps engine, deploy map, Cowork setup):** [`docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`](docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md) + [`docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md`](docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md).
> One brain (LCC + Cortex), one instruction/policy canon (`docs/os/canon/`), many surfaces (Copilot, Claude
> Personal/Cowork, Northmarq Claude, ChatGPT). Edit rules in the canon, bump the version, run
> `docs/os/SURFACE-SYNC-PROTOCOL.md` to update every surface. **Never start from scratch, never fork a source,
> never overwrite canon without bumping its version.** Consolidation map: `docs/os/REGISTRY.md`.

> **CRITICAL: Read `.github/AI_INSTRUCTIONS.md` before modifying any files in `/api/`.** It carries the full
> routing/architecture reference and any lettered-section footguns.

> **This file is the durable reference — architecture invariants, DB topology, naming, write-surface rules,
> doctrines, and known footguns.** The full round-by-round worklog (R5→R64, ORE, CONNECTIVITY, UI phases, SF
> reconcile, etc., through 2026-07) was moved verbatim to **[`docs/history/CLAUDE_full_2026-07.md`](docs/history/CLAUDE_full_2026-07.md)** —
> grep there for the implementation log of any specific round. Add durable invariants here; leave per-round
> narrative in history.

---

## ⚠️ PRODUCTION RUNS ON RAILWAY (Vercel retired 2026-07-20)

The live app is the **Railway Express server**: `server.js` mounts the `/api/*` handlers directly
(e.g. `app.all('/api/capital-markets', capitalMarketsHandler)`); build config in `nixpacks.toml` +
`railway.json` (healthcheck `/health`). **`server.js` is the SINGLE source of truth for `/api/*` routing** —
add a route there (sub-routes via `?_route=`). **There is no serverless-function cap.** `vercel.json` is
deleted (Vercel retired after 40+ failed deploys against the old Hobby 12-function cap).

- **JS/code changes ship via a Railway redeploy of merged `main`.**
- **After a redeploy, run the deploy gate:** `npm run verify:deploy` — compares live `/version` to the merge
  SHA and probes that critical routes return JSON, not the SPA HTML. A GET to an unmounted `/api/*` path now
  returns a real JSON 404 (server.js API-scoped 404), never the SPA HTML with a 200, so a stale deploy can no
  longer look healthy.
- **Supabase view/migration changes are live immediately** — the CM export reads views per request
  (`no-store`), so data-layer fixes need no deploy.

## Rules

0. **`LCC_API_KEY` auth is production-ready.** Frontend `auth.js` auto-injects `X-LCC-Key` via a global fetch
   interceptor. To enforce: set `LCC_API_KEY` + `LCC_ENV=production` in the Railway env — **in that order**.
   Flipping `LCC_ENV` first (key empty, no `OPS_SUPABASE_URL` JWT path) 401s every request = **total sign-in
   lockout**. Verify readiness first via `GET /api/diag?kind=auth-ready` (`would_pass_in_production` must be
   true). Runbook: `docs/AUTH_ENFORCEMENT_ROLLOUT.md`.
1. Prefer adding endpoints as **sub-routes** of an existing handler (`?action=` / `?_route=`). A brand-new
   `api/*.js` is allowed (no platform cap now), but the sub-route pattern keeps related routes in one handler.
   Historically the codebase held **≤12 `api/*.js`**; many round logs cite that count — it is a structure
   convention now, not a hard limit.
2. New utility/handler code goes in `/api/_shared/` or `/api/_handlers/` — never a new top-level `api/*.js`
   unless deliberate.
3. **Mount every new route in `server.js`.** `test/operations-subroutes.test.mjs` guards that every
   server.js-mounted `_route` has a matching dispatch.
4. Descriptive, Round-numbered commit messages — never generic "GPT changes".
5. `.github/AI_INSTRUCTIONS.md` is the full architecture + routing reference.

## Architecture Quick Reference

- **LCC orchestrates; domain Supabase backends execute domain logic.**
- Consolidated handlers: Contacts + Entities → `entity-hub.js` (routes to `_handlers/`); Bridge + Workflows →
  `operations.js`; Intake → `intake.js`; `admin.js` = workspaces, members, flags, connectors, diagnostics
  (config/diag/treasury), edge proxies (data-query, daily-briefing).
- **Supabase Edge Functions:**
  - **`data-query`** + **`daily-briefing`** deploy on the **Dialysis_DB** project (ref `zqzrriwuavgrquhisnoa`)
    — `api/admin.js` `DATA_QUERY_EDGE_URL` hard-codes that ref. When you bump the data-query allowlist (e.g.
    add an RPC or a read table/view), **deploy to that project, not LCC Opps** (see the allowlist footgun below).
  - `availability-checker`, `artifact-offload`, `docai-ocr`, `owner-contact-websearch` (paused) live on
    **LCC Opps** (`xengecqvemvfknjvbvrq`).
- **`lcc_cron_post()`** reads the API key from Supabase Vault and POSTs via `pg_net` to Railway (`/api/*`) or
  Edge endpoints. pg_cron on LCC Opps runs the scheduled sweeps (queue/decision refresh, health checks,
  offload, syncs, reconciles). Grep the history file for the exact schedule of a named job.

### Database topology (3 projects)

| Project | Ref | Role |
|---|---|---|
| **LCC Opps** | `xengecqvemvfknjvbvrq` | The brain: entities, BD spine, priority queue, decisions, cadence, provenance registry, health alerts, **auth (GoTrue)**, most crons. |
| **Dialysis_DB (dia)** | `zqzrriwuavgrquhisnoa` | dia domain: properties, leases, sales, listings, CMS/medicare_clinics. Hosts the `data-query`/`daily-briefing` edge functions. |
| **Government (gov)** | `scknotsqkcheojiaewwh` | gov domain: GSA-leased properties, leases, sales, listings, deeds. |

## Client routing (UI Phase 1) — hash is the source of truth

The SPA uses **hash routing** (`location.hash`, not History clean URLs) so the Railway static/Express server
needs **no catch-all rewrite**. Empty/unknown hash ⇒ Today. **No PII in the URL** — ids/tab/domain only.

- **Scheme:** `#/<page-slug>[?d=<detail-token>]`. Detail-token: `prop:<db>:<propertyId>:<encodedTab>`
  (→ `openUnifiedDetail`), `entity:<entityId>[:<encodedTab>]` (→ `openEntityDetail`), or
  `sub:<lease|sale>:<db>:<id>` (→ `openSubDetail`). Example: `#/dia?d=prop:dia:24703:Overview`.
- **slug↔pageId map:** `ROUTE_SLUG_TO_PAGE` in `app.js` (reverse `ROUTE_PAGE_TO_SLUG`; legacy aliases
  `ROUTE_PAGE_ALIAS`, e.g. pageMyWork→pagePipeline). `dia`/`gov` are bnav shortcuts rendering `pageBiz`.
- **READ side:** `applyRoute()` is the single `hashchange` + initial-load handler (`_routeParseHash` never
  throws); it drives `navTo` + `openUnifiedDetail`/`openEntityDetail`/`switchUnifiedTab` and does NOT duplicate
  render paths. **WRITE side:** nav + open/close helpers set the hash. **Loop guard:** `_routerApplying` no-ops
  writers while `applyRoute` runs; writers skip when the desired hash equals the current one.
- **Zoom model (4A–4C, COMPLETE):** `_detailStack` (app.js) mirrors the chain of open detail levels; one stack
  level == one `?d=` history entry. In-panel "← Back" (`detailBack()`) + breadcrumb drive `history.back()`;
  `applyRoute` reconciles the stack (`_detailStackSync`, idempotent). Entity/owner detail (`openEntityDetail`)
  renders the SAME slide-over shell as `openUnifiedDetail` (tabs, completeness rail, Next-Step). **Portfolio is
  authoritative** — `GET /api/entities?action=portfolio&id=<uuid>` (BD spine), not a fuzzy name-match.
  **Next-Step reads `v_priority_queue_enriched`** via `/api/priority-band?entity_id=` — same truth as the
  Priority Queue / Decision Center. Deeper-than-top levels are not persisted across reload (best-effort).

---

## Core doctrines (apply to every change)

### Producer/Consumer (Consumption Layer)

LCC produces work (research tasks, cadences, decisions, queue rows, inbox items) at ingestion scale and
historically under-consumed it, so surfaces filled with un-worked noise that buried the actionable few (the
worst failure mode: a `5,447` / `999+` badge that is mostly noise trains the operator to ignore the surface).
**Every code path that emits operator-facing work MUST satisfy all five:**

1. **Value-gate the producer.** Emit only above an actionability/value floor — never one item per captured row.
   The floor is a single tunable knob (e.g. `$500k` chain-task floor; `CADENCE_SIGNAL_MIN_VALUE`).
2. **Auto-retire + auto-resolve.** A scheduled sweep closes items whose premise cleared and auto-resolves the
   high-confidence subset, leaving genuine judgment calls for a human. Reversible — pause/skip with a reason,
   **never hard-delete**.
3. **Surface actionable-only, value-ranked, capped** (top-N, with a "show all" toggle).
4. **Close the loop from real activity** (Salesforce/Outlook activity → cadence advance) rather than a separate
   manual queue.
5. **Honest counts** — every badge is actionable work, not raw output.

**No new producer ships without:** a named consumer (human verdict, worker, or auto-sweep — if none, don't
build the producer); a value-gate; an auto-retire predicate; a ranked/capped actionable-only surface; and where
possible reality-driven advance.

### Data-write discipline (used by nearly every round)

- **Fill-blanks only** — never clobber curated data; only fill NULL/blank fields, or overwrite when the source
  is explicitly more authoritative (priority-gated, below).
- **Conservative / unambiguous matching** — surface ambiguity to a review lane; **never guess**.
- **Provenance-tagged, reversible, idempotent, dry-run-able.** Prefer a snapshot/backup table + a
  `source`/`batch_tag` you can reverse by, over any destructive change. Soft-flag (`metadata.*_flagged`) instead
  of deleting.
- **Never fabricate** — a field the source doesn't state stays blank; a contact/owner is never invented.

### Deploy ordering (constant rule)

When a change spans DB + JS: **apply the additive/DB migration first, then ship the JS on the Railway
redeploy.** A DB `CHECK` constraint that enforces new writer output must be applied **AFTER** the writer deploy
(else the still-deployed old writer 500s every write). "Constraint after writer deploy; additive schema before."

### Single-advance-owner (cadence)

`advanceCadence()` (`api/_shared/cadence-engine.js`) is the **single owner** of a cadence advance. Every JS
human-touch writer that advances a cadence tags its `activity_events` row `metadata.skip_cadence_advance='true'`
so the SQL `lcc_activity_event_advance_cadence` trigger skips it — each activity advances exactly once. The
trigger remains the advance owner only for unflagged organic activities.

---

## Field-level data provenance (LCC Opps)

Every cross-table field write to curated tables is observed:

- **`field_provenance`** — append-only log keyed `(target_database, target_table, record_pk_value,
  field_name)`; records source, confidence, source_run_id, decision (`write|skip|conflict|superseded`).
- **`field_source_priority`** — per-field source ranking. **Lower priority = higher trust.** `enforce_mode` is
  `record_only | warn | strict` for gradual rollout. Representative ladder for an owner/recorded field:
  `manual`(1) > `recorded_deed`(3) > `county_records`/`sos_registry`(5–55, source-dependent) >
  `om_extraction`(30–50) > `costar_sidebar`/aggregators(50–70). Consult the row before writing.
- **`lcc_merge_field()`** — the single SQL function that records provenance and returns the write decision;
  application paths consult it. In `record_only` mode UPDATEs still run.
- **`v_field_provenance_unranked`** — schema-drift detector. **Should return 0 rows** — non-zero means a writer
  path was added without a matching `field_source_priority` entry. **Whenever you add a new writer/source to a
  curated field, register a `field_source_priority` row** or this view flags drift.
- **`v_field_provenance_actionable`** / `v_field_provenance_current` / `v_field_provenance_conflicts` — drive
  the Decision Center provenance lanes.

Full rollout plan: `docs/architecture/data_quality_self_learning_loop.md`. Schema:
`supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql`.

## OM Intake Pipeline — three channels, one shared path

All three converge on `api/_shared/intake-om-pipeline.js::stageOmIntake`:

1. **Email** (Power Automate flagged-email) → `POST /api/intake?_route=outlook-message`.
2. **Sidebar** (Chrome extension / CoStar capture) → `api/_handlers/sidebar-pipeline.js` (writes domain DBs
   directly; does **not** go through stageOmIntake).
3. **Copilot Studio** → `POST /api/intake/stage-om` → `handleIntakeStageOm`.

- **Email PA footgun:** the HTTP PUT body MUST use `base64ToBinary(items('Apply_to_each')['contentBytes'])`;
  raw `contentBytes` writes base64-text (extractor has a `recoverIfBase64Wrapped` net).
- No OM attachment ⇒ `handleOutlookMessage` synthesizes a `text/plain` artifact from subject+body; the
  extractor feeds `text/*` straight to AI (capped 80K chars vs 200K for PDFs).
- Doctype: `intake-promoter.js::normalizeDocType()` maps extractor synonyms → canonical (`om`/`flyer`/
  `marketing_brochure`); `snapshotLooksLikeListing()` promotes when doctype is null but the data looks like a
  listing.
- Full reference: `docs/architecture/om_intake_pipeline.md`.

### Multi-model AI fallback (extraction)

`intake-extractor.js::callAiExtraction` routes through `invokeExtractionAI` (`_shared/ai.js`): primary
(`invokeChatProvider`, typically Claude via a Supabase edge function) → on 429/5xx walk `AI_EXTRACTION_FALLBACK_CHAIN`
(default `[{"provider":"openai","model":"gpt-4o-mini"}]`) → on final failure sleep 35s + retry primary once.
Requires `OPENAI_API_KEY`. Per-artifact diagnostics record `ai_chain`/`ai_fell_back`/`ai_final_provider`/
`ai_final_model`.

### OCR / document-text foundation

`api/_shared/document-text.js::extractDocumentText` → digital `pdf-parse`; on a sub-floor text layer
(`DOC_TEXT_MIN_CHARS`, exported) falls back to tiered OCR: free OSS (workstation) → **Google Document AI**
(`docai-ocr` edge fn on LCC Opps, cheap-cloud primary, ~$1.5/1k pages) → gpt-4o vision (last resort, flagged).
The `document-text-tick` worker drains scanned deeds; `lease-extractor.js` OCRs thin-text scanned leases.

**LIVE + VERIFIED 2026-08-12 — do NOT re-provision or recommend a new OCR provider from scratch.**
The full chain works end-to-end: Railway `OCR_CLOUD_OCR_URL`/`OCR_CLOUD_OCR_KEY` → `docai-ocr` edge fn
(v19; GET = no-spend health probe echoing the processor) → Enterprise Document OCR processor
`projects/108926230693/locations/us/processors/5ecc6339861c88e1` (GCP project `modular-conduit-450617-h5`).
Registry: `feature_flags_registry.OCR_CLOUD_DOCAI`. Crons 160/167/169 ACTIVE. Full state + runbook:
`docs/architecture/document-capture-and-ocr-status.md` (FINAL STATE box).
- **Footgun (bit us 2026-07→08):** if the edge secret `GOOGLE_DOCAI_PROCESSOR` points at a *Custom
  Extractor* instead of an OCR-type processor, DocAI 400s (`entity_types`) and EVERY scan silently
  falls to gpt-4o at 6–14× cost while receipts still read `enriched`. Symptom: `ocr_tier:'cloud'`
  where `cloud_cheap` is expected → check the health probe's `processor` + the fn's error log.
  The secret is the BARE resource name (no `https://`, no `:process`).
- **Office docs (docx/xlsx) NEVER go to OCR** — `api/_shared/office-text.js` (zero-dep zip+XML)
  extracts them in-process, sniffed from BYTES (the SharePoint PA flow misreports mime as pdf —
  never trust contentType). Legacy OLE `.doc` → terminal `office_no_text:legacy_doc`. Wired in both
  `runLeaseExtraction` and `extractDocumentText` BEFORE the OCR tiers; no config, byte-sniff only.
- **Caps:** DocAI sync ~15 pages (`over_page_cap` → gpt-4o last resort), `INTAKE_OCR_MAX_BYTES` 12MB
  default; bigger scans go off-box via the `ocr_text` resubmit seam
  (`POST /api/intake?_route=lease-backfill&id=<id>`). Optional: `AI_OCR_MODEL=gpt-4o-mini`.

#### Durable document capture-at-ingest (store the bytes, don't defer the fetch)

A captured CoStar doc that stores only a `source_url` (CDN link) becomes **unprocessable later** — CoStar
CDN/signed links are **bound to the browser session**, so a server-side (Railway datacenter) re-fetch at OCR
time gets 403/expired and the bytes never land (this stranded ~86% of `property_documents` across dia+gov).
Fix: capture the durable copy **while authenticated**, into each domain's `property-documents` bucket
(`fetchDocBytes` already prefers `storage_path` over `source_url`). Two paths, both domains, best-effort/additive:

- **Server re-fetch (Build 1, `sidebar-pipeline.js::captureDocumentBytesAtIngest`)** — works for non-session-bound
  (public county / CDN) links AND **SharePoint-filed docs** (`fetchAndStoreDocBytes` detects a server-relative
  `/sites/…` `source_url` and fetches via the Power-Automate "Get Artifact" flow `SHAREPOINT_FETCH_URL` instead of
  HTTP — honest no-op `sharepoint_fetch_unset` when that PA flow isn't configured). Kept as the fallback + the
  **backfill** worker `POST /api/intake?_route=doc-bytes-backfill&domain=dia|gov&limit=&before=<cursor>&source=sharepoint|http`
  (keyset-cursor so an un-capturable backlog terminates; counts `bytes_captured`/`sharepoint_captured`/
  `session_bound_or_dead` separately — never silently "done"). Verify the SharePoint flow is live via
  `GET /api/diag?kind=env` (`sharepoint_fetch_url_set`). The url-only backlog is dominated by **SharePoint** lease/
  DD/OM docs (724 dia+gov, zero text) that this branch drains; the rest are non-session-bound CoStar (recovered)
  + non-document broker pages (unrecoverable).
- **Extension in-session capture (the durable forward fix)** — the extension fetches each captured doc's bytes
  **in the authenticated CoStar tab** (`background.js::fetchDocBytesViaTab`, the only way to reach a
  session-bound link) and POSTs them to `POST /api/intake?_route=capture-doc-bytes` (`{domain, source_url,
  content_base64, mime_type}` → `storeClientDocBytes`). Keyed by `(domain, source_url)` — the row already
  exists (`process_sidebar_extraction` awaits `upsertDocumentLinks` before responding), so **bytes never touch
  `entity.metadata`**. Idempotent (a row with `storage_path` is a no-op). Offering material is skipped (it
  already routes through the OM live-tab path). Triggered fire-and-forget after a successful extraction
  (`sidepanel.js` → `CAPTURE_DOC_BYTES_BATCH`). **Requires reloading the unpacked extension after deploy**
  (manifest bumped to 1.0.39). Closes the gov firm-term "Gate 1" byte-fetch blocker
  (government-lease `docs/RUNBOOK_firm_term_coverage_ops_gates.md`).

---

## Domain-DB invariants

- **`vertical` / `source_domain` are canonical short-form `dia`/`gov`.** Writers normalize on the way in
  (`bridgeCreateLead` writes `normDomain`; sync functions CASE-map `dialysis→dia`/`government→gov`). `entities.domain`
  also carries a legit third value **`lcc`** (LCC-internal entities) + **`cre`** (generic CRE registry) — never
  remap those. Consumers filtering `source_domain` should accept both forms during transition (`in.(dia,dialysis)`).
  This class of "dia/gov alias" bug has recurred many times — always canonicalize.
- **`external_identities` (LCC Opps) canonical scheme** — every writer funnels through
  `canonicalIdentitySystem()` + `canonicalDomainSourceType()` (`api/_shared/entity-link.js`); a
  `CHECK (chk_external_identities_source_system)` enforces it at the DB. Never introduce a new spelling.

  | concept | `source_system` | `source_type` | `external_id` |
  |---|---|---|---|
  | domain property-anchor ("asset") | `dia`/`gov` | `asset` | domain `properties.property_id` |
  | domain owner entity | `dia`/`gov` | `true_owner` | `true_owner` id (UUID = entity id) |
  | CMS clinic identity | `cms` | `medicare_ccn` | Medicare CCN |
  | vendor/channel | `costar`/`rca`/`crexi`/`loopnet`/`salesforce`/`email_intake`/`outlook`… | as-is | vendor id |

  `asset`=`property`=`clinic`=`facility` for domain rows (collapsed to `asset`); vendor `property` (costar/rca
  listing ids) stays `property`. Banned spellings: `dia_db`, `dia_supabase`, `dialysis`, `gov_db`,
  `gov_supabase`, `government`. `email_intake` is NOT a domain DB (external_id = `staged_intake_items.intake_id`).
- **Gov-side anon-readable views** expose non-PII slices of RLS-protected gov tables so LCC's `pg_net` anon
  pulls work (`gov.v_ownership_history_portfolio`, `v_property_attributes_portfolio`,
  `v_sales_transactions_portfolio`, `v_property_owner_facts_portfolio`, `v_owner_contact_signals_portfolio`,
  `v_property_id_census`…). **Add BD columns to these views, not the underlying tables** (don't loosen RLS on
  PII). dia has the mirrored set.
- **Cap rates are stored as decimals** (7.47% → `0.0747`) and are **derived, not trusted-as-ingested**. gov has
  a full cap-rate framework: `cap_rate_history` is the authoritative derived ledger (`gov_compute_cap_rate()`,
  a 7-tier income hierarchy; opex anchors from trusted ingested cap rates). Raw ingested cap rates are preserved
  for audit. See the **government-lease** repo `CLAUDE.md` §12 for the full framework. dia cap rate = net rent
  (NNN), not NOI.
- **`dia.sales_transactions.sale_date` is `NOT NULL`** (CHECK constraint). Writers must populate it.
- **dia `v_sales_comps.rent` is projected to CURRENT_DATE**, not Y1 base. `base_rent` = the Y1 figure;
  `rent_per_sf` = projected. Projection math: `api/_shared/rent-projection.js::projectRentAtDate` mirrored by
  SQL `dia_project_rent_at_date()`.
- **`on_market_date` is THE canonical market-entry date** (dia + gov); `listing_date` is raw capture (audit
  only) — never read it for market timing. **Exception:** the point-in-time CURRENT available STOCK count. See
  the CM/T9d sections in the history file before touching listing-currency views.

## BD spine (LCC Opps) — key artifacts

- **Tables:** `entities`, `external_identities`, `entity_relationships`, `lcc_entity_portfolio_facts`,
  `lcc_property_attributes`, `lcc_property_owner_facts`, `lcc_listing_events`, `touchpoint_cadence`,
  `bd_opportunities`, `lcc_decisions`, `owner_contact_pivot`, `lcc_buyer_parents`, `lcc_institution_contacts`,
  health/alert + `*_cache`/`*_inflight` tables.
- **Views (all SECURITY INVOKER):** `v_priority_queue` (doctrinal bands P0/P0.4/P0.5/P-BUYER/P-CONTACT/P1–P8),
  `v_priority_queue_enriched`, `v_entity_portfolio_all`, `v_bd_cadence_dashboard`, `v_lcc_merge_candidates`,
  `v_owner_contact_worklist`, `v_lcc_owner_address_dimension`, … The queue reads a **materialized cache**
  (`lcc_priority_queue_resolved`, refreshed by cron); a band-moving verdict calls
  `lcc_refresh_priority_queue_resolved()` to update immediately.
- **Entity ops:** `lcc_merge_entity` (two-step DELETE-then-UPDATE; the single "move backrefs loser→winner"
  path — reconciles portfolio/identities/relationships/cadence), `lcc_normalize_entity_name`,
  `ensureEntityLink` (the R4-A choke point: junk/implausible/federal guards + email-resolution tier +
  SF-account-as-org-edge modeling).
- **Deal spine (living deal dossier, prompt 02/06):** `bd_opportunities` is the deal container;
  `entity_relationships` (effective_from/to + `metadata->>'role'`) is the party role-history store. Added
  `lcc_deal_commission` / `lcc_deal_milestone` / `lcc_deal_diligence` / `lcc_deal_correspondence_summary` /
  `lcc_deal_document` / `lcc_deal_conflict` (`20260820120000_lcc_deal_spine.sql`). Read via
  `lcc_deal_spine(entity)` + `lcc_deal_parties(entity)`; assembled into the tagged deal packet by
  `entities-handler.js::buildDealPacket` and rendered by `dossier-generator.js::renderDealSections`.
  Discipline: SF/Outlook/Sharefile are authoritative for parties/commission/narrative; a CoStar-sourced
  broker edge is `third_party`/"unverified role" until our systems confirm; conflicts go to
  `lcc_deal_conflict` (surfaced, never auto-resolved); absent → "Not on file". SF Opportunity resolve/
  `sf_deal_id` stamp + Outlook thread + Sharefile roster fill are gated on those live connectors.
- **Ownership Resolution Engine (ORE):** multi-signal authority-weighted reconciliation
  (`lcc_reconcile_owner`, `lcc_signal_authority`, `lcc_reconcile_config.match_threshold`), owner-address
  observations store (append-only, never-collapse), SOS/deed/institution-registry enrichment. Full design:
  **government-lease** repo `docs/OWNERSHIP_RESOLUTION_ENGINE.md`.

---

## Known footguns (read before the matching change)

- **Disk-full on LCC Opps = total sign-in lockout.** Auth (GoTrue) lives here; a full disk forces the DB
  read-only, so GoTrue can't INSERT session rows (`SQLSTATE 25006`) and *only sign-in appears broken* while
  reads work. Bloat is source-fixed + retention-pruned + autovacuum-hardened; `lcc_check_disk_health` +
  `lcc-disk-health-check` cron open a `disk_pressure` alert. Large tables (`sf_sync_log`,
  `staged_intake_artifacts`) externalize payloads and have prune crons. `VACUUM FULL` is a **rare manual op**
  (can't run in a migration tx; takes ACCESS EXCLUSIVE) — drain the backlog FIRST, then VACUUM FULL. A
  disabled maintenance/offload cron is watched by `lcc_check_disabled_critical_crons` (folded into
  `lcc-cron-health-check`).
- **PostgREST caps every response at 1000 rows regardless of `limit`.** Any cross-DB sync/pull that pages must
  stride at **1000/page** — a larger stride silently SKIPS rows. This bit the dia owner-facts sync (loaded only
  6,196 of 12,196).
- **`/api/dia-query` + `/api/gov-query` enforce a table/view ALLOWLIST at the `data-query` edge function**
  (`GOV_READ_TABLES`/`DIA_READ_TABLES` Sets in `supabase/functions/data-query/index.ts`), NOT
  `api/_shared/allowlist.js`. A view not in the Set → **HTTP 403** and the client tile silently shows `[]`/0/
  stuck-loading, even when the DB-level SELECT grants are fine. **Whenever a client tile reads a NEW view via
  `diaQuery`/`govQuery`, add it to the edge allowlist AND redeploy `data-query` to the Dialysis_DB project
  (`zqzrriwuavgrquhisnoa`) — NOT LCC Opps.** Mirror the entry in `api/_shared/allowlist.js` (its WRITE sets are
  live via `apply-change.js`; its READ sets are a documented mirror).
- **PostgREST schema cache can go stale after domain-table DDL** — a newly added column can exist
  in the DB while PostgREST still 400s `PGRST204 "Could not find the '<col>' column ... in the
  schema cache"` on writes to it. Supabase usually auto-reloads on DDL, but not always (bit the
  prompt-78 `property_documents.source` fix, 2026-08-08: migrations correct, failures continued
  until a manual reload). Fix: `NOTIFY pgrst, 'reload schema';` on the affected project. When a
  write 400s on a column you JUST added, check the cache before re-diagnosing the migration.
- **`CREATE OR REPLACE VIEW` is append-only for columns** (Postgres 42P16 if you insert a column mid-list). All
  view edits add new columns at the END of the SELECT.
- **Overview/snapshot tiles must render SYNCHRONOUSLY from the main data load, reading ONE canonical
  source/summary view.** Never compute a count by filtering a client-loaded array (empty on Overview), never
  gate a tile's value behind a lazy async filler with a `_rendered` once-flag (a re-render strands it forever).
  A round-number count (1000/500) means a tile is reading a paged query, not a count. This class caused the
  "On Market shows 0 / stuck loading…" bugs. Use `Promise.allSettled` (not `Promise.all`) for the detail batch
  so one failed query can't strand every tile.
- **PL/pgSQL `#variable_conflict use_column`** is required in any function whose `RETURNS TABLE` OUT params
  share names with column names (most BD functions).
- **`ON CONFLICT` on a `CREATE UNIQUE INDEX` must use the index-inference/expression form**, not
  `ON CONSTRAINT` (errors 42704). `touchpoint_cadence` uniqueness is the index `uq_cadence_contact_property` on
  `(COALESCE(entity_id,0), COALESCE(property_id,0), COALESCE(sf_contact_id,''))`.
- **GENERATED ALWAYS columns** — omit from INSERT: `bd_opportunities.is_open` (`= closed_at IS NULL`),
  `lcc_entity_portfolio_facts.is_current` (`= ownership_end_date IS NULL`),
  `dia.sales_transactions.dedup_natural_key`.
- **`facility_patient_counts` (dia) is a CMS reporting-period time-series, not a nightly feed** — CMS publishes
  ~annually; re-running ingestion only adds a row when a genuinely new `snapshot_date` lands. Don't imply a
  stale nightly feed or rank <1% re-stamp noise. (See the **Dialysis** repo `CLAUDE.md`.)
- **SIGALRM does not bound a blocked C-level socket read** (ingestion hang-guard) — every network call in the
  Python pipelines MUST carry its own `timeout=`. (See the **Dialysis** repo `CLAUDE.md`.)
- **Salesforce is minimum-necessary and NOT cleaned by LCC** — LCC is the source of truth and reconciles around
  SF's dups/errors (never writes back to clean SF). An SF Account binds as an **org edge** on the person, not an
  identity on the person (`api/_shared/sf-account-link.js`).
- **Web-search enrichment proxy (`owner-contact-websearch`) is PAUSED — do not activate.** Contact acquisition
  goes through the public-records chain (cross-reference resolver → SOS-direct → address reverse-lookup → deed).
- **"Owner is reachable" has TWO different definitions — the UI reads the NARROW one.** The owner-panel
  hero (`_nextActionForContact`, detail.js) shows "Find a contact" unless `buildContact360` produced a
  `subject.email` / `entity.phone`, and `buildContact360` builds `subject.email` from **`entities.email`
  or a `unified_contacts` row whose `entity_id` IS that entity** — it does **NOT** walk
  `entity_relationships` to a linked person. So an owner with a linked person carrying an email still
  reads as unreachable in the panel. Measuring reachability by the graph therefore OVERSTATES what the
  operator sees (2026-08-15: graph 110 vs hero 56 of 690 property-resolved owners). **Use
  `v_lcc_owner_reachability`** — it reports `reachable_hero` (quote this for operator experience) and
  `reachable_graph` side by side, plus `v_lcc_owner_unreachable_worklist` for the value-ranked
  population. Attaching a person+edge without folding their detail into c360 writes correct data the
  hero cannot see.
- **`dup-pair-planner.ownerCore` / `nameSimilarity` are for FUZZY PAIRING, never for IDENTITY.** They
  strip a generic-CRE **stoplist** (realty, capital, income, group, holdings, properties, partners,
  services…) on top of legal forms, which is right when scoring a candidate pair and catastrophic when
  asking "is this the same party": `Realty Income Corporation` reduces to the **empty string** (so it
  fails to match ITSELF), and `Agree Realty Corp` / `Agree Holdings LLC` both reduce to `agree` and
  score **1.0**. Both were caught by a live dry-run in Prompt 111, one of them a would-be automatic
  write onto the wrong owner. For identity use the STRICT core that strips **only** pure legal-entity
  forms — `owner-contact-propagate-planner.js::strictOwnerCore` (JS) / `gov_owner_strict_core` (SQL, gov
  `CLAUDE.md` §20) — and require the core to carry real material before letting equality drive a write.
- **`entities.email` / `entities.phone` had NO `field_source_priority` ladder** until migration
  `20260903120000` (manual@1 → salesforce@20 → `domain_owner_contact`@55 → costar_sidebar@60), so every
  writer to them was invisible to the provenance doctrine. Register a row when you add another.
  (`v_field_provenance_unranked` still returns **35** rows for other tables — pre-existing drift.)
- **TrafficMetrix table-as-contact-list misparse (Prompt 89).** A CoStar/sidebar capture once parsed a
  property page's TrafficMetrix traffic-count TABLE as a contact list — street names / column labels
  ("Collection Street", "Traffic Vol", "Made with TrafficMetrix") minted as PERSON entities, all stamped
  with the page's one real email (fan-out) → garbage person_email clusters. Guard: `api/_shared/tm-misparse.js`
  is the single detector (`isMisparseName` = street-suffix or TM-vocab, never a clean "First Last"). It is
  reused by (1) the one-shot seeder `?action=tm-misparse-seed` (writes DETERMINISTIC `tm_misparse` dismiss
  proposals into `junk_entity_review` — value-gated on the email fan-out `member_count>4`, so lone real
  people with unique emails are never swept in); (2) the sidebar contact-extraction guard (`isJunkContactName`
  + `planContactMinting` fan-out cap → suspects routed to a `contact_misparse_review` inbox item, never
  minted); (3) the U3 person_email pool (clusters with a misparse member are skipped). On confirm of a
  `tm_misparse` dismiss, the verdict path `unstampMisparseMember` clears `entities.email` + detaches the
  conflated `external_identities` (reversible via `junk_review_batch`) so the real broker's email/SF stops
  binding the phantom, then soft-retires it. Never hard-deletes; the seeder is idempotent (`on_conflict=subject_ref`).
- **The SOS-direct fetcher currently yields nothing from CI** (FL/CA Cloudflare/Incapsula 403 to datacenter IPs;
  AZ portal migrated). The handlers are correct + honest-blocked; the weekly `--apply` schedule is DISABLED.
  Needs a non-datacenter egress. See **government-lease** `docs/SOS_ENDPOINT_VERIFICATION_2026-07-22.md`.
  → **W9.1 Stage 2 (Prompt 99) BUILDS that egress:** the GaryBuilt residential fetch proxy
  (**government-lease** `sos-proxy/` + `docs/RUNBOOK_sos_proxy_garybuilt.md`). Set `SOS_PROXY_URL`
  (+ dedicated `SOS_PROXY_CF_ACCESS_CLIENT_ID/SECRET`, **never** the ollama token) and both the gov
  Python fetcher and the LCC contact-acquisition SOS stage route through it. The SOS stage (`STAGE_SOS`,
  `api/_handlers/contact-acquisition-engine.js`) is flag-gated `W9_1_SOS_DIRECT`, proposal-only
  (`contact_acquisition_review` — confirm never auto), and no-ops honest-blocked while off. Adapter
  re-verification through the proxy + the flag flip are Scott's live post-install steps.

---

## Inert-feature registry (audit §4.4.3) — make "off" visible

Every env-gated capability is catalogued in **`feature_flags_registry`** (LCC Opps; migration
`supabase/migrations/20260809120000_lcc_feature_flags_registry.sql`). Columns: `flag` (PK), `purpose`,
`surface`, `env_var`, `state` (`on|off|partial`, CHECK-enforced), `off_since` (NULL = never enabled /
unknown), `owner`, `notes`. The daily briefing email prints a **"Dormant Capabilities"** section — one
line per flag off (or partial) > 30 days — via `fetchDormantCapabilities()`
(`api/_shared/briefing-data.js`) → `renderDormantCapabilities()`
(`api/_handlers/briefing-email-handler.js`, HTML + plain-text). The audit finding: *a flag-gated no-op
looks identical to a healthy quiet pipeline* — this table is the single source of truth that surfaces it.

- **Whenever you add a new `process.env.<FLAG>` / `Deno.env.get()` capability toggle** (not a tuning
  knob — a whole feature that no-ops when unset), **INSERT a `feature_flags_registry` row** (idempotent
  seed uses `ON CONFLICT (flag) DO UPDATE`). Grep `api/` + `supabase/functions/` for `process.env.` /
  `Deno.env.get` when auditing coverage. SOS per-state adapters are gated in code by
  `SOS_STATE_ADAPTERS[X].enabled` AND the shared `OWNER_ENRICH_SOS_URL` webhook — registered as
  `SOS_STATE_ADAPTERS.<ST>` flags.
- **`state`/`off_since` are operator-curated** — flip a flag's row to `on` (or update `off_since`) when
  you actually enable it in the Railway env; `updated_at` auto-touches on UPDATE.

## dia property "address twins" — Decision Center lane `property_twin` (2026-08-14)

The dia repo ships a geospatial address-twin detector + REVERSIBLE merge (dia
`dia_find_property_twins` / `dia_merge_property_reversible` / `dia_unmerge_property` /
`dia_property_twin_review`; auto-merges only blank-operator husks, routes everything
with a competing clinical identity to review). LCC surfaces the review lane:

- **Federated Decision Center lane `property_twin`** (registered in `api/admin.js`
  `FEDERATED_DECISION_TYPES`, `ops.js` `_DC_FEDERATED` + the lane-tile list,
  `dc-lanes.js` `_DC_FED_META` + card renderer, `review-shared.js` lane map). Source =
  the pending slice of dia `dia_property_twin_review` (closest-first). Verdicts:
  **merge** (→ `rpc/dia_merge_property_reversible`, keep = the CCN anchor, drop = the
  shadow, both taken server-side from the row; stamps `status='merged'` + `backup_id`,
  reversible via `dia_unmerge_property`), **not_twin** (`status='rejected'`), **research**
  (spawns a `research_task`). Badge folded into the `merges_dupes` review-counts lane.
- **No edge-allowlist change / no `data-query` redeploy** — the lane is server-mediated
  via `domainQuery` (direct domain PostgREST with the service key), which bypasses the
  `DIA_READ_TABLES`/`DIA_WRITE_TABLES` edge allowlist. That allowlist only gates
  browser-side `diaQuery` tiles. The one live prerequisite is the dia GRANTs
  (`supabase/migrations/20260814_dia_property_twin_review_grants.sql`, applied to
  `zqzrriwuavgrquhisnoa`) so the service_role PostgREST can read/write the lane + call
  the RPCs.
- **Footgun avoided:** co-located ≠ twin (a Fresenius and a DaVita share one plaza), so
  the lane exists precisely for the human call the auto-pass refuses to make. Merge stays
  reversible; never hard-delete without the snapshot.
- **Prompt 106 — deterministic pre-rank + Ollama assist (annotation-only):** the lane is
  pre-ranked/sorted by a two-layer assist that ANNOTATES but NEVER merges. Layer 1 (NO LLM,
  `api/_shared/property-twin-assist-planner.js::classifyTwinDeterministic`, reuses
  `dup-pair-planner.nameSimilarity`) decides the bulk (same-op/near-identical-name → merge,
  bulk-confirmable; diff-op/`same_norm_address:false`/single-anchor → not_twin) and NEVER
  deterministically not_twins a same-address operator change; Layer 2 (Ollama, `invokeExtractionAI`
  surface `property_twin_assist`) scores the residue with a VERBATIM evidence quote (dropped if not
  a substring of the evidence). Annotations reuse `lcc_clean_assist_proposals` (source
  `property_twin_assist`, keyed `twin:dia:<review_id>`). Tick `GET/POST /api/property-twin-assist-tick`
  (flag `PROPERTY_TWIN_ASSIST`, cron 05:45 UTC, no-op while off). The tick NEVER calls
  `dia_merge_property_reversible` — the merge stays a HUMAN verdict; dc-lanes bulk-confirm targets
  deterministic merges only. Self-measure → `v_lcc_property_twin_assist_accuracy`. Migration
  `20260814130000`.

## Pointers to canonical docs

- **Architecture start:** `LCC-OS.md` → `docs/os/README.md`; canon in `docs/os/canon/`; consolidation map
  `docs/os/REGISTRY.md`; surface sync `docs/os/SURFACE-SYNC-PROTOCOL.md`.
- **API/routing reference (read before editing `/api/`):** `.github/AI_INSTRUCTIONS.md`.
- **Auth rollout:** `docs/AUTH_ENFORCEMENT_ROLLOUT.md`.
- **OM intake:** `docs/architecture/om_intake_pipeline.md`.
- **Provenance / self-learning loop:** `docs/architecture/data_quality_self_learning_loop.md`.
- **Consumption-layer doctrine (long form):** `audit/data-flow-2026-05-30/CONSUMPTION_LAYER_DOCTRINE_2026-06-23.md`.
- **Ownership Resolution Engine:** government-lease `docs/OWNERSHIP_RESOLUTION_ENGINE.md`.
- **Property-owner subsystem + SF-as-a-source doctrine:** `docs/architecture/property-owner-subsystem.md`
  + `docs/architecture/property-owner-source-authority-and-doctrine.md`. **Point person ≠ property owner:**
  `lcc_entity_owner_override.owner_user_id` is the POINT PERSON (lcc_user) who works the deal and drives
  My Work / Team Queue scoping (`v_my_work_scoped`); the PROPERTY owner (which entity owns the building)
  lives in the SEPARATE `lcc_property_owner`. Never feed owner entities through the point-person engine.
  Salesforce is one reconcilable source (authority ladder: manual>deed>rel_purchase>sf_seller>rel_owns);
  write back to SF only for direct team benefit.
- **Access scoping (My Work / Team Queue / correspondence privacy):** `docs/architecture/access-scoping-and-my-work.md`.
- **Deal correspondence ingestion + reconciliation:** `docs/architecture/correspondence-ingestion-design.md`.
- **Property-tab UX review + rollout plan:** `docs/architecture/property-tab-ux-review.md`.
- **Connectivity map + open threads (email/phone/SF route status — START HERE for continuity):**
  `docs/architecture/connectivity-and-open-threads.md`.
- **Contact/owner sidebar (P1) design — layout-as-funnel-to-next-action, reuses `buildContact360`:**
  `docs/architecture/contact-owner-sidebar-design.md`.
- **Full per-round worklog (verbatim archive of everything trimmed here):**
  [`docs/history/CLAUDE_full_2026-07.md`](docs/history/CLAUDE_full_2026-07.md). Round-specific implementation
  logs (R5→R64, R76* ingestion, ORE phases, CONNECTIVITY, OUTREACH, UI Phases, SF-reconcile, T9d, CM) live
  there — grep by round tag.
