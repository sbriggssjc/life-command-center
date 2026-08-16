# Claude Code queue — STATUS

> **START HERE (durable map):** `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` — the surfaces/comps/deploy
> understanding, so a new chat isn't rebuilt from scratch.
>
> **ALL comps code (prompts 22-28) committed to `main` @ `f6adddf0` (in sync with origin).** The gate is a
> **REDEPLOY of both Railway services** (tranquil-delight + standalone MCP) + `BOV_API_KEY` on tranquil-delight,
> then re-import `lcc-openapi.yaml` into ChatGPT + re-paste v1.2.1 bundles, and test the Villages appraisal on
> both surfaces. Follow-up: workbook lacks a 'Secondary/market-range' sheet (high-cap comps excluded, not shown
> — prompt 29 if wanted). Also: rotate `LCC_API_KEY`; Census key (invalid) for prompt 19.


## Milestone 2026-08-15 — voice corpus body-capture PROVEN end-to-end (0 → 24 full bodies)

**Prompt 115 closed the last blocker on the voice corpus. Verified live: `email_bodies` rows with a >255-char
body went 0 → 24** (all `body_format='html'`, 5.7K–248K chars, full `<html>…</html>`). The whole chain is now
proven: Graph sweep → `/api/bridges?_route=ingest` → allowlist (`body` passes, Prompt 114) → queue → worker →
`handleOutlookMessageExtract` → `email_bodies` full body.

**The bug was handler-side, and 115 found THREE defects (two beyond the scoped one):**
1. **Brittle body split** — `bodyFmt === 'html'` dropped content on any casing/shape variance. Fixed: JSON.parse
   if `p.body` is a stringified JSON, lowercase/trim `contentType`, and **sniff HTML from content when
   contentType is missing** — non-empty content ALWAYS lands in `body_html`/`body_text` now.
2. **⚠ Corpus self-drain (the important catch):** the bodyless 5-min forward sweep was upserting explicit
   `body_*: null`, so a re-touch of an already-filled row **erased** its body (last-writer-wins). Fixed: body
   columns are now **omitted, not nulled**, when there's no content — a filled body survives a later bodyless
   touch; a fresh bodyless row still lands NULL by default (no fabrication).
3. **Silent write failure** — `opsQuery` returns `{ok:false}` (doesn't throw) and the handler ignored it, so a
   rejected write looked like a stored body. Now checked + logged as `result.body_persist_error` (+20s timeout);
   deliberately does NOT fail the job (a retry would double-count `total_emails_sent`).

**Backfill applied live** (migration `20260907120000`) — the 24 already-swept rows filled straight from their
stored `enrichment_jobs` payloads, idempotent + reversible, no re-sweep needed. (24 not 25: one swept message has
no tracked party, so the privacy gate correctly created no row — not a miss.) 12 new tests pass; the 6 full-suite
failures are pre-existing on main, unrelated. PR #1755 (handler fix on origin/main).

**Correction to the earlier diagnosis:** my "even the correct-shape payload stored nothing" read was two sweeps
confounded — the 18:41 object-shape sweep likely wrote fine; the 18:55 `setProperty` re-sweep (which dropped
contentType) then nulled the same rows. The `setProperty` flow tweak is unnecessary — the original flow shape was
correct; revert it.

**Two steps remain for the full corpus:**
1. **Railway redeploy of merged main** — the handler fix ships then (the backfill is data-layer, already live).
   Until redeploy, forward sweeps still hit the old handler.
2. **After redeploy, re-run the backward sweep** (`OUTLOOK_BODY_SWEEP_FLOW.md`) to fill the rest of the
   **23,169-row** corpus in place (merge-duplicates updates existing rows; the null-erasure guard makes repeated
   sweeps safe now).

Housekeeping: 115 prompt + response filed to `done/` (Claude Code noted it couldn't find a `done/` dir — it's
`docs/claude-code/prompts/done/`; filed manually).

---

## Post-redeploy status — 2026-08-16 (Cowork): handler fix LIVE, but corpus still 24 — sweep flow is body-broken

PR #1755 merged + redeployed (handler fix live). Corpus body count is **still 24**, and the job data (last 24h,
`outlook.message.extract`) explains it — it is NOT a handler regression:
- **19,184 jobs = the existing INBOUND bridge** (`from` = string, **no `body` in payload**). High-volume Inbox
  ingestion that carries no body → can't fill the corpus. (If inbound bodies are ever wanted, that flow needs the
  same `$select=body`; separate from the voice-corpus/sent goal.) Note the volume — ~19K/day; worth confirming
  it's not a runaway scheduled sweep.
- **50 jobs = Scott's sweep flow's `setProperty` runs** — **bodyless** (the `setProperty` tweak stripped the body).
- **25 jobs = Scott's ORIGINAL 18:41 run** — full bodies → these are the 24 that landed (24 not 25: one no-tracked-party).

**So to backfill the 23,578-row corpus, Scott's sweep flow needs TWO changes before re-running:**
1. **Revert the `setProperty` tweak** back to `"body": @{items('Apply_to_each')?['body']}` — the original shape
   carried the full body; the handler fix now persists it. (`setProperty` was never needed; it broke the body.)
2. **Add backward pagination** (OUTLOOK_BODY_SWEEP_FLOW.md Phase 2 / Part A backward pass) — the current flow has
   no `$filter`, so it only grabs the 25 most-recent Sent and re-running re-pulls the same 25. Cursor walk:
   `&$filter=sentDateTime lt @{variables('cursor')}`, `$top=25&$orderby=sentDateTime desc`, set `cursor`=oldest
   per page, stop on a short page.

With both in + the fix live, body-carrying jobs fill `email_bodies` in place; repeated sweeps are safe (the
null-erasure guard from 115). **Cowork can't trigger PA flows — Scott runs the sweep; Cowork watches the count.**

---

## Last night's runs — 2026-08-15 (Cowork review)

All live crons fired and produced; nothing red. Highlights:
- **Twin assist (106) — FIRST cron fired 05:46 UTC → 40 annotations.** The `property_twin` lane is now pre-ranked
  + sorted (deterministic merges bulk-confirmable, LLM residue scored). New capability live and working.
- **Reachability harvest — 12 open** proposals (04:40 UTC run; accruing after Scott worked the first batch).
- **W9.6 owner-attribution — 8 NEW open** proposals (05:05 UTC; lane refilled after Scott cleared the prior 22 —
  the `correspondence_entity_owner_llc` metric will keep climbing as these are worked).
- **Contact-acquisition — 1 open.**
- **Full-body corpus (`email_bodies`) — still 0 >255-char bodies, EXPECTED:** the Prompt-114 allowlist fix
  UNBLOCKS ingestion (`body` now allowed on `outlook.messages`, verified live) but the Graph body-sweep that
  actually re-pulls bodies isn't built yet (`docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` is Scott's PA build). Bodies
  start landing once that sweep runs.

**Open lanes for Scott right now:** twin assist (40, mostly one-click merges), W9.6 owner-attribution (8),
reachability (12), contact-acq (1) — plus the standing junk / naming / owner-reconcile / SF-assist lanes.

**⚠ Prompt-number collision (housekeeping):** parallel Claude Code streams both used **114** — `114-backward-body-capture-via-bridge.md`
(this voice-corpus task, = `done/114-voice-corpus-body-sweep.md`) and `114-review-lane-drain-and-c360-fold-in.md`
(a separate owner/lane task). **Next prompt should be 115+** to avoid further collision.

---

## Session 2026-08-15h (Cowork) — Marketing: 12 sequential round-trips → throttled-parallel

Branch **`claude/marketing-throttled-pager`**. Frontend only — ships on the next Railway redeploy.

**Two of my own assumptions were wrong, and checking them changed the fix:**
1. *"`select=*` is wasteful."* It isn't — `v_opportunity_domain_classified` is a **matview with 21 columns
   and the mapper reads 19**. A hand-written column list would save ~2 fields and add drift risk against a
   matview. Left as `*`.
2. *"Just parallelise the pages."* **That was shipped and rolled back twice** — QA-27 on dia, QA-33 on gov —
   because N concurrent page requests overwhelm Vercel/Supabase/browser when dashboards stack pagers in a
   `Promise.all`. R2-W-6 reverted dia to serial and wrote the correct answer in the comment:
   *"A throttled-parallel approach (concurrency=4) is the better long-term fix; deferred for both gov + dia."*

**So I built the deferred fix at exactly that concurrency**, rather than repeating the reverted one:
`diaQueryAllThrottled(table, select, params, concurrency = 4)` in `dialysis.js`. Page 0 is fetched with
`includeCount` to plan the rest; results land in a positional array so output order matches the serial
version regardless of completion order; the 2-minute fuse is preserved; **no usable count ⇒ falls back to
the proven serial `diaQueryAll` rather than guessing a page count and silently truncating.**

Marketing's hand-rolled 15-page sequential loop now calls it. **12 sequential round-trips → 3 waves of 4.**
The deferred-retry path stays serial on purpose — it only fires when the first attempt returned zero, and
parallelising a retry after a failure turns a blip into an outage.

Tests: new `test/dia-throttled-pager.test.mjs` (9). The load-bearing ones assert the **concurrency cap
holds at 50 pages** — a future "simplification" to `Promise.all(pages.map(…))` is exactly the twice-reverted
regression, so it now fails loudly. **70 pass** across the three perf/UI suites.

## Session 2026-08-15g (Cowork) — decisions?summary=1: stop paging history for badges

Branch **`claude/decisions-summary-perf`** (`6cf0c443`) · migration
`20260910120000_lcc_decision_excluded_counts.sql` **applied live**.

**Two hypotheses disproved before changing anything** (recorded so nobody re-tests them): it was **not the
SQL** (`v_lcc_decision_open_counts` runs in **85ms**) and **not sequential federation** (`admin.js:8453`
already uses `Promise.all`).

**The actual cost:** summary mode called `fetchExcludedRefs(type)` **once per federated lane**. That function
pages every non-open `subject_ref` for the type in **1000-row sequential pages** and materialises them into a
Set — purely so the caller can read `.size`. Roughly **18 sequential cross-region round-trips to produce 17
integers** (LCC Opps us-east-1, dia us-west-1, gov us-west-2). Summary now reads them all in **one query**
from `v_lcc_decision_excluded_counts`.

**`count(DISTINCT subject_ref)`, not `count(*)`** — `fetchExcludedRefs` builds a *Set*, so `.size` is a
distinct count. `match_disambiguation` has **1,231 decided rows but only 1,044 distinct refs**; a plain
`count(*)` would have under-reported that badge by 187 and every other duplicated lane likewise. Verified
equivalent across all 16 live decision types — **zero mismatches**.

**Fails safe:** if the view read fails (missing view/grant) the code falls back to the paged Set rather than
defaulting the exclusion to 0, which would silently *overstate* every federated badge. The LIST branch is
unchanged — it needs the actual refs, not the size.

Tests: new `test/decisions-summary-perf.test.mjs` (5). One failed first time by matching the code **comment**
that names `fetchExcludedRefs` — the same trap as `panel-redesign.test.mjs`, so it now strips comments before
asserting. **61 pass** across both suites.

### Remaining perf work
1. **Marketing 11,831-row / 12-round-trip pull** — `select=*`, sequential pages, whole table fetched to
   compute mostly counts and one filtered page.
2. **`count=exact` elsewhere** — `fetchFederatedSource` still does one exact count per lane
   (`admin.js:7267`), and `admin.js:566`/`domCount` do `select=*&limit=1` with `count=exact` purely for
   badge numbers. Now the dominant remaining term; measure per-lane before changing.
3. **Cross-region latency** — three Supabase projects in three regions; every federated lane is a
   cross-country round trip. Architectural, not a quick fix.

## Session 2026-08-15f (Cowork) — page-load performance: stale stats + a missing index

Migration `20260909120000_lcc_perf_stats_and_rel_type_index.sql`, applied live.
Triggered by Scott's console capture, which showed a worse daily problem than the panel defects:
`bd_worklist&limit=5` **8,192ms for five rows**, `decisions?summary=1` **16,199ms**, Marketing pulling
**11,831 rows in 12 round-trips** on load.

**Root cause 1 — `entity_relationships` statistics were 26 days stale.** 114,145 rows, last analyzed
2026-07-21, 8,882 modifications since. Autoanalyze fires at 10% of the table (~11,464 rows here), so it sat
under the threshold and drifted for a month. The planner then estimated **2,261 rows where 5 were returned**
and chose plans whose correlated subplans re-scanned **~42,000 organizations per output row**. Fixed at
source by lowering the scale factor — the repo already does this for ~20 smaller tables; the two biggest and
hottest had been missed.

**Root cause 2 — no index on `entity_relationships.relationship_type`.** The bd_worklist CTE seq-scanned
114,145 rows for the 15,981 `associated_with` edges, then re-filtered that CTE once per output row. Indexes
existed on `from_entity_id`/`to_entity_id` only.

| `v_lcc_bd_worklist LIMIT 5` (warm) | before | after |
|---|---|---|
| Planning | 145.3 ms | **15.3 ms** |
| Execution | 1,334.1 ms | **321.3 ms** |
| CTE `owner_link` | Seq Scan, 71 ms | **Index Only Scan, 21 ms** |

Scott's 8,192ms was a cold cache; both changes cut buffer reads as well as CPU, so the cold path benefits
too — but the honest claim is the **warm 4.2×**. Re-measure from the browser for the real number.

**A hypothesis I disproved, recorded so nobody re-tests it:** I assumed `decisions?summary=1` was slow
because the federated lanes ran sequentially. They don't — `api/admin.js:8453` already uses `Promise.all`,
and the underlying `v_lcc_decision_open_counts` runs in **85ms**. The remaining leads are **cross-region
latency** (LCC Opps us-east-1, dia us-west-1, gov us-west-2 — every lane is a cross-country round trip) and
**`Prefer: count=exact`**, which forces a full scan purely to produce a badge number (`admin.js:566` does
`select=*&limit=1` with count=exact). A lane badge needs an honest order of magnitude, not an exact count.

**Also open:** Marketing's 11,831-row / 12-round-trip pull — `select=*`, sequential pages, whole table
fetched to compute what is mostly counts and one filtered page.

### ⚠️ Note on the divider retest
Scott retested the drag on build `5dedbb9f2026`, which is **before** the divider fix (`d4bf43cd`,
branch `claude/panel-divider-split`, unmerged). The geometry was unchanged because that build still has the
74px-travel clamp. Merge + redeploy before retesting.

## Session 2026-08-15e (Cowork) — P112 A2 enrolment + the four sweeps nobody scheduled

Migration `20260908120000_lcc_p112_a2_enrol_and_schedule.sql`, applied live, batch `a2_enrol_20260815`.
Write-up: `connectivity-and-open-threads.md` §4d.

**The bigger gap, found on the way in: NONE of the P112 sweeps were scheduled.** 112's write-up flagged only
`resume`; in fact **no cron referenced any P112 function** — retire, resume and stamp were built, verified,
and never ran again, so the consumption loop the prompt existed to close had not closed. Now scheduled
06:20–06:35 daily in dependency order **retire → resume → enrol → stamp** (jobids 226–229). All four
dry-ran to **0** first, so this is maintenance, not a pending bulk change.

**A2 — my raw count overstated it a fourth time.** 1,420 owners → 110 reachable → 99 with no active cadence
(*the number I quoted*) → **44 pass the same gate the retire sweep uses**, measured via the **canonical
`lcc_entity_cadence_reachable()`** rather than my ad-hoc query — which is precisely why my number kept
disagreeing. **41 enrolled**; the other ~58 fail the value gate and are **correctly excluded, not a gap**.
Active surface 278 → **319**. Re-run enrols 0.

### ⚠️ NEW UNIT (not fixed) — brokerages recorded as property owners, 46 rows

The first dry-run put **Marcus & Millichap** ($4.99M) at the top of the enrolment list — one step from
cold-prospecting a competitor's brokerage as a landlord. 42 rows from `relationship_graph`, 4 from
`domain_true_owner`, **0 from `supersession`** (the guard I added yesterday held). Two classes:
**(a) ~35 suffix-polluted** (`DP Brighton LLC by Marcus & Millichap`) — owner correct, name carries the
CoStar `by <broker>` suffix that `detail.js` only strips *on render*, so the pollution rides into exports,
comps and dedupe; **(b) ~11 pure brokerages** — owner wrong. `lcc_owner_name_is_brokerage()` is the
ready-made detector. **This is the next data unit.**

### Revised plan

1. **Brokerage-as-owner cleanup** (46 rows, two classes) — highest-value data unit; the detector exists.
2. **UI-0** — the uncaught JS error on the Ownership tab. Still needs one console line from Scott
   (diagnostic in `panel-redesign-verification.md` §4.3); it is the only HIGH I cannot close blind.
3. **Re-run manual checks M-2/3/4/5** — the UI-1/2/3 fixes are now merged and deployed but unverified.
4. **Side-by-side panels** — blocked on renderers writing to singleton `#detailBody`/`#detailTabs`.
5. **34 assets with a NULL `domain`** — silently excluded from every coverage rollup.
6. **Supersession review view** — 323 assets awaiting human verdicts (236 ties · 59 person · 18 brokerage).

## Session 2026-08-15d (Cowork) — SUPERSESSION tier shipped: owner resolution 49.2% → 59.0%

Branch **`claude/owner-supersession-tier`** · migration `20260907120000_lcc_owner_supersession_tier.sql` ·
**applied live**, batch `supersede_20260815`. Full write-up: `connectivity-and-open-threads.md` §4c.

**The defect.** `lcc_reconcile_property_owner` sets `confidence = top_score / SUM(all scores)` — the
winner's **share of the vote** — with recency decay floored at 0.25, so a 20-year-old transaction never
stops voting. Ownership is a **chain with a most-recent link**, not an election. Live: **741** assets had
evidence and no owner; **all 741 multi-candidate, NOT ONE passed the 0.55 gate** (avg share 0.407). More
evidence makes it *worse*. **295** already carried a curated `domain_true_owner` and still lost.

**Two guards the live dry-run forced — the design changed because of the data:**
1. **Brokerages were about to be written as property owners** — `Matthews™`, `Colliers`,
   `Coldwell Banker Commercial®`, `PeerRealty`: the broker on the transaction modelled as the purchaser.
   `entity_type` said `organization` for every one, so the shape guard could not catch it; only sampling
   the **names** did.
2. **An operator leaked** ("Satellite Dialysis") — root cause a **flag-coverage gap at source**:
   "Satellite Healthcare" (56 properties) was already flagged `is_operator_not_owner`, its sibling rows for
   the same operator were NULL. Fixed in dia and propagated **by ID**, per CLAUDE.md's "use the existing
   flag, never write a second name-based operator test."

| | Before | After |
|---|---|---|
| assets with a resolved owner | 1,910 (49.2%) | **2,294 (59.0%)** |
| owner entities | 1,118 | **1,420** |
| `reachable_hero_effective` | 228 | **262** |

418 written · ledger reconciles exactly · **re-run resolves 0** · reversible by batch tag.
**323 assets to `v_lcc_owner_supersession_review`** (236 ties · 59 person · 18 brokerage · 10 no-org-marker)
— a **VIEW, not a table**, so it self-drains and cannot become another un-consumed producer (Prompt 114's
lesson).

**New hygiene finding:** assets rose 384 while 418 rows were written — the other **34 targets are
`entity_type='asset'` with a NULL `domain`**, so every `domain in ('dia','gov')` rollup silently
under-reports them.

**Still true:** resolving an owner does not make them reachable. The *share* stays ~20% because each
resolved asset adds owners to the denominator — quote the absolute count. **~478 owners remain solvable
only via the paused SOS-direct path.**

### ⚠️ TWO branches to merge, in this order — `main` has NEITHER

```powershell
git checkout main
git merge claude/panel-ui-defects-manual-run   # UI-1/2/3 + the entityLink apostrophe fix
git merge claude/owner-supersession-tier       # this session's data work + docs
git push origin main
```

A sandbox `git merge` could not run (VS Code holds `index.lock` continuously). Any conflict will be
additive text in `STATUS.md` / `panel-redesign-verification.md` — keep both sides.

## Session 2026-08-15 — Prompt 114 (voice corpus): the bridge fills `email_bodies`, and its allowlist was stripping `body`

**Root-caused why the voice corpus (`email_bodies`) has 23,169 rows ALL with empty body**, and fixed it.

- **`email_bodies` is written by EXACTLY ONE path** — the bridge handler
  `handleOutlookMessageExtract` (`api/_shared/bridge-handlers-outlook.js`), reached via
  `POST /api/bridges?_route=ingest&_source=outlook&bridge=outlook.messages` → worker drain. It reads the
  FULL Graph body (`p.body.content`) and upserts on `(workspace_id, internet_message_id)` with
  merge-duplicates (so a backward re-sweep fills existing empty-body rows). **This SUPERSEDES the Prompt-110
  assumption that `/api/intake?_route=outlook-message`/`outlook-sent` feed the corpus — they don't**
  (`intake.js` writes body to `staged_intake_items`/`activity_events`, never `email_bodies`; confirmed —
  `intake.js` is not among the `email_bodies` writers).
- **THE BLOCKER (found via the "verify contract live first" house rule):** the ingest receiver strips any
  field not on the bridge's per-object allowlist (`applyAllowlist`) BEFORE enqueue. The `outlook.messages`
  `Message` allowlist did **not** include `body`, so the full body was dropped at ingest and every row landed
  `body_text = body_html = NULL`. A sweep would have "succeeded" green while filling nothing.
- **Fixed:** migration `supabase/migrations/20260905120000_lcc_p114_outlook_body_allowlist.sql` adds `body`
  to that allowlist (**applied live** to LCC Opps — config is live-immediately, no deploy). Reversible.
- **Scope decision surfaced (Part 1):** the handler's tracked-contact gate means the corpus = deal/BD-relevant
  mail (recommended Option A, no writer change). Tracked-vs-untracked split can't be measured from LCC data
  (untracked traffic is never stored) — needs a mailbox-side count. `email_bodies.is_sent` is a weak heuristic
  (from-not-tracked), NOT "Scott sent it"; the reader correctly gates on `from ∈ SCOTT_FROM`.
- **Readers confirmed (Part 3):** `draft-assist.js::loadCorpus` + `voice-corpus-clean.js::pickBestBody` already
  read `body_text`/`body_html` (fallback → `body_preview`), gated on presence not length — no reader change.
- **Deliverable:** `docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` — the backward+forward Graph→bridge sweep,
  copy-paste (full-`body` `$select`, `X-LCC-Source-User-Id` = Scott's `lcc_user_id`, `records[]` array,
  high-water-mark backward bound, worker drain). The Graph sweep is Scott's PA build; the live
  POST-through-endpoint + worker-drain is the operator step (the ingest blocker that would have made it
  silently no-op is now removed).

## Session 2026-08-15 (Cowork) — property + owner panel redesign (IA + panel shell)

Spec: **`docs/architecture/property-owner-panel-redesign-2026-08.md`** (normative target state; supersedes the
open P1.5 / P1.6 / P3.3 items in `property-tab-ux-review.md` + `contact-owner-sidebar-design.md`).
Trigger: Scott's walkthrough opening a true owner (Rem Management) from a dia comp — owner-CRM content on a
property tab, one owner name rendered four times, tab bar wrapping, no way to widen/move/park a panel.

**Placement rule adopted:** the property panel answers *what is this asset and what is it worth*; the owner
panel answers *who controls it and what do I do about them*. The owning panel renders the interactive version;
the other renders a read-only one-liner that links across.

**Shipped (frontend only — no DB, no API; ships on the next Railway redeploy of merged `main`):**
- **Panel shell.** Widths are now CSS vars `--panel-primary-w` (520→**720**) / `--panel-companion-w` (480→**620**)
  so `.companion-panel` + the resizer strips track the primary (they were hard-coded `right:520px` in three
  places — the reason the primary was never widened). Added drag-to-resize with persisted width
  (`lcc.panelw.*`, double-click resets), a **⇄ swap** control in both headers (promote the companion into the
  wide slot), and a **minimize tray** holding any number of parked panels — replacing the single vertical
  restore tab that was hard-coded to the label "Property" even when it held an owner.
  `DUAL_DOCK_MIN_WIDTH` 980→1180. At 720px the 7 property tabs fit one row.
- **Property `Ownership & CRM` → `Ownership`.** Removed from the tab: Ownership Assistant, contact roster +
  contact-edit inputs, Recent Touchpoints, Salesforce Activity Feed, Log Call/Activity form, Draft Email engine,
  per-row CRM-coverage bar, per-row "Sync & Begin Prospecting". Every destination already existed on the owner
  panel, so this was a deletion + a hand-off, not new construction. Added **`Work this owner →`** (hero on the
  Current Owner card + footer repeat) as the seam between the property ladder and the owner ladder.
  Also: `Log Touchpoint` dropped from Overview Actions (a touchpoint is logged against a party, not a building);
  Research Notes relocated to Overview › AI Research; completeness rail capped 6→4 chips (it wrapped to two rows
  and pushed the Next-step card off screen); owner-ladder collapses to ONE card when recorded == true owner.
- **Owner panel:** rail chip pointed at the dead tab name `Portfolio` → `Ownership`; Deal tab's Property
  Reference no longer repeats the Property tab's tenant/guarantor/term/SF snapshot.

**Review-caught defects fixed before hand-off (a verification agent read the whole diff):**
1. **`_udSaveOwnership` would have nulled `true_owners.contact_1_name` on every save** once the contact inputs
   were removed (`contactName` read null, payload still sent the key). Now gated on `_contactFormPresent` and
   the key is OMITTED when the form isn't rendered — never-clobber doctrine.
2. `_udWorkOwnerCta` double-escaped the owner name (`esc()` then `.replace(/'/…)` matches nothing), producing a
   broken `onclick` for any name with an apostrophe. Both it and the older "research owner →" link now use an
   `encodeURIComponent`/`decodeURIComponent` round-trip.
3. Tray de-dupe signature ignored the companion descriptor's `propertyId`, collapsing every dock-parked property
   to one chip. 4. Swap/restore lost the property summary (dock rendered "(property)"). 5. Tray restore routed on
   a never-cleared `_activePrimaryKind`, which could dock a lone companion with no primary beside it.
   6. Cache-busters bumped on `app.js`/`detail.js`/`ops.js` + added to `styles.css` (a half-cached client would
   have had the new CSS hiding the old restore tab = un-recoverable minimize). 7. Resizer strips moved INSIDE
   their panel's left edge so they stop covering the neighbouring panel's scrollbar. 8. Width clamps are now
   viewport-aware (independent 1100+900 maxima could push the companion off-screen on a smaller monitor).
   9. `_ownerDrawerBeginProspecting` scrolled to the deleted `#udLogCallForm`; now opens the owner panel.
   10. Owner-name normalizer could report false agreement on an empty residue; requires ≥4 chars.
   Also removed a pre-existing stray `</div>` in the Current Ownership section.

**Verified:** `node --check` on detail.js / app.js / ops.js; `node --test test/w3-6-comp-lane-clarity.test.mjs
test/cm-native-chart-injector.test.mjs` → 221 pass / 0 fail; div-balance check on every touched renderer
(`_udTabOwnership`, `_udOwnershipLadder` both branches, `_udCurrentOwnerCard`, `_udOwnerHandoffCard`,
`_udResearchNotesSection`, `_udWorkOwnerCta`) → balanced; orphaned handlers (`_loadTouchpoints`,
`_loadActivityFeed`, `_loadEmailTemplates`, `_udSubmitLogCall`, `_udGenerateDraft`, `_udOwnerBeginProspecting`)
confirmed DOM-guarded so they no-op rather than throw.

**Follow-ons (deliberately not built):** free-floating draggable windows with a window manager (validate the
docked-resize model in use first); relocating `Diligence & Vendors` off the owner Deal tab to property Documents;
deleting the now-unreachable CRM handlers once Scott confirms the move; the lease-dedupe / cap-recompute data
work (Findings B/C) is unchanged and still open.

### Verification pass (same session) — `docs/architecture/panel-redesign-verification.md`

Standing rule adopted: **no design item is done until it has a row in the evidence matrix with a check
someone else could run.** New suite `test/panel-redesign.test.mjs` — **47/47 pass** (behavioural: the new
pure functions sliced out of the live `detail.js`; structural: assertions that the CRM surfaces really left
the property tab, that widths are var-driven, that cache busters move together).

**Two live defects were caught by the first test run, after a full review had passed them:**
- **The viewport width clamp did not work.** Each panel was clamped against the *other panel's minimum*, so
  on a 1400px screen primary→920 and companion→860 were each "valid" while totalling 1780. Now budgets
  against the other panel's *actual* width.
- **The apostrophe fix was still broken.** `encodeURIComponent` does NOT escape `'` — `O'Brien Holdings LLC`
  still emitted a raw quote and the `onclick` was still a SyntaxError. New `_jsStrArg()` percent-escapes
  `'` and `"` explicitly; the test now *parses and invokes* the emitted handler rather than pattern-matching it.

**Live data audit (LCC Opps, read-only) — the chain the layout drives:**
assets 3,886 → **1,396 (35.9%) with a resolved owner** → 690 owner entities → **104 (15.1%) reachable by any
route** (50 via the org record + 60 via a linked person) → 134 on cadence, **all 134 overdue**.
- **The binding constraint is contact reachability, not UI.** The `Work this owner →` hand-off resolves to
  *"Find a contact"* for ~85% of owners, and that chain is paused / CI-blocked. The redesign did not create
  the gap — it stopped hiding it (the old property-tab Log Call form let you log activity against an owner
  you had no way to contact).
- **Cadence is a producer with almost no consumer:** of 1,905 rows, **1,728 (91%) have never been touched**,
  only **23** are due in the future, only **7** carry a rep, oldest overdue **2021-09-06**. Textbook
  Consumption-Layer failure; flagged, not fixed here.
- **Data-quality defect surfaced:** 3 cadence rows carry `last_touch_at` in the FUTURE (max 2026-10-15) — a
  writer is stamping a scheduled date into the completed-touch column.

## Session 2026-08-15c (Cowork) — prompts 111–114 ALL DONE + merged; plan revised

PRs **#1750 / #1751 / #1753 / #1754** merged to `main` (`e7999e79`). Prompts + responses archived to
`docs/claude-code/prompts/done/` and `responses/done/`. Consolidated end-state:
`docs/architecture/panel-redesign-verification.md` **§3.0**.

| Leg | Start of day | Now |
|---|---|---|
| assets with a resolved owner | 1,396 (35.9%) | **1,910 (49.2%)** |
| distinct owner entities | 690 | **1,118** |
| `reachable_hero_effective` | 56 (8.1%) | **228 (20.4%)** |
| reachable-in-data / invisible-in-UI | 47 | **0** ✅ |
| cadence active surface (nothing deleted) | 1,214 | **278** (1,627 reversibly paused) |
| cadence rows with a rep | 7 | **37** |
| `last_touch_at` in the future | 3 | **0** ✅ |

**Each prompt overturned its own brief's premise — that is the useful part:**
- **111** — the gap is *decision-maker discovery*, not contact enrichment (585 of 586 unreachable owners had
  no person known). My "1,469 gov manager names" headline sat almost entirely off this population (22 gain a
  name, **0** gain a contact). The pipe wasn't broken, it was **aimed elsewhere**.
- **114** — the review lane was **not** 101 decision-makers: 22 person-shaped, **77 organization-shaped**
  (mostly transaction counterparties captured by the CoStar sidebar), 2 blocked. **A single "confirm" button
  would have written the wrong shape for most of the backlog.** Three shape-aware verdicts instead.
- **112** — the cause was **not** a bulk stamp or a missing consumer. R63's `bdSignalFromFacts` accepted a
  **bare Salesforce identity** as a BD signal; that one arm carried **930 of 1,113** prospecting cadences
  (897 never touched, **0** with an open opportunity). The $500k floor was short-circuited before it was ever
  consulted. SF is a capture surface, so the gate was admitting the whole SF contact book.
- **113** — P0.2 own-deal buyer **skipped as data-thin** (17 assets, below the brief's own 50 floor); P0.3 was
  promotion not capture (1,699 assets had an owner never promoted). **The operator guard blocked MORE than
  the feeder promoted** — dia files the tenant in the owner slot on 7,926 of 11,783 properties.

**My published numbers were wrong three times** (§3.0.1): the 104-reachable baseline, the "94 unreachable on
cadence" figure (does not reproduce), and "the rep backfill is a dead end" (it wasn't — 30 resolvable).
**Rule adopted: quote `v_lcc_owner_reachability.reachable_hero_effective` and the canonical predicates —
never hand-roll a reachability query.**

### Still open after 111–114

| # | Item | Size / note |
|---|---|---|
| **UI-0** | Uncaught JS error on the property Ownership tab | **HIGH** — needs one console line; diagnostic in verification §4.3 |
| **UI-1/2/3** | Resize doesn't drag · owner chip only sometimes docks · swap does nothing | manual run 2026-08-15 |
| **SxS** | Full detail side-by-side (Scott) — blocked on renderers writing to singleton `#detailBody`/`#detailTabs` | spec §1.2 superseded; consequences in verification §4.2 |
| **112 A2** | **89 reachable owners have NO active cadence** — never built; grew 65 → 89 with the owner population | the only item that *adds* pipeline |
| **112** | `lcc_p112_resume_workable_cadences` built but **not scheduled** | one cron line; closes the auto-resolve loop |
| **112** | 68 cadence rows overdue > 1 yr on stale date arithmetic | re-baselining question, flagged not fixed |
| **113** | **Resolver supersession tier — sized at +465 assets, not built.** `lcc_reconcile_property_owner` sums evidence with decay floored at 0.25, so a thrice-sold building reads as three competing claims (conf 0.33–0.50). **876 assets have evidence but fail the 0.55 gate — the next lever is the resolver, not another feeder.** | awaiting go-ahead |
| **114** | 84 lane rows awaiting human verdicts (forecast 64 reject · 11 same_party · 8 attach · 18 no lean) | needs a human, by design |
| — | Railway redeploy for all merged JS halves, then `npm run verify:deploy` | DB halves already live |
| — | ~250 stale local branches at 0 commits ahead of main | housekeeping |

**Recommended next:** UI-0 → UI-1/2/3 → 112 A2 + the resume cron (small, adds pipeline) → 113 resolver
supersession (+465, biggest remaining data win) → side-by-side.

## Session 2026-08-15b (Cowork) — reviewed the 111 response + Scott's manual-check run

**Prompt 111 = DONE** (PR #1750, branch `claude/owner-reachability-gap-904h3v`, migration already applied
live). **Manual checks M-1…M-12 = partially run**, evidence in `responses/manual checks.docx`.

### 111 corrected this project's own headline number
The "104 of 690 reachable" baseline **I wrote** counted any graph route, but `buildContact360` never walks
`entity_relationships` — so 60 of those owners still saw *"Find a contact"*. **Hero-true was 56 (8.1%).**
Both definitions are now columns on `v_lcc_owner_reachability`; **quote `reachable_hero`**. Recorded as V-3
in the verification doc, with the lesson: *measure the number the operator experiences, not the one the
schema permits.*

111 also caught (V-4) that reusing `dup-pair-planner.ownerCore` for identity made `Realty Income Corporation`
fail to match itself, and scored `Agree Realty Corp` vs `Agree Holdings LLC` at **1.0** — a would-be
automatic write onto the **wrong owner**, caught only by a live dry-run. Now a `CLAUDE.md` footgun.

**Result:** `reachable_hero` **56 → 92 of 690** (batch `ocp_20260815`, 39 fields / 36 owners, ledgered +
idempotent). Lead sizes measured: A (gov `manager_name`) 22 gain a name / **0 gain a contact** — my prompt's
1,469 headline sat almost entirely off this population; B (Salesforce) 19; C (contacts we already hold) 74,
36 auto-safe → built; **D (only via the paused SOS path) ~478 = 82%** — the measured cost of that flag.
The pipe wasn't broken, it was **aimed elsewhere**: `owner_contact_pivot` has 5,159 rows but intersects the
panel's owner graph on 48 of 586.

### Manual run: the IA landed, the panel-shell interactions did not
✅ 720px panel · 7 tabs on one row · 4-chip rail · CRM stack gone from the Ownership tab · ladder collapsed to
ONE card for Rem Management (was 4) · `Work this owner →` renders · Resolve Data Gaps 4→1 · Log Touchpoint
gone from Overview.
❌ **UI-1** resize does not drag · **UI-2** owner chip only sometimes opens the dock · **UI-3** swap does
nothing · **UI-0 (HIGH)** an *uncaught JS error* fires on the Ownership tab — that toast is `index.html`'s
global `onerror` handler, so a real exception/rejection is running. A static pass found no missing references
in `_udTabOwnership` (23 identifiers, all defined), so it is runtime/async. **Needs the console line before
any fix** — diagnostic snippet in `panel-redesign-verification.md` §4.3.

### Design change from Scott (supersedes spec §1.2 in part)
> *"I think we want to see the full detail side-by-side instead of a placeholder that you can swap over to
> the primary."*

The companion dock's summary card is rejected; both slots should host the **full tabbed panel**. This demotes
⇄ swap from "the way to reach detail" to a convenience. **The blocking work is not layout** — every renderer
writes into the singleton ids `#detailBody`/`#detailTabs`/`#detailHeader` and must be parameterised by a
mount root; plus the dual-dock width floor (720+620 > 1180), the tab bar at 620px, and `?d=` encoding only
one subject. Consequences catalogued in `panel-redesign-verification.md` §4.2.

### Queue re-ordered — **114 → 112 → 113**

| Prompt | Change |
|---|---|
| **114 (NEW)** review-lane drain + `buildContact360` fold-in | Created by 111, which left **101 candidates in a lane with no consumer** and proved attaching a person changes nothing because the hero can't see linked people (**47 owners reachable in data, invisible in UI**). The two defects must ship together — either alone looks like a failure. **Run before 112.** |
| **112** cadence | Restated to hero-true: **107 of 134 cadences (80%) are on unreachable owners** (was 94 on the loose definition). New **Unit A2** — the inverse defect: **65 reachable owners have no cadence at all**, so the actionable population is idle while the un-actionable one generates the noise. That is the only unit here that adds pipeline. |
| **113** owner feeders | Added: use `reachable_hero`, never a hand-rolled query; **every asset this resolves enlarges 111's problem** (~87% of new owners will be unreachable, so a good result *lowers* the reachability %) — report absolute counts and pre-state the denominator effect; and a newly-resolved owner must **not** auto-enrol into a cadence. |

### Queued from the audit — prompts 111 / 112 / 113 (drafted, not started)

The three measured flow breaks are registered in `docs/architecture/connectivity-and-open-threads.md` §4b
with a drafted prompt each. Recommended order is **111 → 112 → 113**: 111 unblocks the constraint, 112 stops
the noise that would otherwise swamp whatever 111 unlocks, 113 widens the funnel once the downstream can
carry it.

| Prompt | Break | Headline number | Core finding to act on |
|---|---|---|---|
| **111** owner reachability | BREAK-1 (HIGH — blocks the redesigned flow) | 104/690 owners reachable (**15.1%**) | **585 of 586 unreachable owners have NO person known at all** — this is decision-maker *discovery*, not contact enrichment. Two unlocks need no new fetching: **80** already carry an SF identity, and gov `recorded_owners.manager_name` is populated on **1,469** rows while the LCC owner graph shows **1** named person → a domain→entity **propagation** gap. |
| **112** cadence consumption | BREAK-2 (HIGH — doctrine violation) | **1,728/1,905 (91%) never touched**, 23 due in future, 7 with a rep | **94 owners are on a cadence with no way to contact them** — un-actionable by construction. Includes the `last_touch_at`-in-the-future writer bug (3 rows) and the upstream rep stamp (backfill already proven a dead end). Explicitly licences *retiring* the population rather than building more consumption around it. |
| **113** owner resolution feeders | BREAK-3 (MEDIUM — known, improving) | 1,396/3,886 assets (**35.9%**) | P0.2 own-deal buyer + P0.3 deed→evidence, still unbuilt. Up from ~2% in July, so **size each feeder before building** — the likely win is *promotion* of `recorded_owners` we already hold, not new capture. |

Each prompt carries its grounded baseline, the re-run SQL, the standing discipline (fill-blanks · unambiguous ·
provenance · reversible · idempotent · dry-run default), and an explicit out-of-scope list. All three require
reporting a **before/after** against `panel-redesign-verification.md` §3.2 rather than asserting success.

### ⚠️ Environment: the Cowork sandbox mount denies file DELETE (rename is allowed)

Root cause of the recurring "git lock" errors, verified this session. Git cannot unlink `index.lock` /
`HEAD.lock` after any command that rolls the lock back (e.g. `git status`), so the stale lock blocks the NEXT
command. `.git/_to_delete/` had **31** swept locks going back to 2026-07-31 and `.git/objects` **812** orphan
`tmp_obj_*` files — debris, not corruption. Also **unset a stale `core.hooksPath`** pinned to a dead session
mount (`/sessions/charming-blissful-clarke/...`). Commits still work (git finishes with a *rename*, which is
permitted). **Standing rule: run git writes and pushes from Windows**; from Cowork, sweep locks first. Full
runbook + cleanup commands in §5 of the verification doc.

## Session 2026-08-14 (Prompt 110) — fuller email-body ingestion (past the ~255-char bodyPreview cap)

- **Finding.** The correspondence store keeps only Graph's `bodyPreview` (~255 chars);
  `email_bodies.body_text/body_html` are empty on ~all rows — capping draft-assist RAG (openings, not full
  precedent), the voice profile's sign-off/long-form fidelity (Stage-1 LOW-confidence), and the harvest
  signature-phone arm (can't see full signatures).
- **Key discovery — the ingestion CODE was already ready.** `api/intake.js` already reads
  `payload.body_text`/`body_html`, clamps them (100K/200K), and prefers them over `bodyPreview`; the bridge
  writer already fills `email_bodies.body_text/body_html`. The fields are empty only because the PA flows post
  `bodyPreview` only. **Forward-only flow change + small consumer wiring — NOT a rebuild.**
- **Part A (Scott's step, documented).** Copy-paste PA click-path (mirrors the W9.4 doc): add a "Get email
  (V3)" action after the trigger (Message Id = trigger id, Include Attachments = No), then add
  `"body_html": <Get email V3 → Body>` to the "POST to LCC" body on the flagged-inbound / Sent-Items / bridge
  flows. No LCC redeploy for the endpoint. Verification query on `email_bodies` (text_len/html_len ≫ 255).
- **Part B (code, this PR).** New shared `pickBestBody`/`htmlToText` in `api/_shared/voice-corpus-clean.js`
  (full `body_text` → tag-stripped `body_html` → capped preview → `''`; on-prem regex only, nothing egresses).
  `api/draft-assist.js` `loadCorpus` selects + prefers full bodies (email_bodies + activity_events metadata);
  `api/admin.js` harvest signature arm reads the full body from metadata before the preview. Forward-compatible
  — falls back to the preview cleanly. Cap comment updated; deterministic cleaning unchanged. Guardrail:
  same corpus-hygiene doctrine (Scott's outbound; strip quoted chains; on-prem only).
- **Part C (scoped, NOT built).** ~23K historical rows have empty bodies; `internet_message_id` is stored.
  Recommended: a bounded/resumable PA "Get email (V3) by message-id" backfill loop keyed on
  `internet_message_id`, forward-only-first — its own future unit. (Graph server-side fetch is the fragile
  alternative — delegated auth, likely not reachable from Railway.)
- **Tests.** `test/voice-corpus-clean.test.mjs` (+9 for the helpers), `test/draft-assist.test.mjs` (29),
  `test/reachability-harvest-planner.test.mjs` (50), `test/outlook-recipients.test.mjs` — all green.
- **Docs.** `docs/audits/W10_FULL_BODY_INGESTION_2026-08-14.md` (Part A click-path + Part C feasibility),
  ROLLOUT_STATUS W10.3 line, W10 kickoff "deferred" note retired, `BRIGGS-WRITING-VOICE.md` upgrade-path note.

## Session 2026-08-14 (Prompt 109) — draft-assist flag consistency + fact-validator precision

- **Part A — flag gate now honors env OR registry (the bug).** `api/draft-assist.js` POST-save gate read
  `flagOn(process.env.DRAFT_ASSIST)` ONLY, with no registry fallback — so Cowork flipping the
  `feature_flags_registry` row to `on` (done 2026-08-14) did NOT enable saves; the endpoint still reported
  `save_skipped: DRAFT_ASSIST flag is OFF`. Fixed to the house env-OR-registry pattern via a NEW shared resolver
  `api/_shared/feature-flag.js` (`flagEnabled` + `fetchFeatureFlag`) mirroring `comms-owner-attribution-tick.js`
  / admin.js `w93FlagEnabled`. Precedence: an explicitly-set `DRAFT_ASSIST` env var wins (on OR off — ops
  override); else the registry `state='on'` enables it. **So the already-flipped registry row enables POST-save on
  the next redeploy with no Railway env var.** GET dry-run unchanged (always on).
- **Part B — fact-validator proper-name false-positive.** `validateDraftFacts` flagged **"Quick Check"** (from
  the subject "Quick Check-In") as an ungrounded `proper_name`. Tightened the Title-Case detector with a
  `NAME_STOPWORDS` set (Quick/Check/Follow/Up/Touch/Base/…): a multi-word run made up ENTIRELY of common
  capitalized English words is benign boilerplate and is NOT flagged; a run with any non-stopword token
  ("Kingsbarn Capital", "Boyd Watterson") is still flagged; ungrounded numbers/dates are still STRIPPED
  (cardinal-sin guard intact).
- **Tests:** `test/draft-assist.test.mjs` — the flag structural test now asserts the shared env-or-registry
  resolver (not `process.env` alone) + a unit test for the resolver's precedence; 7 new Part-B name-validator
  cases. **29 pass.** Additive, reversible, one PR.

## Session 2026-08-14 (Cowork, latest) — draft-assist LIVE + 108 backfill verified

- **Prompt 108 (comms_owner_bridge provenance) reviewed + verified live.** Backfill landed: `field_provenance`
  `comms_owner_bridge` **0 → 22**, all 22 in `v_field_provenance_current`; `v_field_provenance_unranked` adds 0
  (fsp row pre-existed — no new drift). Root cause matched the diagnosis (swallowed catch + `JSON.stringify(ownerEid)`
  double-encoded into the `jsonb` param); the response also corrected `p_target_database` `'lcc'`→`'lcc_opps'`
  (the ops-local convention) and factored an RPC-args builder + regression test (23 pass). **✅ Writer fix MERGED + LIVE (PR #1746, redeploy live 2026-08-14)** —
  `origin/main` carries `buildOwnerBridgeProvenanceArgs` + `p_value` as the raw id (double-encoding gone), so
  FUTURE W9.6 confirms now stamp `comms_owner_bridge` provenance correctly. Durable. (Note: Scott's LOCAL checkout
  was briefly behind — `ahead 1 / behind 2` — a sync/pull brings it current; production was never affected.)
- **W10 Stage 2 draft-assist REVIEWED LIVE + FLIPPED ON.** Scott ran two `GET /api/draft-assist` dry-runs on his
  box; both generated on-prem (`qwen2.5:14b`, GaryBuilt reachable). **Voice is accurate** — terse, "Stay tuned",
  "Got it" (echoing his real retrieved exemplars); **never-fabricate proven** — a non-existent `entity_id` yielded
  ALL "Not on file" + `fact_validation.clean=true`, zero invented facts. Corpus 434, deterministic retrieval
  (embedding model not installed → fell back as designed), `voice_confidence` honest about the ~255-char cap. GET dry-run is live and works well.
  **⚠ CORRECTION (later 2026-08-14): registry flip alone does NOT enable POST-save.** A live POST returned
  `saved:false / save_skipped: DRAFT_ASSIST flag is OFF` even with `feature_flags_registry.DRAFT_ASSIST='on'`,
  because **`api/draft-assist.js:260` gates ONLY on `process.env.DRAFT_ASSIST`** — it has NO registry fallback,
  unlike every cron tick (W9.6/harvest/twin check env-OR-`feature_flags_registry.state`, which is why THOSE
  registry flips genuinely worked — verified by their output). So draft-assist is the lone inconsistency.
  **→ Prompt 109 SHIPPED + merged to origin/main** (verified in tree: `api/_shared/feature-flag.js` +
  draft-assist.js now calls `fetchFeatureFlag('DRAFT_ASSIST')`+`flagEnabled`): **Part A** the save gate now honors
  env-OR-registry via the shared resolver, so the already-on registry row enables POST-save on the next Railway
  redeploy — no env var needed (explicit env still overrides); **Part B** `NAME_STOPWORDS` — benign Title-Case
  phrases ("Quick Check-In", "Following Up") no longer false-flagged, real names + fabricated figures still caught.
  29 tests. **Remaining for actual saves:** redeploy origin/main + `PA_OUTLOOK_DRAFT_URL` set on the service.

## Milestone 2026-08-14 — W9.6 lane fully worked; the last connectedness link is now CONSUMED

Scott worked all **22** W9.6 owner-attribution proposals → **22 confirmed / 0 rejected**, 22
`comms_owner_attribution_apply_log` writes landed, lane empty. **Payoff (the metric this unit existed to
raise): `v_lcc_w9_5_link_coverage.correspondence_entity_owner_llc` moved 2.5% (6/241) → 9.3% (24/259).**
Real owner LLCs now carry their correspondence history (ADM Camarillo, Anchor Point Capital, Atwater
Enterprises, Boyd Watterson, DaVita Healthcare Partners, Easterly Partners, …). Each confirmed bridge also
feeds the W9.2 reachability create-contact arm owner-linked threads it couldn't see before (the arms compound).
- **One observability nuance (not a data issue):** `field_provenance` shows **0** `comms_owner_bridge` rows —
  the confirm appends the owner entity to `activity_events.metadata.linked_entity_ids` (a jsonb-array append,
  tracked reversibly by the apply_log), and the provenance ledger (built for scalar curated-field writes) isn't
  stamping the array append. The reversible record (apply_log) is intact and the metric moved correctly; only
  the provenance *visibility* of these bridges is missing.
  - **RESOLVED — Prompt 108 (W9.6 provenance follow-up, 2026-08-14):** the 0-rows was NOT the array-append shape
    — the confirm writer DID call `lcc_merge_field`, but (a) inside a swallowed `catch (_e) {}` that hid the
    failure and (b) passed `p_value: JSON.stringify(ownerEid)`, double-encoding the jsonb param. Fixed both:
    the catch now logs loudly (`console.warn` on non-ok / thrown), and `p_value` is the RAW owner id (the RPC
    casts to jsonb) via the new single builder `buildOwnerBridgeProvenanceArgs` (`api/_shared/comms-owner-attribution.js`),
    stamping `p_target_database='lcc_opps'` (the ops-local convention). **Backfilled all 22 historical bridges**
    (migration `20260814140000_lcc_w9_6_comms_owner_bridge_provenance_backfill.sql`, applied live — one
    provenance row per bridge keyed on each review's `sample_activity_id`, idempotent, reversible by
    `source_run_id='w9_6_provenance_backfill:2026-08-14'`). **Verified live: `field_provenance` `comms_owner_bridge`
    = 22 write rows, all 22 in `v_field_provenance_current`; `v_field_provenance_unranked` adds 0 for
    `comms_owner_bridge` (fsp row already registered — no new drift).** Regression guard: 3 tests in
    `test/comms-owner-attribution.test.mjs` assert `p_value` is the bare id (never `JSON.stringify`).
- **Twin assist (106):** first cron run is 05:45 UTC **2026-08-15** (flag flipped after today's run window), so
  the property_twin lane will be pre-ranked/sorted tomorrow morning (0 annotations now is expected).

## Session 2026-08-14 — Prompt 107 (W10 Stage 2): retrieval-grounded drafting `/api/draft-assist` SHIPPED

**New endpoint `/api/draft-assist` — a Scott-voiced DRAFT generator grounded in his real sent-email corpus + the deal spine. Flag `DRAFT_ASSIST` OFF; GET dry-run is live for review.**

- **What.** `GET /api/draft-assist?purpose=&intent=&recipient=&entity_id=` assembles a draft and returns it + the retrieved exemplar ids + the facts used (+ "Not on file" gaps) + a `voice_confidence` note — **writes nothing**. `POST` (flag-gated on `DRAFT_ASSIST`, `save=true`) saves the draft to Outlook Drafts via the offer-submission `createOutlookDraftViaPA` seam. **NEVER sends.**
- **Doctrine, enforced structurally (not just by prompt):** (1) never-send — the only outbound call on the path is the save-not-send draft seam; (2) never fabricate — facts come from `buildDealPacket`→`extractDealFacts` ("Not on file" for gaps) and the generated draft is run through `validateDraftFacts`, which **strips any number/date not grounded in the facts or the retrieved exemplars** and flags ungrounded names; (3) strategy stays verbal (prompt forbids it); (4) **on-prem generation only — `invokeOnPremGeneration` fails CLOSED, no cloud fallback**, so Scott's corpus never egresses; (5) honest `voice_confidence` about the opening-only (~255-char) corpus cap.
- **Retrieval.** `loadCorpus` reads `activity_events` + `email_bodies`, gates on the `SCOTT_FROM` from-address set (**outbound-only**), cleans via `voice-corpus-clean`, buckets via `classifyDraftType`. Ranks with on-prem Ollama embedding-KNN (`nomic-embed-text`) when reachable, else a deterministic bucket+recipient+recency ranker (serviceable on opening-length text).
- **Files.** Core (pure/testable) `api/_shared/draft-assist-core.js`; handler `api/draft-assist.js`; on-prem seam added to `api/_shared/ai.js` (`invokeOnPremGeneration` + `invokeOnPremEmbeddings`, both fail-closed); mounted in `server.js`; migration `20260901120000_lcc_w10_2_draft_assist_flag.sql` (registers `DRAFT_ASSIST`); tests `test/draft-assist.test.mjs` (**21 pass**); sample sheet `docs/audits/W10_STAGE2_SAMPLE_DRAFTS.md`.
- **U4 hook** left wired (draft-vs-sent edit-distance); send-side capture is a documented TODO seam (not built — it's heavy).
- **Operator step:** redeploy → run a couple of `GET /api/draft-assist?...` and read the sample drafts ("does this sound like me?") → flip `DRAFT_ASSIST`→on (Cowork) to enable Outlook-draft saves. On-prem generation needs `OLLAMA_URL` set on the Railway service; without it GET honestly 502s "failing closed".
- **⚠ Cowork reconcile (2026-08-14): the flag migration was NOT applied by the PR — Cowork caught + applied it live.** Same deploy-ordering slip as W9.1 Stage 2 (migration in repo, never run on LCC Opps). `20260901120000_lcc_w10_2_draft_assist_flag.sql` applied to LCC Opps (additive/idempotent, `ON CONFLICT DO UPDATE`); **`DRAFT_ASSIST` now registered = off** (off_since 2026-09-01), so it shows in the Dormant-Capabilities digest as designed. Response reviewed — clean; doctrine enforced structurally (never-send / fact-validator / fail-closed-no-cloud-egress), 21 tests, one pre-existing unrelated failure confirmed on baseline. 107 response → `responses/done/`.

## Session 2026-08-14 (Cowork, later) — 105 + 106 reviewed & reconciled; CRLF class fixed repo-wide

**Both responses reviewed, verified live, docs reconciled, folder cleaned. Tree fully synced (`main...origin/main`).**

- **Prompt 105 — repo line-ending normalization: SHIPPED to all THREE repos** (each own branch/commit/PR:
  life-command-center **#1738**, Dialysis **#7376**, government-lease **#381**). Root `.gitattributes`
  (`* text=auto eol=lf`, explicit LF text types, `eol=crlf` for `.ps1/.bat/.cmd`, binary block; Dialysis got
  `*.xls binary` for its 34 .xls) + a single `git add --renormalize .` commit per repo — verified pure CRLF→LF
  (zero content changes, no binaries touched, no Windows scripts flipped). **`.gitattributes` confirmed present
  in the LCC tree.** The CRLF-churn class that blocked syncs 3× is now fixed at the repo level; the commit body
  documents the one-time `git rm --cached -r . && git reset --hard` fallback for any Windows checkout still
  showing churn after re-pull.
- **Prompt 106 — property_twin assist: VERIFIED LIVE (flag OFF, ready for review→flip).** Confirmed against
  LCC Opps: flag `PROPERTY_TWIN_ASSIST` = **off**, migration `20260814130000` applied, `lcc_clean_assist_proposals`
  source CHECK widened (accepts `property_twin_assist`), cron `property-twin-assist-tick` scheduled (05:45 UTC,
  jobid 220, no-op while off). Planner `api/_shared/property-twin-assist-planner.js` in tree. See the dedicated
  106 entry below for the full build. **Flip gate (same as 104):** the `?score=1` dry-run needs the authed tick,
  so live per-class counts confirm at the next cron run or a manual tick call — I'll confirm then.
- **Docs reconciled:** ROLLOUT_STATUS gained the property_twin-assist entry (106's own branch edit to it was
  dropped in a merge; re-added). STATUS 104→SHIPPED and the 106 entry already landed via the merges.
- **Folder cleaned:** prompt 105 → `prompts/done/` (104/106 already there); responses 105/106 → `responses/done/`.
- **106 FLIPPED LIVE (Cowork, 2026-08-14) after a clean `?score=1` review.** Dry-run (200 fresh of 1,245
  pending): deterministic decisive 81 (20 bulk-confirmable merges + 61 co-located `not`), LLM residue 119,
  `scan_errors:[]`; verbatim validator dropped non-verbatim LLM quotes (`quote_not_verbatim`), same-address
  operator-change pairs → `uncertain`, Ollama responding. `PROPERTY_TWIN_ASSIST` = on; cron 05:45 UTC now
  annotates + sorts the lane (never merges).
- **104 `?score=1` reviewed — healthy, no flip needed (flag `W9_2_REACHABILITY_HARVEST` already ON).** The
  bounded 120-target window produced 0 `create_contact` candidates, so `create_fanout_suppressed` /
  `create_brokerage_suppressed` are honestly 0 (nothing to suppress in-window — NOT a defect; the guard is
  deployed + unit-tested against the Sharrow fan-out fixture, and fires in production when a fan-out/brokerage
  create_contact candidate appears). Harvest pool still large (dia 4,238 / gov 10,633 unreachable); comms index
  healthy (9,278 header name-pairs, 3,543 signature phones) — the arm walks the pool nightly.

---

## Prompt 106 (2026-08-14) — property_twin lane: deterministic pre-rank + Ollama assist (annotation-only)

**Built the two-layer assist that pre-ranks + sorts the dia property_twin review lane (~1,245 pending) so
Scott clears the 792 same-operator merges fast and spends judgment on the conflict/ambiguous residue.** The
assist ANNOTATES + SORTS — it NEVER merges (the dia `dia_merge_property_reversible` stays a human, reversible
verdict). Layer 1 = a NO-LLM deterministic classifier (`api/_shared/property-twin-assist-planner.js`, reuses
`nameSimilarity`); Layer 2 = Ollama on the uncertain residue with a verbatim-evidence-quote precision floor
and the co-located-plaza footgun few-shot. Store = existing `lcc_clean_assist_proposals` (source
`property_twin_assist`). Tick `GET/POST /api/property-twin-assist-tick` (dry-run `?score=1&n=`; flag-gated
apply; per-class/per-suggest honest counts; `scan_errors`; budget floor). Lane shows the suggestion + evidence,
sorts easy-first, bulk-confirms deterministic merges only (each a human verdict). Migration `20260814130000`
applied live to LCC Opps (source CHECK widened, flag `PROPERTY_TWIN_ASSIST` OFF, U4 self-measure table/RPC/
view, cron `property-twin-assist-tick` 05:45 UTC jobid 220). Tests `test/property-twin-assist.test.mjs` (31
pass) incl. the deterministic classifier, verbatim validator, annotation-never-verdict structural guard, and
the co-located footgun fixture. **Live steps:** redeploy → `?score=1` review → Cowork flips
`PROPERTY_TWIN_ASSIST`.


## Session 2026-08-14 (Cowork) — END-TO-END CONNECTEDNESS AUDIT (verdict→write→consumer, all lanes)

**Traced every lane from Scott's manual verdict → the write → the downstream consumer, live. The loop is
CLOSED in every category. Scott worked a large batch over ~36h; here is what landed and what didn't.**

### ✅ Working end-to-end (verified live)
- **Hygiene lanes — highest throughput, fully closed.** Junk-entity: **203 confirmed → 207 `junk_review_batch`
  reversible ledger rows** (entities soft-retired, FK-referenced → conflict not delete). Naming-hygiene: **350
  confirmed → 368 `naming_hygiene_batch` rows → 40 `field_provenance` `w8_u5_naming_hygiene` writes** (name
  fields stamped; canonical collisions → conflict). Every verdict reversible + provenance-tagged.
- **Resolver-training loop closed.** Owner-reconcile/dup lane → **48 `entity_match_labels` in 36h**
  (w8_u2_ollama_pair 41 `distinct` + 2 `same_party`; w8_u3_shared_email 5 `distinct`) → feeds the W4.4 nightly
  retrain corpus. The "reject is productive" design is real: 41 hard-negatives captured.
- **BD-payoff arm delivering (the point of the whole campaign).** Reachability harvest: **2 confirmed →
  `reachability_harvest_apply_log` status=applied → 2 owners that had ZERO contacts now have a reachable one**
  (Eric Dowling `edowling@boydwatterson.com`→Boyd Watterson; Oscar Peterson `opeterson@uirc.com` +816-682-8097
  →UIRC). Contact-acquisition: **4 confirmed → applied** (2 broker_of_record: Bob Safai / AJ Belt; 2 crossref
  attaches: Nigel Hebborn / Christine Russi Couture) into the entity graph.
- **W9.3 auto-writers landing provenance-stamped.** Re-score `splink_v2` 22 writes; donor-handoff
  `sf_account_contact_expansion` 13 writes (SF keys onto blank contacts) — both in `field_provenance`, last 36h.
- **W9.6 producing.** First cron run 05:05 UTC minted **22 owner-attribution proposals** into
  `comms_owner_attribution_review` (Path A + tightened Path B). Fill-blanks guards healthy repo-wide
  (`folder_feed_lease` 12 `conflict` decisions correctly recorded, not clobbered — now that we fsp-ranked it).

### ⚠ Not landing yet / gaps (honest)
1. **W9.6 lane is the one un-consumed link.** 22 proposals sit at **0 decided**, so `v_lcc_w9_5_link_coverage`
   `correspondence_entity_owner_llc` is still **2.5% (6/241)** — it only rises once Scott works the lane. This
   is the single highest-leverage next action (it also feeds the reachability harvester more owner contacts).
2. **Precision signal is near-zero on the hygiene lanes.** Junk 203 confirm / **0 reject**; naming 350 confirm /
   **0 reject**. Deterministic renames are safe to bulk-confirm, but ~0 rejects means we're not learning where
   the proposer errs on those two lanes (contrast the resolver lane's healthy 41/43 negatives). Recommend
   spot-rejecting a few genuinely-wrong cards to keep the precision floor honest — or accept if the pre-filter
   is truly clean (the batch ledgers make any over-confirm reversible).
3. **Reachability create_contact could tighten.** 2 of the first 4 harvest cards were **rejected** (shared-broker
   `create_contact` — both were **Philip Sharrow `<philip.sharrow@scopecre.com>` fanned across Boyd Watterson AND
   BLOOMINGTON IRS**), the same brokerage/shared-contact noise we fixed in W9.6 Path B. The human gate caught
   them. **→ Prompt 104 SHIPPED 2026-08-14** (`docs/claude-code/prompts/done/104-w9-2-create-contact-precision.md`):
   two deterministic guards on the `create_contact` mint arm ONLY (the deterministic fill-blanks arm untouched) —
   a **fan-out cap** (`RH.createContactFanoutSuppressed`, `HARVEST_MINT_FANOUT_MAX`=2: a contact keyed by email
   (else name) proposed for ≥2 distinct owners → suppress, catches Sharrow; counter `fanout_suppressed`) and a
   **brokerage/advisor-contact guard** (`coaIsBrokerageContact` = reuse of W9.6 `isBrokerageOwnerName` + a new
   `isBrokerageEmail` domain stoplist incl. `scopecre.com` → never mint an advisor as the owner's own contact;
   counter `brokerage_contact_suppressed`). Per-reason counts surfaced in the tick; planner-only, reversible,
   proposal-only unchanged. Tests extended (`test/reachability-harvest-planner.test.mjs`, 44 pass).
4. **owner_reconcile scale.** 43 worked vs a **3,416** open pool — drain rate is slow relative to the pile (not a
   defect; needs sustained work or a bulk-assist). ORE-native seeder pairs (vs the dup-pair subset) are the bulk.

### Net
Every category is connected verdict→write→consumer with reversible ledgers + provenance. The chain now visibly
*produces value* (2 new reachable owners, 4 graph attaches, 43 resolver labels, 575 hygiene fixes in a day). The
only link waiting on a human pass is W9.6 owner-attribution. Docs updated (this entry + ROLLOUT connectedness note).

---

## Session 2026-08-13 (Cowork, later) — prompt 103 reconciled; W9.6 FLIPPED LIVE; folder cleaned

**Prompt 103 (W9.6 Path-B precision + fsp hygiene) reviewed, verified live post-redeploy, and W9.6 flipped ON.**
All PRs merged + Railway redeploy live (Scott).

- **Part A — Path-B precision (the flip gate): SHIPPED + verified live.** Three deterministic guards (no LLM):
  (1) internal-team exclusion — reused the exported `INTERNAL_DOMAINS` (`northmarq.com`/`stanjohnsonco.com`)
  from `voice-corpus-clean.js`, so Scott/Toby are never an owner-attribution subject; (2) brokerage-target
  guard — new deterministic `isBrokerageOwnerName` / `lcc_is_brokerage_owner_name` stoplist drops brokerages
  mislabeled `true_owner` (logged as a KNOWN upstream ORE labeling issue, NOT fixed here); (3) tie-tightening —
  `relationship` tier now accepts only ownership/employment roles (`works_at`/`contact_at` or `metadata->>'role'`
  in the owner/manager set), keeping `active_contact` via `owner_contact_pivot`. RPC gained `rel_role`,
  `drop_reason`, and a `p_include_dropped` param (direct calls noise-free by default; the tick pulls tagged
  noise for honest per-reason drop counts). **Verified live:** Path B clean **28** survivors, **0 internal /
  0 brokerage**, all 5 key owners survive (Boyd Watterson, Kingsbarn, Realty Income, Easterly); dropped-when-
  included **13** (brokerage 10 / internal 2 / loose 1). Path A unchanged (3, always clean). 20 tests green.
- **Part B — `folder_feed_lease` fsp hygiene: SHIPPED + verified.** fsp rows registered for the drift fields at
  the established `folder_feed_lease@45 warn` rank (14 dia.leases fields total). **Drift 39 → 34 baseline;
  `folder_feed_lease` now 0 in `v_field_provenance_unranked`.**
- **W9.6 FLIPPED ON (Cowork, this session)** after the live re-review of the tightened sample met the flip gate.
  `W9_6_COMMS_OWNER_ATTRIBUTION` state=on, off_since cleared. Nightly cron 05:05 UTC now proposes owner-
  attribution edges (Path A property bridges + tightened Path B) into the `comms_owner_attribution_review`
  lane — proposal-only, human-gated, reversible. It lifts W9.5's `correspondence_entity_owner_llc` (2.5%
  baseline) as verdicts confirm, and each confirmed bridge also feeds the reachability create-contact arm.
- **Migration bookkeeping note:** MCP `apply_migration` records under apply-time versions
  (`20260813120707 lcc_w9_6_pathb_precision` + `20260813120838 ..._loose_edge`), NOT the repo filename version
  (`20260830120000`). Same pattern as every prior migration this campaign; effects verified live, repo file is
  the durable source. A future `db push` re-applying the repo file is safe (CREATE OR REPLACE + ON CONFLICT).
- **Folder cleanup:** prompts 100–103 → `prompts/done/`; responses 100/102/103 → new `responses/done/`.
  `responses/` now holds only README + `done/`.
- **⚠ DOC RECONCILE (Cowork, this session):** planning to flip the "remaining dark" Wave 9 units, I found
  **W9.3 (all 3 flags) has been LIVE since 2026-08-08 and W9.1 Stage 1 since 2026-08-12** — the ROLLOUT_STATUS
  rows falsely still said "BUILT — flag OFF." Corrected all rows + the W9 kickoff summary. **Live health
  verified, all conservative:** W9.3 re-score gov 2,000 / dia 2,000 scored → ~72 exact-unique auto-links
  applied (gov 52 / dia 20), **1 conflict correctly guarded (not overwritten)**, 12 → needs_review;
  W9.3 SF-assist 80 annotation-only pre-ranks (zero curated writes); W9.3 donor-handoff slow unique-match
  SF-key fills (gov 5 last night, input-thin as designed); W9.1 green, 5 proposals night one, human-gated.
  **Net: every INTERNAL Wave 9 unit is now LIVE and producing** (W9.1/W9.2/W9.3/W9.4/W9.5/W9.6); only
  W9.1-Stage-2 SOS-direct stays walled (external, `W9_1_SOS_DIRECT` off).

---

## Session 2026-08-13 (Cowork) — prompts 100 + 102 reconciled; harvest's first live night verified

**Both responses reviewed against live LCC Opps and reconciled. Nothing to re-open; two findings logged.**

**Prompt 102 — W9.6 correspondence→owner-LLC attribution (BUILT, verified live, flag OFF).**
- Closes the last major internal linkage gap: correspondence is stamped with the deal/party/property
  entity the resolver found (brokers/buyers/sellers), never the owning LLC → W9.5 measured
  correspondence→owner-LLC at 2.5% (6/241). Two deterministic-first paths: **A** property→owner
  bridge (asset entity → its single current `true_owner`, conf 1.0, unambiguous-only, value-ranked);
  **B** correspondent-person→owner (`owner_contact_pivot` active contact or unambiguous person→owner
  edge; shared-token bridges rejected — the W9.1 false-bridge lesson).
- **Verified live:** migration `20260829120000` applied; flag `W9_6_COMMS_OWNER_ATTRIBUTION` = **off**
  (off_since 2026-08-13); fsp row registered on `public.activity_events.linked_entity_ids @ priority 45
  record_only` (provenance `comms_owner_bridge`); **W9.5 baseline held at exactly 6/241 = 2.5%** (the
  owner-restricted union did NOT dilute the denominator — confirmed against `v_lcc_w9_5_link_coverage`).
  Path-A 3 candidates / Path-B 40 unambiguous live. New DC lane `comms_owner_attribution_review` fully
  75-wired. 27 tests green. Confirm-writer appends the owner ops entity to `metadata.linked_entity_ids`
  — that one anchor feeds BOTH the owner-record history AND the reachability create-contact arm (arms
  compound). Pushed to `claude/comms-owner-attribution-6flfnt` (PR #1714).
- **Live gate — REVISED after Cowork's live dry-run (2026-08-13): DO NOT FLIP YET.** Ran the Path-A/Path-B
  RPCs directly. **Path A (property_bridge, 3) is clean + flip-ready.** **Path B (person_match, 40) carries
  ~9 noise rows (~23%):** 2 internal-team correspondents (Scott 828 rows / Toby 128 → "Stan Johnson Co" via a
  loose `relationship` tie — the loudest cards by volume) + 7 brokerage-as-owner targets (Avison Young/Newmark/
  Kidder/Transwestern/Coldwell mis-modeled as `true_owner`). Human-gated so no bad writes, but below the flip
  bar (the "noise trains the operator to ignore the lane" anti-pattern). → **Prompt 103 drafted** (Path-B
  precision: drop internal-team, guard brokerage targets, tighten the tie) — flip after that lands + redeploy.
  Finding recorded in the dry-run doc.

**Next Claude Code prompt queued: 103** (`docs/claude-code/prompts/103-w9-6-pathb-precision-and-fsp-hygiene.md`)
— **Part A** W9.6 Path-B precision (the flip gate); **Part B** register `folder_feed_lease` fsp rows for the 5
dia.leases responsibility fields (clears last night's drift 39→~34). One PR.

**Deploy still pending Scott:** merge PRs #1714 (W9.6) + #1715 (voice) → Railway redeploy of merged main. W9.6's
tick/cron and the name-backfill route are not in production until then (DB layers already live).

**Prompt 100 — W10 Stage 1 voice profile (SHIPPED, no surface changed, awaiting Scott's read).**
- `BRIGGS-WRITING-VOICE.md` + pure `api/_shared/voice-corpus-clean.js` (19 tests) + on-prem
  `scripts/voice-distill.mjs` (ollama-only, refuses to run if `OLLAMA_URL` unset — corpus never egresses).
- **Honest cap finding preserved:** the correspondence store keeps only Graph `bodyPreview` (~255-char cap);
  `body_text`/`body_html` empty. So the signal is Scott's email *openings* (~31 words) — strong for
  greeting/opening voice, LOW-confidence for sign-offs/long-form (flagged, not faked). Corpus ~926 distinct
  Scott-authored sent emails (Nov 2022→Aug 2026); cold-BD bucket THIN (14). No LLM read the prose in v1
  (deterministic SQL + small anonymized sample); the ollama distiller is the operator's on-prem enrichment
  step (same "mechanism built, heavy pass is Scott's" pattern as SOS/SAM). Pushed to
  `claude/voice-profile-scott-corpus-qofank` (PR #1715).
- **Scott's step:** read `BRIGGS-WRITING-VOICE.md` — does it sound like you? — before any Stage 2 (RAG drafting).

**Last night's runs (checked live):**
- ✅ **Reachability harvest's FIRST live cron fired 04:40 UTC 2026-08-13** — 1 batch, **4 open deterministic
  proposals**, health **green** (`v_lcc_reachability_harvest_health`: proposals_24h 4, open 4, dropped 0,
  LLM 0, applied 0, flag on). All 4 are real owner-email fills for owners with no contact on file, exactly
  matching the dry-run: **Boyd Watterson Global** (Eric Dowling `edowling@boydwatterson.com`; Philip Sharrow
  `philip.sharrow@scopecre.com`), **UIRC** (Oscar Peterson `opeterson@uirc.com`), **BLOOMINGTON IRS LLC**
  (Philip Sharrow). Awaiting Scott's lane verdicts — the harvest is now *growing the callable owner pool*.
- ⚠️ **New provenance drift (34→39):** last night a `folder_feed_lease` lease-ingest wrote 5 dia.leases
  responsibility fields (`guaranty_scope`, `hvac/parking/structure/roof_responsibility`, 02:4x UTC) with
  **no `field_source_priority` rows** → `v_field_provenance_unranked` flags them. Not from W9.6 (that source
  is properly ranked). Fix = register 5 fsp rows for `folder_feed_lease` on those dia.leases fields (additive,
  reversible) — folded into next-steps below, not silently applied (its authority rank vs om_extraction/costar
  needs Scott's call).


- **Google Document AI is live end-to-end** (was silently broken since ~07-17: the `GOOGLE_DOCAI_PROCESSOR`
  edge secret pointed at a Custom Extractor → `entity_types` 400 → ALL OCR fell to gpt-4o at 6–14×). Fixed
  by repointing to OCR processor `projects/108926230693/locations/us/processors/5ecc6339861c88e1`; verified
  (deed tick: 8 pages `google_docai`/`cloud_cheap`). docai-ocr edge fn v19 now echoes the processor on GET.
- **NEW `api/_shared/office-text.js`** (zero-dep docx/xlsx text; byte-sniffed — PA flow lies about mime) wired
  into `runLeaseExtraction` + `extractDocumentText` BEFORE the OCR tiers; unreadable office → terminal
  `office_no_text` (never re-queues to OCR). 15 tests + fixtures; commit `62e4aef5`, merged + deployed.
- **Crons 160/167/169 reactivated** (deed + CRE doc-text, 30-min ticks). Office needs_ocr queue (11) fully
  drained; Richardson 2840 (15.6MB/40pp rotated scan) OCR'd off-box → enriched. Lease corpus (~214 pending)
  draining via temp cron 217 + self-cleanup cron 218 (auto-unschedules both at eligible=0).
- **Registry:** `feature_flags_registry.OCR_CLOUD_DOCAI` (on, notes current). Docs updated:
  `docs/architecture/document-capture-and-ocr-status.md` (FINAL STATE box = the durable runbook),
  `CLAUDE.md` OCR section, `docs/UW4_LEASE_OCR.md` banner. **Do not re-provision OCR from scratch.**
- Optional knobs left unset: `AI_OCR_MODEL=gpt-4o-mini`, `INTAKE_OCR_MAX_BYTES=20000000`.

## Scheduled check 2026-08-12 (~22:00Z) — W9.4 display-name capture: NOT WORKING yet
Post-PA-flow-change verification on LCC Opps `activity_events`: 9 new correspondence rows since
16:00Z (7 `outlook`, 2 `outlook_inbound`, 0 `outlook_sent`). New code confirmed live (rows stamp
`metadata.from_name`/`to_names` keys) but **all 9 null** — including bridge `outlook` rows whose
FROM name was expected code-only (e.g. `dcrowley@fdstonewater.com`, `smartin@northmarq.com` arrive
bare). **Needs Scott:** check the flagged-inbound + Sent-Items PA flows' run histories for
Select/Join action errors; also verify the bridge payload still carries Graph `{name,address}`.
No sent-mail traffic yet to test the outlook_sent path.

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

### ✅✅ W9.2/W9.4 HARVEST LIVE 2026-08-13 — the "who do I call" gap is closing
Post-backfill `?score=1` PASSED spectacularly: **header_name_pairs 0→9,278, signature_phones 3,516,
7,778/7,854 rows harvestable**. Sample proposals are REAL owner contacts from Scott's own mail:
Eric Dowling→Boyd Watterson Global, Philip Sharrow (ph 215.302.4401)→2 owners, Oscar Peterson (ph
816-682-8097)→UIRC — all owners that had ZERO contact on file, evidence-quoted, create_contact
(human-verdict gated). **Cowork flipped `W9_2_REACHABILITY_HARVEST` → on** (all three arms —
deterministic SF, LLM intake/signature, comms create-contact). Nightly 4:40 cron now mints
owner-contact proposals into the reachability lane. **This is the campaign payoff**: reconciliation
+ backfill + harvest → previously-unreachable owners now have names + numbers. Send order continues:
**102 (W9.6 correspondence→owner) → 100 (voice).**

### Prompt 101 landed — accelerator WORKED via a corrected source; premise refuted + doc fixed
**My prompt-101 premise (inherited from the 96 doc) was WRONG:** `email_bodies.from_name` is NULL
on ALL 23,071 rows — no structured historical name in email_bodies OR the activity_events spine.
Claude Code grounded before trusting it and found the REAL source: **`unified_contacts` (17,527
named)** — reconstructs each row's display name from the emails already on the row (Prompt-93
pattern), provenance `source:'unified_contacts'`. **The false claim in
`W9_4_display_name_capture_2026-08-12.md` is now CORRECTED** (struck + correction note).
**Live result (Cowork-verified):** activity_events from_name 30→**2,298**, to_names ~7→**2,469**
(4,795 backfill-log rows); harvest header_name_pairs simulated ~6,050 (was 0). Applied live batch
`nb_sql_20260813` (reversible via `POST /api/outlook-name-backfill?reverse=1&batch=`). PR #1713
(JS route re-affirms idempotently on redeploy). New `outlook-name-backfill.js` + route + ledger
migration + RPC `lcc_names_for_emails`; 13+68 tests. **Prompts 102 (W9.6) + 100 (voice) do NOT
depend on the refuted premise — no adjustment needed.**
**Gate: Scott runs `GET /api/reachability-harvest-tick?score=1&n=10` → review the now-populated
header_name_pairs sample → Cowork flips `W9_2_REACHABILITY_HARVEST` on real historical yield.**

### 2026-08-13 — ACCELERATE + interim build queued (Scott: "scale the unlock, accelerate")
Grounded finding: harvest accruing SLOWLY (7 new outlook rows since flow fix; 30/6,977 with names)
— organic mail would take weeks. **ACCELERATOR FOUND: `email_bodies.from_name` was already stored
historically** (per the 96 root-cause doc) — a one-time backfill into the 7,751 name-less
activity_events rows flips the harvest NOW instead of waiting. → **Prompt 101** (fill-blanks,
reversible, reuses outlook-recipients parser, backfilled-marker provenance; re-check harvest
dry-run → flip W9.2).
**Interim build = Prompt 102 (W9.6 correspondence→owner attribution)** — the last major internal
linkage gap (W9.5 baseline 2.5%, 6/241). Two paths: A property→true_owner bridge (deterministic),
B correspondent-is-owner-person (LLM-verbatim, false-bridge guarded). Feeds BOTH the owner record
(comms history) AND the harvest's create-contact arm (compounding). Flag `W9_6_COMMS_OWNER_ATTRIBUTION`,
cron 5:05.
**Prompt 100 (W10 Stage 1 voice profile)** also queued — on-prem corpus distill → BRIGGS-WRITING-VOICE.md.
Send order to accelerate: **101 (unlocks harvest now) → 102 (new linkage) → 100 (voice, after flips settle).**

### Wave 10 SPEC written 2026-08-13 — Voice & Drafting (Scott's corpus → grounded BD drafts)
`docs/audits/W10_VOICE_AND_DRAFTING_KICKOFF.md`. 4 staged: (1) voice PROFILE via setup-writing-style
over the REAL sent corpus — cheap, no training, ship first; (2) RAG-grounded drafting (retrieve
Scott's nearest past examples + deal facts → draft in his voice, to Outlook Drafts, never sent);
(3) template library from clustered draft-types; (4) optional GaryBuilt LoRA only if few-shot
insufficient. Doctrine: never auto-send, never fabricate facts (voice=how, spine=what), strategy
stays verbal (offer-submission), corpus-cleaning is a data-quality step first, ON-PREM via ollama
(privacy win). Recommended AFTER Wave 9 flips settle. Live coverage snapshot this session (dia/gov):
recorded→true 98.4/99.7% ✅; true→contact 32.1/27.0%; contact→reachable 29.1/32.2%; true→SF
16.9/11.8% (climbing); contact→SF-person 6.5/5.8% (thinnest). Remaining gaps ranked: harvest flip
(top lever) → person-SF linkage → correspondence→owner-LLC attribution → deed-signatory OCR →
Wave 6 → key rotations.

### GaryBuilt/SOS session reviewed 2026-08-13 — honest accounting (2 corrections + 1 fix)
Scott's report: "everything completed but the SOS websites had issues we couldn't work around."
Grounded review from Cowork (LCC side only — gov repo + GaryBuilt box not visible here):

1. **REAL GAP FOUND + FIXED:** the LCC Stage-2 migration
   `20260812140000_lcc_w9_1_stage2_sos_direct.sql` was on main (PR #1700 merged) but **never
   applied to LCC Opps** — deploy-ordering slip (JS shipped, DB migration didn't run). Cowork
   applied it live: `W9_1_SOS_DIRECT` flag now registered (OFF), 10 `sos_registry` fsp rows added.
2. **CORRECTION to my earlier claim:** I asserted the unranked-drift tick 33→34 was the missing
   sos_registry ladder. **Wrong** — the 34 unranked rows are ALL the pre-existing W6.6 baseline
   classes (costar_sidebar/om_extraction/rca_sidebar/salesforce/ops_asset_metadata_loan on
   sales_transactions/loans/properties/deal_provenance); zero are sos_registry. The +1 is a new
   baseline-class row, NOT SOS. The fsp rows are correct to have but weren't clearing a live drift.
3. **SOS outcome (per Scott):** the proxy + tunnel + adapters were BUILT and installed, but the
   FL/CA registry sites remained unreachable even through residential egress — bot-detection
   defeated the workaround. **This is an environmental wall at the source, not a build gap.**
   `W9_1_SOS_DIRECT` correctly stays OFF (flipping = honest-blocked no-ops against sites that
   don't serve). Same class as the July 2026 SOS finding, now confirmed NOT solved by residential
   IP alone.

**Verdict: Wave 9 BUILD is 5/5 complete; the SOS EXTERNAL-FETCH capability is blocked at the
source** (documented, honest, reversible — the machinery is inert-but-correct if the sites ever
become reachable or an API alternative lands, e.g. OpenCorporates re-price ~Aug 28). Gov-repo
Part A state (proxy install verification, per-state adapter results, token rotations) is NOT
visible from this session — needs Scott's confirmation or the gov-repo verification doc to close.

### ✅ W9.1 STAGE 1 LIVE 2026-08-12 — flag flipped after clean dry-run
Sheet reviewed: 5/40 proposals on the top-value window (crossref 2, broker 3), 35 honest
no_source, scan_errors [], value-ranked correctly. Quality graded: Acquest attach = textbook;
**two watch-classes flagged for lane attention** — (1) naming-core false-bridge risk (PCCP ←
"Pacific Coast Properties LP" — possibly distinct firms; REJECT in lane if read as distinct);
(2) firm-as-person broker candidates ("FD Stonewater"). If lane accept-rates show these classes
noisy, a tune prompt tightens the crossref matcher + adds a firm-name guard to broker mints.
**Cowork flipped `W9_1_CONTACT_ACQUISITION` → on** — nightly 4:55 cron walks the no-contact pool.
Remaining W9 gates: harvest (mail accrual), SOS (Scott's GaryBuilt install per gov runbook +
token rotations).

### ✅ WAVE 9 BUILD-OUT COMPLETE (5/5) — prompts 98 & 99 merged + deployed 2026-08-12

| # | Outcome | Gate |
|---|---|---|
| 98 (Stage 1) | PR #1698. Stage runner (cross-ref ATTACH / deed-signatory MINT / broker_of_record) + `contact_acquisition_review` lane. **Production-safety catch: route renamed to `/api/contact-acquisition-engine-tick`** — the prompt's suggested name was the live R16 SF worker. Honest yields: cross-ref ~6% top-100; **deed stage input-thin (signatories in property_documents, not deed payloads — 0/5,771 gov) → signatory/OCR backfill = NEW BACKLOG UNIT**; institution thin; broker tail 2,830. | Scott: `GET /api/contact-acquisition-engine-tick?score=1&n=10` → review attach sample → Cowork flips `W9_1_CONTACT_ACQUISITION`. |
| 99 (Stage 2) | gov PR #371 (proxy service + transport + runbook) + LCC PR #1700 (STAGE_SOS wiring + migration — which also FIXED a real fsp drift: gov wrote `sos_registry` with no LCC ladder row). Transport honest-blocked when unset; proposal-only; weekly cadence. | **Scott's hands-on infra**: install proxy on GaryBuilt per the gov-repo runbook → 2nd tunnel hostname + NEW CF token → FL/CA side-by-side re-verification → dry-run → Cowork flips `W9_1_SOS_DIRECT` → **rotate both service tokens** (the §3C debt clears here). |

**All five W9 units now built.** Live: W9.3 (3 flags) + W9.5. Gated: W9.2 (mail-name accrual),
W9.1-S1 (dry-run), W9.1-S2 (GaryBuilt install), W9.4 (rides W9.2's flag). The 5PM name-capture
task verdict pending.

### W9.1 queued as TWO prompts (98 Stage 1 + 99 Stage 2) — Scott sanctioned the SOS egress design
**Prompt 98 (Stage 1, internal-only):** value-ranked no-contact owner engine, stages in cost order
w/ stop-at-first-success — 1a cross-reference ATTACH (existing contacts under other entities,
institution contacts for the REIT class), 1b deed mining (grantee mailing addr deterministic +
signatory names via LLM-verbatim, reuses W5.1 GLiNER where fits), 1c broker-of-record (typed
`broker_of_record`, never conflated with owner's people). Pluggable stage runner = the Stage-2
seam. Flag `W9_1_CONTACT_ACQUISITION`, cron ~4:55.
**Prompt 99 (Stage 2, Scott-approved 2026-08-12):** locked-down fetch proxy ON the GaryBuilt box —
compiled-in state-SOS domain allowlist, GET-only, human-like rate limits + daily caps, NEW CF
Access hostname/policy/token (separate blast radius from ollama), kill switches both ends, Windows
install runbook for Scott; SOS adapters re-verified per state through residential egress
(side-by-side 403-vs-200 proof), wired as 98's SOS stage (registered-agent/officer proposals,
`sos_registry` provenance, lane-only). CF token rotation (§3C) folds into the same Zero Trust
session. Flag `W9_1_SOS_DIRECT`. **Send 98 first; 99 after or parallel (98's runner is the seam).**

### Prompt 97 (W9.5) landed — PR #1694; WAVE 9 BUILD-OUT 4/5, the measurement loop is CLOSED
Read-only integrity tick per spec: pure planner `link-coverage.js`, `GET/POST /api/link-coverage-tick`
unifying dia/gov chain views + ops mirror/correspondence/conformance view, monthly snapshot rides
the U4 cron (no second cron), new U4 **Connectedness section** (report now 10 sections; severity =
any link pct DROPPING MoM → high + fix-unit stub naming the producer; low-but-stable = known work,
not regression). Migrations applied live to all 3 DBs (counts-only/no-PII views). **Grounded
baselines:** true→contact dia 32.1% / gov 27.0%; true→SF dia 16.9% / gov 11.8% (up from 11/12% —
W9.3 measurably moving it); mirror conformance 100%, 0 dangling, 0 banned spellings;
**correspondence→owner-LLC 2.5% (6/241)** — the 96 finding now baselined for the follow-on unit.
18 tests + guards. **Remaining Wave 9 unit: W9.1 external acquisition (SOS-egress design) — its
own future prompt.** Gate: merge #1694 → redeploy → optional `GET /api/link-coverage-tick` sanity;
Sept 1 U4 carries Connectedness baselines automatically.

### 2026-08-12 midday — PA flows edited by Scott (natural-traffic test), nightly green, prompt 97 queued
Scott applied the Select+Join change to BOTH flows (no synthetic client emails — testing on real
traffic). **Scheduled task `check-outlook-name-capture` fires 5PM CT today**: queries new
correspondence rows for from_name/to_names, verdict WORKING/NOT WORKING/NO TRAFFIC, auto-logs to
kickoff + STATUS. Nightly Aug-12: all 9 green; **donor cursor fix WORKING — +5 keys, gov 19→24**;
assist 60/3.3k annotated across 3 runs; lanes U1 110 / U2 27 / U3 5 / U5 111. **Prompt 97 queued
= W9.5 propagation-integrity tick**: pure-counts cross-DB link-coverage audit
(`v_lcc_w9_5_link_coverage` + snapshot deltas), new U4 "Connectedness" section (severity = any
link pct DROPPING MoM), read-only on-demand tick, measures the parties-vs-owner-LLC split as the
96-finding baseline. After 97: Wave 9 = 4/5 built; W9.1 (external acquisition + SOS-egress design)
is the last unit.

### Prompt 96 landed — PR #1693 MERGED + deployed; the W9.4 unlock is IN
Root cause: FOUR Outlook writers flattened Graph {name,address}→bare email. Shared parser
`outlook-recipients.js` (never fabricates an address); forward-only `metadata.from_name`/
`to_names[]` on all four writers; comms index binds the pairs. **FROM names capture immediately;
TO/CC needs Scott's ONE-TIME PA flow change** (Select+Join click-steps in
`docs/audits/W9_4_display_name_capture_2026-08-12.md`). 15 tests; full suite green. Second
starvation finding confirmed orthogonal (correspondents = parties/deals, not owner LLCs — W9.5
candidate input, flagged not scoped). **Flip path: (1) Scott applies the PA change; (2) a few
days' mail accrual; (3) `reachability-harvest-tick?score=1&n=10` shows non-zero
header_name_pairs; (4) Cowork flips `W9_2_REACHABILITY_HARVEST` — three arms live.** Kickoff
status updated.

### Extended misparse sweep APPLIED 2026-08-12 — 38 seeded (by_class: street 18 / tm_vocab 5 /
doc_label 2 / bare_title 8 / sentence_fragment 5); dry-run reviewed clean (no real people).
Junk lane now holds 38 tm_misparse deterministic dismisses (the original 23 were still unconfirmed
— idempotently refreshed, no dupes) within 110 total open. Each tm_misparse confirm soft-retires +
un-stamps fanned emails. Note: PS 5.1 `Invoke-RestMethod` nullrefs on this endpoint's larger
responses — use the curl.exe pattern for seeder calls. Prompt 96 with Claude Code (response
pending).

### Reconcile 2026-08-12 (prompts 94 & 95 merged+deployed; U3 lane CLEARED) → prompt 96 queued

| Item | State |
|---|---|
| 94 (W9.4) | ✅ PR #1692. Comms arm built as THIRD arm of the harvest tick (one flag/lane/cron). Caught its own nuance: signature values are LLM-only, never arithmetic. Privacy-scoped (visibility<>private, grounded live). Migration live, 2 name-field fsp rows, 35 tests. **Honest finding: input-starved — 0/7,751 rows carry header display names (Outlook ingestion flattens Graph {name,address}→bare email) + 0 correspondence entities map to true_owners. Flag stays OFF.** |
| 95 | ✅ PR #1691. Shared detector extended: doc_label / bare_title / sentence_fragment classes ("Jane G. Polen"-class negatives fixtured — real people survive); seeder reports by_class; U3 pool + sidebar guard inherit via the shared module. 19 tests. **Operator step: re-run the seeder dry-run (`?_route=tm-misparse-seed`, now with by_class) → review → `&apply=1`.** |
| U3 lane | ✅ CLEARED by Scott: 18 applied / 5 rejected / 1 conflict; +11 distinct labels to the corpus. |
| 96 | **QUEUED — the W9.4 unlock:** trace + fix the Outlook display-name flattening (forward-only `metadata.from_name`/`to_names`; PA-flow steps documented if the flow is the flattener), probe the true_owner attribution gap. Its acceptance → non-zero comms_counts → **flip `W9_2_REACHABILITY_HARVEST` (one flag, three arms)**. |

### U3 lane guidance 2026-08-11 + NEW junk class found by Scott → prompt 95
Lane worked live: different_people confirms = distinct labels (resolver hard negatives, no data
changes); link-proposal confirms = route-to-resolver (never auto-merge — safest click). **Scott
spotted a NEW misparse class in the clusters: sentence-fragments/doc-labels as person names**
("The deed was unavailable at the time of publication", "Income & Expenses", "Buyer information
not available", bare titles). Guidance: REJECT clusters containing them (avoid corpus pollution).
**Prompt 95** extends the shared 89 detector (sentence_fragment/doc_label/bare_title classes) —
seeder re-run flows them to the junk lane; U3 pool + sidebar guard inherit via the shared module.
Prompt 94 (W9.4 comms arm) sent to Claude Code, response pending.

### Prompt 93 landed — PR #1690 MERGED + deployed; W9.4 queued as prompt 94

93 both micros verified from response: (A) donor tick keyset-cursored w/ wrap-and-recheck
(re-score can mint links in scanned windows — a full wrap re-checks); root cause was
permanently-unmatchable rows squatting the fixed window. (B) Aug-10 burst root-caused (pre-82
deploy window, openai-fallback branch); **stamps RECONSTRUCTED from per-row diagnostics — post-82
coverage now 100% (87/87)**, 18 rows honestly openai (W5_3 addendum corrected — "zero cloud
fallbacks" superseded), 48 non-deal rows marked none; `sold_*` strip live (7 drift rows); 82 guard
extended to edge fns. **Prompt 94 queued = W9.4 comms-harvest as a THIRD ARM of the existing
harvest tick** (header pairs deterministic / signature phones via LLM+verbatim / create-contact
shape lane-only; privacy-scoped; comms_observed@40 already registered) — **its dry-run pass is
the W9.2 flip trigger** (one flag, three arms). U3 lane = "Ownership links — Ollama proposals"
in the DC (21 cards; post-77 conflicts return as pick-the-survivor). Archive debts: 92 response
docx still missing from done/; CHECK-widening migration file still owed by Claude Code.

### Nightly 2026-08-11 + FULL REVIEW — 92 verified, W5.3 RE-GRADE DELIVERED, prompt 93 queued

**92 verified from behavior** (two run_ids × 20 — the assist pool walks; response docx never
landed in responses/ — Scott to re-drop for the archive). Lanes worked hard by Scott: U1 145→95,
U2 43→14, U5 157→41; U3 grew to 21 (chain proposals flowing). **Re-score cumulative: 1,200
walked, 32 auto-links, 8 review** — steady conservative ratio.

**W5.3 RE-GRADE (addendum written into the W5_3 report): the 61 hardening WORKED.** Post-61
OM-class coverage: NOI 89 / cap 89 / tenant 79 / SF 95 / responsibilities 79 (vs 4/33/6/41/absent
pre-61). **Verdict upgraded: hardened prompt VALIDATED, keep ollama-primary; revert
recommendation retired.** Caveats → prompt 93B: an Aug-10 bulk path (63/72 rows) still bypasses
the stamp; sold_* key drift on 2/4 stamped rows.

**Prompt 93 queued (two micros):** (A) donor-handoff treadmill — 4th walk-the-pool instance
(stamped 14 night one, 0 since; fixed 480-row window, no cursor) + build the SHARED structural
helper if 92 didn't; (B) trace + stamp the Aug-10 bulk writer, extend the 82 guard.

### Nightly 2026-08-10 — 9/9 fired, 8 healthy; sf-assist treadmill → prompt 92 (micro)
Lanes: U1 145 / U2 43 / U3 13 / U5 157. **Re-score night 2: 800 walked, 26 auto-links (+8), 8
review** — conservative gate steady. Donor stamped 0 (lumpy; last night's links had no unique
bridge matches — watch not bug; gov 19 / dia 15). Disambig clean post-91. **sf-link-assist:
cron succeeds but all 20 annotations carry LAST night's run_id — re-scores the SAME 20 nightly
(no annotated-exclusion in the fetch; 3rd walk-the-pool miss after 83/84). Prompt 92 queued**
(anti-join + pre-LLM skip + shared structural test candidate: every nightly LLM tick's fetch must
exclude its own output). W5.3 volume: 17/~50 fresh extractions (slow week).

### Prompt 91 landed — PR #1655, sweep LIVE; awaiting merge + redeploy for the guard
Root cause found: the enrich promoter passed `match?.candidates ?? []` (empty) into a mint —
guard now at the single choke point (`emitMatchDisambiguation`), all four callers honor the
refusal. Sweep applied live: **19 closed** (skipped, tagged `empty_candidates_p91`, reversible);
verified NOT a silent drop — all 19 intakes correctly parked `review_required` (e.g. f8d11c87 is
a multi_address_no_match portfolio OM). **Lane now 12 real, fully-annotated cards, 0 empty.**
`skipped_no_candidates` counter added. Gate: merge #1655 → redeploy (guard is JS; sweep already
live). **Still owed by Claude Code next session: repo migration file for the 08-09 CHECK widening
on `lcc_clean_assist_proposals` (applied live by Cowork).**

### Both anomalies closed 2026-08-09 — sf-assist FIXED (20/20 written), disambig root-caused → prompt 91
Post-CHECK-widening re-POST: sf-link-assist **proposed 20 / failed 0** ✅ (verdicts sane: 17
uncertain / 2 merge / 1 not). Disambig-assist "0 annotated" root-caused: the 19 remaining open
cards carry literal `candidates: []` (June-14 producer burst — matcher minted "pick one of
nothing" instead of routing no-match; assist correctly refuses them; lane badge inflated).
**Prompt 91** (micro): producer guard (never mint empty), one-shot sweep (~19 → skipped w/ reason,
re-emit unresolved intakes through the no-match path), `skipped_no_candidates` counter. The 12
real cards ARE annotated — the assist did its whole job on night one.

### Nightly 2026-08-09 — 8/9 produced; assist-write CHECK bug FIXED LIVE by Cowork
First full 9-unit night: U1 137 open / U2 25 / U3 **10** (fixed evidence producing!) / U5 85;
**re-score walked 400: 18 auto-links + 7 review + 375 no_match** (conservative gate holding);
**donor handoff stamped 14 person keys — gov coverage 5→19** (the W9.2 unlock metric moving).
Anomaly: sf-link-assist scored 20 but `failed:20` — ALL writes bounced. Root cause (74-class):
`lcc_clean_assist_proposals_source_check` allowed only 'ollama_clean_assist'; W9.3 writes
'w9_3_sf_assist' (planner comment even said "fits the CHECK" — for kind, missed source). **Cowork
widened the CHECK live** (both values; verified). Scott re-POSTs the tick to confirm writes land;
also re-POST `match-disambig-assist-tick` (0 new night 2 — verify it's just pool exhaustion vs a
second issue). NOTE for Claude Code hygiene: record the CHECK widening as a repo migration file
next session (applied live 2026-08-09 by Cowork).

### ✅ W9.3 LIVE 2026-08-08 — all three flags flipped after clean dry-run reviews
WS1 assist: appropriately skeptical (Orion↔Orion Bank uncertain 0.3 — no forced calls). WS2
re-score: banding textbook (L&K/Realty Income exact→auto; Uniland article-variant→review; 90/96
no_match). WS3 donor: 14 unique gov person-matches first window, 0 ambiguous, dia honestly 0
(thinner bridge). **Cowork flipped `W9_3_SF_ASSIST`+`W9_3_RESCORE`+`W9_3_DONOR_HANDOFF` → on.**
Nightly drains begin: 23,817 re-score backlog walks in batches; 3.3k lane gets assist-sorted;
donor keys accumulate toward the 2,305 addressable pool. **W9.2 unlock watch: when
blank-contacts-with-SF-key climbs into the hundreds, flip `W9_2_REACHABILITY_HARVEST`.** U4 gains
sf-coverage + assist-accuracy metrics.

### Prompt 90 (W9.3) landed — PR #1648 MERGED + deployed; 3 dry-run gates pending
Three workstreams, three flags OFF: **WS1** `sf-link-assist` (80-pattern annotation pre-rank on the
3.3k pool, metadata-only writer). **WS2** `sf-link-rescore` — smart scope cut: NO JS Fellegi-Sunter
port (band drift risk); deterministically reproduces W4.3's exact/near-exact auto-link tier only,
vs the refreshed 16,210-account registry (+223 since W4.3); null-guarded, splink_v2 provenance,
reversible `w9_3_rescore_log`. Sample: 5/162 top gov no_match now exact auto-links, 0 ambiguous.
**WS3** `sf-donor-handoff` — traced the real key gap: W9.2 reads person-level `sf_contact_id`,
linkage lands org-level `sf_account_id` → account→contacts expansion via the SF bridge (unique
name-match, fill-blanks). **Addressable pool measured: 2,305 blank contacts under SF-linked owners
TODAY** (vs ~20 with keys) — W9.2's unlock is real and near. 44 tests. **Gate: 3 dry-run GETs
(`sf-link-assist-tick` / `sf-link-rescore-tick` / `sf-donor-handoff-tick` each `?score=1`) →
review → flip `W9_3_SF_ASSIST`/`W9_3_RESCORE`/`W9_3_DONOR_HANDOFF` → watch the donor-key count
climb → flip W9.2.**

### W9.2 dry-run HONEST-ZERO verified; sequencing corrected → prompt 90 (W9.3) queued
W9.2 `?score=1&n=8`: mechanics clean (pools confirmed dia 71.1%/gov 68.3%, scan_errors [], intake
index 5,000 entries loaded) but 0 proposals both arms. **Cowork probe confirmed the zeros are
HONEST:** 0/7 sampled unreachable-contact names appear anywhere in intake snapshots — intake docs
name brokers/listings, unreachable contacts are OWNERS; populations disjoint. Deterministic arm
waits on SF keys (~20 exist). **Flag `W9_2_REACHABILITY_HARVEST` stays OFF (built, input-gated) —
producer/consumer doctrine.** Sequencing correction owned: W9.3 is the true unlock (SF holds the
emails/phones; true-owner SF coverage 11-12%). **Prompt 90 = W9.3**: (1) prompt-80-pattern assist
pre-rank on the 3.3k sf_link_candidate pool; (2) live re-score of the 23,817 no_match vs a
REFRESHED registry (W4.3 stale-registry caveat) w/ conservative 0.9/0.1 bands + splink_v2
provenance; (3) donor-key propagation to the rows W9.2 reads — the rising blank-contact-with-SF-key
count IS W9.2's unlock threshold.

### TM quarantine EXECUTED 2026-08-08 — 23/23 seeded (dry-run reviewed → apply, zero errors)
All 23 = SF Financial District streets + TM vocab from one CoStar page; Ehmer/Devincenti excluded
by the fan-out gate as designed. Now in the junk lane as deterministic dismisses; each confirm
soft-retires + un-stamps rehmer@'s email. Remaining W9.2 gate: `?score=1&n=8` dry-run → review →
flip `W9_2_REACHABILITY_HARVEST`.

### Reconcile 2026-08-08 (prompts 88 & 89 — landed; responses → done/)

| # | Outcome | State |
|---|---|---|
| 88 (W9.2) | Reachability internal harvest | ✅ **PR #1643**, migration LIVE (4 tables, 2 views, 8 fsp rows w9_2_internal_harvest@60/comms_observed@40, flag `W9_2_REACHABILITY_HARVEST` OFF, cron 04:40). **Gov gap measured: 10,542/15,434 (68%) unreachable** (dia 71% confirmed). Two arms per spec (deterministic exact-identity-key fills — never name-fuzz — bulk-confirmable; LLM w/ value-in-quote validator + dropped-log). New `reachability_harvest_review` DC lane (75-guard covered). 22 tests. **Honest yield note: deterministic arm input-starved TODAY (only 15 dia + 5 gov blank contacts carry SF identity keys) — mechanism durable, yield scales as W9.3 lands keys.** Gate: merge → redeploy → `?score=1&n=8` → review → flip. |
| 89 | TrafficMetrix quarantine | ✅ branch `claude/trafficmetrix-misparse-quarantine-ukpo4v` (no PR yet — Scott merge or request one). **Superb grounding:** found the fanned email lives in `entities.email`; caught that the street regex would false-positive REAL people ("Ladonna Street", "Chris Way") → value-gated the seeder on email fan-out >4 instead — 23 phantoms seed, Ehmer/Devincenti excluded cleanly. Un-stamp on confirm (clears email + detaches conflated identities, reversible). Sidebar guard routes suspects to `contact_misparse_review` (never mints). U3 pool skips misparse clusters. Lane counter root-caused (null→0 coercion). CLAUDE.md footgun note added. 14 tests; full suite green. **Post-deploy: dry-run `?action=tm-misparse-seed` → `&apply=1` → confirm in junk lane.** |

### TrafficMetrix misparse found by Scott in the U3 lane → prompt 89 queued
Scott spotted a person_email card with street-name "evidence". Cowork forensics: a 2026-05-09
sidebar/CoStar capture parsed the TrafficMetrix traffic-count widget as a CONTACT LIST — 16
"person" entities minted (streets, "Traffic Vol", "Made with TrafficMetrix® Products"), all
stamped with the page's one real email (rehmer@ehmergroup.com — Richard Ehmer, real broker).
Scale measured: 17 street-label persons, 7 clusters ≥6 members, newest 2026-05-23 (dormant, but
graph contamination persists + U3 pool feeds garbage to the LLM). **Scott advised to REJECT the
card** (confirming would write nonsense pairs into entity_match_labels). **Prompt 89**: one-shot
quarantine seeder → U1 lane as deterministic `tm_misparse` dismisses (real names excluded),
un-stamp the fanned email on confirm, sidebar parser guard (street/label reject + one-email
fan-out cap w/ the 16-name fixture), U3 pool excludes junk clusters, fix the "0 workable" lane
counter quirk. 88 sent to Claude Code (response pending).

### 86 done (Dialysis/FRED back online) + WAVE 9 UNIT 1 queued — prompt 88 (W9.2)
Dialysis Railway service green again post-86. **Prompt 88 = W9.2 internal-harvest reachability**,
the Wave 9 opener: two arms (deterministic exact-identity fills from SF/sidebar — no LLM,
bulk-confirmable; LLM-attributed fills from correspondence/intake with U3 verbatim-quote
validator), value-gated pool (4,234 dia unreachable contacts + gov count to be measured + owners
where internal evidence names a person), proposals into the EXISTING owner-contact surfaces,
fill-blanks writer w/ fsp rows (`w9_2_internal_harvest`/`comms_observed`), flag
`W9_2_REACHABILITY_HARVEST` OFF, cron 4:40 UTC, full house pattern from day one. Headline metric
for U4: reachability coverage %. Gate: dry-run → Scott review → flip.

### W6.5 Stage 1 MERGED + LIVE — PR #1641 (`b94d877`)
DC federated lanes (~1,010 lines: `_DC_FED_META`, `_fedCardHTML` + 17 branches, renderFederatedLane,
dcFed* verdict handlers) extracted VERBATIM from ops.js → new classic-script `dc-lanes.js` loaded
before ops.js — **byte-identity of the moved block verified against base**. Deliberate deviation
from the prompt: classic ordered `<script>` split, NOT ES modules (repo serves SPA from root, no
bundler; shared global scope keeps every cross-ref working with zero rewiring — documented in the
map doc). `docs/architecture/w6-5-frontend-decomposition-map.md` = the full seam inventory +
staged plan (Stage 2: detail.js by tab; Stage 3: app.js by route). Guards widened to read both
files as one runtime surface (assertions unchanged) + new load-order test. 3,388 pass / 3
pre-existing. **Scott verify: hard refresh → DC lanes render → work one junk card (119 waiting) —
that exercises the extracted region end-to-end.**

### Buildout continuation 2026-08-08 — WAVE 9 kicked off + W6.5 staged + ORE self-resolved
Scott picked three tracks: (1) **ORE resolver — already resolved**: flag was flipped Aug 6 (after
the audit-refresh snapshot); queue verified draining 2,064→538 in 2 days (~750/day), nothing to do.
(2) **WAVE 9 — Data Connectedness (Scott directive)**: kickoff written
`docs/audits/W9_CONNECTEDNESS_KICKOFF.md` with LIVE gap map — recorded→true is SOLVED (dia 1.6%
unlinked), the chasm is downstream: **68%/73% (dia/gov) of true owners have NO contact, 71% of dia
contacts have neither email nor phone, ~88-89% no SF link**. Five units W9.1–W9.5; recommended
first = W9.2 internal-harvest reachability (U3-pattern verbatim-evidence proposals from
correspondence/SF/sidebar/intake). Unit prompts to be drafted per session pickup. (3) **W6.5
front-end decomposition**: prompt 87 queued (Stage 1: seam map + module seam + extract DC lanes
region from ops.js; byte-identical behavior; staged follow-ups per the map doc).

### ✅ U1 FULLY PRODUCTIVE — 2026-08-08 13:16 UTC manual drain verified
Post-85 POST: **deterministic_dismissed 100** (blanks, zero LLM), **llm_scored 20** w/ real mix
(17 dismiss / 1 keep / 2 rename — 0.85 share, guard correctly quiet on the LLM-only denominator),
**119 proposals into the junk lane**, cursors advanced, scan_errors [], budgets honest,
remaining_unscored 107 (~1 more night). **All five W8 units + assist now verified productive
end-to-end. W8 build-out arc CLOSED — steady-state operations from here.** Scott's junk lane has
119 cards (blanks bulk-review fast).

### Prompt 85 merged+deployed; Dialysis Railway deploy failure → prompt 86 (DIALYSIS repo)
85 reconciled (deterministic bypass + LLM-only guard denominator; PR #1637). **Dialysis Railway
service** (auto-deploys from dialysis-repo main): failed deployment, NO build logs, first failure
= the FRED API commit → config-stage death (malformed build definition / broken dependency entry /
unresolvable build-time env ref). **NOT an outage** — prior deployment still serving (dia
freshness verified: verification 12:17Z, property updates 12:38Z). **Prompt 86 queued — run in the
DIALYSIS repo**: diff the FRED commit for build-def/manifest defects, flag-gate the feature
(absence of FRED_API_KEY = no-op, never boot failure), timeout= on every network call per the
SIGALRM footgun. Drain POST (U1 post-85) pending Scott's run.

### 84 verified live — mechanics WORK; guard livelock on blank names → prompt 85
Manual POST post-84: windowed scan + budget split + cursors + honest bookkeeping all correct
(20 scored, scan_errors [], budget fine). But 20/20 dismiss (the blank-name dia contacts) trips
the 0.9 distribution guard → batch refused → and refused batches don't mark scored → **livelock**
(nightly re-scores the same 20 blanks forever, ~5 GaryBuilt min/night for zero output).
**Prompt 85**: blank_name/all_non_alpha/exact-token_junk become DETERMINISTIC dismiss proposals
(no LLM call, provider 'none', mirrors U5's deterministic arm; ~100/night cap drains the 199
fast); the dismiss-share guard measures ONLY LLM-judged verdicts (its job is catching a runaway
MODEL, not vetoing arithmetic). Then U1 nightly goes fully productive.

### Prompt 84 landed — PR #1636, migration LIVE, awaiting merge + redeploy
Root cause CONFIRMED (U1 full-scanned 128k/invocation, scan ate the budget, scoring starved; scan
batch stuck 'open'). Fix ports the 83 pattern: keyset-windowed scan (20k/invocation, cursors in
the batch ledger), pure budget-split helpers guaranteeing scoring a floor slice, batch lifecycle
('closed' terminal status — CHECK widened, migration applied live, 2 stale open batches
backfilled), naming_hygiene_backlog persisted flat for the U4 reader. 126 U1-suite tests green;
3 full-suite failures pre-existing. **Gate: merge #1636 → redeploy → next nightly (or manual POST)
drains the 199 blank-name dia contacts into the junk lane.** All five units then share the house
scan/score/budget pattern.

### First full nightly slate 2026-08-08 03:40–04:30 UTC — 4/5 units produced; U1 scan-starved → prompt 84
**U2 +21 pairs (29 open) / U3 +1 (1 open) / U5 first batch 67 proposals / assist 12 annotations —
all healthy.** U1 wrote only a scan batch (no apply/scoring; 0 proposals; scored-ledger unchanged) —
U1 is the only unit still full-scanning ~128k rows per invocation (no scan cursor), so the scan
eats the budget and scoring never runs; scan batch also never closes. **Prompt 84** ports the 83
windowed-cursor pattern back to U1 + guarantees scoring a budget slice + batch lifecycle. 199
enqueueable blank-name dia contacts waiting to drain once it lands. Morning lane slate for Scott:
29 dup pairs (chip), 1 link card, 67 hygiene proposals (bulk-confirm the deterministic renames),
assist-sorted disambiguation lane.

### ✅ Prompt 83 landed, merged, deployed, VERIFIED — all surfaces healthy (2026-08-08)
U5 tick now bounded + fast: lcc scan capped 20k/invocation w/ resumable keyset cursor (smaller
tables wrap), address resolution sampled-slice-only on GET, budget honest, scan_errors [].
Sample quality unchanged from the passing review (Cohen-Cos-keep judgment intact; exactly-one
address matches). Assist tick re-verified healthy (the previously-inflated 0.9 now an
honest 0.7 on re-run). **Every W8 surface + assist is now live AND proxy-safe.** Tonight's crons
(U1 3:40 / U2 3:50 / U3 4:10 / U5 4:25 / assist 4:30) run the first full slate; check
`naming_hygiene_batch` + assist annotations + lane badges tomorrow. Remaining open: merge #1634
(provider stamp) if not yet in; W5.3 re-grade at ~50 fresh extractions.

### U5 tick 502 (post-flip) → prompt 83 queued; assist tick verified healthy
`naming-hygiene-tick?score=1` now 502s (passed once pre-flip — variable runtime crossing the proxy
limit; review/batch/scored tables all EMPTY, first cron window tonight). Prime suspect: the
address-link arm resolves a domain property PER candidate (4,145 candidates = thousands of
round-trips in one request) on top of the 128k-row scan. Third instance of the 66/73 class →
**prompt 83**: crash-proof envelope, sampled-only address resolution on GET, budget + resumable
per-arm caps on POST/cron (det ~50 / LLM ~15 / addr ~15), batched `in.()` property lookups.
**Watch: tonight's 4:25 cron may also fail until 83 lands** — check `naming_hygiene_batch`
tomorrow. Assist tick (`match-disambig-assist-tick?score=1`) verified healthy flag-on; its 4:30
cron writes the first annotations tonight.

### Prompt 82 landed — PR #1634, awaiting merge; PGRST204 confirmed ZERO since cache reload
**PGRST204 = 0 since the schema-cache reload** (Cowork-verified) — the 8,306/30d cluster is fully
closed: 78's migrations + writer fixes + the cache reload. September U4 shows the decay.
**82 root cause:** `staged_intake_extractions` has exactly ONE DB writer, but the 61 stamp lived
in the per-artifact loop where the multi-artifact merge (priority-winner fields only) + a stale
module-global `__lastAiCallInfo` could drop it — sidebar-channel + cloud-fallback rows shipped
bare. Fix: shared idempotent `ensureProviderStamp` (routes the per-artifact stamp; re-asserted on
mergedSnapshot at the WRITE SITE = 100% coverage; no-AI paths stamp `final_provider:'none'` so
absence always means "old row") + structural guard against future bare writers. 25 tests.
**Gate: merge #1634 → redeploy. Then W5.3 re-grade at ~50 fresh extractions (15 now).**

### Housekeeping 2026-08-08 (Cowork) — PGRST204 root-caused to STALE SCHEMA CACHE + prompt 82 queued
Post-redeploy PGRST204 residue (16/3h, all `property_documents` 'source' column) was NOT code: the
78 migrations were correct — PostgREST's schema cache hadn't reloaded. **Cowork ran
`NOTIFY pgrst, 'reload schema'` on dia + gov** — rate should hit 0; verify on next check. Lore:
add "schema cache reload after domain DDL" to the footgun list (columns can exist while PostgREST
400s on them). **Prompt 82 queued:** provider-stamp coverage gap (4/15 fresh extractions stamped —
some writer paths bypass buildProviderStamp; blocks a clean W5.3 re-grade). W5.3 re-grade waits on
volume (15/~50 fresh extractions).

### ✅ EXPANSION LIVE 2026-08-08 — U5 + assist flags flipped after clean dry-run reviews
Both sheets passed Scott+Cowork review: U5 deterministic sample 30/30 mechanical (bulk-confirmable),
LLM arm correctly KEEPS "Cohen Cos"(surname)/"Dev I Ltd" — the U1 false-positive classes handled;
address links exactly-one-match w/ owner names, honest uncertain otherwise. Assist: 5/5 parsed,
grounded reasons, honest create_property on no-match (watch: one 0.9-confidence/hedged-reason —
self-measurement will catch systematic overconfidence). **Cowork flipped `W8_U5_NAMING_HYGIENE` +
`MATCH_DISAMBIG_ASSIST` → on.** Full nightly Ollama schedule now: U1 3:40 / U2 3:50 / U3 4:10 /
U5 4:25 / assist 4:30, U4 monthly 1st 5:00. New DC lane: naming-hygiene (bulk-confirm for
deterministic renames); disambiguation lane now assist-sorted easy-first. Pools: 430 deterministic
renames + 670 LLM + 4,145 address-link candidates; assist 32 open cards.

### Reconcile 2026-08-08 (prompts 79/80/81 — landed; responses → done/; Cowork live-verified)

| # | Outcome | State |
|---|---|---|
| 79 (U5) | Naming-hygiene campaign | ✅ **PR #1631**, migration LIVE (verified: flag `W8_U5_NAMING_HYGIENE` off, cron 04:25, 8 fsp rows, 0 drift). Deterministic dictionary renames (no LLM) + ambiguous→Ollama; address_as_name → property-LINK via ensureEntityLink (exactly-one match or human, never guess); own DC lane (75-guard-covered) + bulk-confirm for mechanical renames only. 51+ tests. Scoping note: address-links target LCC-native entities only (domain rows already FK-linked — counted, not auto-linked). |
| 80 | Match-disambig assist | ✅ **PR #1632**, migration LIVE (flag `MATCH_DISAMBIG_ASSIST` off, cron 04:30, metadata-only writer that structurally can't touch verdict/status; synthetic gate on a real card passed w/ 0 residue). Assist ranks candidates (hallucinated ids dropped), lane sorts easy-first, one-click "assist agrees", agree/disagree self-measurement → new U4 accuracy section (report now 9 sections). **Honest grounding correction: live open lane is 32 cards, not the historical 1,120.** 24 tests. |
| 81 | Ops cleanup | ✅ **PR #1633**, view fix LIVE (verified: flow clusters now 0). **Zombie flows weren't zombies** — 100% of their failures already auto-resolved/quiet since 07-29; the defect was the U4 cluster view counting resolved rows (filtered to open — a real break re-surfaces instantly). 23505 folds (sidebar contacts fill-blanks into the colliding row — those inserts were previously LOST, not just noisy; property_documents/owner upserts on real keys), 23503 property-exists guard, 42P10 real causes found by live verification (agent's lease_ti guess CORRECTED: partial-index on available_listings + nonexistent index target on property_documents). 12 tests. dia/gov repos untouched (all LCC-side). |

**Gate (one redeploy):** merge #1631 + #1632 + #1633 → redeploy → `npm run verify:deploy` →
(a) U5: `GET /api/naming-hygiene-tick?score=1` → Scott reviews sheet → flip flag;
(b) assist: `GET /api/match-disambig-assist-tick?score=1` → review sample → flip flag;
(c) PGRST204/collision clusters decay measurable in September U4.

### Reconcile 2026-08-07 evening (prompts 77 & 78 — landed; responses → done/)

| # | Outcome | State |
|---|---|---|
| 77 | U3 conflict-resolution card | ✅ **PR #1629.** Conflict rows surface as pick-the-survivor cards (candidates w/ relationship+portfolio counts, Mint-new option, sf_link three-way pattern); `resolve_conflict` verdict validates the picked id SERVER-SIDE (exists, unmerged, shares the canonical name — never trusts the client) then resumes the deterministic writer; idempotency guard exempts conflict re-decide so the already-'decided' Trammell Crow is re-resolvable; conflicts count in the badge. 33 tests; 2 full-suite failures pre-existing (stash-verified). ⏳ merge + redeploy → Trammell Crow card reappears. |
| 78 | PGRST204 schema-drift writers | ✅ **PR #1630.** Diagnosed from `ingest_write_failures` payloads — real before-count **8,306/30d** (grew past U4's 6,945), root-caused to **7 clusters**. Biggest: `attachEnrichDocument`/`insertLccDocument` probe a source-tagged payload that PGRST204s on EVERY attach then degrades (a designed-in failure logger). **Additive migrations applied LIVE to dia+gov first** (deploy-ordering) → column-class clusters stopped immediately; field-removal clusters stop on redeploy. Deterministic backfill ran: 2,377/4,775 `listing_sale_id` links. New `domain-writer-columns.js` contract module + schema-pinned tests (16/16) — drift now breaks CI, not production. Cowork verified live: PGRST204 rate declining (27→6/hr through the evening), to-zero check post-redeploy. ⏳ merge + redeploy. |

### Expansion queue 2026-08-07 — Scott approved all four tracks; prompts 77–81 drafted

Send in this order (leaks before expansion, per doctrine):
| # | What | Class |
|---|---|---|
| 77 | U3 ambiguous_entity_match conflict-resolution card (Trammell Crow is stuck invisible) | small polish |
| 78 | **PGRST204 schema-drift writers** — dia 3,702 + gov 3,243 failed writes/mo, diagnose from `ingest_write_failures` payloads, schema-pinned regression guards | the big leak |
| 79 | **W8 U5 naming-hygiene campaign** — ~6.5k backlog; deterministic dictionary renames (no LLM) + address-as-name → property-LINK proposals (not renames); own lane (75 guard enforces full wiring); bulk-confirm for mechanical renames; flag `W8_U5_NAMING_HYGIENE` | expansion |
| 80 | **Match-disambiguation pre-rank assist** — 1,120 open / 0 ever decided; Ollama annotation-only ranking + agree/disagree self-measurement feeding U4; flag `MATCH_DISAMBIG_ASSIST` | expansion |
| 81 | Ops cleanup — zombie `Unflag Completed Email Tasks` (524 fails, flow supposedly retired), 23505 dedup-respect folds (2,221), 23503 FK (494), 42P10 ON-CONFLICT (243), sidebar 409s | stub list |

### ✅ FIRST FULL HUMAN CYCLE COMPLETE — 2026-08-07 evening (Cowork-verified in DB)
Scott worked all three lanes end-to-end post-76. **U2: 30 verdicts → 30 `entity_match_labels`
training rows written** (3 confirmed_match + 27 distinct = exactly the hard negatives the W4.3
finding diagnosed as missing; 8 pairs remain). Tonight's 7:30 UTC W4.4 retrain consumes them —
the self-learning loop is closed. **U3:** USAA → rejected (human judgment); Trammell Crow →
**`conflict: ambiguous_entity_match`** — the never-guess canonical-resolve guard fired correctly
(≥2 existing Trammell Crow entities; the conflict card awaits a pick-the-survivor decision — check
it surfaces somewhere workable, else queue a polish). U1 cleared earlier (18 verdicts). Wave 8 is
now FULLY validated at every layer: producers → gates → lanes → human verdicts → writers →
training fuel. Nightly crons carry it from here; first narrated U4 report 2026-09-01.

### Prompt 76 landed — PR #1627, repair migration LIVE (Cowork-verified), awaiting merge + redeploy
Mint fix: `canonical_name` via house `normalizeCanonicalName` (same fn as ensureEntityLink);
resolve-before-mint now on canonical_name (case-variants resolve, no dupes); ≥2-match ambiguity →
conflict card kept. Repair applied live + verified: both U3 rows (USAA + Trammell Crow) back to
`proposed`, decided_by cleared, decision row reopened w/ superseded_reason. U2: backend sorts
ollama pairs first + per-seeder `parts`; lane renders one-click seeder chips
("All (5.3k) | Ollama pairs (38) | …"). 12 new tests. **Gate: merge #1627 → redeploy → Scott
confirms Trammell Crow end-to-end (resolve-or-mint w/ canonical_name → entity_relationships edge →
provenance → apply-log → decision 'decided'), then USAA; owner-reconcile chip → 38 pairs.**

### Post-75 live verify 2026-08-07 — U3 lane RENDERS but confirm fails; U2 buried → prompt 76
U3 lane visible (75 works) but Confirm → `entity_mint_failed`: mint INSERT omits
`entities.canonical_name` (NOT NULL, no default — verified live; enum 'organization' is valid).
Also the resolve step matches raw `name=eq.` (would mint case-variant dupes) — 76 switches to the
house canonical_name resolve. The USAA Real Estate proposal (review 1, $14.2M, deed-grounded
"grantor: USAA Real Estate") got mislabeled `rejected` after the error — 76 restores it to
proposed + supersedes the verdict row. **U2:** owner_reconcile lane = ~5,300 rows; the 38 ollama
pairs are undiscoverable → 76 adds seeder filter chips + U2-first sort. Prompt 76 queued.
Proposal quality note: both chain proposals are exactly on-design (deed grantor→prior_owner links
with verbatim quotes, $8M/$14.2M rank properties).

### Prompt 75 landed — PR #1623, awaiting merge + redeploy
U3 lane fully wired (list entry "Ownership links — Ollama proposals" + meta + card branch handling
both pools, verbatim quote + Confirm/Reject → decided/skipped per 74). Badges: DC page now
overrides owner_reconcile + w8_u3_link_review from a NEW lightweight `/api/review-counts` add
(owner_reconcile = 5 folded seeders incl. U2; U3 = open-proposal depth) instead of the heavy
`/api/decisions?summary=1` fan-out — root cause of the 0 badge was that heavy path timing out,
never-overrides-to-0 fallback. **Structural guard shipped and immediately caught THREE more
half-wired lanes** (agency_risk_action/npi_dedup_* missing meta, contact_company_link missing
chip) — all fixed rather than exempted. Every _DC_FEDERATED member now must have list+meta+render
or tests fail. **Gate: merge #1623 → redeploy → hard-refresh DC → expect U3 lane badge 2 (incl.
the first chain link_proposal) + owner_reconcile badge ~38 with pair cards inside.**

### DC lane visibility 2026-08-07 — U3 lane missing from frontend, U2 badge undercounts → prompt 75
U1 lane worked + cleared by Scott (18 verdicts, post-74 fix verified silently). U2/U3 invisible:
Cowork verified against origin/main — **U3** is in `_DC_FEDERATED` but has NO lane-list entry /
meta / card branch (PR #1609 frontend touch incomplete; 2 open proposals incl. the FIRST chain
link_proposal currently unreachable); **U2** folds correctly into owner_reconcile on the backend
(v_w8_u2_dup_pair_open) but the lane badge source (open lcc_decisions by type) doesn't include the
38 folded pairs → 0-badge lane holding real work (honest-counts violation). Neither W8 lane is in
/api/review-counts. **Prompt 75**: complete U3's three frontend touches, badge add-on counts,
structural guard (every _DC_FEDERATED member must have list+meta+render — pins the gap class).
Interim: opening "Owner reconcile — same party?" despite the 0 badge should render the 38 pairs.

### Prompt 74 landed — PR #1621, stranded row repaired live, awaiting merge + redeploy
All six invalid `'resolved'` sites fixed (U1 junk + U3's four close paths → house semantic
`decided`/`skipped`; **U2 was already correct**). Structural guard test pins verdict statuses to
the four CHECK-valid literals. Stranded decision 2831209 closed 'decided' live (its review row 18
was already applied). **Gate: merge #1621 → redeploy → lanes safe to work.** Verify with one U1
verdict (should complete silently).

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
