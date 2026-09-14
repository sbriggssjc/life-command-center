# A1 — `establish_ownership_history` is four jobs wearing one label. Split it.

**2026-08-27 · LCC Opps (`xengecqvemvfknjvbvrq`) · migration `20260827090000`, applied live**
**Splits only. No ownership link written, nothing retired, nothing auto-applied.**

## The finding, re-measured

The lane reads **545 open / 0 completions**, first seeded **2026-06-19** — 68 days. It is not short
of answers: **545 of 545** open tasks carry a finished, deterministic, record-cited draft
(`lcc_clean_assist_proposals`, source `ownership_chain_draft`, P131/P133).

Nobody completes one because the lane presents four structurally different jobs as one
undifferentiated queue. Measured from the **structured** payload:

| action | tasks | owners | links | contiguous | annual rent | what it is |
|---|---:|---:|---:|---:|---:|---|
| `agrees` | **380** | 360 | 450 | 337 | $654.9M | chain ends at the owner we already hold — a **confirmation** |
| `mismatch` | **73** | 45 | 120 | 57 | $401.2M | last recorded grantee ≠ our owner — a **data-integrity alert** |
| `no_records` | **74** | 62 | 0 | 0 | $278.5M | `no_transitions_on_file` — unanswerable from what we hold |
| `all_guarded` | **18** | 18 | 0 | 0 | $33.5M | transfers **exist**; every one failed a P138 guard |

`agrees` splits 337 contiguous + 43 with disclosed gaps. **Tasks with no draft: 0** — verified
545/545, no orphan drafts, no task carrying two drafts, no draft pointing at a non-open task.

**Value is per OWNER, never per task.** The rollup sums `lcc_owner_known_annual_rent` over distinct
`entity_id` inside each action and reports the task count separately. The inflation is real and
uneven — `mismatch` is 73 tasks over **45** owners (1.6×) — so a per-task figure would overstate
A3's target by more than half.

## What shipped

- **`v_lcc_ownership_history_lane_split`** — one row per OPEN task, LEFT JOIN to its draft, with a
  single `action` column carrying exactly four values, plus the structured evidence each action
  needs (`link_count`, `rejected_count`, `contiguous`, `continuity_breaks`, `current_owner_name`,
  `address`, `terminates_at_current_owner`, `insufficient_reason`).
- **`v_lcc_ownership_history_lane_actions`** — the per-action rollup driving the chips.
- **`human_actionable_tasks`** appended to `v_lcc_research_lane_summary` (append-only, per the
  `CREATE OR REPLACE VIEW` column rule).
- **`api/_shared/ownership-lane-split.js`** — vocabulary + query shape, no second classifier.
- **Server-side `lane_action` filter** in both research branches; **four action chips** on the
  Research page; a per-card action badge rendered from the server's answer.

## The five things that would have gone wrong

**1. Classifying from the `reason` prose.** `reason ilike '%does not match the current owner%'`
returns **73**, the boolean returns **73**, **0 disagreements**. The prose detector is still wrong
to build on: it is a text detector over prose the drafter generates (P182), and it is structurally
**blind to the 74/18 split**, which exists only in `insufficient_reason`. The view reads booleans
and enum keys; nothing greps prose, and the guard fails on the *shape* rather than on the output —
a test comparing the two methods' results would have passed over the broken implementation.

**2. Letting an undrafted task read as "nothing on file".** LEFT JOIN, and a task with no draft is
`split_state='awaiting_draft'` with a NULL action — visible and countable. It is 0 today, but the
seeder runs 06:35 and the drafter 06:45, so a non-zero window is *normal*. A draft whose payload
yields none of the four is `unrecognised_payload`, not a NULL that merges with awaiting_draft.

**3. Merging `no_records` with `all_guarded`.** "Nothing is recorded" and "we distrust everything
recorded" are different facts (P181). A4 auto-retires the first; the second is a human call on
whether a guard was too strict, and folding it in would silently discard 18 properties whose
transfers demonstrably exist. The split view can never hand A4 the 18.

**4. A badge reading 545.** `human_actionable` is TRUE only for `mismatch` and `all_guarded` — 91.
`agrees` is a confirmation A2 applies; `no_records` is unanswerable. `human_actionable_tasks` is
**NULL for every other lane** — not 0, and not `open_tasks`: claiming a lane is fully actionable
because nobody has split it is the unearned-positive default (P124's `else` branch).

**5. ⚠️ A FILTER IMPLEMENTED IN ONE BRANCH THAT SILENTLY STOPS FILTERING IN THE OTHER.**
`V2_MAP` rewrites `/api/queue?view=research` → `/api/queue-v2?view=research` the moment
`queue_v2_enabled` flips, and `v2GetResearch` would have ignored `lane_action` — serving the whole
545-row lane under a chip reading "mismatch 73", with no error anywhere. Both branches now call the
one shared selector, and a test counts the call sites.

## Found on the way: the Research page could only ever reach 50 of 545 rows

`renderResearchPage` sends `page`/`per_page`; v1's `paginationParams` reads only `limit`/`offset`,
so **every page returned the same first 50 rows** — and the response carried no `pagination` block,
so `paginationHTML` had nothing to draw and **no pager rendered at all**. 545 tasks, 50 reachable,
no way forward. This is fixed here rather than deferred because a chip that filters to 73 and shows
50 with no "next" is the same reach failure the chip exists to remove (P139's "6 of 65"). The v1
research response now returns `pagination`; `opsApi` already keys it on the exact basePath
`paginationHTML` reads, so the existing wiring lit up with no front-end change.

Also fixed in passing: the v1 branch swallowed the DB's own error message (`'Failed to fetch
research tasks'`). That is precisely how the P132 two-embeds outage stayed undiagnosed **on this
same endpoint**.

## Gates

- **P180 equivalence**, both directions, on every pre-existing column: **0 rows differ**; 14 lanes
  before and after. The live definition was read first and matched the committed migration — no
  drift — and the whole view body is carried in the migration (the P194 lesson).
- **`npm test`: 4,601 pass / 0 fail / 6 skipped.**
- **`test/ownership-lane-split.test.mjs`** (15 tests) anchors on **field names**
  (`terminates_at_current_owner`, `insufficient_reason`, `draftable`) and the exported vocabulary —
  never a line number, never a `reason` substring, never a sliced source region (the block-slice
  footgun). Mutation-verified: it goes RED on a prose classifier, on an INNER JOIN, and on a v2
  branch missing the filter, and green again on restore.

## What this does NOT claim

**The lane has still never completed a task.** A split that does not change that is a no-op with
extra steps, and the split alone cannot change it — A2 (apply the 380), A3 (route the 73), A4
(retire the 74) and A4b (adjudicate the 18) are what move the number, and each lands separately and
reversibly. The honest reading today is that the work an operator must do is now **91 items, not
545**, and each of the four jobs is separately reachable, ranked and countable.

**Verify by `completed > 0`** on `research_tasks where research_type='establish_ownership_history'`
— never by the view existing or the chips rendering.

## Reversal

```sql
drop view if exists v_lcc_ownership_history_lane_actions;
drop view if exists v_lcc_ownership_history_lane_split;
-- then restore the v_lcc_research_lane_summary body from 20260826210000
```
JS: revert `api/queue.js`, `api/_shared/ownership-lane-split.js`, `ops.js`, `styles.css`, `index.html`.
