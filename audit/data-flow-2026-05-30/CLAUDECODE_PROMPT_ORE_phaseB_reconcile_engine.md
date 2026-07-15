# Claude Code (LCC + gov + dia) — ORE Phase B: the reconcile engine (authoritative sources → one source-of-truth contact)

## Why (Scott's doctrine, steps 3–6)

Phase A feeds are now flowing: **deeds** (live, DocAI-OCR cron auto-draining ~5,700 gov
deeds → grantor/grantee names + notice addresses), **SOS-direct** (FL/AZ/CA built;
egress workflow pending dispatch → managing member/agent + principal/mailing address),
plus the existing **GSA lessor** (7,770) and **owner phone/email** (CoStar) capture.
The **promote engine** (`gov_promote_parcel_mailing_to_owner` + `_sync_sos_registry_*`)
lands these into `recorded_owners` with `county_records`/`sos_registry`/`recorded_deed`
provenance. Phase B is the engine that **compares those authoritative sources against
Salesforce / CoStar / RCA / email and resolves each owner to a traceable source-of-truth
contact** — the reconcile step Scott does manually today.

Full context: `OWNERSHIP_RESOLUTION_ENGINE_authoritative_source_audit_2026-07-14.md`.
Reuse the built pieces — this is wiring/orchestration, not a rebuild:
CONTACT-SELECTION (signatory→controlling→economic→agent ladder + pivot state), the
owner cross-reference resolver (`lcc_resolve_owner_cross_reference`), the merge
machinery (`lcc_merge_entity`), field_provenance, and the owner-contact worklist.

## B1 — Assemble + reconcile the authoritative record per owner (the comparison)

For each owner (start with the ≥$1M contactless worklist, value-ranked), assemble the
**authoritative name+address set**: deed grantee/grantor (`recorded_deed`), SOS
principal/mailing + registered agent (`sos_registry`/`sos_direct`), GSA lessor,
assessor mailing (`county_records`), and the CoStar-captured owner phone/email. Then
**compare against what's already in the system** — Salesforce (`external_identities`
salesforce), CoStar/RCA captures, email-intake contacts:
- **Agree** → confirm; stamp the owner's authoritative address/contact + source trace.
- **Conflict** (authoritative source ≠ SF/CoStar) → the field_provenance ladder already
  ranks authoritative sources (manual > recorded_deed > county > sos > aggregators);
  surface genuine same-rank disagreements to the existing Decision-Center
  `owner_source_conflict` lane, never silent-overwrite.
- **Absent from SF** → this owner is a **net-new** to add (see B2).
The output per owner: the authoritative name, notice address, and the resolved
**control contact** (via the CONTACT-SELECTION ladder — now fed by real SOS managers +
deed grantees), each with a `source` + a link back to the deed/SOS/parcel record.

## B2 — Consolidate + reach ~100% (cross-match + add non-SF owners)

- **Cross-match to the same party's other LLCs/assets** using the now-populated keys:
  distinctive naming-core AND **shared notice address** (the cross-reference resolver's
  `same_address` strategy was starved — Phase A populates the addresses that make it
  fire). A confident match reuses the party's known contact + consolidates.
- **Consolidate duplicate owner entities** discovered via shared address/naming through
  the existing `lcc_merge_entity` (reversible), so one party = one record.
- **Add the owners not in Salesforce** — the ~100% goal: an owner resolved from
  authoritative sources with a real contact but no SF Account is queued for an SF push
  (the existing SF-mapping / Decision-Center path), so the graph converges on complete.

## B3 — Feedback loop (bouncebacks / bad contacts)

Broker prospecting learns bad emails/phones. Add a **bad-contact handler**: a
correspondence signal (email/Copilot forward, or an SF activity marked bounce/bad) →
mark the contact's email/phone bad on the entity → demote it and **re-run resolution**
from authoritative sources (next-best contact, or re-queue enrichment). Reuse the R24
SF-activity ingest + the `contact_id`/pivot machinery; never delete — flag + re-resolve.

## Boundaries / verify

- LCC orchestration (an owner-reconcile worker/tick + the cross-match/consolidate wiring)
  + the domain provenance writes; reuse existing engines (CONTACT-SELECTION, cross-ref
  resolver, merge, provenance, worklist). Additive · fill-blanks / authoritative-wins ·
  provenance-tagged · reversible · ≤12 api/*.js. No paid API.
- **Verify (as the Phase-A corpus accumulates):** run the reconcile tick over the ≥$1M
  worklist → owners gain an authoritative notice address + a resolved control contact,
  each traceable to a deed/SOS/parcel source; conflicts route to the DC lane; a couple
  of cross-address matches consolidate a party's LLCs; a handful of non-SF owners queue
  for SF push. Spot-check 5 resolved owners back to their source record.
- **Sequencing:** B1 is useful now (some deed/SOS/GSA data already present) and gets
  better daily as the deed cron + SOS run populate addresses. Build B1 first; B2/B3
  follow once B1 is producing.

## Bottom line

Phase A puts authoritative names+addresses into the DB; Phase B is the reconcile engine
that compares them against SF/CoStar/RCA, resolves each owner to a traceable
source-of-truth control contact, consolidates the party's other assets, and adds the
owners missing from Salesforce — closing Scott's manual process into the app, grounded
and traceable to source, toward ~100%, for free.
