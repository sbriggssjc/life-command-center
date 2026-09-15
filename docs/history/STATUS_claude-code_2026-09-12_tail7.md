# STATUS archive — Claude Code queue, 2026-09-12 (fifteenth span)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-16 to keep that file under its
3,000-line budget. Nothing was reworded or dropped; every still-open item named here is tracked in
`docs/os/PLANNED-BACKLOG.md`, which is the canonical open-work list.

---

## 2026-09-12 — Repo sweep done by the filed method; a duplicate SEC row folded; HP1-P1b's hold lifted (Cowork)

Scott asked again for the repo to be cleaned and consolidated by topic so a future chat picks up without
misdirection. Did the **REPO1-root-clutter** sweep using the method filed earlier today — grep every candidate
first, move only the unreferenced, document the rest — rather than a bulk move.

**Moved (12, all verified unreferenced outside `STATUS.md`/`docs/history`)** → `_superseded/scratch-2026-09-12/`,
with a manifest row in the graveyard README: `err.txt` (0 bytes), `draft1/draft2/draftsave.json`, `harvest.json`,
`twin.json`, `seed-apply/seed-dryrun.json`, `acq-dryrun.json`, `fix-allother-pagination.patch`, `_commit.bat`,
`_deploy_hardening.bat`.

**Deliberately NOT moved — and this is the point of the sweep, not a shortfall.** Three groups are referenced by
name from live docs, code comments or a guard test, so moving them converts accurate references into stale ones,
which is worse than an untidy root. Recorded under `_superseded/README.md`'s own *"left in place — documented
instead"* convention:

- **The 15 `flow-*.json`** — cited in `CLAUDE.md`, `.env.example`, `api/_shared/outlook-draft.js`,
  `api/draft-assist.js` and ~10 docs. **Consolidated by TOPIC in documentation instead: new
  `docs/flows/README.md`** names every flow, what it does, and the write-up to read — find the flow there, open
  the JSON at the root.
- **The ~10 loose `.docx`/`.xlsx`** — cited from `audit/ROUND_2_FINDINGS_2026-05-19.md` and several
  `audit/patches/*/COMMIT_MSG.txt`. Historical; nothing live reads them, and none should be cited as current state.
- 🔐 **`wave0-config-values.txt`** — `test/retired-identifiers-guard.test.mjs` allowlists it **BY PATH**, so a move
  breaks that guard. `ACTIVATE_unit4.sql` likewise (cited in `document-capture-ocr-and-deeds.md`).

⛔ **The sweep caught me duplicating an existing row — exactly the misdirection it was meant to find.** I filed
`HP1-P1a-sec` this morning as a new escalation on discovering the committed `LCC_API_KEY`. **`SEC2` had already
recorded precisely that on 2026-08-28**, with a better remediation order than mine (rotate → update Railway →
`git rm --cached` → *only then* consider history) and a warning I did not have: **do not reach for
`filter-branch`** — this repo nearly lost a 475 MB mailbox that way. My row is now a pointer at SEC2, and the one
fact worth keeping moved onto SEC2: the committed value is **byte-identical to the live Bearer token in the
Salesforce flow**, so it is the live key, and a rotation must update every `flow-*.json` header carrying it in the
same change — a flow left on the old key fails silently under an HTTP 200, which is exactly how HP1-P1a hid a
six-week outage. `OPERATOR-ACTIONS.md` already carries SEC2 as ⏸️ DEFERRED, consistent with Scott's decision today.

✅ **HP1-P1b's hold is lifted — a held row whose condition has cleared is stale documentation.** It said *"build
after the feed is restored and P1d is watching it."* Both happened today. Two stale figures inside it corrected
while there: the feared mass auto-retire **did not happen** (six weeks of drift was 10 stage changes, not the
569+37 the row was written on — re-measure live), and **there is no `deal_next_step` table** —
`lcc_generate_deal_next_steps()` writes into `action_items`. Also cross-linked to **HP1-P1a-orphan**: decide the
`sf_absent` rule first, or P1b will ask Scott to confirm deals Salesforce no longer has.
## 2026-09-12 — REPO1 sweep failed CI on the line budget; archived a fourth span (Cowork)

The REPO1 root sweep could not merge: `test/status-line-budget.test.mjs` went red at **2,503 lines**, 3 over.
**My fault, and worth naming precisely** — the branch passed locally at 2,465, then merging `main` brought in
another 74 lines of STATUS entries and pushed it over. **This file grows on the branch and on `main`
simultaneously, so passing locally proves nothing about what happens at merge.** It is the second time today
(PR #2383 hit the identical thing) and my own entries, which have been long, ate the headroom.

Fixed by the documented procedure, not by raising the budget: the **OWN-T0j URL-length → MB-a reconcile** span of
2026-09-11 (5 entries, 175 lines) moved **verbatim** to
`docs/history/STATUS_claude-code_2026-09-11_ownt0j_urllen_to_mba.md` with an archive pointer left in place.
Nothing reworded or dropped; every still-open item in it is already tracked in `PLANNED-BACKLOG.md`. **2,465 →
2,298 locally**, so ~165 lines of headroom survive the merge.

Added the trap to the file's own convention block so the next session does not rediscover it: **archive before you
push, leave 200+ lines of headroom, and keep entries tight** — findings belong in `PLANNED-BACKLOG.md`, which is
canonical; `STATUS.md` is the narrative, not a second copy of it.

⚠️ **Also, a cleanup note that is mine to own:** three stray `asc-manifest.*.tmp.json` files are sitting in
`test/fixtures/healthcare-discovery/`. The healthcare lane tests write them and unlink them — but this bridge
cannot unlink on Scott's machine (the same EPERM that keeps hitting `.git/index.lock`), so a test run from here
leaves them behind. They are untracked and **must not be committed**; `git add -A` would sweep them in. The
commit commands for this change name explicit paths instead.

## 2026-09-12 — `PRI6` response reviewed: three real defects found (not the two-explanation guess from the prompt), the self-reclaim bug explains months of failed daily runs — cross-referenced with a parallel session's own live re-check

`PRI6`'s response (`"PRI6 surface response.docx"`, saved by Scott) read in full and transcribed to
`docs/claude-code/responses/done/PRI6-ingestion-lock-survives-redeploy-and-reclaim-safety-window.response.md`.
**Repo: `Dialysis`.** Stronger than either Section-0 guess in the prompt — neither "different Railway
service" nor "silently reused stale lock" was quite right; the actual mechanism is a self-reclaim bug.

**(a) No real time cap exists — confirmed, not assumed.** `CMS_ORPHAN_RECLAIM_HOURS` (2h) and
`DEFAULT_STALE_HOURS` (6h) both rested on the same "~90 minutes" observation `PRI5` used, but that budget
is env-tunable for catch-up runs and only blocks *launching* the next step, never preempts one in flight —
exactly what this session's own live check proved by finding a genuinely in-flight run at 17.9+ hours.
Fixed with a new `probe_recent_activity()`: corroborates any reclaim (age-based or `force=True`) against a
real recent write to the dataset's own table before touching the row — age alone is no longer sufficient.

**(b) The actual `acquire_ingestion_lock` behavior, and the real root cause — not a guess.** With `force`
resolving true, it unconditionally marks the existing row `failed` and opens a new one — no age check, no
self-exclusion. The mechanism making `force` true on every call: `ingest_medicare_clinics()` calls
`acquire_ingestion_lock(force=force or force_refresh)`, and the **daily production entry point hard-codes
`force_refresh=True` on every single call** — so every day's run force-reclaims its own just-opened row.
Caught live: three `"Reclaimed by ingestion_lock (force)"` events, including one row reclaiming itself
**0.0 hours** after creation.

**(c) Both root causes fixed, and the two Section-0 hypotheses were both wrong.** This was one continuous
process the whole time (started 2026-09-11 19:45:43 UTC, ~18h runtime) — its own startup self-reclaimed its
own row via the `force_refresh` bug, then kept running unaffected by it. Separately,
`facility_patient_counts`'s lock never closes on success because `release_ingestion_lock(status="success")`
sat in an unreachable `else:` clause after a `return` inside a `try` — confirmed live as a completed no-op
(0 new rows in 18h), not a stall.

**This directly explains a much bigger, previously-unconnected problem.** A parallel documentation session
today (`docs(doc-contra)` commit `2346713e`, merged as PR #2394) independently re-verified `cms_ingestion`
live and found it **failing 34 of 36 runs in the last 30 days**, `last_success_at` frozen at **2026-04-04**
— five months — with `medicare_clinics.source_last_seen` stuck at 2026-08-31 (2.9% refreshed) for 12 days,
and every recent failed row reading `"Reclaimed by ingestion_lock (force) after 0.0h in 'started'"`. That is
this exact bug, hitting the daily production schedule for months, not just this one long run. `PRI6`'s fix
is a materially bigger deal than the prompt framed it as — cross-referenced in `B6d-cms-restart`.

**Live-rechecked this session, unchanged as expected**: the two lock rows this arc has been tracking
(`8c9978b3…` `cms_medicare_clinics`, `3093e28a…` `facility_patient_counts`) are still open at ~19 hours old
— correct and expected, since the fix hasn't reached this already-running process (no redeploy has
happened yet) and nothing in this arc's discipline touches live rows without Scott's own trigger.
`properties.estimated_annual_revenue` still shows real recent writes (992 rows in the trailing 15 minutes at
last check) — the run itself remains healthy, unaffected by any of this.

Tests: 12 new (`test_pri6_lock_reclaim_safety.py`), 8/12 independently confirmed red against pre-fix code
(mutation-style, the other 4 are correctly-green positive controls) — a step further than most rounds in
this arc, which usually report post-fix green only. Full suite: **3,131 passed, 0 failed**.

**PR `sbriggssjc/Dialysis#7409` opened this round** — Scott's "This PR is merged" this round most likely
refers to the `life-command-center` documentation PR that filed this review (same recurring ambiguity as
every prior round in this arc) — **the `Dialysis`-side PR #7409's merge status needs Scott's separate
confirmation before this is treated as deployed.** `PLANNED-BACKLOG.md`'s `PRI6` row updated to 🟡 pending
that. Prompt moved to `docs/claude-code/prompts/done/`. Response `.docx` pending archive to `responses/done/`
on Scott's machine.

## 2026-09-12 — HP1-P2misparse: the 117 Inbox rows are the guard saying "I blocked it", not work (Cowork)

Drafted the next prompt — and the measurement changed what it is. **I filed this row yesterday-ish as *"117 rows
with no resolution surface — build one, or decide they're machine-fixable."* That was the wrong question**, and the
prompt says so in §0 rather than quietly building the better thing.

**What they actually are.** The contact guard blocks a suspect contact and then files an Inbox row announcing the
block. A correct block needs no broker judgment — so this is **B6a over-applied**: a skipped step must emit, but to
a counter, not to Scott's homepage. **117 rows carry 294 rejected contacts across only 42 distinct names and ~26
properties**: `View Less` blocked **23 times**, `Equity Funds` **31**, re-notified on every capture.

**Four classes, four different right answers — they are not one problem:**

| class | examples | n | disposition |
|---|---|---|---|
| **A** CoStar UI chrome | `View Less`, `Demographics`, `Public REIT`, `CoStar Property Contact` | ~100 | block and **say nothing** |
| **B** firms parsed as persons | `Marcus & Millichap`, `Colliers`, `Cushman & Wakefield`, `NAI Columbia` | ~60, most **with real emails** | blocking as a *person* is right, **discarding is not** → **BR1** firm registry |
| **C** job titles in the name slot | `Executive Vice Chairman`, `Vice Chair`, `General Mgr \| CEO` | ~25, with emails | a **parser bug** — report it, don't queue it |
| **D** `email_fanout` | `James D. Collins`, `Edward C. Mann`, `Conrad Buhler` | **86 / 15 names / 4 properties** | see below |

🔑 **The one piece of real value hiding in there.** `email_fanout` fires when the scraper staples **one** broker's
email onto **every** name on the page — `jcollins@southpace.com` landed on 5 names (including the firm itself and a
department); `william.collins@cushwake.com` on 3. Blocking the batch is **correct**, 4 of 5 are misattributions.
But the name matching the email's **local part** is the true owner: **jcollins@ ↔ James D. Collins**,
**william.collins@ ↔ William M. Collins**, **jfahner@ ↔ Jacob Fahner**. That contact is real, correctly paired, and
currently discarded with the collateral. The prompt recovers it mechanically under a strict matching rule, mints
nothing on a tie, and leaves every other name in the batch blocked. Expect **~4–8 people** — small, but they are
brokers on properties we track, and we were throwing them away.

**Deliberately no target count in the prompt.** HP1-P2a taught that lesson today: my §5 set a target of 65 that
contradicted my own §3, and CC was right to report 182 instead of forcing my number. This prompt asks for the
after-count and forbids tuning the rules to hit one.

**What it does not do:** it does not weaken the guard — every block measured here is **correct**; it changes what
gets *announced*. It builds no review surface (§0), mints nothing in A/B/C, and leaves `email_alert` (**P2b**) and
the ranking work (**P2c/P2e**) alone.

Prompt: `prompts/HP1-P2misparse-the-guard-notifies-instead-of-disposing.md`.

## 2026-09-12 — HP1-P2a reconciled: shipped and verified live; my own target number was wrong; one gap promoted out of a closed row (Cowork)

PR #2389 merged. Response and prompt filed to `done/`. **Verified independently against the live DB rather than
read from the report** — every claim holds:

| check | reading |
|---|---|
| `inbox_items` at `status='new'` | **1,061** |
| `v_inbox_triage` at `status='new'` (what the Inbox shows) | **182** |
| `new_contact_qualify` excluded | **879**, and **0 leak** into the view |
| `contact_misparse_review` still visible | **117** |
| destination `v_lcc_contact_qualify_worklist` | **868** live rows |
| `mv_work_counts.inbox_new` (the header) | **182** — agrees with the list |

✅ **The honesty gate held, and in the right shape.** `inboxHygienePointer()` reads the excluded population
**straight off `inbox_items` with `countMode:'exact'` and `limit=1`** — never the view, never a page — and returns
`null` on failure rather than a wrong number. Exactly the P159a-safe construction, inside the change meant to make
the surface honest.

⛔ **My own prompt contradicted itself, and CC was right to ignore the wrong half.** §5 set *"Target: the homepage
Inbox shows 65 items"* while §3 of the same prompt instructed leaving `contact_misparse_review` in place if it had
no resolution surface. It has none. The target was unreachable by construction and **182 is correct**. CC reported
it and stopped rather than bending the filter — precisely what the next sentence of §5 asked for. Corrected in the
prompt file in place before filing it: a prompt that argues with itself teaches the wrong lesson to whoever reads
it next.

🔴 **One real filing defect, found and fixed: a gap was recorded inside a row that then closed.** CC correctly
established that `contact_misparse_review` has **zero readers anywhere in the repo** — written at
`sidebar-pipeline.js:2114`, never read — and correctly left it on the Inbox rather than routing it into
invisibility (P131). But it wrote that finding **into the HP1-P2a row**, which is now ✅ SHIPPED. **A gap filed
inside a closed row is a gap that disappears.** Promoted to its own open row, **HP1-P2misparse** — and it matters:
those 117 rows are **64% of the remaining Inbox (117 of 182)**, the single biggest thing still between Scott and
*"a view of the work that needs the broker's attention."* 117 rows written since 2026-08-10 and never once read is
itself evidence about whether they want a review surface or an automated repair.

⚠️ **Minor, filed as HP1-P2a-count:** three numbers a broker meets in two clicks — pointer **881**
(`status IN (new,triaged)`), exclusion **879** (`new` only), destination **868** (11 junk rows dropped by design).
Each defensible alone; clicking a pointer promising 881 and landing on 868 is an unexplained 13-row gap — the same
*rendered ≠ population* confusion one layer out. Not urgent, not a defect in the exclusion.

🛡️ **The H1 burial is now a CI guard, not a convention.** This file's header was buried a **fifth** time today —
including once *after* the prose convention note was added telling sessions not to. A convention nobody is forced
to read is not a convention. `test/status-header-integrity.test.mjs` now fails the build if the H1 leaves line 1,
if a duplicate appears, or if the convention block goes missing, with the repair procedure in the assertion text.

**Net for Scott:** the Inbox went **1,061 → 182**, the header agrees with the list, and nothing was hidden. The
remaining 182 is 117 misparses (P2misparse) + 20 personal alerts (P2b) + 45 genuine broker items — so **P2b and
P2misparse together are what turn 182 into ~45**, and the ranking work (P2c/P2e) still belongs after them.

## 2026-09-12 — MB-b: first user-facing P18 surface built (Lane Briefs email block + homepage tab); flag OFF, not deployed

Built `docs/claude-code/prompts/MBb-lane-briefs-daily-block-and-tab.md` end to end. §0 producer cleanups:
operator identity (§0.1) was already closed by ID2b-caps-2 before this build started (nothing to do, verified
with a new guard `test/market-brief-operator-canonicalization.test.mjs`); the trades fact's date-suffixed
`fact_key` (§0.2, re-minting a fresh zero-fact every day) is fixed — `TRADES_FACT_KEY = 'trades_trailing_7d'`
is now a single stable key, the tick reads a fixed trailing 7-day window, and it retires any old-format live
fact it finds; a `dialysis` RSS stream (§0.3, Renal & Urology News / Nephrology News & Issues / CMS Newsroom)
was added to `briefing-intel-snapshot`'s `RSS_FEEDS`, **not egress-verified from this sandbox** (no outbound
reach). Built: the daily email's "Lane Briefs" block (`renderMarketBriefLanes`, above Sector Watch, which
stays below it), the homepage `#/briefs/<lane>` tab (`GET /api/market-brief-tab`, new page + route), and
shared selection/diff logic (`api/_shared/market-brief-render.js`) so both read the same live facts. Both
ship behind a new flag `MARKET_BRIEF_RENDER` (registered off). Every number in the rendered block traces to
a fact object, asserted by a dedicated tripwire test. New guards: `test/market-brief-render.test.mjs` (14),
`test/market-brief-lane-briefs-email.test.mjs` (11, incl. diff/gap/omitted-empty-lane), `test/market-brief-
operator-canonicalization.test.mjs` (3), plus additions to the existing MB-a suites. **Full repo suite green:
6,114 pass / 0 fail / 6 skipped** across 962 suites (this session had to `npm ci` first — 0 dependencies were
installed at session start, which produced 28 misleading `ERR_MODULE_NOT_FOUND` failures on the first run;
none were real regressions, confirmed by re-running after install).

**Nothing here is deployed or live-verified** — no Railway/Supabase write access this session. Two new
migrations are committed, unapplied: `20260912120000_lcc_mbb_rss_dialysis_stream_cron.sql` and
`20260912121500_lcc_mbb_market_brief_render_flag.sql`. `MARKET_BRIEF_RENDER` stays off. Operator sequence
(spec §5): apply both migrations, redeploy Railway (both services), run the P-SQL tick once via POST with
the flag forced on and confirm the trades supersede chain clears the old date-suffixed fragments, preview
the email block and load `#/briefs/dialysis`, verify each new RSS feed URL parses, THEN flip
`MARKET_BRIEF_RENDER`. Full detail: `docs/architecture/EXEC-BRIEFS-SPEC.md` §9 "MB-b" addendum;
`docs/os/CURRENT-STATE.md` §2 "MB-b" subsection; `docs/os/PLANNED-BACKLOG.md` §P18 MB1e/MB3/MB4.


## 2026-09-12 — HP1-P2a prompt: 94% of the homepage Inbox is data hygiene, and the destination already exists (Cowork)

With the 500 fixed (P0), the deal backbone fixed and watched (P1a-fix, P1d), this is Scott's **third and last
untouched symptom** — *"data and emails and notices that should be automated and not the top of our inbox's
homepage."*

**Re-measured live before drafting.** `inbox_items WHERE status='new'` = **1,052**:

| source_type | n | broker judgment? |
|---|---|---|
| `new_contact_qualify` | **876** | no |
| `contact_misparse_review` | **111** | no |
| `email_om` / `sidebar_om` / `folder_feed_om` | 33 | **yes** |
| `email_alert` (`domain='personal'`) | 20 | no (P2b) |
| `flagged_email` | 12 | **yes** |

**987 of 1,052 — 93.8% — is hygiene. 65 rows are actual broker work.**

✅ **This is a routing change, not a build, and the prompt says so in the first line.**
`v_lcc_contact_qualify_worklist` already exists as a junk-filtered, value-ranked worklist over exactly these rows
(**865 live**, i.e. 876 minus the 11 it already drops), with `bridgeQualifyContact` per-item and
`bridgeQualifyContactsBulk` for the high-confidence subset. ⚠️ And it is **not a classifier problem**: 13,496 rows
already sit in a non-`new` status — the machine disposes at scale. These 987 are correctly classified and rendered
on the wrong surface.

🚨 **The gate is that excluding ≠ hiding.** The homepage must render a persistent pointer row — *"Data hygiene —
987 items (876 contacts to qualify · 111 misparses) →"* — carrying the **true population**, not a capped page
length. Filtering 987 rows out of view without emitting anything is the B6a skipped-step failure, and a capped
count there would repeat **HP1-badge** inside the very change meant to make the surface honest. The prompt says:
if you cannot render the pointer, do not ship the exclusion.

⚠️ **One real risk flagged, not waved through:** `new_contact_qualify` has a proven surface;
**`contact_misparse_review` (111 rows) may not.** It is written at `sidebar-pipeline.js:2114` — if nothing reads
and resolves it, routing it off the homepage deletes the only place it is visible. The prompt requires verifying
that first, routing only `new_contact_qualify` if not, and filing the gap (P131) rather than building a new
misparse surface in the same turn.

⚠️ **Found in passing, filed not absorbed:** `inbox_items.domain` carries **four spellings for two domains** —
`government` 505 / `gov` 8, `dialysis` 314 / `dia` 1, plus 48+ NULL. A domain-keyed rule strands 57 rows, so the
prompt keys on `source_type` (clean) and files the drift as **HP1-P2-domain**.

**Sequencing recorded on P2c and P2e:** both rank the Inbox, and ranking a list that is 94% noise ranks noise.
They come after this, not beside it.

Prompt: `prompts/HP1-P2a-route-data-hygiene-off-the-homepage-inbox.md`.

## 2026-09-12 — HP1-P1d reconciled: monitor verified independently, my own row arithmetic corrected, two SF ghosts found (Cowork)

PR #2383 merged. Response and prompt filed to `done/`. **CC's work holds up under independent measurement** — re-ran
the gate from this side rather than reading the report:

- `lcc_check_sf_opportunity_freshness(p_stale_hours DEFAULT 3)` **exists live**; cron
  `lcc-sf-opportunity-freshness-check` is **active, hourly at :20**, 1 run, succeeded.
- **Live now → green:** `{stale:false, age_hours:0.2, sf_linked_rows:612, max_last_synced_at:13:30:44Z}`.
- ✅ **The B6a trap test passes — the one that mattered.** In a rolled-back transaction, back-dating every SF-linked
  `last_synced_at` by 30 days **and** writing `now()` to the non-SF rows still returns
  `{stale:true, age_hours:720.2, alerts_opened:1}`. The assertion is genuinely producer-scoped, not table-keyed in
  disguise. CC chose `producer_runs` over a `feed_freshness_registry` row for exactly that reason, and made
  `ingestBatch` write its run row on a **3-arg** `opsQuery` call so the P1a-fix Prefer-mangling class cannot recur.
- CC's disclosed limitation — the historical replay fires on **13 of 16** checkpoints, the 3 misses being windows
  where fresh INSERTs briefly kept a MAX-based predicate clean while UPDATEs were 100% broken — is real and **is
  already written into `PLANNED-BACKLOG.md` and `STATUS.md`**, not left in the response. Checked, because a disclosed
  limitation that lives only in a chat transcript is an undisclosed one.

⚠️ **My own arithmetic was wrong and is corrected in place.** I wrote *"619 rows against the feed's 608 — 11 rows a
second producer mints"* into the prompt, the backlog and CURRENT-STATE. The real split is **612 SF-linked / 7
non-SF**. The 7 are the second producer (all `last_synced_at IS NULL`, `metadata->>'source'='priority_queue'`) — CC
measured this correctly and I did not. P1d's conclusion is unchanged; the number behind it was mine and it was sloppy.

🚨 **The 612-vs-608 gap turned out to be a real finding — filed as HP1-P1a-orphan.** Two rows carry an `sf_opp_id`,
are **still open at `stage='qualified_lead'`**, and the feed **stopped sending them**:

- **`Action Behavior Centers — Duncanville — TX`** (`006Vs00000fQ1nFIAS`), last synced **2026-08-04**. A *second, live*
  Duncanville opportunity correctly moved `loi_executed → in_escrow` on the first good run — so this is a
  **superseded duplicate** stranded at a stage that has been false for five weeks.
- **`Test Property SN 05032024`** (`006Vs00000gT8mnIAC`), last synced **2026-08-20** — a **Salesforce test record**
  sitting in the production deal backbone as an open deal.

**Both render in the Important lane right now.** This is Scott's original *"My Work is well behind where the actual
status of each deal is"* complaint — still live after P1a-fix, because fixing the feed fixes rows the feed *sends*
and says nothing about rows it has **stopped** sending. ⚠️ **Do not just delete them:** on a full-refresh feed,
"absent from the payload" is indistinguishable from "deleted in Salesforce", so the rule comes first (mark
`sf_absent` after N consecutive full payloads — surfaced, never silently dropped), and test records should be excluded
at ingest. 👤 Cheaper first move: confirm in Salesforce whether the Duncanville duplicate and the test record should
simply be deleted there.
## 2026-09-12 — Live-checked the "still running, redeploy interrupted it" run: pipeline is genuinely alive, but `PRI5`'s reclaim mechanism has a real gap this run exposes; `PRI6` drafted

Scott reported the CMS ingestion run as ~10 hours in, interrupted by a `Dialysis` redeploy, and the
resumed run now ~7 hours in on its own — asking whether it's on track. Checked live against Supabase
rather than trusting the uploaded log excerpts (both uploads this round were 19–22 second snippets of the
same healthy repetitive pattern, not proof of overall health on their own — same method used for the prior
"8 hours in" check).

**Good news, confirmed live: the pipeline is genuinely alive and writing right now, not hung.**
`properties.estimated_annual_revenue` shows a newest `updated_at` of essentially "now" (0.4 seconds old at
query time) with **1,923 rows updated in the preceding 15 minutes**. This is real, ongoing, healthy write
throughput — the strongest possible signal against a hang, independent of anything in the log excerpt.

**Also good, confirmed live: `PRI5`'s reclaim mechanism is working.** The exact orphaned `ingestion_tracker`
rows this arc flagged in `PRI4` (`c6975255…`) and `PRI5` (`c817274e…`) are now both closed out
(`run_status='failed'`, `finished_at` populated) — consistent with `reclaim_stale_started_runs()` running
and sweeping them once they crossed the 2-hour safety window.

**A real gap, not previously seen, found by this live check — recommend a `PRI6` prompt:** two
`ingestion_lock` rows (`cms_medicare_clinics` and `facility_patient_counts`) are still open
(`run_status='started'`, `finished_at=null`) at **17.9 hours old** — both acquired at
2026-09-11 19:45:55 UTC, right after the last batch of tracker rows got reclaimed. That is nearly 10× past
the "well past the pipeline's own 90-minute wall-clock cap" assumption `PRI5`'s response used to justify
its 2-hour reclaim safety window, and this run is real evidence that assumption doesn't hold — a run can
legitimately still be in flight at 17.9+ hours. No `ingestion_tracker` or `run_log` row of any kind has
been created since that same timestamp (19:45:55 UTC on 9/11), despite Scott's redeploy — meaning either
(a) the redeploy restarted a different Railway service than the one holding this lock, or (b) the resumed
process reused the pre-existing lock/row instead of re-acquiring it and re-logging, which would itself be
worth knowing. **The arithmetic lines up with Scott's own report**: 10h (first stretch) + 7h+ (post-redeploy
stretch) ≈ 17h, close to the lock's actual 17.9h age — consistent with one continuous lock held since
before the redeploy, never released, rather than two genuinely separate runs.

**Net read for Scott, stated plainly**: the run is not hung and is producing real output right now — no
action needed there. But two back-to-back very-long stretches (10h, then 7h+) on top of a lock that's been
open for 17.9 hours without a fresh tracker/lock/log row is worth a real look, not just individual
reassurance each time it's asked about — both because the reclaim window's safety assumption needs
revisiting given a real run now exceeds it by an order of magnitude, and because it's not yet established
whether a redeploy is supposed to release and re-acquire this lock or not.

`PRI6` prompt drafted: `docs/claude-code/prompts/PRI6-ingestion-lock-survives-redeploy-and-reclaim-safety-window.md`.
No `STATUS`/`PLANNED-BACKLOG` closure yet — pending Scott's read on whether to send this to `Dialysis` now
or let the current run finish first.

## 2026-09-12 — CONSOLIDATE2's first flagged contradiction resolved: the stale "FINAL STATE" box defused (Cowork)

Continuing the doc-consolidation work after CONSOLIDATE2 (round 2) flagged three canonical-doc
contradictions without resolving them. Picked off the first, most directly actionable one:
`docs/architecture/document-capture-and-ocr-status.md` already carried an accurate redirect banner
at the very top pointing to `document-capture-ocr-and-deeds.md` as canonical — but immediately below
it sat a large `✅ FINAL STATE 2026-08-12 — THE WHOLE OCR LOOP IS CLOSED AND LIVE. READ THIS, DON'T
REBUILD.` box whose present-tense imperative wording could override the redirect on a skim-read,
exactly as CONSOLIDATE2 warned ("a reader following the first alone would miss DOC17/DOC18").

**Fix, not a rewrite:** retitled the box `⚠️ HISTORICAL — FINAL STATE AS OF 2026-08-12 ONLY`, named
the newer canonical doc and its DOC17/DOC18 currency explicitly inside the box itself (not just in
the banner above it), and reworded "the durable operating state" to "the operating state AS OF
2026-08-12" so the numbers that follow read as a dated snapshot rather than a standing claim.
**Nothing below the box was touched** — same historical narrative, same numbers, per REGISTRY.md's
never-delete rule. This is a framing fix, not a fact correction: everything in the box was true on
2026-08-12 and still is, as history.

The other two CONSOLIDATE2 contradictions (`tier0-owner-contact-system.md` not re-verified against
its own P197/P198 corrections; scattered "LIVE"/"SHIPPED" language predating a same-day correction,
e.g. the FRED/CMS verdict) remain open — left for a follow-up pass, same as CONSOLIDATE2 left them.

Also filed: `responses/consolidate 2 desktop response.docx` moved to `responses/done/` (matches the
already-merged CONSOLIDATE2 commit `9364ec1e`).

Docs updated: `docs/architecture/document-capture-and-ocr-status.md` (FINAL STATE box retitled).
