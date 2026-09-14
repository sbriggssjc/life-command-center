# Oncology / Infusion Staging and Ingestion Contract v0.1

**Status:** Design complete; implementation not authorized
**Date:** 2026-08-11
**Parent:** `ONCOLOGY-INFUSION-NPPES-SOURCE-ADAPTER-SPEC-v0.1.md`

## 1. Decision

Land the first NPPES discovery run in an isolated `healthcare_discovery` schema in LCC Opps. Keep source
observations immutable, derive candidates reproducibly, and prohibit promotion into canonical property,
facility, contact, task or Salesforce surfaces until the verification gate passes.

The first run is a private dry run. This document is a logical contract, not an approved migration.

## 2. Database boundary

LCC Opps owns the cross-vertical discovery and identity layer. Dialysis_DB and government remain read-only
enrichment sources and do not receive NPPES staging rows. The schema is not exposed through the Data API.
Only the ingestion service role and a named read-only profiling role receive privileges.

If platform configuration later exposes the schema, implementation must add explicit grants and RLS policies
before access. No browser client receives write access.

## 3. Logical tables

| Table | Grain | Purpose |
|---|---|---|
| `source_release` | One source artifact/version | URL, file date, checksum, size, taxonomy version and ingest status |
| `ingest_run` | One attempt against one release | Code version, parameters, counts, timestamps and failure receipt |
| `nppes_organization` | Release + Type 2 NPI | Immutable organization-level NPPES observation |
| `nppes_location` | Release + NPI + location role + source ordinal | Primary and additional practice-location observations |
| `nppes_taxonomy` | Release + NPI + taxonomy ordinal | Code, primary flag, license fields and resolved NUCC concept |
| `facility_candidate` | Candidate version + NPI + normalized practice location | Derived, reproducible discovery candidate |
| `candidate_evidence` | Candidate + source observation | Taxonomy, address, service and operating-status evidence |
| `property_resolution` | Candidate + resolver version | LCC property match candidates, scores and disposition |
| `verification_sample` | Frozen sample + candidate | Stratification cell, reviewer disposition and error labels |

## 4. Required controls

- Natural-key uniqueness is enforced at every immutable observation grain.
- Every derived row carries `source_release_id`, `ingest_run_id`, `transform_version` and a deterministic
  fingerprint.
- Raw source text is retained only in private object storage or Git-ignored workspace files; database rows
  retain parsed fields and source pointers.
- Names, addresses and phone numbers are treated as internal operational data even though the source is public.
- Re-running the same release and code version is idempotent.
- A failed run never replaces the last complete candidate version.
- Full monthly loads create a new frozen release; weekly increments append observations and supersede candidate
  facts rather than mutating historical evidence.

## 5. Candidate state machine

`seeded -> address_normalized -> address_resolved -> service_corroborated -> commercially_verified`

Terminal or held states are `excluded`, `duplicate`, `closed`, `relocated` and `needs_review`. State changes
require an evidence row and reason code. NPPES evidence alone cannot create `service_corroborated`.

## 6. Ingestion sequence

1. Download the CMS full monthly Version 2 archive and current NUCC release to private storage.
2. Record source URLs, timestamps, byte sizes and SHA-256 checksums before extraction.
3. Validate headers against an explicit allow-list; fail closed on missing required columns.
4. Stream Type 2 rows and the practice-location reference file; do not load the full file into application
   memory.
5. Resolve the approved facility taxonomy concepts from the versioned NUCC artifact.
6. Bulk-load parsed observations into temporary private tables using PostgreSQL `COPY` or equivalent direct
   connection bulk loading.
7. Validate row counts, uniqueness, NPI shape, taxonomy coverage, US-address completeness and deactivation
   logic.
8. In one transaction, publish the immutable source observations and mark the run complete.
9. Build a frozen candidate version using deterministic SQL/transforms.
10. Produce aggregates and a capped private sample; do not promote canonical records.

## 7. Failure and rollback behavior

The loader never deletes a prior complete release. A run may be retried only after its failure receipt records
the failed stage, error class and observed counts. Publication is transactional: an incomplete release remains
unavailable to candidate builders. Rollback means selecting the prior complete candidate version, not reversing
source history.

## 8. Dry-run acceptance checks

- downloaded and parsed row counts reconcile to source files;
- all seeded NPIs are Type 2 and active at the freeze date;
- all seed taxonomies resolve to the frozen NUCC release;
- no mailing-only location enters the candidate table;
- duplicate natural keys equal zero after deterministic deduplication;
- candidate counts reproduce from the same release and transform version;
- database roles demonstrate that anonymous/authenticated clients cannot read or write the schema;
- no canonical LCC, domain or Salesforce row changes during the run.

## 9. Implementation gate

Before creating the schema, approve: target Supabase project, private-storage location, service identity,
retention period, exact DDL, privilege matrix and rollback test. Run database security/performance advisors after
the migration and verify access using both the ingestion identity and an unprivileged identity.

Implementation-readiness package:
`ONCOLOGY-INFUSION-IMPLEMENTATION-READINESS-PACKAGE-v0.1.md`.
