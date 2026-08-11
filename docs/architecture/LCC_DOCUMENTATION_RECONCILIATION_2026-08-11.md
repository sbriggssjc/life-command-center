# LCC Documentation Reconciliation — Architecture, OS, and Power Automate

**Review date:** 2026-08-11
**Scope:** `docs/architecture`, `docs/os`, and `docs/flows`
**Purpose:** Establish what the repository already proves, identify documentation drift, and define the remaining evidence needed before the outpatient-healthcare lane is built.

## Executive conclusion

The repository already documents most of the functional architecture needed to understand the current LCC system. The missing work is not a wholesale Power Automate or Salesforce discovery exercise. The priority is to reconcile several overlapping and differently aged documents into a machine-readable operating register, verify deployed Power Automate versions and Salesforce metadata, and close a short list of production-control gaps.

The documented architecture supports the current lane-expansion recommendation:

1. LCC is the shared brain, identity, workflow, evidence, provenance, health, and governed-action layer.
2. Dialysis and Government remain authoritative for their specialty facts and underwriting logic.
3. Power Automate is the Microsoft/Salesforce transport layer; validation, matching, promotion, and canonical writes occur behind LCC or specialty backend contracts.
4. New healthcare specialties should be added as lane packs using shared contracts, not by copying the existing database and flow stacks.

## Sources and authority order used

Where documents conflict, use this order:

1. Production-verified, dated runbooks and dated architecture audits.
2. `docs/os/BUILD-STATUS.md` for the last consolidated status, subject to later dated evidence.
3. `docs/os/REGISTRY.md` and `docs/os/README.md` for source-of-truth routing.
4. Flow-specific runbooks and change logs.
5. Undated designs, plans, and historical round logs.

This order is necessary because `BUILD-STATUS.md` was last updated 2026-07-28, while later July/August documents record production changes not reflected there.

## What is already documented well

### 1. Operating-system doctrine

`docs/os/README.md`, `REGISTRY.md`, `UNIFIED-ARCHITECTURE.md`, and the canon define a strong consistency model: one source per capability, many surfaces, versioned renderers, and explicit separation among brain, memory, policy canon, knowledge, and front doors.

### 2. LCC's role

The documentation consistently positions LCC as the cross-system orchestration and intelligence layer. It owns cross-domain identity, workflow, memory, evidence, provenance, health, and controlled actions while the specialty systems retain domain calculation and underwriting authority.

### 3. Power Automate boundary

The strongest flow documentation states that Power Automate is transport only. It authenticates through Northmarq SSO, collects Salesforce or Microsoft data, moves files or metadata, invokes governed endpoints, and records outcomes. Deduplication, routing, storage, extraction, matching, and promotion belong behind backend contracts.

### 4. Salesforce connectivity constraint

Northmarq Salesforce is SSO-gated and the repository records that a direct server-side Connected App path is unavailable. Power Automate's interactively authenticated Salesforce connector is therefore the supported transport. This is an architectural constraint, not a temporary convenience.

### 5. Broker-specific versus shared flows

`docs/os/architecture/scott-pa-flows-reference.md` distinguishes:

- Broker-specific flows for mailbox intake, flagged-email completion, calendars, drafts, briefings, and folder watches.
- Shared team flows for Salesforce pipeline, deal rosters, object/activity/file sync, writeback draining, market feeds, and shared reporting.

This distinction is directly reusable for future lanes: lane expansion should extend shared flows and configuration, not replicate broker-specific bundles.

### 6. Salesforce backbone

The repository documents live Opportunity/deal synchronization, Team Briggs roster edges, activity ingestion, LCC-to-Salesforce queue draining, file discovery, Salesforce ownership logic, and several custom-field/API names. It also documents that the Salesforce object labeled Deal is the standard `Opportunity` for the live pipeline.

### 7. File-ingestion contract

`docs/flows/FLOW_sf_file_discovery.md` defines a production-verified file contract using `ContentDocumentLink` and `ContentVersion`, version-level deduplication, checksums, file-type and size gates, retry-safe endpoints, and asynchronous extraction. It is usable prior art for every future lane.

### 8. Reliability and security standards

The repository contains error-plane, dead-letter, retry, correlation, idempotency, observability, rollback, and secret-handling guidance. The May audit documents 33 flows wired to the health/dead-letter plane, with a controlled fire test and DRY secret management still open at that time.

## Findings that change or sharpen the lane-expansion design

1. **A fourth database is not needed for the first healthcare pilot.** The existing architecture already has generic identity, intake, document, activity, provenance, and workflow primitives.
2. **A reusable lane is primarily configuration plus specialty facts.** The lane pack should define taxonomy, source adapters, specialty fields, scoring/underwriting modules, views, prompts, and acceptance tests.
3. **Salesforce and Microsoft integration should be shared across lanes.** Lane identity should travel as metadata/routing configuration inside shared envelopes.
4. **The first pilot must not create new direct domain writes from Power Automate.** It should use the existing collector-to-backend pattern.
5. **The current cross-domain file flow is valuable prior art but contains technical debt.** Its endpoint is hosted in the Dialysis Supabase project and uses service-role access to both specialty databases. The pattern should be moved behind an LCC-owned shared contract before it becomes the template for lane three.

## Documentation conflicts and drift

### A. Canonical status is stale

`docs/os/BUILD-STATUS.md` calls itself the honest status source but is dated 2026-07-28. Later documents describe production verification, Wave 7 work, dossier changes, intake changes, and data-integrity audits. The status file must be refreshed or generated from a registry.

### B. The registry contains a contradictory follow-up

`docs/os/REGISTRY.md` describes render/parity enforcement as built, while an open follow-up still says to build the single canon renderers. That follow-up appears stale and should be closed or rewritten.

### C. Flow documentation has two homes

Most flow runbooks live under `docs/architecture/flows`, while the newer Salesforce file-discovery documentation and import package live under `docs/flows`. The repository needs one canonical flow index and a redirect rule between these locations.

### D. Plans and production facts are interleaved

Several documents contain both proposed future architecture and verified live behavior. Every registry record should carry one of: `verified_live`, `built_pending_apply`, `designed`, `retired`, or `historical`.

### E. Flow names are not normalized

The same capability appears with different punctuation, prefixes, or names across the failure ledger, audit, flow reference, and runbooks. Exact production display name and a stable logical flow ID must be stored separately.

## What remains genuinely missing

### P0 — required before lane-three production execution

1. **Deployed Power Automate inventory.** Exact display name, immutable flow ID, environment, solution, owner, on/off state, trigger, connections, child flows, endpoint, last modified time, last successful run, export version, and retirement status.
2. **Salesforce metadata dictionary.** Exact object and field API names, labels, data types, required/writable flags, lookups, record types, picklists, and validation rules for the Team Briggs objects used by the system.
3. **Authoritative field matrix.** Field-level ownership across Salesforce, LCC, Dialysis, Government, Microsoft/file stores, and future lanes.
4. **One canonical person/contact decision.** Resolve the overlap among `entities`, `unified_contacts`, and external identities; preserve compatibility mappings.
5. **Shared contract registry.** Versioned schemas for Salesforce object events, file versions, Microsoft intake, domain fact changes, write requests, tombstones/corrections, and replay behavior.
6. **Production contract tests.** Duplicate delivery, replay, correction, tombstone, conflict, stale update, file-version, and partial-failure tests.
7. **Security gate.** Close or explicitly accept the live RLS exposure noted in the connected Supabase review; verify webhook authentication, environment-variable use, least-privilege connections, and secret rotation.

### P1 — required to make lane expansion repeatable

1. **Lane-pack specification and registry.** Lane ID, facility-use taxonomy, specialty fields, source adapters, refresh cadence, underwriting modules, prompts/tools, views, and owner.
2. **Multi-classification facility taxonomy.** A property must support facility use, operator type, lease/credit regime, physical archetype, revenue/regulatory model, and client/transaction relationship simultaneously.
3. **Shared property/facility contract.** Canonical address/property identity, organization hierarchy, leases, transactions, listings, documents, facility facts, evidence, and confidence.
4. **Cross-project routing cleanup.** Remove the Dialysis project as the accidental shared control plane for future-lane file transport; LCC should broker shared routing.
5. **Configuration-driven flow routing.** Replace lane-specific switch branches and copied flows with a lane registry and shared child-flow/backend contracts.
6. **Non-production testing strategy.** The May audit records no dedicated non-production Power Platform environment. At minimum, define solution-based dev/test packaging and manual-trigger clone rules.
7. **Schema/code ownership enforcement.** Make the owning repository and deployment authority explicit for every migration, endpoint, flow package, and contract.

### P2 — optimization after the pilot proves value

1. Salesforce event-driven intake or a supported low-latency alternative, with polling retained for reconciliation.
2. Incremental windows for bulk Salesforce reads and file backfills to reduce API use.
3. One shared dead-letter child flow and centralized secret references across the portfolio.
4. Automated drift checks comparing documented flow/contract versions with production telemetry.
5. Data-retention, deletion, and archive schedules for raw events, files, provenance, and health logs.

## What should be exported now

The repository already supplies enough design detail that a broad manual export is unnecessary. Export the deployed packages for these groups, starting with the flows whose production state or implementation cannot be proven from the repo:

1. Salesforce object/activity backbone: Object Sync, Property Promotion, Opportunity/Deal Sync, Deal Team/Contact Roster, Activity Sync, Queue Drainer, Retry & Dead-letter.
2. Salesforce file backbone: File Discovery, Daily Bulk File Backfill, On-demand File/Backfill.
3. Outlook/task backbone: hardened Outlook Intake, Processing Complete, To-Do Completion Poll, Flagged Email Intake/Cleanup, Calendar Sync, Draft creation.
4. Any flow still active but marked retired, failing, or pending in `scott-pa-flows-reference.md`.

Exports should be stored outside a public repository because packages can include environment identifiers, endpoint references, connection metadata, and sometimes cleartext secrets. The repository should store sanitized manifests and contract summaries, not raw production packages.

The exact baseline list, retention location, filename convention, metadata requirements, and delta-only re-export policy are now canonical in:

- `docs/os/POWER-AUTOMATE-EXPORT-AND-RETENTION.md`
- `docs/os/FLOW-REGISTRY.yaml`

Raw packages are retained locally under the gitignored `private/power-automate/exports/production/YYYY-MM-DD/` tree. The May 2026 audit proves that 29 packages were previously parsed, but most raw packages are not present in this checkout and several backbone flows changed or were created afterward. The 2026-08-11 request is therefore a current production baseline; once complete, future requests are delta-only.

## Immediate documentation changes recommended

1. Create `docs/os/FLOW-REGISTRY.yaml` or `.json` as the machine-readable master and render the human flow tables from it.
2. Refresh `BUILD-STATUS.md` from dated evidence through 2026-08-11.
3. Add a canonical flow index that routes both `docs/architecture/flows` and `docs/flows`.
4. Mark every architecture document with status, authority, owner, last verified date, and superseded-by link.
5. Add `docs/os/contracts/` for versioned envelopes and source-of-truth matrices.
6. Add `docs/os/lanes/` with a shared lane-pack specification and the provisional outpatient-healthcare pilot definition.

## Lane-three execution gate

Do not begin production implementation until:

- the P0 inventory and authority decisions are complete;
- the shared Salesforce/Microsoft/domain contracts are versioned;
- duplicate/replay/correction/conflict tests pass;
- the security gate is resolved;
- the oncology/infusion pilot has a named sponsor, defined cohort, and measurable commercial/workflow outcome; and
- the pilot can run within existing subscriptions and infrastructure.

## Bottom line

The repository contains enough information to continue architecture design without waiting for a temporary exploratory flow. The 2026-08-11 Power Automate baseline is now retained and reconciled: all 16 requested flows plus the supplemental Salesforce HTTP-Switch lookup flow were parsed, assigned deployed GUIDs, fingerprinted, and cataloged in `docs/os/FLOW-REGISTRY.yaml` and `docs/os/POWER-AUTOMATE-DEPLOYED-CATALOG.md`.

The remaining deployed-state work no longer requires another flow export. It requires a one-time inventory capture of owner, enabled state, production modified timestamp, last successful run, and solution membership; Salesforce metadata verification; and remediation of embedded credentials/request-trigger authentication. The next architecture phase can proceed in parallel with the lane-pack specification for the outpatient-healthcare pilot.
# 2026-08-11 continuation update

- Scott Briggs directly confirmed ownership of all 17 retained baseline flows. Ownership is now operator-verified
  in `docs/os/FLOW-REGISTRY.yaml`; no owner export is outstanding.
- A read-only production key/type profile of `sf_sync_log.payload` is documented in
  `docs/architecture/SALESFORCE-PAYLOAD-FIELD-PROFILE-2026-08-11.md`.
- The ledger supplies actual payload keys for Companies, Properties, Comps, Listings and Deals. This closes most
  read-side field discovery and eliminates the need for a temporary exploratory Power Automate flow.
- Remaining Salesforce evidence is now limited to describe/metadata facts needed for safe writes: actual object
  API names, authoritative field types, required/writable flags, relationships, record types, picklists,
  validation rules and connector permissions.
- `docs/architecture/ADR-004-CANONICAL-PERSON-IDENTITY.md` proposes `entities.id` as the canonical person ID and
  `unified_contacts` as the linked contact/engagement projection. Production evidence shows 5,696 of 31,034
  contact rows currently linked, so implementation must be staged and review-driven rather than destructive.
