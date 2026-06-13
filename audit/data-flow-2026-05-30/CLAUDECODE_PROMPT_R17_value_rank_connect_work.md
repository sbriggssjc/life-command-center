# Claude Code — R17: value-rank the connect-the-data work so the app guides research by dollars at stake

## Why (grounded live 2026-06-13)
The app guides the user to the right KIND of work (connect-the-data vs next-touch),
and the touch bands are value-ranked (R14 + `rank_annual_rent`). But the big
CONNECT bands are NOT value-ranked, so the app can't tell the user WHICH connection
matters most:
- **P0.4 (resolve ownership) = 543 rows, 59% rank-zero.**
- **P-CONTACT (select prospecting contact) = 325 rows, 99% rank-zero.**
Connect-work is ~87% of all surfaced work, so this is the larger half of "guide
where to spend time" — and it's currently unsorted by value. A user can burn
research time connecting a worthless owner while a high-value one waits.

**Why it's fixable:** the rank-zero connect entities lack a `lcc_entity_portfolio_facts`
edge (that's why `rank_annual_rent` is null), but they DO carry rich `owns` /
`purchases` / `leases` relationships to assets in `entity_relationships`, and those
assets have value in `lcc_property_attributes` (annual_rent / noi). The value exists;
it's just not joined into the connect-band rank.

## Build — extend the rank with a relationship-graph fallback
Add a `connected_property_value` fallback to the rank for the connect bands:
- For an entity with no `portfolio_facts` rent, compute the SUM of
  `lcc_property_attributes.annual_rent` (fall back to noi) over the assets the entity
  is linked to via `entity_relationships` (relationship_type in `owns`, `purchases`,
  `leases` — the ownership/control edges; exclude `brokers`/`sells` which are
  past/agency, and weight `owns` highest if you tier it). Map the related asset
  entity → its domain property via the existing asset↔property linkage
  (`external_identities` asset rows / `lcc_property_attributes`).
- Extend the enriched-view rank expression (the same `rank_annual_rent` COALESCE
  chain R11 built) with this as the next fallback tier:
  `rollup rent → representative-property rent → connected_property_value → NULLS LAST`.
  So P0.4/P-CONTACT rows that were rank-zero now rank by the dollars of property the
  owner actually controls.
- Keep it on the enriched view / cache-refresh side (where `rank_annual_rent` already
  lives), not the hot path — mirror R11's join pattern. Verify the items-page latency
  stays in budget (the relationship join is the one cost; bound it the way the
  portfolio join is bounded).

## Don't break
- Touch bands (P1-P8, P-BUYER) and their existing rank are UNCHANGED — they already
  rank by portfolio value; this only adds a fallback for the connect bands that were
  NULLS-LAST.
- Genuinely value-less entities (no portfolio, no representative property, no
  connected assets) still sort NULLS LAST — that's correct.
- Conservative on the relationship→property→value mapping: if an entity's connected
  asset can't be resolved to a property value, it contributes 0, not an error.
- dia/gov pipelines untouched.

## Secondary (optional, same round) — demote the junk-cleanup lane
`junk_entity_name` (746 open) is the single largest "work" item but is low-value
cleanup competing with revenue connect-work. Either rank it below the
ownership/contact connect-work in the Decision Center ordering, or batch-disposition
the R11-retyped artifacts so the lane reflects real decisions. Don't present it
peer-to-peer with high-value ownership resolution.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Verify live (read-only): P0.4 and
P-CONTACT rank-zero share drops sharply (entities with connected assets now carry a
value); a high-portfolio owner with no portfolio_facts edge but rich `owns` edges now
ranks near the top of P0.4 instead of NULLS-LAST; touch-band ranks byte-identical
pre/post.

## After deploy (Cowork verifies live)
- The connect bands sort by connected-property value; the operator sees the
  highest-value owners to resolve and the highest-value entities to find contacts for
  at the TOP, not buried. This completes the "guide where to spend time" doctrine —
  value-ranking now covers the ~87% of work that is connect-the-data, not just the
  touch side.
