# `docs/claude-code/done/` — LEGACY pre-split archive (do not add new files here)

**This folder is historical.** It predates the current prompt/response filing convention
documented in `docs/os/DOCUMENTATION-MAP.md` §2. Before the split, a finished round's prompt
and its `.response.md` write-up were both dropped in one flat `done/` folder together (see e.g.
`02-connect-deal-spine.md` + `02-connect-deal-spine.response.md` sitting side by side here).

**The current convention (in effect for all new work):**
- A prompt for Claude Code lives in `docs/claude-code/prompts/`, and moves to
  `docs/claude-code/prompts/done/` once its work merges.
- Claude Code's response (`.docx`/`.md`) lives in `docs/claude-code/responses/`, and moves to
  `docs/claude-code/responses/done/` once reconciled.

**Do not add new files to this folder.** Nothing here is deleted or moved wholesale — several
inbound references from `STATUS.md`, `CURRENT-STATE.md` and dated worklogs point at specific
files inside it — but any *new* finished prompt/response pair goes into the two `done/` folders
above, never here.
