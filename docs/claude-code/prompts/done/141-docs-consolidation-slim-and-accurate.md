# Prompt 141 — Consolidate & slim the docs into an accurate current-state reflection (lose nothing)

## Goal
The repo has accumulated many prompt files, per-round narratives, design briefs, audit docs, and STATUS
history. Produce a **slim, accurate, actionable reflection of the current app structure and plans** — WITHOUT
inadvertently dropping any contemplated-but-unbuilt feature. This is consolidation + archival, **never
lossy deletion of ideas**.

## Hard rules
1. **Never delete a contemplated feature or an open plan.** If something is unbuilt but still intended, it
   moves into a single consolidated "Planned / Backlog" section — it does not vanish. When in doubt, keep it
   and flag it, don't drop it.
2. **Archive, don't erase.** Move superseded per-round narratives and completed prompts into a dated
   `docs/history/` (or `docs/claude-code/prompts/done/` where they already are) rather than deleting — git
   history is not a substitute for a readable archive index.
3. **Preserve the durable footguns.** CLAUDE.md's hard-won lessons (the PostgREST traps, the silent-failure
   classes, the merge-path rules, etc.) are load-bearing — consolidate/dedupe wording, but do not lose a
   single distinct lesson.
4. **One source of truth per topic.** Where two docs describe the same subsystem, merge into the canonical
   one and leave a pointer, per the existing REGISTRY/canon discipline.

## Deliverables
1. **A single current-state index** — refresh/extend `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` (or a new
   `docs/os/CURRENT-STATE.md` it links) that answers, in one place: what's LIVE, what's flag-gated OFF and
   why, what's PLANNED, and where each subsystem's canonical doc lives. Include the local-model surface
   state (from `LOCAL-MODEL-LEVERAGE-MAP.md`) and the production-health table.
2. **A consolidated Planned/Backlog list** — every unbuilt-but-intended feature gathered from scattered
   design briefs, prompt "Follow-ups" sections, gap-audit tail, and STATUS "next steps" into ONE ranked
   backlog. Cross-check against: `LOCAL-MODEL-GAP-AUDIT.md` (R1–R9), the account-based-contact-intelligence
   design, the contact-reconciliation-outbound design, the SOS-egress work, R8 Stage 2 (CM book copy), and
   any `⬜` items in ROLLOUT_STATUS. **List what you found and where, so nothing is silently dropped.**
3. **STATUS.md trim** — keep the last ~6 weeks of milestone entries; move older dated blocks verbatim into
   `docs/history/` with an index line. STATUS should open with the CURRENT state, not archaeology.
4. **A "what changed" report** — a short summary of what you consolidated, what you archived (with
   destinations), and an explicit list of every contemplated feature you preserved, so Scott/Cowork can
   verify nothing was lost.

## Guardrails
- Do NOT touch code, migrations, or flags — docs only.
- Do NOT rewrite the canon blocks without bumping `CANON_VERSION` per the surface-sync protocol.
- Re-measure any dated blocker you're tempted to mark "resolved" before doing so (the standing doctrine).
- Keep the commit doc-only and reversible; use the repo's Co-Authored-By + Claude-Session trailer.

## Why
Cowork drives this app through a paste-prompt/paste-response loop and a long-running chat; when the context
window resets, the docs ARE the memory. A slim, accurate, lossless current-state + backlog is what lets a
fresh chat pick up without rebuilding — and without re-proposing something already built or dropping
something still intended.
