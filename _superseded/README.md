# `_superseded/` — the graveyard (kept for history, never wired)

Prior iterations moved here so they don't float in the active tree and confuse a future chat about what's
canonical. **Nothing here is deleted, nothing here is live.** For what IS canonical, start at
[`../LCC-OS.md`](../LCC-OS.md) → `docs/os/README.md` → `docs/os/REGISTRY.md`.

## What's here and what replaced it
| Superseded file (now under `_superseded/`) | Canonical replacement |
|---|---|
| `copilot/lcc-deal-intelligence.connector.v1.swagger.json` | `copilot/lcc-deal-intelligence.connector.v2.swagger.json` ("LCC Intelligence" v2 — the live connector) |
| `app.js.restored` | `app.js` (live) |
| `dialysis.js.backup` | `dialysis.js` (live) |
| `gov.js.backup` | `gov.js` (live) |
| `scratch-2026-09-12/` (12 files) | nothing — one-off scratch, superseded by the work itself. `err.txt` (0 bytes), `draft1/draft2/draftsave.json`, `harvest.json`, `twin.json`, `seed-apply/seed-dryrun.json`, `acq-dryrun.json`, `fix-allother-pagination.patch`, `_commit.bat`, `_deploy_hardening.bat`. Verified unreferenced anywhere outside `STATUS.md`/`docs/history` before moving (REPO1-root-clutter, 2026-09-12). |

## Superseded but intentionally LEFT IN PLACE (do not move — documented instead)
- **`flow-*.json` (15 files, repo root)** — Power Automate flow definitions. Referenced by name from `CLAUDE.md`, `.env.example`, code comments and ~10 docs; moving them would turn a dozen accurate references stale. **Indexed by topic instead at [`../docs/flows/README.md`](../docs/flows/README.md)** — read that to find a flow, then open the JSON at the root.
- **The ~10 loose `.docx`/`.xlsx` at the repo root** (`LCC_Holistic_Audit_2026-05-17.docx`, `LCC_Architecture_Gap_Analysis.docx`, `Power_Automate_Flow_Guide.docx`, `LCC_Top_Prospects_2026-08-22.xlsx`, …) — historical audit/spec artifacts, referenced from `audit/ROUND_2_FINDINGS_2026-05-19.md` and several `audit/patches/*/COMMIT_MSG.txt`. **Left in place and treated as historical**; nothing live reads them. Do not cite one as current state — `docs/os/CURRENT-STATE.md` is current state.
- **`wave0-config-values.txt`** — 🔐 **do NOT move or rename.** `test/retired-identifiers-guard.test.mjs` allowlists it **by path** (re-measure 2026-10-08), so a move breaks that guard. It is a secrets item, not a tidiness item: see **SEC2**. `ACTIVATE_unit4.sql` likewise stays — cited in `docs/architecture/document-capture-ocr-and-deeds.md`.
- `docs/comps-rollout/lcc-comps-openapi.yaml` — the comps-only subset, **superseded by
  `docs/comps-rollout/lcc-openapi.yaml`** (full read + comps). Retained for back-compat only; **do not extend
  it** — add operations to `lcc-openapi.yaml`.
- `copilot/actions/*.yaml` (`context.retrieve.entity.v1`, `intake.stage.om.v1`, `memory.log.turn.v1`) — old
  per-action drafts. Left in place because their names match live `_preset_action` strings dispatched in
  `server.js`; treat as historical, wire nothing new from them.

## Rule
If you find a file here referenced anywhere as authoritative, that reference is stale — fix it to point at the
canonical replacement above. To retire more iterations, `mv` them here (the device can't delete) and add a row.
