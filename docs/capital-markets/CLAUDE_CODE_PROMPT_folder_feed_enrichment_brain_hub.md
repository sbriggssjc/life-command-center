# Claude Code prompt — Folder-feed enrichment: from "attach" to a connected, self-improving brain hub

> The cloud crawl (Phase-2 Slice 2d) is LIVE and verified: it descends the whole
> PROPERTIES tree from the cloud (depth 8), classifies every doc type (29 BOV / 85
> master / 44 OM / 33 comp / 18 lease), and attaches OMs to `property_documents`
> (66 gov, from the tree). Scott's directive raises the bar: **don't just connect
> the files — enrich the records, make the database self-improving, and connect
> every interaction bidirectionally.** A fully connected brain hub where data flows,
> reads, and writes in both directions.
>
> CRITICAL: build on the infrastructure that ALREADY exists — do NOT fork it. The
> skeleton is in place; this closes the loops. Receipts-first, gated, provenance on
> every write — same discipline as every prior round.

## What already exists (the loops to close, not rebuild)
- **Files in:** the cloud crawl (read / classify / attach).
- **Files out:** the `[LCC]` write-back (Slice 2b) — LCC docs land back in the folder, tagged, re-ingest as authoritative. Bidirectional flow, half-built.
- **The learning arbiter:** `field_provenance` + `field_source_priority` — decides which source wins per field, surfaces conflicts in the Decision Center. The self-improving mechanism; it needs more inputs flowing through it.
- **Connections:** entity graph + `external_identities` (property ↔ sale ↔ owner ↔ contact).
- **Trends:** the CM views roll enriched data into market signals.

## ENRICHMENT BOUNDARIES — what may flow where (Scott, HARD RULE)
The single most important constraint. Enrichment is NOT "write everything a file
contains into the record." Two namespaces, strictly separated:

1. **BOV / Master Sheet PRICE, CAP, and TRADE-RANGE figures are INTERNAL ADVISORY
   ONLY.** They are recommendations to a client — UNAUTHORIZED/UNAPPROVED until the
   listing is confirmed. They must **NEVER** write to any reported/market-facing
   field — not `listing_price`, `asking_price`, `asking_cap`, `last_price`, nor any
   CM-reported cohort. Store them in a separate **advisory namespace** (e.g.
   `property_valuation_advisory`), tagged internal/conversational, and add a
   `field_source_priority` rule that **bars BOV/master price+cap from the reported
   listing/asking fields entirely** (advisory source is authoritative ONLY in the
   advisory namespace). This is the same doctrine as observed-only on-market data:
   confirmed/observed in the reported numbers, estimates/advisories internal only.
2. **Promotion gate.** An advisory price may flow into reported listing/asking data
   ONLY when the listing is **confirmed** by one of: a signed listing agreement; an
   OM drafted AND listing signed; OR independent confirmation the property was listed
   online (a Salesforce listing record, or another confirmed-online signal). Until a
   confirmation exists, the advisory stays internal — never in reported data. Wire the
   gate to the listing-status signal; on confirmation, the advisory promotes with
   provenance (`source='listing_confirmed'`).

Everything in Stage B below is FACTUAL enrichment (tenant/guarantor names, rents,
leased SF, lease terms, expense history, ownership) — those flow to the records with
provenance. Only the price/cap/value ADVISORIES are gated.

## Stage A — IMMEDIATE FIX (the hand-off): non-OM docs attach, not just stage
Right now BOV / master / comp / lease are classified and `folder_feed_seen.status=
'staged'` but do NOT land as `property_documents` rows (only OMs do — 66 gov from the
tree, 0 non-OM). Diagnose and fix so the light path-anchor attach (Slice-2d Unit 2)
completes for every recognized non-OM working doc:
- Confirm whether it's the async drain still catching up, the enrich-mode roots not
  fully engaged (`FOLDER_FEED_ENRICH_ROOTS`), or the attach writing `staged` instead
  of inserting `property_documents` + setting `status='attached'`.
- Acceptance: a property's BOV / Master / comp / lease are queryable as
  `property_documents` rows with `source='folder_feed_properties'` + `field_provenance`,
  refusing on ambiguity (never guessing the property). Receipts: per-type attach
  counts on dia + gov, before/after.
- **DOMAIN SCOPE (Scott, decided):** dia/gov-first, the rest searchable-but-light.
  PROPERTIES is the WHOLE brokerage book (banks, vets, daycare, healthcare, etc.) —
  only dia/gov have curated property DBs. So:
  - **dia/gov docs** → attach to `property_documents` + enrich (Stage A/B). Full
    treatment.
  - **Out-of-domain docs** (no dia/gov property) → do NOT force into a domain and do
    NOT skip. They stay captured in `folder_feed_seen` with their path anchor
    (tenant_brand, City/ST, doc_type) — that table IS the universal doc index. Make
    `folder_feed_seen` **tenant-searchable** so "deals with <tenant> as tenant/guarantor"
    resolves across the whole book (out-of-domain from `folder_feed_seen` + dia/gov from
    domain sales/leases). Nothing lost; just not force-fit into the wrong vertical.
  - A vertical-agnostic **deal registry** that gives every out-of-domain deal a real
    connected record (Stage A.5) is the next expansion — scope it AFTER dia/gov Stage
    A/B land, not as a prerequisite.

## Stage B — ENRICHMENT: files become structured DATA through the provenance arbiter
A per-doc-type extractor turns each attached file into structured fields; EVERY write
routes through `field_provenance` / `field_source_priority` so the best source wins
and the record self-improves as better files arrive. Reuse the OM extractor pattern +
the cloud-fetch (`SHAREPOINT_FETCH_URL`) + the durable-extraction store.
- **Lease / guarantee (FACTUAL — flows to records)** → tenant name, **guarantor name**,
  rent, **leased SF**, lease structure (NNN/NN/gross), firm term, expiration, escalations,
  options, and the **TI-amortization schedule** (gov bifurcation input). These are facts
  → property/lease fields with provenance.
- **Expense history (non-NN/NNN leases — e.g. gov)** → the landlord-borne expense
  schedule, so we can compute/confirm **true NOI** (gross rent − landlord expenses) for
  reporting, trends, and the gov economic-cap. Gov leases aren't pure NNN, so NOI needs
  the expense side captured from the OM/lease/operating statements.
- **Master Sheet** → rent roll + underwriting structure (FACTUAL parts flow); but its
  **recommended price / cap / trade range is ADVISORY** → advisory namespace, gated (see
  ENRICHMENT BOUNDARIES).
- **BOV / Valuation Memo** → stabilized NOI, discount rate, lease/expense facts flow;
  but **Ask/Trade cap ranges + recommended value are ADVISORY** → advisory namespace,
  gated. The *methodology* components feed the gov-engine economic-cap (#64) for
  INTERNAL valuation, never the reported market cohort.
- **Comp** → comp record (price / cap / date / terms) — these are CLOSED deals, factual.
- **Ownership / prospecting** → owner, true owner, ownership-history, guarantor entities,
  contacts → the BD/entity graph. Files enrich prospecting + ownership-history, not just
  the asset record.
- **Searchable tenant/guarantor index (AI-accessible).** Tenant and guarantor become
  first-class normalized entities so a natural-language query — e.g. "example deals we've
  sold with Total Renal Care, Inc. as tenant or guarantor" — resolves across
  sales + leases + guarantees. Expose via the MCP context/search tools so Copilot /
  Claude / ChatGPT chats can query it directly.
- Each field write carries a source rank so the record improves as higher-trust files
  land (a confirmed lease abstract beats an OM pro-forma beats an aggregator capture).
  Conflicts surface in the existing Decision Center provenance lane. Price/cap advisories
  NEVER enter this contest on reported fields (boundary rule above).
- Acceptance: pick one fully-documented gov property; show its record enriched from its
  own BOV + master + lease (fields filled, provenance written, conflicts surfaced not
  silently overwritten). Receipts per field + source.

## Stage C/D — SELF-IMPROVEMENT + FULL CONNECTION (roadmap, scope after B lands)
- **Learning:** extraction confidence feeds `field_source_priority` (the system learns
  which channel to trust per field over time); the registry "learning loop"
  (`DECISION_PROVENANCE_LEARN`) already exists — extend it to the new sources.
- **Trends:** roll the enriched, de-distorted data into the CM trend views (the gov
  economic-cap series, lease-renewal, valuation index) — learning trends from the
  growing corpus.
- **Connection:** the entity graph ties every object so ONE query on a property returns
  its whole context — docs, sales, comps, valuation, contacts, trends. The MCP context
  tools (`get_property_context`) become the brain-hub read surface.
- **Bidirectional round-trip:** the `[LCC]` write-back emits LCC-authored BOVs/exports
  back into the folder, tagged, which re-ingest as top-trust — closing the loop.

## Guardrails
- Receipts-first; NO schema/view writes until each stage's plan is gated. Provenance on
  every field write; never silently overwrite curated data — conflicts go to the
  Decision Center.
- Cloud-first file access (the 3-day-offload rule): read via the PA flows, persist the
  extraction durably, fetch once.
- Reuse: OM extractor, folder-feed, field_provenance/priority, entity graph,
  Decision Center, `[LCC]` write-back. Add extractors + wiring, not parallel systems.
- Stage A ships first (small, unblocks the BOV/Master review). Stage B is the gov
  engine's extraction arm — coordinate with #64. C/D scope after B is verified.
