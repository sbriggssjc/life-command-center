# LCC Build Status — slide content (draft)

Prepared for Scott Briggs, Northmarq / Team Briggs. Status as of 2026-09-11 (repo `main` @ `0128336e`).
Sources: read-only pass over `life-command-center`: `docs/claude-code/STATUS.md` (8,271 lines, newest first), `docs/os/CURRENT-STATE.md`, `docs/os/PLANNED-BACKLOG.md`, `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`, `CLAUDE.md`, and `git log --since="30 days ago"`.
Conventions: **Derived** = I computed it from the repo; it isn't stated anywhere as a figure. **Not on file** = I couldn't find it in the repo. Every other figure is quoted from the cited line.

---

## Slide 1 — Title

**Life Command Center (LCC): Build Status**
Deal intelligence for dialysis and government net lease · Team Briggs, Northmarq · 11 September 2026

**Speaker notes:** This deck covers where LCC stands today: what's live, what shipped in the last 30 days, what's in progress, and which calls are waiting on me. Every figure comes from the repo's own state docs and git history.

**Sources:** `git log -1` → `0128336e` (2026-09-11 10:50 CDT).

---

## Slide 2 — Headline + KPIs

**Headline:** The deal-intelligence spine is live end to end. The last 30 days went into data integrity: deduping entities and properties, hardening ingestion, and gating open endpoints.

| KPI | Value | Basis |
|---|---|---|
| PRs merged, last 30 days | **567** (PR #1703 → #2284) | Derived: count of "Merge pull request" commits |
| Non-merge commits, last 30 days | **937** | Derived: `git log --no-merges` |
| Deals in the SF-synced pipeline | **592** `bd_opportunities` | `CURRENT-STATE.md:41` (measured 2026-08-26) |

- Live flow: SF Opportunity sync → Team-Briggs scope → deal-email matcher → cadence scan → weekly pipeline email + deal dossier
- Comps engine is backed by **3,022 live sold dialysis comps** (1985–2026, 48 states)
- Test suite: ~4,606 tests in 270 files, about 3 min in CI, and a required merge check

**Speaker notes:** The PR and commit counts come straight from git, but they include documentation-only PRs, so they measure build velocity, not features. The 592 deals were measured 2026-08-26 and haven't been re-measured since. The comps count comes from the ops reference and is dated August.

**Sources:** `CURRENT-STATE.md:40-43`; `AI-SURFACES-OPERATIONAL-REFERENCE.md:86-88`; `PLANNED-BACKLOG.md:88` (N13, test counts); `CURRENT-STATE.md:22-24` (CI required check).

---

## Slide 3 — Architecture at a glance

- **AI surfaces (4):** Copilot "LCC Deal Agent", a ChatGPT custom GPT, the Northmarq Claude team Project, and Personal Claude/Cowork skills. One instruction canon (v1.5.0) renders to all four. Copilot and ChatGPT auto-render; Northmarq and the skills are synced by hand.
- **Railway (project `handsome-luck`): 4 web services + 5 cron services.**
  - Web: `tranquil-delight` (web app + `/mcp` + OAuth + `/api/*`, used by ChatGPT and Copilot Studio), `life-command-center` (standalone MCP for Claude/Cowork `mcp__lcc__*`), `gracious-radiance` (record-linkage resolver), `pacific-love` (BOV Generator)
  - Cron: `cms-ingestion`, `county-ingest`, `public-record-ingest`, `government-lease`, `Dialysis`
- **Supabase (3 projects):** LCC Opps is the core (entities, BD spine, Decision Center, auth, most crons). Dialysis_DB holds the dia domain plus the `data-query`, `daily-briefing` and `ai-copilot` edge functions. Government holds the GSA-leased domain.
- **Front end:** no bundler; classic scripts share one global scope; hash routing. Vercel was retired 2026-07-20.
- **Local model:** Ollama ("GaryBuilt") on-box assists, e.g. the brief's Analyst's Take and AC3 role inference.

**Speaker notes:** Deploying an engine change means redeploying both tranquil-delight and the standalone MCP. Supabase view changes go live immediately. Instruction changes are a paste or upload, not a deploy.

**Sources:** `AI-SURFACES-OPERATIONAL-REFERENCE.md:24-30, 39-56, 64`; `CURRENT-STATE.md:20, 30-31`; `CLAUDE.md:158-208` (DB topology table); `CURRENT-STATE.md:306` (§4 local model).

---

## Slide 4 — Shipped in the last ~30 days (highlights, weighted to the last 10 days)

- **Entity reconciliation (PDR1):** a planner, a flag-gated auto-merge tick and a Decision Center lane. 19 of 22 clear cases merged live (including DaVita/Donna TX). The other 167 are queued for human review.
- **Dialysis property dedup + self-heal (PDR13 / PDR14a / PDR14b):** a twin detector, a `dia_property_redirects` table, and a self-heal for dangling property IDs with ongoing monitoring. The 90 dangling IDs split 31 redirect / 13 parcel match / 46 flagged; none were guessed. All live-verified.
- **Dialysis ingestion reliability (Dialysis repo):** CFE-RUNAWAY stopped one job causing 7,547 statement timeouts a day. RATINGS-INSERT-COLLISION and PROPREV1 are confirmed live. The PRI1–3 connection-retry sweep is merged and deployed (PR #7406).
- **Security gates, log-only:** `ai-copilot` and `salesforce-enrichment` are now behind webhook auth, with a matching gate on Railway's `api/sync.js`. `npm test` is hermetic: it no longer makes 14 live production calls per run.
- **Contact intelligence (ACI phases 0–2):** bench ranking (AC2) and Ollama role inference (AC3) planners, and public-record scanners that now write real tables.

**Speaker notes:** The theme of this period is making connections trustworthy, not adding surfaces. I only marked a fix done once it was proven in live data, and some items sit at yellow for exactly that reason. The Dialysis-repo fixes were confirmed against production logs and live queries; this session didn't read the Dialysis diffs.

**Sources:** STATUS.md:476 (PDR1 executed), :528, :651; STATUS.md:114, :177 (PDR14a/b); commits `ae4272f3` (PDR14b), `8e418c0d` (PDR13), `981f1e8c` (PDR1); STATUS.md:2153 + `PLANNED-BACKLOG.md` CFE-RUNAWAY row (~line 44); STATUS.md:44 (PRI arc closed), :566; STATUS.md:2112, :1939, :1662, :2373; STATUS.md:825, :1318, :1003.

---

## Slide 5 — In flight

- **CQM1 (`clinic_quality_metrics`):** the fix is merged and confirmed on one live row. It stays yellow until a full-table production run proves it.
- **ASC Property-44 evidence gate:** parcel-owner evidence gating, explicit capture authorization and parcel-evidence-only completion, merged 2026-09-11. The repo doesn't expand "ASC" anywhere I found.
- **Log-only auth gates waiting on operator steps:** set `PA_WEBHOOK_SECRET` on Railway, watch the DENY-WOULD logs, fix header-less PA callers, then switch to `enforce`.
- **Buyer Engagement module (BUY0):** spec v0.1 drafted, piloting on Jordan Geller's ~$20M industrial search. Design only; no build is authorized yet.
- **Owner/contact pipeline:** the AC2 `sf_context` input isn't wired yet; N2 (grading role labels before the flag flip) is built but not graded.

**Speaker notes:** Nothing here is blocked on code. Most items are waiting on proof in live data or on an operator step. BUY0 needs answers from me before anyone builds it (see slide 8).

**Sources:** `PLANNED-BACKLOG.md:47` (CQM1), STATUS.md:367; commits `d881eea9`, `d309eb9e`, `8a6ad6ad`, `18f75c80` (ASC-P44); `AI-SURFACES-OPERATIONAL-REFERENCE.md:185-189`, `PLANNED-BACKLOG.md:41-43`; STATUS.md:19, `PLANNED-BACKLOG.md:903` (UX-T4); `PLANNED-BACKLOG.md:500` (AC2-sf-context), `:62` (N2).

---

## Slide 6 — Next up

- **C2g (flagged ⭐ NEXT in the backlog):** 489 anchored owner-orgs are still unresolved, with 652 SF people behind them. 415 of these can't be fixed by minting new entities; it's a resolution gap.
- **PDR12:** fix the planner gap where placeholder candidates reference each other (3 Rock Hill SC entities are held back). **PDR5:** the rent roll shows a flat $270,820 a year with 0% escalation, which needs checking against the actual lease.
- **N8:** the CoStar sidebar is the largest intake channel (56% of rows), yet it has never run the hardened extraction prompt (0 of 350 rows).
- **Triage two new health signals:** COPILOT-SYNC-500 (30% of `sf-activities` calls return 500) and CAL-RECONCILE-STUCK (13–16 stale calendar rows never get removed).
- **Contact intelligence Tier 3/4 (AC4/AC5):** a standing re-run loop, and broker intelligence kept separate from prospects. Designed, not built.

**Speaker notes:** This order follows the backlog's own flags (⭐ NEXT, P0 verify) and isn't a new ranking. The standing rule applies to all of it: re-measure a dated row before building.

**Sources:** `PLANNED-BACKLOG.md:83` (C2g), `:952` (PDR12), `:945` (PDR5), `:63` (N8), `:51-52`, `:501-502`.

---

## Slide 7 — Risks & blockers

- **Credential rotation is deferred by decision (2026-08-29).** The exposed `LCC_API_KEY`, the Supabase `service_role` key and PA-export secrets stay un-rotated until a trigger fires: a second user, the repo going public, sharing with Northmarq IT or a vendor, or a lost laptop.
- **Open-endpoint exposure until `enforce` is on.** `ai-copilot` v79 had 25 routes with no authentication; the gates are in `log` mode. SEC1: 62 anon-executable mutating functions on LCC Opps are triaged but deliberately not locked yet.
- **Salesforce direct API is blocked by the org's SSO policy** (`INVALID_SSO_GATEWAY_URL`). The workaround goes through a Power Automate gateway and takes about 48–49 s per call.
- **Dialysis repo CI isn't a merge gate yet** ("one toggle away"). PRI3's crash trigger (possibly an OOM) was never resolved.
- **Data coverage:** dia has rent on only 35% of properties (4,154 of 11,796), so value gates partly measure how much rent was captured.

**Speaker notes:** The rotation deferral is a risk I accepted on purpose, with named triggers, not an oversight. The trigger that matters most for Northmarq is sharing the repo with IT or a contractor: rotate before that happens.

**Sources:** `PLANNED-BACKLOG.md:247-262` (P0s), `:617-618` (SEC1/SEC2), `:185` (SEC1-unit2-lock), `:41` (COPILOT-OPEN); STATUS.md:2548 (SF SSO), :2392 (48–49 s); `CURRENT-STATE.md:28`; STATUS.md:44 (PRI open threads); `PLANNED-BACKLOG.md` A5e row (~line 70).

---

## Slide 8 — Decisions needed from Scott

- **BUY0 Buyer Engagement:** building spec, MSA universe, scoring legs, data sources, and open decisions A–F. Nothing gets built until these are answered.
- **Gate rollout:** approve setting `PA_WEBHOOK_SECRET` on Railway, then the switch to `enforce` for `ai-copilot`, `salesforce-enrichment` and `api/sync.js` once the DENY-WOULD logs are clean.
- **Sponsor/entity confirms:** FGF vs Boyd Watterson (V8a, the highest-risk item, covering 90 SPEs); Commonwealth (the recommendation is no); fcp and tmg sponsor entries (AC1c).
- **Still-open decision forks (P13):** team mailbox intake for Kelly, Sarah and Nate (currently deferred); per-broker digests (currently parked); computed vs manual cadence tiering; SAM account tier weighting.
- **Hygiene toggles:** make Dialysis CI a required check. For N15, decide whether the 1,475 SF-campaign orphans get `unified_contacts` rows.

**Speaker notes:** The mailbox intake fork is the single biggest lever for cadence accuracy, because today LCC sees only my mailbox. Phase 1 (attribution) can be built without deciding the rest.

**Sources:** STATUS.md:19-29; `AI-SURFACES-OPERATIONAL-REFERENCE.md:185-189`; `PLANNED-BACKLOG.md` V8a/V8b rows (~lines 32-33), `:493` (AC1c); `PLANNED-BACKLOG.md:1003-1034` (P13); `CURRENT-STATE.md:28`; `PLANNED-BACKLOG.md` N15 row (~line 66).

---

## Slide 9 — Appendix: where to look

- **Current state:** `docs/os/CURRENT-STATE.md` (what's live, what's flag-gated off, the canonical-doc map). Measured 2026-08-26; some sections are older than the work log.
- **Backlog:** `docs/os/PLANNED-BACKLOG.md` (P0 verify → P17; P13 lists the decision forks)
- **Work log:** `docs/claude-code/STATUS.md` (newest first; Aug 3–12 archived to `docs/history/`)
- **Surfaces and deploys:** `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`. Note that its §4 "Deploy-pending" section is marked historical.
- **Not on file:** a written roadmap with dates or milestones; any uptime or usage metrics for the surfaces; what "ASC" stands for.

**Speaker notes:** The repo says it's easy to misread: a dated blocker is a hypothesis to re-test, not a fact. Re-measure any figure in this deck before quoting it externally.

**Sources:** `STATUS.md:3-17`; `CURRENT-STATE.md:1-14`; `AI-SURFACES-OPERATIONAL-REFERENCE.md:104-112`.
