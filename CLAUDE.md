# Claude Code / Cowork Instructions — Life Command Center

> **🧭 START HERE for architecture: [`LCC-OS.md`](LCC-OS.md) → `docs/os/README.md`.**
> **Operational reference (surfaces, comps engine, deploy map, Cowork setup):** [`docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`](docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md) + [`docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md`](docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md).
> One brain (LCC + Cortex), one instruction/policy canon (`docs/os/canon/`), many surfaces (Copilot, Claude
> Personal/Cowork, Northmarq Claude, ChatGPT). Edit rules in the canon, bump the version, run
> `docs/os/SURFACE-SYNC-PROTOCOL.md` to update every surface. **Never start from scratch, never fork a source,
> never overwrite canon without bumping its version.** Consolidation map: `docs/os/REGISTRY.md`.

> **CRITICAL: Read `.github/AI_INSTRUCTIONS.md` before modifying any files in `/api/`.** It carries the full
> routing/architecture reference and any lettered-section footguns.

> **⚠️ DESTRUCTIVE-OP ORDER (learned the hard way 2026-08-19, nearly lost a 475 MB mailbox):**
> **extract → VERIFY → only then delete the backup and prune.** A 475 MB
> `email_export/*.pst` blocked a push (GitHub rejects >100 MB), so `filter-branch` purged it from
> history. Two mistakes, both about *order*:
> 1. **`git filter-branch` rewrites the WORKING TREE too**, not just history — a file dropped from the
>    rewritten commits is deleted from disk. Do not tell anyone "only history changes".
> 2. **PowerShell `>` is NOT binary-safe.** `git cat-file -p <blob> > file.pst` produced
>    **1,002,334,726 bytes for a 498,017,280-byte blob** — UTF-16LE widening every byte. Use
>    `cmd /c "git cat-file -p <sha> > %USERPROFILE%\...\file.pst"`, which redirects in binary, then
>    check `(Get-Item …).Length` against `git cat-file -s <sha>` **before** deleting the backup ref.
>    (PST magic is `!BDN` in the first 4 bytes if you want a second check.)
> The recovery only worked because `gc --prune=now` happened to leave the unreferenced blob behind.
> Never rely on that. Also: `email_export/`, `*.pst`, `*.ost` are now git-ignored — a mailbox export is
> personal correspondence and does not belong in a repo regardless of size.

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
- **Property-owner feeders → `lcc_property_owner_evidence` → `lcc_reconcile_property_owner`.** Authority
  ladder (`property-owner-source-authority-and-doctrine.md`, registered in `field_source_priority` as
  `lcc.lcc_property_owner/owner_entity_id`): `manual`(8.0) > **`domain_true_owner`(5.0)** > `rel_purchase`(4.0)
  > `sf_seller`(3.5) > `rel_owns`(3.0). `domain_true_owner` (P113, `lcc_ingest_domain_owner_evidence`,
  dry-run default, batch-reversible via `lcc_domain_owner_evidence_log`) outranks `rel_purchase` because it
  is the domain's curated CURRENT owner-of-record, whereas a purchase edge is ONE historical transaction.
  Dry-run surface `v_lcc_domain_owner_candidates`; ambiguity lane `lcc_domain_owner_ambiguous`. Fill-blanks:
  it only ever touches assets with no resolved owner.
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
- **Profile a slow endpoint with the handler's REAL query shape — `LIMIT 5` without the `ORDER BY` lies.**
  An `ORDER BY` forces the WHOLE view to materialise, so the limit is irrelevant: `v_lcc_bd_worklist` cost
  321 ms at `LIMIT 5` (no order) and **30,610 ms** at `order=rank_value.desc.nullslast&limit=150` — the shape
  the handler actually issues. That gap produced two wrong claims and nearly shipped a no-op `CAP` reduction.
  Read the handler, reproduce its exact PostgREST path (filters included), and check `loops=` in the plan:
  **any node with `loops=` equal to the output row count is a correlated subplan**, and no index or ANALYZE
  can fix one — it needs the aggregate hoisted out of the correlation and LEFT JOINed once (Prompt 115 did
  exactly this to `v_lcc_contact_writeback_candidates`: 3 subplans at `loops=1648` → 0, 51.9×, 46× fewer
  buffers, 0-row equivalence diff both directions). Also note the raw DB timing is **session-variable**
  (19.3 s vs 30.6 s for the same unchanged query on consecutive days) — always measure before AND after in
  ONE session, and treat the structural facts (loops gone, buffer count) as the durable evidence.
  Details: `docs/architecture/panel-redesign-verification.md` §4.2d–4.2e.
  - **P118 corollaries (2026-08-20, all three caught live in one session).**
    (1) **Fix EVERY layer of a tick, not the one the error names.** The `lcc-owner-address-feed` alert's
    CONTEXT pointed at `lcc_resolve_owner_address_observation_entities`; hoisting that correlated subplan
    (45 s → 1.2 s, flat in row count, 0-row equivalence diff) left the cron STILL timing out, because
    `lcc_owner_address_feed_tick()` calls two functions and the *other* one
    (`lcc_feed_owner_signal_addresses`) carried the same full-table normalize scan per row (~86 ms × 433
    rows ≈ 37 s). Time each half separately before claiming a tick is fixed.
    (2) **A per-row API cannot be hoisted — that is exactly when a functional index IS the fix.** The
    doctrine above ("no index can fix a correlated subplan") applies when you control the query and can
    LEFT JOIN once. `lcc_record_owner_address_observation` is called per row from several callers, so it
    needed the index instead: 998.756 ms → **0.099 ms**, 2,903 → 4 buffers. **`lcc_normalize_entity_name(text)`
    IS `IMMUTABLE`** (`pg_proc.provolatile='i'`) — check `provolatile`, don't assume a plpgsql helper isn't.
    (3) **⚠️ A partial index is only usable if the query's own predicates IMPLY the index predicate.**
    Building it `WHERE … AND name IS NOT NULL` produced a valid index the planner NEVER used — the query
    never states `name IS NOT NULL`, and a non-STRICT plpgsql function gives the planner no way to infer it
    from the equality. Dropping that one clause is what made it match. Also: build a small index
    NON-concurrently (a cancelled `CREATE INDEX CONCURRENTLY` leaves an INVALID index to clean up).
    (4) **Verify a batch delete by the row-count DELTA, not the function's return value** — a client
    disconnect rolls the whole function back, so "0 deleted" and "nothing to delete" look identical; probe
    the candidate set with a `LIMIT` to tell them apart, and prefer a one-shot **pg_cron** job (the real
    production path) over a client call for anything near the timeout. Related: `count(*)` over a scalar
    subquery **optimizes the subquery away** — time it with `count(<the column>)` or you will measure nothing.
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
- **A bare Salesforce IDENTITY is NOT a BD signal — never re-add it as a cadence gate arm (P112).**
  R63's `bdSignalFromFacts` listed `hasSalesforceIdentity` as sufficient. Measured 2026-08-15 that one
  arm carried **930 of 1,113** prospecting cadences (897 never touched, and **0** prospecting cadences
  had an open `bd_opportunity`) — it admitted the whole SF contact book, which is precisely the
  Consumption-Layer failure ("SF is minimum-necessary and NOT cleaned by LCC" — a capture surface, not a
  relationship). The gate now requires an open opp / real SF activity / value ≥ `CADENCE_SIGNAL_MIN_VALUE`;
  an SF identity is corroboration only. This propagates to `growGateFromFacts` **by design** (the grow
  path keeps its own `outreachEventCount >= N` arm). Auto-seed callers go through
  `cadenceSeedDecision()`, which also applies the **reachability precondition** — never seed a cadence for
  a party with no contact method and no named person, because it can never advance and only ages into
  "overdue". Retire/resume sweeps: `lcc_p112_retire_unworkable_cadences` /
  `lcc_p112_resume_workable_cadences` (reversible pause, never delete). Note the reachability gate fails
  **OPEN** (a read error must not suppress a reachable owner) while the BD-signal gate fails **CLOSED**.
- **`touchpoint_cadence.owner_user_id` and `lcc_entity_owner_override.owner_user_id` FK to DIFFERENT user
  tables.** `touchpoint_cadence.owner_user_id → users(id)`; `lcc_entity_owner_override.owner_user_id →
  lcc_users(lcc_user_id)`, and **none** of the `lcc_users` ids exist in `public.users`. Stamping the
  override id straight onto a cadence FK-violates on every row. The bridge is **email**, resolved once by
  `v_lcc_entity_point_person` / `lcc_cadence_point_person(uuid)` — always go through that, never
  re-derive the mapping in JS.
  - **P116 — the same id-space collision hit the Outlook/Calendar bridges, and it presented as an
    "upsert 409".** `email_bodies.source_user_id`, `meetings.source_user_id` and
    `activity_events.actor_id` ALL FK `public.users(id)`, while `api/bridges.js` takes
    `_source_user_id` **verbatim** from the PA flow's `X-LCC-Source-User-Id` header. The body sweep's
    flow was configured with the `lcc_users` id for sabriggs@northmarq.com (`1d3f7321-…`) instead of
    the `public.users` id (`b0000000-…-0001`), so **10,470 of 10,510** body-carrying `email_bodies`
    writes and 423+/day `activity_events` inserts were rejected — the voice corpus stayed empty for
    two days while every upstream layer (allowlist, payload, sweep, contact resolution) looked
    healthy. Every inbound source-user id now normalizes through
    **`api/_shared/source-user-id.js::resolveSourceUserId`** (pass-through → `lcc_users`→email→`users`
    → null); route any NEW writer to an FK'd user column through it rather than trusting the caller.
- **⚠️ A PostgREST `409` on an upsert is NOT necessarily a conflict — PostgREST maps BOTH `23505`
  (unique_violation) AND `23503` (foreign_key_violation) onto HTTP 409.** A POST with `on_conflict=…`
  + `Prefer: resolution=merge-duplicates` that returns 409 therefore reads convincingly as
  "merge-duplicates didn't take / the unique index isn't being inferred", when the real cause can be
  an unrelated FK on the same row (P116 lost two days to exactly that misread — the merge-duplicates
  upsert was correct the whole time, proven by a self-rolling-back `ON CONFLICT … DO UPDATE` gate).
  **Never diagnose a 409 from the status code — read the DB.** Supabase `query_logs`
  (`source='postgres_logs'`, `event_message ilike '%violates%'`) names the exact constraint; or capture
  `data.code`/`data.message` off the PostgREST body. Writers must record the DB's own code + message,
  not just `upsert_<status>` (see `describeWriteFailure`, `bridge-handlers-outlook.js`). Two things
  NOT worth investigating before the log is read: a plain **UNIQUE INDEX** (not constraint) is a valid
  `ON CONFLICT` arbiter, and a duplicate NON-unique index on the same columns does not break
  inference.
- **A cadence `last_touch_at` can never be in the future.** `lcc_activity_event_advance_cadence` used to
  pass `p_logged_at := NEW.occurred_at` unguarded, so a calendar meeting **scheduled ahead** landed as a
  COMPLETED touch and pushed `next_touch_due` a further quarter out. Guarded in three layers: the trigger
  skips future-dated events, `lcc_advance_onboarding_cadence` clamps to `now()`, and
  `trg_lcc_cadence_future_touch_guard` (BEFORE INSERT/UPDATE on `touchpoint_cadence`) clamps + opens a
  deduped `cadence_future_last_touch` health alert. **A real `CHECK` is impossible** — `now()` is not
  immutable, so Postgres rejects it in a CHECK constraint; the trigger form is the only option.
- **Web-search enrichment proxy (`owner-contact-websearch`) is PAUSED — do not activate.** Contact acquisition
  goes through the public-records chain (cross-reference resolver → SOS-direct → address reverse-lookup → deed).
- **"Owner is reachable" has THREE definitions — quote `reachable_hero_effective`.** The owner-panel hero
  (`_nextActionForContact`, detail.js) used to show "Find a contact" unless `buildContact360` produced a
  `subject.email` / `entity.phone`, and c360 never walked `entity_relationships` — so an owner with a
  linked person carrying an email read as unreachable, and attaching a person+edge (the doctrinally
  correct write) changed nothing on screen. **Prompt 114 closed that** (`subject.reachable_via`, resolved
  by `api/_shared/owner-reachable-via.js`; hero renders "Reach via <name> (<role>)"). Read
  `v_lcc_owner_reachability`, which now reports all three side by side:
  `reachable_hero` = the PRE-114 definition, retained ONLY as the before/after yardstick;
  **`reachable_hero_effective`** = what the hero reads today (org routes ∪ a linked person surviving the
  guards) — **quote this one**; `reachable_graph` = any linked person INCLUDING brokers, which
  OVERSTATES what the panel can show. `hero_gap` is the UI-defect residue (47 → 0 on 2026-08-15).
  `v_lcc_owner_unreachable_worklist` is the value-ranked population.
  - **`reachable_via` is NEVER merged into `subject.email`.** That field means "the ORG's own contact
    detail"; a linked person's address is a different claim. Merging them would assert the org has an
    address it does not and re-commit the person/org conflation `sf-account-link.js` guards against.
  - **The winner-selection rule is ranked, pure and regression-tested** (explicit primary → role
    authority → email-over-phone → most-recently-verified → `person_id`). Never "first row wins" — that
    is the gov `ensureTrueOwner` substring defect (gov `CLAUDE.md` §20). Broker-ish roles
    (`NON_REACHABLE_ROLES`) are EXCLUDED, not ranked last; the SQL `via_person_selectable` arm mirrors
    that list, so **add a role to one and you must add it to the other** or measurement and UI drift apart.
- **The owner-contact review lane is mostly REJECTS — never wire a single "confirm" button to it.**
  `lcc_owner_contact_propagate_review` (Prompt 111) was documented as candidate decision-makers; live
  classification of all 101 rows says **22 person-shaped, 77 organization-shaped, 2 blocked**, and the
  organizations are dominated by **transaction counterparties** — the buyer/seller of a sale on the
  owner's property, captured by the CoStar sidebar ("NGP Capital" ← "CoreCivic, Inc."). Confirming those
  writes another company's switchboard onto the owner. The Decision Center lane
  `owner_contact_attach_review` (Prompt 114) therefore has **three shape-aware verdicts** —
  `attach_person` (person entity + `entity_relationships` edge), `same_party` (fill the OWNER's own blank
  from an abbreviation/acronym name variant), `reject` (terminal, never re-proposed) — and `admin.js`
  re-runs the pure shape gate (`owner-contact-verdict-planner.js::validateVerdict`) before writing, so a
  stale card cannot mint a REIT as a person. Three live-caught traps encoded there:
  `looksLikePersonName` alone accepts org names with no legal suffix (**"Global Net Lease"**, **"U.S.
  Department of Veterans Affairs"** both passed) — require `isPersonShaped` (adds an org-marker check);
  acronym matching must read initials from the **unsorted** name, because `strictOwnerCore` sorts tokens;
  and a strict token SUBSET is NOT an abbreviation (**"Government Properties Trust"** ⊄ **"Easterly
  Government Properties"** — different REITs), so require equal token counts and leave subsets undecided.
- **The domain `true_owner` is often the OPERATOR — never promote it to owner without the flag check
  (P113).** dia files the tenant in the owner slot at scale: **7,926 of 11,783** dia properties point at a
  `true_owners` row flagged `is_operator_not_owner`, and on the assets that lacked a reconciled owner the top
  domain "owner" names were DaVita Inc. (348), Fresenius Medical Care (334), DaVita Kidney Care (67). The
  owner feeder `lcc_ingest_domain_owner_evidence` blocked **815 assets** on that flag — more than the 809 it
  promoted. **Use the existing flag** (`dia.true_owners.is_operator_not_owner`, surfaced on
  `v_property_owner_facts_portfolio.true_owner_is_operator` and read by the P0.1 display guard as
  `own.true_owner_is_operator`); never write a second name-based operator test, or the two definitions drift
  and the panel and the feeder disagree. gov has no such conflation (the tenant is a federal agency) — its
  view returns constant `false` so one guard serves both domains.
- **Resolve a domain owner to an LCC entity by ID, never by name.** `external_identities(source_system=
  'dia'|'gov', source_type='true_owner', external_id = properties.true_owner_id::text)` is the canonical
  join and it follows entity merges for free (227 of 15,481 identities already point at a merge survivor).
  The mirror `lcc_property_owner_facts` carries `true_owner_effective_id` (one `merged_into_true_owner_id`
  hop applied domain-side) for exactly this. **`lcc_mirror_tick`'s `select=` list for the
  `property_owner_facts` leg must keep those columns** — `lcc_apply_property_owner_facts_page` writes NULL
  for any key absent from the payload, so dropping one silently NULLs the mirrored column on the next
  incremental page, starving the feeder AND disarming the operator guard.
- **`lcc_reconcile_property_owner` scores an ownership CHAIN as competing claims (known, sized, unfixed).**
  It sums evidence weight with a recency decay **floored at 0.25**, so a building sold three times yields
  three near-equal candidates and confidence lands at 0.33–0.50, under the 0.55 gate. Measured 2026-08-15:
  **876** assets have evidence and still read "Unresolved"; a strict-latest-purchase supersession tier
  (the later purchase SUPERSEDES the earlier — that is what "current owner" means) would resolve **465**
  of them and correctly abstain on the 360 that tie on date. Adding evidence does not fix this class —
  don't reach for another feeder first.
- **`dup-pair-planner.ownerCore` / `nameSimilarity` are for FUZZY PAIRING, never for IDENTITY.** They
  strip a generic-CRE **stoplist** (realty, capital, income, group, holdings, properties, partners,
  services…) on top of legal forms, which is right when scoring a candidate pair and catastrophic when
  asking "is this the same party": `Realty Income Corporation` reduces to the **empty string** (so it
  fails to match ITSELF), and `Agree Realty Corp` / `Agree Holdings LLC` both reduce to `agree` and
  score **1.0**. Both were caught by a live dry-run in Prompt 111, one of them a would-be automatic
  write onto the wrong owner. For identity use the STRICT core that strips **only** pure legal-entity
  forms — `owner-contact-propagate-planner.js::strictOwnerCore` (JS) / **`lcc_owner_strict_core()`** (SQL,
  LCC Opps, added P116) / `gov_owner_strict_core` (SQL, gov `CLAUDE.md` §20) — and require the core to carry
  real material before letting equality drive a write.
  - **`lcc_normalize_entity_name()` is in the SAME banned-for-identity class** (P116, caught live). It
    strips `holdings|properties|partners|capital|group|company|co|trust` on top of legal forms, so
    **"Century Park Partners" == "Century Park Properties LLC"** (both → `century park`). It is correct
    where it is used — GROUPING candidate duplicates in `v_lcc_merge_candidates`, where a human confirms —
    but a P116 dry-run that used it to pick a re-point target would have moved a property onto a
    **different company**. Grouping-for-review ≠ identity-for-write.
  - **Corollary (P116): a brokerage-polluted name is INVISIBLE to the merge detector.**
    `v_lcc_merge_candidates` groups on `lcc_normalize_entity_name` needing ≥2 members, and
    `"DP Brighton LLC by Marcus & Millichap"` normalizes to `dp brighton by marcus millichap` — which never
    groups with `dp brighton`. Cleaning the stored name is therefore what SURFACES a duplicate, not what
    hides it. Whenever you correct a captured name, check whether the correction changes its merge grouping.
- **A brokerage is the agent, never the principal — every owner-writing feeder needs the guard.**
  `lcc_reconcile_property_owner` had none and produced **42 of 46** brokerage-as-owner rows (P116);
  `lcc_supersede_property_owner` carried `and not lcc_owner_name_is_brokerage(...)` and produced **0**.
  The guard now sits on both. Because `lcc_property_owner.source` is derived from the evidence rows the
  reconcile function scores, that one predicate covers `relationship_graph` AND `domain_true_owner`.
  **Re-point the EVIDENCE too, not just `lcc_property_owner`** — otherwise the next reconcile pass
  re-elects the bad candidate and silently undoes the correction. Note the detector matches bare
  `\mmarcus\M`/`\mnai\M`, so a genuine "Marcus Family Trust" would trip it; the
  `guard_blocked_candidate` lane of `v_lcc_p116_brokerage_owner_review` exists so a false positive
  surfaces instead of failing silently (measured 2026-08-17: it blocks exactly the known brokerages).
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
- **PostgREST's write surface is NARROWER than SQL's, and it reports the difference badly.** Three
  distinct traps, all hit live in one session (P136a/P136b/P141), all costing real rows:
  - **An EXPRESSION or PARTIAL unique index is invisible to PostgREST.** `on_conflict=` takes COLUMN
    NAMES ONLY, so it cannot express a `coalesce()` arbiter. With nothing inferable,
    `Prefer: resolution=ignore-duplicates` silently falls back to the **PRIMARY KEY** — and if that is
    a `bigserial` it never collides, so `ON CONFLICT DO NOTHING` never arms and ONE duplicate 409s its
    entire chunk (10 in-file dups cost 500 rows). **If rows arrive over REST, the dedup key must be a
    single PLAIN column — generate it (`STORED GENERATED`) when the real key needs coalesce().**
    Precedent: `dia.sales_transactions.dedup_natural_key`, `lcc_dia_ownership_master.dedup_key`.
  - **Postgres evaluates NOT NULL BEFORE ON CONFLICT.** A partial-column upsert intended to merge
    (`{id, col_a, col_b}` on a table with other NOT NULL columns) fails **23502**, never reaching the
    conflict. Use an RPC taking a `jsonb` array, not a PostgREST upsert. Per-row PATCH is the other
    option and is thousands of round trips.
  - **A send counter is NOT a write counter.** `chunk.length` summed over successful POSTs counts rows
    SENT; with ignore-duplicates a payload carrying the same key twice lands once (302 sent → 301
    written). Same class as the Dialysis repo's documented "`inserted: N` is a DERIVATION counter."
    **Truth is a `count=exact` delta before vs after**, and a dry run must ALSO report
    already-present vs NEW or a re-run looks like it did nothing when it did everything.
- **`lower()` BEFORE a character-class strip, never after.** `regexp_replace(x,'[^a-z0-9]','','g')`
  carries no `i` flag, so applied to raw text it DELETES every uppercase letter. `lower(regexp_replace(
  'YUKON MEDICAL VA LLC','[^a-z0-9]','','g'))` → **`''`**, and every ALL-CAPS name collapses to the
  empty string and compares EQUAL to every other. This shipped a "32.6% of transitions are
  self-transitions" finding that was really **0.8%** — wrong by 43×, and inverted on both gate rows
  (a case-only variant read FALSE, a real GPT→NGP sale read TRUE). Correct form:
  `regexp_replace(lower(x),'[^a-z0-9]','','g')`.
- **Verify on NAMED rows with stated expected answers, never on an aggregate.** The bug above produced
  a completely plausible 32.6% that would have shipped unchallenged; it was caught only because the
  gate asserted specific properties with expected outcomes. Corollary, hit four times in one session:
  **read the rows the CONSUMER will actually process, not a sample of the population.** They are not
  the same distribution — across all 9,582 gov ownership transitions 3.9% fail the name guards, but
  across the TIED rows a supersession consumer actually touches, **25%** do. A tie exists *precisely*
  where the evidence is messy. Sample the population, conclude "96% clean", be wrong about a quarter
  of your rows.

## gov ownership transitions → LCC supersession (P138–P141, 2026-08-19)

`gov.ownership_history` held **9,582 dated prior→new transfers across 7,057 properties** that LCC could
never see: the anon-readable `v_ownership_history_portfolio` exposes `transfer_date` but **not
`prior_owner`/`new_owner`**, and filters `true_owner_id IS NOT NULL` (hiding 23.5%). gov
`v_ownership_transitions_portfolio` (sibling view, gov repo `sql/20260818_gov_p138*.sql`) exposes them.

**FEED FROM:** `is_latest_for_property AND new_owner_is_clean AND NOT is_self_transition AND NOT
is_oscillating_pair AND new_owner_true_owner_id IS NOT NULL`. Each guard exists because it caught
something live:

- **`new_owner_true_owner_id`** is `true_owner_id` exposed ONLY where the linked `true_owners.name`
  matches the transition's `new_owner`. Measured: the id means the NEW owner 91.4%, the PRIOR owner
  0.6%, **neither 8.1%** — where id and name disagree one is wrong and we cannot tell which. **The
  NAME verifies the ID, the ID carries the identity, neither is trusted alone.** This is what keeps the
  LCC join ID-to-ID via `external_identities(gov, true_owner)` with no fuzzy step anywhere.
- **`is_oscillating_pair`** — a property whose history records BOTH A→B and B→A. `gsa_lease_diff` emits
  an "acquisition" every time the GSA lessor field flickers between an SPE and its parent (property 180:
  GPIT ⇄ Echelon Pkwy four times, six identical rows on one date). The DATE is real, the DIRECTION is
  not. 233 properties; `gsa_lease_diff` is ~93% of the feed and the ONLY source affected — so the flag
  is per-property rather than a down-weight of the whole producer.
- **`gov_strip_brokerage_suffix`** — a `by <brokerage>` suffix is **STRIPPED, not rejected**. Of 214
  brokerage-flagged rows, 197 are REAL owners wearing a capture artifact (`Gardner Tanenbaum Holdings
  by Colliers`, `Boyd Watterson by Newmark Knight Frank`) and only 14 are genuine brokerage-as-owner.
  A rejection guard discards the owner with the artifact. Same lesson as the LCC-side note that
  cleaning a brokerage-polluted name is what SURFACES a duplicate.
- **`is_name_variant`** catches strict prefix extensions ONLY. `1521 N CARPENTER LLC` vs `1521 North
  Carpenter Road LLC` is missed. Catching it needs token-level fuzzy matching — banned for identity —
  so it is a **stated gap, not a patch**.

**LCC side:** `gov_ownership_transition` is registered at supersession **TIER 3 (with `rel_purchase`,
so the DATE decides)** and `field_source_priority` **18** (above rel_purchase 20). The two ladders
differ ON PURPOSE — the tier asks *what kind of claim is this* (both are one historical transaction),
the priority asks *if they disagree, who wins* (the domain's own recorded transfer beats an inferred
edge). Feeder: `scripts/feed-gov-ownership-transitions.mjs`.

### Asset-identity coverage is what gates owner resolution — not evidence

`lcc_property_owner_evidence` / `lcc_property_owner` / supersession all key on an **entity UUID**, so a
property with no `external_identities(domain, 'asset')` row cannot carry owner evidence at all. LCC
holds `lcc_property_attributes` for 13,823 gov properties but asset entities for only 2,235 — and the
first feeder run skipped **2,909 of 3,254** transitions as `no_asset_entity`. **When a domain feeder
under-delivers, check asset-identity coverage before blaming the evidence.**

**Minting is gated, and `--mint` REFUSES to run without a value gate** (`--min-rent`). Doctrine
satisfied four ways: consumer = the supersession engine, *in the same pass*; value gate = the rent
floor; retire predicate = a minted entity with no evidence and no portfolio fact (verified **0**);
honest counts = minted vs already-present, plus the write delta. **Evidence justifies the entity, never
the reverse** — an asset entity with nothing attached is noise in every count, search and merge
candidate. Mint via `lcc_mint_gov_asset_entities()` (RPC, not JS: `entities.canonical_name` and
`external_identities.workspace_id` are both NOT NULL with no default, and canonical_name must come from
the SQL `lcc_normalize_entity_name` — a JS copy is the normaliser drift this file warns about
elsewhere; the RPC also keeps entity+identity in ONE transaction so a failure cannot orphan either).

**Live result 2026-08-19:** 663 minted at a $500k floor → 964 evidence rows → **612 resolved owners**
(2,725 → 3,337) with 51 held in `purchase_tier_no_org_marker` (municipal owners like `City and County
of Denver` and person-shaped names — the guard correctly abstaining). 663 = 612 + 51, zero stray.
Resolve rate does **not** degrade at lower rent (bands under $500k resolve at 100%, though on small
already-modelled samples). Reverse by `metadata->>'mint_batch'` — identities before entities.

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

## CM export — a KPI tile and its data tab must read ONE view (Prompt 119, 2026-08-18)

The 2Q-2026 Dialysis book shipped two numbers for the same metric because a KPI-block view and its
sibling data-tab view each computed their own aggregate over the same base. **A KPI tile is a
projection of a series/table the book already renders — it must READ that view, never restate its
filters.** Two live instances, both root-fixed in the dia views (`Dialysis`
`supabase/migrations/20260818_cm_dia_prompt119_kpi_view_reconcile.sql`, applied live — CM reads views
per request, so no redeploy):

- `cm_dialysis_whatsnew_kpis.cap_ttm` read `cm_dialysis_market_quarterly.avg_cap_rate` (a
  single-quarter SIMPLE average, 7.41%) while `Data_Cap_Avg` charts
  `cm_dialysis_cap_ttm_m.ttm_weighted_cap_rate` (7.06% — the number the book quotes). Now reads the
  TTM series.
- `cm_dialysis_inventory_snapshot_kpis` is now an **unpivot of `cm_dialysis_on_market_snapshot_q`**
  (the canonical on-market definition, which carries the year-ago comparison). The three drifted
  filters were `avg_dom` (`0..3650` vs `>0` — the 22-day 10+ cohort gap), `pct_price_change`
  (non-null denominator vs all rows) and the `avg_price` band ($30M vs $200M).

**`checkKpiSeriesConsistency()`** (`api/_shared/cm-excel-export.js`) is the tripwire: it compares
every inventory KPI tile against its `on_market_snapshot` counterpart and the What's-New cap tile
against the cap-TTM series, and pushes any divergence into the export's `driftWarnings` — warn-only,
never blocks. Add a pair here whenever a new KPI tile mirrors a data tab.

Related invariants from the same round:

- **A KPI `primary_format` token that isn't in `FMT` shipped as Excel's `General`** — a percent tile
  rendered as `0.1505`. `resolveKpiTileFormat()` now honors the token first, then infers a percent
  from a percent-shaped token name, then from a percent-natured label at ratio scale (`|v| < 1`, so a
  dollar/count tile can never be mangled). Mirrored in the web KPI renderer (`capital-markets.js`
  `fmtVal`). **Register a new token in `FMT` when a KPI view starts emitting one** —
  `percent_zero_decimal` was live for months without a mapping.
- **Chart-axis display names are an EXPORT-layer concern** — `CHART_COLUMNS` entries take an optional
  `display: 'short_operator'` token (`applyColumnDisplay`) so the source views keep canonical operator
  names while the data tab, and therefore the native chart's category axis, carry the short form.
- **A stacked-bar data label suppresses zeros via the number format `0%;;;`**, not per-point `<c:dLbl>`
  deletion (the series-level emitter has no per-point control). Empty negative/zero/text sections =
  blank label on a 0% series.

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
