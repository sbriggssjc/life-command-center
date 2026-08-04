# Claude Code queue — STATUS

> **START HERE (durable map):** `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` — the surfaces/comps/deploy
> understanding, so a new chat isn't rebuilt from scratch.
>
> **ALL comps code (prompts 22-28) committed to `main` @ `f6adddf0` (in sync with origin).** The gate is a
> **REDEPLOY of both Railway services** (tranquil-delight + standalone MCP) + `BOV_API_KEY` on tranquil-delight,
> then re-import `lcc-openapi.yaml` into ChatGPT + re-paste v1.2.1 bundles, and test the Villages appraisal on
> both surfaces. Follow-up: workbook lacks a 'Secondary/market-range' sheet (high-cap comps excluded, not shown
> — prompt 29 if wanted). Also: rotate `LCC_API_KEY`; Census key (invalid) for prompt 19.


## This session — reconcile 2026-08-04 (prompts 31–35 processed)
Responses reviewed from `responses/`; prompts + responses moved to `done/`. Canon re-rendered to **v1.2.2**
(0 drift) — the 35 naming doctrine had been written to the non-render `canon/*.md`; ported into `canon/blocks/`
and re-rendered so all 5 surfaces + the Copilot live artifact now carry it.

| # | Outcome | State |
|---|---------|-------|
| 33 | Mount MCP OAuth on root app | ✅ **DONE + DEPLOYED** — pushed `ef8cc6a6`; live `/version` advanced; `/.well-known/oauth-authorization-server`→JSON, `/register`→201. **Connector now registers.** Re-add the LCC connector (account-level or in the plugin) and it should auth. |
| 31 | Property-record consolidation + same-event sale reconcile | ✅ code landed (dia+gov migrations, sidebar ingest guard; dry-run default, backups, review lanes, repeat sales preserved). ✅ **migrations APPLIED live 2026-08-04** (dia+gov; gov needed a `gov_normalize_address` shim). Dry-run counts: dia 78 dup groups/969 repeat-keep; gov 409/1650. Destructive `*_apply(false)` NOT yet run — awaits review. |
| 32 | Ollama cleaning-assist agent (P4, proposal-only) | ✅ code landed (LCC Opps migration, `/api/ollama-clean-assist-tick`, Decision Center hints, `OLLAMA_CLEAN_ASSIST` flag default OFF). ✅ **migration APPLIED live 2026-08-04** (LCC Opps); flag `OLLAMA_CLEAN_ASSIST` still OFF, cron no-ops until flipped. |
| 34 | Regenerate blank BOV templates (DSCR fix) | ✅ delivered `BOV_Master_NNN_Briggs_BLANK_2026-08-04.xlsx` + `BOV_Master_MOB_MT_Briggs_BLANK_2026-08-04.xlsx` (DSCR correct; **1,214 / 1,147 cell drift** vs stale copies, CSV in `outputs/prompt_34_bov_templates/`). ⏳ **Scott swaps these into the Northmarq/Copilot project knowledge + `Templates/`.** |
| 35 | Deliverable naming + save doctrine | ✅ canon (v1.2.2), setup doc, comps skill, `NORTHMARQ_PROJECT_PROMPT.md` v1.12, `bov-generator/main.py`. ⚠️ external `~/.claude/skills/bov-underwriting|bov-government` couldn't be edited from repo — paste-ready block in `SPEC_Capability_Parity.md`; apply via SURFACE-SYNC. |

### Needs Scott (from this batch)
- **Re-add the LCC connector** (plugin or account-level) now that OAuth is deployed — verify it registers cleanly.
- **Apply the 31 + 32 migrations** (dia/gov + LCC Opps): dry-run → review → apply; then optionally flip `OLLAMA_CLEAN_ASSIST` on.
- **Swap the regenerated blank BOV templates** (prompt 34) into the Northmarq/Copilot project knowledge + `Templates/`.
- **Sync the two external BOV skills** with the naming block (SURFACE-SYNC-PROTOCOL); re-paste `NORTHMARQ_PROJECT_PROMPT.md` v1.12 into the Project.
- **Rotate `LCC_API_KEY`** (still outstanding; it was exposed in chat).

## Open (in `prompts/`)
| # | Prompt | Priority | State |
|---|--------|----------|-------|
| 24 | Cross-tool intent/resolution AUDIT (Phase 1 of the understanding layer) | P2 | open |
| 23 | Comps appraisal-scale query shaping (engine fine; defaults under-serve) | P1 | open |
| 22 | MCP server unification + protocol bump | P0 | **code DONE + committed `ddd9d49e`; DEPLOY-PENDING (Scott: env vars on tranquil-delight + redeploy)** |
| 21 | Copilot Studio -> /mcp connect + publish | P1 | **blocked on 22 deploy** (then Scott connects + publishes to M365) |
| 19 | Run census demographics backfill | P1 | **PAUSED per Scott** — awaiting a working key from census.gov |
| 18 | Recurring PA flow failures | P1 | code DONE; tenant PA flows now handled (see below) |

## THE ONE THING THAT UNBLOCKS EVERYTHING: deploy `ddd9d49e` to tranquil-delight
Prompt 22 mounted `/mcp` + OAuth + the 9 bounded `/api/*` read/comps routes onto the root app (`server.js:162`,
before the `/api/*` 404 handler at `server.js:559`), and bumped `initialize` to negotiate `>= 2025-03-26`.
Locally verified (19 tools, 401/echo, check:boot passes). **Not deployed.** Deploying it fixes, in one step:
- **ChatGPT** "Unknown API route" on comps (the GPT's comps call falls through to the 559 handler today —
  confirmed in this session's re-import test chat). Import itself succeeded (prompt 20 trim worked).
- **Copilot Studio** MCP (`/mcp` becomes live at the canonical URL) → prompt 21 Part 2.
- **The 2-server drift** ("fixes land on the server ChatGPT never calls").

**Scott's deploy checklist:** set on the `tranquil-delight` Railway service —
`OPS_SUPABASE_URL/KEY`, `GOV_SUPABASE_URL/KEY`, `PRIMARY_WORKSPACE_ID`, `LCC_API_KEY`, `MCP_BASE_URL` + OAuth —
then redeploy. Live-verify: `POST /mcp` initialize → 200 w/ Bearer (not 404); the 9 `/api/*` → 200; ChatGPT
"Government comps in Texas, last 12 months" returns real comps; then connect Copilot.

## Power Automate (tenant) — RESOLVED by Scott
Retired flows (Unflag Completed Email Tasks, To Do Sync) are **Off**. The sole remaining active To Do flow is
**LCCToDoCompletionPoll** (30-min recurrence): GET/POST `tranquil-delight/api/webhooks/todo-completion-poll`
(route live at `server.js:266` → `api/sync.js`; design in `docs/architecture/flows/todo-completion-poll.md`),
reads staged worklist, reconciles MS To Do + Outlook (resolve msg id → move → flag), reports completion.
Reviewed this session — well-formed and consistent with the documented design; healthy. Health surface should
green out as the retired rows age off.

## This session (2i) processed
- **Prompt 22 response** — code landed + committed `ddd9d49e`; deploy-pending. Response -> done/.
- **ChatGPT re-import test** — GPT correctly refuses to fabricate; blocked only by "Unknown API route" = the
  un-deployed unification (same fix as 22). Not a new issue.
- **LCCToDoCompletionPoll flow** — reviewed; healthy; it's the consolidation of the two retired flows.

## Needs Scott (not code)
- **Deploy `ddd9d49e`** to tranquil-delight (env vars + redeploy) — unblocks ChatGPT + Copilot. ← top priority.
- **Copilot Studio** connect + publish (prompt 21 Part 2) — after the deploy.
- **Census:** paused; obtain a working key from census.gov, then resume prompt 19.

## Northmarq DaVita/Austin test chat — triage (2026-08-04)
Output quality was strong (data-hierarchy discipline: executed lease > client recollection; caught 3 real
discrepancies — Sep-2034→Apr-30-2035 expiry, 7,835→8,024 SF, NN vs Absolute-NNN; no fabricated comps). Gaps were
all plumbing, now queued:
- **Comps not pulled/generated** — the Northmarq project has no live LCC connector (managed Claude, admin needed;
  compose-and-hand-off is the by-design fallback and it worked — it emitted a /comps payload). Native tools land
  when an admin adds the connector at `{MCP_BASE_URL}/mcp` **after prompt 33** mounts OAuth. Not a code prompt →
  Scott/IT action.
- **Deliverables didn't save to disk + inconsistent naming** (Master Sheet off-convention) → **prompt 35**.
- **DSCR bug in the stale blank BOV template** (generator source is correct; uploaded template drifted) →
  **prompt 34**.

## Done (in `done/`)
01-14, 16, 17, 20, 07; session 2i: prompt-22 response. 15 RETIRED.

## Migrations applied live by Cowork (Supabase MCP)
#710 field_source_priority · relocation+competition (Dialysis) · lcc_health_surface (connector_type::text) ·
lcc_contact_property_deal_reverse_reads.

## Process: see `README.md`.

## SECURITY (2026-08-03) — P0
`LCC_API_KEY` was pasted in plaintext during a curl diagnostic (2e04…b64c) → treat as compromised (also the
prior flagged rotation item). ROTATE: new value on tranquil-delight + standalone MCP + BOV services, then update
ChatGPT action, Copilot connection, personal Claude connector, and any PA flows that send it. One new shared
value across all surfaces also removes any key-mismatch as a cause of the comps 401/SystemError.

## Prompt 23 (comps intent) — DEPLOY-PENDING
Committed `39a76315`; tests pass. Redeploy tranquil-delight + standalone MCP so the appraisal-mode / subject-resolution / operator-list behavior goes live on the agents.

## Agent instruction files — UPDATED 2026-08-03 (Scott: paste into each surface)
Added the **comps no-self-narrow** rule (pass request verbatim; engine expands) + the **resolution/ambiguity**
rule (present candidates on `status='ambiguous'`, never guess; `not_on_file`→say so) to: `docs/copilot/agent-
instructions.md` (unified/Copilot Studio), `docs/claude/northmarq-claude-instructions.md`, `docs/claude/personal-
claude-instructions.md`, `docs/setup/gpt-actions-system-prompt.txt` (+ its LCC-CANON knowledge file), and canon
source `docs/os/canon/comps.md` + new `docs/os/canon/resolution.md`. ChatGPT GPT: also update the LCC-CANON
knowledge file, not just the system prompt.
## Prompt 25 (subject resolver) — DEPLOY + MIGRATION pending
Code committed; redeploy tranquil-delight + standalone MCP; apply `supabase/migrations/20260820130000_lcc_
interpretation_logs.sql` (LCC Opps) for the interpretation-logging table (resolver logs best-effort without it).

## Comps data-integrity program (post-audit)
- **Prompt 29** (export polish: dedup/cap-band/field-map/format) — CODE DONE (36/36 tests), **DEPLOY-PENDING** (redeploy tranquil-delight + standalone MCP).
- **Prompt 30** AUDIT delivered: `docs/architecture/data-integrity-audit-2026-08.md`. Findings: dia 610 dup properties / 967 excess rows (370 multi-source); LCC provenance 2,055 rules / 1,155 conflicts / 33 unranked. Phased plan P1(export, ~done via 29) → **P2 sale-event dedup + SF overlap (next)** → P3 backfill w/ precedence → P4 continuous scrub + Health dashboard.
- **Prompt 31** drafted into `prompts/`: P2 reframe says do not delete repeat sales; consolidate 93 same-address/different-`property_id` buildings, reconcile only conservative multi-source same-event sales, keep repeat sales distinct, and use Ollama only as review-lane/unstructured assist.
- **Cowork future-proofing:** `docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md` (run-on-computer default, Global Instructions block, account-level connectors/plugin, canonical folder set).
