# Ownership-Resolution Engine — audit + design (2026-06-27)

## The gap (Scott, 2026-06-27)

"We should be ingesting much more than these addresses everywhere and consolidating
and merging and learning from all these records to where we work all LLCs and SPEs
down to a middle, true representation of the ownership or control of ownership of
these properties."

Grounded today: owner mailing/notice addresses exist for <1% of gov owners
(132/16,830) and <10% of dia (521/6,931), even though we process deeds, OMs, CoStar
captures, leases, and public records constantly. We are **extracting names and
discarding the addresses + contacts those same records contain**, the schema can't
hold owner contact data where it matters, and nothing consolidates LLCs/SPEs into a
single true-ownership representation. This doc is the audit + the engine design.

## A. Extraction audit — where owner address/contact data is dropped

| Source / path | In the source? | Extracted? | Written? | Gap |
|---|---|---|---|---|
| **Deed grantee "return to" + grantor narrative address** (`deed-parser.js`) | Yes | Regex finds it, then `leadingEntityName()` **strips** it | No (deed_records = grantor/grantee names only; full parse sits unindexed in `property_documents.extracted_data`) | **CRITICAL** — ~100% discarded |
| **CoStar owner phone/email** (`sidebar-pipeline.js selectAuthoritativeOwner`) | Yes (contacts array) | Name only returned | No | **HIGH** |
| **Org-entity contacts** (`entity-link.js`) | n/a | — | **phone/email explicitly deleted for non-person entities** (owners are orgs) | **CRITICAL, cross-cutting** — owners structurally can't carry contacts |
| **Public-record registered-agent address + managers/members** (gov `public_record_ingest.py`) | Yes — **already extracted** | Yes | **Orphaned** — never synced to recorded_owners/true_owners | **HIGHEST ROI** (data already in hand) |
| **OM seller/buyer contact + address** (`intake-extractor.js`) | Sometimes | No (prompt omits) | No | MEDIUM |
| **Lease guarantor/tenant notice address + contact** (`lease-extractor.js`) | Yes (boilerplate) | No (prompt omits) | No | MEDIUM |
| CoStar owner mailing address (`upsertDomainOwners`) | Yes | Yes | Yes (dia flat cols / gov `recorded_owners.contact_info` JSONB) | OK — but rarely present in captures |
| **`ownership_history.address`** (gov `ingest_ownership.py`) | — | — | **set to city, not street** (field bug) | data-quality bug |

## B. Schema-capacity audit

- **gov `recorded_owners`**: only `registered_agent_address` (0.78% full), `state`,
  `filing_state` — no owner mailing address columns. **gov `true_owners`: no
  address columns at all.**
- **dia `recorded_owners`**: `address`/`city`/`normalized_address`/
  `registered_agent_address` (7.5% full); **dia `true_owners`**:
  `notice_address_1/2`/`city` (3.6% full, all distinct → no overlap to match on).
- **`contacts` + `brokers` (both domains) DO have `address`/`city`/`phone`/`email`**
  — capacity exists for PEOPLE; the owner tables + org entities are what lack it.
- LCC `entities`: persons carry address/phone/email (R52); **organizations carry
  none** (deleted at write).

## C. Consolidation audit — distance from a "true ownership middle"

- **Dedup is name-only** (`normalizeCanonicalName` + 8 name guards). No address /
  registered-agent-address matching, so "ACME LLC" vs "Acme L.L.C." at the same
  agent address stay separate.
- **Org entities don't carry contacts**, so even resolved owners are bare names.
- **SPE→parent / UBO resolution lives outside the ingest path** (R5/R6 handlers,
  `lcc_resolve_buyer_parent`, owner-facts) — an SPE mints as its own entity; parent
  discovery is downstream/manual, not inherited by every source at the choke point.
- **No single canonical "true owner / ultimate control" per property** — properties
  carry `recorded_owner_id` + `true_owner_id` FKs to bare-name entities; no computed
  ultimate-owner.
- **No learning loop** — resolving one LLC's parent/contact doesn't help siblings;
  a manual merge isn't replayed against raw ingest; resolved aliases aren't fed
  forward.

## D. The engine — design (extract everything → store → consolidate/merge/learn → true middle)

### Phase 1 — STOP DROPPING (capture everything; foundation, highest ROI)
1. **Schema first:** add owner contact columns where missing — gov/dia
   `recorded_owners` + `true_owners`: `mailing_address`, `city`, `state`, `zip`,
   `phone`, `email`, `registered_agent_name`, `registered_agent_address`,
   `manager_name`, `member_names`. Allow LCC **organization** entities to carry
   `phone`/`email`/`address` (lift the `entity-link.js` delete for owner orgs).
   Register `field_source_priority` for the new fields.
2. **Sync the orphaned public-record extraction** (gov `public_record_ingest.py`):
   write the already-extracted registered-agent address + managers/members into
   `recorded_owners`. (Verify this claim first — if real, it's the cheapest large
   win.)
3. **Deed parser:** keep the grantee "return to" + grantor addresses (don't strip
   in `leadingEntityName`); write to the new owner-address columns + a deed
   address field; provenance `source='recorded_deed'`.
4. **CoStar sidebar:** carry owner phone/email through `selectAuthoritativeOwner`
   → write to the owner record (now that orgs can hold them).
5. **OM + lease extraction prompts:** request seller/buyer/guarantor name + phone +
   email + notice address; write through the existing promoter with provenance.
   Fix the `ownership_history.address`=city bug.

### Phase 2 — CONSOLIDATE / MERGE (one clean owner per real owner)
- Extend dedup to **address + registered-agent-address** keys (now that the data
  exists): same agent address + compatible name → same owner. Reuse R39/R40
  `lcc_merge_entity`; **consolidate addresses/contacts onto the survivor on merge**
  (today they'd be lost).
- One canonical owner per property (collapse SPE variants), value-ranked.

### Phase 3 — RESOLVE TO TRUE OWNERSHIP / CONTROL (the "middle")
- Bring SPE→parent / UBO resolution **into the ingest choke point** (managers/
  members + registered agent + shared address → parent/control relationships), so
  every source inherits it — not just the downstream R5/R6 handlers.
- Computed **`true_owner_final` / ultimate-control entity per property**, refreshed
  on ownership change; expose to the queue, detail, and the cross-reference
  resolver (which now has real address + agent data to match on — directly fixing
  the high-value-contact dead end from earlier today).

### Phase 4 — LEARN (gets better as it ingests)
- Merge/resolution **audit + replay**: a confirmed SPE→parent or alias is recorded
  and **fed forward**, so resolving one LLC resolves its siblings and future
  captures inherit it. This is the "learning from all these records" Scott wants.

## E. Why this is the foundation (ties to today's dead ends)
The high-value-contact problem we hit earlier (web search weak, cross-ref by
address = 0 because LCC has no owner addresses) is a *symptom* of this gap. Phase 1
puts the addresses + agents + managers we already process into the owner records;
Phase 2/3 consolidate them into a true owner with control resolved; then the
cross-reference resolver (already built) actually fires on shared agent/address —
and the manual-assist surface has real records to show. This is the root fix, not
another point lever.

## F. Recommended sequencing
Phase 1 is the unlock and splits into independent, verifiable units (schema; the
orphaned-public-record sync [verify-first, cheapest]; deed addresses; sidebar
owner contacts; OM/lease prompt expansion). Do Phase 1 first, measure the owner
address/contact coverage lift, then Phase 2 (consolidation) and Phase 3 (true-owner
resolution) build on the now-populated data. Phase 4 (learning) last. Each unit is
additive, provenance-gated, reversible — the established discipline.
