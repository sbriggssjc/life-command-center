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
| **PARTIAL, DB/code-corroborated** (remediation-plan TODOs, this round + prior) | 4 of 12 shown shipped-under-another-name (C7, C9, B6, B8); 2 still-open (C4, B3); 1 partial-progress (C2); 5 UNMEASURED (C5, C8, A6a, A7, A8) | INVENTORY1b item 3 |
| **root-report intent, this round** | 10 rows, states: 5 shipped/live, 2 partial (with a named stale reference), 3 unmeasured | INVENTORY1b item 6 / CSV `INV1-1780`–`INV1-1789` |
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
"writer refactor" half unconfirmed), **5 UNMEASURED (C5, C8, A6a, A7, A8 — would need
`ownership_history` row-count queries and SF-link-coverage queries not run this round)**.
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
- **5 remediation-plan TODO rows (C5, C8, A6a, A7, A8)** — would need live `ownership_history`
  row-count queries and `unified_contacts`/SF-link-coverage queries. **Supabase MCP tools were
  not available in this session** (unlike the prior INVENTORY1b round, which had them for
  items 1 and 4) — this is the single largest concrete "DB access would help" gap carried
  forward.
- **Root report internals beyond the opening/executive-summary section** — 10 reports were
  read at their opening + a few targeted greps for named artefacts (Context Broker, sf_push.py,
  marketing_leads, openUnifiedDetail); none was read start-to-finish, so any finding buried
  deeper in a 300–785-line report is not represented in the CSV rows this round added.
- **Whether specific PA (Power Automate) flows described in the root reports (GovLease→SF,
  RCM lead intake, Salesforce Activities sync) still point at the live Railway host vs. a
  stale Vercel reference** — this needs either the PA tenant itself or an `edge_logs`
  writer-IP fingerprint query (the technique `CLAUDE.md`'s P194/J13 sections document), neither
  reachable from this session.
- **Ghosts** — genuinely unmeasured across all three rounds; no positive or negative finding.
