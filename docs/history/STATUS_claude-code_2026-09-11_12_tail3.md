# STATUS archive — Claude Code queue, 2026-09-11/12 tail (third cut)

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-14, **before pushing**, per the CLAUDE.md
doctrine *"TWO BRANCHES THAT BOTH ADD TO A SHARED DOC MERGE CLEANLY AND SILENTLY DUPLICATE IT"*: this file grows
on `main` while a branch is open, so archive to hold 200+ lines of headroom rather than trimming when CI goes red
(`test/status-line-budget.test.mjs`, budget 2,500). Nothing was reworded, summarised or dropped. Every still-open
item named below is tracked in `docs/os/PLANNED-BACKLOG.md`, the canonical open-work list; for the HP1 arc the
map is `docs/architecture/HOMEPAGE-ATTENTION-SURFACE.md`.

Covers 9 entries, from *2026-09-12 — ID3a-d reconciled: ownership table settled (LCC owns Dialysis_DB); blast* to *2026-09-12 -- ID3a measured before wiring: the canonicalizer itself has a live contam*.

---

## 2026-09-12 — ID3a-d reconciled: ownership table settled (LCC owns Dialysis_DB); blast radius measured at 188 live objects; drift run still owed

Filed `responses/ID3a-d desktop response.docx` → `done/`; prompt → `prompts/done/`. ID3a-d shipped on branch
`claude/id3a-d-db-ownership` — **PR #2352 is OPEN, not merged; `main` is still at #2351**, so the retirement README, the
CI guard and the drift-check design are not on `main` yet. It wrote the ownership table into `CLAUDE.md`/I16/`REGISTRY.md`,
marked all 213 `migrations/government/*` files historical (README + per-file header, naming the stale canonicalizer and the
two mappings a re-apply would restore), added a CI guard against new gov migrations landing here, and **refused to fabricate
a drift result** it had no DB access to produce — the right call. **Cowork measured what ID3a-d could not:** of the 194
objects those retired files define, **188 are live right now (86 functions, 102 views)** — the retirement is a live-overwrite
hazard, not housekeeping. Live gov census: 277 functions, 252 views, 91 triggers. 👤 **Scott decided: `life-command-center`
owns Dialysis_DB**, not the Dialysis repo as ID3a-d proposed — the operator registry, aliases, guards, comps engine and
market-brief producers all ship from here, and declaring otherwise would orphan this week's ID2a work; the Dialysis repo owns
CMS/NPI **ingestion** (rows, not schema). That closes **ID3a-d-dia**: LCC's 277 `migrations/dialysis/*` stay live and owned,
and must NOT be retired. New row **ID3a-e**: run the drift detector for real in a session that has both repos, report the
drift list, then schedule it. **Next:** merge PR #2352, then ID3e (county vocabulary) or MB-b (the visible brief).
## 2026-09-12 — HP1 filed: the homepage Today 500 root-caused, and My Work / Inbox measured as pre-doctrine widgets

Live read-only Cowork triage of Scott's screenshot (all three Today lanes showing `HTTP 500`; My Work
and Inbox behind actual deal status). Filed `prompts/HP1-homepage-attention-surface-triage.md`. Nothing
built, nothing written to the DB.

**The 500 is one endpoint and one unhandled throw.** `GET /api/operations?action=today_sections`
(`api/operations.js:2038`) fires six queries in `Promise.all`; `opsQuery` (`ops-db.js:63`) calls
`fetchWithTimeout` with an **8 s default and no try/catch**, and an `AbortController` abort makes
`fetch` **throw**, not resolve `{ok:false}` — so the handler's `sellerQR.ok ? … : []` guard is dead
code for the timeout case and the rejection reaches `withErrorHandler` as a 500. All three lanes
render from that one response, which is why one failure draws three errors. The slow source, measured
with `EXPLAIN ANALYZE`: `v_lcc_seller_prospect_queue` = **815 ms** for the 200-row page + **750 ms**
for the exact `COUNT(*)` PostgREST runs alongside it under `count=exact`, on a plan carrying two
`Seq Scan`s of `entities` (56,289 rows), a `Seq Scan` of `lcc_property_attributes` (30,928), 33,812
heap fetches on `entity_relationships`, and a `SubPlan` executed 1,518×. Cold cache on first load
after idle is what crosses 8 s — matching "every so often when we log into the app." **The fix already
exists in this repo and was never applied here:** `ops-db.js:80-84` documents the R6 `timeoutMs`
option added for exactly this ("heavy aggregate views … need more headroom so a slow-but-successful
read isn't aborted into a blanket 500"); `getTodaySections` passes none on any of its six calls.

**My Work is stale because the deal backbone froze, and no task ever ages out.** 66 open
`action_items`, **57 overdue, 38 by more than 30 days**; 37 are `deal_next_step` from
`source_type='deal_stage_engine'`. `lcc_generate_deal_next_steps()` (cron `lcc-deal-next-steps-daily`,
active) retires a task ONLY when `bd_opportunities.stage` changes or the deal closes — **there is no
time-based retirement**. And the stage data it keys on has not moved: `off_market_listing` and
`loi_executed` last updated **2026-08-03**, `bov` **2026-08-04**, while **22 of the 50 open deals have
an `expected_close_date` already in the past** (ECU Physicians MOB 2024-08-27; Pops Mart Fuels
2025-09-25). Scott's two screenshot cards trace exactly here: *DaVita Portfolio 4 - Realty Income* is
still `loi_executed` with close 2026-07-16 (58 days past, task due = close−14 = Jul 2), *Queens - NY*
still `listing_signed`. `bd_opportunities` is **pushed** from Salesforce via Power Automate into
`/api/pipeline/ingest-opportunity` — nothing pulls, and there is no freshness assertion on the deal
backbone even though `lcc-bd-sync-health-check` and `lcc-feed-freshness-sync` exist for other feeds.
**Not determined read-only, and NOT to be assumed: whether the frozen stages are a Salesforce hygiene
gap or a PA scope gap — 👤 Scott.**

**The Inbox is a reverse-chronological mailbox holding mostly machine work.** 953 items at
`status='new'`, of which **850 are `new_contact_qualify` and 38 `contact_misparse_review` — 93% data
hygiene**, not broker judgment. The human-facing residue is market data, not decisions: a competitor's
Spokane DaVita listing blast present **twice** (original + FW, not deduped), an SSA Minden new-listing
announcement, a Fresenius Pittsboro SOLD COMP notice, and a **bank balance alert**. Four of the 21 new
`email_om` rows are titled from the raw MIME filename (`OM: email-body-AAVtKA8aAAA.txt`) because no
property resolved. `inbox_items.priority_score` **exists and is dead**: written only by
`api/intake.js:1054` for `domain='infra'` rows, never read — `v2GetInbox` (`api/queue.js:517`) orders
`received_at.desc`. The classifier is fine (3,847 triaged + 2,252 dismissed vs 21 new); this is a
routing-and-ranking problem, not a classification one.

**The design finding underneath all three:** the homepage runs three widgets at three orderings —
Today (client-value ranked, per operator-doctrine 1.8.0, and the one that 500s), My Work
(`due_date.asc`, so the most-ignored task is pinned to the top), Inbox (`received_at.desc`). My Work
and Inbox are **pre-doctrine widgets never re-cut when UX-T1a-today shipped 2026-09-03**. The
alignment Scott is asking for is finishing that cut: make Today reliable, make My Work its Urgent
detail view on the same ranking function, and reduce the Inbox to items needing a human verdict.

**Next:** HP1 P0 (`allSettled` + timeout budget + count mode + per-lane error, with a guard test that
a thrown source degrades one lane and still returns 200), then P1 (backbone freshness + deal-status
confirmation lane) after Scott settles the SF-vs-PA question.

## 2026-09-12 — ID3a-c reconciled: agency class closed (live-verified), and a repo-ownership hazard found — gov DB now owned by `government-lease`

Filed `responses/ID3a-c desktop response.docx` → `done/`; prompt → `prompts/done/`. **Verified live (Cowork, read-only):**
`Immigration & Customs Enforcement` → **ICE** (root cause: `&` never normalized to `and`, so ICE fell through CBP's bare
`customs` match), `Border Patrol` → CBP, `Dept of Homeland Security` → DHS; **9 federal `Department of X` patterns were
matching state departments of the same name** — `TEXAS DEPARTMENT OF AGRICULTURE` → USDA, now NULL with `US Department of
Agriculture` intact, via one shared state-qualifier guard. GSA rule **474/624 → 624/624** (Scott's own `GSA - Social
Security Admin` example was the broken one). Registry **65 → 79**; `properties.agency_id` **7,369 → 8,875**;
`property_agencies.agency_id` **119,361 → 120,471**; review lane gained a retire mechanism (348 retired, 1,135 open).
**The finding that outranks all of it:** this work shipped in the **`government-lease`** repo (PR #398), while
`life-command-center` holds 213 `migrations/government/*` files — including its own copy of this same function **without**
the state guard and with the old ICE branch order. Re-applying it would silently restore both defects. 👤 **Scott decided:
`government-lease` owns the government DB.** Recorded as a new `CLAUDE.md` core doctrine, as the repo-level instance of
invariant **I16**, and as backlog **ID3a-d** (retire LCC's gov migrations with a pointer, name the owning repo for dia and
LCC Opps, ship the deployed-vs-committed drift check). **Next:** `prompts/ID3ad-db-ownership-and-drift-guard.md`, then ID3e
(county vocabulary, ready). Deferred from ID3a-c: USFS/BLM/NSF regex gaps, 10 FK granularity judgment calls, the
drift-detector views (built, unscheduled).

## 2026-09-12 — ID3a-b reconciled: agency contamination fixed live (NAVY 150→3, STATE 213→9), but registry + wiring didn't land; new invariant I16

Filed `responses/ID3a-b desktop response.docx` → `done/`; prompt → `prompts/done/`. **Verified live (Cowork, read-only):**
`canonicalize_agency()` now returns NULL for `Navy Federal Credit Union`, `State of Texas`, `Handel's Homemade Ice Cream`,
bare `DOC` and `RICHMOND FIELD OFFICE (VA)`, while `Department of the Navy` still resolves to NAVY. NAVY 150→3, STATE 213→9,
ICE 44→43, DOC 16→1. The `(XX)` state-suffix rule is general across 15 `<CITY> FIELD OFFICE (XX)` strings. `using_agency_*`
columns exist on properties/leases/sales_transactions, 456 of 623 GSA-compound rows populated. **ID3a-b's own key discovery:
the DEPLOYED `canonicalize_agency()` had drifted from its committed migration** (undocumented hand-patch; the regexes already
had word boundaries and were merely too permissive) → new invariant **I16: running is not committed** — the inverse of the
repo's "MERGED is not RUNNING" doctrine — with the detector specified and the interim rule (read the deployed definition
before editing any DB object). **Three gaps found by the live check → ID3a-c:** (1) `Immigration & Customs Enforcement`
canonicalizes to **CBP** (the `customs` branch wins), so 16 properties carry the wrong DHS component; `Border Patrol` and
`Dept of Homeland Security` resolve to NULL though DHS is in the registry. (2) The GSA-compound rule is inconsistent —
150 `GSA - Social Security Admin` rows put SSA in the lease-counterparty column while 473 others correctly keep GSA there;
Scott's rule is *tenant is GSA, user is whatever is second*. (3) §3/§4 never landed: `government_agencies` still 65 rows
(no NAVY/ARMY/LSC/…), `properties.agency_id` still **7,369/20,509**, 1,347 canonicalized-but-unlinked, review lane 1,483 open.
**Next:** send `prompts/ID3ac-agency-finish-registry-wiring-and-dhs-components.md`. ID3e (county vocabulary) remains ready.

## 2026-09-12 — ID3a-b SHIPPED: canonicalize_agency() contamination fixed (NAVY/STATE/DOC/ICE), GSA using-agency added

Ran the ID3a-b prompt live against gov (`scknotsqkcheojiaewwh`). Migration
`supabase/migrations/government/20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql`,
applied and backfilled (properties/leases/sales_transactions), reversible via
`_gov_id3ab_agency_backup_20260912`. Guard `test/gov-id3ab-agency-canonicalizer.test.mjs` (14
tests); full suite green (5,992 pass / 0 fail / 6 skipped).

**The regex fixes, live-measured before/after (properties table):**
- NAVY **150 → 3** — `*federal credit union` excluded before the NAVY branch (145 *Navy Federal
  Credit Union* rows now resolve NULL → review `private_company_name_collision`).
- STATE **213 → 9** — bare `\mstate\M` replaced with a closed allowlist. It was matching the
  ordinary English word inside 213 STATE-GOVERNMENT names: "State of Texas", "Washington State
  Dept of Social and Health Services", and "DEPARTMENT OF STATE HEALTH SERVICES" (Texas DSHS),
  which contains the literal substring "department of state" and would have survived a
  substring-only fix.
- Bare DOC **16 → 1** (the 1 survivor is "North Carolina Department of Commerce", spelled-out
  phrase). The other 15 (`DOC`, `DOC/P&PO`, `DOC&PS`) route to review as
  `ambiguous_doc_commerce_or_corrections` — never auto-linked to Commerce.
- **Found while shipping, not in the original brief:** ICE **44 → 43** — `\mice\M` was matching
  "Handel's Homemade Ice Cream & Yogurt". Same shape as NAVY, fixed the same way.
- `RICHMOND FIELD OFFICE (VA)` and every trailing `"(<two letters>)"` state-code suffix are now
  stripped BEFORE any keyword match, generally — not a Richmond/VA-specific patch.
- ACE aliased to USACE **case-sensitively on the raw input only** — a bare lowercase `\mace\M`
  was deliberately NOT added (this exact repo's gov CLAUDE.md documents an "Ace Hardware" sale
  existing in this database; a lowercase word-boundary match would misread it as the Army Corps).
- NAVY/ARMY/DOC/LSC/DOL/USGS/NRC/NIH/NLRB/USAF/TREAS were **already live** in
  `canonicalize_agency_full()` — a QA-24/QA-30 hand-patch the committed migration never reflected
  (a "running but not merged" case). Committed the live body verbatim rather than re-adding rows
  that already existed.
- `GSA - <AGENCY>` measured at **624 properties / 106 distinct raw strings** (not the ~168–330
  estimated). `agency_canonical` stays GSA (lease counterparty, unchanged); a second pair of
  columns, `using_agency_canonical`/`using_agency_full`, carries the occupying agency — one lease,
  two facts. 456 of 624 resolve today; the rest use an abbreviated form ("dept of" not "department
  of") the comparator doesn't expand — a stated gap, NULL not guessed.

**Still live, confirmed, filed as ID3a-c, NOT fixed here (scope discipline):** DOJ (includes
`TEXAS JUVENILE JUSTICE DEPARTMENT` ×5), EPA (a Georgia state environmental dept), DOL (two
Pennsylvania Dept-of-Labor-and-Industry variants), ED (Alabama's + a NJ school board's education
depts), DOT (California's + NY State's transportation depts) each fold in a same-named STATE
agency, the identical shape STATE just had fixed. The separate `government_agencies`/
`gov_agency_aliases` FK registry ID3a wired is untouched by this change — display column and FK
registry are two different systems on purpose (`ID3a-regdup`, `ID3a-registry-gaps`,
`ID3a-detector-schedule`, `ID3a-consumer-switch` all remain open, unrelated to this fix).

Docs updated in the same change: `PLANNED-BACKLOG.md` (§P0d rows ID3a-b, ID3a-canonical-repair,
ID3a-gsa-compound closed/updated; new row ID3a-c filed), `data-coherence-invariants.md` (I13),
`CURRENT-STATE.md`.
## 2026-09-12 — ID3e SHIPPED: county/city vocabulary fold (I14), never merges across state

Built from the pre-written prompt (`docs/claude-code/prompts/ID3e-county-city-vocabulary-fold.md`) and its own
measurement note. Re-measured live before building (numbers move slightly, as expected): gov `properties.county`/`state`
2,445→1,611 (834 collapse), gov `city`/`state` 3,454→3,225 (229 collapse), dia `medicare_clinics.city`/`state`
4,367→3,635 (732 collapse). **This is I14 controlled-vocabulary work, not ID3a's FK-wiring pattern** — no registry
table, no `_id` column: one IMMUTABLE normalizer (`gov_normalize_place_token`/`dia_normalize_place_token`) + STORED
generated columns (`county_norm`/`city_norm`) keyed on `(normalized_name, lower(trim(state)))` as a **pair, never name
alone**. Verified live: `St Louis|mn` ≠ `St Louis|mo` (cross-state same-name counties never fold); `RICHMOND (CITY)`
and `Richmond city` fold to one `richmond city|va` key (VA independent cities fold across punctuation, never with a
same-named county — punctuation normalizes to a **space**, never deleted, which is what keeps the `city` token alive).
The two corrupted-state rows (`property_id 6638` state=`M`, `property_id 16465` state=`|`) route to
`v_gov_place_vocab_state_review`, untouched. Parity views `v_{gov,dia}_{county,city}_fold_groups` expose every merged
group. `property_type` (96 values, only 9 collapse) confirmed a taxonomy question, not a case-fold — scoped out as
`ID3e-property-type-taxonomy`. Migrations applied live + committed
(`supabase/migrations/{government,dialysis}/20260912120000_*_id3e_*_vocab_fold.sql`); offline structural guard
`test/id3e-migration-shape.test.mjs` (13/13 pass, comments stripped before matching); live positive-control
`test/sql/id3e-place-vocab-fold.live.test.mjs` (kept out of the `npm test` glob per the hermetic-suite doctrine — it
reaches Supabase directly, so it's a manual/CI-secret-gated check, not a `npm test` member). Full suite: 5,991 pass /
0 fail / 6 skipped. **Not built:** no consumer repointed to read the new columns yet — that's a separate decision.

## 2026-09-12 — ID2a-cleanup + ID3a reconciled: operator registry clean; gov agency WIRED but the NAVY regex is still live

Both responses filed. **ID2a-cleanup (PR #2337) verified live:** aliases 42 → 207, review queue 1,020 → 71 open, 807
category/payer rows routed to `properties.operator_class`, 5 subsidiaries parented (not merged), 9 junk rows
reclassified, `operator_id` 9,307 → 9,449, parity byte-identical on the 7 canonicals. **ID3a (PRs #2338/#2339)
measured before building** — and caught a live contamination bug: `canonicalize_agency()` prefix-matches `^navy`
with no word boundary, so 145 **Navy Federal Credit Union** rows (a private bank) carry `agency_canonical='NAVY'`.
Wiring shipped anyway: `properties.agency_id` 0 → **7,369/20,509**, `property_agencies.agency_id` 0.12% → **90.3%**,
alias/review tables and both guards live. **Cowork live check: the bug is NOT fixed** — the NAVY rows are unlinked only
because no `NAVY` registry row exists, and `canonicalize_agency('Navy Federal Credit Union')` still returns `NAVY`, so
adding that row would promote a credit union to a federal agency across 145 properties. Also open: 1,732 rows
canonicalized-but-unlinked, 8,838 with agency text and no canonical, and the registry lacks NAVY/ARMY/DOC/LSC/DOL/
USGS/NRC/NIH/NLRB/USAF/TREAS (it has `USACE` but no `ACE` alias — the 614 Tully Rd twin, ID3i). **Scott decided
(2026-09-12):** `RICHMOND FIELD OFFICE (VA)` is **Virginia**, not Veterans Affairs; bare `DOC` is state **Corrections**
— verify all 16, auto-link none; **`GSA - <AGENCY>` is SINGLE-TENANT** — *"the tenant is the GSA but the user is whatever
is second"* — so keep one lease and add a using-agency field beside the lease-counterparty agency. New row **ID3a-b**
carries all of it, regex fix first. **Next:** send `prompts/ID3ab-agency-canonicalizer-fix-and-finish-wiring.md`.

## 2026-09-12 — ID2a-cleanup SHIPPED and live-verified against Dialysis_DB (aliases 42→207, review 1,020→71)

Ran the ID2a-cleanup prompt against live Dialysis_DB (`mcp__Supabase__apply_migration`, real writes,
measured before AND after in the same session — not a static-analysis prediction). Migration
`supabase/migrations/dialysis/20260912120000_dia_id2acleanup_operator_registry_finish.sql`.

The fix that shrank everything else: **seeded an exact-match alias for every live company operator's
own name + `dba_names`** — `dia_resolve_operator` only ever knew the 6 hardcoded families, so a
property whose raw text was literally a registered operator's own name (Northwest Kidney Centers,
Wake Forest University, Sanford Health, ...) still hard-blocked into the review queue. Aliases
42 → 207; review queue 1,020 open → **71 open** (142 resolved onto 14 real operators, verified
byte-exact against the parity table; 807 dismissed as classifications, see next). Also: merged the
two byte-identical `Us Renal Care Inc` / `Dialysis Clinic Inc` duplicates ID2a's exact-string array
missed; parented (never merged) BMA Quincy / BMA OF NORTH CHARLOTTE / KNICKERBOCKER under Fresenius
and DCI East Gainesville under DCI; reclassified 9 person/junk rows to a new `kind='junk'`; added
additive `properties.operator_class` (category/payer/non_operator) so those rows never occupy a human
queue slot again, backfilled on the 807 already-existing rows too; shipped the orphan-registry-gap
detector (`v_dia_operator_orphan_registry_gap`, reads 0 today) for the ID3a-class generalization.
**Parity proven, not asserted:** the 7 pre-existing merged canonicals are byte-identical
before/after (0 properties moved by the two new dedup merges — both duplicates carried 0 properties).
Guard `test/id2a-cleanup-operator-registry.test.mjs` (13 tests) + full suite green (5,966/0).
**ID2b is now unblocked on the registry side** — `operator_id` covers 9,449/11,804 (80.1%), see
`PLANNED-BACKLOG.md` §P0d ID2a-cleanup/ID2b/ID2c-payer. **Next:** ID2b (consumer switch) or ID3a
(gov agency wiring), per Scott's priority.
## 2026-09-12 -- ID3a measured before wiring: the canonicalizer itself has a live contamination bug

Picked up ID3a next (Scott's #1 identity class, ranked first 2026-09-12). Before touching the
alias/backfill/guard build the drafted prompt calls for, did its own Section 1 ("measure before
wiring") live against the gov database -- the same discipline that caught OWN-T0h's counting bug and
RO4's root cause.

Two findings that change the prompt's scope, both live-verified:

1. The "811 distinct uncanonicalized agency strings" population is contaminated by literal archived
   junk: 2,670 rows / 20 strings carry `data_source='junk_backfill_archived_2026-06-09'` (e.g. "10
   Federal Self Storage" duplicated across 10+ property_id rows at one address). Excluding them, the
   real population is 6,168 rows / 804 distinct strings.

2. More important: even the ALREADY-canonicalized 8,674 rows have drift -- 887 carry a code with no
   matching row in the 65-row `government_agencies` registry. Read each code's raw strings rather than
   assuming they're all registry gaps, and found one is not a gap at all but a live bug: `NAVY` (150
   rows) is 145 rows of "Navy Federal Credit Union" -- a private bank -- because
   `canonicalize_agency()`'s own regex (`gov_round_76bg_agency_canonicalizer.sql` line 53,
   `x ~ '^navy|department of the navy'`) prefix-matches "Navy" with no word boundary. `DOC` (16 rows,
   mostly bare `DOC`/`DOC/P&PO`/`DOC&PS`) is plausibly the same class -- likely a state Department of
   Corrections abbreviation read as federal Commerce -- flagged as unconfirmed rather than guessed. The
   other 9 missing codes (LSC/DOL/USGS/ARMY/NRC/NIH/NLRB/USAF/TREAS, ~400 rows) are genuine, safe
   registry gaps -- real federal agencies just missing a row.

This flips the ID3a build order: wiring `properties.agency_id`/`property_agencies.agency_id` to the
existing canonicalizer BEFORE fixing the NAVY regex would durably promote a private credit union to a
federal-agency record on every property it touches -- a worse defect than the unwired FK it was meant
to fix. Documented both findings in the ID3a backlog row and added a warning block directly to
`docs/claude-code/prompts/ID3a-gov-agency-wiring-and-first-detector.md` (the artifact a build session
will actually read) so this isn't rediscovered the hard way mid-build.

No code changed -- this was measurement only, same as RO4/RO5's pattern. The safe registry-gap
backfill (9 codes) can proceed independently since it's additive and doesn't touch the regex; the NAVY
fix and the DOC verification are prerequisites for the FK wiring itself.


> **📦 ARCHIVE (2026-09-14, tenth span):** a further run of 2026-09-11 entries was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-11_tail2.md`](../history/STATUS_claude-code_2026-09-11_tail2.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.
