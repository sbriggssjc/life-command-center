# Healthcare ASC-First Private Artifact Staging Runbook v0.1

**Status:** Run harness implemented and synthetically verified; official run not authorized  
**Lane:** Ambulatory surgery centers only  
**Network boundary:** The staging command has no downloader, uploader, database client, or CRM client

## 1. Purpose

This runbook governs the first use of `healthcare:artifact-staging` against official ASC artifacts that have
already been placed in an approved private filesystem root. The command verifies the four-file bundle,
materializes a private `draft_unapproved` authorization packet, and writes a separate aggregate-only receipt.
It cannot approve execution or draw the 50-property sample.

## 2. Preconditions

Do not run the command until all of the following are recorded outside Git:

1. The absolute private staging root and its access owner.
2. The run operator and a different independent verifier.
3. The exact official CMS artifact URL and release date for all four source keys.
4. The four source files already present under the private root as non-symlink regular files.
5. The verifier's independently recomputed byte size, whole-file SHA-256, and first-header SHA-256.
6. Private bucket/prefix controls, reviewer rules, retention, privacy receipt, and lane stop conditions.

The required source keys are `cms_pos_asc`, `cms_ascqr_facility`, `cms_ffs_enrollment`, and
`cms_asc_payment`. A landing page, latest-version alias, mirror, estimated date, or placeholder digest fails
the contract.

## 3. Private request file

Create `asc-staging-request.json` inside the approved private root. It contains:

- `artifacts`: one record per required source with `source_key`, relative `local_path`, exact official
  `artifact_url`, and `release_date`;
- `verifier_attestations`: one record per source with `source_key`, independent `verifier_id`, `byte_size`,
  `sha256`, and `header_sha256`; and
- `authorization_envelope`: `created_at`, private `storage`, frozen reviewer evidence dictionary,
  second-review policy, retention, aggregate privacy receipt, and ASC stop conditions.

Do not put the request, source files, verifier identities, private paths, or resulting private packet in Git.
The harness derives `source_manifest_release_id` from the verified artifact bundle and forces the packet to
`draft_unapproved` with an empty approval list.

## 4. Command

From the repository root in PowerShell, substitute the approved absolute paths:

```powershell
npm run healthcare:artifact-staging -- `
  --template test/fixtures/healthcare-discovery/asc-release-packet-template.json `
  --request "D:\LCC-Private\healthcare-discovery\asc\<release>\asc-staging-request.json" `
  --approved-root "D:\LCC-Private\healthcare-discovery\asc\<release>" `
  --private-packet-output "D:\LCC-Private\healthcare-discovery\asc\<release>\asc-draft-packet.json" `
  --receipt-output "D:\LCC-Private\healthcare-discovery\receipts\asc-<release>-receipt.json"
```

The output directories must already exist. Existing outputs are never overwritten.

## 5. Expected result

Success prints:

```text
ASC artifacts staged as draft_unapproved; execution remains unauthorized
```

The private packet contains exact official artifact identities and the governed authorization envelope. The
aggregate receipt contains the release fingerprint, artifact count, privacy classification, and false values
for execution, sample draw, and production-write authorization. It contains no paths, verifier IDs, provider
identifiers, or signed URLs.

## 6. Stop and escalation rules

Stop without retrying around the control when any path escapes the root, an artifact is missing/empty/a
symlink, source keys are duplicated or incomplete, the origin is not official CMS HTTPS, a date is invalid,
either digest calculation disagrees, a destination already exists, or the privacy/authorization envelope is
invalid. Correct the source or create a new release directory; never weaken the validator.

After a successful run, review the private packet and aggregate receipt. A separate checkpoint must validate
the execution boundary and add two distinct approvals (`release_owner` and `privacy_reviewer`) before any
official ASC profiling or 50-property sampling begins.
