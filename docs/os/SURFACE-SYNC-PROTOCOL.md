# Surface Sync Protocol

How the canon reaches every surface, and how to update them all systematically without drift.
**Canon version lives in `canon/00-INDEX.md`.** Every rendered artifact below stamps the version it was built from.

## 1. Surfaces and their binding artifacts

| Surface | How it binds to the canon (the artifact you edit to render it) | Also carries |
|---|---|---|
| **Copilot — LCC Deal Agent** | `docs/copilot/agent-instructions.md` (paste below `---` → Studio → Publish) | LCC Intelligence connector; Work IQ SharePoint; connected specialists |
| **Northmarq Claude (team Project)** | `_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md` (paste into Project instructions) | MCP connector (if admin-added); BRIGGS-* knowledge |
| **Personal Claude** | `~/.claude/skills/*` (comps-engine, briggs-comps, bov-underwriting, …) | MCP connector; BRIGGS-PERSONAL-CONTEXT |
| **Claude Cowork** | Cowork skills (same skill set) | MCP tools |
| **ChatGPT** | `docs/setup/gpt-actions-system-prompt.txt` (persona) | GPT Action (`lcc-openapi.yaml`) |
| **LCC in-app Copilot** | `/api/chat` routing (`api/bridge.js`, `api/_shared/ai.js`) | — |
| **Engines / data (all surfaces)** | `mcp/` + `api/` — one implementation | Identical JSON on MCP + HTTP |
| **Knowledge (Copilot/Northmarq)** | `_AI-Context/Copilot-Context/BRIGGS-*` (SharePoint) | re-sync in Studio Knowledge |
| **Memory (all surfaces)** | Cortex — `log_memory`/`recall_memory`, signals | write-gated |

Cross-reference the engine×surface state in `docs/comps-rollout/SURFACE_CAPABILITY_PARITY.md` and the Deal
Agent component map in `docs/copilot/DEAL-AGENT-SOURCE-OF-TRUTH.md`.

**Base URL (deployment):** all HTTP/MCP surfaces should point at ONE base URL. Today there are two servers
(`architecture/mcp-server-unification.md`); the endpoint state after unifying onto `tranquil-delight` is the
target. Until then, ChatGPT/Copilot `lcc-openapi.yaml` `servers[0].url` must match the server that actually
serves all 9 bounded `/api/*` ops — not the web-app-only host.

**Migration status:** Copilot `agent-instructions.md` now carries a generated `CANON:BEGIN…END` region
(`render --write-live`); paste-and-publish to Studio applies it. ChatGPT persona is next.

## 2. Propagation matrix — which surfaces to update when a canon module changes

| Canon module | Copilot (agent-instructions) | Northmarq prompt | Claude skills | ChatGPT persona | Engines (`mcp`/`api`) | Knowledge |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| comps | ✔ | ✔ | ✔ | ✔ | ✔ (comps-tools) | — |
| filing | ✔ (specialists) | — | — | — | — | — |
| email-and-routing | ✔ | ✔ | ✔ | ✔ | ✔ (intake) | — |
| logging-and-touchpoints | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| writing-voice | ✔ | ✔ | ✔ | ✔ | — | ✔ (BRIGGS-WRITING-VOICE) |
| bov | ✔ | ✔ | ✔ | ✔ | ✔ (bov-generator) | — |
| intake-triage | ✔ | — | ✔ | — | ✔ (intake) | — |
| personal | ✔ (scoped) | ✖ team | ✔ | — | — | ✔ (BRIGGS-PERSONAL-CONTEXT) |

✔ update · — n/a · ✖ intentionally excluded (personal never on team surfaces).

## 3. Update procedure (run this whenever a rule changes)
1. Edit the canon module in `canon/` (the ONLY place the rule is authored).
2. Bump `CANON_VERSION` and add a changelog line in `canon/00-INDEX.md`.
3. For each ✔ in the module's matrix row, **render** the change into that surface's binding artifact
   (paste/publish/redeploy). Stamp the artifact header with the new `Canon: vX.Y.Z`.
4. If an engine changed, deploy `mcp/`/`api/` (parity holds by construction — MCP + HTTP share handlers).
5. **Verify parity:** run the same prompt on two surfaces; outputs must match. (Automate as a parity test.)

## 4. Drift detection
- Each binding artifact carries a `Canon: vX.Y.Z` header. Anything behind the current `CANON_VERSION` is stale.
- A quick audit = grep the `Canon:` stamps across artifacts and compare to `00-INDEX.md`.
- If two artifacts disagree on a rule, the canon module wins; fix the artifact, don't fork the rule.

## 5. Adding a surface later
Add a row to §1 and §2 (its binding artifact + which modules it renders), then run the update procedure once
to seed it. No canon changes required — a new surface is just another renderer of the same canon.
