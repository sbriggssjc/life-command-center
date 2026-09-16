# Claude Code queue — STATUS

<!-- =====================================================================     CONVENTION — READ BEFORE PREPENDING AN ENTRY.
     This file is newest-first. New entries go DIRECTLY BELOW the Open-threads
     table's `---` that follows this block — NOT directly below this block, and
     never above it. (Prepending right below this block is what buried the
     Open-threads table 1,741 lines deep by 2026-09-14: this comment and the
     table's own header gave contradictory instructions, and the guard that
     would have caught it was never merged. See test/status-line-budget.test.mjs.) The `# Claude Code queue — STATUS` H1 above must remain line 1.
     This is enforced by test/status-header-integrity.test.mjs — CI fails if the
     H1 moves off line 1 or a second copy appears. Five sessions on 2026-09-12
     buried it (lines 25, 29, 57, 83, 212) before the guard existed.
     Line budget: 3,000 (test/status-line-budget.test.mjs), with a soft warning at 80%. When you approach it,
     archive BEFORE you push, not when CI fails. ⚠️ This file grows on YOUR
     branch AND on main at the same time, so a branch that passes locally can go
     over the budget the moment main is merged in — it has happened twice
     (PR #2383, and the REPO1 sweep at 2,503). Leave 200+ lines of headroom, and
     keep entries tight: the findings belong in PLANNED-BACKLOG.md, which is the
     canonical open-work list; STATUS.md is the narrative, not a second copy.
     move the OLDEST contiguous span verbatim to docs/history/ and extend the
     archive pointer — never reword or drop an entry to make room.
     ============================================================================ -->

## Open threads (updated 2026-09-12 — table moved to the TOP of this file by Cowork; new entries go BELOW the `---`)

One-line read on each active multi-round thread. Full narrative for anything older than this file's
current window lives in `docs/history/STATUS_claude-code_*.md`; durable state lives in
`docs/os/PLANNED-BACKLOG.md` and `docs/os/CURRENT-STATE.md`.

| thread | backlog rows | last entry | state (one line) |
|---|---|---|---|
| **Identity / operator canonicalization (ID-series)** | ID0–ID4, ID2a-cleanup, ID2b, ID2b-caps, ID2b-caps-2, ID3a–ID3e, ID3a-d | 2026-09-12 | ID2b-caps-2 shipped + live-verified (3rd comp source fixed at source); ID3a-d retired LCC's stale gov migration copy; ID2b's remaining 45 views/12 modules still group on operator text |
| **Market briefs (MB/EB)** | MB1d, MB2a, MB3, MB4, MB5, MB6, MB7, EB1b, P18 | 2026-09-12 | **LIVE**: `MARKET_BRIEF_PSQL` + `MARKET_BRIEF_RENDER` on; the daily email carries the Lane Briefs block (cap-rate bands, on-market, honest CMS staleness gaps, link to `#/briefs/dialysis`), the tab serves live facts, first `market_brief_issues` row frozen. Next: MB2a (the 3 new dialysis RSS URLs all fail 403/404), MB5 P-WEB (blocked on EB1b Anthropic credit), MB6 weekly long-form, MB7 MCP recall |
| **Operator funnel (OC / HP1)** | HP1, HP1-P1a, HP1-P1a-fix, HP1-P1a-dup | 2026-09-12 | HP1-P1a-fix CLOSED live (608 rows UPDATED, first-ever Salesforce UPDATE to `bd_opportunities`); HP1 P0 (Today 500 badge) fixed+deployed+verified |
| **Ownership (OWN/RO)** | OWN-T0a–T0j, RO3, B1b, AC2/AC3/AC6–AC11 | 2026-09-12 | OWN-T0j verified end-to-end live; RO3 field-mapping design drafted; OWN-T0a/B1b/AC-series propagation work still open |
| **CoStar sidebar / public records (PR5/PRI)** | PR5d, PR-scanner-3, PRI2–PRI6, HCRIS-TIMEOUT, HCRIS-TRACKER-BLIND, HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN | 2026-09-16 | PR-scanner-3 shipped (`county_records_needed` action); `PRI6` closed ✅ 2026-09-14, both sides confirmed merged — checking on it live is what surfaced `HCRIS-TIMEOUT` (a separate, months-old defect, not a `PRI6` regression). `HCRIS-TIMEOUT` is now **five rounds deep**: root cause isolated 2026-09-16 (`HCRIS-TIMEOUT-4`, two structural bugs, neither HCRIS-specific), both **fixed and pushed same day** (`HCRIS-TIMEOUT-5`, `Dialysis` PR #7413, commit `226f7e3` — merge status unconfirmed, asked Scott directly, same recurring ambiguity as `PRI6`/`HCRIS-TIMEOUT-3`). **No live proof yet either way** — re-checked live: as of 14:05 UTC no run has started since the same pre-fix run this session already knew about, so even a merged+deployed fix has nothing to prove itself against yet. `HCRIS-TIMEOUT` stays 🔴. One flagged, unbuilt follow-up still queued: `qip_scores_ingestor.py`/`cms_deficiency_ingestor.py` share HCRIS's old bare-timeout bug, still correctly out of scope until the pipeline actually reaches that far. |
| **C2g / sponsor↔SPE gate (C2k)** | C2g, C2h, C2i, C2k | 2026-09-16 | **C2k decided: attested-only widening**, prompted; gov exposes `true_owner_attested` first, then LCC widens the gate for attested rows only (≈858), ledgered + reversible |
| **Deed / owner-conflict (DEED/GOVDEED)** | DEED1, DEED1-emptycompare, DEED2, GOVDEED1–5, GOVDEED5b, GOVDEED-478, DEED-DIA-LATENT | 2026-09-16 | **Arc complete through GOVDEED5b** (gov PRs #400–#405, all live; `latest_deed_*` deed-only, one writer); open: GOVDEED3 (accept gate, prompted), sale-party conflicts 1,290 are a review queue; dia clean |
| **CoStar sidebar / public records (PR5/PRI)** | PR5d, PR-scanner-3, PRI2–PRI6, HCRIS-TIMEOUT, HCRIS-TRACKER-BLIND, HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN | 2026-09-15 | PR-scanner-3 shipped (`county_records_needed` action); `PRI6` (the connection-retry/ingestion-lock reliability sweep that started with `PRI1`'s dropped-connection crash) closed ✅ 2026-09-14, both sides confirmed merged — checking on it live is what surfaced `HCRIS-TIMEOUT` (a separate, months-old defect, not a `PRI6` regression). `HCRIS-TIMEOUT` is now three rounds deep: the original fix was correct, the real blocker was the tracker/heartbeat mechanism itself being blind (`HCRIS-TRACKER-BLIND`, fixed same round) — **awaiting live proof from a run Scott triggered 2026-09-15 (post-PR-#7411)**. One flagged, unbuilt follow-up already identified for whenever this closes: `qip_scores_ingestor.py`/`cms_deficiency_ingestor.py` share HCRIS's old bare-timeout bug. |
| **C2g / sponsor↔SPE gate (C2k)** | C2g, C2h, C2i, C2k | 2026-09-16 | **C2k LIVE** (LCC PR #2506): 218 attested supersessions, 40/43 pairs to sponsor, 16/16 controls untouched, reversible; sponsor-as-edge = future work |
| **Deed / owner-conflict (DEED/GOVDEED)** | DEED1, DEED1-emptycompare, DEED2, GOVDEED1–5, GOVDEED5b, GOVDEED-478, DEED-DIA-LATENT | 2026-09-16 | **Arc complete through GOVDEED5b** (gov PRs #400–#405, all live; `latest_deed_*` deed-only, one writer); open: GOVDEED3 (accept gate, prompted), sale-party conflicts 1,290 are a review queue; dia clean |
| **Research lanes / owner gap (C1B/C1C/OWNERGAP)** | C1B-GOV-GATE, C1C-SPLIT, OWNERGAP1, OWNERGAP2, MCP1 | 2026-09-16 | **OWNERGAP2 applied — 20 Philadelphia owners live from public record** (5,494 with owner), ledgered; Harris needs an HCAD payload; MCP1 blocks the context gate; 1,346 `owner_needs_sos` still the feed |
| **App feedback intake (SBN)** | FLOWS1, HOME1, PRI1, DIA1 | 2026-09-16 | Intake protocol live (`SB notes/README.md` + `TRIAGE.md`); first pass: 8 rows → 4 prompts; FLOWS1 also needs one failed-run screenshot per flow from Scott |
| **Process / consolidation (CONSOLIDATE, INVENTORY)** | CONSOLIDATE1–4, INVENTORY1, REPO1 | 2026-09-16 | CLAUDE.md pass 1 done (3,268 lines); **INVENTORY1** prompted — the full plan-vs-built gap map; pass 2 of CLAUDE.md waits on Scott |
| **App / UX** | ASC50, HP1, UX-T1a | 2026-09-12 | ASC50 governed review workbench built + locally verified, publication pending |
| **Buyer engagement (BUY0)** | BUY0, BUY1a/1b, BUY-G1–G6 | 2026-09-11 | Phase 0 complete for Geller Round 1 (client deliverable + email draft shipped); build handoff written, BUY1a/1b + BUY-G1..G6 filed as next steps |
| **Broker identity (BR) / BROKER1** | BR1, BR2, BROKER1, BROKER1-sf | 2026-09-11 | BROKER1 prospect-assignment applied live (1,303 assigned) with a real bug found+fixed in production; BROKER1-sf (Salesforce write-back) correctly left unbuilt — no write path exists |
| **gov agency canonicalization (ID3a\*)** | ID3a, ID3a-b, ID3a-c, ID3a-d, ID3e, I14, I16 | 2026-09-12 | ID3a-b/c/d/e all shipped and live-verified; repo-ownership hazard (I16) found and closed — `government-lease` owns the gov DB's migrations, LCC's copy retired |
| **CI / producer health (B6d/B6e)** | B6d-cms-*, B6d-assessor-*, B6d-pri-*, B6e-ci-*, B6e-fred-* | archived 2026-09-11 | Suite is a real merge gate (`Run Tests` unmasked, green once on `main`); `pip-audit`/secrets-grep/ruff still masked; full detail in the 2026-08-29→09-11 archive and `docs/architecture/producer-health-and-ci-enforcement.md` |

> **📦 ARCHIVE (2026-09-08):** entries for **2026-08-31 → 2026-09-01** (the CMS-ingestion restart,
> DOC1–DOC18 document pipeline, C13/C14 entity-role work, and the trailing pointers for two earlier
> cuts) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-31_to_2026-09-01.md`](../history/STATUS_claude-code_2026-08-31_to_2026-09-01.md).
> Nothing was dropped; every still-open item was already in `PLANNED-BACKLOG.md` and the canonical pages.

---

## 2026-09-16 — OWNERGAP2 applied: the first 20 owners in the arc; CLAUDE.md pass-1 cut; INVENTORY1 and MCP1 drafted (Cowork)

**OWNERGAP2 ✅ applied (Philadelphia).** After Scott's Railway redeploy (`/version` = `0235c31a` = main)
I ran the dry run against the deployed route — through pg_net with the vault key, so the key never
entered this chat — and got the build's exact numbers: 26 → 20 resolved / 6 refused. Scott chose apply.
Batch `ownergap2_philadelphia_pa_20260916` wrote 20: properties with an owner **5,474 → 5,494**,
`recorded_owners` +17 (three owners span two addresses), ledger 26 rows, every new row's `source`
citing its OPA record id, PA `true_owner_id` fingerprint unchanged. **Twenty of the 4,021 now have an
owner from a public record**, and the method is proven; Harris needs an operator-supplied HCAD payload.
Gate #6 failed for a reason that is its own finding → **MCP1**: `get_property_context` cannot see a dia
property that is not among the 1,784 minted LCC assets, and its address path throws
`(rows \|\| []).filter is not a function`.

**CLAUDE.md pass 1 (CONSOLIDATE4).** 5,503 → **3,268** lines. The 34 dated round narratives (Aug 14 –
Sep 2) went verbatim to `docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md`; an index of their
titles (each title is its lesson) stands where they were, and the header says so. Every rule,
doctrine, footgun and invariant stayed. Pass 2 — condensing the doctrines and footguns themselves —
waits for Scott, section by section.

**INVENTORY1 drafted.** Scott's ask: every plan, design and discussion ever, against what is actually
built and running, to find what is slipping through the cracks and aim the next rounds. The prompt is
read-only, extracts intent from every source including the loose `.docx` reports, measures state
rather than reading it, and ends with the process change per leak class.

---

## 2026-09-16 — GOVDEED5b + OWNERGAP2 reconciled; the SB-notes intake exists now, and its first pass produced four app prompts (Cowork)

**GOVDEED5b ✅ live** (gov PR #405): the three sale propagators re-pointed to `latest_transfer_*`;
`pg_proc` writers of `latest_deed_date` 4 → **1**; `latest_deed_date` 3,340 → **43** and holding after a
hand-run of the 03:30 cron and a trigger fire in rolled-back transactions. Re-measured here: 43 / 43 /
1 writer. GOVDEED2 → 4 → 478 → 5 → 5b is the whole deed arc, and it is done except GOVDEED3 (the
accept gate) and the Python writer's deployed state, which the round scoped out and said so.

**OWNERGAP2 🟡 merged, not run** (LCC PR #2508): Philadelphia 20/26 live, Harris payload-only (HCAD is
bot-walled — the prompt's rule, honoured), guard intact and refusing a real `ABC INC`. Nothing applied
by design. The next step is an operator sequence: redeploy both Railway services, confirm `/version`,
dry-run tick, review, apply, and then the number the whole arc exists for — how many of the 4,021.

**SB notes — the intake.** Scott's new folder (`docs/claude-code/SB notes/`) holds what he notices in
the app. It now has a protocol (`README.md`), a ledger (`TRIAGE.md`, `SBN-n`), a line in
`BUILD-TURN-PROTOCOL.md` §④, and `docs/claude-code/README.md` was rewritten — it still described
`NN-slug.response.md` files and a dossier-era trail doc nobody uses; that was the exact misdirection a
future chat would have walked into. First pass, two files → **8 rows, 4 prompts**: **FLOWS1** (eight PA
flows failed in a week, Get Artifact 709×; the LCC side first, Scott supplies one failed-run screenshot
per flow), **HOME1** (the gaps list is 9/10 agency-drift cleaning — ID3a's class — and one real human row;
Home mirrors Priority; a DaVita deal under *Government highlights* is a lane-key bug to fix), **PRI1**
(P-bands → one ranked human-only list; spec + label change only), **DIA1** (six action items graded
human/code/noise; the Market Economics Exhibit button fails silently at `dialysis.js:1744`; tiles are
stale by 22 rows and one counts a different thing: 45 "operators" vs 21 distinct `operator_id`).

Every screenshot number was checked against the database before it became a row.

---

## 2026-09-16 — `HCRIS-TIMEOUT-5`: both structural bugs fixed and pushed same day; no live proof possible yet, and PR merge status needs Scott's confirmation

Fifth round, first fix round since `HCRIS-TIMEOUT-4` isolated the two structural bugs. CC fixed both same day:

- **Discarded run id**: `start_run()` now builds an actual query-builder object and passes it (with
  `return_representation=True`) into `safe_execute()`, instead of a bare lambda with `.execute()` already
  baked in — the fix the prior round called for. All named call sites (`main.py:3177`, `run_cms_ingestion.py:
  852/1786/1833`, `acquire_ingestion_lock()`) route through `start_run()` directly, so **one fix repairs all
  of them**, confirming the "fix once, fixes everywhere" framing from the `-5` prompt.
- **Swallowed timeout**: CC reports the loop-vs-hang question this round was specifically asked to resolve
  **couldn't be settled from the error-log evidence alone** (the ledger only flushes between steps, not
  per-row) — disclosed plainly rather than guessed. Found independent structural evidence instead: `aux_cms_
  tables`'s direct `psycopg` calls carry no `statement_timeout`/keepalive tuning (every other DB call in the
  codebase does), and `SIGALRM` can't interrupt a blocked native socket read. Fixed both angles: `TimeoutError`
  now re-raised before the per-row `except Exception:`, plus a 60s statement timeout + keepalives on the
  direct connections.

10 new regression tests, full suite 3,280 passed / 1 pre-existing unrelated failure (confirmed by CC to also
fail on unmodified `main`). **Live verification explicitly not attempted** — no DB credentials/egress from
that sandbox, disclosed rather than claimed. Pushed to `claude/compassionate-hamilton-geof1p`, commit
`226f7e3`, **`Dialysis` PR #7413 opened**.

**This session independently re-checked live state and it confirms CC's own disclosed gap, not a new
problem**: as of DB time 2026-09-16 14:05:49 UTC, the most recent `ingestion_tracker` rows are still the same
pre-fix run 2 (`1fb8af07…`/`64e34e14…`, started 06:03:13/06:03:24 UTC, still `run_status='started'`, ~8 hours
in) — **no new run has started since**, so there's nothing yet that could prove the fix either way, merged or
not. Scott's message said "this PR is merged" without naming which — the `life-command-center` docs PR
(`docs/hcris-timeout-4-5-triage-and-fix-prompt`, #2509) is already confirmed merged (this session re-synced to
it), but whether `Dialysis` PR #7413 is *also* merged and redeployed is unconfirmed. **Asked Scott directly**
— same recurring ambiguity this arc has hit before (`PRI6`, `HCRIS-TIMEOUT-3`).

`HCRIS-TIMEOUT` stays 🔴 either way — not yet proven live. Full writeup:
`docs/claude-code/responses/done/HCRIS-TIMEOUT-5-fix-the-two-structural-bugs-start-run-header-and-aux-cms-timeout-swallow.response.md`.

## 2026-09-16 — `HCRIS-TIMEOUT-4`: root cause finally isolated — two structural bugs, neither one HCRIS-specific, and this round deliberately did not fix them

Fourth round on this defect, and the first one framed as triage rather than another single-hypothesis fix —
after three rounds each independently correct on their own terms (PR #7410 fixed a real timeout bug,
`HCRIS-TIMEOUT-3`/PR #7411 fixed a real tracker-blindness bug) with the symptom unmoved, this round asked CC to
step back rather than extend the pattern a fourth time. **This session independently re-verified every
load-bearing claim live against Dialysis_DB before filing it** — most held up exactly as described; one
needed a real correction, noted below.

**Bottom line CC reported, verified true**: HCRIS was never the step hanging. Two independent bugs compound:

1. **`ingestion_tracker.start_run()` silently discards its own run id on every call.** `get_supabase_client()`
   sets a client-wide default `Prefer: return=minimal` header; `safe_execute()` only overrides it to
   `return=representation` when handed a live query-builder object, not a pre-built `.execute()` closure.
   `start_run()` passes a bare lambda, so a genuinely successful insert (HTTP 201) comes back with an empty
   body and reads as a failure — `_CURRENT_RUN_ID` is `None` for the entire life of every run, which is why
   `HCRIS-TIMEOUT-3`'s heartbeat/notes instrumentation could never write anything no matter how many retries
   it got. **Same call, same bug, also used by `acquire_ingestion_lock()`** — this is why the ingestion-lock
   rows have been orphaned every run, a repo-wide defect (4+ more `start_run()` call sites named, not
   individually traced) rather than anything CMS/HCRIS-specific.
2. **`aux_cms_tables` (step 3 of ~15, several steps before `hcris_cost_reports` at step ~8) swallows its own
   900-second `SIGALRM` step-timeout inside a per-row `except Exception:`**, so the pipeline never advances
   past it and never reaches HCRIS at all. `facility_cost_reports` freezing at 2026-03-16 is a direct,
   mechanical consequence of the run never getting there — not a separate HCRIS-side defect.

**Independently confirmed live, exactly as claimed**: `ingestion_tracker.notes='{}'` on every relevant row back
to 2026-09-10 (the last populated `notes` on record for this dataset is 2026-08-31, well before this whole
arc started); zero `ingestion_run_errors` rows with `table_name='ingestion_tracker'`; the `aux_cms_tables`
900s timeout firing exactly on schedule (17:52:36 UTC, ~15 min after run 1's 17:37:29 start); `facility_cost_
reports` still frozen at exactly 2026-03-16 15:35:48; both orphaned lock rows present with the described
timestamps.

**One correction filed**: CC's response describes "a massive, continuous stream of errors ... for the entire
observed [12.7-hour] lifetime," ~17,753 total. Checked by the minute — that's actually **two separate
15-minute startup bursts** (run 1's own, 17:37–17:52, ~8,877 errors, ending exactly when its own timeout
fired; run 2's own startup burst the next morning, 06:03–06:18, ~8,876 errors) with **zero errors of any kind
in the ~12h09m between them**. Total silence, not continuous activity — the same burst-then-silence shape
every prior round already found, not new behavior. This matters for the fix: a per-row loop that's genuinely
"still going, just not hitting these particular tables" would look different from a process that's actually
hung/deadlocked after the swallowed signal. CC's fix-round instruction now includes confirming which one it
actually is, not assuming "keeps looping obliviously" the way this round's prose implied.

**No fix attempted this round** — correctly, per the prompt's explicit instruction not to make a fifth narrow
patch before full triage. `HCRIS-TIMEOUT` stays 🔴. **Next step**: a dedicated fix round for both structural
bugs, plus resolving the loop-vs-hang question above. Full writeup:
`docs/claude-code/responses/done/HCRIS-TIMEOUT-4-full-triage-run-log-still-silent-after-the-fix-built-to-fix-it.response.md`.

## 2026-09-16 — `HCRIS-TIMEOUT` live-monitored across two full run cycles post-fix: same failure shape both times, and a new, more basic problem found — `run_log` has written nothing at all in 28 hours

Watched the post-`HCRIS-TIMEOUT-3`/`PR #7411` run live rather than waiting for another log upload. Two
full cycles have now completed since the fix merged, and neither tells a different story than before.

**Run 1** (`593e1e75…`, started 2026-09-15 17:37:36 UTC): ran until it was reclaimed as `abandoned` at
2026-09-16 06:02:56 — **~12h25m**, well past the 90-minute budget. **Run 2** (`64e34e14…`, started
2026-09-16 06:03:24 UTC, the daily scheduled run) was still live as of this check, ~5h17m in, `properties`
being written to seconds before the query ran. Both runs show the **identical error-burst-then-silence
shape**: ~8,880 `ingestion_run_errors` in the first ~15 minutes (unrelated `medicare_ingestion` writes), then
total silence. `facility_cost_reports` remains frozen at 2026-03-16 through both cycles, and
`public_data_snapshots` still has zero HCRIS rows, ever.

**The new finding, more basic than HCRIS itself: `run_log` has not received a single write since
2026-09-15 07:33:40 UTC — 28 hours and two full run cycles ago.** That's the run that predates the fix
entirely. Neither of the two post-fix runs logged anything — not a startup summary, not a step heartbeat,
not the `step_errors` map `HCRIS-TIMEOUT-3` added specifically so this wouldn't require another manual
cross-check. **`ingestion_tracker.notes` is also still blank (`'{}'`) on both runs, including the one that's
now fully closed out** (`593e1e75…`, `run_status='abandoned'`, `finished_at` populated) — a finished, closed
run with populated `notes` is exactly the case `HCRIS-TIMEOUT-3`'s fix was built to handle, and it didn't.

**This points back at the same open question `HCRIS-TIMEOUT-2` raised and never got a direct answer to:
is the Railway service genuinely running the merged commit (`651c630`)?** Two consecutive runs producing
zero diagnostic output despite a fix specifically designed to produce that output is hard to explain any
other way. Not re-diagnosing the fix's logic again without that answer first — same discipline as before.
`HCRIS-TIMEOUT` stays 🔴. Nothing filed as a new backlog row yet — this is additional evidence on the
existing `HCRIS-TIMEOUT` row, not a new defect.
## 2026-09-16 — OWNERGAP2: the first BUILD in the owner arc; verified against the live Philadelphia API; nothing applied (Claude Code)

Two adapters, as scoped. Built, tested, migration applied live, **zero owner rows written anywhere.**

**Verified against the real API, not only against tests.** The sandbox has no direct egress to
`phl.carto.com` (proxy 403), so the production matcher was run over the production query's real
responses fetched through `pg_net` from Dialysis_DB, across the WHOLE Philadelphia population:
**20 of 26 resolved = 76.9%**, above the 68% §8 measured by hand. 19 of the 25 that fired, plus
property 36738 (a duplicate address of 28606, which resolved). Recovered owners include
UNIV CITY ASSOCIATES (OPA 882000790), EPISCOPAL HOSPITAL (777012002), 3020 MARKET OPERATING LP,
PHILA SUBURBAN, RS REALTY PARTNERS L P. **Three refusals were correct** — `3300 Henry Ave` carries
5 distinct owning LPs, and two Walnut St properties sit inside a range holding 3–4 owners.

⚠️ **THE PRESCRIBED FIX WAS INSUFFICIENT AND THE MEASUREMENT IS WHAT SHOWED IT.** §8 said the
Philadelphia misses were *"fixed by prefix matching"*; implemented, **prefix-only resolves 16 of
26**. It cannot see a range **containment** row (`3823 Market St` ⊂ `3817-39 MARKET ST`). Prefix +
containment + **odd/even parity** gives 20 — and parity is load-bearing, not tidiness: `3823` falls
inside both `3817-39` (odd) and `3816-40` (even), so without it the property returns two owners and
a **FALSE `needs_parcel_discriminator`, which reads exactly like the safety rule working.**

⚠️ **A leading directional was being eaten by the house-number regex, costing 5 of 26 as silent
"no record".** `^(\d+)\s*(?:-\s*\d+)?\s*([A-Z])?\b` captured the `E` of `100 E. Lehigh Ave`
as a sub-parcel letter, leaving street `LEHIGH AVE`. No error, no null — the instrument answered
confidently. Fixed by requiring the letter be attached (`2910R`) and exempting directionals.

⚠️ **THE FIRST QUERY WOULD HAVE SHIPPED A SILENT TRUNCATION.** It fetched the whole street at
`LIMIT 100`; MARKET ST holds **1,218** parcels and WALNUT ST **1,923**. It survived a first
verification only because that run happened to narrow to `38%MARKET ST`. Shipped: a numeric band on
the house number, `ORDER BY … DESC` so the containing range is reachable, and an explicit
`truncated` flag → `source_response_truncated`. Four live requests hit the 250 cap; all four still
resolved.

**Harris is `fetches: false`, decided by measurement per §2 of the prompt.** Probed live via
`pg_net`: `search.hcad.org` → **403 Cloudflare managed challenge**, `hcad.org` → **521**,
`public.hcad.org/records/quicksearch.asp` → **404**, `download.hcad.org` → 200 but a shell page
with no file index. No reachable free API or enumerable bulk path, and §6 forbids automating a
bot-protected portal. Harris therefore ships as a **parser + `Personal`/`Commercial` account-type
discriminator over an operator-supplied payload** — never a fetcher. §9's 86% stands as a rate; it
was never evidence the fetch is automatable.

⚠️ **THE CITY OF PHILADELPHIA RECORDS `ABC INC` AS A REAL OWNER, AND THE OWNERGAP1 GUARD FLAGS
IT.** `dia_is_fabricated_placeholder_owner('ABC INC')` → true. **The guard was NOT weakened** — one
real name is worth less than the containment. The writer pre-checks and refuses with
`blocked_by_fabrication_guard`, keeping the name and its citation in the ledger, surfaced on
`v_dia_ownergap2_fabrication_guard_collisions`. Guard positive-controlled both directions the same
day: `XYZ Dialysis Centers LLC`/`unknown` → true; `UNIV CITY ASSOCIATES`/`RALSTON MERCY-DOUGLASS
HO` → false.

⚠️ **`county ilike '%harris%'` RETURNS 52 AND TWO ARE HARRISON COUNTY** (Marshall, TX — a different
appraisal district ~200 miles away). Harris proper is **50**, matching §9. The adapter keys on
equality and a guard pins it.

**Provenance is CHECK-enforced, and the constraints were positive-controlled in both directions.**
`chk_ownergap2_resolved_must_cite` refused all four malformed shapes (no citation / empty
`source_record_ids` / no `source_query` / unresolved with no cause) and **accepted** both
well-formed shapes, inside a self-rolling-back transaction — **0 residue** afterwards. A constraint
that only ever refuses is indistinguishable from a broken one.

👤 **NOTHING IS APPLIED, AND THAT IS THE STATE TO CARRY.** GET is a dry run; no POST was issued.
Measured at close: `dia_ownergap2_resolution_log` **0 rows** · `recorded_owners` **7,585, 0 of them
`ownergap2*`-sourced** · properties with a `recorded_owner_id` **5,473** · `true_owner_id`
untouched (10,308). The JS half needs the Railway redeploy before the tick exists in production
(the migration shipped instantly — the documented half-applied-deploy split).

⚠️ **Population drift, stated not reconciled:** owner-unknown is **4,014** (OWNERGAP1 said 4,021),
`recorded_owners` **7,585** (said 7,487), owned properties **5,473** (said 5,467).

Files: `api/_shared/ownergap2-{address-match,sources,owner-writeback}.js`,
`api/_handlers/ownergap2-owner-resolve-tick.js`, migration
`supabase/migrations/dialysis/20261010120000_dia_ownergap2_owner_resolution_ledger.sql` (applied
live), fixtures `test/fixtures/ownergap2-live-samples.json`, guard
`test/ownergap2-owner-resolution.test.mjs` (**55 tests, 33 mutations verified RED**). Audit §10;
backlog `OWNERGAP2`, `OWNERGAP1-decision`.

---


## 2026-09-16 — All four rounds landed; C1C closed on both arms; GOVDEED5 was undone by a nightly cron twenty minutes after it applied (Cowork)

Reconciled the four responses against live state on both databases.

**C1B-GOV-GATE ✅** (gov PR #403): SF arm sealed (0 passing), SOS unsealed (2,019). `v_ownership_gaps`
had no committed source anywhere before this — it was live-only. Then ran **C1C's gov arm** here:
dry run 1,851 / real run `c1c-gov-20260916` **1,851 retired**; watch view `{dia 839, gov 1851}`;
the SF lane is gone from the lane summary. C1C is closed. Consequence to carry: LCC now holds
**1,346 open `owner_needs_sos`** tasks and nothing consumes them — OWNERGAP2 is next, not someday.

**GOVDEED-478 ✅** (gov PR #402): 4,995 deed rows marked `rejected_placeholder` (kept, not deleted);
290 grantees cleared, 91 grantee+price, 97 held because a sale corroborates them; conflicts
899 → 518 at the time.

**C2k ✅** (gov attestation 856 → LCC PR #2506): 234 eligible (13 fill / 221 supersede), 218
superseded, 40/43 A-class pairs to the sponsor (the other 3 were already there), 16/16 controls
untouched, unsupersede round-trips 218/218. CI caught `lcc_c2k_unsupersede` created with the default
anon grant — a function that rewrites ownership, callable unauthenticated — fixed before merge.
That is the SEC1 test doing exactly its job.

**GOVDEED5 🟡** (gov PR #404): the split landed and reported 43/43 truthfully — at 03:09 UTC. At
03:30 the `gov-propagate-recompute-tick` cron ran `propagate_sales_recompute`, whose candidate
predicate treats a NULL `latest_deed_date` as 1900 and whose write is `latest_deed_date =
sale_date`: **3,310** properties got a sale date back by 03:35. `pg_proc` has **six** writers; the
round inventoried the `sql/` tree and found three. Two more are triggers on the sales tables. Live
now: 3,340 / 2,743 / conflicts 1,295. → **GOVDEED5b** handoff written. Same class as C1B-GOV-GATE:
the live catalog, not the repo, is the inventory.

Queue: four prompts + responses to `done/`; GOVDEED5b in `prompts/`.

---

## 2026-09-16 — Four open decisions walked through and closed; four prompts written (Cowork)

Scott took each with the same shape — the recommended option, the measured alternative, the cost —
and chose the recommended one on all four. Every choice is the "Not on file over a plausible value"
rule applied to a different column.

**GOVDEED5 → split by source** (👤 gov). `latest_deed_date` was three writers deep and 94% sale dates;
`latest_deed_grantee` is set on 5,787 properties, 5,744 without a dated deed behind them. New
`latest_transfer_{date,party,source,ref}` backfilled from evidence with the source written beside it;
`latest_deed_*` become deed-only (≈43); the 75 untraceable go to NULL, snapshotted; every writer
must be able to clear (GOVDEED4 needed a hand-run clear because none can).

**C2k → attested-only widening** (gov step 1, then LCC). The domain `true_owner` may supersede a
lower-tier resolution only where an SOS/SAM manager on the SPE names it (≈858 gov); unattested rows
stay gap-fill. Ledgered, reversible, dry run with a 20-row hand read, and the 16 no-evidence C2g pairs
are the positive control that nothing unattested moved. Full lift (1,036 at once) and sponsor-as-edge
were not chosen; the latter is noted as future work.

**C1B-GOV-GATE → seal SF, unseal SOS** (👤 gov). Re-measured: `owner_needs_salesforce` 1,838 passing,
`owner_needs_sos` sealed — still the wrong arm a week on. The test must read which arm carries the
marker. Once live, C1C's gov arm runs (≈1,851, dry run first).

**GOVDEED-478 → exclude placeholder deeds + clear the planted grantee** (👤 gov). Conflicts today: 899 =
478 dateless (all from the 4,995 no-date/no-instrument rows) + 405 sale-backed (real, must stay) +
16 other. Mark rejected, don't delete (GOVDEED3 still reads them); view and propagators ignore them;
grantee NULLed only where it traces solely to a rejected row.

Queue: four prompts in `prompts/` — three gov handoffs, one LCC build with a gov precondition.
Nothing applied.

---

## 2026-09-16 — GOVDEED4 applied live: 676 dates demoted, 147 properties reconciled (12 repointed, 135 cleared), and `latest_deed_date` turns out to have three writers (Cowork)

Gov PR #401 merged; read the migration first. Confirmed what the response left unsaid: it never
touches `properties`, and `propagate_deed_to_property` only ever SETs. Measured before applying:
**147** properties (⚠️ not 493 — that earlier figure counted join rows, not distinct properties;
corrected in the backlog and the entry below) carried a `latest_deed_date` from a soon-to-be-demoted
deed; 12 had another real dated deed to fall back to, 135 did not. Scott chose apply + clear.

Applied `20260916_gov_govdeed4_low_confidence_date_guard` to `scknotsqkcheojiaewwh`: **168 dated /
676 approx / 676 in the snapshot**, 0 `low` rows still dated, remaining dated by confidence
∅ 145 · medium 21 · high 2 — exactly the migration's own expected numbers. Then, ledgered in
`_gov_govdeed4_cleared_properties_20260916` (147 rows, prior date + grantee, `outcome`): ran
`propagate_deed_to_property` → `latest_deed_set = 12` (the predicted 12), then NULLed
`latest_deed_date` + `latest_deed_grantee` on the properties still pointing at a demoted deed with no
surviving dated source → **135 cleared**. Ledger reads `{cleared: 135, repointed: 12}`.
`properties.latest_deed_date = '2023-10-01'` went 130 → **5** (those 5 come from `sales_transactions`,
not deeds — see below). 17 `ownership_history` rows still carry a demoted deed's date; left as-is for the
GOVDEED-478 disposition, as the handoff said.

⭐ Side-finding while verifying: of **2,401** properties with a `latest_deed_date`, only **43** trace to
a bridged dated deed. **2,263** match `sales_transactions.sale_date` — written by the intel sweep
(`20260508_gov_intel_sweep_tier3c_and_true_owner.sql` l.191, `latest_deed_date = l.sale_date`) —
and a third writer, `sync_properties_from_sources.py` l.1723, also SETs from deeds. The column is
mostly a sale date wearing a deed name; **75** values trace to nothing at all. Not this defect (a
CoStar sale month is a different convention from a model guess), but it belongs in the backlog as
**GOVDEED5** before anyone reads `latest_deed_date` as "there is a deed." Nothing else changed.

---

## 2026-09-16 — GOVDEED4 reconciled: built in gov (PR #401), migration NOT yet applied; two deviations from the handoff, one of them a disposition decision (Cowork)

The round (gov branch `claude/modest-wozniak-kyexxl`, commit `ce1d5bc`, tracking **PR #401**, not merged)
did the four steps: `deed_records.recording_date_approx` + a real `date_confidence` column;
`save_deed_record` demotes the date into the approx column and `has_chronology_key` no longer
counts it, so a placeholder-grantor row with only a guessed date is now **rejected**; prompt rule 5
asks for `null` when the day is unknown; 5 new tests with both positive controls (57/57 in file).
📊 Live check: columns absent, snapshot table absent, **844 dated / 676 low — unchanged**, so
nothing has run against `scknotsqkcheojiaewwh` yet (no credentials in the round's sandbox — stated).

Two departures, both worth knowing before the apply. ① **Narrower than asked:** the guard fires only
on `low` **AND** day-of-month = 01, not on any `low` date — the round's own positive control asserts a
non-day-01 low date still writes as recorded. Today that is the same population (676/676 are day-01),
and with rule 5 changed the model should now emit `null` instead; but a `low` non-01 date remains a
recorded date. Follow-up, not a blocker. ② **Wider than asked:** the migration **demotes the 676
existing rows in place** (`recording_date` → approx, `recording_date` set NULL), snapshotting the ids
to `_gov_govdeed4_demoted_dates_20260916` for reversal. The handoff deferred that to the GOVDEED-478
disposition round. It is ledgered and reversible, and it is the disposition that round would most
likely have chosen — so acceptable, but it makes the apply a **data change**, not a guard. ⚠️ What the
response does **not** say: the `properties.latest_deed_date` values (**147** distinct properties — first written
here as 493, which was join rows) and **25** `ownership_history` rows sourced from those deeds. Demoting the deed does not clear them; unless the
migration re-runs propagation (unreadable from here — no repo access to gov from this session), those
493 keep a date whose source row no longer has one. That is the first thing to read in the SQL.

Next: merge #401, pull `GovernmentProject`, read the migration for the 493/25 question, apply, re-measure
(`recording_date IS NOT NULL` before/after, `latest_deed_date` on the 493), then GOVDEED3/GOVDEED-478
inherit a smaller problem. Queue: `GOVDEED4` prompt + response filed to `done/` — and the four moves PR #2502 *claimed*
(DEED1-autofix, GOVDEED1, GOVDEED2, ID3b) had not happened (the apply script only moved C1C-SPLIT);
done for real here. STATUS archived to ~2,350 (eighteenth span, `tail10`).

---

## 2026-09-16 — GOVDEED4: the dated gov deeds are 80% invented dates, and GOVDEED2 just promoted them to winner (Cowork)

Ran down the two C2g side-findings. The "seller" resolutions are **not a class** — `Scannell` and
`Park De Ville Trio` each have real, older evidence (a 2017 `rel_purchase`, a 2021 lease-diff
transition); the later deeds never became LCC evidence because **there is no deed-grantee feeder** —
deeds reach LCC only via gov's `true_owner`, behind C2k's gate. Folded into C2k, with one more
structural note: `v_lcc_owner_supersession_candidates` has the same `unresolved`-only gate, so
**whichever feeder touches an asset first wins forever**.

The `2023-10-01` sentinel is real, and bigger than 130 properties. `deed_records` has **844** dated
rows; **676 (80%) carry `raw_payload.date_confidence='low'`**, every one day-01, 667 with no document
number, 451 with a placeholder grantor. The extraction prompt's rule 5 *tells* the model to emit
`YYYY-MM-01` with `date_confidence='low'` when the day is unknown; the recall path does it when
nothing is known (`2023-10-01` ×486). `save_deed_record` writes the date as recorded, keeps the flag
only inside `raw_payload`, and lets it satisfy the accept gate. ⚠️ **GOVDEED2's NULL guard made these
the winning deed** — 493 properties now source `latest_deed_date` from a `low` row. Only **2** dated
rows are `high` with a document number. dia: 230 dated, 0 low, clean. 👤 `government-lease` →
**GOVDEED4** handoff written; the 676 join GOVDEED-478's disposition question. Nothing applied.

---

## 2026-09-16 — C1C-SPLIT applied and run live: 839 dia tasks retired, gov untouched — and the dry run was counting lanes (Cowork)

Ran the sequence the round asked for, on LCC Opps: applied `20260908130300` (the nine
objects DEPLOY2 caught absent; **C1C-UNAPPLIED closed**), applied `20260916120000`, positive-controlled
both guards live (empty array and `owner_needs_sos` each RAISE with the documented message), one
signature in `pg_proc`.

⚠️ **Then the dry run said `tasks_to_retire = 1`** next to `by_type = {dia: 839}`. The `count(*)`
in the dry-run `jsonb_build_object` runs over the per-lane `GROUP BY` subquery, so it counts lanes
— 1 for dia alone, 2 for both. The defect is in `20260908130300` as well and was never seen because
that file never ran. The write path counts the ledger's `RETURNING` and is right; but the dry run is
the function's safety property, and the prompt's own stop rule reads exactly that field. Fixed as
**`20260916130000_lcc_c1csplit_b_dry_run_counts_tasks.sql`** (`sum(n)`), applied live before any
write, guard test added with a positive control that the original still carries the defect.

Corrected dry run: **839 dia / 0 gov** — 838 plus one row minted 2026-09-15 after the round measured.
Explained, so not a stop; noted that the dia trickle is 2 in 9 days, not 0. Real run, batch
`c1c-dia-20260916`: **839 retired**, 839 ledger rows, 839 stamped `terminal=true`, watch view 839
with 0 gov, and `v_lcc_research_lane_summary` no longer lists the dia lane while gov
`owner_needs_salesforce` reads **1,851, unchanged**. Reversal handle:
`lcc_c1c_unretire('c1c-dia-20260916')`. C1B-GOV-GATE untouched, as instructed. Prompt-queue
hygiene in the same PR: DEED1 (autofix), GOVDEED1, GOVDEED2, ID3b filed to `done/`.

---

## 2026-09-16 — C1C-SPLIT: `lcc_c1c_retire_sf_lanes` gains lane scoping; dia retire is ready, gov stays out (Claude Code)

C1c (`20260908130300`) can only retire BOTH `owner_needs_salesforce` (gov) and
`true_owner_needs_salesforce` (dia) at once — its plan CTE hardcodes
`_lcc_c1c_lane_types()`. That is now wrong: **C1B-GOV-GATE** found the gov gate
guards `owner_needs_sos`, not `owner_needs_salesforce`, so the gov lane is still
being fed (175 rows minted 2026-09-08..15) while the dia lane genuinely holds
(1 row minted in the same window, gate confirmed live).

Shipped `supabase/migrations/20260916120000_lcc_c1csplit_scope_retire_by_lane.sql`:
`lcc_c1c_retire_sf_lanes` gains a 4th, trailing `p_research_types text[] default
null` parameter. `NULL` still means the full lane set (both lanes) — the
reversal runbook and any future gov retirement depend on that default not
narrowing. A non-null array is validated against `_lcc_c1c_lane_types()` and
**raises** on an empty array or an unrecognised lane name; there is no
zero-row silent success. The pre-split 3-arg signature is `drop function if
exists`-ed before the new `create or replace` (the N15d/N15g 42725 overload
trap), and the migration asserts live — via `pg_proc`, in a `do $$ ... raise
exception` block — that exactly one signature survives, rather than trusting
the DROP. `_lcc_c1c_lane_types()`, `lcc_c1c_unretire`,
`lcc_c1c_reopen_tasks` and `lcc_c1c_reopen_relinked` are untouched.

Guard: `test/c1c-split-scope-retire-by-lane.test.mjs` — 12 structural
assertions over both migration files (comment-stripped), all passing,
including a positive control that the unknown-lane RAISE interpolates the
real bad values rather than a static string.

⚠️ **The live apply and run are PENDING.** This sandbox has no Supabase egress
(the same constraint DEPLOY2 already documented), so nothing here executed
against LCC Opps. Cowork applies in order: (1) `20260908130300` — DDL only,
defines functions, runs nothing inline; (2) this scoping migration; (3)
`select lcc_c1c_retire_sf_lanes(true, 'c1c-dia-<date>', null,
array['true_owner_needs_salesforce'])` — **expect `tasks_to_retire = 838`,
`research_types = ["true_owner_needs_salesforce"]`, 0 gov rows touched; any
other number is a STOP, re-measure rather than proceed**; (4) the same call
with `p_dry_run => false`; (5) re-read `v_lcc_research_lane_summary`: dia lane
→ 0 open, gov `owner_needs_salesforce` unchanged at ~1,851.

C2 stays open until the dia retirement is confirmed live. C1B-GOV-GATE stays
open and is explicitly out of scope for this change — do not retire the gov
lane, do not touch the gov gate, do not re-apply the retired `government/`
copy of C1b. Backlog: **C1C-SPLIT** row updated to shipped/live-run-pending.

---

## 2026-09-15 — C2g read-through: 43 of 111 pairs are SOS-attested, and the blocker is a gate, not a feeder (Cowork)

Scott took my recommendation (the 58-pair read before the beneficial-owner decision). Read all
**111 pairs / 92 orgs** — reconstructed from scratch, 78 stays the tracked number — against gov's
registry fields instead of names: `docs/audits/C2g_58_PAIR_READ_2026-09-15.md`.

⚠️ **Corrects this morning's C2h §7.** "Only 10 of 58 show any sponsor↔SPE link" was a *name* check
presented as the available evidence. It wasn't. **43 of 111: the SPE's SOS-registered manager IS
the Salesforce-linked org or its contact** (`llc_research_source='sos_registry'`, 40 `exact`).
23 wording-variant duplicates (decision #2's lane), 9 gov-internal conflicts, 6 LCC-contradicts-gov,
**2 LCC-resolved-to-the-seller** (`supersession` picked the deed grantor), 1 real sale where the CRM
contact is stale and LCC is right, 8 name-only, **16 "Not on file"**. Nothing written anywhere.

⭐ **The real finding:** `v_lcc_domain_owner_candidates` proposes the domain `true_owner` (weight
5.0, the feeder's highest) **only for assets with no resolved owner**. Once `supersession` placed the
SPE at 0.75, domain truth never entered as evidence — 0 `domain_true_owner` rows on the 92 assets.
R6's "domain truth OUTRANKS name patterns" is implemented as a gap-filler. **Lifting the gate
touches 936 gov + 100 dia resolved assets** — the `supersession-tie-lane-2026-08.md` §4 decision,
re-sized from 63 to 1,036. → **C2k**, 👤 Scott. ⛔ The token-keyed `lcc_ownership_sponsor_family`
cannot hold these (`300 Fifth Avenue LLC` ← Martin Selig has no token) — bulk-writing it would be the
third detector in a confirm table's clothes.

Side-findings, sized not chased: `latest_deed_date='2023-10-01'` on **130** gov properties (a
sentinel read as a date); 2 seller-resolutions worth one query. C2h §8, `connectivity` §4n-b,
tie-lane §6 updated. Archived the sixteenth 2026-09-12 span first (headroom was under 200).

---

## 2026-09-15 — GOVDEED2 shipped; the round refused one of my instructions and was right (Cowork)

**The manufacturing has stopped.** Verified from the live `pg_get_functiondef`: step 1's `bridged` CTE
now carries `AND d.recording_date IS NOT NULL` and `LIMIT p_limit`, matching step 2. Committed to
`government-lease` (PR #400) — **the first time that function has existed in any repository**, having
run twice hourly against production while source-controlled nowhere.

⛔ **The round refused my recommendation #3, and I retract it.** I told it to guard `consideration`
with `_positive_or_none`. It declined, citing `government-lease`'s CLAUDE.md §13d: a **$0 deed price
is a real recorded fact** (quitclaims, intra-sponsor transfers), deliberately unguarded, with a test
that fails if someone "fixes" it. Declining a handoff instruction because it contradicts documented
doctrine in the owning repo is exactly the behavior these prompts should produce. (Stated plainly:
`government-lease` is not connected here, so I could not read §13d directly and am taking the round's
report of it at face value.)

⭐ **But the defect is real — I aimed at the wrong target.** Of the 4,908 dateless rows, **4,854 have
`consideration = 0` and ZERO have `consideration > 0`**; **4,881** have a placeholder grantor. So the
$0 quitclaim §13d protects **does not occur in this population at all** — doctrine and defect were
never in conflict. `consideration = 0` is the **seventh** instance of one signal carrying two meanings:
*a genuine $0 transfer* and *the model had nothing*. → **GOVDEED3** retargets the fix at the accept
gate: reject a payload that is placeholder **as a whole** (no date, no document number, placeholder
grantor), never the value.

⚠️ **Two consequences I want on the record before they are forgotten.** (a) **"No backfill" did not
leave the 3,930 as NULL — it froze them as the manufactured value.** The guard removes those
properties from `bridged` entirely, so the producer can never revisit them: they are not awaiting
correction, nothing will correct them. Still exactly 3,930; the 478 conflicts remain; gov
`auto_fixable` is still 0. → **GOVDEED-478**, which is now the real remaining work. (b) `LIMIT
p_limit` in step 1 truncates *after* an unordered window function and could drop `rn=1` rows — latent
only (729 rows / 178 properties, far under 5,000) and consistent with step 2, but worth a comment.

---


## 2026-09-15 — GOVDEED1: one missing predicate is manufacturing half the gov conflict set (Cowork)

CC found the root cause and localized it correctly. Verified live, with two corrections that both
make it **stronger**, and one connection CC did not draw.

**The producer is running now:** `cron.job` 20, `35,5 * * * *` — twice an hour, not hourly — active,
calling `propagate_deed_to_property(5000)`.

⚠️ **Correction 1.** CC reported "no `recording_date IS NOT NULL` guard." The function contains that
exact predicate, **fifteen lines below the block that needs it**. There are two CTEs both named
`bridged`: step 1 writes `properties.latest_deed_*` with no date guard and no `LIMIT`; step 2 writes
`ownership_history` with both. **The author already knew** — they wrote the guard for one block and
not the other. That makes the fix an internal-consistency repair with the correct predicate already in
the file, not a design decision.

🚨 **The connection CC did not make.** **478 of the 941 government owner-source conflicts (50.8%)
trace to a dateless, document-number-less deed row — 478 of 478, a perfect match.** The missing date
does not merely block the autofix: **more than half the gov owner-conflict population is manufactured**
by this producer. And **4,143 of 4,928** linked dateless deeds have a grantee byte-identical to the
property's own `recorded_owners.name` — 84.1%, meaning the "deed" is an echo of the prompt's own
context, not evidence. Those rows assert that real properties changed hands on no evidence at all.

⛔ **Correction 2 — retracting my own prompt.** GOVDEED1 (which I wrote) claimed the dialysis pipeline
is "a working reference implementation of what the government one is failing at." **Wrong.** dia's
function is a different implementation entirely — and carries the identical unguarded write. Its
2-of-1,774 is a smaller upstream population, not a safer downstream. So the fix must be authored per
database, and dia cannot copy a guard from its own step 2 because dia has no step 2. →
**DEED-DIA-LATENT**.

👤 The fix belongs to **`government-lease`** → **GOVDEED2** handoff written, with no-backfill stated
plainly. ⚠️ The function is **in no repository at all** — running twice hourly, source-controlled
nowhere.
## 2026-09-15 — C2g's sponsor↔SPE explanation checked for precision before proposing anything to write (Cowork)

Follow-on to the same-day C2g reconfirmation (previous entry): before proposing candidate rows for
the `lcc_owner_sponsor_domain`/`lcc_ownership_sponsor_family` confirm surfaces, checked whether the
58 "unrelated name" pairs actually carry a textual sponsor↔SPE signature (shared initials or a
shared significant word) the way C2h's own named examples did. **Only 10 of 58 (17%) do.** The
other 48 — `praveen gupta`→`cary st ssa`, `murray hills`→`ten`, and 46 more — have no discoverable
naming link at all between the Salesforce-linked owner and the resolved title-holder.

**This sharpens, not overturns, the same-day finding**: the resolution mechanism
(`lcc_property_owner` picking the title-holding SPE via `supersession` at a flat 0.75 confidence) is
still structurally correct, not a feeder bug. But calling the *reason* for the name mismatch
"sponsor↔SPE" for the whole 58 was overstated — that held up on C2h's hand-picked examples, not on
the full population. Corrected the same-day doc changes (`C2h_...md` gets a new §7,
`connectivity-and-open-threads.md` and `PLANNED-BACKLOG.md`'s C2g row both re-worded) rather than
letting an overclaim stand.

**Recommendation, not built:** don't bulk-feed the 48 into the confirm surfaces — that repeats the
~25%-precision lexical-detector mistake this repo already paid for (A3/P196). The right-sized next
step is a manual read of 58 rows (one sitting), not new matching machinery. No rows written to
either confirm table.

---


## 2026-09-15 — the dia ownership contradiction, measured: both repos write schema (Cowork)

Scott's answer to the 👤 ownership question was the right one to give: *"Nothing in either would have
been written by me directly. It's all written by Claude."* Neither CLAUDE.md line carries human
authority, so re-reading them could never settle it. Measured the live database instead.

**Both repos apply schema to Dialysis_DB today** — proven in both directions. `dia_property_redirects`
(table + view + 3 indexes) is live and its migration exists **only in the `Dialysis` repo**, absent
from LCC's 283-file `dialysis/`. And three of LCC's five newest `dialysis/` migrations are **also
live**. So "ONE REPO OWNS EACH DATABASE'S OBJECTS" was never true of this database.

⭐ **That dissolves the contradiction rather than resolving it.** Neither line is wrong: the doctrine
is aspirational, the inventory line is observational, and they were written in the same register. A CC
round could follow either and look correct — which is exactly what happened.

**Proposal now on the row, awaiting Scott: own by OBJECT FAMILY, boundary drawn at "who queries it."**
A migration lives where its consumer lives, so an endpoint change and the schema it depends on land in
one reviewable commit. The DEED1 objects settle cleanly: `v_owner_source_conflict` is queried from
five LCC files, and the other two exist only to serve it. LCC keeps the BD/analysis layer; the
`Dialysis` repo keeps CMS/NPI ingestion and its own pipeline schema.

Next: **DEED1-reconcile-2** (port the file, close PR #7412) and **GOVDEED1**, still unsent and still
the largest single blocker in the deed set at 3,930 dateless gov deeds.
## 2026-09-15 — C2g re-diagnosed as already-answered: it's the sponsor↔SPE gap, not a new mystery (Cowork)

Was about to write up a fresh diagnosis of the "78 gov owner-orgs, property+asset present, still
unresolved" residue (`PLANNED-BACKLOG.md`'s C2g row, marked ⭐ NEXT) — live-measured a 26%
duplicate-entity / 74% unrelated-name split, then found `C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md`
had already answered this exact question three weeks ago at nearly the same proportions (69/8/2),
and `connectivity-and-open-threads.md` §4n already carries it as canonical. C2g's own backlog row
and §4's "next question" paragraph never got updated to point at it — a real staleness gap, not a
new finding.

**What I added, not rebuilt:** a live reconfirmation (`C2h_...md` §6) that the diagnosis still holds
2026-09-15 — `lcc_property_owner` resolving to the title-holding SPE via `supersession` at a flat
0.75 confidence while the Salesforce contact sits at the sponsor, for ~83% of the residue (52 of 70
sampled, `source='supersession'`); ruled out the batch cap (evidence exists on 91 of 95 pairs), the
`lcc_domain_owner_ambiguous` lane (0 of 58), and guards (unchanged from C2h). Cross-checked the
remaining high-name-similarity pairs against decision #2's dedup views: 5 of 8 exact-name pairs
already sit in `v_lcc_merge_candidates`/`v_lcc_canonical_twin_candidates`, no new machinery needed;
1 (`sarita mutscher`) is an exact-name pair neither view flags — a possible dedup-view gap, not
chased further here.

**Updated, not built:** `PLANNED-BACKLOG.md`'s C2g row (demoted from ⭐ NEXT/🔴 "diagnose before
building" to 🟡 "diagnosed, two narrower unsized steps remain") and `connectivity-and-open-threads.md`
§4's two paragraphs that still framed this as open. The two real next steps, neither sized nor
built: (1) feed the sponsor↔SPE pairs into the existing confirm-only surfaces
`lcc_owner_sponsor_domain`/`lcc_ownership_sponsor_family` (8/34 rows, unchanged in scale since
C2h — sizing this is not done); (2) Scott's still-open buyer-vs-true_buyer precedence call in
`supersession-tie-lane-2026-08.md` §4, the same mechanism from the tie-breaking angle. **No ⭐ NEXT
re-crowned** — that's a call for Scott, not mine to make unilaterally; the backlog currently has no
single headline item and should get one from him.

---


## 2026-09-15 — DEED1-reconcile: right work, wrong repository (Cowork)

**The round was done correctly and I verified it live.** The migration was emitted from
`pg_get_functiondef`/`pg_get_viewdef` rather than retyped — which is exactly why I handed it to CC
instead of transcribing it myself — made idempotent, and applied. All **seven checks reproduce
identically**: `auto_fixable` 4 (1 + 3), bad rows 0/4, good rows 4/4, SMFG `true`, unrelated `false`,
alias table 1 row intact. A reconciliation that changed behavior would have been the bug; it did not.

🚨 **But the file was committed to `sbriggssjc/Dialysis` (PR #7412), not here, and does not exist
anywhere in `life-command-center`.** So the drift is not closed — it moved. Rebuilding Dialysis_DB
from this repo still restores the old comparator and drops the alias table.

⭐ **And the cause is ours, not CC's.** This repo's `CLAUDE.md` gives two answers. The ownership
doctrine says Dialysis_DB schema belongs to `life-command-center` and names *aliases* among its
examples; the migration-inventory table lower down says the `Dialysis` repo owns it, tagged 👤 "not
formally confirmed by Scott." `supabase/migrations/dialysis/README.md` sides with the doctrine and is
unambiguous. The two lines are answering **different questions** — where the files sit, versus who
owns the objects — and were written as if they were the same one. → **CANON-OWNERSHIP1**.

⚠️ Leaving PR #7412 open is the dangerous outcome: a dia migration living in a repo that does not own
those objects can be re-applied from there and overwrite a running object — the exact hazard the
`government/` retirement (I16) was created to prevent. → **DEED1-reconcile-2** prompts the port, the
PR closure, and the canon fix, and explicitly leaves the 👤 ownership confirmation to Scott.

---


## 2026-09-15 — Decision #2's review lane already exists — no build needed, it just needs to be worked (Cowork)

Scott's answer on how to review the 2,201 canonical_name duplicate groups: build a Decision Center
review lane. Reviewed the existing machinery first, per this repo's standing discipline, before
writing any code — **and there is nothing to build.** The `merge_duplicate_entities` federated lane
(`api/admin.js` ~line 8886) already reads `v_lcc_canonical_twin_candidates`, a surface-only,
human-verdict-only view over every same-canonical-name org twin, explicitly built to add "the
previously-invisible groups" beyond the `auto_mergeable`/`sf_inheritance` filter. Sampled 200 of the
1,988 groups outside that filter against the twin view: **200 of 200 already present.** The lane
already shows this population today, paginated, with a working verdict path straight to
`lcc_merge_entity` (reversible).

**The real gap is throughput, not machinery** — `lcc_decisions` shows only 13 `merge` + 1 `research`
verdict ever recorded against this lane, the same "built but unworked" shape `[UX-T1c]`'s census
already found on 12 of 28 other federated lanes. Decision #2 stays open until the lane gets worked
down; nothing further to build. Full detail:
`docs/architecture/ownership-truth-pipeline-state.md` decision #2.
## 2026-09-15 — DEED1 shipped and verified; the migration for it was never written (Cowork)

**Verified against the live database rather than the response summary, and every number holds.**
`auto_fixable` **8 → 4**; the SMFG pair now reads as one company; an unrelated pair stays false; the
four bad rows are gone; and **the four good rows are still auto_fixable** — the positive control is
the one that matters, because it proves the guards did not clean up the set by excluding everything.

⭐ **The alias mechanism is better than the response described.** Not a hardcoded regex but a curated
TABLE, `public.dia_owner_name_alias`, whose single row carries its own provenance: *"Human-confirmed
pairing, not inferred."* The financing-instrument regex was widened from the data — all ~44 "leasing
and finance" grantees in the conflict set were enumerated first.

⚠️ **But no migration file exists for any of it.** A new table, a changed function and a changed view
are live in Dialysis_DB and the repo knows about none of them. Rebuilding from `main` restores the old
comparator and regex — silently re-admitting the four rows this round removed — **and drops the alias
table entirely**. That is the **fifth DEPLOY3-unmerged instance**, and the first involving a TABLE.
DEPLOY2's `migration_unapplied` detector cannot see it by construction: it enumerates files and probes
the DB, and here there is no file to enumerate. → **DEED1-reconcile**, prompted. I deliberately did not
transcribe the migration myself — the view's word-boundary regexes have escaping I cannot read back
unambiguously through a tool boundary, and a silently wrong regex changes which rows auto-fix.

**The window widening was measured and correctly NOT shipped** → **DEED2**. Of the rows blocked solely
by the 2-year window (**146** re-measured post-fix; CC's 151 was pre-fix, the difference being the new
financing regex), **13 are legal-form-only restatements** and **3 have deed-parsing boilerplate as the
grantee** — so a bare widening writes ~11% garbage. Declining on that evidence is the same gate that
stopped DEPLOY2-stale.

⭐ **The 13 expose a sixth instance of the recurring class, and the second of a specific sub-shape:
absence of evidence rendered as a verdict.** `dia_owner_share_significant_token` drops short and
stoplisted tokens, then asks `EXISTS (ta JOIN tb)`. When a name reduces to the empty set — `Realty
Income Corp` is entirely stopwords — `EXISTS` is false and every caller reads that as "different
companies". Verified live. The fix is not a bigger stoplist; the function needs a third answer,
`cannot tell`, alongside same and different. → **DEED1-emptycompare**, which blocks DEED2.

---


## 2026-09-15 — Decision #2 measured: canonical_name UNIQUE constraint still not safe, 2,201 groups need Scott's call on review approach (Cowork)

Next step after decision #6 closed: decision #2 (`entities.canonical_name` as an enforced UNIQUE
key), the last of Scott's six ownership-pipeline decisions still gated. Its own "next step" said to
measure how close to unique-clean the population is after #1's merge sweep, then add the constraint.
Measured live — **result: still not safe.**

`v_lcc_merge_candidates` (the same view #1's sweep used): **2,201 groups / 4,738 entities remain, 0
auto_mergeable** — every previously-safe tier was already swept 2026-09-15 by decision #1. Breakdown:
`bridged_unknown_pinned` 1,644g/3,539e, `no_role_or_sf_signal` 340g/688e, `multiple_sf_accounts`
89g/193e, `low_name_similarity` 64g/143e, `normalizer_blind_review_only` 64g/175e.

Read the dominant class further: **1,484 of the 1,644 `bridged_unknown_pinned` groups (3,087
entities) are name-compatible but carry zero Salesforce corroboration** — no signal either way on
whether two same-named entities are really the same company. Checked whether
`entities.normalized_address` could break the tie before concluding review is unavoidable — dead
end, all 1,484 groups have at least one member with a NULL address; this bridged-owner population
never carried address data at all. No other cheap signal exists. The remaining sub-classes
(multi-SF-account groups, low-name-similarity, normalizer-blind) are correctly held for the reasons
already on file — genuinely different firms, not reviewable-for-merge.

Adding the UNIQUE constraint today would either fail outright or force blind-merging 4,738 entities
with no corroborating signal on most of them — against Scott's own "accuracy first" instruction from
decision #1. **2,201 individual judgment calls is a real review workload**, not something to sweep
through alone. Surfaced three options rather than picking one: (a) a Decision Center review lane
(the federated-lane pattern this same doc's item 2 already flags as under-used elsewhere) for Scott
or the team to work through in normal course; (b) a scoped/partial unique constraint that exempts
this reviewed-pending population; (c) something else. Full detail:
`docs/architecture/ownership-truth-pipeline-state.md` decision #2. Awaiting Scott's answer before
building anything.

## 2026-09-16 — I duplicated a parallel session, and my version was the wrong one (Cowork)

**Retracting my own work from earlier today.** A parallel Cowork session filed **CANON-OWNERSHIP1** and
**DEED1-reconcile-2** for the same findings I filed as **DIA-OWNERSHIP-CONFLICT** and **DEED1-RELAND**,
hours apart. Both merged. That is precisely the failure this repo's own doctrine names — *two branches
that both add to a shared doc merge cleanly and silently duplicate it* — and I wrote that line.
⚠️ **And my argument was wrong, not just redundant.** I argued from `CLAUDE.md` line 375 that ownership
was already settled. **Scott has since said neither CLAUDE.md line was written by him** — *"Nothing in
either would have been written by me directly. It's all written by Claude"* — so neither carries human
authority and no amount of re-reading them could have settled it. The other session measured the live
database instead: **both repos apply schema to Dialysis_DB today** (`dia_property_redirects` is live from
a migration that exists only in the `Dialysis` repo; three of LCC's five newest `dialysis/` migrations are
also live). "One repo owns each database's objects" was **never true of this database**. That dissolves
the contradiction instead of resolving it, and it is the better finding.
✅ **Nothing lost.** The destination is identical — port the file here, close PR #7412 — and
**DEED1-reconcile-2** tracks it, with a check mine lacked (whether the `Dialysis` repo also carries an
older copy of `v_owner_source_conflict`). My one unique contribution, the **md5 behaviour pin**
(`pg_get_viewdef` = `9fc5aa3f824b125853b3ac8c8a8388f1`/4747, `pg_get_functiondef` =
`72b48cd949db4de5502812920b2e5dd0`/2183, plus the `\m`-escape transcription hazard), was folded into that
prompt before retiring the duplicate to `_superseded/duplicate-prompts-2026-09-16/` with a manifest.
🔭 **The guard gap is real and worth naming:** `backlog-id-uniqueness` catches a repeated ID, not two IDs
describing one finding — and nothing at all catches two prompts for one job. With parallel sessions now
routine, the cheap mitigation is to read the queue and the newest backlog rows before filing, which I did
not do this turn.

---

## 2026-09-16 — DEED1's migration is correct and in the wrong repository (Cowork)

**The SQL is right; only its address is wrong.** CC wrote, applied and verified the DEED1 reconciliation
migration, then committed it to the **`Dialysis`** repo (PR **#7412**) on the strength of *that* repo's
`CLAUDE.md` saying "Dialysis owns `supabase/migrations/*.sql`". Re-verified live, independently of the
response: `dia_owner_name_alias` present with 1 row, the comparator function present, the
financing-instrument regex live, `auto_fixable` = 4. Nothing needs redoing.
⚠️ **But LCC's own `CLAUDE.md` line 375 — Scott's 2026-09-12 ONE REPO OWNS EACH DATABASE'S OBJECTS
decision — assigns Dialysis_DB schema to `life-command-center`**, leaving the Dialysis repo its CMS/NPI
*ingestion* (rows, not schema), and names "aliases" explicitly. An alias table is schema.
💥 **So the drift moved rather than closed.** Rebuilding Dialysis_DB from this repo still restores the old
comparator and regex and still drops the alias table — the exact thing the reconcile existed to prevent.
And **no detector covers it**: `migration_unapplied` enumerates files and probes the DB, so with no file
here there is nothing to enumerate. CC spotted that itself. DEPLOY3-unmerged shape, **fifth occurrence**,
first involving a table.
🟢 **Prompted: `DEED1-RELAND-the-migration-went-to-the-wrong-repo.md`** — re-land under
`supabase/migrations/dialysis/`, **emitted from live objects, never transcribed**: the view body is 4,747
chars carrying `\m`/`\M` word-boundary escapes, and a silently wrong regex changes which rows auto-fix.
✅ **Behaviour is pinned by checksum, not by adjective.** Captured live before any re-land:
`md5(pg_get_viewdef)` = `9fc5aa3f824b125853b3ac8c8a8388f1` (4747), `md5(pg_get_functiondef)` =
`72b48cd949db4de5502812920b2e5dd0` (2183). Both must be unchanged after applying; a differing hash is a
STOP, not a cosmetic difference.
👤 **Root cause is a doctrine conflict, not a mistake** → **DIA-OWNERSHIP-CONFLICT**. The two repos'
`CLAUDE.md` files contradict each other and CC followed one of them correctly. Same class ID3a-d resolved
for government — where `government/` got a README, a marker on every file and a guard test, while
`dialysis/` here has 0 of 282 markers and no README. Both cannot be true. ⛔ Nobody should close PR #7412
or edit the Dialysis repo's CLAUDE.md until Scott decides; Cowork's read is that #7412 closes unmerged.

---

## 2026-09-16 — C1C-SPLIT prompted; and `docs/capital-markets/` is mostly not capital markets (Cowork)

🟢 **`prompts/C1C-SPLIT-retire-the-dia-lane-only.md`** (129 lines). C1c cannot be applied as written:
`lcc_c1c_retire_sf_lanes` has **no lane scoping** — its plan selects `research_type = any(_lcc_c1c_lane_types())`,
a hardcoded two-element array — so it is all-or-nothing, and "all" now includes the ungated gov lane.
✅ **Measured before prompting, and it makes the fix small: lane and domain are 1:1.**
`owner_needs_salesforce` = 1,851 rows, **all** government; `true_owner_needs_salesforce` = 838, **all**
dialysis. So one `p_research_types text[]` parameter is enough, and the prompt **forbids adding a domain
parameter** — two selectors that must agree is a defect waiting to happen.
⚠️ The prompt names the **42725 overload trap** explicitly: a defaulted parameter added with `create or
replace` leaves BOTH signatures live, so it needs an explicit `drop function` first **and an assertion that
exactly one remains** — do not trust the DROP, assert it. An out-of-range lane name must **raise, not
no-op**; a silent zero-row success is this arc's signature failure.
🔍 CC's sandbox has no Supabase egress (measured on DEPLOY2), so it ships and states the live run pending.
**Cowork applies and runs**: DDL → scoping migration → dry run, expect **838 dia / 0 gov** (anything else is
a STOP) → real run → re-read with gov unchanged.

**Consolidation: `docs/capital-markets/` indexed, and the index's headline is that the directory is
misnamed.** Of 156 markdown files, **115 are archived `CLAUDE_CODE_PROMPT_*`** spanning the whole
application; only 41 are capital-markets or adjacent, and only ~4 are the quarterly book itself.
⚠️ **Deliberately not moved.** Those files carry inbound links from this STATUS file, from
`docs/architecture/`, and from several processed DOCMAP/J13a prompts — a mass `git mv` without rewriting
them leaves dead links in the narrative future sessions are told to trust, which is worse than the
mis-filing. Filed as **DOCS-CM-MISFILED** 🟡 with the scoped fix written down; the README now says it at
the top so the trap is at least legible.
🔭 `docs/history/` (111 files) is the last unindexed directory, and it is partly self-describing through the
STATUS archive pointer chain — lowest value of the three.

---

## 2026-09-16 — `docs/architecture/` has an index for the first time (Cowork)

**188 design documents, no entry point.** Every session arrived at that directory and guessed, which is a
standing tax on exactly the "pick up seamlessly" goal. `docs/architecture/README.md` now groups all 188 into
14 topics — ownership/identity (25), copilot & intelligence layer (29), Salesforce/Microsoft/PA (22), deal
spine & dossiers (20), healthcare verticals (19), app surfaces (17), and so on.
✅ **Generated from each file's own H1, never from an assumed summary** — a hand-written index of 188 files
is a fabrication surface, and the point of the directory is to be trustworthy. Section counts are asserted
against the rows beneath them; all 188 files are accounted for, none dropped, none invented.
⚠️ The index carries the warning the directory needs: **a design document is a design document.** Several
describe behaviour that was never built or has since drifted, so the live system is still the check —
`PLANNED-BACKLOG.md` is the open-work list and STATUS is the narrative. Non-markdown assets (dossier HTML
examples, `copilot_action_registry.json`, `signal_table_schema.sql`, the four subdirectories) are named as
out of scope rather than silently omitted.
🔭 Remaining directories without an entry point: `docs/history/` (111 files, though the STATUS archive
pointers already chain through it) and `docs/capital-markets/` (163) — the next two worth doing.

---

## 2026-09-16 — C1c re-diagnosed before applying, and the check found a guard that never guarded (Cowork)

**Recommendation was re-diagnose rather than apply. Doing so changed the answer.** C1c's header says the
retirement is safe *because* C1b makes `gate_pass` permanently false so *"nothing will mint into these two
lanes ever again."* Measured live, that is **true for dia and false for gov**:

| lane | queued | minted since C1b (8 days) | premise |
|---|---|---|---|
| dia `true_owner_needs_salesforce` | 838 | **1** | holds |
| gov `owner_needs_salesforce` | 1,851 | **175** (156 on 09-13 alone) | **fails** |

🚨 **C1b's gov gate is live and gates the WRONG LANE** → **C1B-GOV-GATE**. The government project's
`v_ownership_gaps` carries exactly one `lane_no_consumer` marker and it sits on the **`owner_needs_sos`**
arm; the `owner_needs_salesforce` arm still has the ordinary value/placeholder predicate. The view exists,
the marker string exists, a grep finds it — **only reading which arm carries it shows the gate missing.**
That is XB2-precision's shape again (object present, wrong body) and it is the standing argument for
**DEPLOY2-stale**. The mint path is not at fault: `fetchNbaFeed` applies `gate_pass=is.true` server-side.
✅ **The "no consumer" half was checked separately rather than inherited.** The dia lane shows 298
`completed` rows — but **every one carries a fully NULL `outcome`** (no action, no outcome, no terminal;
last touched 2026-09-02). A bulk status flip, not a human working the lane. "Retire, no consumer" is still
the right verdict for dia.
👤 **Recommendation: apply C1c's dia arm only.** The gov arm waits on a real gate, and that fix belongs to
`government-lease` (ID3a-d) — ⛔ not to re-applying this repo's retired `government/` copy, which is exactly
what that directory's README warns restores known-bad state.

---

## 2026-09-16 — DEPLOY2-coverage verified live: the rule caught a real one, and a stale ✅ fell with it (Cowork)

**CC shipped it and honestly refused to quote a live number** — its sandbox had no Supabase egress and a
shallow clone, which makes `git log --diff-filter=A` report the graft boundary as every file's add date.
Correct call. **The CI run has happened since, so I took the measurement.** Snapshot 33 (`c841e1a6`),
`window_degraded: false` — real add-dates, skew gone. **60 checked of 1,173 available; findings 24 → 43.**

| target | checked | applied | UNAPPLIED | unverifiable |
|---|---|---|---|---|
| LCC Opps | 47 | 42 | **1** | 4 |
| Dialysis_DB | 13 | — | — | **13** (`probe_rpc_http_404`) |

🚨 **First real catch, and it invalidated a backlog row that had read ✅ for eight days.**
`20260908130300_lcc_c1c_retire_sf_lanes.sql` merged 2026-09-08 and **was never applied** — 9 of 9 declared
objects absent. I verified that independently of the rule that raised it, because a new monitor does not get
to be its own witness: `lcc_c1c_retire_log` and `v_lcc_c1c_retired_watch` both null, **0** rows in `pg_proc`
matching `lcc_c1c%`. **C2** claimed *"`true_owner_needs_salesforce` (dia, 837) is now RESOLVED — C1c retired
it"*. Live today: **838 open tasks.** It grew by one. The lane was never retired; the row recorded the merge
as the outcome. C2 **retracted**, → **C1C-UNAPPLIED** 🚨👤.
🚨 **Fourth occurrence of the class, and it is the detector's own migration.** The dia probe RPC merged and
never applied — hence 13 × `probe_rpc_http_404`. ✅ **The fail-closed design is the only reason that is
visible**: it emitted 13 named warns instead of quietly reporting root-only-and-clean. I applied the dia RPC
live (read-only `pg_catalog`, `service_role` + `anon` asserted) and confirmed it round-trips.
✅ **Acceptance #1 answered: OWNERGAP1 is APPLIED** — all 7 probed objects present in Dialysis_DB. The
incident the detector was blind to is now in scope *and* verified clean.
👤 **C1c needs your decision before anything is applied.** It is a retirement with data effects (closes
tasks, writes a retire log), not a read-only probe, so I left it alone: apply it, re-diagnose first, or drop
it. The lane is 8 days older than the diagnosis that justified retiring it.

---

## 2026-09-16 — DEPLOY2-coverage: the `migration_unapplied` window was blind to one of its own three incidents (Claude Code)

`migration_unapplied` shipped 2026-09-16 and its core design is sound (version-anchoring correctly
ruled out, UNVERIFIABLE a first-class verdict, positive control firing, STALE measured and correctly
not shipped). **Its WINDOW had three defects, all measured, and together they meant the rule could
not see OWNERGAP1 — one of the three incidents it was built to catch.** All three closed.

| defect | before | after |
|---|---|---|
| `dialysis/` excluded as "a historical copy" | 889 root files only | **1,171 candidates** (root 889 + dialysis 282); **OWNERGAP1 in scope**, routed to Dialysis_DB |
| window sorted by filename (a synthetic sequence number, not a clock) | floor `20260930121500`; 107 migrations added in 14 days, **64 outside the window, 24 of them root-level** | ordered by **git add-date**, one `git log --diff-filter=A` pass; `MIGRATION_WINDOW_SIZE` held at **60** on purpose |
| "root → LCC Opps" | **31 root files carry a `gov_`/`dia_` prefix** and target another project; 0 in window **by luck** | routed by **target database**, undetermined **fails closed** as UNVERIFIABLE |

- **`dialysis/` is live and owned by THIS repo; only `government/` is retired.** The old header
  generalised the gov retirement to dia without checking: `government/` has a README, the
  `HISTORICAL — DO NOT RE-APPLY` marker on every file and a guard; `dialysis/` had **0 of 282
  markers and no README**. It has one now, written as the deliberate mirror so the two directories
  stop looking alike — `supabase/migrations/dialysis/README.md`.
- **A file with no git add-date sorts NEWEST, never dropped** (P180 — an untracked migration is the
  freshest thing in the repo), and an **unavailable git history EMITS** `window_degraded` with a
  reason on the snapshot rather than silently reverting to filename sort (B6a: a degraded window
  that looks identical to a healthy one is how this defect survived its own review).
- **The dia half is a second PROJECT, not a second directory.** Probe RPC ported to Dialysis_DB
  (`20260916130000_dia_deploy2_migration_probe_rpc.sql`). ⚠️ Its grants **deliberately differ** from
  the LCC copy's — `service_role` **and** `anon`, both asserted — because the credential CI resolves
  is `diaSupabaseKey()`, which falls back to `DIA_SUPABASE_KEY`, **the anon JWT** (#720). A
  service_role-only grant would fail on every run. 🔍 **Consequence, stated not buried: this grants
  schema object-NAME enumeration on Dialysis_DB to anon-key holders**, bounded by #720 Phase 4,
  which is named in the migration as the removal trigger. Credentials go through the resolver, never
  a hardcoded env name, so the rule upgrades itself the day the service key is set.
- **A 401/403 from any probe emits `skipped` WITH the HTTP status**, never "no objects missing"; a
  project with no credentials skips **its own files with a named reason** rather than quietly
  reducing to "root only, all clean".
- **`government/` stays out, and the gap is now attributed rather than absent** —
  `docs/architecture/MIGRATION-COVERAGE-MAP.md` (three projects → owning repo → does a detector
  exist → where). Backlog **GOVDEPLOY1** 👤 owns building one, in `government-lease`.
- Guard: `test/xb1-xb2-build-brief-collector.test.mjs` — **51 tests, 8/8 mutations RED**. Full suite
  **6,298 pass / 0 fail / 6 skipped**.

⚠️ **THE LIVE RE-RUN DID NOT HAPPEN AND NO NUMBERS ARE QUOTED FOR IT.** The sandbox has no Supabase
egress, **and its checkout is shallow** — so `git log --diff-filter=A` reports the graft boundary as
the add date for ~880 files (exactly the trap `CLAUDE.md` documents), which is why a sandbox dry run
skews the window dia 49 / lcc 11. The collector reports that honestly as
`window_degraded: shallow_clone_add_dates_are_graft_boundary`. **CI checks out `fetch-depth: 0`, so
the first workflow run on `main` is the real measurement.** Baseline to compare against: **60 checked
/ 100 objects / 0 UNAPPLIED / 5 UNVERIFIABLE, LCC Opps only.** A rising UNAPPLIED count there is the
rule working. Still unverified from here: whether the `DIA_SUPABASE_*` secrets resolve, and **which**
key the resolver picks — which is what decides whether the `anon` grant is load-bearing today.
## 2026-09-15 — the deed-wins flag was never the decision; two prompts sent instead (Cowork)

Took FLAGDARK1's recommended first decision (**#4, `DECISION_OWNER_DEED_WINS`**) and measured it
before recommending it to Scott. It does not hold. The flag would write **8 rows out of 1,363 live
owner-source conflicts** — **zero in government**, 8 in dialysis — so it is a switch on a population
a guard has already reduced to nothing, not a policy call about whether deeds win.

**And the 8 fail a hand-check.** `Sumitomo Bank Leasing And Finance Inc` → **`SMFG`** twice: the
rebrand guard (`dia_owner_share_significant_token`) compares shared tokens, and an initialism shares
none with the words it abbreviates — structurally blind, not a tuning miss. Separately a
leasing-and-finance entity takes title on rows that read as financing instruments; the grantee
exclusion list covers `mortgage`/`savings bank`/`bancorp` but not `Leasing and Finance`.

**The real blockers are measured, and neither is a decision.** 234 dialysis rows are blocked *solely*
by the 2-year deed-recency window — and an older deed is not a less authoritative one, it is a more
settled one. On the government side, **3,930 of 5,922** grantee-bearing properties have **no deed date
at all** (66.4%) against dialysis's **2 of 1,774** (0.1%): same field, two pipelines, 600x miss rate,
which makes the dialysis path a working reference implementation of what gov is failing at.

Scott's calls: widen the window but prove it first, fold the guard work into the same round, and yes
to chasing the gov date gap. Two prompts written —
`prompts/DEED1-the-autofix-set-is-8-rows-and-half-are-wrong.md` and
`prompts/GOVDEED1-two-thirds-of-gov-deeds-have-no-date.md`. GOVDEED1 flags the repo-ownership
question up front (gov DB objects belong to `government-lease` per ID3a-d/I16, so the deliverable may
be a handoff rather than a migration) and forbids inferring a date from any adjacent field.

⭐ The gov NULL date is the **fifth** instance of one signal carrying two meanings — downstream,
"we have no date" and "the deed is old" are indistinguishable. And the lesson for the triage doc
itself, recorded there: it ranked the five decisions by **cost** without sizing their **effect**.

---


## 2026-09-15 — Decision #6 CLOSED: OWN-T0i ships live, all six of Scott's ownership-pipeline decisions now closed (Cowork)

**The last of Scott's six compiled ownership-pipeline decisions is closed.** Follow-up answer,
verbatim: *"Yes, we want to pursue, in research, until every current and prior owner of a building
leased to one of the operators or agencies in our target swimlanes (dialysis and government-leased)
are known and connected to our LCC app and code processes. The brokers can then make the election on
whether to pursue the account or not individually, with the guidance and coaching of the LCC on the
next best relatively important lead."*

This resolved the one open scope question from the prior research pass (whether "promotion" meant
widening the seller-prospecting population beyond the live queue's lease-timing bands): yes, but as
**connectivity** (role known, broker assigned), not as a forced bulk cadence — brokers still elect
individually, which is why no cadence was seeded.

**One category error caught before building anything**: the OLD scalar `entities.owner_role` /
`behavioral_override` field is a human-manual-override convention, not a system-write target — an
earlier pass in this same research nearly wrote a system-derived "promotion" into it, which would
have been exactly the kind of fabrication this repo's doctrine exists to catch. Checked instead
whether the live deterministic role-SET view (`v_lcc_entity_roles`) already had this right: it does
— **445 of 447** reachable current owners already correctly tagged `investor_owner`, **3,804 of
3,820** prior owners already `former_owner`, computed live, no backfill needed. Role classification
was never a real gap.

**Shipped `lcc_own_t0i_extend_broker_assignment(p_dry_run)`** — reuses BROKER1's exact
vertical-default policy (`gov`->Scott, `dia`->Kelly Largent, Scott catch-all, Nate never assigned,
fill-blanks-only, reversible) over the wider population Scott's follow-up asked for: every reachable
current-OR-prior target-market owner, not just the live priority-queue's lease-timing bands. Does not
touch `lcc_broker1_assign_prospect_brokers` itself. Dry run matched live exactly: **1,044 reachable
owners total** (447 current + 197 prior, minus 5 domain-overlap in the current set already counted —
sized live 2026-09-15), **487 already assigned, 557 newly defaulted** (315 gov->Scott, 238 dia->Kelly,
4 catch-all->Scott). Re-ran the dry run afterward: **0 remaining**, idempotent. Verified Nate
untouched (0 rows). Migration:
`supabase/migrations/20261102200000_lcc_own_t0i_extend_broker_assignment.sql`.

**The real remaining bottleneck, sized but not addressed here**: reachability, not role or broker
mechanics. 86.5% of current owners (2,875 of 3,322) and 94.8% of prior owners (3,623 of 3,820) in the
target market have no usable contact method at all, so they cannot yet be "known and connected" in
any way that matters to a broker. This is a contact-data-sourcing problem, and it already has an open
thread: `FLAGDARK1`'s owner-enrichment-adapters question (address/deed/SOS/websearch/OpenCorporates)
is the actual lever for moving these numbers, not anything in decision #6's scope. Full detail:
`docs/architecture/ownership-truth-pipeline-state.md` decision #6.

**All six of Scott's ownership-pipeline decisions now have a decided rule, and five of the six are
shipped and live** (#1 trailing-"The", #3 OWN-T0g transfer supersession, #4 N15 SF-campaign orphans,
#5 T2b widening, #6 this entry). **#2** (`canonical_name` unique constraint) is the only one still
un-built — its rule was decided same as the others, but it stays gated on reviewing the review-only
merge-sweep tail from #1, which has not been started. That review, or `FLAGDARK1`'s enrichment-adapter
decision (the real lever on the reachability numbers this entry sized), are the two live next steps in
this arc.

## 2026-09-15 — Decision #6 research done: BROKER1 + C6 already cover most of it; one scope question left for Scott (Cowork)

**Decision #6 of Scott's six compiled ownership-pipeline decisions -- the last one open.** Scott's
answer, verbatim: *"If they currently own an asset in our target market, that broker assigned to
working that market should be assigned the prospecting and cadence should match the schedule
planned for (7 touchpoints in the first 6 months, average 4 a year thereafter, but each client
interaction and profile dictates the exact timing and content)."*

Followed the decision's own "review before building" instruction (`docs/architecture/cadence-engine.md`,
`api/_shared/cadence-engine.js`, `docs/architecture/owner-role-classification.md`,
`docs/architecture/bd-ranking-and-priority-queue.md` §7) -- and the review changed the shape of the
work. An initial pass concluded no broker-to-market assignment mechanism exists anywhere; that was
wrong, caught before writing anything to Scott. **`BROKER1`** (shipped + applied live 2026-09-11,
`PLANNED-BACKLOG.md` `C4c`/`BROKER1`) already *is* the broker-to-market rule: vertical default
(`gov`->Scott, `dia`->Kelly Largent, Scott catch-all, Nate never assigned), fill-blanks-only,
already run against the live seller-prospecting queue (1,303 assigned: 870 gov->Scott, 414
dia->Kelly, 19 catch-all->Scott). And **C6** (2026-08-29) already retired the role gate on that same
queue -- eligibility today is *holds a current asset AND is reachable*, no role predicate -- so an
owner sitting at `owner_role = 'unknown'` no longer blocks anything operationally for owners already
inside the queue's bands.

**Sized live (2026-09-15)**: 3,322 distinct entities hold a current target-market asset at
`effective_owner_role = 'unknown'`; the queue's own reachability predicate
(`owner_contact_pivot.active_contact_entity_id IS NOT NULL`) narrows that to **447 reachable** (374
gov, 78 dia, 5 overlap) -- P112-safe by construction. Of those 447: 212 are already in
`lcc_priority_queue_resolved`, 206 of those 212 already have a broker, only **6** are in-queue and
unassigned; **167 of the 447 already have a `touchpoint_cadence` row** -- prospecting is already
running for a real share of this population despite the stale `unknown` label. The label itself was
never written by C6 or BROKER1, so all 447 still literally read `unknown` -- a pure data-integrity
gap with no live gating effect on the 212 already in-queue.

**The one real open question**: Scott's decision text ("if they currently own an asset in our target
market") reads broader than the queue's live lease-expiry/timing bands (`P1`/`P2`/`P3`/`P8`) -- 235
of the 447 reachable owners (159 gov, 73 dia, 3 other) sit outside those bands entirely. Whether
"promotion" means widening the seller-prospecting population itself to all 447 reachable current
owners (buildable today, no new machinery -- BROKER1's default and the cadence engine both already
generalize), versus just fixing the label + the 6-owner broker gap + cadence gap for owners already
inside today's bands, is a scope call, not something to infer -- a prior standing decision
(`bd-ranking-and-priority-queue.md` §7, "do NOT widen the gate to `unknown` alone") was written
specifically to avoid silently widening this population, and while reachability (the missing piece
that refusal cited) is now satisfied, widening *what counts as a prospect* is still Scott's call, not
a default to make quietly. Full detail: `docs/architecture/ownership-truth-pipeline-state.md`
decision #6.

**Next**: awaiting Scott's answer on scope (a) vs (b) above. Once answered, the build is small:
extend/rerun `lcc_broker1_assign_prospect_brokers` (or the population it reads from) to the chosen
set, promote the `owner_role`/`behavioral_override` scalar, and seed `touchpoint_cadence` for anyone
reachable without a row yet. #2 (`canonical_name` unique constraint) remains the only other item
still gated, on reviewing the review-only tail from the OWN-T0c merge sweep -- not started.

## 2026-09-15 — the misparse guard IS blocking real brokers, and it is one rule (Cowork)

Triaged the 44 unreviewed `contact_misparse_review` items (**MISPARSE-BACKLOG1**) by reason, and the
queue splits cleanly. **`person_junk_name` (71 rejections) is ~99% correct** — "Marcus & Millichap"
x16, "Demographics" x7, "Cushman & Wakefield" x5, "View Less" x4, plus "Vice Chairman" / "Public REIT"
/ "CoStar Property Contact" — firms, page furniture and scraped labels, exactly what it is for. One
miss: **"Brian Lane"**, a real person whose surname is also a street word.

⚠️ **`email_fanout` (26 rejections) is the problem.** Roughly half are real, named brokers — Edward C.
Mann (x2), Bradley Lagomarsino, Clifford L. Lamar, Conrad Buhler, Dail Longaker, Debbie Gallimore
CCIM CIPS, Drew A. Flood, Jacob Fahner, James D. Collins, Nancy J. Bouton, Paul J. Collins, William M.
Collins — mixed with genuine junk ("Gross Income", "Vacancy", "PO Box 61381") and firm names. So
**HP1-P2misparse's worry is CONFIRMED and localized to one rule**, not to the guard as a whole.

⭐ **The fourth instance of "one signal, two meanings"** (after XB2-counter, `flag_long_dark`, and
DOC-TABLE2): one email on several contacts means either *a shared/generic inbox behind scraped junk*
or *a listing that legitimately names several brokers at one firm*, and `email_fanout` cannot tell
those apart. Prompt written: `prompts/MISPARSE1-email-fanout-is-blocking-real-brokers.md`, scoped to
`email_fanout` only, explicitly forbidding both weakening `person_junk_name` (it works) and bulk
auto-accepting the blocked contacts.

---


## 2026-09-15 — XB2-counter is live but unmerged; DEPLOY2 is live and in main (Cowork)

**XB2-counter verified against the live DB, not the summary.** `v_build_brief_producer_stall` returns
**0 rows**, `sidebar_contact_guard` is excluded (now 95 runs, still 0 completions — correctly silent),
and `pg_get_viewdef` shows the live body carrying `has_cron_trigger` and the cron predicate. CC also
repaired the duplicate-ID CI failure properly: `main` has **zero** duplicate backlog IDs.
🚨 **New class found — the exact mirror of DEPLOY2-unapplied → DEPLOY3-unmerged.** That migration is
**applied to production but absent from `main`**; it exists only on the still-open PR #2475 branch.
Rebuilding the DB from `main` would silently restore the old view and re-introduce the false positive,
and if the PR is closed or the branch pruned the only copy of that DDL goes with it — the loss BRANCH1
spent a round preventing. ⚠️ **DEPLOY2's brand-new detector is blind to this direction by construction:**
it enumerates `supabase/migrations/*.sql` and probes each declared object, so a change that is in the DB
with no file in the repo presents no file to enumerate. 👤 **Fix is trivial — merge PR #2475.**
**DEPLOY2 itself is genuinely live and in `main`:** snapshot 23 carries 5 `migration_unapplied` findings,
all `warn`/UNVERIFIABLE, 0 UNAPPLIED — matching CC's report exactly.
⚠️ **A flaw in my own guard, found while fixing two malformed rows.** Both had raw `|` inside code spans
(`` `'cron' | 'manual' | 'api'` ``, `` `FUNCTION|VIEW|TABLE|…` ``). GFM requires pipes escaped **even
inside code spans**, so those rows render broken on GitHub — but `backlog-table-shape`'s splitter is
backtick-aware and passes them. **My guard is more permissive than the renderer.** Pipes now escaped;
the guard should treat an unescaped pipe in a code span as a violation → **DOC-TABLE2**.
Brief is at 30 findings (24 + 5 migration_unapplied + 2 orphan prompts − 1 stall fixed); the two orphan
prompts were these two responses awaiting filing, now filed.


## 2026-09-15 — OWN-T0g closed: transfer-evidenced supersession rule shipped, live and forward-fixed (Cowork)

**Decision #3 of Scott's six compiled ownership-pipeline decisions — the riskiest one, a live
cron-critical ingestion path.** Scott's answer, verbatim: *"If there was a deed or a transfer of
ownership in some clear capacity, then the prior ownership has ended. Accuracy first."*

**Background** (`docs/audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md`, STATUS.md 09-14
OWN-T0g sizing): `lcc_finalize_entity_portfolios`'s gov branch computes its supersession window only
across the rows in the current inflight sync payload — a property whose ownership history is split
across two sync calls (pagination) never gets compared across that split, so an old current fact and
a new current fact for the same property can both sit at `ownership_end_date = null` forever. dia has
no supersession logic at all.

**Classified `ownership_source` producers by data, not assumption** (live query against
`lcc_entity_portfolio_facts`): `county_deed`, `gov_ownership_chain`, `sales_transaction`,
`sales_transactions_seller_exit` are genuine recorded transfer instruments. `gsa_lease_diff`,
`gsa_lease_lessor`, `lcc_property_owner`, `county_records`, `costar`/`costar_sidebar`, and null are
lease-record restatements, internal snapshots, or market data — not proof an ownership change
happened. Matched the sizing note's own prediction exactly.

**Sized the live blast radius before writing anything** (per the OWN-T0g note's own recommendation):
against `v_lcc_property_multi_current`'s 735 `multi_current_distinct_parties` population, 72
properties had a transfer-evidenced current fact competing with a stale current fact for a different
party. Of those, 57 were safe to auto-resolve (the stale fact's own last-known start date was on or
before the transfer's date, or unknown) — 15 were a genuine unresolved conflict (the "stale" fact was
itself dated *later* than the transfer, i.e. something claims to be even more current than the
recorded deed) and were deliberately left alone for `v_lcc_portfolio_ownership_conflict` / human
review, never guessed. The known genuine co-ownership case (gov/1708, The Greystone Group vs.
Silverstone Company, both real current owners per OWN-T0d's investigation) was checked explicitly and
correctly excluded — neither of its current facts carries transfer evidence.

**Shipped `lcc_own_t0g_supersede_by_transfer_evidence(p_dry_run, p_batch_tag)`** — for every property
with a transfer-evidenced current fact, ends the losing party's fact at the transfer's start date,
unless that losing fact's own start date is later (left as a genuine conflict). Reversible via
`lcc_own_t0g_revert_supersession(batch_tag)`, fully logged to `lcc_own_t0g_supersession_log`. Dry run
matched live exactly: **65 facts / 61 properties superseded**, 0 failures, batch `own_t0g_2026-09-15`.
Re-running the dry run afterward found **0** remaining — idempotent, self-terminating.
`v_lcc_property_multi_current`'s `multi_current_distinct_parties` count dropped **735 → 678**.
Re-verified gov/1708 unchanged after the live run — both current owners still current, correctly
untouched.

**Wired the forward fix**: `lcc_finalize_entity_portfolios` (live, `SECURITY DEFINER`, cron-driven,
both dia and gov domains) now calls the same supersession function, live, at the very end of every
run — after both domains' upserts, scanning the WHOLE table (cheap, ~14k rows), not just that run's
payload. This is what actually closes the cross-sync-batch gap: a property whose ownership history
arrives split across two separate sync calls now gets compared correctly regardless of which call each
fact came in on. Everything else in the function is byte-for-byte unchanged from the live definition
(verified via `pg_get_functiondef` before editing, diffed line-for-line). Ran the modified live
function (`select * from lcc_finalize_entity_portfolios()`) — no error, no unintended side effect:
`multi_current_distinct_parties` stayed at 678, 0 new log rows (correctly a no-op since nothing was
left to supersede).

**Migrations**: `supabase/migrations/20261102180000_lcc_own_t0g_transfer_supersession.sql` (log table +
`lcc_own_t0g_supersede_by_transfer_evidence` + `lcc_own_t0g_revert_supersession`),
`supabase/migrations/20261102190000_lcc_own_t0g_finalize_calls_supersession.sql` (the forward-fix
wiring into `lcc_finalize_entity_portfolios`, full function body preserved verbatim plus one new
`PERFORM` call). Both applied and run live on `xengecqvemvfknjvbvrq`.

**Next**: one decision remains open from Scott's six — **#6, owner-role promotion + cadence**
(current ownership in the target market promotes out of `unknown`, covering broker assigned, 7
touchpoints in the first 6 months then ~4/year, individualized by client). It's the most
product-shaped of the six and needs its own design pass — reviewing the existing cadence engine
(`UX-T1a-touchcount`, the P112 never-seed-a-cadence-with-no-contact-method doctrine) and the current
broker/market-assignment data before proposing anything. #2 (`canonical_name` unique constraint) stays
gated on reviewing the review-only tail from the OWN-T0c merge sweep.
## 2026-09-16 — Government answered, and a third window defect found on the way (Cowork)

🔴 **"Root → LCC Opps" is not true, and the shipped rule avoids a false critical only by luck.**
**31 root-level migrations carry a `gov_` or `dia_` prefix** and target the other two databases.
Probed live: `20260812120000_gov_credit_classifier_expand_state_federal.sql` declares
`public.gov_credit_buckets_from_text`, which is **absent from LCC Opps (count 0)** — so the moment one
of these enters the window, `migration_unapplied` fires a **false UNAPPLIED at `critical`**: loudest
severity, most trusted rule, for a migration that is correctly applied to the DB it was written for.
**0 of 60 are in window today — that is luck, not design, and DEPLOY2-coverage destroys it**, because a
git-add-date window reshuffles scope and any new root `gov_`/`dia_` file lands in it at once. Prompt now
requires routing by **target database** (directory AND filename prefix) and **failing closed**: an
undetermined target is UNVERIFIABLE with a reason, never defaulted to LCC.
👤 **Scott's decision: no government detector in this repo** → **GOVDEPLOY1** filed, not built.
`GOV_SUPABASE_URL` / `GOV_SUPABASE_KEY` are both in Production, so it is possible — declined because it
would mean this repo auditing a database it handed to `government-lease` on 2026-09-12 (ID3a-d), the
exact ownership confusion that decision ended.
⛔ **And it must not be closed by scanning `supabase/migrations/government/`.** That directory's own
README says re-applying its files *"would silently restore two known-bad mappings"* (`TEXAS DEPARTMENT
OF AGRICULTURE` → `USDA`; `Immigration & Customs Enforcement` → `CBP`) — a detector reading them would
report the **live, correct** government DB as wrong. The stale-copy problem and the coverage problem
look alike and are opposites.
📄 Visibility ships with DEPLOY2-coverage: **`docs/architecture/MIGRATION-COVERAGE-MAP.md`** — three
projects → owning repo → detector status → where it lives, linked from the collector, so the uncovered
database is attributed rather than quietly absent. It records the asymmetry too: a root `_gov_` file
here still targets the government project, so "government is out of scope" and "nothing here touches
the government DB" are different claims and only the first is true.

---

## 2026-09-16 — DEPLOY2-coverage prompted: fix the blind spot before shipping into it (Cowork)

🟢 **`prompts/DEPLOY2-coverage-the-detector-is-blind-to-its-own-incident.md`** (176 lines). Two window
fixes: window by **git add-date** instead of filename sort, and **scan `dialysis/`** — which means
routing those files to **Dialysis_DB `zqzrriwuavgrquhisnoa`** and deploying the probe RPC there too.
`government/` stays excluded; it really is retired and guarded.
**Sequenced ahead of OWNERGAP2 on purpose.** OWNERGAP2 is dialysis owner-matching, so its migration will
almost certainly land in `supabase/migrations/dialysis/` — the one directory the detector does not scan,
on the same arc that produced the incident the blind spot hides. Shipping into the blind spot first is
the avoidable mistake.
✅ Enabling facts confirmed before writing, not assumed: CI already sets `fetch-depth: 0`, so full git
history is available to the collector; and the repo's established second-project secret names are
`DIA_SUPABASE_URL` / `DIA_SUPABASE_SERVICE_KEY` (172 / 70 existing references).
⚠️ Hard requirements in the prompt: **a file with no git add-date sorts NEWEST, never dropped** (P180 —
an untracked migration is the freshest thing in the repo); **absent dia credentials the dia half emits a
`skipped` finding**, never a quiet root-only scan reported as clean (B6a); and OWNERGAP1's verdict is to
be stated even if it comes out UNVERIFIABLE, not massaged into APPLIED.
✅ **AMENDED same day — no secrets need adding, and my first draft was wrong about this.** Scott showed the
live Production secret list: `DIA_SUPABASE_URL` and `DIA_SUPABASE_KEY` are already set;
`DIA_SUPABASE_SERVICE_KEY` is not. ⚠️ Naming either one directly is a trap the repo already documented —
`api/_shared/supabase-keys.js` (issue #720) records that `DIA_SUPABASE_KEY` has *"historically held the anon
JWT ... despite the names suggesting otherwise"*, with a **Phase 4 mass-revoke of anon grants** planned. So the
anon name is scheduled for demolition and the service name does not exist yet. Prompt now requires the existing
resolver **`diaSupabaseKey()`** (prefers service, falls back to anon): works today, upgrades itself when the
service key lands, no second change. Dia probe grants `service_role` AND `anon` (`SECURITY INVOKER` kept —
pg_catalog is world-readable, nothing to escalate) with #720 Phase 4 named in-comment as when the anon grant
comes out. 🔍 Stated, not buried: until that revoke this grants object-name enumeration on Dialysis_DB to
anon-key holders. This is the third time this arc that **reading the existing module beat inventing a new
name** — same lesson as `hasFirmSuffix()` and `localPartMatchRule()`.
🔭 Left open deliberately: the `government` project (`scknotsqkcheojiaewwh`) will have no unapplied-migration
detector at all. Correct by design, but it is a real gap and the prompt asks for it to be surfaced, not solved.

---

## 2026-09-16 — DEPLOY2 reconciled: the detector is real, and it is blind to OWNERGAP1 (Cowork)

**The shipped work is good and I verified it rather than reading the claim.** `lcc_probe_schema_objects`
IS live on LCC Opps. The judgement calls were right: STALE was measured (3-of-12 extractor success, plus
a real FP from pg's `timestamptz` → `timestamp with time zone` rendering) and **correctly not shipped**;
the XB2-precision retrospective was **declared unreconstructible rather than claimed**. Both are the
honest answer, and both are what the prompt asked for.
⚠️ **But the window has two defects, and one of them is severe.** **(a) `dialysis/` was excluded on a
half-true justification.** Root-only was justified as "`dialysis/`/`government/` are historical copies."
That is right for `government/` — README, `HISTORICAL — DO NOT RE-APPLY` marker, its own guard test,
owned by `government-lease`. It is **wrong for `dialysis/`: 0 of 282 files carry the marker and there is
no README.** The gov retirement was generalized without checking. So
`dialysis/20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql` — **OWNERGAP1, one of the three
incidents DEPLOY2 exists to catch** — is outside the scan, and its own header calls itself "the
containment that IS in scope from this repo."
**(b) The window sorts by filename, and filenames are not a clock.** `MIGRATION_WINDOW_SIZE = 60`, floor
`20260930121500` — but timestamps are synthetic sequence numbers, so files land out of order. Measured:
**107 migrations added in the last 14 days, 64 outside the window, 24 of those root-level.** This is the
same class the prompt already killed once: a synthetic timestamp is not recency. Both filed as
**DEPLOY2-coverage** 🔴; fix is bounded (git add-date window + deploy the probe RPC to Dialysis_DB).
🔍 **Live evidence that DEPLOY2-stale is worth building, not just a nice-to-have.** The very next
migration after CC's run — `20261102190000_lcc_own_t0g_finalize_calls_supersession.sql` — `CREATE OR
REPLACE`s `lcc_finalize_entity_portfolios`, which **already existed**, so existence proves nothing. One
body probe settled it in a single query (`pg_get_functiondef` contains `t0g` → the change IS live). That
is the XB2-precision shape reappearing four days later.
✅ **Two older rows closed by the same reconcile.** PR #2475 merged, so **XB2-counter** and the immediate half of **DEPLOY3-unmerged** (applied-but-unmerged) are both closed — `20261102180000_lcc_xb2counter_producer_stall_scheduled_only.sql` is on `origin/main` at `988fd65c`. ⚠️ It arrived carrying a **filename collision**: `20261102180000` is now held by two migrations (xb2counter and own_t0g_transfer_supersession, PRs #2475 and #2477), created the same day by two branches that never saw each other. The 99th collision, and it lands squarely on DEPLOY2's filename-sorted window.
✅ Also verified applied live while reconciling: PR #2477's two own_t0g migrations (`lcc_own_t0g_supersession_log`,
`supersede_by_transfer_evidence`, `revert_supersession`) — all present.

---

## 2026-09-16 — DEPLOY2-unapplied: migration-merged-but-unapplied detector shipped

Third occurrence of the class (HP1-P1a-fix, OWNERGAP1, XB2-precision) got its own audit rule.
`scripts/build-brief-collector.mjs` gained `migration_unapplied`: parses the most recent 60 ROOT
`supabase/migrations/*.sql` files for declared `CREATE [OR REPLACE] FUNCTION|VIEW|TABLE|TRIGGER|
INDEX|TYPE|POLICY` objects and probes each against LCC Opps via a new narrow RPC
(`lcc_probe_schema_objects`, `20260916120100`, SECURITY INVOKER over pg_catalog, revoked from
anon/authenticated). Killed the obvious version-number design first (the prompt's own
pre-measurement showed it flags nearly every recent migration as unapplied, due to synthetic
timestamps). **Live measured: 100 unique objects, 0 UNAPPLIED, 5 UNVERIFIABLE** (genuine
ALTER/COMMENT/INSERT-only migrations, hand-confirmed). N15 stays a false-positive-free negative
control; a fabricated function name fires the positive control at `critical`. **STALE (normalized
`pg_get_functiondef` body diff) evaluated and NOT shipped** — a 12-function extraction sample found
the regex extractor unreliable (3/12 first pass) and, worse, a genuine false positive purely from
Postgres's canonical type rendering (`timestamptz` → `timestamp with time zone`) on an unambiguously
current function. Filed as **DEPLOY2-stale**, needs an AST-based extractor + type-alias-aware
comparator before it is safe. XB2-precision's own history is **not** reconstructible from a
point-in-time DB snapshot that does not exist — stated, not claimed. Full detail:
`docs/os/PLANNED-BACKLOG.md` DEPLOY2-unapplied row. Branch `claude/deploy2-unapplied-migration-audit`,
pushed, not merged.

---

## 2026-09-15 — XB2-counter: the build brief's only producer finding was a false positive (Cowork)

`producer_stall_not_flag_gated` fired on `sidebar_contact_guard` — an event counter written on
every sidebar capture (`trigger_source='sidebar_capture'`), not a scheduled producer; its `0
completions` is the correct steady state once dedupe has already notified a key (already
established under SIDEBARGUARD1/XB2-precision). Fixed structurally: `v_build_brief_producer_stall`
now requires `bool_or(trigger_source = 'cron')` per producer, so any FUTURE event counter is
excluded too, not just this one. Migration
`20261102180000_lcc_xb2counter_producer_stall_scheduled_only.sql`, applied live to LCC Opps.
Verified: `sidebar_contact_guard` excluded (negative control); a synthetic `trigger_source='cron'`
stalled producer, inserted+rolled back in one transaction, still caught (positive control, 0
residue). RPC findings 19 → 18 (`producer_stall_not_flag_gated` 1 → 0); next collector snapshot
should read 24 → 23. See backlog **XB2-counter** for the full writeup and **XB2-counter-eventguard**
(filed, not built — a replacement alert for the guard's own failure mode).

---

## 2026-09-15 — The 15 dark flags are ~5 decisions, and none of them is dead code (Cowork)

`flag_long_dark` is **15 of 24 findings (62%)** of the build brief, so triaged it into something Scott
can act on: `docs/audits/FLAG_LONG_DARK_TRIAGE_2026-09-15.md`.
⚠️ **Corrects my own earlier note.** I wrote that each dark flag is "either work to finish or code to
delete." **Checked all 15: every surface file exists and every flag is still referenced in live code** —
deletion is not on the table for any of them. And for most, "off" means **the env var was never set**:
`return !!process.env.OWNER_ENRICH_ADDRESS_URL`, with `sos-lookup.js` returning `reason: 'unconfigured'`.
These are **unconfigured adapters degrading honestly**, not disabled features.
**15 rows collapse to ~5 decisions:** nine flags are ONE question (stand up owner-enrichment adapters at
all?); two are the Salesforce list import (dark **108 days** — the oldest, and nobody has missed it,
which is itself an answer); one is save-not-send Outlook drafting (touches Northmarq IT constraints);
one is the CM treasury webhook (optional). `ENABLE_OWNERSHIP_RESEARCH_QUEUE` is the `government-lease`
repo's call, not this one's.
⭐ **Recommended first: `DECISION_OWNER_DEED_WINS`** — the only true feature toggle in the set. No
endpoint, no purchase, no IT conversation; just a policy call on whether a recorded deed overrides other
owner sources, and it sits squarely on the OWNERGAP true-owner thread. → **FLAGDARK1**
⭐ **Third instance of one rule-design flaw**, so it is worth naming as a class: after
`producer_stall_not_flag_gated` (event counter vs scheduled producer) and `market_brief_lane_stale`
(one gap vs five), `flag_long_dark` conflates *unconfigured* with *disabled*. The pattern is **a rule
reading one signal that carries two different meanings** — folded into **XB2-counter**.


## 2026-09-15 — T2b shipped: gov ownership resolution's second tranche fully applied (Cowork)

**Decision #5 of Scott's six compiled ownership-pipeline decisions.** Scott's answer, verbatim:
*"Yes, again, the objective is accurate coverage of all properties in our target submarket. We want
to get there as fast and efficiently as possible."*

**Background** (`docs/audits/C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md` §6,
`connectivity-and-open-threads.md` §4k.1): T2a (gov owners with ≥$100k aggregate rent) shipped
2026-08-28. T2b — the remaining below-$100k + rent-unknown tail, 2,241 properties / 2,054 owners —
was sized safe and cheap (predicted duplicate-group growth actually *lower* than T2a's measured
actual) but left unrun: "the decision is purely whether 'resolve all ownership, rank later' should
be applied to a population ~96% un-contactable today... **Not run. No default taken.**"

**Re-measured live before running** (population moves): `v_lcc_c2e_asset_mint_plan` — which
self-excludes anything already minted, so T2b's population is simply whatever remains after T2a —
held at 2,255 properties / 2,068 owners (805 under $50k / 712 at $50–100k / 537 rent-unknown),
essentially unchanged composition from the original 2,241/2,054 sizing three weeks ago.

**Ran the same mechanism T2a used**, no new code needed (per "review existing machinery before
building"): `lcc_mint_gov_asset_entities(p_rows, p_batch, p_dry_run)`. Dry run matched the live run
exactly — **2,255 would-mint → 2,255 minted, 0 skipped**, batch `t2b_gov_2026-09-15`. Drove the
evidence ingest explicitly in the same pass, as the mechanism requires (cron 225 caps at 400/run):
`lcc_ingest_domain_owner_evidence(false, 3000, 't2b_evidence_2026-09-15')` → **evidence_written
2,262, assets_resolved 2,255, ambiguous_logged 1**. The 7-row gap between written and resolved is the
identical guard T2a hit — all 7 residual `eligible` rows are brokerages (`Stan Johnson Co` ×4, `NAI
Pfefferle`, `Bradford Allen Realty Services`, `SVN®`), correctly filtered out by
`lcc_reconcile_property_owner`'s scoring CTE. Working as designed, not a defect.

**Result**: `v_lcc_c2e_asset_mint_plan` now reads **0** — gov asset-anchor resolution across both
tranches is fully applied. gov asset anchors now 10,255 (external_identities, `source_system='gov'`,
`source_type='asset'`); `lcc_property_owner` now 10,906 rows. Checked for a blowup on the two axes
T2a's own audit flagged (duplicate-candidate growth, Tier 0 card growth) — neither spiked; both
stayed in the range the pre-run sizing predicted.

**Next**: decisions #3 (OWN-T0g supersession rule — needs care, live cron ingestion path) and #6
(owner-role promotion + cadence — needs its own design pass) are the two remaining open items from
Scott's six. #2 (`canonical_name` unique constraint) is gated on reviewing the review-only tail from
the OWN-T0c merge sweep earlier today.
## 2026-09-15 — DEPLOY2-unapplied prompted; the obvious design was measured and killed first (Cowork)

**The N15 migration turned out to be APPLIED** — verified live rather than assumed: mint + unmint
functions and `lcc_n15_sf_campaign_hub_mint_log` all present, batch `n15_sf_campaign_2026-09-15`
carrying **1,475 rows**. So the merged-but-unapplied class is **3 of 4, not 4 of 4** — and that
counterexample is load-bearing, because an existence-only check passes N15 correctly *and* passes
XB2-precision incorrectly. Staleness, not existence, is the discriminator.
⚠️ **Pre-measured the obvious design before writing the prompt, and it is a dead end.** LCC Opps holds
**885 migration files** but only **742 unique version prefixes** (98 timestamps collide);
`supabase_migrations.schema_migrations` holds **770 rows**, newest `20260915142114` — **and no file is
named that**. The repo names migrations with *synthetic sequence* timestamps (`...120000`) while
Supabase stamps the *real apply clock*, so **87 file versions are dated after today**, out to
`20261102170000`. A `file_version NOT IN schema_migrations` rule would flag nearly every recent
migration as unapplied — wrong on its whole visible output, the **XB2-counter** failure on a second
rule in the same brief. The prompt forbids it by name.
🟢 **Prompt written: `prompts/DEPLOY2-unapplied-migration-detector.md`** (175 lines). Rule goes in
`scripts/build-brief-collector.mjs`, not the XB2 SQL RPC — that migration's own header sets the split
(filesystem state is not queryable from Postgres) and this rule needs both halves. Hard requirements:
**UNVERIFIABLE is a finding, never folded into APPLIED** (a data-only backfill is the exact shape that
merges and leaves no trace — P131/P180); a **positive control** (Class 11); and a
measure-the-FP-rate-first gate on the `pg_get_functiondef` normalized compare, with explicit
permission to ship UNAPPLIED+UNVERIFIABLE only and file STALE as a row if the noise is bad. ⛔ Report
only — the prompt forbids applying anything it finds, since some of the 87 future-dated files may be
staged deliberately.
🔭 Two things surfaced and deliberately NOT fixed: canon has **no block on migration application at
all**, and the synthetic-timestamp naming is its own 885-file / 98-collision change.

---

## 2026-09-15 — XB2-precision verified; SIDEBARGUARD1 disproved by reading the source it told me to read (Cowork)

**XB2-precision shipped and hit its acceptance target.** Snapshot 13: findings **32 → 24** (predicted
~23), lane findings aggregated **11 → 3**, `branch_debt` present. The collector produced **13 snapshots
in one day**, each tied to a merge commit — it is genuinely self-running now.
⚠️ **SIDEBARGUARD1 was a false positive, and my framing of it was wrong.** I had called it "either dead
code on a schedule or something unguarded for days". Neither. `sidebar_contact_guard` is an **event
counter**, not a scheduled producer — written on every sidebar capture, where `status='ok'` means
*"raised a NEW misparse review item"*. So **0 completions is the correct steady state** once dedupe has
notified a key. Evidence: 73 runs blocked 166 contacts, and **149 review items exist** (2026-08-10 →
09-14) of which a human **dismissed 105**. The surfacing path works; the guard works. I had written
"read the skip_reason's source before assuming either" into the row itself — doing that is what
disproved it, which is the only reason this did not become a wasted CC round.
**The real defect is in XB2's rule** → **XB2-counter**, now the brief's only wrong finding and therefore
load-bearing: a rule whose single visible output is known-wrong is the "monitor nobody trusts" failure
we have paid for three times already.
👤 **One genuine item survived:** **44 misparse reviews still `new`**, oldest 2026-08-10 (~36 days) →
**MISPARSE-BACKLOG1**. Matters because HP1-P2misparse is the thread about this guard rejecting REAL
people, and `person_junk_name` is the dominant rejection reason.
🔭 New shape of the brief: `flag_long_dark` is **15 of 24 findings (62%)**. Not a monitor defect — a real
backlog awaiting Scott's decision (11 dark >60 days, oldest since 2026-05-30).

## 2026-09-15 — `HCRIS-TIMEOUT-3` reviewed: the HCRIS fix itself is genuinely correct — the real culprit was the diagnostic instrument (`ingestion_tracker`) being blind, plus a second, previously-unnamed bug hiding behind it

`HCRIS-TIMEOUT-3`'s response (`"HCRIS TIMEOUT 3 surface response.docx"`, saved by Scott) read in full and
independently re-checked against Dialysis_DB. **Genuinely different shape of finding than the first two
rounds — not "the fix didn't work," but "the fix worked, and the instrument measuring it was broken."**

**(a) Re-read against the actual deployed code, confirmed clean.** `_download_and_extract`'s bounded
(connect, read) timeout and wall-clock deadline, `HCRIS_DOWNLOAD_TOTAL_TIMEOUT_SEC`/`CMS_HCRIS_INGEST_STEP_TIMEOUT_SEC`,
and `hcris_propagation`'s real call to `save_estimates_batch()` (no leftover dead call site to the old
per-row path) — all genuinely wired as designed. `HCRIS-TIMEOUT`'s original fix (PR #7410) is not the
defect.

**(b) The actual reason the symptom persisted: two previously-undiagnosed bugs in the tracker/heartbeat
mechanism itself**, not in HCRIS-specific code at all. `_write_step_heartbeat()` used one unretried
`.execute()` call on a long-lived Supabase client this repo's own code already documents as degrading late
in a run, failures logged at DEBUG — silently blind on nearly every run (this session's own spot-check:
126–129 of the last 140 `ingestion_tracker` rows carry blank `notes`, close to but not exactly matching the
response's own "139 of 140" figure — noted as a minor precision gap, not a substantive one). `finish_run()`
only retried twice versus `start_run()`'s already-hardened 6-attempt budget for the identical
connection-degradation symptom (`PRI3(e)`) — so a run that actually finishes still reads `started`/`NULL`
forever. **This is exactly `HCRIS-TRACKER-BLIND`, filed last round** — folded in and fixed here rather than
treated as separate, since the fix is the same mechanism.

**A genuinely new, materially important finding: `hcris_cost_reports` and `hcris_propagation` are failing
for their own, still-unidentified reason, separate from `run_timeout`.** The `"Failed steps: hcris_cost_reports,
hcris_propagation, run_timeout"` summary this arc has been reading for three rounds was never one failure —
it names two steps that fail on their own plus a budget cutoff that (per this round's live trace) hits a
**different, later, unnamed step**. The real per-step exception text was never captured anywhere before this
fix — `_log_ingestion_row()` now persists a `step_errors` map with the actual exception per failed step, so
the next run will finally say why `hcris_cost_reports` fails, instead of every round re-guessing. **Flagged,
not fixed, out of scope this round**: `qip_scores_ingestor.py` and `cms_deficiency_ingestor.py` — later,
optional steps in the same pipeline — still carry the exact bare `requests.get(timeout=300, stream=True)`
pattern `HCRIS-TIMEOUT`'s first round already root-caused and fixed for HCRIS, a plausible source of the
multi-hour `run_timeout` tail. New candidate backlog item, not yet a prompt.

**(d) Live proof still not obtained — correctly disclosed, not claimed.** No CMS/Railway egress from the
Claude Code sandbox, and the currently-stuck run (`bc5d3867…`, started 07:33:40 UTC, still `run_status='started'`
at DB time 14:21 UTC — 6.8+ hours in, independently re-confirmed) predates this fix and won't demonstrate it
either way. Scott confirmed `Dialysis` PR #7411 (commit `651c630`, branch `claude/lucid-wozniak-z996iw`)
merged. **The real test is the next full run cycle** — this time with `step_errors` actually populated, so
the next review reads the real cause directly instead of cross-referencing four Supabase tables by hand.
`HCRIS-TIMEOUT` stays 🔴 — not closed — pending that. Prompt moved to `docs/claude-code/prompts/done/`.

## 2026-09-15 — XB2-precision reconciled: the code shipped, the migration never did — third time for one class (Cowork)

PR #2460 merged and `main` carries both halves. The **JS half is live** — `branch_debt` fires in every snapshot
from 12:52 onward, so the 1,722-branch number is no longer silent. **The SQL half was never applied.**

Checked rather than assumed: the live `lcc_build_brief_db_audit()` still had **no `GROUP BY`** and was still
emitting `format('%s/%s', lane, section)` — one finding per cell. Snapshots 7 through 11 all read **32 findings
with 11 lane rows**, unchanged, including the newest at 14:16. **The prompt's stated deliverable was a
before/after findings table after applying and redeploying — the "after" never existed**, so what looked like a
shipped precision fix had changed nothing on the DB side.

✅ **Applied it live.** DB-side findings **27 → 19**; the lane rule collapses **11 → 3** (`government`,
`net_lease`, `dialysis`), with every affected section now named inside `measured` instead of restated as its own
row. Flags (15) and the stall rule (1) are untouched, so the next collector run should read **≈24** total against
the prompt's predicted ~23.

🚨 **This is the THIRD time the same class has bitten, and that is the finding worth more than the fix.**
**HP1-P1a-fix**: migration merged, unapplied — the deployed code called an RPC that did not exist and would have
404'd all 608 deals every 30 minutes. **OWNERGAP1**: caught only because a verification step happened to run.
**XB2-precision**: merged, unapplied — and everybody, including the session that shipped it, believed the count
had dropped.

⚠️ **Prose has failed three times.** `CLAUDE.md`'s *"merged is not running"* doctrine covers **code**, and it
works — `/version` against `main` is a real check that this session has used repeatedly. There is **no equivalent
for migrations**, and that is the actual hole.

✅ **Filed as `DEPLOY2-unapplied`, with the fix that fits: make it an XB2 rule.** XB2 already exists to catch
"looks live, does nothing" — having the self-audit system flag a migration on `main` whose object is absent or
structurally stale in the live DB is the right owner for this. ⚠️ And the rule needs a **staleness** test, not an
existence test: existence alone would have passed XB2-precision, because the function existed — it was just the
old body. Hashing the file's `CREATE` block against `pg_get_functiondef` is one option to evaluate.

## 2026-09-15 — N15 closed: 1,475 Salesforce-campaign orphans minted as unified_contacts hub rows (Cowork)

**Decision #4 of Scott's six compiled ownership-pipeline decisions.** Scott's answer, verbatim:
*"These are members of a specific group? Usually means that there is some vested interest in the
space mapped by the name. Some may be brokers, some may be a new fund exploring the space, but the
vast majority will be owners or prior owners and the membership is evidence that some prior research
has concluded that in our team's BD history and just because the LCC doesn't yet have that connection
mapped, does not mean that its not out there undiscovered."*

**Background** (P197, `docs/audits/P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md` §4): of the live person
entities with an email and no `unified_contacts` hub row, membership in a Salesforce campaign (via
`lcc_sf_list_membership`) was measured as "the only gate that discriminates" among candidate criteria
— 1,475 admitted. P197 explicitly did not mint ("an operator-surface decision with a blast radius")
and filed it for Scott as this backlog row.

**Re-measured live before building anything** (re-measure-before-acting discipline, this population
moves): total email-orphan population grew from 5,193 to **5,672** since P197, but the SF-campaign
gate held at exactly **1,475** — `lcc_sf_list_membership` turns out to be a frozen 2026-07-16→07-21
snapshot, not a live-syncing producer. Worth its own follow-up (the campaign-membership signal itself
is stale for anything captured since July), not fixed in this pass. Sampled the 1,475 before minting:
side distribution seller 1,030 / unknown 416 / buyer 88 — consistent with Scott's "vast majority will
be owners" read; 15 random rows spot-checked, all real BD-relevant names and campaigns (`VCA Animal
Hospital Owners`, `DMR Urgent Care Owners`, `SAB GSA Prospects`, `GSA Buyer`). Checked mint-collision
risk the way P197 did for its own would-be reconcile: 0 of the 1,475 already resolve to a hub row
under `sf_contact_id`.

**Shipped `lcc_n15_mint_sf_campaign_hub_rows(dry_run, batch_tag)`** — one hub row per entity, picking
the best of that entity's campaign-membership rows (domain-confirmed company preferred, else most
recent). **Never fabricates `company_name`** — reuses the exact `lcc_tier0_company_confirms_domain`
gate P197 built after finding that a bare campaign company label is a human/capture field, not an
employer register, and copying it verbatim manufactures employers (city/zip strings, the person's own
name, a different firm, a bank). Dry run matched live exactly: 1,475 would-create → 1,475 created, 0
failures. Only 228 (15%) got a domain-confirmed `company_name` written; the other 1,247 correctly
render with no company rather than a guess — honest "Not on file," per standing doctrine. Fully logged
to `lcc_n15_sf_campaign_hub_mint_log`, batch `n15_sf_campaign_2026-09-15`, reversible via
`lcc_n15_unmint_sf_campaign_hub_rows('n15_sf_campaign_2026-09-15')`. Migration:
`supabase/migrations/20261102170000_lcc_n15_sf_campaign_hub_mint.sql`.

**Scope, stated plainly**: this does not touch the remaining ~4,197 email orphans outside the
SF-campaign gate, and does not itself change Tier 0's `no_employer_on_file` blockage — P197 already
fixed that separately with a read-time resolver (`lcc_tier0_employer_on_file`), and this row's own
audit found minting hub rows would only have helped 4 of 73 blocking people. This is Scott's stated
connectivity-coverage goal ("truth and accuracy... pushed toward 100%"), not a Tier 0 fix.

**Next**: decisions #3 (OWN-T0g supersession rule), #5 (T2b), #6 (owner-role promotion + cadence) are
still open with decided rules, not yet built. #2 (`canonical_name` unique constraint) is gated on
reviewing the remaining canonical-name collision tail from earlier today's OWN-T0c sweep.
## 2026-09-15 — OWNERGAP2 prompt: the first BUILD in the owner arc, deliberately two adapters wide (Cowork)

The sampling has done its job — two measured rates (Philadelphia **68%**, Harris **86%**), three named miss
causes, and a demonstrated free path. Written the build prompt:
`prompts/OWNERGAP2-match-owners-from-free-sources.md`.

✅ **Checked the existing machinery first, and it changes the shape of the build.** `recorded_owners` **already
exists with 7,487 rows** — `name`, `normalized_name`, `normalized_address`, `source`, `entity_type`,
`registered_agent_*`, `filing_*` — and **5,467 of 11,815 properties already carry a `recorded_owner_id`**. The
destination is built and working for 46% of the book; the 4,021 are the hole in it. **So the prompt forbids a new
table** and scopes the work to *adapters plus a provenance contract*.

🚨 **The provenance contract is the whole prompt, and it is written that way because of what this arc already
found.** Every owner written must cite the source row — jurisdiction, that source's own record id, the query.
**No model may produce an owner name**: a name is copied from a fetched record or it does not exist. A local model
may only normalise and match strings already fetched, and even then the value written is the **source's** string,
not the model's rendering of it. A miss stays `recorded_owner_id IS NULL` and gets reported — **never** filled
from the operator, which would be PDR2 undone.

🔑 **One free gift from the measurement, written into the design:** Harris types every account `Personal` or
`Commercial`, so the assessor draws the operator-vs-owner line for us. The matcher keys on that account type
rather than re-deriving it from name text — which is precisely the mistake PDR2 fixed.

**The two cheap miss causes are handled; the third is refused.** Ranges (`4126 Walnut` ↔ `4126-38 WALNUT ST`) and
aliases (Cypress Creek Pkwy = FM 1960, from an explicit evidence-grown list, **never** by loosening the match
until something returns). Multi-parcel sites — `3300 Henry Ave` returns six owning LPs — are left unresolved and
flagged `needs_parcel_discriminator`. **Guessing which LP would be exactly the failure this arc exists to stop.**

⚠️ **Explicit ambiguity rules**, because this is where a wrong owner gets minted: more than one candidate, a
non-exact house-number-and-street match, or a matched name that is itself an operator → **write nothing, flag,
report**. And the gate requires **hand-checking 5 written owners against the live source** — a match rate is not
proof the right name landed on the right property.

Scope is held deliberately small: **two adapters**, no national pipeline, no scheduler, no `county_authorities`,
and no attempt on a CAPTCHA-gated portal. The closing ask is one number: **how many of the 4,021 now have an
owner.**

## 2026-09-15 — ⚠️ `HCRIS-TIMEOUT-2` reviewed, and a prior round's own STATUS/backlog edits never made it to `main` — a real process bug found and worked around

**Two things happened this round.**

**(1) `HCRIS-TIMEOUT-2` reviewed** (this round's response, re-verified live before filing — details below,
since the entry documenting this got lost, see (2)): could not confirm the deployed commit SHA (no Railway
tool access), but independently re-verified three of the response's claims live: zero `public_data_snapshots`
rows ever for HCRIS; the failed run's timing decomposing into 4 URLs × ~4.5h each, matching the OLD
unbounded-timeout bug's signature; and an 8,894-error burst followed by 17h46m of silence. Filed
`HCRIS-TRACKER-BLIND` (below) for a second, unrelated defect found along the way.

**(2) Scott then confirmed Dialysis PR #7410 (the HCRIS fix) is deployed on Railway**, and uploaded a log
snippet claiming the most recent run finished in ~90 minutes. **Checked live rather than accepting that at
face value — the database evidence contradicts it.** The most recent `ingestion_tracker` row (`bc5d3867…`,
started 2026-09-15 07:33:40 UTC) is still `run_status='started'`, `finished_at=NULL` at DB time 13:07:43 UTC
— **5.5+ hours later, not 90 minutes** — and `run_log` has zero entries of any kind after the initial
startup batch at 07:33:37–07:41. `facility_cost_reports` is still frozen at 2026-03-16 (0 rows touched
today), and `public_data_snapshots` still has zero HCRIS rows, ever. **The uploaded log file itself only
covers a 20-second slice at the run's startup (07:34:06–07:34:26 UTC) — it cannot show the run finishing**,
same limitation as the previous log upload in this arc. **With the deploy now confirmed, this squarely
answers `HCRIS-TIMEOUT-2`'s catalog item (a) — the merged fix IS what's running — which means the symptom
persisting is now item (b): a residual bug in the fix's own code, not a stale deploy.** Asked Scott where
the "~90 minutes" observation came from (Railway dashboard/process view), since it doesn't match what
Supabase shows. New follow-up prompt drafted:
`docs/claude-code/prompts/HCRIS-TIMEOUT-3-deploy-confirmed-still-hung-re-diagnose-the-actual-deployed-code.md`.

**A separate, purely mechanical finding, also from this round: this file and `PLANNED-BACKLOG.md`'s prior
`HCRIS-TIMEOUT-2` entries were silently dropped and never reached `main`.** The merged PR
(`docs/hcris-timeout-2-reviewed`, #2462) contains only the new response `.md` file — `git show --stat`
confirms it. Root cause: the recovery pattern this arc has used for the recurring `checkout -b` failure
(`git branch <name> HEAD` → `git reset --hard origin/main` → `git checkout <name>`) captures only committed
history in the `git branch` step; STATUS.md/PLANNED-BACKLOG.md had been written to Scott's working tree via
the file bridge but were still **uncommitted**, so the very next step, `git reset --hard origin/main`,
silently discarded those two files' edits before `git add` ever ran. The new response file survived only
because it was untracked, and `reset --hard` doesn't touch untracked files. **This pattern is retired as of
this round.** New default: `git checkout -b <branch>` with no explicit start-point (branches from current
HEAD in place, carrying uncommitted changes forward, never touches origin/main), used in this round's git
block instead.

## 2026-09-15 — XB2-precision shipped: `branch_debt` rule + per-lane market-brief aggregation (Cowork)

Both gaps from the XB2-precision reconcile below are fixed. (a) New rule `branch_debt`
(`branchDebtFinding`, `scripts/build-brief-collector.mjs`) fires on `total_remote` alone (warn,
threshold 200, growth trend from a prior snapshot when fetchable) — the count was already recorded
in the payload and never surfaced as a finding. (b) `lcc_build_brief_db_audit()`'s
`market_brief_lane_stale_or_missing` rule now emits ONE finding per LANE, not per lane×section,
with `missing_sections`/`stale_sections` named in `measured`. Lane list left untouched (the
retraction below stands — `net_lease` is the MB9 survivor, not a retired lane). 22/22 tests pass.
Not yet re-measured live post-deploy — next step is a fresh collector run against the redeployed
migration and the before/after findings-count table (32 → ~23 predicted).

---

## 2026-09-15 — OWN-T0c trailing-"The" adopted + the general fuzzy-merge sweep it unblocked; N3c/bank-trustee exclusion also merged (Cowork)

**Scott answered all six compiled open decisions at once (2026-09-14 → 2026-09-15).** This entry
closes decision #1 (trailing "The"); items #2–#6 are filed as their own open threads below and in
`docs/architecture/ownership-truth-pipeline-state.md`'s "Open decisions" section, which is being
updated in the same pass.

**Decision #1 — "if they are the same entities, merge... I don't have a preference about the naming
structure."** `lcc_entity_name_tokens` now strips a trailing "The" token, not just a leading one (this
re-applies, with explicit authorization, the exact change built-then-reverted on 2026-09-14 as
`own_t0c_trailing_the_2026-09-14`). 12 confirmed collision groups (16 entities) merged live via
`lcc_merge_entity`. Effect on the property-conflict-scoped `duplicate_entity` class: 1,183 → 1,177
(only -6) — confirmed most of that population is a **separate** collision class, not explained by
trailing-"The" alone.

**Reviewed existing machinery before building anything new (standing doctrine)** and found the real
scope of Scott's decision was already served by `v_lcc_merge_candidates` + the dormant
`lcc_apply_fuzzy_merges(dry_run, [limit])` — a mature, already-built auto-mergeable detector with
role-priority survivor selection, Salesforce-account-aware guards, name-similarity gating, and a
"pinned" protection for bridged unknown-role entities, applying through the same guarded
`lcc_merge_entity` primitive `lcc_repair_tombstone_portfolio_facts` (OWN-T0d) also uses. Full
canonical_name collision population measured first: **6,636 groups / 14,007 entities** (not scoped to
property conflicts — this is the true size of "if they are the same entities, merge"). Dry run showed
3,021 groups / 3,305 entities `auto_mergeable = true`; sampled for false positives (short-code LLC
names, DBA/legal variants — `cbre`→`CBRE Group, Inc.`, 4-letter LLC codes, etc.) — sane. **Ran live**:
`lcc_apply_fuzzy_merges(false)` — 3,021 groups applied, 3,305 entities merged, 0 failures, fully logged
to `lcc_entity_merge_log` (reversible per-row, same snapshot mechanism as every other merge this
session).

**Result**: canonical_name collision population 6,636/14,007 → **3,772/8,005** groups/entities.
`duplicate_entity` class: 1,177 → **930**. Remaining population is the harder, review-gated tail
`v_lcc_merge_candidates` already routes away from auto-merge: `bridged_unknown_pinned` (1,644g/3,538e),
`no_role_or_sf_signal` (337g/682e), `multiple_sf_accounts` (89g/193e), `low_name_similarity`
(64g/143e), `normalizer_blind_review_only` (64g/175e) — **not** swept here; needs its own review pass
since the view's gates exist precisely because same-canonical-name alone isn't proof of same-entity in
these cases.

**JS/SQL parity kept intact.** `test/entity-canonical-key.test.mjs`'s corpus contradicted the newly
adopted rule (`'Penstar Group, The' → 'penstar group the'`) — updated to the live-verified value
(`'penstar group'`), and `api/_shared/entity-link.js`'s `entityNameTokens()` rewritten to mirror the
SQL's exact `ord`/`total` window semantics, **including a real quirk**: a trailing "The" strips only
when it lands exactly at the post-stoplist survivor count, so a legal-form word (Inc./Co./LLC/...)
anywhere before the "The" prevents the strip (`'Edwin Mcintyre Co., Inc., The'` stays
`'edwin mcintyre co the'`, unstripped — confirmed this is the live SQL's actual behavior, not a JS bug,
and documented in both files so a future session doesn't "fix" it without re-running the backfill and
merge sweep). All 8 subtests in `test/entity-canonical-key.test.mjs` pass. Migration:
`supabase/migrations/20261102160000_lcc_own_t0c_trailing_the_and_fuzzy_merge_sweep.sql`.

**Also merged this window** (built and shipped just before the six-decision answer, PR #2456 already
on `main`): OWN-T0/N3c bank-and-CMBS-trustee prospecting exclusion
(`lcc_owner_name_is_bank_or_trustee`, OR'd into the single `lcc_owner_name_is_not_prospected` choke
point) — 11 owner names excluded live, 0 false positives against individual/family trustees or credit
unions. Closes N3c (`tier0-owner-contact-system.md` §6).

**Open-threads table restored to the top of this file** — a concurrent session's 09-15 entry had been
prepended above it (line 47, past the guard's 40-line limit), reproducing the exact failure mode the
table's own header comment warns about. Reordered, no content dropped; `status-header-integrity` and
`status-line-budget` both pass again.

**Next**: decisions #2 (canonical_name unique constraint — gated on this sweep's result, now much
closer), #3 (OWN-T0g supersession rule), #4 (Salesforce-campaign orphans, N15), #5 (T2b), #6
(owner-role promotion + cadence) are still open, each filed as its own thread in
`ownership-truth-pipeline-state.md`.
## 2026-09-15 — XB2-precision scoped, and I retracted a claim I had already merged (Cowork)

⚠️ **Correction first.** The XB reconcile (PR #2458, merged) asserted that `v_market_brief_staleness`
"reports staleness on a retired lane" because MB9 collapsed `net_lease`. **Wrong.** MB9 collapsed
**`broad_net_lease` INTO `net_lease`** — `net_lease` is the survivor, and the view's three lanes match
`KNOWN_LANES` in `api/_shared/market-brief-render.js` exactly. I read a collapse as a retirement and
asserted it without checking the constant, then shipped it. Corrected at the source in both STATUS and
PLANNED-BACKLOG rather than quietly edited, and the prompt carries the retraction so CC does not "fix" a
view that is already correct.
**The aggregation half stands and is what the prompt covers:** `market_brief_lane_stale_or_missing`
emits per lane×section, so one known fact — no producer has ever written a government or net-lease fact
— becomes **11 of 32 findings (34%)**, burying the one genuinely new find in the same snapshot
(`SIDEBARGUARD1`). Fix is one finding per lane with sections as detail.
**Also measured the trend, not just the level:** remote branches **1,718 → 1,722** in a day, ~4/day. The
collector already records `total_remote` and **no rule fires on it** — the biggest number in the repo,
captured and silent, the same shape as `item_count` before MB2b. Prompt notes why `unmerged` reads 0
(a CI clone has no local branches, so local debt is unmeasurable there by construction — 0 is honest,
not a bug) so nobody "fixes" it into a rule that reads 0 forever and looks healthy.
Acceptance target given to CC: findings **32 → ~23**, with `branch_debt` newly present.



## 2026-09-15 — Harris measured at 86%; two jurisdictions now, and the county hands us PDR2's distinction for free (Cowork)

Second match-rate test, sampled the way a person would do it — HCAD's public search, seven owner-unknown
properties, address by address. **6 of 7 = 86%**, against Philadelphia's 68%.

**Owners recovered:** `CRENSHAW MOB LLC` (FKC Pasadena-Crenshaw) · `BEAMER SCARSDALE LP` (DaVita Sagemeadow) ·
`ROY AND VEVA MORRISON RANCH CORPORATION` (DaVita Garden Oaks) · `US INVESTMENTS` (DaVita Inwood) ·
`AALS PROPERTIES LLC` (FKC Atascocita) · `FULTON SHOPPING CENTER INC` (FMC Moody Park).

🔑 **The most useful finding is structural, not the rate.** Every Harris hit returned two or three accounts at the
same address, **typed by the county itself as `Personal` or `Commercial`** — the tenant's equipment account
(`PIKE DIALYSIS LLC`, `HOLDREGE DIALYSIS LLC`, `BIO-MEDICAL APPLICATIONS OF TEXAS INC`) versus the real property
owner. **That is PDR2's operator-vs-owner distinction, drawn for us, for free, by the assessor.** A matcher should
key on that account type rather than re-deriving operator-vs-owner from name text — which is what LCC was doing
wrong in the first place.

⚠️ **The single miss is a THIRD failure mode.** `4427 Cypress Creek Pkwy` returned Cypress Grove Ln, Cypress Pond
Ct and W Cypress Villas — wrong street entirely, because Cypress Creek Parkway is Houston's renamed **FM 1960**
and HCAD indexes the name it holds. A **street alias**, not a formatting difference, and the one cause a string
normaliser **cannot** fix from our data alone.

**Three miss causes now identified, all cheap, none needing paid data:** address **ranges** (Philadelphia,
`4126-38 WALNUT ST`) · street **aliases** (Harris, FM 1960) · **multi-parcel** sites (3300 Henry Ave → six owning
LPs, needs a parcel discriminator).

⚠️ **Miami-Dade was NOT sampled**, and that is stated rather than implied — two rates of 68% and 86% would not
have been changed by a third, and the sampling has done its job.

👤 **Recommendation, unchanged in direction and far better evidenced:** build nothing yet. The next unit of real
work is a **matcher against free sources**, scoped by those three miss causes, starting with jurisdictions that
publish bulk files or open APIs. A paid provider stays relevant only for **LA-shaped** counties that publish no
owner at all — now demonstrably a small fraction of the 4,021 rather than the whole of it. Audit doc §9.

## 2026-09-15 — ⚠️ `HCRIS-TIMEOUT`'s merged fix did NOT resolve the symptom — live-verified, re-opened as `HCRIS-TIMEOUT-2`

Scott confirmed the `Dialysis` PR (`claude/hcris-timeout-fix-01BWJTdN`) merged and triggered a fresh run to
prove it live. **Checked the actual result rather than accepting "the run finished successfully" — it did
not fix anything.**

The post-merge run (`ingestion_tracker` row `84e215c3…`, started 2026-09-14 13:35:03 UTC, genuinely after
the merge) ran for **17.98 hours** — longer than any pre-fix cycle (13.6h/14.9h) — and its `run_log`
summary reads the **identical** `"Failed steps: hcris_cost_reports, hcris_propagation, run_timeout"`
signature as before. `facility_cost_reports` remains frozen at 2026-03-16 (now 183 days), zero writes in
the trailing 24 hours. Not a smaller regression — the run took longer and produced the exact same failure,
the opposite of what a working fix should do.

**Two live hypotheses, not yet determined**: either the Railway redeploy never actually picked up the
merged commit (checking the deployed commit SHA against the merge SHA is the first thing the follow-up
prompt asks for, before any further code diagnosis), or the fix as coded has a residual bug that didn't
show up in the test suite. `PLANNED-BACKLOG.md`'s `HCRIS-TIMEOUT` row reopened to 🔴 with the live evidence
recorded plainly, not closed as done. New prompt drafted:
`docs/claude-code/prompts/HCRIS-TIMEOUT-2-fix-did-not-resolve-symptom-first-check-if-the-merged-commit-is-actually-deployed.md`
— deliberately ordered to confirm deployment before re-diagnosing code that may not even be running.




## 2026-09-15 — XB1/XB2 live, and the build brief is already running itself (Cowork)

**The third of Scott's three original P18 asks is now live.** PR #2456 merged;
`build_brief_snapshots` holds 2 rows — and snapshot 2 carries `commit_sha 3f391fb1`, generated
**11:42 UTC by the GitHub Action on the merge itself**, not by a human. The collector looks without
being asked, which was the whole point.
✅ **The rule refinement holds structurally, not just in prose.** `producer_stall_not_flag_gated` fires
on exactly one subject and stays silent on `p_rss`, because the SQL excludes `^flag \S+ is off$` rather
than trusting a future reader to remember the distinction. The orphan-prompt false positive is fixed too.
⭐ **First genuinely new find: `sidebar_contact_guard` has run 69 times and completed zero times, ever**
(31 runs on 09-14, so still accruing). Every run skips for an *operational* reason. Either it is dead code
on a schedule, or whatever it guards has been unguarded for days. Nobody was watching producer completion
before this. → **SIDEBARGUARD1**
🔴 **Two precision gaps, both the failure XB2 was scoped to avoid → XB2-precision.** (a) The biggest
number is **measured and silent**: `branches.total_remote = 1,722` sits in the payload with no rule
firing on it — the same "recorded but not surfaced" shape as `item_count` before MB2b. And
`branches.unmerged` reads 0 because a CI clone has no local branches, so **local branch debt is
unmeasurable from CI by construction**; only the remote count works there. (b) `market_brief_lane_stale`
emits per lane×section, turning one known gap into **10 of 32 findings (31%)** . ⚠️ **I also claimed it reports on `net_lease`, "a lane MB9 collapsed" — that was wrong and is retracted:
MB9 collapsed `broad_net_lease` INTO `net_lease`, so `net_lease` is the survivor and the view's lanes match
`KNOWN_LANES` exactly.** I read a collapse as a retirement without checking the constant. The aggregation half
stands. A brief where a third of the findings restate one known fact is on
its way to being a brief nobody reads.


## 2026-09-14 — XB1+XB2 shipped: the build-brief collector, live-verified against the hand run (Cowork)

`scripts/build-brief-collector.mjs` (branch debt, orphaned prompts, doc sizes, GENERATED-file
changes) + `public.lcc_build_brief_db_audit()` (flag-long-dark, producer-stall-not-flag-gated,
market-brief lane staleness) write one `build_brief_snapshots` row via
`.github/workflows/build-brief-collector.yml` (push to `main` + nightly), read via
`GET /api/admin?_route=build-brief-latest`. **No dashboard** — `#/exec` is XB3, unbuilt. First live
snapshot **id=1, 32 findings**, reproducing the hand-run's numbers (15 flags off >3wk, 1 producer
stall — `sidebar_contact_guard`, `p_rss` correctly silent). Orphan-prompt false positive fixed
(substring match on leading ID token, recursive across `responses/`). Doc contradictions / dated
re-measure age / flags-no-consumer deliberately deferred (`XB2-followup`) — too fuzzy for v1
without false positives. Guard `test/xb1-xb2-build-brief-collector.test.mjs` (19/19 green), full
suite 6266/0. Detail: `docs/os/PLANNED-BACKLOG.md` XB1/XB2.

---

## 2026-09-14 — CONSOLIDATE3 was never actually shipped, and STATUS had buried its own index (Cowork)

Extracting the test file from the rescued branch `docs/consolidate3-headroom-and-table-fix-2026-09-12`
turned up a **false ✅**: `PLANNED-BACKLOG` has claimed since 2026-09-12 that CONSOLIDATE3 shipped
"budget raised to 3,000 with an 80%-mark soft warning" and a table-placement guard. **`main` had
`LINE_BUDGET = 2500`, no warning, and no guard** — all of it lived only on that unmerged branch. Third
"claimed shipped, actually isn't" of the day, after the undeployed edge function and the unregistered
flag row; precisely the doc-contradiction rule **XB2** is meant to catch without a human looking.
**The guard, once applied, immediately failed against `main` — correctly.** `## Open threads` sat at
line **1,781**, not the first 40. Cause: **this file gave two contradictory instructions.** The
convention block said *"new entries go DIRECTLY BELOW this block"*, while the table's own header said
*"new entries go BELOW the `---`"*. The header won, so every session prepending above the table pushed
it down — **Cowork's own ~8 entries today are the bulk of that drift.**
Fixed: table moved back to the top (now line 25), the convention block rewritten to point at the
table's `---` so the two no longer disagree, and the stale "Line budget: 2,500" text corrected to 3,000
with the 80% warning. Guards: 10/10 green. ⚠️ PRs **#2448** and **#2452** should be **closed unmerged** —
#2448 carries a 2-day-old STATUS snapshot that would overwrite this, and #2452 would revert a
2026-06-20 brand-font fix in the lease-comps template. Both branches stay on origin (BRANCH1).


## 2026-09-14 — N3c decided and shipped: banks/CMBS trustees excluded; full open-decisions list compiled (Cowork)

Scott's call on N3c: banks and CMBS trustees are their own excluded category, same as public bodies
and universities, "for now" -- explicitly revisitable if lender prospecting via Northmarq debt-side
coordination comes up later.

Reviewed existing machinery first: `lcc_owner_name_is_not_prospected` is already the single choke
point excluding public bodies/universities from prospecting, feeding 7 views (Tier 0 lane, seller
prospect universe, loan maturity worklist, etc.). Added `lcc_owner_name_is_bank_or_trustee` and wired
it into that same function rather than building a new mechanism. Sized the regex against live data
before shipping: 11 owner names match today (10 national banks + 1 JPMorgan CMBS trust), 0 false
positives against individual/family trustees (e.g. "Tony Martin, Trustee" correctly stays
prospectable), 0 credit unions swept in (deliberately -- member-owned, can be legitimate
owner-occupant prospects, a different category from a bank/CMBS trustee holding title incidentally).
Verified live: Wells Fargo Bank NA and the JPMorgan CMBS trust are now gone from
`v_lcc_tier0_owner_contact_lane_open`. Migration:
`supabase/migrations/20261102150000_lcc_own_t0_bank_cmbs_trustee_exclusion.sql`.

Also found fcp/tmg's sponsor-domain proposals (the other N3-adjacent open item) have gone stale --
zero live rows in `v_lcc_tier0_sponsor_map_proposals` today, re-checked live. Not re-raising a
decision with no population behind it.

Per Scott's request, compiled every remaining genuine open decision across the whole ownership→contact
chain into one place: `ownership-truth-pipeline-state.md`'s new "Open decisions — needs Scott" section.
Six items: trailing-"The" canonical key (`OWN-T0b/c`), `entities.canonical_name` unique-key enforcement
(`N15c`, blocked by the first), `lcc_finalize_entity_portfolios`'s supersession rule (`OWN-T0g`), 1,475
Salesforce-campaign orphans (`N15`), whether to widen ownership resolution to the remaining 2,241
properties (`T2b`, safe/cheap but low-value -- only 3.7% contactable), and what evidence promotes an
owner out of `unknown` role (doctrine question from `connectivity-and-open-threads.md` §4o). Also added
a "Where we are toward 100%" snapshot table with every load-bearing metric measured this session and
the sessions before it, and an honest read: the mechanisms keep getting fixed (auto-attach now writes,
tombstones cleared, bank/trustee category closed) but the headline 13% owner-to-person linkage number
has barely moved (13.5% now) because the entity-dedup residue upstream is the real blocker.
## 2026-09-14 — Match rate measured: Philadelphia returns ~68%, and it found a two-property owner on the first pass (Cowork)

§7 said download one free file and measure the **match rate**, because coverage is not a hit rate. Done, live,
against Philadelphia's free public open-data endpoint (`phl.carto.com/api/v2/sql`, `opa_properties_public`) — no
scraping, no login, no vendor.

**Pass 1, exact address: 9 of 22 distinct addresses. Pass 2, house-number prefix + street: 6 more. ≈ 68%.**

🔑 **Every pass-1 miss had one cause, and it is trivial:** Philadelphia stores address **ranges**; LCC stores the
lead number. `4126 Walnut St` ↔ `4126-38 WALNUT ST`. `1300 W. Lehigh Ave` ↔ `1300-24 W LEHIGH AVE`.
`1172 S Broad` ↔ `1172-74 S BROAD ST`. That is an **address-normalisation** problem — exactly the lane
`OWNERGAP1-ollama` reserves for a local model — **not** a data-availability one.

**Fifteen real, callable owners came back**, including `UNIV CITY ASSOCIATES` (DaVita 42nd St), `SIX G'S L P`
(DaVita Memphis St), `HASBROOK ASSOCIATES L P` (Fkc Fox Chase), `UMBRIA VENTURES LLC` (Fkc Roxborough) and
`EPISCOPAL HOSPITAL` (Fkc Episcopal).

🚨 **And the first prospecting signal fell out on the first pass, unprompted:** **`FILIPPONE EDWARD J TR`** owns
109 Dickinson St and **`FILIPPONE-NEWMAN LLC`** owns 1172-74 S Broad St — **the same family behind two of Team
Briggs' dialysis properties.** A portfolio seller prospect LCC could not see yesterday, because both properties
read "owner unknown". That is the point of the whole exercise, arriving earlier than expected.

⚠️ **Two honest limits, both recorded rather than smoothed over.** **One jurisdiction is not a rate** —
Philadelphia is a well-run open-data city, so re-measure on a Texas CAD and a Florida county before projecting 68%
onto the 4,021. And **the real hard case is multi-parcel sites**: `3300 Henry Ave` returns **six** owning entities
(the Falls Center LPs) for a single street address; that needs a unit or parcel discriminator, and no amount of
address matching resolves it.

**Next: repeat the identical test on Harris TX (50) and Miami-Dade FL (29)** — two more measurements, still no
build, and the coverage question is then answered with three real rates instead of one projection. Full detail in
the audit doc §8.

## 2026-09-14 — Second county sweep: the question was wrong again, and the free path covers ~20% before we start (Cowork)

Scott ruled out a paid provider and asked whether a local Ollama model could do this. Sampled six more
jurisdictions. **The framing changed a second time, in his favour.**

**The useful question is not *"can we search this county's portal"* but *"does this jurisdiction publish a FREE
BULK FILE that already contains the owner"*** — and several of the largest do:

| jurisdiction | props | owner published? | how |
|---|---:|---|---|
| **Harris, TX** | 50 | **yes** | portal + CSV/XLS/PDF export |
| **Dallas, TX** | 25 | **yes** | owner-name search + COMMERCIAL filter, no CAPTCHA |
| **Miami-Dade, FL** | 29 | **yes** | dedicated **OWNER NAME** search tab |
| **Philadelphia, PA** | 25 | **yes** | address→owner, full grantee/grantor sales history, **+ free bulk dataset download** |
| **NYC (Queens + 4)** | 56 | **yes** | **PLUTO**, free, tax-lot level, **monthly** (26v2, Aug 2026) |
| **Cook, IL** | 73 | gated | CAPTCHA every search — human-only |
| **Los Angeles, CA** | 54 | **no** | not published at all |

Philadelphia's own property page ends *"You can download the property assessment dataset in bulk"*, and its detail
view carries the **grantee/grantor chain** — free. **None of this is scraping.** It is open data, downloaded once
and matched offline.

**Measured coverage of the obvious free-bulk targets: TX 432 + FL 302 + Philadelphia 25 + NYC 56 = 815 of 4,020
(20.3%)** with no portal automation, no CAPTCHAs and no vendor — before checking the other open-data states.

⚠️ **That is COVERAGE, not a hit rate**, and the distinction is the whole risk. A bulk file covering a
jurisdiction does not mean our property matches a row in it — matching is **by address**, and these rows carry
almost no APNs (Cook 0/73, Harris 0/50, LA 1/54). **Measure the match rate on one downloaded file before building
anything.** Philadelphia is the cheapest test: 25 properties, documented bulk download.

🚨 **On Ollama, recorded as `OWNERGAP1-ollama` because Scott asked and the line is sharp.** A local model may
**never** be used to recall an owner. Asked *"who owns 5040 Crenshaw Rd"*, any LLM returns a plausible LLC name —
**exactly the defect we quarantined this week**, since the `ABC`/`XYZ Dialysis Centers` rows came from a `gpt-4o`
call asked to recall a public record. Running that locally makes it free and unlimited, **which is worse, not
better.** ✅ Where it genuinely helps: **matching and normalising text we already fetched** — our address strings
against a downloaded file's (`5040 Crenshaw Rd` ↔ `5040 CRENSHAW RD`, suite noise, abbreviations) and entity names
(`CRENSHAW MOB LLC` ↔ `Crenshaw MOB, L.L.C.`). Transformation of retrieved data, never recall, every output
checkable against its source row. That is the step that turns a free download into matched owners.

**Revised recommendation:** download **one** file (Philadelphia), measure the match rate, and let that number —
not a vendor quote — decide everything downstream. Cook-shaped counties stay manual; LA-shaped are unreachable
from the county at any price, and the vendor conversation can stay deferred indefinitely against a residual that
will be far smaller than 4,021. Appended to the decision doc as §7.

## 2026-09-14 — XB scoped by running the audit by hand first; it found real debt (Cowork)

Two of Scott's three original P18 asks are now live and self-monitoring (market briefs, operator funnel).
**XB — the CDO/CTO build brief — is the third and was never started.** Rather than describe it, ran the
XB2 rules by hand so the prompt carries a measured acceptance target:
**618 local branches** (14 unmerged); **68 flags — 37 on / 29 off, 15 off >3 weeks, 11 off >60 days**,
oldest dark since **2026-05-30**; `sidebar_contact_guard` **31 runs / 31 skipped / 0 completions ever**;
4 of 8 prompts without a matching response; STATUS 2,257 / 2,500 and BACKLOG 1,178 (both guarded).
⭐ **The run produced a rule refinement.** `p_rss` also reads "skipped, never completed" — but its
`skip_reason` is `flag MARKET_BRIEF_PRSS is off`, which is the system working and must stay silent.
`sidebar_contact_guard`'s reason is operational, 31 runs running — a stall wearing a skip's clothes. So
the rule is **not** "no completions" but "skips that are NOT flag-gated, N runs running". Same
dead-vs-silent distinction FEED2 and MB2e each paid for separately; it now has a third instance.
⚠️ The orphan-prompt rule threw a **false positive** (`MB2bc-…` vs `MB2b desktop response.docx`) — the
prompt↔response naming convention is unenforced, so that rule needs a real key before shipping.
Scoped **XB1+XB2 only — no dashboard**: a surface with nothing behind it is exactly how three "looks
live, does nothing" defects happened this week. → `prompts/XB1-XB2-build-brief-collector-and-audit-rules.md`

## 2026-09-14 — County pilot run live: Harris works, Cook is human-only, LA publishes no owner at all (Cowork)

Ran OWNERGAP1's recommended pilot in the browser rather than handing Scott an hour of clicking. It took minutes,
and **it refutes the single-number framing of the question it was meant to answer.**

⚠️ **A constraint the decision doc did not weight:** these properties carry essentially **no APNs** — Cook
**0/73**, Harris **0/50**, LA **1/54** — so every lookup has to work from a **street address alone**. That is what
the pilot actually tested.

**The three counties resolved three different ways:**

| county | props | verdict |
|---|---:|---|
| **Harris, TX** | 50 | ✅ free, address search, **returns the owner**, CSV/XLS/PDF export — looks automatable |
| **Cook, IL** | 73 | ⚠️ free address search exists but **every search is CAPTCHA-gated** — human-only |
| **Los Angeles, CA** | 54 | ⛔ free, no CAPTCHA, **but owner names are not published at all** |

**Harris is a direct hit, and the county draws exactly PDR2's distinction.** `5040 Crenshaw` → three accounts:
`FRESENIUS MEDICAL CARE GREATER SOUTHEAST HOUSTON LLC` and `FUSA MARKETING` as **Personal** property, and
**`CRENSHAW MOB LLC`** (16,915 SF, $1,903,507) as **Commercial** — the real owner, a single-asset LLC, on a
property LCC reports as "owner unknown" today.

**LA is a hard no, established by reading rather than assuming.** Parcel detail for AIN 2350012065 carries situs
address, use code, building characteristics, a 25-row assessment history, and an ownership *events* table with
recording dates, doc numbers and sale prices — **and no owner name anywhere.** Not a scraping difficulty; the
datum is not published.

👤 **What it changes for Scott:** **there is no single "Option A yield."** Behind the 4,021 sit **1,266 distinct
(state, county) combinations**, and the three largest split one-automatable / one-manual / one-impossible. A
national county build would be sized against the worst case while delivering only the Harris-shaped subset.
Revised to three options on **OWNERGAP1-decision**: build for Harris-shaped counties only (**sample 5–10 more
first** — three proves the shapes differ, not how they split); a paid bulk provider, which is the only path that
reaches LA-shaped counties because it does not depend on what a county chooses to publish; or accept "owner
unknown" and rank those properties last — now a measured choice rather than a default.

**The cheapest informative next step is more sampling, not a build** — the same logic that made this pilot worth
running. Appended to `docs/audits/OWNERGAP1_FABRICATED_OWNER_AND_UNRECOVERABLE_GAP_2026-09-14.md` §6 rather than
filed separately, so the decision and its evidence live in one place.

## 2026-09-14 — Tier 0 auto-attach fix VERIFIED live; owner-to-person linkage re-measured at 13.5% (Cowork)

Scoped Stage 4's contact-linkage gap per my own recommendation, starting with review before building.
`tier0-owner-contact-system.md` explicitly flagged an unverified claim: a 2026-09-12 fix to
`TIER0_AUTO_ATTACH` (a call-site arity bug had silently kept it off for 16 straight days) was never
actually confirmed to write anything in production.

Verified it directly against `lcc_tier0_auto_attach_run_log` and `lcc_tier0_confirm_log`: 09-12 06:55
still shows `attached=0` (fix landed mid-day, after that run); **09-13 06:55 shows `attached=9`** -- the
first non-zero `attached` in the log's history, independently confirmed by 9 new `lcc_tier0_confirm_log`
rows with `actor` NULL (system) and `verdict='attach'`, all dated 09-13, none before. 09-14 06:55 shows
`auto_candidates=0`, which is the expected steady state (pool cleared) rather than a regression. The fix
genuinely works.

Re-measured the "13% owner-to-person linkage" headline figure the same way the 08-27 audit did: **13.5%
(1,377 of 10,187)** today vs. 13% (847/6,480) then. Both the linked count and the universe grew (universe
growth is partly the still-open OWN-T0b/c duplicate-entity residue inflating the owner count with
un-merged duplicates) -- the ratio barely moved. Honest read: the mechanism now works, but 9 links/day
against a gap this size won't move the headline number on its own.

Documented both findings in `tier0-owner-contact-system.md` (§2 headline table + §6) and
`ownership-truth-pipeline-state.md` (`[UX-T1a-reach]`).

Did not build anything further this pass -- Stage 4 is a large, 13-audit-round subsystem with several
genuinely open decisions already sitting there for Scott (fcp/tmg sponsor domain confirmation, N3c
bank/trustee scope, N15 Salesforce-campaign orphans, N15c's canonical_name unique-key call), any of
which is a smaller, well-scoped next step than trying to move the 13% number directly. Flagged back to
Scott rather than picking one unilaterally.

Housekeeping: `docs/claude-code/responses/` had OC-v2 and OWNERGAP1 desktop responses queued; left
untouched -- another concurrent session had the shared checkout mid-edit on exactly those topics
(uncommitted changes across api/, docs/audits/, docs/os/, supabase/migrations/, test/) when checked, so
reconciling them was that session's in-flight work, not mine to touch.
## 2026-09-14 — OC-v2 taken live: the operator funnel now triages, routes, and watches itself (Cowork)

**Applied the migration CC could not** (`20261102140000`): flag row registered, `v_operator_notes_stale_open`,
`lcc_check_operator_notes_stale`, crons `lcc-operator-triage` 07:25 UTC and `lcc-operator-notes-stale-check`
07:30 UTC — **both slots verified free against live `cron.job` first**, which the migration's own comment
explicitly asked an operator to do. Confirmed the deployed build carries the fix (`87042eb63878`,
`merge-base` proves it contains PR #2438) before grading anything — merged is not running.
**Re-graded with the model actually invoked: `scanned 3, triaged 3, routed 2, unclassified 0`** (was
1 / 1 / 2). The dialysis bug note that previously failed now grades `bug` / `lane: dialysis` / `medium`
→ `app/briefing` via `onprem_ollama`; the comps idea now carries `lane: government`.
**`OPERATOR_NOTE_TRIAGE` flipped ON** against that evidence — the gate the migration documented. A POST
run wrote the classifications; all three fixtures were then closed through the normal disposition path,
so that path is exercised too. Stale monitor reads 0 open notes, 0 alerts.
⚠️ **Correction to my own earlier diagnosis, which was wrong.** I reported the model as "declining" on the
bug note. CC found the truth: a plain GET **never called Ollama at all** — `model_declined` meant *never
asked*. That is why the fix was a code path, not a prompt. Worth keeping: a verdict string named the
wrong cause, and I repeated it as measurement.
👤 Residual: the meta note graded `bug` (over-classification) with `routed_to: null`. Triaged-but-unrouted
correctly stays `open` and would age into an alert — the monitor working as designed.

## 2026-09-14 — OWNERGAP1 reconciled: containment verified both ways, CC corrected my premise, one residual gap found (Cowork)

PR #2437 merged. Responses and prompt filed to `done/`. **CC's pass was better than the prompt that asked for it,
in four separate ways, and each is worth naming.**

**1. It corrected my premise.** I named `sidebar-pipeline.js` as the producer. It is not — the fabricated names
come from **`Dialysis/src/public_record_ingest.py`'s `gpt-4o` recall call**, in a *different repo*, asking a model
to "extract" `mailing_owner` from a prompt **seeded with the property's own owner and no county fetch**. That is
fabrication **by construction**, the same class as PR1/PR1a/PR1b. Filed honestly as `OWNERGAP1-producer` 🔴 with
read-only access disclosed rather than claimed as fixed.

**2. The fabrication was bigger than I measured.** I found 228 rows in `tax_records`. CC ran the same detector
across every table that can carry a model-sourced owner string and found **221 more in
`entity_registry_records.entity_name`, 12 in `recorded_owners.name`, and 10 in `true_owners.name`** — the last two
being the **curated** tables `properties.recorded_owner_id`/`true_owner_id` point at. A fabricated row there is a
live landmine for any future name-match reconciler, not a staging-table curiosity.

**3. It caught its own near-miss during verification and corrected it in place.** The single `recorded_owners` row
literally named `"Unknown"` **is referenced by 23 real properties today** — a genuine in-use sentinel from some
other producer, not gpt-4o fabrication. Nulling that FK would have been an undisclosed side effect of a migration
about stopping fabrication. It narrowed the properties-link guard to fire only on `fabricated_placeholder`, proved
it with a rolled-back positive **and** negative control, and documented the correction in the migration header.

**4. Its recommendation is the right one, and it is a decision rather than a build.** The concentration analysis
kills the "narrow path" hope I was hoping for: **top-15 counties = 13.7% of the gap, 1,266 distinct
(state, county) combinations, 640 properties with no county at all.** So instead of committing to a county-portal
build or a vendor contract, it proposes a **bounded one-hour manual pilot** on Cook IL / Los Angeles CA /
Harris TX (177 properties) to learn whether Option A's yield is nearer 40% or 5% **before** anyone spends money.

✅ **What I verified independently rather than reading:** `trg_dia_ownergap1_*_guard` is live and **enabled on all
four tables**; **370 rows quarantined** (228 + 142), rows intact, reasons distinct. I re-ran the control myself in
a rolled-back transaction: `XYZ Dialysis Centers LLC` → nulled + `fabricated_placeholder`; `Unknown` → nulled +
`unstated_placeholder`; **and a real owner, `Decarion Family Trust`, passed through untouched.** Both sides hold.

⚠️ **One residual, filed as `OWNERGAP1-payload`:** the guard protects the **column**, not `raw_payload`. A row
whose fabricated name sits only in `raw_payload->>'mailing_owner'` is **not** flagged (probe `PROBE-RB-4`), and the
228 already-quarantined rows **still carry the invented string in their payload** — which is exactly how I found
them. So *"catches every one going forward"* is true of the column and not of the payload. **Not urgent** (no live
consumer reads that key, and leaving a raw source record unedited is arguably correct) — the likely right answer is
to make the quarantine flag readable beside the payload rather than scrub it. Written down so the next reader of
that payload is not misled.

## 2026-09-14 — OWN-T0f reviewed (no action needed), OWN-T0g sized and deferred pending a decision (Cowork)

Continued the OWN-T0 residue after OWN-T0d shipped. Reviewed existing machinery before building, per the
OWN-T0c lesson.

**OWN-T0f (closed, no build)**: the per-row UUID on `county_deed:<uuid>`/`gov_ownership_chain:<uuid>` in
`ownership_source` looked like producer noise in the audit, but reading `lcc_a2_apply_ownership_chains`
showed it is deliberate citation back to the specific source chain-link record. The one live consumer that
groups on it, `v_lcc_property_ownership_reconciled` via `lcc_ownership_evidence_level()`, already
prefix-matches both patterns correctly -- verified live, `evidence_level` grouping has 0 rows in `other`
across all 27,421 rows. Nothing to build; would have been solving an already-solved problem.

**OWN-T0g (sized, not shipped)**: `lcc_finalize_entity_portfolios` is live, `SECURITY DEFINER`, cron-driven,
and runs both domains' portfolio syncs -- a different risk class from OWN-T0d's one-time data cleanup.
Confirmed by reading its body: gov's supersession window is computed only across the current inflight
request's rows, so a property whose owner history is split across sync calls never gets end-dated across
that split; dia has no supersession logic at all. Real, confirmed gap. Did not build a fix -- the correct
repair needs a decision first (should supersession compare against all historical facts, not just the
current payload; is "new current owner supersedes old" even a safe assumption here, given gov/1708 has two
genuinely-current co-owners from OWN-T0d's investigation). Recommend sizing the live blast radius against
the 747 `multi_current_distinct_parties` population before writing anything.

Both findings documented in `PLANNED-BACKLOG.md`'s OWN-T0b/c/d/f/g row and
`docs/architecture/ownership-truth-pipeline-state.md`.

Housekeeping: MB2e desktop response reconciled (already-merged PR #2433, moved to responses/done/).
## 2026-09-14 — OC-v2 shipped: lane detection + GET-never-calls-the-model bug fixed, flag registered, cron scheduled

Root-caused the two triage findings from the measurement pass below. `lane: null` was structural —
`classifyDeterministic` never set `lane`, only `note_type`/`severity`; added `detectLane` (domain
keyword map: dialysis/government/comps/market-brief/buyer-engagement/automation/data-coherence/canon)
and attached it to every deterministic verdict. `triage_source: null` / "model declined" was a
misread — a plain `GET` dry run never called Ollama at all (only `POST` or `?generate=1` did), so the
bug note was never actually offered to the model. Removed that gate (`?skip_model=1` opts out).
Migration `20261102140000` registers `OPERATOR_NOTE_TRIAGE` (still **off** — the row never existed,
so nothing could flip it), schedules `lcc-operator-triage` (07:25 UTC, not flag-gated), and adds a
distinct stale-note monitor (`v_operator_notes_stale_open` / `lcc_check_operator_notes_stale`,
`operator_note_stale_open` alert ≥3d, cron 07:30). **Not applied live** (no DB access this session) —
flag stays off until a live re-grade. `test/operator-notes.test.mjs` + `test/operator-triage-tick.test.mjs`
+ `test/sql-definer-privilege-stanza.test.mjs` all green.
## 2026-09-14 — OWNERGAP1 Unit 1 shipped: reversible SQL-side quarantine on Dialysis_DB; producer is `Dialysis/src/public_record_ingest.py`, not this repo (Cowork)

Followed up on the entry below (the 228 fabricated `ABC`/`XYZ` owner names + 142 `"Unknown"` placeholders in
`tax_records.raw_payload->>'mailing_owner'`). Attached the `Dialysis` repo read-only and traced the real
producer: **not** `sidebar-pipeline.js` as the originating prompt named — that file never writes
`mailing_owner` (grep: zero hits). It is `Dialysis/src/public_record_ingest.py::write_tax_record`, calling
`gpt-4o` with the property's own recorded/true owner in the prompt and no county fetch anywhere in the module
— the same mechanism PR1/PR1a/PR1b already documented on `assessed_value`/`tax_amount`/`tax_delinquent`,
recurring on a field (`mailing_owner`) those rounds never touched. Corrected in place above.

**Contamination is wider than the prompt described** — measured across all four tables the producer touches,
not just `tax_records`: `entity_registry_records.entity_name` carries the same `ABC`/`XYZ` pattern, and
`recorded_owners.name` / `true_owners.name` carry it too (the curated identity tables `properties` FKs
point at). Migration `20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql` (applied live to
Dialysis_DB `zqzrriwuavgrquhisnoa` via three sequential statements — the base migration plus two live
corrections, both folded into the committed file):

- **One detector, `dia_is_fabricated_placeholder_owner(text)`** — case-insensitive `^(XYZ|ABC)\s` plus
  exact (trimmed, case-insensitive) `= 'unknown'`. Never a `contains` rule (P158a) — a real firm like
  `"AZ Business Trust LLC"` or `"Unknown Holdings of Dallas LLC"` must not flag.
- **`dia_ownergap1_fabrication_quarantine`** — append-only log, idempotent (`ON CONFLICT ... WHERE
  restored_at IS NULL DO NOTHING`), records the pre-quarantine value for every flag.
- **`tax_records.mailing_owner`** — the field the investigation named — is NULLED (the field is not an
  identity column; blank is the honest state) + flagged; guard trigger stops future writes the same way.
- **`entity_registry_records`/`recorded_owners`/`true_owners`** — **flag-only, name preserved.** These are
  identity columns other rows FK to; nulling `name` would either FK-violate or silently rename a real party.
  Each has its own `BEFORE INSERT OR UPDATE` guard trigger.
- **The loophole this closes: `properties.recorded_owner_id`/`true_owner_id`.** A property could still point
  at a fabricated-and-flagged owner row even after the row itself is flagged. `trg_dia_ownergap1_property_owner_link_guard`
  nulls the FK on write — **scoped to `fabrication_quarantine_reason = 'fabricated_placeholder'` only, never
  `'unstated_placeholder'`.** ⚠️ That scoping was corrected live, mid-build: the first version tested
  `fabrication_quarantined_at IS NOT NULL` generically, and a live `recorded_owners` row literally named
  `"Unknown"` is referenced by **23 real properties** — the generic guard would have silently severed those
  on the next write to that row. Caught by testing both directions against production before shipping
  (rolled back, no residue), not by reading the code.
- **`dia_ownergap1_restore_quarantine(batch_tag)`** — full reversal, restores `mailing_owner` from the log
  and clears every flag column for a batch.

**Before/after (live, `zqzrriwuavgrquhisnoa`):** `tax_records.mailing_owner` fabricated 228 → **0** (nulled +
logged), `"Unknown"` literal 142 → **0** (nulled + logged, `unstated_placeholder`); `entity_registry_records` /
`recorded_owners` / `true_owners` fabricated names flagged, names preserved. **Confirmed: 0 properties'
`recorded_owner_id`/`true_owner_id` reference a `fabricated_placeholder`-flagged row** (the link guard's
positive control), and **no property owner FIELD was written by any of this** — only flags, nulls on the
non-identity `mailing_owner` field, and reversible FK-nulls on the loophole.

**Unit 2 (re-measurement) — all four of the prompt's own figures reproduced, live, this session**, beside
the originating measurement: 25,331 `mailing_owner` keys / 24,365 null-or-empty (matches exactly); of the
4,021 owner-unknown properties, 3,048 join tax records and exactly 1 has a non-blank `mailing_owner`
(`"Unknown"`, matches exactly); `deed_records` **204** total / 0 overlap (the prompt said 203 — a genuine
+1 landed in the hours between the two measurements, not a methodology disagreement, called out rather than
silently reconciled); 56 of 4,021 carry a `parcel_number`, 0 of those join a `parcel_records.owner_name`
(matches exactly). **No source the prompt missed was found.** The finding stands as written: the 4,021-
property owner gap is not recoverable from any table LCC or Dialysis_DB holds.

**Unit 3 (costed decision doc):** `docs/audits/OWNERGAP1_FABRICATED_OWNER_AND_UNRECOVERABLE_GAP_2026-09-14.md`
— county-recorder path (`handleRecorderPortal` is gov-only; `county_authorities` does not exist on
Dialysis_DB at all — verified via `information_schema`, so the prompt's premise there needed correcting too;
the dia-capable path is the manual `handlePublicRecordsCapture` writeback only) vs a paid bulk vendor
(`Dialysis/src/regrid_client.py` — a complete, unused Regrid Parcels client gated on unset `REGRID_API_KEY`)
vs doing nothing; state/county concentration (top 15 = 549/4,021, 13.7%; 640/4,021 carry no county at all;
1,266 distinct state/county combinations — the population is NOT geographically narrow, so a county-by-county
manual pilot does not obviously beat a national paid feed); recommendation to Scott: a small 3-county pilot
before committing to either paid path, given the population's dispersion.

**Guard:** `test/ownergap1-fabricated-owner-quarantine.test.mjs`, 40 tests — positive control on all 12
known fabricated names + `"Unknown"` variants (case/whitespace), negative control on 10 real names
(`"AZ Business Trust LLC"`, `"X Y Z Dialysis Consulting LLC"` as the deliberately adversarial edge cases),
plus structural assertions against the migration's own source (detector, quarantine table, all four+one
guard triggers, the `fabricated_placeholder`-only scoping on the property-link guard, the restore function,
`NOTIFY pgrst`). Full suite: **6,231 passed / 0 failed / 6 skipped** (pre-existing skips, unrelated).

**No Railway redeploy needed or possible for this change** — nothing in `api/`/JS shipped; the entire fix is
a Dialysis_DB migration (live immediately, per this repo's own "Supabase migration changes are live
immediately" rule) plus a test file and two docs. The actual Python producer fix (stop `gpt-4o` emitting
`ABC`/`XYZ` template-shaped names) is filed as **`OWNERGAP1-producer`**, cross-repo, not shippable from this
session's read-only `Dialysis` access.

## 2026-09-14 — OC-v2 de-risked by measuring triage before sending it (Cowork)

Rather than send OC-v2 blind, forced a triage dry run against the deployed handler
(`tranquil-delight` `cf04ae04ae52`, which reports `skipped: flag_off` / `registry_state: null` honestly
and offers `?force=1`). Filed **two realistic notes** first, because the only queued note was meta
("confirming the funnel accepts notes") and a meta note is a bad test of a classifier.
**Result — `scanned 3, triaged 1, routed 1, unclassified 2, errors 0`:** an unambiguous **dialysis bug
report** naming a route, a lane and a mechanism came back `unclassified`
(`no_deterministic_rule_matched_and_model_declined`); the one success was a comps idea routed
`deterministic`ally but with **`lane: null`**, despite "government deals" and "GSA lease".
**So: only keyword rules fire, they lack market-brief/dialysis vocabulary, lane is never populated, and
the model arm declines** (`triage_source: null` on both misses). ⚠️ **Flipping the flag as-is would route
about one note in three and lose the rest silently** — the funnel would look alive while still dropping
most of what Scott puts in it. MB-a measured Ollama reachable from Railway in the RSS path, so OC-v2 must
check whether the TRIAGE path reaches the model at all: unreachable is a wiring bug, conservative is a
prompt question, and they have different fixes. Both test notes left in the queue as fixtures.

## 2026-09-14 — OWN-T0d shipped: 11 tombstone-duplicate-current properties cleaned up (Cowork)

Continuing the ownership-truth-pipeline work after OWN-T0c's revert, picked up OWN-T0d next (my own
recommendation, approved). Re-measured `v_lcc_property_multi_current` on LCC Opps: `tombstone_duplicate_current`
unchanged at 11 properties from the 2026-09-02 audit (unlike OWN-T0c's population, which had nearly tripled).

Reviewed existing machinery *before* building anything (the lesson from OWN-T0c) and found the fix already
built and deployed: `lcc_repair_tombstone_portfolio_facts(p_dry_run, p_batch)` (P175) on `lcc_entity_portfolio_facts`
-- finds current-fact rows still sitting under a tombstoned (`entities.merged_into_entity_id is not null`)
entity_id where the survivor already holds an equal-or-better current row for the same property, and
dedup-deletes the ghost row (or repoints it if the survivor lacks the property). It explicitly leaves alone
any case where the ghost claims current and the survivor claims ended -- a genuine conflicting claim, not a
duplicate -- for `v_lcc_portfolio_ownership_conflict` to surface separately, so it never over-corrects.

Dry run found **12** ghost fact rows (not 11 properties -- one extra, gov/1708, was bucketed under the
*other* defect class `multi_current_distinct_parties` by the view because it also carries a genuine second
rival owner; the repair function operates at the fact-row level so it caught it anyway). Ran live, batch tag
`own_t0d_2026-09-14`, fully logged to `lcc_p175_portfolio_repair_log` (old-row snapshot per fact) and
reversible via `lcc_unrepair_tombstone_portfolio_facts('own_t0d_2026-09-14')`.

Re-measured after: `tombstone_duplicate_current` **0** (was 11/12). `multi_current_distinct_parties` unchanged
at 747/\$876,981,134, confirming no genuine rival-party conflict was touched. gov/1708 now correctly shows
exactly its 2 real current owners (The Greystone Group vs. the Silverstone Company survivor) with only the
duplicate Silverstone ghost row gone. No migration needed -- the repair function pre-existed; this was a
live-data operation only, documented in `PLANNED-BACKLOG.md`'s OWN-T0b/c/d/f/g row and
`docs/architecture/ownership-truth-pipeline-state.md`.

Housekeeping: checked `docs/claude-code/responses/` -- empty, nothing to reconcile.

Next recommendation: Stage 4's contact-linkage gap (13% owner-to-person linkage), or the smaller
mechanical OWN-T0f (`ownership_source` per-row UUID noise) / OWN-T0g (`lcc_finalize_entity_portfolios`
supersession-window gap) follow-ons. OWN-T0b/c (1,183 `duplicate_entity` merges) stay blocked on the
trailing-"The" human decision from the prior entry.
## 2026-09-14 — MB2e verified live; then found the operator funnel has no consumer (Cowork)

**MB2e confirmed independently.** All **13 feeds now contribute ≥1** — Federal Register (GSA) 6→**4**
after cutoff, Tax Foundation 15→**5** — **zero feeds at zero**, zero open alerts of either kind, and the
11:15 UTC cron genuinely calls **both** monitors (checked the cron command, not the claim). The feed
thread is complete and self-monitoring. No doc entry was needed for the confirmation itself.
**Closed a stale blocker:** `MB2a` still read `⛔ blocked on edge-function deploy` two days after that
deploy landed (v21 → v25 since). Now ✅ — and it is exactly the stale-dated-blocker class **XB2** exists
to catch automatically.
🚨 **The operator funnel accepts notes and nothing processes them.** OC-v's blocker #1 IS resolved —
the standalone MCP redeploy happened, `log_operator_note`/`get_operator_inbox` are live, intake works
end to end. But: `operator_notes` holds **1** note, filed 2026-09-12, still `open` / `note_type=null` /
`routed_to=null`; the **`OPERATOR_NOTE_TRIAGE` registry row does not exist at all** (OC2 shipped the
handler and never registered the flag, so it cannot be turned on); and there is **no triage cron**.
This is worse than not having the funnel — Scott was told it is live, so a note filed there looks
captured, is captured, and is then silently ignored. Same class as a dead feed reporting healthy.
→ **OC-v2** (`prompts/OC-v2-notes-go-in-and-nothing-happens.md`).

## 2026-09-14 — MB2e: two more feeds green + contributing nothing (Federal Register GSA, Tax Foundation)

MB2b's `items_after_cutoff` column found its next two customers on day one. Same class as FEED2
(a fixed window vs. a slower producer cadence, worst on Monday): `maxAgeHours` set 24*7 on both
`government/Federal Register (GSA)` and `tax_policy/Tax Foundation` (measured: newest item 82h/92h
old, 5 items each land inside 7d, 0 inside 72h). Deployed to LCC Opps (v24 → v25), body re-read to
confirm. Forced live: both feeds went from `items_after_cutoff: 0` to **4** and **5** respectively
on the same day's real feed. Monitor half also shipped (migration `20260914130000`):
`v_market_brief_feed_health_no_contribution` + `lcc_check_market_brief_feed_no_contribution` — a
DISTINCT alert_kind from `market_brief_feed_stale`, counting consecutive checks (never calendar
days, FEED2's fix applied from the start) that parsed items but contributed 0; rides the same
11:15 UTC cron. Guard `test/mb2e-feed-cutoff-window.test.mjs`. Full suite green (6,212 tests).
Backlog **MB2e** ✅; canonical lesson filed in `docs/architecture/data-coherence-invariants.md` I11
section (fixed-window-vs-cadence is a class, not a one-off).

> **📦 ARCHIVE (2026-09-16, nineteenth span):** the 2026-09-14 tax-feed → PDR2 → OWN-T0c → MB2b/MB2c/FEED2 →
> `HCRIS-TIMEOUT` run was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-14_tail11.md`](../history/STATUS_claude-code_2026-09-14_tail11.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-16, eighteenth span):** the ID3b-shipped → 2026-09-14 queue-audit/HP1/FEED2/PRI6 →
> 2026-09-12 HP1-P2f-urgent → BACKLOG-ids run was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_to_09-14_tail10.md`](../history/STATUS_claude-code_2026-09-12_to_09-14_tail10.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-15, seventeenth span):** the FEED1-scoped → MB2a → MB9 run of 2026-09-12 entries
> was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail9.md`](../history/STATUS_claude-code_2026-09-12_tail9.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-15, sixteenth span):** the last two 2026-09-12 entries (the BACKLOG-ids duplicate-ID
> finding and the HP1-badge prompt) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail8.md`](../history/STATUS_claude-code_2026-09-12_tail8.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-16, fifteenth span):** the next-oldest run of 2026-09-12 entries (the REPO1 repo
> sweep through the CONSOLIDATE2 contradiction) was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail7.md`](../history/STATUS_claude-code_2026-09-12_tail7.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-16, fourteenth span):** the oldest remaining run of 2026-09-12 entries (MB2a through
> the HP1-P1a-fix reconcile) was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail6.md`](../history/STATUS_claude-code_2026-09-12_tail6.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-15, thirteenth span):** a further run of 2026-09-12 entries was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail5.md`](../history/STATUS_claude-code_2026-09-12_tail5.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.
