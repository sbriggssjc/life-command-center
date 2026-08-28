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

**This file is the LIVING DOCUMENT for the chain.** Current state is §4e–§4h; everything else on the
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
`C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE`.
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

### 👤 Tranche two — ⚠️ SUPERSEDED BY §4i.4 above, which owns this decision. Kept for its detail only; if the two differ, §4i.4 is authoritative.

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

### Still not measured (C2e §8)

Whether a resolved owner converts to a call · search/UI cost of +3.2% entities · the **3,362 gov
properties with no `true_owner_id`** (54% of the non-resolving residue, the largest remaining lever,
a gov-side capture question) · ⚠️ **public-body counts are LOWER BOUNDS** — `lcc_looks_like_person`
returns true for `CITY OF SALEM` and `BROOME COUNTY` (the A3/P196 two-capitalised-token false
positive), and no second classifier was written, deliberately.
