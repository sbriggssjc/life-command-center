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

## Live connector acceptance test (2026-08-05) — connector WORKS; builder bugs found → queued 46/47
Connector is live (prompt 38 OAuth fixed — LCC MCP tools reachable). But `generate_comps` fails end-to-end:
- **Every build 500s on the prompt-37 conformance validator** — it rejects what the prompt-43 renderer produces:
  one-shot "[On Market] grid not trimmed to AVG bar"; two-step "shared widths differ PATIENTS 10 vs 13";
  standard "EXPENSES narrower than content" + RENT/SF (formula col). Auto-fit ↔ validator not one contract.
- **On-market returned 174 rows** into a 100-row template (overflow; not curated).
- **Subject not resolved into the anchor**: `get_property_context` resolves 1050 Old Camp Rd fully (31964: 6,453 SF/
  12 chairs/2022/term→2038/6.75%), but the comps engine's subject came back "Not on file" + cap defaulted 6.00%,
  and the subject appeared as a comp (`excluded_subject=0`).
Queued:
- **46** — reconcile auto-fit ↔ conformance validator (one width contract, recalc-then-measure), trim both sheets all
  paths, truncate appraisal on-market to ~20–25 curated. Unblocks generate_comps.
- **47** — hydrate the subject anchor from the resolved property record (SF/chairs/term/bumps/operator/cap 6.75%) +
  exclude the subject from the set. Makes 41/44 similarity actually work.
Stopgap delivered: local-renderer workbook (subject excluded, 22 sold + 14 on-market) so the appraiser isn't blocked.

## Comps prompts 44-45 — reconcile 2026-08-05 (merged/live)
| # | Merged | State |
|---|---|---|
| 44 | Exporter: DEFAULT_APPRAISAL_LIMIT 30→25 (most-similar), scoreComp rescored (market 10→12/region 4→6, size ×5, chairs ×3, term-at-close 8pts +1.5/yr penalty, cap →10; **operator 6→2, credit 3→1** — minor tiebreaker), bumps bare-decimal→`X% / 5 yrs` (0.1→10%), computed-column min widths (TERM/DOM/caps/$ ≥ floors) + shared width — PR #1563 `341b4b64` | ✅ merged — **redeploy MCP/tranquil-delight** |
| 45 | Price-adjustment recovery: **dia** (Dialysis #7359) recovered earliest dated ask into `initial_price` (59 fills+33 corrections) + `had_price_change` + recurrence triggers → on-market PRICE CHG **10→22 (verified live: 22, 1,842 rows provenance-tagged)**; **gov** (#363) recovered 522 `original_price` from `listing_verification_history` → **13→19**. Reversible, provenance, caps reconcile. Applied LIVE in both DB repos | ✅ merged + live (views read per-request, no deploy) |

**Deploy-pending to activate 44:** redeploy tranquil-delight (MCP/comps engine) + BOV service (renderer widths).
45 is already effective (DB). Then the **live connector acceptance test**: run a Villages `generate_comps` and confirm
25 most-similar (Fresenius-over-DaVita where more alike), bumps `10% / 5 yrs`, TERM visible, PRICE CHG populated.

## Comps exporter v-final notes (2026-08-05) — queued 44/45
Scott's notes on the acceptance workbook. Queued:
- **44 (exporter)** — return the **25 best/most-like** comps every request; **rescore similarity OVER operator**
  (a similar-market/size/term/cap Fresenius beats a different-market/+4yr-term DaVita); bumps `0.1`→`10% / 5 yrs`;
  fix TERM column width (hidden) + the shared-width residual (PATIENTS/EXP/TERM/LAST PRICE).
- **45 (price-adjustment recovery)** — YES recoverable. gov: wire native `available_listings.original_price`/
  `price_change_count`. dia: backfill `initial_price` from `listing_verification_history.prior_asking_price` (7,097),
  `listing_snapshots` (1,310), `v_property_ask_history` (2,987). Re-point enriched views so PRICE CHG populates
  broadly; fix `listing_sync` to capture future reprices natively.
Plan: send 44+45, then test the live `generate_comps` via the reconnected connector. Prompts drafted, not sent.

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


## Reconcile 2026-08-05 (prompts 46 & 47 — merged, live) + queue 48/49

**46 & 47 landed and moved to `done/`.** Live-connector acceptance re-run (The Villages
DaVita, 1050 Old Camp Rd, property_id 31964) — verified what now works, and isolated the
two residual blockers with root cause + reproduction. Queued **48** and **49**.

| # | Outcome | State |
|---|---------|-------|
| 46 | Builder conformance: overflow cap, trim-both-paths, curated on-market, shared-width contract | ✅ **merged (#1565), live.** Overflow cap + trim + on-market truncation confirmed. Shared-width contract (`validate_comps_output`) correct. **Residual:** contract set pre-recalc; LibreOffice `store()` re-optimizes widths → **prompt 48**. |
| 47 | Subject hydration from property record + exclude subject from set | ✅ **merged (#1567), live.** `synthesize_comps` (appraisal wording) hydrates subject fully (31964: 6,453 SF / 12 chairs / 2022 / exp 2038-08-05 / bumps "10% / 5 yrs" / cap 6.75%), `excluded_subject=1`, 166 national ranked comps. **Residual:** resolution is phrasing-dependent (place-fallback → near-empty) + nested `fields.cap_rate` still 6.00% → **prompt 49**. |

### Live acceptance test findings (2026-08-05)
- `synthesize_comps("Appraisal comps for … 1050 Old Camp Rd …")` → **correct**: subject hydrated (`resolved_from_record:true`, cap 0.0675), `excluded_subject:1`, 166 of 215 national ranked. 47's engine logic works.
- `generate_comps` (fuller/appraisal wording) → **500 conformance**: `shared column widths differ … [('PATIENTS', 10.0, 13.0)]`.
- `generate_comps` (non-appraisal wording) → subject resolved as **place** (`_cap_default:true`, "Not on file"), collapsed to 0 sold / 1 on-market (the subject's own listing).

### Root cause — conformance 500 (→ prompt 48), REPRODUCED end-to-end
`_autofit_no_wrap` sets ONE shared width per header across On Market/Sold **before** save (correct — repro: PATIENTS 10.0/10.0, passes). Then the export path runs LibreOffice `calculateAll()`+`store()` (`recalc_runner.py`), and **LibreOffice re-optimizes column widths on store even with `customWidth="1"`** — a shared column populated on one sheet but blank on the other desyncs (PATIENTS: On Market blank→10.0, Sold has counts→13.0). The conformance gate runs AFTER recalc, so it sees the desync. Verified by running the real recalc macro locally: Sold PATIENTS 10.0→13.0 post-store. Fix = re-apply the shared-width contract as the LAST write before validation, preserving cached values (surgical `<cols>` rewrite).

### Root cause — subject place-fallback (→ prompt 49)
When the street address isn't extracted from the request text, resolution falls to the metro ("The Villages"), so hydration/exclusion never fire and scope collapses to the subject's own metro. Fix = extract the street address and resolve to property FIRST (same path `get_property_context` uses), keep national scope on resolve, and propagate the hydrated cap into `subject.fields` (nested `fields.cap_rate` still shows 6.00%).

### Deferred decision for Scott
Appraisal-mode cap filtering: the working 166-comp set includes caps ABOVE the subject's 6.75%. The standing appraisal rule is never to show a higher cap / lower value than the subject. Whether appraisal mode should *withhold* higher-cap comps (vs. show the full market) is a deliberate scope change — noted in prompt 49's tail, not encoded unilaterally.


## Reconcile 2026-08-05 (prompts 48–53 — merged, live) — COMPS ARC COMPLETE
Full comps pipeline (36–53) is now merged and **live end-to-end via the connector**. `generate_comps` verified
2026-08-05: `status: success`, real download, 25 sold + 20 on-market, **no conformance 500**, subject resolved
(property_id 31964, 6,453 SF, 12 chairs, cap 6.75% at top-level AND `fields`, `_hydrated: true`), all operators,
national ranking (25 of 146 sold; on-market 171 curated to 20). Hand-building is retired — the connector produces it.
Canon → **v1.4.0** (appraisal cap discipline + selection policy block; 0 drift, re-rendered to all 5 surfaces).

| # | Outcome | State |
|---|---------|-------|
| 48 | Shared-width contract re-applied AFTER LibreOffice recalc (`comps_width_postpass.py`, surgical `<cols>` rewrite, cached values preserved) | ✅ merged **PR #1570** (`1ba82cb`), live. PATIENTS 10↔13 desync gone; conformance passes. |
| 49 | Address-first, phrasing-independent subject resolution + hydrated cap in `subject.fields` | ✅ merged **PR #1571** (`804c3fb`), live. Resolves on every phrasing; cap 6.75% top+fields. (Cosmetic residual: `subject.kind` still reads "place" — all functional signals correct.) |
| 50 | Propagate closed sales `available_listings` → master comp workbook | ✅ **dia migration applied live** (`dia_propagate_closed_sales_to_workbook`, PR #7360). Workbook 18-mo sold **145 → 284 (+139 distinct)**. Woodland Hills now a comp ($15.73M/6.00%/12.1yr/DOM 46). Reversible (batch `p50_apply_20260805`). **Correction:** sold from `sales_transactions` (Woodland Hills already live there, sale_id 14832); the real gap was the staged workbook. "274" = 139 distinct after listing-dup collapse. |
| 51 | Consolidate same-address duplicate property records (review-lane, reversible) | ✅ **dia migration applied live** (detector + soft-merge + reversal + review lane, PR #7361). Consolidated **Snellville** (45519→44179), **9341 East 21 St** (37547→37594, Wichita KS), **5715 N Venoy** (26506→35566). Reversible via `dia_reverse_property_consolidation`. |
| 52 | Engine: operator=similarity anchor (not filter), drop bare dupes, rank on displayed cap | ✅ merged **PR #1578** (`c66f2305`), live. Mixed-operator appraisal sets; bare dups excluded; cap = rent/price. |
| 53 | Confirm/land 48 & 49 | ✅ Confirmed 48/49 already on main (PR #1570/#1571); earlier "not on main" was a shallow-clone artifact. Live acceptance test PASSED both phrasings. No redeploy needed. |

### Needs Scott (open items, non-blocking)
- **269 E Caroline St** consolidation is parked in `dia_property_consolidation_review` (2 rows): decide whether 35820 "Bldg C" (15,860 SF) is a distinct building and which building the 37379 clinic suite occupies.
- **Prompt-50 review lane** (57 rows): 27 cap-disagreements (>25 bps stored-vs-rent/price), 29 out-of-band caps, 1 ambiguous multi-blank — work when convenient.
- Cosmetic: `subject.kind` still labels "place" though the property is fully resolved — cheap polish if wanted.
- Still outstanding from earlier: rotate `LCC_API_KEY`; Census key (prompt 19 parked).


## Reconcile 2026-08-06 (prompts 54 & 55 — merged, live) + queue 56 + canon re-render

**54 & 55 landed and moved to `done/`.** Re-ran `generate_comps` for The Villages and — per prompt 54's
"confirm against the sheet" — **downloaded and inspected the actual workbook**, not just the JSON.

| # | Outcome | State |
|---|---------|-------|
| 54 | Cap band as HARD filter on displayed rows + reliability-or-exclude + sold on-market-date join | ✅ **merged (PR #1582), live.** Verified in the downloaded sheet: every cap ≤7.10% (Sold 5.21–7.08%, On Market 5.25–7.01%), RENT/SF all 13.8–55.0 (none <12/>60), tenants canonical (DaVita / Fresenius Medical Care / US Renal Care / American Renal), DOM all plausible (no <0/>1000). **Scope narrowed by the response** — 3 original items still open → **prompt 56**. |
| 55 | Chairs/patients propagation hardening + listing price-history ingestion (dia DB) | ✅ **migrations applied live** (dia `zqzrriwuavgrquhisnoa`, PR #7362). Chairs recovered on 145 workbook rows (Swamy Dr→13, MLK→canonical 35120→10); `listing_price_history` 1→175 rows; active price-change 33→45. Genuine gaps stay "Not on file" (7 chairs blanks in the live sheet are the real data-acquisition backlog). Reversible + backups. |

### Live acceptance test (2026-08-06) — connector produces an appraiser-clean workbook
`generate_comps` for "1050 Old Camp Rd": `status: success`, 23 sold + 14 on-market, no 500. Subject fully
hydrated — cap **6.75% at top-level AND `fields.cap_rate`** (prompt-49 fix holding), chairs 12, bumps "10% / 5 yrs",
`resolved_from_record: true`. Sold median 6.74% / weighted-avg 6.71%, both **below** the 6.75% subject; cap max
7.08% within the +35bps ceiling. Delivered the downloaded workbook to Scott. (Cosmetic: `subject.kind` still
labels "place" though fully resolved — unchanged since 49/53.)

### CANON drift FIXED (recurring pattern)
Prompt 54 bumped `CANON_VERSION` 1.4.0→**1.4.1** and edited the `comps` block but did **not** re-render — parity
showed **11 drift** (all 5 surface bundles stale + missing the updated comps block + stale live managed region).
Re-ran `render-surfaces.mjs --root=docs/os --write-live` → 5 bundles regenerated + Copilot live region rewritten →
**0 drift**. (External surfaces — chatgpt/northmarq/claude skills — still need the SURFACE-SYNC paste, per usual.)

### Residual from 54's original scope → prompt 56 (queued in `prompts/`)
The 54 response narrowed the 7-item prompt to cap-band/reliability/on-market-date and dropped three items that are
verifiably still open in the shipped sheet:
1. **On Market STATUS blank** on every row (should default "Available").
2. **BUMPS not fully normalized** — Sold shows bare `1.75`, `10% every 5`, `5% after 5 years`; blanks left empty (should be "Flat"); On Market has `Fixed` (should unify to "Flat"). Same bumps issue Scott has flagged repeatedly.
3. **`summary` cap range (6.41–7.08%) ≠ the sheet** (Sold displays down to 5.21%) — stat set and shipped rows must match.
Prompt 56 addresses all three; keeps 52/54 intact.

### Still open (non-blocking, carried forward)
- Prompt-50 review lane (57 rows) and 269 E Caroline St consolidation (2 rows) — data review when convenient.
- "Always-include-our-deals" rule (Woodland Hills at 21,080 SF doesn't rank into a 6,453-SF subject's top-25) — separate opt-in if wanted.
- Rotate `LCC_API_KEY`; Census key (prompt 19 parked).


## Reconcile 2026-08-06 (prompt 56 — merged, live) + queue 57

**56 landed and moved to `done/`.** Re-ran `generate_comps` for The Villages and **downloaded + inspected the sheet**.

| # | Outcome | State |
|---|---------|-------|
| 56 | STATUS default "Available" + full BUMPS normalization + summary-matches-sheet | ✅ **merged (PR #1585), live & verified in the sheet.** On Market STATUS = "Available" on all 14 rows; BUMPS both tabs normalized ("Flat", "10% / 5 yrs", "2% / yr", "12.5% / 5 yrs", "CPI annually" — no bare decimals / "10% every 5" / blanks); summary now reads "displayed sold set (n=22), 5.21%–7.08%" matching the sheet. |

### Live verify (2026-08-06, post-56) — 3 items FIXED, 4 residuals found
Scott's report (status empty, bumps errors) was from the **pre-56 file** — those are now fixed in the live sheet.
Downloaded-sheet inspection surfaced four genuine residuals, none previously scoped → **prompt 57**:
1. **OPTIONS not normalized** (both tabs) — `(3) 5-yr`, `3`, `Two (2) Five (5) Year`, `three five-year options`, `One, Five-Year Period`, `Two (2), Five (5) Year` all coexist. BUMPS got a normalizer in 56; OPTIONS never did.
2. **Lease-term discipline** — Sold ships comps with **no lease expiration** (2520 B F Terry Blvd, 582 Pole Line Rd, 2500 Commercial Dr) and **<3 yr at close** (320 Gideon Creek Way 0.24 yr, 6020 Enterprise Pkwy 1.72 yr, 311 140th St 2.84 yr). TERM math is correct (term-at-sale, verified: 614 S Cannon 9.96 yr from its 2025 sale) — it's a **selection** gap: no-term / short-term comps ranking into a 12-yr-subject appraisal set. Scott's "wrong lease at sale" = stale lease predating the sale where the property re-leased at close.
3. **On Market no price** — 1550 Goodman Ave (just-listed, no ask) → no cap → not usable.
4. **On Market no lease details** — 1775 NW 80th Blvd (EXP/TERM blank).

### Prompt 57 — ✅ landed (moved to `done/`)
- **OPTIONS normalizer** (`normalizeRenewalOptions` hardened + new `renewalOptionsForWorkbook`, `mcp/comps-tools.js`): every raw spelling → canonical `(N) M-yr` (`Two (2) Five (5) Year` / `Two (2), Five (5) Year` → `(2) 5-yr`; `three five-year options` → `(3) 5-yr`; `One, Five-Year Period` → `(1) 5-yr`; bare `3` → `(3)` unknown-term, **never assumes 5-yr**; none/blank → `None`). Applied at the workbook-row layer so **Sold and On Market render identically** (parallels BUMPS `bumpsForWorkbook`; fixes the raw `t.raw.renewal_options` fallback that bypassed the old normalizer).
- **Lease-term + price discipline** (`applyLeaseTermPriceDiscipline`, named floor `APPRAISAL_MIN_REMAINING_TERM_YEARS = 3`, tunable via `min_remaining_term_years`): in appraisal mode the DISPLAYED set now excludes comps with **no lease expiration**, **remaining term at close < 3 yr**, or (On Market) **no price**. A lease that expired at/before the sale reads as no-usable-term (`termRemainingAtClose` returns null) → routed to review, never shipped as a sub-year stub, never fabricated. Runs before the cap-band filter so summary/ceiling are computed on the clean set. Excluded comps route to the domain review lane (sold rows land; on-market counted in meta) — never deleted.
- **Auditable counts** surfaced on `generate_comps` result: `excluded_for_review { no_lease_term, short_lease_term, no_price, total, min_remaining_term_years }`.
- Keeps 52/54/56 intact. Tests: new `test/comps-options-lease-term-prompt57.test.mjs` (7) + prompt-54/56 & bounded-output fixtures given real lease terms; **full comps suite 116/116 green**.
- ⏳ **Gate:** Railway redeploy of merged `main` → re-run `generate_comps` for The Villages, download + inspect the sheet (OPTIONS one format both tabs; no no-term / <3-yr / no-price rows; the six named leak rows gone; STATUS/BUMPS/cap-band unchanged).

### Carried forward (non-blocking)
- Prompt-50 review lane (57 rows) + 269 E Caroline St (2 rows); "always-include-our-deals" opt-in; rotate `LCC_API_KEY`; Census key (19 parked). Cosmetic: `subject.kind` still "place" though fully resolved.


## Reconcile 2026-08-06 (prompt 57 — merged, live) + canon re-render (40→0 drift)

**57 landed** (Claude Code moved the prompt to `done/`; PR #1587). Re-ran `generate_comps` for The Villages and
**downloaded + inspected the sheet** — all four residuals fixed. The connector now produces the fully appraiser-clean workbook.

| # | Outcome | State |
|---|---------|-------|
| 57 | OPTIONS normalizer `(N) M-yr` (both tabs) + lease-term discipline (exclude no-term / <3yr-at-close / no-price; route to review) | ✅ **merged (PR #1587), live & sheet-verified.** OPTIONS now only `(N) M-yr` / `(N)` (count, term-unknown, NOT faked to 5-yr) / `None` — all raw spellings ("Two (2) Five (5) Year", "three five-year options", "One, Five-Year Period", bare "3") gone. No row with blank lease expiration; none <3yr; no On Market row without a price; STATUS + bumps still clean. `excluded_for_review: {no_lease_term 5, short_lease_term 4, no_price 1, total 10}`; `APPRAISAL_MIN_REMAINING_TERM_YEARS=3` (named/tunable). 116 comps tests green. |

### Live verify (2026-08-06, post-57) — sheet-level
`generate_comps` → 17 sold + 12 on-market (down from 23/14; 10 comps routed to review lane, auditable). Sold caps 5.29–7.08%, median 6.13%, weighted-avg 6.12% (below the 6.75% subject). Subject fully hydrated (6.75% top+fields, chairs 12, bumps "10% / 5 yrs"). Delivered the verified workbook to Scott AND wrote it directly to `outputs/deals/The_Villages_FL/` via the folder bridge (bypasses the desktop download cache — the earlier "still broken" reports traced to stale cached downloads of look-alike filenames, not the data).

### Comps arc — COMPLETE end-to-end (36–57)
Single plain-language request → connector `generate_comps` → conforming, appraiser-clean dialysis workbook: subject resolved+hydrated+excluded, national 25-best similarity ranking, cap band ≤ subject+35bps (avg below subject), reliability + lease-term + price discipline, canonical tenants/STATUS/BUMPS/OPTIONS, on-market-date/DOM, summary-matches-sheet. Hand-building retired.

### CANON re-render (recurring drift)
Parity showed **40 drift** — every block EXCEPT comps went stale across all 5 surfaces (the 54/56/57 branches forked before the prior re-render and carried older surface bundles back on merge). Re-ran `render-surfaces.mjs --write-live` → **0 drift**. External surfaces (chatgpt/northmarq/claude skills) still need the SURFACE-SYNC paste.

### Carried forward (non-blocking)
- Review lanes: prompt-50 (57 rows) + 269 E Caroline (2) + NEW prompt-57 exclusions (10: no/short-term + no-price) — data-acquisition/verification backlog, all reversible/auditable.
- "Always-include-our-deals" opt-in (Woodland Hills size-rank); rotate `LCC_API_KEY`; Census key (19 parked). Cosmetic: `subject.kind` still "place".


## Connected-tools rollout — kickoff 2026-08-06

Comps arc complete → moving to roll the LCC tools out across all 4 surfaces (Copilot, ChatGPT, Northmarq,
Personal-Claude skills). Kit: `docs/comps-rollout/ROLLOUT-AND-TEST-KIT-2026-08-06.md` (foundation order, smoke-test
baseline, per-surface wire-up + test scripts).

**Foundation (Scott, gates everything):** (1) redeploy BOTH `tranquil-delight` AND the standalone MCP from current
`main` — engine 36–57 was verified only against the standalone MCP; ChatGPT/Copilot/Northmarq reach the engine via
`tranquil-delight`, so if it's behind they'll still show old comps. (2) Rotate `LCC_API_KEY` once, distribute the
new value to each surface as wired. (3) Land prompt 58.

**Connector smoke-test baseline (2026-08-06):** ✅ `generate_comps`, `synthesize_comps`, `get_daily_briefing`,
`get_pipeline_health`, `get_queue_summary` all correct. ❌ **`get_property_context`** returns `not_on_file` for
properties that exist (incl. 31964, which comps still hydrates) — regression; ❌ **`search_entities`** crashes
(`.replace` of undefined). → **prompt 58** queued (fix both; don't roll those two out until merged).

**Ops-health alerts noticed:** owner-reconcile queue depth 2,014 > 1,500; Power Automate HTTP-Switch + RCM AMBER —
separate from comps, triage on request.


## Reconcile 2026-08-06 (prompt 58 — merged, live, verified) — connector baseline now FULLY GREEN

**58 landed** (PR #1589, code-only fix, standalone MCP redeployed). Re-ran the two broken tools live:
- ✅ `get_property_context("1050 Old Camp Rd, The Villages, FL")` → **resolved**, confidence 0.96, property_id 31964, full entity (12 chairs / 18 patients / cap 6.75% / lease + listing 12223 + 15 documents). No more false `not_on_file`.
- ✅ `search_entities("DaVita")` → 10 entity matches, no `.replace` crash.

**Root cause (single, for both):** connector passes the free-text arg under a key the handler didn't read (`query`/`q`/`request`/bare string) → empty ref → false `not_on_file` / `.replace` of undefined. Fix = `firstNonEmptyString()` alias acceptance in both `server.js` handlers; `{status,candidates}` envelope preserved. Code-only (no DB/env change). DIA resolver leg confirmed live (31964 resolved from dia).

**Connector smoke-test baseline is now fully green:** generate_comps, synthesize_comps, get_daily_briefing, get_pipeline_health, get_queue_summary, get_property_context, search_entities all correct → the rollout kit's "Foundation #3" is satisfied; property-context + entity-search can now ride out to the other surfaces.

Note (from the 58 response, unrelated): a pre-existing failure in `test/mcp-comps-http-route.test.mjs` fails on a clean tree too — not caused by 58; flag if we want it triaged.


## Rollout progress 2026-08-06 — Copilot/ChatGPT wiring + prompt 59 (curated GPT spec)

**Canon:** re-rendered to **v1.4.3** (0 drift); comps block compressed to fit Copilot's 20k limit. Fresh paste files
(v1.4.3) delivered: `Copilot_LCC_Deal_Agent_Instructions_v1.4.3.md` (19,567 chars, under 20k) + `ChatGPT_LCC-CANON_Knowledge_v1.4.3.md`.
Stale v1.4.2 paste files retired.

**Copilot Studio:** paste file + wiring steps delivered (MCP `/mcp`, Bearer new key, publish, smoke test). Awaiting Scott's paste + test.

**ChatGPT GPT:** instructions/knowledge pasted; the briefing came back from-memory because the **Action** wasn't wired.
Diagnosed: importing the full `/api/copilot-spec` (46 ops) hits ChatGPT's **30-op cap**; the static `lcc-openapi.yaml` is a
hand-maintained snapshot that had drifted (declared briefing at `/api/ai/daily-briefing` vs live `/api/daily-briefing`).

**Prompt 59 — IMPLEMENTED, PR #1592, awaiting merge+redeploy.** Serves a curated ≤30-op ChatGPT spec live from the routes:
`CHATGPT_CURATED_OPERATIONS` (single source, 15 flat user-facing tools) + `generateChatGptSpec()` served at `GET /api/gpt-spec`
and `/api/copilot-spec?surface=chatgpt` (no-auth GET, Bearer for calls); briefing canonicalized to `/api/daily-briefing`;
static yaml retired to a GENERATED+stamped file (`npm run spec:chatgpt`); anti-drift CI test (every curated op → mounted+Bearer route, ≤30 ops).
`/api/copilot-spec` (full 46) + `/api/copilot-spec-v2` (swagger2, Copilot) unchanged. Code-only → redeploy tranquil-delight + standalone MCP.
**Next:** merge #1592 → redeploy → import ChatGPT Action from `{tranquil-delight}/api/gpt-spec` + Bearer key → verify briefing/comps live.

**Connector baseline (58):** fully green — all 7 tools correct.


## Post-deploy verify 2026-08-07 (61/62 merged + live) + queue 63

Deploy verified: `/version` = `c86cdf01381f` (git-pinned). First post-deploy extraction (03:05Z,
DaVita Chilton WI OM) is **provider-stamped** (`_provider.final_provider=ollama`, qwen2.5:14b) and
the hardened prompt performed: NOI $115,500 / price $1.65M / cap 7.0% (internally exact), tenant/SF/
address filled — vs pre-61's 4% NOI recall. **⚠️ Intake still ran OLLAMA** — if
`OLLAMA_SURFACES=summaries,roles,narrations,next_step` was set, intake should be cloud-primary;
**Scott confirmed 2026-08-07: intake stays on ollama deliberately** — ride the hardened prompt;
the 50-intake re-grade is the decision gate (interim-revert plan superseded by the strong first
post-61 sample).
**Queued: prompt 63** (W8 U2 — duplicate candidate pairs → resolver review pool → entity_match_labels
fuel; reuses U1 shapes; flag `W8_U2_DUP_PAIRS` OFF).

### First live lane verdict 2026-08-07 — "verdict record failed" → prompt 74 queued (one-liner)
Scott worked the first real U1 card; the WORK applied (review row 'applied', soft-retire landed)
but the decision-close step wrote `lcc_decisions.status='resolved'` — invalid per the CHECK
(open/decided/skipped/superseded). Traced to the 62-session "always use 'resolved'" hardening.
**Prompt 74**: fix to 'decided', sweep all three W8 verdict branches for the same literal, repair
the one stranded open decision row, structural guard. **Scott: pause lane-working until 74
deploys** (each verdict would apply but error + strand a decision row).

### ✅✅ WAVE 8 BUILD-OUT COMPLETE — 2026-08-07 (all 4 units LIVE)
Final verification runs both PASSED post-72/73 deploy: **U3 chain evidence FIXED** (scan_errors
empty, deed 83 / activity 12 hits, Cira Square 768 chars / 6 blocks; the 4 no_evidence verdicts
are honest — evidence real but doesn't name developers). **U4 tick fast + crash-proof**
(section_errors [], 46 findings, honest zeros, 18 fix-unit stubs). **Cowork flipped
`W8_U4_FINDINGS_REPORT` → on — Wave 8 is fully operational:** U1 3:40 / U2 3:50 / U3 4:10 nightly,
U4 monthly (1st 05:00). Watch items: U3 chain `intake` source still 0/60 (queries verified live —
plausibly genuine gov coverage gap; per-source counts make it measurable); U4's extraction section
will read low `_provider` stamping until the 30d window rolls past the prompt-61 deploy.
**Standing fix-unit backlog from U4's first doc (Scott to queue at will):** PGRST204 schema drift
(dia 3,702 + gov 3,243, critical), `Unflag Completed Email Tasks` flow (524 fails — flow is
supposedly OFF/retired, may be zombie-logging), dia 23505 dedup collisions (1,837),
`propagateToDomainDbDirect:last_ingested_at` (702), `backfillListingSaleIdForListing` (505).

### Prompt 73 landed — PR #1619, awaiting merge (bundle with #1618 redeploy)
U4 tick hardened per spec: crash-proof JSON envelope (`headersSent`-guarded 500 — no response-less
path), `?narrate=1` retired on GET (`{narrate:'deferred'}` — narration lives ONLY on POST/cron,
2-attempt budget), per-section try/catch → `section_errors` array (failing section degrades POST
health to amber, never silent). 40/40 tests. **Final Wave 8 gate: merge #1618 + #1619 → ONE
redeploy → Scott runs (a) `/api/link-propagation-tick?score=1` (expect scan_errors empty,
deed/activity/intake >0, chain proposals w/ verbatim quotes) + (b) bare
`/api/systemic-findings-tick` (fast computed JSON) → Cowork reviews → flip
`W8_U4_FINDINGS_REPORT` → Wave 8 build-out COMPLETE (4/4 units live).**

### Prompt 72 landed — PR #1618, awaiting merge (bundle with #1611/#1614 redeploy)
All three chain-evidence sources root-caused against live schemas: deed = gov PK is `deed_id`
(dia `id`) → domain-aliased select; activity = columns are `id`/`title`/`body` (no
activity_id/subject); intake = **the recurring dia/gov alias footgun** — `match_domain` stores
long-form `government`/`dialysis`, `eq.gov` matched 0/7,713 → `in.(gov,government)` per the
priority-band srcForms pattern. Each fixed query verified against live DBs (real rows returned).
Schema-pinned regression tests (53 pass). Chain rows re-enter automatically post-deploy
(evidence-hash change). **Gate: merge #1618 (+#1611/#1614 if pending) → redeploy → re-run
`?score=1` — expect scan_errors empty, deed/activity/intake counts >0, chain proposals scored.**

### ✅ W8 U3 LIVE 2026-08-07 (post-71 re-run) + prompt 72 queued + U4 502 under diagnosis
Post-71 `?score=1&n=6`: **different_people arm PASSED** — 5 proposals, all quote_verbatim=true,
real shared-email findings (e.g. Hughes/Lawrence/Austin one inbox) → Cowork flipped
`W8_U3_LINK_PROPAGATION` ON (person_email arm productive; 257-row backlog → distinct labels).
**Chain arm still starved, now DIAGNOSABLY** — the 71 loud-errors exposed wrong column names:
`deed_records.id` and `activity_events.activity_id` don't exist (42703 on every gov candidate) →
**prompt 72** queued (schema-check the two queries + gov intake-match filter). Skip-marked chain
rows re-enter automatically post-fix (evidence-hash changes). **U4 `?narrate=1` 502'd** — Cowork timed all
10 `v_lcc_w8_u4_*` views live: instant (aggregation NOT the bottleneck) → crash/hang in the
handler or the inline narrate call. **Prompt 73 queued:** retire inline narrate (GET = computed
JSON + deterministic doc only; narration moves to the POST/cron path, budget-bounded, single
validator retry), crash-proof JSON envelopes, per-section try/catch with loud `section_errors`.
Gate: merge → redeploy → bare GET → review → flip `W8_U4_FINDINGS_REPORT`.

### Prompts 70 & 71 landed (PRs #1611, #1614) — both migrations LIVE (Cowork-verified), both flags OFF

| # | Outcome | State |
|---|---|---|
| 70 (U4) | Systemic-findings monthly report | ✅ PR #1611. Pure aggregator + figure validator (prose numbers must match computed table), `GET /api/systemic-findings-tick` (`?narrate=1`), migration live (snapshot table, 10 views, flag `W8_U4_FINDINGS_REPORT` off — verified, monthly cron `0 5 1 * *` — verified). **First doc generated from live data: `docs/audits/systemic-findings/2026-08.md` (on the branch) — 46 findings (6 critical/9 high). Top signal: PGRST204 schema-drift writes, dia 3,722 + gov 3,271** ← real systemic defect surfaced on day one; candidate fix-unit. 34 tests. |
| 71 (U3 fix) | Evidence depth + different_people verdict | ✅ PR #1614. Per-source evidence counts + loud scan_errors, NEW `intake` source (join path fixed to `raw_payload->extraction_result` after live schema check; 7,713 rows carry match_property_id), assembly-skip evidence-hash markers, `different_people` first-class (verbatim-quote floor; confirm → `entity_match_labels` distinct seeder `w8_u3_shared_email` + reversible mark — never merge). Constraint migration `20260808120000` applied live (verified: CHECK carries different_people). 50 tests. Honest note: intake snapshots are tenant/address-heavy — chain-gap yield may stay modest; per-source counts now make it measurable. |

**Gate: merge #1611 + #1614 → redeploy → (a) U3: `GET /api/link-propagation-tick?score=1&n=6` —
expect per-source evidence counts populated, different_people proposals with verbatim quotes,
honest no_evidence; (b) U4: `GET /api/systemic-findings-tick` + review the JSON/doc. Cowork flips
`W8_U3_LINK_PROPAGATION` and `W8_U4_FINDINGS_REPORT` on pass.**

### U3 first dry-run REVIEWED 2026-08-07 — safety PASSED, yield FAILED → prompt 71 queued, flag stays OFF
Scott ran `?score=1&n=6` post-#1609: 6 honest no_evidence_found, dropped_not_verbatim 0, zero
fabrication — validator + abstention working. But (1) **evidence assembly starving**: 59/60 chain
candidates skipped no_evidence; the one scored (Cira Square) assembled only 459 chars — sources
unreached (join keys / swallowed 403s / unqueried), needs per-source hit counts; (2)
**different_people findings discarded**: model resolved person-email candidates as "distinct names
share this email" 0.95 but the verdict vocab has no shape for it → dumped into no_evidence
(consumption-doctrine violation). **Prompt 71**: fix assembly reach + per-source counts + honest
genuinely-no-evidence marking (U4 feed), add first-class `different_people` verdict → resolves the
merge candidate + writes `entity_match_labels` distinct (seeder `w8_u3_shared_email` — more W4.4
hard negatives). Flag stays OFF until re-run shows yield.

### Queued 2026-08-07: prompt 70 (W8 U4 — systemic-findings monthly report, final unit)
Deterministic aggregator (ingest/flow failure clusters, provenance drift/conflicts, chain
completeness + U3 drain, precision floors, U1/U2 lane throughput + accept rates, naming-hygiene
backlog, extraction provider mix; monthly snapshot for deltas) + Ollama narrative FROM computed
numbers with a W7.2-style figure validator (every number in prose must match the table). Output:
one monthly doc `docs/audits/systemic-findings/YYYY-MM.md` + fix-unit stubs; NO new lane. Flag
`W8_U4_FINDINGS_REPORT` OFF; monthly cron 1st 05:00 UTC; dry-run tick for pre-flip review.
In `prompts/`, ready to send. U2 flag-on re-run verified stable (identical output to acceptance run).

### Prompt 69 (W8 U3) landed — PR #1609, migration LIVE (Cowork-verified), flag OFF, awaiting merge+redeploy
Full unit per spec: planner (value-gate ordering, bounded evidence assembly, VERBATIM-quote
validator → `w8_u3_dropped_log`, no-evidence short-circuit, evidence-hash resumable markers),
`/api/link-propagation-tick`, `w8_u3_link_review` DC lane, deterministic provenance writer
(verdict CHECK has NO merge shape), reversible apply log. Cowork-verified live: flag off, cron
`10 4 * * *` (staggered after U1/U2), **2 fsp rows for `w8_u3_link_propagation`**, unranked view =
33 (all pre-existing W6.6 baseline — U3 adds 0 drift). Pool grounded: 3,405 chain gaps
(developer_unidentified 1,226 / no_prior_owners 2,179) + 258 person-email candidates. 36 planner
tests; 3 full-suite failures pre-existing; clean-assist guard conflict found+fixed by relocation
(`114a8a2`). **Gate: merge #1609 → redeploy → `GET /api/link-propagation-tick?score=1&n=6`
(every would-propose must carry quote_verbatim=true; no_evidence_found honest) → Cowork flips
`W8_U3_LINK_PROPAGATION`.**

### Queued 2026-08-07: prompt 69 (W8 U3 — connection propagation)
Grounded live first — **premise correction:** `lcc_chain_unresolvable` is EMPTY; U3 targets
`v_ownership_chain_worklist` (3,405 ranked rows, gap types e.g. developer_unidentified) +
`v_lcc_person_email_merge_candidates` (257). Design: value-gated rank order, deterministic
internal-evidence assembly (no web search — websearch proxy PAUSED), Ollama link proposals with
W7.4-style VERBATIM-quote validator (fail ⇒ `w8_u3_dropped_log`), confirm lane → deterministic
provenance writer (`w8_u3_link_propagation` fsp row; unranked view stays 0), flag
`W8_U3_LINK_PROPAGATION` OFF, cron 4:10 UTC staggered after U1/U2 (GaryBuilt serial), ~15/night,
evidence-hash re-score keying. In `prompts/`, ready to send.

### ✅ W8 U2 LIVE 2026-08-07 16:26 UTC — flag flipped after clean second run
Post-68 `?score=1` PASSED: coverage fixed (gov 8,000 w/ resumable cursor, dia 6,967 full/wrapped,
scan_errors []), sample all recognizable near-misses (MAINSTREET/Main Street, NorthStar/North Star,
Invester/Investar, Winbrook/Twinbrook, Andersen/Anderson, Heritage/Meritage), fixtures all behaved:
**NorthStar↔North Star Realty→same_party 0.85**, Winbrook↔Twinbrook→same_party 0.9 (pending human),
Harrison↔Garrison→distinct 0.9 (hard negative), MAINSTREET↔Main Street Group→**needs_human**
(dropped_unsure 0). **Cowork flipped `W8_U2_DUP_PAIRS`→on.** Nightly 3:50 UTC cron scores 25/night
→ proposals into the owner_reconcile DC lane (seeder `w8_u2_ollama_pair`); accepted verdicts →
entity_match_labels → nightly W4.4 retrain. **Watch item:** `abbrev_expansion` pairs = 84% of
generated (504/600) and none were in the scored sample yet — eyeball the first nightly lane batches;
if that class is noisy, tune the abbrev map (human gate + 25/night bounds the risk). Same-address
method 0 everywhere (gov lacks the column; lcc/dia to observe).

### Prompt 68 landed — PR #1607 (`e8252ef`), awaiting merge + redeploy
All three U2 defects root-caused + fixed: (1) distinctive-core similarity — expanded generic-CRE
stoplist + `coreIsPairable` gate (core ≥4 chars, ≥3-char token, never pure initials; initials pair
only via same-address). All verbatim fixtures verified (Invester↔Investar pairs; P&A↔B&W,
Owner↔Downer, T.D.↔I.C.E. never generate; Harrison↔Garrison → hard negative). (2) Coverage —
ROOT CAUSE: gov `true_owners` has no scalar mailing column, dia's is `notice_address_1`; the old
select 400'd at PostgREST and was swallowed to `records:0`. Fixed mapping; scan errors now surface
LOUDLY (`scan_errors`); lcc 60k scan pages a resumable keyset cursor in the batch ledger.
(3) Value logic — three-way `dupPairDisposition`: propose / **needs_human** (high-core-sim unsure →
review lane, never dropped) / drop; rubric typo-variant vs surname guidance. 61 tests green; 3
full-suite failures pre-existing. **Gate: merge #1607 → redeploy → re-run
`/api/dup-pair-tick?score=1` (expect gov/dia non-zero or loud error, near-miss-only sample,
Invester-class proposed) → THEN flip `W8_U2_DUP_PAIRS`.** Note: gov same-address method is
unavailable (no scalar address column) — name-core method only on gov; acceptable, documented.

### U2 first dry-run REVIEWED 2026-08-07 — FAILED (3 flaws) → prompt 68 queued, flag stays OFF
Scott ran `/api/dup-pair-tick?score=1`: (1) **similarity degenerate** — generic CRE vocabulary
dominates char-similarity (`P & A Investments`↔`B & W REALTY INVESTMENT` 0.909, `Owner`↔`Downer &
Associates` 0.833); (2) **coverage broken** — gov+dia true_owners scanned 0 records (silent query
failure, allowlist-footgun class) and lcc truncated at 8,000/60,431; (3) **value inversion** —
junk pairs labeled distinct 0.95 (more easy negatives = the W4.3 corpus disease) while the best
finds dropped as unsure 0.3 (`Invester↔Investar` typo-dupe, `Winbrook↔Twinbrook`). **Prompt 68**:
distinctive-core similarity (legal-form + generic-noun stoplist; initials-only cores unpairable by
name), loud coverage errors + paged resumable scan window, distinct-persists-only-on-true-near-miss,
high-sim unsure → review lane instead of dropped. Verbatim regression fixtures.

### Prompt 63 (W8 U2) landed — PR #1606, migration LIVE (Cowork-verified), flag OFF, awaiting merge+redeploy
Dup-pair proposals → resolver fuel, doctrine held (zero merges structurally tested; LLM writes
nothing). Pure planner `dup-pair-planner.js` (trigram/levenshtein no-shared-block pairs, same-address
diff-name, abbreviation/expansion incl. DVA↔DaVita; prefix+suffix blocking; exclusion joins; cap);
`/api/dup-pair-tick` (GET dry-run/`?score=1`/POST flag-gated); proposals surface through the EXISTING
`owner_reconcile` DC lane as folded seeder `w8_u2_ollama_pair`; accepted verdicts →
`entity_match_labels` (corpus reader verified: no seeder allowlist — W4.4 consumes automatically).
Migration `20260807160000` applied live (Cowork-verified: table present/empty, flag off, cron
`50 3 * * *`). 43 planner tests; full suite 3,060 pass / 3 pre-existing. **Gate: merge #1606 →
redeploy → Scott `GET /api/dup-pair-tick?score=1` → review pair sheet → flip `W8_U2_DUP_PAIRS`.**

### ✅ W8 U1 LIVE 2026-08-07 13:51 UTC — flag flipped after clean fifth run
Post-67 `?score=1` PASSED all acceptance: suspect_distribution false (threshold 0.9, share 0.67),
**WALDSCHMITT→keep 1.0** ("consonant run is part of a real surname" — the model itself, on ollama),
CCMCRHS SPE→keep, garbage/`CO` orphans→dismiss with independent evidence, keeps counted-not-enqueued,
bounded (6 scored/241 remaining). **Cowork flipped `W8_U1_JUNK_PRESCREEN`→on.** Nightly cron
(3:40 UTC) now drains ~25/night into the Decision Center junk-review lane; ~247-row pool ≈10 nights.
Review spot: Decision Center junk lane (backing view `v_junk_entity_review_open`; health
`v_lcc_junk_prescreen_health` incl. scored_total/scored_24h). All writes human-gated + reversible.
**Next: send prompt 63 (U2 duplicate-pair fuel).** Naming-hygiene backlog (~6.5k: lcc 5,091 /
gov 973 / dia 395) counted, unenqueued — future rename/normalize unit.

### Prompt 67 landed — PR #1604, awaiting merge + redeploy → THEN flag flip
Distribution guard recalibrated: default 0.5→0.9, env `JUNK_DISMISS_GUARD_THRESHOLD` (validated
(0,1]) threaded through both call sites — 5/6 dismiss on the pre-filtered pool no longer suspect;
all-dismiss pathology (>90%) still refusable. Surname guard: `consonantRunSurnameLike` morphology
(sch/…dt$/…tt$/wicz/ski + personal/partnership name shapes) + `hasSecondJunkSignal`; surname-like
candidates route to the LLM with a WALDSCHMITT rubric line AND a post-LLM `surname_gate` veto
(dismiss→keep) — belt and braces. `CLOVER/WALDSCHMITT, L.L.C.` is a regression fixture. 86 tests
green. **Gate: merge #1604 → redeploy → `?score=1&n=6` (expect no suspect_distribution,
WALDSCHMITT-class keep-or-absent, garbage still dismiss) → Cowork flips `W8_U1_JUNK_PRESCREEN`.**

### 66 fourth run 2026-08-07 — bounded scoring WORKS on ollama, rubric proven; 2 residuals → prompt 67
`?score=1` returned clean in-budget (6 scored/241 remaining, qwen2.5:14b). Rubric holding live:
`CCMCRHS 850 CANAL LLC`→keep (SPE reasoning), OCR garbage + zero-connection `CO` stubs→dismiss with
evidence beyond the heuristic. Residuals: (1) **distribution guard miscalibrated for the tightened
pool** — 83% dismiss on pre-filtered true junk is CORRECT but >0.5 → every POST would be refused;
(2) surname false positive (`CLOVER/WALDSCHMITT, L.L.C.`→dismiss 1.0 — consonant_run inside a
German surname). **Prompt 67**: `JUNK_DISMISS_GUARD_THRESHOLD` env (default 0.9) + deterministic
surname guard + WALDSCHMITT regression fixture. Then flag flip.

### Prompt 66 landed — PR #1603, migration LIVE (Cowork-verified), awaiting merge + redeploy
Bounded/resumable scoring per spec: inline `?score=1` takes `&n=` (default 20→6) + wall-clock
budget `JUNK_SCORE_BUDGET_MS` (120s); POST apply scores ≤`JUNK_SCORE_BATCH_SIZE` (25)/invocation —
247 candidates drain over ~10 nights; new `junk_prescreen_scored` ledger keyed
(domain,table,pk,name_hash) = resume cursor + no re-scoring unless renamed (suspect-distribution
refusals deliberately NOT marked scored); honest counts (`scored`/`remaining_unscored`/
`budget_exhausted`/`excluded_scored`); health view + scored_total/scored_24h. Migration
`20260807140000` applied live to LCC Opps (verified: table present, 0 rows). 76+ tests green.
**Gate: merge #1603 → redeploy → `?score=1&n=6` → if sample clean, flip `W8_U1_JUNK_PRESCREEN`.**

### 65 third run 2026-08-07 — SCOPE FIXED (247 candidates ✅), but `?score=1` 502s → prompt 66 queued
Post-65 deploy (`6bb9c1aaa57a`): bare scan returns fast — **247 true-junk candidates**,
naming_hygiene_backlog counted, connection exclusion live. `?score=1` 502s at the Railway proxy:
with `OLLAMA_SURFACES` unset, clean_assist scores on GaryBuilt (~16s/call) → 20 inline calls ≈320s
> proxy timeout (earlier runs survived on gpt-4o-mini). Same math would break the nightly apply
(247×16s ≈ 66 min). **Prompt 66**: inline scoring time-budget + `&n=` cap (default 6), resumable
`JUNK_SCORE_BATCH_SIZE` batches on the cron path with a scored-marker dedupe, honest
remaining/budget counts. Flag stays OFF until 66 + a clean scored sample.

### Prompt 65 landed — branch `claude/w8-u1-true-junk-scope-i9v78v`, awaiting merge + redeploy
Scope tighten implemented per spec: `classifyName()` splits junk vs naming_hygiene vs null;
abbrev/address classes dropped from candidacy (counted-only `naming_hygiene_backlog` per domain);
scan-time batch connection exclusion (`excluded_connected`) with the per-row FK probe kept as the
apply-path safety net; `isEnqueueableJunkVerdict()` — only dismiss/rename/parse_contact persist,
keeps counted `kept_not_enqueued` and dropped (both GET dry-run and POST apply). 60/60 dedicated
tests green (verbatim 64 fixtures reused). Acceptance is live-runtime: **gate = merge → redeploy →
Scott's third `?score=1`** (expect: pool back to few-hundred true-junk, sample dominated by
`--`/`Test Test`/gibberish with surviving dismiss verdicts, ~6k backlog counted-not-enqueued,
distribution guard active) → THEN flip `W8_U1_JUNK_PRESCREEN`.

### 64 re-run REVIEWED 2026-08-07 — guards work, but scope overshoot → prompt 65 queued, flag stays OFF
Second `?score=1` (post-64 deploy): 0% dismiss, SPEs excluded, connection gate + distribution guard
live — the 64 fixes all held. New flaws: **pool exploded 649→6,946** (the new `known_abbreviation`
+ `address_as_name` classes flag thousands of REAL entities — address-named property-anchor
entities with 6–88 relationships, "Cohen Cos"-style names = naming-hygiene backlog, not junk), and
**all 20 scored rows were connection-gated keeps persisted as proposals** (keep = non-event, would
flood the lane). **Prompt 65**: restrict candidacy to true-junk classes (all_non_alpha/token_junk/
gibberish/zero-connection too_short), drop abbrev+address classes to a counted-only
`naming_hygiene_backlog` metric (future separate unit), move the connection check to scan time
(batch exclusion), never persist keeps. Flag stays OFF until 65 + a clean third run.

### Prompt 64 landed — PR #1600 (`c9a7584`), awaiting merge + redeploy
Precision fix implemented per spec: deterministic SPE-pattern guard (code-token LLCs never reach the
model), abbreviation dictionary → rename preVerdict, address-as-name → parse_contact, acronym
marker + connection gate (FK-referenced ⇒ keep, probed BEFORE spending the LLM call), softening-only
post-LLM guards, judge-don't-parrot rubric with the live failures as few-shot fixtures, and the
>50%-dismiss distribution guard (blocks POST apply). 52/52 dedicated tests green; only
junk-prescreen.test.mjs exercises the touched code; full-suite 3 failures pre-existing (suite also
OOM-SIGKILLs at ~2,985 tests on the runner — noted, unrelated). **Gate: merge #1600 → redeploy →
Scott re-runs `?score=1`** (expect: SPE/acronym/Brookfield keep-or-absent, Prtnrs→rename,
addresses→parse_contact, `--`/`Test Test` dismiss, dismiss share well under 50%) → THEN flip
`W8_U1_JUNK_PRESCREEN`.

### U1 first dry-run REVIEWED 2026-08-07 — FAILED precision review → prompt 64 queued, flag stays OFF
Scott ran `?score=1`: 649 candidates (lcc 278/dia 268/gov 103), 20 scored, **18/20 dismiss — many
false positives**: ARC/ARHC SPE-code LLCs (`ARC3 GSCRGCO001, LLC` etc. — real net-lease SPEs),
`SMBC` (Sumitomo Mitsui), `Brookfield Prop Prtnrs…` proposed dismiss; LLM reasons parrot the
heuristic (no independent judgment); address-as-name rows dismissed instead of rename/link.
True junk (`--`, `Test Test`) correctly caught. **Prompt 64** adds deterministic SPE/abbreviation/
relationship-gate guards, a judge-don't-parrot rubric with the failures as few-shot fixtures, and a
>50%-dismiss distribution guard that blocks apply. **Do NOT flip `W8_U1_JUNK_PRESCREEN` until 64
lands + a clean re-run.**
**Env finding from the same run:** scoring attributed `gpt-4o-mini` → `OLLAMA_SURFACES` is active
and excludes `clean_assist` (and `intake`) — contradicts Scott's keep-intake-on-ollama decision.
**Scott: unset `OLLAMA_SURFACES`** (all-local default) or set it to include `intake,clean_assist`.

## Reconcile 2026-08-06 (prompts 61 & 62 — landed as PRs, awaiting merge + redeploy)

| # | Outcome | State |
|---|---|---|
| 61 | Ollama extraction hardening + seam fixes | ✅ code landed — **PR #1598** (`db4fc3f`). New `intake-extraction-prompt.js` (strict full-key schema, doc-type rubric incl. psa/listing_agreement/valuation_proposal, party-role + sale-record guards, abstain preserved); Ollama native JSON (`OLLAMA_JSON_FORMAT`, default on); snapshot `_provider` stamp; **per-surface gating** `invokeExtractionAI({surface})` + `OLLAMA_SURFACES` env; loud misconfig warn; promoter guard (PSA never rescued to om). **Edge-400 ROOT-CAUSED:** ai-copilot `/chat` edge caps `max_tokens=1500` + injects a sales system prompt — `AI_EXTRACTION_PRIMARY=openai` routes extraction off it (no deploy needed for the JS side). **Bypass finding: extraction runs ONLY in `server.js` (tranquil-delight)** — the 17/50 edge-first artifacts came from a server.js instance missing `OLLAMA_*` env. 18 new tests; 3 full-suite failures pre-existing. ⏳ merge + redeploy gates it. |
| 62 | W8 U1 junk-entity pre-screen | ✅ code landed — **PR #1599**; **migration `20260807120000` APPLIED LIVE to LCC Opps + Cowork-verified 2026-08-06** (flag `W8_U1_JUNK_PRESCREEN` off, `junk_entity_review`/`junk_review_batch` empty, cron `40 3 * * *` no-oping, both views present). Extends prompt-32 clean-assist (no parallel agent). Pure planner `junk-prescreen.js` (deterministic candidate filter, FK guard — live-schema-validated incl. `entity_relationships.from/to_entity_id` fix), `/api/junk-prescreen-tick` (GET dry-run / `?score=1` sample / POST flag-gated apply), DC federated lane + verdict branch, reversible soft-retire. Live scope: candidate pool small (ops ~194 / dia 19 / gov 8). 28 tests. Prompt moved to done/ in the PR. |

### Needs Scott (this batch)
- **Merge PR #1598 + #1599 → redeploy tranquil-delight + standalone MCP.**
- **Set the approved interim revert** (post-61 deploy): `OLLAMA_SURFACES=summaries,roles,narrations,next_step` on tranquil-delight → intake goes cloud-primary, narrative stays local. Optionally `AI_EXTRACTION_PRIMARY=openai` to skip the broken edge hop.
- **Confirm `OLLAMA_URL`/`OLLAMA_MODEL`/`CF_ACCESS_*` on every service running `server.js`** — the new warn names the offender in logs.
- Optional: redeploy `ai-copilot` edge fn (Dialysis project) for `AI_COPILOT_MAX_TOKENS`.
- **U1 first run** (post-deploy): `GET /api/junk-prescreen-tick?score=1` → review the proposal sheet → flip `W8_U1_JUNK_PRESCREEN` on. Then Cowork queues U2 (duplicate proposals → resolver fuel).
- **W5.3 re-grade** after ~50 fresh intakes post-redeploy (acceptance queries in the W5_3 report).

## W5.3 CLOSED + W8 hygiene campaign kicked off — 2026-08-06 (Cowork)

Per `docs/audits/W53_AND_OLLAMA_HYGIENE_KICKOFF.md`. **Wave 5 closes** — verdict in ROLLOUT_STATUS
W5.3 row + full report `docs/audits/W5_3_LOCAL_LLM_EVALUATION_2026-08-06.md`. Headline: KEEP
ollama-primary on narrative surfaces (W7.2/7.4/7.5 — no fabrication, validator working); intake OM
extraction has a material recall/schema gap (NOI 4% vs cloud 93%) → TUNE + interim revert
recommended; seam gaps found (17/50 artifacts bypass ollama — a process lacks OLLAMA_URL; snapshot
has no provider stamp; feedback corpus unusable for grading — one bulk Jul-27 batch).

**Queued:** prompt **61** (extraction hardening + provider stamp + env audit + edge-400 triage),
prompt **62** (W8 U1 junk-entity pre-screen — extends prompt-32 `OLLAMA_CLEAN_ASSIST` machinery,
junk_review lane, flag `W8_U1_JUNK_PRESCREEN` OFF, nightly cron). U2–U4 sequenced after U1 lands.
Housekeeping: stale reconciled response docx (36–40) moved responses/ → done/.

### Needs Scott (this batch)
- **Interim revert APPROVED by Scott (2026-08-06): revert intake extraction to cloud NOW.** On the
  Railway service(s) running the intake extractor: unset/blank `OLLAMA_URL` (or set
  `AI_EXTRACTION_PROVIDER` back to cloud) + flip `feature_flags_registry.OLLAMA_EXTRACTION` off.
  Narrative surfaces (W7.2/7.4/7.5, next-step) KEEP ollama — they route through the same seam, so
  the flip must be the intake-surface flag, not a global OLLAMA_URL removal, if both share a service
  (verify in prompt 61's env audit; if they share, prefer flag-level gating). Re-cutover after 61.
- Send prompts 61 + 62 to Claude Code (in `prompts/`).

## ChatGPT surface — COMPLETE 2026-08-06 ✅

`getQueueSummary` (and the other Actions) now return live data in the published GPT (verified: 1,148 queue items,
priority bands, real government ownership-resolution top items). Prompts 59 (curated `/api/gpt-spec` endpoint) + 60
(OpenAPI 3.1.0 + `components.schemas`) merged, live, and imported clean.

**What it took to get ChatGPT calling the Actions (record for the other surfaces):**
1. **Curated ≤30-op spec** served live at `/api/gpt-spec` (59) — the full 46-op `/api/copilot-spec` trips ChatGPT's 30-op cap.
2. **OpenAPI 3.1.0 + `components.schemas: {}`** (60) — ChatGPT's importer rejects 3.0.3 and a missing schemas object.
3. **Capabilities OFF: Web Search AND Code Interpreter** — with them on, the GPT answered data questions by web-searching ("queue" → Minecraft/AWS docs) or reading the canon knowledge file via Code Interpreter, instead of calling the Action.
4. **Persona referencing the REAL operationIds** — the old `gpt-actions-system-prompt.txt` told the model to call `get_daily_briefing_snapshot` / `search_entity_targets` (Copilot dispatch names that DON'T exist in the curated spec), so it never found the tool. Rewrote it to `getDailyBriefing` / `getQueueSummary` / `getPipelineHealth` / `synthesizeComps` / `getPropertyContext` / … + a hard "Actions-for-data, knowledge-file-is-rules-only, never web-search/fabricate" rule (committed `4aab2618`).

Auth = API Key / Bearer / raw `LCC_API_KEY` (no "Bearer " prefix — ChatGPT adds it). Privacy policy URL set. Import via URL (`/api/gpt-spec`), not a pasted file.

**Rollout status:** Personal-Claude connector ✅ (baseline green). ChatGPT ✅. **Copilot** — paste file + wiring steps delivered, awaiting Scott's paste + smoke test. **Northmarq** — prompt-diff + admin-connector still to do. **Personal-Claude skills** — v1.4.3 comps sync still to do.
