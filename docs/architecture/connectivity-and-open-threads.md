# LCC — Connectivity Map + Open Threads (state as of 2026-07-31)

The pick-up-quickly handoff for future chats. Covers where each ingestion/reconciliation route stands,
what's live vs connector-gated, and every open gap through the **email / phone / Salesforce** routes.
Cross-references the per-topic design docs in `docs/architecture/`.

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
Of **1,905** `touchpoint_cadence` rows: **1,728 (91%) never touched**, **1,803** overdue < 90 days (a bulk
stamp that went stale), 68 overdue > 1 yr (oldest due **2021-09-06**), only **23** due in the future, only
**7** carrying `owner_user_id` (the documented producer gap → the ROE line on the owner card is blank).
- **94 of the unreachable owners are already on a cadence** — we are "prospecting" 94 parties we have no way
  to contact. A cadence with no contact method is un-actionable work by construction, and it is exactly what
  the Consumption-Layer doctrine says must be value-gated at the producer.
- **Data defect:** 3 rows carry `last_touch_at` **in the future** (max `2026-10-15`). A completed touch
  cannot be in the future — a writer is stamping a scheduled date into the completed-touch column.

### BREAK-3 — owner resolution coverage (severity: MEDIUM, known, improving)
35.9% of assets carry a reconciled owner — real progress against the 2026-07-31 audit (102 of 4,837 ≈ 2%),
but 2,490 assets still fall back to "Unresolved" in the header. The feeders specified as P0.2 (own-deal buyer
→ owner evidence) and P0.3 (county deed) in `property-tab-ux-review.md` are still the highest-leverage
remaining work.

**Re-measure:** the SQL for every number above is in `panel-redesign-verification.md` §3.2.

## 5. Doc trail (all linked from CLAUDE.md "Pointers to canonical docs")
- `property-owner-subsystem.md` + `property-owner-source-authority-and-doctrine.md`
- `access-scoping-and-my-work.md`
- `correspondence-ingestion-design.md`
- `property-tab-ux-review.md`
- **this file** (`connectivity-and-open-threads.md`) — the route-level status index.
