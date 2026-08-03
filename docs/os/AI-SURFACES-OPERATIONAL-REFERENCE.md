# AI Surfaces & Comps Engine — Operational Reference

**Read this before touching instructions, the comps engine, or a deploy.** Consolidated 2026-08-03 from a long
working session so future chats don't re-derive it. Chronology lives in
`docs/architecture/DOSSIER-PROGRAM-STATE-OF-PLAY.md`; this is the durable "how it actually works" map.

## 1. Instructions are a managed single-source system — never hand-write per surface
- **Source of truth:** `docs/os/canon/blocks/*.md` (one file per rule block). Version:
  `docs/os/canon/00-INDEX.md` `CANON_VERSION` (currently **1.2.0**).
- **Renderer:** `docs/os/tools/render-surfaces.mjs` (config `docs/os/render.manifest.json`). Run:
  `node docs/os/tools/render-surfaces.mjs --root=docs/os --write-live`. It writes per-surface bundles to
  `docs/os/surfaces/*.canon.md` and, for surfaces with a `liveArtifact`, splices the `CANON:BEGIN…END` region
  into that file in place.
- **To change ANY instruction rule:** edit the `blocks/<id>.md`, bump `CANON_VERSION` in `00-INDEX.md`, run the
  renderer, then propagate to each surface (below). **Never hand-edit a file whose header says GENERATED**, and
  never edit a rule in one surface only — that is the drift this system exists to prevent.

### Per-surface MASTER paste-file (the ONE file per surface — from SURFACE-SYNC-PROTOCOL §1, confirmed)
| Surface | The one file you paste/upload | How it updates |
|---|---|---|
| **Copilot LCC Deal Agent** | `docs/copilot/agent-instructions.md` (paste below `---`) | **auto** — renderer `--write-live` |
| **ChatGPT custom GPT** | `docs/os/surfaces/chatgpt.canon.md` uploaded as the **"LCC-CANON" Knowledge file** (persona `docs/setup/gpt-actions-system-prompt.txt` stays a short pointer, ≤8000 chars) | **auto** — renderer generates the bundle |
| **Northmarq Claude (team Project)** | `_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md` (rich hand-authored doc, its own version + §8 Update Log; currently **v1.10**) | **manual** — sync the canon-governed sections (comps §3C, resolution) by hand |
| **Personal Claude / Cowork** | `~/.claude/skills/*` (comps-engine, briggs-comps, bov-underwriting, …) | **manual** — skills, not a single paste file |

**LEGACY — do NOT treat as authoritative (delete to end the confusion):** `docs/claude/northmarq-claude-instructions.md`
and `docs/claude/personal-claude-instructions.md` self-label "AUTHORITATIVE SOURCE OF TRUTH" but are NOT the binding
artifacts per §1 (Northmarq→_WORKFLOW prompt, Personal→skills). They are stale duplicates.

**Open improvement (not yet built):** true one-command-updates-all needs each master (Northmarq prompt, the skills)
to carry a managed `CANON:BEGIN…END` region + a portable render target. Today only Copilot + ChatGPT auto-render.

## 2. Deployment architecture — TWO servers (+ BOV), and what "deploy" means
There are **two Railway deployments from this repo** (`docs/os/architecture/mcp-server-unification.md`):
- **`tranquil-delight-production-633f.up.railway.app`** = root web app (`server.js`). Since prompt 22 it ALSO
  mounts `/mcp` + OAuth + the 9 bounded `/api/*` read/comps routes (`mountLccMcp` at `server.js:162`, before the
  `/api/*` 404 at `server.js:559`). This is the URL ChatGPT (`/api/*`) and Copilot Studio MCP (`/mcp`) use.
- **A separate standalone MCP service** (`mcp/server.js`) = what the personal-Claude connector AND this Cowork
  session's `mcp__LCC__*` tools talk to.
- **`pacific-love-production-f6b9.up.railway.app`** = BOV Generator (hosts `/generate-comps`, `/generate-bov`).
  The workbook export (`/api/comps` → proxies it) needs `BOV_API_KEY` (distinct from `LCC_API_KEY`) on
  tranquil-delight.

**Env on tranquil-delight** (for the unified `/mcp` + comps): `OPS_SUPABASE_URL/KEY`, `GOV_SUPABASE_URL/KEY`,
**`DIA_SUPABASE_URL/KEY`** (legacy JWT — a dialysis comps pull errors without it), `LCC_API_KEY`,
`LCC_PRIMARY_WORKSPACE_ID`=`a0000000-0000-0000-0000-000000000001`, `MCP_BASE_URL`=the tranquil-delight URL,
`BOV_API_KEY`. **Rotate `LCC_API_KEY`** — it was exposed in chat (2026-08-03); keep it identical across the
service + every connector or auth 401s.

**A "deploy" of engine changes = redeploy tranquil-delight AND the standalone MCP service** (both build from `main`).
Instruction/canon changes do NOT need a deploy — they're paste/upload.

## 3. Comps engine — operational reference (`mcp/comps-tools.js`)
- **Data is NOT the problem.** Dialysis_DB (`zqzrriwuavgrquhisnoa`) holds **3,022 live sold dialysis comps
  (1985–2026, 48 states, 100+ FL)** in `sales_transactions` (`transaction_state='live'`); `v_sales_comps` is built
  from them. `rpc_query_comps` serves up to `p_limit`, **most-recent-first**.
- **Three surfaces, one core:** `synthesize_comps` (NL `request` → `parseRequest` → appraisal mode) and
  `query_comps` (explicit params) both call `runComps`; `generate_comps` exports the workbook from returned rows.
- **Appraisal mode** (prompt 23, deployed) fires when the request text says appraiser/valuation/under-contract/
  BOV/comp-package: sets `include_unreliable_noi`, tenant NULL, high limit, resolves a `subject`, ranks by
  `scoreComp` (metro > state > region > national + credit/term/size/chairs/cap/recency), tiers A/B/C.
- **`p_tenant` is a single ILIKE** — a multi-operator string collapses to ~0; for "all operators" pass NULL /
  a list. **Reliability gate** excludes imputed-cap comps by default (most dialysis) — appraisal mode includes them.
- **Known fixes shipped (code committed, see §4 deploy):** prompt 23 (appraisal mode + no-self-narrow),
  prompt 25 (shared `mcp/subject-resolver.js` → property/contact context return `{status,candidates}` envelopes;
  `interpretation_logs` table applied to LCC Opps), **prompt 26** (appraisal geography RANKS, not hard-filters —
  fixed the "1 comp for The Villages" bug where the subject metro filtered FL's ~14 down to 1; subject row excluded).
- **Client-routing rule (canon v1.2.0):** every surface must pass the user's request VERBATIM to `synthesize_comps`
  and NOT invent tenant/metro/date filters — the engine expands. (This was the ChatGPT "1 comp" cause before the
  instruction fix.)

## 4. DEPLOY-PENDING (the single most important "what's left")
**Prompts 23, 25, 26 DEPLOYED + working** (appraisal mode: 100 candidates → top ~25 ranked, 17 FL, sold +
listings, flags retained). **Prompt 27 (one-shot server-side workbook) = CODE DONE, committed `9ac94bfb`, canon
v1.2.1 — DEPLOY-PENDING.** To land the workbook download: (1) redeploy **tranquil-delight + the standalone MCP**;
(2) confirm the BOV service (`pacific-love`) is up and `BOV_API_KEY` is set on tranquil-delight (the generator
proxies it); (3) **ChatGPT: re-import `docs/comps-rollout/lcc-openapi.yaml`** — `generate_comps` now takes a
`request` param; Copilot-on-MCP picks up the new tool after redeploy (OpenAPI-connector Copilot = re-import the
package); (4) **re-paste the v1.2.1 instruction bundles** per §1. Still pending: rotate `LCC_API_KEY`; Census key
(invalid) for prompt 19.

## 5. The bigger architecture (pointers)
- Request-understanding layer (why plain-language handling is a cross-tool gap): `docs/architecture/request-
  understanding-and-consistency-layer.md` + the audit `docs/architecture/intent-resolution-audit-2026-08-03.md`.
  Phase 2 (shared Subject/Entity Resolver) = prompt 25, done. BOV is the next adopter.
- Comps triage detail: `docs/comps-rollout/comps-query-shaping-triage-2026-08-03.md`.
- MS surfaces / MCP pivot: `docs/comps-rollout/ms-surface-triage-and-mcp-pivot.md` + `mcp-copilot-readiness.md`.
- Claude Code prompt/response workflow + STATUS: `docs/claude-code/`.
