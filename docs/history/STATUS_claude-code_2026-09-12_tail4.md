# STATUS archive — Claude Code queue, 2026-09-12 tail (fourth cut)

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-14, **before pushing**, per the CLAUDE.md
doctrine *"TWO BRANCHES THAT BOTH ADD TO A SHARED DOC MERGE CLEANLY AND SILENTLY DUPLICATE IT"* — this file grows
on `main` while a branch is open, so archive to hold 200+ lines of headroom rather than trimming when CI goes red
(`test/status-line-budget.test.mjs`, budget 2,500). Nothing was reworded, summarised or dropped. Every still-open
item named below is tracked in `docs/os/PLANNED-BACKLOG.md`, the canonical open-work list; for the HP1 arc the map
is `docs/architecture/HOMEPAGE-ATTENTION-SURFACE.md`.

Covers 7 entries, from *2026-09-12 — HP1-P1a CORRECTED: the opportunity feed never STOPPED — its upsert has n* to *2026-09-12 — ID2b reconciled: real but not yet visible — the cap-rate fragmentation S*.

---

## 2026-09-12 — HP1-P1a CORRECTED: the opportunity feed never STOPPED — its upsert has never UPDATED a row, since the day it was built

Six hours ago I filed *"the feed ran once and stopped."* **That was wrong in a way that understated
it.** The flow is healthy and delivers **608 records every 30 minutes**. What has never worked is the
WRITE. Prompt filed: `prompts/HP1-P1a-fix-opportunity-upsert-never-updated.md`.

**Measured end to end, 2026-09-12 06:00 UTC.** PA run **Succeeded**; `Get records` → **608 rows**;
POST `/api/pipeline/ingest-opportunities` → **HTTP 200**; body
`{"ok":true,"total":608,"succeeded":0,"failed":608}`, every `errors[].error` = `upsert_failed` /
`status 502`. Postgres logs at `06:00:43`–`44Z`, **608 times**:
`duplicate key value violates unique constraint "bd_opportunities_workspace_id_sf_opp_id_key"`.
**PostgREST is running a plain INSERT — `Prefer: resolution=merge-duplicates` never takes effect.**

**Ruled out live, do not re-walk:** the constraint exists and is a plain two-column btree (so NOT the
documented partial/expression-index case); **direct SQL `ON CONFLICT … DO UPDATE` succeeds** (probed in
a rolled-back transaction); the upsert call is unchanged since `83cd873f` (2026-07-27) and the
constraint since 2026-05, so **nothing regressed**; `deal_name`/`property_address` were added 07-28 and
wrote fine on 08-03, so not a stale PostgREST schema cache; and a duplicate-key error proves the INSERT
reached the table, so not auth and not RLS.

**Why 2026-08-03 looked like a start date: it is the day the table was POPULATED.** Empty table → 590
inserts, no conflicts; 15 more on 08-04. Every run since collides. The only writes that have landed are
**5 brand-new `sf_opp_id`s**, and **all five have `created_at == last_synced_at` to the second — all
five are INSERTs. Zero UPDATEs have ever succeeded on this path.**

🚨 **So no stage change and no close has EVER propagated from Salesforce into LCC.** The backbone learns
a deal at creation and is frozen at that instant permanently. **This is the single root cause under all
of HP1 Finding 2** — the 22 open deals past their close date (ECU Physicians MOB **746 days**, ATEK
Brainerd 683, GSA-MSHA Oakwood 515), the frozen stages, 57 of 66 overdue `action_items`, the My Work
graveyard. Not task hygiene. Not Salesforce hygiene. One unexecuted `ON CONFLICT`.
⚠️ **`closed_at` on all 569 closed rows is the Aug 3/4 insert timestamp, not the real close date** —
never captured, not recoverable from LCC.

⚠️ **And the reason six weeks of 100% failure was invisible from BOTH ends:** `ingestBatch` ends
`return res.status(200).json({ ok: true, ...summary })` **unconditionally**. It answered **`ok: true`
with `failed: 608`**. Power Automate reads the status code, sees 200, reports Succeeded — while
`summary.errors[]` carried the truth nobody was reading. **A batch endpoint that cannot fail its caller
is not instrumented, whatever its summary says.** Unit 3 of the fix.

**Method note worth keeping.** Three successive readings of this feed were wrong, each from reading a
convenient column instead of the honest one: `max(updated_at)` said the pipe was alive (LCC-side writers
move it); `last_synced_at`'s history said it stopped (only INSERTs ever stamped it); the truth needed
`created_at == last_synced_at` to prove no row had ever been UPDATED. **Each reading was plausible, and
only the one that could distinguish an insert from an update was decisive.**

**Next:** `HP1-P1a-fix` — RPC-first write (the repo's own standing conclusion about PostgREST's write
surface), a non-2xx on a fully-failed batch, and `closed_at` preservation. **Verify on
`UPDATED_not_inserted` in the hour after a run — a number that has been 0 for this feed's entire life —
never on a 200.** ⚠️ Snapshot `bd_opportunities` first: 608 rows and six weeks of stage drift land in
one batch, and a large `deal_next_step` auto-retire follows.

## 2026-09-12 — Sized the 40-property residual from B2: a small, named slice of C2g (Cowork)

Continuing after B2's retirement, sized the 40-property residual flagged there (gov properties with a
working `asset` anchor that were never resolved to an owner in `lcc_property_owner` at all — distinct
from the 2,496-property mint gap, which is `C2e-T2b`).

**Findings:** these 40 are stuck, not merely queued — anchors range from 2026-04-24 to 2026-08-19 (up
to ~4.5 months old) with no resolution having landed. Two sub-shapes: 10 of 40 carry a real
`assessed_owner` name (LLCs, a trust, an individual, a corp, a city) and simply never resolved; the
other 30 have no `assessed_owner` at all despite a `true_owner_id` and a working anchor — thinner data
than the first ten, worth separating before diagnosing either. Checked and ruled out: not a
`cmbs_discovery`-status artifact (all 40 are `status='active'`); not a timing/backlog-catch-up issue
(ages rule that out).

**This is very likely the same machinery as `C2g`** ("why are 489 anchored owner-orgs still
unresolved?" — `lcc_reconcile_property_owner`'s 0.55 confidence gate, a dia-operator-in-owner-slot
case, or a cross-domain anchor), just counted at the property level with no Salesforce-people filter,
so the two counts (40 vs 489) aren't directly comparable. Filed as `C2g-40` right under `C2g` in
`PLANNED-BACKLOG.md` rather than as a new independent row — per the repo's own standing rule against
building a second detector for the same defect class, this should be diagnosed alongside C2g's own
investigation, not separately.

No build taken. Docs updated: `PLANNED-BACKLOG.md` (new `C2g-40` row).

## 2026-09-12 — B2 retired: it's `C2e-T2b`, not a separate gap; asset-anchor coverage re-measured live (Cowork)

Picked B2 as the next gap after PR-scanner-3, per the standing "measure before building" discipline
and the row's own `owner_needs_salesforce` warning about wrong-key artifacts. Re-derived the real join
chain instead of trusting the row's 9,830/6,362/3,468 figures: `properties.true_owner_id` (gov) →
`external_identities(source_system='gov', source_type='true_owner')` (LCC Opps) → gov `asset` anchor →
`lcc_property_owner`.

**Found: B2's premise was itself a wrong-key artifact, the exact class its own warning named.** Of
9,842 live gov properties carrying a `true_owner_id`, only 163 (1.7%) are unindexed at the identity
layer — 97.7% already ARE indexed as a `gov/true_owner` identity. "Never reached the entity graph" is
false at that layer. The real bottleneck is asset-anchor coverage: **2,496 properties have no gov
`asset` entity anchor at all** (resolution can't even be attempted — the anchor-then-resolve chain
never starts), plus a small, previously-uncounted **40-property residual that IS anchored but was
never resolved to an owner link**.

**This 2,496-property gap is not new — it is `C2e-T2b`** (`connectivity-and-open-threads.md` §4k.1),
sized 2026-08-28 at 2,241 properties / 2,054 owners, already measured safe-to-run and low-value, and
already left as an explicit, un-taken decision for Scott ("safe to run, low-value to run. No default
taken."). The two-week population growth (2,241 → 2,496) is ordinary property-intake drift, not a new
finding. `PLANNED-BACKLOG.md`'s `B2` row had drifted out of sync with `C2e-T2b` and was carrying stale,
wrong-key numbers as if it were a distinct, still-unsized gap — retired into a pointer at `C2e-T2b` so
there is one authoritative row for this population, not two disagreeing ones.

**New, smaller finding not previously counted anywhere:** 40 gov properties that DO have an asset
anchor but were never resolved to an owner in `lcc_property_owner` — distinct from T2b's mint-eligible
population (T2b is entirely about properties with no anchor yet). Small enough to be worth a quick
look on its own rather than folding into the T2b decision.

**No build taken** — T2b remains explicitly Scott's call, and this session did not override that.
Docs updated: `PLANNED-BACKLOG.md` (`B2` row retired/redirected to `C2e-T2b`).


## 2026-09-12 — ID2b-caps SHIPPED: rpc_query_comps carries operator_id, the cap-rate band fragmentation is fixed

Closed the row filed earlier today (ID2b-caps, prompt `prompts/ID2bcaps-comps-engine-operator-id-passthrough.md`
→ `prompts/done/`). `rpc_query_comps` (Dialysis_DB, applied live) now returns `operator_id`/`operator_canonical`
(ID2a registry, survivor-resolved via `dia_operator_survivor`) on the sale and listing arms, additive-only —
appended via `jsonb || jsonb_build_object(...)`, never editing an existing key, so `mcp/comps-tools.js`'s comp
SELECTION/scoring (`operatorTier`/`compTenantText`, which read only the pre-existing fields) cannot have
changed. New pure `planOperatorCapRateBands()` in `market-brief-psql-tick.js` groups the TTM cap-rate band on
`operator_id` when resolved, falls back to the old raw-tenant-text grouping for the ~20% of dia properties
ID2a hasn't backfilled yet, and supersedes the stale text-keyed fragments a resolved id makes obsolete via a
new `retireStaleFact()`.

**Verified live on the tick's own TTM window (2026-09-12):** the exact fragmentation the earlier dry-run
found — `Fresenius` vs `Fresenius Medical Care`, `DaVita` vs `DaVita Dialysis` — is gone: DaVita (72 comps)
and Fresenius Medical Care (68 comps) each collapse into ONE band, both well clear of the `MIN_N_CAP_BAND=5`
floor. The residual `:fresenius_medical_care`(13)/`:davita_dialysis`(12)/`:davita_kidney_care`(5) text bands
are comps whose linked property has no resolved `operator_id` at all — a coverage gap (ID2a backfill sits at
80.1%), not the fragmentation defect re-emerging; they are correctly kept separate rather than guessed into a
bucket.

**One defect caught by the test suite before shipping, not by a live probe:** the first draft of the
retire-stale-key logic would have retired a `fact_key` the SAME run's own unresolved comps still needed as a
genuinely live band, whenever a resolved operator and an unresolved property happened to share the identical
raw tenant text. Added a guard (never retire a key this run also emitted) and a regression test for it before
this went anywhere near the live DB.

Guard `test/id2b-caps-operator-id-bands.test.mjs` (12 tests, all pass). Full suite: 6,044 pass / 0 fail / 6
skipped (all pre-existing skips, unrelated). `MARKET_BRIEF_PSQL` not touched (MB-b's call). Full writeup +
sized ID2b-remaining follow-up (CM views, dossier, MCP tools): `docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md`.
Backlog rows ID2b-caps and MB1e (item 1) updated to ✅ in `docs/os/PLANNED-BACKLOG.md`;
`docs/architecture/EXEC-BRIEFS-SPEC.md` §9 addendum added.
## 2026-09-12 — HP1-P1a ANSWERED read-only: it is NOT a Salesforce hygiene gap. The opportunity feed has written 5 rows in 36 days.

HP1 framed the frozen deal backbone as *"a Salesforce hygiene gap or a Power Automate scope gap — do
not assume"* and sent Scott to check Salesforce. **Both options were wrong, and one column settled it
without leaving the database.** `bd_opportunities.last_synced_at` is stamped unconditionally on every
ingest write (`mcp/opportunity-sync.js:217`), so it records *the feed touched this row*, independently
of whether anything changed. Its write history:

| date | rows written by the SF feed |
|---|---:|
| **2026-08-03** | **590** ← one bulk backfill |
| 2026-08-04 | 15 |
| 2026-08-20 | 1 |
| 2026-09-03 | 1 |
| 2026-09-07 | 2 |
| 2026-09-09 | 1 |

**Five rows in 36 days — and one of the five is `Test Property SN 05032024`.** Of 569 CLOSED
opportunities, **zero have been synced since the backfill** (`max(last_synced_at)` on closed rows is
2026-08-04 21:00:45, the backfill itself). A brokerage does not go 36 days with no closes. **The feed
ran once and stopped.** The surviving five carry `:00:4x`-second timestamps on the hour, which reads
like a scheduled flow that still fires and delivers almost nothing — a too-narrow filter or a broken
query, not a dead trigger. Distinguishing those two is a **Power Automate run-history** question, not
a Salesforce one.

⚠️ **This corrects my own HP1 finding 2c, which said the opposite.** It read *"the table as a whole is
still being written (`max(updated_at)` 2026-09-10, 619 rows), so the pipe is not dead — the
transaction-stage rows specifically have not changed."* **`updated_at` was the wrong column.** It also
moves for LCC-side writers, and the proof is on one row: `DaVita Dialysis - Succasunna - NJ` reads
`last_synced_at` **2026-09-07** against `updated_at` **2026-09-10** — that later change came from
inside LCC, not from Salesforce. Reading `updated_at` as feed liveness produced a confident, plausible
and wrong conclusion, and it is the same class this file documents a dozen times: *the convenient
counter answered instead of erroring.* **For any pushed feed, read the column the WRITER stamps
unconditionally, never the row's own mtime.**

**This re-orders HP1's P1 and kills one premise.** The stale tasks, the 22 past-close deals and the
graveyard My Work are **symptoms of a dead feed**, not of missing task hygiene — so **P1d (the
backbone freshness assertion) is now FIRST**, not last. It should have fired on 2026-08-05 and there
was nothing to fire it: `lcc-bd-sync-health-check` (05:00) and `lcc-feed-freshness-sync` (05:30) watch
other feeds, and `bd_opportunities` is in neither registry. ⚠️ **Do NOT build P1b (the deal-status
confirmation lane) next** — on a stopped feed it becomes a surface that asks Scott to hand-reconcile
data we stopped receiving, which is the producer/consumer inversion, and it would make the outage
*more* comfortable to live with rather than fixing it.

⚠️ **And note what a restarted feed will do on its first run:** 569 closed rows and 37 frozen open rows
will all arrive at once. `lcc_generate_deal_next_steps()` retires on stage change, so a backlog of
real closes lands in one batch — expect a large auto-retire and verify it against the ledger rather
than being surprised by it.

**👤 Scott's step changed:** not "check the stage in Salesforce" but **"open the Power Automate
opportunity-sync flow and read its run history since 2026-08-04"** — is it failing, is it succeeding
with 0 records, or has it been turned off? Each answer is a different fix. Backlog **HP1-P1a** rewritten.

**Next:** HP1-P1d (freshness assertion on the deal backbone) once the flow's state is known; HP1-badge
is unaffected and still ready to build.

## 2026-09-12 — PR-scanner-3 reconciled against the merged desktop response (Cowork)

Read the pasted Claude Code desktop response for PR-scanner-3 in full and independently re-verified
its claims live against both Supabase projects rather than trusting the report text:

- `v_lcc_ownership_history_lane_split` action distribution on LCC Opps matches exactly:
  `agrees` 147, `county_records_needed` 126 (27 human_actionable), `sponsor_spe` 110,
  `mismatch` 101 (37 human_actionable), `all_guarded` 27 (4 human_actionable), 1 null —
  `human_actionable` total unchanged at 68. Confirms the response's "predicted-vs-actual delta
  was exact" claim rather than assuming it.
- The new mirror table `lcc_gov_property_record_coverage` has exactly 254 rows, all synced at one
  single timestamp (`2026-09-12 05:26:52.77913+00`) — confirms it was seeded once, live, and is
  not yet on a recurring sync, exactly as both the response and `PLANNED-BACKLOG.md`/`STATUS.md`'s
  own PR-scanner-3 entries already disclose.
- **Deploy status, both Railway services** (per the repo's standing "redeploy both" rule for engine
  changes): `tranquil-delight-production-633f.up.railway.app/version` returns `bd679c4321c8` —
  byte-identical to this change's merge commit (`bd679c43`), so it is live at the correct commit.
  The standalone MCP service (`life-command-center-production.up.railway.app`, the `mcp/` directory)
  does not import any file this change touched (`ops.js`, `api/_shared/gov-property-record-coverage.js`,
  `api/_shared/ownership-lane-split.js` are all outside `mcp/`) and exposes no git-sha `/version` route
  to check directly — its own `/health` reports a static `"version":"1.0.0"`. **Conclusion: this
  shipment did not require a second-service redeploy, and none is owed.**
- CC's own doc updates (`PLANNED-BACKLOG.md` PR-scanner-3 row, `ownership-history-lane.md` §5,
  `research-workbench.md` §7d, and this file's PR-scanner-3 entry above) were read in full and found
  accurate, complete, and consistent with the live numbers above — no corrections needed.

**Outstanding decision for Scott, not yet made:** the `lcc_gov_property_record_coverage` mirror was
seeded once (254/254 rows) and has no recurring sync. It will silently drift stale as A2/A3 apply
tasks and PR-scanner-1/2 scans change gov's `parcel_records`/`tax_records`/`deed_records` — a stale
mirror can only ever fail *safe* (an unsynced row stays at its base action, `IS FALSE` not `= false`),
but it will under-report `county_records_needed` over time rather than staying accurate. Options:
(a) schedule `syncGovPropertyRecordCoverageForOwnershipLane()` on a cron now (a small follow-up build,
mirroring cron 244/245's cadence), or (b) leave it manual/on-demand until PR-scanner-1/2 show real
adoption (their writers still show 0 rows on either domain as of this reconciliation), since a cron
syncing an unused signal has no payoff yet. No action taken pending Scott's call.

Response filed: `docs/claude-code/responses/done/PR-scanner 3 desktop response.docx`.

## 2026-09-12 — ID2b reconciled: real but not yet visible — the cap-rate fragmentation Scott flagged is unchanged; ID2b-caps drafted

Filed `responses/ID2b desktop response.docx` → `done/`; prompt → `prompts/done/`. **ID2b (PR #2359) shipped one switch:**
`v_market_brief_cms_operator_counts` now groups on `properties.operator_id` through `dia_operator_survivor` — verified live,
0 rows lost (6,695 → 6,695), Satellite's two spellings collapsed into one bucket of 69, plus a repo-wide class-guard test.
It corrected the prompt's own figure (**96** grouping-relevant views, not 45 — the remainder are review/audit surfaces where
raw text is intentionally correct) and **refused to switch `comps-tools.js` blind** because the 5-subject comp-set diff
hadn't been run — the right call, filed as ID2b-c. **What the reconcile found:** the switched view feeds the CMS clinic
counts, which MB1d already withholds behind the staleness gate, so **nothing user-visible changed**. Cowork re-ran the
P-SQL tick's dry run against the deployed build: `cap_rate_ttm_band:fresenius` **n=63** alongside `:fresenius_medical_care`
**n=11**, `:davita` **n=67** alongside `:davita_dialysis` **n=9** — the exact defect that started the identity thread on
2026-09-11, still live. Root cause named: the bands group on the comps RPC's `comp_tenant` **text** and key on
`normKey(text)`, so `operator_id` never reaches the engine's output and every engine consumer re-fragments the same way.
New row **ID2b-caps** with prompt `prompts/ID2bcaps-comps-engine-operator-id-passthrough.md`: return `operator_id` +
`operator_canonical` from `rpc_query_comps` **additively** (existing fields byte-identical, so `operatorTier()` selection
cannot change — proven on 5 subjects), group bands on the id, supersede the text-keyed fragments. Gate: Fresenius 63+11 →
one band n=74, DaVita 67+9 → n=76, whole-market n≈167 unmoved.


> **📦 ARCHIVE (2026-09-14, thirteenth span):** a further run of 2026-09-12 entries was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail5.md`](../history/STATUS_claude-code_2026-09-12_tail5.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.
