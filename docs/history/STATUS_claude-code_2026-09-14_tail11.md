# STATUS archive — Claude Code queue, 2026-09-14 (nineteenth span)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-16 to keep that file under its
3,000-line budget (it had crossed the 80% soft-warn again). Nothing was reworded or dropped; every
still-open item named here is tracked in `docs/os/PLANNED-BACKLOG.md`, the canonical open-work list.
The span covers the 2026-09-14 tax-feed fabricated-owner finding, PDR2 / OWN-T0c / MB2b-MB2c-FEED2
and the `HCRIS-TIMEOUT` review.

---
## 2026-09-14 🚨 — The tax feed has written 228 fabricated owner names into production, and the owner gap is NOT recoverable (Cowork)

Set out to size the recoverable half of **PDR2-noowner** (the 4,021 dia properties — **34% of the book** — that
render "owner unknown" now that the operator no longer stands in). **Both halves of what I found are worth more
than the sizing was.**

🚨 **1. `tax_records` contains 228 invented owner names, and the producer is still writing them.**
`raw_payload->>'mailing_owner'` holds **12 distinct `ABC`/`XYZ` names** — `XYZ Dialysis Centers Inc./LLC`,
`XYZ Healthcare Trust`, `ABC Properties LLC` and siblings — across **228 rows and 119 counties**, first seen
**2026-05-20**, last **2026-08-24**. **Of the 824 non-placeholder `mailing_owner` values in that table, 228
(28%) are fabricated.** ✅ None are linked to a property, so nothing displays them today — **but they are in the
table ownership answers come from.** A further **142 rows hold the literal `"Unknown"`**, a placeholder written as
though it were a fact (**P180**). This is the *never fabricate* rule failing in the data layer rather than in
prose, which is the harder place to notice it.

⚠️ **CORRECTED 2026-09-14 (OWNERGAP1 containment) — the writer named above was wrong.** `sidebar-pipeline.js`
in *this* repo never writes `mailing_owner` (verified by grep — zero hits). The real producer is
**`src/public_record_ingest.py` in the sibling `Dialysis` repo**, and it is the SAME class already recorded
twice elsewhere in this file: no county HTTP call at all, one call to `gpt-4o` seeded with the property's own
address/owner and asked to "extract" parcel facts — a generator, not a source. See PR1/PR1a/PR1b above; this
is the fourth instance of the identical mechanism, on a field (`mailing_owner`) those rounds did not touch.
Unit 1 (SQL-side containment: detector, reversible quarantine, write-time guard) is now shipped on Dialysis_DB
— see the OWNERGAP1 entry below. The Python producer fix is a separate, cross-repo follow-up
(`OWNERGAP1-producer`, filed, not built here — this session has read-only access to `Dialysis`).

✅ **2. The owner is NOT recoverable from anything we hold — and establishing that is the point.** The tempting
conclusion was *"the data is in the payload, we just never parsed it."* **Tested, and false:**

- **25,331** tax rows carry a `mailing_owner` key; **24,365 are null or empty.** The source returned nothing —
  **not an extraction gap.**
- Of the 4,021 owner-unknown properties, **3,048 join tax records and exactly ONE has a `mailing_owner`** — value
  `"Unknown"`.
- `deed_records`: **203 rows total, zero overlap** with the 4,021.
- Only **56** of the 4,021 carry a `parcel_number`, and **0** join a `parcel_records` row with an `owner_name`.

That is **B4/B5 applied in the direction it is usually skipped** — *"we must acquire the data" is the most
expensive conclusion available, so enumerate every table first.* I enumerated them, and this time the expensive
conclusion is the correct one. Writing it down stops the repo re-asking, and stops someone building a parser for
data that is not there.

**Prompt written:** `prompts/OWNERGAP1-a-third-of-the-book-has-no-owner-and-the-tax-feed-invents-some.md`.
Unit 1 is containment (find where the fabricated values enter — CoStar payload, a fixture, or our own fallback,
**say which** — stop the write, quarantine reversibly, never guess a real owner in their place). Units 2–3 are
measurement whose output is 👤 **a costed decision for Scott** — county-recorder path vs a paid bulk provider vs
accepting "owner unknown" and ranking those properties last — with the 4,021 broken down by state and county,
**because if a few counties hold most of them the cheapest path is narrow, not national.** It explicitly forbids
starting the acquisition build.

⚠️ It also tells CC to re-measure all four of my numbers and to say so loudly if it finds a source I missed —
that would be the most valuable outcome available here.

## 2026-09-14 — PDR2 reconciled: live positive control PASSES on the deployed endpoint; two items promoted out of the closed row (Cowork)

PR #2429 merged and **running** — `/version` = `953b7a00` == `main`, and `api/_shared/true-owner-operator-guard.js`
is on main. Response and prompt filed to `done/`.

✅ **The live positive control the prompt required — run against the DEPLOYED endpoint, not a code trace.** CC
reported *"live trace confirmed against 4 real dia rows — matches the new code's logic exactly"*, which is a trace
of the logic, not a call. Called `get_property_context(property_id=39874, domain='dia')` for real:

```
ownership: { recorded_owner_name: "Living Trust & Gina M Decarion Living Tr",
             true_owner_name: null, true_owner_is_operator: true,
             operator_name: "DaVita Kidney Care" }
```

**And it is independently corroborated inside the same packet:** that property's transaction history shows the
2019-02-01 sale, **buyer *Phil Decarion*, seller *Davita*** — so the Decarion trust genuinely is the owner and
DaVita genuinely is not. The packet now answers the question a net-lease broker actually asks. Before the fix it
named the tenant.

🟠 **Promoted out of the closed row: `PDR2-denorm`.** CC documented a remaining leak **inside the PDR2 row**,
which is now ✅ — **the same "a gap filed inside a closed row disappears" defect caught on `HP1-P2misparse`**, and
worth naming as a recurring pattern rather than a one-off. The leak is real: `entities-handler.js` §1.6 re-queries
**`properties.true_owner_name`**, a **denormalized column `sidebar-pipeline.js` populates unguarded**. Sized live:
populated on **830** properties, **134 of which hold an operator's name**. CC was right not to repoint it inline —
the write path has to be audited first or the dossier silently regresses. Fix the **writer** first.

🔵 **And the honest consequence, filed as `PDR2-noowner`:** with the operator no longer standing in as the owner,
**4,021 dia properties now render "owner unknown"** — operator-flagged `true_owner_id`, no `recorded_owner_id` to
fall back to. That is **34% of the 11,815 dia properties**. The fix did not create this gap; **it stopped a wrong
answer from concealing it.** 👤 This is the actionable half for Scott: a third of the dialysis book is property
LCC cannot tell him who to call about — and that is now visible instead of masked by a confident wrong name.
Sizing the recoverable subset (county deed grantee, tax mailing owner, SOS filings, several already ingested) is
its own measured unit and is plausibly the highest-value BD work left in the backlog.

**Queue:** 6 open prompts — `BR1`, `HCRIS-TIMEOUT`, `HP1-P2misparse-fp`, `ID3b`, `ID3d`, `MB2bc`.
## 2026-09-14 — OWN-T0c: shipped a canonical-key change, found it contradicted a tested contract, reverted fully (Cowork)

Continuing the ownership-connectivity work after ID3b, picked up `OWN-T0c` (417 `duplicate_entity`
conflicts, audit-dated 2026-09-02) as the next entity-dedup slice. Re-measured live first, per
doctrine: population is now **1,183**, not 417 — re-measure again before trusting either number.

Reviewed the existing merge machinery (`lcc_merge_entity` — mature, snapshot-backed, fully
reversible, no extension needed) and traced the audit's named root cause: `lcc_entity_name_tokens`
strips a LEADING "the" but not a TRAILING one, so `"XYZ Company"` and `"XYZ Company, The"` get
different canonical keys and are invisible to each other as duplicates. Measured the fix's real
blast radius before touching anything (43 live entities affected, ~6 that would newly collide)
and shipped it live to LCC Opps (`xengecqvemvfknjvbvrq`): fixed the tokenizer, then ran the
**existing** `lcc_n15c_backfill_canonical_names` (dry-run first, then live) to resync the stored
`entities.canonical_name` column — 25 rows rewritten, 18 correctly held stale by its own guard.

**Then found the contradiction, before updating any doc or committing anything to git**:
`test/entity-canonical-key.test.mjs`, dated 2026-08-27 (a week *before* the OWN-T0c audit), carries
a deliberate SQL-verified corpus that explicitly keeps a trailing "The" as part of the canonical
key — `'Penstar Group, The' → 'penstar group the'`, commented "leading article only; a trailing
'The' is part of the name." Two tested, considered positions disagree on what "the same owner"
means for this exact shape. That is a decision for Scott, not something to resolve unilaterally
mid-build by picking whichever doc I read most recently.

**Reverted fully, live, same session**: `lcc_entity_name_tokens` restored to its original body
(exact function definition, not a patch); all 25 `entities.canonical_name` rows restored to their
logged prior values via `lcc_n15c_canonical_backfill_log` (batch `own_t0c_trailing_the_2026-09-14`
— the fix's own audit log is what made an exact revert possible, not a guess). Parity re-verified:
67,234/67,234 live entities' stored `canonical_name` matches what the function now computes.
`test/entity-canonical-key.test.mjs` re-run green (8/8). No entity was ever merged; only the
canonical-key computation was touched, briefly, and undone before it reached git. `PLANNED-BACKLOG.md`
`OWN-T0b/c/d/f/g` row updated with the re-measured count and this open question, flagged for a
human call rather than closed.

No migration shipped, nothing to redeploy. Docs housekeeping: moved `MB2a`/`MB2b` desktop response
files to `docs/claude-code/responses/done/` — both confirmed already merged (PR #2418, #2426) by
other sessions before I reached them, no new work needed.


## 2026-09-14 — PDR2: closed the operator-as-owner read-path gap in `assemblePropertyPacket` (systemic, 7,937 dia properties)

Re-measured the blast radius live (do not requote the 2026-09-11 figures) — **7,937 dia
properties** resolve `true_owner_id` to a `true_owners` row with `is_operator_not_owner=true`;
**4,022** of those also have `recorded_owner_id IS NULL`, so even a correctly-guarded reader
falling back to `recorded_owner_name` has nothing to fall back to. Top offenders: Fresenius
Medical Care 3,077 · DaVita Inc. 2,625 · DaVita Kidney Care 1,182 · U.S. Renal Care 343 ·
Dialysis Clinic Inc 256 · American Renal Associates 221 — every major operator, not one bad
placeholder row. **gov's `true_owners` has NO `is_operator_not_owner`/`owner_type` column at
all** (confirmed live) — only `owner_role`, and 0 gov properties currently key `owner_role=
'operator'`, so gov's contribution to this defect is 0 today but the guard must not 400 there.

Fix (read-path only, no domain-DB writes): extracted one shared predicate,
`api/_shared/true-owner-operator-guard.js::isTrueOwnerOperator` (ORs `is_operator_not_owner` /
`owner_type='operator'` / `owner_role='operator'`, mirroring the two pre-existing correct copies
in `entities-handler.js` §1.6 and `sf-link-reconcile.js::isOperator()`) plus
`trueOwnerOperatorSelectFields(domain)` so the `true_owners?select=` never asks gov for a column
it doesn't have. `api/operations.js::assemblePropertyPacket`'s ownership block now selects those
signals alongside `name`, and when the true owner is an operator: `ownership.true_owner_name`
stays `null` (never the tenant), `ownership.true_owner_is_operator: true`,
`ownership.operator_name: '<tenant name>'`; `recorded_owner_name` is untouched either way; when
both are null/operator-only the honest answer is "owner unknown" — no backfill from the operator
name. Both `ownership = {...}` initializer sites (domain-linked and no-domain-linkage) carry the
new fields so every packet shape is consistent.

**§3 audit of the other true-owner readers, per the task list:**
- `api/_handlers/entities-handler.js` §1.6 — already correctly guarded (re-queries
  `is_operator_not_owner` itself). **NOT repointed at the packet's verdict** — it also falls back
  to `prop.true_owner_name`/`prop.recorded_owner_name` (denormalized columns on `properties` that
  `sidebar-pipeline.js` populates from `true_owners.name` **unguarded**, line ~10140), so if the
  packet's `true_owner_name` reads null on an operator, that fallback could still surface the
  operator name — repointing needs that write path audited/fixed first (filed, not this unit's
  scope: the denormalized `properties.true_owner_name` column is a separate, real leak worth its
  own prompt).
- `api/admin.js` `harvestResolveOwnersWithoutContacts` (~line 5567, the W9.4 create-contact
  target resolver) — **fixed**. It fetched `true_owners.name` for entities lacking a domain
  contact and fed it to a `create_contact` proposal keyed on `true_owner_id`; an operator-flagged
  true_owner would have let the harvest propose minting a contact under the tenant's
  `true_owner_id`. Now selects the operator signals per-domain and skips any operator-flagged row
  before building the target map.
- `api/_handlers/intake-promoter.js` `resolveOwnerLinksDia` (~2027) and its gov analogue
  (~2198) — **left as-is, different root cause.** These resolve/link `true_owner_id` from a
  deal-extracted `seller_name` via fuzzy match; `result.true_owner.resolved_name` feeds
  `sf_sync_flags` (an SF-match-status telemetry array), not a display of "the owner" to a
  user/agent. The matched party is whatever the OM stated as seller, not a domain-flag lookup —
  a different defect class if the OM itself named the operator, out of scope here.
- `api/operations.js` ~562 (`ownerName` in a Teams "Ownership Research Complete" alert) —
  **left as-is.** Sourced from caller-supplied `entity_fields`/`metadata`, not a `true_owners`
  read; guarding it would need threading the operator flag through the research-closure payload,
  a separate, smaller unit.
- `api/operations.js` `bridgeCreateLead` (~2280–2360) — **already correct**, an input contract:
  the caller passes `true_owner_is_operator` and the function anchors the lead on the recorded
  owner when it's set. No change needed.
- `sidebar-pipeline.js` true-owner lookups — several are WRITERS (create/match `true_owner_id`,
  or denormalize `true_owner_name` onto `properties`), not READERS presenting an owner to a
  human; the one write-path leak found (line ~10140, unguarded denormalization) is noted above,
  filed as a follow-up rather than fixed in this read-path-only unit.

**Live positive control** (Supabase MCP, Dialysis_DB, read-only): traced the new logic by hand
against 4 real rows — `property_id=39874` (Donna, TX; `true_owner=DaVita Kidney Care`,
`is_operator_not_owner=true`, `recorded_owner=Living Trust & Gina M Decarion Living Tr`) →
under the fix: `true_owner_name=null`, `true_owner_is_operator=true`,
`operator_name='DaVita Kidney Care'`, `recorded_owner_name` unchanged. `21924` (Anderson, IN;
Fresenius operator, recorded owner present) → same shape. `21893` (Waipahu, HI; U.S. Renal Care
operator, `recorded_owner_id IS NULL`) → `recorded_owner_name=null`, `true_owner_name=null`,
`operator_name='U.S. Renal Care'` — honest "owner unknown", never backfilled. `21867` (Mobile,
AL; `PMG Leasing, L.L.C.` non-operator control, `is_operator_not_owner=false`) →
`true_owner_name='PMG Leasing, L.L.C.'` unchanged, flag false. All four match the shipped code's
behaviour exactly (encoded as the corresponding test cases).

**Files:** `api/_shared/true-owner-operator-guard.js` (new), `api/operations.js`,
`api/admin.js`, `test/pdr2-operator-owner-guard.test.mjs` (new, 11 tests, all green).
`npm run check:boot` green. `docs/os/PLANNED-BACKLOG.md` PDR2 row updated ✅ shipped.

Not touched, per the task's exclusions: PDR12 (Rock Hill planner), PDR14/14b machinery, the 167
`needs_human` entities, any domain-DB write, any `GENERATED`-headed or canon/surface file.
## 2026-09-14 — MB2b/MB2c/FEED2 landed; the new column immediately found two more silent feeds (Cowork)

**Verified live after CC's PR #2426 (v23 → v24).** `items_after_cutoff` column present, PRSS correctly
**off**, zero open feed alerts, ESRD now contributes (1 of 1) under its `maxAgeHours = 30d`. CC's PRSS
judgment stands and is the right call — the Google News **query** is the blocker, not the plumbing.
🚨 **On its first day the new column exposed two feeds that are green and contribute nothing:**
**Federal Register (GSA)** 6 items → **0 after cutoff**, and **Tax Foundation** 15 → **0**. MB2b set
`maxAgeHours` on ESRD only. Measured both directly: FR GSA newest item **82h** old, Tax Foundation
**92h** — so 0 within 72h, but **5 each within 7 days**. Live consequence: `government` contributes from
ONE feed (FEED1 only half-fixed it) and **`tax_policy` is empty in the daily email** while reading green.
⭐ **This is FEED2's twin.** FEED2 was a monitor counting calendar days against a weekday producer; this
is a cutoff counting calendar hours against feeds that publish a few times a week. A fixed calendar
window aimed at a slower-cadence source is empty by construction on some days, and **Monday is worst —
72h on a Monday excludes everything before Friday morning.** Today is Monday. The 72h default is a NEWS
window and we keep pointing it at non-news sources. → **MB2e** (`maxAgeHours = 7d` on both, then a
distinct `no_contribution` alert arm so the monitor catches this class itself).

## 2026-09-14 — MB2b/MB2c/FEED2: fixed the instrumentation, then judged PRSS off (Claude Code)

**Shipped + deployed + live-verified, all three.** MB2c: `splitGoogleNewsTitle()`'s publisher regex
widened `[^-–—]+`→`.+` (one char) — a hyphenated outlet ("Honolulu Star-Advertiser") used to fail
the whole match, leaving `publisher: null` and the raw suffix stuck on the headline. MB2b: Federal
Register (ESRD) got its own `maxAgeHours` (30d, not the global 72h) plus a new additive
`market_brief_feed_health.items_after_cutoff` column, so "parsed 3, contributed 0" is now a visible
number instead of a green `ok=true` row. FEED2: added the missing test
(`test/feed2-streak-checks-not-days.test.mjs`) over the streak-counting migration's four cases +
structural guards on the SQL. Deployed `briefing-intel-snapshot` v23→v24 to LCC Opps, deployed body
re-read and confirmed byte-identical; migration `20260914120000` applied live. Forced a POST →
confirmed `Honolulu Star-Advertiser` now parses and Federal Register (ESRD) reads
`item_count:1, items_after_cutoff:1` on the real feed.

**Then judged `MARKET_BRIEF_PRSS`, per the task's own instruction — flag stays OFF.** Forced the RSS
tick dry-run against `stream=dialysis` (5 articles, real on-box Ollama): 4/5 "relevant", 4 would-write
facts, **0 of the 4 a broker could cite** — a capital-markets headline restated with no numbers, a
market-research report title, local EMS coverage. The one genuinely on-topic item (a Federal Register
ESRD document) was marked not relevant. Reproduces Cowork's 2026-09-12 finding even with the pipeline
fixed: the defect is the broad Google News query, not the instrumentation. Filed as a follow-up
(tighten to `cap rate`/`clinic`/`acquisition`/`when:7d`, re-measure) rather than guessed at blind.

Full suite: 6,180 pass / 0 fail / 6 skipped.
## 2026-09-14 — `HCRIS-TIMEOUT` response reviewed: both timeout root causes found and fixed, plus an unprompted finding much bigger than scoped — the same silent budget cutoff has likely been dropping several downstream steps for months

`HCRIS-TIMEOUT`'s response (`"HCRIS TIMEOUT surface response.docx"`, saved by Scott) read in full and
transcribed to
`docs/claude-code/responses/done/HCRIS-TIMEOUT-cost-report-ingestion-times-out-every-run-facility-cost-reports-stale-182-days.response.md`.
**Repo: `Dialysis`.** All four catalog items answered with real root causes, not guesses.

**(a) Two distinct bugs, not one.** `hcris_cost_reports`'s download used a bare `requests.get(timeout=300)`
— a single float timeout only bounds each socket read, so a trickling connection never trips it (the exact
bug class this repo already fixed elsewhere via `_safe_get`, just never applied here). `hcris_propagation`
called `save_estimate()` once per CCN with 2–3 sequential round trips each — an unbatched N+1 over the full
national HCRIS population, the same anti-pattern already fixed in `patient_count_ingestor.py` but never
ported to this module.

**(b) Fixed**: bounded connect/read timeouts plus an explicit wall-clock deadline on the download; a new
`save_estimates_batch()` (prefetch + chunked bulk writes, exact business rule preserved, other callers
untouched); sized per-step timeout overrides matching what `medicare_ingestion` already has.

**(c) The unprompted finding — bigger than the prompt scoped.** `run_timeout` isn't a third failed step —
it's the overall 90-minute budget check run before each step; once exceeded, the loop just breaks and
**every remaining step is silently skipped, no exception, no log line**, swept into "Failed steps" so it
reads like an ordinary failure. Since HCRIS sits 9th/10th of 15+ steps, its hang routinely burned the whole
budget — meaning `financial_estimates`, `property_financials`, `trend_detection`, `target_flagging`, and
other downstream steps have likely frequently never run at all, for months, invisibly. Fixed to name every
dropped step, not just the one it happened to be checking.

**(d) Confirmed**: `hcris_cost_report_ingestor.py`'s `.upsert()` is the sole writer of
`facility_cost_reports` anywhere in the repo — this timeout fully explains the 182-day staleness.

Tests: 26 new, full suite 3,262 passed / 9 skipped / 1 xfailed (1 pre-existing unrelated failure disclosed).
**Live re-check performed before filing**: the currently-running cycle predates this fix and is still on old
code — `facility_cost_reports` remains frozen at 2026-03-16 as expected; the next full cycle after this
deploys is the real proof point.

PR opened on branch `claude/hcris-timeout-fix-01BWJTdN` — **merge status unconfirmed**, asked Scott directly.
`PLANNED-BACKLOG.md`'s `HCRIS-TIMEOUT` row updated to 🟡. Prompt moved to `docs/claude-code/prompts/done/`.
Response `.docx` pending archive to `responses/done/` on Scott's machine.
