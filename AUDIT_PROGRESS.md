# LCC Holistic Audit — Progress Tracker

**Source doc:** `LCC_Holistic_Audit_2026-05-17.docx` (63 findings, 24 pages)
**Sprint started:** 2026-05-17
**Owner:** Scott Briggs
**Mode:** Direct edits on per-item branches off `main`; Supabase migrations authored AND applied via MCP

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
| 1 | Fire `runListingBdPipeline` from sidebar + OM intake | `audit/01-bd-pipeline-trigger` | 🟦 PENDING | A-1 (part), D-1, D-5 | CRITICAL · 1-2 d |
| 2 | Drain `llc_research_queue` + `ownership_research_queue` (cron + UI, no scraper) | `audit/02-research-queue-drain` | 🟦 PENDING | A-1, B-5, D-13 | CRITICAL · 3-4 d · scraper deferred per Scott |
| 3 | Wire `resolveOwnerLinks` for dia + backfill | `audit/03-dia-owner-linkage` | 🟦 PENDING | A-2 | CRITICAL · 2 d |
| 4 | Build `v_next_best_action` UNION view + Home rail | `audit/04-next-best-action` | 🟦 PENDING | B-1, B-3, B-13 | CRITICAL · 4-5 d |
| 5 | Fix silent-write loop in sidebar-pipeline (provenance integrity) | `audit/05-provenance-integrity` | 🟦 PENDING | A-3 | CRITICAL · 1-2 d |
| 6 | Data Completeness rail on `detail.js` + persisted column | `audit/06-completeness-rail` | 🟦 PENDING | B-2, B-15 | HIGH · 3 d |
| 7 | Seed cadence on new contact writes | `audit/07-contact-cadence-seed` | 🟦 PENDING | D-2, D-6 | CRITICAL · 2 d |
| 8 | Sticky next-action bar on `detail.js` | `audit/08-detail-next-action-bar` | 🟦 PENDING | B-9, B-10 | HIGH · 3 d |
| 9 | Value-weighted sort on every list | `audit/09-value-sort` | 🟦 PENDING | B-3 | HIGH · 2 d |
| 10 | Global error visibility (window.error, retry CTAs, toast tiering) | `audit/10-global-error-visibility` | 🟦 PENDING | C-5, C-6, C-9, C-10 | HIGH · 2 d |

## Working agreements

- Each top-10 item gets its own branch off `main`.
- Migrations: timestamped `.sql` in `supabase/migrations/` AND applied via `mcp__f7225045-...__apply_migration`.
- SoS scraper for owner research is **deferred** — cron + UI ships now; manual SOS workflow via `sosBtns` until the scraper is built as a separate effort.
- After each item: update this file (status, branch, commit SHA, verification notes) and append a `## Closeout — item N` section below.
- Per-finding remediation notes live in the source `.docx`; this file is the operational tracker.

## Backlog (remaining 53 findings)

After the Top 10 ship, follow the 5-phase roadmap from the audit doc (Stop the bleeding → Connect collection to consequence → Make DB visible → Close BD loops → Refinement). Phase membership for each remaining finding is annotated in `LCC_Holistic_Audit_2026-05-17.docx`, "90-Day Improvement Roadmap" section.

---

# Closeout log

(Each item, on completion, appends an entry below.)

## Closeout — item N — [title]
- **Branch:** `audit/NN-...`
- **Commit:** `<sha>`
- **Files changed:** ...
- **Migrations applied:** ...
- **Verification:** ...
- **Date:** YYYY-MM-DD

---

# Sprint preflight — 2026-05-17

- **Working tree state at start:** 477 line-ending-only diffs + 2 real diffs (`docs/architecture/sf_file_backfill_flow6_next_steps.md` added, `supabase/functions/intake-salesforce-files/index.ts` 1-line edit). Untracked: `_audit_preview_*.jpg` (audit-build artifacts), `docs/architecture/sf_connected_app_setup.md`. 1 unpushed commit `f967172` (Nixpacks fix) — kept.
- **Decision:** stash everything; branch off clean `main`. Stash carries the 2 real diffs for later recovery via `git stash pop`.
- **Blocker (2026-05-17 14:13):** `.git/` has accumulated 40+ stale lock files (HEAD.lock.bak, index.lock, packed-refs.lock.stale) from prior sessions dating to March 16. Sandbox mount permits `mv` but not `unlink`, so every git command leaves a residual lock and the next mutation aborts with `Unable to create '.git/index.lock'`. Requires Windows-side cleanup of `C:\Users\scott\life-command-center\.git\*.lock*` files before sprint can proceed.
