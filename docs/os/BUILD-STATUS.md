# Build Status — where the OS architecture actually stands

> **⚠️ Dated 2026-07-28. The consolidated, current backlog is
> [`PLANNED-BACKLOG.md`](PLANNED-BACKLOG.md); live system state is
> [`CURRENT-STATE.md`](CURRENT-STATE.md).** Every unbuilt row in this file was swept into that
> backlog on 2026-08-26 (Prompt 141) — see the manifest in
> `docs/history/DOCS_CONSOLIDATION_2026-08-26.md` §5. This file is kept for its **reasoning,
> dependency ordering and design pointers**, which the backlog deliberately does not duplicate.
> **Re-measure any row here before acting on it.**

One honest answer to "are we done?" Legend: ✅ built/live · ⏳ built in repo, pending a manual apply ·
📐 designed/specced, not built · 🚫 excluded by decision · 🔮 roadmap. Last updated: 2026-07-28.

## Foundation (the consistency contract)
- ✅ **Canon** — `docs/os/canon/` (8 topic modules + blocks) is the single source of the rules.
- ✅ **Render + parity enforcement** — `tools/render-surfaces.mjs` + `check-parity.mjs`; tested (green when
  synced, non-zero exit on drift).
- ✅ **OS home + registry + start-here pointers** — `README.md`, `REGISTRY.md`, root `LCC-OS.md`, banners in
  `CLAUDE.md`/`AGENTS.md`.

## Surfaces (canon-bound)
- ✅ **Copilot** — `agent-instructions.md` canon-migrated; **published** by Scott.
- ✅ **ChatGPT** — persona canon-migrated (parity ✓); ⏳ paste into the GPT.
- ⏳ **Northmarq Claude** (Project prompt), **Personal Claude** / **Cowork** (skills) — bundles generated in
  `surfaces/`; sync (paste) pending.
- ✅ **LCC in-app** (`/api/chat`) — unchanged by design (the brain's own front door).

## Unification (one URL for every surface)
- ✅ **Phase 1 LIVE** — `api/ai-read.js` proxy + `server.js` routes + openapi briefing path; ChatGPT/Copilot
  reach all 9 ops on one base URL; Claude connector unchanged.
- 🔮 **Phase 2** — collapse into a single service, retire the standby (`architecture/unification-changeset.md`).

## Copilot agent structure (tools + specialists)
- ✅ **LCC Intelligence connector** — live (comps, property, briefing, drafts, memory).
- ✅ **Work IQ SharePoint** — present in the Deal Agent (DLP passed). ⏳ apply the least-privilege enable set +
  pin the Team Briggs site via Inputs + end-user auth (`connected-agent-descriptions.md` / the tool list).
- 📐 **Document Files Agent** & **Document Assembly Agent** — routing descriptions + instructions are
  paste-ready (`connected-agent-descriptions.md`). ⏳ create them in Studio and connect to the orchestrator.
- ✅ **Orchestrator delegation block** — added to `agent-instructions.md` (marked "activate when specialists
  exist"). ⏳ publish alongside creating the specialists.
- ✅ **Office Script** for the pro-forma escalation fix — `architecture/office-scripts/apply-lease-escalation.ts`
  (+ wiring README). ⏳ load into Office Scripts + build the Power Automate flow.
- 🚫 **Work IQ Mail / Teams** — excluded (email/comms stay on the LCC path).
- 🔮 **Work IQ Word/User/Calendar, Azure AI Document Intelligence, Approvals, a `Sites.Selected` Graph app** —
  scoped as roadmap.

## Connected-agent model (task agents connected to the Deal Agent)
- ✅ **Settled & documented** — orchestrator + specialists *only* for tool-heavy capabilities; the 9 catalog
  roles stay as flows. Reconciled under "one brain, unlimited front doors."
- ⏳ **Built** — the two specialists' Studio creation (yours) is the remaining step; everything they need is specced.

## Cortex (memory) & personal
- ✅ **Cortex** — server-side, device-agnostic; reachable on every surface; write-gated (`log_memory` Claude/MCP-only).
- ✅ **Personal binding** — `canon/personal.md` (same brain/memory/voice, scoped off team surfaces).
- ✅ **Access/device topology** — `ACCESS-TOPOLOGY.md` maps devices × storage × surfaces; flags the D-drive
  island; gives the personal-project homing rules.

## Deal intelligence — dossier + Salesforce write-back (NEW, 2026-07-27)
- ✅ **Deal Dossier** — `get_deal_dossier` / `list_deal_checkpoints` LIVE on the engine; a per-deal projection
  over `entities` + `activity_events` (snapshot + milestone timeline w/ overdue/due-soon flags + correspondence).
  Fresenius Woodland Hills seeded. Read proven on Copilot + the connector.
- ✅ **Salesforce write-back (LCC-brokered, link-only)** — LIVE end to end. LCC is system of record; deal calls
  stay in LCC; BD calls with a person post a link-only SF Task (`Description="Ref: <lcc_activity_id>"`, notes
  never egress). `mcp/sf-writeback.js` → `sf_sync_queue` → PA "LCC → SF Queue Drainer" → existing SF Task flow.
  Proven with Frank Meyrath (SF Task `00TVs00001ND0eFMAT`).
- ✅ **Canonical connector** — `copilot/lcc-deal-intelligence.connector.v4.swagger.json` (53 ops, de-duped,
  dialog-safe). Full resume guide: `architecture/SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md`.
- ⏳ **Drainer → other kinds** — extend to `create_task` + `advance_opportunity_stage` (pattern proven for log_call).

## Deal backbone — SF Deal/Opportunity → LCC sync (BUILD 01, LIVE 2026-07-28)
- ✅ **Pipeline sync LIVE** — PA flow "SF Deal → LCC Opportunity Sync" (scheduled ~30 min, On) pulls all Team
  Briggs Opportunity records (the object labeled "Deal" IS the standard `Opportunity`) filtered to 6 investment-
  sales record types, and POSTs the whole Get-records array to the engine batch endpoint
  `POST /api/pipeline/ingest-opportunities`. **592 deals on `bd_opportunities`**: 219 closed-won, 339 closed-lost,
  34 open (the real active pipeline). Idempotent, self-healing full-refresh.
- ✅ **Engine endpoints** — `mcp/opportunity-sync.js`: single (`/ingest-opportunity`, Copilot/manual) + batch
  (`/ingest-opportunities`, server-side loop, concurrency 8, per-deal 20s timeout). Resolves deal→asset by
  city+state (tenant token breaks collisions), idempotent upsert on `(workspace_id, sf_opp_id)`, inherits
  vertical from the entity domain, maps owner via `lcc_users.salesforce_owner_id` (4/4 mapped; historical deals
  owned by other brokers keep their raw SF owner id in metadata).
- ✅ **Stage vocabulary (real, in-org)** — STAGE_MAP covers BOV, ELA, LOI Executed, In Escrow, Non-Refundable,
  Closed, Listing Signed, Off-Market Listing, Closed IS (=closed-won), Terminated IS (=closed-lost). Won/lost
  derived into `closed_at`/`closed_won`; `is_open` is a GENERATED column.
- 📐 **Entity reconciliation (NEW — needed at scale)** — 232 deals in multi-asset cities created flagged
  entities (`entities.metadata.ambiguous_resolution` = candidate list) rather than matching an existing asset.
  Needs a review/merge pass; now a first-class build, not a footnote.
- ⏳ **Incremental optimization** — currently full-refresh every 30 min (cheap + robust). Optional later:
  add a `LastModifiedDate` window (needs the Compose-action pattern; the inline `@{}` token would not take).
- **Hard-won fixes banked**: engine deploys from `mcp/` (import via `./`); PA Filter Query is **OData not SOQL**
  (`eq`/`or`/`and`, filter on direct `RecordTypeId`, not `RecordType.Name`); **batch endpoint replaced the PA
  Apply-to-each** (which hung 10h on record 1 with no timeout); **`opsQuery` now forwards `Prefer`** (upsert was
  silently insert-only → 23505 collision on every re-sync); generated `is_open`; all-dash "Tenant - City - State"
  name parsing; ambiguous resolution never 409s (creates flagged entity); Closed-IS won detection.

## Deal Roster — Team Briggs scope (BUILD 02 Slice A, LIVE 2026-07-28)
- ✅ **Team-roster edges LIVE** — PA flow "SF Deal Team → LCC Roster" (Deal Team Member object, OData filter
  `UserId` ∈ the 4 TB users) → batch `POST /api/pipeline/ingest-deal-parties` → `mcp/deal-roster.js` writes
  `entity_relationships` `deal_party` edges (deal-asset → TB person, role `our_broker`, source `sf_opp_team`).
  **192 edges / 192 deals.** Idempotent check-then-insert (no unique constraint added to the 109k-edge graph).
- ✅ **Scope is now accurate** — open Team Briggs deals = **23 of 34** (19 owned + 4 partnership-only); 11 correctly
  excluded. Rule: `owner_user_id ∈ TB  OR  deal_party edge to a TB person  OR  metadata.team_briggs_include`;
  default = exclude. (`docs/os/architecture/deal-backbone-design-refinements.md`.)
- ✅ **STAGE_REGIME** shipped in `mcp/opportunity-sync.js` (A active-listing / B contractual / C terminal) and
  returned by the ingest endpoint; cadence-scan + deal monitor read it.
- 🚫 **Slice B via SF OpportunityContactRole — DEAD END for TB.** Endpoint `ingest-deal-contacts` built + working
  (verified with a real pair), but OCR is **empty for Team Briggs deals** (7,201 rows firm-wide, 0 on any of the
  592 backbone deals, confirmed after 15-char id normalization). TB does not track external parties in standard
  contact roles. **Re-spec:** `docs/os/architecture/deal-party-roster-source.md`. Party source is likely the
  custom **`Deal_Participants__c`** object (verify next) and/or the `.md` dossier rosters; the deal-email matcher
  pivots to **strong-signal-primary** (address / escrow# / OM-PSA) with the roster as a byproduct. Pause the empty
  OCR flow.
- 📌 **Identity rules surfaced** — (1) match SF↔LCC ids on the **15-char prefix** everywhere (needs a shared
  helper); (2) **contact-entity resolution backfill** — only 5,651/17,289 SF contacts resolve to a person entity,
  which caps the roster + matcher.

## Cadence Engine — cadence-scan (BUILD 03, LIVE 2026-07-28)
- ✅ **`GET/POST /api/pipeline/cadence-scan`** — read-only "what needs a touch" digest over IN-SCOPE open deals
  (`mcp/cadence-scan.js`). Reads `bd_opportunities` + `STAGE_REGIME` + `activity_events`. Regime A → touch-due
  (interval per stage: identified 7d, active listings 14d) vs last call/email; Regime B → surfaced as contractual
  (the deal monitor owns cadence there); Regime C → skipped. Ranked overdue → needs-first-touch → due-soon →
  on-track. **Verified live: 21 in-scope open (16 A, 5 contractual), 16 needs-first-touch.**
- ✅ **Sharpened by BUILD 04** — see below; last-touch now reflects attributed email.

## Deal-Email Matcher (BUILD 04, LIVE 2026-07-28)
- ✅ **`POST /api/pipeline/match-deal-emails`** (`mcp/deal-email-matcher.js`) — attributes Outlook emails to
  in-scope open deals by STRONG SIGNAL (**tenant AND city** in subject/body; precision-first — city-alone
  over-attributes badly, validated). On a match it writes a deal-attributed `activity_events` row on the asset
  (idempotent by `entity_id`+`external_id`) AND an `email_derived` `deal_party` edge — **the roster self-builds**.
  **First run: 65 emails → 8 deals, 17 roster edges, 0 dupes; spot-checked precise** (Valley MOB marketing +
  diligence threads).
- ✅ **cadence-scan is now REAL** — with attributed activity the digest went from 16 needs-first-touch / 0
  actionable to **4 overdue + 1 on-track** (e.g. a Listing Signed deal 82 days past its 14-day cadence). The
  spine connects end to end: SF pipeline → backbone → scope → correspondence → next-best-touch.
- ✅ **Weekly / pipeline email LIVE (BUILD 05, Spine #6)** — `GET /api/pipeline/weekly-digest` returns a
  ready-to-send email (`subject` + engine-composed `html` + `text`; shared `computeScan` with cadence-scan). PA
  flow "Team Briggs Weekly Pipeline" (Recurrence → POST `match-deal-emails` → GET `weekly-digest` → Outlook Send
  Email V2 with `@{body('Get_Digest')?['subject']}` and Body in code/HTML view `@{body('Get_Digest')?['html']}`)
  delivers it. **Verified end-to-end in-inbox** — overdue-first, tenant/city labels, stages, days-overdue,
  contractual section. The recurrence also schedules the matcher (keeps attribution fresh).
- 📐 **Next / backlog** — fold the digest into the existing **daily LCC email** as a section (leaner
  `cadence-section` variant); add **address / escrow# / OM-PSA** matcher signals for recall (misses e.g.
  Innovative Renal Care); store SF `deal_name` on `bd_opportunities`; contact-entity resolution backfill; the
  shared SF 15-char-id helper.
- 📐 **Proactive Deal Monitor** — the automation-plane loop that reads `list_deal_checkpoints` on a schedule and
  acts on overdue/due-soon milestones (notify / draft / update). Foundation now exists; loop not yet built.
- 📐 **Mail-intake → dossier** — Outlook deal-mail distilled into `activity_events` so correspondence auto-appends.

## Consolidation & hygiene
- ✅ **Graveyard** — superseded files moved to `_superseded/` with an index; back-compat items documented.
- ⏳ **SharePoint `_WORKFLOW` deployment docs** (4) — correct via Copilot in-tenant now that Phase 1 is live.
- ⏳ **`LCC_API_KEY` rotation** — deferred to the end (threaded through Power Automate flows).

## What "done" needs (remaining)
1. Manual surface applies: paste ChatGPT persona; sync Northmarq/Personal/Cowork bundles.
2. Create the 2 Copilot specialists in Studio + publish the delegation block; apply the Work IQ least-privilege config.
3. Load the Office Script + build its Power Automate flow.
4. `git push` the repo; triage D-drive files; home the personal projects (`ACCESS-TOPOLOGY.md`).
5. Correct the 4 SharePoint deployment docs; (last) rotate `LCC_API_KEY`.
6. Optional: unification Phase 2.
