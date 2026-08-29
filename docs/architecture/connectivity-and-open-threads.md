# LCC — Connectivity Map + Open Threads

> **Chain state re-measured 2026-08-28 — see §4e, which SUPERSEDES the §4b numbers.**
> Route status below is as of 2026-07-31 unless a section says otherwise.
>
> ⚠️ **Two corrections a future chat must not miss:**
> **(1) BREAK-2's verdict is OVERTURNED — the cadence layer is NOT being retired** (see the box in
> BREAK-2). **(2) §4b's coverage percentages use ASSETS as the denominator, not PROPERTIES**, and
> the two differ by 6× — see §4e before quoting either.

The pick-up-quickly handoff for future chats. Covers where each ingestion/reconciliation route stands,
what's live vs connector-gated, and every open gap through the **email / phone / Salesforce** routes.
Cross-references the per-topic design docs in `docs/architecture/`.


---

## 0. 📇 THE TOPIC INDEX — every document on the ownership→contact chain, and what it is for

**This file is the LIVING DOCUMENT for the chain.** Current state is §4e–§4p (**§4p is the newest — the callable list + the `buyer` exclusion**); everything else on the
topic is listed here with its scope and status so no one has to guess which of ~20 files to open.
**Nothing below is deleted — an audit is evidence for a date, and dated evidence stays.**

### The three canonical pages (read these; they are maintained)

| page | owns |
|---|---|
| **this file** | the **chain end to end** — property → owner → contact → cadence, current state, and the open threads |
| [`tier0-owner-contact-system.md`](tier0-owner-contact-system.md) | **person ↔ owner** matching: the Tier 0 lane, sponsor map, owner-entity merges (P186–P198) |
| [`ownership-history-lane.md`](ownership-history-lane.md) | **ownership history/depth**: `establish_ownership_history`, the five lane actions (A1–A4b, B1) |

### ⚠️ Naming traps — two documents do NOT do what their titles suggest

| file | ⚠️ what it actually covers |
|---|---|
| `owner-reconciliation-engine.md` | **The POINT PERSON** — which Northmarq broker works the deal (`lcc_entity_owner_override.owner_user_id`). **It does NOT resolve the property owner.** `property-owner-subsystem.md` documents that exact confusion as the finding that reframed P0.2 |
| `sf-owner-capture.md` | Also **point person**, sourced from the Salesforce Task assignee — not property ownership |

**The property owner lives in `lcc_property_owner`**; the point person lives in
`lcc_entity_owner_override`. Different tables, different questions, and
`touchpoint_cadence.owner_user_id` FKs a *third* user table — resolve through
`lcc_cadence_point_person()`, never re-derive it.

### Supporting design docs — current, narrower scope

| file | scope |
|---|---|
| `property-owner-subsystem.md` | how the property owner is resolved (evidence → `lcc_reconcile_property_owner`) |
| `property-owner-source-authority-and-doctrine.md` | the source-authority ladder for owner fields |
| `account-based-contact-intelligence.md` | **who to call at a repeat buyer** — the acquisitions-vs-disposition doctrine |
| `contact-reconciliation-outbound.md` | pushing the contact record back out (Outlook/SF) |
| `contact-owner-sidebar-design.md` · `property-owner-panel-redesign-2026-08.md` · `property-tab-ux-review.md` | the UI surfaces that render all of it |
| `touchpoint_cadence_spec.md` (2026-04-13) | the original cadence design. ⚠️ **Read BREAK-2's overturn box below before treating any "no consumer" language as current** |

### Evidence trail — dated audits, newest first

**Chain/connectivity:** `C2a_ASSET_MINT_RENT_FLOOR_CURVE` · `C2_CONNECTIVITY_STALL_MAP`
(⚠️ carries a supersession banner — three of its numbers moved) · `BD_PIPELINE_FUNNEL_AUDIT` ·
`C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE` · `C2b_SALESFORCE_BRIDGE_SELF_HEALED` ·
`C2g_UNRESOLVED_OWNER_ORGS` · `C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT` ·
`C4_RANKING_LAYER_ROLE_GATE` (§4o — the last hop: why the BD queue reaches 4% of owners) ·
**`C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION` (§4p — 224 owners callable today; `buyer` is 578 / $410.4M)**.
**Person↔owner (Tier 0):** P186 · P188 · P194 · P195 · P197 → indexed inside `tier0-owner-contact-system.md`.
**Ownership history:** A1 · A2 · A3 · A4 · A4b · A5 · B1 → indexed inside `ownership-history-lane.md`.
**Older, still-valid-for-their-date:** `W3.3_owner_merge_audit` (2026-07-30) ·
`W9_1_contact_acquisition_dryrun` · `W9_2_reachability_harvest_dryrun` ·
`W9_6_comms_owner_attribution_dryrun` · `OWNERSHIP_RESEARCH_FREE_FIRST_PLAN`.

**Rule for this topic:** *a dated audit is evidence, not state.* If a number here disagrees with an
audit, **this file wins and the audit gets a supersession banner in the same change** — the way
`C2_CONNECTIVITY_STALL_MAP` now carries one.

---

## 1. Route-by-route connectivity status

### A. EMAIL route (deal correspondence + OM intake)
| Piece | Handler / code | Connector dependency | Status |
|---|---|---|---|
| OM intake — email channel | `intake.js` `handleOutlookMessage` → `stageOmIntake` | Power Automate flagged-email flow | **Live** |
| OM intake — sidebar / Copilot | `sidebar-pipeline.js`, `handleIntakeStageOm` | Chrome ext / Copilot Studio | **Live** |
| Live inbound mail → spine (dual-anchor) | `intake.js` `handleOutlookMessage` → `logInboundCorrespondenceDualAnchor` | Outlook flow forwards deal mail | **Live** |
| Live sent mail → spine | `intake.js` `handleOutlookSent` | Outlook sent flow | **Live** |
| **Deal correspondence backfill** | `deal-correspondence-backfill.js` (`/api/deal-correspondence-backfill`) | `OUTLOOK_SEARCH_WEBHOOK_URL` + `deal_thread_search` flow op | **Live** — 872 msgs across 40/40 open deals swept |
| Reconcile mail → to-dos | `lcc_reconcile_deal_todo` (called by all 3 loggers) | — | **Live** |

**Email route OPEN gaps** (see `correspondence-ingestion-design.md` §"planned v2"):
1. **v2 email-based search.** The `deal_thread_search` flow searches only the deal-name **subject**; the
   seed's `correspondent_emails` are unused. Add a from/to-in-emails branch → higher recall on threads
   that don't carry the deal name. Deals with no subject match were marked swept with 0 msgs.
2. **Multi-subject / `since` window** — flow searches only `first(subjects)`, ignores `since`.
3. **Cadence run** — the backfill was a one-time sweep; schedule the worker (`missing_only`) to catch
   new deals/stragglers.
4. **Briefing-as-last-touch hygiene** — "LCC Morning Briefing" notes are stamped on deal `entity_id` and
   can mask true correspondence staleness in My Day. Exclude system/briefing notes from deal last-touch.
5. **Multi-mailbox (blocks correspondence privacy)** — the backfill ran from a **single mailbox**, so
   per-user correspondence privacy (below) can't fully light up until each rep's mailbox feeds in.

### B. PHONE route (WebEx calls)
| Piece | Handler / code | Connector dependency | Status |
|---|---|---|---|
| WebEx OAuth token mgmt | `contacts-handler.js` (`system_tokens.webex`) | `WEBEX_CLIENT_ID/SECRET/ACCESS/REFRESH` | Built |
| Pull call history | `contacts-handler.js` → `telephony/calls/history` | WebEx API creds | Built |
| Call → activity spine (dual-anchor) | `logCallDualAnchor` (`intake-correspondence.js`), route `ingest_webex_calls` | resolves party+deal by phone | Built |
| Outbound call auto-resolves "reach out" to-do | `logCallDualAnchor` → `lcc_autoresolve_todos` | — | Built |

**Phone route OPEN gaps:**
1. **WebEx creds / live status unconfirmed** — everything returns 503 until `WEBEX_*` are set in Railway.
   **Verify whether calls are actually flowing**; if not, that's why phone touches are absent from My Day /
   deal last-touch / cadence. This is the biggest phone-route unknown.
2. **No scheduled call pull** — confirm/stand up a cron for `ingest_webex_calls` so call history ingests
   continuously (mirror the correspondence cadence).
3. **Phone-number → party resolution depth** — `lcc_resolve_contact` by phone leans on
   `external_identities` `webex` phone identities accruing; sparse today, improves as identities land.
4. **Per-user privacy** — same as email: a call's participant should scope to the rep (Phase 2).

### C. SALESFORCE routes
| Piece | Handler / code | Flow op (SF_LOOKUP_WEBHOOK_URL) | Status |
|---|---|---|---|
| SF account/contact lookup | `salesforce.js` | `find_account_by_name/by_id`, `find_contact_by_email` | Live |
| Owner (rep) signals | `sf-owner-sync.js`, `getSalesforceOwnerSignals` | `owners_by_ids` | Live |
| **Seller → property owner** | `sf-seller-owner.js` (`/api/sf-seller-owner`) | **`opportunities_by_ids`** (built this session) | **Live** — 32/40 own listings resolved |
| SF Account → org entity | `sf-account-link.js` `relatePersonToSfAccount` / `ensureEntityLink` | — | Live |
| Task reassign / activity log | `salesforce.js` | `reassign_task_owner`, activity write | Live |

**SF route doctrine + gaps:**
- **Doctrine (Scott, reinforced 2026-07-31):** SF is **one reconcilable source, not truth** — broker-entered,
  full of dups/errors. LCC merges/cleans toward the most accurate internal record and **writes back to SF
  ONLY for a direct team benefit** (email/contact correction, BD marketing-list add, ROE territory via a
  logged call) — never merely to sync. Governs any future SF-write feature.
- **Gap — no bulk SF write-back surface** by design; build only per-benefit.
- **Gap — paused enrichers:** `owner-contact-websearch` PAUSED; SOS-direct fetcher blocked from CI (datacenter
  IP 403s). Contact acquisition uses the public-records chain.

---

## 2. Owner truth (property owner vs point person) — the big architecture note
**Point person ≠ property owner.** `lcc_entity_owner_override.owner_user_id` = the **lcc_user who works the
deal** (drives My Work / Team Queue scoping via `v_my_work_scoped`). The **property owner** (which entity owns
the building) lives in the SEPARATE `lcc_property_owner`. Never feed owner entities through the point-person
engine. Full detail: `property-owner-subsystem.md` + `property-owner-source-authority-and-doctrine.md`.

- Property-owner coverage: **1,768 from the ownership graph + 32 of our own listings from SF seller.**
- Authority ladder: `manual` 8 > `deed_recorded` 6 > `rel_purchase` 4 > `sf_seller` 3.5 > `rel_owns` 3.
- **`lcc_pin_property_owner(entity, owner, note)`** = human override (Genesis KC Development pinned on 8 DaVita
  sale-leasebacks).
- **OPEN:** county/deed feeder (`deed_recorded` tier, connector-dependent) — the highest-authority
  non-human source, still unbuilt; bulk/cadence re-run of the graph feeder as new edges land; the panel wiring
  (lookup_asset → lcc_property_owner) is live.

---

## 3. Access scoping (My Work / Team Queue / correspondence privacy)
Full detail: `access-scoping-and-my-work.md`.
- **DONE:** My Work point-person scoped (v1+v2), Team Queue lead-gated (backend + frontend subtab/metric hide
  via `/api/members?action=me` `is_lead`), work_counts badge scoped. Needs a per-user smoke test.
- **OPEN — correspondence privacy (Phase 2):** participant-stamp each `activity_events` mail/call row with the
  rep(s) in from/to (→ `lcc_users.email`), then filter the deal timeline to "me" for non-leads; lead sees all.
  **Partly gated on multi-mailbox ingestion** (email route gap #5) — buildable before, but full payoff needs
  each rep's mailbox/WebEx feeding their own mail.

---

## 4. Property-tab rollout status (this is the active workstream)
Catalog + audit + phased plan: `property-tab-ux-review.md`. Reviewed on the **dialysis** property tab; the
**same design applies to government** (and future net-lease subspecialties) EXCEPT lease/operational nuances
(gov: GSA lease numbers, agency credit, FRPP/OPM data, cap-rate framework; dia: CMS/clinic, NNN net rent).
Build domain-generic where possible; branch only on the domain-specific nuances.

| Phase | Item | Status |
|---|---|---|
| P0.1 | Owner-display fallback → "Unresolved" not operator | **DONE** (detail.js) |
| P0.2/0.3 | Owner feeders (SF seller done; graph done; **deed/county OPEN**) | Partial |
| P0.4/0.5 | Lease dedup + cap recompute at source | **OPEN** |
| P0.6 | Portfolio owner audit | **DONE** (98% were unresolved; now 1,800+) |
| P1 | Second contact/owner sidebar + party-link chips + move contact fns off property | **DESIGNED** (`contact-owner-sidebar-design.md`); build phased P1.0→P1.4 |
| P2 | Property/Deal Dossier (format + local-AI gen + PDF; replace ChatGPT/Claude brief links) | **OPEN** |
| P3.1 | Overview: **pipeline-name header default** (“Fresenius – Woodland Hills, CA”) | **DONE** (title). Actions-buttons audit = OPEN |
| **P3.2** | Deal History: party rows CLICKABLE (Seller/Buyer/Listing+Procuring Broker) | **DONE** (chips). Developer/loan origin SKIPPED — 0 graph coverage; lives in OM/correspondence (P2 extraction) |
| **P3.3** | Ownership & CRM: **Current Owner card** (clickable chip + provenance + verified date) | **DONE** (owner card). Prospecting status + developer chain + move contact fns off = OPEN |
| P3.4 | Activity Log → data ingestion/reconciliation lineage only | **OPEN** |
| P3.5 | Operations summary from Seller correspondence + files + OM (dia Medicare gap) | **OPEN** |

**Domain-generality note for the rollout:** party-link chips, the contact/owner sidebar, the dossier, and the
Deal-History party/developer/loan rows are all domain-generic (entity/relationship graph + correspondence).
Gov vs dia differ only in: lease economics (gov cap-rate framework vs dia NNN net rent), operational data
(gov FRPP/OPM/agency credit vs dia CMS/clinic), and naming (GSA lease numbers). Build the shared shell once;
gate the nuance blocks by `db`/domain.

---

## 4b. Measured flow breaks — the asset → owner → contact → cadence chain (2026-08-15)

Found while proving the property/owner panel redesign end-to-end
(`panel-redesign-verification.md` §3). These are **measured, not inferred** — LCC Opps
`xengecqvemvfknjvbvrq` + the two domain DBs, read-only. Each has a drafted Claude Code prompt.

The redesigned UI expresses one chain: **asset → resolved owner → reachable contact → cadence → touch.**
Here is where the chain actually parts.

| Leg | Live | Break | Prompt |
|---|---|---|---|
| asset → resolved owner | **1,396 / 3,886 (35.9%)** | 2,490 assets have no owner; the owner feeders (own-deal buyer, county deed) never landed | **113** |
| owner → reachable contact | **104 / 690 (15.1%)** | **the binding constraint** — the new `Work this owner →` hand-off dead-ends for ~85% of owners | **111** |
| cadence → touch | **1,728 / 1,905 never touched (91%)** | producer with almost no consumer; 23 rows due in the future; 7 carry a rep | **112** |

### BREAK-1 — owner reachability (severity: HIGH, blocks the redesigned flow)
**585 of the 586 unreachable owners have NO person known at all** — not one name behind the LLC. This
reframes the problem: it is **decision-maker discovery**, not contact-detail enrichment. Two unlocks that do
**not** depend on the blocked SOS-direct fetcher:
- **80** unreachable owners already carry a **`salesforce` external identity** — SF may already hold contacts
  under those accounts that were never pulled onto the entity.
- **gov `recorded_owners.manager_name` is populated on 1,469 rows** (ORE Phase 1 Unit A, SOS registry) — a
  named decision-maker per LLC — yet the LCC owner graph shows **1** named person across all 586. Strong
  evidence of a **propagation gap between the domain DB and the entity graph**, with no new fetching needed.
  (dia is genuinely starved: 31 manager names of 7,217.)
- Owner mailing addresses remain input-starved as documented: gov 31 `mailing_address`, 137
  `registered_agent_name`; dia 551 owner addresses. Consistent with the Phase-A1 grounding — capture, not
  promotion, is the missing half.

#### BREAK-1 findings — Prompt 111 investigation + first unlock (2026-08-15)

Four leads sized against live data, then the largest one built. **Re-measure any number here with
`SELECT * FROM v_lcc_owner_reachability;`** (LCC Opps) — the loose SQL that used to live in
`panel-redesign-verification.md` §3.2 is now that view, so the definition can't drift.

**Correction to the headline, found while sizing.** The 104/690 figure counts owners reachable by *any*
graph route, including a linked person carrying email/phone. **The owner panel hero does not read that
route.** `buildContact360` sets `subject.email` from `entities.email` or a `unified_contacts` row whose
`entity_id` IS the owner — it never walks `entity_relationships` to a linked person — and
`_nextActionForContact` gates on `subject.email || entity.email || emailRel.email` / `entity.phone`. So
what the operator actually experienced was **56 / 690 (8.1%)**, not 104. The view now reports both:
`reachable_hero` (what the hero reads) and `reachable_graph` (the wider number). **Quote
`reachable_hero` when describing operator experience.** The 54-owner gap between them is a real,
separately-fixable defect: we can reach those owners and the panel says we can't.

| Lead | Sized | Verdict |
|---|---|---|
| **A** — gov `recorded_owners.manager_name` → entity graph | **22 owners** would gain a NAME; **0** gain a reachable contact | **Much smaller than the 1,469 headline implies.** Of the 481 gov properties behind unreachable owners, only **50** have a manager on the recorded owner (25 distinct owners); dia contributes **1**. The 1,469 manager names are concentrated on owners whose properties are *not* in the property-resolved set. A manager name carries no email/phone, so it cannot move reachability at all. |
| **B** — Salesforce contacts under a linked Account | **19 owners** (27 contacts) | 79 unreachable owners carry a `salesforce/Account` identity, but only 19 have a `unified_contacts` row under that account id with email/phone. Real, and needs the person+org-edge model (below). |
| **C** — contacts we already hold in dia/gov `contacts` | **74 owners** have an owner-bound contact with email/phone; **36 auto-attributable** | **The largest lead, and the one built.** |
| **D** — solvable only by the paused SOS/web-search path | **~478 owners (82% of the unreachable)** | The measured cost of `W9_1_SOS_DIRECT` being off. Not re-provisioned, not recommended — per gov `CLAUDE.md` §25 the residential proxy is already BUILT and the remaining blocker is TLS/bot-wall fingerprinting, not egress. |

**Which pipe is broken vs missing.** Neither, exactly — the existing pipe is *aimed elsewhere*.
`owner_contact_pivot` holds 5,159 rows and its whole chain is healthy (`lcc-owner-contact-signals-sync`
05:00, `-finalize` 05:05, `-pivot-refresh` 05:20, `-owner-contact-enrich` 05:25 — **all four crons
ACTIVE**). But it intersects this population on **48 of 586 owners**, because it is keyed off the domain
true_owner signal view rather than off the `lcc_property_owner` graph the panel resolves through. So the
fix was **not** to re-aim or fork the pivot; it was a sibling worker walking the panel's own graph.
`owner-contact-enrich` still drains the pivot unchanged.

> ### ⚠️ CORRECTION 2026-08-20 — "the whole chain is healthy" was FALSE, and the crons being ACTIVE is
> exactly why nobody noticed (P157 / P157a / P159 / P159a)
>
> **All four crons were active and succeeding daily while the chain wrote nothing for three weeks.**
> `lcc_owner_contact_signals` was frozen from **2026-07-28 to 2026-08-20**.
>
> * **P157 — the domain views returned nothing to anon.** Six gov and four dia
>   `v_*_portfolio` views carried `security_invoker=on`, so the CALLER's RLS applied instead of the view
>   owner's; anon has no policy on `recorded_owners` (where `manager_name` lives), so every `pg_net` page
>   came back **HTTP 200 with `[]`** — indistinguishable from "no new data". `lcc_sync_owner_contact_signals`
>   returns `pages_fired`, an honest counter that reads like throughput. Measured
>   service_role→anon: `v_ownership_history_portfolio` 12,697→0, `vw_portfolio_owners` 1,915→0,
>   `v_owner_contact_signals_portfolio` 733→0. Fixed by `security_invoker=off`; gov 697→743 rows,
>   dia 392→408, first write since July.
> * **P157a — the finalize could not survive a duplicate key.** Two pages covering the same owner in one
>   batch hit `21000 ON CONFLICT DO UPDATE cannot affect row a second time`, and the abort also skipped the
>   CTE that clears `lcc_owner_signal_sync_inflight` — so it was self-perpetuating. **Dormant only because
>   P157 meant no batch ever contained two real rows.** Fixing one bug exposed the other.
> * **P159 / P159a — the enrich tick was 2/3 dead weight.** Under `rank_value DESC` the `updated_at`
>   rotation this section's model assumes is only a TIEBREAK, so terminal rows
>   (`enrichment_action='manual_research'`, `find_person_at_manager`, or an open `owner_contact_manual`
>   task) jammed the highest-value slots forever — **17 of the top 25**, matching the live `skipped` count
>   exactly. Queue 4,472 → 757 actionable; useful work 32% → 88%; real drain 6 → 16/run. **Cron 139 is now
>   `25 * * * *` at `limit=100`, not daily at 25.**
>
> **Read row (D) below with this in mind:** SOS-direct is no longer the only unlock. **P155/P156 built a
> SAM.gov bulk path** — the per-entity API is rate-limited to ~10 lookups/day (NOT the 401 the older docs
> claim), but the PUBLIC MONTHLY extract is ONE request covering every registrant. It carries POC
> **name + title** but **no email/phone** (those are FOUO, federal-account-only), so it converts
> "unreachable LLC" into "named decision-maker at a known company" at scale — which is what
> **P158's new `NAMED LEAD — find their line` state** and `v_lcc_named_lead_worklist` exist to surface.

**Built:** `POST /api/owner-contact-propagate-tick` (GET = dry-run default) —
`api/_handlers/owner-contact-propagate.js` + the pure planner
`api/_shared/owner-contact-propagate-planner.js`, migration `20260903120000`, 27 tests in
`test/owner-contact-propagate.test.mjs`. It fill-blanks `entities.email`/`entities.phone` from an
**owner-bound, name-matched** dia/gov `contacts` row. Property-scoped contacts are deliberately never
read (a property contact may be a broker or the prior seller — attributing it to the current owner would
be a guess), and broker-role rows are excluded per the deal-spine `third_party` discipline.

**Before → after (batch `ocp_20260815`, applied live):**

| Metric | Before | After |
|---|---|---|
| `reachable_hero` (what the hero reads) | **56 / 690 (8.1%)** | **92 / 690 (13.3%)** |
| `reachable_graph` (any route) | 110 | 139 |
| owners reachable via the org record | 50 | **86** |
| pending decision-maker candidates in a review lane | 0 | **101** (89 named parties across 50 owners, 12 fan-out) |

**36 owners, not 400 — and that is the honest ceiling of this lead.** The remaining 38 of Lead C's 74
are differently-named real parties (Eric Dowling @boydwatterson.com, Delos Yancey, Lee Elman, Daniel
Brower, Marcus Monical…) that must **not** be stamped onto the owner org record — that is precisely the
conflation error `sf-account-link.js` C1/C2 guards against. They now sit in
`lcc_owner_contact_propagate_review` with verbatim evidence instead of being invisible. **That lane is
the actual decision-maker discovery backlog**, and draining it (plus Lead B's 19) needs the person+edge
model *and* the `buildContact360` fold-in above — otherwise the attach is written correctly and the hero
still says "Find a contact".

> **Doctrine caveat, stated rather than glossed:** that review lane is a **producer with no consumer
> surface yet** — 101 rows readable only by SQL/API. It is deliberately **not** registered in
> `FEDERATED_DECISION_TYPES` / `_DC_FEDERATED` / the review-counts badge, so it cannot inflate any
> existing count or train anyone to ignore a badge; and it is bounded by the population (101 rows / 50
> owners), not emitted per captured row. But it does not satisfy "named consumer" until the person+edge
> attach unit ships. **Wire the lane and the drain together, in that unit — not before.**

**Two defects the live dry-run caught** (recorded because they'd have shipped silently):
1. Reusing `dup-pair-planner.ownerCore` for identity was wrong — it strips a generic-CRE stoplist, so
   `Realty Income Corporation` reduces to `""` and **failed to match itself** (filed as `name_mismatch`).
2. Worse, `Agree Realty Corp` and `Agree Holdings LLC` both reduce to `agree` and scored **1.0** — an
   automatic write onto the wrong party. Both fixed by a strict identity core that strips *only* pure
   legal-entity forms, mirroring gov `gov_owner_strict_core` (gov `CLAUDE.md` §20); both are regression
   tests now.

**Consumption-Layer note:** this worker emits **zero** new operator-facing work — no task, badge, queue
row or cadence. It runs the doctrine in reverse, making existing work actionable: 107 still-unreachable
owners sit on a cadence we cannot act on; 6 of the 36 filled owners were already on one. It deliberately
does **not** stamp `touchpoint_cadence.contact_id`, because the reachable party here is an org
switchboard and that column means "which person do we call".

**Pre-existing drift surfaced, not fixed:** `v_field_provenance_unranked` returns **35** rows (doctrine
says 0). `entities.email`/`phone` had *no* `field_source_priority` ladder at all, so every prior writer
to them was unranked; the migration registers one (manual@1 → salesforce@20 → `domain_owner_contact`@55
→ costar_sidebar@60). The other 35 belong to other tables and predate this work.

**Reversal:** runbook in the migration header — `batch_tag='ocp_20260815'`, ledger
`lcc_owner_contact_propagate_log` carries `old_value` per field.

#### BREAK-1 — Prompt 114: the c360 fold-in + the lane's consumer (2026-08-15)

The two coupled defects Prompt 111 left open, shipped together because either alone reads as a failure:
draining the lane without the fold-in writes correct data the hero cannot see; the fold-in without the
lane fixes 47 owners and strands the rest.

**Unit 2 — `buildContact360` now walks `entity_relationships` (the pure UI defect, CLOSED).**
`subject.reachable_via` is a **separate** descriptor, deliberately not merged into `subject.email`:
`subject.email` means *"this org's own contact detail"*, and a linked person's address is a different
claim. Blurring them would tell the operator the org has an address it does not, and would re-commit the
person/org conflation `sf-account-link.js` guards against. The hero now reads **"Reach via Eric Dowling
(manager)"** instead of "Find a contact"; the companion dock reuses the same resolver, so the two
surfaces cannot disagree. Winner selection is a pure, ranked, regression-tested rule in
`api/_shared/owner-reachable-via.js` — explicit primary → role authority → email-over-phone → most
recently verified → `person_id`. **Never "first row wins":** that is the exact shape of the gov
`ensureTrueOwner` substring defect (gov `CLAUDE.md` §20), and the test asserts order-independence.
Broker-ish roles are **excluded outright**, not ranked last — surfacing a listing broker as "reach the
owner via…" would send outreach to the wrong human.

**Unit 1 + 3 — three shape-aware verdicts and a Decision Center lane.**
New federated lane `owner_contact_attach_review` (`v_lcc_owner_contact_attach_review_open`), migration
`20260904120000`, ledger `lcc_owner_contact_attach_log`, auto-retire
`lcc_owner_contact_review_autoretire()` on cron `lcc-owner-contact-review-autoretire` (05:45, after the
owner-contact signal chain). Verdicts: **attach_person** (mint/resolve the person, carry the detail onto
*them*, link via `entity_relationships`), **same_party** (fill the OWNER's own blank — the `fill_org`
write Prompt 111 refused to automate), **reject** (recorded and terminal, so a counterparty is never
re-proposed). The server re-runs the pure shape gate before writing, so a stale card or a misclick cannot
mint a REIT as a person or stamp a human's email onto an org.

> ⚠️ **GROUNDING CORRECTION — the lane was NOT 101 decision-makers.** Prompt 111's own write-up (and
> Prompt 114's brief) described these rows as candidate decision-makers. Classifying every pending row
> live says otherwise: **22 person-shaped, 77 organization-shaped, 2 blocked.** The organizations split
> into (a) **transaction counterparties** — the buyer/seller of a sale on the owner's property, captured
> by the CoStar sidebar ("NGP Capital" ← "CoreCivic, Inc.", "Boyd Watterson" ← "CIM Group, LP") — which
> are **rejects**; and (b) **same-party name variants** the strict matcher could not see through because
> the difference is an abbreviation or acronym ("Easterly Gov Properties (REIT)" ↔ "Easterly Government
> Properties, Inc.", "UIRC" ↔ "UIRC, Urban Investment Research Corporation"), which want the ORG fill.
> **A single "confirm" button would have written the wrong shape for the majority of this backlog.**

**Pre-verdict triage forecast (deterministic, no LLM), 101 rows:**

| Lean | Rows | Distinct owners | What it is |
|---|---|---|---|
| `reject` | 64 | 39 | transaction counterparties + 2 blocked (a government body, a broker row) |
| `same_party` | 11 | 8 | abbreviation / acronym variants of the owner's own name |
| `attach_person` | 8 | 8 | a named human with no competing transaction role |
| no lean (human call) | 18 | 12 | a person named on a buyer/seller role (could be either side), or an org name that is a strict subset of the other |

**Auto-retire, applied live:** 17 of the 101 already had a reachable owner and were withdrawn
(`retire_reason='owner_now_reachable'`); re-run retires 0. The lane badge counts **84 actionable rows
across 53 owners**, not 101 — honest counts.

**Before → after (Prompt 114):**

| Metric | Before | After |
|---|---|---|
| `reachable_hero` (pre-114 definition, kept as the yardstick) | 92 / 690 (13.3%) | 92 (unchanged by design) |
| **`reachable_hero_effective`** (what the hero reads now) | 92 / 690 (13.3%) | **139 / 690 (20.1%)** |
| **hero-vs-graph gap** (reachable in data, invisible in UI) | **47** | **0** |
| owner-contact review lane, actionable | 101 (no consumer) | **84** (Decision Center lane) |

**Honest ceiling, stated rather than implied.** `reachable_hero_effective` 20.1% is the arithmetic
maximum this prompt could reach, and it was reached: the 47-owner gap was a UI defect and it is now 0.
Draining the remaining 84 lane rows will add at most ~16 owners (8 `same_party` + 8 `attach_person`),
because the lane is dominated by rejects. **~478 owners (82%) remain solvable only by the paused
SOS-direct path** — untouched here and still measured-but-blocked (gov `CLAUDE.md` §25: the residential
proxy is built; the blocker is TLS/bot-wall fingerprinting, not egress).

**Deliberately NOT done:** cadence enrolment for newly-reachable owners (prompt 112 Unit A2). No verdict
seeds or stamps a cadence, so this lane cannot quietly create a pile of un-worked cadences.

**Three defects the live full-lane run caught** (all now regression tests):
1. `looksLikePersonName` accepts organization names carrying no legal suffix — **"U.S. Department of
   Veterans Affairs"** and **"Global Net Lease"** both passed as people. One confirm from minting a
   federal agency and a REIT as human beings. Fixed by requiring person shape = `looksLikePersonName`
   AND no org marker.
2. Acronyms were computed off `strictOwnerCore`, which **sorts** its tokens — so initials were read in
   the wrong order and **every** acronym pair scored nothing. "UIRC" ↔ "UIRC, Urban Investment Research
   Corporation" was silently missed.
3. Pure token coverage called **"Government Properties Trust"** ↔ **"Easterly Government Properties,
   Inc."** an abbreviation. They are two different REITs. Fixed by requiring equal token counts; a strict
   subset now leans *nothing* and is labelled undecidable rather than nudging a wrong confirm.

**Provenance (Unit 4).** No new `field_source_priority` rows were needed and none were added: both
writers are human verdicts in a review lane, which `20260903120000` already registered as
`manual_resolution` @1 for `entities.email`/`phone`. So this work **cannot** add a 36th unranked row.
The standing drift is unchanged at **35 rows across 5 tables**, all *capture-metadata* fields rather than
curated values — `dia.sales_transactions` (20: `data_source`, `notes`, `updated_at`, `property_id`,
`recorded_date`, `rent_source`, `sale_notes_raw`/`_extracted`, `listing_sale_id`,
`exclude_from_market_metrics`, `cap_rate_confidence`, `cap_rate_noi_source_table`/`_id`),
`gov.sales_transactions` (4), `gov.properties` (3: `government_type`, `noi_source`, `noi_as_of_date`),
`dia.loans` (2), `deal_provenance` (1) — sources `costar_sidebar` / `om_extraction` / `rca_sidebar` /
`ops_asset_metadata_loan` / `salesforce`. Registering those ladders belongs with whoever owns the sidebar
and OM writers; it is listed here so it stops being invisible.

**Reversal:** runbook in the `20260904120000` migration header — `batch_tag='ocpv_<YYYYMMDD>'`, ledger
`lcc_owner_contact_attach_log` carries `old_value` per filled field and the created edge id. A minted
person entity is never hard-deleted; the reversal drops the edge.

### BREAK-2 — cadence is a producer with no consumer (severity: HIGH, doctrine violation)

> ## ⚠️ VERDICT OVERTURNED BY SCOTT, 2026-08-27 — DO NOT RETIRE THE CADENCE LAYER
>
> This section concluded that cadence was a producer with no consumer. **Scott's direction:**
> *"The cadence layer is absolutely a huge part of this build… relative level of importance and
> impact that directs our next best touchpoint or call when compared to the balance of the leads or
> marketing activities we could complete."*
>
> **The layer is INTENDED and unbuilt-out, not orphaned.** The reason it reads empty is that
> **Scott has not begun using LCC for BD** — the effort to date has been the build itself. So
> "1,728 never touched" measures an un-started pipeline, not a broken one, and the Consumption-Layer
> remedy here is **to finish the consumer, not to gate the producer harder.**
>
> The genuine defects this section found still stand and are still worth fixing: the future-dated
> `last_touch_at` writer, the missing `owner_user_id` on all but 7 rows (broker assignment — backlog
> **C2c**), and cadences on parties with no contact method.
Of **1,905** `touchpoint_cadence` rows: **1,728 (91%) never touched**, **1,803** overdue < 90 days (a bulk
stamp that went stale), 68 overdue > 1 yr (oldest due **2021-09-06**), only **23** due in the future, only
**7** carrying `owner_user_id` (the documented producer gap → the ROE line on the owner card is blank).
- **94 of the unreachable owners are already on a cadence** — we are "prospecting" 94 parties we have no way
  to contact. A cadence with no contact method is un-actionable work by construction, and it is exactly what
  the Consumption-Layer doctrine says must be value-gated at the producer.
- **Data defect:** 3 rows carry `last_touch_at` **in the future** (max `2026-10-15`). A completed touch
  cannot be in the future — a writer is stamping a scheduled date into the completed-touch column.

#### BREAK-2 RESOLVED — Prompt 112 (2026-08-15)

Migration `20260815120000_lcc_p112_cadence_overdue_signal.sql` (applied live to LCC Opps) + the JS producer
gate. **Verdict on the headline question: the 1,728-row population was worth RETIRING, not consuming.**

**Root cause (Unit B) — it was NOT a bulk stamp, and NOT a missing consumer.** Creation is a steady drip
across ~90 days (largest single day 414 rows), so there was no one event to blame. The producer's value gate
had a hole: R63's `bdSignalFromFacts` accepted a bare **Salesforce IDENTITY** as a BD signal. Measured live,
that one arm carried the entire noise population:

| measure | value |
|---|---|
| prospecting cadences | 1,113 |
| …passing the gate ONLY on a bare SF identity | **930 (84%)** |
| …of those, never touched | **897** |
| prospecting cadences with an OPEN bd_opportunity | **0** |
| prospecting cadences with portfolio/connected value ≥ $500k | 105 |

Salesforce is documented as *"minimum-necessary and NOT cleaned by LCC"* — a capture surface, not a
relationship signal. "An SF contact record exists" admitted essentially the whole SF contact book into a
prospecting cadence nobody would ever work. **The five doctrine questions, answered honestly:**
1. **Named consumer?** No. The only consumer was "a human eventually opens the owner panel" — which the
   doctrine explicitly says is not a consumer. Now: the auto-retire/auto-resolve sweep pair below.
2. **Value gate?** `CADENCE_SIGNAL_MIN_VALUE` ($500k) existed but was **bypassed** on this path, because the
   bare-SF-identity arm short-circuited before value was ever consulted. Now applied.
3. **Auto-retire predicate?** None existed. Now `lcc_p112_retire_unworkable_cadences`.
4. **Actionable-only, ranked, capped surface?** No — every row rendered, all "overdue".
5. **Advances from real activity?** Yes (the SF/Outlook grow path) — this one was already right.

**⚠️ Two grounding corrections to the numbers above — do not rebuild on them.**
- **The "94 unreachable owners on a cadence" does not reproduce.** Under
  `reachable_hero_effective` — the definition CLAUDE.md says to quote — only **190 of 1,905** rows were
  unreachable, and only **17** of the 1,113 prospecting rows. Scoped the way the sentence reads (owners of
  dia/gov assets, on a cadence, unreachable) the live answer is **0**. The closest reproducible figure is
  **109** — owners on a cadence with no *organisation-level* email/phone — i.e. the pre-114 `reachable_hero`
  definition, which ignores `unified_contacts` and linked persons. Reachability was therefore a **real but
  minor** contributor (9 rows swept), not the driver.
- **Unit D's "assignment is simply not in the data" is only partly true.** 0 prospecting cadences carry an
  open opportunity (confirmed dead end), but `lcc_entity_owner_override` holds **131** point-person rows and
  **30** cadence rows resolve to one. Those were stamped.

**⚠️ FOOTGUN caught before it shipped (Unit D):** the two rep columns FK to **different user tables** —
`lcc_entity_owner_override.owner_user_id → lcc_users(lcc_user_id)` but
`touchpoint_cadence.owner_user_id → users(id)` — and **all 131** override ids are absent from `public.users`.
Stamping the override id directly would have FK-violated on every row. The bridge is **email**, resolved once
in SQL by `v_lcc_entity_point_person` / `lcc_cadence_point_person()`. Never re-derive it in JS.

**Unit C — the future `last_touch_at` (writer found and fixed at source).** All 3 rows were
`last_touch_type='meeting'` in `steady_state`. `lcc_activity_event_advance_cadence` passed
`p_logged_at := NEW.occurred_at` with no future guard, so a calendar meeting **scheduled ahead** was ingested
as a **completed** touch — and `next_touch_due` was then computed from that future date, pushing it a further
quarter out. The JS `advanceCadence` is NOT implicated (it always stamps `now()`). Live blast radius: **78**
future-dated `meeting` activity_events across 4 entities, so it recurred on every calendar sync. Fixed in
three layers: the trigger skips future-dated events (a scheduled event is not a completed touch); the advance
function clamps `p_logged_at` to `now()`; and a BEFORE trigger on `touchpoint_cadence`
(`trg_lcc_cadence_future_touch_guard`) clamps + opens a deduped `cadence_future_last_touch` health alert so no
write path can silently persist one again. *(A real `CHECK` is impossible — `now()` is not immutable, so
Postgres rejects it in a CHECK; hence the trigger form. All three layers are additive/clamping, so deploy
ordering is satisfied without waiting on the JS redeploy.)* The 3 rows were corrected from **real data**
(`last_touch_at` := the entity's most recent PAST touch; `next_touch_due` := its next SCHEDULED event), which
also made them materially more useful — one went from *"last touched Oct 15, next due Jan 14"* to
*"last touched Aug 14, next due Aug 17"*, which is the meeting actually on the calendar.

**Before / after (§3.2 SQL re-run live, 2026-08-15).** The success metric is *fewer, all actionable* — not
more rows. Nothing was deleted; `rows_total` is unchanged at 1,905 and every retire is a reversible pause.

| metric | before | after |
|---|---|---|
| rows total (nothing deleted) | 1,905 | 1,905 |
| **active surface** (`phase NOT IN (paused,unsubscribed)`) | **1,214** | **278** |
| paused (reversible) | 691 | 1,627 |
| active never-touched | ~1,034 (prospecting alone) | 103 |
| active reachable | — | **269 / 278 (96.8%)** |
| `last_touch_at` in the future | 3 | **0** |
| rows carrying a rep | 7 | **37** |

**The residual is honest work, not noise.** Of the 278 active rows: 97 of the 103 never-touched are there
because portfolio/connected value is **≥ $500k** (genuinely valuable owners never worked); 152 of the overdue
rows are relationships that were actually touched and are genuinely due; the 9 remaining unreachable rows are
kept deliberately because 6 carry worked history and 3 carry real activity — **a worked row is never swept**.
The badge now counts real work: overdue fell 1,802 → 253, and every one of those is value-gated and reachable.

**Still open (surfaced, not fixed here):** 68 active rows remain overdue by more than a year with stale
`next_touch_due` dates. They pass the value gate, so they are real targets whose due-date arithmetic never
caught up — a re-baselining question for the cadence cockpit, not a producer defect.

**Reversal / operations.** Every piece is dry-run-default, idempotent (a second retire run pauses 0), and
reversible; runbooks are in the migration header.
- Un-pause the sweep: `metadata->>'paused_by' = 'lcc_p112_retire_unworkable_cadences'`.
- Un-stamp the rep: `metadata->>'rep_source' = 'entity_owner_override'`.
- Un-correct Unit C: `_lcc_p112_future_touch_backup_20260815`.
- **Auto-resolve:** `lcc_p112_resume_workable_cadences(false)` returns a paused row the moment it earns a
  signal or becomes reachable, with `next_touch_due = now()` so it surfaces as actionable rather than
  instantly "overdue". **Not yet on a cron** — schedule it alongside the other daily sweeps.

### BREAK-3 — owner resolution coverage (severity: MEDIUM, **35.9% → 49.2%**, Prompt 113)

> ⚠️ **DENOMINATOR WARNING — this percentage is *of ASSETS*, not of PROPERTIES.** It reads
> 1,910 of **3,886 assets**. Measured against all **32,289 properties** (gov 20,493 + dia 11,796)
> the same coverage is **13%**, because only **5,144 properties have an LCC asset entity at all**.
> Both numbers are correct about different populations. **§4e is the property-denominator view.**

**1,396 → 1,910 of 3,886 assets (35.9% → 49.2%)**; owner entities **690 → 1,118**. Batch tag
`p113_dom_owner_20260815`, reversible. Against the 2026-07-31 audit baseline (102 of 4,837 ≈ 2%) the
reconciliation engine is clearly working; what was missing was a feeder, and the brief's hunch was right —
**"the likely gap is promotion, not capture."** No external data was acquired.

**What shipped — P0.3, by ID, not by name.** The domain DBs already held the owner
(`dia|gov properties.true_owner_id`), and LCC already mirrored the property; the missing link was the owner's
IDENTITY. `v_property_owner_facts_portfolio` on both domains now exposes
`recorded_owner_id / true_owner_id / true_owner_effective_id (one merge hop) / true_owner_is_operator`,
`lcc_property_owner_facts` mirrors them, and `lcc_ingest_domain_owner_evidence(dry_run default true)` resolves
the candidate through `external_identities(source_system, 'true_owner', <id>)` and writes
`lcc_property_owner_evidence` at source `domain_true_owner`, weight **5.0** — above `rel_purchase` (4.0, ONE
historical transaction) and below `manual` (8.0). Name matching is absent from the path by design (the
`Realty Income Corporation` → `""` footgun in CLAUDE.md).

**The operator trap was bigger than the win, and it held.** dia files the OPERATOR in the owner slot at scale
(7,926 of 11,783 dia properties). Of the candidates, **815 assets were operator-blocked** — DaVita Inc. (348),
Fresenius Medical Care (334), DaVita Kidney Care (67) — versus 809 eligible. The guard reads the SAME flag the
P0.1 display guard reads (`dia.true_owners.is_operator_not_owner`), not a second name-based definition.

| candidate status | assets |
|---|---|
| eligible → evidence written | **809** (→ **514 resolved**, 295 evidence-only) |
| operator_blocked (would have stamped the tenant) | 815 |
| no_owner_entity (domain owner has no LCC entity) | 48 |
| name_blocked (placeholder / federal tenant / brokerage) | 20 |
| ambiguous → `lcc_domain_owner_ambiguous` | 2 |

**Reachability did NOT move with it, as predicted.** `reachable_hero_effective` **139 → 228** owners, but as a
share of owners **20.1% → 20.4%** — essentially flat. Resolving an owner does not make them reachable; that
is Prompt 111/114's leg. The reachable-but-invisible residue (`reachable_graph − reachable_hero_effective`)
stays **0**. (Note: the `hero_gap` COLUMN on `v_lcc_owner_reachability` computes
`reachable_hero_effective − reachable_hero`, i.e. the Prompt-114 before/after delta — now 128, and it grows
as owners are added. It is not a defect count; don't read it as one.)

**P0.2 (own-deal buyer) was measured and SKIPPED — data-thin, below the brief's own 50-asset floor.** Only
**70** assets carry a closed-won `bd_opportunity` at all, **40** of those were unresolved, and just **17** had
a buyer party edge. After P0.3 the residue is **34 unresolved / 15 with a buyer edge**.

**The canonical test case does not resolve, and the reason is worth recording.** Fresenius – Woodland Hills
(dia property 35724, entity `d118b3a1…`) is a **four-link break**, none of which is a missing owner feeder:
1. its domain `true_owner` is **"Fresenius Medical Care"**, flagged operator → P0.3 correctly refuses it;
2. dia `sales_transactions` sale 14832 ($15.73M, 2026-07-24) has **`buyer_name` NULL**;
3. the closed-won SF deal *does* exist (`Fresenius - Woodland Hills - CA`, opp `006Vs00000MvNT3IAN`) but is
   anchored to a **DUPLICATE asset entity** (`Fresenius Woodland Hills`, `a0feab2e…`) — not the
   domain-linked one;
4. that deal entity carries **zero** `entity_relationships` — no buyer party to read.

So **P0.2 as specified could not have fixed it either**; the buyer lives only in the 11 linked
`property_documents` (om/dd/lease). The real blockers are an **asset-entity merge** (SF-name-derived duplicate
vs domain-linked asset) and **deal-party edges from the deal spine**, then document extraction. Recorded here
rather than guessed at.

**Known, sized, NOT built: the resolver scores an ownership CHAIN as competing claims.** 876 unresolved assets
already had evidence and failed the 0.55 gate — `lcc_reconcile_property_owner` sums weights with a decay
floored at 0.25, so a building sold three times yields three near-equal candidates (confidence 0.33–0.50). A
strict-latest-purchase supersession tier would resolve **465** of them (439 strictly-latest + 26
single-candidate) and correctly abstain on the 360 that tie. That is a change to the shared CONSUMER, not a
feeder, so it is sized and reported rather than bundled into a feeder migration. **This is the next-highest
lever on BREAK-3.**

**Re-measure:** the SQL for every number above is in `panel-redesign-verification.md` §3.2; the feeder's own
dry-run surface is `SELECT status, count(DISTINCT entity_id) FROM v_lcc_domain_owner_candidates GROUP BY 1`.

## 4c. BREAK-3 follow-on — the SUPERSESSION tier (2026-08-15, SHIPPED)

Prompt 113 sized this and left it ("it changes the shared consumer"). Re-grounded and built.
Migration `supabase/migrations/20260907120000_lcc_owner_supersession_tier.sql`, applied live, batch
`supersede_20260815`.

**The defect.** `lcc_reconcile_property_owner` sets `confidence = top_score / SUM(all scores)` — the
winner's **share of the vote** — and floors recency decay at 0.25, so a 20-year-old transaction never stops
voting. Ownership is a **chain with a most-recent link**, not an election.

Measured live: **741** assets had evidence and no resolved owner; **all 741 were multi-candidate and NOT ONE
passed the 0.55 gate** (avg top share 0.407). Adding evidence cannot fix this class — more evidence makes
the share *worse*. The clincher: **295** of the 741 already carried a `domain_true_owner` row (the curated
current owner-of-record, the top non-manual authority) and still lost to a pile of historical purchases.

**The rule.** Authority first, then recency inside the winning tier:
`manual > domain_true_owner > rel_purchase > sf_seller > rel_owns`. Ties on the winning date **abstain**.
*Checked, not assumed:* `rel_purchase.observed_at` is a real transaction date (first-of-month clustering,
CoStar granularity) while `rel_owns.observed_at` is a **sync timestamp** — so ranking a recent `rel_owns`
above a dated deed would be a recency illusion.

**Two guards the live dry-run forced (the design changed because of the data):**
1. **Brokerages were about to be written as owners** — `Matthews™`, `Colliers`,
   `Coldwell Banker Commercial®`, `PeerRealty`: the broker on the transaction modelled as the purchaser.
   `entity_type` said `organization` for every one, so the shape guard could not catch it. Added a
   brokerage-name guard on all tiers, plus an org-marker requirement on the purchase tier only —
   a personal name is suspicious on a purchase edge but **legitimate** as a curated owner-of-record
   (a clinic can be owned by "Surinder Mann" or a family living trust).
2. **An operator leaked** — "Satellite Dialysis". Root cause was a **flag-coverage gap at source**, not a
   naming problem: "Satellite Healthcare" (56 properties) was already flagged `is_operator_not_owner`, its
   sibling rows for the same operator were NULL. Per CLAUDE.md ("use the existing flag; never write a second
   name-based operator test") it was fixed **in dia** and propagated into `lcc_owner_operator_block` **by
   ID** via `external_identities`. After both guards: **0** operator-ish and **0** brokerage names remain.

**Result (live, verified):**

| | Before | After |
|---|---|---|
| assets with a resolved owner | 1,910 (49.2%) | **2,294 (59.0%)** |
| owner entities | 1,118 | **1,420** |
| `reachable_hero_effective` | 228 | **262** |

418 written (293 domain_true_owner · 124 latest purchase · 1 other); ledger reconciles exactly; **re-run
resolves 0** (idempotent); reversible by batch tag.

**Left to a human, by design — `v_lcc_owner_supersession_review` (323 assets):** 236 ties on the winning
date · 59 person-shaped winners · 18 brokerages · 10 purchase-tier names with no org marker. Deliberately a
**VIEW, not a table** — Prompt 114's lesson was that a review table with no consumer is an un-consumed
producer; a view recomputes from live evidence, drains itself as upstream data improves, and can never go
stale.

**New hygiene item found:** the asset count rose 384 while 418 rows were written. The other **34 target
entities are `entity_type='asset'` with a NULL `domain`**, so `v_lcc_owner_reachability` (which filters
`domain in ('dia','gov')`) does not count them. Assets should always carry a domain — worth a cleanup pass.

**Still true, and unchanged by this:** resolving an owner does not make them reachable. `reachable_hero_effective`
moved 228 → 262 in absolute terms while the *share* stayed ~20%, because every newly-resolved asset adds
owners to the denominator. **~478 owners remain solvable only via the paused SOS-direct path.**

## 4d. BREAK-2 follow-on — A2 enrolment + the sweeps nobody scheduled (2026-08-15, SHIPPED)

Migration `20260908120000_lcc_p112_a2_enrol_and_schedule.sql`, applied live, batch `a2_enrol_20260815`.

**The bigger gap found on the way in: none of the P112 sweeps were scheduled.** Prompt 112's write-up
flagged only `resume` as needing a cron; in fact **no cron referenced any P112 function** — retire, resume
and stamp were built, verified, and never ran again. The consumption loop the prompt existed to close had
not actually closed. Now scheduled 06:20–06:35 daily in dependency order: **retire → resume → enrol →
stamp** (jobids 226–229). All four dry-ran to **0** first, so the schedule is maintenance, not a pending
bulk change.

**A2 honest sizing — the raw count overstated this a fourth time.** 1,420 owners → 110 reachable → 99 with
no active cadence (*the number previously quoted*) → **44 pass the same gate the retire sweep uses**, via the
**canonical `lcc_entity_cadence_reachable()`** predicate rather than an ad-hoc query — which is exactly why
the hand-rolled number kept disagreeing. **41 enrolled** (1 brokerage excluded). The other ~58 fail the
value gate and are **correctly excluded, not a gap**; enrolling them would re-create the noise 112 cleared.

| | Before | After |
|---|---|---|
| cadence rows total | 1,905 | 1,946 |
| active surface | 278 | **319** |
| `last_touch_at` in the future | 0 | 0 |

Re-run enrols **0** (idempotent). First cut wasn't: it selected owners with no *active* cadence, so three
owners holding a *paused* row stayed eligible forever while the insert silently no-opped on the unique
index — a dry-run reporting "would_enrol 3" in perpetuity is a dishonest count. Enrolment now requires **no
cadence row at all**; a paused row is resume's job.

### ⚠️ NEW DATA-QUALITY UNIT — brokerages recorded as property owners (46 rows, NOT fixed)

The first A2 dry-run put **Marcus & Millichap** ($4.99M connected value) at the top of the enrolment list —
we were one step from cold-prospecting a competitor's brokerage as if it were a landlord. Sizing it:

| source | owner rows | brokerage-as-owner |
|---|---|---|
| `relationship_graph` | 1,763 | **42** |
| `domain_true_owner` | 401 | **4** |
| `supersession` | 418 | **0** ← the 20260907 guard held |

**Two distinct classes needing different fixes:**
- **(a) ~35 suffix-polluted names** — `1121 California Avenue LLC by Capital Pacific`,
  `DP Brighton LLC by Marcus & Millichap`, `Michvet LLC by Northmarq`. **The owner is correct; the name
  carries a CoStar "by &lt;broker&gt;" suffix.** This is the `_BROKER_SUFFIX_RE_R5` defect `detail.js`
  already strips *defensively on render* — the underlying data was never cleaned, so the pollution rides
  into exports, comps, matching and dedupe. Fix at source.
- **(b) ~11 pure brokerages as owner** — `Marcus & Millichap`, `Capital Pacific`, `Stan Johnson Co`,
  `Lee & Associates`, `Trammell Crow Co (CBRE)`, `NAI Pfefferle`, `Svn®`. **The owner is wrong.**

Not fixed here — they need different treatments and their own dry-run. `lcc_owner_name_is_brokerage()`
(built for the supersession tier) is the ready-made detector. **Next data unit.**

### Classified + dry-run 2026-08-16 → **prompt 116**, and the design changed

Exact split: **(a) 27 suffix-polluted** (27 distinct owner entities) · **(b) 19 rows / 7 distinct pure
brokerages** — `Marcus & Millichap`, `Capital Pacific`, `Stan Johnson Co`, `Lee & Associates`,
`NAI Pfefferle`, `Svn®`, `Trammell Crow Co (CBRE)`.

**⚠️ The obvious fix is wrong.** Stripping the ` by <broker>` suffix produced 27 clean, plausible names —
but **17 of the 27 collide with an entity that already exists under the clean name** (`DP Brighton LLC`,
`Michael Moore`, `MassMutual Asset Finance LLC; SMBC…`; `Mielkemark LLC` has **two**).

So this is a **duplicate-entity problem, not a naming problem**: the CoStar capture minted
`"X LLC by Broker"` as a *separate entity* from the existing `"X LLC"`. Renaming in place would create two
identically-named entities — hiding the duplication rather than fixing it, and leaving the property pointed
at the duplicate with its own split portfolio, cadence and contact history.

The corrected design (prompt 116): **re-point** the owner to the existing clean entity and file the polluted
one through the *existing* `lcc_merge_entity` machinery; abstain on the ambiguous 2-candidate case; strip in
place only where no clean twin exists; remove the class-(b) owners into a reversible ledger + review view;
and — the durable part — **add the brokerage guard to the `relationship_graph` feeder, which produced 42 of
the 46** and will otherwise re-create them. The supersession feeder already has that guard and produced **0**.

### SHIPPED 2026-08-17 — migration `20260817120000_lcc_p116_brokerage_as_owner.sql`, batch `p116_20260817`

**Brokerage-as-owner rows 46 → 5**, and the 5 are exactly the deliberate abstains.

| source | before | after |
|---|---|---|
| `relationship_graph` | 42 | **5** |
| `domain_true_owner` | 4 | **0** |
| `supersession` | 0 | **0** ← held throughout |

**⚠️ Two of the numbers quoted above (from the single 2026-08-16 dry-run) were wrong, and the correction
matters.** Re-measured on a **strict identity core**:

- **21 of 27 collide, not 17** — and **4 are ambiguous, not 1**: `BGC-Havasu Project LLC`,
  `Century Park Partners Inc`, `Mielkemark LLC`, `MLC Ranch, LLC` each have **two** clean twins.
- The 2026-08-16 dry-run scored identity with **`lcc_normalize_entity_name`**, which strips *semantic*
  tokens (`partners`, `properties`, `capital`, `group`, `holdings`) — the CLAUDE.md stoplist footgun.
  Under it **"Century Park Partners" and "Century Park Properties LLC" both collapse to `century park`**,
  so the plan would have re-pointed a property onto **a different company**. Fixed by adding
  **`lcc_owner_strict_core()`**, the SQL mirror of the regression-tested JS `strictOwnerCore` /
  `gov_owner_strict_core`: strip only pure legal-entity forms, keep every semantic token.
- A third abstain the dry-run never surfaced: **`Michael Moore by Matthews™` is a `person` whose clean
  twin is an `organization`** — merging those is the person/org conflation `sf-account-link.js` guards
  against.

Final class (a) disposition (27): **16 repoint · 6 strip in place · 4 review_ambiguous · 1 review_type_shape**.

**Why re-pointing alone was not enough (two mechanisms worth remembering):**
1. **The rename is what makes the duplicate visible.** `v_lcc_merge_candidates` groups on
   `lcc_normalize_entity_name` with `count(*) >= 2`; `"DP Brighton LLC by Marcus & Millichap"` normalizes
   to `dp brighton by marcus millichap`, which **never groups with `dp brighton`** — precisely why the
   duplication had been invisible. Renaming the loser to the clean name surfaces the pair to the existing
   lane. **15 of the 16 now appear in `v_lcc_merge_candidates`** (4 already `auto_mergeable`); the 16th is
   the person, carried by a `person_duplicate_unmerged` lane because that view is organization-only.
2. **The evidence had to move too.** Without re-pointing `lcc_property_owner_evidence.candidate_owner_entity`,
   the next `lcc_reconcile_property_owner` pass re-elects the duplicate and silently undoes the correction.

**Unit 4 (the durable fix)** adds `and not lcc_owner_name_is_brokerage(ce.name)` to
`lcc_reconcile_property_owner` — the *same predicate* `lcc_supersede_property_owner` already carries.
Because `lcc_property_owner.source` is derived from the evidence this function scores, **one guard covers
both `relationship_graph` and `domain_true_owner`**. Verified by re-running the live feeder over all 41
touched assets: 22 kept the corrected owner, 19 returned `no_evidence`, and the brokerage count **stayed 5**.

Consumer: **`v_lcc_p116_brokerage_owner_review`** (70 rows) — `guard_blocked_candidate` 45 ·
`class_b_owner_removed` 19 · `review_ambiguous` 4 · `review_type_shape` 1 · `person_duplicate_unmerged` 1.
The `guard_blocked_candidate` lane exists so a **false positive** on the brokerage regex (it matches bare
`\mmarcus\M`, so a genuine "Marcus Family Trust" would trip it) surfaces rather than failing silently;
measured today it blocks **exactly** the known brokerages and nothing else. All three units re-run to
**0/0/0** (idempotent) and are reversible by `batch_tag` via `lcc_p116_brokerage_owner_log`.

## 5. Doc trail (all linked from CLAUDE.md "Pointers to canonical docs")
- `property-owner-subsystem.md` + `property-owner-source-authority-and-doctrine.md`
- `access-scoping-and-my-work.md`
- `correspondence-ingestion-design.md`
- `property-tab-ux-review.md`
- **this file** (`connectivity-and-open-threads.md`) — the route-level status index.


---

## 4e. Chain re-measured 2026-08-28 (C2) — the gate is ASSET IDENTITY

**Supersedes §4b's counts.** Full evidence: [`docs/audits/C2_CONNECTIVITY_STALL_MAP_2026-08-28.md`](../audits/C2_CONNECTIVITY_STALL_MAP_2026-08-28.md).

| hop | count | of prior |
|---|---:|---:|
| properties — **LIVE** (gov 13,837 non-archived + dia 11,796) | **25,633** | — |
| ~~properties incl. 6,657 ARCHIVED gov shells~~ | ~~32,289~~ | ⚠️ C2a correction — see below |
| dia `true_owner` rows that are OPERATORS (P113 trap) | 7,941 of 10,293 | — |
| **LCC asset anchors** | **5,096** | **19.9% of LIVE properties** ⚠️ **THE GATE** |
| resolved property→owner rows | **4,065** | 13% |
| distinct owner entities | 2,768 | |
| **owners with an active contact** | **1,439** | **52% of resolved owners** — healthy |
| cadences | 2,302 | |

**A property with no asset entity cannot carry owner evidence at all**, so every hop below is
starved by the first. The owner→contact conversion is *not* the problem.

**⚠️ The Salesforce book is connected to the wrong side.** 9,793 SF-linked people, 9,491 with an
email, **9,129 (93%) carrying a relationship edge — but only 669 (6.8%) reach a resolved property
owner.** They attach to their employer org via the `works_at` Salesforce-account edge (the bare-SF
signal P112 disqualified and P161 gated out of reachability). **The bridge has no far bank.**

**The 16% is a value-gated DECISION, not a defect** — `lcc_mint_gov_asset_entities` refuses to run
without `--min-rent`. ⚠️ **Do not drop the floor without the measurement**: minting ~27,000
evidence-less assets re-creates the noise the gate prevents. Backlog **C2a** is that measurement
(resolve-rate by rent band); **C2b** is the SF bridge; **C2c** is what C2 did *not* measure
(dia ownership depth, the developer/investor/buyer split, Outlook/WebEx per contact — **WebEx is not
in the schema at all** — and broker assignment).

### 4e-i. C2a measured the floor curve (2026-08-28) — the rate holds, the OWNERS do not

Full evidence: [`docs/audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md`](../audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md).
**Measurement only — nothing minted, no floor changed.**

⚠️ **Denominator correction to §4e above: the gate is 20%, not 16%.** `32,289 properties` includes
**6,657 ARCHIVED gov shells** that both gov portfolio views filter out by design (and that are
genuinely empty — 2 carry a `true_owner_id`). Non-archived: gov **3,422 / 13,837 = 24.7%**,
dia **1,674 / 11,796 = 14.2%**, fleet **5,096 / 25,633 = 19.9%**.

**gov: the technical resolve rate does NOT degrade** — 68.5% / 69.0% / 75.9% / 69.0% / 58.5% / 48.9%
across ≥$500k → unknown. That flatness was treated as an instrument fault until controlled three
ways: a **mutation control** (same query, identity join on `recorded_owner_id`) returns **0 in every
band across 6,688 rows**; dia's identical query shape **does** degrade (18.5% → 1.6%); and the
rejecting arms fire. The rate is real.

**What collapses is the owner.** Net-new owners already carrying an active contact:
**18.3% / 21.8% / 15.6% / 6.8% / 1.6% / 3.2%**. Known beyond the gov feed: 9.7% → 1.3%. And the
named rows turn over completely — the top band is LCOR, Centerpoint, Durst, USAA Real Estate; the
bottom band is **CITY OF SALEM, COUNTY OF DAWSON, Transportation Hawaii Department Of, FedEx, Bank
of Colorado** and private individuals. ⚠️ **The "small per property, big per owner" defence was
tested and refuted**: of the 1,549 owners unlocked at $100–250k, **19** reach $500k of gov rent
across their whole portfolio.

👤 **Recommended to Scott: $250k now (+1,282 properties, +884 resolving, +701 owners, 153 already
contactable), re-measure, $100k as the hard floor, never below.** And ⚠️ **mint the ELIGIBLE SET,
not the band** — `lcc_mint_gov_asset_entities` takes its own row list, so a $250k run can be 2,102
properties that all carry evidence on the same pass instead of 3,061 of which 959 match the retire
predicate on day one.

**dia: the floor is the wrong knob and no floor helps.** 6,780 of its 10,122 no-asset properties
(**84% of those carrying an owner**) point at an `is_operator_not_owner` row (P113); only **188 of
11,796** dia properties are priced ≥$500k at all; and dia prices only 35% of its properties, so
**75% of dia's would-resolve population sits in `rent unknown`** — a coverage gap wearing a value
judgement (A5c). dia's lever is the operator flag and rent coverage, not a rent floor.

⚠️ **Two instrument facts worth carrying forward:** `lcc_property_owner_facts` reproduces gov's own
rent histogram **exactly** but **over-reports dia by 5,519 rows** (twin-merged properties; the apply
page upserts and never deletes) — a mirror validated on one domain is not validated on the other.
And the largest gov residue is not a guard: **3,363 properties (54% of non-resolvers) simply have no
`true_owner_id` in the gov database**, which no floor touches.


---

## 4f. C2a — the rent-floor curve, and Scott's decision (2026-08-28)

Evidence: [`docs/audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md`](../audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md).
**Nothing was minted; no floor was changed.**

### ⚠️ It corrected §4e's own denominator

**32,289 / 16% included 6,657 ARCHIVED gov shells**, which every feeder filters out by design (and
which are genuinely empty — 2 of 6,657 have a `true_owner_id`). Live: gov **13,837** + dia 11,796 =
**25,633**, anchors **5,096**, coverage **19.9%**. The conclusion is unchanged; the number quoted
for it is not. *(The 5,144 headline also counted 49 identities pointing at deleted properties.)*

### The finding: the resolve rate holds; the OWNERS degrade

gov technical resolution stays **58–76%** from $500k down to under $50k — so "does it still
resolve" is the wrong question. What collapses is owner quality: **already-contactable owners fall
21.8% → 6.8% → 1.6%**, owners known outside the gov feed fall 9.7% → 1.3%, and the named rows stop
being landlords and become **cities, counties, state DOTs, FedEx and private individuals**.

| floor (cumulative, gov) | minted | resolve | rate | net-new owners | already contactable |
|---|---:|---:|---:|---:|---:|
| ≥ $500k *(today)* | 1,779 | 1,218 | 68.5% | 928 | 170 |
| **≥ $250k** | 3,061 | 2,102 | 68.7% | **1,629** | **323** |
| ≥ $100k | 5,606 | 4,034 | 71.9% | 3,178 | 564 |
| below $100k | — | — | — | — | **collapses** |

**Recommendation (Scott's call): $250k now → re-measure → $100k as the hard floor, never below.**
⚠️ **Mint the ELIGIBLE SET, not the band** — `lcc_mint_gov_asset_entities` takes its own row list,
so a $250k run should mint the **2,102 that resolve on the same pass**, not 3,061 of which 959 sit
evidence-less and match the retire predicate on day one.

**⚠️ dia is a different problem and no floor fixes it** — **84% of its un-minted owner slots hold an
OPERATOR** (the P113 trap) and 73% of its would-resolve population has no rent on file. Its levers
are `is_operator_not_owner` and rent coverage (A5e). **Change nothing on dia.**

---

## 4g. ⚠️⚠️ THE "$500k FLOOR" IS FIVE INDEPENDENT KNOBS, AND TWO THREADS ARE MOVING DIFFERENT ONES

`CLAUDE.md` (P161) says these are *"the same $500k knob as the gov asset-mint and
`CADENCE_SIGNAL_MIN_VALUE` — one number, not three."* **Measured 2026-08-28, that is FALSE as
implemented.** They are separate objects that happen to share a value:

| # | knob | where | who wants to change it |
|---|---|---|---|
| 1 | `lcc_mint_gov_asset_entities --min-rent` | CLI arg, gov asset mint | **C2a → $250k** (this thread) |
| 2 | `gov_research_gate_value_floor()` / dia twin | gov + dia DBs (A5c) | **B1 → split by consumer** (other thread) |
| 3 | `lcc_weak_role_value_floor()` | LCC Opps (P161 reachability) | — |
| 4 | `lcc_chain_human_value_floor()` | LCC Opps (ownership chain) | — |
| 5 | `CADENCE_SIGNAL_MIN_VALUE` | env (P112 cadence gate) | — |

**Two Cowork threads are proposing to change #1 and #2 in the same week, and the docs say they are
one number.** They are not. Changing one does **not** move the others, and nobody should assume it
did. **Before touching any "$500k floor", say WHICH of the five you mean.** Fixing the CLAUDE.md
sentence is backlog **C2d**.


---

## 4h. ⚠️ SCOTT'S FLOOR DECISION (2026-08-28) — the gate is on RENT, and it was mis-framed

**Scott: *"Is that gate a minimum on value or gross rents? My inclination is to have no minimum
floor… Sometimes that could be someone that owns 20-30 properties with rents below $250k. Bigger
deals doesn't always mean better… Our sweet spot tends to be single-tenant deals from $2M to $20M,
through volume with repeat seller clients."***

### The two facts that reframe it

1. **The gate is GROSS ANNUAL RENT, not deal value.** At a ~7% cap, the $2M–$20M sweet spot is
   **$140k–$1.4M of rent**. **The $500k rent floor ≈ $7.1M of value — it excludes roughly the bottom
   two-thirds of the stated sweet spot.** A floor calibrated for *"is this worth an entity"* was
   never calibrated for *"is this our kind of deal."*
2. **There is no `--min-rent` inside the mint.** `lcc_mint_gov_asset_entities(p_rows jsonb, p_batch
   text, p_dry_run boolean)` takes a **row list**; the floor is a caller-side convention in the
   feeder script, not a database constraint. It is far easier to change than "a floor in the mint"
   suggests — and the row-list shape is what makes eligible-set minting possible.

### ⚠️ The portfolio-owner argument was MEASURED and does not hold in gov

Aggregating rent to the owner instead of the property adds very little (gov, non-archived, owners
with a `true_owner_id`):

| | owners |
|---|---:|
| total | 7,196 |
| reached by the $500k **per-property** floor | 1,729 |
| reached by a $250k per-property floor | 2,959 |
| **missed by $500k but PORTFOLIO clears $500k** | **129** |
| missed by $250k but portfolio clears $250k | 93 |
| owners with **20+ properties** | 16 |
| …with **all** properties under $250k | **0** |

**The owner described — 20–30 properties all under $250k — does not exist in the gov data.** The
per-owner view is worth 93–129 owners, not thousands. *That mechanism is not the argument; the
rent-vs-value mis-calibration is.*

### The resolution: the floor decides what to MINT, not who to PURSUE

Resolving ownership broadly is cheap and reversible. Deciding who to call is `v_priority_queue`'s
job and it already ranks on owner-level value, contactability and signal. **Mint broadly, rank
narrowly.**

**DECISION — no rent floor, but eligible-set only.** Mint every gov property whose owner **resolves
on the same pass** (~6,811 of 10,415), and skip the ~3,600 that would resolve nothing and match the
documented retire predicate on day one. This is *"no minimum on value"* in the sense Scott means,
while still honouring *"evidence justifies the entity, never the reverse."*

⚠️ **The one real cost, and C2a could not measure it** (there was nothing minted to measure on):
~6,811 new asset entities is **+11% on a 62,368-entity graph**, landing on
`v_lcc_merge_candidates`, search and every count surface. **Measure it on the first tranche before
running the second** — that is the gate's actual purpose, and it has never been quantified.
> **↳ MEASURED 2026-08-28 in §4i, and the sentence above is now WRONG on its main claim.** Minted
> assets **cannot land on `v_lcc_merge_candidates` at all** — that view filters
> `entity_type = 'organization'`. Across a 2,000-entity mint the merge surfaces did not move by a
> single row. Left in place as the hypothesis that was tested; read §4i for the result.

⚠️ **dia is unaffected and must not be swept in.** No floor helps it: **84% of its un-minted owner
slots hold an OPERATOR** (P113) and 73% of the would-resolve population has no rent on file.

---

## 4i. C2e — tranche one MINTED; the noise cost measured, and mostly not real (2026-08-28)

Evidence: [`docs/audits/C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md`](../audits/C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md).
**Tranche one is APPLIED to production (gov only, dia untouched). Tranche two is NOT run — §4i.4
hands the call back to Scott.**

### What shipped

`v_lcc_c2e_asset_mint_plan` (migration `20260828140000`) is the eligible set: gov properties with no
asset entity whose owner resolves **ID-to-ID** on the same pass — the candidate view's own CASE arm
for arm, plus C2a's sixth (brokerage-at-reconcile) guard. **6,811 eligible of a 10,415 no-asset
slice**, reproducing C2a exactly. Owners taken **whole**, richest gov portfolio first, cut at
`cum_props <= 2000` → **`owner_rank <= 1145` = 2,000 properties / 1,145 owners**, batch
`c2e_gov_eligible_t1_20260828`.

| | before | after |
|---|---:|---:|
| live entities | 62,356 | 64,356 (+3.21%) |
| **`lcc_property_owner` rows** | **4,065** | **6,065** |
| **distinct owner entities** | **2,768** | **3,743** (+975) |
| minted entities / identities / **orphans** | — | 2,000 / 2,000 / **0** |
| **minted entities left evidence-less** | — | **0** |
| gov asset coverage (of 13,837 non-archived) | 24.7% | **39.2%** |

**Every one of the 2,000 carries evidence and a resolved owner.** ⚠️ That required driving
`lcc_ingest_domain_owner_evidence` explicitly: **cron 225 is capped at 400/run**, so on the schedule
alone 2,000 entities would have sat matching the retire predicate for ~5 days.

### ⚠️ The floor's stated purpose was largely not real

`v_lcc_merge_candidates` and `v_lcc_merge_candidates_normalizer_blind` filter
`entity_type = 'organization'`. Minted assets are `entity_type = 'asset'` — **structurally
incapable** of entering either. Measured across 2,000 mints: merge candidates **5,250 → 5,250**,
**`auto_mergeable` 3,038 → 3,038**, normalizer-blind **64 → 64**, canonical drift **0 → 0**
(detector positive-controlled at 64,356). The entire observable cost was **`v_duplicate_candidates`
+20** (predicted +20 before writing) and **+23 Tier 0 cards**.

**Tier 0 moved although the brief said it must not — and it is the pipeline working.** `ask` +9
matches *exactly* the 9 cards on owners whose only resolved property came from this batch; resolving
an owner is what makes "who do we call there" askable. **`auto` — the only band that can trigger an
unattended write — did not grow (9 → 9), and zero `auto` cards landed on any owner C2e made
resolvable.**

Incidentally this closes **N15d's open item**: the N15c `canonical_name` trigger had never been
exercised by a real producer. 2,000 entities through a live write path, **all on-key, drift still 0**.

### ⚠️ Tranche one tested the SAFEST population — do not extrapolate linearly

The rank-1145 cut lands at **$543,782 of owner gov rent**, so tranche one sits *entirely above the
old $500k floor* and exercised none of the low-rent tail the no-floor decision is about.

| | tranche one (1,145 owners) | tranche two (4,354 owners) |
|---|---:|---:|
| already contactable | **21.3%** | **10.8%** |
| known beyond the gov feed | 12.9% | 4.4% |
| predicted new duplicate groups | 20 (1.00%) | 72 (**1.50%**) |

Duplicate formation is 1.5× — mildly super-linear, **no cliff on graph grounds**.

### 4i.4 👤 Tranche two — recommended in two steps, Scott's call on the second

> ⚠️ **STEP ONE (T2a) IS NOW APPLIED — see §4k. The "4,811 / 4,354 remain" and "run it"
> below were true when written; live it is 2,241 / 2,054, and T2a is done.** The T2b half of this
> block still stands and is still Scott's, but §4k re-sized it against the post-T2a graph.

**4,811 properties / 4,354 owners remain**, all still in the plan view (it self-excludes minted rows).

1. **T2a — owner rent ≥ $100k: 2,570 properties / 2,300 owners, 17.2% already contactable** —
   indistinguishable from tranche one's 21.3%, and it covers the whole $2M–$20M sweet spot
   ($140k–$1.4M of rent at ~7%). **Recommended: run it.**
2. **T2b — below $100k + rent-unknown: 2,241 properties / 2,054 owners, ~3% contactable, 17.8%
   public bodies in the bottom band.** 👤 **Scott's call, and the argument has changed.** C2a said
   stop here because minting would "manufacture surface noise" — **measured, that premise is largely
   false.** What remains is not a technical risk but a prospect-quality judgement: these owners are
   mostly cities, counties, state DOTs, corporate occupiers and private individuals. Against that
   stands Scott's own rationale that ranking is `v_priority_queue`'s job, not the mint's.

The measured owner cliff (C2a projected 6.8% / 1.6%; live 6.6% / 1.5%):

| slice | properties | owners | contactable | public body (LB) |
|---|---:|---:|---:|---:|
| ≥ $100k | 2,570 | 2,300 | 17.2% | 2.7% |
| $50–100k | 742 | 715 | **6.6%** | 5.7% |
| < $50k | 821 | 803 | **1.5%** | **17.8%** |
| unknown | 678 | 536 | 3.2% | — |

⚠️ **Whatever runs, drive the evidence ingest explicitly afterwards** (cron 225's 400/run cap), and
**dia stays untouched** — 84% operator-blocked (P113); its levers are the flag and rent coverage.


---

## 4k. C2e-T2a — tranche two step one MINTED; the prediction missed by 2 and the 2 were the finding (2026-08-28)

Evidence: [`docs/audits/C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md`](../audits/C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md).
**APPLIED to production, gov only, batches `c2e_gov_eligible_t2a_20260828` (mint) +
`c2e_t2a_evidence_20260828` (evidence). No dia asset minted. T2b NOT run.**

| | before | after |
|---|---:|---:|
| **gov asset anchors** | 5,425 | **7,995** |
| **gov asset coverage** (of 13,837 non-archived) | 39.2% | **57.8%** |
| `lcc_property_owner` rows / owners | 6,065 / 3,743 | **8,636 / 5,992** |
| live entities | 64,304 | **66,874** (+4.00%) |
| plan view remaining | 4,811 | **2,241** |

**2,570 minted · 2,570 resolved an owner · 0 evidence-less · 0 orphans.** Population reproduced
C2e §6 exactly before writing (2,570 / 2,300 / 17.2% contactable), and the slice is contiguous with
tranche one ($543,718 against its $543,782 cut).

### ⚠️ Predict a canonical-key effect with the key the WRITER persists, not the caller's argument

`v_duplicate_candidates` moved **+46** against a predicted **+44**. The gap is not noise:
`lcc_mint_gov_asset_entities` passes `lcc_normalize_entity_name(name)` as `canonical_name` and the
**N15c `BEFORE INSERT` trigger overwrites it** with `lcc_entity_canonical_key(name)` — all 2,570 rows
carry the trigger's key and only **2,497 (97.2%)** equal what the function passed. Re-run against the
key actually written: **12 + 34 = 46**, exact. The trigger is doing its job (one writer for the dedup
key); the function's argument is **dead code that reads like the answer**, which is exactly why it
produced a wrong prediction. Cosmetic cleanup filed as **N15g**.

### The gates, all attributed

Merge surfaces flat and *attributed*: `v_lcc_merge_candidates` 5,194 → 5,194, **`auto_mergeable`
3,006 → 3,006**, normalizer-blind 64 → 64, drift 0 → 0 (positive-controlled at 64,304).
⚠️ **`lcc_entity_merge_log` shows 0 merges in the measurement window** (newest 13:27Z, nine hours
prior), so per §4i.5 the "unchanged" claim carries a timestamp and an attribution.

**Tier 0 +4, not the predicted ~+20** — `auto` **9 → 9 with ZERO cards on any owner T2a made
resolvable** (the only band that can trigger an unattended write); `ask` +1 and `parked` +3 are
*exactly* the 1 and 3 cards on T2a owners. The shortfall is a population signal: only **7.0%** of
these owners carry a second identity against tranche one's 12.9%, so there is less bench for Tier 0
to match. Resolving an owner makes the question *askable*; it does not manufacture a bench.

### The 7 residual `eligible` candidates are all brokerages

`evidence_written 2578` against a **+2,571** row delta — 7 idempotent re-writes, matching the 7 rows
still reading `eligible`: `Stan Johnson Co` ×4, `SVN®`, `NAI Pfefferle`, `Bradford Allen Realty
Services`. `lcc_reconcile_property_owner` filters brokerages *inside* its scoring CTE, so they clear
the candidate view and score zero forever. **The sixth guard working — not a defect, not a backlog.**
(3 gov + 4 dia; **1 dia property resolved** because the ingest function takes no domain argument —
work cron 225 would have done that night.)

### 4k.1 👤 T2b — sized live against the post-T2a graph; still Scott's, no default taken

**2,241 properties / 2,054 owners** (803 under $50k · 715 at $50–100k · 536 rent-unknown).

| | tranche one | **T2a actual** | **T2b predicted** |
|---|---:|---:|---:|
| already contactable | 21.3% | **17.2%** | **3.7%** (76) |
| known beyond gov | 12.9% | 7.0% | **1.9%** (38) |
| new duplicate groups | +20 (1.00%) | **+46 (1.79%)** | **+26 (1.16%)** |
| Tier 0 cards | +23 | **+4** | fewer still |

**The two axes moved in opposite directions and that is the whole answer.** The graph cost is now
measured across 4,570 minted entities and is not the issue — **T2b's predicted duplicate rate is
LOWER than T2a's actual**, computed with the corrected key against the live graph rather than
extrapolated. What *did* arrive exactly where C2a said is the **owner cliff**: 21.3% → 17.2% →
**3.7%** contactable.

**T2b is safe to run and low-value to run.** Nothing measured argues against it on graph grounds; it
is cheaper than the tranche just completed. The decision is purely whether *"resolve all ownership,
rank later"* should be applied to a population ~96% un-contactable today. **Not run.**

⚠️ Public-body figures stay **lower bounds** — `lcc_looks_like_person` returns true for `CITY OF
SALEM` / `BROOME COUNTY` (A3/P196). A pattern floor over T2a's owners is 182 of 2,300 (7.9%); the
`lcc_looks_like_person` reading of 618 is a **broader and different** measure. No second classifier
was written, deliberately.


---

## 4j. ⚠️ THE UNCONNECTED-SOURCE CLASS — gov never consumed its own sales table (B4→B5→B6, 2026-08-28)

**This page exists to track connectivity, and it had no row for the largest disconnection in the
system: sources we hold that no consumer reads.** Playbook **Class 20**.

**How it surfaced.** B1a closed `establish_ownership_history` as a source of chain DEPTH (64 of its
65 completions carried ONE link). The deed layer was then measured — **876 grantor-bearing
`deed_records` of 5,804; 325 deed documents for 13,835 properties** — and written up as *"depth is
now an external ACQUISITION problem."* **Both numbers correct, conclusion wrong.** One
`group by ownership_source` on `lcc_entity_portfolio_facts` overturned it.

| domain | source | historical facts | properties |
|---|---|---:|---:|
| **dia** | **`sales_transactions_seller_exit`** | **2,207** | **1,584** |
| gov | `gov_ownership_chain` (A1→B1a) | 1,356 | 1,302 |
| gov | `gsa_lease_diff` | 976 | 821 |
| gov | `county_deed` | 104 | 104 |
| **gov** | **`sales_transactions_seller_exit`** | **absent** | **0** |

**Three unconsumed gov sources, measured:**

1. **`sales_transactions`** — 14,645 rows / 5,321 properties / 1970→2026; **9,514 named sellers,
   4,697 dated properties**; `ownership_history` has consumed **169 rows (1.8%)**;
   **3,080 net-new / 2,114 properties**. → **B5, in flight.**
2. **`gsa_lease_change_facts`** — **336,303 rows**, `landlord_change_flag` on **38,213 across 8,845
   leases**, **38,055 with both old and new lessor names**, **2013-02 → 2026-02**. ⚠️ RAW signal:
   P138 flicker (return leg), A2b per-lease fan-out (**keyed on `lease_number`**), name variants.
3. **`property_sale_events`** — **5,208 rows carrying `ownership_history_id` AND
   `sales_transaction_id`; both populated on ZERO rows.** The comps↔ownership join table is
   **modelled and never wired.**

**Why this page could not see it.** A missing feeder produces **no error, no zero row, no queue** —
there is nothing to audit but the absence. Every route in §1 tracks a connection that EXISTS and
might be broken; this class is a connection that was never made.

**Detector (needs no hypothesis):** group the output by its provenance column, split by domain — **a
source bucket present for one domain and absent for another IS the finding.**

⚠️ **Do not date a feeder off `updated_at` on an upserted table** — `lcc_entity_portfolio_facts`
has **no creation timestamp** and the nightly re-upsert touches **11,828 of 14,076 rows daily**, so
every source reads "written today." Find producers in code; **a one-shot means the sibling domain
has a Class 8 problem too.**

**Scott's spec for the sweep (B6):** every place a change of **owner or lessee** is reported — GSA
lease inventory, SAM.gov, public records, sales, dia — must reach **both** stores (**transaction
history / comps** AND **ownership history**), be read **against** each other over time, and
**direct a next action**. Corroboration rides the **existing** `field_source_priority` ladder and
supersession tiers; a contradiction goes to a **review lane, never a silent winner** — and note a
GSA lessor-of-record change and a recorded deed are different KINDS of claim (in a ground lease
both can be true at once). **B6 is audit + design and builds nothing.**

### 4i.5 — C2e cross-window state notes (verified 2026-08-28)

> ⚠️ **CONSOLIDATED 2026-08-28.** This block and §4i above were written **independently by the two
> parallel windows on the same day** and both were headed `## 4i` — a duplicate heading, which is
> the documentation form of the §4a *two-windows-one-file* lesson. **Nothing was deleted**: §4i
> (above) is the primary record and owns the **tranche-two decision (§4i.4)**; this block is kept
> for the three things it measured that §4i does not carry — live state, the `auto_mergeable`
> two-thread warning, and the still-unmeasured list. **Where the two overlap, §4i wins.**

Evidence: [`C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md`](../audits/C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md).
**Applied to production, gov only, batch `c2e_gov_eligible_t1_20260828`. dia untouched.**

### The finding that changes the doctrine's application

**`v_lcc_merge_candidates` and `v_lcc_merge_candidates_normalizer_blind` filter
`entity_type = 'organization'`. A minted asset is `entity_type = 'asset'` — structurally incapable
of entering either surface.** So the merge-noise cost that justified the rent floor **cannot occur
for asset minting at all**. Measured across the 2,000-entity mint: merge candidates 5,250 → 5,250,
`auto_mergeable` 3,038 → 3,038, normalizer-blind 64 → 64, canonical drift 0 → 0.

The entire observable cost: **+20 rows on `v_duplicate_candidates`** (+0.25%) and **+23 Tier 0
cards — with the `auto` band, the only one that can trigger an unattended write, flat at 9.**

⚠️ **This does NOT retire the doctrine.** *"Evidence justifies the entity"* still holds and is why
the mint was eligible-set only: **2,000 minted, 2,000 resolved an owner, 0 left evidence-less.**
What is refuted is the specific claim that minting assets pollutes the merge surfaces.

### Live state after tranche one (verified 2026-08-28)

| | before | after |
|---|---:|---:|
| LCC asset anchors | 5,096 | **7,145** |
| `lcc_property_owner` rows | 4,065 | **6,065** |
| distinct owner entities | 2,768 | **3,743** (+975) |
| live entities | 62,368 | 64,293 (+3.2%) |
| Tier 0 ask / auto | 82 / 9 | **91 / 9** |
| canonical-name drift | 0 | **0** |

### ⚠️ `auto_mergeable` now has TWO threads moving it — timestamp every "unchanged" claim

C2e reported `auto_mergeable` unchanged at **3,038**; a check hours later read **3,005**. The mint
did not do it: **64 merges landed in that window from the other Cowork thread** (merge log 66 → 130,
97 entities tombstoned), and `v_lcc_merge_candidates` cannot see assets anyway. **C2e's claim was
correct at its measurement time.** With parallel windows, *"the gate did not move"* is only
meaningful with a timestamp and an attribution — check `lcc_entity_merge_log` before treating a
delta as your own.

### 👤 Tranche two — ⚠️ DOUBLY SUPERSEDED: **T2a is APPLIED (§4k)**, and §4i.4 owned the decision before that. Kept for its detail only; where they differ, **§4k wins, then §4i.4**.

**4,811 properties / 4,354 owners remain** in `v_lcc_c2e_asset_mint_plan`.
⚠️ **Tranche one tested the SAFEST population** — its cut landed at $543,782 of owner rent, entirely
*above* the old floor, so it exercised none of the low-rent tail the no-floor decision was about.

- **T2a — owner rent ≥ $100k: 2,570 properties / 2,300 owners, 17.2% already contactable.**
  Statistically indistinguishable from tranche one's 21.3%, and it covers the whole $2M–$20M sweet
  spot. **Recommended.**
- **T2b — below $100k + rent-unknown: 2,241 properties / 2,054 owners, ~3% contactable, 17.8%
  public bodies in the bottom band.** 👤 **Scott's call — and the argument has changed.** C2a said
  stop here to avoid manufacturing noise; **that premise is now measured and largely false.** The
  remaining case against is *prospect quality*, not technical risk: these are mostly cities,
  counties, DOTs, corporate occupiers and private individuals. Against it stands Scott's own
  rationale — *resolve all ownership, rank later* — and ranking is `v_priority_queue`'s job.

⚠️ **Whatever is run, drive `lcc_ingest_domain_owner_evidence` explicitly afterwards** — cron 225's
400/run cap would otherwise leave a 2,570-row tranche evidence-less for most of a week, matching the
retire predicate.

### Still not measured (C2e §8) — ⚠️ re-read against §4k, which closed part of this list

Whether a resolved owner converts to a call · search/UI cost of +3.2% entities · the **3,362 gov
properties with no `true_owner_id`** (54% of the non-resolving residue, the largest remaining lever,
a gov-side capture question) · ⚠️ **public-body counts are LOWER BOUNDS** — `lcc_looks_like_person`
returns true for `CITY OF SALEM` and `BROOME COUNTY` (the A3/P196 two-capitalised-token false
positive), and no second classifier was written, deliberately.

---

## §4j — B6: the owner/lessee change-signal matrix (2026-08-28)

Full audit: [`docs/audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md`](../audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md).
Nineteen signals swept across gov + dia. **Most are already consumed** — deeds 98.5%, the CoStar
sidebar writes both parties, and gov's sales table is ~97% represented in `ownership_history` under
other provenance labels. The gaps are structural, not acquisition.

- ⚠️ **`property_sale_events` cannot hold its own keys.** `ownership_history_id` and
  `sales_transaction_id` are **`bigint`** against **`uuid`** PKs, with no FK; 0 of 5,208 populated,
  and unpopulatable (`22P02`). **dia's identical table has a compatible `integer` PK and 52
  populated rows** — that is the positive control making gov's zero a type defect rather than
  neglect. This is the comp↔ownership join Scott's framing names, and it has never existed.

  > **↳ ANSWERED 2026-08-28 in §4l — and the last sentence above is the part that did not survive.**
  > The type facts all hold. But the comp↔ownership join is **not** what this column would restore:
  > `ownership_history_id` has **ZERO readers on either domain**, and **56% of the gov rows it would
  > link are `ownership_change_stub*`**, the retired circular source. **Retiring the column is the
  > recommendation; the real finding is §4l.** Read §4l before acting on this bullet.
- ⚠️ **The GSA landlord-change signal deflates 28.6×**: 38,213 flagged → 20,271 after name-key
  normalization (**46.7% of the flag is a re-spelling**) → 13,225 property-resolved → **4,845
  distinct conveyances** → **1,338 net-new / 1,202 properties**, spanning 2013→2026. Worth having,
  and it adds depth; **never quote 38,213**.
- ⚠️ **Four producers died in March–April 2026 and no health surface shows it.**
  `gsa_lease_change_facts` + `gsa_lease_timeline` (2026-03-11) have **no scheduled caller** —
  written only by `src/ingest_gsa_historical.py`, a manual CLI; the live Monday `gsa_auto_sync`
  writes `gsa_snapshots` + `gsa_lease_events` and **not** the change layer. Four monthly snapshots
  are undiffed. `prospect_leads.ownership_change` (7,729 leads, 2,041 worked) died 2026-03-31;
  `property_sale_events` 2026-04-06.
- ⚠️ **A SKIPPED STEP EMITS NOTHING, AND `v_pipeline_task_health` IS BUILT ON EMITTED ROWS.**
  `pipeline_runner.py` guards the diff with `if latest_file and not runner.dry_run:`, and
  `find_latest_gsa()` globs a local folder that is always empty on CI — it returns `None` and is
  logged **"Task completed"**. The guarded `run_task` is then never invoked, writes no `run_log`
  row, and has no row in the health view. gov `CLAUDE.md` §16 closed the *failed* case
  (`completed_with_errors`); **the skipped case is still open, and it is invisible in a different
  way — a failed step is a red row, a skipped step is no row.**
- ⚠️ **The corroboration engine exists and its disagreements go nowhere.** `parcel_owner_xref`
  (cron 21, every 30 min) produces **8,838 corroborates / 561 diverges / 362 properties**. **319 of
  the 362 already carry the assessor's name as `new_owner` in `ownership_history`** — a propagation
  gap between the store and `properties.recorded_owner_id`, the cheapest correction in the audit;
  43 are genuine net-new. `diverges` produces no task, card or lead.
- ⚠️ **The ladder does not know its biggest sources.** `field_source_priority` has a full
  `gov.ownership_history` ladder (manual@1 > recorded_deed@3 > county_records@5 > sidebars@50–70)
  with **no rung for `gsa_lease_diff` (6,648 rows) or `sales_transaction` (169)**.
  `lcc_property_owner_evidence` is fed by only four sources — no deed, no lease-diff, no
  seller-exit. **A GSA lessor change and a recorded deed cannot be adjudicated**, and per Scott's
  Sunflower framing (ground lease: fee vs leasehold) both can be right at once → a review lane,
  never a silent winner.
- **Measured and refuted:** `ownership_research_queue` (17,665) is **100% complete**, not a stalled
  backlog. Deeds are **98.5% consumed** — the gap is EXTRACTION (876 grantors of 5,804), which
  supports B1a/B5's finding that deed acquisition is the wrong first lever. **gov `CLAUDE.md` §21's
  "state-lease producer silent 6+ weeks" is SUPERSEDED** — 617 rows, all within 90 days, events to
  2026-08-05; its `property_id`-is-NULL half still stands.
- ⚠️ **B5's `3,080 / 2,114` ceiling could not be reproduced and should be re-derived.** The
  anti-join is scope-sensitive by **26×**: against the `sales_transaction` bucket → 9,517 rows;
  against the whole store → **366** (exact-date key) or **269 / 215 props** (no date). **3,313 of
  the 9,686 named-seller rows are `ownership_change_stub*`, a mechanism gov R37 explicitly
  retired** — minted *from* ownership history, so feeding them back is circular. Honest target:
  **~270–370 rows / ~215–291 properties**, concentrated in `costar_export`.
- **dia's seller-exit producer, found in code:** a one-shot backfill
  (`20260522140200_dia_backfill_oh_seller_exits.sql`, no cron) **plus** a standing writer at
  `sidebar-pipeline.js:9367` gated `domain === 'dialysis'`. Its comment — *"Gov OH already captures
  the seller via the prior_owner text field… so no separate seller OH row is needed for gov"* — is
  **true of the sidebar's own writes and narrower than the conclusion drawn from it**; gov
  `sales_transactions` holds rows from six other channels. **dia has a Class 8 problem** (2,974
  seller-exit rows against 3,702 named-seller sales, decaying).
- ⚠️ **Detector hygiene:** `ownership_source` is **not** a controlled vocabulary — **2,978 distinct
  values over 14,076 rows**, embedding record ids (`county_deed:<uuid>`,
  `gov_master_backfill_r71|h=<md5>`). Split on `:` and `|` before grouping, or gov `county_deed`
  reads as 1 row instead of **1,614**. And **69% of dia's own `ownership_history` carries a NULL
  `ownership_source`** — the Class-20 detector is blind to it.

---

## 4j. B6b — the GSA landlord-change layer, restarted (2026-08-28)

`gsa_lease_change_facts` **356,291 → 374,257** (max snapshot **2026-02-01 → 2026-07-01**);
`gsa_lease_timeline` **16,471 → 16,779** (max **2025-12-01 → 2026-07-01**); **both `feed_stale`
alerts auto-resolved.** Migration
`government-lease/sql/20260828_gov_b6b_gsa_change_layer_from_snapshots.sql`; caller
`src/gsa_change_layer.py`, wired into the existing Monday `gsa-sync`. Full writeup:
`docs/audits/B6b_GSA_LANDLORD_CHANGE_RESTART_2026-08-28.md`.

- **⚠️ THE RAW FEED WAS ALIVE THE WHOLE TIME, AND THE PULL LEDGER SAID SO.** `gsa_snapshots` at 58
  days old reads exactly like a dead feed from `max(snapshot_date)`. `gsa_source_pull_log` shows the
  Monday job pulling **2026-08-24**, fingerprinting the file, and recording
  `action='skipped_duplicate'` / `consecutive_unchanged=3` — GSA has not published past 2026-07-01,
  and the measured cadence is **monthly (28–31d)**. **A feed early in its publish cycle and a dead
  feed are indistinguishable from the table alone**; the difference lives in the ledger, and
  `consecutive_unchanged` is the honest counter. The freshness registry had already separated them
  (`gsa_source_pull` was *not* among the six open alerts while both derived feeds were) — nobody had
  read it that way.
- **⚠️ PRODUCER AND CONSUMER WERE ON TWO COPIES OF ONE PANEL.** `derive_change_facts` reads
  `gsa_inventory_snapshot_lines` (manual CLI, frozen 2026-02-01); the weekly job writes
  `gsa_snapshots` (live, 2026-07-01). **Scheduling the existing code unchanged would have derived
  nothing** — the diagnosis "it has no scheduled caller" was true and insufficient. **When a derived
  layer is stale behind a live source, diff the table the consumer READS against the table the
  producer WRITES before concluding anything about schedulers.**
- **⚠️ AND THE LIVE PANEL IS NOT A CLEAN SUPERSET — A THREE-MONTH SAMPLE SAID IT WAS.** 137 shared
  dates, 136 byte-identical (positive-controlled: mis-keyed one month → 6,223 diffs), but **10 dates
  exist ONLY in the manual panel**, two of them serving as `prior_snapshot_date` for 5,029 existing
  facts. The manual panel is unioned in **per date**, not retired. The full-history digest is what
  found them; the recent-months sample was clean and wrong.
- **⚠️ "UNDIFFED" IS NOT "DERIVABLE."** 21 undiffed dates; **15 are already SPANNED** by an existing
  diff whose prior is before them and whose snapshot is after (2018-06-01 sits inside a
  `2018-03-01 → 2019-04-01` diff carrying 18,821 facts). Deriving them records a **second
  observation of conveyances already held** — the A2b per-lease fan-out in the **TIME** dimension.
  The guard is the whole safety argument. Its cause is an unreported defect in the old writer:
  `_previous_snapshot_date` resolves the prior from whatever metadata existed at that moment, and
  the 2026-03-11 run processed files **out of order**, so 2025-12 got prior 2025-08 (4 months) and
  2026-02 got 2025-12 (2 months). **A fourth inflation source on top of B6's three**, neutralised by
  B6's `distinct (property, from, to)` stage.
- **⚠️ THE FAITHFULNESS PROOF FAILED FIRST AND THE STORED DATA WAS THE WRONG ONE.** The port gave
  35/26/630 against a stored 68/63/1,845 on 2026-02-01 — because the stored rows describe a
  two-month diff. On dates whose stored prior IS adjacent it is **byte-faithful: 1,409 rows, 1,409
  matched, 0 differing in any of 13 derived columns.** When a port disagrees with production,
  establish which is right before adjusting either.
- **⚠️ A DRY RUN CANNOT CATCH A WRITE-TIME CONSTRAINT.** The apply died `22003` on **one row in
  17,966** — lease LMT14507's `$1.00` placeholder rent corrected to `$10,418.00`, ratio 10,417
  against a `numeric(8,4)` column. Five clean dry runs saw nothing, because a dry run proves the
  SELECTION and never the WRITE. `gov_gsa_pct_or_null` returns **NULL (not representable, not zero —
  P180)** and the raw rents stay on the row.
- **⚠️ THE CLIENT TIMED OUT AND THE WORK HAD COMMITTED.** The tick exceeded the 60s PostgREST
  statement timeout and returned an error; the delta says **+17,966 facts, all 16,779 timeline rows
  touched**. Verify a batch by the state delta, never the return value (P118 corollary 4). Split
  into two RPCs since — ⚠️ and adding the defaulted third parameter needs the 2-arg signature
  **DROPPED first** (42725, N15d/B1).
- **Deflation, coverage and depth separately (B1):** raw **+1,336** → **+72 net-new conveyances /
  +63 properties** (18.6× on the increment; 28.1× fleet-wide). The ladder reproduces B6's published
  stages **exactly** on the pre-B6b subset. ⚠️ **Non-oscillating went DOWN 47** while conveyances rose
  311 — the new months supplied return legs, so **more data made the P138 flicker guard stricter**.
- **⚠️ B6's G3 ROW IS REFUTED, BY THE TRAP THAT PRODUCED IT.** `gsa_lease_events` DOES carry old/new
  lessor pairs — **16,907 rows, 1,176 in 90 days**. `changed_fields` is a jsonb **string** holding
  JSON text, so `changed_fields ? 'lessor_name'` cannot match and returns a confident **0 of
  201,212**; the Python consumer parses it and never noticed. Correct probe:
  `(changed_fields #>> '{}')::jsonb ? 'key'`. **A zero from a JSON/text detector needs a positive
  control before it becomes a finding** — here the wrong zero had already been published.
- **Nothing was fed to `ownership_history`, and the lead lane was NOT restarted** — `ingest_ownership`
  is a different producer over a different source, its blast radius is **10,635 rows**, it cannot be
  dry-run without credentials, and its only gate is a name heuristic. Its consumer is confirmed
  alive (**2,041 worked, 208 in Salesforce, 2,149 touched in 30d**), which is why it deserves a
  measured restart. Backlog **B6b-lead**; its `feed_stale` alert correctly stays open.


---

## 4k. C2e-T2a — tranche two step one MINTED. gov asset coverage 39.2% → 57.8%.

Evidence: [`C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md`](../audits/C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md).
Batches `c2e_gov_eligible_t2a_20260828` (mint) + `c2e_t2a_evidence_20260828` (evidence). gov only.

| | C2a baseline | after T1 | **after T2a** |
|---|---:|---:|---:|
| gov asset anchors | 3,422 | 5,425 | **7,995** |
| **gov asset coverage** (of 13,837 non-archived) | 24.7% | 39.2% | **57.8%** |
| asset anchors, both domains | 5,096 | 7,147 | **9,717** |
| `lcc_property_owner` rows | 4,065 | 6,065 | **8,636** |
| **distinct resolved owner entities** | 2,768 | 3,743 | **5,992** |
| plan view remaining | 6,811 | 4,811 | **2,241** |

**The eligible-set promise held again: 2,570 minted · 2,570 resolved an owner · 0 evidence-less ·
0 orphans**, and the population reproduced C2e §6 exactly *before* anything was written (2,570 /
2,300 / 17.2% contactable). The slice is contiguous with tranche one — its top owner rent
$543,718 against T1's cut at $543,782.

**Gates held and the claim is ATTRIBUTED** (the §4i rule): `v_lcc_merge_candidates` 5,194 → 5,194,
`auto_mergeable` **3,006 → 3,006**, normalizer-blind 64 → 64, drift 0 → 0, both readings timestamped
seven minutes apart. Structural, as C2e established.

### ⚠️ Predicted +44 duplicate groups, measured +46 — and the 2-row gap is a real finding

`lcc_mint_gov_asset_entities` passes **`lcc_normalize_entity_name(m.name)`** as `canonical_name`,
and the **N15c `BEFORE INSERT` trigger overwrites it** with `lcc_entity_canonical_key(name)`. All
2,570 rows carry the trigger's key; only **2,497 (97.2%)** equal what the function passed. Re-running
the prediction against the key actually **persisted** gives 46, exactly.

**This is the trigger working as N15c intended — one writer for the dedup key.** But the argument
inside the mint function is now **dead code that reads like the answer**, which is what produced the
wrong prediction. **Durable rule: predict a canonical-key effect with the key the WRITER persists,
not the one the caller passes** — where a `BEFORE` trigger owns a derived column, the caller's
argument is a suggestion. Same family as the P157/P182 traps. Filed as **N15g** (cosmetic).

### ⚠️ Tier 0 moved +4, not the predicted ~+20 — a POPULATION signal, not a miss

Only **7.0%** of T2a's owners carry a second identity, against tranche one's 12.9%. **Resolving an
owner makes "who do we call there" askable; it does not manufacture a bench.**

### 👤 T2b — safe to run, low-value to run. Still Scott's call, no default taken.

**2,241 properties / 2,054 owners** (803 under $50k · 715 at $50–100k · 536 rent-unknown).

| | T1 | T2a actual | **T2b predicted** |
|---|---:|---:|---:|
| already contactable | 21.3% | 17.2% | **3.7%** |
| known beyond gov | 12.9% | 7.0% | **1.9%** |
| new duplicate groups | 1.00% | **1.79%** | **1.16%** |

**The two axes moved in opposite directions.** T2a ran *hotter* than predicted on duplicates and far
*colder* on Tier 0 — and **T2b's predicted duplicate rate is LOWER than T2a's actual**, computed with
the corrected key against the live post-T2a graph rather than extrapolated. **The graph cost is now
measured across 4,570 minted entities and is not the issue.** The owner cliff, however, is real and
arrived exactly where C2a said: contactability **21.3% → 17.2% → 3.7%**. That is a *prospect-quality*
judgement, not a technical risk — cities, counties, state DOTs, corporate occupiers, private
individuals — set against Scott's own *resolve all ownership, rank later*, with ranking being
`v_priority_queue`'s job.

⚠️ **Whatever is decided, drive `lcc_ingest_domain_owner_evidence` in the same pass** — cron 225 caps
at 400/run.


---

## 4l. C2b — the Salesforce bridge SELF-HEALED, and the residue is not an owner problem

Evidence: [`C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md`](../audits/C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md).
Measurement only — nothing written.

**No bridge code was written and the bridge doubled.** SF-linked people reaching a resolved property
owner: **669 (6.8%) → 1,486 (15.2%), +817**, purely because T1 + T2a built the far bank. **C2's
diagnosis and remedy are both confirmed** — hop 3 was the binding constraint. **Re-measure a
downstream gap after fixing an upstream one, before building anything for it.**
diagnosis and remedy are both confirmed** — hop 3 was the binding constraint.

### ⚠️ The residue is 91.5% NOT-AN-OWNER, and that is correct

Of the 7,646 SF people still unconnected, across **6,816 distinct orgs**:

| | |
|---|---:|
| orgs carrying a `dia\|gov` `true_owner` identity | **489 (7.2%)** |
| people at those orgs | **652 (8.5%)** |
| **people at orgs that are NOT domain owners** | **6,994 (91.5%)** |

Brokers, vendors, tenants, lenders and counsel, edged to their employer by the `works_at`
They are brokers, vendors, tenants, lenders and counsel, edged to their employer by the `works_at`
Salesforce-account edge. **Their employers do not own our properties. No minting or reconcile will
connect them, and none should.**

⚠️ **This retires the framing that opened the topic.** *"8–10k Salesforce opportunities not yet
connected"* is, measured, **~652 people at 489 owner-orgs.**

### ⚠️ It also settles T2b independently: minting it would connect **74 orgs**

Only **74 of the 489** appear in `v_lcc_c2e_asset_mint_plan` — **3.6%** of T2b's 2,054 owners.
With T2a's measured collapse in contactability to **3.7%**, the case is weak on two independent
axes. It remains *safe* (graph cost settled across 4,570 minted entities). **Do not run T2b now.**

---

## 4m. C2g — why 489 anchored owner-orgs are unresolved. Both leading hypotheses were WRONG.

Evidence: [`C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md`](../audits/C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md).
Diagnosis only — nothing written.

| hypothesis | measured | verdict |
|---|---|---|
| the **0.55 confidence gate** (876 assets with evidence read "Unresolved") | **444 of 489 were NEVER a candidate** — only 45 appear in `lcc_property_owner_evidence` | ❌ **refuted** — the gate never saw them |
| **P113 operator-in-the-owner-slot** | `true_owner_is_operator` = **0** across all 489 | ❌ **refuted** |

**Both were the documented causes closest to hand, and both were wrong.** The residue is three
populations:

| | orgs | lever |
|---|---:|---|
| **dia — no property in the mirror at all** | **248 of 271** | not a resolution gap; they own nothing we track |
| **gov — property but NO asset entity** | **74 of 222** | minting — **exactly the 74 that overlap the T2b plan** |
| **gov — property WITH an asset entity, still no evidence** | **79 of 222** | ⚠️ **the genuine feeder defect** |
| gov — no property in the mirror | 69 of 222 | as dia |

⚠️ **The 74 reconciles exactly with C2b's independent count** of owner-orgs in
`v_lcc_c2e_asset_mint_plan` — two different queries, same number. And the
`true_owner_effective_id::text = external_id` join was **controlled before concluding**: 19,851 of
20,123 facts match a gov or dia anchor, so the zeros are facts, not artifacts.

### ⚠️ T2b — a THIRD independent reading, same answer

T2b mints the 74. It does not touch the 79 (already minted), the 248 (own nothing here) or the 69.
**Three separate measurements now converge**: contactability 3.7% (T2a) · only 74 of 489 reachable
(C2b) · those same 74 the only slice of this residue (C2g). **Safe, and low-value.**

### The next question — 79 gov owner-orgs the feeder should have resolved

Property present, asset entity present, owner anchored — and `lcc_property_owner_evidence` names
them **zero times** (only 17 of 222 gov orgs here were ever a candidate). **Undiagnosed by design.**
Test in order: the **400/run cap** on cron 225 (both mints had to drive it explicitly); the
**`lcc_domain_owner_ambiguous`** lane, where a parked row would make these *correct abstentions*;
then the **brokerage/junk/placeholder guards**. ⚠️ **In this arc every "silent producer" that looked
like a defect turned out, at least partly, to be a guard doing its job** — read the verdicts first.
connected"* is, measured, **~652 people at 489 owner-orgs.** The rest are correctly unconnected.

### ⚠️ It also settles T2b independently: minting it would connect **74 orgs**

Only **74 of the 489** unresolved owner-orgs appear in `v_lcc_c2e_asset_mint_plan` — **3.6%** of
T2b's 2,054 owners. Combined with T2a's finding that contactability collapses to **3.7%** in that
band, **the case for T2b is weak on two independently measured axes.** It remains *safe* (the graph
cost is settled across 4,570 minted entities), so it can be revisited if the ranked queue runs dry.
**Recommendation: do not run T2b now.**

### The actionable slice, and the next question

**489 orgs / 652 people**: companies that **are** domain property owners, **have** Salesforce people
attached, and whose properties are **not** resolved to them. ⚠️ **415 of the 489 are NOT reachable
by minting** — they are anchored and unresolved for some other reason. **That is the next thing to
size, and it is deliberately undiagnosed here.** Candidates in order: the `lcc_reconcile_property_owner`
0.55 confidence gate (the documented 876-asset supersession class); a dia **operator** in the owner
slot (P113); or an org anchored in one domain with properties in the other. **Do not assume — this
arc has three instrument errors on record from assuming.**


---

## 4n. C2h — the "silent feeder" resolved every one of them. It is the sponsor↔SPE gap.

Evidence: [`C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md`](../audits/C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md).
Diagnosis only — nothing written.

**C2g called these 79 "the genuine feeder defect." They are not a defect.** Every one of their
properties **is** resolved: the feeder resolved the **SPE that holds title** (the correct recorded
owner) while the Salesforce person works for the **sponsor**. Both sides are right.

| SF person's employer *(a gov `true_owner`)* | LCC resolved owner *(title holder)* |
|---|---|
| **Avery Capital** | **AC** ORLANDO SPV LLC |
| **Ball Ventures** | **BV**GC PARCEL C, LLC |
| **Browman Development Co.** | **BDC** Livermore L.P. |
| **Carmel Partners** | **CP** VI Van Gordon, LLC |
| Corporate Office Properties Trust | REDSTONE GATEWAY 100, LLC |

**The SPE initials are the sponsor's initials.** Split: **69 sponsor↔SPE · 8 true duplicates (same
canonical key) · 2 probable duplicates.**

⚠️ **One column turned the whole diagnosis around:** `prop_resolved_to_someone` equalled
`props_with_asset` on all 79. C2g's *"everything the feeder needs is present and it produced
nothing"* was wrong because it never asked whether the property had resolved **to someone else**.
**When a producer looks silent, check whether it answered a different question before calling it
silent.**

### Do NOT build a third sponsor detector

`lcc_owner_sponsor_domain` (P190) and `lcc_ownership_sponsor_family` (A3) both exist and are
**human-confirm by design** — A3 measured a lexical sponsor detector at **~25% precision** raw, and
P196 at 4-of-6 even with three guards. Feed these 69 into the existing confirm surfaces as
candidates; they arrive with **stronger evidence than either surface normally has** (the sponsor is
independently attested as a gov `true_owner` *and* carries Salesforce people). **Not sized here.**

### Real residue found while reading

**`Casa De Chupita` → `Undisclosed` at confidence 0.57** — a **placeholder won a resolution**, and
`lcc_is_placeholder_owner_name` does not list `Undisclosed`. **`Chiapelone Trust` →
`BGC-Havasu Project LLC by Newmark Knight Frank`** — brokerage pollution inside a resolved owner
name (the P116 class; gov's `gov_strip_brokerage_suffix` exists to strip exactly that suffix).
Two more (`Consilium → Easterly`, `Carosella → WMC`) are unexplained at confidence 1.00 and want
reading individually.
## §4l — B6c: `property_sale_events` — the table has a future, the two link columns do not (2026-08-28)

Full audit: [`docs/audits/B6c_PROPERTY_SALE_EVENTS_2026-08-28.md`](../audits/B6c_PROPERTY_SALE_EVENTS_2026-08-28.md).
**Diagnosis only — no migration, no column dropped, no type changed.** B6c was briefed to answer
*"does this table have a consumer"* **before** repairing the `bigint`/`uuid` defect §4j found. It
does; the columns do not; and the audit found something that outranks both.

### The three verdicts

- **The TABLE is alive — keep it.** 6 live gov triggers, three of them table-specific:
  `trg_pse_close_listing` (flips a concurrent listing to Sold), `trg_pse_propagate_sale` (writes
  `properties.latest_sale_price` / `latest_deed_date` / grantor / grantee) and
  `trg_gov_auto_cap_rate_on_sale_event` (feeds `cap_rate_history`). It is the LCC detail panel's
  **declared canonical write target** (two write paths) and is read+write allowlisted on both
  domains. dia has 6 objects on it including `v_property_latest_sale`.
- **`ownership_history_id` — ZERO readers anywhere. Retire it.** 0 hits across **620 gov objects**,
  0 across dia, 0 in `api/`; 0 of 5,208 gov rows; **1.9% (52/2,730) on dia after four months**; **no
  FK on either domain.** ⚠️ **Both gov trigger functions were read in full and neither touches
  either link column** — they use `property_id`, `sale_date`, `price`, `cap_rate` and the *name*
  columns. Repairing the type builds a link nobody follows (**Class 2**).
- **`sales_transaction_id` — one reader, dia-only.** `fn_listing_close_if_sold` uses it to stamp
  `available_listings.sale_transaction_id`, and that is why dia has the FK. **gov has no reader and
  gov's own close-listing trigger does not want one.** Held, not retyped: if the two stores
  consolidate (below) the column disappears rather than getting fixed.

### 🚨 The finding that outranks the type defect — two stores, opposite ideas of "canonical"

`detail.js` states in its own comments that `property_sale_events` is **canonical** and
`sales_transactions` is *"legacy, retired for write paths."* The database says the reverse:

| | reads `sales_transactions` | reads `property_sale_events` |
|---|---:|---:|
| all gov views | **76** | **0** |
| of which `cm_gov*` (the CM book) | 30 | 0 |

**No trigger or function propagates PSE → `sales_transactions`** (PSE writes to `properties` and
`available_listings` only), while the reverse direction *does* exist via
`trg_gov_listing_propagate_to_sale`. **So a sale an operator types into the property panel never
reaches the comps spine.** Already non-empty and not noise — **6 real priced comps, up to $10.8M
with cap rates**, exist only in PSE and are invisible to every chart in the book. And PSE is **92.6%
duplicative** of `sales_transactions` on exact `(property_id, sale_date)` (4,825 of 5,208; **0** PSE
rows sit on a property with no `sales_transactions` row at all).

⚠️ **Both stores are individually correct and each has a coherent consumer set. Nothing errors and
no component test can see it, because it is a property of the CONNECTION** — the class the coherence
contract exists for. Filed as **B6c-dup**, ranked above every column-level repair.

### D2 — the I3 sweep, run on all three projects

**10 genuine defects · 3 low-severity · 5 accepted false positives.** Detector SQL in the audit §7e.
Two refinements it earned while running, both worth carrying:

- **A declared FK is authoritative and Postgres already type-checks it** — so D2 need only examine
  *unFK'd* columns. `available_portfolios.portfolio_id` was flagged against a name-derived
  `portfolios`; its real FK points at `sales_portfolios` (uuid→uuid, correct). **The declaration
  beat the name guess.**
- **Every genuinely mismatched undeclared column found is 0% populated** — a column that cannot hold
  its value never gets one. **Triage by populated-ness first**; a *populated* mismatch is nearly
  always an external vendor id (Salesforce `00T8W...`) or a uuid stored as text.

⚠️ **LCC Opps returned no mismatches, and that is a BOUNDED zero, not a clean bill** — it evaluated
**151 of 559** `_id` columns (27%); the other 408 do not resolve to a name-derived target and were
**not examined**. ⚠️ **And gov and dia's `property_sale_events` are broken on *different* columns**
(gov's `broker_id` is fine, dia's is `uuid` against an `integer` PK on 2,730 rows) — **neither is a
safe template for the other**, which is I2's same-shape invariant failing on types.

### The alert is NOT to be resolved — re-scope it

`property_sale_events` is registered in `feed_freshness_registry` on `created_at` at **45 days** and
reads **`is_stale=true`, age 144**. Its bulk producer was retired **on purpose**; its only live
producer is an operator form with **no cadence at all**. A 45-day expectation there alerts whenever
nobody types a sale for six weeks and then sits open forever — **the B6a *"expectation nobody chose"*
failure, inside the freshness registry.** De-register with the reason recorded, or re-register as a
DECLARED irregular feed. Backlog **B6c-feed**.


---

## 4o. C4 — the ranking layer: the whole BD queue is gated on one unset column

> **Audit:** [`docs/audits/C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md`](../audits/C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md).
> **Diagnosis only, nothing written.** This is the LAST hop of Scott's chain — the ranked call list
> — and the first time it has been measured.

Measured **2026-08-28 after the T1 + T2a mints, cache verified fresh** (refreshed 4 min before the
read; `lcc-priority-queue-refresh` every 5 min). **Staleness ruled out first.**

### The gate

Every gov deal-timing band (P1/P2/P3/P8) reads one CTE in `v_priority_queue_live`:

```sql
gov_owner_props AS (
  SELECT ... FROM entity_effective_role eer
    JOIN lcc_entity_portfolio_facts f  ON f.entity_id = eer.entity_id AND f.is_current AND f.source_domain='gov'
    JOIN lcc_property_attributes   a  ON a.source_domain=f.source_domain AND a.source_property_id=f.source_property_id
  WHERE eer.effective_owner_role = ANY (ARRAY['developer','user_owner'])   -- ← the entire gate
)
```

**It reconciles to the row:** gov properties with a current owner fact, an attributes row, and a
lease expiring ≤24 months = **1,216**; add the role predicate = **74**; the observed P1 count is
**74**. Not value-gated, not cadence-gated, not opportunity-gated. The attributes join passes 1,216
and is *not* the constraint.

### ⚠️ Half the gate has never matched a row, and the other half is exhausted

| `effective_owner_role` | live entities (66,874) | of the 5,992 resolved owners |
|---|---:|---:|
| `unknown` | **62,554 (93.5%)** | **4,314 (72%)** |
| `buyer` | 3,591 | 1,567 |
| `developer` | 715 (1.07%) | 111 (1.9%) |
| **`user_owner`** | **0** | **0** |

- **`user_owner` has no producer anywhere.** Named in the gate, in P0.4/P0.5, and in the doctrine;
  **written by nothing, ever.** ⚠️ **A gate arm that has never matched a row is indistinguishable
  from one that is absent** — which is exactly why it survived unnoticed. New detector class.
- **`developer` has a producer that has run out of input, not broken.**
  `lcc_developer_classification_log` = **285 rows lifetime**, candidates view down to **2 open**.
  It keys on `properties.developer_name`, so it can only ever find parties a domain DB already
  labelled. **Working; exhausted.** (Plus 374 `behavioral_override` rows.)

⚠️ This is the **N18 view** — whose ranking N18 found was arbitrary because `attributed_rent`
self-compared. That view sits **upstream of the entire ranked call list**, which N18 did not know.

### What the queue contains — 73% is data work

**931 of 1,267 rows (73%)** are P0.4 `resolve_ownership_control` (552), P-CONTACT
`select_prospecting_contact` (231), P0.5 `open_bd_opportunity_needed` (148). **~336** are genuine
deal-timing signals. **Only 256 of 5,992 resolved owners (4.3%)** appear anywhere in the queue.

The 73% is **not itself a defect** — those are doctrinal producers with named consumers. But a
surface three-quarters data-completion trains the operator to skim it: the badge-that-is-noise
failure, one level up.

### Broker assignment ~2%

2,301 cadences, **48** with `owner_user_id`; **14 of 1,267** queue rows. ⚠️ **Do not re-derive the
mapping** — `touchpoint_cadence.owner_user_id` FKs `users(id)` while
`lcc_entity_owner_override.owner_user_id` FKs `lcc_users(lcc_user_id)` and **none of those ids exist
in `public.users`**. The bridge is email via `lcc_cadence_point_person(uuid)`.

### ⚠️ SELF-CORRECTION (same day) — widening admits 2,521, not 62,554

**This section first said widening to `unknown` admits 62,554 entities. That is wrong by 25×.**
`gov_owner_props` **already joins** `lcc_entity_portfolio_facts` (current, gov) **and**
`lcc_property_attributes` — joins that are a value gate in all but name. 62,554 is the fleet-wide
`unknown` count; **the count that can reach this CTE is 2,521.**

⚠️ **Quote the population at the point the predicate is APPLIED, not at the table it names.**
Reading the `WHERE` clause and reaching for the column's fleet-wide distribution skips the JOINs
directly above it. Class 19's sibling: blast radius is a property of the query, not the column.

| the 2,521 reachable `unknown` entities | |
|---|---:|
| organization-typed | 2,438 · person-typed 83 |
| already a resolved owner | **1,952** |
| **placeholder or brokerage names** | **3** |
| ≥2 current assets · `purchases` edge · already contactable | 231 · 383 · 320 |

**Three junk names in 2,521** — the eligible-set joins already removed the flood. Also newly
visible: **`buyer` is 2,432 reachable entities**, excluded deliberately, and an `operator` role
exists (2).

**What widening would produce:** P1 **74 → 553**, P2 **32 → 242**, P3 **62 → 414**; **997 distinct
owners**. The P1 delta alone is 479 rows / **449 owners / $148.0M** (top asset per owner), and the
named rows are genuine gov landlords — `1101 WILSON OWNER, LLC`, `131 SOUTH DEARBORN LLC`,
`1515 FLAGLER PROPERTY LP`.

### ⚠️ The real constraint is REACHABILITY, and it is severe

**Only 56 of the 449 new P1 owners (12.5%) are contactable**; 39 have a cadence. Widening alone
emits **~393 owners nobody can call** — the **P112** failure this repo already documents: *never
seed a cadence for a party with no contact method, because it can never advance and only ages into
"overdue."* **So the answer is sequencing, not refusal:** widening is safe and valuable, and it
should ship gated on the reachability precondition the cadence engine already applies. **The 56
contactable owners are actionable on day one.**

### ⚠️ What still should NOT be done
- **Do not write a name-based role classifier.** Every lexical owner classifier measured in this arc
  landed ~25% precision raw (P189, A3) or 7% (P198), 4-of-6 guarded. A role deciding *whether we
  call someone* is a worse home for that than a merge candidate.
- **`lcc_looks_like_person` is not a census** (`CITY OF SALEM`, `USAA Real Estate` — A2a/A3/P196).

### 👤 The open question is Scott's, and it is doctrine

**What recorded evidence should promote an owner out of `unknown`?** It decides who gets prospected
and in which bucket — his chain's *"correct prospecting style in correct buckets."* Facts already on
hand, none adopted: **portfolio shape** (`lcc_entity_portfolio_facts` knows asset count/domain/rent);
**acquisition history** (`entity_relationships` `purchases` edges already separate a repeat investor
from a one-off owner — his own distinction, already modelled); **`is_operator_not_owner`** (P113, a
recorded flag); and **deed/B5 sales party roles**, which the developer classifier has never read.

⚠️ Whatever fills it **needs a value gate and an auto-retire predicate before it emits**, or it
recreates the 931-row data-work flood one band up.

### Not measured

dia's bands (this CTE is gov-only) · whether the 336 deal-timing rows are individually good
(counted, not read) · **value** — no dollar figure on the 1,216 or the 74, and ⚠️ per §4g there are
**five distinct $500k floors**, so any floor here must be NAMED · **marketing and deal-execution
actions**, the other half of *"compared to the balance of the leads or marketing activities"* —
they live outside `v_priority_queue` and **that inventory does not exist today.**

---

## 4p. C5 — the callable list, and the `buyer` exclusion is the larger half

> **Audit:** [`docs/audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md`](../audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md).
> **Diagnosis only.** Answers **C4e** and produces the list C4a implied.

**1,924 owners hold a current gov property with a P1/P2/P3 deal-timing signal and are invisible to
the queue** — 1,052 typed `buyer`, 871 `unknown`. **224 are contactable today.**

⚠️ **C4's "56 contactable" was P1-only and `unknown`-only.** Across all three bands and both excluded
roles it is **224**. Quote 224.

### ⚠️ C4e answered — the `buyer` exclusion is a category error, not a bad label

**578 owners typed `buyer` hold a gov property with a lease expiring inside 24 months, carrying
$410.4M** — larger than the `unknown` half C4 focused on. And the labels are *correct*:

| owner | role | gov assets | signal | contact |
|---|---|---:|---|---|
| **Boyd Watterson Asset Mgmt** | `buyer` | **45** | lease expiry **2026-08-31** | Eric Dowling |
| Prologis, L.P. | `buyer` | 3 | 2027-07-31 | Jeff Behm |
| RMR Group | `buyer` | 5 | 2027-04-11 | Jenkin Cagwin |
| HC Government Realty Trust | `buyer` | 6 | 2027-01-11 | David Lucas |

They **are** buyers. They are **also, right now, the owner of a building whose lease is running
out.** `entities.owner_role` is a **party-level identity**; the bands ask a **per-asset question**.
The CTE has already joined `lcc_entity_portfolio_facts` on `is_current = true` — **it is holding the
per-asset fact and then discarding it in favour of the entity's global label.** A REIT is
permanently a buyer and permanently ineligible however many gov buildings it owns.

⚠️ **Firing the band is not choosing the pitch.** `account-based-contact-intelligence.md` is explicit
that acquisitions and disposition are different contacts and different tones, and the buy-side
relationship is the funnel *into* the disposition conversation. **Which bucket the call lands in is
C4a's doctrine question, not this one.**

### Urgency

**173 owners have a gov lease expiring within 90 days and are invisible**; **14 contactable**, 28
within 180 days. ⚠️ **Boyd Watterson: 2026-08-31 — three days from the measurement**, 45 gov assets,
contact confirmed, on no surface. **Not verified: whether that lease is renewing, extended or
terminal** — the attributes row carries a date, not an outcome. **Read the asset before acting.**

### The names are the ones already resolved

Boyd Watterson · Easterly · NGP Capital · RMR · Gardner Tanenbaum · GI Partners · USAA Real Estate ·
Trammell Crow · Prologis. **The Tier 0 arc spent twelve rounds confirming these contacts. The signal
existed the whole time. The role gate sat between them.**

### What it changes

**The per-asset fix is narrower and better founded than widening to `unknown`** — it needs no new
classifier and no doctrine call, because the join is already there and already says `is_current`.
`buyer` alone is 578 owners / $410.4M. **224 owners are callable the day it ships.**

### Not measured

Whether any named lease is terminal (date ≠ outcome) · whether the 224 contacts are the *disposition*
decision-maker · dia · portfolio rent (only top-asset per owner; the $410.4M is a different basis —
**do not mix them**) · P5/P8/P-BUYER.
## §4p — B6c-dup: the two sale stores disagreed about which is canonical (2026-08-29)

> Full writeup: [`docs/audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md`](../audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md).
> Follows **§4l** (B6c), which found this behind the type defect it was sent to answer.

**DECISION, recorded: `sales_transactions` is the canonical comps spine. `property_sale_events` is
a CAPTURE surface that propagates into it.** Measured over 234 gov views/matviews: **77 read the
spine — all 30 `cm_gov*` Capital Markets views among them — and ZERO read `property_sale_events`**
(nonsense-token control: 0). `detail.js` asserted the exact opposite in its own comments; corrected
at four sites, each `B6c-dup`-marked with the old wording quoted.

**The leak was real and was confirmed behaviourally, in a rolled-back transaction:**
`property_sale_events` +1, `sales_transactions` **+0**, `properties.latest_sale_price` set. Shipped
`trg_gov_pse_propagate_to_sale` — AFTER INSERT on PSE, the **single owner** of that transition, keyed
`(property, YEAR-MONTH, price-to-$1k)`, fill-blanks only, ledgered, kill-switched, batch-reversible.

⚠️ **AND THE DAMAGE WAS ZERO, WHICH IS THE POINT.** The operator path had never produced a row: all
5,208 PSE rows come from bulk importers that wrote the spine *independently* (inserts stopped
2026-04-06). **A complete downstream store is not evidence that propagation exists** — here it was
evidence that two importers each wrote two tables. Fix-before-it-bites, so the build stayed small.

### The three wrong numbers, and why they are the transferable part

| figure | source | verdict |
|---|---|---|
| 330 orphans / $4.48B | B6c-dup sizing | ❌ artifact |
| 9 / $558.8M | the brief's own correction | ❌ artifact |
| 6 / $29.2M | **my first re-measure** | ❌ artifact |
| **0** | keyed on `(property, YEAR-MONTH)`, control 1,694 | ✅ |

1. **The exact-date join was the wrong key.** `sales_transactions.sale_date` is **month-truncated**
   for its dominant source — `costar_sidebar` **87.4% day-1** (6,871/7,865), ownership stubs 100%.
   All six named "orphans" have an **exact price twin 3–21 days apart, every twin on the 1st**.
   ⚠️ `dedup_natural_key` already encoded that granularity: **the spine had been stating its own join
   key all along.** *Run the neighbouring key before believing an anti-join* — a ±31-day variant
   returned 0 for free.
2. **`property_id IS NULL` is not a dangling reference.** Dangling is **0 and structurally
   impossible** (`fk_pse_property … ON DELETE SET NULL`). The 321 are **376 NULL-link rows**, 321 of
   them detached in one bulk property deletion on 2026-04-03. ⚠️ I reproduced the brief's error
   first: **a `LEFT JOIN … WHERE prop_live = false` lumps NULL in with dangling.**
3. **`transaction_state` was never read.** The "$529.6M invisible to the spine" is **quarantine** —
   all three NULL-price twins are `needs_review`/`duplicate_superseded`,
   `exclude_from_market_metrics = true`. Population: **1,687 live twins · 7 quarantined ($604.1M) ·
   0 absent · 0 live twins with a NULL price.** The spine is complete and had already judged them.

### ⚠️ The filter that would have resurrected quarantined comps

The first propagator filtered its twin lookup to `transaction_state = 'live'` — the natural thing to
write. That made a **quarantined** twin invisible, so it fell through to `INSERT` and would have
minted a fresh **live** comp for a sale somebody deliberately excluded, straight into the Capital
Markets book. Caught by the live probe one pass before it mattered.

**The general rule: a filter that narrows a lookup to the rows you want to ACT on will hide the rows
that should STOP you.** Same shape as A5c's mint/probe asymmetry. A dedup probe must see the whole
population, including the excluded part.

### Also closed / re-scoped here

- **`B6c-feed` DONE** — the 45-day `property_sale_events` expectation is **retired, not resolved**
  (`is_active=false`, reason recorded). ⚠️ **The expectation moved rather than vanished:** feed
  `sales_transactions` is registered at 45 days and reads 10 days old, and this trigger is what makes
  operator sales reach it.
- **`B6c-orphan` re-scoped** — smaller and a different question: *what should happen to an event
  whose property was deleted?* Today: nothing, silently, forever.
- **`B6c-dup-dia` filed, NOT ported.** dia is **72 : 2**, not 77 : 0, and has real PSE consumers
  (`fn_listing_close_if_sold`). Both of the gov propagator's calibrated decisions — the
  month-truncation key and the quarantine gate — are **gov measurements** and must be re-derived.
