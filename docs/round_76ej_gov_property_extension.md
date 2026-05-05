# Round 76ej — Government-property extension (2026-05-05)

Round 76ej landed all of its OM-intake / sidebar-extraction fixes against the
dialysis domain. This note records which 76ej items already covered government
property captures, which were extended for gov in this follow-up, and which
were left intentionally dia-only because gov uses a different data lifecycle.

## What already worked for gov before this round

- **76ej.i — closed-listing URL-drift entity lookup.** `promoteLccEntity`
  (intake-promoter.js:1730) builds `sourceSystem='gov_db'` for the
  government domain and reuses the canonical-URL machinery unchanged.
- **76ej.j — lcc-bridge street-suffix-alias normalization.** The
  Boulevard↔Blvd / Drive↔Dr / Avenue↔Ave / Highway↔Hwy variant lookup at
  intake-promoter.js:1918 selects `dq` from the resolved domain
  (`'dialysis'` or `'government'`), so gov entities whose LCC name uses
  the long form match a gov.properties row that stored the abbreviated
  form (and vice versa).
- **field_source_priority** rules for `costar_sidebar`, `crexi_sidebar`,
  and `rca_sidebar` exist on `gov.properties`, `gov.available_listings`,
  `gov.leases`, `gov.contacts`, `gov.property_documents`, etc. via
  20260426110000 / 20260426120000 / 20260504200000 migrations, so the
  Phase 2.2 sidebar provenance instrumentation already drives gov
  decisions.
- **gov property NULL-fill semantics** are handled by
  `promotePropertyFinancials` (intake-promoter.js:771-856) for
  `noi`, `gross_rent`, `year_built`, `land_acres`, `rba`. The dia-only
  `promoteDiaPropertyFromOm` is narrower because dia.properties has no
  cap-rate / NOI / RBA columns; the gov branch does not need a separate
  function.
- **Junk-tenant filter** in sidebar-pipeline.js `upsertDomainLeases`
  early-returns for non-dialysis (`if (domain !== 'dialysis') return 0`),
  so `tenant_agency='General Services Administration'` on a gov capture
  is never tested against the dia `JUNK_TENANT_RE` / `OM_SECTION_RE` /
  `NAICS_SECTOR_RE` filters and cannot be rejected by them.

## What this round changed

**76ej.h extension — gov.property_documents persistence.**
`promoteIntakeToDomainListing` previously persisted text/* artifact bytes
into `dia.property_documents` only, hard-coding `domain='dialysis'` in
the guard at intake-promoter.js:1983. The same row shape (property_id,
file_name, document_type, source_url, ingestion_status) is already
written to `gov.property_documents` by sidebar-pipeline.js
`upsertDocumentLinks`, and the field_source_priority Phase 2.2c
extension lists those columns explicitly for gov. The promoter now
extends the guard to accept gov, passes the resolved domain to
`domainQuery`, and only attaches the dia-specific `raw_text` /
`extracted_data` columns when the domain is dialysis.

A matching entry was added to the field-provenance recording block
(intake-promoter.js step 4) so a gov OM capture writes an actionable
provenance row for `gov.property_documents.{file_name, document_type,
source_url}` against `source='om_extraction'`.

## What was left intentionally dia-only

- **`promoteDiaLeaseFromOm` (76ej.e degradation guard).** Gov leases
  follow a distinct lifecycle: GSA master leases (e.g. LPA00668) are
  loaded into `gov.leases` from the GSA IOLP master-lease table by the
  sidebar pipeline (`upsertDomainLeases` + `upsertGovBrokers` plus the
  master-lease seeder around sidebar-pipeline.js:5829), and the OM
  intake's role is only to patch `expense_structure` onto the existing
  active lease via `promoteLeaseExpenses`. There is no use case for an
  OM-driven INSERT into `gov.leases`, so 76ej.e's dialysis-targeted
  insert/PATCH/dedup logic is not mirrored.
- **Dia broker `brokers` linking (Bug J fix).** Gov has its own broker
  model wired through `prospect_leads.listing_broker_*` fields (handled
  by `promoteProspectLead`, intake-promoter.js:876), so the
  contact→brokers→listing.listing_broker_id chain is dia-specific.

## Acceptance — manual verification recipe

1. In the LCC entities table, find a gov-domain asset with a GSA tenant
   agency:

   ```sql
   SELECT id, name, metadata->>'address' AS address
     FROM lcc_opps.entities
    WHERE entity_type = 'asset' AND domain = 'government'
    LIMIT 5;
   ```

2. Pick one that is also live on CREXi or CoStar, capture via the Chrome
   sidebar (Save Property to LCC + OM upload).

3. Trace the row through:

   ```sql
   -- Stage row
   SELECT intake_id, status, raw_payload->'extraction_result'->>'document_type' AS doctype
     FROM lcc_opps.staged_intake_items
    WHERE intake_id = '<INTAKE_ID>';

   -- Promotion result
   SELECT pipeline_result->'ok' AS ok,
          pipeline_result->'property_document'->>'domain' AS doc_domain,
          pipeline_result->'property_document'->>'document_id' AS doc_id
     FROM lcc_opps.staged_intake_promotions
    WHERE intake_id = '<INTAKE_ID>';

   -- Domain-DB landing
   SELECT * FROM gov.available_listings WHERE intake_id = '<INTAKE_ID>';
   SELECT * FROM gov.property_documents WHERE document_id = '<DOC_ID>';

   -- Provenance trail (should show write/skip, not conflict)
   SELECT target_table, field_name, source, decision
     FROM lcc_opps.field_provenance
    WHERE source_run_id = '<INTAKE_ID>'::text
    ORDER BY target_table, field_name;
   ```

4. Confirm `lookup_asset` from the sidebar resolves the same gov entity
   (the canonical_url + domain_listing_id machinery from 76ej.i is
   domain-agnostic, but a conflict-decision row on gov.* would indicate
   a missed field_source_priority entry — file a follow-up if so).
