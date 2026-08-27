# LCC — CURRENT STATE (the one-page answer to "where are we?")

> **Read this first, then `PLANNED-BACKLOG.md`.** This file answers, in one place: what is **LIVE**,
> what is **flag-gated OFF and why**, what is **PLANNED**, and **where each subsystem's canonical doc
> lives**. It carries no rules — rules live in `canon/` (see §6). It carries no history — history is
> archived (see §8).
>
> **Measured 2026-08-26** against the live LCC Opps registry/tables (queries noted inline). Anything
> not marked *measured* is doc-sourced and inherits that doc's date.
>
> ⚠️ **Standing doctrine that governs this file:** *a dated blocker is a hypothesis to re-test, never
> an input to a recommendation* (`CLAUDE.md` → Core doctrines). Consolidating these docs surfaced
> **four** stale claims that measurement overturned — they are listed in §7. Expect more. Re-measure
> before you quote, and **fix the note in the same change**.

---

## 1. Runtime truth — where the app actually runs

| Thing | Truth | Canonical doc |
|---|---|---|
| **Production web app** | **Railway** — `server.js` mounts every `/api/*` handler directly. **Vercel was retired 2026-07-20**; `vercel.json` is deleted; there is **no serverless-function cap**. | `CLAUDE.md` §"PRODUCTION RUNS ON RAILWAY" |
| **`/api/*` routing** | `server.js` is the **single source of truth**. Sub-routes via `?_route=`. Every new route must be mounted there (guarded by `test/operations-subroutes.test.mjs`). | `.github/AI_INSTRUCTIONS.md` |
| **Deploy gate** | `npm run verify:deploy` — compares live `/version` to the merge SHA **and** probes that critical routes return JSON (not the SPA HTML) **and** that every local `<script src>` actually ships. `--wait[=sec]` for the push→verify loop. | `CLAUDE.md` |
| **⛔ Merging to `main`** | **`main` is protected — you cannot push to it.** Branch → PR → both checks green → merge. *"npm test"* became a **required status check** on 2026-08-27, so a direct push is rejected by the rule engine and retrying never works. ⚠️ **`main` is currently BLOCKED** — the required check has never been green (Node-20 pin); a one-file workflow fix must land first. | **`docs/os/GITHUB-WORKFLOW.md`** |
| **Where documents go** | Root of the repo is code + config; **no new `.md` there.** Five files carry state: CURRENT-STATE · PLANNED-BACKLOG · STATUS · CLAUDE.md · GITHUB-WORKFLOW. | **`docs/os/DOCUMENTATION-MAP.md`** |
| **⚠️ CI gate (or the lack of one)** | **No workflow runs `npm test` on a PR.** `boot-check.yml` is the only PR check; it runs `npm run check:boot` (a `node --check` sweep + a `server.js` import). The 4,551-test suite **never executes in CI** — which is how #1786 merged green with a red suite. Every `test/*.test.mjs` tripwire this repo documents is a **local** regression detector, not a merge gate. Fix scoped, not built (Scott's call) → backlog **N9**. | `CLAUDE.md` footgun; Prompt 139 |
| **Two Railway services** | `tranquil-delight-…` = root web app + `/mcp` + OAuth + the 9 bounded read/comps routes (what ChatGPT and Copilot Studio use). A **separate standalone MCP service** (`mcp/server.js`) is what the personal-Claude / Cowork `mcp__lcc__*` tools talk to. `pacific-love-…` = BOV Generator. **A deploy of engine changes = redeploy BOTH.** | `AI-SURFACES-OPERATIONAL-REFERENCE.md` §2 |
| **Databases (3)** | **LCC Opps** `xengecqvemvfknjvbvrq` (the brain + auth/GoTrue + most crons) · **Dialysis_DB** `zqzrriwuavgrquhisnoa` (dia domain; **hosts `data-query` + `daily-briefing` edge fns**) · **Government** `scknotsqkcheojiaewwh` (gov domain). | `CLAUDE.md` §"Database topology" |
| **Supabase views/migrations** | **Live immediately** — the CM export reads views per request (`no-store`), so data-layer fixes need no deploy. **DB migration first, JS second** — except a `CHECK` that enforces new writer output, which goes *after* the writer deploy. | `CLAUDE.md` §"Deploy ordering" |
| **Front end** | **No bundler.** `index.html` loads classic `<script src>` tags sharing ONE global scope. **Load order is the entire dependency mechanism.** Never `type="module"` for a split region; cache-busters move as a SET. | `docs/architecture/w6-5-frontend-decomposition-map.md` |
| **Client routing** | Hash routing (`#/<slug>[?d=<detail-token>]`) — no catch-all rewrite needed. No PII in the URL. | `CLAUDE.md` §"Client routing" |
| **Auth** | `LCC_API_KEY` is production-ready but **not enforced**. Enforcing = set `LCC_API_KEY` **then** `LCC_ENV=production`, in that order. Flipping `LCC_ENV` first = total sign-in lockout. Verify with `GET /api/diag?kind=auth-ready`. | `docs/AUTH_ENFORCEMENT_ROLLOUT.md` |

## 2. What is LIVE (subsystem → canonical doc)

Grouped by the thing it does, not by the wave that built it.

### Deal-intelligence spine — LIVE end to end
SF Opportunity sync → `bd_opportunities` (592 deals) → Team-Briggs scope (roster edges) → deal-email
matcher → cadence-scan → weekly pipeline email; deal dossier + link-only Salesforce write-back.
→ `docs/os/BUILD-STATUS.md` (BUILD 01–05), `docs/architecture/SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md`

### Ingestion & intake
Three OM channels converge on `intake-om-pipeline.js::stageOmIntake` (email PA flow · CoStar sidebar ·
Copilot Studio). ⚠️ **They converge on the pipeline but NOT on the hardened prompt — measured
2026-08-26, the sidebar channel has produced 0 hardened-schema extractions out of 350 in 30 days
while being the largest producer (56% of rows). `staged_intake_extractions` is therefore not one
population: split by channel before grading it, or you are measuring the channel mix.** →
`docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`, backlog N8/L8/V6.
Multi-model AI fallback on extraction. Tiered OCR — digital `pdf-parse` → free OSS →
**Google Document AI** (`docai-ocr`, LIVE + verified 2026-08-12) → gpt-4o vision last resort. Office
docs (docx/xlsx) never go to OCR (byte-sniffed, extracted in-process).
→ `docs/architecture/om_intake_pipeline.md`, `docs/architecture/document-capture-and-ocr-status.md`

### BD spine, ownership & provenance
`entities` + `external_identities` + `lcc_property_owner*` + the priority queue / Decision Center;
field-level provenance (`field_provenance`, `field_source_priority`, `lcc_merge_field`); the
Ownership Resolution Engine; supersession tiers; the gov ownership-transition feeder.
→ `CLAUDE.md` §"BD spine", `docs/architecture/property-owner-subsystem.md`,
`government-lease/docs/OWNERSHIP_RESOLUTION_ENGINE.md`

### Comms → context
Outlook/Teams intake → `activity_events` / `email_bodies` → deal attribution → correspondence
summaries, role evolution, next-step derivation, mailbox mirror + move-queue executor.
→ `docs/architecture/correspondence-ingestion-design.md`, `docs/setup/OUTLOOK_MAILBOX_MIRROR_FLOW.md`

### Voice & drafting
Voice profile distilled on-box from Scott's sent corpus; `/api/draft-assist` RAG drafting with the
real branded signature, threading, and deal context; save-to-Outlook-Drafts (save, never send).
→ `BRIGGS-WRITING-VOICE.md`, `docs/audits/W10_VOICE_AND_DRAFTING_KICKOFF.md`

### Capital Markets exports
`cm_*` views → Excel/PDF book export with native charts + brand tokens; KPI tiles read the same view
their data tab renders (`checkKpiSeriesConsistency` is the tripwire).
→ `CLAUDE.md` §"CM export", `public/reports/cm-brand.json`

### Ownership-history lane — the first dead research lane with a working consumer (2026-08-27)
`establish_ownership_history` produced **545 items and consumed none for 69 days**. A1 split it
into four real actions (`v_lcc_ownership_history_lane_split`; badge reads **91 human-actionable**,
not 545); A2 auto-applies the `agrees` bucket. **Completed ever: 0 → 288. Open: 545 → 257. +304
historical ownership facts** (12,724 → 13,028), 280 owners, **$579.9M**. Nightly on **cron 244**
(06:49 UTC), reversible by batch tag. Residue is named, not buried: 48 tasks blocked by duplicate
entities (**A2a**, no new code needed), 28 by a `gsa_lease_diff` flicker (**A2b**).
→ `docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md`, `DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`

### The shared entity-merge path is REVERSIBLE (2026-08-27, P196 / N11)
`lcc_merge_entity` snapshots the whole loser side, **folds `owner_contact_pivot` fill-blanks before
the dedup DELETE**, calls the reconcile with `p_snapshot => true`, and action-labels every P160
dedup/repoint. Reverse with **`lcc_unmerge_entity(loser)`**; ledger `lcc_entity_merge_log`;
instrument `v_lcc_entity_merge_reversibility`. Round-trip proven on live data (16 rows before, 16
after, 0 lost, 0 new; `auto_mergeable` 3,053 → 3,053). ⚠️ **The "dormant" verdict described the
auto-merge LOOP, not the function** — `lcc_merge_entity` has 9 human-verdict call sites and ran
**285 merges in 30 days**. ⚠️ **2,411 pre-P196 tombstones are `reversible=false` and always will
be.** `lcc_apply_fuzzy_merges` is still unwired — that is a separate decision. **A2a is unblocked.**
→ `docs/audits/P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md` §1–6

### Parked Tier 0 cards now say WHY (2026-08-27, P196 / N3e)
**146 parked / 105 owners / $180.3M**, each carrying `park_reason` + both compared strings:
`employer_on_file_differs` 76 (the gate working), `no_employer_on_file` 68,
`employer_not_comparable` 2. Sponsor-shaped parks surface as
`v_lcc_tier0_sponsor_map_proposals` → a curated `lcc_owner_sponsor_domain` INSERT (one decision per
SPE family). ⚠️ The prescribed company-string normalisation was **measured and refuted** (0 of 146),
and a naive sponsor detector reads **~25% precision** — three guards take it to 4 of 6, top-4 by
rent. **The un-park was NOT widened** (ask 77 / auto 9 / parked 146, before and after).
→ same audit, §7–13

### Conflict-marker guard (2026-08-27)
`test/no-conflict-markers.test.mjs` — committed conflict markers had been sitting on `main` in
**two** files, from **two different mechanisms** (a merge, and a `git stash pop`). Git flags
neither: the conflict *was* resolved, by committing the markers. The guard is verified red on the
pre-fix files and **also runs on the docs-only CI path**, because both instances were `docs/*.md`
and the docs-only skip would otherwise have hidden the very population it exists for.
⚠️ **Match marker CHARACTERS, never label text** — stash-pop markers read `Updated upstream` /
`Stashed changes`, not `HEAD` and a sha. → `docs/os/GITHUB-WORKFLOW.md` §2b/§4b

### On-box generation (the newest capability)
The daily brief's **Analyst's Take** generates on the GaryBuilt box. Today's
`briefing_intel_snapshot` carries a 774-char take with `analyst_take_meta.source =
'onprem_ollama'`; every prior day is length 0. First real on-box narrative.
⚠️ **Re-measured the same evening: that take is a ONE-SHOT, not the pipeline running.**
`generated_at` = **20:51 UTC** against a row created at 10:00 and a cron that fires at **10:18** —
so cron 240 did not produce it; it was generated by hand during the P138 session. P138's tick only
became deployable at the **23:13 UTC redeploy**. **Do not read this row as "producing" until a take
appears inside the 10:18 window.** → backlog **V7**; `docs/architecture/briefing-analyst-take-onprem.md`

## 3. Feature-flag state — LIVE registry snapshot, measured 2026-08-26

`select flag, state from feature_flags_registry` on LCC Opps: **30 `on` · 27 `off` · 2 `partial`.**
The registry is the authority; **seed migrations and older docs have drifted from it more than once**
(that miss is what re-ranked the whole local-model audit on 2026-08-24).

**ON (30).** `BRIEFING_ANALYST_TAKE_ONPREM` · `DEAL_COMMS_PROPAGATE_CRON` · `DEAL_EMAIL_MATCH_CRON` ·
`DRAFT_ASSIST` · `MAILBOX_MIRROR` · `MATCH_DISAMBIG_ASSIST` · `MOVE_QUEUE_EXECUTOR` · `NEXT_STEP_AI` ·
`OCR_CLOUD_DOCAI` · `OLLAMA_CLEAN_ASSIST` · `OLLAMA_EXTRACTION` · `ORE_USE_RESOLVER` ·
`OWNERSHIP_CHAIN_DRAFT` · `PROPERTY_TWIN_ASSIST` · `SHAREPOINT_LIST_URL` · `TAGGED_COMM_INTAKE` ·
`W51_PARTY_EXTRACT` · `W74_ROLE_ISSUES` · `W75_ACTION_SUMMARY` · `W8_U1_JUNK_PRESCREEN` ·
`W8_U2_DUP_PAIRS` · `W8_U3_LINK_PROPAGATION` · `W8_U4_FINDINGS_REPORT` · `W8_U5_NAMING_HYGIENE` ·
`W9_1_CONTACT_ACQUISITION` · `W9_2_REACHABILITY_HARVEST` · `W9_3_DONOR_HANDOFF` · `W9_3_RESCORE` ·
`W9_3_SF_ASSIST` · `W9_6_COMMS_OWNER_ATTRIBUTION`

**PARTIAL (2).** `CONTACTS_HUB` (currently pointing at **`ops`** — LCC Opps is the live
`unified_contacts`; the gov copy is a frozen pre-cutover snapshot. ⚠️ `govQuery()` reads whichever
side the flag names, so **confirm the flag before quoting any contact count**) ·
`RESOLVER_RETRAIN_LOOP`.

**OFF (27) — grouped by WHY, because "off" is not one thing.**

| Why it is off | Flags | What it would take |
|---|---|---|
| **External egress / bot-wall** — the handlers are correct and honest-blocked | `W9_1_SOS_DIRECT`, `SOS_STATE_ADAPTERS.FL/CA/TX`, `OWNER_ENRICH_SOS_URL`, `OWNER_ENRICH_ADDRESS_URL`, `OWNER_ENRICH_DEED_URL`, `OPENCORPORATES_API_KEY` | Client fidelity in `sos-proxy/fetcher.js` (per-host cookie jar + browser-grade TLS). **Never a CAPTCHA solver.** TX is *paid*, not blocked. → `government-lease/CLAUDE.md` §25 |
| **Paused by doctrine** | `OWNER_ENRICH_WEBSEARCH_URL` | Nothing — contact acquisition is public-records-only by decision. |
| **Third-party key / URL not provisioned** | `GEOCODIO_API_KEY`, `GOOGLE_MAPS_API_KEY`, `CM_TREASURY_REFRESH_URL`, `SF_LIST_IMPORT_URL`, `SF_LIST_SEED_INSTITUTION` | Provision the key/webhook; the code no-ops honestly meanwhile. |
| **Held pending a dry-run grade** (built, deliberately not flipped) | `OWNERSHIP_CHAIN_ROLE_LABELS` (→ open Prompt 140), `LISTING_PAGE_PROACTIVE_EXTRACT`, `DEED_IMPLIED_PRICE_FILL`, `CADENCE_TEMPLATE_AUTOSELECT`, `CADENCE_OPEN_TRACKING_ACTIVE`, `DECISION_PROVENANCE_LEARN`, `DECISION_OWNER_DEED_WINS`, `DECISION_GOV_WRITEBACK`, `GOV_EVIDENCE_WORKBENCH`, `SF_CONTACT_WRITEBACK`, `TEAMS_COLD_ALERTS_ENABLED` | Pull a dry-run sample, eyeball 10–20 proposals, flip. **Grade before flipping** — `OLLAMA_CLEAN_ASSIST` failed its first grade (6/12 content-free) and needed P134 context enrichment before it passed. |
| **Producer gate, deliberately closed** | `ENABLE_OWNERSHIP_RESEARCH_QUEUE` | A decision, not a defect — it gates 9 gov insert sites. |
| **Operator/tenant step outstanding** | `PA_OUTLOOK_DRAFT_FLOW` (`off_since` 2026-08-21 — ⚠️ the same day the draft seam was proven working end-to-end; **re-measure before acting on either reading**) | Confirm the PA flow + `PA_OUTLOOK_DRAFT_URL` against the tenant. |

> **The generalised check for every ON flag:** `state=on` is not production. **Assert on the write
> delta over the last 7 days**, never on the flag and never on the worker's own tally — a
> re-discovery counter (`already_annotated`, `already_attributed`, `already_drafted`) reads exactly
> like throughput while nothing moves. This has been proven three times (P135, P136, P159a).

## 4. Local-model (GaryBuilt / Ollama) surface state

Doctrine: **private corpora never go to a cloud model.** All traffic flows through
`api/_shared/ai.js` (`invokeExtractionAI` / `invokeOnPremGeneration` fail-closed /
`invokeOnPremEmbeddings`). Master gate `OLLAMA_URL`, per-surface gate `OLLAMA_SURFACES`.
Full map: **`LOCAL-MODEL-LEVERAGE-MAP.md`** · ranked gaps: **`LOCAL-MODEL-GAP-AUDIT.md`** ·
box playbook: `docs/setup/garybuilt-local-model.md`.

**Live uses:** extraction (OM/deed/lease/BOV/owner-name/party) · narrative (dossiers, deal-comm
summaries, action summaries) · drafting (`draft-assist` + `nomic-embed-text`) · voice distillation ·
junk pre-screen · next-step derivation · **on-box brief narrative (new)** · optional chat provider.

### Production-health of the assist lanes — re-measured 2026-08-26

`select source, count(*), count(*) filter (where created_at > now()-interval '7 days')
from lcc_clean_assist_proposals group by source`:

| assist | flag | total | last 7d | last write | verdict |
|---|---|---|---|---|---|
| ownership-chain draft | `OWNERSHIP_CHAIN_DRAFT` | 545 | 545 | 2026-08-26 | ✅ healthy — full corpus drafted; cron 239 keeps it fed |
| sf-link assist | `W9_3_RESCORE` (source `w9_3_sf_assist`) | 247 | 47 | 2026-08-22 | ✅ healthy (caught up) |
| ollama clean-assist | `OLLAMA_CLEAN_ASSIST` | **63** (45 earlier the same day) | 63 | 2026-08-26 | ✅ producing and still climbing since the P134 re-grade + P137 ladder wiring |
| **property-twin assist** | `PROPERTY_TWIN_ASSIST` | 200 | **0** | 2026-08-19 | ⏳ **DIAGNOSED 2026-08-26 evening — THE FIX WAS NEVER DEPLOYED, not broken.** P135 merged 18:16 UTC; the build running all day was cut at **16:03 UTC**. Cleared by the 23:13 UTC redeploy (#1789). **Verify on cron 220 @ 05:45 UTC — the count must pass 200.** |
| reachability harvest | `W9_2_REACHABILITY_HARVEST` | *(writes to `lcc_decisions`)* — `decision_type='reachability_harvest_review'`: **4 total, 0 in 7d, last 2026-08-13** | | | ⏳ **Same cause, same fix.** P136 merged 18:56 UTC, also post-cutoff; now live. **Verify on cron 212 @ 04:40 UTC — the count must pass 4.** |
| junk pre-screen · naming hygiene · dup-pair · match-disambig · next-step | `W8_U1` · `W8_U5` · `W8_U2` · `MATCH_DISAMBIG_ASSIST` · `NEXT_STEP_AI` | *(other stores / inline)* | | | Doc-sourced ✅ healthy as of 2026-08-26 — see `LOCAL-MODEL-LEVERAGE-MAP.md` §2; not independently re-measured here |

## 5. Surfaces & the instruction canon

- **Canon version: `CANON_VERSION 1.5.0`** (2026-08-20) — `docs/os/canon/00-INDEX.md`. Rules live in
  `canon/blocks/*.md`; **never hand-edit a file whose header says GENERATED.**
- **To change any rule:** edit the block → bump `CANON_VERSION` → run
  `node docs/os/tools/render-surfaces.mjs --root=docs/os --write-live` → follow
  `SURFACE-SYNC-PROTOCOL.md` to push to every surface. `tools/check-parity.mjs` exits non-zero on drift.
- **One master paste-file per surface:** Copilot Deal Agent → `docs/copilot/agent-instructions.md`
  (auto) · ChatGPT → `docs/os/surfaces/chatgpt.canon.md` as the LCC-CANON knowledge file (auto) ·
  Northmarq Claude → `_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md` (manual) · Personal Claude / Cowork →
  `~/.claude/skills/*` (manual).
- **Legacy, do not treat as authoritative:** `docs/claude/northmarq-claude-instructions.md` and
  `docs/claude/personal-claude-instructions.md` self-label "AUTHORITATIVE" and are not.
- Full mechanics: **`AI-SURFACES-OPERATIONAL-REFERENCE.md`**.

## 6. Canonical doc map — one source per topic

| Topic | Canonical source |
|---|---|
| **Where we are** (this file) | `docs/os/CURRENT-STATE.md` |
| **Everything unbuilt-but-intended** | `docs/os/PLANNED-BACKLOG.md` |
| OS entry point / architecture | `docs/os/README.md` → `docs/os/REGISTRY.md` |
| Rules (per topic) + version | `docs/os/canon/*.md`, `docs/os/canon/00-INDEX.md` |
| Surface update procedure | `docs/os/SURFACE-SYNC-PROTOCOL.md` |
| Surfaces / comps engine / deploy | `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` |
| Local model — where it is used | `docs/os/LOCAL-MODEL-LEVERAGE-MAP.md` |
| Local model — ranked gaps | `docs/os/LOCAL-MODEL-GAP-AUDIT.md` |
| Invariants, footguns, doctrines | `CLAUDE.md` (LCC) · `Dialysis/CLAUDE.md` · `government-lease/CLAUDE.md` |
| API/routing reference | `.github/AI_INSTRUCTIONS.md` |
| Repeatable defect detectors | `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` |
| **Where operator time actually goes** (lane-by-lane throughput) | `docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md` |
| Intake channel provenance (grade by channel, never fleet-wide) | `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md` |
| Wave rollout ledger | `ROLLOUT_STATUS.md` |
| Running work log | `docs/claude-code/STATUS.md` |
| Connectivity map + open threads | `docs/architecture/connectivity-and-open-threads.md` |
| Cowork session setup | `docs/os/COWORK-SETUP-AND-FUTUREPROOFING.md` |
| Fresh-chat kickoff | `docs/claude-code/NEW-CHAT-KICKOFF.md` |

## 7. Stale claims this consolidation overturned (measured 2026-08-26)

Recorded here so the next chat does not re-inherit them, per the fix-the-note-in-the-same-change rule.

1. **`AI-SURFACES-OPERATIONAL-REFERENCE.md` §1 said `CANON_VERSION` is `1.2.2`.** It is **1.5.0**
   (2026-08-20). Corrected in that file.
2. **`briefing-analyst-take-onprem.md` and the STATUS entry say `BRIEFING_ANALYST_TAKE_ONPREM` is
   OFF awaiting the operator gate.** The registry says **`on`**, and today's snapshot carries a real
   774-char on-box take. The gate was passed; the docs had not caught up. *(The edge fn
   `briefing-intel-snapshot` is at v21, updated 2026-08-26, consistent with the omit-when-null guard
   deploy having been run — **confirm the deployed source carries
   `if (row.analyst_take == null) delete row.analyst_take;` before any manual snapshot re-fire**, or
   the re-fire upserts NULL over the on-box take.)*
3. **`LOCAL-MODEL-LEVERAGE-MAP.md` §3 points at "ROLLOUT_STATUS W10 Stage 3, `⬜`".** There is no
   `⬜` anywhere in `ROLLOUT_STATUS.md` — the W10 Stage 3 (template library) and Stage 4 (LoRA)
   intentions live only in the prose of the **W10.1** row. Both are preserved in
   `PLANNED-BACKLOG.md` so the pointer's rot cannot lose them.
4. **P135 / P136 are written up as fixed.** The code fixes shipped and dry-ran clean, but **neither
   lane has yet produced a live write delta** (property-twin still 200/0-in-7d; reachability-harvest
   4/0-in-7d). By this repo's own rule that is *not yet* fixed in production. Carried as an open
   verify in `PLANNED-BACKLOG.md`. **Re-confirmed the same evening — both unchanged.**

### Added 2026-08-26 (evening) — three more, from picking up the W5.3 / Ollama-hygiene thread

5. **`ROLLOUT_STATUS.md` W5.3 says the Prompt-61 hardening is "VALIDATED at production quality"
   (NOI 89% / tenant 79%).** That number averages **three channels with different input types**,
   and the sidebar channel — **56% of rows, 0 hardened-schema extractions out of 350** — has never
   run the hardened prompt. The verdict is **unproven, not refuted**; the evidence offered cannot
   carry it. Row corrected in place. → `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`
6. **The post-93 note "stamp coverage now 100% (87/87 backfilled)" reads as a fixed writer.** It
   was a **backfill**; the daily new-row rate decays straight back to zero (2026-08-26: **0 of
   21**). Carried as backlog **V6**.
7. **`CLAUDE.md` said "CI keeps the hard fail."** No workflow runs `npm test` on a PR at all — the
   4,551-test suite never executes in CI, which is how #1786 merged green with a red suite.
   Corrected in `CLAUDE.md`; fix scoped as backlog **N9**.

## 8. Where the history went (nothing was deleted)

| Archive | What it holds |
|---|---|
| `docs/history/CLAUDE_full_2026-07.md` | The full per-round worklog R5→R64 (ORE, CONNECTIVITY, UI phases, SF reconcile, T9d, CM) through 2026-07 |
| `docs/history/AGENTS_full_2026-07.md` | The AGENTS.md counterpart |
| `docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md` | **New 2026-08-26** — the STATUS tail: comps arc prompts 19–60, Wave 8 hygiene, Wave 9 connectedness, ChatGPT/Copilot rollout |
| `docs/history/DOCS_CONSOLIDATION_2026-08-26.md` | **New** — what this consolidation moved, and the full preservation manifest |
| `docs/history/worklogs/` + its `INDEX.md` | **New 2026-08-27** — 31 one-off per-round worklogs moved verbatim from the **repo root**. ⚠️ Seven carried unfinished work, now recovered into `PLANNED-BACKLOG.md` P10 as **K13–K20** (five measured Capital-Markets chart defects among them). **P141 swept `docs/` and never looked at the root**, which is how they stayed invisible for 17 days. |
| `docs/history/INDEX.md` | The archive index |
| `docs/claude-code/done/` | Completed Claude Code prompts (66 files) |
