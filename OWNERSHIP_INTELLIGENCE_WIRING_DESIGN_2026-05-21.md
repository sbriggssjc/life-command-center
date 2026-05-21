# Ownership Intelligence — Cross-Source Wiring Design

**Date:** 2026-05-21
**Goal:** a complete, gap-free chain from **property → recorded owner → true (beneficial) owner → decision-maker contact → Salesforce**, built by intelligently linking owners and addresses across every source (county, SOS, SAM, GSA, CoStar, RCA, research, Salesforce, Outlook), so every property resolves to a real person a broker can call.

---

## 1. Current state — where the chain breaks today (measured)

| Link in the chain | Government | Dialysis |
|-------------------|-----------|----------|
| property → recorded owner | 7,573 / 17,610 (**43%**) | 1,875 / 13,964 (**13%**) |
| property → true owner | 6,933 (39%) | 8,546 (61%) |
| recorded → true owner | partial | 3,490 / 3,552 (98%) |
| recorded owner → contact | 8,775 (58%) | — |
| **owner → Salesforce** | **225 recorded (1.5%) / 432 true (3%)** | **700 true (20%) / 367 contacts** |
| **registered agent / SOS filing / managers** | **0 / 0 / 0** | **1 / 0 / 0** |
| county deed grantee / assessor / tax-mailing owner | n/a (GSA-fed) | **509 / 24 / 16 (<4%)** |
| SAM.gov entities ingested | **127** | n/a |
| LLC/SOS research queue | **461 queued, 0 completed** | **1,235 queued, 0 completed** |
| canonical layer (`unified_contacts`) | gov only, **SF-only** (until today's owner wiring) | **does not exist** |

**Read:** the connective tissue is largely missing. SOS/registered-agent data is empty everywhere (research queued but never run). County/deed/assessor data — the dialysis backbone — is <4% populated. Owner→Salesforce links (the "property → decision maker" the brokers need) are 1.5–20%. Over half of gov properties and 87% of dia properties have no recorded owner at all. The canonical entity hub only exists on gov and only held Salesforce until today.

---

## 2. Target chain & the hub

```
property ──► recorded_owner (who is on title / the lessor)
                 │  name + mailing address
                 ▼
            true_owner (beneficial / sponsor)  ◄── SOS managers/members, SAM officers
                 │
                 ▼
        decision-maker contact(s)  ◄── SF, Outlook, research, registered agent
                 │
                 ▼
      unified_contacts (canonical hub, unified_id)  ──►  Salesforce account + contact
```

`unified_contacts` is the hub: one `unified_id` per real-world entity/person, carrying `gov_contact_id, dia_contact_id, recorded_owner_id, true_owner_id, sf_account_id, outlook_contact_id`. Today's work wired gov recorded_owners in (13,111). **First structural decision:** make `unified_contacts` a single cross-domain table (recommend on LCC Opps) and create it for dia (it doesn't exist there) — otherwise gov and dia build divergent graphs and the cross-domain `gov_contact_id`/`dia_contact_id` columns stay meaningless.

---

## 3. Source-by-source wiring

### 3a. Government — the GSA-expedited path (high automation)
- **GSA lease inventory** (`gsa_leases.lessor`) → `recorded_owner`. The lessor is the recorded owner; this is the fastest way to lift gov property→owner from 43% toward ~100%. Wire a linker: for each property with a `lease_number`, set/seed `recorded_owner` from the GSA lessor (canonical-key dedup via `resolve_company`).
- **SAM.gov** (`sam_entities`, currently 127 — expand the ingest): entity registration carries the registered agent, POCs, and officers → decision-maker contacts + true-owner signal. Match `sam_entities` → owner by canonical name/EIN/address; populate `recorded_owners.registered_agent_name` and create contacts for POCs.
- **USASpending / federal_lease_awards**: the awardee entity corroborates the lessor and gives a UEI to join SAM.

### 3b. Dialysis — the manual-research path (the big gap)
- **County records** (deed grantee/grantor, assessor owner, tax-mailing owner): the deed grantee = recorded owner; the **tax-mailing owner/address is often the true owner or its manager** (where the bill is sent). Currently <4% populated — this is the highest-value dia fix. Drive the county scraper to cover the dia property set and write `latest_deed_grantee`→recorded_owner, `tax_mailing_owner`→true-owner candidate.
- **SOS filings** (both domains): registered agent + managers/members → true owner + named decision makers. **This is the universally-empty gap.** The `llc_research_queue` has 461 gov + 1,235 dia rows stuck because the enrichment was gated on a paid OpenCorporates key and the free SOS-direct scraper was deferred. Build the SOS-direct scraper (per-state) to drain the queue into `recorded_owners.registered_agent_name / manager_name / filing_id`.
- **CoStar / RCA**: sidebar capture already yields recorded/true owner on some deals; RCA gives buyer/seller + sponsor intelligence. Feed both through `resolve_company` so they attach to the canonical entity rather than creating new rows.

### 3c. Salesforce + Outlook — the decision-maker rolodex
- `unified_contacts` already holds 16,990 SF identities. **Link entities → SF accounts** (`sf_account_id`) so a resolved owner maps to an existing SF account; **create SF accounts** for owners with no SF match (push via `sf_push`). Attach decision-maker **contacts** (people) to the entity. Outlook engagement (`last_email_date`, `total_touches`) tells you which decision makers you actually know.

---

## 4. The matching engine (how links get made)

Two complementary keys, both already partly built:
- **Name:** `resolve_company()` (deployed today) — canonical key (strip legal suffixes) + trigram similarity, with the federal anti-pattern guard. For people, `resolve_contact()` (email/phone/name tiers).
- **Address:** normalized-address match. This is the lever the request specifically calls out — two owners (recorded vs true, or across deals) sharing a **notice/mailing address** are very likely the same sponsor even when names differ ("ABC Propco I LLC" + "ABC Propco II LLC" at one address). Add an address-canonical key and a matcher that links recorded→true and entity→entity on shared address, then confirms with name similarity.

Both feed `unified_contacts` as the single hub; conflicts/low-confidence go to a **review queue** (the pattern used today: 1,847 owner matches parked, not force-linked).

---

## 5. No-slip-through controls (so nothing stays unlinked silently)

1. **Drain the research queues.** 461 gov + 1,235 dia rows have sat `queued` with 0 completed — build the SOS-direct scraper (the deferred item) and make the `lcc-llc-research-tick` actually process them; alert if queue depth grows or completion rate is 0.
2. **Coverage metrics + alerts.** A scheduled rollup of: % property→recorded, % →true, % owner→SF, % owners with registered agent, queue depth. Alert (via the existing `lcc_notify_health_alerts_teams`) when any coverage metric drops or a research queue stalls — this is what would have caught the empty-SOS gap months ago.
3. **A "needs-owner-research" worklist** for properties with no recorded owner (57% gov / 87% dia) and owners with no decision-maker, so the manual dia effort is targeted, not ad hoc.
4. **Bidirectional SF sync confirmation** — every resolved entity should end with a populated `sf_account_id` or a `created-in-SF` flag; report the residual.

---

## 6. Scheduling (aligned with the propagation/scheduling review)

All of the above run as **incremental, low-frequency** ticks (15–30 min or post-ingestion), each capped (≤200–500/tick) and staggered off shared minute marks — never the every-minute pattern that broke the dia linker. Order per tick: county/SOS/SAM enrich → `resolve_company` unify → address cross-match → SF link. A nightly coverage-rollup feeds the alerts in §5.

---

## 7. What's already built vs to-build

**Built this session:** `resolve_company()` + `company_canonical_key()` + anti-pattern guard; gov recorded_owner → `unified_contacts` wiring (13,111 linked) + incremental cron; owner/true-owner dedup (DQ-5).

**To build (engineering):**
1. `unified_contacts` cross-domain decision + create on dia.
2. GSA lessor → recorded_owner linker (gov quick win).
3. **SOS-direct scraper** to drain the research queues (biggest universal gap).
4. County deed/assessor/tax-mailing ingestion coverage for dia.
5. SAM ingest expansion + officer→contact extraction.
6. Address-canonical matcher (recorded↔true↔entity on shared address).
7. SF account link/create for resolved entities + decision-maker contact attach.
8. Coverage-metric rollup + alerts (the no-slip-through layer).

*Design only. Grounded in the measured current state above. Companion fixes for the broken auto-links are in `AUTO_LINK_FIXES_2026-05-21`.*
