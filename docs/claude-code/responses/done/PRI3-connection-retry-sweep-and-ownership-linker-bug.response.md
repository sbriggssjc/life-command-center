# PRI3-connection-retry-sweep-and-ownership-linker-bug — response (transcribed 2026-09-11)

> Recovered from Scott's own saved transcript (`PRi3 surface response.docx`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`.
> This session verified this against the transcript only — `Dialysis` is not reachable from this
> session (no credentials).** Overall this response is substantive and directly answers most of what
> the prompt asked, but it has real gaps flagged honestly below rather than assumed away — this arc's
> standing discipline is to never fabricate confidence the transcript doesn't support.

## Session framing (from the transcript itself)

The Dialysis-side session was instructed to develop on branch `claude/epic-archimedes-jpcknd` (create
locally from `origin/main` if it doesn't exist), never push directly to `main`, and — notably — **not to
create a pull request unless explicitly told to**. This explains why, unlike `PRI1` (which opened
`sbriggssjc/Dialysis#7404` proactively), this round did not open a PR on its own. The response closes
with: *"Got it — I'll reference PR #7406 for this branch going forward and treat further pushes to
`claude/epic-archimedes-jpcknd` as updates to it rather than creating a new PR."* **This confirms PR
#7406 exists and is the reference for this branch — it does NOT confirm PR #7406 is merged.**

## (a) `oig_leie_ingestor` — fixed

Reported fixed by routing the LEIE upsert batch call through `safe_execute()`, the same reused pattern
from `PRI1`. Listed among "(a)-(e), (g): fixed, each with before/after proof" — **but the actual
before/after proof text (the specific batch call and its before/after result) was not visible in the
paragraph-only text this session was able to extract from the .docx.** It may be present in a table or
other structure the extraction method didn't capture, or it may simply not have been included in as much
detail as the prompt asked for. Flagging this rather than asserting the proof was seen.

## (b) `ownership_linker` — all 9 sub-steps — fixed

Reported fixed across four separate edit passes to `ownership_linker.py`, covering Steps 1–5 and an
audit function (roughly +177/-105 lines across those passes; net diff for the file per the final file
list: +202/-105). Same before/after-proof caveat as (a) applies here too.

## (c) The `owners` `UnboundLocalError` — fixed, genuine code defect independent of the retry work

Confirmed as a real Python bug, not a connection error: a preceding step (`Assessed owner matching`)
failing before assigning `owners` left a later step (`Address matching`) referencing an unbound local
variable. Fixed by initializing/guarding the variable so a failure in the preceding step no longer
crashes the following one. This is the correct scope call flagged in the prompt itself — this bug would
still exist even after the connection-retry fix, if any other transient failure ever hit this same code
path.

## (d) `utils_shared`'s `pending_updates` fetch — fixed

Reported fixed via the same `safe_execute()` pattern. Same before/after-proof caveat as (a)/(b).

## (e) `ingestion_tracker`'s `start_run` — fixed, with a self-caught regression along the way

Fixed (+53/-31 in the final file list, described in the transcript as two edit passes: an initial change
of roughly +6/-2, but the file list's larger total suggests more work happened here than that one pass
covered — see the regression note below). **Self-reported regression, worth taking at face value since
it's an honest admission rather than a hidden gap**: moving the query construction outside
`safe_execute()` broke an existing test that used an incomplete stub client. Fixed by wrapping
construction and execution together in a lambda, restoring the original code's single try/except scope.
Confirmed via the full test suite after the fix.

## (f) The all-zeros run summary — resolved: two conflated but both-benign phenomena

Plain answer given: the "all zeros" summary and the "counters were not recorded" warning are **two
separate, both-benign things that looked like one alarming thing** in the original log excerpt — not one
mechanism silently hiding real data loss. (The transcript's exact mechanism-level explanation of what
the two separate causes are was not captured in more detail than this in what this session could extract
from the paragraph text — the conclusion itself, that they're conflated-but-benign, was clearly stated.)

## (g) `census_demographics` failure — partially resolved: vulnerability confirmed, this run's specific cause not

Confirmed `census_demographics_ingestor.py` is vulnerable to the same class of connection issue as the
other fixed call sites. **However, the specific cause of the failure in this particular run was not
determinable from the log excerpt available to that session** — stated plainly as unresolved rather than
assumed to be the same `ConnectionTerminated` pattern. This is a partial answer: vulnerability confirmed,
but this run's actual trigger remains unknown.

## (h) The actual crash trigger — investigated exhaustively, genuinely unresolved

Traced all 25 pipeline steps' individual try/except wrapping and the post-loop tail code. **Found no
unprotected code path that would explain an unhandled crash after the all-zeros summary print.**
Concluded the crash may be an OOM or other platform-level kill, consistent with a failure mode the
`Dialysis` repo's own documentation already describes elsewhere — but this is stated as a plausible
explanation, not a confirmed one. **This is the one item of the catalog that remains genuinely
unresolved** — correctly reported as such rather than guessed at.

## Section 2 — root cause of the connection drops: not determinable from this repo

Plain conclusion: **not determinable**. `requirements.txt` pins are all `>=` floors with no lockfile, so
the actual resolved httpx/supabase-py/postgrest-py/h2 versions running on Railway can't be audited from
the repo alone. Git history shows no deliberate recent version bump that would explain a new onset of
this behavior. No Dockerfile/nixpacks/Railway config is committed either, so a Railway-side network or
proxy change can't be checked from the repo. **Conclusion stated plainly**: the call-site-by-call-site
`safe_execute()` approach remains the practical path forward for now, absent a confirmed root cause.

## Test suite result

Full suite: **3183 passed, 7 skipped, 1 xfailed, 0 failed** — up from 3173 passing before this round's
changes (consistent with the new/expanded `test_pri3_connection_retry_sweep.py`, which the file list
shows at +406/-8, refined further in two more small passes of +8/-6 and +9/-2).

## Files changed (per the response's own file list)

- `oig_leie_ingestor.py` — +23/-6
- `ownership_linker.py` — +202/-105
- `utils_shared.py` — +39/-24
- `ingestion_tracker.py` — +53/-31
- `test_pri3_connection_retry_sweep.py` — +406/-8

**Plus a 6th changed file the transcript's "Show 1 more" collapsed control did not expand in what this
session could extract from the .docx — its name and diff size are unknown.** Flagging this explicitly
rather than guessing which file it might be; worth asking Scott or re-checking the PR diff directly once
its merge status is confirmed.

## Open items for the next round — do not assume resolved

1. **PR #7406's merge status is unconfirmed.** The transcript confirms the PR number and that the
   session will keep pushing to it, but never states it was merged. Scott's message ("This PR is
   merged...") most likely refers to the `life-command-center` documentation PR for this round, not
   necessarily the `Dialysis`-side code fix — this arc's standing discipline is to ask rather than
   assume, so this needs an explicit confirmation from Scott.
2. **The detailed before/after proof for (a), (b), (d), (e), (g)** — asserted as done, not independently
   visible in what this session could extract from the .docx. Worth a second look at the actual PR diff
   or a fuller re-read of the document once merge status is confirmed, in case it's present in a table
   this session's paragraph-only extraction missed.
3. **The unnamed 6th changed file.**
4. **(h), the actual crash trigger, remains genuinely unresolved** — flagged for awareness, not treated
   as a defect in this response; the session did the legwork and reported the honest limit of what it
   could determine.
