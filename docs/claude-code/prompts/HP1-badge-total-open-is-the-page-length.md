# HP1-badge — `total_open` is the capped page length, not the population. Two of three Today badges under-report.

**Repo: life-command-center** (owns LCC Opps `xengecqvemvfknjvbvrq`). Small change, and the second half of it
(§4) matters more than the first.

**Read first:** `docs/os/PLANNED-BACKLOG.md` `HP1-badge`, `HP1-1d` (⏸️ deferred perf), `HP1-P2a` (✅ — the
`hygiene_pointer` it shipped is the honest-count pattern to reuse) · `api/_shared/today-sections.js` **lines
79 / 103 / 182** (`total_open: all.length`) · `api/operations.js::getTodaySections` **~line 2055**, especially the
**1c comment block at 2062–2072** which explains why `countMode` is `'estimated'` · `api/queue.js::inboxHygienePointer`
(~line 66) · `CLAUDE.md` **P159a** (rendered count ≠ population), **P180** (NULL is not zero).

---

## 1. The defect, re-measured live 2026-09-12

Each section returns `total_open: all.length` — **the length of the array that came back**, which is bounded by
`limit=200`. The module header promises *"the full population"* for the "See all (N) →" badge and cites **P159a**.
**It is the honest-counts rule failing inside the module written to enforce it.**

| Today lane | badge shows | true population | |
|---|---|---|---|
| **Significant** (`v_lcc_seller_prospect_queue`) | **200** | **516** | under-reports 61% |
| **Important** (`bd_opportunities is_open`) | 46 | **46** | ✅ correct — only because it sits under the cap |
| **Urgent** (`action_items` open/in_progress **66** ∪ `v_lcc_bd_worklist` `contact_writeback` **1,598**) | **≤200** | **1,664** | under-reports ~88% |

⚠️ **Ranking is NOT affected** — `order by` runs before the cap, so the eight rendered rows really are the top
eight. **Only the count lies.** Do not touch ordering.

## 2. ⚠️ Two dead ends, already measured — do not walk into either

- **Re-enabling `count=exact` is what HP1-P0 deliberately removed.** The 1c comment at `operations.js:2062` records
  the reason: the extra `COUNT(*)` costs **~750 ms on `v_lcc_seller_prospect_queue` alone**, and this endpoint is
  the one that was 500ing all three lanes on a timeout. **Do not reintroduce the outage to fix a badge.**
- **`countMode: 'estimated'` cannot work here at all.** `select reltuples from pg_class where
  relname='v_lcc_seller_prospect_queue'` returns **-1** — it is a view, never analyzed, so PostgREST has no planner
  estimate to hand back. The current setting is not "a slightly wrong number"; for these lanes it is **no number**.
  Confirm this yourself before designing around it.

## 3. Get a true count without paying for it on the render path

Pick one and justify it against the measured cost:

- **(a) A separate cheap count per lane**, run in the same `Promise.allSettled` — a `select=id` `HEAD`/`count=exact`
  against the *narrowest* projection, not the `select=*` the render path uses. Measure it; if the cost is in the
  count rather than the projection, this is no better than reverting P0.
- **(b) Reuse the HP1-P2a pattern**: `inboxHygienePointer()` already does exactly this job correctly — one
  `countMode:'exact'` probe with `limit=1`, read off the **base table**, never the capped view, returning `null` on
  failure rather than a wrong number. **Read that function before writing anything.** Its shape is the answer; the
  open question is whether the underlying view can be counted cheaply.
- **(c) A maintained count** (`mv_work_counts` already exists and HP1-P2a taught it to stay consistent with its
  list). Cheapest to read, adds a refresh/drift surface (**I16**) — take it only if (a)/(b) measure badly.

**Non-negotiable, whichever you pick (P180, and the `hygiene_pointer` precedent):** a count that **fails** must
render as *unknown*, never as `0` and never silently as the page length. A lane whose count could not be taken
says so. And `total_open` must never again be assigned from `all.length` — if the count is unavailable, the field
is `null` and the UI says "See all →" without a number.

## 4. 🚨 The part that matters more than the count — read this before you ship

**Fixing the badge honestly will make Urgent read 1,664, and that number is the real finding.** **1,598 of those
1,664 (96%) are `contact_writeback`** — pipeline hygiene, not deal work. That is the *same class* of defect
HP1-P2a just removed from the Inbox, sitting in the Urgent lane, and an honest badge is what exposes it.

So: **fix the count, and file the population.** Do **not** quietly leave the cap in place to keep the number
comfortable — that is choosing a pretty lie, and it is the exact failure this row exists to correct. Equally, do
**not** re-scope the Urgent lane in this prompt: routing `contact_writeback` off Today is a separate decision with
its own destination question (does it have a working surface? P2a's lesson: **check before routing, or you delete
the only place it is visible**). File it as a new row with the measurement, and say plainly in the write-up that
Urgent is 96% hygiene.

## 5. The gate

Paste all of it:

1. The three lanes' badge values **before and after**, beside the true populations measured in SQL.
2. The measured added latency of your chosen count strategy on `getTodaySections`, against the endpoint's current
   warm timing — **it must not approach the timeouts HP1-P0 set** (`timeoutMs: 20000` on the seller query).
3. A **failure** reading: force the count to fail and show the lane rendering *unknown*, not `0` and not `200`.
4. Confirmation the rendered items and their **order** are byte-identical to before.

If a count strategy measures badly, **report it and pick another** — do not ship a number you had to cap to afford.

## 6. What NOT to do

- Don't change ordering, the `limit=200` page size, or which rows render.
- Don't revert HP1-P0's `Promise.allSettled` / `timeoutMs` / `source_error` work.
- Don't re-scope the Urgent lane (§4) or touch `HP1-1d`'s deferred MV question.
- Don't report a lane's count as `0` for any reason other than a genuine zero.

## Guard + ship

Tests: `total_open` is never `all.length`; a lane whose count fails renders unknown (positive control, not a
comment); the true population matches SQL for at least one lane; ordering unchanged. Full suite green — and note
`test/status-line-budget.test.mjs` **grows on `main` while you work**, so archive to `docs/history/` **before you
push**, leaving 200+ lines of headroom, not after CI goes red (it has cost two PRs already). `test/status-header-integrity.test.mjs`
keeps the STATUS H1 on line 1 — prepend below the convention block. Branch → PR → CI → merge → redeploy **both**
Railway services.

## Ship + record

Update `PLANNED-BACKLOG.md` (`HP1-badge`; **add the Urgent-is-96%-hygiene row** from §4), `CURRENT-STATE.md` (its
HP1 paragraph still calls this 🔴), `STATUS.md`. Report: the strategy chosen and its measured cost, all four gate
readings, and the Urgent population finding.

**Standing rules:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with the repo's
`Co-Authored-By` + `Claude-Session` trailer.
