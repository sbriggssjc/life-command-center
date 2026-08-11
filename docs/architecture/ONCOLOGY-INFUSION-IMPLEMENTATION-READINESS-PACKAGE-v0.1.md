# Oncology / Infusion Implementation Readiness Package v0.1

**Status:** Reviewable implementation design; no schema creation or ingestion authorized
**Date:** 2026-08-11
**Target:** LCC Opps (`xengecqvemvfknjvbvrq`), private `healthcare_discovery` schema

## 1. Frozen seed taxonomy contract

Use the current NUCC release artifact and verify these exact rows by code and display name before every run:

| Code | Concept | Discovery role |
|---|---|---|
| `261QX0200X` | Oncology Clinic/Center | Seed; modality `oncology` |
| `261QI0500X` | Infusion Therapy Clinic/Center | Seed; modality `infusion` |
| `261QX0203X` | Radiation Oncology Clinic/Center | Seed; modality `radiation_oncology` |

All three are organization/facility concepts. An NPPES row must also be Entity Type Code 2, active at the
freeze date, and tied to a usable practice location. Do not seed from individual oncology clinicians.

Review-only concepts include Medical Specialty Clinic/Center, Multi-Specialty Clinic/Center, hospitals,
pharmacies, home-infusion suppliers and individual physician/nurse/pharmacist taxonomies. They may corroborate
or explain a seeded facility but cannot independently create one.

Fail closed if the versioned NUCC artifact omits a code, changes its grouping/classification/specialization, or
has a checksum different from the approved manifest.

## 2. Proposed private schema

This is proposed DDL, not an approved migration. Generate the eventual migration with the repository's
Supabase migration workflow after a private dry-run review.

```sql
begin;

create schema if not exists healthcare_discovery;
revoke all on schema healthcare_discovery from public, anon, authenticated;

create table healthcare_discovery.source_release (
  id uuid primary key default gen_random_uuid(),
  source_name text not null check (source_name in ('nppes_v2', 'nucc_taxonomy')),
  release_date date not null,
  source_url text not null,
  object_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size > 0),
  schema_fingerprint text not null,
  status text not null check (status in ('registered', 'validated', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  unique (source_name, release_date, sha256)
);

create table healthcare_discovery.ingest_run (
  id uuid primary key default gen_random_uuid(),
  source_release_id uuid not null references healthcare_discovery.source_release(id),
  transform_version text not null,
  parameter_fingerprint text not null,
  status text not null check (status in ('started', 'validated', 'published', 'failed')),
  observed_counts jsonb not null default '{}'::jsonb,
  failure_stage text,
  failure_class text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (source_release_id, transform_version, parameter_fingerprint)
);

create table healthcare_discovery.nppes_organization (
  source_release_id uuid not null references healthcare_discovery.source_release(id),
  npi text not null check (npi ~ '^[0-9]{10}$'),
  entity_type_code smallint not null check (entity_type_code = 2),
  legal_business_name text not null,
  other_name text,
  enumeration_date date,
  last_update_date date,
  deactivation_date date,
  reactivation_date date,
  row_fingerprint text not null,
  primary key (source_release_id, npi)
);

create table healthcare_discovery.nppes_location (
  source_release_id uuid not null,
  npi text not null,
  location_role text not null check (location_role in ('primary_practice', 'other_practice')),
  source_ordinal integer not null check (source_ordinal >= 0),
  address_1 text not null,
  address_2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country_code text not null default 'US',
  phone text,
  normalized_address text,
  row_fingerprint text not null,
  primary key (source_release_id, npi, location_role, source_ordinal),
  foreign key (source_release_id, npi)
    references healthcare_discovery.nppes_organization(source_release_id, npi)
);

create table healthcare_discovery.nppes_taxonomy (
  source_release_id uuid not null,
  npi text not null,
  taxonomy_ordinal integer not null check (taxonomy_ordinal >= 1),
  taxonomy_code text not null,
  is_primary boolean not null default false,
  license_number text,
  license_state text,
  concept text not null,
  seed_eligible boolean not null default false,
  row_fingerprint text not null,
  primary key (source_release_id, npi, taxonomy_ordinal),
  foreign key (source_release_id, npi)
    references healthcare_discovery.nppes_organization(source_release_id, npi)
);

create table healthcare_discovery.facility_candidate (
  id uuid primary key default gen_random_uuid(),
  candidate_version text not null,
  source_release_id uuid not null references healthcare_discovery.source_release(id),
  ingest_run_id uuid not null references healthcare_discovery.ingest_run(id),
  npi text not null,
  normalized_address text not null,
  modality text not null check (modality in ('oncology', 'infusion', 'radiation_oncology', 'multi')),
  state text not null check (state in (
    'seeded', 'address_normalized', 'address_resolved', 'service_corroborated',
    'commercially_verified', 'excluded', 'duplicate', 'closed', 'relocated', 'needs_review'
  )),
  deterministic_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (candidate_version, deterministic_fingerprint)
);

create table healthcare_discovery.candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references healthcare_discovery.facility_candidate(id),
  evidence_type text not null,
  source_release_id uuid references healthcare_discovery.source_release(id),
  source_url text,
  retrieved_at timestamptz,
  evidence_fingerprint text not null,
  supports_state text,
  disposition text not null check (disposition in ('supports', 'conflicts', 'neutral')),
  unique (candidate_id, evidence_fingerprint)
);

create table healthcare_discovery.property_resolution (
  candidate_id uuid not null references healthcare_discovery.facility_candidate(id),
  resolver_version text not null,
  lcc_property_id text,
  match_method text not null,
  match_score numeric(5,2),
  disposition text not null check (disposition in ('unique', 'ambiguous', 'no_match', 'rejected')),
  evidence jsonb not null default '{}'::jsonb,
  primary key (candidate_id, resolver_version)
);

create table healthcare_discovery.verification_sample (
  sample_version text not null,
  candidate_id uuid not null references healthcare_discovery.facility_candidate(id),
  stratum text not null,
  random_seed bigint not null,
  reviewer_disposition text,
  error_labels text[] not null default '{}',
  reviewed_at timestamptz,
  primary key (sample_version, candidate_id)
);

alter table healthcare_discovery.source_release enable row level security;
alter table healthcare_discovery.ingest_run enable row level security;
alter table healthcare_discovery.nppes_organization enable row level security;
alter table healthcare_discovery.nppes_location enable row level security;
alter table healthcare_discovery.nppes_taxonomy enable row level security;
alter table healthcare_discovery.facility_candidate enable row level security;
alter table healthcare_discovery.candidate_evidence enable row level security;
alter table healthcare_discovery.property_resolution enable row level security;
alter table healthcare_discovery.verification_sample enable row level security;

commit;
```

No permissive policies are proposed because the schema stays outside Exposed Schemas. RLS is defense in depth;
schema/table grants remain the primary private boundary.

## 3. Proposed privilege matrix

Use dedicated `NOLOGIN` database roles inherited only by controlled service identities. Final role names must be
checked against existing roles before migration.

| Capability | Loader role | Profiler role | `anon` / `authenticated` | Browser app |
|---|---:|---:|---:|---:|
| Schema usage | Yes | Yes | No | No |
| Source/release write | Yes | No | No | No |
| Candidate build/write | Yes | No | No | No |
| Aggregate/select | Yes | Yes | No | No |
| Row-level private sample | Yes | Yes, controlled session | No | No |
| Canonical LCC/Salesforce write | No | No | No | No |

Apply grants explicitly; do not grant to `service_role` generically unless the runtime cannot use a narrower
identity and that exception is approved and recorded.

## 4. Source manifest

One immutable JSON manifest accompanies each run in Git-ignored private storage:

```json
{
  "manifest_version": "1.0",
  "freeze_date": "YYYY-MM-DD",
  "transform_version": "git:<40-character-sha>",
  "sources": [
    {
      "name": "nppes_v2_monthly",
      "release_date": "YYYY-MM-DD",
      "url": "<official CMS URL>",
      "object_path": "private/healthcare-discovery/source/<release>/<file>",
      "sha256": "<64 lowercase hex>",
      "byte_size": 1,
      "header_sha256": "<64 lowercase hex>"
    },
    {
      "name": "nucc_taxonomy",
      "release_date": "YYYY-MM-DD",
      "url": "<official NUCC URL>",
      "object_path": "private/healthcare-discovery/source/<release>/<file>",
      "sha256": "<64 lowercase hex>",
      "byte_size": 1,
      "approved_seed_codes": ["261QX0200X", "261QI0500X", "261QX0203X"]
    }
  ],
  "parameters": {
    "entity_type_code": 2,
    "country_code": "US",
    "include_deactivated": false,
    "candidate_minimum": 400,
    "sample_size": 50,
    "random_seed": 0
  }
}
```

The real manifest must use the downloaded artifact's actual official URL, size, dates and checksums. Never use
placeholder values for execution.

## 5. Dry-run command contract

The implementation should expose explicit phases rather than one opaque command:

```text
npm run healthcare:nppes:manifest -- --release <YYYY-MM> --private-root <path>
npm run healthcare:nppes:validate -- --manifest <manifest.json>
npm run healthcare:nppes:profile -- --manifest <manifest.json> --output <private-report.json>
npm run healthcare:nppes:load -- --manifest <manifest.json> --mode dry-run
npm run healthcare:nppes:sample -- --run-id <uuid> --size 50 --seed <integer>
npm run healthcare:nppes:verify -- --run-id <uuid>
```

`manifest`, `validate` and local `profile` must work before database creation. `load --mode dry-run` must use a
transaction or temporary/private scratch tables and end without a published release. No command may default to
production writes.

Required aggregate receipts:

- source bytes, file rows and parsed rows;
- active Type 2 organizations by seed code;
- primary/other practice locations and unusable addresses;
- deterministic duplicates and collision groups;
- candidate counts by state and modality;
- exact LCC match, ambiguous match and no-match counts;
- zero canonical LCC, domain or Salesforce writes.

## 6. Rollback and verification

Rollback is selection of the prior published candidate version. Never delete the last complete release.

Before authorization, prove:

1. a deliberately failed validation creates no published release;
2. a failed load rolls back every observation and candidate row from that attempt;
3. rebuilding the same release/version produces identical fingerprints and counts;
4. switching the active candidate version restores the prior aggregate result;
5. `anon` and `authenticated` cannot use the schema or select any table;
6. the profiler can select but cannot insert/update/delete;
7. the loader cannot write canonical LCC/Salesforce tables;
8. database security and performance advisors show no new unresolved finding attributable to the migration.

## 7. Build sequence and approval gates

| Phase | Output | Approval required before next phase |
|---|---|---|
| A | Parser, manifest validator, taxonomy tests, local aggregate profile | Code review |
| B | Proposed migration and privilege tests against disposable/local database | DDL review |
| C | Private source download and non-production dry run | Source/release authorization |
| D | Frozen 50-record private verification sample | Sample review and precision gate |
| E | Private published discovery version; no canonical promotion | Ingestion authorization |
| F | 200-property cohort and governed review lane | Business cohort approval |
| G | Canonical/Salesforce write proposal | Separate write authorization and metadata gate |

The immediate authorized work remains Phase A design/code preparation only. No download, live schema creation,
row-level extraction, or production ingestion is implied by this package.

The local-only implementation sequence, receipt contract, synthetic-fixture rules and Phase A acceptance gate
are defined in `ONCOLOGY-INFUSION-PHASE-A-BUILD-PLAN-v0.1.md`.

## 8. Current platform basis

- CMS NPPES downloadable files and companion reference files: `https://download.cms.gov/nppes/NPI_Files.html`
- Current NUCC taxonomy lookup: `https://taxonomy.nucc.org/`
- Supabase private-schema/Data API guidance: `https://supabase.com/docs/guides/api/securing-your-api`
- Supabase custom-schema guidance: `https://supabase.com/docs/guides/api/using-custom-schemas`
