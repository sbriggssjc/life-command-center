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
6. **R17 — data-quality ✅ SHIPPED + VERIFIED 2026-06-10** (PRs life-command-center
   #1129, government-lease #257, Dialysis #7293). Root cause: the R71/7d gov
   "master Sold import" deduped per-sale-hash instead of per-address → a fresh
   null-source/null-lease property per comp. Outcomes: **Unit 1** — 6,662 junk
   rows archived (reversible, snapshotted), 6 anchored rows merged
   (gov_merge_property, sales/listings repointed, 0 orphans), 16 kept rows +
   942 leftover singletons stamped traceable, `gov_stamp_data_source_guard`
   trigger prevents regrowth; gov real properties 18,949→12,284 (~35% de-bloat).
   **Unit 2** — 436 auto_mergeable LCC entity dupes merged (verified survivors),
   steady-state = Decision Center "merge duplicate entities" lane (no blind
   cron). **Unit 3** — 698 orphan entities flagged + daily cron + picker
   exclusion. **Unit 4** — gov merge lane 6,914 rows→51 groups (dia 54). dia was
   already healthy (auto-supersede drove dup-addr 1,061→42).
   **R17b ✅ DONE + VERIFIED (PR #257):** the 343 "orphan" sales + 56 listings
   were NOT delete-orphans — they're `property_id IS NULL` off-universe CoStar/
   CREXi market comps (importers leave pid NULL when no gov match, by design).
   Fix = lens not data: 2 sales re-linked (incl. 9180 Covington→23520; 10
   "exact" matches were dedup duplicates, kept unlinked), 341 sales + 56 listings
   tagged `comp_scope='market_offuniverse'` (0 untagged residue), importer-
   agnostic BEFORE-INSERT trigger auto-tags/excludes future NULL-pid comps, and
   the 16 direct-reading `cm_gov_*` views scoped `comp_scope IS DISTINCT FROM
   'market_offuniverse'` (off-universe-only — NOT the `exclude_from_market_metrics`
   flag, which carries 9,601 unrelated rows). Dual gate verified: all-time cap
   8.559→8.611% (+5.2bps, signed off), sales TTM byte-identical, cap-ladder
   intact; listing current counts correctly drop 56 active off-universe.
   Snapshots: gov_junk_archive_audit_20260609, gov_anchored_merge_audit_20260610,
   gov_offuniverse_comp_audit_20260610.
   **R17c ✅ DONE + VERIFIED (gov branch `claude/stoic-edison-9x7dhy`):** the gov
   CM report was internally inconsistent (7.9–8.6% all-time cap depending on
   section). Investigation found the `exclude_from_market_metrics` flag (9,632
   sales) was principled for most (needs_review 4,547 / ownership_stub 3,313 /
   duplicate_superseded 711 / link+dedup) but **over-broad on 166 real gov sales**
   — a too-narrow [3%,10%] DQ1 cap band dropped NOI-corroborated 10-15% gov deals,
   and a dedup rule excluded live survivors whose only twin was non-live. Fix
   (basis b, signed off): reinstated the 166, codified the corrected band as
   `gov_apply_dq1_cap_band()`, converged all 29 CM sales views to honor the
   corrected flag. **Verified: converged all-time cap 8.037% / $85.66B, every CM
   view reads it (`v_cm_view_flag_audit` offenders-only = 0 rows), master_m TTM
   8.174%, Boyd 564→317.** CI guard prevents re-split.
   **R17d (logged, Scott's call):** `gov_apply_dq1_cap_band(true)` would flag 342
   post-May captures with implausible caps (>15%/<3%/uncorroborated 10-15%) — a
   pre-existing, consistent DQ gap; cleaning it moves the published number again,
   so do it deliberately with impact shown, not chained onto R17c.
7. **Backlog / deferred:** precision BTS/chain developer signal · SOS adapters
   beyond FL · person-typing for chain owners.

## Forward roadmap (architecture phases)
1. **Storage adapter ✅ SHIPPED 2026-06-09** (adapter + PA Save/Get flows live,
   verified). 2. **Folder-feed intake — DESIGNED** (`ARCHITECTURE_PHASE2_folder_feed.md`):
   read the Team Briggs tree (tenant/brand + City,ST anchor) into the existing
   extract→match→promote pipeline; additive landing zones only (read, don't
   reorganize); cloud PA "List/Get folder" + local backfill. conventions LOCKED
   (DB-only tracking; outputs to existing folders w/ `[LCC]` tag). **Slice 1
   SHIPPED 2026-06-10 (PR #1133): worker `?_route=folder-feed-tick`, classifier,
   `stageOmIntake` sharepoint-pointer extension, local backfill script.
   Migrations applied to LCC Opps (`folder_feed_seen` table + `lcc-folder-feed`
   */30 cron); endpoint live + returns clean 200 no-op (`SHAREPOINT_LIST_URL`
   unset).** **PA list flow ✅ BUILT + VERIFIED LIVE 2026-06-10** — the "List
   folder" connector action was a dead end for dynamic paths; rebuilt on "Send an
   HTTP request to SharePoint" (REST `GetFolderByServerRelativeUrl?$expand=Folders,Files`),
   a live run returned real folder data. Confirmed verbose shape: arrays at
   `sp.d.Files.results` / `sp.d.Folders.results`, `Length` is a string. Remaining:
   (a) set `SHAREPOINT_LIST_URL` env to the flow trigger URL; (b) ship Slice-1b
   worker map (`CLAUDECODE_PROMPT_PHASE2_Slice1b_list_rest.md` — finalized to the
   confirmed shape); (c) GET dry-run to confirm the cron goes live. Slice-1 build
   prompt: `CLAUDECODE_PROMPT_PHASE2_folder_feed_worker.md`. **✅ Slice-1b shipped
   (PR #1137); SharePoint env (LIST/FETCH/SAVE + STORAGE_BACKEND=sharepoint_pa) set
   on tranquil-delight; dry-runs verified live 2026-06-10** (gov On Market 32 OMs,
   dia Comps/On Market 58 OMs, Storage OM's 9 OMs all classify correctly).
   **Channel doctrine LOCKED (ARCH §10):** Channel A = INGEST = the two `On Market`
   folders (full pipeline); Channel B = PROPERTIES = bidirectional workspace
   (path-anchor match-existing → enrich, never silent create; + write-back of
   LCC-generated master/BOV/OM/memo docs `[LCC]`-tagged + property_documents
   linked; + context links to email/SF notes/LLC). Sequence: **Slice 1c**
   (`max_stage` cap → controlled first drain of 1–2 OMs; prompt ready:
   `CLAUDECODE_PROMPT_PHASE2_Slice1c_max_stage.md`) → Slice-1 steady-state
   (`FOLDER_FEED_ROOTS`=On Market folders) → **Slice 2** (PROPERTIES read+write-back)
   → **Slice 3** (context layer). Storage OM's = one-time local backfill, not a
   steady root. **✅ Slice 1 FULLY LIVE + VERIFIED 2026-06-10:** Slice-1c
   max_stage cap (PR #1138); Phase-1 Get flow fixed ("Get file content using path"
   was fed the full server-relative path → 502 on every file; fix = File Path
   `replace(triggerBody()?['server_relative_url'],'/sites/TeamBriggs20','')`
   so it's site-relative); Slice-1d stale-sweep fix (PR
   `claude/affectionate-meitner-ef5tpy`: livePaths from full listing + miss_streak>=2
   + DEFAULT_ROOTS→On Market only; migration `20260718122000` applied). End-to-end
   PROVEN: Champaign SSA→gov 5681, Rome GA SSA→gov 4548, DaVita Houston→dia 44708
   (fetched→extracted→matched 0.95→promoted). Stale-fix verified live (125-file
   truncating drain → files_stale=0; pre-fix staled 54); 54 wrongly-staled gov rows
   recovered. Cron 114 LIVE, scoped to On Market; backlog drains on cron (~2/tick by
   the 22s budget; historical OMs enriching tracked properties — no urgency; do NOT
   run local backfill alongside or it double-stages). **NEXT:** Slice 2a prompt READY
   (`CLAUDECODE_PROMPT_PHASE2_Slice2a_properties_enrich.md`) — PROPERTIES enrich-read
   (match-existing→fill-blanks, never create, unresolved→disambiguation); then
   Slice 2b (write-back generated docs) + Slice 3 (context layer).
   **✅ Slice 2b WRITE-BACK COMPLETE + VERIFIED LIVE 2026-06-11.** `POST
   /api/property-doc-writeback {domain,property_id,file_name,doc_type,content_base64}`
   resolves the property's PROPERTIES folder (known-path from property_documents
   source_url), uploads the file `[LCC]`-tagged via the PA "Http -> Put file (LCC
   Put Artifact)" flow (Create file, dynamic Folder Path), links a
   `property_documents` row (`source='lcc_generated'`) + provenance, and the enrich
   re-ingest guard classifies `[LCC]` files as `lcc_generated`/skip. Migration
   `20260718125000` (lcc_generated priority 1) applied. PRs: #1148 (handler/resolver),
   #1149 (server.js mount + adapter), #1150/#1151 (upload contract fixes). **Hard-won
   PA gotcha:** SharePoint "Create file" Folder Path is **site-relative WITH the
   library** — strip only `/sites/TeamBriggs20`, keep `/Shared Documents/...` (bare
   `PROPERTIES/...` → 400 "Root folder is not found"); same form the Get flow needed.
   PA new-designer froze repeatedly over remote CDP — Scott does flow edits natively.
   Test artifacts (2 stray `LCC Writeback Test [LCC].pdf` files in `Storage OM's/Intake`
   + Chilton folder) left for Scott to delete; enrich guard skips them. **Phase 2
   ingest+enrich+write-back ALL LIVE.**
   **✅ Slice 3a PROPERTY CONTEXT PACKET COMPLETE + VERIFIED LIVE 2026-06-11 (PR
   #1152).** Grounding: context_packets had 45,733 packets but only `contact` +
   `daily_briefing` types — ZERO `property`. `assemblePropertyPacket` existed +
   wired in the switch but nothing called it (preassemble skipped assets; the
   property handler only read cache → null), and it was thin (no documents/
   ownership/transactions). Fix enriched the assembler (documents w/ provenance —
   surfaces the Phase-2 doc connections; ownership + related entities; transactions
   + listings; real investment score) + assemble-on-miss in the `/api/property`
   HTTP mirror + nightly pre-warm of active assets. Verified: `GET /api/property
   ?entity_id=9782c412-...` (DaVita Chilton) returns the full packet — documents=1
   (`DaVita...OM.pdf`, source `enriched`), ownership (Avalon Properties / DaVita
   Inc.), 4 transactions, lease, score; cached + fresh (property_packets_total 0→1).
   **TWO FINDINGS:** (1) the deployed **MCP server `mcp/server.js` get_property_context
   does NOT assemble-on-miss** — only reads cache (relies on nightly pre-warm); a
   cold-miss returns null to agents (Copilot/Claude/GPT). → optional **Slice 3a.1**
   (small mcp/server.js change) completes the agent-facing keystone. (2) **gov ingest
   doesn't mint LCC asset entities** (unlike dia's promoter bridge) — get_property_context
   by entity_id finds nothing for gov; gov reachable by address only. Next: Slice 3a.1
   (MCP assemble-on-miss) then **Slice 3b** (route email/SF-notes correspondence into
   activity_events → enriches the packet's activity_timeline; today activity_events
   is mostly system events, ~494 human notes + 1 call).
   **✅ Slice 2a SHIPPED + VERIFIED LIVE 2026-06-10 (PR #1144):** enrich channel
   (FOLDER_FEED_ENRICH_ROOTS env, default PROPERTIES; INERT when unset). Migrations
   `20260718123000` (folder_feed_seen.mode) + `20260718124000`
   (field_source_priority folder_feed_properties) applied. First enrich drain on
   PROPERTIES/D/DaVita: `DaVita Dialysis - Chilton - WI - OM.pdf` matched EXISTING
   dia property 29841 (0.97) → attached property_documents doc 2298 + field_provenance
   (folder_feed_properties), fields_filled=0 (conservative), NO property created.
   `FOLDER_FEED_ENRICH_ROOTS=/sites/TeamBriggs20/Shared Documents/PROPERTIES` SET on
   tranquil-delight — full PROPERTIES tree enabled on the cron. **⚠️ Throughput
   caveat (Slice 2a.1, prompt ready `CLAUDECODE_PROMPT_PHASE2_Slice2a1_enrich_budget.md`):**
   walkPhase gates enrich on the SHARED limitFolders + 22s budget that ingest
   consumes first → enrich crawls ~0 folders/tick during the On Market backlog drain,
   ~1-2/tick after. Fix = independent per-phase folder budget + a ~7s enrich time
   reserve. Recommended (Scott deferred the call to me 2026-06-10). NEXT: run Slice
   2a.1 → verify both channels walk in one tick → then Slice 2b/3.
   3. Correspondence
   + notes enrichment. 4. Context layer as shared MCP+REST service. 5. Standards
   spine + cross-tool syndication. 6. New verticals on the same layers.
Architecture docs: `ARCHITECTURE_intelligence_hub.md` (the 5-layer design),
`ARCHITECTURE_PHASE2_folder_feed.md` (Phase 2 detail).
