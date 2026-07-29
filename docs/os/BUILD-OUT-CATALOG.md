# LCC OS — Build-Out Catalog (the finish line)

_Created 2026-07-28. A single master checklist of everything left to finish the Life Command Center OS, so
nothing is lost. Legend: ✅ done · ⏳ built, pending a manual apply · 📐 designed/specced, not built · 🔨 build
work remaining · 🚫 excluded by decision · 🔮 roadmap. **Owner:** 🤖 = I can drive it from here (engine/DB/docs);
🧑 = needs Scott (his M365/Salesforce/Studio tenant or a human decision). Priority: P1 accuracy/blocking · P2
value · P3 polish/roadmap._

Anchor state today: the deal-intelligence spine (BUILD 01–05) is LIVE end-to-end; all three Supabase DBs are at
**0 security-advisor ERRORs**; the nightly provenance-prune cron is fixed; two To-Do PA flows are root-caused
and waiting on a list repair. The items below are what remains.

---

## A. Deal-intelligence spine — hardening the live system  (Track 1)

| # | Item | Status | Owner | Pri | Notes |
|---|------|--------|-------|-----|-------|
| A1 | **Entity reconciliation** | ✅ RESOLVED — 0 open flagged | 🤖+🧑 | — | `reconcile-entity` + `flagged-deals` endpoints over atomic DB fns + the A1e engine. **All 7 open TB flagged deals resolved 2026-07-28** (Zapata dup-merge, DCi via tenant signal, IRC linked, + Action Behavior/Archbold/Concentra/Fresenius enriched with real SF addresses). **Open TB flagged backlog = 0.** Key proof: 4/5 real addresses were NOT in their candidate sets, so the observation/enrich engine was necessary (hand-picking candidates would have been wrong). **Backlog sweep 2026-07-29 (sweep v3, `…_v3_closed_and_dedup`): flagged 238 → 197, 41 auto-linked** (extended reconcile to closed deals + addr_key dedup tie-break; unique tenant-in-city matches only; 0 integrity issues). Residual 197 = ~150 no-tenant-match (need address feed) + ~35 genuine multi-property ties — the finite review tail, drains via A1f/A1g feeds. |
| A2 | **Contact-entity resolution** | 📐 design-gated | 🤖+🧑 | P2 (was P1) | **Reclassified 2026-07-28** (`architecture/contact-entity-resolution.md`). 31,014 contacts, 5,696 linked; only **41** match an existing entity by email — the gap is entity *creation* (~11,700 recoverable), a policy decision coupled to A6. ~13,505 are no-signal junk. Recommend: settle A6, then scoped creation. No bulk create done. |
| A3 | **Shared SF 15-char-id helper** | 🔨 | 🤖 | P2 | One helper for SF↔LCC id matching (15-char prefix) used everywhere; today the logic is duplicated. |
| A4 | **Store SF `deal_name` on `bd_opportunities`** | ⏳ deploy pending | 🤖 | P2 | **Done 2026-07-28** — name was parsed then discarded; not in metadata at all. Column added live; `opportunity-sync.js` now writes `deal_name = b.name`. Populates on next full-refresh once redeployed. Migration `20260728150000_bd_opportunities_add_deal_name.sql`. |
| A5 | **Matcher recall v2.1** | ✅ LIVE 2026-07-28 | 🤖 | — | Shipped core-tenant + city + word-boundary + digest-exclusion (`deal-email-matcher.js`). Dry-run **refuted** the tempting tenant-alone idea (would've mis-attributed same-operator/different-property mail — IRC Arvada→Milwaukee, etc.); city is load-bearing. Live run: **+121 attributions, +33 roster edges**, precise. Idempotency aligned to the unique constraint. `?dry_run=1` retained. (`matcher-recall-design.md`.) |
| A5b | **Populate asset property addresses** | ⚠️ SF route blocked | 🤖+🧑 | P2 | SF address is on the related Property (`Property2__r`), but the formula field is FLS-hidden AND the PA connector can't traverse relationships, AND assets carry no SF id — all three automated SF routes dead-end (Scott has no SF admin). Superseded by A1e (the observation engine), which is source-agnostic. |
| A1e | **Deal-Address Resolution Engine** | ✅ Phase 1 LIVE | 🤖 | — | **Built 2026-07-28** (`deal-address-resolution-design.md`, migrations `…_deal_address_observations_engine`, `…_sweep_v2_enrich`). Mirrors the Owner Reconcile Engine: `lcc_deal_address_observations` + scored `reconcile_deal_addresses_sweep` (shared `lcc_normalize_address`, `addr_key` street match, `lcc_reconcile_match_threshold`, reversible). Source-agnostic **link-or-enrich**. DCi auto-resolved (tenant signal); 5 await an address feed. |
| A1f | **OM/document-ingestion feed** (Phase 2) | 📐 next build | 🤖+🧑 | P2 | The automation that eliminates manual address entry: ingest listing OMs/deal-folder docs → extract address → record as observations feeding A1e. Prereq: the doc pipeline (SharePoint crawl `sharepoint_documents` is empty; `lcc_cre_property_document_text` covers only 38 props). Highest-leverage automation for capturing TB's own listing addresses. |
| A1g | **SF browser-read address feed** (finding 2026-07-28) | 📐 | 🤖 | P2 | The SF Deal record PAGE renders `Property_Address__c` fine even though the API/connector can't (FLS + no relationship traversal). So a Claude-in-Chrome read of the Deal record is a viable, automatable observation feed that **bypasses the API block entirely** — proven live (all 5 addresses pulled this way). Could run on a schedule to feed A1e for any flagged deal, no SF admin needed. Second automated feed alongside A1f. |
| A6 | **Deal-party roster real source** | ✅ RESOLVED | 🤖 | — | **Verified 2026-07-28 via SF Object Manager.** `Deal_Participants__c.Deal` = `Fannie_Mae_Deal__c` (lending/agency), NOT the Opportunity. Combined with empty OCR → **no structured SF object holds TB deal parties.** The correspondence-driven matcher (+ `.md` dossiers) is the roster. (`deal-party-roster-source.md`.) |
| A7 | **Proactive Deal Monitor** | 📐 | 🤖 | P2 | The automation-plane loop: read `list_deal_checkpoints` on a schedule, act on overdue/due-soon milestones (notify/draft/update). Foundation exists; loop not built. |
| A8 | **Mail-intake → dossier** | 📐 | 🤖+🧑 | P2 | Distill Outlook deal-mail into `activity_events` so correspondence auto-appends to dossiers (broader than the matcher). Related to B2 (team mailboxes). |
| A9 | **SF write-back drainer → more kinds** | ⏳ | 🤖 | P2 | Extend the proven log_call drainer to `create_task` + `advance_opportunity_stage`. |
| A10 | **Fold digest into daily LCC email** | 📐 | 🤖 | P3 | A leaner `cadence-section` variant embedded in the existing daily email, vs a standalone send. |
| A11 | **Incremental sync optimization** | 🔮 | 🤖 | P3 | Currently full-refresh every 30 min (robust, cheap). Optional `LastModifiedDate` window later (needs the Compose-action pattern). |

## B. Team visibility & delivery  (owner-scoping design note)

| # | Item | Status | Owner | Pri | Notes |
|---|------|--------|-------|-----|-------|
| B1 | **Per-broker delivery (Flow B)** | 📐 ready, **PARKED** | 🧑 | P2 | Owner-scoped digests are live in the engine + specced as a PA flow. **Deferred by Scott** until build-out done + errors triaged. Un-park when ready. |
| B2 | **Team mailbox intake** (Kelly/Sarah/Nate) | 📐 designed, **PARKED** | 🤖+🧑 | P1 for accuracy | **Specced 2026-07-28** (`team-mailbox-intake-design.md`). Biggest cadence-accuracy lever (LCC sees only Scott's mailbox; all outlook rows are `SYSTEM_ACTOR` — no per-broker attribution). Extends the existing intake pipeline; core change = stamp `actor_id` per broker; privacy via match-then-persist. **Auth = Option A confirmed**: email access is a per-mailbox PA Outlook flow (not app-login; only Webex uses stored OAuth) — so adding brokers = replicate Scott's flow, no admin. **Deferred by Scott.** Phase 1 (attribution) is buildable independently, no mailbox changes. |

## C. Surfaces & rollout  (Track 3 — mostly your tenant)

| # | Item | Status | Owner | Pri | Notes |
|---|------|--------|-------|-----|-------|
| C1 | **Paste ChatGPT persona** into the GPT | ⏳ | 🧑 | P2 | Canon-migrated + parity ✓; just needs pasting. |
| C2 | **Sync surface bundles** (Northmarq Claude project prompt, Personal Claude / Cowork skills) | ⏳ | 🧑 | P2 | Generated in `surfaces/`; paste pending. |
| C3 | **Create 2 Copilot specialists** (Document Files Agent, Document Assembly Agent) | 📐 ready | 🧑 | P2 | Routing descriptions + instructions paste-ready; create in Studio, connect to the orchestrator, publish the delegation block. |
| C4 | **Work IQ least-privilege config** | ⏳ | 🧑 | P2 | Apply the enable set + pin the Team Briggs site via Inputs + end-user auth. |
| C5 | **Office Script + its PA flow** (pro-forma lease-escalation fix) | ⏳ | 🧑 | P2 | Load `office-scripts/apply-lease-escalation.ts` into Office Scripts, build the flow. |

## D. Operational errors — open (from the triage board)

| # | Item | Status | Owner | Pri | Notes |
|---|------|--------|-------|-----|-------|
| D1 | **Repair the deleted To-Do list** | 🔨 root-caused | 🧑 | **P1** | Fixes BOTH failing PA flows at once (`To Do - Life Command Center Sync` + `LCC To Do Completion Poll`) — both 404 on a To-Do list that was deleted/renamed. Re-pick the list in each failing action. |
| D2 | **`gov:loans` stale feed** | 🔨 | 🤖+🧑 | P2 | Loans (gov) feed 31d stale (SLA 30d) — the ingest may have stopped; investigate the loans ingest job. |
| D3 | **`HTTP-Switch` flow** | 👀 watch | 🧑 | P3 | Single failure (07-28 17:00); likely transient. |
| D4 | **Stale pipelines** (dialysis cms_ingestion 33d, email 117d) | 👀 confirm | 🧑 | P3 | Confirm whether intended cadence or actually stalled. |
| D5 | **Resolve/age the 16 open `lcc_health_alerts`** | 🔨 | 🤖 | P3 | Once D1/D2 clear + the prune fix lands tonight, clear the stale alert rows so Ops Health reflects reality. |

## E. Security & hygiene  (Track 4 — largely closed by the 2026-07-28 RLS work)

| # | Item | Status | Owner | Pri | Notes |
|---|------|--------|-------|-----|-------|
| E1 | **Security-advisor ERRORs → 0 on all 3 DBs** | ✅ DONE | 🤖 | — | OPS 135→0, GOV 304→0, DIA 489→0 (928 cleared). |
| E2 | **Function `search_path` hardening + revoke EXECUTE from anon/authenticated** | 🔨 | 🤖 | P2 | WARN-level: ~130 (OPS) + 150 (GOV) + 228 (DIA) functions with mutable search_path; plus the anon/authenticated executable grants. Safe (engine calls via service_role); staged as a deliberate pass. |
| E3 | **DIA Postgres upgrade** (PG15 → current) | 🔨 | 🧑 | P2 | DIA flagged `vulnerable_postgres_version`; schedule the upgrade (brief maintenance). |
| E4 | **`materialized_view_in_api`** (OPS 2, GOV 5, DIA 13) | 🔨 | 🤖 | P3 | Matviews can't take `security_invoker`; revoke from anon/authenticated instead. Low urgency (no anon exists). |
| E5 | **`auth_leaked_password_protection`** (OPS) | 🔨 | 🧑 | P3 | One toggle in Auth settings. |
| E6 | **`LCC_API_KEY` rotation** | ⏳ deferred | 🧑 | P2 | Threaded through the PA flows; rotate at the end so nothing breaks mid-build. |
| E7 | **git push accumulated commits** | 🔨 | 🧑 | P2 | The session's migrations + docs are on disk; keep pushing them. |
| E8 | **D-drive triage + home personal projects** | 📐 | 🧑 | P3 | `ACCESS-TOPOLOGY.md` flags the D-drive island + personal-project homing rules. |
| E9 | **Correct 4 SharePoint `_WORKFLOW` deployment docs** | ⏳ | 🧑 | P3 | Fix via Copilot in-tenant now that Phase 1 is live. |

## F. Roadmap (explicitly optional)

| # | Item | Status | Notes |
|---|------|--------|-------|
| F1 | **Unification Phase 2** | 🔮 | Collapse the two-server topology into one service, retire the standby (`unification-changeset.md`). |
| F2 | **Roadmap Work IQ** | 🔮 | Word/User/Calendar, Azure AI Document Intelligence, Approvals, a `Sites.Selected` Graph app. |

---

## Design forks that need a decision before building (the "stop us" items)

These are the places where I should not just build — they need your call:

1. **Entity reconciliation (A1).** 232 deals in multi-asset cities are parked as flagged/ambiguous entities. The
   design question: do we (a) auto-merge on a best-match heuristic with a review queue for low-confidence ones,
   (b) require manual confirmation for all 232, or (c) treat the flagged entity as canonical and merge lazily
   when more signal arrives? This affects data quality across the whole backbone — worth a short spec.

2. **Deal-party roster source (A6).** OCR is a dead end for TB. Before building, we should confirm whether
   `Deal_Participants__c` is the real party object (you have a Salesforce tab open on exactly that object) or
   whether the `.md` dossier rosters are the truth. The answer changes what the roster + matcher read.

3. **Team mailbox intake (B2).** The single biggest accuracy lever. The design questions: which mailboxes, what
   auth model (shared-mailbox vs delegated vs app-only Graph), and how to attribute activity to the right broker.
   Everything cadence-related is only as honest as this.

## Suggested next moves (my read)
- **Now, 🤖-drivable, high value:** A2 (contact backfill) and A3 (id helper) unblock A5/A6 and the roster; E2
  (function hardening) finishes the security sweep. I can do these without your tenant.
- **Needs a short design pass with you:** A1 and A6 (and B2 when you want the accuracy lever). Say the word and
  I'll write the mini-spec for each so we decide, then build.
- **Your tenant, whenever:** D1 (repairs two flows at once), then C1–C5 rollout.
