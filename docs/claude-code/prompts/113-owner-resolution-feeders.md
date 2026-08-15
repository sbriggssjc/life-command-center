# Prompt 113 — Owner resolution feeders: get past 35.9% (BREAK-3)

**Origin:** `docs/architecture/panel-redesign-verification.md` §3,
`connectivity-and-open-threads.md` §4b BREAK-3. Specified originally as **P0.2 / P0.3** in
`property-tab-ux-review.md` Part 4 (Phase 0) and never built.

**Why now.** The property panel's header, Current Owner card, and the whole `Work this owner →` hand-off are
gated on a reconciled owner. **2,490 of 3,886 assets (64%) still have none**, so those panels correctly but
unhelpfully render *"Owner: Unresolved"*. Everything downstream — the owner panel, cadence, My Day, the
Decision Center owner lanes — is dark for those assets.

---

## Grounded baseline

| Fact | Value | Note |
|---|---|---|
| asset entities (dia+gov) | 3,886 | |
| **with a reconciled owner** (`lcc_property_owner.owner_entity_id`) | **1,396 (35.9%)** | |
| without | **2,490** | render "Unresolved" |
| distinct owner entities | 690 | |
| gov `recorded_owners` rows | 17,229 | 1,469 with a `manager_name` |
| dia `recorded_owners` rows | 7,217 | 551 with an address |

**Context — this has moved a long way already.** The 2026-07-31 audit (P0.6) found **102 of 4,837 assets
(~2%)** carried a reconciled owner. It is now 35.9%. So the reconciliation engine works; the question is
purely **which feeders are still missing**, and the two named in Phase 0 were never built.

**Verify the 35.9% before building** — establish which sources produced the existing 1,396
(`lcc_property_owner.source`: `sf_seller` / `manual` / `relationship_graph` / `deed_recorded` / …). The
distribution tells you which feeder already carries the load and which is absent, and it prevents building
a duplicate of something that shipped since July.

---

## P0.2 — own-deal buyer → owner evidence (highest confidence, our own data)

For a closed `bd_opportunities` deal, **we know who bought the building** — we brokered it. That buyer IS
the current owner, and it is first-party knowledge, not an inference.

- Feed post-sale buyer → `lcc_owner_evidence` at **high weight**, then reconcile
  (`lcc_reconcile_owner` / `lcc_reconcile_all_owners`).
- Respect the authority ladder in `property-owner-source-authority-and-doctrine.md`
  (`manual > deed > rel_purchase > sf_seller > rel_owns`) — a closed own-deal buyer should sit **at or above
  `rel_purchase`**; justify wherever you place it and register the `field_source_priority` row so
  `v_field_provenance_unranked` stays at 0.
- **Size it first.** How many closed deals with an identified buyer map to an asset that currently has no
  resolved owner? The July note warned developer/loan graph coverage was 0 — check that this feeder is not
  similarly data-thin **before** building it. If it is worth <50 assets, say so and stop.
- The Fresenius – Woodland Hills case in `property-tab-ux-review.md` (Finding A) is the canonical test: our
  own closed deal, buyer known in OM/SF/ShareFile, owner still unresolved. **It should resolve after this.**

## P0.3 — county deed / recorded owner → owner evidence

The deed grantee is the recorded owner, and the deed pipeline exists: `deed-parser.js` now keeps
grantee/grantor **names and mailing addresses** (ORE Phase 1 Unit C), and gov/dia `recorded_owners` hold
17,229 / 7,217 rows.

- **The likely gap is promotion, not capture.** Determine how many assets have a domain `recorded_owners`
  row (or a `deed_records` grantee) that never became `lcc_property_owner` evidence. That is the free win;
  a new deed *fetch* is not needed to find it.
- Mind the documented ceiling: `mailing_address` is populated on only **31** gov / **551** dia owner rows,
  and the assessor-parcel path is echo-only (Phase A1 grounding correction — the audit premise that "the
  scraper already fetches parcels" was **refuted**). Do not build on the assumption that parcel data exists.
- Deed-sourced owners must not stamp the **operator/tenant** as owner — `granteePassesOwnerGuards`
  (brokerage / federal / junk guard) applies, and the P0.1 display guard must keep working.

## Cross-cutting

- **The owner ladder just changed.** As of 2026-08-15 the property Ownership tab collapses the
  recorded → true owner ladder into ONE card when both resolve to the same party
  (`_udOwnershipLadder`, `_ownersAgree`). A feeder that writes the recorded owner into the true-owner slot
  (or vice versa) will now be *invisible* rather than obviously wrong. Confirm each feeder writes the right
  slot, and check the result renders as two cards where a shell genuinely sits in front of a parent.
- **Feeding the owner does not make them reachable.** Prompt 111 covers that leg. Report the two numbers
  separately so the win is not overstated: assets that gain a resolved **owner**, and owners that gain a
  reachable **contact** (likely near zero from this prompt alone).

---

## Deliverable

1. **Source distribution of the existing 1,396** + the size of each proposed feeder, reported **before**
   any build. If a feeder is data-thin, skip it and say why — the repo has a good record of doing exactly
   that (the developer/loan join, the cadence rep backfill) and those write-ups saved real time.
2. The feeder(s) that survive that test, built to the standing discipline: additive · fill-blanks-only ·
   conservative/unambiguous (ambiguity → review lane) · authority-ladder-aware · provenance-tagged ·
   reversible by batch tag · idempotent · **dry-run default**.
3. Re-run the §3.2 leg-1 SQL and report **1,396 / 3,886 → ?**, plus a spot-check on Fresenius – Woodland
   Hills.
4. Update `connectivity-and-open-threads.md` §4b BREAK-3 and the P0.2/P0.3 rows in
   `property-tab-ux-review.md` Part 4.

## Out of scope
- New external data acquisition (county scrapers, assessor fetchers — that is Phase A1b).
- The `Diligence & Vendors` / dossier work.
