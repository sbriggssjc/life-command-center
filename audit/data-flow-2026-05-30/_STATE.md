# LCC Audit & Architecture — Current State

> **Read this first.** Single source of "where we are." Canonical implementation
> detail for every shipped round lives in the repo root `CLAUDE.md` (updated per
> round). This file tracks status + what's open + what's next so a new session
> picks up without re-exploring. Last updated 2026-06-08.

## File hygiene convention (applies to every workstream — personal + business)
Latest-only at the surface: a workstream folder shows only what's CURRENT — a
`_STATE.md` index, the live design/plan docs, and the active prompt(s).
Everything completed/superseded moves to `archive/` (git mv — preserve history,
don't delete). Consolidate older plans into the latest rather than leaving
parallel versions. Goal: any future chat reads `_STATE.md` first and resumes
without re-exploring. Apply the same pattern to other repos/working folders as
they're touched.

## How we work
Audit-and-fix loop: ground findings live (Supabase MCP + the deployed Railway
app) → write a grounded Claude Code prompt → Scott merges PR + redeploys → verify
live + apply DB migrations via MCP. DB changes that are cache-or-live-safe apply
live immediately; constraints/crons apply AFTER the writer/route deploys.

## Active files (this folder)
- `ARCHITECTURE_intelligence_hub.md` — the forward design: LCC as the centralized
  brain (5 layers, cross-platform consistency, vertical-agnostic, 6-phase roadmap).
- `CLAUDECODE_PROMPT_PHASE1_storage_adapter.md` — the Phase 1 build prompt
  (IMPLEMENTED — see below; keep until shipped + flipped, then archive).
- `PHASE1_SHAREPOINT_PA_FLOW_CONTRACT.md` — **Scott's next action**: the PA HTTP
  flow contracts (Save / Get / Link) + env vars + staged cutover for the
  SharePoint storage backend.
- `archive/` — every completed round's prompt + historical audit artifacts.

## Phase 1 — storage adapter (IMPLEMENTED 2026-06-09, on branch
`claude/inspiring-shannon-3fdqs7`; awaiting merge + redeploy, then the SharePoint flip)
- New `api/_shared/storage-adapter.js` — pluggable backend (`supabase` default |
  `sharepoint_pa`) behind one interface (`putArtifact` / `fetchSharepointBytes` /
  `resolveArtifactDownload` / `getConfiguredStorageBackend`); wraps the existing
  `artifact-storage.js` so supabase mode is byte-identical. `sharepoint_pa` posts
  to PA flows; degrades to supabase (one-time warn) if `SHAREPOINT_SAVE_URL`
  unset → flipping the flag early can't break ingest.
- Ingest (`intake-om-pipeline.js`) routes uploads through `putArtifact` + records
  `storage_backend`/`storage_ref`. Extractor (`intake-extractor.js`) gained a
  Path-3 `sharepoint_pa` read branch (Paths 1/2 untouched). Download
  (`intake-artifact-download.js`) delegates to the adapter (ref-shape sniff:
  `bucket/obj`→Supabase signing unchanged, `/sites/...`→PA link).
- DB: migration `20260717120000_lcc_phase1_storage_adapter_columns.sql` —
  additive nullable `storage_backend`+`storage_ref` on `staged_intake_artifacts`.
  **APPLIED LIVE to LCC Opps** (metadata-only, safe) + committed.
- `node --check` clean (4 files); 12 functions.
- **PA Flows 1+2 BUILT + TESTED LIVE 2026-06-09** (Save id
  `4bebbeff-3049-4f4d-ba5d-f900490f0db5`, Get id
  `c63003a0-5d08-4b08-93cb-ad0eecfa2ae3`; both On). Full round-trip proven
  (save → read-back → base64 decode = "LCC SharePoint flow test").
  `SHAREPOINT_SAVE_URL` set. **Only remaining for full cutover:** Scott sets
  `SHAREPOINT_FETCH_URL` (Flow 2 trigger URL) in Railway + keeps
  `STORAGE_BACKEND=sharepoint_pa`; until FETCH_URL is set keep `supabase` to
  avoid a read-back gap. Download link = optional Flow 3 (`SHAREPOINT_LINK_URL`).
  Gotcha: SharePoint OAuth token had expired (90-day inactivity, `AADSTS700082`)
  — reauth fixed it; watch for periodic reauth. Recipe + self-tests in
  `PHASE1_SHAREPOINT_PA_FLOW_CONTRACT.md`.
- Deferred-within-scope (honest): SharePoint *download* fully works once Flow 3
  + `SHAREPOINT_LINK_URL` exist AND promoted listings carry the SharePoint ref in
  `intake_artifact_path` (the adapter sniffs ref shape, so no listing backend
  column is needed — the ref is self-describing). Until then SharePoint downloads
  return a clean 501; Supabase downloads unchanged.

## Shipped & verified (detail in CLAUDE.md)
R4 identity/UX · R5 SPE→parent buyer doctrine · R6 ownership-resolution gating ·
R7 Decision Center (+ Phase 2 lane conversion) · R8 dia owner-facts + decision
producers · R9 chain connect/classify (developer fuel) · R10 cadence→outreach
loop · R11 value-ranking integrity (rank_annual_rent) · R12 Salesforce sync
(identity clean, gov-buyer-sync cron live) · R13 Decision Center health
(provenance lane 14.7k→3.2k) · R14 intake funnel (matched-state leak; promote
-drain + lcc-bridge hotfix; recovery proven live) · R15 cron/automation health
(artifact-offload edge cron, gov MV fix, flow_failure TTL).

## Open items / watch list
1. **Disk (LCC Opps) — contained, finish it.** Growth halted (edge offload 60/hr
   > inflow; ingest-to-Storage live). Backlog draining (~1.2k inline left).
   **Pending:** (a) consider a small Supabase disk bump for margin during drain;
   (b) a final `VACUUM FULL public.staged_intake_artifacts` AFTER the backlog
   drains (cheap then; projects DB → ~3-4 GB); (c) Phase 1 storage adapter is the
   durable fix (moves files off Supabase entirely).
2. **R14 follow-up (9 items):** promote-drain should derive target domain from
   the bridge `source_system`, not `entities.domain` (NULL-domain lcc entities
   with valid bridges). In `CLAUDECODE_PROMPT_R14_HOTFIX...` (archived).
3. **R16 — `create_opportunity` is an SF TASK, not an Opportunity object — ✅ SHIPPED + VERIFIED 2026-06-09.**
   NorthMarq has no Opportunity object; an "opportunity" = an **open Task on a
   Contact** (custom **NMType** picklist = "Opportunity" seller / blank buyer).
   Code (salesforce.js `createSalesforceTask`, fire-at-contact-selection in
   operations.js, gov-buyer sync as retry safety-net) merged via PR #1126 +
   deployed; migration `20260609210000` (view contact-gate + `hold_no_contact`)
   applied live. PA Task case built on flow `c3744e93-…` (NM Type=`NM_Type__c`,
   Status static "Open", fields as fx tokens). **End-to-end proven:** Boyd
   Watterson → SF Task `00TVs00001GBewcMAD` on Joseph Capra, `sf_opp_id` written,
   `synced`; idempotent re-run; NGP `hold_unmapped`. Build lessons + the
   Response-`{`/constrained-field gotchas captured in
   `PA_FLOW_create_opportunity_case_recipe.md`.
   **Follow-up (minor):** add Due Date back via LCC always-send `activity_date` +
   trigger-schema dynamic-content tokens (omitted now; not API-required). One
   orphan buy-side task on Joseph Capra from the pre-fix trigger to delete (keep
   `00TVs00001GBewcMAD`).
   Also still pending: the Unit-1 `autoCreateProperty` domain-gate + enum-map (a gov DB guard
   trigger is already live as a stopgap).
4. **Env flags (Scott, Railway), enable when ready:** `DECISION_GOV_WRITEBACK`
   (stale-owner write-back), `DECISION_PROVENANCE_LEARN` (registry learning loop).
   `INTAKE_AUTOCREATE=1` + `INTAKE_AUTOCREATE_CAP=5` already set (but the rematch
   scan-starvation fix R14-Unit4 shipped to let it actually reach eligible items).
5. **In-app work (Scott):** P-CONTACT contact selection (~314, biggest pipeline
   lever) · buyer-parent SF mappings (NGP unblocks its opp) · junk review buckets
   · Decision Center lanes.
6. **R17 — data-quality (grounded 2026-06-09, prompt ready
   `CLAUDECODE_PROMPT_R17_data_quality.md`):** dia is healthy (auto-supersede
   drove dup-addr 1,061→42). Issues: (1) **HEADLINE — gov.properties has 7,626
   rows (40%) with NULL data_source + NULL lease from two bulk batches (May-17
   6,690 + Jun-7 894), heavily address-duplicated (159 addrs, 150-173 rows
   each); 99.8% have agency, 943 sales, 446 listings — identify the generating
   writer + triage/dedup (investigation-first, gated).** (2) LCC 436
   auto_mergeable duplicate entities with NO drain cron. (3) 1,037 orphan
   entities (no edge/identity/portfolio). (4) gov property-merge lane over-counts
   (6,914 rows = 159 groups, 106 legit multi-lease; ~53 real) — de-noise like
   R13. **Awaiting Scott:** does he recognize the May-17/Jun-7 gov load (was it
   intentional)?
7. **Backlog / deferred:** precision BTS/chain developer signal · SOS adapters
   beyond FL · person-typing for chain owners.

## Forward roadmap (architecture phases)
1. **Storage adapter ✅ SHIPPED 2026-06-09** (adapter + PA Save/Get flows live,
   verified). 2. **Folder-feed intake — DESIGNED** (`ARCHITECTURE_PHASE2_folder_feed.md`):
   read the Team Briggs tree (tenant/brand + City,ST anchor) into the existing
   extract→match→promote pipeline; additive landing zones only (read, don't
   reorganize); cloud PA "List/Get folder" + local backfill. Awaiting Scott's 2
   structure conventions (DB-only vs sidecar; central vs per-property
   `_LCC/Generated`), then the `folder-feed-tick` worker prompt. 3. Correspondence
   + notes enrichment. 4. Context layer as shared MCP+REST service. 5. Standards
   spine + cross-tool syndication. 6. New verticals on the same layers.
Architecture docs: `ARCHITECTURE_intelligence_hub.md` (the 5-layer design),
`ARCHITECTURE_PHASE2_folder_feed.md` (Phase 2 detail).
