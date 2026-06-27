# Claude Code (life-command-center) — owner cross-reference resolver (resolve contacts from records we already hold)

## Why (Scott's actual ownership-resolution method, grounded live 2026-06-26)

Scott's real process for identifying an owner's decision-maker is a public-records
chain, NOT a web search: **County records (LLC → owner + address) → State SOS
(managing member / registered agent) → cross-match the overlapping names/addresses
against our existing contact/company records + naming structure → (web/people-search
only LAST, for phone/email once identity is known).** Web search (Brave) is the
weakest, last step — deliberately PARKED. This round builds the part of his method
the system can do for free on data we already own: **the cross-reference / naming-
structure / address-overlap match against our own entity graph.**

Grounded on LCC Opps: of **738 high-value (≥$1M) owners**, only **45 are bridged to
a domain true_owner** (so domain manager/agent signal-surfacing reaches ~45), and
`lcc_owner_contact_signals` holds only **298 rows total** — captured manager/agent
coverage is thin. BUT the high-value owners DO carry a rich LCC entity graph (the
`owns` edges that give them their connected value, plus names + addresses). The
worker's **cross-reference step is currently a no-op stub** (`defaultCrossRef` →
`no_sibling`; owner-contact-enrich.js:56, and the production query was explicitly
deferred). Building it is the highest-value, free, most-Scott-aligned move: it
resolves the contactless owner from a related owner we've ALREADY contacted —
exactly "it becomes apparent from the records + naming structure."

This feeds the SAME proven chain: a resolved contact → `attachPersonToOwner`
(guards re-apply) → value-gated cadence seed (#1353) → work-surface focus card.

## Unit 1 — the cross-reference resolver (the no-op stub → real)

Replace `defaultCrossRef` with a real resolver (in `_shared/` so it's testable;
the worker already calls `deps.crossRef(row)` as step 1, before the routed/web
adapters). For a contactless owner, find a RELATED owner/entity that already has a
resolved **person** contact and reuse it. Three match strategies, in priority order
(most → least authoritative), each guarded:

1. **Shared address** — another owner/entity at the same normalized notice /
   recorded / property address (the addresses we hold from county/deed —
   `lcc_property_owner_facts`, `recorded_owners`, the owner's `metadata` address)
   that has a linked person contact → reuse that person (role `principal` /
   carry the source role).
2. **Same parent / SPE family (R5/R6)** — resolve the owner via the EXISTING
   `lcc_resolve_buyer_parent` / owner-facts to a parent or sibling SPE; if the
   parent or a sibling that shares the parent has a contact, reuse it. (This is the
   repeat-buyer / developer-family case — NGP/Boyd/etc. — where one contact serves
   the whole family.)
3. **Naming-structure match** — the owner's normalized name-CORE
   (`lcc_normalize_entity_name` / the R39 person-name + R5 SPE-strip helpers)
   matches another entity that has a contact (e.g. "Smith Family Trust 2019" ↔ a
   "Smith Family Trust" we've contacted). Conservative: require a strong core match
   (not a generic token like "Holdings"/"Capital"), and never match across clearly-
   different owners.

Guards (reuse, don't reinvent): the reused name must pass `looksLikePersonName` +
`isImplausiblePersonName` + the junk/federal filters; never reuse a firm/agent as
the person; record provenance `source='cross_reference'` + which strategy + the
source entity, so an attach is auditable/reversible. **No confident related
contact ⇒ return `{ok:false, reason:'no_sibling'}`** (falls through to the deferred
SOS/web steps / manual worklist — never a guess).

## Unit 2 — extend domain-signal surfacing (the bounded supplement)

For the high-value owners that ARE bridged (or bridgeable) to a domain true_owner,
make sure the manager / registered-agent / economic-contact signals we already
captured (`v_owner_contact_signals_portfolio` → `lcc_owner_contact_signals` →
`owner_contact_pivot`) are actually pulled and seeded into the pivot so the
free-attach path covers them. Today the pivot is only 172 owners and ~3 of the 738
high-value. Extend the sync / pivot seeding to cover the high-value worklist (don't
restrict to the original bridged subset). Bounded by the ~298 captured signals +
45 bridged — honest, supplementary to Unit 1.

## Critically — DRY-RUN to size the yield BEFORE any broad write

The cross-ref yield is unground (could be large via the SPE-family case, or modest).
Provide a GET/dry-run mode that, for the high-value contactless set, reports how
many resolve via each strategy (shared_address / same_parent / naming) WITHOUT
writing, plus a sample of the proposed (owner → reused contact, source entity) pairs
so Scott can eyeball correctness. Only after the dry-run looks right does a capped
real run attach. (Same discipline as every prior drain.)

## Boundaries / verify

- life-command-center; resolver in `_shared/`, wired as the worker's `crossRef`
  dep; no new api/*.js (stays 12); reuse the attach path + guards + the value-gated
  cadence seed (#1353) + `advanceCadence`. Migration only if Unit 2's sync needs a
  view/coverage change (additive).
- `node --check`; suite green; unit-test each match strategy + the guard rejections
  + the no-confident-match abstain.
- **Live proof (Cowork verifies):** the dry-run sizes the cross-ref yield on the
  738 high-value set; a capped real run attaches a reused contact to a high-value
  owner whose sibling/same-address/same-name entity we'd already contacted, seeds a
  cadence, and surfaces it in the focus session — and a spot-check confirms the
  reused person genuinely belongs to that owner (no wrong-family reuse).

## Documentation

Update CLAUDE.md (owner-contact enrichment): the cross-reference resolver — resolve
a contactless owner's decision-maker by reusing a contact from a related owner
(shared address / R5-R6 parent-or-SPE-family / naming-structure core match) in our
own entity graph, guarded + provenance-tagged; the worker's free step-1, ahead of
SOS/web/manual. Mirrors the County→records→cross-match method. Web-search (Brave)
stays parked as the last contact-detail step.

## Bottom line

Build the front of Scott's chain, not the back: resolve high-value owners'
decision-makers from the county/deed/entity-graph records we ALREADY hold —
shared address, SPE/parent family, and naming structure — reusing contacts we've
already established elsewhere. Free, authoritative, and exactly how Scott works it
by hand. Web search stays parked for the contact-detail step later.
