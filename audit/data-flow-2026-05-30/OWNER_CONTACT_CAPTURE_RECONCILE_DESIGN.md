# Owner-contact capture + continuous reconcile — design (2026-07-22)

Scott's direction after the SOS-via-CI path proved unreachable (FL/CA bot-wall datacenter
IPs, AZ portal migrated). Three interlocking builds, one doctrine:

> **The objective is the outcome. The means are minimal human involvement, leveraged at
> maximum effectiveness where automation is genuinely walled.**

The shared spine across all three: **capture the raw material the moment we have it, store it
durably, and reconcile owners continuously using address + name as join keys.** Today we lose
the raw material (deed CDN links expire before we fetch them; SOS data is never captured; owner
addresses land in five places and are never unified), so the reconcile can't run.

Grounded facts (live, 2026-07-22):
- **Deed loss:** `sidebar-pipeline.js::upsertDocumentLinks` writes only
  `{source_url, ingestion_status:'url_captured'}` — the CoStar CDN link, never the bytes. 120
  gov deeds sit `url_captured` with `storage_path=NULL`; the CDN links (ahprd1cdn.csgpimgs.com)
  have since expired. The `document-text-tick` worker REQUIRES `storage_path`, so these are
  permanently unprocessable.
- **Address framework exists, unwired:** `api/_shared/address-reverse.js` +
  `buildAddressReverseAdapter` are built and gated on `OWNER_ENRICH_ADDRESS_URL` (no-op until a
  source is wired). `enrichment_action='address_reverse_lookup'` is a routed action in
  `owner-contact-enrich.js`. The cross-reference resolver's `same_address` strategy is starved —
  its own header says *"owner entities hold no notice address in LCC."*
- **SOS automated path dead from CI** (verified in gov `docs/SOS_ENDPOINT_VERIFICATION_2026-07-22.md`):
  needs non-datacenter egress OR a human-in-the-loop capture. Scott chose the latter, modeled on
  the CoStar sidebar ingestor.

---

## Build 1 — Deed capture-at-ingestion (fully grounded, self-contained, BUILD FIRST)

**Fix the loss at the source, then recover the recoverable backlog.**

- **Forward:** when the sidebar captures a document link (`upsertDocumentLinks`), fetch the bytes
  **while the CDN link is fresh** and upload to the domain `property-documents` Storage bucket,
  setting `storage_path`. The existing artifact-storage helper + bucket pattern already exists
  (used by OM intake). The `document-text-tick` worker then picks it up automatically — no worker
  change needed. Best-effort: a fetch failure still writes the `url_captured` row (never blocks
  the capture), so this is strictly additive.
- **Backlog:** the 120 existing `url_captured` deeds have expired links. A `refetch-or-retire`
  pass tries the stored `source_url` once; on success → store bytes + `storage_path` (processable);
  on a dead link → mark a terminal `url_expired` status so they stop showing as pending work
  (honest count, not a silent backlog). Realistically most of the 120 retire; the value is the
  forward fix so we never lose another.
- **Why first:** LCC-only, no egress, no human loop, and the deed→grantee→`latest_deed_grantee`→
  R51 conflict-lane propagation chain downstream ALREADY works (105 deeds parsed, 5,899 properties
  carry a grantee). Capturing more deeds directly feeds a working pipeline. It also establishes the
  capture-and-store pattern Build 3 reuses.

## Build 2 — Continuous owner-address reconcile (the connective tissue)

**Unify every owner-address source into one address dimension on the owner, and use address as a
reconcile join key everywhere it appears.**

Owner addresses land in ≥5 places today, unconnected:
1. `recorded_owners.address` / `mailing_address` (county deed + assessor — dia/gov)
2. SOS registry `principal_address` / `mailing_address` (state of origin) — the ORE Phase A3 field
3. Asset location (the property itself)
4. Salesforce account/contact address
5. Outlook / website / web-search

Build:
- A **unified owner-address view/dimension** that gathers all sources per owner entity (normalized),
  so the cross-reference resolver's `same_address` strategy stops being starved.
- **Reconcile on write:** wherever an owner address lands (deed propagation, SOS capture, SF sync,
  Outlook ingest), run the address through the reconcile check — two owners sharing a normalized
  notice address are the same party (this is a high-authority signal in the existing
  `lcc_signal_authority` weighting: `shared_mailing_address=50`). Feed the owner-reconcile engine
  that already exists (`lcc_reconcile_owner`, the multi-signal authority-weighted resolver).
- **Wire the address-reverse adapter** (`OWNER_ENRICH_ADDRESS_URL`) as ONE input among these — a
  free/rate-limited reverse-lookup that turns an owner address into a name/occupant, gated like the
  other adapters. Not the whole build; one contributor to the address dimension.

Reuse, don't fork: `lcc_reconcile_owner`, the signal-authority weights, `address-reverse.js`, the
cross-reference `same_address` strategy. This is continuous reconciliation, not a one-shot.

## Build 3 — SOS human-in-the-loop sidebar ingestor (the walled path, done at max leverage)

**Automated SOS is blocked; pivot to the CoStar-sidebar model — a state-sorted worklist a human
works through, the sidebar capturing SOS data + documents, stored like deed (Build 1's pattern).**

- **The worklist:** a dedicated LCC surface — registered entities that need SOS capture, **sorted
  by state** (and within state, value-ranked so the human hits the highest-value owners first).
  Sourced from `entity_registry_records` empty-manager rows + the contactless high-value owners.
  State-by-state so the human batches one SOS site at a time (the natural rhythm — one login, one
  site's UX). Backlog today: FL 334 · AZ 333 · CA 481, plus the broader empty-manager set (6,570).
- **The capture:** extend the existing LCC Chrome sidebar (the CoStar/RCA ingestor) with an SOS
  mode — on a state SOS entity-detail page, the human clicks capture, the sidebar extracts
  managing member / registered agent / principal + mailing address and **stores the page/doc**
  the same way Build 1 stores a deed (bytes → Storage bucket, structured fields → the registry).
- **The flow-through is already built:** captured SOS data → `entity_registry_records`
  (`source='sos_direct'` or a new `sos_sidebar`) → the daily gov crons (03:20 manager-sync / 03:22
  address-sync) → `recorded_owners.manager_name` / `mailing_address` / `registered_agent_*` → the
  LCC 05:00 signals pull → owner pivots → cadence. So the human capture drops into an existing
  consumer chain — no new propagation.
- **Max-leverage principle:** the human does ONLY the walled step (the authenticated/bot-walled SOS
  search + page load a bot can't reach). Everything before (which entity, which state, ranked by
  value) and after (extract, store, propagate, reconcile) is automated. One human click per
  high-value owner, on a value-ranked list, is the minimal viable involvement.

---

## Sequencing

1. **Build 1 (deed capture)** — fully grounded, LCC-only, feeds a working chain, establishes the
   capture-store pattern. Smallest, highest certainty.
2. **Build 2 (address reconcile)** — the connective tissue; makes every captured address (including
   Build 1's deeds and Build 3's SOS) reconcile owners continuously. Reuses the existing engine.
3. **Build 3 (SOS sidebar)** — biggest (UI worklist + extension mode), but drops into existing
   consumers and reuses Build 1's storage pattern. Do last so it inherits 1 + 2.

Each is independently valuable and reversible. Build 1's prompt is written; 2 and 3 follow once
its shape is confirmed.
