# Ownership Resolution Engine — does the app operate on authoritative sources? (audit + build, 2026-07-14)

## Scott's doctrine (the target process)

Work every owner to a **source of truth**, grounded in authoritative public records,
traceable back to the source per property:
1. **County records** (deed / assessor / appraiser) → the LLC that owns it + its
   notice/mailing address.
2. **SOS registration** (state of formation + state of property location) → managing
   members / registered agent + notice addresses + names.
3. **Compare (1)+(2) vs Salesforce / CoStar / RCA / emails** → resolve the right
   ownership-&-control contact.
4. **Cross-reference to the same party's other LLCs / assets** → consolidate + improve
   as we learn (naming patterns + known addresses emerge as keys).
5. **Reconcile with the DB → ~100%** by ADDING owners not yet in Salesforce.
6. **Feedback loop** — broker prospecting learns bouncebacks / bad emails-phones →
   forward to LCC/Copilot to update.
7. **Gov side** — GSA lease inventory has the **Landlord LLC**; **SAM.gov** has
   registered entities (names/addresses/contacts).
8. Fallback: whitepages / BeenVerified / public records + a simple Google search for
   the last gaps.

## Verdict: the doctrine is BUILT but NOT RUNNING at scale

Every authoritative **source is ingested**, but the **extraction → owner notice-address
+ names → resolution** chain is barely populated, so the comparison/consolidation
engine has almost nothing to work with. Grounded live 2026-07-14:

| Layer | Ingested | Owner-contact populated | Gap |
|---|---|---|---|
| **County deeds (gov)** | 5,698 deed_records | `grantee_address` = **0** | Unit-C address capture built, **re-parse/OCR backfill never run** (gated on docai-ocr creds) |
| **County deeds (dia)** | **167** deed_records | `grantee_address` = 1 | dia county-deed ingestion is **essentially absent** (gov has 5,698) |
| **SOS registry (gov)** | 8,292 registry rows (1,735 w/ managers) | 1,423 owners got a `manager_name`; **0** got `mailing_address` | SOS **notice address not extracted** to the owner; SOS-direct fetcher (FL/AZ PoC) **egress not stood up** |
| **SOS (dia)** | — | 31 owners w/ manager, 524/6,947 w/ address | dia SOS layer barely populated |
| **Assessor / parcel** | gov 11,033, dia parcel `owner_name` | owner_name only, **no mailing address**, **not wired to recorded_owner** | assessor owner+address not extracted → owner |
| **GSA Landlord LLC (gov)** | 7,770 `gsa_leases.lessor_name` | **text only — NOT resolved to a recorded_owner/entity** | GSA lessor → owner resolution **not wired** (R53 uses lessor *changes* for suspected sales, but the name never becomes the owner/contact) |
| **SAM.gov (gov)** | 6,478 rows (`awardee_name`, `point_of_contact`) | not wired to owner | weak owner signal (solicitation/awardee), but BTS awardee → developer is usable |
| **Owner coverage** | gov 9,157/13,442 recorded owners; dia 5,628/12,305 | `recorded_owners.mailing_address` gov **0**, dia 524 | the whole notice-address layer the comparison keys on is empty |

**Consequence:** because owner notice-addresses + managers are ~empty, the
cross-reference/comparison engine (name+address vs SF/CoStar/RCA) can't fire, so
~3,408 contactless owners default to `manual_research` and the ~344 ≥$1M owners stay
uncontacted. The machinery exists (ORE Phase-1 Units A/C/E/F, the cross-reference
resolver, R51/R53/R58/R59, field_provenance) — it just isn't executing end-to-end.

## Gap catalog vs the doctrine (what to fix)

- **G1 — County-deed notice-address layer is empty.** Run the deed **OCR + re-parse
  backfill** (gov 5,698; expand dia deed ingestion which is at 167) so
  `deed_records.grantee_address` + `recorded_owners.mailing_address` populate. This is
  the #1 authoritative source and it's producing **0** addresses today. (docai-ocr is
  deployed; needs the Google creds — the one credential to prioritize.)
- **G2 — SOS notice-address + manager not fully extracted.** Unit A filled 1,423
  managers but **0 SOS mailing addresses**. Extract the registry/agent address to the
  owner; stand up the **SOS-direct fetcher egress** (Unit F FL/AZ → expand states) for
  the owners with no registry manager.
- **G3 — Assessor/parcel owner+address not wired to the owner graph.** Parcel data
  (gov 11,033, dia owner_name) carries the assessor owner; extract owner + mailing
  address → `recorded_owners` (fill-blanks, provenance `county_records`).
- **G4 — GSA Landlord LLC unresolved (gov).** 7,770 `lessor_name` values are text;
  resolve/create the owner entity + link (`recorded_owner_id`), with the GSA lessor
  as an authoritative owner source (priority slot already exists — R53 registered
  `gsa_lessor`@20). This alone could seed thousands of gov owners.
- **G5 — The comparison/consolidation engine is starved, not broken.** Once G1–G4
  populate names+addresses, wire the **cross-source reconcile**: compare county/SOS
  owner name+address vs SF/CoStar/RCA/email, pick the authoritative contact, and
  cross-match to the same party's other LLCs/assets (naming-core + address keys) to
  consolidate. The resolver + provenance ledger exist; they need populated inputs +
  an explicit "authoritative-source wins, trace to source" merge rule.
- **G6 — No bounceback / bad-contact feedback handler.** R24 captures inbound
  *replies*, but there's no path for "broker forwarded a bounce / bad phone" →
  mark the contact bad → re-run resolution from authoritative sources. Add a
  correspondence-driven bad-contact marker (email/Copilot forward → LCC) that demotes
  the contact and re-queues enrichment.
- **G7 — SAM.gov awardee → developer/owner (gov, modest).** For BTS/awarded leases,
  route `awardee_name` + `point_of_contact` as a supplemental owner/developer signal.
- **G8 — Traceability is mostly there** (field_provenance + deed `source_url` +
  provenance_event_log) — extend it so every resolved owner/contact carries the
  authoritative source + a link back, per property.

## Build to make it operate (phased; grounded, reversible, free)

**Phase A — populate the authoritative notice-address + name layer (the unblock):**
run the deed OCR/re-parse backfill (G1), SOS address extraction + fetcher egress (G2),
assessor owner+address → owner (G3), GSA lessor → owner resolution (G4). All write
fill-blanks with `source ∈ {recorded_deed, sos_registry, sos_direct, county_records,
gsa_lessor}` at their existing `field_source_priority` ranks; all reversible.

**Phase B — the reconcile/consolidate engine (the "source of truth"):** for each owner,
assemble the authoritative name+address set (county + SOS + GSA), compare vs
SF/CoStar/RCA/email, resolve the ownership-&-control contact (signatory > controlling
> economic > agent — the CONTACT-SELECTION ladder already ranks this), cross-match to
the same party's other assets (naming-core + shared address), consolidate/merge, and
record the source trace. Owners not in SF get ADDED (→ the ~100% goal).

**Phase C — feedback + steady state:** the bounceback/bad-contact handler (G6), and a
recurring pass so new deeds/SOS/GSA data continuously refine owners (most crons exist;
they just need the extractors from Phase A running).

## GROUNDING CORRECTION (2026-07-14) — there is no pure-SQL win; the addresses must be FETCHED

Dry-running the two hypothesized "runnable-now" wins refuted both premises:
- **G4 GSA lessor → owner is already effectively done.** 0 GSA-lessor properties are
  missing a `recorded_owner`, and 1,192/1,282 distinct lessor names already match an
  existing owner. The property→owner LINK is not the gap.
- **G3 assessor mailing address is not in the DB.** `parcel_records` carries owner
  NAME on 9,541 rows but `mailing_address` on only **7** — the county scraper grabbed
  the owner name and **never captured the mailing-address column**. There is no data
  to promote.

So the owner **entities + names** are well-covered from authoritative sources; the
**notice addresses + decision-maker names are genuinely absent** (assessor mailing 7,
deed addresses 0, SOS addresses 0). The bottleneck is **FETCHING** the addresses from
the public records, not a SQL join. The corrected priority:

- **A1 (cheapest, near-free) — fix the assessor/parcel scraper to CAPTURE
  `mailing_address` + re-run.** `county_scraper` already hits the county assessor
  sites for 9,541 parcels; it just isn't grabbing the mailing-address field. Adding
  that column to the fetch is the highest-leverage authoritative-address source and
  needs **no new credentials** (public assessor pages). Then promote
  `parcel_records.mailing_address` → the property's `recorded_owner` (fill-blanks,
  provenance `county_records`) — matched by situs address (there is no
  property↔parcel FK today; match on normalized situs/APN).
- **A2 — deed OCR/re-parse backfill** (G1): needs Google Document AI creds on the
  deployed `docai-ocr`.
- **A3 — SOS-direct fetch egress** (G2): a PA/edge fetcher for the state SOS detail
  pages (FL/AZ built → expand); no paid API.

**Net:** none of Phase A is a hand-run SQL migration — each is a public-records
**fetcher** run/fix. A1 is the one that needs no credentials and should go first
(fix the scraper, re-run, promote). The Phase-B reconcile engine + G6 feedback handler
are buildable in parallel and become useful the moment A1/A2/A3 populate addresses.

## Bottom line

The app is built to do exactly what Scott described, but today it produces **~0 owner
notice-addresses** because the county/SOS/assessor/GSA extractors aren't running at
scale and the GSA-lessor + assessor feeds aren't wired to the owner graph. Turn the
extractors on (Phase A), wire GSA-lessor + assessor → owner (runnable now), then let
the reconcile engine compare authoritative sources vs SF/CoStar and consolidate
(Phase B) — that's the path to grounded, traceable ownership at ~100%, for free.
