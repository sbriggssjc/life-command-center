# Cowork / profile setup — future-proofing connections & orientation (2026-08-04)

How to stop the two recurring pains: (a) the cloud↔desktop bridge dropping / folders needing re-attach, and
(b) each new chat re-deriving where files live and how the system works.

## 1. Run mode — the single biggest fix for the drops
This session runs **in the cloud** and reaches your machine over a bridge that drops (network blips, app sleep,
timeouts). A Cowork task that runs **on your computer** works with your folders directly — no bridge, so folders
stay connected the whole task and outputs save straight to disk.
- **Set the default:** desktop app → **Settings → Cowork → turn OFF "Run new tasks in the cloud."**
- **Per task:** the **"Run this task" picker (top-right)** when you start a new Cowork task.
- A running cloud task can't be moved; start the *next* one on-computer. (If the picker/toggle isn't there, the
  on-computer option isn't enabled on the account yet.)
Given our work is mostly reading `responses/` and committing to the repo, on-computer mode removes this whole
class of interruption.

## 2. Global / Personal Instructions — so every new chat starts oriented
Paste the block in §6 into your Claude **profile personal preferences** (and/or Cowork personal instructions).
It points every session at the repo, the read-first reference, and the workflow — no rebuilding from scratch.

## 3. The repo is the durable memory
`CLAUDE.md` (project instructions) + `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` (surfaces/comps/deploy map) +
`docs/claude-code/STATUS.md` (live queue) are the memory. Any session that reads them is oriented. Keep them
current (we do, each turn). Both are now linked from CLAUDE.md's START-HERE.

## 4. Connectors / MCP / plugins — make them account-level, not per-session
- **LCC MCP connector** + **Supabase**: add them in **Settings → Connectors** at the account level so they
  persist across sessions instead of being re-added. (Rotate `LCC_API_KEY` first — it was exposed in chat — and
  set the same value on the services + every connector.)
- **Bundle the LCC skills + connector into a Cowork plugin** installed at the account/org level, so
  comps-engine / bov / offer-submission and the LCC connector are always present without per-session setup. (I can
  build this `.plugin` on request — it packages the skills + the connector config as one installable.)

## 5. Canonical connected-folder set (keep these attached)
`life-command-center` (the repo), `_WORKFLOW` (Northmarq prompt, checklists), `_AI-Context` (BRIGGS-* knowledge),
`Team Briggs - Documents/Templates`, `…/PROPERTIES`, and `_FileSystem/claude-md`. In on-computer mode these stay
connected; the list here makes setup repeatable.

## 6. Paste-ready Global Instructions block  ← copy into your Claude profile
---
You are helping Scott Briggs run Life Command Center (LCC), a CRE BD platform (Northmarq / Team Briggs; dialysis +
government net-lease). At the start of any session touching LCC:
- The repo is the connected folder `life-command-center` (C:\Users\scott\life-command-center).
- READ FIRST, don't rebuild from scratch: `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`, `CLAUDE.md`, and
  `docs/claude-code/STATUS.md`.
- Prompt/response workflow: Scott pastes Claude Code responses into `docs/claude-code/responses/`. Check it each
  turn, reconcile, move processed files to `done/`, draft new prompts into `prompts/`, keep `STATUS.md` current.
- Instructions are single-sourced: edit `docs/os/canon/blocks/*.md`, bump CANON_VERSION in `canon/00-INDEX.md`,
  run `node docs/os/tools/render-surfaces.mjs --root=docs/os --write-live`, then paste each surface's file per
  `docs/os/SURFACE-SYNC-PROTOCOL.md`. NEVER hand-edit a file whose header says GENERATED.
- Deploy of engine code = redeploy BOTH Railway services (tranquil-delight + the standalone MCP). Instruction/
  canon changes are paste/upload, not a deploy.
- Standing rules: never fabricate (render "Not on file" / "Derived" / "Conflict"); Supabase is reconcilable, never
  automatic truth; review existing machinery before building; document at every step; commit with the repo's
  Co-Authored-By + Claude-Session trailer.
- Keep connected: life-command-center, _WORKFLOW, _AI-Context, Templates, PROPERTIES, claude-md.
---
