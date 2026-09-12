# Executive Briefs — Market Briefs per swimlane (MB) + CTO/CDO Build Brief (XB) + Operator Funnel (OC)

**Spec v0.2 — decisions recorded 2026-09-11 (Scott), architecture recommended (Cowork). Design approved in
principle; build proceeds prompt-by-prompt. EB1 (foundation) merged PR #2291 2026-09-11; OC-a merged PR #2298; MB-a merged PR #2301; MB-a2 merged PR #2307; MB-a3 (freshness-honest facts + CMS feed gate) built, PR open, flags OFF pending redeploy — see §9 MB-a3 addendum.**
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

**Addendum 2026-09-11 "MB-a2" — sources fixed against the live schema + DB applied; flags still OFF.**
All four MB1c defects fixed and verified live via Supabase MCP. Cap-rate band + trades-since-last-run now
call the comps engine's OWN `rpc/rpc_query_comps` RPC — the same RPC `query_comps`/mcp/comps-tools.js
uses — rather than reproducing its filters by hand; this satisfies the design rule above by construction
(the RPC already applies `transaction_state='live'`, `exclude_from_market_metrics IS NOT TRUE`, and
`cap_rate = coalesce(cap_rate_final, cap_rate)` server-side, and already joins `properties` for
address/city/state and resolves `tenant`). The handler additionally reads the engine's own DISPLAYED
(rent÷price) cap basis via `displayedCompCap()` (imported from `mcp/comps-tools.js`), falling back to the
RPC's coalesced field — the identical basis `query_comps`' own summary quotes (Prompt 52 doctrine).
Verified live: the RPC returns 200 TTM rows (175 `dialysis_db` + 25 `salesforce`, 98+21 carrying a cap)
against the raw table's 94 market-eligible rows — a proper superset, not a narrower/different set.
`v_dia_on_market` now reads `current_cap_rate`. CMS operator counts now read a new server-side view,
`v_market_brief_cms_operator_counts` (migration `dialysis/20260911190000`, **applied**;
`sum(clinic_count)=6695`, 32 distinct operators, top row DaVita/Fresenius 2,450 each — matches the full
population). Every paged source read carries a `truncationGap()` tripwire. Migration
`20260911180000_lcc_mba_market_brief_producers.sql` is now **APPLIED to LCC Opps**: `fact_key` column +
partial unique index present, both flags registered `off`, both crons scheduled (`15 7 * * *` P-SQL,
`10 10 * * *` P-RSS — checked against live `cron.job`, no collision). Guard:
`test/mba2-market-brief-psql-source-fixes.test.mjs` (12 tests, mutation-verified RED on the reintroduced
`cap_rate` column-name regression); full repo suite 5,913 pass / 0 fail / 6 skipped. P-RSS (MB2) was swept
for the same defect class and found clean — it reads ops-side JSON, no domain-DB row limits or guessed
columns. **⚠️ Neither flag flipped, neither tick run live** — this session has Supabase DB access only,
no Railway/API reach, so the JS fix is committed but not yet redeployed or exercised against the live
endpoint. Operator next step: redeploy, `GET /api/market-brief-psql-tick?lane=dialysis`, read `gaps[]`
(expect empty), one flag-forced `POST`, compare the reported cap-rate band to a direct `query_comps` call
for the same window, then flip both flags.

**Addendum 2026-09-11 "MB-a2 reconcile" (PR #2307 merged; Cowork live check, read-only):** fixes and migrations
confirmed live (`fact_key`, both flags off, crons 07:15/10:10 UTC, `v_market_brief_cms_operator_counts` sums 6,695);
app redeployed at `e42dbcb7`; 0 producer runs yet. **New defect MB1d:** CMS facts dated by run time over a census last
seen 2026-01-22 (B6d-cms outage), and DaVita = Fresenius = 2,450 exactly. **Design rule 3 added: every fact's
`source_date` is the source data's own as-of — never the producer's run time — and a producer whose source is beyond
its feed SLA writes a named gap instead of facts.** Without this rule the staleness machinery (§1) cannot see
upstream decay, which is the failure the living-brief design exists to prevent.

**Addendum 2026-09-11 "MB-a3" (this branch; unmerged) — MB1d closed for P-SQL, flags NOT flipped.**
`buildCmsOperatorFacts` gates each operator on its own `max(last_seen_date)` against a 45-day SLA
(mirroring dia `feed_freshness_registry.medicare_clinics`) and writes a named `cms_census_gap:<op>`
fact instead of a count/net-change fact when stale — live measured, DaVita/Fresenius both stale at
≈8 months while their `cms_last_checked`/`source_last_seen` touch columns read days-old (the reason
`last_seen_date` was chosen and the touch columns explicitly rejected, documented in code).
`buildCapRateBandFact`/`buildTradesSinceLastRunFact` now date off the newest comp `sale_date` behind
the derivation, not the run clock; on-market count and the genuine-zero trades fact keep `asOfIso`
as a stated exception (no better date exists for a live inventory count). Migration applied to
Dialysis_DB (append-only `source_as_of` column on `v_market_brief_cms_operator_counts`). 15 new
tests, full suite green (5,925/0). **The DaVita=Fresenius=2,450 tie is real and load-bearing for
the gate's design** (both share an identical `created_at` batch ending 2026-01-22 — an import-cap
artifact, not coincidence; filed to the Dialysis repo's B6d-cms backlog, not fixed here). **Flags
stay OFF**: this fix is not yet deployed to Railway (`/version` still reads the pre-MB-a3 SHA), and
flipping `MARKET_BRIEF_PSQL` before a redeploy would re-ship the exact bug this addendum closes.
P-RSS's Ollama reachability from `tranquil-delight` could not be confirmed (no Railway env access
from this session) — left OFF, stated as an operator-verification item.

**Addendum 2026-09-11 "MB-a3 reconcile" (PR #2313 merged, deployed as `78082f46`):** MB-a3 declined to verify because
its sandbox saw a pre-fix build; by reconcile time the fix was deployed, so Cowork ran both ticks' GET dry-runs via
pg_net (vault key, no writes). P-SQL: `gaps: []`, 17 candidates, CMS gate emitting 8 named gaps and no counts —
design rule 3 is working in production. P-RSS: Ollama reachable from Railway, 0 facts — the healthcare stream has no
dialysis content, so **P-RSS value depends on lane-specific feeds** (MB-b §0.3). The 2,450 tie is confirmed as one
import batch (created_at 17 s apart), filed for the Dialysis repo's B6d-cms backlog. **Design rule 4 added: fact identity
is canonical — operator/tenant facts key on a canonical id (Dialysis_DB `operators.operator_id`), never a raw display
string; windowed facts state their window and key stably.** Otherwise a brief shows one operator twice and zero-facts
accumulate daily.

**Addendum 2026-09-11 "source of record" (Scott):** *"track the source to ensure that the truth persists in all
places, not just a patch."* Design rule 4 (canonical fact identity) is now satisfied **at the source**, not in the
producer. The market brief consumes `operator_id` from the ID1/ID2 identity repair, and until then it withholds
per-operator bands behind a named gap. **Design rule 5: a brief never fixes a fact the source of record gets wrong.
It exposes the defect (gap or conflict), and the defect is traced and fixed upstream per CLAUDE.md Core doctrines.**
The brief is therefore also a detector: every gap it renders points at a source-of-record repair.

**Addendum 2026-09-12 "ID2b" (Cowork, live):** design rule 4's own withheld gap is closed for the
CMS-operator-count facts. `v_market_brief_cms_operator_counts` (the source the P-SQL tick reads for
`cms_clinic_count:*`/`cms_census_gap:*` facts) now groups on `properties.operator_id`
(survivor-resolved), falling back to raw `chain_organization` text only for the ~14.7% of clinics
whose linked property has no resolved operator (fill-blanks, never dropped). Measured live:
row-count parity 6,695→6,695; `Satellite Healthcare`(54)+`Satellite Dialysis`(14)→one bucket of 69.
`market-brief-facts.js` needed no code change — it was already agnostic to how `operator` was
derived. Full measurement:
`docs/audits/ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md`.

**Addendum 2026-09-12 "ID2b-caps" (Cowork, live):** the CAP-RATE half design rule 4 left
unverified above is now ALSO closed. `rpc_query_comps` (the market brief's own cap-rate source,
and every other comps-engine consumer's) returns `operator_id`/`operator_canonical`
(survivor-resolved) additively — every pre-existing field, including `tenant`, is unchanged, so
comp selection/scoring (`mcp/comps-tools.js`) cannot have moved. The per-operator TTM cap-rate
band now groups on `operator_id`, falling back to the old raw-text grouping only for comps whose
linked property has no resolved operator yet (ID2a's coverage gap, not this defect recurring).
Measured live on the tick's own TTM window: DaVita and Fresenius Medical Care each collapse from
two fragmented bands into one (72 and 68 comps respectively), clear of the small-n floor. Stale
text-keyed bands a resolved id makes obsolete are explicitly retired (`status='superseded'`) in
the same tick run, guarded against retiring a key other, still-unresolved comps genuinely need
live. **Design rule 4 is now fully satisfied for the market brief's operator identity.** Full
measurement + the sized ID2b-remaining follow-up list (CM views, dossier, MCP tools beyond the
selection-identity proof):
`docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md`.

⚠️ **Correction, same day: the sentence above was written from a verification that missed a THIRD
comp source.** A Cowork live re-check against the deployed build found the fragmentation had NOT
actually closed — `sf_comp_staging` (Team Briggs' own Salesforce-staged closed comps) has no
`properties` join, so ID2b-caps' passthrough could only ever emit `operator_id: null` for that arm,
and 375 rows spelled exactly `DaVita Dialysis`/`Fresenius Medical Care` were still minting a
second, text-keyed band under the SAME display label as the id-keyed one. **Addendum 2026-09-12
"ID2b-caps-2" (Cowork, live) closes it for real:** `sf_comp_staging` now carries its own
`operator_id`, resolved through the same `dia_resolve_operator` every other caller uses, and a
structural invariant in `planOperatorCapRateBands()` refuses to ever ship two id-keyed bands under
one label. Live re-verified: exactly three resolved bands (DaVita, Fresenius Medical Care, US
Renal Care), no duplicate label. **Design rule 4 is fully satisfied for the market brief's
operator identity as of ID2b-caps-2, not ID2b-caps.** Full measurement: the addendum appended to
`docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md`.

**Addendum 2026-09-12 "MB-b" (this branch; unmerged) — first user-facing P18 surfaces built, flag NOT
flipped.** Per `docs/claude-code/prompts/MBb-lane-briefs-daily-block-and-tab.md`. §0.1 (operator
canonicalization) was already satisfied by ID2b-caps-2 above before this build started —
`planOperatorCapRateBands()` groups every per-operator cap-rate band on `operator_id`, never a
locally-added name map, and refuses a second live band under one label; a new guard test
(`test/market-brief-operator-canonicalization.test.mjs`) pins "no two live band facts share an
operator_id" directly, as the prompt required. §0.2 (the trades fact's date-suffixed key re-minting a
fresh zero-fact every day) is fixed: `TRADES_FACT_KEY = 'trades_trailing_7d'`
(`api/_shared/market-brief-facts.js`) is now a single stable key regardless of run day, the tick reads a
fixed trailing 7-day window instead of "since last run" (a cursor whose meaning drifts with run cadence),
and the claim states its window explicitly ("… in the trailing 7 days as of <date>"). §0.3: a `dialysis`
RSS stream (Renal & Urology News, Nephrology News & Issues, CMS Newsroom) was added to
`briefing-intel-snapshot`'s `RSS_FEEDS`, separate from `healthcare` (which MB-a3-reconcile measured
carries 0 dialysis content most days) — **not egress-verified from this sandbox**, same limitation that
addendum already recorded for this exact task; the cron for `lcc-market-brief-rss` is repointed at
`stream=dialysis` in a new migration.

Built: the daily email's "Lane Briefs" block (`renderMarketBriefLanes`, `api/_handlers/briefing-email-
handler.js`, sits above Sector Watch — kept, unchanged, below it — per lane with live facts: what
changed since yesterday via `diffFactSets`, the 2–3 most material live facts via section-weighted
`selectTopFacts`, named gaps rendered plainly via `selectGapFacts`, "Read the full brief →"); the
homepage `#/briefs/<lane>` tab (`GET /api/market-brief-tab`, new handler + new `pageMarketBriefs` page +
`app.js` route wiring for the `#/briefs/<lane>` sub-path, a small teaser beside `#dailyBriefingWidget`);
shared fetch/diff/select logic in `api/_shared/market-brief-render.js` so both surfaces read the
identical live-fact selection and diff — they can never disagree about "live" or "changed". Both ship
behind a new flag, `MARKET_BRIEF_RENDER` (migration `20260912121500`, registered `off`); the homepage
tab's endpoint returns `{enabled:false}` while off, never a 404/500. Every number in the rendered email
block traces to a fact object — a dedicated tripwire test extracts every numeric token from the rendered
HTML (stripping tags/CSS/entity-escaping artifacts) and asserts each is present verbatim in the facts
handed to the renderer. A daily render freezes one `market_brief_issues` row per lane
(`issue_type='daily'`), idempotent via the EB1 unique index `(lane, issue_type, issue_date)` — a same-day
re-render upserts the same row rather than accumulating; a lane with no live facts is never frozen and
never rendered (omitted, not an empty section).

Guards: `test/market-brief-render.test.mjs` (14 tests — selection/diff/freeze-shape), `test/market-
brief-lane-briefs-email.test.mjs` (11 — the diff/gap/omitted-lane snapshot cases + the number tripwire),
`test/market-brief-operator-canonicalization.test.mjs` (3), plus additions to `test/market-brief-
facts.test.mjs` and `test/market-brief-tick-handlers.test.mjs`. Full repo suite: **6,114 pass / 0 fail /
6 skipped** across 962 suites — the failures first observed in this session were a missing
`node_modules` in the sandbox (`npm ci` fixed it), never a real regression; no pre-existing failure was
masked, per the repo's CI-masking doctrine.

⚠️ **Nothing here is deployed or live-verified — this session had no Railway/Supabase write access.**
Two new migrations are committed and unapplied: `20260912120000_lcc_mbb_rss_dialysis_stream_cron.sql`
(repoints the RSS cron at the new stream) and `20260912121500_lcc_mbb_market_brief_render_flag.sql`
(registers `MARKET_BRIEF_RENDER`, off). `MARKET_BRIEF_RENDER` stays off. Per §5, an operator must: apply
both migrations, redeploy Railway, run the P-SQL tick once via POST with the flag forced on and confirm
the trades supersede chain clears the old date-suffixed fragments (any live
`trades_since_last_run:<date>` fact should read `status='superseded'` after the first post-fix run),
render the email with a preview and load `#/briefs/dialysis`, verify each new RSS feed URL actually
parses, THEN flip `MARKET_BRIEF_RENDER`.

**Addendum 2026-09-12 "MB-b live" (Cowork):** §4's first two surfaces are LIVE. `MARKET_BRIEF_PSQL` and
`MARKET_BRIEF_RENDER` are on; the daily email carries the Lane Briefs block and `#/briefs/dialysis` serves live facts,
both reading `market_brief_facts`/`market_brief_issues` only. Design rules 1–5 are all now observable in production: the
brief shows three canonical operator bands (rule 4, via ID2a/ID2b-caps-2), renders the CMS census as a dated gap rather
than a stale number (rules 3 and 5), and recomputes nothing. **`MARKET_BRIEF_PRSS` remains off** — the dialysis RSS URLs
added with MB-b all fail (403/404, backlog **MB2a**), a reminder that a feed URL is not a source until it has been
fetched once and parsed.

**Addendum 2026-09-12 "MB2a" — dead dialysis RSS feeds replaced; feed-health monitor added; PRSS still
OFF.** `RSS_FEEDS.dialysis` in `briefing-intel-snapshot/index.ts` now points at the two feeds Cowork
fetched and parsed live (Federal Register, filtered to "end-stage renal disease" — the authoritative
ESRD PPS policy source spec §3 names; Google News, operator query `dialysis OR DaVita OR "Fresenius
Medical Care"`), replacing the three dead URLs (403/404/404). No third publisher-specific feed was
added — this session's sandbox has zero egress to verify one (policy-denied CONNECT to every
candidate host), and a feed that cannot be verified is skipped rather than shipped with a spoofed
User-Agent, per this task's own instruction. **Google News's two caveats are handled, §2's own
wording:** `parseRss()` splits a redirect feed's item title on the LAST `" - "`/`" – "` separator into
`{headline, publisher}` (a headline containing its own dash still keeps the true publisher suffix; a
title with none returns `publisher: null` rather than guessing), and `market_brief_facts` gained two
additive columns — `source_publisher` (the real outlet) and `source_url_is_redirect` — so a citation
never presents a `news.google.com/rss/articles/...` link as if it were the publisher's own page.
**A dead feed cannot ship silently again, per §2 and I11:** `scripts/verify-rss-feeds.mjs` (opt-in,
never wired into `npm test`, which stays hermetic) parses `RSS_FEEDS` straight out of the edge-function
source and fails non-zero on any non-200 or zero-item feed; and a new `market_brief_feed_health` table
(migration `20260912150000`) records one row per (stream, source, day) from every `fetchSectorNews()`
run, with `lcc_check_market_brief_feed_health(3)` opening a deduped `lcc_health_alerts` row after 3
consecutive zero-item days and auto-resolving on the next real item — the monitor alerts on its own
blindness rather than reading a dead feed as a quiet news day. **`MARKET_BRIEF_PRSS` was NOT flipped**
— this session has no live egress and no Railway/Supabase write access, so there is no fresh evidence
from this change of facts actually flowing; the only live-fetch evidence on record predates this code
(Cowork, 2026-09-12). Full repo suite unaffected: 6,130 pass / 0 fail / 6 skipped. Backlog: `docs/os/
PLANNED-BACKLOG.md` §P18 MB2a.
