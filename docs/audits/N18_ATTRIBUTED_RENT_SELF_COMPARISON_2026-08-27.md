# N18 — `attributed_rent` was a one-character self-comparison (2026-08-27)

`v_lcc_developer_classification_candidates.attributed_rent` correlated its rent subquery on
`pof.source_property_id = pof.source_property_id` — a column compared to itself. Fixed live +
committed (`supabase/migrations/20260827250000_lcc_n18_developer_attributed_rent_self_comparison.sql`).
Guard: `test/sql-self-comparison-guard.test.mjs` (4 tests, **all 5 mutations verified RED**).
Suite 4,786 pass / 0 fail.

| | before | after |
|---|---:|---:|
| rows | 6 | 6 |
| **distinct `attributed_rent`** | **1** | **5** |
| range | $34,920,891.77 (every row) | $431,643.78 – $2,226,661.54 |
| execution time (same session) | **1,602.352 ms** | **128.252 ms** |
| buffers | **2,102,242** | **3,904** |

---

## 1. ⚠️ The fabricated value is the domain-wide MAX, not the domain-wide SUM

N15c §6 and the N18 brief both describe $34,920,891.77 as *"the gov-wide sum of all current
portfolio facts."* **It is not.** The gov-wide sum is **$3,517,585,879.83** — two orders of
magnitude larger. $34,920,891.77 is the gov-wide **`max(annual_rent)`** over current facts.

The mechanism matters because it is not what "sum everything" would predict:

```
attributed_rent(broken) = props × domain_max_current_rent
```

The self-equality reduces to a `One-Time Filter`, so the scalar subquery returns one number — the
domain max — and the enclosing `sum()` adds that same constant once per property in the group.

**So "one distinct value" is a property of the surviving 6-row slice, not a general invariant.**
All six rows carry `props = 1`, which is the only reason they collapse to a single figure. Across
the full 277-candidate population the broken expression takes **11 distinct values**, topping out
at **$279,367,134.16** (= 8 × the domain max). A future candidate with `props = 17` would have
shown ~$594M. The Class 11 signal was real; the explanation attached to it was wrong.

## 2. It was a LIVE-ONLY defect — the repo never carried it

The newest **committed** definition (`20260609170000`) reads `pf.source_property_id =
pof.source_property_id` — correct. The live view differed from the repo in exactly two places:

| | repo (`20260609170000`) | live (before N18) |
|---|---|---|
| rent predicate | `pf.source_property_id` ✅ | **`pof.source_property_id`** ❌ |
| entity join | `e.canonical_name = n.norm` | `lcc_normalize_entity_name(e.name)` (N15c, uncommitted) |

Both differences were hand-applied live and never committed. This is the **gov CLAUDE.md §13.12
class — "running but not merged"** — and the mirror of the LCC "merged is not running" doctrine. It
also re-proves **P194**: *"read the live definition as the authority" is not a substitute for
committing the view.* A rebuild from the repo would have silently reverted N15c's repoint
(**267 → 196** candidates resolved, measured today, reproducing N15c's predicted regression exactly).

**The migration therefore carries the WHOLE view body**, not a one-line patch: the `20260609170000`
body + N15c's repoint + the fix. A second copy that is correct beats no copy at all.

## 3. The ranking fully reorders — and it was arbitrary, not merely wrong

`api/admin.js handleChainClassifyTick` reads
`?order=attributed_rent.desc.nullslast,props.desc&limit=25`. With every row tied at $34.9M **and**
every `props = 1`, both sort keys were constant: the order was **whatever the plan emitted**. The
worker's header calls this "value-prioritized"; it was not prioritized at all.

| old rank | candidate | new rank | corrected rent | overstated by |
|---:|---|---:|---:|---:|
| 5 | Heritage Developments LLC | **1** | $2,226,661.54 | 15.7× |
| 1 | ACQUEST HOLDING FC LLC | **2** | $2,102,952.00 | 16.6× |
| 6 | HINES VAF II 444 SOUTH FLOWER LP | **3** | $1,983,833.53 | 17.6× |
| 4 | DIVERSIFIED DEVELOPMENT & CONTRUCTION LLC | **4** | $1,710,829.94 | 20.4× |
| 2 | Curtis (`buyer`) | **5** | $431,643.78 | 80.9× |
| 3 | Curtis (`unknown`) | **6** | $431,643.78 | 80.9× |

Every position moves except rank 4. Total attributed rent across the lane: **$8,887,564.57**.

**Reconciled on named rows, 5 of 5 exact** — each figure equals `max(annual_rent)` of the current
portfolio facts on that candidate's own property (Heritage → gov 8387, ACQUEST → 6861, HINES →
1517, DIVERSIFIED → 8121, Curtis → 11620). Two of those properties carry **two** current facts and
`max()` correctly takes the higher — the view's own pre-existing per-property semantic, unchanged
here.

### What the defect did NOT cost
Stated so the impact is not overclaimed:

- **Nothing was persisted.** `lcc_developer_classification_log` has **no `attributed_rent` column**
  — only `(source_domain, candidate_norm, entity_id, candidate_name, signal, tagged_at)`. No stored
  value needs repair.
- **No value gate reads it.** In the handler it appears only in `order=` and in the GET dry-run's
  `items[]`. There is no floor, so nothing was excluded by being mis-sized.
- **Reach was unaffected today.** 6 rows against `limit=25`, so every candidate was drained
  regardless of order. The cost was sequence and the operator-facing number, not coverage — though
  order decides reach the moment the lane exceeds the limit or the time budget trips.

## 4. Why the view returns 6 rows — and what that number is NOT

Measured funnel, so the small row count is not mistaken for a small population:

| stage | count |
|---|---:|
| candidate groups in `named` | **277** |
| already decided in `lcc_developer_classification_log` | −266 |
| matched a buyer parent by name | −2 |
| survive to the entity join | 9 |
| removed by `cur_role` / buyer-parent / buyer-SPE filters | −4 |
| **view rows** (incl. the `Curtis` fan-out to 2 entities) | **6** |

⚠️ **N15b's "222 of 274" does not reproduce off this view** and must not be quoted beside it — that
is the resolution rate over the underlying candidate set, not the view's output. Today's figures are
**277 candidates / 267 resolved (repointed) / 196 (`canonical_name`) / 6 rows**.

## 5. Performance — the correctness fix was the performance fix

`EXPLAIN (ANALYZE, BUFFERS)` with the handler's real query shape (filters and `ORDER BY` included —
`LIMIT 5` without the `ORDER BY` lies), before and after **in one session**:

| | before | after |
|---|---:|---:|
| SubPlan 4 shape | `One-Time Filter (pof.x = pof.x)` | `Index Cond (source_domain, source_property_id)` |
| rows per loop | **3,183** | **1** |
| SubPlan 4 buffers | 2,084,423 (**99.2%** of query) | 1,337 |
| per-loop time | 3.763 ms | 0.013 ms |
| total execution | 1,602.352 ms | **128.252 ms** (12.5×) |

⚠️ **Precise claim: the subplan is not "gone" — it is now index-satisfiable.** It still runs at
`loops=385`, one probe per property row, which is the correct semantics for a per-property lookup.
This is **P118 corollary (2)**: a genuinely per-row lookup is exactly the case where an index *is*
the fix, as opposed to the hoist-and-LEFT-JOIN-once case. The pathology was never the correlation —
it was that a self-equality constrains nothing, so each of the 385 probes scanned the domain's
entire 3,183-row current-fact set.

**Not hoisted.** At 385 × 0.013 ms ≈ 5 ms it is no longer material, and widening the change to
restructure a now-cheap subplan is not warranted.

**Surfaced, not fixed:** the dominant remaining cost is `SubPlan 3`, the
`lcc_match_buyer_parent_by_name(u.candidate_name)` function scan at `loops=277` × 0.356 ms ≈ 98 ms
of the 128 ms. A separate concern, out of scope here.

## 6. Equivalence

Full row set diffed **both directions** on every column except `attributed_rent`
(`signal, source_domain, candidate_name, norm, props, cur_role`): **0 rows each way.** The identity
of the lane is byte-identical; only the number moved, which is the intent. Column list, order, names
and types unchanged (`CREATE OR REPLACE VIEW` is append-only for columns); `security_invoker = true`
preserved.

## 7. The guard, and the two things it had to get right

`test/sql-self-comparison-guard.test.mjs` is a **class detector** over every migration — a
self-equality in a predicate is never meaningful SQL — not a line-anchored check on one file.

- **⚠️ It must strip SQL comments first.** The N18 migration's own header quotes the broken
  predicate three times while explaining the fix. A raw-text detector fires on the *documentation of
  the fix* and reports the bug it just removed. This is **A5c inverted** — there, a file's
  explanatory prose made two assertions pass over a deleted assignment; here it would make them fail
  over correct code. Either way: strip comments before matching source.
- **⚠️ It needs a positive control.** After the fix the population is **zero across the whole
  migration surface**, and an implausibly clean result is a bug signal, not a finding (Class 11 —
  the P182 deparse trap and the P189 `IS NOT DISTINCT FROM` inversion both returned confident, wrong
  zeros). The detector is pointed at known positives, including the real pre-fix predicate, and must
  fire on them — while *not* firing on a genuine self-JOIN between two distinct aliases
  (`a.parent_id = b.id`) or an alias that merely shares a prefix (`a.x = ab.x`).

Mutations verified RED: defect re-introduced into live SQL (2 fail), comment-stripping removed
(2 fail), N15c repoint reverted (1), detector regex blinded (2), `security_invoker` dropped (1);
restored → 0 fail.

## 8. Verify by

```sql
select count(*) rows, count(distinct attributed_rent) distinct_rent,
       min(attributed_rent), max(attributed_rent)
from public.v_lcc_developer_classification_candidates;
-- 6 / 5 / 431,643.78 / 2,226,661.54     (was 6 / 1 / 34,920,891.77 / 34,920,891.77)
```

Not "the view compiles" and not the row count. The check is that `attributed_rent` has **more than
one distinct value**, that each figure reconciles to its own candidate's portfolio facts on a named
row, and that the plan shows an `Index Cond` rather than a `One-Time Filter`.

## 9. Left alone, deliberately

- **Signal B (`bts_multi_prop`) stays dropped.** Removed by `20260609150000`; reviving it is a
  different decision with its own grading.
- **The `Curtis` fan-out stays.** Two entities share the normalized name; surfacing both is the
  never-guess rule, and the log keys on `(source_domain, candidate_norm)` so one verdict clears both
  rows (N15c stated this).
- **No cron registered.** The handler's header says crons follow Scott blessing the top-10 list —
  and that list has, until now, been ordered by a constant. **The corrected ranking has never been
  graded by an operator.**
