# Why Owner Addresses/Contacts Are Empty — Root Cause + Ingestion Build Plan

**Date:** 2026-05-21

## Root cause (the "why")
The sidebar **writer is fine** — `ensureRecordedOwner(name, address)` correctly parses + stores owner address (dia flat columns, gov `contact_info` jsonb) and there's even a field-priority rule that deed/county data outranks CoStar "since CoStar often shows the listing contact's mailing address rather than the legal owner's." Addresses/contacts are empty because the **authoritative source feeds aren't effectively running:**

| Feed | State | Why empty |
|------|-------|-----------|
| **SAM.gov** | works but tiny (127) + **unpropagated** | batch lookup runs (50/2h) but is underfed candidates; and the rich data it returns (address + points-of-contact) was never written into owners/contacts |
| **SOS filings** | **queued, never executed** | 461 gov + 1,235 dia rows stuck `queued`; gated on a paid OpenCorporates key, free SOS-direct scraper deferred → `registered_agent_name`/`manager_name`/`filing_id` = 0 |
| **County deed/assessor/tax** | barely (<4% dia) | county scraper not driven across the property set; deed grantee 509, assessor 24, tax-mailing 16 (dia) |
| **CoStar/sidebar** | names yes, addresses spotty | provides owner *name* reliably but the owner *address* only sometimes (and often the wrong listing-contact address) |

## Built this session (live)
- **`sam_propagate_to_owners()`** (gov) — reads `sam_entities` and writes owner addresses (`true_owners.contact_info.sam_address`) + creates **decision-maker contacts** from `points_of_contact`. First run: **210 contacts created, 126 owner addresses set.** Scheduled `45 */2 * * *` (after each SAM batch). Idempotent — scales automatically as SAM grows.

## To build (app code — can't run as SQL)

### 1. Feed SAM the right candidates (the GSA lever you flagged)
The `sam-entity-lookup` edge function only produced 127 — it isn't iterating the owner universe. **Point its candidate query at all `recorded_owners`/`true_owners` lacking a SAM match, prioritized by deal value, and especially the GSA lessor LLCs** (they're federal lessees → almost always SAM-registered). At 50/2h that drains thousands over weeks; raise the batch if the SAM API budget allows. The `sam_propagate_to_owners()` (built) then auto-fills owners/contacts as the pool grows.

### 2. SOS-direct scraper (drains the 1,700 stuck rows — the universal unlock)
Per-state SOS scraper (or sidebar-assisted) to populate `recorded_owners.registered_agent_name / manager_name / registered_agent_address / filing_id / state_of_incorporation`, draining `llc_research_queue`. This is the **prerequisite for the address matcher** (recorded-owner addresses) and the manager→true-owner→decision-maker chain. Write-back fires the existing resolution; mark `no_match` (visible) when SOS returns nothing — never leave `queued` silently (the coverage alert now catches a stalled queue).

### 3. County deed/assessor/tax ingest (dia backbone)
Drive `county_scraper` across the dia property set (county_authorities has the URLs); write deed grantee→recorded owner, grantor→prior owner (chain of title), tax-mailing owner+address→true-owner candidate. Schedule as a daily batch, capped, with coverage alerting.

### 4. Address-canonical matcher — sequenced AFTER #2/#3 (deliberately deferred)
I did **not** build this yet: verified that owner addresses are currently empty (`recorded_owners.normalized_address` is the empty string on all 1,455 rows; only 472 have any address; tax-mailing 0). It has **no fuel** until the SOS + county feeds above populate recorded-owner addresses. Once they do, build it to link recorded↔true↔unified owners sharing a normalized notice/mailing address (+ name-similarity confirm), feeding the review queue — not auto-merge. Building it now would link nothing.

## Sequence
1. ✅ SAM propagation (built + scheduled).
2. Feed SAM candidates (GSA lessors first) — app.
3. SOS-direct scraper — app (the keystone unlock).
4. County ingest scheduling — app.
5. Address matcher — after 3/4 give it fuel.
6. The `generate-research-tasks` route (separate spec) turns every remaining gap into a Next Best Action driving the manual research.

The coverage alerts built earlier now make the cost of each un-run feed visible (the SOS-stalled alert is already firing), so none of these can silently lapse again.
