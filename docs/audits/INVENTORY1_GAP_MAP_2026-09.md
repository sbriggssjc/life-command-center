# INVENTORY1 — Consolidated Intent Inventory & Gap Map (2026-09-16)

**This file now folds together three rounds of work and supersedes its own earlier content**
(preserved verbatim, unchanged, at
[`INVENTORY1_GAP_MAP_PASS1_2026-09.md`](INVENTORY1_GAP_MAP_PASS1_2026-09.md)):

1. **Pass 1** — heading-level census of `docs/architecture/**`, `docs/audits/**`,
   `docs/os/canon/**`, root `SPEC_*.md` (567 CSV rows, `INV1-0001`…`INV1-0567`). Full text:
   [`INVENTORY1_GAP_MAP_PASS1_2026-09.md`](INVENTORY1_GAP_MAP_PASS1_2026-09.md).
2. **Pass 2** — heading-level census of `docs/history/**` + title census of
   `docs/claude-code/prompts/done/**` (1,212 more rows, `INV1-0568`…`INV1-1779`). Full text:
   [`INVENTORY1_GAP_MAP_PASS2_2026-09.md`](INVENTORY1_GAP_MAP_PASS2_2026-09.md).
3. **INVENTORY1b, items 4–6** (this round) — a live-DB check on the `CONTACTS_HUB`
   contradiction pass 1 flagged (item 4); a re-trace of 30 of pass 2's 132 "no-trace" prompts
   against a wider grep scope, item 5, full table at
   [`INVENTORY1b_prompt_trace_2026-09.md`](INVENTORY1b_prompt_trace_2026-09.md); intent
   extraction from the 10 root-report `.docx` conversions, item 6, 10 more CSV rows
   (`INV1-1780`…`INV1-1789`, `source=root-report`). Items 1–3 of this round (flags,
   `data_quality_self_learning_loop.md` staleness, remediation-plan TODOs) are in
   [`INVENTORY1b_followup_2026-09.md`](INVENTORY1b_followup_2026-09.md) and are cross-cited
   below where they change a pass-1/2 finding.

**CSV total after all rounds: 1,789 data rows** (`docs/audits/INVENTORY1_intent_2026-09.csv`,
`INV1-0001`…`INV1-1789`).

---

## Method note, carried forward and not re-litigated

Every prior round's honesty caveats stand: this is a **census of headings and titles**, not a
line-by-line verification of ~600–1,200 individually hand-read claims the original brief
asked for. Pass 1 and pass 2 both state this explicitly and it is not repeated in full here —
read their own method sections for the complete list of what was and wasn't scanned.
**New this round:** Supabase MCP tools were NOT available in this session (unlike
INVENTORY1b's items 1 and 4, which had live DB access) — every "unmeasured, would need DB
access" note below is a genuine gap, not a formality.

---

## Five-state distribution, measured — everywhere it was actually measured, honest UNMEASURED elsewhere

This repo does not have a single canonical five/six-state name list; the closest working
vocabulary, used consistently by pass 1 §Five-state distribution, INVENTORY1b, and this doc,
is: **LIVE (shipped and confirmed working) · BUILT-OFF/INERT (code exists, deliberately or
accidentally never fires) · PARTIAL (some but not all of the stated scope shipped) ·
PLANNED/NOT-STARTED (no evidence of code) · ABANDONED/REFUTED (explicitly superseded or found
wrong) · UNMEASURED (not independently checked at this pass's depth).**

| state | rows measured to this state | where |
|---|---:|---|
| **LIVE** (heading self-reports `SHIPPED`/`✅`/`BUILT`/`LIVE`/`COMPLETE`, pass-1 scope) | 83 | pass 1 §Five-state distribution |
| **LIVE, DB-corroborated** (this round, live query) | 4 sources (`cms_chain_org`, `county_records`, `manual_edit`, `salesforce`) all already-registered rungs, superseding `data_quality_self_learning_loop.md` Phase 2.3–2.6's "NOT STARTED" claim | INVENTORY1b item 2 |
| **LIVE, wide-grep-corroborated** (this round) | 30 of 30 sampled "no-trace" prompts traced to a real artefact once the grep scope widened past 4 doc directories | INVENTORY1b item 5 / `INVENTORY1b_prompt_trace_2026-09.md` |
| **BUILT-OFF / INERT-by-design** (this round, live query: `feature_flags_registry` `off_since IS NULL`, 9 flags) | 7 of 9 confirmed deliberate dark-ship defaults with working code paths (`CADENCE_OPEN_TRACKING_ACTIVE`, `CADENCE_TEMPLATE_AUTOSELECT`, `DECISION_GOV_WRITEBACK`, `DECISION_PROVENANCE_LEARN`, `DEED_IMPLIED_PRICE_FILL`, `SF_CONTACT_WRITEBACK`, `TEAMS_COLD_ALERTS_ENABLED`) | INVENTORY1b item 1 |
| **BUILT-OFF / genuinely undecided** | 2 (`GEOCODIO_API_KEY`, `GOOGLE_MAPS_API_KEY` — no recorded cost/ops decision either way) | INVENTORY1b item 1 |
| **flagged issue/footgun** (heading self-reports `⚠️`/`🚨`, no shipped/planned word, pass-1 scope) | 36 | pass 1 §Five-state distribution — **candidate leak list, not confirmed** (see Leaks below) |
| **refuted/retired** (heading self-reports, pass-1 scope) | 16 | pass 1 |
| **not-started/planned** (heading self-reports, pass-1 scope) | 5 | pass 1 |
| **partial/in-progress** (heading self-reports, pass-1 scope) | 2 | pass 1 |
| **PARTIAL, DB/code-corroborated** (remediation-plan TODOs, this round + prior) | 4 of 12 shown shipped-under-another-name (C7, C9, B6, B8); 3 still-open, DB-confirmed (C4, B3, C8); 1 partial-progress (C2); 1 domain-split partial, DB-confirmed (A6a — dia shipped with 616 grandfathered residual, gov not started); 1 still-open, DB-confirmed (C5 — gated on A6a and A6a is not complete on gov); 2 still-open, DB-confirmed (A7 — 11.7%/13.2% SF-link coverage on gov vs an ≥60% target; A8 — no batch-harvest signature found in dia `contacts`) | INVENTORY1b item 3 (Round 2) + **Round 3 — DB-verified** below |
| **root-report intent, this round** | 10 rows, states: 5 shipped/live, 2 partial (with a named stale reference), 3 unmeasured | INVENTORY1b item 6 / CSV `INV1-1780`–`INV1-1789` |
| **LIVE, DB-verified prompt traces (Round 3)** | 3 of 4 previously-flagged prompt claims confirmed shipped by direct query (ID2bcaps2, SALE1a, RATINGS3); 1 confirmed still-open (HP1-P2misparse-fp) | **Round 3 — DB-verified** below |
| **unspecified in heading** (no explicit status word, pass 1) | 425 | pass 1 |
| **unspecified, pass 2 (history + prompt titles)** | 1,212 (all of pass 2's rows — pass 2's own convention is every row defaults to `stated: unspecified` unless the title carries a status word) | pass 2 |
| **UNMEASURED** (everything else — the overwhelming majority of 1,789 rows) | ~1,700+ | all three rounds, honestly |

**Read this table for what it is: a record of the narrow slices that got independently
checked, not a claim that the rest of the inventory is broken.** The single largest number in
this table — ~1,700+ rows still UNMEASURED — is the actual state of this audit after three
rounds, and every round has said so plainly rather than rounding it away.

---

## Leaks — intent with no backlog row / no code trace, by class

### Leak class 1 — canonical doc names unbuilt sub-units the backlog doesn't track

`data_quality_self_learning_loop.md` Phase 2.3–2.6 (CMS chain-org sync, county records sync,
manual edits, Salesforce two-way sync), each marked `⏳ NOT STARTED` with **no matching
backlog row** (pass 1 §1). **RESOLVED, not a leak: this round's live DB check (INVENTORY1b
item 2) found all four source names already registered and in active use** under different
names (`cms_chain_org` 2 rungs, `county_records` 93 rungs, `manual_edit` 207 rungs,
`salesforce` 81 rungs). **The doc is stale, not the backlog** — a topic page went stale on its
own topic (exactly the pattern `CLAUDE.md`'s own doctrine section warns about), and nothing in
the backlog needed to track a gap that closed under a different name.

### Leak class 2 — prompts run with no trace in the 4-directory doc corpus

Pass 2 found 132 of 303 `prompts/done/*.md` files (43.6%) whose round tag never appears in
`docs/architecture/**`, `docs/audits/**`, `docs/os/**`, or `CLAUDE.md`. **This round sampled
30 of the 102 plain-slug ones and re-checked them against a WIDER grep scope** (adding
`supabase/migrations/**`, `test/**`, `api/**`, `docs/claude-code/responses/**`,
`docs/os/CURRENT-STATE.md` specifically) — **all 30 traced to a real artefact.** See
`INVENTORY1b_prompt_trace_2026-09.md` for the full table and the mechanism (pass 2's own
4-directory scope was too narrow; the real evidence for most of these lives in migrations,
tests, code, and `CURRENT-STATE.md`'s status table, none of which pass 2's script queried).
**This class is very likely NOT a real leak population — it is a measurement artefact of an
under-scoped cross-reference check.** The remaining 72 unsampled plain-slug prompts + 30
numbered ones were not re-checked; extrapolating from this sample, most are probably traceable
too, but that is an inference from n=30, not a re-measurement of the full 132.

### Leak class 3 — remediation-plan TODO rows never revisited

`docs/history/OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md` carries 12 `⬜ TODO` rows
(C2, C4, C5, C7, C8, C9, B3, B6, B8, A6a, A7, A8) never marked done in that file.
**INVENTORY1b item 3 re-tested all 12 against live code/schema**: 4 shipped-under-another-name
(C7 — different state set than planned but live and gated; C9 — `api/_shared/ingest-contract.js`
exists; B6 — migrations on `main` for both domains; B8 — a data-health surface exists,
placement unconfirmed), 2 genuinely still-open (C4 — no BEFORE INSERT dedup trigger found; B3
— no `deed-relink-tick` cron found), 1 partial (C2 — a contacts-persistence path exists, the
"writer refactor" half unconfirmed), and **5 rows left UNMEASURED that round (C5, C8, A6a, A7,
A8)** — **all 5 resolved this round (Round 3) with live queries; see "Round 3 — DB-verified"
below.** Summary: C5 still-open (no EXCLUDE constraint on gov); C8 still-open (`marketing_leads`
is 0 rows, no evidence the backfill ever ran); A6a is a domain split — **dia shipped it** (an
`EXCLUDE USING gist` constraint exists on `dia.ownership_history` with 616 rows carrying
`overlap_grandfathered=true`, i.e. residual overlaps deliberately fenced rather than fully
closed) **while gov never started** (gov's `ownership_history` is transition-shaped, not
interval-shaped, so the plan's daterange-EXCLUDE design as written doesn't even apply to gov's
live schema); A7 still-open (gov SF-link coverage measures 11.7% on `recorded_owners` / 13.2% on
`true_owners`, both far under the plan's ≥60% target); A8 still-open (no batch-harvest signature
in dia `contacts` — `costar_sidebar` rows are a continuous organic stream from 2025-06-14 to
today with no distinct one-time-backfill spike after the plan's 2026-05-23 date).
⚠️ Same-named A/B/C tags recur across time in this codebase (May-2026 tags vs later
2026-08/09 tags with the same letter+digit) — treat every one of these 12 as a dated
hypothesis to re-test, per `CLAUDE.md`'s own "re-measure a dated blocker" doctrine, not a
confirmed current gap.

### Leak class 4 — forward-looking statements in history logs, unadjudicated

283 raw grep hits across 188 history files for `TODO`/`not yet built`/`next step`/etc.
(pass 2 §2). Only ~15 individually read. The one structured, high-confidence find is leak
class 3 above; the rest remain an unclassified pile.

---

## Ghosts — backlog rows whose intent is already LIVE

**Not determinable at pass 1 or pass 2's depth** (both explicitly declined to guess — pass 1
§2 states this outright). **This round adds one partial exception**: leak class 1 above is
technically the inverse of a ghost (a doc claims NOT-STARTED for something that IS live) — the
mechanism is the same failure (a canonical page going stale on its own topic) but the
direction is opposite a ghost's (a backlog entry surviving past its own closure). No true
ghost (a `PLANNED-BACKLOG.md` row whose linked capability has since shipped and is still
listed open) was confirmed this round — this remains **UNMEASURED**, not zero.

---

## Inert — BUILT-OFF flags/code paths that never fire, with reason (or lack of one)

Full table in pass 1 §3, corrected by this round's live check (INVENTORY1b item 1):

| flag | inert reason, as measured live | recommendation |
|---|---|---|
| `CADENCE_OPEN_TRACKING_ACTIVE`, `CADENCE_TEMPLATE_AUTOSELECT`, `DECISION_GOV_WRITEBACK`, `DECISION_PROVENANCE_LEARN`, `DEED_IMPLIED_PRICE_FILL`, `SF_CONTACT_WRITEBACK`, `TEAMS_COLD_ALERTS_ENABLED` | **inert-by-design** — dark-ship default, working code path, self-documenting refusal message on the off path (7 of 9) | none needed; cheap to flip if wanted |
| `GEOCODIO_API_KEY`, `GOOGLE_MAPS_API_KEY` | **inert-by-accident-leaning-dead** — no recorded cost/config decision, parent tick (`geocode-backfill`) is live, other tiers may be sufficient | file as a human yes/no question ("do we want a paid geocoding fallback"), not a defect |
| `SHAREPOINT_LIST_URL`, `SF_LIST_IMPORT_URL`, `OPENCORPORATES_API_KEY`, `OWNER_ENRICH_*` (4 flags), `W9_1_SOS_DIRECT` | reason recorded, either in the flag's own `notes` or in a sibling repo's `CLAUDE.md` (bot-wall / ToS-pause reasons) | correctly inert, no action |
| `CONTACTS_HUB` | **RESOLVED this round** — registry `notes` describe the code DEFAULT (`gov` unless `CONTACTS_HUB=ops`), not the live Railway env value; live write-volume measurement (INVENTORY1b item 4: LCC Opps 4,660 rows/7d vs gov 709/7d, gov stale 4 days) confirms `ops` is actually set and CLAUDE.md's claim is correct | proposed DB fix, not applied (read-only constraint): update the `notes` column to state the measured live value, not just the code default |

---

## Process recommendation, per leak class — why it happened, what prevents recurrence

**Class 1 (a canonical doc claims NOT-STARTED for something shipped elsewhere):** this is the
"a canonical topic page goes stale on its own topic first" pattern `CLAUDE.md` already names
as a standing doctrine. It recurs because a round that ships capability X under name Y has no
prompt to go back and update every doc that once called X "not started" under its old name Y'.
**Prevention: when closing a `field_source_priority` (or any named-source) registration, grep
every doc that names the OLD proposed source name and update it in the same change** — the
`BUILD-TURN-PROTOCOL.md` "update the canonical docs in the SAME change" rule already covers
this in principle; the gap is that Phase-2-style planning docs aren't on anyone's checklist of
"canonical docs to touch" when a differently-named implementation ships.

**Class 2 (prompts with no doc trace, but real code trace):** this is a measurement artefact,
not a process failure in the prompts themselves — 30/30 sampled prompts DID leave a trace, just
not in the 4 directories the automated check queried. **Prevention: the check itself needs
fixing, not the prompts.** The concrete next step (already named in both pass 2 and this
round): widen the automated cross-reference to include `supabase/migrations/**`, `test/**`,
`api/**`, `docs/claude-code/responses/**`, and `docs/os/CURRENT-STATE.md` specifically (pass
2's `docs/os/**` scope appears to have undercounted `CURRENT-STATE.md`'s large status table —
worth checking why in a future pass). A structured registry stamping every round tag against
one indexed table (the recommendation pass 1 and pass 2 both already made) would let this
query run in one `SELECT` instead of a repeated scripted corpus scan.

**Class 3 (remediation-plan TODOs never revisited):** a status table living in a single
`docs/history/` file, dated May 2026, with no re-open/re-close mechanism and no backlog
mirror. Four of its twelve rows shipped under a DIFFERENT name/scope than the row describes
(C7, C9, B6, B8), which the row itself has no way to detect — nobody reads a closed-looking
TODO table to check whether its items shipped elsewhere. **Prevention: this is the same
"two-way sync between a status doc and the backlog" gap as class 1** — a plan doc's TODO rows
should either BE backlog rows (with the same ID scheme) or should be retired with an explicit
"superseded, see backlog row X" pointer the moment the superseding work ships, not left to be
rediscovered by an audit months later.

**Class 4 (283 unadjudicated forward-looking statements):** volume, not a process defect per
se — 188 history files accumulate TODO-shaped prose faster than anyone re-reads them, and
history files are explicitly archival (not meant to be live-tracked). **Prevention: this is
arguably correct behavior for an archive** — the fix isn't to make history files trackable,
it's to ensure nothing IMPORTANT ever lands ONLY in a history file without also getting a
backlog row or canonical-doc mention at the time it's written (again, `BUILD-TURN-PROTOCOL.md`'s
existing rule, under-enforced for prose-only findings that never got a structured artefact).

---

## What could not be measured, and why (consolidated)

- **The ~1,700+ UNMEASURED rows in the five-state table above** — the honest bulk of this
  three-round audit. No round claims otherwise.
- **72 of 102 plain-slug + all 30 numbered "no-trace" prompts** — only 30 were re-sampled this
  round; the rest were not re-checked against the wider grep scope that resolved the sampled
  30.
- **~~5 remediation-plan TODO rows (C5, C8, A6a, A7, A8)~~ — RESOLVED Round 3 (2026-09-16),
  Supabase MCP live queries.** See "Round 3 — DB-verified" below.
- **Root report internals beyond the opening/executive-summary section** — 10 reports were
  read at their opening + a few targeted greps for named artefacts (Context Broker, sf_push.py,
  marketing_leads, openUnifiedDetail); none was read start-to-finish, so any finding buried
  deeper in a 300–785-line report is not represented in the CSV rows this round added. **Still
  unmeasured after Round 3** (out of this round's scope).
- **Whether specific PA (Power Automate) flows described in the root reports (GovLease→SF,
  RCM lead intake, Salesforce Activities sync) still point at the live Railway host vs. a
  stale Vercel reference** — **PARTIALLY resolved Round 3**: `edge_logs` on LCC Opps shows live,
  current-day (2026-09-16), `node`-UA REST traffic against `xengecqvemvfknjvbvrq.supabase.co`
  correlated with `rcm1.com`-addressed correspondence (`unified_contacts` lookups) and
  RCM-named SharePoint documents (`folder_feed_seen`) — i.e. SOME RCM-related traffic is live
  and hitting the correct (Railway, not stale-Vercel) host. **This does NOT confirm the specific
  "RCM/LoopNet lead intake → `marketing_leads`" flow C8 describes** — `marketing_leads` itself is
  0 rows (see Round 3 below), so whichever PA flow is live, it is not the one C8's webhook fix
  was meant to unblock. The GovLease→SF flow specifically was not independently checked — **still
  genuinely inconclusive**: no distinguishing log signal (a gov-project `edge_logs`/`query_logs`
  sweep for that flow's writer fingerprint) was run this round, and the 24-hour log retention
  window this tool exposes cannot answer a "does this flow still exist / still point at the
  right host" question that depends on the PA tenant's own definition, not on recent traffic.
- **Ghosts** — genuinely unmeasured across all three rounds; no positive or negative finding.

---

## Round 3 — DB-verified (2026-09-16, Supabase MCP live queries against all three projects)

**Scope:** resolve every item the prior two rounds explicitly flagged "unmeasured — needs DB
access": remediation-plan TODOs C5/C8/A6a/A7/A8, the 2 undecided feature flags, 4 unresolved
prompt-trace claims (ID2bcaps2, SALE1a, RATINGS3, HP1-P2misparse-fp), and a PA-flow live-host
check. All queries below are read-only `SELECT`s; no schema changes, no writes, no flag flips.

### Remediation-plan TODOs (item 3's 5 UNMEASURED rows)

**C5 — `ownership_history` EXCLUDE constraint (gated on A6a).**
```sql
select conname, contype, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'public.ownership_history'::regclass;
```
- **gov** (`scknotsqkcheojiaewwh`): result has **no `contype='x'` row** — only a PK, 4 FKs, and one
  CHECK on `ownership_state`. No EXCLUDE constraint exists.
- **dia** (`zqzrriwuavgrquhisnoa`): result **includes** `excl_oh_no_overlap` — `EXCLUDE USING gist
  (property_id WITH =, daterange(COALESCE(start_date, ownership_start),
  COALESCE(end_date, ownership_end, 'infinity'::date), '[)') WITH &&) WHERE (ownership_state =
  'active' AND property_id IS NOT NULL AND overlap_grandfathered = false AND
  COALESCE(start_date, ownership_start) IS NOT NULL)`.
- **Verdict: confirmed-still-open on gov; confirmed-shipped on dia (with a carve-out — see A6a
  below).** The plan's C5 text names one constraint for one shared design; the two domains
  diverged — gov's `ownership_history` schema doesn't even carry `ownership_start_date`/
  `ownership_end_date` columns (it's transition-shaped: `prior_owner`/`new_owner`/`transfer_date`,
  per `CLAUDE.md`'s B5/B6c-dup sections), so the EXCLUDE-on-daterange design as written cannot
  apply to gov's live schema without a rewrite, not just a backfill.

**A6a — ownership_history chronological closure (gated C5 on this).**
```sql
select overlap_grandfathered, ownership_state, count(*) from ownership_history group by 1,2;
```
dia result: `{false,'active',8785}`, `{false,'superseded',1024}`, `{true,'active',616}`.
- **Verdict: confirmed-partial, domain-split.** dia's EXCLUDE constraint is live with a
  `WHERE overlap_grandfathered = false` carve-out — i.e. A6a's backfill ran, resolved most
  overlaps, and **616 residual active overlapping rows were fenced off (`overlap_grandfathered
  = true`) rather than fully closed**, exactly the shape the plan's own A6a text anticipated
  ("residual real overlaps → `research_tasks` for analyst"). This is in the right order of
  magnitude versus the plan's stated dia estimate (1,111 rows) — not exact, consistent with
  partial closure since 2026-05-23. **gov has no equivalent work at all** — no
  `overlap_grandfathered` column, no EXCLUDE constraint, confirmed by the C5 query above.

**C8 — RCM/LoopNet auth fix + `marketing_leads` backfill.**
```sql
select source, count(*), min(created_at), max(created_at) from marketing_leads group by source;
```
Result: **empty — 0 rows total in `marketing_leads`** (LCC Opps).
- **Verdict: confirmed-still-open.** Whatever the auth-fix status, the doc's own acceptance
  criterion ("replay last 7 days of inbound emails to backfill `marketing_leads`") has
  categorically not happened — the table has never held a row. See the PA-flow-host section
  below for a related, partial finding (some RCM-addressed traffic IS live on the correct host,
  just not landing in `marketing_leads`).

**A7 — owner→SF link backfill (target: coverage rises toward ≥60%).**
```sql
select count(*) total, count(sf_account_id) linked, round(100.0*count(sf_account_id)/count(*),1) pct
from recorded_owners;   -- gov: 17259 total, 2019 linked, 11.7%
select count(*) total, count(sf_account_id) linked, round(100.0*count(sf_account_id)/count(*),1) pct
from true_owners;       -- gov: 16274 total, 2142 linked, 13.2%
```
- **Verdict: confirmed-still-open.** 11.7%/13.2% is well under the plan's ≥60% target (and below
  even the doc's stated starting baseline of "1.5%/20%" on one of the two metrics — a different
  denominator than what this query measured, so not directly comparable, but the target itself
  is clearly unmet).

**A8 — CoStar Contacts retroactive harvest.**
```sql
select data_source, count(*), count(sale_id) with_sale_link, min(created_at), max(created_at)
from contacts group by data_source;
select created_at::date d, count(*) from contacts where data_source='costar_sidebar'
group by 1 order by count(*) desc limit 10;
```
Result: `costar_sidebar` rows run continuously **2025-06-14 → 2026-09-16** (today) with no
column recording a distinct backfill batch; the single largest single-day count (574 on
2026-04-28) predates the plan's own 2026-05-23 date and reads as ordinary capture-burst
variance, not a post-plan retroactive-harvest job.
- **Verdict: confirmed-still-open, no evidence found.** A8's own text names it optional
  ("if not [cached], skip — going-forward C2 covers new captures"), so absence of a distinct
  harvest signature is consistent with the operator having exercised that skip clause — this is
  a "not done" finding, not necessarily a "should have been done and wasn't" finding.

### The 2 undecided flags (`GEOCODIO_API_KEY`, `GOOGLE_MAPS_API_KEY`)

Round 2 already classified these correctly as genuinely-undecided cost/ops questions rather than
defects (registry `notes` say "duration unknown / never configured"; parent tick
`geocode-backfill` runs other tiers fine without them). **Round 3 did not find any downstream
table, cron log, or DB signal that changes that verdict** — there is no `geocode_backfill_runs`
row, health alert, or `feature_flags_registry` note suggesting either key was ever provisioned
and then revoked, which would have implied a deliberate "tried it, didn't work" decision rather
than "never configured." **Verdict unchanged from Round 2: genuinely-undecided, not a defect.**

### 4 prompt-trace claims

**ID2bcaps2 — the operator-id band-collision fix, re-run live.**
```sql
select operator, count(*) from properties
where operator ilike '%fresenius%' or operator ilike '%davita%' group by operator;
-- Fresenius: 3,733 · Fresenius Medical Care: 36 (raw text still split, as expected)
select o.operator_id, o.name, count(p.property_id)
from operators o left join properties p on p.operator_id = o.operator_id
where o.name ilike '%fresenius%' group by 1,2;
-- operator_id=5 'Fresenius Medical Care': 3,769 properties (= 3,733 + 36, exactly)
```
- **Verdict: confirmed-shipped.** The raw `properties.operator` text column staying split is
  expected and correct — `planOperatorCapRateBands` (read directly, `api/_handlers/market-brief-
  psql-tick.js`) groups on the **registry-resolved `operator_id`**, never the raw text, precisely
  to survive this split. The query proves the registry side resolves both text spellings to one
  `operator_id` with zero residue (3,733 + 36 = 3,769 exactly) — the band-collision this prompt
  fixed cannot recur for Fresenius on the current data.

**SALE1a — post-decision row count on `v_dia_sale1_price_review`.**
```sql
select count(*) from v_dia_sale1_price_review;                         -- 136 (was 165 at filing)
select review_class, count(*), count(*) filter (where cap_rate_final is not null)
from v_dia_sale1_price_review group by review_class;
-- ledger_disagreement: 96 (was 132) · deed_says_undisclosed: 40 (was 33)
```
- **Verdict: confirmed-shipped (partial completion, actively decreasing).** The view is
  dynamically computed (not a frozen snapshot), so this reading proves per-row decisions have
  been applied and are changing the live membership: `ledger_disagreement` fell by 36 while
  `deed_says_undisclosed` rose by 7 — consistent with rows being reclassified/resolved per the
  prompt's own null-vs-reset rule, not merely aging out. 29 net rows have left the review
  population since the 165-row baseline. Not fully closed (136 remain), but the mechanism the
  prompt asked for is demonstrably running.

**RATINGS3 — live-proven upsert fix (third attempt after two false "fixed" claims).**
```sql
select indexdef from pg_indexes where tablename='ratings' and indexname='ratings_medicare_id_uidx';
-- CREATE UNIQUE INDEX ratings_medicare_id_uidx ON public.ratings USING btree (medicare_id)
--   WHERE (medicare_id IS NOT NULL)
select medicare_id, count(*) from ratings where medicare_id is not null
group by medicare_id having count(*) > 1;                              -- 0 rows (no duplicates)
select count(*), max(updated_at), count(*) filter (where updated_at > now() - interval '30 days')
from ratings;                                                          -- 7013, 2026-09-16, 7013
```
- **Verdict: confirmed-shipped.** The unique index exists, zero duplicate `medicare_id` rows
  exist under it, and all 7,013 rows carry an `updated_at` inside the last 30 days with the
  newest stamped today — live evidence the upsert is both unique-constrained and actively
  writing, which is exactly the "prove it live" bar this prompt's own title sets after two prior
  false claims.

**HP1-P2misparse-fp — the street-suffix false-positive fix, test-fixture / code diff.**
```
grep -n "Brian Lane|blane@northmarq|Jim Street" api/_shared/tm-misparse.js
  test/tm-misparse.test.mjs api/_shared/misparse-disposition.js   → 0 hits, any file
grep -n "localPartMatchRule" api/_handlers/sidebar-pipeline.js api/_shared/tm-misparse.js
  → 0 hits (the corroborating-email discriminator from the prior HP1-P2misparse prompt is never
    called from the street_suffix code path in tm-misparse.js, nor from the sidebar-pipeline
    contact-mint path)
```
Corroborating DB check (LCC Opps): an entity `canonical_name='brian lane'`,
`email='blane@norhmarq.com'` (note: typo'd domain, `norhmarq` not `northmarq`), `entity_type=
'person'` **does exist** — but this does not confirm the fix, because that entity could equally
have arrived via Outlook/SF sync (channels the misparse guard doesn't gate) rather than a
now-unblocked CoStar sidebar capture; the typo'd domain is itself suggestive of a different,
non-CoStar source.
- **Verdict: confirmed-still-open.** `STREET_SUFFIX_RE` (tm-misparse.js:42) still fires
  unconditionally on a name ending in a street-suffix word, with no call to the corroborating-
  email discriminator (`localPartMatchRule`) that the prompt's own §4 says already exists and
  should be consulted before rejecting. No fixture for the named cases (`Brian Lane`, `Jim
  Street`) was added to `test/tm-misparse.test.mjs`. The prompt's own fix is not on `main`.

### PA-flow live-host verification (root-report follow-up)

`mcp__Supabase__query_logs` on LCC Opps (`edge_logs`, last ~1h window, 2026-09-16):
```sql
select timestamp, event_message from logs where source='edge_logs'
and (event_message ilike '%rcm%' or event_message ilike '%loopnet%'
     or event_message ilike '%marketing-lead%' or event_message ilike '%govlease%')
order by timestamp desc limit 20;
```
Returned 20 rows, all **today, UA `node`** (i.e. a server process, not a stale serverless
client), split between `unified_contacts?email=in.(...)` lookups against `*@rcm1.com` inboxes
(`cbre@rcm1.com`, `northmarqlistings@rcm1.com`, `investmentsale@rcm1.com`) and
`folder_feed_seen` hits on SharePoint paths containing `RCM.pdf`/`RCM.docx.pdf` filenames under
`PROPERTIES/.../DD/Buyer Information/.../Lease and Amendments/`.
- **Verdict: genuinely-inconclusive-because-partial-evidence-only.** This confirms SOME
  RCM-addressed traffic is live, current, and hitting the correct host (Railway → LCC Opps
  REST, not a stale Vercel deployment) — a positive signal against the P194-class "retired
  deployment still answering" failure mode for at least this slice of RCM activity. It does
  **not** confirm the specific PA flow C8 names (RCM/LoopNet lead intake writing
  `marketing_leads`), which the C8 query above shows has never written a row — whatever this
  traffic is, it is an email-correspondence/document-matching path (Outlook or SharePoint sync
  reading `rcm1.com` senders and matching `RCM`-named lease documents), not a lead-intake webhook.
  The **GovLease→SF flow specifically was not checked** — no distinguishing search term was run
  against gov-project logs, and the tool's 24-hour retention window cannot answer whether a PA
  flow's *definition* still points at a live host versus only whether recent traffic exists;
  those are different questions and only the second is answerable from here. **Left as
  genuinely-inconclusive**, not guessed.

### What Round 3 did NOT resolve (carried forward, same as before)

- Root report internals beyond the opening section (items 5–7 of the original prompt).
- The GovLease→SF PA-flow live-host question specifically (see above).
- Whether the 2 undecided geocoding flags should be turned on — this is a human yes/no, not a
  measurement gap.
