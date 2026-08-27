# A5a — the research-task generator auto-closed over a truncated feed

**Correctness fix in a shared generator.** Measured live 2026-08-27 against LCC Opps
`xengecqvemvfknjvbvrq`, dia `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`.
Prior: `docs/audits/A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md`.

> ## The one-line finding
>
> **The auto-close guard compared the number of rows it ASKED FOR against the number it GOT.**
> `if (feed.length < limit)` — 1,000 < 2,000 — so it passed on every PostgREST truncation and
> closed every open task outside a 1,000-row window as `gap_resolved`. Its own comment said
> *"never on a capped slice."*
>
> **And the blast radius is 15× what A5 measured.** A5 said 5,509 dia gaps had never had a task.
> Across both domains it is **69,448 of 71,448** — and **three entire lanes have never had a single
> task minted in their lives.**

---

## 1. What was measured, before touching anything

### 1a. Every lane this generator auto-closes (`source_table = 'v_next_best_research'`)

| domain | lane | open now | completed | `gap_resolved` | real completions |
|---|---|---:|---:|---:|---:|
| gov | `property_missing_recorded_owner` | **1,000** | 4,410 | **4,410 (100%)** | **0** |
| dia | `true_owner_needs_salesforce` | **815** | 596 | **596 (100%)** | **0** |
| dia | `property_missing_recorded_owner` | **185** | 371 | **371 (100%)** | **0** |
| gov | `property_missing_true_owner` | **0** | 386 | **386 (100%)** | **0** |
| | **total** | **2,000** | **5,763** | **5,763** | **0** |

**Not one task in this generator's history has ever been completed by a human, a worker or a
verdict.** 934 of those closures landed in the last 30 days — the "~900 false closures/month".

> ⚠️ A5 reported `property_missing_recorded_owner` as one lane at 4,781 completions. That figure is
> **gov 4,410 + dia 371**, two different lanes in two different databases. Per-domain is the honest
> unit — the two behave differently (see §5).

### 1b. The pinned-constant signature, both domains

| domain | open tasks | = |
|---|---:|---|
| gov | 1,000 + 0 | **exactly the 1,000-row cap** |
| dia | 815 + 185 | **exactly the 1,000-row cap** |

Two independent databases, two independent feeds, both totalling **exactly 1,000**. That is not a
backlog; it is a reading of the instrument.

### 1c. Lanes this generator does NOT touch — confirmed, not assumed

`establish_ownership_history` (314 completions) and `trace_ownership_to_developer` (52) are fed by
`v_lcc_ownership_chain_completeness`, a **different** generator, and carry **0** `gap_resolved`.
Every other producer in `research_tasks` (`owner_contact_pivot`, `mv_npi_inventory_signals`,
`lease_extraction`, `lcc_decisions`, `state_lease_events`, `deed_extraction`, `news_alert_leads`)
likewise carries **0**. The A5 verdict that those completions are real **stands**.

## 2. ⚠️ Three lanes have never had a single task, and A5 did not see them

The feed is not 29,643 rows. It is **71,448** across two domains and **six** research types:

| domain | research type | priority | feed rows | tasks ever minted |
|---|---|---:|---:|---:|
| gov | `owner_needs_sos` | 10 | **16,873** | **0 — never** |
| gov | `owner_needs_salesforce` | 20 | **13,724** | **0 — never** |
| gov | `property_missing_recorded_owner` | 0–74 | 11,180 | 1,000 |
| gov | `property_missing_true_owner` | 14–21 | 28 | 0 |
| dia | `property_missing_county_record` | 0–2 | **9,761** | **0 — never** |
| dia | `owner_needs_sos` | 10 | **7,204** | **0 — never** |
| dia | `true_owner_needs_salesforce` | 20 | 6,324 | 815 |
| dia | `property_missing_recorded_owner` | 0–52 | 6,354 | 185 |
| | **total** | | **71,448** | **2,000** |

**69,448 gap rows have never had a task**, and four lane-domains (`owner_needs_sos` ×2,
`owner_needs_salesforce`, `property_missing_county_record` — **47,562 rows**) have never once
appeared in `research_tasks`. They sit below the priority band the truncated window reaches, so no
surface has ever shown them and no audit has ever counted them. **A lane that has never emitted is
invisible to a query that groups by lane.**

## 3. The three defects, and why all three had to be fixed

1. **The guard compared the requested limit against a capped response.** PostgREST caps any
   response at 1,000 rows regardless of `limit` — the invariant already in `CLAUDE.md`, which cost
   the dia owner-facts sync 6,000 rows. Raising `limit` cannot help: the cap is server-side, and a
   bigger number just re-creates the lie (`CAND_LIMIT = 1200`, P123).
2. **The feed was read once, unpaged.** One request, one page, 1,000 rows, 71,448 needed — and
   nothing else ever asked whether the missing rows existed.
3. **The sort had no tiebreak, and every gap arm hard-codes its priority.** `20 AS priority` is a
   literal — **6,324 dia rows and 13,724 gov rows tie at exactly 20** — so the "top 1,000" was an
   arbitrary, unstable slice, and offset paging over it would have dropped and repeated rows.

**Fixing any two without the third leaves the bug.** An untied sort is not deterministic even when
paged; a tiebreak on a single truncated fetch still truncates; and a correct guard over a truncated
read just disables the auto-close permanently — which is why the close had to stop depending on a
bulk read at all (§4).

## 4. The fix — two budgets, and completeness bought by PROBING not downloading

`api/_shared/nba-feed-sweep.js` (new, pure, the single owner of these rules) + `api/admin.js`.

- **Truncation is read from the RETURNED count against the server's page cap**, never from a
  requested limit. Reads stride at exactly `FEED_PAGE_SIZE = 1000`.
- **The ranked read is a TOTAL order** — `priority.desc,research_type.asc,entity_id.asc`. Verified
  live: `(research_type, entity_id)` is unique in **both** feeds (29,643/29,643 and 41,805/41,805)
  with zero null entity_ids, so the head is deterministic instead of an arbitrary tie slice.
- **The close is settled by a chunked MEMBERSHIP PROBE** — the generator asks the feed, directly,
  which of its ~2,000 open subjects are still a gap, 150 ids per request. `complete` is true only
  if every subject was asked about **and** every chunk came back under the response cap.
- **⚠️ FAIL CLOSED.** `planAutoClose` closes **nothing** unless membership is complete. A probe
  error, an unsafe subject id, or a chunk that hit the cap closes nothing and names the reason in
  the response.
- **Two budgets, not one** — the shape of the change. The **close** needs COMPLETENESS; the **mint**
  needs PRIORITISATION and stays capped at `limit` (§6).
- **`?dry_run=1`** reports `would_close` / `would_insert` / `would_refresh` and writes nothing.
- **An ignored entity counts as still-present.** Muting a recommendation does not resolve its gap,
  so closing its task as `gap_resolved` was a second false claim. Can only ever reduce closures.

### ⚠️ Why the feed is NOT paged in full — the obvious fix was measured and rejected

Downloading all 71,448 rows is the natural reading of "page the feed", and it was implemented
first. `EXPLAIN (ANALYZE, BUFFERS)` on the gov view killed it:

| read shape | time | notes |
|---|---:|---|
| ordered, `limit 1000 offset 41000` | **1,149 ms** | materialises and external-sorts **all 41,805 rows**, 8 MB spilled to disk — **per request, at every offset** |
| filtered `entity_id in (…10 ids…)` | **44 ms** | predicate pushes into every UNION arm; no sort, no spill |

This is the documented *"an `ORDER BY` forces the whole view to materialise, so the `LIMIT` is
irrelevant"* footgun. A 42-page offset sweep is **~48 s of gov DB time per run**, and cron 35 fires
every 30 minutes — **~64 min/day of pure re-sorting on the shared PostgREST pool that the
2026-08-12 incident wedged.** Offset paging is also O(pages²) in work, since each page re-sorts the
whole view.

**The probe is not a weaker guarantee, it is a stronger one.** A downloaded list only supports
`close if absent`, and is only ever as complete as the fetch that built it — which is exactly how a
1,000-row truncation came to mean "the gap resolved". The probe asks about each open subject
directly, and refuses any answer that could itself have been truncated. Cost: **~14 chunks
fleet-wide, ~0.6 s**, versus ~48 s.

**Guard:** `test/nba-feed-truncation-guard.test.mjs` (14 tests). Per the block-slice footgun it
anchors on stable identity tokens over the whole file — the defect's own comparison, the order
string — never a line number or a sliced region. **All nine mutations verified RED:**

| mutation | result |
|---|---|
| truncation test uses `<=` (a full page counted as proof) | 3 fail |
| `planAutoClose` fails OPEN instead of closed | 2 fail |
| page cap 1000 → 2000 | 5 fail |
| ranked order loses its tiebreak | 1 fail |
| mint head unbounded | 1 fail |
| probe chunk large enough to fill the response cap | 1 fail |
| unsafe subject ids accepted into the `in.()` list | 1 fail |
| probe ids keyed per-lane instead of deduped per subject | 1 fail |
| `api/admin.js` reinstates `feed.length < limit` | 2 fail |
| **baseline** | **14 pass / 0 fail** |

## 5. ⚠️ The auto-close was not uniformly false — measure per lane

View-membership check (is the subject still in the feed today?), sampled from the distinct closed
subjects:

| domain | lane | closures | distinct subjects | sampled | **still in feed = false closure** |
|---|---|---:|---:|---:|---:|
| gov | `property_missing_recorded_owner` | 4,410 | 1,525 | 250 | **239 (95.6%)** |
| dia | `true_owner_needs_salesforce` | 596 | 421 | 183¹ | **170 (92.9%)** |
| dia | `property_missing_recorded_owner` | 371 | **369 (census)** | 369 | **195 (52.8%)** |
| gov | `property_missing_true_owner` | 386 | 316 | 250 | **0 (0%)** |

¹ A5's sample, carried forward.

**`property_missing_true_owner` closed legitimately.** Its feed fell to 28 rows — the gap really did
resolve for those 316 subjects. The auto-close is false **where the feed is larger than the window**,
which is why a blanket "all 5,763 were wrong" would have been as inaccurate as the original claim.
And dia `property_missing_recorded_owner` sits in between at 53%. **Per-lane, on named rows.**

## 6. What the first correct run does — measured, not predicted

Simulated the exact new sort and mint head against the live feeds.

**Mint head at `limit=2000` (cron 34):**

| domain | lane | in head | already open | **newly emitted** |
|---|---|---:|---:|---:|
| gov | `property_missing_recorded_owner` | 1,568 | 1,000 | +568 |
| gov | `owner_needs_salesforce` | 430 | 0 | **+430 (lane's first tasks ever)** |
| gov | `property_missing_true_owner` | 2 | 0 | +2 |
| dia | `true_owner_needs_salesforce` | 1,815 | 815 | +1,000 |
| dia | `property_missing_recorded_owner` | 185 | 185 | 0 |
| | **total** | **4,000** | **2,000** | **≈ +2,000** |

**The cap chosen, stated: the mint head is `limit` — the caller's own existing instruction, honoured
for the first time.** No new knob, no silent truncation. Open counts converge to
min(`limit`, feed size) per domain and then plateau; they do **not** run to 71,448. The value gate
that would take dia's 6,324 to 963 is **A5c** and is deliberately not built here.

**Two things to expect and not misread:**
- **gov `owner_needs_salesforce` gets its first 430 tasks.** Real gaps, previously invisible. It has
  no consumer yet — the same shape A5 found for its dia sibling.
- **`owner_needs_sos` (24,077 rows) and `property_missing_county_record` (9,761) still get zero.**
  They are below the priority band even at `limit=2000`. This fix unpins the window and stops false
  closures; it does **not** make the whole backlog reachable. That needs A5c plus a lane picker
  (P179 Class 2: *ranked but genuinely behind more valuable work* is a filter problem, not a re-rank).

### ⚠️ The decisive safety number: the first correct run closes ZERO on gov

Checked all **1,000** open gov tasks against the live feed:

| | |
|---|---:|
| open gov tasks | 1,000 |
| **still in the feed** | **1,000** |
| **would close legitimately** | **0** |

**Every single closure the old code would have made on gov tonight would have been false.** The
~29/day gov "throughput" was 100% window churn. dia's `would_close` will be small and non-zero
(`salesforce_id` fills are real but rare — 13 of 183 over three months); **run `?dry_run=1` and read
`would_close` before the first write run.**

## 7. A5b-repair — FILED, NOT BUILT

**Do not re-open anything until this fix is deployed and verified**, or the repair refills a broken
window.

| | |
|---|---:|
| `gap_resolved` closures | **5,763** |
| distinct subjects | **2,631** |
| **estimated genuinely-false, re-openable subjects** | **≈ 2,044** |

Derived per lane from §5: gov pmro ≈1,458 · dia touns ≈391 · dia pmro 195 (census) · gov pmto **0**.

**Options, for Scott to choose:**

1. **Do nothing.** The producer re-mints any subject that re-enters the mint head. **This already
   covers ~1,000 of the 2,044** on the first corrected run — and costs nothing. The residue is the
   low-priority tail, which no surface reaches today anyway.
2. **Re-open the measured-false subjects only** (still in the feed today), reversibly, with a batch
   tag. ~2,044 tasks. Doubles the open surface with work nobody has value-gated (A5c).
3. **Re-label without re-opening** — leave them completed but rewrite `outcome` to
   `gap_resolved_unverified_a5a` so no future audit counts them as throughput. **Cheapest honest
   option**; preserves the record, kills the false metric, adds zero surface.

**Recommendation: (3) then (1).** Option 3 removes the corrupted metric permanently; option 1 lets
the corrected producer restore the tasks that matter, ranked, with no flood. Option 2 only becomes
attractive after A5c makes the lane finite.

## 8. Verify — and the honest signal is that NOTHING happens

```sql
-- 1. False closures must stop. This is the number that must fall to ~0.
select research_type, domain, count(*)
from research_tasks
where status='completed' and outcome::text ilike '%gap_resolved%'
  and completed_at > now() - interval '1 day'
group by 1,2 order by 3 desc;

-- 2. The pinned constants must move off 1,000 / 815 / 1,000+0.
select domain, research_type, count(*) filter (where status in ('queued','in_progress')) open_
from research_tasks where source_table='v_next_best_research'
group by 1,2 order by open_ desc;

-- 3. The first real completion this generator has ever produced (today: 0).
select count(*) from research_tasks
where source_table='v_next_best_research' and status='completed'
  and outcome::text not ilike '%gap_resolved%';
```

⚠️ **Open counts going UP is the fix working.** Real gaps that were being silently closed now stay
visible. The number that must FALL is `gap_resolved`-per-day; the number that must MOVE is the
pinned constant. Read the response's `membership_complete`, `subjects_probed` and `auto_close_skipped_reason` —
**`would_close` / `closed`, never `feed`**, which is now just the size of the ranked mint head and
reads exactly like throughput (P159a).

## 9. The durable lessons

- **A guard that compares a request against a response is not a guard.** The comment said *"never on
  a capped slice"*; the code tested the slice it asked for. Whenever a cap exists server-side, the
  only honest signal is what came back.
- **An open count that equals a query window is not a backlog.** `815 = 1000 − 185`; both domains
  totalled exactly 1,000. A count that does not move is a reading of the instrument (Class 11: the
  implausibly clean number is the bug signal).
- **A lane that has never emitted cannot be found by grouping on lanes.** Four lane-domains and
  47,562 gap rows were absent from every audit because absence has no row. **Enumerate the
  PRODUCER's population, not the consumer's table.**
- **Completeness and prioritisation are different budgets.** Conflating them is what forced the
  false choice between "truncate and close wrongly" and "read everything and flood".
- **⚠️ The obvious fix for a truncation is not always "read it all" — measure the read first.**
  Full paging was implemented, then rejected on an `EXPLAIN`: the view re-sorts all 41,805 rows on
  every request, so the fix would have cost ~64 min/day of DB time on the pool a prior incident
  wedged. **Asking a bounded question beat downloading an unbounded answer**, and gave stronger
  evidence — the generator now interrogates each open subject instead of inferring absence.
- **A blanket correction can be as wrong as the original claim.** One of the four lanes closed
  legitimately; per-lane measurement on named rows is what separated them.
