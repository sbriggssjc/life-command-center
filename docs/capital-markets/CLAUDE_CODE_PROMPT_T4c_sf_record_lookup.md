# Claude Code prompt — T4c: ID-based SF record lookup worker (recover the ~560 the broad crawl can't reach)

> The broad PA Comp crawl is exhausted: the `Get Comps` tenant-keyword filter
> (`Tenant_Name2__c contains(Dialysis/DaVita/Fresenius/…)`) tops out at **674 comps**, and two full
> crawls did NOT grow it — the **~560 still-held SF-linked comps don't match the keyword filter** and are
> unreachable that way. The fix (Scott's design) is an **ID-based lookup**: LCC sends the exact comp IDs
> it's missing, SF returns `On_Market_Date__c`, LCC backfills. This prompt builds the LCC side. The PA
> "SF → LCC: Record Lookup by ID" flow is built separately by Scott (`PA_FLOW_SF_RECORD_LOOKUP_BUILD.md`);
> its HTTP URL goes in env `SF_RECORD_LOOKUP_URL`. Runs server-side (the flow holds the SF OAuth).
> Reversible; reuses the existing harvest + `lcc_apply_on_market_backfill`. dia `zqzrriwuavgrquhisnoa`,
> gov `scknotsqkcheojiaewwh`, LCC Opps `xengecqvemvfknjvbvrq`.

## Grounded state (2026-06-24)
- Sync root cause fixed (`Get_Deals` OData `IN`→`eq`); broad crawl captured **674 comps / 555 OMD** into
  `lcc_sf_comp_on_market`; **~91 held listings backfilled** (`source='sf_on_market_date'`, tags
  `t4c_recovery` + `t4c_recovery_crawl`). Remaining held-SF-linked-but-uncovered ≈ **560** (dia ~300 /
  gov ~260) — their comp IDs are known from the intake link but their comps aren't in the retained map.
- **This connector's filter is OData** (`eq`/`gt`/`contains`/`or`) — **no `IN`** (that was the Get_Deals
  bug). So an ID lookup must use an `Id eq 'x' or Id eq 'y' …` chain, NOT `Id IN (…)`.

## The contract (LCC ↔ the PA lookup flow)
LCC POSTs to `SF_RECORD_LOOKUP_URL` with a **pre-built OData filter** (LCC owns the string so the PA flow
stays trivial + the syntax is unit-tested here, not hand-built in PA):
```json
POST {SF_RECORD_LOOKUP_URL}
{ "object_type": "Comp__c",
  "fields": "Id,On_Market_Date__c,CreatedDate",
  "filter": "Id eq 'a1Y…' or Id eq 'a1Y…' or …",
  "request_id": "<uuid for idempotency/logging>" }
```
Response: `{ "records": [ { "Id": "a1Y…", "On_Market_Date__c": "2026-01-22", "CreatedDate": "…" }, … ] }`.

## Build (LCC, ≤12 api/*.js — sub-route of an existing handler or a worker)
1. **Compute the missing-ID set.** The comp IDs linked to still-held listings
   (`on_market_date_source='unestablished'`) via the existing chain (held `available_listings` →
   `promotion_listing_id` → `staged_intake_items.seed_data.sf_entity_id`) MINUS the IDs already in
   `lcc_sf_comp_on_market`. (A `v_lcc_missing_comp_ids` view alongside `v_lcc_on_market_backfill_map` is
   the clean way.) De-dupe; these are the ~560.
2. **Batch + build the OData filter in JS** — chunk IDs to ≤100/batch (filter-length safe), build
   `Id eq '…' or Id eq '…'` (single-quote SF ids never contain quotes, but escape defensively), POST each
   batch to `SF_RECORD_LOOKUP_URL`. Bounded concurrency, time-budgeted.
3. **Upsert returned records into `lcc_sf_comp_on_market`** (the same retained map the harvest writes —
   reuse its upsert), so the dates land prune-proof and the existing `v_lcc_on_market_backfill_map` picks
   them up automatically.
4. **Re-run the backfill** — call the existing reversible `lcc_apply_on_market_backfill(payload, false,
   't4c_recovery_lookup')` per domain (fill-held-only, idempotent, logged). Report dia/gov updated counts
   + the still-missing residual.
5. **Endpoint:** GET = dry-run (compute the missing-ID count + would-fetch, no POST), POST = drain
   (fetch + backfill). Feature-flagged on `SF_RECORD_LOOKUP_URL` (no-op + clear message when unset, like
   the existing `SF_LOOKUP_WEBHOOK_URL` pattern). Secure the call with a shared-secret header the PA flow
   validates.

## Reusability (Scott's "drive to the middle")
Keep `object_type` + `fields` as parameters so the SAME worker + flow serve property / listing / company
lookups later — LCC computes which IDs it needs for any object and fetches exactly those. v1 target is
`Comp__c.On_Market_Date__c`; don't hardcode it so the path generalizes.

## Gate
- Dry-run reports the missing-comp-ID count (~560) + batch plan. After a drain: most of the ~560 resolve
  an `On_Market_Date__c` (SF's ~97% coverage), land in `lcc_sf_comp_on_market`, and the backfill dates the
  corresponding held listings (real spread dates, reversible under `t4c_recovery_lookup`). Residual (comps
  SF has no OMD for, + the ~1,882 listings with NO comp link) reported, held, never fabricated.
- `synthetic_from_sale` / `master_curated` / curated untouched; published history unchanged (writes
  `on_market_date` only — the Item-3 timing-view repoint is the separate next gate). ≤12 api/*.js. Suite
  green. Reversible (drop the lookup batch from the backfill log; `SF_RECORD_LOOKUP_URL` unset ⇒ inert).

## Boundaries
ID-based fetch only (no tenant-keyword reliance); OData `eq`/`or` (never `IN`); fill-held-only; reuse the
retained map + existing backfill; hold the genuinely-uncovered; reversible; no fuzzy matching; the
timing-view repoint is the next gated step, not this one.
