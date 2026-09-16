# STATUS archive — Claude Code queue, 2026-09-12 → 2026-09-14 (eighteenth span)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-16 to keep that file under its
3,000-line budget (it was at 2,759, over the 80% soft-warn). Nothing was reworded or dropped; every
still-open item named here is tracked in `docs/os/PLANNED-BACKLOG.md`, which is the canonical
open-work list. The span covers the ID3b ship, the 2026-09-14 prompt-queue audit / HP1-P2misparse-fp /
HP1-P2f-urgent / FEED2-weekend / PRI6 entries, and the 2026-09-12 HP1-P2f-urgent → BACKLOG-ids run.

---
## 2026-09-12 — ID3b shipped: gov owner fuzzy-variant merge (Cowork)

Continued the "ownership connectivity" redirect (Scott: audit property→recorded-owner→developer
chain→true-owner→contact discovery/enrichment across LCC/Outlook/WebEx/Salesforce) by executing
**ID3b**, the highest-leverage concrete step per `docs/architecture/ownership-truth-pipeline-state.md`'s
own finding that entity-dedup fixed once upstream benefits multiple stages at once, and per Scott's
own "THIRD by Scott 2026-09-12" sequencing.

Re-measured live before building (RO2a's numbers were a day old): gov `recorded_owners` fuzzy-variant
population unchanged at 1,380 groups / 2,870 rows; gov `true_owners` at 227 groups / 461 rows (down
from the prior day's 237/483 as other identity work kept chipping at it). Confirmed the existing merge
machinery (`apply_owner_merge`, `apply_true_owner_merge`) needs no extension — both already accept
arbitrary caller-supplied survivor/loser pairs. Confirmed no reusable SQL guard exists for bank/lender
exclusion (`lenderNamePasses` in `sidebar-pipeline.js` was checked and rejected — it deliberately does
NOT exclude banks, wrong model for "bank captured as owner should route to review").

Shipped two new tick functions, `gov_owner_variant_merge_tick(p_dry_run)` and
`gov_true_owner_variant_merge_tick(p_dry_run)`: group by `gov_owner_strict_core` (core ≥4 chars),
survivor = highest-property-count member, guard every group through `gov_owner_name_is_brokerage`,
`is_generic_gov_owner`, and a new bank/lender/lienholder regex — any hit routes the WHOLE group to
`entity_match_candidates`/`gov_owner_merge_review_log`, never auto-merged. Dry-run matched the live run
exactly on both tables.

**Live results:** `recorded_owners` 1,380 groups seen, 1,466 merged, 24 routed to review (22 groups —
hand-checked: correctly caught `CBRE`, four `U.S. Bank National Association` casings, JPMorgan Chase,
TD Bank, Umpqua, SunTrust, World Bank, a title/land-trust company, and three brokerage names —
Colliers, Northmarq, Marcus & Millichap — riding inside one JV description string). `true_owners` 227
groups seen, 232 merged, 2 routed to review (TD Bank / U.S. Bank). **Parity confirmed bit-for-bit**:
`total_properties` (20,509), `properties_with_recorded_owner` (9,327), `properties_with_true_owner`
(9,848) were unchanged before/after both live runs — only unmerged-owner-row counts dropped by exactly
the merged-loser counts. No property silently moved to a different real owner. dia confirmed untouched
(already zero exact AND fuzzy dups, no build needed).

Migration: committed in `government-lease` (`sql/20261013_gov_id3b_owner_variant_merge.sql`) --
the owning repo per ID3a-d, not life-command-center. **Correction, 2026-09-14:** this file was
first committed to life-command-center's now-retired `supabase/migrations/government/` directory
by mistake; PR #2420's CI caught it (`test/gov-migrations-directory-retired.test.mjs` -- the exact
regression guard ID3a-d built for this exact mistake). Moved to `government-lease` where it
belongs; the live database change itself was correct and unaffected throughout. `PLANNED-BACKLOG.md`
ID3b and RO2a rows marked executed with the live numbers. `ownership-truth-pipeline-state.md`
Stage 3 refreshed to note the entity-dedup residue this closes.

No Railway redeploy needed (DB-only, no application consumer changed). Left for a human: the 26
review-lane rows (`gov_owner_merge_review_log`); Stage 3's remaining `OWN-T0b/c/d/f/g` (417
`duplicate_entity` merges) and Stage 4's contact-linkage gaps are the next candidates in this pipeline,
not yet started.
## 2026-09-14 — Prompt-queue audit: two prompts existed in BOTH `prompts/` and `prompts/done/`; PDR2's blast radius is ~2× what it says (Cowork)

Before adding a fourth prompt to Scott's queue, checked whether the queue is accurate — an earlier XB2 pass found
shipped prompts still sitting in `prompts/`, and the failure mode is worse than untidiness: a future chat re-runs
finished work.

**Found and fixed:**
- ⛔ **`PRI4` and `PRI5` were in `prompts/` AND `prompts/done/` — byte-identical (md5 verified).** Both are shipped
  and deployed (PRI5 confirmed by Scott 2026-09-11; PRI4 merged via PR #2293/#2297). A file in two places is worse
  than a stale one: a reader cannot tell which is canonical. Active-queue copies moved to
  `_superseded/prompt-queue-audit-2026-09-14/` with a manifest row — not deleted, and `prompts/done/` keeps the
  canonical copy.
- **`MB2a` was ✅ BUILT with a response already filed, but its prompt was still in the active queue** → `done/`.
  (Its follow-on `MB2a-deploy` stays 🚨 open — a separate row, correctly.)
- Two new prompts arrived from parallel Claude Code work (`HCRIS-TIMEOUT`, `MB2bc`). **Queue is now 7, all
  genuinely open**: `BR1`, `HCRIS-TIMEOUT`, `HP1-P2misparse-fp`, `ID3b`, `ID3d`, `MB2bc`, `PDR2`.

🔴 **And the audit turned up the thing that should be built next — PDR2, whose own headline understates it by
about half.** The prompt says *"~4,026 properties"*; that is the **no-fallback subset**. Re-measured live in
Dialysis_DB: **7,937** properties point `true_owner_id` at an `is_operator_not_owner=true` row, and **4,022** of
those also have `recorded_owner_id IS NULL` — so even the readers that guard correctly have **nothing to fall back
to**. Top offenders: **Fresenius 3,077 · DaVita Inc. 2,625 · DaVita Kidney Care 1,182 · U.S. Renal Care 343 ·
Dialysis Clinic Inc 256 · American Renal 221** — **every major operator, not one bad DaVita placeholder.**

**Why it outranks the rest of the queue:** for a net-lease broker the entire job is identifying and calling the
**owner**. `get_property_context` — the MCP tool and the property packet Scott actually reads — currently answers
*"the owner is DaVita"* when DaVita is the **tenant**. And two other readers in this same repo already guard it
correctly (`assemblePropertyDossier` §1.6, `sf-link-reconcile.js::isOperator()`), so it is a **one-file
inconsistency, not a data problem** — cheap to fix, expensive to leave.

Corrected the figure in the prompt header and on the backlog row rather than leaving a dated number to be quoted
again (*"re-measure a dated blocker before quoting it"*). §1 of the prompt still requires CC to re-measure rather
than inherit even these.

## 2026-09-14 — HP1-P2misparse-fp prompt: the guard blocks real people, and a shape fix cannot repair it (Cowork)

Sized the last 🔴 under HP1 before writing anything, and the sizing changed the shape of the fix.

**Root cause, exact:** `STREET_SUFFIX_RE` at **`api/_shared/tm-misparse.js:42`** matches a street-suffix token at
the **end** of a name. A person whose **surname is a street word** therefore flags as a misparsed address.
**`Brian Lane <blane@northmarq.com>` — a Northmarq colleague, Scott's own firm — fires under *two* reasons**
(`misparse_name` and `person_junk_name`), and every CoStar capture of him has been silently discarded for as long
as the arm has been live. Live sizing: **3 rejections / 2 distinct people**, both person-shaped, both carrying an
email, and **zero** street-suffix blocks in that lane start with a house number.

⛔ **The obvious fix is wrong, and the prompt says so up front.** "Only flag if it doesn't look like *First
Last*" **fails against this file's own fixtures**: `Hinckle Walk` and `Jack Kerouac Aly SE` are real TrafficMetrix
street captures that are **exactly as person-shaped as `Brian Lane`**. Any shape rule admitting one admits the
other. Checking that before drafting is what stopped this being a prompt that shipped a regression.

✅ **The discriminator is the corroborating email local part** — a street capture has no personal mailbox; a real
person has one that matches the name (`blane@` ↔ **B**rian **Lane**). And **the matcher already exists**:
`localPartMatchRule()` (`api/_shared/misparse-disposition.js:150`), shipped by HP1-P2misparse for the fan-out
recovery. Reuse, not a second copy — a second matching shape is the drift that produced `inbox_items.domain`'s
four spellings.

⚠️ **Honest scope, stated in the prompt rather than discovered later:** this rescues Brian Lane. It does **not**
rescue `Jim Street <mgreencre@gmail.com>`, whose generic mailbox corroborates nothing — nothing in the data
distinguishes him from a street capture, so he stays blocked and is filed as a residual. **A fix that rescues one
real person and says so beats one that rescues two and cannot prove the second.**

⚠️ **And a false comment to correct in the same change:** `tm-misparse.js` asserts *"real people must NOT flag —
the never-flag-clean-'First Last' guarantee is preserved."* True for `sentence_fragment`, `doc_label` and
`bare_title`; **false for `street_suffix`**, and the comment does not say so. A comment claiming a guarantee the
code no longer keeps is a defect in its own right.

**Gate is two-sided (Class 11)**, because a guard change can fail in both directions: every one of the 22 fixtures
must still return `street_suffix`, **and** the real people must mint, **and** a name that is *only* a street must
stay blocked even with a corroborating-looking email. If no rule separates them, the prompt says **report and
stop** — a documented open false positive is a legitimate outcome; widening the guard until the fixtures pass by
luck is not.

## 2026-09-14 — HP1-P2f-urgent shipped AND running; HP1 closed out with a topic page (Cowork)

PR #2419 merged. Response and prompt filed to `done/`. **CC's own caveat resolved by measurement, not assumption:**
it closed saying *"this takes effect after the next Railway redeploy."* Checked — `/version` on `tranquil-delight`
reports **`ba22b8abac78`**, which **is** `main`. Merged **and** running. (The repo's own "merged is not running"
rule, applied to the sentence that raised it.)

**Live, today:** Significant **518** · Important **46** · **Urgent 59** · Inbox **92**. Urgent was ≈**1,664**; the
**1,603** `contact_writeback` rows now sit behind a pointer linking to the BD worklist's pre-existing
**"Push to CRM"** chip — a destination this change did not touch, and verified reachable before it. ⚠️ That
population **moves** (1,664 → 1,730 → 1,669 → 1,603 across four reads in a day) — quote it at read time.

📘 **The consolidation Scott has been asking for, made concrete: `docs/architecture/HOMEPAGE-ATTENTION-SURFACE.md`.**
Until now the entire HP1 arc existed only as **17 open backlog rows, ~20 STATUS entries (most already archived),
and a dozen files in `prompts/done/`** — a future chat would have had to reconstruct it from fragments, which is
exactly the misdirection this cleanup exists to prevent. The page is the **one door**: what each of the three
symptoms turned out to be (vs what it looked like), what Today and the Inbox contain now with live numbers, where
the code lives, which guards protect it, and what is still open — with an explicit instruction to re-read the live
rows rather than trust its own list. `PLANNED-BACKLOG.md`'s HP1 section header and `CURRENT-STATE.md` now point at
it, and it states plainly that the **backlog remains the canonical open-work list; the page is the map, not a
second backlog** (a second copy of the open work is how `MB3`×4 happened).

**The five rules the arc produced, now written down in one place** rather than scattered across the entries that
earned them: check the destination before routing anything off a surface · never verify on an HTTP 200 · a monitor
must be producer-keyed, not table-keyed · a detector that has never fired is not a detector · a skipped step must
emit to a counter, not to the broker.

**What HP1 was, in one line:** three symptoms that looked like UI problems and were not — an unhandled abort
killing three lanes at once, a six-week silent write failure hiding under an HTTP 200, and two lanes of machine
output rendered as broker decisions. **What remains under `HP1-` is follow-on work, not the original report.**

## 2026-09-14 — FEED2 held through a real weekend; MB2b/MB2c/FEED2-test bundled and measured (Cowork)

**FEED2 verified in production, not just at apply time.** The health cron has run twice since the fix
(Sun 09-13, Mon 09-14): **zero alerts, max streak 1**, today 13 feeds all returning items. Sunday is
precisely the run the old `9999`-sentinel logic would have turned into **16 false alerts**.
**MB2c measured on the live feed — it is one character.** `([^-–—]+)$` → `(.+)$`; the greedy `(.*)`
already anchors to the last separator. Across **101 real titles** with a separator: old parsed 98, new
parses **101**, **0 previously-correct parses changed**. Fixes `Honolulu Star-Advertiser` and two
`ad-hoc-news.de` items. Regression corpus named in the prompt, since hyphens *before* the separator are
what make a naive rewrite dangerous.
**Sharper MB2b diagnosis, correcting my own earlier note:** the ESRD feed's problem is its narrow
query's low volume, **not** Federal Register — the FR GSA-agency feed on the same service publishes
daily. So: per-feed `maxAgeHours` (default 72), not a blanket "policy feed" exemption, and not a global
widening of the 72h window.
All three bundled into `prompts/MB2bc-fix-the-instrumentation-then-judge-PRSS.md` — they are one theme
(our instrumentation is wrong, not the sources) and together they decide whether PRSS can flip.
## 2026-09-14 — `PRI6` confirmed merged both sides; the "stuck for 2+ days" run turned out to be four run cycles chained back-to-back, all hitting a separate, months-old timeout defect (`HCRIS-TIMEOUT`), not a hang

Scott confirmed `Dialysis` PR `#7409` merged — `PRI6` closed to ✅ in `PLANNED-BACKLOG.md`, both sides now
confirmed.

Scott then reported a CMS ingestion run as running "more than 2 days" and asked whether to keep it going.
**Checked live rather than trusting the log excerpt alone (again a short, healthy-looking snippet) — this
is not one continuous run.** `ingestion_tracker` shows **four separate run cycles chained back-to-back**
since 2026-09-12, each roughly 10–16 hours, a new cycle starting the instant the previous one ends. The
core `cms_medicare_clinics` fetch is correctly a no-op every cycle (already-confirmed benign, near-annual
CMS cadence) — **not the problem**.

**The real, previously-unflagged defect, found by reading `run_log` payloads in full rather than just the
uploaded excerpt**: every recent cycle's summary reads `"Failed steps: hcris_cost_reports, hcris_propagation,
run_timeout"`. This is not new — the identical signature appears in `run_log` going back to **2026-06-25**,
predating this entire `PRI` arc. **Confirmed live**: `facility_cost_reports` (what `hcris_propagation`
presumably writes) hasn't been touched in **182 days**, `max(updated_at)` = 2026-03-16. Each cycle burns
most of its 10–16 hour runtime on this one step (`elapsed_seconds` 48,921s / 53,660s on the two most recent)
before timing out.

**Net read for Scott**: not a hang, genuinely fine to keep running — the currently-active cycle (started
06:03 UTC 9/14) is alive and writing real data elsewhere (`properties.estimated_annual_revenue` updating in
real time, matching "now"). But it will very likely follow the same pattern and time out on the same two
steps again, same as the last several cycles — worth fixing rather than continuing to silently eat most of
every run's wall-clock time. Filed as a new, separate backlog item — `HCRIS-TIMEOUT` — distinct from
`B6d-cms-restart`'s already-fixed 30-day-skip throttle bug and from `PRI6`'s self-reclaim bug; this is a
third, still-open failure mode in the same pipeline.

`PLANNED-BACKLOG.md`'s `PRI6` row closed to ✅; new `HCRIS-TIMEOUT` row filed at 🔴. Prompt drafted:
`docs/claude-code/prompts/HCRIS-TIMEOUT-cost-report-ingestion-times-out-every-run-facility-cost-reports-stale-182-days.md`.


## 2026-09-12 — HP1-P2f-urgent: `contact_writeback` moved off Today's Urgent lane, not hidden (Claude Code)

**Shipped.** Urgent's ranked union (`buildUrgentSection`, `api/_shared/today-sections.js`) no longer
admits `v_lcc_bd_worklist`'s `contact_writeback` rows — CRM plumbing (push an already-resolved contact
to Salesforce), measured at 96% of the lane's HP1-badge population against 66 real `action_items` of
deal correspondence. `owner_source_conflict` and `action_items` are untouched. `getTodaySections`
(`api/operations.js`) drops the signal from `urgentTrueCount`'s sum (now three producers, not four) and
threads the SAME exact `v_lcc_bd_worklist` count probe it already ran into a new `urgent.pointer` field
— `{source_type, count, label, surface}`, `null` (never `0`, P180) on a failed probe — mirroring
HP1-P2a's `inboxHygienePointer`. `app.js::_renderUrgentHygienePointer` renders it as a persistent row
below Urgent's items, linking to `renderBdWorklist('contact_writeback')` — the BD worklist's own
pre-existing "Push to CRM" chip (`ops.js:3785/3803`) and handler (`api/_handlers/contact-writeback.js`),
**neither of which was touched** — the destination was reachable before this change and is reachable
identically after it.

**Live population, re-measured via Supabase MCP at ship time** (`select count(*) from
v_lcc_bd_worklist where signal_type='contact_writeback'`): **1,603** — it moves (1,664 → 1,730 → 1,669
→ 1,603 across four reads inside one day; quoted at read time, never a stale prior figure).

**Gate:** (1) `test/uxt1a-today.test.mjs` proves `contact_writeback` rows never reach `items` or
`total_open` regardless of `rank_value`, that `pointer` carries a distinct true count, `null` when
unsupplied, and a genuine `0` (never conflated with "unknown"); (2) `test/hp1-badge-today-total-open.test.mjs`
proves the handler sums only the three remaining producers into `total_open` (excluding the stubbed
1,598 contact_writeback rows) and passes that same 1,598 through as `pointer.count`; (3) a failed
count-probe path (existing coverage) still renders `null`, never `0`; (4) Significant/Important and
their `total_open` are byte-identical — untouched code paths. Full suite: **6,167 pass / 0 fail / 6
skipped.**

⚠️ **Not yet observed end-to-end on the deployed app.** `main` is protected (branch → PR → CI green →
merge → Railway redeploy); this sandbox has Supabase MCP access (used for the population read above)
but no route to the live Railway app. The DB-side count and the pure-function/handler-test behaviour
are verified; the rendered Today page is confirmed only after the next redeploy.

**Docs:** `PLANNED-BACKLOG.md` (`HP1-P2f-urgent` → ✅), `CURRENT-STATE.md` (new HP1-P2f-urgent row + the
BD-ranking paragraph's stale "filed, not routed off yet" corrected).

## 2026-09-12 — FEED1 landed; reconciling it found the feed monitor itself was broken (Cowork)

**FEED1 verified live.** CC re-fetched every URL itself rather than trusting Cowork's table (its sandbox
has no egress), swapped the three dead feeds, deployed **v22 → v23**, and re-read the deployed body.
Confirmed independently: all three dead URLs are gone from `RSS_FEEDS`, and today's health rows show
`government` on 2 feeds (Federal Register GSA 14 + GovExec 15), `healthcare` 4, `net_lease` 4.
🚨 **Then the monitor turned out to be broken — caught before its cron had ever fired.** Every feed read
`zero_item_streak_days = 9999`, including ones that had just returned 15 items. Two bugs in one
expression: (1) it measured **calendar days**, but `lcc-briefing-intel-snapshot` runs `0 10 * * 1-5`
(weekdays) while the check runs `15 11 * * *` (daily) — so **Monday − Friday = 3** tripped the threshold
on healthy feeds; (2) a **9999 sentinel** stood in for "no history", so the FIRST run alerted on all 16.
Proven by simulation: a feed returning 15 items on EVERY check alerts on run 1 and every Monday. The
monitor blamed feeds for days nobody looked — an **I11 inversion**, now written up in the invariants.
**Fixed and applied live** (`20260912190000`, FEED2): the measure counts **checks, not days**
(`zero_item_streak_checks`). After the fix: 13 healthy feeds **0**, the 3 retired feeds **1**,
`lcc_check_market_brief_feed_health(3)` returns **0 opened / 0 resolved**. Both positive controls pass —
a truly dead feed (3 zero-item checks) alerts, a healthy feed spanning a weekend stays silent. Tomorrow's
11:15 UTC run would otherwise have opened **16 false alerts**.
⚠️ This entry was written twice: the first copy was lost when a parallel session's STATUS archive
rewrote the file while it sat uncommitted in the shared checkout. The rest of the FEED2 work (migration,
backlog rows, invariants note) was swept into that session's commit `ba9da224`.

## 2026-09-12 — HP1-badge + HP1-P2misparse reconciled: both verified live, CC's own corrections held, one new finding (Cowork)

PRs #2414 and #2415 merged. Three responses filed to `done/` (badge, P2misparse, FEED1). **Verified against the
live DB and the shipped code rather than read from the reports** — and this time the verification mostly *confirms*:

**HP1-badge — correct, and built the way the prompt hoped.** `total_open` now comes from `resolveTotalOpen(opts,
all)`: a present `trueTotalOpen` key wins **even carrying `null`** (= "the count probe failed"), and only an
entirely absent key falls back to `all.length` — which is only ever the module's own uncapped unit fixtures. The
counts are **separate, parallel, single-column `limit=1` `count=exact` probes** in the same `Promise.allSettled`
batch as the row fetches, never reattached to the row-fetch request — which is exactly the ~750 ms/request cost
HP1-P0 measured and removed. Both dead ends the prompt named were avoided, and **P180 is honoured**: a failed
probe renders *unknown*, never `0`, never the page length.

**HP1-P2misparse — shipped, and CC's live re-measurement beat the brief.** Measured here: misparse rows
**130 → 25** (CC) / **31 open now** (re-measured hours later — the feed keeps adding), **105 disposed**; the whole
Inbox **196 → 91**, header agreeing. ✅ **CC found things the prompt missed and filed rather than patched:** a real
false positive — **Brian Lane `<blane@northmarq.com>`, a Northmarq colleague**, blocked because the guard treats
"Lane" as street chrome (I confirmed: 5 rows, under **two** different reasons, and a **second** case, `Jim Street`);
class C's root cause is in the **Chrome extension's** `costar.js` person-boundary logic, not the ops-side guard;
and **BR1 does not exist yet**, so class B was left visible with a handoff filed instead of a second firm path
being built. Every one of those is now its own open row.

✅ **CC's own numbers, checked:** it reported 4 recovered fan-out contacts; **3 are on the graph** (Dail Longaker,
Jacob Fahner, William M. Collins) and **James D. Collins is not** — which is precisely what its own
`HP1-P2misparse-jcollins` row already says ("3 already exist, 1 has nowhere to land"). The report's headline was
looser than its filing; the filing was right.

🟠 **One finding that is mine and is NOT covered by `-fanout-legacy`** (that row is about the wrong *email* on a
real person): **12 junk-chrome entities are live on the graph**, minted before the guard existed — `Equity Funds`
**×3 as `entity_type='person'`**, `General Partner` (person + organization), `View Less`, `Demographics`,
`Vice Chair`, `Vice Chairman`, `Executive Vice Chairman`, `Public REIT`, `CoStar Property Contact`. The guard now
**blocks every one of those strings**, so the live blocks and the stored entities disagree about the same name.
Filed as **HP1-P2misparse-junkents**, pairing with `-fanout-legacy` as one reversible identity-cleanup unit —
⚠️ a write to curated identity, so relationships get checked first and the guard's own vocabulary gets reused
rather than a second hand-written list.

✅ **And the gate `HP1-P2f-urgent` was waiting on is now answered with evidence:** unlike `contact_misparse_review`
(zero readers), **`contact_writeback` has a working home** — `api/_handlers/contact-writeback.js`, rendered at
`ops.js:3785` as **"Push to CRM"** with its own chip filter at `ops.js:3803`. Routing it off Today **moves** it
rather than hiding it. Prompt written: `prompts/HP1-P2f-urgent-route-crm-plumbing-off-today.md` — the last
structural piece of HP1, with P2a's pointer gate carried forward and, deliberately, **no target count**.

**Where Today stands:** Significant 516 · Important 46 · Urgent ~1,664 of which **1,598 is CRM plumbing** — so
P2f-urgent is what turns Urgent into the ~66 rows of real deal correspondence.

## FEED1 — three more dead RSS feeds (outside dialysis) replaced + deployed (2026-09-12)

MB2a's `market_brief_feed_health` monitor found three more dead feeds nobody was checking:
`government` (GSA News, 404), `healthcare` (Health Affairs, 410 Gone — retired), `net_lease`
(GlobeSt, 403). Sandbox had zero egress (same policy denial as MB2a); re-verified all six
URLs via `net.http_get` from LCC Opps instead of trusting Cowork's prior fetch — all 200,
counts matched. `RSS_FEEDS` updated, deployed to LCC Opps (`v22 → v23`), deployed body
re-read to confirm, then triggered a live `dry_run=1` and read `market_brief_feed_health`
for today: all six new feeds wrote `ok=true` with real item counts. No `market_brief_feed_stale`
alert had opened for the three dead ones, so nothing to resolve. See `PLANNED-BACKLOG.md` FEED1.

## 2026-09-12 — HP1-P2misparse: the Inbox's 130 misparse rows were success notifications (Inbox 196 → 91)

**Shipped.** `contact_misparse_review` `status='new'` **130 → 25**; the whole Inbox **196 → 91**;
`mv_work_counts.inbox_new` **91** (list and header still agree — HP1-P2a's invariant, held);
`entities` **69,764 → 69,764**, so **not one guard decision moved**. Migrations `20261102120000`
(disposition, reversible via `lcc_hp1p2misparse_disposition_log` batch `hp1p2misparse_20260912`) and
`20261102130000` (`v_lcc_contact_guard_blocks`), both applied live. JS:
`api/_shared/misparse-disposition.js` + `api/_handlers/sidebar-pipeline.js`. Guard
`test/hp1-p2misparse-guard-disposition.test.mjs` (17 tests). Full suite **6,161 pass / 0 fail**.

⚠️ **I had filed this row as "117 rows with no resolution surface — give the lane a review surface."
That was the wrong question and the prompt superseded it.** These were never work awaiting a
decision — they are the contact guard announcing, one Inbox row at a time, that it successfully
blocked something. **B6a over-applied:** a skipped step must emit, but to a counter, not to the
broker's homepage. Re-measured before building: **130 rows, not 117** (still growing), carrying
**307 rejections across only 42 distinct (name, reason) pairs / ~26 properties** — `Equity Funds`
blocked 31×, `View Less` 29×, `Marcus & Millichap` 26×.

Two **notification-only** rules, neither touching mint-vs-block: class-A CoStar page furniture is
counted not notified (**EXACT match, never substring** — P158a: `Demographics Research Group LLC`
must survive); and one notification per **(property, name, reason)**, which alone removed 90 of the
105. Split: `all_chrome` 15 · `chrome_and_duplicate` 39 · `all_duplicate` 51.

**Class D recovered 4 real people with 0 false positives on the live batches** — James D. Collins ←
`jcollins@southpace.com`, William M. Collins ← `william.collins@cushwake.com`, Dail Longaker, Jacob
Fahner. `Paul J. Collins` and `Drew A. Flood` sit on the *same* mailbox and were correctly refused.
⚠️ **3 of the 4 already exist in `entities`**, so the historical recovery is nearly a no-op; only
James D. Collins is absent, and he was **not** hand-minted in SQL (minting is `ensureEntityLink`'s
job — `HP1-P2misparse-jcollins`).

⚠️ **`v_lcc_contact_guard_blocks` reads 0 runs today.** That is the Railway deploy gap — *merged is
not running* — not a quiet guard. **P180: 0 runs means NOT MEASURED.** Re-read it after the deploy
and the next sidebar capture.

**Four things the measurement contradicted, all filed:** the prompt's *"every block measured here is
correct"* is **false** — `Brian Lane` (**`blane@northmarq.com`, our own colleague**) and `Jim Street`
are real people caught by the street-suffix arm (`HP1-P2misparse-fp`, with the free corroboration:
the mailbox's local part names them); the class-C cause is an **extension** vocabulary gap
(`isTitleLine` knows no `chair`/`chairman`/`mgr`), not an ops-guard gap, and is contained — reported,
not fixed, because widening it changes person boundaries (`HP1-P2misparse-titleparse`); **BR1 does
not exist yet**, so class B's ~60 firm rows stay deduped-and-visible rather than getting a second
firm path (`BR1-misparse-handoff`); and the pre-guard fan-out damage is **live in `entities`** —
`Drew A. Flood` and `Paul J. Collins` both carry William Collins's mailbox
(`HP1-P2misparse-fanout-legacy`).
## 2026-09-12 — BACKLOG-ids reconciled: 0 duplicates, guard positive-controlled, and the race behind it now a doctrine (Cowork)

PR #2410 merged. Response and prompt filed to `done/`. **Verified independently rather than read from the report:**
a fresh scan of `PLANNED-BACKLOG.md` finds **0 duplicate IDs across 551 rows**, and I re-ran the new guard's
positive control myself — seeding a duplicate `HP1-badge` row makes `test/backlog-id-uniqueness.test.mjs` fail
(*"PLANNED-BACKLOG.md row IDs are unique"*), restoring the file makes it pass 6/6. It is a real detector, not a
green run.

**CC's pass was better than the prompt that asked for it, and said so.** It re-measured from scratch instead of
inheriting my 26 and found **27** — my parser had missed `COPILOT-OPEN` (its ID carries a trailing
`(was COPILOT-CHAT-OPEN)` annotation) and `ID3e`. **13 collisions renamed** (`SEC1-4`→`SEC9-12`,
`A5d/A5e`→`A5i/A5j`, `D1/D3/D4/D5`→`D1-monitor`/`D3-digest`/`D4-recall`/`D5-dealname`, `R1/R2/R3`→`R1b/R2b/R3b`),
keeping each ID where the citations already pointed — checked, and none needed updating, including
`OPERATOR-ACTIONS.md`'s `SEC2`. **14 restatements collapsed**, ten of which I had not enumerated. ✅ **And it did
the thing the prompt cared most about:** the two `ID3a-d` copies **disagree** on whether `ID3a-d-dia` is closed —
both readings kept with the conflict stated, not silently resolved.

🚨 **The real finding is the race CC hit while fixing it, and it is now a CLAUDE.md doctrine.** Its correct fix
was reintroduced as duplication by a *concurrent* PR adding `MB2a`/`MB3`/`MB4` rows: **git's 3-way merge sees two
pure insertions at different offsets, finds no textual conflict, and keeps both.** Nobody is warned. That is the
same mechanism that broke `STATUS.md`'s line budget twice today (passed locally at 2,465, failed CI at 2,503 after
a merge from `main`). Filed under *"TWO BRANCHES THAT BOTH ADD TO A SHARED DOC MERGE CLEANLY AND SILENTLY
DUPLICATE IT"* with four rules: a shared append-mostly doc needs a **guard, not a convention** (prose failed five
times in one day on a single rule); **a green local run proves nothing about the merge** — re-run the doc guards
after merging `main`, and archive before pushing; **never resolve a doc duplicate by deleting** — classify
collision vs restatement first, and report disagreements; **edit the row, don't restate it** — every one of the 14
restatement groups began as a session appending instead of amending.

Four live doc guards now: `backlog-id-uniqueness`, `backlog-table-shape`, `status-header-integrity`,
`status-line-budget`.

⚠️ **Fixed a stale note of my own**: `HP1-P1a-sec` still warned *"there are TWO rows numbered SEC2"*. There
aren't, as of this PR — rewritten to say the §P9 one is now `SEC10`. A caution that has been resolved is
misdirection with a longer half-life than the defect it described.

## 2026-09-12 — BACKLOG-ids: the 27 duplicate row IDs, measured and repaired (Claude Code)

Executed `docs/claude-code/prompts/BACKLOG-ids-collisions-and-restatements.md`. Re-measured from
scratch rather than trusting the prompt's counts: **27 duplicate IDs**, not 26 — the prompt's own
scan missed `COPILOT-OPEN` (a trailing `(was COPILOT-CHAT-OPEN)` annotation broke a naive regex)
and `ID3e` (paired deliberately with `ID3e (original measurement)`).

**Class A collisions renamed (13), citations checked, none needed updating** (every real external
citation for SEC1-4/A5d/A5e/D1/D3/D4/D5/R1-R3 pointed at the KEPT row; verified via targeted grep
per ID, not assumed):
- `SEC1`/`SEC2`/`SEC3`/`SEC4` — §P0s (security-definer audit / wave0-config-values.txt exposure)
  kept all four; §P9's versions renamed **SEC9/SEC10/SEC11/SEC12**. `docs/os/OPERATOR-ACTIONS.md`'s
  SEC2 citation already pointed at §P0s — no fix needed there. §P0s `SEC2`'s ⏸️ deferral content
  (Scott 2026-09-12) carried across byte-identical, untouched.
- `A5d`/`A5e` — the A5-family block (~line 444, cited by `CURRENT-STATE.md`, the A5 audit doc,
  C1/C2a/C2e) kept both; the isolated pair near N15/N20 (~line 74) renamed **A5i/A5j**.
- `D1`/`D3`/`D4`/`D5` — the P0d data-coherence I-series (cited by `CLAUDE.md` "Campaign P0d / D1–D5")
  kept all four; the P5 "Deal-intelligence spine" series renamed **D1-monitor/D3-digest/
  D4-recall/D5-dealname**.
- `R1`/`R2`/`R3` — the P6 cross-cutting series (cited by `BUILD-BACKLOG.md`, `cross-cutting-design.md`)
  kept all three; the DOC-TABLE1 R1-R14 series (only 1 external cite, a STATUS.md history span)
  renamed **R1b/R2b/R3b**, leaving R4-R14 untouched.

**Class B restatements merged (14), no content dropped** — `AC2`, `AC3`, `B6d-cms-escalation`,
`B6d-cms-restart` (3 copies → 1, chronology from 2026-08-29 through 09-12 folded together),
`B6d-cms-step` (2, includes the "premise refuted" correction), `B6e-fred`, `B6e-fred-cm-exposure`,
`B6e-fred-verify`, `COPILOT-OPEN`, `ID3a-d` (2 — **genuine disagreement found and reported, not
silently picked**: one copy says Scott closed `ID3a-d-dia` by deciding LCC owns Dialysis_DB, the
other still files `ID3a-d-dia` as open pending confirmation — both readings kept, flagged
explicitly in the merged row), `MB3` (4 → 1), `MB4` (4 → 1), `PR1d` (2). In every case the LATEST
occurrence was already a superset of the earlier ones (verified by diff, not assumed), except
`B6d-cms-escalation`/`B6d-cms-step`/`ID3a-d`/`PR1d`/`AC2`/`AC3`/`B6e-fred-verify` where a distinct
earlier fact was folded in explicitly.

**`ID3e` / `ID3e (original measurement)`** — not a true duplicate (the file already disambiguated
these as a shipped-result + preserved-original pairing); renamed the latter's row ID to
**`ID3e-orig`** for mechanical uniqueness only, content untouched.

Row count `docs/os/PLANNED-BACKLOG.md` **1172 → 1154 lines** (18 rows collapsed away; every
collapsed row's distinct facts survive inside its merged sibling — verified by re-reading each
merged row against all its source rows).

**Guard shipped:** `test/backlog-id-uniqueness.test.mjs`, modeled on
`test/status-header-integrity.test.mjs`. Parses only cells at split-position 1 of a `|`-leading
line (never a prose mention elsewhere in a row's body) as a row-defining ID; positive-controlled
both ways (a seeded prose cross-reference does NOT count as a duplicate; a seeded real duplicate
DOES fail, with a message naming the repair procedure). Live-tested against the real file: seeded
a duplicate `SEC9` row, confirmed the test fails with a useful message, reverted, confirmed green.
`DUPLICATE_ALLOWLIST` is empty (every 2026-09-12 duplicate was resolved in this change, not
deferred) but wired with the same by-ID / reason / re-measure-date / stale-entry-fails convention
as `test/retired-identifiers-guard.test.mjs`.

Full suite: **6,140 pass / 0 fail / 6 skipped** (unchanged from before this change — pure
documentation + one new test file).

Closed `BACKLOG-ids` in `docs/os/PLANNED-BACKLOG.md` §P0d (added as a done row, since the item
existed only as the standalone prompt file, not a backlog row).
