# Claude Code — R15: generic CRE property registry (the "high-value middle" for non-dia/gov assets)

## Why (doctrine, decided 2026-06-11)
LCC is two vertical engines — dialysis (CMS data) and government-leased (GSA data) —
but the PROPERTIES SharePoint tree is Briggs' WHOLE book: office (Vervent, Vistra),
retail, bank (Santander), entertainment (Top Golf), MOB, etc. ~84% of enrich docs
are these other classes; today they correctly PARK (`skip_reason=
'out_of_domain_asset_class'`) because they have no home DB. Decision: build the
**high-value middle** — a lightweight generic CRE registry so the BD spine
(entities → queue → cadence → ownership → document-connection) covers these owners,
WITHOUT building a third deep underwriting engine.

**The value is the OWNER, not the underwriting.** Briggs' biggest owners/developers
often span asset classes; capturing their office/retail assets completes the
relationship's portfolio picture. What we DON'T build: asset-class scoring, cap-rate
frameworks, or CMS/GSA-style enrichment (no public-data equivalent exists for
office/retail — these are relationship-tracked, not underwritten). That scope
boundary is the whole point of "middle."

## Scope (grounded live 2026-06-11, partial — crawl still descending)
58 out-of-domain docs across ~25 tenant brands so far; the full universe is larger
once the PROPERTIES crawl completes. So design for the steady-state flow, not a
one-time batch.

## Architecture — a third lightweight domain, reuse everything above the property layer

### 1. The store (LCC Opps, additive)
`lcc_cre_properties` — minimal property record for non-dia/gov assets:
`id, address, city, state, tenant_brand, asset_class (text, e.g. office/retail/
bank/entertainment/mob/unknown), owner_entity_id (FK→entities), source_path,
created_at, updated_at`, with a natural-key dedupe on `(normalized_address, state)`
(fall back to `(tenant_brand, city, state)` when no address yet). NO scoring/NOI/
cap-rate columns — deliberately. Plus `lcc_cre_property_documents` (or reuse a
generic doc-attach shape) linking docs to the CRE property, mirroring the dia/gov
`property_documents` the enrich path already writes.

### 2. The flow — extract → register → connect (reuse the OM pipeline)
Out-of-domain docs currently PARK. Instead, route them through the EXISTING
extractor (the OM/master-sheet extractor already pulls address + owner + tenant),
then a NEW lightweight promoter branch writes to the CRE registry instead of
dia/gov:
- **Match-or-create** an `lcc_cre_properties` row by the natural key (path anchor
  gives tenant/city/state; extraction adds address). Fill-blanks-only.
- **Owner → entity**: resolve/create the owner ENTITY in the existing graph
  (`ensureEntityLink`, the same machinery dia/gov use), set
  `cre_properties.owner_entity_id`, and tag the entity so the queue/cadence treat
  it like any other owner. This is the BD payoff — the owner relationship becomes
  first-class.
- **Attach the doc** to the CRE property (+ `field_provenance`
  `source='folder_feed_cre'`).
- Keep the junk/anti-pattern guards (`isJunkEntityName`, federal anti-pattern,
  implausible-person) — they're domain-agnostic.

Phase this if needed: **Phase 1** = the store + register-by-path (tenant/city +
docs attached, owner via extraction where the master sheet has it); **Phase 2** =
backfill owner extraction for rows that registered without one. Phase 1 alone
delivers the connected document set + the owner entity for most docs.

### 3. The BD spine picks it up for free
Because owners become normal `entities`, they flow into the existing priority
queue, cadence, Decision Center, and context packets with NO per-band changes —
EXCEPT confirm the band predicates don't assume dia/gov. Audit the queue's
property-trigger bands (P1/P3/P5/P8) + portfolio rollups: a CRE owner has no
dia/gov `lcc_property_attributes` row, so it should simply not appear in
property-driven bands (no rent/lease data) but SHOULD appear in relationship bands
(P0.4/P0.5/P-CONTACT/cadence). Verify a CRE-only owner doesn't crash or rank-zero-
pollute the value-ranked bands (it has no `rank_annual_rent` — same NULLS-LAST
treatment as the property-less relationship entities, which is correct).

### 4. Context packet
Extend the property packet assembler to serve `lcc_cre_properties` (a CRE
`entity_type`/packet variant) so MCP/agents can pull a connected office/retail
property's docs + owner, same as dia/gov. Light — reuse the dia/gov packet shape,
just point at the CRE tables.

## Don't break / boundaries
- dia + gov pipelines UNCHANGED. The CRE branch only fires when the asset is
  out-of-domain (no dia/gov vertical cue AND no dia/gov match) — exactly the
  `out_of_domain_asset_class` set that parks today.
- No scoring/underwriting — if a CRE property ever needs a value, that's a separate
  blessed build (a real asset-class engine).
- The out-of-domain PARK path stays as the fallback for docs the CRE extractor
  can't resolve (e.g., no address + no owner) — register what you can, park the
  rest, never guess an owner.
- Provenance: `source='folder_feed_cre'` registered in `field_source_priority` so
  `v_field_provenance_unranked` doesn't flag drift.

## Tests / house rules
≤12 `api/*.js` (the CRE promoter branch lives in the existing promoter/handler
modules, not a new api/*.js); `node --check`; full suite green. Unit tests: an
out-of-domain doc with an extractable owner → creates a CRE property + owner entity
+ doc attach; one without an owner → registers the property (tenant/city) + parks
for owner backfill, never invents an owner; a dia/gov doc is UNAFFECTED (still
routes to its domain). Migration is additive (new tables + provenance rows).

## After deploy (Cowork verifies live)
- Out-of-domain docs stop parking and instead create `lcc_cre_properties` rows with
  attached docs; their owners appear as entities in the graph.
- A spot-check: does a CRE owner (e.g. a Vervent/Top Golf owner) that ALSO owns
  dia/gov assets now show a unified cross-asset-class portfolio? (This is the
  owner-overlap payoff — visible only once the registry + extraction exist, which
  is why we built rather than pre-measured it.)
- A context packet for a CRE property returns its docs + owner.

## Sequencing note
R14 (queue owner-rollup) and R15 are independent — ship in either order. R15 is the
larger build; Phase 1 (store + register + owner entity + doc attach) is the
shippable core, Phase 2 (owner backfill) and the packet/queue-audit polish can
follow.
