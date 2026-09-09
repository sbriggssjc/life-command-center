# AI Surfaces & Comps Engine — Operational Reference

> **For "where are we?" read [`CURRENT-STATE.md`](CURRENT-STATE.md) first** (what is LIVE, what is
> flag-gated OFF and why, the canonical-doc map). **For "what's left?" read
> [`PLANNED-BACKLOG.md`](PLANNED-BACKLOG.md)** (every unbuilt-but-intended item, with provenance).
> **This file is the durable HOW — surfaces, the comps engine, and deploy mechanics.**

**Read this before touching instructions, the comps engine, or a deploy.** Consolidated 2026-08-03 from a long
working session so future chats don't re-derive it. Chronology lives in
`docs/architecture/DOSSIER-PROGRAM-STATE-OF-PLAY.md`; this is the durable "how it actually works" map.

## 1. Instructions are a managed single-source system — never hand-write per surface
- **Source of truth:** `docs/os/canon/blocks/*.md` (one file per rule block). Version:
  `docs/os/canon/00-INDEX.md` `CANON_VERSION` (**1.5.0**, 2026-08-20 — corrected 2026-08-26; this line read
  1.2.2 for weeks, so verify it against `00-INDEX.md` rather than trusting any copy of it).
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
There are **two Railway deployments from this repo** (`docs/architecture/mcp-server-unification.md`):
- **`tranquil-delight-production-633f.up.railway.app`** = root web app (`server.js`). Since prompt 22 it ALSO
  mounts `/mcp` + OAuth + the 9 bounded `/api/*` read/comps routes (`mountLccMcp` at `server.js:162`, before the
  `/api/*` 404 at `server.js:559`). This is the URL ChatGPT (`/api/*`) and Copilot Studio MCP (`/mcp`) use.
- **A separate standalone MCP service** (`mcp/server.js`) = what the personal-Claude connector AND this Cowork
  session's `mcp__LCC__*` tools talk to.
  **Railway service `life-command-center` → `https://life-command-center-production.up.railway.app` (port 3100).**
  *(Named here 2026-09-09 after backlog I16/I16b had this service marked "dormant — delete": it is the MCP.
  `/health` → `lcc-mcp-server`. It also mounts the engine routes the six `api/*.js` `GOV_API_URL` fallbacks call.)*
- **`gracious-radiance-production-eeaf.up.railway.app`** = the **record-linkage resolver** (splink / libpostal /
  gliner; models `owner_sf`, `owner_owner`, `contact`; `no_db_writes: true`) — the w44 retrain stack. Referenced in
  `docs/architecture/comps-data-integrity-and-canonical-record.md`; recorded here 2026-09-09 so the full Railway
  service map is in one place: **four web services + five cron services** (`cms-ingestion`, `county-ingest`,
  `public-record-ingest`, `government-lease`, `Dialysis`) in project `handsome-luck`.
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

**Env on Dialysis_DB (`zqzrriwuavgrquhisnoa`) edge functions** (Supabase secrets, not Railway): the
`intake-salesforce` function reads `SF_USERNAME` / `SF_PASSWORD` / `SF_SECURITY_TOKEN` (SF-DIRECT,
2026-09-09 — `_shared/salesforce-soap.ts`'s SOAP login, password = `SF_PASSWORD`+`SF_SECURITY_TOKEN`
concatenated) + the optional `SF_LOGIN_HOST` (defaults `login.salesforce.com`; set to
`test.salesforce.com` to point at a sandbox) and `SF_API_VERSION` (defaults `61.0`). These are the
same three secrets `sf-test` held before its 2026-09-09 deletion — kept by decision, now consumed by
`intake-salesforce?action=sf-ping`.

- ⚠️ **`SF_LOOKUP_WEBHOOK_URL` is now needed on Dialysis_DB too (SF-DIRECT-b, 2026-09-09).** Until
  now it lived only in the Railway env, read by `api/_shared/salesforce.js` (Node). SOAP login was
  proven to fail at the org's door (`INVALID_SSO_GATEWAY_URL` — the integration user's Salesforce
  profile is under corporate SSO), so `sf-ping` falls back to the same PA gateway flow ("HTTP Switch
  Salesforce Lookup", `sf-http-switch-lookup`) via `supabase/functions/_shared/salesforce-gateway.ts`
  — same signed URL, same secret value, set a second time on the Supabase project:
  `supabase secrets set SF_LOOKUP_WEBHOOK_URL="<the flow's HTTP POST URL>" --project-ref zqzrriwuavgrquhisnoa`.
  The URL carries a `?sig=...` signature — never log it, never put it in a doc; treat both copies
  (Railway env var, Supabase secret) identically as secrets.

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

## 4. DEPLOY-PENDING — ⚠️ HISTORICAL (2026-08-04), superseded as the "what's left" answer
> **Do not read this section as current.** It was the deploy-gate snapshot on **2026-08-04**, during the
> comps arc; the app has shipped through ~P188 since. The live "what's left" is
> [`PLANNED-BACKLOG.md`](PLANNED-BACKLOG.md), and the live flag/runtime state is
> [`CURRENT-STATE.md`](CURRENT-STATE.md). Two items below were **not** re-measured during the 2026-08-26
> consolidation and are carried forward as open in the backlog rather than declared resolved:
> **rotate `LCC_API_KEY`** (backlog SEC1) and the **Census key** (backlog: third-party keys). The rest is
> retained verbatim for the reasoning trail. Full chronology:
> `docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md`.

**Updated 2026-08-04 (reconcile of prompts 31–35).**

- ✅ **MCP OAuth mounted + DEPLOYED (prompt 33, `ef8cc6a6`).** `/mcp` + OAuth discovery + `/register`/`/authorize`/
  `/oauth/token` now serve on tranquil-delight (live `/version` advanced; `/.well-known/oauth-authorization-server`
  → JSON, `/register` → 201). **The Cowork/Copilot connector registration error is fixed** — re-add the LCC
  connector (plugin or account-level) and it should auth.
- ⏳ **Prompts 31 + 32 code landed, migrations NOT applied live.** dia/gov property-consolidation +
  same-event-sale reconcile (31) and the LCC-Opps Ollama clean-assist (32, `OLLAMA_CLEAN_ASSIST` flag OFF) are
  committed with dry-run defaults + backups + review lanes. Apply dry-run → review → apply; runtime stays off
  until the flag is flipped. No hard-deletes; repeat sales preserved.
- ⏳ **Prompt 34 blank BOV templates delivered, awaiting swap.** Regenerated NNN + MOB/MT blanks (DSCR correct;
  1,214/1,147-cell drift vs the stale copies) live in `outputs/prompt_34_bov_templates/`. Scott replaces the
  Northmarq/Copilot project-knowledge + `Templates/` copies.
- ✅ **Prompt 35 naming/save doctrine, canon v1.2.2.** `{Property}_{DocType}_{Client}_{YYYYMM}` + deal-folder save
  is in the `bov`/`filing` blocks and rendered to all 5 surfaces (0 drift). External BOV skills + the Northmarq
  Project prompt (v1.12) still need the SURFACE-SYNC re-paste.

**Earlier comps arc (still true):** prompts 22–29 comps engine is deployed + validated (The Villages appraisal
PASS). A "deploy" of engine changes = redeploy **tranquil-delight + the standalone MCP** (both build from `main`);
confirm `BOV_API_KEY` + the `pacific-love` BOV service for one-shot workbooks; ChatGPT re-imports
`lcc-openapi.yaml` on tool-shape changes. Still pending: **rotate `LCC_API_KEY`**; Census key (invalid) for
prompt 19.

## 4a. `ai-copilot` edge function (dia) — auth gate env vars (COPILOT-OPEN-gate, 2026-09-09)

`ai-copilot` (Dialysis_DB `zqzrriwuavgrquhisnoa`) is gated behind `authenticateWebhook()` on every
route but `GET /health` since v80. It now reads two new env vars on top of the existing
`PA_WEBHOOK_SECRET` (already present — shared with `intake-salesforce`, confirmed via
`supabase secrets list`, names only):

| var | default | meaning |
|---|---|---|
| `PA_WEBHOOK_SECRET` | (already set) | the shared secret; `X-PA-Webhook-Secret` must match |
| `COPILOT_AUTH_MODE` | `log` | `log` = an unauthenticated request is logged as `DENY-WOULD` and allowed through; `enforce` = 401 |
| `COPILOT_KNOWN_IPS` | unset | comma list of `class:ip-prefix` pairs for the DENY-WOULD log's `ip_class` field, e.g. `railway:152.55.,railway:162.220.232.,scott:<prefix>` |

Full state + the flip procedure: `docs/architecture/edge-function-deploy-drift.md`
§"`ai-copilot` (dia) — v79 shipped with NO authentication". Callers that need the header:
`docs/architecture/flows/ai-copilot-sync-callers.md` (four PA flows, 👤 Scott).

## 5. The bigger architecture (pointers)
- Request-understanding layer (why plain-language handling is a cross-tool gap): `docs/architecture/request-
  understanding-and-consistency-layer.md` + the audit `docs/architecture/intent-resolution-audit-2026-08-03.md`.
  Phase 2 (shared Subject/Entity Resolver) = prompt 25, done. BOV is the next adopter.
- Comps triage detail: `docs/comps-rollout/comps-query-shaping-triage-2026-08-03.md`.
- MS surfaces / MCP pivot: `docs/comps-rollout/ms-surface-triage-and-mcp-pivot.md` + `mcp-copilot-readiness.md`.
- Claude Code prompt/response workflow + STATUS: `docs/claude-code/` (STATUS entries for 2026-08-03→12
  are archived at `docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md`).
- **Current state / backlog:** `docs/os/CURRENT-STATE.md` · `docs/os/PLANNED-BACKLOG.md`.
- **Local model:** `docs/os/LOCAL-MODEL-LEVERAGE-MAP.md` (where it runs) · `docs/os/LOCAL-MODEL-GAP-AUDIT.md` (ranked gaps).
