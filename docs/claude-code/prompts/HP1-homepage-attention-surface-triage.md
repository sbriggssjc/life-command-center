# HP1 — Homepage attention surface: the Today 500, the stale My Work, the mailbox Inbox

**Filed 2026-09-12 from a live Cowork read-only triage.** Scott's report: an intermittent HTTP 500
across all three Today lanes on login; My Work and Inbox showing items "well behind where the actual
status of each deal is" and items "that should be automated and not the top of our inbox's homepage."
His stated intent for the surface: *"The homepage should be a view of the work that needs the broker's
attention and review in priority order."*

Everything below was measured live (LCC Opps `xengecqvemvfknjvbvrq`, read-only) or read from the
committed code. Numbers are as of 2026-09-12; re-measure before building — that is this repo's rule.

---

## Finding 1 — the 500 is one endpoint, one unhandled timeout, and no per-lane isolation

**Endpoint:** `GET /api/operations?action=today_sections` → `getTodaySections` (`api/operations.js:2038`).
All three lanes render from this ONE response (`renderTodaySections`, `app.js:7458`), which is why the
screenshot shows the identical error in Significant, Important AND Urgent — it is one failure, drawn
three times, not three failures.

**The mechanism, exactly:**

1. `getTodaySections` fires six queries in a single `Promise.all` (ops ×4, gov ×1, dia ×1).
2. `opsQuery` (`api/_shared/ops-db.js:63`) calls `fetchWithTimeout(url, opts, timeoutMs)` with a
   **default of 8000 ms** and **does not wrap it in try/catch**. `fetchWithTimeout` aborts via
   `AbortController`, which makes `fetch` **throw**, not resolve `{ok:false}`.
3. `getTodaySections` has no try/catch of its own. So one slow source → `Promise.all` rejects →
   `withErrorHandler` (`ops-db.js:240`) → **HTTP 500**.
4. The handler already defends against a *failed* query (`sellerQR.ok ? ... : []`) — it just never
   defends against a *thrown* one. The `ok:false` branch is dead code for the timeout case.

**Which source is the one that crosses 8 s.** `v_lcc_seller_prospect_queue?select=*&limit=200` with
`countMode:'exact'`. Measured warm with `EXPLAIN ANALYZE`:

| query | warm execution |
|---|---|
| the 200-row page | **815 ms** |
| the exact `COUNT(*)` PostgREST runs *in addition* under `Prefer: count=exact` | **750 ms** |

≈1.6 s warm for that one call. The plan is not index-shaped: a `Seq Scan on entities` (56,289 rows
surviving the filter) run twice, a `Seq Scan on lcc_property_attributes` (30,928 rows), two
`Seq Scan`s on `lcc_entity_portfolio_facts`, a 115,981-row index-only scan of `entity_relationships`
with **33,812 heap fetches**, and a correlated `SubPlan` against `activity_events` executed
**1,518 times**. On a cold shared-buffer cache — i.e. the first page load after the app has sat idle,
which is precisely "every so often when we log into the app" — those seq scans hit disk and the call
runs several-fold longer. That is what crosses the 8 s abort.

**Corroborating detail in the repo's own comment.** `ops-db.js:80-84` says the `timeoutMs` option was
added (R6 hotfix) precisely because "heavy aggregate views (e.g. `v_priority_queue_enriched`, ~5-7s to
materialize) need more headroom so a slow-but-successful read isn't aborted into a blanket 500."
`getTodaySections` passes **no `timeoutMs`** on any of its six calls. The fix for this exact class of
bug exists in the codebase and was never applied here.

**Three separate defects, fix all three:**

- **1a — no timeout budget.** Give the seller-prospect call explicit headroom (`timeoutMs: 20000`),
  and the rest a sane budget. Headroom alone is a band-aid; do 1b and 1d too.
- **1b — no per-source isolation.** Replace `Promise.all` with `Promise.allSettled`. A source that
  times out should empty *its own* lane and name the gap (this module already has a `named_gaps`
  contract for exactly this — P131's "a coverage gap is filed, never faked"), not 500 the other two.
  Significant's source has nothing to do with Urgent's; today they die together.
- **1c — `count=exact` doubles the work for a label.** All four ops calls use `countMode:'exact'`, and
  the only consumer of `total_open` is the "See all (N) →" button text. Downgrade to `'estimated'`
  (or `'none'` + `count: items.length`) for `bd_opportunities`, `action_items` and
  `v_lcc_bd_worklist`. Keep exact for the Significant queue ONLY if a stated rule requires it — and
  if so, materialize it (next line) rather than paying for a 750 ms COUNT on every page load.
- **1d — the view needs to stop being computed per request.** `v_lcc_seller_prospect_queue` is a
  ranked BD queue that changes daily at most. It is a candidate for a materialized view refreshed on
  the existing cron cadence (cf. `lcc-priority-queue-refresh`, `*/5 * * * *`, which already does this
  for the priority queue). Measure both before choosing: an MV is a new drift surface (I16), so only
  take it if the per-request cost is real after 1c.
- **1e — the front end lies about scope.** `_todaySectionsFallback` writes the same "Today unavailable
  — HTTP 500" into all three lanes regardless of which source failed. Once 1b lands, render per-lane.

**Do NOT** "fix" this by raising the front-end 12 s race in `renderTodaySections` — that timer is
downstream of the server's own 8 s abort and is not the cause.

---

## Finding 2 — My Work is stale because the deal backbone stopped moving, and nothing ages a task out

**Live counts (2026-09-12):** 66 open `action_items`; **57 overdue**; **38 more than 30 days overdue**.

**Breakdown by producer:**

| action_type | open | oldest due | >30d stale |
|---|---|---|---|
| `deal_next_step` | 37 | 2026-04-10 | 26 |
| `send_info` | 10 | 2026-07-31 | 5 |
| `reply_overdue` | 5 | 2026-08-05 | 1 |
| `schedule_call` | 4 | 2026-08-01 | 2 |
| `seller_follow_up` | 4 | 2026-07-31 | 2 |
| `review_response` | 3 | 2026-08-04 | 2 |
| `follow_up` | 2 | (no due date) | 0 |
| `advance_to_contract` | 1 | 2026-08-29 | 0 |

**2a — The generator is self-correcting on the wrong axis.** `lcc_generate_deal_next_steps()`
(`supabase/migrations/20260818200000_lcc_deal_stage_next_step_engine.sql`, cron
`lcc-deal-next-steps-daily` @ 05:15 UTC, **active**) retires an auto step when — and only when —
`bd_opportunities.stage` changes, the deal closes, or the deal disappears. **There is no time-based
retirement.** A deal whose stage never changes keeps its task open forever while the due_date ages
into the red. The engine is working exactly as written; what is missing is the clause that says a
task nobody has acted on in N days is a *question about the deal*, not a task.

**2b — and the stage data it keys on has been frozen since early August.** Every open row in the
transaction stages, measured live:

| stage | open rows | last `updated_at` | rows whose `expected_close_date` is already past |
|---|---|---|---|
| `listing_signed` | 18 | 2026-09-10 | 3 |
| `identified` | 7 | 2026-08-27 | 0 |
| `bov` | 7 | **2026-08-04** | 6 |
| `off_market_listing` | 6 | **2026-08-03** | 6 |
| `loi_executed` | 5 | **2026-08-03** | 3 |
| `qualified_lead` | 3 | 2026-08-20 | 1 |
| `non_refundable` | 2 | 2026-09-10 | 2 |
| `in_escrow` | 1 | 2026-09-07 | 1 |
| `(null)` | 1 | 2026-07-31 | 0 |

**22 of the 50 open deals have an `expected_close_date` in the past** — including `ECU Physicians MOB
- Greenville - NC` at **2024-08-27** and `Pops Mart Fuels - Portfolio 2 - SC` at **2025-09-25**. Two
of the four cards in Scott's screenshot trace straight to this: *DaVita Portfolio 4 - Realty Income -
May 2026* is still `loi_executed` with `expected_close_date = 2026-07-16` (58 days past), and its task
due date is exactly `close_date − 14` = Jul 2, which is what the card shows; *DaVita Dialysis - Queens
- NY* is still `listing_signed`.

**2c — why the backbone froze.** `bd_opportunities` is **pushed** into LCC from Salesforce by Power
Automate hitting `/api/pipeline/ingest-opportunity` (`mcp/opportunity-sync.js`). Nothing pulls. So LCC
learns a deal advanced only if (i) a human advanced `StageName` in Salesforce AND (ii) the flow fired.
The table as a whole is still being written (`max(updated_at)` 2026-09-10, 619 rows), so the pipe is
not dead — the *transaction-stage rows specifically* have not changed. Whether that is a Salesforce
hygiene gap or a flow-scope gap is the one thing this triage could NOT determine read-only, and it is
the first thing to establish: **do not assume**. The repo already runs `lcc-bd-sync-health-check`
(05:00) and `lcc-feed-freshness-sync` (05:30) for other feeds; the deal backbone has no equivalent
freshness assertion.

**2d — My Work sorts chronologically, not by value.** `v2GetMyWork` (`api/queue.js:462`) defaults to
`due_date.asc.nullslast,created_at.desc`, and `loadCanonicalData` (`app.js:6220`) requests
`sort=due_date`. The consequence is structural: **the oldest, most-ignored task is always pinned to
the top of the homepage.** That is the graveyard effect Scott is describing. Meanwhile the Today card
directly above it already ranks by client value and overdue-beats-valuable
(`buildUrgentSection`) — two widgets on one page, two contradictory orderings.

**What to build (propose, measure, then decide with Scott — this is his workflow, not a data model):**

- A **deal-status confirmation lane**: open deal, stage unchanged ≥ N days OR `expected_close_date`
  in the past → one item that asks *"is this deal still where LCC thinks it is?"* with the stage,
  the frozen-since date, and a one-click advance/close. This replaces N silently-rotting tasks with
  one honest question. Render "Not on file"/"Conflict" semantics, never a guessed stage.
- Add an **age clause** to `lcc_generate_deal_next_steps()`'s retire step so an auto task past a
  threshold retires with `retired_reason='aged_out'` and routes to the confirmation lane. Reversible
  and logged, per the existing metadata convention.
- A **backbone freshness check** alongside the existing sync-health crons: alert when no
  transaction-stage opportunity has changed in N days. Frozen data must announce itself — this is
  the same I16 "running is not committed" family of failure, applied to a feed.
- **Re-rank My Work** on the same function Today's Urgent lane already uses. One ranking, one page.

---

## Finding 3 — the Inbox is a reverse-chronological mailbox holding mostly machine work

**Live `inbox_items` at `status='new'`: 953.** Composition:

| source_type | new | what it actually is |
|---|---|---|
| `new_contact_qualify` | **850** | data hygiene — does this contact belong to this company |
| `contact_misparse_review` | 38 | data hygiene — name parsing |
| `email_om` | 21 | inbound OMs |
| `email_alert` | 19 | vendor/bank notifications |
| `flagged_email` | 14 | Outlook-flagged |
| `sidebar_om` | 7 | |
| `folder_feed_om` | 4 | |

**93% of the homepage inbox population is data hygiene, not broker judgment.** Those lanes have their
own review surfaces; they do not belong in the same bucket the Today page reads.

**3a — the human-facing residue is mostly market data, not decisions.** The actual live `new` rows,
verbatim: `New Listing: DaVita in Spokane WA | Absolute NNN Leasehold`, `FW: New Listing: DaVita in
Spokane WA | ...` (**the same announcement twice — original and forward, not deduped**),
`New Listing Announcement - SSA - MINDEN, LA`, `Fresenius - Pittsboro, NC - SOLD COMP`, and
`BOK: Here's the balance alert you requested.` A competitor's new-listing blast and a sold-comp
announcement are **comps and market intelligence** — they should land in the comps/listing feeds
automatically and surface on the homepage only when they touch a live deal, a tracked owner, or a
subject property. A bank balance alert should never have reached this surface at all.

**3b — the titles are unreadable.** `OM: email-body-AAVtKA8aAAA.txt`, `OM: email-body-AAVhnrBOAAA.txt`,
`OM: email-body-AAVhnrBBAAA.txt` — four of the 21 new `email_om` rows are titled from the raw MIME
part filename because no property was parsed. A card a human cannot identify cannot be triaged, so it
sits forever. Title from the resolved property; when nothing resolved, say so ("OM — property not
identified") rather than showing the filename.

**3c — there is no ranking, and the column for it is dead.** `inbox_items.priority_score` exists as a
numeric column and is **written by exactly one path** — `api/intake.js:1054`, and only for
`domain='infra'` rows. The read path, `v2GetInbox` (`api/queue.js:517`), orders `received_at.desc`
and never reads it. So "the top of our inbox's homepage" is literally just "most recent email." The
ranking column Scott is asking for is already in the schema, unused.

**3d — the classifier is not the problem.** 3,847 `email_om` triaged + 2,252 dismissed against 21
new: the machine is already disposing of >99% of this volume. The 21 are residue, not a backlog. So
this is a **routing and ranking** problem, not a classification problem — resist rebuilding a
classifier (review existing machinery before building).

**What to build:**

- **Route hygiene out.** `new_contact_qualify` and `contact_misparse_review` leave the homepage inbox
  for their own review lanes. Measure the homepage inbox count before/after — it should drop from
  953 to roughly 65.
- **Auto-dispose the announcement classes** (new-listing blasts, sold-comp notices, vendor alerts)
  into the comps/market feed, and promote one to the homepage only when it matches a live deal,
  a tracked owner, or a subject property. Dedupe the FW/original pair on message content.
- **Populate and order by `priority_score`** — rank by the deal or owner value the item touches, the
  same client-value axis the canon's Today doctrine uses. Do not invent a second scoring vocabulary.
- **Fix the title derivation** for OM items with no resolved property.

---

## Finding 4 — the design point underneath all three

The homepage today shows three widgets with **three different sort orders**:

| widget | ordering | state |
|---|---|---|
| **Today** (Significant/Important/Urgent) | ranked by client value, overdue beats valuable | **the correct design — and it is the one that 500s** |
| **My Work** | `due_date.asc` — chronological | oldest-and-most-ignored floats to the top |
| **Inbox** | `received_at.desc` — chronological | most-recent-email-wins, 93% machine work |

The canon already states the intent (`docs/os/canon/blocks/operator-doctrine.md` 1.8.0): *"Today is
the day's tasks only, ranked by client value... the surface exists to keep Urgent from crowding out
Significant."* The Today card is the doctrine made real. My Work and Inbox are **legacy
pre-doctrine widgets that were never re-cut** when UX-T1a-today shipped (2026-09-03) — they were left
in place below the new card, and they are the two Scott is complaining about.

So the alignment is not a redesign, it is finishing the one already started:

1. **Make Today reliable** (Finding 1) — it is the answer to "work that needs my attention in
   priority order," and it is currently the least reliable thing on the page.
2. **Subordinate My Work to it** — My Work becomes Urgent's detail view, on the same ranking
   function, with aged items routed to a deal-status confirmation lane instead of rotting.
3. **Subordinate Inbox to it** — the homepage inbox shows only items needing a human verdict, ranked
   by the deal/owner value they touch; hygiene and market-data lanes move off the homepage.
4. **One ranking function, three surfaces.** Today, My Work and Inbox must not each carry their own
   ordering — that is the normaliser drift this repo keeps paying for, in the UI layer.

---

## Sequencing

**P0 (ship first, smallest, unblocks the surface):** Finding 1 — 1b (`allSettled`) + 1a (timeout
budget) + 1c (count mode) + 1e (per-lane error). Guard test that a thrown source degrades one lane and
returns 200. Re-measure the view cost after 1c before deciding on 1d.

**P1 (the honesty fix):** Finding 2c freshness check + 2a deal-status confirmation lane. Establish
FIRST whether the frozen stages are a Salesforce hygiene gap or a Power Automate scope gap — 👤 Scott.

**P2:** Finding 3 routing + ranking; Finding 2d My Work re-rank onto the shared function.

**Standing rules apply:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is
reconcilable, never automatic truth; review existing machinery before building; document at every
step; commit with the repo's `Co-Authored-By` + `Claude-Session` trailer.
