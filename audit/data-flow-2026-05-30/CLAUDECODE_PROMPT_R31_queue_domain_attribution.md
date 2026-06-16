# Claude Code — R31: fix priority-queue domain attribution (dia parity is real, the filter hides it)

## Why (grounded live 2026-06-16 — see AUDIT_dia_parity_2026-06-16.md)
dia is well-represented in the value-ranked queue when measured by the entity's own domain
(~547 rows: 319 P0.4, 125 P7, 63 P0.5, 9 P-BUYER, …) — on par with gov (~736). But the
queue's **domain filter** keys on `source_domain`, which is **NULL on every owner-entity
row** (P0.4/P0.5/P-CONTACT/P-BUYER/most P7 — these are keyed by entity, not a domain
property). So:
- Operator console "Dialysis" tab shows ~**37** of the true ~**547** dia rows.
- "Government" tab likewise hides its owner-level rows (~448 of ~736).
- MCP `get_queue_summary` domain filter (R30) inherits the same `source_domain` predicate.

The bulk of ownership-resolution + cadence work is invisible to a domain filter. This is the
single thing that makes dia *look* underserved when it isn't.

## The fix — attribute each queue row to the entity's domain when the property domain is null
- In `v_priority_queue_enriched` (or `lcc_priority_queue_resolved`, wherever the consumers
  read), add a column **`effective_domain = COALESCE(source_domain, e.domain)`** by joining
  `entities e ON e.id = entity_id`. Keep `source_domain` as-is (don't break existing
  readers); ADD the new column (CREATE OR REPLACE appends at the end — the R7 rule).
  `entities.domain` carries `dia`/`gov`/`cre`/`lcc`; map `lcc` to null/no-domain so internal
  entities don't mis-tag.
- Repoint the domain filter to `effective_domain` in BOTH consumers:
  - `api/admin.js handlePriorityQueueList` (operator console Dialysis/Government tabs) —
    accept `dia`/`dialysis` and `gov`/`government`, filter on `effective_domain`.
  - the MCP server `get_queue_summary` (R30) domain filter.
- The materialized `lcc_priority_queue_resolved` is refreshed by `lcc_refresh_priority_queue_resolved()`
  — if `effective_domain` is added to the resolved cache, make the refresh populate it and
  `ANALYZE` (R7 pattern). Keep it cache-or-live-safe (empty/null ⇒ current behavior).

## Guards / house rules
- Additive view column + filter repoint; no band logic changes — band counts/membership must
  be byte-identical (verify the 12 bands' counts unchanged pre/post). ≤12 `api/*.js`;
  `node --check`; suite green. DB migration additive + cache-or-live-safe.
- Don't double-count: a row has exactly one `effective_domain`; the all-domains view is
  unchanged.

## Verify live (after deploy)
- Priority-queue "Dialysis" filter returns ~547 (not 37); "Government" returns ~736 (not
  448); "All" unchanged (~1,283). Band membership for All identical to today.
- MCP `get_queue_summary(domain:"dialysis")` returns the real dia bands (P0.4≈319, P7≈125),
  not ~37.

## Secondary (ASSESS-ONLY, not a code change yet)
dia transaction bands are sparse (P1 new-listing=0, P3 sale=1) because `lcc_listing_events`
dia=39 total. Before treating this as a wiring gap, check dia `available_listings` /
`sales_transactions` → `lcc_listing_events` sync completeness vs the gov leg. If dia events
are genuinely few (hold-heavy net-lease market), it's correct and needs no fix; if the dia
sync is dropping events, that's a separate round. Report which — don't change the sync in
R31.

## Bottom line
dia already has real parity in the data + queue; R31 makes the operator's domain filter
SHOW it (the ~547 dia footprint instead of 37). One additive view column + a filter repoint
in two consumers.
