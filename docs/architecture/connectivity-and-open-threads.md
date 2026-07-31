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
| P1 | Second contact/owner sidebar + party-link chips + move contact fns off property | **OPEN** |
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

## 5. Doc trail (all linked from CLAUDE.md "Pointers to canonical docs")
- `property-owner-subsystem.md` + `property-owner-source-authority-and-doctrine.md`
- `access-scoping-and-my-work.md`
- `correspondence-ingestion-design.md`
- `property-tab-ux-review.md`
- **this file** (`connectivity-and-open-threads.md`) — the route-level status index.
