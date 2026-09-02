# Data-process & automation audit — window handoff

> **This is the kickoff document for a fresh chat continuing the Cowork "data-process & automation
> audit" window.** It replaces reading the whole of `STATUS.md`.
>
> **Written 2026-09-02.** Re-measure anything dated before you act on it — that doctrine has bitten
> this file's predecessors repeatedly.

---

## 1. Which window you are

Two audit windows run in parallel against this repo and they must not collide:

| window | prompts | owns |
|---|---|---|
| **this one — data-process & automation** | **lettered** (`A*`, `B*`, `C1`, `D*`, `PR*`, `DE*`, `BR*`) | ingestion, producers, CI enforcement, data coherence, source lanes |
| app audit (Scott's desktop) | **numeric** (`189`, `194`…) and `C4`–`C13`, `DOC*`, `N*` | the LCC app surfaces, Tier 0, prospecting brief, OCR |

⚠️ **Prompts in `docs/claude-code/prompts/` starting `C6/C8/C10/C11/C13/DOC*` belong to the OTHER
window. Do not action them.** Only `B6e-ci-last5-decisions-resolved.md` is this window's, and it is
already with CC.

## 2. The through-line of everything below

**Every producer failure found in this arc reported success.** Not one errored, not one alerted.
CMS was dead 67 days, FRED had never once written a row, `public_record_ingest` failed ~1,950×/day,
and the Dialysis test suite had never executed a test in the repo's history — all green throughout.

> **Assert on the STATE DELTA — rows written, queue drained, population changed — never on a
> worker's own tally, its exit status, a green cron, or a green badge.**

## 3. Where things stand

### ✅ Closed this arc

- **CMS ingestion** repaired (67-day outage; throttle keyed on last *attempt* not last *success*).
- **FRED** proven alive — `max(observation_date)` 2026-08-28, first rows ever written from CI.
- **The Dialysis suite RUNS**: `0 executed → 3,132`, `55 fail → 5`, `executed` up at every step.
  `timeout-minutes` on all four jobs, sized from a measured 6 m 12 s.
- **PR1a/PR1b** — the model-leg sentinel purged: dia `assessed_value` 8,700 zeros → **0** (262 real
  values preserved), `tax_amount` 9,025 → **0**, `tax_delinquent` `false` on 11,802 → **NULL**.
- **DE1** — both CM econ exhibits gated on `payer_mix_source`. **Both moved**; the operator exhibit
  was live-wrong, understating Satellite's revenue/clinic by **41%**.
- **BR2** — broker FK backfill **with its producer fix in the same change**: `listing_broker_id`
  181 → **1,027**, `id_set_name_null` held at **0**.
- **A1→B1a** ownership-chain arc: `establish_ownership_history` 0 completions in 69 days → **1,302**;
  gov `ownership_history` 16,177 → **18,953**.

- **B6e-ci-last5 / B6e-ci-unmask (2026-09-02, Dialysis PR #7393)** — the pytest `|| echo` is gone
  and the step is green once on `main`: **3,147 collected / 3,139 passed / 0 failed**, read from
  the job log. `baseline39` closed by supersession (`main` at `ff712e0` measured **3**, never 39).
  ⚠️ **Not yet a merge gate — see 🔄 below.**

### 🔄 In flight

**Nothing is with CC.** ⚠️ **But the Dialysis gate is one operator step short:** `ci.yml`'s header
says CI is *not* a required check, and #7393 merged 8 s after its test job started. A red suite
fails the job and blocks nothing → **`B6e-ci-required-check`** (👤 Scott, with the `paths-ignore`
docs-only fix in the same change). Ruff is `continue-on-error` and **red on `main` right now** (11
errors, root `.tmp_*.py` + `alias_review.py`) behind a green check → **`B6e-ci-mask-ruff`**.
⚠️ **Verify next:** the gate has only been proven green — it has not yet been seen to fail a red
PR; and the `exit code 128` gitlink warning's absence was not read from a checkout log.

### 🔴 Next, in recommended order

1. **`BR1`** — repair the firm registry **before** anything matches against it. `broker_companies`
   is 131 rows of which **73 (56%) contain a `;`**, 28 are single-token abbreviations, 9 read as
   person names, 7 are the Colliers family. **`cbre; smyth & colliers; patel` is minted as one
   company.** Start with **`BR1-confirm`** — 12 brokerage-evidenced orgs ready for a one-decision
   human confirm.
2. **`PR2`** — why does one live producer return tax rows for 9,107 properties and parcel stats for
   **41**? The tax fetcher reaches 77%, so this is a *fetcher* question, not an acquisition one.
3. **`PR5`** — **39 of 67 registered ladder sources (58%) have never written a field.** Triage into
   build / rename / retire. ⚠️ Blocked on **`PR8`** first (see below).
4. **`PR8`** — `lcc_flush_provenance_events()` relabels any source off a 4-item allowlist to
   `domain_trigger`, **so PR5's count is an upper bound** and a source-name verification can read
   zero on a correct write.
5. **`DE3`/`DE4`**, **`B6e-worktree-gitlinks`**, **`B6e-clinic-metadata`**, **`D2`–`D5`**.

### 👤 Waiting on Scott

`B6e-ci-required-check` (Dialysis branch protection — until flipped the unmasked suite gates nothing) ·
`BR1-confirm` (12 brokerages) · `B6d-sam` (re-issue `SAM_API_KEY`, 401) · `PR1d` (`REGRID_API_KEY` —
a complete vendor client that has never run) · `I16b` (delete the dormant `life-command-center`
Railway service) · `B6e-fred-cm-exposure` (did a book go out after 2026-08-07?).

⏸️ **Deferred by decision, not dropped:** key rotation (`SEC2`–`SEC4`), until a second LCC user
exists. That trigger is enumerated in `docs/os/OPERATOR-ACTIONS.md` §1.

## 4. The turn protocol — do this every turn, without being asked

`docs/os/BUILD-TURN-PROTOCOL.md` is the definition of done. In practice, each turn:

1. **Read the response** in `docs/claude-code/responses/`.
2. **Verify its load-bearing claims live** against Supabase before recording them. ⚠️ **Several of
   this thread's biggest corrections came from re-measuring a claim that sounded right** — including
   two of my own that had already shipped into canonical pages.
3. **Update every affected doc in the same change**: `STATUS.md` (newest first),
   `PLANNED-BACKLOG.md`, `CURRENT-STATE.md`, `CLAUDE.md`, and the canonical topic page.
4. **Correct what is now false IN PLACE**, including your own prior claims, and say so plainly.
5. **Consolidate by topic** (§5).
6. **File the prompt and response to `done/`.**
7. **Hand Scott the git commands** (§6).
8. **Name the next step and draft its prompt.**

## 5. Consolidation rules — how the repo stays true

**The goal: any future chat can pick up a topic cold and be right, and no unbuilt plan is ever
lost.**

- **One canonical page per topic**, carrying live state, decisions already made, and traps already
  paid for. Current set: `producer-health-and-ci-enforcement.md` ·
  `public-records-source-lane.md` · `dialysis-economics-and-medicare-data.md` ·
  `broker-and-firm-identity.md` · `property-metadata-coverage.md` ·
  `data-coherence-invariants.md` · `ownership-history-lane.md` · `tier0-owner-contact-system.md` ·
  `bd-ranking-and-priority-queue.md`.
- **Audits stay as EVIDENCE for their date** and carry a banner pointing at the canonical page.
  **Where they disagree, the page wins**, and the audit gets a supersession note in the same change.
- **Never delete a plan. Extract it.** Before archiving anything, pull every unbuilt intention into
  `PLANNED-BACKLOG.md` with its provenance. 62 items were recovered this way that existed in no
  tracker.
- **A page that reaches a "don't build" verdict must carry its REFUTATIONS**, with reach numbers —
  or the next session re-proposes the same thing.
- **Record what is NOT a defect.** `dialysis-economics-and-medicare-data.md` and
  `broker-and-firm-identity.md` both lead with that section, specifically so understood behaviour
  stops being re-raised as a bug.
- **Archive `STATUS.md` when it passes ~8,000 lines** to `docs/history/STATUS_claude-code_<range>.md`,
  verbatim, with a pointer left behind. Last cut: 2026-08-20 → 08-21, on 2026-09-02.

## 6. GitHub sync — the exact sequence, every time

**Never run git from the sandbox.** Hand Scott copy/paste PowerShell:

```powershell
cd C:\Users\scott\life-command-center
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
git checkout main; git pull --rebase origin main; git status
git checkout -b docs/<topic-slug>
git add docs/ CLAUDE.md
git commit -m "<subject>

<body: what was measured, what was corrected, what was deliberately NOT done>

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: cowork-data-process-audit-<date>"
git push -u origin docs/<topic-slug>
```

- ⚠️ **`Remove-Item .git\index.lock` is not optional** — dropping it has cost this thread real time.
- ⚠️ **Verify `git status` after the rebase** before branching.
- **`main` is protected**: branch → PR → CI green → merge. A direct push is rejected.
- ⚠️ **Merged is not running; green is not enforced; a check that finished AFTER the merge is
  neither.** Five merge-before-CI instances were recorded in two days.

## 7. Traps this thread paid for — do not re-walk them

- **A detector that cannot fire returns a comfortable zero.** Positive-control every zero.
  `definition ILIKE '%confidence_tier%'` matches the SELECT projection, not a filter — it reported
  three views as careful that were not.
- **A roundness statistic that counts zeros.** `0 % 100000 = 0`. Exclude zeros and NULLs, and state
  the non-zero denominator.
- **Read what a producer's external call actually TALKS TO before trusting its name.**
  `*_enrichment` names an intent; two modules so named ask a model to *recall* facts.
- **A one-shot repair of a live producer is a chore repeated forever.** Ship the producer fix in the
  same change as the backfill.
- **Scope a SOURCE to what it populates, never to one consumer's gap list.**
- **A year-based guard and a quality-based guard are not substitutes.**
- **Isolation before traceback** — one `pytest <file>` per failing file separates harness pollution
  from product failures before any error text is read.
- **"Fails the job" ≠ "blocks the merge."** An unmasked step on a repo with no branch protection
  is a badge again. Read the workflow header and the PR merge timing, not the PR body.
- **A "within 0.3%" that four pages repeated did not reproduce (−4.90%).** A figure that sounds
  right and has been copied is not thereby measured — re-run it before it lands on a canonical page.
- **Grouping-for-review ≠ identity-for-write.** Never fuzzy-match a residue of abbreviations,
  surnames and co-listings.

## 8. Standing doctrine

Never fabricate — render "Not on file" / "Derived" / "Conflict". Supabase is reconcilable, never
automatic truth. Review existing machinery before building. Private corpora never egress to a cloud
model. Document at every step.
