# Executive Briefs — Market Briefs per swimlane (MB) + CTO/CDO Build Brief (XB) + Operator Funnel (OC)

**Spec v0.2 — decisions recorded 2026-09-11 (Scott), architecture recommended (Cowork). Design approved in
principle; build proceeds prompt-by-prompt. EB1 (foundation) merged PR #2291 2026-09-11; OC-a merged PR #2298; MB-a merged PR #2301; next: `docs/claude-code/prompts/MBa2-psql-source-fixes-and-live-verify.md`.**
**Backlog:** `docs/os/PLANNED-BACKLOG.md` §P18. **Exemplars:** `docs/briefs/exemplars/2026-09-11-*.md`.

## 0. Scott's decisions (2026-09-11)

| Q | Decision (Scott's words, condensed) |
|---|---|
| Cadence | Brokers must be able to **recall the brief regularly in conversations**. Include it **daily** in the LCC morning email, **updated and improved as news or data is ingested**. Update schedule per section is Claude's call, based on how often each input actually changes. |
| Integration | **Built into our systems — not a pinned Cowork task that is never revisited and goes stale/disconnected.** Get design, architecture and connections right. Use the **local Ollama model** where appropriate. |
| Delivery | **Weekly long-format email** + a **short-form version inside the existing daily morning briefing**, linking to the long form. |
| Swimlanes | **Dialysis, government, general net lease, broad net lease only.** New medical lanes (ASC, imaging, MOB) join only once they exist as LCC lanes. |
| Generation | Claude's recommendation, weighted by the anti-decay concern. (Recommendation §2.) |
| Build brief | **Lives on the dashboard always, refreshed when updated.** Email timing per the market-brief pattern. Scott-only. |
| Operator notes | **All of the above — one large funnel sorting into one to-do list, filtered and delegated by topic to the right agent/thread.** Minimise human friction; maximise improvement loops. |

## 1. Design principle: a living brief, not a generated document

The exemplar is excellent because every figure is **sourced and dated**. It decays because a document has
no idea which of its lines are stale. So the unit of storage is the **fact**, not the brief:

- **`market_brief_facts`** — one row per claim: `lane`, `section` (operators · policy · capital_markets ·
  implications · trades), `claim_text`, `value`/`unit` (nullable), `source_url`, `source_title`,
  `source_date`, `fetched_at`, `origin` (`onbox_sql` | `rss` | `web_research` | `operator_note`),
  `fact_kind` (`reported` | `opinion` | `derived`), `stale_after` (per section TTL, §3), `supersedes_id`,
  `confidence`, `status` (`live` | `superseded` | `expired` | `conflict`).
- **`market_brief_issues`** — each rendered issue (daily short / weekly long) freezes the fact ids it used,
  like `cm_report_snapshots` does for quarterly figures → reproducible, citable, and diffable
  ("what changed since yesterday" = fact-set diff, not an LLM guess).
- A brief is a **render over live facts**. A fact past `stale_after` is either refreshed by its producer or
  shown as "as of <date>", never silently re-asserted. Conflicting facts render "Conflict", per the standing
  never-fabricate rule.
- **Decay is observable:** the XB audit (§5) reports, per lane, the share of facts that are stale, producers
  that have not run, and sections with no live facts. The system itself catches rot.

## 2. Generation architecture (recommendation)

Three producers write facts; one synthesizer writes prose; renderers read issues. All are LCC ticks on the
existing scheduler (flag-gated, logged, health-checked) — nothing lives in a Cowork task.

| Producer | What | Where it runs | Why |
|---|---|---|---|
| **P-SQL (on-box structured, P131-a)** | Our comps / cap-rate bands, trades since last issue, on-market counts, CMS clinic counts & closures (dia), GSA lease events (gov), 10-yr/macro already in the snapshot | Railway tick / SQL views; **triggered on ingest** + nightly | Deterministic; no model. Fills the exemplar's gap (no published dialysis cap average → ours). |
| **P-RSS (daily news)** | Extend the RSS streams `briefing-intel-snapshot` **already fetches daily** (healthcare, government, net_lease, tax). Local **Ollama** classifies lane/relevance and extracts candidate facts with the article as source. | Existing edge fn → on-box Ollama tick | Reuses live machinery; cheap; daily freshness. Ollama only sees public articles. |
| **P-WEB (cited web research, P131-c)** | Weekly per-lane research pass (operator earnings, CMS/GSA policy, capital-markets commentary, trades) **plus event-triggered runs** (§3). Prompt carries only the lane topic + the list of stale/expiring **public** facts to refresh — **no private corpus leaves the box** (standing doctrine, `briefing-analyst-take.js` L21). | Railway tick → Anthropic API with the web-search tool | Only cloud model use; bounded by a per-run budget; every fact must carry a URL or it is dropped. |
| **Synthesizer** | Writes exec summary + implications from live facts only; "opinion" labelled | On-box **Ollama** (same pattern as Analyst's Take); Anthropic fallback only over public facts | Keeps prose on-box; cannot invent a number because it is handed the fact set, and the renderer rejects numbers not in it. |

**Degradation, not silent failure:** if `ANTHROPIC_API_KEY` is missing/out of credit (it has been — see
`briefing-analyst-take.js` L10–13) P-WEB records `producer_run.status='skipped'`, facts age visibly, and XB
flags it. The daily brief keeps rendering from P-SQL + P-RSS.

## 3. Refresh cadence per section (Claude's call, per Scott)

| Section | Input changes… | Producer + cadence | `stale_after` |
|---|---|---|---|
| Rates / 10-yr / Fed | daily | existing snapshot macro, daily | 2 days |
| Sector news | daily | P-RSS daily | 7 days |
| Our comps, cap-rate bands, trades | on ingest | P-SQL on ingest + nightly | 30 days (re-derived nightly) |
| On-market counts | daily | P-SQL nightly | 2 days |
| Operator results (DaVita, FMC, USRC…) | quarterly | P-WEB **event-triggered** from an earnings calendar + weekly sweep | 100 days |
| CMS ESRD PPS rule | ~July proposed / ~Nov final | P-WEB weekly Jul–Dec, monthly otherwise | 45 days |
| GSA / federal footprint policy | irregular, frequent in 2025–26 | P-RSS daily + P-WEB weekly | 30 days |
| Broker cap-rate surveys (Boulder, etc.) | quarterly | P-WEB monthly | 100 days |
| Implications (opinion) | when inputs change | Synthesizer when any fact in its inputs changes | tied to inputs |

## 4. Delivery surfaces

1. **Daily morning email (existing `briefing-email-handler.js`)** — new **"Lane Briefs"** block (upgrades
   §8 Sector Watch): per lane, one line of *what changed* (fact diff) + the 2 most material live facts +
   "Read the full brief →" link. No new email engine.
2. **Weekly long-form email** — Monday, one email with all four lanes (exemplar structure per lane:
   exec 5 → operators/tenants → policy → capital markets → implications [opinion] → unverified → sources).
   Rendered from a frozen `market_brief_issues` row; same brand tokens.
3. **App: "Market Briefs" tab on the homepage** (`#/briefs/<lane>`) — live view + issue archive + "changed
   since" highlighting. The email links land here.
4. **Broker recall (the point of it):** MCP tool **`get_market_brief(lane, section?, as_of?)`** returning live
   cited facts, + a canon block so Claude / Copilot / ChatGPT surfaces pull it in conversations. (Canon edit
   → render → paste per `SURFACE-SYNC-PROTOCOL.md`.)

Audience: the briefing's existing recipients (team). Market briefs are team-wide; XB is Scott-only.

## 5. CTO/CDO build brief (XB) — Scott-only

- **Collector (deterministic):** on every push to `main` + nightly, a GitHub Action (repo is the source) parses
  STATUS.md, PLANNED-BACKLOG.md, CURRENT-STATE.md, prompts/ & responses/ folders, git log, CI results, and
  reads pipeline/queue health + Railway deploy state → writes **`build_brief_snapshots`**.
- **Audit rules (deterministic first):** doc contradictions (e.g. 2026-09-11 backlog ⭐NEXT C2g vs live queue
  PDR2), dated blockers past re-measure age, uncommitted/branch drift, orphaned prompts, GENERATED-file
  hand edits, stale market-brief facts, producers not running, flags ON with no consumer.
- **Synthesis:** on-box **Ollama** tick writes the exec narrative + ranked "next best effort" (repo content
  is private corpus → never a cloud model).
- **Surfaces:** dashboard **`#/exec`** (Scott-only, always current, refreshed on each snapshot) — headline &
  KPIs, shipped / in flight / next, risks, **decisions needed**, audit flags, operator-note loop status.
  **Weekly email to Scott** (Monday, after the market brief) + one **Scott-only line** in his daily email copy
  if/when per-recipient rendering exists (does not reopen P13 fork 3, owner-scoped digests).

## 6. Operator funnel (OC) — every channel, one inbox, auto-routed

**Channels → one table `operator_notes`** (raw text, attachments, auto-captured context, channel, received_at):

| Channel | Mechanism (reuse) |
|---|---|
| Reply to the XB or any briefing email | Outlook reply → existing tagged-comm intake (`intake-tagged-comm.js`, `source_type='outlook_tagged'`) with an LCC-Note tag/rule |
| Email to self / Outlook category "LCC-Note" | same intake path |
| In-app "Note" button (every page) | captures route, entity id, recent console/API errors, optional screenshot automatically |
| Teams message to the LCC channel/bot | Power Automate → intake endpoint |
| Any Claude / Copilot / ChatGPT surface | MCP write tool `log_operator_note` (sibling of `log_memory`) |
| Cowork / Claude Code sessions | a response or chat that contains a note is filed via the same endpoint |

**Triage tick (on-box Ollama + deterministic):** classify `type` (bug · data-gap · not-connecting · idea ·
UX · question), `domain`/lane, `severity`; **dedupe** against open PLANNED-BACKLOG rows and prior notes;
attach evidence (for bugs: matching log lines / failing endpoint); **route to an owner thread**
(`app/briefing`, `automation`, `data-coherence`, `surfaces/canon`, `comps`, `buyer-engagement`… — a small
routing table kept in canon); bugs with a reproducible signal get an auto-drafted Claude Code prompt.

**One to-do list:** DB is the truth; a nightly job renders **`docs/os/OPERATOR-INBOX.md`** (GENERATED
header, grouped by thread) which every Claude Code / Cowork loop reads each turn alongside `responses/`,
promoting items into PLANNED-BACKLOG rows or prompts. Only items that need a human decision go to a
Decision Center lane for Scott. **Loop closure:** each note carries its disposition (row X / PR Y / refuted
by measurement Z) and the next XB issue reports it back.

## 7. Build order (each step flag-gated OFF until verified live)

1. ✅ **EB1 — foundation:** schema + contracts + seed (PR #2291). Migration **not yet applied live** → EB1a.
2. ✅ **OC-a — funnel v1 (PR #2298; not yet live — see OC-v):** apply EB1 live, endpoint + in-app Note button + MCP `log_operator_note` + Outlook
   `LCC-Note` branch + triage tick + OPERATOR-INBOX render (via session-start hook + MCP read, no bot commits).
   *First, because every later step then improves faster.* (prompt drafted)
3. **MB-a — P-SQL + P-RSS producers** for dialysis, then gov / NL.
4. **MB-b — daily "Lane Briefs" block + homepage tab.**
5. **MB-c — [blocked on EB1b: Anthropic credit] P-WEB weekly + event triggers; synthesizer; weekly long-form email; MCP `get_market_brief` + canon.**
6. **XB-a — collector Action + audit rules + `#/exec` dashboard; XB-b — Ollama narrative + weekly email.**

## 8. Still open (small)

- Anthropic API budget ceiling per week for P-WEB (default proposal: hard cap per run, logged).
- Weekly send day/time (proposal: Monday 6:30 CT, ahead of the daily).
- Which Teams channel for the note intake.

## 9. Measured state (2026-09-11, Cowork, live read-only on LCC Opps) — supersedes EB1's UNMEASURED cells

| Item | Measured |
|---|---|
| EB1 tables | **Not applied** — 0 of 5 exist. Apply in OC-a step 0 (EB1a). |
| RSS streams (`briefing_intel_snapshot.sector_news`, last 8 rows) | All 4 live, capped at 6 items/stream. **government 0 on 09-07 and 09-08; tax_policy 0 on 3 of 8 days** → P-RSS needs more feeds per lane. |
| Analyst's Take (Ollama) | Live daily since 09-03, 316–680 chars, `onprem_ollama`; 09-02 null. `BRIEFING_ANALYST_TAKE_ONPREM` = on. |
| Anthropic API | Key present on the snapshot fn, **every call 09-02→09-11 fails: "credit balance is too low"** (code comment: since 2026-07-08). → EB1b decision; P-WEB blocked; §2 degradation path is the live reality today. |
| Tagged Outlook intake | `TAGGED_COMM_INTAKE` = on, but **6 rows ever, last 2026-08-07, 0 in 30 d** → diagnose the PA flow before relying on the email channel. |
| `cortex_market_intel` | **Exists live** (EB1 could not see it from the repo): 922 rows, last write 2026-09-11 06:30 UTC; email-parsed listing alerts with tenant, property_type, city_state, price, cap_rate, psf, dom, sf. Writer lives outside the repo. → a P-SQL source for MB1 and the only general-NL on-market signal (shared with BUY0). |

**Routing table location (OC-a):** `docs/os/operator-note-routing.json` (data, versioned in the repo). Promote to a
canon block only when a surface needs to read it.

**Addendum 2026-09-11 (MB-a — MB1/MB2 built, flags OFF, not live-verified):** `GET/POST
/api/market-brief-psql-tick` (MARKET_BRIEF_PSQL) and `GET/POST /api/market-brief-rss-tick`
(MARKET_BRIEF_PRSS) are wired for the **dialysis** lane. P-SQL sources: dia `sales_transactions` (TTM
cap-rate band, per-operator with a 5-comp small-n floor; trades since the last completed run),
`v_dia_on_market` (on-market count + median ask cap — the canonical on-market filter, read directly,
never re-derived locally), `medicare_clinics` (top-8 `chain_organization` counts, excluding
`dedup_status='demoted_duplicate'`, + a net-change fact only when a prior count exists). **Not wired:**
`cortex_market_intel` (its writer is still unlocated in this repo across two sessions — PLANNED-BACKLOG
MB1a) and gov GSA lease events (dialysis-first per the build order). CMS "closures" are approximated as
a fleet-count net-change, not a real per-facility open/close event feed (MB1b — no termination/status
column could be confirmed for `medicare_clinics` from the repo). P-RSS reads the EB1-measured healthcare
stream (still the 3 general feeds: MedCity News, KFF Health News, Health Affairs — no dialysis-specific
feed added yet, since that edits a separate edge-function deploy surface and none could be egress-
verified from this session) and fails closed with `producer_runs.status='skipped'` when on-box Ollama is
unreachable. `market_brief_facts` gained `fact_key` (+ a partial unique index scoped to `status='live'`)
so an SQL derivation with no `source_url` has a supersede identity; RSS/web facts keep using EB1's
`uq_mbf_source_identity`. Both feature-flag rows and both cron schedules were registered live-shaped
(off / guarded) in the same migration. **Neither flag has been flipped and neither tick has run against
live Supabase/Railway** — this session had no such reach; the GET-dry-run-first design is exactly built
so an operator can confirm real dia column names (via the response's `gaps[]`) before the first POST.

**Addendum 2026-09-11 (after OC-a, PR #2298):** EB1a applied — 16 live dialysis facts; `v_market_brief_staleness`
20 cells (5 populated / 15 missing). Outlook dormancy cause found in code: `parseLccCategoryHint` could never match
`LCC-Note` (hyphen) — fixed; whether the PA trigger fires is still unconfirmed. Funnel not live yet: 0 notes, no
`OPERATOR_NOTE_TRIAGE` registry row, no cron job, standalone MCP not redeployed (backlog OC-v).

**Addendum 2026-09-11 "MB-a reconcile" (PR #2301 merged; Cowork live check, read-only):** MB-a migration not applied;
0 producer runs. P-SQL sources vs live Dialysis_DB: `sales_transactions` lacks operator/address/city/state; raw
`cap_rate` on 37 TTM rows vs `cap_rate_final` on 106 (94 eligible, 66 `exclude_from_market_metrics`) → **design rule
added: every cap-rate fact in any brief comes from the shared comps engine (`runComps`) or a parity-tested copy of its
filters, so a brief can never disagree with `query_comps`**; `v_dia_on_market` uses `current_cap_rate`; the
`medicare_clinics` read truncates at 1,000 of 6,695. **Design rule added: producers aggregate in SQL; no row-limit-bound
client-side counts; CI carries a truncation tripwire and live column contracts.** OC-v still open (0 notes, no triage flag row).
