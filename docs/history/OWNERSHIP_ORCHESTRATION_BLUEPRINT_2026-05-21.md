# Ownership Intelligence — Orchestration Blueprint

**Date:** 2026-05-21
**Builds on:** `OWNERSHIP_INTELLIGENCE_WIRING_DESIGN_2026-05-21.md` (the gap map + source roles).
**This doc:** the operational wiring — what is imported, when, from where, where it lands, **what triggers fire thereafter**, how it links to Salesforce/LCC, how the full chain of title to the developer is tracked, and how LCC's Next Best Action drives the research that fills every remaining gap.

---

## 1. The loop (one sentence)

> Each source **ingests** owner names + addresses → a **resolver** matches them to a canonical entity (`unified_contacts`) by name **and** address → **triggers** propagate the link to the property, extend the chain of title, and link to Salesforce → a **gap detector** turns anything still missing into a prioritized **research task** that becomes the broker's Next Best Action → completing that task feeds the next ingest. Nothing unlinked is allowed to sit silently.

```
SOURCES ─► STAGING/RAW ─► RESOLVE (name+address) ─► unified_contacts (hub)
   │                                                      │
   │                                          AFTER triggers fire:
   │                            propagate→property · extend chain_of_title · link→Salesforce
   ▼                                                      ▼
GAP DETECTOR  ◄──────────────────────────────────  coverage shortfalls
   │  creates research_tasks (priority)
   ▼
LCC NEXT BEST ACTION  ─► broker/sidebar action ─► (back to SOURCES)
```

---

## 2. Ingestion contracts — what / when / where / from / triggers-thereafter

| Source | Cadence | What it brings | Lands in | Triggers / cascade thereafter |
|--------|---------|----------------|----------|-------------------------------|
| **GSA lease inventory** | quarterly (gov) | landlord **LLC (lessor)** per lease, lease #, address | `gsa_leases.lessor` → seed `recorded_owners` + `properties.recorded_owner_id` | new recorded owner → `resolve_company` → if unmatched, **research_task: "SAM-lookup landlord LLC"**; property→owner coverage metric updates |
| **SAM.gov** | weekly + on-demand from a GSA-owner task | entity registration: **registered agent, officers/POCs, mailing + physical addresses, UEI** | `sam_entities`; → `recorded_owners.registered_agent_name`, officer **contacts** | officer rows → `contact_auto_link` → `unified_contacts`; entity → `true_owner` candidate; address added to address-match index |
| **CoStar / RCA sidebar pull** | per capture (event) | **recorded owner + true owner + mailing addresses from multiple panels** (deed, public-record, ownership, sale history) | `recorded_owners`, `true_owners`, `properties`, `sales_transactions`, `ownership_history` | `propagate_sale_to_property`, `propagate_ownership_to_property`, `close_listing_on_sale`, cap-rate snapshot; new owner/address → `resolve_company` + address-match → unified; chain-of-title extended |
| **SOS filings** (scraper / sidebar / manual) | incremental tick (drains `llc_research_queue`) | **registered agent, managers/members, filing #, principal address** | `recorded_owners.registered_agent_name / manager_name / filing_id / state_of_incorporation` | manager/member names → **contacts** → `unified_contacts`; resolves recorded→**true** owner; closes the "no decision-maker" gap |
| **County records** (deed/assessor/tax) | incremental (dia priority) | deed **grantee** (=recorded owner), **grantor** (prior owner), **tax-mailing owner+address** (often the true owner), assessor owner | `properties.latest_deed_grantee/grantor`, `tax_mailing_owner`; `ownership_history` rows | deed event → `ownership_history` insert → `propagate_ownership_to_property` → property owner updated + **chain-of-title extended** one link |
| **Salesforce** | bidirectional sync | existing **accounts (entities)** + **contacts (decision makers)** + relationship/engagement | `unified_contacts.sf_account_id`, contacts | resolved entity with no `sf_account_id` → **research_task / auto-create SF account** (`sf_push`); decision-maker contacts attached |
| **Outlook / calendar** | sync | who we actually know + last touch | `unified_contacts.outlook_contact_id`, engagement fields | raises NBA priority for entities where we already have a warm contact |

> **⚠️ SAM.gov row — SUPERSEDED 2026-08-20. The key is VALID; the constraint is a RATE LIMIT.** (This
> blueprint never carried the `401 API_KEY_INVALID` claim that circulated elsewhere; the correction is
> recorded here because the "weekly + on-demand from a GSA-owner task" cadence — and the "SAM enrichment
> tick, every 2h" row in §5 — assume a throughput that does not exist.) Live evidence: 281 `sam_entities`
> (53 in the last 30 days), 497 contacts with `data_source='sam'`, owners stamped `sam_checked` as recently
> as 2026-08-19. Per GSA's published tier table a non-federal personal key with **no role** gets **10
> requests/day** (with a role: 1,000). A live probe returns
> `{"rate_limited":true,"api_calls":0,"next_access":"…00:00Z"}` and stops on the first owner, so an
> on-demand `owner_needs_sam` task cannot be serviced promptly. The fail-soft design (an API error skips the
> `sam_checked` mark so the owner retries) makes a ~98% rate-limited pipeline indistinguishable from a
> healthy slow one — **measure `sam_checked` stamps per day, never "is the cron active".** Bulk alternative
> built 2026-08-20: the PUBLIC MONTHLY entity extract is ONE request covering all registrants
> (`GovernmentProject/src/ingest_sam_public_extract.py` + `gov_match_sam_public_extract`) — it carries POC
> name+title but **NOT email/phone** (FOUO, federal-account-only), so the "officer rows → contacts →
> unified_contacts" cascade above lands names, not reachable lines. See
> `GovernmentProject/docs/RUNBOOK_sam_public_extract_cron.md`.

**Already-firing triggers we build on** (gov, confirmed): `propagate_ownership_to_property`, `propagate_sale_to_property`, `close_listing_on_sale`, `contact_auto_link_before/after`, cap-rate snapshots, `stamp_ingestion_log`. **To add:** an AFTER-insert/update trigger on `recorded_owners`/`true_owners` that calls `resolve_company` and, on no-match, enqueues a research task (today owner resolution is batch-only).

---

## 3. The resolution + linking layer (the hub)

- **Canonical hub:** `unified_contacts` (one `unified_id` per real entity/person), carrying `gov_contact_id, dia_contact_id, recorded_owner_id, true_owner_id, sf_account_id, outlook_contact_id`. *(Decision pending: make it one cross-domain table on LCC; create it for dia where it doesn't exist.)*
- **Two match keys, always run together:**
  1. **Name** — `resolve_company()` (canonical key + trigram, deployed) for entities; `resolve_contact()` for people.
  2. **Address** — a normalized-address key. Two owners sharing a **notice/mailing address** are linked as the same sponsor even when names differ ("ABC Propco I/II LLC"). Address is the bridge from a **recorded** owner (title) to the **true** owner (where the tax bill / SOS notices go).
- **Link rule:** exact name OR exact address → auto-link; name **and** address agree → high confidence; one-only or fuzzy → **review queue** (the pattern already in use — 1,847 owner matches parked, not force-linked). No silent auto-merge of ambiguous entities.

---

## 4. Chain of title — back to the developer, on every property

**Model:** `ownership_history` is the temporal spine — one row per transfer, ordered by date, `prior_owner → new_owner` (gov) / dated owner spans (dia), each ideally tied to a `sale_id`/deed. Read newest→oldest, the chain walks back through every recorded owner to the **original developer** (first-generation owner / build-to-suit sponsor).

**How it stays complete:**
- Every deed (county) and every CoStar/RCA sale-history panel inserts an `ownership_history` row → `propagate_ownership_to_property` updates the current owner and the chain gains a link.
- **Chain continuity check** (DQ-4, now measurable on canonical `unified_id`): seller of transfer N should equal buyer of transfer N-1. A break = a **missing link** in the chain.
- **Gap types the detector flags per property:** (a) no recorded owner; (b) chain doesn't reach a first-generation/developer owner; (c) a break (seller≠prior buyer) = a hidden intermediate transfer to research; (d) recorded owner with no resolved true owner; (e) true owner with no decision-maker contact; (f) entity with no Salesforce link.

---

## 5. Next Best Action — the gap-filling engine (the keystone, currently unbuilt)

`research_tasks` and `action_items` exist with the right shape (`research_type, entity_id, domain, priority, source_table, instructions`) but are **empty** — nothing generates them. This is what closes the loop.

**Build a `generate_ownership_research_tasks()` rollup** (nightly + incremental) that scans the gap types in §4 and emits prioritized `research_tasks`, e.g.:
- `property_missing_owner` → "Pull recorded owner for <property> (county/CoStar)"
- `chain_of_title_break` → "Find the transfer between <ownerA> and <ownerB> on <property>"
- `owner_needs_sos` → "SOS lookup <LLC> for registered agent/managers" (also drains `llc_research_queue`)
- `owner_needs_sam` → "SAM lookup <GSA landlord LLC>"
- `entity_needs_salesforce` → "Link/create SF account for <entity>"
- `owner_no_decision_maker` → "Identify principal for <true owner>"

**Prioritization:** weight by deal value / active listing / firm-term / how warm the SF relationship already is — so brokers research the owners that matter first. **Surfacing:** these become the LCC Next Best Action list (and feed the daily briefing). **Closure loop:** completing a task (sidebar ingest, SOS pull, SF link) writes the data → the resolver/triggers fire → the gap detector marks the task resolved and re-scores. A task is never silently dropped; if a source returns nothing, it's marked `no_match` (visible), not abandoned.

---

## 6. Timing summary (aligned to the scheduling review — incremental, staggered, capped)

| Step | Cadence |
|------|---------|
| GSA inventory ingest | quarterly |
| SAM enrichment tick | every 2h (existing) + on-demand from tasks |
| SOS / LLC research tick (drain queue) | every 30 min, capped 200 |
| County deed/assessor ingest (dia) | daily batch + on-demand |
| `resolve_company` / address match / owner→unified | every 15–30 min (the `unify-owners-incremental` cron, extended) |
| Salesforce link/push | every 30 min |
| **Gap detector → research_tasks** | nightly full + 30-min incremental |
| Coverage-metric rollup + alerts | nightly (Teams) |

No every-minute jobs; everything caps per tick and runs through the pooler (per the connection-exhaustion lesson).

---

## 7. Controls so nothing slips through

1. Every gap type in §4 has a corresponding research-task generator rule → no gap is invisible.
2. Coverage metrics (% property→owner, →true, →decision-maker, →SF; chain-completeness %; queue depth) roll up nightly and **alert on regression** via the existing Teams push — the layer that would have caught the empty-SOS / broken-auto-link problems months ago.
3. Research queues must show non-zero completion; a stalled queue (today: 461 gov + 1,235 dia) raises an alert.
4. The chain-of-title break count is a tracked KPI, trending toward zero as research closes intermediate-transfer gaps.

---

## 8. Build sequence (depends-on order)

1. Decide `unified_contacts` home (cross-domain on LCC) + create on dia.
2. AFTER-trigger on `recorded_owners`/`true_owners` → `resolve_company` + enqueue-on-no-match.
3. GSA lessor → recorded_owner linker (gov quick win) → SAM lookup tasks.
4. **SOS-direct scraper** to drain the research queues (the universal empty gap).
5. County deed/assessor coverage for dia.
6. Address-canonical matcher (recorded↔true↔entity).
7. Salesforce link/create for resolved entities.
8. **`generate_ownership_research_tasks()` + NBA surfacing** — the keystone that drives 3–7 to completion.
9. Coverage rollup + alerts.

*Design/blueprint only — grounded in the live schema, triggers, crons, and table states observed. No code or data changed in producing it.*
