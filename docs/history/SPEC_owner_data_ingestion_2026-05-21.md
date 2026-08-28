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
The `sam-entity-lookup` edge function only produced 127 — it isn't iterating the owner universe. **Point its candidate query at all `recorded_owners`/`true_owners` lacking a SAM match, prioritized by deal value, and especially the GSA lessor LLCs** (they're federal lessees → almost always SAM-registered). ~~At 50/2h that drains thousands over weeks; raise the batch if the SAM API budget allows.~~ The `sam_propagate_to_owners()` (built) then auto-fills owners/contacts as the pool grows.

> **⚠️ SUPERSEDED 2026-08-20 — the key is VALID; the constraint is a RATE LIMIT, and "raise the batch" is not
> available.** (This spec never claimed a `401 API_KEY_INVALID`; the correction is recorded here because the
> feed-widening it prescribes was implemented and is throttled at the source, and because the feed table above
> reads SAM as "works but tiny + unpropagated" when the real ceiling is the quota.) Live evidence: 281
> `sam_entities` (53 in the last 30 days), 497 contacts with `data_source='sam'`, owners stamped `sam_checked`
> as recently as 2026-08-19. Per GSA's published tier table a non-federal personal key with **no role** gets
> **10 requests/day** (with a role: 1,000). The cron asks for 50 lookups × 12 runs/day and **~10–23 owners
> actually get checked** — one run burns the daily allowance and the other eleven no-op; a live probe returns
> `{"rate_limited":true,"api_calls":0,"next_access":"…00:00Z"}` and stops on the first owner. Raising the batch
> size therefore changes nothing; only a key with a role, or the bulk path below, does. The fail-soft design
> (an API error skips the `sam_checked` mark so the owner retries) makes a ~98% rate-limited pipeline
> indistinguishable from a healthy slow one — **measure `sam_checked` stamps per day, never "is the cron
> active".** Bulk alternative built 2026-08-20: the PUBLIC MONTHLY entity extract is ONE request covering all
> registrants (`GovernmentProject/src/ingest_sam_public_extract.py` + `gov_match_sam_public_extract`),
> carrying POC name+title but NOT email/phone (FOUO, federal-account-only). See
> `GovernmentProject/docs/RUNBOOK_sam_public_extract_cron.md`.

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
