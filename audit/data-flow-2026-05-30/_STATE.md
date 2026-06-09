# LCC Audit & Architecture — Current State

> **Read this first.** Single source of "where we are." Canonical implementation
> detail for every shipped round lives in the repo root `CLAUDE.md` (updated per
> round). This file tracks status + what's open + what's next so a new session
> picks up without re-exploring. Last updated 2026-06-08.

## How we work
Audit-and-fix loop: ground findings live (Supabase MCP + the deployed Railway
app) → write a grounded Claude Code prompt → Scott merges PR + redeploys → verify
live + apply DB migrations via MCP. DB changes that are cache-or-live-safe apply
live immediately; constraints/crons apply AFTER the writer/route deploys.

## Active files (this folder)
- `ARCHITECTURE_intelligence_hub.md` — the forward design: LCC as the centralized
  brain (5 layers, cross-platform consistency, vertical-agnostic, 6-phase roadmap).
- `CLAUDECODE_PROMPT_PHASE1_storage_adapter.md` — **current actionable**: move OM
  ingestion storage to company storage (OneDrive/Graph or ShareFile).
- `archive/` — every completed round's prompt + historical audit artifacts.

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
3. **R12 PA flow pieces (Scott, in Power Automate):** the `create_opportunity`
   Switch case (spec in `salesforce.js`; gov-buyer-sync cron live + waiting on it)
   and the Unit-1 `autoCreateProperty` domain-gate + enum-map (a gov DB guard
   trigger is already live as a stopgap).
4. **Env flags (Scott, Railway), enable when ready:** `DECISION_GOV_WRITEBACK`
   (stale-owner write-back), `DECISION_PROVENANCE_LEARN` (registry learning loop).
   `INTAKE_AUTOCREATE=1` + `INTAKE_AUTOCREATE_CAP=5` already set (but the rematch
   scan-starvation fix R14-Unit4 shipped to let it actually reach eligible items).
5. **In-app work (Scott):** P-CONTACT contact selection (~314, biggest pipeline
   lever) · buyer-parent SF mappings (NGP unblocks its opp) · junk review buckets
   · Decision Center lanes.
6. **Backlog / deferred:** precision BTS/chain developer signal · SOS adapters
   beyond FL · person-typing for chain owners.

## Forward roadmap (architecture phases)
1. **Storage adapter** ← current prompt. 2. Folder-feed intake (property folders
→ existing pipeline). 3. Correspondence + notes enrichment. 4. Context layer as
shared MCP+REST service. 5. Standards spine + cross-tool syndication. 6. New
verticals (childcare/vet/urgent-care) on the same layers.
