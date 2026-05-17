# LCC Holistic Audit — Progress Tracker

**Source doc:** `LCC_Holistic_Audit_2026-05-17.docx` (63 findings, 24 pages)
**Sprint started:** 2026-05-17
**Owner:** Scott Briggs
**Workflow:** Direct edits on per-item branches off `main`; code changes delivered as apply scripts under `audit/patches/NN-<slug>/apply.mjs` (sandbox/Windows filesystem coherence issue makes direct sandbox writes invisible to Windows git); Supabase migrations authored AND applied via Supabase MCP.

## Status legend

- 🟦 **PENDING** — not started
- 🟨 **IN PROGRESS** — branch open, work underway
- 🟧 **REVIEW** — code complete, awaiting verification / merge
- ✅ **DONE** — merged to main and verified
- ⛔ **BLOCKED** — needs decision or upstream fix
- ⏸️ **DEFERRED** — moved out of sprint scope

## Top 10 priority queue

| # | Item | Branch | Status | Closes | Notes |
|---|------|--------|--------|--------|-------|
| 1 | Fire `runListingBdPipeline` from sidebar + OM intake | `audit/01-bd-pipeline-trigger` | 🟧 REVIEW | A-1 (part), D-1, D-5 | CRITICAL · sidebar + OM-intake wired; pending verification |
| 2 | Drain `llc_research_queue` + `ownership_research_queue` (cron + UI, no scraper) | `audit/02-research-queue-drain` | 🟦 PENDING | A-1, B-5, D-13 | CRITICAL · scraper deferred per Scott |
| 3 | Wire `resolveOwnerLinks` for dia + backfill | `audit/03-dia-owner-linkage` | 🟦 PENDING | A-2 | CRITICAL |
| 4 | Build `v_next_best_action` UNION view + Home rail | `audit/04-next-best-action` | 🟦 PENDING | B-1, B-3, B-13 | CRITICAL |
| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) | `audit/05-provenance-integrity` | 🟦 PENDING | A-3 | CRITICAL |
| 6 | Data Completeness rail on `detail.js` + persisted column | `audit/06-completeness-rail` | 🟦 PENDING | B-2, B-15 | HIGH |
| 7 | Seed cadence on new contact writes | `audit/07-contact-cadence-seed` | 🟦 PENDING | D-2, D-6 | CRITICAL |
| 8 | Sticky next-action bar on `detail.js` | `audit/08-detail-next-action-bar` | 🟦 PENDING | B-9, B-10 | HIGH |
| 9 | Value-weighted sort on every list | `audit/09-value-sort` | 🟦 PENDING | B-3 | HIGH |
| 10 | Global error visibility (window.error, retry CTAs, toast tiering) | `audit/10-global-error-visibility` | 🟦 PENDING | C-5, C-6, C-9, C-10 | HIGH |

## Working agreements

- Each Top-10 item gets its own branch off `main`.
- Code changes delivered as apply scripts (`audit/patches/NN-<slug>/apply.mjs`); the script anchors edits by unique substring + asserts pre-conditions before writing. Run `--dry` then `--apply`.
- Migrations: timestamped `.sql` in `supabase/migrations/` AND applied via Supabase MCP.
- SoS scraper for owner research is **deferred** — cron + UI ships now; manual SOS workflow via `sosBtns` until the scraper is built as a separate effort.
- After each item: update this file (status, branch, commit SHA, verification notes) via the next patch.
- Per-finding remediation notes live in the source `.docx`; this file is the operational tracker.

## Backlog (remaining 53 findings)

After Top 10 ships, follow the 5-phase roadmap from the audit doc (Stop the bleeding → Connect collection to consequence → Make DB visible → Close BD loops → Refinement). Phase membership for each finding is annotated in `LCC_Holistic_Audit_2026-05-17.docx`, "90-Day Improvement Roadmap" section.

---

# Closeout log

## Closeout — item 1 — Fire runListingBdPipeline from sidebar + OM intake
- **Branch:** `audit/01-bd-pipeline-trigger`
- **Patch:** `audit/patches/01-bd-pipeline-trigger/apply.mjs`
- **Closes:** A-1 (partial — paired with item #2 for owner research drain), D-1 (sidebar), D-5 (OM intake)
- **Files changed:**
  - `api/_handlers/sidebar-pipeline.js` — writer return shape `{count, insertedListingId}`, BD trigger wiring, workspaceId/userId threaded through propagateToDomainDb
  - `api/_handlers/intake-promoter.js` — BD trigger fires when listingResult was a genuine INSERT (not updated, not merged_into_existing)
  - `AUDIT_PROGRESS.md` — this file, created via Node fs.writeFile so Windows git sees it
- **Verification (post-apply, post-commit):**
  1. `grep -c "runListingBdPipeline" api/_handlers/sidebar-pipeline.js` → ≥ 2 (import + call)
  2. `grep -c "runListingBdPipeline" api/_handlers/intake-promoter.js` → ≥ 2
  3. `grep -c "insertedListingId" api/_handlers/sidebar-pipeline.js` → ≥ 6 (writer returns + reader)
  4. `node -c api/_handlers/sidebar-pipeline.js` → parses
  5. `node -c api/_handlers/intake-promoter.js` → parses
  6. (Smoke) Capture a CoStar listing for an asset+state with known peer-owner contacts; confirm new `inbox_items` rows with `source_type='listing_bd_trigger'`. Re-capture the same listing; confirm NO duplicate inbox items are queued.
- **Commit SHA:** _paste after `git commit`_
- **Date applied:** _paste at apply time_

---

# Sprint preflight — 2026-05-17

- **Working tree state at start:** 477 line-ending-only diffs + 2 real diffs (`docs/architecture/sf_file_backfill_flow6_next_steps.md` added, `supabase/functions/intake-salesforce-files/index.ts` 1-line edit). Untracked: audit preview JPGs, `docs/architecture/sf_connected_app_setup.md`. 1 unpushed commit `f967172` (Nixpacks fix) — auto-cleared between sessions.
- **Decision:** stash everything; branch off clean `main`. PowerShell stash reported "no local changes to save" — working tree was already clean by the time the stash ran (auto-cleared upstream).
- **Resolved blocker (2026-05-17 14:13):** `.git/` had 40+ stale lock files from prior sessions; cleared from PowerShell via `Get-ChildItem -Recurse -Filter "*.lock*" | Remove-Item -Force`.
- **Discovered (2026-05-17 14:25):** Sandbox writes physically reach NTFS (visible to `dir`) but **not** to Windows git's directory enumeration. PowerShell writes are seen normally. Confirmed by test (`sync_test.txt` visible, `AUDIT_PROGRESS.md` invisible). Workflow shifted to apply-script delivery: I author `audit/patches/NN/apply.mjs`; Scott runs from PowerShell — all file writes happen via Node's fs API which the Windows-side git enumerates normally.
- **Discovered (2026-05-17 14:38):** Repo working tree is 100% CRLF on both target files (`sidebar-pipeline.js` 8,799/8,799, `intake-promoter.js` 2,531/2,531). First apply.mjs draft used LF anchors → aborted cleanly on the first anchor. Script rewritten with per-file EOL detection (`detectEol`) + normalization (`toEol`); LF-formatted anchors in the script source are converted to the file's EOL before matching, so the same script works on LF/CRLF/mixed without producing mixed-EOL output.
