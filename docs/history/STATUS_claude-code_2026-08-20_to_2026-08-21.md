# STATUS archive — Claude Code queue, 2026-08-20 → 2026-08-21

> **⚠️ ARCHIVED 2026-09-02 from `docs/claude-code/STATUS.md`. HISTORICAL RECORD ONLY.**
> Moved verbatim, nothing dropped. **Every entry was true on the day it was written and several are
> now superseded** — re-measure a dated blocker before quoting it.
>
> **Current state:** `docs/os/CURRENT-STATE.md` · **open work:** `docs/os/PLANNED-BACKLOG.md` ·
> **running log:** `docs/claude-code/STATUS.md`.
> **Canonical topic pages supersede anything here** — see `docs/os/DOCUMENTATION-MAP.md`.

---

## 2026-08-21 (P125) — draft-assist retrieval: four defects, all measured live, all root-caused

**JS-only + a flow re-import. Ships on the next Railway redeploy of merged `main` → `npm run verify:deploy`.**
No migration, no `field_source_priority` change. Full suite 4,258 tests, 0 new failures (2 pre-existing on
`main`, both in `auto-scrape-listings`, unrelated).

**1. The corpus loader spent its whole page budget on other people's mail.** `loadCorpus` paged the newest
3,000 rows of the WHOLE store and only then dropped everything not authored by Scott. Live: `email_bodies`
holds **28,090** body-bearing rows of which **1,188** are his — so that window contained just **565**, and
`retrieval.corpus_size` reported a number far below the corpus that exists. `SCOTT_FROM` is now a PostgREST
filter on both stores (`from_email=in.(…)` / `metadata->>from_email=in.(…)`); the JS gate stays as the
authority. The whole outbound corpus (1,188 + 951 `activity_events` = 2,139) now fits in one cap with headroom,
and the payload reports `corpus_full_bodies` + `corpus_truncated` — **assert on full bodies, never row count.**

**2. ⚠️ THE FULL-BODY TEST WAS A LENGTH HEURISTIC, AND IT WAS WRONG ABOUT 62% OF SCOTT'S REAL EMAILS.**
`FULL_BODY_MIN_CHARS = 300` infers provenance from size — and Scott's voice is short *by design* (the profile's
own first rule). Measured over the 777 Scott-authored rows carrying a real `body_html`, after the cleaner strips
the quoted chain and signature:

| cleaned prose | rows | |
|---|---|---|
| < 12 chars | 71 | correctly dropped as boilerplate — `"AWESOME!"`, `"Just did!"` |
| **12–299 chars** | **438** | **genuine full bodies the heuristic called "preview-era openings"** |
| ≥ 300 chars | 268 | |

Median cleaned prose is **160 characters**. That is why `voice_confidence` kept reporting *"preview-era OPENINGS
only (~255-char cap)"* over a corpus that is nothing of the kind — it was measuring length, not provenance.
Provenance is a fact held at load time (which body column the text came from), so it is now carried
(`exemplar.full_body`) and the length test survives only as a fallback for callers that supply none.
`exemplarBodyCoverage` reports its `basis` so the fallback can never be mistaken for a real read.

**3. The embedding ranker was entirely recipient-blind — and that is invisible from outside.** It scored cosine
plus a 0.02 bucket nudge and nothing else, so `target.recipientEmail` was accepted and discarded: backfilling
Susan Holdsworth's 55 full-body emails changed the retrieved set by **nothing**, because no term could see them.
The deterministic ranker *did* weight recipient (+2) — so the two rankers disagreed about what relevance means,
and which one ran depended only on whether Ollama answered. Both now read one `recipientMatchLevel` (to 2 / cc
1.5 / domain 1 — **cc was never read at all before**, and 3 of Susan's 55 rows are cc-only).

**A weight that can lose is indistinguishable from one that is not there.** So the two guarantees are a hard
ordered PARTITION (`selectExemplars`), not score terms: `full body + exact recipient` → `full body` →
`preview + exact recipient` → `preview`. Full-body is the outer key (a preview evidences a greeting and nothing
else); exact recipient is the inner one. **A domain-only match is deliberately NOT a tier** — a colleague at the
same firm is a different person. Lower tiers only ever fill slots a higher tier could not, so a thin corpus is
never starved. Applied around *whichever* ranker won, so the guarantee no longer depends on Ollama.

**4. Deal resolution did not fail — it did not exist.** Facts were loaded only `if (entityId)`, so a dry-run
supplying just a recipient reported `facts.source: no_entity_relational` for a live, named, in-progress deal.
Nobody had asked. `resolveDealEntity` now reads the verdict the hourly deal-email matcher **already records**
(`activity_events.source_type='lcc:deal_match'`, `external_id` = the RFC internetMessageId, `entity_id` = the
deal) — no new matching heuristic. Thread-scoped, not message-scoped, because the matcher is budget-bounded and
skips already-attributed mail: **verified live** — the exact reply target draft-assist picked for Susan had no
row of its own, and its conversation resolved to `DaVita Dialysis - The Villages - FL` (`17218fd0-…`, stage
`non_refundable`, expected close 2026-08-21). An unresolved deal now names the rung that came up empty
(`thread_not_attributed_to_a_deal` ≠ "no deal exists").

**5. The threading outcome was unobservable, which is why a live save was needed to notice it.**
`{ok, draft_id, web_link}` is identical for a threaded reply and a fresh message. Three real defects in the flow
definition: `Respond_Success` ran `runAfter: Is_Reply: [Succeeded]` — after **both** branches — so the reply path
**responded twice** and the second read a null `body('Create_draft')`; `Set_reply_body` PATCHed `toRecipients`
onto a reply draft that already carries the thread's recipients; and an empty `$filter` result built
`/me/messages//createReply`. Fixed: one responder per path, body-only PATCH, a `Thread_Message_Found` guard that
falls back to a standalone draft **and says so**. Every response now echoes `threaded` (+ `conversationId`), the
seam surfaces `conversation_matches_thread`, and a requested-but-unthreaded save returns a `threading_warning`.
`threaded: null` ≠ `false` — "an older import" and "it did not thread" are different facts.

**The repo definition had also drifted from the tenant.** Per the hand-package notes above, `CreateDraftMessageV3`
does not exist in this tenant, `$authentication` must be declared and referenced, and every `HttpRequest` with a
Body needs `ContentType: application/json`. All three are now in the committed definition — a definition that only
describes a flow nobody can import cannot be reasoned about.

**⚠️ REMAINING GATE (Scott/Cowork, live):** re-import `flow-lcc-create-outlook-draft.json` and re-run the
acceptance test in `docs/architecture/flows/outlook-draft-reply-executor.md`. Until then `outlook_draft.threaded`
will read `null` and threading stays unverified.

## 2026-08-21 Cowork reconcile — P122/P123/P124 verified; ⚠️ REDEPLOY PENDING (draft-assist safety)

All three landed and each corrected my prompt's premise. **DB layers verified live on LCC Opps:** P122 crons
`cm-gov-packet-refresh` (start) + `cm_packet_refresh_tick` (per-min) armed, 0 open alerts for that source (gov
packet updated_at moved 2026-08-14 → 2026-08-21, 41→45/45 charts); P123 `v_lcc_deal_match_run_health` +
`duration_ms` present; P124 `PA_OUTLOOK_DRAFT_FLOW` registered, profile → v3.0.0.

**⚠️ THE JS HALVES OF P123 + P124 ARE NOT DEPLOYED.** `/version` = `527d78f9b05c`, unchanged since P121 — the
P123/P124 merges (PR #1767 / #1765) have NOT redeployed. Consequences until a Railway redeploy of `main` +
`verify:deploy`:
- **P124 (safety):** `DRAFT_ASSIST` is **ON** (since 2026-08-14) with the **old contaminated classifier** live —
  `purpose=cold_bd` still draws from the personal-mail sump (89.7% of `cold_bd_outreach` was bunk-notes/meal-
  plans/football, 0 cold BD). A save to an institutional owner would be in the wrong register. **Action: redeploy
  promptly, OR flip `DRAFT_ASSIST` off until then; and check Outlook Drafts for anything created this past week
  (depends on `PA_OUTLOOK_DRAFT_URL` being set on Railway).**
- **P123 (benign):** matcher keeps completing (~80s) but pg_net keeps timing out at 60s → `no_response` alerts
  persist until the v2.2 engine (bulk pre-fetch, work budget, run-log-opened-first) deploys.

**Premise corrections worth carrying:** P122 — pg_net queue inserts are TRANSACTIONAL, so the statement-timeout
abort rolled back every fired request: 0 HTTP calls delivered in 7 runs, and the gov packet lives in the DOMAIN
DB (gov), not LCC Opps `cm_report_snapshots` (empty). P123 — not broken/not a matcher timeout: `no_response` is
a pg_net 60s cap while Railway finishes+logs ok; "6 in 24h" was a ~6h retention artifact = 100% of calls; the
cost was ~680 sequential N+1 round-trips, not the DB. P124 — `DRAFT_ASSIST` was already ON (not gated off), and
`email_bodies`-first dedup is one sort-direction from silent total failure (866/0 vs 614/614). Dry-run is
Scott's on-box step (GaryBuilt Ollama unreachable from cloud); build sheet
`docs/architecture/flows/outlook-draft-reply-executor.md`.

## 2026-08-21 runs review — email loop healthy; 2 unrelated lanes to watch

Deploy live + git-pinned (`/version` = `527d78f9b05c`). **Email-orchestration loop all green:** move queue
fully drained (`move_outcome` 329 moved + 15 already_out, 0 pending), mirror worklist 0, stranded detector 0,
jobs clean (433 extract + 14 doc-text, 0 failed). Open alerts back to **29** (from the 3,987 park storm). Two
NON-email items worth a look, neither urgent, neither ours from this week:
- ~~**`cm-gov-packet-refresh` cron failing** (09:15Z) — the one CC left open in P118; recurring,
  capital-markets gov packet lane. Candidate for its own prompt.~~ **FIXED in P122 (2026-08-21)** —
  in-transaction `pg_sleep` blew the statement timeout AND rolled back every queued pg_net request,
  so the gov packet had refreshed zero times in 7 days. See the P122 entry below.
- ~~**`/api/pipeline/match-deal-emails-cron` — 6 `no_response` in 24h**~~ **FIXED in P123 (2026-08-21).**
  Not the same class as the P118 subplan timeouts, and **not 6 of 24** — `net._http_response` is pruned to a
  ~6-hour window, so 6 was the whole retained sample: **100% of hourly calls timed out**, every one at exactly
  60,000 ms (`lcc_cron_post`'s `timeout_milliseconds`). The DB was never the bottleneck (~100 ms per deal);
  the handler was making ~680 sequential PostgREST round trips per run to rediscover already-done work, and
  Railway kept finishing at ~80 s and writing an `ok=true` run-log row after pg_net had already given up.
  See the P123 entry below.
- Transient (self-heal): `SF→LCC Retry&Dead-letter` flow_failure, `cre-owner-backfill` 502, `dup-pair-tick`
  no_response — single occurrences.

## P123 (2026-08-21) — `match-deal-emails-cron` `no_response`: a 60 s wall, not a crash

**Migration `20260821180000_lcc_p123_deal_match_run_log_observability.sql` — APPLIED LIVE to LCC Opps
(`xengecqvemvfknjvbvrq`).** Handler + engine changes ship on the next Railway redeploy of merged `main`
(then `npm run verify:deploy`).

**The diagnosis inverted the premise, twice.**
1. **It was never broken.** `DEAL_EMAIL_MATCH_CRON` is on, and `lcc_deal_match_run_log` has a complete
   `ok=true`, `error_count=0` row for **every** hour. The P122-era count=exact fix held.
2. **It was never a DB timeout.** `lcc_cron_post` posts with `timeout_milliseconds := 60000`; the handler
   took ~75–90 s (cron fires :17:00, the log row lands :18:15–:18:30). pg_net gave up at exactly
   60,000 ms — `net._http_response.timed_out = true`, *"Timeout of 60000 ms reached"* — on **every**
   retained call. "6 in 24h" was the retention window (~6 h), not a 25% failure rate.
3. **The real cost was round trips, not SQL.** Profiled with the handler's actual query shape (P118
   method): the per-deal candidate scan is an index scan at **~99 ms**, so all 36 deals ≈ 3.6 s. The other
   ~75 s was **~680 sequential PostgREST calls** — one idempotency GET plus one roster-edge GET *per matched
   email* — spent rediscovering that all 341 matches were already attributed, every hour.
   **Not a dead worker, and worth stating precisely:** 282 real attributions landed in the last 14 days
   and mail is flowing (692 Outlook events in 7 days). The defect was the CONSTANT re-discovery cost —
   paid in full hourly however little was new — and `already_attributed: 341` reading like throughput
   when it is a re-scan tally. P159a applied to cost rather than output.

**The fix (engine v2.2 + handler + migration).**
- **Bulk pre-fetch** of the attributed-key set and the existing `deal_party` edge set (two paged reads)
  turns both per-email probes into in-memory Set hits. Fails **closed** — a failed prefetch aborts the run
  rather than assuming nothing is attributed and re-POSTing hundreds of rows against the unique index.
- **Candidate query carries core tenant AND city to the DB.** Substring ⊇ the word-boundary test applied in
  memory, so no match can be lost; the candidate set and its payload of full email bodies collapse.
- **Every multi-row read pages at 1000.** PostgREST caps a response at 1000 rows regardless of `limit=`, so
  the old `CAND_LIMIT = 1200` silently returned 1000 and dropped real matches. Truncation is now counted
  (`candidates_truncated`), never silent.
- **Work budget** — `deadline_ms` (default 40 s, inside the 60 s window), `max_writes`, and a deal `cursor`.
  A run stops on a deal *boundary* and hands the next run `cursor_end`, so no backlog can push one
  invocation past the response window. `budget_stopped` reports it out loud.
- **The run-log row is OPENED before the work** (`status='started'`) and PATCHed closed with
  `duration_ms`/stats. Previously the row could only be written on the way out, so a run that genuinely died
  mid-flight left *nothing* and looked identical to one that never fired. A row stuck at `started` is now
  the signature of a dropped run (`v_lcc_deal_match_stalled_runs`); `v_lcc_deal_match_run_health` is the
  per-run line.
- **A failed candidate READ is now an ERROR, not "this deal has no mail"** — the old `cand.data || []`
  swallow made a broken query indistinguishable from a quiet inbox. This is a deliberate behavior change;
  the test that asserted the old swallow was rewritten to assert the new contract.

**Matching logic is untouched** — core-tenant + city + word-boundary + digest exclusion are byte-for-byte
v2.1. Guards: `test/deal-email-match-cron.test.mjs` (9 tests) pins zero per-email round trips, the
fail-closed prefetch, open-before-work ordering, both budget stops, cursor wrap, and the city push-down.

**Verify after the redeploy** (the honest check is the delta, not the tally):
```sql
-- no_response must go to 0, and duration_ms must sit well under 60000
select run_id, status, ok, duration_ms, deals_scanned, deals_total,
       cursor_start, cursor_end, budget_stopped, emails_attributed, already_attributed
  from v_lcc_deal_match_run_health limit 12;
select count(*) from v_lcc_deal_match_stalled_runs;          -- expect 0
select l.request_id, r.timed_out, r.status_code
  from lcc_cron_post_log l left join net._http_response r on r.id = l.request_id
 where l.endpoint = '/api/pipeline/match-deal-emails-cron'
   and l.created > now() - interval '6 hours';               -- expect timed_out = false
```

## P122 (2026-08-21) — `cm-gov-packet-refresh` fixed: the gov CM packet had refreshed ZERO times in 7 days

**Migration `20260821120000_p122_cm_packet_refresh_cursor.sql` — APPLIED LIVE to LCC Opps
(`xengecqvemvfknjvbvrq`). Data/cron layer only, no Railway deploy.** Runbook:
`docs/capital-markets/CM_PACKET_REFRESH_RUNBOOK.md`.

**The break.** `cm_gov_packet_refresh_chunked(p_batch 4, p_sleep 50)` looped the gov chart catalog
firing `net.http_post` per batch with `PERFORM pg_sleep(50)` — **fifty seconds** — between them, all
inside ONE statement. Live: 31 gov charts ÷ 4 = 8 batches × 50s = **400s of in-transaction sleep
against a 120s `statement_timeout`**. Cancelled on every run, 7/7 from 08-15 to 08-21.

**⚠️ And it delivered NOTHING — not "some batches got through".** `net.http_post` is async but its
queue insert is **transactional** (pg_net 0.20.0 INSERTs into `net.http_request_queue`; the worker
only reads *committed* rows). The statement timeout aborts the transaction, so every already-"fired"
request rolled back with it. Proven two ways: a `DO` block that http_posts then `RAISE`s left 0 rows
in the queue and produced 0 responses; and the **state delta** — the gov Q2-2026 row in gov
`cm_report_snapshots` sat at `updated_at = 2026-08-14 20:00:12` across all 7 runs. A single delivered
batch would have bumped it. **Durable rule: a rolled-back `net.http_post` is a silent no-op — never
assume partial delivery from a mid-loop abort.**

**The fix — cursor across invocations.** The serialization intent was right (`mergeRefreshPacket` is a
read-modify-write on one snapshot row, so overlapping merges lose charts); doing it with a multi-minute
sleep in one statement was not. Now `cm_packet_refresh_start('gov')` (daily 09:15, same job name so
the alert `source` stays stable) freezes the catalog into `cm_packet_refresh_cursor`, and
`cm_packet_refresh_tick('gov')` (new job, every minute) fires ONE batch and advances — milliseconds
per tick, no sleep, statement timeout never approached. Idles instantly once covered. Per-batch ledger
`cm_packet_refresh_log` + `v_cm_packet_refresh_health`.

**⚠️ Caught live on the first cycle — A TIMED-OUT pg_net RESPONSE IS NOT COMPLETION, IT IS THE
OPPOSITE.** The first guard advanced as soon as a response row existed. Batch 1 fired 17:00:00.78 at
the inherited `timeout_milliseconds=55000`; pg_net gave up at 17:00:55; the tick read that as "done"
and fired batch 2 at 17:01:00 — but batch 1's merge only upserted at **17:01:09.90, nine seconds
later**. Batch 2 had already read the pre-batch-1 packet, so its merge would have written back stale
copies of batch 1's charts — precisely the lost update the serialization exists to prevent. A 4-chart
gov subset merge measures **~69s**, so 55s was abandoning a request the server was still working on.
Corrected: timeout → 170s, and completion now requires a response that is **NOT `timed_out`**
(fail-forward past `p_max_wait_sec` 300 so a lost response can't stall a cycle).

**Verified by state delta, not return values.** A full clean cycle was driven end-to-end by the
production cron (17:03:10 → 17:20:00): **8/8 batches fired, 0 unreconciled, tick job 23/23 succeeded,
0 failures.** Gov Q2-2026 `cm_report_snapshots.updated_at` **2026-08-14 20:00:12 → 2026-08-21
17:19:16** — first movement in 7 days — and populated charts **41 → 45 of 45**.

**Batch 3 returned a 502** (`cap_rate_ttm_by_quarter, case_for_renewal, cash_leveraged_returns,
core_cap_rate_dot_plot`) — surfaced in the ledger, not silent. Because the merge is non-regressing
those charts kept their existing rows (`cap_rate_ttm_by_quarter` still 354) and simply retry next
cycle. `batches_ok` counts pg_net 2xx and is **not** proof the packet changed — always confirm with
the domain `updated_at` delta.

Synthetic/composed + `DataTable`/`kpi_block` templates stay excluded — documented residual, not a
failure. The 7 stale `cron_failure` alerts for this source resolved with a P122 note (open alerts
30 → 23, 0 for this source). `cm_gov_packet_refresh_chunked` is dropped; reversal runbook in the
migration foot. Cost of the per-minute tick: +1,440 `cron.job_run_details` rows/day on ~5,774/day,
bounded by the existing `cleanup-cron-history` 7-day prune — ~+3 MB steady state.

## P120 (2026-08-20) — the app now MOVES emails: move-queue executor built (was: nothing ever drained it)

**Migration `20260820140000_lcc_p120_move_queue_executor.sql` — APPLIED LIVE to LCC Opps
(`xengecqvemvfknjvbvrq`), so the data layer is live now. The two new sub-routes ship on the next Railway
redeploy of merged `main` → run the deploy gate `npm run verify:deploy` and confirm
`/api/move-queue-worklist` + `/api/move-queue-ack` return JSON, not the SPA HTML.**

**Cowork reconcile-verified live 2026-08-20 (PR #1763 merged @ 37fa2e7):** LCC side all present —
`v_lcc_move_queue_worklist` (n=**340**: 325 staged + 15 duplicate), `lcc_move_queue_ack` RPC, auto-retire
cron, `MOVE_QUEUE_EXECUTOR` flag registered **off**, both routes mounted in `server.js` (L421–422).
**✅ LIVE 2026-08-20 — the app now moves emails.** All three activation steps done: `main` redeployed,
`MOVE_QUEUE_EXECUTOR=true` set on `tranquil-delight` + registry flipped `on`, and the **Flow 7 PA executor built
+ running** (`LCC — Move Queue Executor`, 15-min recurrence). First manual run: **22 `moved` + 3 `already_out`,
0 parked, worklist 340 → 315.** Recurrence drains the rest at ~25/run. Flow-build footguns hit + fixed live:
the guard used `equals(skipped,'')` but the flag-on response OMITS `skipped` (PA `equals(null,'')`=false) → wrap
in `coalesce(...,'')`; the ack URL had `/api-move-queue-ack` (should be `/api/move-queue-ack`); and the msg-id
expr must be `first(body('Find_message')?['value'])?['id']` (the `)` after `['value']`, not around the whole). **⚠️ Ordering hazard to close before/with rollout
(CC-flagged, not fixed):** Flow 6 (`todo-completion-poll`) flips `staged→filed` WITHOUT moving, while the
mirror gates on `outcome='staged'` — if Flow 6 wins the race a message sits in staging forever reading
`filed/moved`. Latent while staging was empty, **now reachable (drainer live 2026-08-20) → drafted as
prompt 121** (`121-staging-move-vs-flow6-ordering-hazard.md`): decouple the mirror worklist from the transient
`outcome` flip (anchor on the mirror ledger), stop Flow 6 asserting a move it didn't make, heal any stranded.

**The break (measured live, 4 independent confirmations).** `staged/pending 325 · duplicate/pending 15 ·
filed/moved 16 · needs_review/skipped 47`. **All 16 `moved` rows carry `outcome='filed'` AND
`target_folder = final_target_folder`** — the signature of the Flow 6 `todo-completion-poll` `staged→filed`
flip; `intake.js` never emits `outcome='filed'`. **So the move executor stamped ZERO rows, ever.** Root cause:
`processing-complete.js` writes the queue row and returns the event in the intake HTTP *response*; the mover
relay (`POST /api/webhooks/processing-complete` → `pa-move-message.js`) is real and correct but has **no
caller** (the only `postMoveMessage` call site is the relay itself) and **never wrote `move_status` on any
path** — no queue endpoint to poll, no stamp-back. `briefing-data.js:297` and the P119 migration header had
both already recorded it. The index `ix_processing_log_move_queue` existed for a drainer nobody wrote.

**Built.** `v_lcc_move_queue_worklist` (actionable-only: has a move key + destination, not parked, outside the
1h backoff; FIFO) · `lcc_move_queue_ack()` (the SINGLE stamp-back path; idempotent) ·
`lcc_move_queue_retire_cleared_parks(dry_run default true)` · handler `api/_handlers/move-queue.js` +
sub-routes `GET /api/move-queue-worklist` / `POST /api/move-queue-ack` (batch-capable) · flag
`MOVE_QUEUE_EXECUTOR` registered in `feature_flags_registry` (state `off`) · PA build sheet
`docs/architecture/flows/move-queue-executor.md` (Flow 7).

**P119 semantics reused, not reinvented** — MESSAGE-not-in-source-folder = terminal SUCCESS on the first ack
(`move_outcome='already_out'`, no retry/park/alert); DESTINATION-folder-not-found = real break → 1h backoff →
park after 5 → deduped `move_queue_parked` alert. The classifier remains the single SQL owner
`lcc_mailbox_mirror_error_is_terminal()`; a test asserts there is **no JS copy**.

**Honest counts:** `move_status='moved'` covers BOTH a real relocation and an already-gone no-op. The
move-DELTA is `move_outcome='moved'`; the ack response reports `moves_performed` separately from `counts`.

**Verified:** 13/13 JS tests + full suite green; live self-rolling-back synthetic gate **11/11 PASS, 0 residue**
(real move · msg-not-found terminal at attempts=0 · dest-folder retries · backoff excludes · park-after-5 with
exactly 1 alert · parked excluded · idempotent re-ack · ack resolves the alert · unknown-message honest ·
clear_flag true for duplicate / false for staged). **The gate caught a real bug pre-ship:** the first cut used
`move_status='error'`, which `processing_log_move_status_check` rejects — the schema already had `move_failed`.

**⏭ Scott's live steps (the backlog does NOT drain until these run):** redeploy + deploy gate → dry-run
`GET /api/move-queue-worklist?force=1&limit=5` → build the PA flow from the Flow 7 sheet → set
`MOVE_QUEUE_EXECUTOR=true` in Railway + flip the registry row to `on`. Then verify by **state delta**
(`select move_outcome, count(*) …` and the falling worklist count), never by the run's own tally.

**⚠️ Ordering hazard surfaced (not fixed here):** once staging fills, Flow 6 flips `staged→filed` *without
moving anything* while the W7.6 mirror (which does the moving) gates its worklist on `outcome='staged'` — if
Flow 6 wins the race the message sits in staging forever while the DB reads `filed`/`moved`. Latent while
staging was empty; reachable now. Close it before/with the `MAILBOX_MIRROR` rollout.

**Also corrected:** `docs/KNOWN_ISSUES.md` called this same symptom **"Impact: cosmetic only"** and recommended
**deleting the `pending_moves` briefing clause** — i.e. removing the only live indicator that the loop was
open. Entry rewritten as RESOLVED with the durable lesson: before calling an unmaintained counter cosmetic, ask
what it would look like if the underlying work were genuinely not happening.

## P150a–P160 (2026-08-19/20, Cowork) — the contact pipe was dead for 3 weeks; owner resolution 2,716 → 4,064

**Not filed as prompt files** — these were done live in Cowork against the DBs. They exist as
`supabase/migrations/20260930120900…20260930121600*.sql` (LCC),
`GovernmentProject/sql/20260819_gov_p155*…20260820_gov_p157*.sql`,
`DialysisProject/supabase/migrations/20260820_dia_p157*.sql`, plus
`GovernmentProject/src/ingest_sam_public_extract.py` and
`docs/RUNBOOK_sam_public_extract_cron.md`. Full narrative in `docs/audits/ROLLOUT_STATUS.md` session log.

**Theme: every failure reported healthy.** Three-week-dead pipes behind green crons; a value gate present
in code and inert in the data; a worker reporting `drillthrough: 37` while draining 6.

| Unit | What |
|---|---|
| P150a/b, P154 | Merge tombstones: evidence stranded, **30 merged-away entities still in the prospect list**, $32.5M double-counted, one live A→B/B→A **merge cycle**. `lcc_entity_survivor()` (hop-capped 20). |
| P151 | Public bodies out of prospects — 234 owners / $87.2M of unworkable BD. Guard matches the governmental FORM, not the word "city" (`Space Center Kansas City Inc` is private). |
| P152 | `lcc_owner_name_is_agent()` — CMBS servicers / trustee banks / OBO managers are not principals. Deferred by P146, P148a and P149; closed here. **60 community banks and 17 individual trustees deliberately NOT matched.** |
| P153 | Article/punctuation duplicate merges (told Scott "5 pairs", merged 86 — all verified genuine). |
| P155 | **The SAM value gate was inert.** `deal_value` used a join path empty for exactly the owners its top tier selects, so ~10 scarce daily lookups went out **alphabetically by UUID**. 131/131 tier-0 owners have rent (max $26.3M) via the other path. |
| P156/a/b/e/f/g | **SAM public monthly BULK extract** — one API request instead of 23,000. Railway (per the standing hosting rule; I built it on GH Actions first and Scott caught it). Layout guard, placeholder-POC guard (**GSA's sample is anonymised to "JOHN DOE" — an `--apply` would have written a fictional person onto 1,117 owners**), per-table uniqueness (union rule was discarding 5.1× the coverage), matcher 7.09s→2.03s. |
| **P157/P157a** | **6 gov + 4 dia `v_*_portfolio` views had `security_invoker=on` → anon got HTTP 200 `[]`.** `lcc_owner_contact_signals` frozen **2026-07-28 → 2026-08-20** with crons 136/137 green throughout. Fixing it exposed a second bug (`21000` on duplicate keys) **dormant only because of the first**. |
| P158/a | New pursuit state **`NAMED LEAD — find their line`** + `v_lcc_named_lead_worklist` — 61 owners / $121.5M we can name but not dial (USAA Real Estate → Joseph Capra, $62.0M). NOT marked reachable (P112). |
| P159/a | Enrich queue 4,472 → **757 actionable**; useful work 32% → 88%; real drain 6 → 16/run. Cron 139 now hourly `limit=100`. |
| P160 | `lcc_merge_entity` repoints the ownership/BD backrefs the reconcile never moved + cycle guard + terminal-survivor resolution. Cleaned **63 dead owners / 99 stranded pivots** it had already created. |

**Near-misses worth remembering** (all caught by measuring before applying): adding `&` as an org marker
would have retyped **119 people and touched 66 resolved owners** — the population is married couples
(`Amy & Richard Gonzalez`); a `bank ... trust` agent arm would have swallowed **60 community banks**;
a `by <brokerage>` rejection guard would have discarded **197 real owners** wearing a capture artifact.

**Book after:** 4,120 prospects / $3.77B — 509 pursuing, 61 named leads, 3,547 needing a contact.

**Operator (Scott):** confirm `SAM_API_KEY` (repo convention, NOT the edge function's `SAM_GOV_API_KEY`)
and gov `SUPABASE_URL` on the new Railway service. Cron `0 0 9 * *` is deliberate — the entity cron
empties the daily quota at 00:15, so any later slot is rate-limited every month.

---

## P119 (2026-08-20) — mailbox-mirror park storm root-caused + auto-retire shipped

**Migration `20260820120000_lcc_p119_mailbox_mirror_not_found_terminal.sql`, applied live to LCC Opps
(`xengecqvemvfknjvbvrq`). No Railway deploy required for the fix itself** (view + RPC + sweep are all
data-layer); the JS change is comment/test only.

**Cowork reconcile-verified live 2026-08-20 (PR #1762 merged @ 5c9862e):** open `mailbox_mirror_parked` = **0**,
total open alerts = **27** (real surface holds), the `cowork-mirror-backlog-retire-20260820` tag intact at 3,960
(auto-retire sweep correctly did NOT re-touch it), `lcc_mailbox_mirror_error_is_terminal` + retire sweep +
`lcc-mailbox-mirror-retire` cron all present, and 1 ack already recorded `already_out` (terminal-success path
live). ⏭ **Real remaining blocker (surfaced, not fixed):** all 323 `processing_log.outcome='staged'` rows sit
`move_status='pending'` back to 2026-07-21 — nothing drains the queue that populates "Intake Staged, Not
Completed", so the mirror correctly but silently acks `already_out` and moves nothing. **That staged-queue
drainer is the next piece of work → drafted as prompt 120** (`120-staged-move-drainer-app-moves-emails.md`):
the `processing_log` move queue is populated (`target_folder`/`move_status`) but only 16 `filed` rows ever
executed — build the move-executor so the app actually relocates emails (Scott's stated goal), reusing P119's
`not_found`=terminal-success semantics. Minor: the PA mover omits `reason` on its failure ack (3,963 ledger
rows `reason=NULL`) — one-line flow fix, in the runbook A5b.

**⚠️ The leading hypothesis below (double-mover race) was RIGHT about the mechanism and WRONG about the
scale — it accounts for 7 of 3,960 rows (0.2%).** Measured live:

- **The mover has moved ZERO messages, ever.** `lcc_mailbox_reconcile_ledger` = 3,963 rows since
  2026-08-06, **0 with `moved=true`**, 100% `last_error='not_found_or_not_in_source_folder'`.
- **100% of the 3,960 parks qualified via the `inbox_triaged` arm** — none via `todos_done` or
  `thread_replied`. And `archived` is not deliberate triage: 2,319 rows were archived in one bulk sweep on
  2026-06-04, another 580 on 2026-06-16.
- **The real cause is producer over-emission.** The worklist had **no source-folder-membership predicate** —
  it published every `inbox_items` row with `source_type='flagged_email'` (4,051) as a move against a folder
  those messages never entered. Split of the 3,960 parks: **3,649 (92.1%) no `processing_log` decision at
  all** (Apr–May 2026 capture, predates the move queue) · 245 (6.2%) `staged` · 45 (1.1%) `needs_review`
  (by design left in place) · 14 (0.4%) `duplicate` · **7 (0.2%) `filed`** — the actual double-mover class.
- **Stale-folder-binding is moot, not ruled in or out.** It's PA-side and unreadable from LCC, but a correct
  binding would still find nothing, because nothing populates the folder (below).

**Fixes:**
1. **Producer gate** — the worklist now requires `processing_log.outcome='staged'` (LCC itself routed the
   message to "Intake Staged, Not Completed"). Producer anchor **4,051 → 323 (−92.0%)**. Ownership rule:
   the intake flow owns Inbox→Processed and Inbox→staging; the mirror owns staging→Processed *only*.
2. **`not_found` is TERMINAL SUCCESS** — a not-in-source-folder ack records `outcome='already_out'`,
   `action='noop'`, attempts 0, no park, no alert, and resolves any open park alert for that message.
   Classifier `lcc_mailbox_mirror_error_is_terminal()` is a narrow allowlist and is the **single owner** of
   that decision (never re-implemented in JS — test-enforced). A **destination**-folder-not-found
   (`ErrorFolderNotFound`, stale `processedFolderId`) still retries, parks and alerts.
3. **Auto-retire sweep** `lcc_mailbox_mirror_retire_cleared_parks(dry_run default true)` + cron
   `lcc-mailbox-mirror-retire` (06:25 UTC). Resolves open parks whose premise cleared, normalises those
   ledger rows so they can't re-park, returns `alerts_left_open` as the honest count of genuinely stuck
   moves. Touches `resolved_at IS NULL` only ⇒ **idempotent and never rewrites the
   `cowork-mirror-backlog-retire-20260820` batch**. Reverse by `resolved_note LIKE 'p119-mirror-auto-retire:%'`.

**Verified live:** 16/16 named terminal-classifier cases pass (including the destination-folder case that
must still alert); a self-rolling-back synthetic gate covers terminal ack → already_out + 0 alerts, re-ack
idempotence, destination-folder break → parks + 1 alert, sweep dry-run mutates nothing, sweep real retires
the cleared park and normalises its ledger row, **and leaves the genuinely-stuck park open** — `all_pass=t`,
**0 residue**. The 3 still-retrying ledger rows all classify terminal on their next ack ⇒ **no new parks**.
Open `mailbox_mirror_parked` = **0**; the 27 real alerts stay visible. JS/tests: 15/15 in
`test/mailbox-reconcile.test.mjs`.

**⏭ Open upstream gap (surfaced, NOT fixed here — it is not a mirror bug).** All **323**
`processing_log` rows with `outcome='staged'` are still `move_status='pending'`, back to 2026-07-21 — the
queue that moves a staged email *into* "Intake Staged, Not Completed" **has never been drained** (the only
rows it ever moved were 16 `filed` ones, 2026-07-21→23). So the staging folder is not being populated and
the mirror will keep correctly + quietly acking `already_out`. **Draining that queue is the next piece of
work.** Also: the PA mover omits `reason` on its failure ack (all 3,963 ledger rows have `reason=NULL`) —
one-line flow fix noted in the runbook.

---

## P118 (2026-08-20) — two overnight cron failures fixed live on LCC Opps

Both surfaced in the 2026-08-20 overnight-verification sweep below. Three migrations, all **live on LCC
Opps (`xengecqvemvfknjvbvrq`), no Railway deploy**: `20260930121200` / `121300` / `121400`.

**Cowork reconcile-verified live 2026-08-20 (PR #1761 merged @ 381ed62):** `field_provenance` = 1.371M
(drained from 1.66M, still shedding), prune guards BOTH FK columns, `idx_entities_norm_name_org` present,
audit row 187741 alive, **0 open `cron_failure` for either fixed job**. Premise corrections from CC accepted:
`lcc_normalize_entity_name(text)` IS `IMMUTABLE` (enabled the index that actually cleared the tick), and
neither cron was an overnight blip. ⏭ **Follow-up flagged by CC, not urgent:** `lcc_feed_owner_signal_addresses`
is still a per-row loop (fast enough now behind the index; set-based rewrite if its 433-row feed grows).

**🔭 NEW finding from the reconcile — health-surface is 99% noise.** `v_lcc_health_alerts_open` = **3,982
open, of which 3,958 are `mailbox_mirror_parked`** (the intake "Processed"-folder mover failing
`not_found_or_not_in_source_folder` and parking one alert per email, still firing 2026-08-20 04:04Z). This
buries the ~24 real alerts (9 http_failure, 5 cron_failure on OTHER jobs, 3 sidebar_promote, etc.) — the
classic Consumption-Layer "999+ badge trains the operator to ignore the surface." Likely cause: the
flagged-intake flow ALREADY moves the email to Processed on success (its Condition → `Move_email_(V2)`), so
the separate mailbox-mirror mover then can't find it in the source folder.

**✅ Immediate cleanup done (Cowork 2026-08-20):** all 3,960 (100% `not_found_or_not_in_source_folder`, terminal
after 5×+park) retired reversibly — `resolved_at` set + `resolved_note` tag `cowork-mirror-backlog-retire-20260820`.
**Health surface 3,987 → 27 real alerts** (cron_failure 6, http_failure 10, flow_failure 3, sidebar_promote 3,
resolver_calibration_drift 3, lcc_health_red 2 — now visible). Reversible by the note tag.
**✅ Durable fix SHIPPED — see the P119 section at the top of this file** (2026-08-20). Note the hypothesis
in the paragraph above is only 0.2% of the story: the mirror had moved **zero** messages ever, and the real
cause was a worklist with no source-folder-membership gate publishing the whole historical flagged inbox.
The tagged backlog was NOT re-cleared.

**⚠️ Scope correction — neither was an overnight blip.** Resolving the alert backlog showed both crons had
been failing on EVERY scheduled run for weeks: **`field-provenance-prune` on 16 days back to 2026-07-25**,
**`lcc-owner-address-feed` on 10 days back to 2026-08-11**. The nightly `cron_failure` alert fired each
time and was read each morning as a fresh one-off. So `field_provenance` had been growing entirely
unpruned for ~4 weeks (to 1.66M) — the disk-pressure → **sign-in-lockout** path, not a cosmetic cron.
21 stale alerts were closed with a P118 note (the unrelated `cm-gov-packet-refresh` alert left open).
**Lesson: a recurring alert that reads as "new today" is worth one `group by job` over the alert history
before triaging it as fresh.**

**(a) `field-provenance-prune` — FK 23503 on the SECOND resolution pointer.**
`field_provenance_resolutions` references `field_provenance` through **two** FK columns; the 2026-08-06
fix guarded `current_provenance_id` only, so a row referenced solely via `attempted_provenance_id`
(id 187741) passed the guard. Because the delete is `where id = any(v_ids)` over a 5,000-id batch,
**one referenced id failed the entire batch** — the prune deleted *nothing* while `field_provenance`
grew to 1.66M. Guard added for both columns, in the dry-run count and the batch CTE.
**Measured: 1,663,282 → 1,371,524 = 291,758 rows pruned, 0 remaining candidates**, all 3 resolutions
and all 6 referenced provenance rows intact (187741 alive). `attempted_provenance_id` is deliberately
NOT nulled to make those rows prunable — it is the audit record of what a resolution *tried* to write.

**(b) `lcc-owner-address-feed` — correlated subplan in the resolver.**
`lcc_resolve_owner_address_observation_entities` recomputed `lcc_normalize_entity_name(e.name)` for every
org entity, for every observation row (`loops=5`, ~1,021 ms each, 45,325 rows removed by filter).
Hoisted into a `norm_org` CTE + LEFT JOIN; earliest-`created_at` tiebreak preserved (`e.id` appended only
to make ties deterministic). Timed in ONE session: old 5,091.8 ms/5 rows (~45 s at 44) → new **1,216 ms at
the full 44 rows, flat** — cost no longer scales with input rows. Equivalence proven on a match-rich
104-row sample (44 unresolved + 60 already-resolved): 58 matched by both, **0-row diff both directions**.

**(c) The fix that actually cleared the timeout — a third instance of the same antipattern.**
(b) alone was **not sufficient**. `lcc_owner_address_feed_tick()` has two halves, and the *feed* half
(`lcc_feed_owner_signal_addresses`) loops row-by-row over 433 signals calling
`lcc_record_owner_address_observation`, whose entity-fallback branch runs the **same** full-table
normalize scan — ~86 ms/row, ~37 s per tick. It is a per-row API called from several places, so it cannot
be hoisted; it needed an index. Added `idx_entities_norm_name_org` on
`(lcc_normalize_entity_name(name), created_at) WHERE entity_type='organization' AND merged_into_entity_id
IS NULL`. **998.756 ms → 0.099 ms, 2,903 → 4 buffers (~10,000x)**, sort node gone.
**End-to-end: the tick went from statement-timeout (>120 s) to 755 ms; the real pg_cron path now
succeeds in 0.7–2.5 s and the prune cron in 23.7 s with no FK error.** `entities_resolved` advanced —
unresolved observations 44 → 43 (only 1 of the 44 has a genuine org match; the rest are honestly
unmatchable, not starved).

### Lessons (durable)

- **The correlated-subplan antipattern recurs — check EVERY layer of a tick, not the one named in the
  error.** The alert's CONTEXT named the resolver, and fixing it left the cron still failing. A wrapper
  that calls two functions needs both timed separately before you claim the fix.
- **A per-row API cannot be hoisted — that is when a functional index is the right answer.** Hoist when
  you control the query; index when the call is the interface.
- **⚠️ A partial index is only usable if the query's predicates IMPLY the index predicate.** Adding
  `AND name IS NOT NULL` to the index WHERE made it valid-but-never-used: the query never states it, and a
  non-STRICT plpgsql function gives the planner no way to infer it. Cost an unexplained "index built,
  nothing got faster" round.
- **`lcc_normalize_entity_name(text)` IS IMMUTABLE** (`pg_proc.provolatile='i'`) — a functional index on it
  is legal. The prompt's premise that it was not was wrong; check `provolatile`, don't assume.
- **Verify a prune by the row-count DELTA, never by its return value.** An MCP/client disconnect at 60 s
  rolls the whole function's transaction back, so a delta of 0 reads identically to "nothing to prune" —
  the candidate set had to be probed with a `LIMIT` to tell them apart. The honest verification path was
  to run both through **one-shot pg_cron jobs** (the real production path), then unschedule them.
- **`count(*)` over a scalar subquery optimizes the subquery away.** The first timing run showed the
  "old" correlated form at 2.3 ms — the planner had elided it. Force it with `count(<the column>)`.
- **Build a small index NON-concurrently.** A cancelled `CREATE INDEX CONCURRENTLY` leaves an INVALID
  index that must be dropped before retrying; at 43k rows the plain build takes seconds.

## 2026-08-20 overnight verification

- **Worker queue clean:** last 24h = `outlook.message.extract` 1,331 **done** (0 failed/stuck) + `cre.doc.text`
  13 done. Forward sweep + intake draining normally.
- **Intake stayed healthy post-fix (13h):** email channel finalized 7 / review 3 / discarded 7 / failed 1 —
  OMs finalizing normally, so the Select-bug fix holds. Last email intake 2026-08-20 11:26Z.
- **16 new health alerts (15h), none blocking, but note:** 11 `mailbox_mirror_parked` (the Processed-folder
  MOVER failing 5x on some just-intaken emails, e.g. the DS0PR05MB9718 OM thread — intake itself succeeded,
  only the tidy-up move parked); 2 `cron_failure` on **`lcc-owner-address-feed`** (failed 05:07Z — **fixed, see P118 above**); 1 `http_failure` no_response to `/api/link-propagation-tick` (transient); 1 `http_failure` **401 to
  `/api/daily-briefing`** (auth). Follow-ups: owner-address-feed cron + the briefing 401.
- **Git:** local repo has a stale lock (`.git/HEAD.lock` + `.git/objects/maintenance.lock` + tmp_obj\_\*)
  left by a sandbox commit racing Git's background `maintenance`. Sandbox can't unlink them (perms). Cleared
  locally by Scott; durable fix = `git maintenance unregister --force` + stop committing from the sandbox on
  this repo. Also uncommitted staged WIP present (CLAUDE.md + p143–p152 migrations + supersession-tie-lane
  doc) awaiting Scott's commit; push still blocked by the 475 MB .pst blob at f85b2c98 (history rewrite pending).

## Milestone 2026-08-19 — email capture end-to-end: forward sweep + contact-history pull live, v2 voice distilled, LCC Intake root-caused & fixed

**Session (Cowork) built and verified live:**

1. **LCC Intake folder "not processing" — ROOT-CAUSED & FIXED (highest impact).** Flagged OMs never reached
   `staged_intake_items`. Cause was NOT attachments (my first hypothesis, wrong): the `LCC Flagged Email
   Intake` flow had been enhanced (post-2026-08-11) to add `body_html` + `to/cc_recipients` via
   `Select`→`Join` actions that read `triggerOutputs()?['body/toRecipients']` as a Graph array — but the
   **`When an email is flagged (V3)` trigger returns To/Cc as semicolon STRINGS**, so `Select` errored every
   run (`'from' … is of type 'String'. The value must be an array`) and killed the flow before the intake
   POST. Fix: deleted the 4 Select/Join actions, repointed `to_recipients/cc_recipients` to the trigger
   strings directly, kept `Get_email_(V2)` (body_html) + the (correct) attachment loop. **Verified live:**
   the 337 E. Coronado Rd. OM finalized from its real 7.28 MB PDF; backlog drained; junk still discarded.
   Doc reconciled: `docs/architecture/flows/lcc-flagged-email-intake.md` (incident + live export
   `LCCFlaggedEmailIntake_20260819220833.zip`). **Recovery:** 4 real-attachment OMs discarded Aug 4–14
   (Oceanside CA, Scarborough ME GSA-DHS, two Aug-5 PDFs) — reflag to retry; the rest of the discards were
   correctly body-only junk.

2. **Forward-capture sweep LIVE.** New recurring PA flow (every 30 min): Graph `GET /me/messages`
   filtered `sentDateTime ge utcNow-2h and isDraft eq false`, per-message → bridge → worker drain. Spans
   Sent+Inbox; the 2h/30min trailing window self-heals gaps and the `internet_message_id` upsert makes
   overlaps free. Verified: 53 jobs/run all `done`, tracked bodies landing into timeline + corpus. Keeps
   the LCC current going forward (both tracking history AND voice).

3. **On-demand contact-history pull LIVE.** New instant PA flow: text input `emailAddress` → Graph
   `$search="participants:{addr}"` with `@odata.nextLink` paging → bridge → drain. Pulls a contact's FULL
   primary-mailbox history (all folders). Verified vs klargent@northmarq.com: 30+ bodies, dedup-safe.

4. **v2 voice distilled on-prem.** `voice-distill.mjs` ran on GaryBuilt (qwen2.5:14b), **760 usable
   Scott-authored** corpus, guards working (46,136 not-from-Scott, 76 app-briefings, 221 self-addressed all
   excluded); wrote `docs/os/voice/briggs-voice-attributes.json`. Per-context signal confirmed (internal
   terse/no-signoff; LOI formal/70% signoff; cold-BD long-form). ⏭ fold attributes into
   `BRIGGS-WRITING-VOICE.md` once the json syncs to the repo; Scott to read/approve before it's the default.

5. **Online Archive backfill PARKED (no IT).** The older SENT-mail voice history lives in the
   auto-expanding online archive, which no Outlook client route can reach (Copy/Move/Export-to-PST all see
   the primary mailbox only; Graph can't see the archive). Requires a Purview Content Search export (IT) —
   deferred per Scott. Primary-mailbox received history already back to 2022-11 (Inbox/Archive swept).

## Milestone 2026-08-18 — the voice profile is re-distilled on full bodies (Prompt 117), and three premises were wrong

**`BRIGGS-WRITING-VOICE.md` v2.0.0** — the sign-off / paragraph-shape / long-form sections that Stage 1
honestly marked LOW-confidence are now **counted off whole emails**, not inferred. Corpus basis, live
2026-08-18: **609 distinct Scott-authored messages after guards — 399 with a FULL body (2026-05-04 →
2026-08-17) + 210 preview-only openings (2022-11-14 → now)**; 129 long-form (≥400 chars), 55 ≥900.

**Three grounded corrections — each one would have quietly wrecked the result:**
1. **"7,851 Scott-authored sent full bodies" is not Scott's mail.** It counts `email_bodies` rows with
   `is_sent=true` that carry a body, but `is_sent` is unreliable on this store — its top senders are inbound
   newsletters (govtribe 1,346, seekingalpha 1,105, salesforce 1,773) and only **1** of the 654 Scott-from
   full bodies has it set. **Scott-from full bodies = 654 → 399 usable.**
2. **`from_email` is NOT authorship.** 118 of 654 are self-addressed — **74 are the app's OWN LCC Morning
   Briefing / Weekly Deep Dive** — and ~107 open by addressing Scott (inbound filed under his address).
   Un-guarded, the profile would have learned the briefing template and other people's voices, and
   draft-assist retrieval could have quoted the app's own briefing back at Scott as an exemplar of his
   voice. New `voiceCorpusExclusion()` gates both surfaces.
3. **The upgrade would have cancelled itself.** All 654 full bodies ALSO exist in `activity_events` as
   ~255-char previews, and BOTH corpus loaders deduped **preview-first** — so every full body would have
   been discarded as a duplicate and the re-distill would have re-learned the openings. Fixed:
   `email_bodies` is drained first in `voice-distill.mjs` and `api/draft-assist.js`.

**Cleaner verified on real full-body shapes.** 24% of full bodies carried NO text reply marker — Outlook's
quote boundary is a div attribute (`id="appendonsend"` / `divRplyFwdMsg`) that vanishes with the tags.
`htmlToText` now emits a sentinel there, min-lead-guarded so an empty div on a fresh compose can't empty the
body (52 emptied → 0). **Retention over the 654: raw body averages 7,537 chars → 1,303 kept (17.3%) — ~83%
of a typical full body is quoted chain + signature + disclaimer.**

**What the corpus actually says about his voice (new):** **86.7% of his emails have no sign-off at all**;
**"Best regards," is the ONLY closer he uses** (13.3%) and it is an EXTERNAL marker — 24.7% of external
follow-ups and 31.3% of LOI/offer threads vs **2.3%** internal; **"Thanks," never appears as a closing
line** (v1 guessed it did). LOI/offer upgrades **LOW → MEDIUM-HIGH** (83 full bodies); cold-BD is still thin
in count (18) but now full-length (median 2,640 chars); listing-announcement (n=1) stays flagged LOW.

**Code:** `voice-corpus-clean.js` (+`cleanEmailBodyDetailed` so the sign-off stays measurable after the
cleaner trims it, `voiceCorpusExclusion`, `bodyShape`, `redactExcerpt`); `voice-distill.mjs` extended with a
no-model deterministic layer (`--stats-only`), `--dry-run`, stratified length+recency sampling, a long-form
pass, and **mechanical verbatim enforcement** (an excerpt that is not a literal substring of the sample is
dropped, so a hallucinated example can't reach the committed profile); draft-assist `voice_confidence` now
reports per-draft FULL-BODY coverage from the retrieved exemplars' real lengths. Tests: 45 + 15 + 33 green.

**⏭ Scott's step (on-prem):** run `node scripts/voice-distill.mjs` on GaryBuilt with `OLLAMA_URL` set (it
refuses without it — the corpus never touches a cloud model), fold the qualitative attributes in, then read
v2 and answer: *does this sound like me now, sign-offs and all?* It should not be the default voice source
until you have.

## Milestone 2026-08-17 — voice corpus FILLING (24 → 654 full bodies); the `upsert_409` was an FK, not a conflict

**Prompt 116 closed the real, final blocker. `email_bodies` full bodies: 24 → 654** (all `body_format='html'`,
324–248,516 chars, verified `<html>…</html>` intact), `upsert_409` errors → 0, and the PA sweep has walked back
to **2026-05-03** and counting. The voice corpus is finally filling from Scott's real Sent history.

**The true root cause — my Prompt-116 premise was half wrong (it was NOT a merge-duplicates conflict):**
- `upsert_409` was a **foreign-key violation (SQLSTATE 23503)**, which PostgREST maps to HTTP 409 *identically*
  to a unique conflict (23505) — so the status code was unreadable. The live Postgres log named it:
  `violates foreign key constraint "email_bodies_source_user_id_fkey"`.
- `email_bodies.source_user_id` FKs `public.users(id)`. **The sweep sent the `lcc_users` id
  `1d3f7321-…` where the working forward path sends the `public.users` id `b0000000-…-0001`** — same person,
  disjoint id spaces (the exact P116 id-collision footgun in CLAUDE.md). Every one of the 10,510 bad-id jobs
  409'd; the 112,030 good-id jobs never did. **⚠ This traces to Cowork's own sweep walkthrough + the
  `OUTLOOK_BODY_SWEEP_FLOW.md` doc, which specified the `lcc_users` id in the `X-LCC-Source-User-Id` header.**
- Wider than reported: the same bad id was also silently killing `activity_events` timeline writes (423 FK
  rejections/24h, swallowed as best-effort). And the PA sweep was correct all along — the bodies were on disk.

**The fix (`api/_shared/source-user-id.js` — the P116 `resolveSourceUserId`):** normalizes ANY inbound id to a
real `public.users.id` (pass-through → `lcc_users` → email → `users` → null), wired into both handlers (also
covers `meetings.source_user_id` + `activity_events.actor_id`). An unresolvable id writes NULL into the nullable
provenance column rather than 409'ing the whole row — losing a mailbox stamp is recoverable, losing a 250 KB body
isn't. `body_persist_detail` now carries the DB's own code/message so the next 409 self-diagnoses. 11 new tests
(FK-first, merge-duplicates-when-asked, DO-UPDATE-payload-cols-only; mutation-checked). PR **#1758** (merged to
origin/main; migration `20260914120000` — retimestamped off a P118 collision).

**Live counts:** 654 = 465 blank rows filled + 165 rows the FK had blocked from existing + 24 from P115. Re-run
probe 0/0/0 (idempotent); 630 reversal rows.

**UPDATE 2026-08-18 — corpus filling fast post-redeploy:** handler fix confirmed live (new sweep jobs 0 × `upsert_409`).
Sent Items exhausted at 654 (folder only retains ~3.5 months, back to May 3 — older mail auto-archived). Pointed the
sweep at the primary-mailbox **Archive folder** (id `…ETAAA=`, 8,781 items) → **`email_bodies` full bodies 654 →
5,110 → 8,631** across resume runs, walking back to **2022-11-04**, zero 409s throughout. **Archive floor CONFIRMED
2026-08-18** (a resume from 2022-11-04 returned 0 older). **⚠ CORRECTION (Prompt 117 re-grounding): the 8,631 is
NOT 7,851 of Scott's sent mail — that was the unreliable `is_sent` flag** (its top "senders" are govtribe 1,346 /
seekingalpha 1,105 / salesforce 1,773; only ~1 of the Scott-from rows carries it). The **8,631 is mostly RECEIVED
correspondence** (the Archive is Scott's archived *inbound*, back to Nov 2022) — a real BROAD-corpus enrichment
(harvest / attribution / draft-assist context), but **not voice**. **Scott's actual SENT voice corpus = 644
full bodies, window 2026-05-03 → 08-17 (~3.5 months)** — verified `from_email ∈ {sabriggs,teambriggs}@northmarq`.
So the primary-mailbox VOICE corpus is still recent-only; **older sent mail lives in the Online Archive** (separate
mailbox, Graph `/me/mailFolders` can't reach it — the remaining voice-history source). The **Inbox sweep (42,644)**
serves the BROADER received-corpus goal Scott named ("all correspondence to enrich the LCC"), NOT voice.
**2026-08-18: Inbox sweep started (after an ASCII-in-URI fix — a non-breaking space from paste) → broad corpus
8,631 → 11,827 full bodies (+3,196 received), 0 409s. Inbox is 42,644 → needs resume-across-runs to finish.**
Voice distill v2 (PR #1760) merged; the on-prem `node scripts/voice-distill.mjs` run is Scott's step
(`--stats-only` first, then GaryBuilt with `OLLAMA_URL`).
Skip junk folders (Sync Issues 71,180, Deleted, Junk, RSS, Clutter).

**⚠ REMAINING STEPS (Scott):**
1. **Railway redeploy of merged main** — the DB backfill is live (hence 654), but the **handler fix isn't
   deployed yet**, so the ongoing sweep is STILL 409'ing new jobs. Redeploy makes it durable.
2. **After redeploy, keep the sweep running** — it walks back a chunk per run (currently at May 2026); re-run to
   continue toward the full ~23K. Newly-swept + any still-409'd jobs then fill in place (fill-blanks, idempotent).

**Doc correction:** `OUTLOOK_BODY_SWEEP_FLOW.md` `X-LCC-Source-User-Id` should be the `public.users` id
`b0000000-0000-0000-0000-000000000001` (the handler now normalizes either, but the doc's `lcc_users` id was the
trigger). 116 prompt/response filed to `done/`.

---

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

## Session 2026-08-17 (Cowork) — P116 reviewed + the redesign's manual checks CLOSED

### Prompt 116 = DONE (PR #1757), applied live — and it corrected me twice

**Result verified independently: brokerage-as-owner 46 → 5**, all `relationship_graph`;
`domain_true_owner` 4 → **0**; `supersession` held at **0**. The 5 remaining are exactly the deliberate
abstains. Assets with a resolved owner 2,294 → **2,275** — *down by design*, because 19 class-(b) owners were
removed and "Unresolved" is the honest state.

**My collision count was wrong, and the reason matters.** I measured collisions with an exact
lowercase compare and reported **17 colliding / 1 ambiguous**. 116 re-scored and found **21 colliding /
4 ambiguous** (BGC-Havasu, Century Park Partners, Mielkemark, MLC Ranch). More importantly it found that
`lcc_normalize_entity_name` — the obvious tool — **strips semantic tokens**, collapsing
`Century Park Partners` and `Century Park Properties LLC` to the same core. Using it would have re-pointed a
property onto **a different company**. It built `lcc_owner_strict_core()` (SQL mirror of the
regression-tested JS `strictOwnerCore`) and re-scored on an identity-safe basis. It also surfaced a third
abstain I never saw: `Michael Moore by Matthews™` is a **person** whose clean twin is an **organization** —
the person/org conflation. Final class (a): **16 repoint · 6 strip · 4 ambiguous · 1 type-shape.**

**My design reasoning was inverted on one point.** I wrote that renaming "makes the duplication invisible."
The opposite is true: `v_lcc_merge_candidates` groups on the *normalized name* needing ≥2 members, and
`"DP Brighton LLC by Marcus & Millichap"` normalizes to `dp brighton by marcus millichap` — which never
groups with `dp brighton`. **That is precisely why it has been invisible.** So renaming the loser is what
*surfaces* the pair to the existing detector; 15 of 16 now appear in the lane (4 already auto-mergeable),
and the 16th (the person) got a `person_duplicate_unmerged` lane rather than being left as silent residue.

It also caught something I had not considered: **`lcc_property_owner_evidence` must be re-pointed too**,
otherwise the next reconcile pass re-elects the duplicate and silently undoes the fix. Proven by re-running
the live feeder over all 41 touched assets: 22 kept the corrected owner, 19 returned `no_evidence`, and the
brokerage count stayed at 5 — **the Unit-4 guard on `relationship_graph` holds.**

**New backlog surfaced, not acted on:** 45 `guard_blocked_candidate` rows — pre-existing assets with
brokerage-named evidence and no resolved owner. Review view total 70.

### Manual checks CLOSED — all green (build `6efd9c27fcc7`)

M-1 ✅ · **M-2 ✅ divider splits, total conserved 720/620 → 920/420** · **M-3 ✅ owner docks beside the
property** · **M-4 ✅ swap exchanges primary/companion** · **M-5 ✅ tray chip carries the real subject name** ·
M-6 ✅ · **UI-4 ✅ fixed and verified live** (owner attached, CTA present, prospecting tier A).

Two caveats: M-2 was proven by driving the divider directly — a real pointer drag landed on the wrong strip
because of my screenshot-vs-CSS pixel conversion, so **pointer hit-targeting at the seam is worth one human
drag**. And I misread panel geometry three times by measuring during the slide-in animation; with the
wrong-query-shape and cold/warm errors that is **five measurement-condition mistakes**, now a standing rule.

### Revised plan

| # | Item | Note |
|---|---|---|
| 1 | **Side-by-side full detail** (Scott's ask) | The companion is still a summary card. Blocked on renderers writing to singleton `#detailBody`/`#detailTabs` — the real work is parameterising a mount root. **The last open item on the redesign itself.** |
| 2 | **UI-5** ladder shows the same name twice on the operator-elevation path | Small, cosmetic, well understood |
| 3 | 45 `guard_blocked_candidate` + 4 ambiguous + 1 person-dup | Human review lanes, surfaced and waiting |
| 4 | 15 merge candidates now visible in `v_lcc_merge_candidates` | 4 auto-mergeable |
| 5 | Perf remainder | Cross-region transport only — architectural, deliberately parked |

**Recommend next: the side-by-side panel** — it's the one thing Scott explicitly asked for that is still
outstanding, and everything else is now either verified, surfaced for human review, or parked with reasons.

## Session 2026-08-16b (Cowork) — brokerage-as-owner classified; the obvious fix was wrong

Branch **`claude/brokerage-owner-prompt-116`**. Analysis + prompt only — **no data changed**.

Exact split of the 46: **(a) 27 suffix-polluted** (`"<owner> by <brokerage>"` — owner correct, name carries
a CoStar artefact) · **(b) 19 rows / 7 distinct pure brokerages** (owner wrong): Marcus & Millichap,
Capital Pacific, Stan Johnson Co, Lee & Associates, NAI Pfefferle, Svn®, Trammell Crow Co (CBRE).

**⚠️ The obvious fix — strip the suffix — is wrong.** The dry-run produced 27 clean, plausible names, but
**17 of the 27 collide with an entity that already exists under the clean name** (`Mielkemark LLC` has
*two*). This is a **duplicate-entity problem, not a naming problem**: the CoStar capture minted
`"X LLC by Broker"` as a separate entity from the existing `"X LLC"`. Renaming in place would create two
identically-named entities — hiding the duplication and leaving the property pointed at the duplicate, with
its own split portfolio, cadence and contact history.

Corrected design is **prompt 116**: re-point the owner to the existing clean entity and file the polluted one
through the *existing* `lcc_merge_entity` path; abstain on the ambiguous 2-candidate case; strip in place only
where no clean twin exists; remove class (b) into a reversible ledger + review **view**; and — the durable
part — **add the brokerage guard to the `relationship_graph` feeder, which produced 42 of the 46** and will
otherwise re-create them. The supersession feeder already has that guard and produced **0**.

I stopped at the prompt rather than implementing: 17 of these need entity **merges**, which is the repo's
most safety-critical machinery, and I have been reminded three times this week that rushing here produces
wrong claims.

### ⚠️ Deploy mismatch — UI-4 is NOT live

The redeploy at `a4fc7beb0d79` contains the **docs** commit (`2bbd4e27`), not the UI-4 fix (`6f7ae2d7`).
Verified by fetching the served `detail.js` — the fix markers are absent. `claude/ui4-asset-lookup-by-id` is
still 1 ahead of main. **Manual checks M-2/3/4/5 remain blocked** until it merges.

Useful check before declaring a deploy done:
```powershell
git branch --no-merged main    # anything listed is NOT deployed
```

## Session 2026-08-16 (Cowork) — Prompt 115 reviewed + VERIFIED in the browser

**Prompt 115 = DONE** (PR #1756), migration `20260911120000_lcc_p115_bd_worklist_decorrelate.sql` already
applied live. It found **three** correlated subplans in `v_lcc_contact_writeback_candidates`, not the one I
diagnosed — each at `loops=1648`: `sf_account_id` (~1.9 s), `rank_value` (~20.5 s, 8.99 M buffer hits),
`rank_property_count` (~7.5 s). Decorrelated: **30,610 ms → 590 ms (51.9×)**, buffers 10.7 M → 232 k, zero
`loops=1648` nodes remaining.

Equivalence was checked properly: `EXCEPT` both directions **and** an md5-per-row multiset check (because
`EXCEPT` is set-wise and would hide a multiplicity change) — **0 rows differ**, 5,054 = 5,054. One semantic
change, `sf_account_id` from an arbitrary `LIMIT 1` to `min()`, was de-risked *before* the edit by
confirming **0 of 1,648 candidates map to more than one SF Account** — byte-identical today, deterministic
from here. It also measured the `ch` branch as instructed and **left it alone** (269 ms of the 30.6 s).

### The verification 115 couldn't do — I did it in the browser

115 was blocked from Railway by its sandbox proxy and explicitly asked that 51.9× be treated as a DB result
until confirmed. **Confirmed** (no redeploy needed — the view reads per request):

| Endpoint | Original | Pre-115 warm | Post-115 warm | |
|---|---|---|---|---|
| `bd_worklist&limit=5` | 8,192 ms | 8,171 ms | **2,485 ms** | **3.3×** ✔ |
| `decisions?summary=1` | 16,199 ms | 10,100 ms | **8,620 ms** | **−47%** ✔ |
| `priority-queue?limit=5` | — | 5,776 ms | 5,314 ms | flat |
| wall-clock to last API | — | 13,925 ms | **12,664 ms** | |

**⚠️ I nearly got this wrong a second time.** The *first* post-115 load read **8,178 ms** and I started
writing "P115 didn't translate" — that was a **cold** call; the next warm load was 2,485 ms. Same class of
error as §4.2d (measuring `LIMIT 5` instead of the handler's `LIMIT 150`): the number was real, the
condition was wrong. **Standing rule: label every timing cold/warm; never conclude from one sample.**

### Where `bd_worklist` time now lives — and it is not LCC

Isolated with the endpoint's own `?type=` filter, warm, twice each:
`suspected_sale` **1,847 ms** (gov, cross-region) · `ownership_chain` 674 · `contact_writeback` **600**
(the view 115 rewrote) · `owner_source_conflict` 504 · `loan_maturity` 249 · **all 1,870** (≈ the slowest,
as expected for a parallel fan-out).

**The LCC view is no longer the bottleneck.** The floor is `v_suspected_sale` on gov. Further work starts
there, not in LCC.

### Revised plan — perf thread is effectively closed

Remaining perf items are all **cross-region transport**, which is architectural (three Supabase projects in
three regions) and not worth chasing before the product work:
1. `decisions?summary=1` 8.6 s — the `count=exact` per federated lane in `fetchFederatedSource` is the last
   tractable term.
2. `priority-queue` 5.3 s — ~250 ms of DB; the rest is handler + transport. **115 correctly refused to
   invent a SQL fix here.**
3. `v_suspected_sale` (gov) — the new `bd_worklist` floor.

**Recommended next is product, not perf:** the **brokerage-as-owner cleanup** (46 rows, two classes,
detector already built) and the **outstanding manual checks** M-2/3/4/5 on the panel divider.

## Session 2026-08-15i (Cowork) — BROWSER re-measure, and a retraction

Driven directly in Scott's browser (Claude-in-Chrome) against merged build `41e03651a6b9`, two consecutive
loads to separate cold-start. Full detail: `panel-redesign-verification.md` §4.2d.

| Endpoint | Original | Warm now | |
|---|---|---|---|
| `decisions?summary=1` | 16,199 ms | **10,100 ms** | **−38%** ✔ |
| `bd_worklist&limit=5` | 8,192 ms | **8,171 ms** | ❌ **no change** |
| `priority-queue?limit=5` | not captured | **5,776 ms** | ⚠ new |
| wall-clock to last API | — | 13.9 s | |

### ⚠️ Retraction — my "bd_worklist 4.2× faster" claim does not apply

I measured `v_lcc_bd_worklist` at `LIMIT 5` **with no ORDER BY**, which short-circuits after five rows. The
handler runs `ORDER BY rank_value DESC LIMIT 150`, and an ORDER BY materialises the **whole view**:

| shape | execution |
|---|---|
| `LIMIT 5`, no ORDER BY *(what I measured)* | 321 ms |
| `ORDER BY … LIMIT 25` | **18,561 ms** |
| `ORDER BY … LIMIT 150` *(the handler)* | **19,320 ms** |

**The limit is irrelevant** — so the fix I was about to ship (shrink the handler's `CAP` 150 → ~3× limit)
would have done nothing. That would have been my third wrong claim on this endpoint; measuring first is the
only reason it didn't ship.

**Real cause, now precisely located:** `SubPlan 2` is a correlated aggregate running **1,648 times** — once
per candidate person — each re-aggregating ~3,681 organizations *and* linearly re-filtering the entire
15,981-row `owner_link` CTE (`Rows Removed by Filter: 15981`, per loop). The index + ANALYZE were correct
and durable (they fixed the CTE seq scan and the planner estimates) but cannot fix a per-row correlated
subquery. That needs a **view rewrite** → **prompt 115**, written and grounded in the plan output. Not
attempted here: it changes a shared BD surface (home rail, My Day, worklist) and deserves its own dry-run
rather than being bolted onto a pass I have already been wrong about twice.

**Honest scoreboard:** `decisions?summary=1` genuinely improved by 6.1s. The stats/index work is correct but
did not move the endpoint it was aimed at. `bd_worklist` and `priority-queue` remain open and are now
diagnosed rather than guessed at.

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

