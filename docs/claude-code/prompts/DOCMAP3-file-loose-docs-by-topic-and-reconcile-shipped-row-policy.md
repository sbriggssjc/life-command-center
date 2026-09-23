# DOCMAP3 — file the loose docs by topic, collapse duplicate folders, and settle the shipped-row policy

Backlog: `DOCMAP3`. Source: Scott, 2026-09-23: *"Make sure we are still cleaning and consolidating the repository by topic as we go, so that we are only leaving an accurate and clean picture of the LCC app and build process for future chats to pick up seamlessly without distraction."*
Governing standard: `docs/os/DOCUMENTATION-MAP.md` (the filing standard), and DOCMAP1 (2026-09-08), the last pass of this kind. **Read both first.**

## Measured by Cowork, 2026-09-23 (re-measure before moving anything)

1. **51 loose files in the `docs/` root.** Examples: `AUTH_ENFORCEMENT_ROLLOUT.md`, `BD_ENGINE_POST_WORK_AUDIT_2026-05-22.md`, `BRIEFING_EMAIL_FLOW_v2.md`, `CONTACTS_SPLIT_BRAIN_*`, `PHASE1…PHASE4_*`, `PR1_APPLY_GUIDE.md`, `PR1_pending_updates_ux.patch`, `RAILWAY_DEPLOYMENT.md`, `RUNBOOK_sf_*`, `STATE_*`, `UW4_*`, `UW6_*`, `Life-Command-Center-Setup-Guide.docx`. The map files each of these kinds somewhere specific (audits → `docs/audits/`, runbooks → `docs/setup/`, designs → `docs/architecture/<subsystem>.md`, superseded narrative → `docs/history/`).
2. **Duplicate or odd folders:**
   - `docs/runbooks/` (1 file) vs `docs/setup/` (the map's runbook home, 27 files);
   - `docs/claude/` vs `docs/claude-code/`;
   - `docs/cm/` vs `docs/capital-markets/` (see `DOCS-CM-MISFILED`: 115 of 156 files there are archived prompts);
   - `docs/round68a/`, a one-round working folder at the top level.
3. **10 `.md` files at the repo root.** The map forbids new ones. Classify each: keep at root (e.g. `CLAUDE.md`, `AGENTS.md`), or file (e.g. `SPEC_*.md`, `SALESFORCE_LCC_INGESTION_PLAN.md`).
4. **A policy contradiction that misdirects every session.** `DOCUMENTATION-MAP.md` §3 says a shipped (✅) backlog row should have its substance moved to `CURRENT-STATE.md` §2 and the row **deleted**. `test/doc-clobber-guard.test.mjs` **fails any PR that removes a backlog row id** and says to strike (`~~…~~`) instead. As a result, the backlog is **817 rows / 1,386 lines, of which 145 are in a done/struck state**: it has become the changelog the map warns about.
5. A misleading page already fixed this round: `docs/RUNBOOK_sf_opportunity_inbound_flow.md` ("there is no Salesforce Opportunity object") got a clarification banner. The object exists for deals; BD opportunities are Tasks. Check for other retracted or superseded pages that lack such a banner.

## Ask (docs-only; no code or behaviour change)

A. **Settle the shipped-row rule first, in both places at once.** Recommended: shipped rows move **verbatim** to a dated backlog archive, `docs/history/PLANNED-BACKLOG_shipped_<date>.md`, in the same commit that removes them. Extend `doc-clobber-guard` with an archive exemption mirroring the STATUS `ARCHIVE_HEADING_EXEMPT` (a removed id must appear in a `docs/history/PLANNED-BACKLOG_shipped_*` file added in that commit). Then update `DOCUMENTATION-MAP.md` §3/§4 to match, and run the first archive pass. Each archived row's substance must already be in `CURRENT-STATE.md`; where it isn't, add a one-line CURRENT-STATE pointer.

B. **File every loose `docs/` root file per the map**, using `git mv` (history kept).
- One topic, one canonical page. Where a loose file duplicates an existing canonical page, leave the file as evidence under `docs/history/` or `docs/audits/`, with a supersession banner pointing at the canonical page.
- Nothing is deleted.
- Fix every inbound link: grep all file types, including `.js`, `.json`, `.yml` and canon blocks.
- `retired-identifiers-guard` and `status-header-integrity` must stay green.

C. **Collapse the duplicate folders.** Merge `docs/runbooks` → `docs/setup`. `docs/claude` → pick one home and say why. `docs/cm` → the capital-markets home (coordinate with `DOCS-CM-MISFILED`). `docs/round68a` → `docs/history/round68a/`.

D. **Repo-root `.md`:** keep only files that must live at root; file the rest.

E. **Index:** add a "where to start" block at the top of `DOCUMENTATION-MAP.md`: the five state files, `STATUS.md`'s Open-threads, `OPERATOR-CHECKLIST.md`, `SB notes/TRIAGE.md`, and the prompt/response loop. Update `docs/claude-code/NEW-CHAT-KICKOFF.md` if it disagrees.

F. **Canon impact:** if any moved file is referenced from `docs/os/canon/blocks/*.md`, edit the block, bump `CANON_VERSION`, and run `node docs/os/tools/render-surfaces.mjs --root=docs/os --write-live`. List the surfaces Scott must re-paste per `SURFACE-SYNC-PROTOCOL.md`.

## Done means

- A move table in the response (old path → new path → reason).
- Before/after counts: `docs/` root files, repo-root `.md`, backlog rows and lines.
- All doc guards and the full suite green.
- A `DOCMAP3` backlog row with the result.
- No Railway deploy (docs only), unless canon changed. In that case, the paste list.
