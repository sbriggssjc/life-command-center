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

## Superseded but intentionally LEFT IN PLACE (do not move — documented instead)
- `docs/comps-rollout/lcc-comps-openapi.yaml` — the comps-only subset, **superseded by
  `docs/comps-rollout/lcc-openapi.yaml`** (full read + comps). Retained for back-compat only; **do not extend
  it** — add operations to `lcc-openapi.yaml`.
- `copilot/actions/*.yaml` (`context.retrieve.entity.v1`, `intake.stage.om.v1`, `memory.log.turn.v1`) — old
  per-action drafts. Left in place because their names match live `_preset_action` strings dispatched in
  `server.js`; treat as historical, wire nothing new from them.

## Rule
If you find a file here referenced anywhere as authoritative, that reference is stale — fix it to point at the
canonical replacement above. To retire more iterations, `mv` them here (the device can't delete) and add a row.
