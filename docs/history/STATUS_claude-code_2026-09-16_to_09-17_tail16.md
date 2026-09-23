# STATUS.md archive — 2026-09-16 → 2026-09-17 (tail 16)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-23 (Cowork round 68) to stay under the 3,000-line budget (`test/status-line-budget.test.mjs`). Nothing reworded or dropped; every backlog ID in the span is tracked in `docs/os/PLANNED-BACKLOG.md`.

## 2026-09-17 — Round 29 (Cowork): **the app Scott uses every day is a stale Vercel build — Vercel was never retired** (`VERCEL-LIVE1`); Scott's lease rule — inactive only on *confirmed* expiration — recorded, RECON1's date-only trigger disabled live, `RECON2` unit 1 prompted; the three PA flows carry the header

**Round 28 merged** (PR #2569, `44928976`). Nothing new in `responses/` or `SB notes/`.

**Vercel (from Scott's log export, 21:08 UTC, + the Dialysis_DB edge log).** Project `life-command-center` is
live in production at `life-command-center-nine.vercel.app`, functions in iad1, called by Scott's own Chrome/
app window. Its client is older than `main`: it issues `bd_worklist&limit=5` (added 2026-09-03, since removed),
`cadence_dashboard&limit=200` (main: 300), the flag-OFF `/api/priority-queue?limit=5` fallback, and it reads
`ai-copilot` **from the browser** (`DENY-WOULD GET /sync/calendar-events browser scott`, 21:08:25 UTC) where
`main` goes through the server. That is why Scott sees no three-lane Home: `home_three_lanes` is ON in the
workspace config, and the build he runs predates the flag. It is also the best explanation of PL-14 (`POST
/chat`, UA `node`, AWS Ashburn): same platform, same region — the 19:19 request itself is outside the export.
`CLAUDE.md`'s "Vercel retired 2026-07-20" is corrected in place. **Open consequence:** SB notes taken from
that window may describe old code — worth a glance at recent SBN rows once Scott is on Railway. → row
`VERCEL-LIVE1`, checklist **Q30**.

**Q1.** Scott added `X-PA-Webhook-Secret` to Sync SF Activities, Sync SF Tasks and Sync Flagged Emails. The
21:00 UTC `/sync/sf-tasks` slot logged no `DENY-WOULD` (first confirmation). Last flow miss 20:01 UTC →
earliest enforce 2026-09-20 ~20:00 UTC, **and not before Q30**: the Vercel client would break on the flip.

**RECON2 — Scott's rule, verbatim:** *"Let's only allow leases to go inactive once we have confirmation that
the lease expired. We can leave it in an unconfirmed status until further research or evidence updates it."*
Option C (25-row sample first). RECON1's trigger did the opposite (flip on date alone, unledgered), so Cowork
**disabled it live** — `20260917213000_dia_recon1_lease_guard_disable_pending_recon2.sql`, in this PR and
applied verbatim; verified `tgenabled = D`; it had flipped 0 rows; 2,454 leases remain active past expiration.
Measured for the prompt: `leases.status` is unconstrained free text (17 status×active combinations), so the
new state gets its own CHECK-constrained column. **Prompted:** `RECON2-lease-expiration-confirmed-not-assumed-
and-banning-residue.md` — R5 rewritten, reader labels, dry-run + sample, research worklist, and RECON1-b.

**Parking lot:** +PL-21…23, triaged on entry. Next free: PL-24.

**Open for Scott:** Q30 (open the Railway URL, say what Home looks like, reinstall the app, send Vercel's
env-var *names*); **send `RECON2`** to Claude Code.

## 2026-09-17 — Round 28 (Cowork): `RECON1` + `GUARD-CLOBBER1` reconciled against live state — Banning is one property and off *Available*, but the deed task was never created and "Not on file" was stored as a party name (`RECON1-b`); fleet reconciler filed (`RECON2`); Q1 clock restarts — `/sync/activities` still `DENY-WOULD`; PL-14 caller traced to AWS Ashburn (derived: the retired Vercel project)

**Clobber check first (the last manual one).** `STATUS.md` `## ` headings and backlog row ids at the round-27
merge (`20dd3ae0`) vs `origin/main` (`a5ae7d17`): identical. The only change since is PR #2567 (3 files: spec,
migration, test). `GUARD-CLOBBER1` is on `main`, in `test-suite.yml` on both paths and in the commit script, so
the per-turn manual diff is retired.

**`GUARD-CLOBBER1` (PR #2566, merged `cef6e0c4`) — reconciled ✅.** `test/doc-clobber-guard.test.mjs` exists
on `main`; workflow lines 57/146; the round wrote its own STATUS entry and row (below). No `Parked:` section.

**`RECON1` (PR #2567, merged `a5ae7d17`) — reconciled 🟡.** Step 4a: the migration's objects exist live on
Dialysis_DB (`dia_recon1_run_log`, `dia_recon1_reconcile_banning_clinic`, the lease guard function + trigger,
enabled); ledger batch `recon1_banning_apply1` = 7 rows. Measured after-state: properties 35786 and 51228 are
gone into **29894** (reversible, backups 594/595); the clinic has **0 active listings** (12350 / 14798 / 15146
off-market 2026-09-14 → sale 15042; 9499 `withdrawn`, was a false `sold`); lease 23211 inactive; sale 15042
carries `listing_broker_id = 1373`. Spec merged: `docs/architecture/reconcile-property-spec.md`, R1–R7 with
existing-vs-new per rule. Blast radius re-measured: leases active past expiration **2,454** (round said 2,455),
Northmarq sales with no broker id **235** (same), same-property active-listing-after-sale **0** (the spec says
why that zero is structural: the twin rows hide it until R1 runs), range/suffix duplicate candidates ~75
(round's figure, not re-measured).

**What the summary did not say (found in the ledger and the rows):**
1. **The deed task does not exist.** The summary says "plus a task to pull the deed"; the ledger says
   `task_insert_failed` — `pending_updates_status_check`. Nothing is asking anyone to pull the Banning deed.
2. **"Not on file (pending deed)" was written into `buyer_name` and `seller_name`** on sale 15042. The standing
   rule is that an empty value *renders* as "Not on file"; stored, it is a string every reader of those columns
   can take for a party. Measured: 1 sale, 0 owners minted from it yet.
3. After the fold, **Scott's own listing 14798 reads `superseded` and the OM shell listing 12350 reads `sold`.**
4. The part-1 **trace table was not delivered** (not in the response, not in the spec).
5. The OM's lease abstract is still not a lease on the property (declared by the round — no model in a
   migration); 29894 now shows **no active lease** behind a 3.70% cap sale.
6. The lease trigger is **fleet-wide and unledgered**: it will flip `is_active` on any of the 2,454 rows the
   next time a writer touches one. Correct direction, silent mechanism, and a dialysis lease past expiration is
   often a real holdover — 0 rows are flagged `holdover` today.
7. Process: the round wrote **no STATUS entry and no row edit** (⑤-CC) and no `Parked:` section. No clobber.
→ rows **`RECON1-b`** (1–5, filed) and **`RECON2`** (the fleet build; 6 is its first decision). Nothing was
hand-fixed from Cowork: each is a write through owned machinery.

**Q1 (`ai-copilot` enforce) — the log is not clean.** 24 h re-read at 20:30 UTC: `/sync/calendar-events`
last `DENY-WOULD` 18:26, the 19:27 slot silent ✓. But `/sync/activities` fired `DENY-WOULD` at **20:01 UTC**;
`/sync/sf-tasks` (last 15:00) and `/sync/flagged-emails` (11:32) have not fired since the fix, and nothing
suggests they carry the header. The three-day clock runs from the last `DENY-WOULD` on any route, so
**2026-09-20 evening no longer holds** until those three flows send the header → checklist Q1.
**PL-14:** `POST /chat node other` again at 19:19:39 UTC. Edge log for that request: UA `node`, network Amazon
Ashburn, **400**. Railway shows as org `Railway`/Santa Clara in the same log — not Railway. **Derived:** the
Vercel project retired 2026-07-20 is still deployed (`.vercel/project.json`, Node 24; Vercel = AWS us-east-1;
Node fetch UA = `node`) and something still calls it. Confirmation is Scott's (Vercel dashboard) → checklist Q1.

**HOME2-on:** flag still ON; Scott's description of the three-lane Home not received this turn — row unchanged.

**Parking lot:** +PL-17…20, all triaged on entry (Q1/EDGE-GATES1-b, RECON1-b, RECON2, a process note). No open
lines; none older than seven days. Next free: PL-21.

**Open for Scott:** (1) the header on the three remaining flows; (2) is Vercel still up; (3) RECON2's holdover
rule — expired-but-active dialysis lease = inactive, or `holdover` when CMS still shows the clinic operating
there; (4) what the three-lane Home looks like.

## 2026-09-17 — Round 27 (Cowork, short): Q29 answered; `home_three_lanes` turned ON for the look; no Settings panel for flags exists (SETTINGS-FLAGS1)

**Q29 (Scott):** all three `brokers` rows named Scott Briggs are him — 1373 (Northmarq; 26 available
listings, 55 `sale_brokers` rows, one company-history row), 2076 (bare; 2 `sales_transactions`; shares
1373's `contact_id`), 2437 (Stan Johnson Company; 4 listings, 4 sale-broker rows; own `contact_id`).
Decision: **keep the firm attribution distinct by date** — one person, `broker_company_history` rows
(Stan Johnson → Northmarq), so each sale attributes to the firm at the time; not a flat merge. Found on
the way: firm **126 is named `scott briggs`** — BR4 minted a firm from his name; it belongs to Northmarq.
Both recorded on `BR4-b`, and the same rule (same person + different firm → history row) is the rule
for BR4-b's 120 one-linked-one-blank groups.

**HOME2-on:** Scott looked for "Settings → workspace feature flags" and it does not exist — the app's
own empty-state copy points to a panel nobody built; the only writers of
`workspaces.config.feature_flags` are `POST /api/flags` (manager) and the database → `SETTINGS-FLAGS1`.
Cowork set `home_three_lanes: true` on the one workspace (`a0000000-…0001`, LCC Opps, SQL `jsonb_set`;
previous: absent → default false; `queue_v2_enabled`, `ops_pages_enabled`, `more_drawer_enabled`
untouched). Scott's look is the next step; the flag flips back the same way if the Home is worse.

**GUARD-CLOBBER1 merged meanwhile (PR #2566, `de480723`)** — `test/doc-clobber-guard.test.mjs` in `test-suite.yml`, verified red on the #2563 pair and green on the restore; its docx response is still to be filed and reconciled (row already marked shipped by the round).

**Handoff:** this thread closes here; the next chat starts from the prompt in the round-27 reply
(main `d3fa1ce2` + this round; RECON1 and GUARD-CLOBBER1 responses pending; clobber check each turn).

## 2026-09-17 — `GUARD-CLOBBER1` shipped (CC): a CI test that fails a PR which silently deletes STATUS entries or backlog rows

`test/doc-clobber-guard.test.mjs`, wired into `.github/workflows/test-suite.yml` on both the
docs-only-skip path and the full-suite path (a clobber is a doc-only diff by construction, so a
guard that only ran inside the full suite would never see it). It diffs `STATUS.md` and
`PLANNED-BACKLOG.md` at HEAD against the PR's real base sha (`GUARD_CLOBBER_BASE_SHA` =
`github.event.pull_request.base.sha`, piped in as a workflow `env`) and fails if any `## ` STATUS
heading, Open-threads row, or backlog row id present at the base is missing at HEAD (unless a
heading was moved verbatim into a `docs/history/STATUS_claude-code_*.md` archive in the same
commit), or if a backlog row's Item text became a strict prefix of what it was at the base (the
signature of an older snapshot landing on a newer one, since the append-only loop never shortens
a row). Verified against real history before shipping: run against base=round25/head=the pre-fix
`70ae2e82` it goes RED with the exact 7 headings / 11 rows PR #2563 deleted; run against
base=`70ae2e82`/head=round26's restore commit it is green. Added the same discipline note to
`docs/os/BUILD-TURN-PROTOCOL.md` §⑤-CC and `docs/claude-code/README.md` step 7: edit both files
only against the CURRENT `origin/main` copy, never a copy read earlier in the session.

## 2026-09-17 — Round 26 (Cowork): **PR #2563 had silently reverted STATUS and the backlog to a week-old snapshot — restored**; `EDGE-GATES1` reconciled and verified live (8 functions log-gated); Q1's second calendar flow fixed — `/sync/calendar-events` clean since 18:30 UTC; the Banning clinic note (SBN-12) traced on Dialysis_DB → `RECON1` prompted; parking lot +3

**⚠️ Second doc clobber, this time from a Claude Code round — found and repaired this round.**
PR **#2563** (`docs/hcris-timeout-7-verify`, `70ae2e82`, parent `0ca02c77` = main after round 25)
committed `STATUS.md` and `PLANNED-BACKLOG.md` as whole files taken from `0304aa8b` (main seven
Cowork rounds earlier) plus its own HCRIS-TIMEOUT-7 entry and two HCRIS row edits. Result on `main`,
no conflict, CI green: **7 STATUS entries gone** (every Cowork round of 2026-09-17: H8/R1/F8,
F8 pre-check, F8 verified/PRI2-on applied, inventory review, parking lot, DIA1c/geocode/harris-d,
DEPLOY2-live/BR4/HOME2), **11 backlog rows gone** (`DEPLOY2-stale-body`, `BR4-b`, `DIA-DUP1`,
`OWNER-WRITERS1`, `EDGE-GATES1`, `PRI2-on`, `FLOWS-consolidate-lcc`, `INVENTORY-review-2026-09-17`,
`INVENTORY2`, `PROCESS-ROW-CELLS`, `PROCESS-PARKING-LOT`) and **84 rows reverted** (all the round-23
"→ checklist Qn" pointers, every ✅ from rounds 19–25). Verified by diff: main's backlog =
`0304aa8b`'s + exactly the two HCRIS rows. **Restored here** from `0ca02c77` with #2563's real edits
re-applied (its entry sits below this one; the two HCRIS rows carry its text; the duplicated
CoStar/Deed open-thread rows — a pre-existing copy — collapsed to one each). The other four docs were
untouched by #2563. The CI guard `PROCESS-MERGE-CLOBBER` filed in round 17 was never built; it is now
a prompt: **`GUARD-CLOBBER1`** (STATUS entries append-only, backlog rows never deleted, truncated
narrative = fail; tested against this very pair of commits). Until it lands, Cowork diffs `main`
against the previous round's merge at the start of every turn.

**EDGE-GATES1 (PR #2564, merged) — verified by Cowork against `list_edge_functions` on Dialysis_DB.**
Eight functions now carry the shared `authenticateWebhook()` gate in log mode, `verify_jwt:false`
unchanged, `<FN>_AUTH_MODE` defaulting to `log`: `context-broker` v21, `template-service` v19,
`intake-receiver` v20, `calendar-ics-sync` v21, `calendar-caldav-sync` v26, `calendar-caldav-push` v24,
`calendar-capture` v15, `data-query` v44 (non-GET routes only). Eight left alone because they already
had real enforced auth (`lead-ingest`, `intake-salesforce`, `intake-salesforce-files`,
`sf-promotion-worker`, `npi-registry-sync`, `w41-corpus-export`, `w43-sf-link-export`,
`w44-retrain-tick`). Caller inventory at `docs/architecture/flows/edge-gates1-caller-inventory.md`;
70 tests. First gate lines already visible in the 24 h log: `DENY-WOULD` on `/calendar-ics-sync`
(caller class unknown) — that is a real caller to name before any enforce → PL-15.
The round's own `Parked:` lines (four calendar functions deployed with hand-rolled shims of
`_shared/auth.ts` instead of the module; four functions with zero traffic in 24 h so their
"what enforce needs" is blank; `calendar-caldav-push`'s destructive retire routes only log-gated;
`intake-salesforce` ~400 lines of deploy drift) → one follow-up row **`EDGE-GATES1-b`**.

**Q1 — the calendar flow.** Scott found the second hourly caller ("Outlook Calendar - Life Command
Center Sync") missing the header in its HTTP step and fixed it. Log read 2026-09-17: last
`DENY-WOULD … /sync/calendar-events` at 18:26 UTC, none 18:30 → 19:26 UTC across two hourly runs.
The 3-day clock for `COPILOT_AUTH_MODE=enforce` starts at 18:26 UTC 09-17 → earliest flip
**2026-09-20 evening**, Cowork re-reads the log each turn until then. One new line class on
`ai-copilot`: `POST /chat node other` `DENY-WOULD` — a non-browser, non-Railway caller of the chat
route; caller unknown → PL-14 (must be named before enforce, or it breaks on the flip).

**SBN-12 — `Self Clean Triggering.docx` (nine screenshots of the DaVita Banning clinic).** Scott's
intent verbatim: *"ingestion of any data [should] trigger a reconciliation … one accurate view of
the property … The property should no longer be in the available section when it closes."*
Traced on Dialysis_DB: **three `properties` rows for one clinic** — 29894 (`6050-6090 W Ramsey St`,
the real record: 2 sales, 4 leases, 2 ownership rows, 3 listings), 35786 (`6050 W Ramsey St`, an OM
intake shell `e26e414f…` carrying an active $4.75M listing and the OM/rent-roll/lease-abstract
artifacts), 51228 (`6090 W Ramsey St`, a CoStar shell with its own active listing, seller
`Genesis Kc Development Llc`). Listing 9499 marked `sold` on 2026-06-19 with no sale row; sale 15042
(2026-09-14, $4,180,180, `is_northmarq=true`, listing broker Scott) has empty buyer/seller, no
`sf_deal_id` and wrote no ownership row; two DaVita leases (2013–2018 flagged `is_active=true`,
2015–2025 inactive — inverted); owner strings `Davita Healthcare Prtnrs` vs `DaVita HealthCare
Partners` in conflict. Every store is internally consistent and none of them talks to the others —
that is the defect class, not a data-entry slip. → **`RECON1`** (§P10a's first concrete case, with
the 27 Harris situs-gap properties): trace table → fix Banning through the existing ledgered merge
machinery → specify `reconcile_property(property_id)` as a deterministic post-ingest step with rules
R1–R7 (identity fold, listing↔sale closure, lease activity from dates, owner from the newest
evidence, artifact follow-the-survivor…) → size the blast radius across dia. Scott's Ollama
suggestion recorded as design input on the row: a local model is worth it only for the fuzzy
identity tail (R1) and lease-abstract extraction; everything else is rules the data already
determines, and a model in that path would be a second source of unexplained writes.

**Parking lot:** PL-14 (`POST /chat node other`), PL-15 (`/calendar-ics-sync` caller unknown),
PL-16 (Ollama / local-model reconciliation — parked as design input on RECON1, no separate row).
**Files moved:** `EDGE-GATES1` prompt + response → done/; SB note → `SB notes/done/`.
**Open for Scott:** send `RECON1` and `GUARD-CLOBBER1` (independent); Q1 clock running (no action until 09-20); Q29; HOME2-on;
confirm the DEPLOY2 CI job's first green run.

## 2026-09-17 — `HCRIS-TIMEOUT-7`: found the actual swallow site (three layers under round 6's re-raise guards) plus a second, independent timeout-defeating bug; fixed, tested cheaply, PR #7418 merged per Scott — live proof still pending

**Why round 6 wasn't enough, now confirmed against the deployed code rather than guessed at.**
`HCRIS-TIMEOUT-6`'s `except TimeoutError: raise` guards were real and correctly placed — on the
**SELECT-only** call sites. The actual per-row **write** in `propagate_financials()` goes through
`utils_shared.update_row()` → `utils_shared.safe_execute()` → `core_utils.safe_execute()`, and every one
of those three layers had its own bare `except Exception` that silently absorbed the `StepTimeout` (a
`TimeoutError` subclass) before it could ever reach round 6's re-raise points. This lines up exactly with
this session's own live evidence: 9h20m runtime, 10,243 properties written, zero `StepTimeout` rows,
despite running 37x past the 900s budget — the timeout was firing and being swallowed on the write side,
not failing to fire at all.

**A second, independent bug found in the same investigation**: `core_utils.safe_execute()`'s
`with ThreadPoolExecutor(...) as ex:` pattern meant even its own inner 30s timeout was defeated —
`__exit__` calls `shutdown(wait=True)`, which blocks the main thread on the abandoned worker thread for as
long as the stuck socket call takes, with no second alarm available to interrupt that join. Two separate
failure modes, both closed:

1. `utils_shared.safe_execute()` — re-raises `TimeoutError` before its generic swallow.
2. `utils_shared.update_row()` — lets a `TimeoutError` from `safe_execute()` propagate instead of
   returning an ordinary failed-write result.
3. `core_utils.safe_execute()` — `except TimeoutError: raise` added in the retry loop (which would
   otherwise re-swallow it via its own generic handler), and the blocking
   `with ThreadPoolExecutor(...)` replaced with explicit `shutdown(wait=False, cancel_futures=True)` on
   every exit path.

**Tests**: `tests/test_hcris_timeout_7.py` (pins fixes 1 & 2, with negative controls proving ordinary
exceptions are still absorbed as before) and `tests/test_core_utils_hcris_timeout_7.py` — the cheap,
targeted proof this round's prompt specifically asked for: a fake builder that sleeps 2s under a
monkeypatched 0.05s timeout, confirmed to fail at 2.001s against the pre-fix code and pass in under 1s
against the fix — no multi-hour production run needed to verify this layer. 340 tests matching
`safe_execute`/`update_row`/`propagat*`/`hcris_timeout` pass with no regressions.

**Delivery**: `sbriggssjc/Dialysis` branch `claude/amazing-turing-y8nr4w`, commit `f865250`,
**PR #7418 — Scott reports this merged.** Independently checked Supabase: no scheduled `cms_ingestion`
run has started since the round-7 run this morning (06:04:28 UTC) as of this write-up (checked
2026-09-17 ~18:55 UTC) — the next scheduled run is the earliest chance to see whether a real
`StepTimeout` finally lands in `ingestion_run_errors`. **`HCRIS-TIMEOUT` stays 🔴** until that's observed.

**Gap in this round's response, carried forward rather than glossed over**: the `HCRIS-TIMEOUT-7` prompt
asked two more things CC's response didn't address — (b) reconciling Railway's "Stopping Container at
7:34:18" Deployments-tab event against the Supabase timeline (06:04:28 UTC start, 15:24:49 UTC last
write), and (c) confirming or correcting this session's own read that round 6's SELECT-prefetch batching
is working (the shift to ~60-writes-per-10-minutes late in the prior run). Neither is resolved. If the
round-7 fix also turns out not to hold, both should be re-asked explicitly in round 8 rather than assumed
answered.

Full response filed to `docs/claude-code/responses/done/HCRIS-TIMEOUT-7-alarm-never-fires-during-propagate-financials.response.md`.

## 2026-09-17 — DEPLOY2-live, BR4 and HOME2 reconciled; Q1's calendar flow is still calling without the header; parking lot triaged, EDGE-GATES1 drafted (Cowork)

**DEPLOY2-live (PR #2559, running on `7611e966`).** The window fixes were already in code from the
09-16 coverage round; the round ran the detector **live over LCC Opps and Dialysis_DB — 149 objects,
0 unapplied** — with the three known incidents (Geocodio cap, PRI2-on, C1C) confirmed applied and
caught; added `.github/workflows/deploy2-unapplied-check.yml` (every push to `main`, fails the job with
a commit-comment table); built a **stale-body comparator but did not wire it** (needs a migration on both
projects) → `DEPLOY2-stale-body`, low. Caveats it disclosed: its probe used a shallow clone (CI's
`fetch-depth: 0` sees the full add-date window), and it caught its own hand-typed object list mid-round.
👤 Scott: confirm the job ran green on the merges since (`Actions` → *deploy2-unapplied-check*).

**BR4 (PR #2558) — applied live, verified.** 146 duplicate-name groups: **3** true duplicates merged
(13 FK constraints across 11 tables repointed, ledgered in `dia_br4_broker_merge_log`), 120
one-linked-one-blank and 20 both-blank groups correctly left (filling from a sibling would be an
identity guess), 3 different-firm. **52 firms minted** from BR1's 661 queued strings, gated on ≥3 brokers
sharing the token AND ≥2 sharing an email domain, evidence in `dia_br4_firm_mint_evidence`;
`broker_company_id` **366 → 641 of 2,566 (25.0%)**; `broker_companies` 127. 123 firm-shaped rows in
`brokers` flagged, not touched; 468 review rows open. Migration objects all present live (step 4a).
Parked by the round: PL-11 (the 123 firm-shaped rows), PL-12 (the 468), PL-13 (Scott's own name ×3 in
`brokers`).

**HOME2 (PR #2560) — built behind `home_three_lanes`, OFF.** Research = the nbaSnapshot gaps feed
(§A predicate); BD = `/api/seller-prospect-queue` top 5, labelled; Inbox = the briefing's inbox
summary, new before triaged (no due-date field exists — PL-7); the silent `_dbFillMyPrioritiesFromQueue`
fallback disabled under the flag; 21 tests. The round had no DB access, so the live render and the
"how often was `today_top_5` empty" measurement are still owed — **HOME2-on** is Scott's look at the
flag ON in his own session, then the flip.

**Q1 — not done yet, and the log says which one.** Scott reports the four header edits; the log shows
**`POST /sync/calendar-events` still logging `DENY-WOULD` at 18:26 UTC** (hourly, unchanged). The other
three run less often and cannot be judged yet. Most likely: the edited flow is not the hourly calendar
caller (four workflow ids in `ai-copilot-sync-callers.md`; the calendar one is `4eb7c46f…`), or the
header name/value differs (`X-PA-Webhook-Secret`, the Object Sync flow's value). Cowork re-reads the
log tomorrow; the three-day clock starts at the last `DENY-WOULD`.

**Parking lot, first triage.** PL-1 → **`EDGE-GATES1`** prompt (the 18 unreviewed `verify_jwt:false`
functions: measure writers/callers/drift from the deployed bodies, gate writers log-only, the
COPILOT-OPEN pattern); PL-2 folded into it; PL-3 → Q2; PL-4 → `DIA-DUP1` (Longenbaugh Rd/Dr); PL-5
recorded on GOVDEED3, no action; PL-6 → `OWNER-WRITERS1` (which writer set three `recorded_owner_id`s
during H7); PL-7/9/10 → HOME2 row; PL-8 → HOME2-on gate; PL-11/12 → `BR4-b`; PL-13 → checklist Q29
(a 30-second look). BR4's and HOME2's rounds both numbered their lines PL-7…9 — renumbered; the
`Parked:` convention now says "next free PL number, check the file".

**Next:** Scott — re-check the calendar flow (Q1), glance at Q29, send `EDGE-GATES1`, confirm the
DEPLOY2 job is green; then HOME2-on. Cowork — Saturday digest, Monday GOVDEED3, the Q1 log.

## 2026-09-17 — Working the queue programmatically: a parking lot for what we notice on the way, three independent CC rounds drafted, and Q1/Q2 measured live (Cowork)

**Scott's ask:** proceed on the recommendation, keep consolidating, and find a way to flag and grab
other topics as we go. Three moves.

**1. A parking lot.** `docs/claude-code/PARKING-LOT.md` — one line per thing noticed while doing
something else (date · where · what · who); every Cowork turn triages the open lines into a backlog
row, a checklist line, a prompt, a decision, or a drop with a reason (README step ③b). Claude Code
rounds feed it through a **`Parked:`** section every prompt now asks for in its Reporting block. Six
lines went in on day one, including one that matters: **eight more Dialysis_DB edge functions run
`verify_jwt:false` with no reviewed gate** (`context-broker`, `template-service`, `intake-receiver`, the
`calendar-*` four, …) — the COPILOT-OPEN class is wider than the two functions the queue names.

**2. Three rounds that need no decision, sent in parallel.** `DEPLOY2-live` — run the unapplied-
migration detector live against all three projects, fix the two window defects (include `dialysis/`,
window by git add-date), body-hash views and functions, and make it a job on every merge to `main`;
three incidents this week say this is the highest-leverage process fix available. `BR4` — broker
dedupe against the firm-linked population (143 duplicate-name groups; the 661 firm strings BR1 queued),
true duplicates only, every FK repointed, firms minted only with evidence. `HOME2` — the three-lane
Home from HOME1 §B behind a flag, with the BD lane corrected to PRI2's reason-first list and the
Priority-tab-duplicating fallback removed.

**3. Q1 and Q2 measured live before Scott spends time on them.** Q1: the `ai-copilot` gate **is
deployed** (v84) in log mode and the edge project has `PA_WEBHOOK_SECRET` set; in the last 24 h it logged
**35 `DENY-WOULD` lines, all from four Power Automate flows** (`/sync/calendar-events` 24, `/sync/activities`
6, `/sync/sf-tasks` 4, `/sync/flagged-emails` 1) — so the remaining step is exactly the one already
written in `docs/architecture/flows/ai-copilot-sync-callers.md`: add the `X-PA-Webhook-Secret` header to
those four flows' HTTP actions, export, then three clean days, then `COPILOT_AUTH_MODE=enforce`. Q2:
`salesforce-enrichment` v27 (log-only gate) has been live since 09-09 with **no `[sfenrich-auth]` line
in 24 h** — the monthly caller has not fired; enforce waits for one cycle (≈10-09) or Scott naming the
caller (PL-3). Q1's line on the checklist now says the four flows and the doc; Q2's says the date.

**Next:** Scott sends the three prompts and, when convenient, does Q1's four header edits (the doc
has the click-path); Cowork triages the parking lot each turn; Saturday's digest; Monday's GOVDEED3
check.

## 2026-09-17 — Inventory reviewed against the to-do lists: the residue is small; the real gap was 67 backlog rows waiting on Scott that the checklist did not know about (Cowork)

Scott asked for a run at the inventory work versus the to-do lists. The CSV (1,789 intent rows) is
mostly history: 1,000 rows are "docs & process", 919 come from `docs/history/`, and 15 carry a backlog
link. Of the 70 rows the inventory itself marked flagged / planned / partial, all but four are section
headings of findings that were resolved in their own round (checked by hand against the backlog); the
four that are not (the RCM lead flow → `marketing_leads` = 0, the holistic audit's 63 findings, the
property-tab design part 3, N15d's unreadable arm) already sit under REMEDIATION-2026-05 or their own
rows. The inventory's honest residue — ghosts (never measured), the ten root reports past their
opening sections, 283 forward-looking history statements, 102 prompts never re-checked with the
widened trace — is one read-only CC round, filed as **INVENTORY2**, held until the queue below moves.

**The gap ran the other way.** A sweep of every backlog row whose State cell carries 👤 found **67**
— across nineteen sections, some from August — against an operator checklist that held **five**.
Nine of the 67 were already done with a stale state (UX0, EXT1, EXT2, C4a, OWNERGAP1-decision; and
CFE-RUNAWAY, PRI5, CQM1, HCRIS-TIMEOUT are waiting on runs, not on Scott) — states fixed. The rest are
now **`OPERATOR-CHECKLIST.md` § Scott's queue, Q1–Q28**, tiered: **A** exposure (the open `ai-copilot`
and `salesforce-enrichment` edge functions, the Vercel teardown with the extension still writing
through the retired build, the PA webhook secret); **B** ten-minute admin (Dialysis CI required
check — three steps owed since 2026-09-02; leaked-password toggle; Postgres upgrade; Anthropic credits;
the gov detector handoff); **C** decisions that unblock building (Dialysis_DB owner confirmation, the
five long-dark-flag decisions, the six zero-completion lanes, the 2,044 false closes, the bank/trustee
rule, sponsor confirmations, the 15 person merges, CMBS opt-in, the dia tenant-in-owner-slot rule,
DOC14, N2, the orphan opps, team mailboxes); **D** tenant chores (UX0 pastes, S1–S10, probes, ASC50
reviews, W3); **E** waiting on runs; **F** parked designs. Every 👤 row now points at its Q line, and
rule ⑤-👤 in the protocol makes the mirror part of the same change from here on. SEC9/SEC10 (key
rotation) stay under the P0s decision, not in the queue.

**Next:** Scott clears tier A/B as he can (Q1–Q9; Cowork turns any of them into a click-path on
request); Saturday's digest; Monday's GOVDEED3 check; INVENTORY2 when the queue is moving.

## 2026-09-17 — F8 done and verified from the export; PRI2-on merged with its migration unapplied — the Priority tab was returning 502 until Cowork applied it; a migration-apply step joins the loop (Cowork)

**F8 — verified from `LCCFlaggedEmailIntake_20260917152101.zip`.** The success branch now reads
`Mark as read or unread (V3)` → `HTTP GetEmailWebLink` (retry exponential 3 × PT20S) →
`HTTP GetIntakeSummary` (URI re-pointed to `body('HTTP_-_outlook-message')?['correlation_id']`) →
`Post card in a chat or channel`. `Move email (V2)`, `Flag email (V2)` and `Terminate` are gone; no
processing-complete call; dead-letter path intact. Scott turned off *Outlook Intake to Teams
(Hardened)* and *Processing Complete → Move Message*. One nit, not a blocker (**F8-b**): `HTTP
GetIntakeSummary` runs after the web link on *Succeeded* only, so a web link that fails all three
retries skips the card — the guide asked for *Succeeded + Failed*; thirty seconds in the designer.
Verification is Saturday's digest and `processing_log.already_out` staying at 2.

**PRI2-on (PR #2553) — merged, and the tab was broken live.** The round appended `reason_measured` to
`v_lcc_seller_prospect_universe` (PostgREST cannot order on an expression), reordered the queue
reason-first, collapsed rows to one card per property, fixed a dead CTA, flipped `priority_tab_v2` to
true, 14 guard tests, suite 6,524/0 — and wrote in its own backlog row that the migration was
*"applied via the LCC Opps schema owner path"*. It was not: `/api/seller-prospect-queue` answered
**502 `column v_lcc_seller_prospect_queue.reason_measured does not exist`** on Railway `49329608`, i.e.
the flag was ON against a view that did not have the column. Cowork pinned the universe view (8,289
rows, full-row md5 `b8bc1505…`), applied `20260917120000_lcc_pri2_on_reason_first_order.sql` verbatim
from the repo, and re-fingerprinted minus the new column: **identical** — nothing but the appended
boolean changed. Route now 200. Live after the flip: queue 508 rows / 458 properties, **277 with a
measured reason**; the new top 20 is every one debt/developer (WMC ATL $24.9M debt+developer, FD
Stonewater/State Warehouse Nova $22.9M developer, NGP V Broward $22.9M debt, …) — the eight
`reason_to_sell_unmeasured` rows that led the old order are gone from the top. That is the post-flip
side-by-side the round said needed an operator; it is in the PRI2-on row.

**Third merged-not-applied migration in two days** (geocode cap, PRI2-on; and the C1C detector's own
history) — and this one took a user-facing tab down. The loop gets a step, not another finding:
**`docs/claude-code/README.md` step 4a and `BUILD-TURN-PROTOCOL.md` ③** — for every merged PR, diff
`supabase/migrations/**` against `origin/main~`, and for each new file check the live object exists
(`information_schema` / `pg_proc` / `cron.job`) *before* the row goes ✅; apply from the repo file if
not, verbatim, and say so. The DEPLOY2 detector's live run is still the tool that should do this
(`DEPLOY2-coverage`, three incidents behind it now).

**Next:** F8-b (Scott, 30 s); Saturday's digest (F1–F8 verification); Monday's GOVDEED3 check;
`FLOWS-consolidate-lcc` after a clean digest; DEPLOY2 live run.

## 2026-09-17 — F8 pre-check: the Move Queue Executor exists and is the working single mover; the consolidation steps revised (three movers → one) (Cowork)

Scott's export of *LCC Move Queue Executor* (15-minute recurrence): `GET /api/move-queue-worklist`,
find each message by `internetMessageId` (immune to the id change a move causes), clear the flag when
LCC says so, move to the folder LCC names, `POST /api/move-queue-ack`. Live on LCC Opps: **118 moves in
14 days, latest 11:45 UTC today, 2 `already_out`** — P120's puller, working. So the message had
**three** movers: the Flagged flow's own `Move email (V2)`, the *Processing Complete → Move Message*
flow reached through LCC's webhook push relay after the Teams card, and the Executor. The 2
`already_out` rows are the races counted.

`docs/setup/FLOWS-CONSOLIDATE-2026-09-16.md` revised: copy **three** actions from the Hardened flow
(web link, intake summary, card — not the processing-complete Condition), delete the Flagged flow's
own Move **and** its Flag-clear (the Executor clears the flag; the trigger keys on it), re-point one
expression, turn **two** flows off (Hardened + Processing Complete → Move Message). Verification is
now a number: `already_out` stops at 2. LCC follow-up filed low: `FLOWS-consolidate-lcc` (retire the
webhook→Move-Message relay once nothing calls it). The Executor export goes to
`private/power-automate/exports-2026-09-17/` (carries connection references — never committed).

## 2026-09-17 — H8 applied (with its ledger row this time); R1 delegated → `PRI2-on` prompt; F8 walked through (Cowork)

**H8.** `POST …?jurisdiction=harris_tx&include_classes=C2`, no `batch_tag` (the tick derived
`ownergap2_harris_tx_202609171319`) → `wrote 1`: `10311 South Post Oak` → `LUEL PARTNERSHIP LTD 2-03`,
source `ownergap2_public_assessor:harris_tx:0440360000028`, citation `state_class = C2`. The ledger
took the row (id 107 rows total now; harris resolved **21**) — OWNERGAP2-ledger-order's fix, seen
working. Properties with an owner **5,523**. Harris final shape: **21 of 50 applied**, 27 situs gap
(§P10a), 1 Longenbaugh Rd/Dr duplicate, 1 refused on a directional conflict (380 W vs E Little York).
**41 assessor-sourced owners live.**

**R1.** Scott delegated the read. Recommendation, recorded: ON, with two changes that are not a new
score — order *measured reason before value* (today eight `reason_to_sell_unmeasured` rows sit in the
top 20 ahead of measured debt/developer reasons) and one card per property (rows 1/17 and 5/6 of the
side-by-side are the same property twice). → `prompts/PRI2-on-reason-first-and-one-card-per-property.md`.

**F8.** Scott asked for the walk-through; it is `docs/setup/FLOWS-CONSOLIDATE-2026-09-16.md` (merged
in round 18), nine steps, restated in chat this turn. The pre-check (a *Move Queue Executor* flow?)
comes first.

## 2026-09-17 — DIA1c, FLAGS-geocode-on and harris-d reconciled; Geocodio live (after Cowork applied the cap migration the round had only merged); the C2 dry run resolved one and refused one for the right reason (Cowork)

**DIA1c (PR #2547, running on `0304aa8b`) — verified live on Dialysis_DB.** The 878 were mostly not a
duplicate-operator problem: 807 carry `operator_class` category/payer/non_operator (Independent 683,
Other 84, State Owned 17, Kaiser 20…) and are `operator_id = NULL` **by design** — folding them would
count categories as companies, the opposite of S2. The real residue was 71 properties on 13 names
that were never in the registry (Intermountain Healthcare, UPMC, Veterans Administration…) — the round
registered them as operators rather than the review list the prompt asked for; they are health
systems, not spelling variants, so the call is defensible and is recorded here as a deviation. The
split Scott named was real and older than the tile: ID2a had merged the duplicate `Us Renal Care Inc`
rows but never repointed `properties`/`tenants`/`leases`/`medicare_clinics.operator_id` onto the
survivor. Fixed. Live now: **33 canonical operators**, `US Renal Care` one row with **465** properties
(was three rows), `DaVita at Home` folded into DaVita, `v_dia_operator_unresolved_review` **0**, no
property points at a merged operator. Migration in `supabase/migrations/dialysis/` here ✓ (applied live
from the session, committed the same round — the doctrine sentence held). The tile reads the canonical
count with an `operators_unresolved` sub-label; the DIA1b guard that pinned the old caption was
re-pointed at the new contract.

**FLAGS-geocode-on (PR #2549) + D4 — live, but not by itself.** The code shipped a per-UTC-day
Geocodio ledger (`geocode_tier_usage`, cap 2,400, Census continues past it) and the registry
update; the migration `20261102210000_lcc_flags_geocode_on_geocodio_daily_cap.sql` was **merged and
not applied** — the handler reads a missing table as "0 used" (fails open toward Geocodio, by design),
so with Scott's key in Railway the 10-minute cron had been calling Geocodio uncounted since the key
landed. Cowork applied the migration to LCC Opps at 12:33 UTC (its own file, verbatim, from this
repo). Then one live tick: **120 scanned / 120 patched, all by Geocodio** (Census 0 — these are the
Census-miss long tail), `geocodio_usage_after_tick` 120. Unplaced properties so far: dia 1,707 →
**1,639**, gov 1,760 → **1,701**; the cron will spend the rest of today's cap in ~3 hours and go
Census-only until 00:00 UTC. ⚠️ Second incident of the class DEPLOY2 exists for, and the detector's
live run is still "pending" (`DEPLOY2-coverage`) — noted on that row.

**OWNERGAP2-harris-d (PR #2548) — the C2 dry run.** `include_classes=C2` validated against a closed
allow-list, threaded to the matcher, echoed in the response; an admitted class resolves on the exact
arm only (`class_admitted_requires_exact_situs`); `state_class` in the citation; 45 tests; suite
6,510/0. Live: population 30 → **1 resolved / 29 refused**. Resolved: `10311 South Post Oak` →
**`LUEL PARTNERSHIP LTD 2-03`** (acct `0440360000028`, C2, exact). Refused, and correctly: `380 W
Little York` — HCAD's C2 account `380 LITTLE YORK LLC` sits at **380 E Little York Rd**, a different
address on the other side of the freeway; the exact-situs rule Scott asked for is what kept a
plausible-looking wrong owner out. The remaining 27 are the situs gap. **H8:** apply the one on
Scott's go.

**Also — a defect in my own tooling, found while writing this.** Since round 16 the helper that appends a
round's outcome to a backlog row wrote the text into the State cell and then overwrote that cell with the
new state: 20 rows on `main` (GOVDEED3, DEED1-reconcile-2, ID3d, ID3d-reconcile, the harris-c/ledger-order
rows, the S1–S5 decision rows…) have read ✅ with **no supporting narrative** since PR #2538. The
narratives are restored in this round from the scripts that produced them, the helper is fixed, and
`PROCESS-ROW-CELLS` records it with a guard idea (a State change without an Item change is suspicious).
Railway `0304aa8b` = main (all three rounds running). The HCRIS-TIMEOUT session's PR #2550
(round 6 live proof failed overnight) landed in the same window — theirs, untouched.

**Next:** H8 (say "apply"); R1 (the PRI2 read); F8 (the flow consolidation); Saturday's digest;
Monday's GOVDEED3 check; the DEPLOY2 live run so the next unapplied migration is caught by a tool, not
by a tick that happened to be watched.

## 2026-09-16 — S1–S5 answered and turned into work; V1 answered from the screenshot and the gov repo; C2 accounts staged; PRI2 side-by-side produced (Cowork)

**S1 — PRI2.** Scott could not find the side-by-side because it did not exist; it does now:
`docs/audits/PRI2_SIDE_BY_SIDE_2026-09-16.md`, measured live. V1's top 20 is the oldest overdue P1 rows
(all gov, all `lease_expiry_24mo`, next touch 668–729 days ago — a two-year-old to-do). V2's top 20 is
the twenty most valuable in-band assets ($19.9M–$24.9M), 15 with no linked person, 8 in band only on
value + lease (`reason_to_sell_unmeasured`); one owner overlaps. The read is Scott's; the likely
follow-up if he says "reason first" is a one-line order change inside PRI2's no-new-score rule.

**S2 — Operators.** Decision is neither 45 nor 21: **one operator identity everywhere** (US Renal =
U.S. Renal Care), the canonical count is the only number, and the 878 unresolved operator names are
the work, shown as such. → `DIA1c` prompt (fold onto the registry fill-blanks, evidence-backed aliases
only, one count view consumed everywhere).

**S3 — Geocoding.** "If it's free, get it working." Measured: the backfill *is* working on the keyless
Census tier; dia 1,707 + gov 1,760 = **3,467** properties still have no lat/lng; Geocodio's free tier is
2,500/day and the handler already calls it. → `FLAGS-geocode-on` prompt (key in Railway = D4, a hard
daily cap in code, Google stays off by decision, registry reasons recorded).

**S4 — Flows.** Option (b), one flow owns the lifecycle. Read from the two exports: both flows post
the message to LCC (idempotent), only the Hardened one posts the card, and the message is **moved by
two movers** (the Flagged flow's own `Move email (V2)` and the Move Message flow LCC calls after the
card) — P120's "two movers on one transition" verbatim. Click-path written:
`docs/setup/FLOWS-CONSOLIDATE-2026-09-16.md` (F8): copy four actions from the Hardened flow into the
Flagged flow's success branch, delete its own move, re-point three `body('HTTP_PostIntakeMessage')`
references, turn the Hardened flow off, export. Pre-check first: does a *Move Queue Executor* flow
exist (P120's puller)? If so the steps change.

**S5 — C2 accounts.** Scott: go with the recommendation, and the parcel must be the county's parcel.
Recommendation recorded as **(a) with an exact-situs rule** for admitted classes. Done now: the merged
loader re-run from the VM with `--include-classes C2` → stage **98,804** rows (F1 68,811 + F2 2,465 + C2
27,528), 0 without an owner — and the harris-c loader worked first time on the real file, honest
accounting and all. Still needed: the tick has no `include_classes` parameter → `OWNERGAP2-harris-d`
prompt (parameter + exact-arm-only for C2 + `state_class` in the citation).

**V1 — where the gov deed ingest runs.** The Railway service in Scott's screenshot
(`public-record-ingest`, project `handsome-luck`) builds from **`sbriggssjc/Dialysis`** — that repo has
its own `src/public_record_ingest.py` (no `save_deed_record`); it is the dialysis-side ingest, not the
gov one. The gov deed writer (`save_deed_record`, GOVDEED3) runs from **GitHub Actions**
(`.github/workflows/ci.yml`: daily 08:00 UTC `pipeline_runner --daily`, weekly Monday 06:00 UTC), which
checks out `main` every run — so GOVDEED3 is live from its next scheduled run. Live evidence: gov
`deed_records` inserts on 09-07 (11, 10 dateless) and 09-14 (9, 9 dateless) — Mondays, the weekly
job — so the manufacturing was still happening pre-GOVDEED3. **Verify Monday 2026-09-21:** dateless
inserts that day must be 0. ⚠️ The gov repo's own note says compute crons belong on Railway, not GH
Actions (free-plan failures); the deed ingest is on GH Actions today — recorded, not changed.

**D3.** Scott reports Dialysis PR #7416 merged (the removal); not verifiable from here (no GitHub
fetch) — accepted as reported, ID3d-reconcile closed.

**Next:** Scott — F8 pre-check + click-path; D4 (Geocodio key); the PRI2 read; send `DIA1c`,
`FLAGS-geocode-on`, `OWNERGAP2-harris-d`. Cowork — after harris-d merges, the C2 dry run; Monday, the
GOVDEED3 verification; Saturday, the digest.

## 2026-09-16 — harris-c, ledger-order and ID3d-reconcile merged and running; the C2 switch stops one step short of the tick; my own round-8 merge clobbered another session's entry — commits move to patches (Cowork)

**OWNERGAP2-harris-c (PR #2541, Railway `4fc03bbd` = main).** All five: `on_conflict=acct,file_year` on
the POST; one `{written, errors}` shape with the DB's `code`/`message` surfaced; `owner_name` from
`owners.txt` ln 1 when the export has no `name` column, and `--apply` refuses a stage with any empty
owner; `isHcadPlaceholderOwnerName()` (`CURRENT OWNER`, `OWNER UNKNOWN`, …) filtered before grouping,
so HCAD's sentinel can never be written; `--include-classes` on the loader and `includeClasses` on the
matcher, default F1/F2. 18 + 33 tests, suite 6,489/0. ⚠️ **The switch reaches the matcher but not the
route** — `ownergap2-owner-resolve-tick` reads no `include_classes` query parameter, so the C2 dry run
S5 asks for cannot be run live yet; and the stage holds no C2 rows until the loader is re-run with the
flag. Both are one small step *if* S5 lands on (a); folded into the S5 row rather than prompted ahead of
the decision. The round also wrote its own response file into `responses/` (moved to `done/`).

**OWNERGAP2-ledger-order (PR #2540, running).** `applyOwnerResolution()` now reads the ledger insert's
result and on failure PATCHes the property back to NULL (re-checked against the owner id it just
wrote, so a race is never clobbered) and reports `ledger_write_failed:<status>` — `wrote` can no longer
exceed ledger rows. Default `batch_tag` is minute-granular; a caller-supplied tag is checked against
open ledger attempts for the population before any write and refused `409 batch_tag_collision`
(verified: the check is on the write path — a dry-run GET with the old tag still answers normally,
which is right, dry runs ledger nothing). Sequence gap answered: `id` is `bigserial`, `nextval()` fires
before CHECK/unique evaluation, so the 48 missing ids are the failed inserts — nothing was deleted.
Ledger row 125 untouched. 6 new tests + 2 source-shape assertions; 6,486/0.

**ID3d-reconcile (LCC PR #2539 merged; Dialysis PR #7416 opened for the removal — merge state not
visible from here → checklist D3).** Three live hashes pinned and unchanged before/after
(`dia_resolve_guarantor`, `dia_normalize_guarantor_text`, the trigger); migration ported
byte-identical with an "already live" header carrying the hashes; 9 structural tests ported to
`node --test`; `CLAUDE.md` doctrine row now says the rule binds a CC/Cowork session with Supabase MCP
too. The 87 unresolved leases are **81 distinct guarantor strings** — single-clinic SPEs, personal
guarantees, multi-party splits ("USRC and Nephrology Group") — listed in the commit; filed as
**ID3d-b** (review lane, not prompted).

**A finding about my own process, from another session.** PR #2537 (the HCRIS-TIMEOUT chat) records
that its STATUS entry and Open-threads update, merged at PR #2516, were **silently reverted by my
round-8 merge** (`8cda70b9`) — no conflict raised, because my rounds copy whole files from a bundle
built against the `origin/main` I fetched at the start of the turn, and the fresh worktree takes the
bundle's file as-is. Anything merged to those files between my fetch and my push is overwritten. The
other session recovered the content by re-checking `origin/main` before reporting. **Fix, from this
round on:** the bundle carries a base SHA and a unified diff per existing doc; the commit script runs
`git apply --3way` against a fresh `origin/main` and stops on conflict — new files still copy. Row
`PROCESS-MERGE-CLOBBER`. The other session's HCRIS-TIMEOUT-5 finding itself (both fixes merged and
redeployed, the identical failure shape persists on a fresh run) stays theirs; its row is in the
Open-threads table as they wrote it.

**Where the decisions live, since Scott asked:** `docs/claude-code/OPERATOR-CHECKLIST.md` → § *Decisions
(Scott's)*, rows S1–S5, each with the options and where the answer lands. Answer in chat or in the
file; Cowork does the rest.

**Next:** Scott's D3 (merge Dialysis #7416) and V1; S1–S5; PRI2 side-by-side; the next free-bulk
jurisdiction once S5 settles what Harris looks like finished.

## 2026-09-16 — Five rounds reconciled (GOVDEED3, DEED1-reconcile-2, ID3d, MISPARSE1, BR1/BR3); H7 applied — and the apply exposed a ledger-ordering defect (Cowork)

**H7 applied.** `POST …?jurisdiction=harris_tx` under the day's batch tag → `wrote: 1`:
`2626 South Loop West` → `AMALGAMATED HOUSTON HOLDINGS LLC`, source `ownergap2_public_assessor:harris_tx:1145390000003`.
Properties with a `recorded_owner_id` **5,517 → 5,519** (the other +1 is `1325 Hwy 4 East` and two more
from other writers in the same window — not OWNERGAP2). ⚠️ **The ledger did not get the row.** The
property already carried an `unresolved / no_staged_rows` row under the same batch tag from the
19-owner apply, `uq_dia_ownergap2_open_attempt (batch_tag, property_id)` refused the `resolved` insert,
and the owner write proceeded anyway. Cowork wrote the missing ledger row by hand (id 125, batch
`…20260916b`, the citation says why). Two defects — ledger after write with no rollback; a reused tag
is silently half-blind — and one operator error (reusing the tag) → **`OWNERGAP2-ledger-order`**,
prompted, small. 40 assessor-sourced owners are live; the provenance contract held only because
someone looked.

**GOVDEED3 → gov PR #406, merged.** The round measured 5,671 dateless `deed_records` (Cowork's
prompt said 4,908 — the population grew between measurements; note the drift, not a conflict):
5,142 carry `consideration=0` **and** a placeholder grantor; the 9 with a positive consideration all
carry a real grantor. Gate made conjunctive on the placeholder shape (no date, no document number,
placeholder grantor), `consideration` left unguarded per §13d, positive control for a real $0
quitclaim, 59 tests. ⚠️ Merged is not running: `public_record_ingest.py` runs wherever the gov
ingestion runs — **V1** on the checklist is to confirm the deployed copy carries `_is_placeholder_party_name`.

**DEED1-reconcile-2 → LCC PR #2535 + Dialysis PR #7414, both merged.** Hashes matched the pin before
and after (view `9fc5aa3f…`/4747, function `72b48cd9…`/2183); the migration now sits in
`supabase/migrations/dialysis/`; the Dialysis copy is removed; `CLAUDE.md`'s Dialysis_DB inventory row
no longer reads as an ownership verdict and names this incident as the worked example.
CANON-OWNERSHIP1's contradiction is therefore closed in the text; 👤 Scott's formal confirmation is
still the open item on that row.

**ID3d → applied live, then Dialysis PR #7415 — the wrong repo, the same day the doctrine was
re-stated.** Verified live on Dialysis_DB: `leases.guarantor_id` **1 → 628 of 715** (87 to review),
`dia_guarantor_aliases` 58, `dia_resolve_guarantor()`, a real FK `fk_leases_guarantor_id` (it had
been described as an FK and was not), fill-blanks trigger, parity view; DaVita/Fresenius subsidiaries
kept distinct with `parent_company_id`. The round applied directly via Supabase MCP (no PR first) and,
lacking this repo in its scope, committed the migration + 9 tests to `Dialysis`. Right result, wrong
record — **`ID3d-reconcile`** prompted: port byte-identical here, remove there, and add the sentence to
the doctrine table that stops the third occurrence.

**MISPARSE1 → LCC PR #2533, merged and running** (Railway `affc5d84` = main). `email_fanout` split by
mailbox genericness: a personal-shaped shared mailbox fanning out to several person-shaped names is
admitted whole; a role inbox stays strict. 4 → 9 of 12 real brokers recovered on the live fixture, 0
new junk; `person_junk_name` strengthened for the genuine junk that had been leaking (financial line
items, `PO Box`, `NAI <City>`). The round wrote its own STATUS entry and rows (kept).

**BR1/BR3 → applied live + LCC PR #2534, merged.** Cowork re-measured Dialysis_DB: `broker_companies`
**75** (from 131), 10 `;`-rows left (the ambiguous ones, in `dia_broker_company_composite_review`),
`brokers.broker_company_id` **366 of 2,550 (14.4%)**; the review table holds **674** rows — 10 firm
composites, **661 `brokers.company` strings with no registry match** (queued, never minted), 3
existing-link conflicts. That 661 is the real next unit for BR4. Write guard rejects new `;` names.
The round wrote its own STATUS entry and rows (kept; the open-threads row header it produced is fixed).

**Process note.** Three of the five rounds edited `STATUS.md` / `PLANNED-BACKLOG.md` directly. Two of
them re-introduced rows that already existed (caught by the ID-uniqueness guard, fixed by the rounds
themselves) and one appended a fifth cell to four rows (caught by the table-shape guard). The guards
did their job; the rule that keeps the fixes from being needed goes in `BUILD-TURN-PROTOCOL.md`: a
round **appends** to STATUS and **updates the row it owns**; it never restates a row, and Cowork
reconciles in the next turn. Row `PROCESS-CC-DOCS`.

**Next:** send `OWNERGAP2-harris-c`, `OWNERGAP2-ledger-order`, `ID3d-reconcile`; V1 (where does
`public_record_ingest.py` run?); decisions S1–S5; the PRI2 side-by-side.

## 2026-09-16 — MISPARSE1: email_fanout split into generic-inbox vs team-roster (Cowork)

`isGenericMailboxLocalPart()` + `recoverTeamRosterBatch()` (`api/_shared/misparse-disposition.js`),
additive to the existing single-owner `recoverFanoutOwner`: a personal-shaped shared mailbox (not
`info@`/`leasing@`/`admin@`/…) that fans out to several distinct person-shaped, non-org names is now
admitted whole; a role/generic inbox stays exactly as strict before. Measured on the live 15-row
`email_fanout` fixture: recovered 4 → 9 of 12 named real brokers, 0 new junk admitted. Strengthened
`person_junk_name` (`hasFirmSuffix`/`tmMisparseReason`) to catch the genuine junk that had been
leaking into `email_fanout` instead (financial line items, `PO Box ####`, `NAI <City>` franchise
brand, CRE marketing headlines) — never touched the working `person_junk_name` rule itself.
`test/hp1-p2misparse-guard-disposition.test.mjs` +9 (23/23). Full suite 6458/6458, 0 regressions.
See `docs/os/PLANNED-BACKLOG.md` MISPARSE-BACKLOG1 / HP1-P2misparse.
## 2026-09-16 — BR1/BR3 broker_companies registry repair applied live to Dialysis_DB (Claude Code)

**`broker_companies` was a corrupted firm registry** — of 131 rows, 73 (56%) carried a literal `;`
composite capture artifact ("`<firm>; <agent surname>`", occasionally a genuinely ambiguous
multi-party capture), and `brokers.broker_company_id` was wired on only 184 of 2,542 rows (7.2%).
Re-measured live before building (the PLANNED-BACKLOG counts were stale): confirmed 73/131, and
that the `&` vs `;` distinction (BR3) holds exactly — `&` names a real firm (`Lee & Associates`,
`Cushman & Wakefield`, `Horvath & Tremblay`), `;` is the capture pipeline's composite separator.

**Applied via Supabase MCP (`apply_migration`) directly against Dialysis_DB `zqzrriwuavgrquhisnoa`,
then committed to the repo** as `supabase/migrations/dialysis/20260916120000_dia_br1_broker_company_registry_repair.sql`.
Dry-run first, then real apply, then the fleet-wide `brokers.broker_company_id` backfill, then a
hardening pass (RLS + `search_path` on the four new tables/functions — closed both advisor
findings the first apply produced).

- **Classifier, not a hand-enumerated list.** `br1_classify_composite()` splits each `;`-row into
  firm-token / agent-text and flags four GENERIC ambiguity shapes (more than one `;`; a stray `:`
  alongside the `;`; the firm and agent text sharing a prefix in either direction — the
  "`reichel; reichel realty`" / "`silver; silver group`" reversed-capture shape; an agent token
  that itself names another existing firm — the "`cole; m&m`" shape). **10 of 73 rows are
  genuinely ambiguous and were routed to `dia_broker_company_composite_review`, untouched.**
- **A real bug found mid-build and fixed before applying for real:** the agent-token splitter's
  first draft used `\s*(&|,| and )\s*` — optional whitespace around `&` — which shreds a tight
  firm abbreviation like `m&m`/`c&w`/`b&e` into two garbage tokens and made the classifier blind
  to `"cole; m&m"` naming a second real firm. Fixed to `\s+&\s+|,\s*|\s+and\s+` (mandatory
  surrounding whitespace), caught by a dry-run diff before the real apply, and pinned with a
  positive-controlled test.
- **Resolution order: exact match against an existing bare canonical row, then a small
  evidence-backed alias table, then mint verbatim (never fabricate an expansion).** Two aliases
  seeded, both citing evidence already present verbatim elsewhere in the table (`m&m` →
  `marcus & millichap`, whose fuller spelling already exists as its own bare row; `c&w` →
  `cushman & wakefield`, minted from the literal firm-token text of the
  `"cushman & wakefield; sheldon"` row). **The `m&m` alias never actually fires** — a bare `m&m`
  row already existed and exact-match wins first, so all 37 `m&m;<agent>` composites collapsed
  onto the pre-existing abbreviated row, not onto `marcus & millichap`. That is the SAFER outcome:
  merging those two bare rows into one identity is the ID3c decision this unit deliberately stays
  out of.
- **Live result:** 63 collapsed (colliers 5-way onto the existing bare `colliers` row; `m&m`
  37-way; `c&w` 10-way onto a newly-minted `cushman & wakefield`; `kw`/`encore`/`svn` 1–2-way
  each); 6 new firms minted verbatim (`b&e`, `berkeley capital advisors`, `coldwell`,
  `cp partners`, `horvath & tremblay`, `ribeiro corp`); 7 brokers created, 49 filled from blank;
  1 pre-existing broker FK repointed off a composite id before its row was deleted (measured live:
  81 brokers rows already pointed straight at a composite id — `broker_company_history` and
  `sale_brokers` also FK `broker_companies` and are repointed the same way). `broker_companies`
  131 → 75. Fleet-wide `brokers.broker_company_id` backfill (exact/alias match only): 126 more
  filled, 661 `brokers.company` values with no registry match routed to review (raw text intact,
  never used to mint a company) → **coverage 184/2,542 (7.2%) → 366/2,549 (14.4%)**.
- **Guard against a new composite ever landing again:** `trg_br1_guard_no_composite_company_name`
  (BEFORE INSERT/UPDATE OF company_name) rejects any value containing `;` — verified live with a
  real INSERT that raised 23514.
- **Parity/audit view `v_br1_broker_company_parity`** — confirmed only the 10 collapsed-into firms
  (`b&e`, `berkeley capital advisors`, `coldwell`, `colliers`, `cp partners`, `cushman & wakefield`,
  `encore`, `m&m`, `ribeiro corp`, `svn`) show a `broker_count` movement; nothing else moved.
- **Idempotent, verified live**: re-running `br1_repair_broker_companies` after the real apply
  returns `composites_seen=10, resolved_collapsed=0, companies_minted=0` — the 10 ambiguous rows
  and nothing else.
- **Not done here, by scope:** no `brokers` dedupe (BR4), no display-layer change (BR5), no
  identity merge across the `m&m`/`marcus & millichap` bare-row pair or any other ID3c collision.
  All three are now unblocked.
- **Guard:** `test/br1-broker-company-registry-repair.test.mjs` (20 tests; positive-controlled —
  reverting the whitespace-guarded `&`-split regex back to the loose form turns the guard red).
- Docs updated in the same change: `docs/os/PLANNED-BACKLOG.md` (BR1/BR3 marked ✅ shipped, BR4/BR5/
  ID3c/BR1-misparse-handoff annotated unblocked), `docs/os/CURRENT-STATE.md` (Dialysis_DB section).

---

---

## 2026-09-16 — H6: the loader wrote nothing twice on the real HCAD file; Cowork repaired it and staged the full roll; the third dry run says the rest is a situs gap, not a matcher gap (Cowork)

**Scott's two runs.** Run 1 had no Dialysis credentials in `.env.local` (`[ops-db] WARN … DIA_SUPABASE_URL`)
— every chunk 503'd, reported as `chunk_at_0_failed:undefined`. Run 2, with the credentials, parsed
1,628,306 lines → 71,276 F1/F2 rows and again reported `wrote 0 of 71276 … 72 chunk(s) failed`. The
DB said otherwise: 53,000 rows had landed. Patching a copy of the loader in the VM to print PostgREST's
body found the real error on the other 19 chunks: `23505 duplicate key value violates unique constraint
"uq_hcad_stage_acct_year"`. The POST carries `Prefer: resolution=merge-duplicates` but no
`on_conflict=acct,file_year`; PostgREST infers the arbiter from the primary key only, so every chunk
holding one of Cowork's 37 seeded accounts failed. And the `wrote 0` was a second bug: `flush()` reads
`r.ok`/`r.status` from `upsertRows`, which returns `{ written, errors }`.

**Then the worse one.** `owner_name` was NULL on all 71,276 rows — and the upsert had overwritten the 37
seeded owners with NULL. The 2026 `real_acct.txt` header is `acct, yr, mailto, mail_addr_1, …`: **no
`name` column**, so the parser's candidate list matched nothing; the loader only used `owners.txt` for a
second owner. The harris-b prompt had specified `owners.txt` ln 1 as the owner of record. Cowork's
patched copy (on_conflict; `owner_name` from `owners.txt`; honest accounting) re-ran in ~60 s:
**71,282 rows, 0 without an owner, 68,811 F1 / 2,465 F2**, seeded rows restored (`2000 CRAWFORD
PROPERTY LLC` back). 995 rows carry HCAD's placeholder `CURRENT OWNER`; none was ever applied (checked
`recorded_owners`). All three fixes + the placeholder refusal + a C2 switch → **`OWNERGAP2-harris-c`**
(prompt written). Nothing in the repo changed this round; the patched copy lives in the VM only.

**Third live dry run (full roll, deployed `ac96fd45`, population 31 still open): 1 resolved / 30
refused** — 27 `no_staged_rows`, 2 `no_records_returned`, 1 `no_matching_record`. With the whole roll
staged, `no_staged_rows` means HCAD has no account at that street+number. Checked in the raw file, all
classes, for 20 of the 27: `5208 Atascocita Rd` (HCAD: 5123/5131/5132/5210/5212/5220/5226), `6626
Antoine Dr` (6601/6696/6700), `2254 Holcombe Blvd` (2245/2249/2250/2265 W), `2920 Fulton St`
(2901/2902), `2916 Woodridge Dr` (2900/2928), `1426 Kingwood Dr` (1409/1450), `10923 Scarsdale Blvd`
(10901–10906), `20435 Cypresswood Dr` (20434/20445/20467)… **LCC's house numbers are not HCAD situs
numbers.** That is the §P10a property-identity problem (a clinic inside a larger parcel or a
tenant-facing number) and needs a parcel discriminator, not a looser matcher — nearest-number is
guessing and stays forbidden. Two of the 30 are the class filter: `380 E Little York Rd`
(`0222430000049`, **C2**, `380 LITTLE YORK LLC`) and `10311 S Post Oak Rd` (`0440360000028`, **C2**,
`LUEL PARTNERSHIP LTD`) → decision **S5**. The 1 resolved: `2626 South Loop West` → `AMALGAMATED
HOUSTON HOLDINGS LLC` (`1145390000003`, exact; the `2626 W LOOP S` account on West Loop South correctly
not taken) → **H7**, applied on Scott's go.

**Net for the lane:** the Harris population is 50; 19 applied, 1 applying, 2 pending S5, 27 need a
parcel discriminator, 1 is the Longenbaugh Rd/Dr duplicate. The free-bulk pattern holds — the ceiling
here is address identity, which is now measured, not assumed.

## 2026-09-16 — Harris owners applied (19) via HCAD bulk PDATA; backlog regrouped by category; ROADMAP.md added (Cowork)

**OWNERGAP2-harris-b reconciled (PR #2531, `6c97c86a`; Railway at `ac96fd45` = main).** The round did
what the prompt asked — `harrisPdataStreetKeys()` queries HCAD's bare `str` plus `str_num` with alias
expansion, the suffix is optional when LCC has none — and found two more real bugs on the way:
`stageRowToLocation` was concatenating `site_addr_2/3` (city/zip) into the street text, and
`normalizeAddress` collapsed `Northwest Fwy` to `FWY`. Against the 37 real staged rows: 24 of 25 named
targets resolve; Little York 2711 correctly refuses (`needs_parcel_discriminator`). Crawford and Kirby
resolved rather than refused because their non-F1/F2 accounts are excluded as untyped — that is the
rule working, but Kirby 9001 (three accounts) is worth Scott's spot-check. Loader rewritten to stream
(`JSZip.nodeStream()` + `readline`), `owner_name` from `owners.txt`, `mailto` → `owner_name_2`, `--dsn`
accepted; verified on a synthetic 50k-row zip through the real decompression path — the production zip
is still unloaded (→ H6). 19 new tests; suite 6,452/0.

**Live (Cowork, Scott's go):** second dry run `jurisdiction=harris_tx`, population 50 → **19 resolved /
31 refused** (streets outside the subset, plus real refusals — `18003 Longenbaugh Dr` refused on a
suffix conflict because LCC holds that site as both `Rd` and `Dr`: a dia duplicate to fold). POST,
batch `ownergap2_harris_tx_20260916` → **wrote 19**. Re-measured on Dialysis_DB: properties with a
`recorded_owner_id` **5,494 → 5,517**; ledger 76 rows (harris 19/31, philadelphia 20/6); every Harris
source cites its HCAD account; TX `true_owner_id` fingerprint `8810c66e…` unchanged. **39 assessor-
sourced owners now live; 41 Harris targets wait on the full-roll load (checklist H6).**

**Scott's question — "have the inventory prompts and responses been integrated into our to-do lists
by category?"** Honest answer: the *rows* were — every INVENTORY1/1b finding is a backlog row or a
loop change (INVENTORY-process, REMEDIATION-2026-05, FLAGS-geocode, REGISTRY-contacts-hub) — but they
were filed **by adjacency, not by category**: DEED/GOVDEED/C1B/C1C rows sat under §P18 *Executive
briefs*, OWNERGAP rows under §P17 *Donna TX walkthrough*, SBN/FLOWS/INVENTORY rows under §P17 too.
Nothing above the row level said "here is the ownership-evidence lane, here is app & flow health,
here is process." Fixed this round: three new backlog sections — **P19 Ownership evidence** (deeds,
owner-source conflicts, research lanes, the owner gap: 30 rows), **P20 App observations & flow
health** (17), **P21 Inventory, process & consolidation** (7) — rows moved verbatim (747 table lines
before and after, IDs unchanged), each with an intro that names the arc, its state, and what is
still open. And the missing layer above the backlog: **`docs/os/ROADMAP.md`** — one screen per
category (live / partial / open / next unit / Scott's decision), pointing at the rows. It is the
file to read when the question is "what is the next unit of work in lane X?"; the backlog stays
the row-level truth; CURRENT-STATE stays the measured state.

**Also:** Open-threads table de-duplicated (CoStar, C2g and Deed rows each appeared twice after the
09-15/09-16 merges; the newer line kept). CURRENT-STATE's OWNERGAP2 paragraph rewritten (it still
said "zero rows written" and "Harris ships fetches:false"). OPERATOR-CHECKLIST: H5 ✅, H6 added
(exact command, both credential options). `OWNERGAP2-harris-b` prompt + response → done/.
**Next:** H6 (Scott) → third Harris dry run → apply; decisions S1–S4; PRI2 side-by-side (S1 input);
GOVDEED3 handoff; CLAUDE.md pass 2.
