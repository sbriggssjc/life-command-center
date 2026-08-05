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
| 31 | Property-record consolidation + same-event sale reconcile | ✅ code landed (dia+gov migrations, sidebar ingest guard; dry-run default, backups, review lanes, repeat sales preserved). ✅ **migrations APPLIED live 2026-08-04** (dia+gov; gov needed a `gov_normalize_address` shim). Dry-run counts: dia 78 dup groups/969 repeat-keep; gov 409/1650. Destructive apply RUN + verified 2026-08-04: dia 12 merges+3 supersessions, gov 20+8; repeat sales preserved (dia 968/gov 1642); review lanes untouched. |
| 32 | Ollama cleaning-assist agent (P4, proposal-only) | ✅ code landed (LCC Opps migration, `/api/ollama-clean-assist-tick`, Decision Center hints, `OLLAMA_CLEAN_ASSIST` flag default OFF). ✅ **migration APPLIED live 2026-08-04** (LCC Opps); flag `OLLAMA_CLEAN_ASSIST` still OFF, cron no-ops until flipped. |
| 34 | Regenerate blank BOV templates (DSCR fix) | ✅ delivered `BOV_Master_NNN_Briggs_BLANK_2026-08-04.xlsx` + `BOV_Master_MOB_MT_Briggs_BLANK_2026-08-04.xlsx` (DSCR correct; **1,214 / 1,147 cell drift** vs stale copies, CSV in `outputs/prompt_34_bov_templates/`). ⏳ **Scott swaps these into the Northmarq/Copilot project knowledge + `Templates/`.** |
| 35 | Deliverable naming + save doctrine | ✅ canon (v1.2.2), setup doc, comps skill, `NORTHMARQ_PROJECT_PROMPT.md` v1.12, `bov-generator/main.py`. ⚠️ external `~/.claude/skills/bov-underwriting|bov-government` couldn't be edited from repo — paste-ready block in `SPEC_Capability_Parity.md`; apply via SURFACE-SYNC. |

### Needs Scott (from this batch)
- **Re-add the LCC connector** (plugin or account-level) now that OAuth is deployed — verify it registers cleanly.
- **Apply the 31 + 32 migrations** (dia/gov + LCC Opps): dry-run → review → apply; then optionally flip `OLLAMA_CLEAN_ASSIST` on.
- **Swap the regenerated blank BOV templates** (prompt 34) into the Northmarq/Copilot project knowledge + `Templates/`.
- **Sync the two external BOV skills** with the naming block (SURFACE-SYNC-PROTOCOL); re-paste `NORTHMARQ_PROJECT_PROMPT.md` v1.12 into the Project.
- **Rotate `LCC_API_KEY`** (still outstanding; it was exposed in chat).


## Correction 2026-08-05 — prompt 40 WAS done (found it)
Earlier flagged 40 as not-done because I searched only `life-command-center`; the on-market enrichment lives
in the separate **dia** and **gov** database repos (Dialysis PR #7356, gov PR #360) and is applied live as
`v_dia_on_market_full` / `v_gov_on_market_full`. Verified on Dialysis_DB: 205 on-market rows enriched,
implied-NOI cap reconciliation exact (0 mismatch). So ALL of 36–40 are complete.
**Still to validate end-to-end:** that a real `generate_comps` workbook now renders POPULATED on-market rows
(i.e. the enriched view/RPC actually feeds the on-market sheet) — check after the connector/redeploy is up.

## Acceptance run 2026-08-05 (post-redeploy) — 41/42/43 validated end-to-end
Regenerated the Villages workbook through the DEPLOYED renderer/template (43) on the live gated data (42),
41-standardized fields. PASS: OPTIONS header (real template), auto-fit/no-wrap (real renderer), national 18-mo
DaVita+Fresenius set (14 states), standardized operator/expenses/OPTIONS/bumps, clean DOM + 0 negative bid-ask,
0 recalc errors, unknown_keys=[]. Price-change: verified live (11 of 180 on-market rows repriced) but the 14
closest comps to this subject weren't among them (correct — quality assets clear near ask), so PRICE CHG blank here.
**Small residual (candidate 43 follow-up):** renderer's shared-width matching left 4 columns (PATIENTS, EXP, TERM,
LAST PRICE) slightly different between the On Market and Sold tabs — the shared-width pass isn't covering formula/
date columns. Minor.
NOTE: container mount served a STALE cache of the renderer/template on first stage; verified device working tree +
HEAD are correct (OPTIONS header, autofit present) and rebuilt against fresh copies.

## Comps prompts 41-43 — reconcile 2026-08-05 (all merged/live)
Canon re-rendered to **v1.3.0**, 0 drift (41 bumped the block but not the version/surfaces — fixed here).
| # | Merged | State |
|---|---|---|
| 41 | Recency 18-mo default + operator-first widening + operator/expense/OPTIONS/bumps standardization (mcp/comps-tools.js, canon v1.3.0) — PR #1558 `518fcb64` | ✅ merged — **redeploy MCP/tranquil-delight**; re-paste surface bundles |
| 42 | Data-quality gates (DOM validity, ask≥sold bid-ask) + on-market price-change (original vs current ask) — engine `f36943b1` (#1560) + **dia migration (Dialysis #7357) & gov migration (gov #361) APPLIED LIVE** | ✅ merged + live. Verified: gov 0 bad DOM/bid-ask, 13 repriced; dia 386 on-market carry price_changes |
| 43 | RENEWAL OPTIONS→OPTIONS in Briggs+Dialysis templates (gov already OPTIONS) + auto-fit/no-wrap matched widths in populate_comps + validator asserts it — PR #1561 `96119b03` | ✅ merged — **redeploy BOV svc**; run `sync_comps_templates.py --dest <Templates>` to refresh distributed copies |

**Two honest gaps still open (candidate future prompts):**
- **listing_price_history is EMPTY** in both DBs — PRICE CHG currently derives from original-vs-current ask only;
  full per-reprice history needs the `listing_sync` ingestion to write that table.
- **SOLD renewal options** rely on the on-market-enrichment join being present on the sold arm too — 42 says it's
  covered by the prior enrichment PR; confirm on a live sold pull once the connector's back.
- Pre-existing unrelated test failures: `test/w3-6-display-name-resolution.test.mjs` (_cleanAssistHTML) — not comps.

**Deploy-pending to activate 41+42(engine)+43:** redeploy tranquil-delight (41/42 engine) + BOV service (43),
re-add connector, then run a live Villages appraisal pull to confirm 18-mo default, standardized fields,
clean DOM/bid-ask, price-change, OPTIONS header + auto-fit.

## Comps export notes v3 (2026-08-05) — queued 41/42/43
Scott reviewed the national workbook (much better) and flagged remaining export errors. Split: what I fixed in the
regenerate (18-mo default, DaVita+Fresenius, standardized tenant/expenses, OPTIONS rename+normalize, bumps
normalize, cleaned bad DOM + negative bid-ask, auto-fit/no-wrap matched widths) vs what must live in the engine:
- **41** — recency default (18 mo) + operator-expansion order + field standardization (operator/expenses/OPTIONS/
  bumps) in the ENGINE so every surface matches.
- **42** — data-quality gates (DOM validity, ask≥sold bid-ask, on-market original-vs-current ask for PRICE CHG) +
  enrich SOLD renewal options / patients / land / expenses to sold-parity.
- **43** — template rename RENEWAL OPTIONS→OPTIONS + bake auto-fit/no-wrap matched widths into populate_comps.
Known data gaps still visible pending 42: sold renewal options blank, on-market price-change (view stores one ask),
two corrupt bump values (0.1, 1.75). All prompts drafted, NOT sent.

## Comps prompts 36-40 — reconcile 2026-08-05
Landed as MERGED PRs on `main` (not docx responses). Canon re-synced to **v1.2.3**, parity **0 drift**.
| # | What merged | State |
|---|---|---|
| 39 | National subject-anchored selection in appraisal mode (mcp/comps-tools.js: national pull, geography=score weight, +term-at-close/operator-tier/age/size/chairs/bumps scoring, cap-support) — PR #1553 `abce1163` | ✅ merged — **redeploy MCP/tranquil-delight** |
| 36 | Single renderer + connector-down `populate_comps` fallback into comps skill + canon (v1.2.3, blocks/comps.md, re-rendered) — PR #1554 `63a6f3b8` | ✅ merged — re-paste surface bundles |
| 37 | `bov-generator/validate_comps_output.py` + `sync_comps_templates.py` + tests, wired into main.py; templates single-sourced — PR #1555 `72112144` | ✅ merged — **redeploy BOV svc (pacific-love)** |
| 38 | MCP OAuth well-known at RFC 9728 path-suffixed URL + 401 WWW-Authenticate (real connector root cause) — PR #1556 `5f159945` | ✅ merged — **redeploy tranquil-delight; then re-test connector** |
| 40 | On-market enrichment — `v_dia_on_market_full` / `v_gov_on_market_full` (join listings→property+lease) + rpc on-market NOI basis. Lives in the **dia/gov DB repos** (Dialysis PR #7356 `4c73b95`, gov PR #360 `289caee`), NOT life-command-center | ✅ **DONE + LIVE** (views read per-request, no deploy). Verified: dia 205 rows populated, cap_mismatch=0, NOI flagged implied |

**Deploy-pending (the gate to validating any of this):** redeploy tranquil-delight (38 OAuth + 39 comps) and the
BOV service (37 validator); then re-add the LCC connector (38 is the likely real fix) and re-run a Villages
appraisal pull to confirm national selection (39) — on-market enrichment (40) is already LIVE via the DB views.
36-39 moved to done/; 40 remains open.

## Comps pipeline GAP AUDIT (2026-08-05) — do F1/F2 before the format prompts
Full trace in `docs/architecture/comps-pipeline-gap-audit-2026-08.md`. The same request diverged because gaps
live in the ENGINE, not just agent behavior. Prioritized fix set (send in this order):
- **39 (F1, SELECTION)** — appraisal pull is region-bounded (`queryScopeArgs`→`appraisalCandidateStates`→p_states
  = subject state+region); `scoreComp` ranks nationally but is starved. Fix: pull national, geography = score
  weight only, add underwriting dims (term-at-close, operator/credit, age, size/chairs, bumps, cap-support). ← FIRST
- **40 (F2, ON-MARKET DATA)** — on-market rows come from the thin listings path, not enriched to property+lease;
  LAND/BUILT/EXP/TERM/EXPENSES/BUMPS/RENEWAL/CHAIRS/PATIENTS blank. Fix: enrich to sold-parity depth. ← SECOND
- **36** single renderer + local `populate_comps` fallback (format).
- **37** single-source templates + conformance validator.
- **38** connector still errors after MCP_BASE_URL set — deep-diagnose the failing hop.
Verified this session: `populate_comps` run directly = correct FORMAT (unknown_keys:[], trimmed, chairs/patients),
but SELECTION (national) and ON-MARKET DATA remain engine gaps → 39/40. Prompts drafted, NOT yet sent, pending
Scott's go on order.

## Comps output unification — queued 2026-08-04
Root cause of "many formats for the same request": ONE correct renderer exists —
`bov-generator/comps_generator.py::populate_comps` (loads the canonical dialysis template, header-driven,
formula-safe, sorts, flags estimated, trims to the AVG/TOTALS bar). Divergence only when a surface can't reach
`generate_comps` and hand-rolls a layout. Verified this session by importing + running `populate_comps` directly
(payload of query_comps field names → `unknown_keys: []`, sheets trimmed, chairs/patients populated).
- **36** — enforce single renderer + documented local `populate_comps` fallback (skill + canon).
- **37** — single-source `bov-generator/templates/` + conformance validator wired into the export path.
- **38** — connector STILL errors after MCP_BASE_URL is set; deep-diagnose the exact OAuth/initialize hop.

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
