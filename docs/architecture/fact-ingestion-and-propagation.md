# Fact Ingestion & Propagation — the brain learns & stays coherent everywhere
_2026-07-27._ The foundational data-coherence layer: **every learned fact flows INTO the canonical record with
provenance, and every change PROPAGATES to all consumers.** Builds on LCC's existing provenance fabric.

## What already exists (strong foundation — do not rebuild)
- **Merge primitive:** `lcc_merge_field(entity, field, value, source, …)` + `lcc_record_field_resolution` — write a
  fact WITH a source; it reconciles against **`field_source_priority`** (which source wins).
- **Provenance store:** `field_provenance` (+ resolutions) with a full review/conflict view set
  (`v_field_provenance_current/_conflicts/_actionable/_review_queue/_would_block`).
- **Canonical facts:** `lcc_property_attributes` (tenant, lease_commencement/expiration, term_remaining, annual_rent,
  noi, building/asset), `lcc_property_owner_facts` (recorded/true owner, developer).
- **Propagation:** `lcc_listing_events` (event stream), `*_sync_inflight` tables (in-flight propagation tracking),
  `contact_change_log`, `activity_events`.
- **Entity hygiene:** `lcc_merge_entity` / fuzzy/person-email merges + `cortex_janitor_*`.

## The gaps (exactly the coherence concern)
1. **Our-process learning points aren't wired back.** Canonical facts are fed from the domain DBs (`source_domain`
   = dia/gov). When WE learn something — abstract a lease, close a deal, receive an extension — it lands in a workbook
   or SF, **not merged back** into `lcc_property_attributes`/`owner_facts` via `lcc_merge_field`. The brain doesn't
   learn from our own work.
2. **Detailed lease structure has no canonical home.** Only the lease *summary* is canonical; escalation schedules,
   option terms, rent steps, and multi-tenant rent rolls live in BOV workbooks — not first-class, not provenanced.
3. **Propagation-on-change is partial.** A closing should ripple to ownership + a new sale comp + deal-closed + SF +
   dossier; a lease extension should ripple to term/income + revaluation + dossier. Some rails exist (sync_inflight,
   listing_events) but coverage isn't guaranteed.

## The invariant (make it universal)
**Every learned fact is written through `lcc_merge_field` with `source` + `confidence` + `as_of` — never as an
ad-hoc canonical write.** `field_source_priority` decides conflicts (a **signed lease / recorded deed / executed
PSA outranks a scraped estimate**). Every canonical change **emits an event** that propagates to consumers, tracked
idempotently (the `*_sync_inflight` pattern → ties to H5 resilience).

## Wire every learning point (ingestion coverage)
| Learning point | Merge (source, priority) | Then propagate to |
|---|---|---|
| **Lease abstraction** (BOV / lease review) | lease summary + **structure** (source `lease_doc`, high) | property_attributes + canonical lease record + revaluation flag + dossier |
| **Closing** | ownership (owner_facts + `entity_relationships` `owns`/`purchases`), price/date (source `recorded`/`psa`, highest) | **create sale comp** + deal→Closed + SF opp closed-won + dossier milestone + cadence off-ramp (H4) |
| **Lease extension / amendment** | new expiration/term/escalation (source `lease_doc`) | income → revaluation flag + dossier + SF |
| **Email/file-derived facts** | merge (source `email`/`doc`, medium) | dossier + whichever fact changed |
| **SF sync (inbound)** | merge (source `salesforce`) | reconcile vs our facts by priority |
| **Enrichment / research** | merge (source `enrichment`, low) | never overrides a primary doc |

## New/expanded pieces
1. **Canonical lease record** — a first-class lease (or extended `lcc_property_attributes` child) for escalation
   schedule, options, rent steps, multi-tenant rent roll, with provenance. Closes gap #2; feeds valuation + comps + dossier.
2. **Lease-abstraction → merge writer** — the BOV/lease workflow **emits its abstracted facts through `lcc_merge_field`**
   (not just into the workbook). Closes gap #1 for leases.
3. **Closing propagator** — a closing event fans out: ownership edge + sale-comp creation + deal-close + SF + dossier.
4. **Coverage audit (build-time):** enumerate every learning point × confirm (a) writes-through-merge with a source,
   (b) emits a propagation event. Anything writing a canonical field ad-hoc is a bug against the invariant.

## Where it sits
This is a **foundational layer beneath the six domains** (part of the brain's data plane, with the shared
substrates). Every domain **reads canonical facts (with provenance)** and **writes learned facts through the merge
primitive**; changes propagate. It's the mechanism that makes "ingest & propagate the central brain at every step"
true and consistent — Domains A–F are *producers/consumers* of facts; this layer keeps them coherent.

## Build phasing
- **FP1.** Coverage audit — map learning points to merge/propagation; list the ad-hoc writers to convert.
- **FP2.** Canonical lease record + lease-abstraction merge writer (your lease example).
- **FP3.** Closing propagator (ownership + sale comp + deal-close + SF + dossier).
- **FP4.** Generalize propagation on the `sync_inflight`/`listing_events` rails with H5 idempotency + dead-letter.
