# Oncology / Infusion Phase A Build Plan v0.1

**Status:** Recommended local-only implementation plan; no source download, database migration or ingestion authorized  
**Date:** 2026-08-11  
**Parent:** `ONCOLOGY-INFUSION-IMPLEMENTATION-READINESS-PACKAGE-v0.1.md`

**Business feasibility companion:** `HEALTHCARE-REAL-ESTATE-AND-ECONOMICS-BUSINESS-PLAN-v0.1.md`

**Cross-lane comparison:** `HEALTHCARE-SWIM-LANE-EVALUATION-MATRIX-v0.1.md`

## 1. Outcome

Phase A should produce a deterministic, local-only adapter that can validate a frozen NPPES/NUCC source bundle,
stream the relevant NPPES records and emit sanitized aggregate receipts. It must not connect to Supabase,
Salesforce or the LCC API.

The approval decision at the end of Phase A is narrow:

> Is the adapter safe and reproducible enough to test against a disposable database in Phase B?

Phase A does not answer whether the candidates are commercially useful. That requires the private source run,
50-record review and service corroboration gates in later phases.

## 2. Recommended implementation shape

Keep source-independent logic in a small library and make every command a thin wrapper.

```text
scripts/healthcare-discovery/
  cli.mjs
  manifest.mjs
  nppes-parser.mjs
  nucc-taxonomy.mjs
  normalize.mjs
  profiler.mjs
  receipts.mjs
test/
  healthcare-discovery-manifest.test.mjs
  healthcare-discovery-nppes.test.mjs
  healthcare-discovery-taxonomy.test.mjs
  healthcare-discovery-profile.test.mjs
test/fixtures/healthcare-discovery/
  nppes-v2-synthetic.csv
  nucc-synthetic.csv
  manifest.valid.json
  manifest.invalid-checksum.json
```

Fixtures must be synthetic and contain no copied provider names, NPIs, phone numbers or addresses. Include
deliberately difficult CSV cases: commas and quotes in names, blank optional columns, multiple taxonomies,
multiple locations, a deactivated organization, duplicate observations and malformed rows.

Use a maintained streaming CSV parser with RFC 4180 behavior rather than splitting lines or loading the whole
file into memory. Pin the reviewed dependency version and commit the lockfile change. The parser dependency is
the only expected new runtime dependency in Phase A.

## 3. Work packages

### A0 — Freeze the executable contracts

- Add the six `healthcare:nppes:*` package scripts defined in the readiness package.
- Define one shared CLI argument parser with unknown-argument rejection.
- Require explicit `--manifest` and `--output` paths; never infer a production location.
- Reject output paths inside tracked repository directories unless they are synthetic test fixtures.
- Add `/private/healthcare-discovery/` to `.gitignore` before any real source artifact is downloaded.
- Make `--help` and validation commands network-free and credential-free.

**Receipt:** command-contract tests and a checked-in synthetic manifest.

### A1 — Manifest and source-integrity validator

- Validate the manifest against an explicit in-code schema and reject unknown top-level keys.
- Recompute file byte size, SHA-256 and header SHA-256 from disk.
- Require official HTTPS source origins recorded in the manifest, while reading only local frozen files.
- Validate release dates, transform Git SHA, seed-code set, sample size and deterministic random seed.
- Fail closed on placeholders, missing files, checksum mismatch, duplicate source names or unclean transform IDs.
- Never print source rows, full paths, credentials or environment variables in receipts or errors.

**Receipt:** one machine-readable validation receipt containing manifest fingerprint, source fingerprints and a
pass/fail reason taxonomy.

### A2 — NUCC taxonomy gate

- Resolve the three approved codes from the frozen NUCC artifact:
  `261QX0200X`, `261QI0500X` and `261QX0203X`.
- Assert the expected grouping, classification, specialization, definition status and non-individual role.
- Detect missing, duplicate or materially changed concepts.
- Keep adjacent/review-only taxonomies in configuration, separate from seed eligibility.
- Store the taxonomy release fingerprint in every profile receipt.

**Receipt:** code-by-code taxonomy assertions with no provider data.

### A3 — Streaming NPPES parser and candidate reducer

- Read the Version 2 header dynamically and map required columns by exact name.
- Reject a source with missing required columns; report additive unknown columns as schema drift.
- Process one row at a time with bounded memory and periodic aggregate progress only.
- Admit only Entity Type Code 2, active-as-of-freeze-date, United States practice locations with an approved
  facility seed taxonomy.
- Preserve primary and additional practice locations as separate observations.
- Generate stable row, address and candidate fingerprints from versioned normalization rules.
- Route collisions, incomplete addresses and conflicting taxonomy/location observations into aggregate reason
  buckets rather than guessing.
- Cap malformed-row examples at synthetic/local test mode; real-run receipts contain counts and error classes
  only.

**Receipt:** deterministic aggregate profile by modality, state, location role, exclusion reason and collision
class.

### A4 — Reproducibility, privacy and resource tests

- Run the same fixture twice and require byte-identical canonical JSON receipts.
- Change the manifest, taxonomy version or normalization version and prove the fingerprint changes.
- Prove malformed input fails without a partial success receipt.
- Prove the commands make no network calls and do not read Supabase, Salesforce or LCC credentials.
- Add a generated large synthetic stream test to enforce bounded memory and avoid checking in a large fixture.
- Scan committed fixtures and receipts for realistic NPI/address/phone patterns.
- Run the repository test suite and whitespace/secret checks.

**Receipt:** a Phase A acceptance report generated from synthetic inputs only.

## 4. Receipt contract

Every successful command writes canonical JSON with sorted keys and a versioned schema. At minimum:

```json
{
  "receipt_version": "1.0",
  "command": "profile",
  "transform_version": "git:<40-character-sha>",
  "manifest_sha256": "<64 lowercase hex>",
  "schema_fingerprint": "<64 lowercase hex>",
  "taxonomy_fingerprint": "<64 lowercase hex>",
  "counts": {
    "source_rows": 0,
    "parsed_rows": 0,
    "eligible_organizations": 0,
    "candidate_locations": 0,
    "excluded": 0,
    "malformed": 0
  },
  "breakdowns": {
    "modality": {},
    "state": {},
    "location_role": {},
    "exclusion_reason": {},
    "collision_class": {}
  },
  "warnings": []
}
```

The receipt must not contain names, NPIs, street addresses, phones, source rows or database identifiers. Counts
with very small cells may remain in the private receipt but should be suppressed or grouped before a report is
committed publicly.

## 5. Phase A acceptance gate

Phase A is complete only when all are true:

1. All synthetic fixture tests pass under the repository's supported Node version.
2. The parser is streaming and passes the generated-volume resource test.
3. Checksums, header drift and taxonomy drift fail closed.
4. Two identical runs produce identical fingerprints, counts and canonical receipt bytes.
5. No command has a database client, API client, download behavior or production-write mode.
6. No real provider-level data or private source manifest is tracked by Git.
7. The full repository test suite remains green.
8. Code review approves the parser dependency and normalization rules.

Only then should Phase B add proposed SQL migrations and privilege tests against a disposable/local Postgres
environment.

## 6. Recommended checkpoint sequence

Use small commits that can be independently reviewed and reverted:

1. **A0:** command skeleton, ignore rule, synthetic fixtures and manifest contract.
2. **A1/A2:** checksum validator and taxonomy gate with tests.
3. **A3:** streaming parser, normalization and aggregate profiler with tests.
4. **A4:** reproducibility/privacy/resource tests and Phase A acceptance receipt.

Push each checkpoint after the relevant tests pass. Do not mix Phase B DDL, private source downloads or
production configuration into these commits.

## 7. Expansion roadmap after Phase A

| Stage | Primary question | Deliverable | Gate |
|---|---|---|---|
| B | Can the private schema and privileges be enforced? | Disposable-DB migration and role tests | DDL review |
| C | What does the frozen national source actually yield? | Private aggregate dry-run receipt | Source authorization |
| D | Are candidates truly facilities providing the stated services? | Stratified 50-record review | Precision ≥ 90% |
| E | Can a private discovery version be reproduced and rolled back? | Published private version | Ingestion approval |
| F | Which 200 properties matter commercially? | Scored pilot cohort and review lane | Business approval |
| G | How should verified facilities enter LCC/Salesforce? | Governed promotion proposal | Separate write approval |

Commercial scoring should not begin before the service-corroboration sample passes. Otherwise the model risks
optimizing a large but clinically or real-estate-irrelevant candidate set.

The private verification sample must also measure property form, healthcare-user building share, owner/operator
affiliation, third-party-landlord addressability and economics-source coverage. These results determine whether
oncology/infusion is a scalable net-lease lane; discovery volume alone is not a business-feasibility result.

## 8. Current implementation status and immediate recommendation

- A0 is complete on `main`: six fail-closed command contracts, synthetic fixtures and private-path exclusion.
- A1/A2 are implemented against synthetic fixtures: manifest/source integrity and the three-code NUCC gate.
- A3 is implemented against synthetic fixtures for the primary practice-location file: dynamic header mapping,
  row-streamed parsing, versioned address normalization, deterministic fingerprints and aggregate-only receipts.
- The NPPES secondary-practice-location reference file still requires a manifest-contract extension before A3
  is complete for both location roles; it must not be silently treated as part of the primary monthly file.
- No real CMS/NUCC artifact, provider record, database connection or production write mode has been added.

The next bounded checkpoint is A3.1/A4: add the separate secondary-location source contract, join it by NPI
without emitting provider identifiers, and add reproducibility/privacy/resource acceptance tests. Keep the
implementation synthetic until A3/A4 acceptance tests pass. After Phase A, compare the observed
oncology/infusion feasibility results under the cross-lane matrix before authorizing a production-bound model.
