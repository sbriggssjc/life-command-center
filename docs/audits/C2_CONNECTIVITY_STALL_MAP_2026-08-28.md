> **📍 CANONICAL PAGE: [`docs/architecture/connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) §4e** — this file is the EVIDENCE for one
> measurement; the canonical page carries the standing chain state. ⚠️ **This round OVERTURNED
> BREAK-2's verdict** (the cadence layer is not being retired — Scott 2026-08-27) and added a
> **denominator warning to BREAK-3** (its 49.2% is *of assets*; the property-denominator figure is
> 13%). Both corrections are in that page.

# C2 — the connectivity stall map: where the chain actually breaks

**Measured live 2026-08-28 against all three databases. Diagnosis only — nothing was written.**

> ## The one-line finding
>
> **The binding constraint is ASSET IDENTITY, not contact acquisition.** Only **5,144 of 32,289
> properties (16%)** have an LCC asset entity, and a property without one **cannot carry owner
> evidence at all**. Downstream of that gate the system converts well — **52% of resolved owners
> already have an active contact.** The 9,793 Salesforce people are in LCC and 93% carry an edge,
> but only **669 (6.8%) reach a resolved property owner**, because there are only 4,065 resolved
> owners for them to reach.

---

## 1. The chain, hop by hop

| hop | count | of prior hop | note |
|---|---:|---:|---|
| **Properties** — gov 20,493 + dia 11,796 | **32,289** | — | |
| gov with `true_owner_id` | 9,830 | 48% of gov | |
| dia with `true_owner_id` | 10,293 | 87% of dia | ⚠️ **7,941 of these are OPERATORS** (`is_operator_not_owner`) — the P113 tenant-in-the-owner-slot trap. Real dia owners ≈ **2,352** |
| gov with `recorded_owner_id` | 9,312 | 45% | |
| dia with `recorded_owner_id` | 5,442 | 46% | |
| **LCC asset anchors** (`external_identities` `dia\|gov`/`asset`) | **5,144** | **16% of properties** | ⚠️ **THE GATE** |
| LCC owner anchors (`…/true_owner`) | 15,487 | — | owners are anchored far ahead of assets |
| **Resolved property→owner rows** (`lcc_property_owner`) | **4,065** | **13% of properties** | |
| distinct owner entities behind them | 2,768 | | |
| **Owners with an active contact** (`owner_contact_pivot`) | **1,439** | **52% of resolved owners** | the healthy hop |
| touchpoint cadences (all) | 2,302 | | |

**Supporting population, already present and largely unusable:** 43,202 live organizations,
13,004 live people (11,122 with an email), 32,854 hub contacts, 16,315 Salesforce Account ids.

## 2. ⚠️ The Salesforce book is connected to the wrong side of the chain

| | |
|---|---:|
| Salesforce-linked people in LCC | **9,793** |
| …with an email | 9,491 |
| …carrying at least one relationship edge | **9,129 (93%)** |
| **…linked to a RESOLVED PROPERTY OWNER** | **669 (6.8%)** |
| …serving as an active contact on some owner | 1,036 |

**The people are in and they are connected — to their employer organization.** That org edge is the
Salesforce-account `works_at` edge (8,506 of them; the same bare-SF signal **P112** disqualified as a
BD signal and **P161** gated out of reachability). What it is *not* connected to is a property owner,
because **only 4,065 property→owner rows exist for 32,289 properties.**

**This is one gap, not two.** Contact acquisition is not the bottleneck — the bridge has no far bank.

## 3. Why asset coverage is 16%, and why that is a decision rather than a defect

It is **deliberate and value-gated**. `lcc_mint_gov_asset_entities` **refuses to run without
`--min-rent`**, and the P141 run minted 663 assets at a **$500k floor**. The doctrine is explicit
in `CLAUDE.md`: *"Evidence justifies the entity, never the reverse — an asset entity with nothing
attached is noise in every count, search and merge candidate."* And: *"**Asset-identity coverage is
what gates owner resolution — not evidence.** When a domain feeder under-delivers, check asset
coverage before blaming the evidence."*

So the 16% is the Consumption-Layer doctrine working as designed. **The question this audit raises
is whether the floor is still calibrated for a system that is now about to be USED for BD**, which
is a different question from the one it was set to answer.

⚠️ **Do not simply drop the floor.** Minting 27,000 asset entities with no owner evidence would
re-create exactly the noise the gate exists to prevent, and would inflate every merge-candidate and
search surface. The measured question is: **at what rent floor does a minted asset actually resolve
an owner?** P141 measured **612 of 663 resolving at the $500k floor (92%)** and noted resolve rates
did *not* degrade in lower bands (on small samples). **That measurement, extended down the rent
curve, is the input to the decision.**

## 4. ⚠️ Corrections to figures quoted earlier in this thread

- **"101 owners with a contact, 157 cadences"** was scoped to *property owners above the $500k
  rent floor*. **Fleet-wide it is 1,439 pivot contacts and 2,302 cadences** — an order of magnitude
  larger. Both figures are correct about different populations; quoting the scoped one as the
  system total understates it ~10×.
- **Two instrument errors preceded this map, both caught by reading named rows:** (a) counting *any*
  linked entity as a "person" returned addresses (`2 Mill St, Lawrence, MA 01840`) as contacts and
  inflated an "unclosed loop" finding **56×**; (b) `activity_events` attributes 23,232 events to
  only **253 distinct person entities**, so it cannot answer "do we correspond with this person" —
  `email_bodies` (29,521 rows, **5,509 distinct addresses**) is the correspondence record, keyed by
  **address**, not entity id.

## 5. What this says about sequencing

The chain that Scott described —
*property → recorded ownership (current + all prior, developers ≠ investors ≠ buyers) → SPE/LLC
control → true owner → the right contact with the right details → the right prospecting bucket and
broker → relative priority against every other action* — **is built, and it is starved at hop 3.**

Ranked by what unblocks the most downstream:

1. **Asset-identity coverage** (5,144 → ?). Everything else is gated behind it. Needs the
   resolve-rate-by-rent-band measurement first, then a floor decision.
2. **The SF bridge** — 9,124 SF people whose employer org is not a resolved owner. Once assets and
   owners exist, most of this connects itself; some needs the org↔owner reconcile.
3. **Prospecting-style buckets and broker assignment** — **not yet measured**; `touchpoint_cadence`
   carries `phase`, `priority_tier` and `owner_user_id`, so the fields exist. ⚠️ **`owner_user_id`
   FKs a different user table than `lcc_entity_owner_override` — go through
   `lcc_cadence_point_person()`, never re-derive the mapping** (a documented footgun).
4. **Relative weighting across all actions** — `v_priority_queue` already implements doctrinal bands
   (P0…P8). It is the existing machinery for "this call versus everything else" and should be
   extended, not rebuilt.

## 6. Not measured here — stated so nobody assumes it was

- **Prior/historical ownership depth** (back to the developer) — the A-series ownership-chain work
  covers gov; dia is unmeasured.
- **The developer / investor / buyer prospecting-type distinction** — `entities.metadata` and
  `v_lcc_developer_classification_candidates` exist, but coverage was not counted.
- **Outlook / WebEx connectivity per contact** — `outlook_contact_id` is 2,809 (P184); WebEx is not
  in the schema at all.
- **Whether the 2,302 cadences carry a correct broker assignment.**
