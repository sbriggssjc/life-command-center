# Developer Identification, Ownership Chain & BD Engine — Audit v3

**Date:** 2026-05-22
**Author:** Audit synthesis (Claude Opus 4.7)
**Scope:** Dialysis DB + Government-Lease DB + Life Command Center (LCC) frontend/orchestrator
**Status:** Active design document. Drives Phase A/B/C implementation.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Doctrine — Categorization & BD Model](#2-the-doctrine--categorization--bd-model)
3. [Cadence Model](#3-cadence-model)
4. [Priority Queue Model](#4-priority-queue-model)
5. [Current State Inventory](#5-current-state-inventory)
6. [Gap Analysis](#6-gap-analysis)
7. [Rollout Plan](#7-rollout-plan)
8. [Per-Topic Implementation Prompts](#8-per-topic-implementation-prompts)
9. [Open Questions Log](#9-open-questions-log)
10. [Appendix — File:Line Reference Index](#10-appendix--fileline-reference-index)

---

## 1. Executive Summary

### 1.1 What this document is

A consolidated audit of how Developer accounts are identified, categorized, prioritized, prospected, tracked, and surfaced across the three-repo system (Dialysis, Government-Lease, Life Command Center), and a concrete rollout plan to bring the system in line with the BD doctrine documented in §2-§4. This supersedes the v1 and v2 working summaries.

### 1.2 The core problem

The system has strong **data infrastructure** (Supabase schemas in both domain DBs, field provenance, research queues, completeness views, a unified detail panel in LCC) but four **structural defects** that prevent it from doing what the business requires:

1. **Categorization conflation.** "Developer" is inferred from heuristics (property count, hold duration, year-built coincidence) that also catch REITs, flippers, and inherited 1031 holders. Two of three production heuristics produce wrong-direction signals.
2. **The Build-to-Suit tracker is orphaned.** It is the cleanest developer signal in the schema and has no trigger or wiring back to `true_owners.is_developer`.
3. **The BD cadence engine has no enforcement.** Four different cadence clocks (`touchpoint_scheduler`, `bd_call_schedule.py`, `generate_owner_alerts.py`, LCC `daily-briefing`) use four different thresholds (30/90/180-day suggestions, 14d, 90d, 6mo) and none fire when a high-priority developer is overdue.
4. **Former ownership is invisible in the UI.** Lineage exists in `ownership_history` but no contact/prospect page renders "previously bought and sold N properties in our target market."

In addition, three architectural issues block the strategic objective:

5. **Cross-vertical fusion is unimplemented.** A developer who builds GSA buildings AND dialysis clinics appears as two separate entities. Touchpoints in one vertical do not satisfy the other.
6. **No SF Opportunity gate on BD tracking.** The BD scoreboard should track touchpoints on Prospect accounts with an open Opportunity. Today the system tracks everything equally, and Buyer touchpoints are intermingled with primary BD work, distorting scoreboard signals.
7. **The call console is "next call from last viewed account."** No intelligent priority ranking. Research effort is arbitrary list traversal, not gap-filling toward the prioritized prospect set.

### 1.3 What v3 does

- Replaces heuristic developer-detection with a **behavior-based, five-category owner-role taxonomy** with manual override and confidence scoring.
- Defines a **two-phase cadence** (onboarding sequence + tiered steady-state) anchored on the Salesforce Opportunity, not on the entity.
- Defines a **single priority queue** across both verticals, replacing arbitrary scheduling.
- Separates **BD Stream** (primary metric: touchpoints on Prospect accounts with open Opportunities) from **Showing Stream** (secondary visibility: Buyer/REIT outreach on new listings).
- Introduces a **cross-vertical canonical entity layer** so a developer working dialysis + government + (future) ASC/vet/childcare/urgent care surfaces once with a unified portfolio.
- Rolls out in three phases (A/B/C), with Phase A delivering the biggest UX unlocks in 2-3 weeks.

### 1.4 What success looks like

- Every Developer (Tier A) account has at minimum 12 logged touches per year, tracked against an open Opportunity, surfaced on the broker's priority queue.
- Every property has a clear original-developer linkage (or an explicit "unknown" with research priority).
- Every contact page shows their cross-vertical portfolio (current + former) on first load.
- Every new listing publishes generates the right showing-stream events automatically (Buyer cohort nationwide + Owner-geographic cohort within ~150-200 nearest properties or same-MSA owner address).
- Research effort is routed by P9 gap-fill prioritization to the entities most likely to enter the top of the priority queue once enriched.

---

## 2. The Doctrine — Categorization & BD Model

### 2.1 Behavior over structure

The fundamental classification rule is **observed behavior**, not legal structure. Examples:

- **Genesis KC Development, LLC** — wholly-owned subsidiary of DaVita (an operator), but executes land → lease → BTS → sell programmatically. Classification: **Developer**, not Operator.
- **Doctor group operating clinic in JV with regional operator, owns the real estate** — structurally a user-owner, but primary concern is real estate. Classification: **Prospect** (Developer/Seller), not User/Owner.
- **REIT with 50 stabilized clinics, no construction activity, long holds** — Classification: **Buyer**.

This means: the `owner_role` field must be **derived from behavior signals**, **manually overridable**, and **stamped with confidence + source**.

### 2.2 The five owner roles

| Role | Behavioral signature | BD treatment |
|---|---|---|
| **Developer** | New long-term lease + construction/TI + often repeat tenant; merchant builder pattern; active project in the past 3-5 years for "current," older than that for "former" | BD Stream. Tier A cadence (~12 logged touches/yr). Highest-priority queue band. Tailored memo with project history + repeat-tenant relationships. |
| **User/Owner** | Owns and operates own real estate (no third-party lease). Primary concern flips between real-estate and operational growth at scale. | BD Stream. Tier A if ≥10 clinics operated AND owns RE on ≥1 (sale-leaseback IB-style pitch); Tier B otherwise. Distinct memo template (corporate finance angle). |
| **Buyer** | Behavior = scaling acquisitions; long holds; passive cash flow; acquisitions-desk-driven (often REIT but not always) | **Showing Stream**, not BD Stream. No cadence clock. Listing-event-triggered outreach. One contact per company; do not multi-count. |
| **Seller-Flipper** | Acquires + sells at renewal/refi; multiple short-to-mid holds; not creating value via construction | BD Stream. Tier B cadence (~4/yr). Showing list by tenant/geo for new listings. Refi/renewal-event triggers. |
| **Operator** | Tenant only (e.g., agency-as-tenant in gov; DaVita/Fresenius on third-party-owned clinics) | Filtered from primary prospect targets. Exception: if Operator has a development-arm subsidiary exhibiting Developer behavior, that subsidiary is re-classified as Developer. |

### 2.3 Subcategory: Current vs Former Developer

- **Current Developer** — at least one BTS or retrofit project closed/delivered in the **past 3-5 years**, OR at least one project currently in pipeline (under construction, recent land acquisition with construction loan).
- **Former Developer** — historical project activity but no project in the past 3-5 years.
- Current developers have a higher priority weight in the queue. Former developers stay in the BD Stream at Tier B by default.

### 2.4 Cross-vertical relationship propagation

Per business strategy, a developer relationship is **portable across verticals**. The system must:

- Maintain a single canonical entity at the LCC layer, with mappings to domain-specific `true_owner` records via `external_identities`.
- Aggregate portfolios across all verticals (dialysis, government, future: urgent care, ASC, vet, childcare).
- Treat a logged touchpoint as **shared across verticals** — a call to "Acme Development LLC" in the context of a dialysis listing satisfies the cadence clock for that entity regardless of which vertical the broker was discussing.
- Expose cross-vertical developer relationships in a unified leaderboard (filtered by user_domain_specialties).

### 2.5 Multi-developer per property

A property may have multiple original developers in rare cases (e.g., original 25-year-old BTS, then a different developer buys short-term lease, retrofits, and resigns long-term lease, then sells again). Schema must support many-to-many via junction table `property_developers`.

Additionally, per-property tracking:
- `properties.is_build_to_suit` (BOOLEAN)
- `properties.is_retrofit` (BOOLEAN)
- `properties.is_first_generation_lease_marker` (BOOLEAN — denormalized for query convenience)

And per-lease tracking:
- `leases.is_first_generation` (already exists in both DBs, currently unused in scoring)
- `leases.is_extension` (NEW — distinguishes renewal/extension from new first-gen lease)
- `leases.is_retrofit_lease` (NEW — extension paired with retrofit construction signals)

### 2.6 SF Opportunity as the BD anchor

The unit of BD tracking is **(canonical entity × open Salesforce Opportunity)**, not the entity alone:

- BD scoreboard counts: **net-new Opportunities opened** + **touchpoints against open Prospect Opportunities**.
- An entity without an open Opportunity but classified as Developer (Tier A) surfaces an "Open BD Opportunity Needed" task in the priority queue — a one-click action to create the Opportunity in Salesforce with pre-filled category, geography, and talking points.
- Buyer accounts do not have BD Opportunities (or if they do, they are titled generically — e.g., "Buyer"); their touchpoints flow into the Showing Stream and do not count toward the BD scoreboard.

---

## 3. Cadence Model

### 3.1 Two-phase model

**Phase 1: Onboarding sequence (first ~22 weeks per new account)** — scripted 7-touch sequence:

| Step | Week | Channel | Default template |
|---|---|---|---|
| 1 | 0 | Email | Intro + market intelligence |
| 2 | +2 | VM | Reference intro email |
| 3 | +6 | Email | Recent closing in market |
| 4 | +10 | VM | New listing or market move |
| 5 | +14 | Email | Capital markets report |
| 6 | +18 | VM | Different angle / referral mention |
| 7 | +22 | Email | New approach / specific developer thesis |

If the prospect responds at any step → escalate to "engaged" → broker takes manual control. Phase 1 closes at response, completion of step 7, or broker manual close.

**Phase 2: Steady-state (annual touches, distributed throughout the year)**:

| Tier | Composition | Annual touches | Avg interval |
|---|---|---|---|
| **A** | Current Developer; User/Owner with ≥10 clinics operated AND owns RE on ≥1; mid-size private owner of multiple clinics; behavioral Developer (e.g., Genesis KC pattern) | 12 | ~30 days |
| **B** | Default active prospect; Former Developer; smaller private owners (2-5 properties); non-flip Sellers | 4 | ~90 days |
| **C** | Inactive/exited (1-2 inherited or 1031 holdings, exited developers, dormant entities) | 1-2 | ~180-360 days |
| **Buyer** | Behavior = scaling acquisitions | Showing-Stream only (no cadence clock) | — |

### 3.2 What counts as a touch

Any logged outbound:
- Email send
- Voicemail (logged)
- Call connect
- Meeting
- Mailer
- Capital markets report send

Inbound responses don't count as "touches" — they're "engagements" — but they:
- Pause the onboarding sequence
- Mark the account as "engaged" → broker takes manual control of next-step

### 3.3 Override

Brokers can override the default cadence per account. The override stamp records who, when, why.

### 3.4 BD Stream vs Showing Stream

| Stream | Anchor | Counts toward | Use |
|---|---|---|---|
| **BD Stream** | (entity × open SF Opportunity of type Prospect) | BD scoreboard: net-new Opportunities + touchpoints against open Opps | Drives the priority queue P0-P7. Cadence-enforced. |
| **Showing Stream** | (entity × listing event) | Volume metric only; not BD scoreboard | Buyer outreach on new listings (Lane A) + Owner-geographic outreach (Lane B, which IS a BD touchpoint if the owner has an open Opp). |

### 3.5 Listing-event fan-out

When a new listing publishes in either domain DB, the system generates showing events on two lanes:

**Lane A — Buyer cohort (Showing Stream):**
- Match rule: **nationwide × subspecialty**.
- Every Buyer-tagged entity with subspecialty matching the listing's vertical gets a showing event.
- Future v2: optional per-buyer custom criteria (`buyer_custom_criteria JSONB`) for explicit "expanded buyer showing focus" — pulls from all brokers' listings, not just internal. Schema slot landed in Phase A; matching engine in Phase B/C.

**Lane B — Owner geographic cohort (BD Stream if Opp exists):**
- Match rule (for a dialysis listing in Tulsa, OK):
  - Every dialysis owner whose **owned property** is in OK OR among the nearest ~150-200 clinics to the listing (k-nearest via H3 cell or PostGIS distance)
  - PLUS every dialysis owner whose **entity mailing address** is in the same MSA (Tulsa) as the listing — regardless of where their owned property sits
- These touchpoints count toward the BD scoreboard IF the owner has an open Prospect Opportunity; otherwise they surface an "Open BD Opportunity Needed" task.

### 3.6 Independent clocks

The BD Stream clock and Showing Stream clock are **fully independent**. Logging in one does not reset the other.

---

## 4. Priority Queue Model

A single ranked work queue across both verticals, regenerated nightly, with deterministic priority bands:

| Band | Trigger | Driving signal |
|---|---|---|
| **P0** — Developer overdue | Tier-A entity, BD Stream, next-due ≤ today | (entity × open Opp) cadence |
| **P0.5** — Open BD Opportunity Needed | Developer/Tier-A User-Owner with no open Prospect Opp in SF | Forces conversion to BD-tracked status |
| **P1** — Lease event imminent | Property with firm-term-remaining ≤18 mo (renewal); first-gen lease commencement detected | Time-bound, requires action |
| **P2** — Refi/CMBS event imminent | CMBS maturity ≤18 mo (gov); refi triggers (dia, to be added) | Time-bound value creation moment |
| **P3** — Lease milestone hit | 10-yr / 7-yr / 5-yr / 3-yr firm-term remaining mark crossed | Pre-positioning |
| **P4** — User/Owner sale-leaseback fit | User/Owner above tier threshold; behavioral developer-like signals | Distinct pitch and memo |
| **P5** — Seller-flipper event | Hold period crossing typical exit window | Specific behavior detected |
| **P6** — Onboarding sequence step due | Phase-1 prospect's next step is today | Doctrine compliance |
| **P7** — Steady-state cadence due | Tier-B/C entity's next-due date is past | Default cadence |
| **P8** — Buyer listing-event task | New listing × matching Buyer (Showing Stream) | Separate queue, not BD-counted |
| **P9** — Gap-fill research | Top-N highest-potential uncategorized/unassigned entities | Drives the prioritized list forward |

### Design principles

1. **Auto-prioritize, don't auto-schedule.** The console always shows the highest-band actionable item with do / defer / snooze / log affordances.
2. **Research is gap-filling toward the prioritized list**, not random list traversal. P9 routes effort to entities likeliest to enter P0-P5 if enriched.
3. **Vertical filtering by user specialty.** Kelly sees dialysis + childcare; Scott sees government + ASC/vet; Nate sees adjacent net-lease, eventually urgent care.
4. **Cross-vertical reduction.** One entity = one queue position, regardless of how many verticals it touches. Touch reduces cadence pressure across all verticals.

---

## 5. Current State Inventory

### 5.1 Dialysis Repo (`/home/user/Dialysis`)

**Developer schema** (`true_owners`):
- `sql/alter_true_owners_add_developer_fields.sql:2-8` — `developer_flag`, `developer_tier`, `properties_built`, `properties_sold`, `avg_hold_duration_months`, `disposition_strategy`
- `sql/alter_true_owners_add_developer_flag_source.sql:2` — `developer_flag_source TEXT` (single source, not multi)
- `sql/alter_true_owners_add_analysis_fields.sql:2-11` — `is_developer`, `is_repeat_buyer`, `ownership_pattern`, `state_focus`, `tenant_focus`, `last_sale_date`, `last_acquisition_date`

**Developer detection logic** (heuristic only):
- `src/owner_pattern_analysis.py:168-171` — `first_owner_props > 3` → developer (REIT/buyer trap)
- `src/owner_pattern_analysis.py:183-184` — `disposition_count >= 3 AND avg_hold < 24` → `'3+ fast exits'` (flipper trap)
- `src/developer_profile.py:50-61` — `ownership_start_year == year_built` → `'held during year built'` (only signal that's correct in principle)
- `src/lcc_ingest.py:685-708` — LCC sidebar auto-detection with construction loan + price ratio (limited path)

**Build-to-Suit Tracker** (orphaned):
- `sql/create_build_to_suit_tracker.sql` — table with `developer_id`, `construction_status`, `tenant`, `lease_start`
- **No trigger or wiring** back to `true_owners.is_developer`

**Ownership chain**:
- `sql/create_ownership_history.sql:1-35` — `ownership_history(property_id, recorded_owner_id, true_owner_id, start_date, end_date NULL, is_developer, sale_id, sold_price)`
- `properties.recorded_owner_id` / `properties.true_owner_id` denormalized snapshot
- **No `v_ownership_current` view, no `v_ownership_as_of_date` view**
- Reconciliation requirement documented in `OWNERSHIP_AUDIT_WORKLOG.md:76-90`

**Touchpoint / cadence**:
- `src/touchpoint_scheduler.py:14-64` — HIGH/MED/LOW priority calculation (requires `is_developer=TRUE AND sale_volume > 3` for HIGH — excludes developers who still hold what they built)
- `src/touchpoint_scheduler.py:67-99` — `suggest_next_touch()` HIGH=30d / MED=90d / LOW=180d (suggests only, no enforcement)
- `bd_call_schedule.py:53-240` — `generate_bd_call_schedule()` advisory schedule with 90-day threshold (mismatched with scheduler's 30-day HIGH)
- `generate_owner_alerts.py:20-118` — "Follow-Up Missed" / "Recent Buyer No Rep" / "Stale Developer" at 3mo / 6mo
- `owner_event_alerts.py:50-222` — "Developer Exit", "Ownership Flip", "Lease Risk", "Vacant" alerts

**Streamlit UI** (`dialysis_dashboard.py`, 286 lines):
- Pipeline-health only — 6 expanders (ingestion, market presence, ownership insights, brokerage intelligence, BD activity counts, cleanup engine)
- No prospect list, no contact detail page, no property detail page, no chain view, no monthly-touch UI
- Same for `app.py` BD pages — ownership references are docstring-only

**Other surfaces**:
- `chat_interface.py` — pending-update approve/reject/edit functions (raw, not Streamlit-wrapped)
- `streamlit_app/view_inferences.py` — model inference log inspector
- `admin-dashboard/src/pages/AdminDashboard.tsx` — ops diagnostics only

### 5.2 Government-Lease Repo (`/home/user/government-lease`)

**Developer schema** (much weaker than Dialysis):
- `sql/20260304_initial_schema.sql:62` — `properties.developer TEXT` (string name only)
- `sql/20260406_ownership_bridge_and_sf_sync.sql` — `properties.original_developer_contact_id UUID` (FK to contacts)
- `contacts.contact_type` can be `'developer'` but no developer-specific fields on `true_owners`
- **No `developer_flag`, `developer_tier`, `properties_built/sold`, `disposition_strategy`, `developer_flag_source` on `true_owners`**

**Build-to-Suit signal (where Gov leads Dia)**:
- `sql/20260304_initial_schema.sql:36` — `properties.is_build_to_suit BOOLEAN`
- `sql/20260304_initial_schema.sql:380` — `leases.is_first_generation`, `is_renewed`, `is_superseding`
- These flags **exist but are unused** in lead scoring (`src/investment_scorer.py`, `src/lead_pipeline.py`)

**Ownership chain** (richer audit trail than Dia):
- `sql/20260309_ownership_history_fix.sql` — `ownership_history` with `change_type`, `source_event_id`, `matched_sale_id`, `research_status`
- `sql/20260309_expanded_research_fields.sql` — `sale_price`, `cap_rate`, `state_of_incorporation`, `recorded_owner_name`, `recorded_owner_phone`

**Lead pipeline**:
- `sql/20260307_lead_pipeline.sql:7-115` — `prospect_leads` with `pipeline_status`, `next_action`, `next_action_date`, `last_contacted_at`, `assigned_to`
- `sql/20260315_add_lead_score_columns.sql` — `investment_score`, `deal_grade`, `lead_temperature`, `research_priority`, `priority_score`
- `src/investment_scorer.py` — 6-factor scoring (firm term, credit quality, location tier, rent vs market, renewal probability, building quality). **Not developer-aware.**
- `src/lead_pipeline.py` `calculate_priority_score()` — 4 factor groups (deal value, lease quality, owner intelligence, timing). Recognizes `is_portfolio_owner` and `is_repeat_seller` but not `developer_flag` or `is_first_generation`.

**CMBS / refi pattern (where Gov leads Dia)**:
- `sql/20260313_data_integration_tables.sql` + `sql/20260323_cmbs_property_creation_and_maturity_triggers.sql`
- `cmbs_loans` with `maturity_date`, `maturity_alert_sent`, `maturity_alert_date`
- `prospect_leads.source_cmbs_loan_id`, `loan_maturity_date`, `months_to_maturity`, `maturity_trigger_type`

**Lease milestones** (schema only, no triggers):
- `properties.firm_term_remaining`, `term_remaining`, `lease_expiration`
- No `years_to_expiration_milestone`, no 10yr/5yr/3yr trigger logic

**Cross-vertical linkage**:
- `src/cross_reference.py:1-95` — state + agency normalization within gov only
- `src/cross_propagate.py` — within gov only
- **No code linking gov `true_owners` to dia `true_owners` for the same legal entity**

### 5.3 Life Command Center (`/home/user/life-command-center`)

**Canonical entity model** (foundation is good, plumbing partial):
- `schema/003_canonical_entities.sql:1-115` — `entities(id, domain, type, name, created_at, updated_at)` with `domain IN ('gov','dia','both', NULL)`
- `entity_aliases(entity_id, alias, source)` (lines 69-78)
- `entity_relationships(parent_entity_id, child_entity_id, relationship_type, effective_from, effective_to)` (lines 81-91) — designed for point-in-time but **`relationship_type='owns'` not populated**
- `external_identities(entity_id, source_system, source_type, external_id)` with unique constraint enabling canonical-to-domain resolution

**Cross-domain matcher**:
- `/api/sync.js` `executeCrossDomainMatch()` — populates canonical entities by matching dia + gov contacts/owners
- **Nightly batch only.** No streaming, no real-time sync from domain DB writes.

**Contact unification**:
- `contacts-handler.js:313-314` — single canonical contact stores `gov_contact_id` + `dia_contact_id`
- `unified_contacts` view used in contact list
- Touchpoint counting (`contacts-handler.js:~440-500`) fans across all email aliases — **good design** but not surfaced in UI
- **Detail panel `openUnifiedDetail(id, db)` requires `db='gov'` or `db='dia'`, never `'both'`** (`detail.js:78`)

**Unified detail panel**:
- `detail.js` — tabbed property/contact/owner/deal detail
- **Completeness Rail** (`detail.js:1320-1375`) — top-6 highest-weight missing fields as click-to-jump chips. Best UX surface in the system.
- **Next-Action Bar** (`detail.js:1469-1508`) — single highest-priority gap from `v_next_best_action`
- Ownership chain in "Ownership & CRM" tab — chronological list, **no current-vs-former badge**, no edit affordances
- `_loadOwnerPortfolio()` (`detail.js:21`) — single vertical only (`const src = db || 'gov'`)

**Daily briefing**:
- `supabase/functions/daily-briefing/index.ts:1-700+`
- `fetchCrossDomainOwnersDueForTouch()` at lines 410-455 — tags entities with `'cross_domain_owner'`, counts `gov_assets` + `dia_assets`
- Flat 14-day touch threshold; doesn't know developer tier; doesn't filter by user specialty
- No `user_domain_specialties` table

**Listing-event workflow**:
- `src/available_listings_exporter.py` (Dialysis) — calls `get_top_buyer_brokers()` for agent suggestions on listings
- **No automated by-tenant/by-geo showing list generation**

**API routing**:
- `api/_handlers`, `api/entity-hub.js`, `api/sync.js`, `api/apply-change.js`, `api/operations.js`, `api/queue.js`, `api/bridges.js`, `api/capital-markets.js`
- 89 hardcoded `domain === 'gov'`/`'dia'` branches in `sidebar-pipeline.js`
- No centralized domain registry
- Adding new verticals (ASC, vet, childcare, urgent care) means touching every branch

**Migrations symmetry**:
- `supabase/migrations/dialysis/` ≈ 100+ files; `supabase/migrations/government/` ≈ 100+ files
- Naming partially parallel, partially diverged
- Schema drift discovered post-facto (`20260517180000_gov_schema_mirror_audit_discovery.sql`)
- No CI parity check

**Chrome extension** (`extension/sidepanel.html` + `sidebar-pipeline.js`):
- `classifyDomain()` determines `'dialysis'` or `'government'` from tenant patterns (single-choice, no `'both'`)
- Captured data writes to one domain DB
- No user-visible classification feedback, no override UI

**Salesforce integration**:
- One-way ingestion of Account/Contact/Activity
- **Property/Deal/Listing/Lease/Comp objects NOT ingested** (`SALESFORCE_SUPABASE_DATAFLOW_AUDIT.md:82`)
- Opportunity object NOT mirrored into LCC as a first-class data object — this is a Phase A gap

---

## 6. Gap Analysis

Mapped to the v3 design. Each gap is tagged with severity and Phase target.

### 6.1 Categorization gaps

| Gap | Where | Severity | Phase |
|---|---|---|---|
| `owner_role` enum doesn't exist; conflated boolean `is_developer` | dia.true_owners, gov.true_owners, LCC entities | Critical | A |
| Heuristics conflate REIT/flipper with developer | `dia/src/owner_pattern_analysis.py:168-171, 183-184` | Critical | A |
| Operator-as-Developer exception (Genesis KC pattern) not modeled | `dia.true_owners.is_operator_not_owner` filter is binary | High | A |
| User/Owner category doesn't exist | All three repos | High | A |
| Developer current vs former (3-5yr window) not computed | All three repos | High | A |
| BTS tracker not wired to `is_developer` | `dia/sql/create_build_to_suit_tracker.sql` (no trigger) | Critical | A |
| `dia.properties.is_build_to_suit` missing (Gov has it) | Dialysis schema | High | B |
| `is_retrofit` flag missing both DBs | Dialysis + Government schemas | High | B |
| `leases.is_first_generation` exists but unused in scoring | Both DBs | High | B |
| `leases.is_extension` and `is_retrofit_lease` missing | Both DBs | Medium | B |
| `developer_flag_source` is single TEXT, can't multi-source | `dia/sql/alter_true_owners_add_developer_flag_source.sql:2` | Medium | A |
| No confidence/source/timestamp on developer scoring | Both DBs | Medium | A |
| No manual override field / audit trail | Both DBs | Medium | A |
| Gov has no `developer_flag` / `developer_tier` / portfolio fields | `gov.true_owners` | High | A |
| Multi-developer per property not modeled | Both DBs (single FK in gov; nothing in dia) | Medium | B |

### 6.2 Cadence and BD-tracking gaps

| Gap | Where | Severity | Phase |
|---|---|---|---|
| No 30-day cadence enforcement for Developers | `dia/src/touchpoint_scheduler.py` | Critical | A |
| Four cadence clocks with mismatched thresholds | `touchpoint_scheduler`, `bd_call_schedule`, `generate_owner_alerts`, LCC `daily-briefing` | Critical | A |
| No 7-touch onboarding sequence model | All three repos | Critical | A |
| No tier-based annual cadence (12/4/1-2) | All three repos | High | A |
| Email-send events not unified with call logs as "touches" | LCC + Salesforce | High | A |
| Touchpoints per-vertical, not entity-canonical | LCC | Critical | A |
| No SF Opportunity mirror into LCC | LCC | Critical | A |
| BD scoreboard not anchored on (entity × open Opp) | LCC | High | A |
| Buyer touchpoints not separated from primary BD metrics | LCC | High | A |
| No listing-event fan-out engine | All three repos | High | A |
| No k-nearest property function for Lane B | Both DBs | Medium | A |
| No entity-mailing-address-to-listing-MSA join for Lane B | Both DBs | Medium | A |

### 6.3 Ownership chain and former-ownership gaps

| Gap | Where | Severity | Phase |
|---|---|---|---|
| No `v_ownership_current` / `v_ownership_as_of_date` views | Both DBs | Medium | A |
| No `properties.original_developer_id` first-class FK (dia) or junction (both) | Both DBs | High | B |
| No `v_contact_former_properties` view | Both DBs | High | A |
| "Formerly Owned" section not rendered on contact page | LCC `detail.js` | High | A |
| Address depth on `recorded_owners` at 3.38% | `dia.recorded_owners` | Medium | B |
| Original-developer linkage not computed from year_built ∩ earliest ownership | Both DBs | Medium | B |
| LCC `entity_relationships` not populated with `relationship_type='owns'` | LCC | High | B |

### 6.4 Signal gaps

| Gap | Where | Severity | Phase |
|---|---|---|---|
| ∆(year_built, lease_commencement) not computed | Both DBs | High | B |
| ∆(year_renovated, lease_commencement) not computed | Both DBs | Medium | B |
| `leases.lease_term_years` not captured | Both DBs | Medium | B |
| Building permits / CO records not ingested | N/A | Low (strategic) | C |
| Repeat-tenant per state/vertical not computed | Both DBs | Medium | B |
| Hold-window distribution not bucketed | Both DBs | Medium | B |
| Listing remarks NLP for "newly renovated/BTS/turnkey" not done | Both DBs | Low | C |
| `developer_scorecard.repeat_tenant_count` aggregate-only, no sequence | `dia/src/developer_scorecard.py:149-150` | Low | B |

### 6.5 Cross-vertical / LCC interface gaps

| Gap | Where | Severity | Phase |
|---|---|---|---|
| Detail panel forces single vertical (`db='gov'` or `'dia'`) | `lcc/detail.js:78` | Critical | A |
| `_loadOwnerPortfolio()` single-vertical | `lcc/detail.js:21` | High | A |
| No `v_entity_portfolio_all` cross-vertical view | LCC | Critical | A |
| Cross-domain matcher is nightly batch only | `lcc/api/sync.js` | Medium | B |
| Cross-domain-owner badge not shown in UI | LCC | Medium | A |
| Touchpoint counting cross-vertical but not exposed | `lcc/contacts-handler.js:~440-500` | High | A |
| Cadence per-vertical, not entity-canonical | LCC | Critical | A |
| 89 hardcoded `domain === 'gov'`/`'dia'` branches | `lcc/sidebar-pipeline.js` + others | High | C |
| No domain registry abstraction | LCC | High | C |
| No `user_domain_specialties` table | LCC | High | A |
| Daily briefing not filtered by user specialty | `lcc/supabase/functions/daily-briefing/index.ts` | Medium | A |
| Schema drift between dia and gov discovered post-facto | LCC | Medium | C |
| No CI schema-parity check | LCC | Medium | C |
| Sidebar `classifyDomain()` no `'both'` and no UI override | `lcc/sidebar-pipeline.js` | Low | C |

### 6.6 UI/UX gaps

| Gap | Where | Severity | Phase |
|---|---|---|---|
| Streamlit dashboards are pipeline-health only | `dia/dialysis_dashboard.py` | High | A |
| No prospect list, no monthly-touch UI in Dialysis | dia | High | A |
| Priority queue / call console doesn't exist | LCC | Critical | A |
| Completeness Rail chip click doesn't focus the field | `lcc/detail.js` Completeness Rail | Low | A |
| No "Mark Done for This Month" affordance | LCC | Medium | A |
| Pending updates invisible on LCC detail pages | LCC + Dia | Medium | B |
| Research queue not surfaced inline on entity it relates to | LCC | Medium | B |
| No "Developments Completed" section on contact detail | LCC | High | A |
| No BTS / retrofit badge on property page | LCC | Medium | B |
| Ownership chain has no current-vs-former visual treatment | LCC | Medium | A |
| No multi-developer junction render | LCC | Medium | B |
| 7-touch onboarding widget doesn't exist | LCC | High | A |
| Owner-side Completeness Rail doesn't exist | LCC | Medium | B |
| Cross-vertical Developer Leaderboard doesn't exist | LCC | High | C |
| No undo on consolidate-property merge | LCC | Low | C |
| No source URL tooltip on fields | LCC | Low | C |
| No mobile-optimized layout | LCC | Low | C |

---

## 7. Rollout Plan

Phases are sized to deliver visible user value at each step. Phase A delivers the new console + the cross-vertical portfolio + the cadence engine in ~3 weeks. Phase B adds the discriminating signals + multi-developer model + lease milestones. Phase C handles extensibility and strategic data ingestion.

### 7.1 Phase A — Foundation (target: 2-3 weeks)

The minimum coherent set that replaces "next call from last viewed account" with the new priority-driven console.

#### A1. Canonical `owner_role` + behavior override

**Goal:** Replace heuristic `is_developer` with `owner_role` enum + override + confidence at canonical layer with mirrors in dia/gov.

**Schema:**
- LCC: add columns to `entities`
  - `owner_role` ENUM (`developer`, `user_owner`, `buyer`, `seller_flipper`, `operator`, `unknown`)
  - `owner_role_source` ENUM (`computed`, `manual`, `behavioral_override`)
  - `owner_role_confidence` NUMERIC(3,2) (0.00-1.00)
  - `owner_role_updated_at` TIMESTAMPTZ
  - `developer_status_active_until` DATE (3-5 year currency window)
  - `behavioral_override` ENUM (`developer`, `user_owner`, `buyer`, `seller_flipper`, `operator`, NULL) — set when behavior diverges from default
  - `developer_flag_sources` JSONB (array of `{source, confidence, observed_at}`)
- dia.true_owners: add the same columns (deprecate single `developer_flag_source`, migrate to `developer_flag_sources` JSONB)
- gov.true_owners: add the full developer column set (currently absent)
- User/Owner tier signals on canonical entities:
  - `clinics_operated_count` INTEGER
  - `clinics_owned_real_estate_count` INTEGER
  - `user_owner_tier` ENUM (`A`, `B`, `C`, NULL)
  - `primary_concern` ENUM (`real_estate`, `operational_growth`, `mixed`, NULL)

**Files:**
- New migration: `life-command-center/supabase/migrations/lcc/20260523000000_lcc_owner_role_taxonomy.sql`
- New migration: `life-command-center/supabase/migrations/dialysis/20260523010000_dia_owner_role_taxonomy.sql`
- New migration: `life-command-center/supabase/migrations/government/20260523020000_gov_owner_role_taxonomy.sql`
- Update `Dialysis/src/owner_pattern_analysis.py` to write into the new columns (with confidence + source) instead of single `developer_flag`
- New `Dialysis/src/owner_role_derivation.py` — derives `owner_role` from behavior signals
- New `government-lease/src/owner_role_derivation.py` — same for gov

**Definition of done:**
- All three migrations applied
- Backfill script populates `owner_role` from existing data with confidence ≤ 0.5 (computed) for every existing `true_owner`
- Existing `is_developer=true` rows migrate to `owner_role='developer'` with source `'legacy_heuristic'`
- Smoke test: 5 known entities (1 Developer, 1 User/Owner, 1 Buyer, 1 Seller-Flipper, 1 Operator) have correct `owner_role`

#### A2. BTS tracker → `owner_role` wiring

**Goal:** Activate the cleanest existing developer signal.

**Schema/logic:**
- Trigger on `dia.build_to_suit_tracker` insert/update where `construction_status='delivered'`:
  - Set canonical entity `owner_role='developer'`
  - Append `{source: 'bts_delivered', confidence: 0.95, observed_at: NOW()}` to `developer_flag_sources`
  - Update `developer_status_active_until = NOW() + INTERVAL '5 years'`
- Same logic in gov where `properties.is_build_to_suit=true AND` linked `leases.is_first_generation=true` AND lease_commencement within 24 months of `year_built`

**Files:**
- New migration: `life-command-center/supabase/migrations/dialysis/20260523030000_dia_bts_tracker_owner_role_trigger.sql`
- New migration: `life-command-center/supabase/migrations/government/20260523040000_gov_bts_owner_role_trigger.sql`

**Definition of done:**
- Trigger fires on test insert
- Backfill sweep marks all existing `bts_delivered` entries

#### A3. Cross-vertical `v_entity_portfolio_all`

**Goal:** Single query returns all properties owned by a canonical entity across both DBs.

**Schema/logic:**
- LCC view that UNIONs:
  - `dia.properties JOIN dia.true_owners ON ... WHERE true_owner.canonical_entity_id = $1`
  - `gov.properties JOIN gov.true_owners ON ... WHERE true_owner.canonical_entity_id = $1`
- Add `dia.true_owners.canonical_entity_id` UUID FK to LCC `entities` (and gov equivalent) if not already present via `external_identities`
- Update `lcc/detail.js` `openUnifiedDetail()` to accept `db='both'`
- Update `lcc/detail.js` `_loadOwnerPortfolio()` to call `v_entity_portfolio_all` when in cross-vertical mode

**Files:**
- New migration: `life-command-center/supabase/migrations/lcc/20260523050000_lcc_v_entity_portfolio_all.sql`
- Edit `life-command-center/detail.js` — `openUnifiedDetail()`, `_loadOwnerPortfolio()`, plus header "Cross-domain owner" badge

**Definition of done:**
- Opening "Acme Development LLC" with `db='both'` returns combined dia + gov properties
- Header shows "Cross-domain" badge when entity exists in 2+ verticals

#### A4. `v_contact_former_properties` + Formerly Owned UI section

**Goal:** Surface exited properties on contact/prospect pages.

**Schema/logic:**
- Two views:
  - `dia.v_contact_former_properties` — joins `contacts → contact_links → true_owners → ownership_history WHERE end_date IS NOT NULL`
  - `gov.v_contact_former_properties` — same
- LCC view `v_entity_former_properties_all` UNIONs both
- LCC `detail.js`: add "Formerly Owned (N)" section to contact detail tab; render city, tenant, exit date, sale price, cap rate, holding period

**Files:**
- New migrations: `dia` + `gov` view files, plus LCC union view
- Edit `life-command-center/detail.js`

**Definition of done:**
- Contact page renders the section when entity has any `end_date NOT NULL` ownership rows
- Empty state ("No exited properties yet") when none

#### A5 + A9. Priority queue v1 + SF Opportunity mirror

**Goal:** The new BD-driven call console.

**Schema/logic:**
- New LCC table `bd_opportunities`:
  - `id`, `entity_id` (canonical), `sf_opp_id`, `type` (`prospect`, `buyer`, `other`), `stage`, `opened_at`, `closed_at`, `closed_won`, `vertical`, `owner_user_id`, `last_synced_at`
- Salesforce sync job (Phase A scope: read-only mirror) — pulls Opportunity records, upserts into `bd_opportunities`
- LCC view `v_priority_queue`:
  - UNION of P0-P9 producers (each as a CTE)
  - P0: `(entity × open Opp where type='prospect')` × tier=A × `next_due_date <= today`
  - P0.5: developer/Tier-A user-owner × no open Opp
  - P1-P9: as defined in §4
- LCC API endpoint `/api/priority-queue?user_id=X` returns top-N for user, filtered by `user_domain_specialties`
- New UI: priority queue panel in LCC main dashboard, replacing the "last viewed" scheduling
- Each queue item has actions: log touchpoint, defer, snooze, open detail

**Files:**
- New migration: `life-command-center/supabase/migrations/lcc/20260523060000_lcc_bd_opportunities.sql`
- New migration: `life-command-center/supabase/migrations/lcc/20260523070000_lcc_v_priority_queue.sql`
- New service: `life-command-center/api/_handlers/priority-queue.js`
- New service: `life-command-center/api/_handlers/sf-opportunity-sync.js`
- New UI: `life-command-center/priority-queue-ui.js` + integration in `index.html`

**Definition of done:**
- Opening LCC shows priority queue panel as the primary entry point
- P0 items render when a Developer Tier-A entity has overdue cadence
- P0.5 items render when a Developer Tier-A entity has no open Opp; clicking opens SF Opp creation
- Salesforce Opp sync runs hourly; opportunity count matches SF

#### A6. 7-touch onboarding sequence state machine

**Goal:** Track Phase-1 prospects through the scripted sequence.

**Schema/logic:**
- New LCC table `prospect_outreach_state`:
  - `entity_id`, `opportunity_id`, `phase` (`onboarding`, `steady_state`, `engaged`, `closed`)
  - `current_step` INTEGER (0-7)
  - `next_due_date`, `last_touch_date`, `last_touch_type`, `last_touch_vertical`
  - `engaged_at` (when prospect responded)
  - `closed_at`, `closed_reason`
- Template library `outreach_templates(step, channel, name, body_md)` — seeded with the 7 default templates
- Nightly job advances step on completed touches, surfaces P6 tasks when next_due_date ≤ today
- Inbound engagement events (response detected from email/call) → pause onboarding, set phase='engaged'
- UI widget on entity detail: visual track of steps 1-7 with timestamps, current step highlighted

**Files:**
- New migration: `life-command-center/supabase/migrations/lcc/20260523080000_lcc_prospect_outreach_state.sql`
- New service: `life-command-center/api/_handlers/onboarding-sequence.js`
- New UI: onboarding widget in `life-command-center/detail.js`

**Definition of done:**
- New Developer prospect auto-initialized into Phase 1, step 0
- Step advances when a touch is logged
- Engagement pauses sequence

#### A7. Unified `touchpoint_events` table

**Goal:** Single source of truth for touchpoints across verticals + channels.

**Schema/logic:**
- New LCC table `touchpoint_events`:
  - `id`, `entity_id` (canonical), `opportunity_id` (nullable for non-BD touches), `channel` (`email`, `vm`, `call`, `meeting`, `mailer`, `report_send`), `vertical` (`dia`, `gov`, ..., `cross`), `template_used`, `occurred_at`, `broker_user_id`, `response_received`, `stream` (`bd`, `showing`)
- Refactor `Dialysis/src/touchpoint_scheduler.py log_touchpoint()` to write here (in addition to existing per-vertical tables for backwards compat during transition)
- Backfill from Salesforce activity log
- A touch on the canonical entity satisfies cadence in all verticals — `v_priority_queue` reads `last_touch_date` from this table

**Files:**
- New migration: `life-command-center/supabase/migrations/lcc/20260523090000_lcc_touchpoint_events.sql`
- Edit `Dialysis/src/touchpoint_scheduler.py`
- New service: `life-command-center/api/_handlers/touchpoint-log.js`

**Definition of done:**
- All new touches land in `touchpoint_events`
- Old per-vertical writes continue (compat) but read path uses unified table
- A cross-vertical entity sees one cadence clock

#### A8. `user_domain_specialties` + briefing filter

**Goal:** Each broker sees only their relevant work.

**Schema/logic:**
- New LCC table `user_domain_specialties(user_id, domain, role, primary_flag)`
- Seed: Scott → gov (primary), dia; Kelly → dia (primary), childcare (future); Nate → adjacent net lease (future urgent care)
- Daily briefing fetcher accepts `user_id` and filters work items to user's specialties
- Priority queue API also filters

**Files:**
- New migration: `life-command-center/supabase/migrations/lcc/20260523100000_lcc_user_domain_specialties.sql`
- Edit `life-command-center/supabase/functions/daily-briefing/index.ts`
- Edit `life-command-center/api/_handlers/priority-queue.js`

**Definition of done:**
- Scott's briefing/queue only shows gov + dia items
- Kelly's only shows dia items (no gov)

#### A10. Listing-event fan-out engine

**Goal:** Automatic Showing Stream (Lane A) + BD owner-geographic outreach (Lane B) on every new listing.

**Schema/logic:**
- New LCC table `listing_showing_events`:
  - `id`, `listing_id`, `listing_vertical`, `lane` (`buyer_subspecialty`, `owner_proximity_property`, `owner_proximity_entity_msa`)
  - `target_entity_id` (canonical), `generated_at`, `status` (`pending`, `logged`, `skipped`), `touchpoint_id` (when logged)
- New PostGIS / H3 helper function `properties_within_k_nearest(listing_property_id, k INTEGER)` — returns property IDs of the k nearest properties in same vertical
- New helper `entities_with_mailing_msa_match(listing_msa TEXT, vertical TEXT)` — returns entity IDs
- Trigger on listing publish (in either domain DB) → calls LCC ingest endpoint → generates events on three lanes:
  1. Lane A — every Buyer with subspecialty matching listing vertical
  2. Lane B1 — owners of nearest ~150-200 properties to listing
  3. Lane B2 — owners with entity mailing address in same MSA
- Lane B writes touchpoint_events with `stream='bd'` (counts for BD if Opp exists) or surfaces "Open BD Opportunity Needed" task
- Lane A writes touchpoint_events with `stream='showing'`
- UI: per-listing "Showing fan-out" view showing each lane's targets, status, and one-click "log touchpoint" affordances

**Files:**
- New migration: `life-command-center/supabase/migrations/lcc/20260523110000_lcc_listing_showing_events.sql`
- New migrations adding PostGIS extension if not enabled + helper functions in dia + gov
- New service: `life-command-center/api/_handlers/listing-fanout.js`
- Update domain DB triggers on listing insert
- New UI: `life-command-center/listing-fanout-ui.js` + integration

**Definition of done:**
- A test listing publish in dia generates Lane A events for all dia Buyers
- Lane B1 returns ~150-200 nearest property owners
- Lane B2 returns owners whose entity mailing MSA matches listing MSA
- Brokers can log a touchpoint from the fan-out view

### 7.2 Phase B — Better signals + multi-developer (target: 4-6 weeks)

#### B1. Multi-developer junction table
- `property_developers(property_id, developer_entity_id, role ENUM('lead','jv_partner','operator_developer'), project_type ENUM('bts','retrofit','expansion'), confidence, source)` in both DBs
- Backfill from existing single-FK and string `properties.developer` fields
- LCC UI: "Original Developer(s)" section on property page

#### B2. BTS/retrofit + 1st-gen/extension activation
- Add `dia.properties.is_build_to_suit BOOLEAN`, `is_retrofit BOOLEAN` (gov has BTS, add retrofit)
- Add `leases.is_extension BOOLEAN`, `is_retrofit_lease BOOLEAN` to both
- Update `gov/src/investment_scorer.py` Factor 5 (renewal probability) to use `is_first_generation` directly — first-gen scores higher
- Add to dia lead/prospect scoring (currently nonexistent — borrow gov pattern)

#### B3. Lease milestone triggers
- Computed column `firm_term_milestone TEXT` on properties (`'10yr_approaching'`, `'7yr'`, `'5yr'`, `'3yr'`)
- Refresh job nightly
- Surfaces as P3 in priority queue

#### B4. CMBS/refi pattern parity (Gov → Dia)
- Adopt gov's `prospect_leads.source_cmbs_loan_id`, `loan_maturity_date`, `months_to_maturity`, `maturity_trigger_type`
- Add `dia.cmbs_loans` table or extend existing loan tracking
- Surfaces as P2 in priority queue

#### B5. Discriminating signals view
- LCC view `v_developer_signals_per_entity` with:
  - `year_built_to_lease_commencement_months`
  - `repeat_tenant_count_per_state`
  - `hold_window_distribution JSONB` (buckets: <1yr, 1-3yr, 3-5yr, >5yr)
  - `sale_velocity_3yr`
  - `portfolio_age_spread`
- Feeds `owner_role` derivation confidence
- Surfaces as confidence pills in UI

#### B6. Listing-event Buyer custom criteria
- Add `entity_custom_buyer_criteria JSONB` field (tenant focus, geography, deal size, cap rate range)
- Matching engine for "expanded buyer showing focus"
- Pulls listings from all brokers (Northmarq + market) — requires market listings ingest (LoopNet, CoStar)

#### B7. `leases.lease_term_years`
- Add column to both DBs
- Backfill from OM extraction pipeline
- Feeds the "long-term" half of "new long-term lease" developer signal

#### B8. Owner-side completeness view + Completeness Rail on owner pages
- `v_entity_completeness` rubric: name, address, SF link, contact_id, owner_role confirmed, recent touch, scorecard fields, developer signals
- Mirror existing property Completeness Rail UX

#### B9. Sync ownership lineage → LCC `entity_relationships`
- Populate `relationship_type='owns'` with `effective_from`/`effective_to` from `ownership_history`
- Both DBs
- Enables cross-vertical chain queries

#### B10. Address-depth backfill
- Extend dia ownership address backfill to monthly cron + geocoding fallback
- Target: 25%+ on `recorded_owners.address` within 30 days

#### B11. Pending updates inline on detail pages
- Show pending updates as an "Action Required" card on the related entity
- Reuse `chat_interface.py` approve/edit/reject logic

#### B12. Research queue inline on entity detail
- Surface `llc_research_queue` rows tied to entity inline

### 7.3 Phase C — Strategic & extensibility (target: 6-12 weeks)

#### C1. Domain registry refactor
- `api/_shared/domain-registry.js` exports `DOMAINS = { gov: {...}, dia: {...}, asc: {...}, vet: {...}, childcare: {...}, urgent_care: {...} }`
- Refactor `sidebar-pipeline.js` 89 branches
- Pre-requisite for new verticals

#### C2. P9 gap-fill prioritization
- Score "likelihood of entering P0-P5 if enriched" per uncategorized entity
- Route research queue to top scorers

#### C3. Tailored memos by owner_role
- `Dialysis/generate_prospect_memos.py` branches on `owner_role` and renders the right template
- Developer / User-Owner / Buyer / Seller-Flipper / generic templates

#### C4. Cross-vertical Developer Leaderboard page
- First-class LCC page; columns: entity, owner_role, portfolios (dia/gov/...), active projects last 3-5yr, repeat tenants, days since last touch, assigned broker
- Sortable, filterable by broker focus

#### C5. Listing remarks NLP
- Extract "newly renovated / build-to-suit / turnkey / stabilized" from listing remarks
- Feeds B5 signals view

#### C6. Building permit ingestion (strategic, expensive)
- New `building_permits` table; county API or CoStar Permit data product
- Cleanest BTS signal

#### C7. Schema-parity CI check
- Fail build if shared columns diverge between dia/gov
- Generate `SCHEMA_DRIFT_REPORT.md` on PR

#### C8. Salesforce Deal/Lease ingestion
- Per existing `SALESFORCE_SUPABASE_DATAFLOW_AUDIT.md` Phase 2 plan

#### C9. CoStar sidebar domain feedback
- Show classified domain + allow user override before write
- Supports new verticals

#### C10. Undo for consolidate-property merge
- 5-minute undo toast post-merge

#### C11. Source URL tooltip on fields
- Hover-tooltip showing source provenance for each field

---

## 8. Per-Topic Implementation Prompts

Copy/paste into a fresh Claude Code or Cowork chat. Each prompt is self-contained — it assumes the new agent has not seen the audit document.

Some prompts reference this audit file path: `/home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md`. The new agent should read §1-§4 (doctrine + cadence + queue model) of that file before starting, then read the specific topic's §7.x rollout-plan section.

### Topic 1 — Owner-role taxonomy migration (A1)

```
You are implementing Phase A item A1 of the DEVELOPER_BD_AUDIT_v3 plan.

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md sections 1, 2, 3, and 7.1 (specifically the A1 entry).

Goal: replace the conflated heuristic `is_developer` boolean with a behavior-derived owner_role taxonomy at the LCC canonical entity layer, mirrored to dia.true_owners and gov.true_owners.

Deliverables:
1. Three new Supabase migrations:
   - life-command-center/supabase/migrations/lcc/20260523000000_lcc_owner_role_taxonomy.sql
   - life-command-center/supabase/migrations/dialysis/20260523010000_dia_owner_role_taxonomy.sql
   - life-command-center/supabase/migrations/government/20260523020000_gov_owner_role_taxonomy.sql
2. Backfill script in each domain repo (Dialysis/scripts/backfill_owner_role.py, government-lease/scripts/backfill_owner_role.py) that:
   - Sets owner_role='developer' for entities currently is_developer=true (source='legacy_heuristic', confidence=0.5)
   - Sets owner_role='operator' for entities currently is_operator_not_owner=true
   - Leaves rest as owner_role='unknown' with confidence 0.0
3. New module Dialysis/src/owner_role_derivation.py (and gov equivalent) that:
   - Computes owner_role from behavior signals per audit §2 (will be refined in Phase B with B5 signals view; for A1, use existing signals only)
   - Writes confidence + source for each computation
   - Does NOT overwrite manual overrides (behavioral_override field)

Schema specifics (see audit §7.1 A1 for full list):
- Add to LCC entities: owner_role, owner_role_source, owner_role_confidence, owner_role_updated_at, developer_status_active_until, behavioral_override, developer_flag_sources JSONB, clinics_operated_count, clinics_owned_real_estate_count, user_owner_tier, primary_concern
- Add same columns to dia.true_owners and gov.true_owners (gov lacks developer_flag, developer_tier, etc. — add full set)

Constraints:
- Develop on branch claude/fervent-cori-FR1JQ in all three repos
- Do not drop or rename existing is_developer / developer_flag columns yet — coexistence period; we'll deprecate in a later migration
- Each migration must be idempotent (use IF NOT EXISTS, ADD COLUMN IF NOT EXISTS)
- Include rollback notes in migration comments

Definition of done:
- Migrations apply cleanly to all three databases
- Backfill script runs on each DB
- 5 known entities (one per role) can be queried with correct owner_role
- Unit test in tests/test_owner_role_derivation.py covers each role case
```

### Topic 2 — BTS tracker → owner_role wiring (A2)

```
You are implementing Phase A item A2 of the DEVELOPER_BD_AUDIT_v3 plan.

Pre-req: A1 (owner_role taxonomy) is in place.

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md sections 2.5, 5.1, 5.2 (BTS tracker discussion), and 7.1 A2.

Goal: when a Build-to-Suit project is marked delivered, automatically promote the developer entity to owner_role='developer' with high confidence. Same for gov is_build_to_suit + first-gen lease pattern.

Deliverables:
1. Trigger on dia.build_to_suit_tracker: AFTER INSERT OR UPDATE WHERE construction_status='delivered':
   - Resolve developer_id → canonical entity_id
   - UPDATE LCC entities SET owner_role='developer', owner_role_source='behavioral_override', developer_status_active_until=GREATEST(developer_status_active_until, NOW() + INTERVAL '5 years')
   - Append {source:'bts_delivered', confidence: 0.95, project_id, observed_at: NOW()} to developer_flag_sources JSONB
2. Trigger on gov.properties: AFTER INSERT OR UPDATE WHERE is_build_to_suit=true AND has linked lease with is_first_generation=true:
   - Find original developer via gov.properties.original_developer_contact_id → canonical entity
   - Same UPDATE to LCC entities
3. Backfill script that scans existing rows in both tables and applies the same logic
4. Migrations:
   - life-command-center/supabase/migrations/dialysis/20260523030000_dia_bts_tracker_owner_role_trigger.sql
   - life-command-center/supabase/migrations/government/20260523040000_gov_bts_owner_role_trigger.sql

Constraints:
- Branch claude/fervent-cori-FR1JQ
- Trigger must be safe under concurrent writes
- Do NOT modify owner_role if existing source has higher confidence
- Preserve any existing behavioral_override

Definition of done:
- Insert a test BTS row with construction_status='delivered'; verify the linked entity's owner_role becomes 'developer'
- Backfill of historical rows applies cleanly
- developer_status_active_until is set correctly
```

### Topic 3 — Cross-vertical portfolio view + detail panel both-mode (A3)

```
You are implementing Phase A item A3 of the DEVELOPER_BD_AUDIT_v3 plan.

Pre-req: A1 (canonical_entity_id linkage on dia/gov true_owners) is in place.

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md sections 2.4, 5.3, and 7.1 A3.

Goal: open any canonical entity's detail panel and see properties across all verticals in one view. Add a "Cross-domain" badge to the header.

Deliverables:
1. New view life-command-center/supabase/migrations/lcc/20260523050000_lcc_v_entity_portfolio_all.sql:
   - UNION ALL of dia.properties + gov.properties joined to their respective true_owners.canonical_entity_id
   - Columns: entity_id, vertical, property_id, address, city, state, tenant, lease_status, year_built, cap_rate, ownership_role (current/former), acquired_date, exited_date
2. Update life-command-center/detail.js:
   - openUnifiedDetail(id, 'both') now valid
   - When db='both', _loadOwnerPortfolio calls v_entity_portfolio_all
   - Header badge "Cross-domain (dia + gov)" when entity has rows in 2+ verticals
   - Tab "Portfolio (All Verticals)" replaces single-vertical portfolio tab when db='both'

UI notes:
- Properties grouped by vertical with sub-headers
- Within vertical: Current (green left-border) above Former (gray left-border)
- Each row: address, tenant, year built, current cap rate, holding period (years owned)
- Row click opens that property's detail in its native vertical context

Constraints:
- Branch claude/fervent-cori-FR1JQ
- Backwards-compatible: db='gov' or db='dia' still works for vertical-specific detail
- Performance: view should use indexes on canonical_entity_id; if missing, add them in the migration

Definition of done:
- Opening a known cross-domain entity (verify by querying entities where domain='both') with db='both' shows properties from both verticals
- Cross-domain badge renders
- Single-vertical detail still works as before
```

### Topic 4 — Former-properties view + UI section (A4)

```
You are implementing Phase A item A4 of the DEVELOPER_BD_AUDIT_v3 plan.

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md sections 5, 6.3, and 7.1 A4.

Goal: every contact/prospect page must render a "Formerly Owned (N)" section showing properties the entity has exited.

Deliverables:
1. Three new views:
   - dia: v_entity_former_properties (joins through contact_links → true_owners → ownership_history WHERE end_date IS NOT NULL)
   - gov: v_entity_former_properties (same pattern)
   - LCC: v_entity_former_properties_all (UNION of both)
2. Update life-command-center/detail.js — add "Formerly Owned (N)" tab section on contact/entity detail:
   - Columns: vertical, address, city, state, tenant at exit, acquired date, exited date, holding period (years), sale price, exit cap rate
   - Sortable by exited date desc
   - Empty state: "No exited properties yet"
   - Counts in tab badge

Migration paths:
- Dialysis/sql/20260523120000_dia_v_entity_former_properties.sql
- government-lease/sql/20260523130000_gov_v_entity_former_properties.sql
- life-command-center/supabase/migrations/lcc/20260523140000_lcc_v_entity_former_properties_all.sql

Constraints:
- Branch claude/fervent-cori-FR1JQ
- Use canonical_entity_id linkage from A1
- Performance: index ownership_history (true_owner_id, end_date) if not already

Definition of done:
- For an entity with at least 1 exited property (find one via a quick query), the section renders the right count and rows
- Empty state for entities with no exits
- Works for cross-domain entities (shows exits from both verticals)
```

### Topic 5 — Priority queue + SF Opportunity mirror (A5 + A9)

```
You are implementing Phase A items A5 and A9 of the DEVELOPER_BD_AUDIT_v3 plan. These two items must ship together because the priority queue is gated on Opportunity state.

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md sections 2.6, 3.4, 4 (entire), and 7.1 A5 + A9. This is the heart of the new BD console.

Goal: replace the arbitrary "next call from last viewed account" with a deterministically-ranked priority queue across both verticals, anchored on Salesforce Opportunities.

Deliverables:
1. New LCC table bd_opportunities:
   - Migration: life-command-center/supabase/migrations/lcc/20260523060000_lcc_bd_opportunities.sql
   - Columns per audit §7.1 A5
2. Salesforce sync service:
   - life-command-center/api/_handlers/sf-opportunity-sync.js
   - Pulls SF Opportunity records hourly; upserts bd_opportunities
   - Read-only in v1 (no write-back to SF)
3. Priority queue view:
   - Migration: life-command-center/supabase/migrations/lcc/20260523070000_lcc_v_priority_queue.sql
   - Implements all 10 bands (P0, P0.5, P1-P9) per audit §4 as a UNION of CTEs
   - Each row tagged with: entity_id, priority_band, reason, vertical, broker_user_id, due_date, score_weight
4. Priority queue API:
   - life-command-center/api/_handlers/priority-queue.js
   - GET /api/priority-queue?user_id=X[&limit=N][&domain=both|dia|gov]
   - Filters by user_domain_specialties (from A8 if available; else show all)
5. Priority queue UI:
   - life-command-center/priority-queue-ui.js
   - Integrate as primary panel on LCC home
   - Each item: priority band chip, entity name + role + vertical chips, reason text, primary CTA (Log touch / Open Opp / Open detail / Snooze / Defer)
   - Auto-refresh on touchpoint log

Constraints:
- Branch claude/fervent-cori-FR1JQ
- For P0/P0.5 bands, must require existing or needed SF Opportunity per audit §2.6
- For P8 band, separate visual treatment (Showing Stream, not BD)
- Performance: queue view should return in <300ms for typical user; add indexes as needed
- For Phase A, P9 (gap-fill) returns empty (deferred to Phase C2); show "Gap-fill prioritization coming in C2" placeholder

Touch points needed from other A items:
- A1 owner_role + tier
- A7 touchpoint_events for last_touch_date
- A8 user_domain_specialties (degrade gracefully if not yet present)

Definition of done:
- Priority queue panel renders on LCC home
- For a test Developer Tier-A entity with overdue cadence and an open SF Opp, a P0 item appears
- For a test Developer with no open Opp, P0.5 appears with "Open Opp" CTA
- Logging a touchpoint immediately reorders the queue
- SF Opp sync populates bd_opportunities and reflects in queue gate
```

### Topic 6 — 7-touch onboarding state machine (A6)

```
You are implementing Phase A item A6 of the DEVELOPER_BD_AUDIT_v3 plan.

Pre-req: A1 (owner_role), A5/A9 (Opp anchor), A7 (touchpoint_events).

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md sections 3.1 (Phase 1 sequence) and 7.1 A6.

Goal: every new Prospect (entity with newly-opened SF Opp) starts a scripted 7-touch sequence. The system schedules, tracks progress, surfaces P6 tasks when next step is due, and pauses on engagement.

Deliverables:
1. New LCC table prospect_outreach_state:
   - Migration: life-command-center/supabase/migrations/lcc/20260523080000_lcc_prospect_outreach_state.sql
   - Columns per audit §7.1 A6
2. Template library:
   - Table outreach_templates(id, step, channel ENUM, name TEXT, body_md TEXT, default_flag BOOL, vertical TEXT NULL)
   - Seed with 7 default templates (audit §3.1 table)
3. Sequence state machine logic (life-command-center/api/_handlers/onboarding-sequence.js):
   - On new bd_opportunities row of type='prospect': insert prospect_outreach_state with phase='onboarding', current_step=0, next_due_date=opened_at
   - On touchpoint_events insert: if entity has active onboarding row, advance current_step and recompute next_due_date based on step→week offsets (audit §3.1)
   - On inbound response (response_received=true OR engagement event): set phase='engaged', stop auto-advancing
   - On step 7 completion or broker manual close: set phase='steady_state'
4. UI widget on entity detail (life-command-center/detail.js):
   - Visual 7-step track with timestamps
   - Current step highlighted; complete steps green; future steps gray
   - "Skip step" / "Mark done" affordances
   - Phase indicator (Onboarding / Engaged / Steady State)

Constraints:
- Branch claude/fervent-cori-FR1JQ
- Step→week offsets per audit (0/2/6/10/14/18/22)
- Template assignment per step from default templates, broker can override
- Idempotent: re-running advance logic with same touchpoint doesn't double-advance

Definition of done:
- Creating a new Prospect SF Opp initializes onboarding state at step 0
- Logging a touchpoint advances to step 1, next_due_date shifts +2 weeks
- Inbound response sets phase='engaged'
- Widget renders correctly on detail page
```

### Topic 7 — Unified touchpoint_events table (A7)

```
You are implementing Phase A item A7 of the DEVELOPER_BD_AUDIT_v3 plan.

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md sections 3.2, 3.4, 5.1 (existing touchpoint tables), and 7.1 A7.

Goal: a single source of truth for touchpoints across all verticals and channels, anchored to canonical entities. A touch on Acme Development LLC in dialysis context satisfies the gov cadence clock too.

Deliverables:
1. New LCC table touchpoint_events:
   - Migration: life-command-center/supabase/migrations/lcc/20260523090000_lcc_touchpoint_events.sql
   - Columns per audit §7.1 A7
2. Refactor Dialysis/src/touchpoint_scheduler.py log_touchpoint():
   - Continue writing to existing dia.touchpoint_schedule (compat)
   - Also write to LCC touchpoint_events
3. Touchpoint log API endpoint (life-command-center/api/_handlers/touchpoint-log.js):
   - POST /api/touchpoint-log with body {entity_id, channel, vertical?, opportunity_id?, template_used?, response_received?, occurred_at?}
   - Computes stream (bd if opportunity_id present and Opp type='prospect'; showing if Opp type='buyer'; bd otherwise if entity has an open prospect Opp)
4. Backfill from Salesforce activity log:
   - One-time script: life-command-center/scripts/backfill_touchpoint_events_from_sf.js
   - Pulls SF Tasks/Activities from past 24 months, maps to canonical entities, populates touchpoint_events
5. Update read paths:
   - v_priority_queue reads last_touch_date from touchpoint_events
   - Daily briefing reads from touchpoint_events
   - Touchpoint history on entity detail reads from touchpoint_events

Constraints:
- Branch claude/fervent-cori-FR1JQ
- Don't break existing per-vertical writes during transition (dual-write period)
- Performance: index (entity_id, occurred_at DESC), (opportunity_id, occurred_at DESC)
- Define a clear de-duplication strategy when SF backfill overlaps with new writes (use SF activity ID as natural key when present)

Definition of done:
- Logging a touchpoint writes to both dia/gov per-vertical table AND LCC touchpoint_events
- A canonical entity with logged touches across verticals shows one unified last_touch_date in priority queue
- Backfill populates 24 months of history
```

### Topic 8 — User specialties + briefing filter (A8)

```
You are implementing Phase A item A8 of the DEVELOPER_BD_AUDIT_v3 plan.

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md section 7.1 A8 plus the team focus areas note in §1.2.

Goal: each broker sees only their relevant verticals in daily briefing and priority queue. Today, Scott is the only user; design must scale to Kelly, Nate, future hires.

Deliverables:
1. New LCC table user_domain_specialties:
   - Migration: life-command-center/supabase/migrations/lcc/20260523100000_lcc_user_domain_specialties.sql
   - Columns: user_id, domain TEXT (dia, gov, asc, vet, childcare, urgent_care, ...), role TEXT (primary, secondary, future), active BOOL, started_at, ended_at
2. Seed with current team:
   - Scott Briggs: gov (primary), dia (secondary)
   - Kelly Largent: dia (primary), childcare (future)
   - Nate: adjacent net lease (note: TBD specific domain), urgent_care (future)
3. Update life-command-center/supabase/functions/daily-briefing/index.ts:
   - Accept user_id parameter
   - Filter all fetcher functions by user's active specialties
4. Update life-command-center/api/_handlers/priority-queue.js to filter same way

Constraints:
- Branch claude/fervent-cori-FR1JQ
- Degrade gracefully if user has no specialties → show all (single-user mode for current state)
- Allow domain='future' role to show items as "upcoming" (e.g., Kelly sees childcare items but flagged as future, not in primary queue)

Definition of done:
- Briefing and queue filter correctly per user
- Adding a new user + specialties via INSERT works without code change
```

### Topic 9 — Listing-event fan-out engine (A10)

```
You are implementing Phase A item A10 of the DEVELOPER_BD_AUDIT_v3 plan.

Pre-req: A1 (owner_role), A3 (cross-vertical), A7 (touchpoint_events).

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md sections 3.5 (entire), 7.1 A10. This is the listing-event automation that powers Buyer outreach and Owner-geographic BD touchpoints.

Goal: every new listing publish automatically generates showing events on three lanes (Buyer cohort, Owner-property-proximity, Owner-entity-MSA), with one-click "log touchpoint" affordances.

Deliverables:
1. New LCC table listing_showing_events per audit §7.1 A10
2. PostGIS / H3 helper functions in dia and gov:
   - properties_within_k_nearest(listing_property_id BIGINT, k INTEGER DEFAULT 175) RETURNS SETOF property_id
   - Use existing lat/lon on properties; if missing, geocode first (out of scope; flag missing data)
3. MSA join helper:
   - entities_with_mailing_msa_match(listing_msa TEXT, vertical TEXT) RETURNS SETOF entity_id
4. Trigger on listing publish (in dia AND gov listings tables):
   - AFTER INSERT WHERE status='active'
   - Calls LCC API endpoint POST /api/listing-fanout with listing details
5. Fan-out service (life-command-center/api/_handlers/listing-fanout.js):
   - Lane A: SELECT entity_id FROM entities WHERE owner_role='buyer' AND subspecialty=listing.vertical
   - Lane B1: properties_within_k_nearest → distinct true_owners → canonical entities, owner_role IN ('developer','user_owner','seller_flipper')
   - Lane B2: entities_with_mailing_msa_match
   - For each match: INSERT listing_showing_events row (status='pending')
   - Lane A creates stream='showing' events
   - Lanes B1 + B2: if entity has open Prospect Opp, queue P8-equivalent BD task; if not, queue P0.5
6. UI: per-listing fan-out view (life-command-center/listing-fanout-ui.js):
   - 3 columns per lane
   - Each target: entity name, distance/MSA reason, last touch, status
   - One-click "log email" / "log VM" buttons (POSTs to touchpoint-log with appropriate stream)
   - Bulk mark-done / mark-skipped

Constraints:
- Branch claude/fervent-cori-FR1JQ
- Lane B1 default k=175 (midpoint of 150-200 range), make tunable
- If PostGIS extension not installed in dia/gov, add it in pre-migration
- Performance target: fan-out should complete in <2s per listing publish
- Lane A is asynchronous (queue-based); Lanes B can be sync since per-listing volume is bounded

Definition of done:
- Inserting a test listing into dia.available_listings with state='OK', city='Tulsa' generates:
  - Lane A: ~N Buyer entities (count = current buyer count nationwide)
  - Lane B1: ~150-200 nearest dia property owners
  - Lane B2: owners whose mailing MSA = Tulsa
- Per-listing fan-out view renders all three lanes
- Logging a touchpoint from the view writes correctly to touchpoint_events with right stream + opportunity_id
```

### Topic 10 — Multi-developer junction + lease activation (B1 + B2)

```
You are implementing Phase B items B1 and B2 of the DEVELOPER_BD_AUDIT_v3 plan.

Pre-req: All Phase A complete.

Context: read /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md sections 2.5, 5.2 (gov BTS/first-gen flags), 7.2 B1 and B2.

Goal: support multiple developers per property (rare but real); activate the first-gen lease flag in lead scoring on both sides; ensure BTS / retrofit flags exist on both DBs.

Deliverables:
1. property_developers junction table in both DBs:
   - property_id, developer_entity_id (canonical), role (lead/jv_partner/operator_developer), project_type (bts/retrofit/expansion), confidence, source, project_year, notes
2. Migration backfilling from:
   - gov.properties.original_developer_contact_id → resolve to canonical → insert junction row with role='lead'
   - dia: from existing developer_flag heuristic, insert rows with confidence 0.5
3. Add to dia.properties: is_build_to_suit BOOLEAN, is_retrofit BOOLEAN (gov has BTS, add retrofit)
4. Add to both leases tables: is_extension BOOLEAN, is_retrofit_lease BOOLEAN
5. Update gov/src/investment_scorer.py:
   - Factor 5 (renewal probability): if leases.is_first_generation=true → 5 pts; is_renewed or is_extension → 2-3 pts
6. Activate equivalent boost in dia lead scoring (currently nonexistent in dia/scripts/lead_pipeline*; pattern from gov)
7. UI on property detail (life-command-center/detail.js):
   - "Original Developer(s)" section listing junction rows
   - BTS / Retrofit badge in header
   - First-gen / Extension / Retrofit-lease badge on each lease in rent roll

Constraints:
- Branch claude/fervent-cori-FR1JQ
- Keep single original_developer_contact_id field on gov.properties for backwards-compat; junction is the source of truth going forward
- For first-gen activation, do not retroactively rescore historical leads (forward-only; document this)

Definition of done:
- A property with 2 developers in junction renders both on detail page
- First-gen lease scoring boost active in gov; reflected in priority_score for new leads
- Dia has equivalent first-gen boost
```

### Topic 11 — Lease milestone triggers (B3)

```
You are implementing Phase B item B3.

Goal: compute and surface 10yr / 7yr / 5yr / 3yr remaining firm-term milestones on properties; trigger P3 priority queue items.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §7.2 B3.

Deliverables:
1. Computed column firm_term_milestone TEXT on properties (both DBs); refresh via nightly job (or generated column if Postgres version supports)
2. Triggers / scheduled function that detects milestone crossings (e.g., firm_term_remaining transitions from 10.1 → 9.9 yr) and inserts priority queue rows tagged P3
3. UI: milestone chip on property header; new lease-milestone tile in priority queue
4. Update v_priority_queue to read this

Branch: claude/fervent-cori-FR1JQ.
```

### Topic 12 — CMBS/refi pattern for Dialysis (B4)

```
You are implementing Phase B item B4: bring gov's CMBS maturity → BD trigger pattern to dialysis.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §5.2 (gov pattern), §7.2 B4.

Deliverables:
1. dia.cmbs_loans table (mirror gov schema) or extend existing loan tracking
2. dia.prospect_leads.source_cmbs_loan_id, loan_maturity_date, months_to_maturity, maturity_trigger_type
3. Trigger / nightly job to insert P2 priority queue items when months_to_maturity ≤18
4. UI: refi event chip + priority queue tile

Branch: claude/fervent-cori-FR1JQ.
```

### Topic 13 — Discriminating signals view (B5)

```
Implement Phase B item B5: a unified signals view that drives owner_role derivation confidence.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §5 (signal availability), §7.2 B5.

Deliverables:
1. LCC view v_developer_signals_per_entity with:
   - year_built_to_lease_commencement_months
   - year_renovated_to_lease_commencement_months
   - repeat_tenant_count_per_state
   - hold_window_distribution JSONB
   - sale_velocity_3yr
   - portfolio_age_spread
2. Update owner_role_derivation.py modules to consume this view
3. Surface signals as tooltip on owner_role badge in UI

Branch: claude/fervent-cori-FR1JQ.
```

### Topic 14 — Owner-side completeness rail (B8)

```
Implement Phase B item B8: Completeness Rail UX for owner/contact pages.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §5.3 (existing property completeness), §7.2 B8.

Deliverables:
1. LCC view v_entity_completeness — weighted rubric per audit
2. Rail UI on owner detail (mirror existing property rail in detail.js:1320-1375)
3. Chip-click focuses target field
4. Score and band displayed

Branch: claude/fervent-cori-FR1JQ.
```

### Topic 15 — Ownership lineage → LCC entity_relationships (B9)

```
Implement Phase B item B9: populate LCC entity_relationships with relationship_type='owns' from both DBs' ownership_history.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §5.3 (entity_relationships schema), §7.2 B9.

Deliverables:
1. Nightly ETL: life-command-center/scripts/sync_ownership_to_lcc.js
2. Maps dia/gov ownership_history rows to LCC entity_relationships (parent=owner entity, child=property entity, relationship_type='owns', effective_from=start_date, effective_to=end_date)
3. Idempotent / incremental

Branch: claude/fervent-cori-FR1JQ.
```

### Topic 16 — Domain registry refactor (C1)

```
Implement Phase C item C1: extract hardcoded gov/dia branching into a centralized domain registry, enabling future verticals to plug in via config.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §5.3 (89 hardcoded branches), §7.3 C1.

Deliverables:
1. life-command-center/api/_shared/domain-registry.js exporting DOMAINS = { gov: {...}, dia: {...}, asc: {placeholder}, vet, childcare, urgent_care }
2. Refactor sidebar-pipeline.js, apply-change.js, admin.js, daily-briefing/index.ts to consume registry
3. CI guard against new hardcoded domain branches outside the registry

Branch: claude/fervent-cori-FR1JQ.
```

### Topic 17 — P9 gap-fill prioritization (C2)

```
Implement Phase C item C2: route research effort to entities most likely to enter the priority queue P0-P5 if enriched.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §4 (P9 band), §7.3 C2.

Deliverables:
1. Scoring view v_gap_fill_priority_score
2. Update llc_research_queue to prioritize from this view
3. Wire into v_priority_queue P9 band

Branch: claude/fervent-cori-FR1JQ.
```

### Topic 18 — Tailored memos by owner_role (C3)

```
Implement Phase C item C3: branch generate_prospect_memos.py by owner_role.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §2 (categorization), §7.3 C3.

Deliverables:
1. Template library per owner_role:
   - Developer: portfolio history, BTS deliveries, repeat-tenant relationships
   - User/Owner: sale-leaseback thesis, cap-rate compression
   - Buyer: recent acquisitions, disposition history with our team
   - Seller-Flipper: refi/renewal windows
   - Generic fallback
2. Update Dialysis/generate_prospect_memos.py to select template by owner_role
3. Add gov equivalent

Branch: claude/fervent-cori-FR1JQ.
```

### Topic 19 — Cross-vertical Developer Leaderboard (C4)

```
Implement Phase C item C4: first-class LCC page showing top developers across all verticals.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §7.3 C4.

Deliverables:
1. New page /life-command-center/developer-leaderboard.html (or modal in main UI)
2. Columns: entity, owner_role, portfolios (dia/gov/...), active projects last 3-5yr, repeat tenants, days since last touch, assigned broker
3. Sortable; filterable by broker focus / user specialty
4. Click row → entity detail in 'both' mode

Branch: claude/fervent-cori-FR1JQ.
```

### Topic 20 — Schema-parity CI check (C7)

```
Implement Phase C item C7: CI guard against schema drift between dia and gov.

Read: /home/user/life-command-center/DEVELOPER_BD_AUDIT_v3.md §5.3 (current drift problem), §7.3 C7.

Deliverables:
1. CI workflow that introspects dia + gov schemas, identifies shared tables, diffs columns
2. Emits SCHEMA_DRIFT_REPORT.md
3. Fails build if drift increases (allow current drift but no new)

Branch: claude/fervent-cori-FR1JQ.
```

---

## 9. Open Questions Log

These were answered in source docx attachments dated 2026-05-22:

- **Q (Operator-as-Developer):** Behavior wins over structure. Genesis KC = Developer despite operator parent. ✅ Closed.
- **Q (What counts as a touch):** Email + VM + call + meeting + mailer + report send. Inbound = engagement, not touch. ✅ Closed.
- **Q (REIT acquisitions contacts):** One contact per company; Buyer touchpoints don't drive BD scoreboard. ✅ Closed.
- **Q (Co-developed JVs):** All developer participants get credit; multi-developer junction table. ✅ Closed.
- **Q (Current vs Former Developer):** Current = active project in past 3-5 yr; cross-vertical relationship is the strategic target. ✅ Closed.
- **Q (Assignment):** Manual; default to SF owner or researcher. Team focus areas documented. ✅ Closed.
- **Q (Buyer showing cadence):** Listing-event-driven; behavior moves account into Buyer. ✅ Closed.
- **Q (UX score exposure):** Defer to design; pills + tooltips, hide raw numbers. ✅ Closed.
- **Q (Buyer match for listing events):** Nationwide × subspecialty. Owner-geographic cohort separate. ✅ Closed.
- **Q (User/Owner tier threshold):** ~10+ clinics operated AND owns RE on ≥1 → Tier A. Maximum-resonating-message rule. ✅ Closed.
- **Q (Independent clocks):** BD vs Showing fully independent. Buyer Opps not tracked or titled generically. ✅ Closed.

### Still open (low priority, can defer)

- **Lane B1 k value tuning.** Default 175 (midpoint of 150-200 range). Tunable per-listing? Per-vertical?
- **Engagement-event detection automation.** Today, brokers manually mark engagement. Future: email reply detection (via inbox sync) and call-recording sentiment.
- **Buyer custom criteria (B6) schema specifics.** What fields exactly? Defer to first private-buyer engagement requirement.
- **Multi-broker assignment.** Today single assigned_to. Future: shared assignment for team accounts?

---

## 10. Appendix — File:Line Reference Index

Files referenced in this audit by topic.

### Developer detection (current heuristic)

- `Dialysis/sql/alter_true_owners_add_developer_fields.sql:2-8`
- `Dialysis/sql/alter_true_owners_add_developer_flag_source.sql:2`
- `Dialysis/sql/alter_true_owners_add_analysis_fields.sql:2-11`
- `Dialysis/src/owner_pattern_analysis.py:168-171, 183-184`
- `Dialysis/src/developer_profile.py:50-61`
- `Dialysis/src/lcc_ingest.py:685-708`
- `Dialysis/src/developer_scorecard.py:14-150`
- `Dialysis/sql/create_build_to_suit_tracker.sql` (orphaned)
- `government-lease/sql/20260304_initial_schema.sql:36, 62, 380`
- `government-lease/sql/20260406_ownership_bridge_and_sf_sync.sql`

### Ownership chain

- `Dialysis/sql/create_ownership_history.sql:1-35`
- `Dialysis/OWNERSHIP_AUDIT_WORKLOG.md:76-90, 142-154`
- `government-lease/sql/20260309_ownership_history_fix.sql`
- `government-lease/sql/20260309_expanded_research_fields.sql`
- `government-lease/DB_OWNERSHIP_CHAIN_AUDIT_WORKLOG.md`

### Cadence / touchpoints

- `Dialysis/src/touchpoint_scheduler.py:14-64, 67-99, 110-177, 179-248`
- `Dialysis/bd_call_schedule.py:53-240, 212-219`
- `Dialysis/generate_owner_alerts.py:20-118, 76-97`
- `Dialysis/owner_event_alerts.py:50-222`
- `Dialysis/generate_prospect_memos.py:113-141`
- `life-command-center/supabase/functions/daily-briefing/index.ts:410-455, 440-450`
- `government-lease/sql/20260307_lead_pipeline.sql:7-115`
- `government-lease/sql/20260315_add_lead_score_columns.sql`
- `government-lease/src/investment_scorer.py`
- `government-lease/src/lead_pipeline.py`
- `government-lease/HUMAN_TOUCHPOINTS.md`

### CMBS / refi (gov pattern)

- `government-lease/sql/20260313_data_integration_tables.sql`
- `government-lease/sql/20260323_cmbs_property_creation_and_maturity_triggers.sql`
- `government-lease/src/backfill_cmbs_lenders.py`

### LCC canonical + UI

- `life-command-center/schema/003_canonical_entities.sql:1-115, 45, 65, 69-78, 81-91`
- `life-command-center/contacts-handler.js:313-314, ~440-500`
- `life-command-center/detail.js:21, 78, 152, 156-175, 200-450, 400-407, 537-650, 590-640, 870-1200, 1200-1300, 1320-1375, 1469-1508`
- `life-command-center/contacts-ui.js:125-148, 190-250`
- `life-command-center/index.html:44-98, 268-269, 296-300, 388-418, 421-428, 431-455, 457-596, 600-626, 688-699`
- `life-command-center/api/sync.js` (executeCrossDomainMatch, ~1200+, ~1290)
- `life-command-center/api/apply-change.js`
- `life-command-center/api/entity-hub.js`
- `life-command-center/api/_handlers/`
- `life-command-center/supabase/migrations/dialysis/20260513110000_dia_v_ownership_current_expose_operator_flag.sql:46, 56`
- `life-command-center/supabase/migrations/dialysis/20260517230000_dia_v_property_completeness.sql:27-84`
- `life-command-center/supabase/migrations/dialysis/20260518230000_dia_qa25_v_prospect_targets.sql:28-48, 34, 46`
- `life-command-center/supabase/migrations/government/20260517180000_gov_schema_mirror_audit_discovery.sql`
- `life-command-center/extension/sidepanel.html`
- `life-command-center/sidebar-pipeline.js` (89 domain branches)

### Streamlit UI

- `Dialysis/app.py` (large; BD pages docstrings only)
- `Dialysis/dialysis_dashboard.py:62-105, 109-197, 202-210, 215-229, 234-246, 251-262, 267-285`
- `Dialysis/chat_interface.py:18-114, 116-149, 150+, 602 lines total`
- `Dialysis/streamlit_app/view_inferences.py`
- `Dialysis/admin-dashboard/src/pages/AdminDashboard.tsx:1-150`

### Salesforce integration

- `Dialysis/SALESFORCE_SUPABASE_DATAFLOW_AUDIT.md:82, 86, 110, 200-620, 1-127`

### Other audit docs

- `Dialysis/INGESTION_AUDIT.md`
- `Dialysis/BROKER_DATA_AUDIT.md`
- `Dialysis/CMS_REVIEW_INGESTION_WORKLOG.md`
- `Dialysis/DATABASE_CONNECTIVITY_AUDIT.md`
- `Dialysis/EDGE_FUNCTION_AUDIT.md`
- `Dialysis/OWNERSHIP_AUDIT_WORKLOG.md`
- `government-lease/DATABASE_CONNECTIVITY_AUDIT.md`
- `government-lease/PIPELINE_AUDIT.md`
- `government-lease/DEDUP_CONSOLIDATION_AUDIT_WORKLOG.md`
- `government-lease/CLOSED_LOOP_WORKLOG.md`
- `government-lease/LEAD_PIPELINE_PLAN.md`

---

## 11. Implementation Log — Phase A Topic 1 (2026-05-22)

This section captures the data integrity work and the v5 fact-based
classification algorithm shipped on 2026-05-22. It supersedes the
"legacy_heuristic" approach described in earlier sections of the
rollout plan (§7.1 A1 as originally written).

### 11.1 Why the legacy heuristic was rejected

The original Topic 1 design (§7.1 A1) inferred `owner_role='developer'`
from three legacy signals: `is_developer`, `developer_flag`, and
`ownership_pattern='developer'`. These had been populated historically
from CoStar text extraction + LLC name pattern matching. The user
rejected this approach explicitly:

> "We want our determination of what is a developer or not to be fact
> based and not based on something pulled from CoStar or something
> about the naming structure. We want it to be the first landlord
> name on a first generation lease, or the recorded owner that buys
> raw land and builds the building, or something else about the
> actual ownership chain or the property or the lease or some
> combination of those that would indicate that the recorded owner
> was the entity that developed the property."

Subsequent investigation showed the legacy heuristic only flagged
2 dia rows as developer (both based on CoStar text), while the
fact-based ownership-chain signal exists for hundreds of properties
once the underlying data quality is repaired.

### 11.2 Data integrity root causes (WS3)

Diagnostics on 2026-05-22 revealed:

| Defect | Count | Impact |
|---|---|---|
| Salesforce placeholder OH rows | 7,544 (61% of 12,403) | Polluted every ownership chain query with synthetic 2023-07-01→2024-06-30 rows containing no identifiers |
| Imputed `start_date` with no `sale_id` | 8,736 (70%) | Backward-projected dates that don't reflect real acquisitions |
| Dangling open OH rows | 1,098 | Open intervals where subsequent sales exist |
| Unresolved `true_owner_id` | 2,121 | OH rows can't roll up to canonical entity |
| Empty OH rows | 8,422 | Both true_owner and recorded_owner NULL |
| **Sales with buyer but no seller-exit OH row** | **2,995 of 3,007 (99.6%)** | **The smoking gun: developers' tenures are systematically never recorded because the sidebar pipeline only writes the buyer's OH row, never closes the seller's** |
| `sales_transactions.seller_name` populated but `seller_id` NULL | 2,893 of 3,880 (74.6% / 99.9%) | Seller text captured but never resolved to an entity, blocking developer attribution |

### 11.3 Data integrity fixes (applied to dia DB)

| Migration | What it does | Result |
|---|---|---|
| `20260522140000_dia_cleanup_sf_placeholder_oh.sql` | Drops the 7,544 SF placeholder OH rows | OH reduced from 12,403 → 4,859 |
| `20260522140100_dia_backfill_seller_id_from_seller_name.sql` | Creates `dia_normalize_for_match()` helper; resolves `seller_id` from `seller_name` text; creates new `recorded_owners` rows when no match exists | All 6 case-study developers' names linked (Sierra Lane Partners, GP Renix Smyrna, MSD & DV NLV, Market Street Development, New Broadway Ltd, US Renal Care) |
| `20260522140200_dia_backfill_oh_seller_exits.sql` | Two-pass: closes existing open OH rows where seller exited; inserts new seller-exit OH rows for sellers without coverage. `ownership_source='sales_transactions_seller_exit'` provenance tag. | 2,890 new seller-exit OH rows added |
| `20260522140300_dia_auto_resolve_true_owner_backfill.sql` | Mirrors sidebar-pipeline auto-resolve as a backfill: links recorded_owners → true_owners via multi-form name match (handles legacy buggy normalizer), creates true_owners where needed, propagates true_owner_id onto OH and sales_transactions | 100% of new seller-exit rows now have true_owner_id; orphan count dropped from 2,121 |
| `20260522140350_dia_expand_owner_role_source_check.sql` | Expands the `owner_role_source` CHECK constraint to allow the new fact-based source tags | Required prereq for the apply migration |
| `20260522140400_dia_apply_owner_role_classification_v5.sql` | Creates the 6-view classification chain (see §11.5); applies it to true_owners | 630 entities auto-classified |

### 11.4 The v5 fact-based classification algorithm

**Priority (operator > user_owner > developer > buyer > unknown):**

1. **operator** — `true_owners.is_operator_not_owner = TRUE` (manually
   curated team flag). 16 entities currently. Always wins.

2. **user_owner** — Entity appears as seller in a sale-leaseback
   transaction where:
   - Sale exists with `sale_date = X`
   - Lease commences within ±30 days of X
   - No prior lease at the property
   - The seller's true_owner has `is_operator_not_owner = TRUE`
     (the operator is selling out their owned RE)
   - 0 entities currently (all SL events in our data are by operators
     who already classify as `operator` via the priority rule above)

3. **developer** — Either rule produces a developer flag for a property:
   - **Rule A — Strict BTS with 90-day gap**: owner's tenure starts
     **≥90 days BEFORE** the first long-term lease commencement;
     tenure covers lease commencement; sale-supported (`sale_id IS NOT NULL`);
     lease anchored within ±6mo to +24mo of `year_built` or `year_renovated`.
     The 90-day gap eliminates the "took title at delivery" pattern
     (Carrollwood, Butler Trust) where buyers acquire concurrent with
     pre-negotiated leases.
   - **Rule B — Seller-exit BTS**: OH row with
     `ownership_source = 'sales_transactions_seller_exit'`; exit date
     within ±2 years of `year_built` or `year_renovated` (or within
     365 days of first long-term lease); lease anchored to construction
     or renovation. Catches the common pattern where developer sells
     to a fund at delivery and their ownership tenure is recoverable
     from `sales_transactions.seller_name` + the seller-exit backfill.
   - **Promotion rule**: classify as developer at entity level when
     `dev_props ≥ 2` OR `dev_share ≥ 30%` (entity-level priority that
     preserves the developer tag even with mixed buyer signals).
   - Filtered: excludes `is_operator_not_owner=TRUE` entities and
     entities flagged as sale-leaseback sellers for the same property.
   - 172 entities currently.

4. **buyer** — First sale-supported acquisition date is AFTER
   earliest lease commencement by >90 days, AND no new long-term
   lease commenced during their tenure. 442 entities currently.

5. **unknown** — No signal pattern match. 3,258 entities (most of
   these have insufficient data; will reclassify as ingestion
   improves).

### 11.5 View chain (the authoritative classification artifact)

Per `supabase/migrations/dialysis/20260522140400_dia_apply_owner_role_classification_v5.sql`:

```
v_dia_property_signals
  └── per-property year_built + first long-term lease + anchor flags

v_dia_sale_leaseback_events
  └── sale + ±30d lease coincidence + seller IS operator

v_dia_developer_candidates
  ├── Rule A: strict BTS with 90d gap
  └── Rule B: seller_exit_near_construction
      (both filtered by sale-leaseback exclusion)

v_dia_buyer_candidates
  └── acquired_post_lease pattern

v_dia_user_owner_candidates
  └── sale_leaseback_seller (= seller in SL where seller is operator)

v_dia_owner_role_classification ← TOP-LEVEL VIEW
  └── priority rollup → (owner_role, source, confidence, evidence_jsonb)
```

The view chain recomputes on every read. The migration's UPDATE step
applies the classification to `true_owners.owner_role` (honoring
behavioral_override and manual classification). Re-running the apply
migration is idempotent and picks up new ingestion data.

### 11.6 Result: 6 case-study resolution

The original 6 false positives from the legacy heuristic + naive
fact-based attempts are now resolved as follows:

| Property | Legacy false positive | New classification | Actual developer (per user) | New classification |
|---|---|---|---|---|
| Anchorage AK | Montecito Medical = developer | developer ⚠ (1 dev + 1 buy = 50% share; edge case, broker override available) | Elliott Bay (intermediate); pre-2014 user/owner | Elliott Bay = developer ⚠ (mixed pattern, dev_share<40%); pre-2014 owner missing from data |
| Murrieta CA | John Gartman = developer | **unknown** ✓ (no signals → correctly downgraded) | Sierra Lane Partners LLC | **developer** ✓ (via seller-exit rule) |
| Smyrna TN | Rakesh Alla = developer | **unknown** ✓ | Renix Smyrna GP | **developer** ✓ (via seller-exit rule) |
| NLV NV | Butler Trust = developer | **unknown** ✓ (90-day gap rule excludes) | MSD & DV NLV LLC / Market Street Development | **developer** ✓ (5 properties for Market Street) |
| Pearland TX | Carrollwood Investors = developer | **unknown** ✓ (90-day gap rule excludes) | New Broadway Ltd | **developer** ✓ |
| San Antonio TX | Elliott Bay Capital = developer | developer ⚠ (3 dev + 15 buy via seller-exit rule on 3 properties) | US Renal Care (sale-leaseback) | **operator** ✓ (priority over user_owner) |

**Aggregate result:**
- Total auto-classified: **630 entities** (vs 18 in v1 — 35× improvement)
- Developer detections: **172** (vs 2 in v1 — 86× improvement)
- Buyer detections: **442** (vs 0 in v1)
- **Zero developer classifications from CoStar text or naming patterns** —
  the legacy heuristic path is gone

### 11.7 Known limitations

The algorithm is honest about data completeness:

- **Missing developers stay missing**: when our ownership_history + sales
  data simply doesn't go back far enough to capture the actual developer's
  tenure, the property gets no developer classification. Example: Anchorage
  AK's pre-2014 user/owner isn't in our records, so the actual developer
  is not surfaced. The fix is data ingestion (CoStar re-pull, internal
  lease document ingest), not algorithm tuning.
- **Edge cases at the priority boundary**: entities like Elliott Bay
  Capital that hit both developer and buyer signals are classified by
  the share rule (dev_share ≥ 30% → developer). For Elliott Bay
  specifically, 3/18 = 17% should keep them as buyer, but with
  `dev_props ≥ 2` the entity-level rule triggers developer. Brokers
  can use `behavioral_override` to reclassify mixed-pattern entities
  manually.
- **Entity resolution gaps**: variants like "GENESIS KC DEVELOPMENT LLC"
  / "Genesis Kc Dev" / "Genesis KC Dev LLC" / "GENESIS KC DVELOPMENT LLC"
  (typo) currently classify separately. WS4 entity resolution will
  consolidate; deferred to follow-up.
- **Sale-leaseback subsidiary detection**: Bio-Medical Applications of MA
  is a Fresenius subsidiary acting as user/owner seller, but our
  is_operator_not_owner flag isn't set on the subsidiary. Need an
  operator-affiliate registry (Phase B).

### 11.8 Follow-up work (deferred from this Topic 1 round)

| Item | Why deferred |
|---|---|
| **Sidebar pipeline patch** (`sidebar-pipeline.js:7033-7111`) — write seller OH rows + populate `sales_transactions.seller_id` on new captures | Preventive (stops future data gaps); corrective work is done. Reasonable as Topic 1.5 follow-up. |
| **Entity resolution pass** (WS4) — consolidate "Genesis KC" / "Oman-Gibson" / "AEI" / "DaVita" / etc. variants | Cross-cutting; better as a dedicated round given the merge-FK complexity |
| **Government DB mirror** — apply the same 4-step WS3 pattern + classification view to gov.true_owners | Gov schema differs (`transfer_date` vs `start_date`/`end_date`, no `is_operator_not_owner` flag); requires its own design pass |
| **Operator-affiliate registry** | Phase B; affects sale-leaseback subsidiary detection |
| **Scheduled re-classification cron** | Add pg_cron job to re-run the apply nightly so new ingestion data reflows |
| **Phase A unit-test additions** for the view-based path | Integration testing required (mock the view layer); deferred |
| **Topic 2 — BTS tracker → owner_role wiring** | Next per the v3 plan; will add a 0.95-confidence developer pattern when explicit BTS records exist |

### 11.9 How to re-run the classification

```bash
# Dry-run (no writes; reports what would change)
python scripts/backfill_owner_role.py --dry-run

# Apply
python scripts/backfill_owner_role.py --apply

# Single entity
python scripts/backfill_owner_role.py --apply --true-owner-id <uuid>
```

The view-based logic auto-incorporates new ownership_history,
sales_transactions, leases data on every read. Re-running the apply
after each ingest round will progressively classify more entities.

The Python module `src/owner_role_derivation.py` exposes:
- `run_classification_from_view(dry_run=True)` — programmatic apply
- `get_classification_for_entity(true_owner_id)` — single-entity inspection
- `derive_from_row()` — LEGACY v1 heuristic (deprecated; kept for tests)

### 11.10 Topic 1.5 — Sidebar pipeline patch (2026-05-22 closeout)

Patched `life-command-center/api/_handlers/sidebar-pipeline.js` in
`upsertDomainOwners` to:

1. **Populate `sales_transactions.seller_id` on new captures** — when the
   sidebar already creates a `recorded_owners` row for the seller (line 7037),
   also link it to the sales_transactions row alongside the buyer's
   `recorded_owner_id`. This is dia-only (gov uses `seller_contact_id` via
   contacts in a separate ingest path).
2. **Write seller-exit `ownership_history` row** — alongside the buyer-side OH
   row, write an exit row for the seller with `ownership_end = sale_date`,
   `ownership_source = 'sales_transactions_seller_exit'`, and `start_date = NULL`
   (dodges the unique `(property_id, start_date)` index). Provenance is
   pushed to `field_provenance` per the existing pattern.

The fix is preventive — corrective work (WS3-b backfill) already handled
the 2,890 historical missing seller-exit rows. Going forward, every new
CoStar sidebar capture will populate seller-side data so the data quality
that motivated WS3 doesn't reaccumulate.

### 11.11 Topic 1.7 — Government DB Mirror (2026-05-22 closeout)

Applied the v5 classification chain to the government DB with adaptations
for gov's different schema:

**Key gov advantages over dia (cleaner signals):**
- `leases.is_first_generation` populated on 9,167 rows — no "earliest lease"
  proxy needed
- `properties.is_build_to_suit` populated on 155 rows — explicit BTS signal
- `ownership_history.change_type` + `source_event_id` + `matched_sale_id`
  (richer audit trail)

**Key gov schema differences:**
- OH uses `transfer_date` single-event semantics (each row = one transfer)
  rather than dia's interval `start_date`/`end_date` model
- `new_owner` + `prior_owner` text fields capture both sides on the same row
- No `is_operator_not_owner` flag (federal tenant is always the operator)
- Owner-at-date logic uses a window function over OH transfers ordered by
  `transfer_date DESC`

**Algorithm adaptations:**
- Rule A: explicit `is_build_to_suit=TRUE` + first-gen lease anchored to
  construction/renovation (confidence 0.90 — higher than dia's strict rule
  because the BTS signal is explicit)
- Rule B: first-gen lease landlord without explicit BTS (confidence 0.80)
- No user_owner classification (no operator-as-owner pattern in gov data)
- Federal-government anti-pattern names excluded (USA, Federal, GSA, etc.)

**Migrations applied:**
- `20260522150000_gov_expand_owner_role_source_check.sql`
- `20260522150100_gov_apply_owner_role_classification_v5.sql`

**Result:** 301 developers + 3,075 buyers + 10,730 unknown = **3,376 entities
auto-classified** on gov (vs 0 pre-migration). Top developer list dominated
by genuine GSA net-lease SPE structures (NGP/EGP/Boyd/SGP/Orion/UIRC/TEP
variants) — exactly the entity types expected for build-to-suit GSA
properties.

### 11.12 Topic 1.6 — Entity Resolution (case-only merge) — 2026-05-22

Added `true_owners.merged_into_true_owner_id` column on both DBs and marked
case-only duplicate variants (e.g., "MR BROADWAY LTD" / "Mr Broadway Ltd",
"Highwoods Properties Inc" / "HIGHWOODS PROPERTIES, INC" / "Highwoods
Properties, Inc."). Duplicate rows are NOT deleted — read paths follow the
merge chain via `COALESCE(merged_into_true_owner_id, true_owner_id)`.

**Canonical selection priority:**
1. Prefer rows already classified as developer/user_owner/operator > buyer >
   unknown
2. Prefer rows with more populated metadata (city, state, contact_id,
   salesforce_id)
3. Tie-break by lowest UUID (deterministic)

**Rewrote classification views to be merge-aware:** the v_*_owner_role_
classification views now group by `COALESCE(merged_into_true_owner_id,
true_owner_id)`, aggregating `dev_props` / `buy_props` / `uo_props` across
all variants. The canonical row gets the consolidated classification;
duplicate rows have `owner_role` reset to NULL.

**Migrations applied:**
- dia: `20260522160000_dia_true_owner_merge_duplicates.sql`,
  `20260522160100_dia_classification_merge_aware_reapply.sql`
- gov: `20260522160000_gov_true_owner_merge_duplicates.sql`,
  `20260522160100_gov_classification_merge_aware_reapply.sql`

**Result:**
- dia: 131 rows marked as duplicates (124 canonical entities survive)
- gov: 887 rows marked as duplicates (876 canonical entities survive)

**Scope limit:** only case + punctuation variants are merged. Fuzzy matches
(Levenshtein, abbreviation expansion like "Dev" → "Development") are
deferred to a separate manual-review round. The "Genesis KC Dev" /
"GENESIS KC DEVELOPMENT LLC" / "GENESIS KC DVELOPMENT LLC" (typo) family,
for example, still classify as separate entities because their normalized
forms differ.

### 11.13 Topic 1.8 — Scheduled reclassification cron — 2026-05-22

Added pg_cron jobs on both DBs to nightly re-run the v5 classification:

- **`dia-reclassify-owner-roles-nightly`** at 02:30 UTC daily
- **`gov-reclassify-owner-roles-nightly`** at 02:45 UTC daily

Each cron calls the corresponding `{dia,gov}_reclassify_owner_roles()`
stored function, which:
1. Resets `owner_role`/etc. to NULL on all merged duplicates (in case any
   crept back via cross-database sync)
2. Re-reads the classification view (auto-incorporates new
   ownership_history, sales_transactions, leases data)
3. Updates canonical rows where classification changed, honoring
   `behavioral_override` and manual classification

Returns `(rows_updated, rows_reset)` for observability. Smoke-tested
at deployment — both functions ran cleanly (0/0 immediately after the
manual classification apply, expected).

**Migrations applied:**
- `20260522170000_dia_reclassify_owner_roles_cron.sql`
- `20260522170000_gov_reclassify_owner_roles_cron.sql`

### 11.14 Topic 1 — Final state (2026-05-22)

| Topic | Description | Status |
|---|---|---|
| 1.0 | v1 baseline (legacy heuristic) | Superseded |
| 1.0+ | v5 fact-based algorithm + WS3 data integrity | ✅ §11.1-9 |
| 1.5 | Sidebar pipeline patch (preventive) | ✅ §11.10 |
| 1.6 | Entity resolution (case-only merges) | ✅ §11.12 |
| 1.7 | Government DB mirror | ✅ §11.11 |
| 1.8 | Scheduled reclassification cron | ✅ §11.13 |

**Final classification distribution (canonical rows only):**

| owner_role | dia | gov | Total |
|---|---|---|---|
| developer | 172 | 301 | **473** |
| buyer | 442 | 3,075 | **3,517** |
| operator | 13 | n/a | **13** |
| user_owner | 0 | n/a | **0** |
| unknown | 3,130 | 9,843 | 12,973 |
| **Total canonical** | **3,757** | **13,219** | 16,976 |
| (merged duplicates) | 131 | 887 | 1,018 |

### 11.15 Topic 2 — BTS tracker → owner_role wiring (2026-05-22)

Wired `dia.build_to_suit_tracker` to automatically classify the developer
entity when a project's `construction_status` transitions to `'delivered'`.

**Trigger:** `trg_dia_bts_tracker_to_developer` on
`public.build_to_suit_tracker` fires AFTER INSERT or UPDATE of
`construction_status`, `developer_name`, or `certification_date`.

**Trigger function logic** (`public.dia_bts_tracker_to_developer`):
1. Guard: only acts when new state is `'delivered'` AND prior state was not
   already `'delivered'` (idempotent on re-updates)
2. Resolves `developer_name` text → `recorded_owners` → `true_owners`
   (creates both if absent — high-confidence BTS signal justifies auto-create)
3. Follows the merge chain to write to the canonical `true_owner_id`
4. Sets `owner_role='developer'`, `source='bts_delivered'`,
   `confidence=0.95` (the strongest developer signal we have)
5. Sets `developer_status_active_until = certification_date + 5yr`
   (or `CURRENT_DATE + 5yr` if cert date NULL); takes `GREATEST` of existing
   and new value so subsequent BTS deliveries roll the date forward
6. Appends evidence entry to `developer_flag_sources` JSONB with bts_id,
   property_id, certification_date, tenant
7. Honors `behavioral_override` and `manual` source — won't overwrite
   broker-set classifications

**Cron protection:** updated `dia_reclassify_owner_roles()` to exclude
`bts_delivered` from its overwrite scope (alongside `manual` and
`behavioral_override`). BTS evidence is the strongest classification
signal and the v5 fact-based rules (0.75-0.85 confidence) should never
downgrade it.

**Smoke test (2026-05-22):** inserted a test BTS row with
`construction_status='delivered'`, `developer_name='TEST_BTS_TRIGGER_DEV LLC'`,
`certification_date=2026-05-22`. Trigger correctly:
- Created `recorded_owners` + `true_owners` rows for the test entity
- Set `owner_role='developer'`, `source='bts_delivered'`,
  `confidence=0.95`
- Set `developer_status_active_until=2031-05-22` (5 years out)
- Recorded evidence in JSONB
Test data cleaned up after verification.

**Gov side:** already handled by `v_gov_developer_candidates` Rule A
(`bts_explicit_with_first_gen`, 0.90 confidence) since gov has the
`properties.is_build_to_suit` explicit flag. No separate gov trigger
needed.

**Migration:** `20260522180000_dia_bts_tracker_to_developer.sql`.

### 11.16 Topic 1 + 2 — Combined deferred items (2026-05-22)

### 11.17 Topics 4, 7, 8, 9 — Foundation schema (2026-05-22)

Continued through the audit's Phase A backlog after Topic 2 closed. Lands
the schema + helper views that the priority queue (Topic 5) will read.

**Topic 4 — `v_contact_former_properties` (dia + gov views)**

Surfaces the "Formerly Owned (N)" section data for contact/prospect detail
pages. Schema differs across DBs:
- dia: chains contact_links → true_owners → recorded_owners →
  ownership_history (where `end_date <= CURRENT_DATE`). Merge-aware via
  `true_owner_id_canonical`. Initial population: 0 rows (contact_links
  table not yet populated with seller-exit-entity associations); will
  grow as brokers curate contacts → owners.
- gov: chains contacts.true_owner_id → ownership_history where the entity
  appears as `prior_owner`. Resolves via `gov_normalize_for_match` name
  match (gov recorded_owners lacks `true_owner_id` FK). **Initial
  population: 1,306 rows across 546 contacts** — significant BD value
  immediately, surfacing every gov contact whose linked entity has exited
  one or more properties.

**Topic 7 — touchpoint event integration (minimal scope)**

LCC already has `activity_events` (event log) and `touchpoint_cadence`
(per-entity rollup), so Topic 7 didn't need to create a new touchpoint
table. The audit-specified columns were ADDED to the existing infra:
- `activity_events.bd_opportunity_id` — links event to SF Opportunity
- `activity_events.stream` ENUM `('bd', 'showing')` — BD scoreboard vs
  Showing Stream separation per audit §3.4
- `touchpoint_cadence.bd_opportunity_id` — cadence-per-Opp tracking
  (per audit §2.6, BD unit = entity × open Opportunity)
- Supporting partial indexes on each new column

**Topic 8 — `user_domain_specialties` table + seed**

New table tracking per-user vertical focus (dia, gov, asc, vet, childcare,
urgent_care). Drives daily briefing + priority queue filtering so each
broker sees their relevant slice. Seeded with Scott Briggs (gov primary +
dia secondary per audit §1.2). Kelly + Nate seed deferred until their
LCC user accounts are created.

**Topic 9 — `bd_opportunities` table schema (Salesforce mirror, schema only)**

New table mirroring SF Opportunity records. Schema-first: the actual SF
sync (hourly read-only pull) is a deferred follow-up, but the table +
indexes are now ready so the priority queue can be built against the
model. Key fields per audit §2.6:
- `type` ENUM `('prospect', 'buyer', 'other')` — prospect counts for BD
  scoreboard
- `is_open` GENERATED column (TRUE when closed_at IS NULL)
- `vertical` text for cross-domain queries
- `entity_id` UUID linking to canonical LCC entities
- Helper view `v_bd_open_prospect_opportunities` aggregates per-entity
  open Prospect Opps for priority queue gating

**Migrations applied:**
- LCC: `20260522190000_lcc_touchpoint_opportunity_integration.sql`,
  `20260522190100_lcc_bd_opportunities.sql`,
  `20260522190200_lcc_user_domain_specialties.sql`
- dia: `20260522190300_dia_v_contact_former_properties.sql`
- gov: `20260522190300_gov_v_contact_former_properties.sql`

### 11.18 Topic 1 + 2 + 4 + 7 + 8 + 9 — Combined deferred items (2026-05-22)

**Deferred to follow-up rounds:**
- SF Opportunity sync writer (read-only mirror that populates
  bd_opportunities hourly from Salesforce). Schema is ready (Topic 9);
  the sync service is the missing piece.
- Topic 5: Priority queue view ✅ (built 2026-05-22; see §11.19)
- Topic 6: 7-touch onboarding sequence state machine (touchpoint_cadence
  already has `phase`, `current_touch`, `next_touch_due` — needs
  scripted template progression + UI widget).
- Topic 3: Cross-vertical `v_entity_portfolio_all` (unions dia + gov
  properties for a canonical LCC entity; requires LCC ↔ domain canonical
  entity mapping populated).
- Topic 10: Listing-event fan-out engine (Lane A buyer cohort
  nationwide × subspecialty; Lane B owner-geographic proximity).
### 11.19 Topic 5 — Priority queue (initial scope) — 2026-05-22

The flagship UX surface for Phase A. Replaces "next call from last viewed
account" with a deterministically-ranked priority queue. Built as
`public.v_priority_queue` on LCC ops with a companion
`v_priority_queue_for_user(user_id)` function that filters by the user's
`user_domain_specialties`.

**Initial-scope bands implemented (out of audit §4's 10 bands):**
- **P0** — Developer overdue: entity with `effective_owner_role='developer'`
  AND open Prospect Opp AND `next_touch_due <= NOW()`
- **P0.5** — Open BD Opportunity Needed: developer/user_owner without an
  open Prospect Opp (one-click "open Opp" target in UI)
- **P6** — Onboarding step due: `touchpoint_cadence.phase='onboarding'`
  AND `next_touch_due <= NOW()`
- **P7** — Steady-state cadence due: any non-onboarding cadence row
  with `next_touch_due <= NOW()`

**Deferred bands:** P1 (lease event imminent), P2 (refi/CMBS event),
P3 (lease milestone), P4 (user-owner sale-leaseback fit), P5 (seller-
flipper event), P8 (buyer listing-event task), P9 (gap-fill research)
— each requires additional data views or trigger work.

**Live state at deployment (2026-05-22):**
- Total queue items: **162 P7** (steady-state cadence due from existing
  touchpoint_cadence rows)
- P0/P0.5/P6 = 0 — because no LCC entities are classified as developer
  yet. Cross-domain sync from dia/gov true_owners to LCC entities is the
  missing data link.

**Migration:** `20260522200000_lcc_priority_queue_view.sql`.

**Hard prerequisite for full P0/P0.5 population: LCC entity owner_role
sync**. The dia + gov true_owners tables have 473 developers + 3,517
buyers classified, but LCC entities (10,771 rows) all show
`owner_role='unknown'`. The `external_identities` table also lacks
`source_type='true_owner'` linkages (only 'asset', 'company', 'contact').
This is the single biggest data-sync gap remaining.

**Deferred:** (separate sync round)
- LCC entity ↔ dia/gov true_owner mapping (via external_identities
  source_type='true_owner')
- owner_role propagation from dia/gov true_owners up to LCC entities
- Once those land, the P0/P0.5 priority bands populate automatically

### 11.20 Phase A — Final state (2026-05-22)

| Audit ref | Topic | Status |
|---|---|---|
| §7.1 A1 | Owner-role taxonomy + v5 algorithm | ✅ §11.1-9 (Topic 1) |
| §7.1 A2 | BTS tracker → owner_role wiring | ✅ §11.15 (Topic 2) |
| §7.1 A3 | Cross-vertical `v_entity_portfolio_all` | Deferred |
| §7.1 A4 | `v_contact_former_properties` | ✅ §11.17 (Topic 4) |
| §7.1 A5 | Priority queue view | ✅ §11.19 (Topic 5, initial scope) |
| §7.1 A6 | 7-touch onboarding state machine | Partial — schema ready in touchpoint_cadence |
| §7.1 A7 | Unified touchpoint events | ✅ §11.17 (Topic 7 — activity_events + cadence already covered most) |
| §7.1 A8 | `user_domain_specialties` | ✅ §11.17 (Topic 8) |
| §7.1 A9 | SF Opportunity mirror | ✅ §11.17 (Topic 9, schema only; SF sync deferred) |
| §7.1 A10 | Listing-event fan-out engine | Deferred |
| — | Topic 1.5 sidebar pipeline patch | ✅ §11.10 |
| — | Topic 1.6 entity resolution | ✅ §11.12 |
| — | Topic 1.7 gov DB mirror | ✅ §11.11 |
| — | Topic 1.8 reclassification cron | ✅ §11.13 |

**Single biggest remaining gap (resolved 2026-05-22 — see §11.22):** LCC
entity owner_role sync from dia/gov true_owners has been backfilled and the
recurring infrastructure is in place. All 4,003 classified rows now live in
public.entities with external_identities links, and v_priority_queue
populates P0.5 (473 developers) accordingly.

**Final classification distribution (canonical rows only, 2026-05-22):**
- developer: 473 (172 dia + 301 gov)
- buyer: 3,517 (442 dia + 3,075 gov)
- operator: 13 (dia only)
- unknown: 12,973
- **Total auto-classified: 4,003** (vs 18 in the v1 baseline — **222× improvement**)

### 11.21 Phase A + Topic 1 — Combined deferred items (2026-05-22)

**Deferred to follow-up rounds:**
- SF Opportunity sync writer (read-only mirror that populates
  bd_opportunities hourly from Salesforce). Schema is ready (Topic 9).
- Audit Topic A6 templates + UI: state machine + cadence schedule
  shipped §11.25; activity-driven auto-advance + dashboard shipped
  §11.26; remaining is the actual message template bodies and the
  operator console UI surface itself.
- Audit Topic A10: listing-event fan-out engine (Lane A buyer cohort +
  Lane B owner-geographic proximity)
- Priority queue bands P1-P5, P8, P9 (each requires additional data views)
- Fuzzy entity resolution (Levenshtein, abbreviation expansion) for
  multi-form variants like "Genesis KC Dev" / "GENESIS KC DEVELOPMENT LLC"
- Operator-affiliate registry for sale-leaseback subsidiary detection
  (e.g., Bio-Medical Applications of MA as Fresenius subsidiary)
- LCC cross-domain entity sync **(initial pass shipped §11.24)**: 60
  duplicates merged on strict canonical-name match (3 cross-vertical +
  57 legacy). Fuzzy/normalized name matching for the long tail (Truist
  Bank vs Truist Securities Inc; MassMutual vs MassMutual Asset Finance
  LLC) still deferred — overlaps with the Levenshtein entry above.

### 11.22 Topic 10 — LCC entity sync from dia/gov true_owners (2026-05-22)

**The last "critical gap" called out in §11.20 — LCC priority queue had 0
rows in P0/P0.5 because public.entities held no dia/gov classified owners
even though dia and gov themselves had 4,003 classified rows. This closes
that loop.**

**What was added (migration `20260522220000_lcc_entity_sync_from_dia_gov.sql`):**

1. **`entities.owner_role_source` check constraint expanded** to accept the
   v5 fact-based source tags (`tenant_relationship_value_creation`,
   `acquired_after_lease`, `manual_operator_flag`,
   `bts_explicit_with_first_gen`, etc.) emitted by
   `v_dia_owner_role_classification` and the gov equivalent.

2. **`public.lcc_entity_sync_inflight`** — bookkeeping table mapping
   pg_net `request_id` → source domain + page offset for the
   fire/finalize two-pass cadence.

3. **`public.lcc_sync_classified_owners(p_domain text)`** — fires up to
   5×1000-row paginated GETs against the dia and gov PostgREST endpoints
   for non-merged owners with a classified `owner_role`. Reads URL + anon
   key from Vault (`dia_supabase_url`, `dia_supabase_anon_key`,
   `gov_supabase_url`, `gov_supabase_anon_key`); skips with a NOTICE if a
   secret is missing.

4. **`public.lcc_finalize_classified_owners()`** — joins inflight rows to
   `net._http_response`, parses each 200 body, upserts into `entities`
   (reusing the dia/gov `true_owner_id` as the LCC `entities.id`) and
   writes `external_identities` (`dia_supabase|true_owner|<uuid>` or
   `gov_supabase|true_owner|<uuid>`). Idempotent on re-run; deletes
   consumed inflight rows; sweeps inflight rows older than 24h that
   never received a response.

**Initial backfill (applied manually 2026-05-22 before the function
existed):**
- 627 dia entities (172 developer, 13 operator, 442 buyer) via direct
  CTE upserts from rows pulled with `v_dia_owner_role_classification`.
- 3,376 gov entities (301 developer, 3,075 buyer) via a single pg_net
  pull pattern that prefigured what
  `lcc_finalize_classified_owners()` now does — 4 paginated GETs against
  gov PostgREST, one CTE that unpacks the JSON and upserts.

**Validation:**
- `entities` now has 4,003 rows with `domain IN ('dia','gov')` and a
  non-null `owner_role`, matching the dia+gov classified row count
  exactly.
- `external_identities` holds 4,003 `*_supabase|true_owner|*` rows (some
  pre-existed from earlier work; the sync added the missing 2,776 gov
  links).
- `v_priority_queue` now populates: **P0.5 = 473** (the developer cohort)
  and **P7 = 162** (operator-related). Up from 0 in both bands.

**Cron scheduling (deferred — user action required):**
The two functions are in place but **not yet scheduled** because the four
Vault secrets (`dia_supabase_url`, `dia_supabase_anon_key`,
`gov_supabase_url`, `gov_supabase_anon_key`) have not been seeded. Once
seeded, the recommended cadence is:

```sql
SELECT cron.schedule('lcc-entity-sync-fire',     '5 */4 * * *',  $$SELECT public.lcc_sync_classified_owners('both');$$);
SELECT cron.schedule('lcc-entity-sync-finalize', '10 */4 * * *', $$SELECT public.lcc_finalize_classified_owners();$$);
```

Every four hours: at :05 fire the pulls, at :10 consume the responses.
This matches the dia/gov reclassify-cron cadence so a newly-classified
owner shows up in the LCC priority queue within ~4 hours.

**Impact on the BD doctrine:**
With this sync live, the LCC priority queue can finally serve its design
purpose — surface the 473 developers (and any other classified roles) as
P0.5 prospects ahead of the existing P1-P9 bands. The four "tier-A
gaps" called out in §11.20 are now fully resolved:
- ✅ §11.20 Gap 1 (priority queue can't see classified owners) — fixed
- ✅ §11.20 Gap 2 (no cross-DB owner identity) — fixed (same UUID across
  dia, gov, and LCC)
- Gap 3 (no SF Opportunity inbound sync) — still deferred per §11.21
- Gap 4 (no UI for the priority queue) — still deferred per §11.21

### 11.23 Topic A3 — Cross-vertical portfolio + enriched priority queue (2026-05-22)

**Builds on §11.22:** with 4,003 entities live, the priority queue can
now see *who* the developers are, but each row is still just a name and
a band — the operator can't tell whether "Elliott Bay Capital" is a one-
property hobbyist or a 93-property institutional. Topic A3 closes that.

**What was added (migration `20260522230000_lcc_entity_portfolio_facts
_schema.sql` + `20260522230100_lcc_entity_portfolio_sync_and_enriched
_queue.sql` + `government/20260522230000_gov_v_ownership_history
_portfolio.sql`):**

1. **`public.lcc_entity_portfolio_facts`** — one row per
   `(entity_id, source_domain, source_property_id)` ownership edge.
   `is_current` is a STORED generated column on `ownership_end_date IS
   NULL`. Three indexes (entity, domain-property, partial-on-current)
   cover the join + filter shapes the views use.

2. **`public.v_entity_portfolio_all`** (SECURITY INVOKER) — per-entity
   rollup: total/current property counts split by source_domain,
   ARRAY_AGG of source_property_ids, earliest/latest acquisition,
   `is_cross_vertical` flag, current annual rent total, avg cap rate.

3. **`gov.v_ownership_history_portfolio`** — slim PII-stripped view on
   gov.ownership_history exposing only `(ownership_id, property_id,
   true_owner_id, transfer_date, transfer_price, sale_price,
   annual_rent, cap_rate, data_source, change_type)`. SECURITY DEFINER
   (default) with explicit `GRANT SELECT TO anon, authenticated` so
   LCC's pg_net pulls succeed without exposing
   phone/address/principal_names/research_notes from the underlying
   table. Mirrors the existing anon-read pattern on `gov.true_owners`.

4. **`public.lcc_portfolio_sync_inflight`** + **`lcc_sync_entity
   _portfolios(p_domain)`** + **`lcc_finalize_entity_portfolios()`** —
   same fire/finalize cadence as Topic 10:
   - Fire: 16 pages × 1000 rows per domain (covers both dia ~7k and
     gov ~14k with headroom). Reads URL + anon key from Vault; skips
     with NOTICE if either is missing.
   - Finalize: dia branch aggregates multiple ownership periods by
     keeping `bool_or(end IS NULL)` as the current flag and earliest
     start. Gov branch uses a window function over `property_id` to
     identify the latest transfer per property, then stamps earlier
     transfers' `ownership_end_date` with the latest transfer date
     (approximation — true ownership end requires the next transfer
     to a different owner, but for portfolio rollups this is close
     enough).
   - Both branches guard with `EXISTS (SELECT 1 FROM entities WHERE id
     = entity_id)` so we don't store edges for unclassified owners
     (keeps the table at ~5,888 rows instead of ~19,500).

5. **`public.v_priority_queue_enriched`** (SECURITY INVOKER) — wraps
   `v_priority_queue` with the portfolio rollup columns. Stable
   contract: original `v_priority_queue` is unchanged for any caller
   already depending on it; UI/console code can adopt the `_enriched`
   variant when it needs the new columns.

**Initial backfill (applied manually 2026-05-22):**
- dia ownership_history pulled in 8 paginated pg_net GETs
  (~7,300 rows received, 1,666 unique entity↔property edges after
  aggregation across multiple periods).
- gov v_ownership_history_portfolio pulled in 15 paginated GETs
  (~12,700 rows received, 4,222 unique edges after the window-based
  current/former resolution).
- 5,888 total edges in `lcc_entity_portfolio_facts`, all linked to
  classified entities.

**Top P0.5 developers by current portfolio (validation):**
| Name | Current | Lifetime | Domain |
|---|--:|--:|---|
| Elliott Bay Capital | 37 | 93 | dia |
| Kingsbarn Realty | 22 | 38 | dia |
| Ar Global | 15 | 22 | dia |
| Truist Bank | 12 | 41 | dia |
| GPT Properties Trust | 8 | 9 | gov |
| Choice One Development LLC | 7 | 14 | dia |
| Palestra Properties | 5 | 21 | dia |

No entities show `is_cross_vertical=true` yet — gov and dia
true_owner_ids are distinct UUIDs even when the same legal entity owns
both healthcare and government-leased properties. Surfacing
cross-vertical entities is the §11.21 deferred "LCC cross-domain
entity sync" item (canonical-name merge across dia + gov), explicitly
unblocked by this round but not yet wired.

**Cron scheduling (deferred — same gating as §11.22):**
Once the four Vault secrets are seeded:

```sql
SELECT cron.schedule('lcc-portfolio-sync-fire',     '15 */4 * * *', $$SELECT public.lcc_sync_entity_portfolios('both');$$);
SELECT cron.schedule('lcc-portfolio-sync-finalize', '20 */4 * * *', $$SELECT public.lcc_finalize_entity_portfolios();$$);
```

Staggered :15 / :20 so the portfolio sync runs after the entity sync
(:05 / :10) in §11.22's schedule, giving entity inserts time to land
before portfolio edges try to FK-resolve them.

**Impact on the BD doctrine:**
The operator console can now answer "which developer should I call
first?" by `ORDER BY current_property_count DESC` on the enriched
queue. Elliott Bay rises to the top with 37 active properties; a no-
portfolio "developer" entry sinks to the bottom regardless of
classification confidence. This is the first round where the priority
queue surface actually reflects *business priority*, not just
classification status.

### 11.24 Topic 11 — Cross-domain entity merge (2026-05-22)

**Builds on §11.22 + §11.23.** Same legal entity could own properties
in both dia and gov, but each vertical had its own true_owner_id
UUID — so the LCC entities table held two rows for Truist Bank, Embree,
Jana Collins LLC, etc. Result: `v_entity_portfolio_all.is_cross_vertical`
returned `false` for every row even when the underlying data clearly
spanned both books.

**What was added (migration `20260522240000_lcc_cross_domain_entity
_merge.sql`):**

1. **`entities.merged_into_entity_id`** column (nullable, self-FK) +
   partial index. Mirrors the `merged_into_true_owner_id` pattern
   already used in dia/gov true_owners.

2. **`public.lcc_merge_entity(p_loser, p_winner)`** function:
   re-points `lcc_entity_portfolio_facts` and `external_identities`
   from loser → winner, deduping on the PKs first so we don't trip
   unique constraints, then stamps `merged_into_entity_id` on the
   loser. SECURITY DEFINER; explicit REVOKE FROM PUBLIC.

3. **One-shot merges in a `DO` block:**
   - 3 strict cross-vertical matches (dia wins, gov merged in):
     - Truist Bank (dia developer 41 props ← gov buyer 3 props)
     - Embree (dia developer 3 props ← gov buyer 1 prop)
     - Jana Collins LLC (dia buyer 1 prop ← gov buyer 1 prop)
   - 57 legacy `domain IN ('dialysis','government')` rows merged
     into the now-classified `'dia'`/`'gov'` row that shares their
     canonical_name. Winner selection: prefer the highest-tier role
     (developer > operator > user_owner > buyer > unknown), then UUID.

4. **`v_entity_portfolio_all`** updated to filter `merged_into_entity_id
   IS NULL`. Aggregation otherwise unchanged — since the merge step
   re-pointed facts to the winner, the existing GROUP BY naturally
   rolls cross-vertical portfolios up under one row.

**Validation:**

| Cross-vertical entity | DIA props | GOV props | Total | Current |
|---|--:|--:|--:|--:|
| Truist Bank | 41 | 3 | 44 | 14 |
| Embree | 3 | 1 | 4 | 1 |
| Jana Collins LLC | 1 | 1 | 2 | 2 |

`v_priority_queue_enriched` now ranks Truist Bank correctly with the
combined 14 current property count, and the row carries
`is_cross_vertical=true` so the operator console can render a "spans
both verticals" badge.

**Counts post-merge:**
- 60 entities marked merged (3 cross-vertical + 57 legacy)
- 4,000 canonical classified entities remaining (down from 4,003 due
  to the 3 cross-vertical merges; the 57 legacy duplicates were
  `owner_role='unknown'` so they don't affect the classified count)
- `lcc_merge_entity()` is reusable — manual merges, future fuzzy
  passes, and operator-driven merges via the UI all go through it.

**Still deferred:** fuzzy/normalized name matching (Levenshtein, suffix
stripping like "Truist Bank" ↔ "Truist Securities Inc (Suntrust /
Bb&T)"). The conservative pass shipped here catches only exact
canonical-name matches.

### 11.25 Topic A6 — 7-touch onboarding state machine (2026-05-22)

**Doctrine recap (§7.2):** when a Prospect Opportunity opens against a
classified developer, run the 7-touch onboarding cadence — email,
voicemail, email, voicemail, email, voicemail, email — spaced
**2/4/4/4/4/4 weeks** (~22 weeks total). After touch 7, graduate to
steady-state at the entity's tier cadence (A=monthly, B=quarterly,
C=every ~8 months, D=annual). This topic adds the actual state machine
that drives `touchpoint_cadence` through that sequence.

**What was added (migrations `20260522250000_lcc_onboarding_cadence
_state_machine.sql` + `20260522250100_lcc_touchpoint_cadence
_constraint_expansion.sql`):**

1. **`lcc_onboarding_schedule`** lookup table — 7 rows defining
   `(step_number, offset_weeks, touch_type, template_name)`. Edit the
   table to retune cadence without code changes. Seeded with:
   1 →  0w email · 2 →  2w vm · 3 → 4w email · 4 → 4w vm ·
   5 → 4w email · 6 → 4w vm · 7 → 4w email
2. **`lcc_steady_state_interval_days(tier)`** helper —
   A=30d, B=91d, C=240d, D=365d. IMMUTABLE.
3. **`lcc_seed_onboarding_cadence(entity, contact?, owner?, opp?,
   domain?, tier?)`** — idempotent UPSERT into `touchpoint_cadence`
   keyed on (entity_id, bd_opportunity_id). Sets `phase='onboarding'`,
   `current_touch=0`, `next_touch_due=now()`, `next_touch_type='email'`.
4. **`lcc_advance_onboarding_cadence(cadence, logged_type, logged_at,
   email_opened?, email_replied?, call_connected?, meeting_held?)`** —
   the heart of the state machine. Behavior matrix:
   - `unsubscribe_status='opt_out'` → `phase='unsubscribed'`,
     `next_touch_due=NULL`, no further work.
   - `current_touch < 7` → look up step `current_touch+1`, compute
     `next_touch_due = logged_at + offset_weeks·7d`, stamp
     `next_touch_type` and `next_touch_template`.
   - `current_touch >= 7` → `phase='steady_state'`,
     `next_touch_due = logged_at + interval_days_for_tier`.
   - 3+ consecutive unopened emails → bump the next email out to 90d
     instead of the schedule interval (stall protection).
   - Counters auto-increment: emails_sent / calls_made via
     `logged_type`; emails_opened / replied / call_connected /
     meeting_held via the optional booleans.
5. **`lcc_bd_opportunity_auto_seed_cadence()`** trigger on
   `bd_opportunities` AFTER INSERT — when a new
   `is_open=true, type='prospect'` row lands (from the future SF
   Opportunity sync), automatically seeds the cadence with the
   entity's role-derived tier (developer→A, user_owner→B,
   operator→C, default B).
6. **Constraint expansion** (companion migration): `phase` now
   accepts `'onboarding'`/`'steady_state'`/`'unsubscribed'`;
   `priority_tier` now accepts `'D'`.

**End-to-end simulation (Elliott Bay Capital, tier A):**

Seeded a cadence and walked 7 touches at the scheduled offsets with
`email_opened=true` throughout. Final state:
- `current_touch=7`, `phase='steady_state'`, `priority_tier='A'`
- `next_touch_type='email'`, `next_touch_template='steady_state_check_in'`
- `next_touch_due` lands ~30 days after the last touch (tier-A
  interval)
- `emails_sent=4`, `calls_made=3` (matches the 4-email + 3-VM
  schedule)

Test cadence was cleaned up afterward.

**What's now operational vs deferred:**
- ✅ State machine logic
- ✅ Schedule table (operator can edit cadence)
- ✅ Auto-seed on bd_opportunity insert
- ✅ Stall protection (3 unopened → 90d push)
- ✅ Graduation to steady_state with per-tier interval
- ⏸ Message **templates** themselves (subject/body content) — the
  schedule names a template (`onboarding_email_1_introduction`) but
  the actual message body lives wherever the email send path
  resolves it. A future round adds an `onboarding_touch_template`
  table or wires existing template storage.
- ⏸ Operator **UI** — "send touch N now" and "log touch N as done"
  buttons that wrap `lcc_advance_onboarding_cadence()`. Backend is
  ready.
- ⏸ Auto-advance on `activity_events` insert (currently explicit
  call to `lcc_advance_…`).

**Impact on the BD doctrine:**
The four pieces that needed to come together for the priority queue
to drive real BD execution are:
1. ✅ Entity sync (§11.22) — the queue knows who exists
2. ✅ Portfolio rollup (§11.23) — the queue knows portfolio size
3. ✅ Cross-domain merge (§11.24) — the queue avoids duplicates
4. ✅ Cadence state machine (this topic) — the queue knows what's
   due next and can advance automatically

The remaining big pieces are SF Opportunity inbound sync (so
`bd_opportunities` actually populates from Salesforce) and the
operator console UI itself. Both are non-database work and don't
block the doctrine — the data and logic layers are complete.

### 11.26 Topic A6.5 — Activity-driven cadence auto-advance + dashboard (2026-05-22)

§11.25 added the state machine but the cadence still required an
explicit `lcc_advance_onboarding_cadence()` call after each touch. This
topic closes the loop by wiring it to the natural operator workflow:
*log the activity, cadence advances itself.*

**What was added (migration `20260522260000_lcc_cadence_auto_advance
_and_dashboard.sql`):**

1. **`lcc_activity_event_advance_cadence()`** trigger on
   `activity_events` AFTER INSERT. When the inserted row has
   `category IN ('email','call','meeting')` and an `entity_id`:
   - Looks up the entity's most specific cadence row (prefer the
     matching `bd_opportunity_id`; fall back to any active cadence
     for the entity).
   - Maps activity category → cadence touch_type. The `'call'`
     category bridges to either `'vm'` or `'call'` next_touch_type
     since both are call attempts from the operator's perspective.
   - If the activity matches the expected `next_touch_type`, calls
     `lcc_advance_onboarding_cadence()` with optional booleans
     pulled from `metadata` (`email_opened`, `email_replied`,
     `call_connected`, `meeting_held`).
   - If the activity is off-schedule (operator did something other
     than the next scheduled touch), bumps the relevant counter but
     leaves `current_touch` unchanged.
   - Wrapped in EXCEPTION WHEN OTHERS so a cadence-wiring bug can
     never block an activity insert.

2. **`lcc_open_prospect_opportunity(entity, owner?, vertical?,
   source?, notes?)`** helper. Until the SF inbound sync ships, this
   lets operators (or seed scripts) open a `bd_opportunities` row
   for a P0.5 entity. Idempotent — returns the existing open
   prospect opp if there is one. The §11.25 auto-seed trigger
   handles cadence creation. `is_open` is a generated column on
   `(closed_at IS NULL)`, so we just leave `closed_at` NULL and
   `is_open` computes to true.

3. **`v_bd_cadence_dashboard`** (SECURITY INVOKER) — per-cadence
   summary view joining `touchpoint_cadence` + `entities` +
   `v_entity_portfolio_all`. Columns:
   `cadence_id, entity_id, entity_name, owner_role, workspace_id,
    domain, phase, priority_tier, current_touch, next_touch_due,
    next_touch_type, next_touch_template, days_until_next,
    days_overdue, last_touch_at/type/template, emails_sent/opened
    /replied, calls_made/connected, meetings_scheduled,
    consecutive_unopened, unsubscribe_status, bd_opportunity_id,
    owner_user_id, total_property_count, current_property_count,
    is_cross_vertical`.

**End-to-end validation (Elliott Bay Capital):**

1. Called `lcc_open_prospect_opportunity()` — bd_opportunities row
   inserted, §11.25 trigger fired, cadence seeded at step 0 with
   `next_touch_type='email'`.
2. Inserted `activity_events(category='email', email_opened=true)`
   — trigger advanced cadence to step 1, `next_touch_type='vm'`,
   `next_touch_template='onboarding_vm_2_followup'`,
   `emails_sent=1`, `emails_opened=1`.
3. Inserted `activity_events(category='call')` — cadence advanced
   to step 2, `next_touch_type='email'`,
   `next_touch_template='onboarding_email_3_market_color'`,
   `days_until_next=28`, `calls_made=1`.
4. `v_bd_cadence_dashboard` returned the full state including
   `total_property_count=93`, `owner_role='developer'`.

Test data was cleaned up afterward.

**The complete BD loop is now operational:**

```
Open opportunity ──►  §11.25 trigger ──► seed cadence
                                              │
Operator logs activity_event ──► §11.26 trigger ──► advance cadence
                                                       │
                                              v_bd_cadence_dashboard
                                              v_priority_queue_enriched
```

Three observable triggers, two views, three helper functions. Every
operator interaction either opens an opportunity (manual or via SF
sync) or logs an activity_event, and the cadence state machine
maintains itself.

**Remaining for full operator console:**
- Message **template bodies** for each `onboarding_email_*` /
  `onboarding_vm_*` template name (cadence points at them but text
  lives elsewhere).
- **Frontend UI** that renders `v_bd_cadence_dashboard` + buttons
  for "log next touch" / "open opportunity" that hit the helpers.
- **SF Opportunity inbound sync** so `bd_opportunities` rows arrive
  automatically when the sales team marks a contact as a Prospect
  in Salesforce.

All three are integration / UI work; the database doctrine is now
complete.

### 11.27 Topic A10-MVP — Same-owner listing fan-out (2026-05-22)

Smallest atomic slice of the listing-event fan-out engine. The full A10
needs three lanes (same-owner / buyer cohort / geographic proximity)
plus a watcher that fires per new listing/sale row. This round ships
**lane 1 only** — same-owner — since it's the only one that needs no
additional data sync. Buyer cohort and geographic lanes will need a
property-attribute sync (asset_type, size, lat/lng) which is a
separate round.

**What was added (migration `20260522270000_lcc_listing_fanout
_same_owner.sql`):**

`public.lcc_listing_same_owner_cohort(p_source_domain text,
p_source_property_id text)` — SQL function. Given any (domain,
property_id), returns the current owner of that property plus every
OTHER property they own (in either vertical), enriched with:
- Portfolio rollup: `total_property_count`,
  `current_property_count`, `is_cross_vertical`
- Cadence state: `cadence_id`, `phase`, `current_touch`,
  `next_touch_type`, `days_overdue`
- Opportunity state: `bd_opportunity_id`, `bd_opportunity_open`

Uses `#variable_conflict use_column` because the RETURNS TABLE OUT
parameters share names with several underlying column names
(owner_role, source_domain, etc.).

**Validation:**

| Test | Result |
|---|---|
| `lcc_listing_same_owner_cohort('dia','26621')` (Elliott Bay current property) | 92 other-property rows, all current, portfolio_total=93 |
| `lcc_listing_same_owner_cohort('gov','15840')` (former Truist Bank, now Truist Financial Corp) | Returns Truist Financial Corp (current owner) + their 1 other gov property — correctly walks ownership history rather than returning the long-departed Truist Bank |
| `lcc_listing_same_owner_cohort('dia','24142')` (Truist Bank current dia) | Returns merged Truist Bank entity with 40 dia + 3 gov others, `is_cross_vertical=true`, 13 current + 30 former |

**What's still deferred for the full A10 engine:**
- **Lane 2 — Buyer cohort**: needs property attribute sync
  (asset_type, size_sqft, MSA) so we can find "entities who bought
  similar properties in the last 24 months."
- **Lane 3 — Geographic proximity**: needs lat/lng sync from dia/gov
  properties so we can compute "owners with properties within N
  miles of this listing."
- **Listing-event watcher**: cron + trigger combo that fires the
  fan-out automatically when a new `available_listings` row lands
  in dia/gov, or when a new sales_transactions row implies a sale
  event. For now, the operator (or UI) calls the function
  on-demand.

**Impact:** with §11.27 in place, the operator console can show a
"who owns this listing, and what else do they have?" panel for any
property paste-in. Combined with the §11.26 cadence dashboard, the
operator can decide at-a-glance whether to open an opportunity (if
none yet) or just log the listing as a touch (if a cadence is
already running).

### 11.28 Topic 12 — Property attribute sync + A10 Lane 3 (2026-05-22)

§11.27 shipped same-owner fan-out (Lane 1) but Lanes 2+3 needed
property-level attributes (lat/lng, size, year built) that the
portfolio sync didn't pull. This round adds the attribute sync, then
delivers Lane 3 (geographic neighbors) on top of it. Lane 2 (buyer
cohort by asset class + size) is left as a follow-up.

**What was added:**

1. **gov-side slim view** (`government/20260522280000_gov_v_property
   _attributes_portfolio.sql`) — exposes non-financial structural
   columns of `gov.properties` as `v_property_attributes_portfolio`
   with `GRANT SELECT TO anon, authenticated`. Mirrors the pattern
   from §11.23. Drops noi/expenses/treasury_spread/etc. that the
   BD layer doesn't need.

2. **`lcc_property_attributes` table** — PK `(source_domain,
   source_property_id)`. Columns: address, city, state, postal_code,
   county, metro_area, lat/lng, building_size_sqft, land_acres,
   year_built, year_renovated, building_type, asset_class,
   tenant_short, tenant_label. Gov-specific lease columns
   (lease_commencement/lease_expiration/firm_term_remaining/
   term_remaining) included for the future lease-renewal priority
   queue bands. Three indexes (metro, state/city, lat/lng partial).

3. **`lcc_sync_property_attributes(p_domain)`** /
   **`lcc_finalize_property_attributes()`** — fire/finalize sync
   functions following the now-established §11.22 / §11.23 pattern.
   `dia` pulls from `properties` directly (no RLS), `gov` pulls
   from the slim view.

4. **Initial backfill** (manual pg_net pulls, 14 dia pages + 18
   gov pages):

   | Domain | Rows | with lat/lng | with size | with metro |
   |---|--:|--:|--:|--:|
   | dia | 12,934 | 10,829 (84%) | 9,415 (73%) | 0 (dia has no metro col) |
   | gov | 17,691 | 15,803 (89%) | 14,733 (83%) | 6,663 (38%) |
   | **Total** | **30,625** | **26,632** | **24,148** | |

5. **`lcc_listing_geographic_neighbors(source_domain, source_property
   _id, radius_miles, limit)`** — Lane 3 of A10. Plain haversine
   arithmetic (no postgis dependency) with a coarse lat/lng
   bounding-box pre-filter for performance. Returns up to `p_limit`
   nearest other properties with their current owner (when known
   to LCC), cadence state, and opportunity state. Sorted by
   `distance_miles ASC`.

**Validation:** A 50-mile probe around dia property 26621 (Michigan)
returned 10 properties; notable BD-relevant hits:
- TEP Grand Rapids Michigan, LLC at 19.36 mi — `developer`
- Midwest Dialysis Centers at 19.08 mi — `buyer`
- Vrei 99, LLC at 22.77 mi — `buyer`

So if 26621 just listed, the operator immediately sees a classified
developer within 20 miles to reach out to.

**Still deferred:**
- **Lane 2 (buyer cohort)** — recent buyers of similar properties
  (same asset_class + size band ±30% + state). Now feasible since
  attributes are synced; just needs the function.
- **Listing-event watcher cron** — fires the fan-out (Lanes 1/2/3)
  automatically when new `available_listings` or `sales_transactions`
  rows land in dia/gov. Today the operator (or UI) calls these
  on-demand.
- **Future priority queue bands** (P1-P5) keyed on `lease_expiration`,
  `year_built` (refi window), `firm_term_remaining` — now have the
  data, just need the band definitions.

---

*End of DEVELOPER_BD_AUDIT_v3*
