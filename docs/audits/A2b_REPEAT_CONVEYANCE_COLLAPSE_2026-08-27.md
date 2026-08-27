# A2b — one conveyance recorded on several dates (2026-08-27)

**Blocked reason `repeat_transfer_unrepresentable`: 14 tasks / 14 properties / 32 links /
12 distinct current owners / $26.2M annual rent.** Fixed in the DRAFTER
(`api/_shared/ownership-chain-draft-planner.js`), not the applier. The sweep is a state-keyed
re-draft pass inside the existing 06:45 drafter run — **no new cron**. Nothing in
`gov.ownership_history` is touched.

> ⚠️ **Value is per OWNER.** 14 tasks over 12 owners (1.17×), and the naive per-LINK sum reads
> **$88.5M against a true $26.2M** — a 3.4× overstatement. Quote the owner figure.

---

## 1. The premise was right about the effect and wrong about the mechanism

A2, A1 and `CLAUDE.md` all describe this population as the **`gsa_lease_diff` flicker** P138
documented — *the DATE is real, the DIRECTION is not*. Measured 2026-08-27, **it is not that**.

P138's flicker oscillates between an SPE and its parent: it emits **both** `A→B` and `B→A`, which
is exactly what `is_oscillating_pair` catches per-property. **This population has no return leg** —
there is no `B→A` row anywhere in it, and A4 already measured zero oscillating pairs across the
guarded set. Two different mechanisms wearing one producer's name.

What it actually is, both variants being *one conveyance observed more than once*:

| mechanism | properties | evidence |
|---|---:|---|
| **per-lease fan-out** | 13 | a GSA building carries many leases and the lessor of record updates on each separately, so the diff emits an acquisition per lease. **One distinct `lease_number` per date, 13 of 13 testable properties.** Property 3123 is 8 rows across 8 distinct leases (LDC12727, LDC02196, LDC02315, LDC02328, LDC02200, LDC02233, LDC02253, LDC12584) spanning 2020-02..2020-04. |
| **cross-source lag** | 1 (3891) | `costar_sidebar` records the sale at **2014-07**, `gsa_lease_diff` sees the lease paperwork at **2015-05**. Same conveyance, two independent observers. |

**Why this correction matters rather than being pedantry:** if it were the flicker, the direction
would be untrustworthy and collapsing would be unsafe. It is not the flicker — the direction is
consistent on every row — so the only thing wrong is that one fact is stored as several. That is a
representation problem, and it is what makes the collapse legitimate at all.

## 2. The date rule: EARLIEST, and why

The judgement is stated explicitly rather than defaulted, because the alternatives are not
obviously wrong on their face.

**1. Structural.** The link's `transfer_date` becomes the **grantor's `ownership_end_date`**. The
first date the record shows the successor in possession is the tightest bound we have on when the
grantor left. Taking a later observation asserts the grantor still held the asset *after* the record
already showed otherwise — it can only ever **overstate** a tenure, and on this population by up to
**700 days** (property 3139, 2016-07 → 2018-06).

**2. Empirical, and it is a natural experiment.** Where we hold an independent record of the actual
conveyance, is it earlier or later than the lease-diff observation? Over **every** party pair gov
holds from **both** `costar_sidebar` and `gsa_lease_diff`:

| | count |
|---|---:|
| pairs observed by both sources | **26** |
| recorded sale **earlier** than the lease-diff | **26** |
| same date | 0 |
| lease-diff earlier | **0** |
| mean lag | **161 days** |

**26 of 26, zero counterexamples.** So the earliest observation is the one nearest the conveyance and
every later one is administrative lag. Property 3891 is this case inside the blocked set itself: the
collapse keeps CoStar's 2014-07 and folds the 2015-05 lease-diff row. Choosing "latest" would have
discarded the actual sale date in favour of lease administration.

**⚠️ The later dates are not wrong data** — they are the same fact observed again, which is why
nothing is deleted (§3) and why gov's records are left exactly as recorded.

**This supersedes A2's own comment.** The applied A2 migration reads *"Picking the earliest date
would be a guess about which record is real, so the pair is BLOCKED. Never guess."* That was the
right call **without the measurement**. With 26 of 26 and the per-lease mechanism established, it is
no longer a guess. The migration text is left as the historical record; this document is the
correction.

## 3. Evidence preservation — 48 of 48

The surviving link carries its own citation and gains `citation.also_recorded_as[]`: the
`ownership_id`, `data_source` and `transfer_date` of **every** row folded into it, plus
`collapsed_from` and `also_recorded_on`.

Run over the real gov rows for all 14 properties: **48 guarded-clean source rows in, 48 reachable
from the drafts.** Nothing is lost and the collapse is reversible from the draft alone.

That required closing a pre-existing gap: P131's `(from, to, date)` dedup **silently discarded** the
`ownership_id` of a byte-identical same-date twin (property 3123 has three on 2020-03-01 alone).
Those twins are evidence too, so they now ride the same `also_recorded_as` list. Without that fix
the claim would have been 33 of 48.

A price seen only on a later observation is carried (one conveyance has one price) and **cited** via
`citation.price_from_ownership_id` — a figure whose provenance is not on the row is precisely what
this lane must not produce.

## 4. The safety property is in the KEY

The collapse key is `(grantor name-key, grantee name-key)` — **the grantee is in it**. A grantor that
sold to B and later sold to C is **genuine repeat ownership**: two distinct keys, no collapse, and it
stays blocked for a human. That is right, because one interval per party cannot represent it either.

Verified on the live population: **all 14 blocked pairs carry exactly ONE grantee name-key**, so all
14 collapse and nothing else in the lane is touched.

## 5. Result, run against the real planner on the real gov rows

| | before | after |
|---|---:|---:|
| links across the 14 properties | 32 | **15** |
| links collapsed away | — | **18** |
| properties still carrying a duplicate grantor | 14 | **0** |
| chains contiguous | 0 | **14 of 14** |

**Property 3290 correctly keeps two links** — `WASHINGTON DESIGN CENTER SUBSIDIARY → MUSEUM OF THE
BIBLE` (2013-02) then `MUSEUM OF THE BIBLE → WOC LLC` (2016-11). A genuine two-link chain, not
over-collapsed.

**The phantom gap disappears, and that is a second defect the repeat was causing.** `A→B, A→B` reads
as a chain break, because link[1].`from` is not link[0].`to`. The chain was never broken; it was one
link recorded twice. All 14 now report `contiguous: true`, so the drafts stop claiming a missing
intermediate owner that never existed.

## 6. Producer verdict: **LIVE** — so it needs a sweep

| | |
|---|---|
| `gsa_lease_diff` | **dormant** — 6,648 rows, newest **2026-03-27**, **0 in 90 days** |
| `costar_sidebar` | **live** — 3,161 rows, newest **2026-08-26**, **271 in 30 days** |
| repeat pairs fleet-wide | **323**, of which **91 cross-source** |
| repeat pairs completed in last 90d / 30d | **58 / 9** |
| most recent arrival | **2026-08-24** |

⚠️ **Reading only the dormant half would have given the wrong answer.** The obvious check —
"is `gsa_lease_diff` still writing?" — says no, and would have justified a one-shot. But the
*population* is still growing at ~9/month, because live `costar_sidebar` lands a **second
observation of a pair the lease-diff already recorded**. A one-shot would have been a chore repeated
silently forever (P176 / playbook Class 8).

**But it does not need a NEW cron.** Because the fix is in the drafter, every draft from now on is
collapsed at birth; the only residue is tasks already carrying a pre-A2b draft — the A4b stale-draft
trap (lane invariant #10), since `fresh` excludes any task that already has a proposal. So the sweep
is `runA2bRedraftPass` inside the drafter's existing 06:45 run:

- **Keyed on STATE** — *this task is blocked as `repeat_transfer_unrepresentable` and the drafter now
  collapses it* — never on "A2b shipped". It self-clears once re-drafted and equally catches a pair
  whose second observation lands next month.
- **Re-runs the real planner** rather than trusting the blocked reason, so a gov fetch that returns
  nothing supersedes nothing ("the fetch failed" must never read as "now collapsible"), and a task
  blocked for a reason A2b does not fix keeps its draft instead of being churned.
- Runs before `fetchExistingDrafts()`, so the same night re-drafts what it supersedes:
  **06:45 draft → 06:49 A2 apply.**
- Reports `repeat_blocked_checked` / `now_collapsible` / `links_collapsed` / `drafts_superseded`.
  **Read `drafts_superseded` and `links_collapsed`, never `repeat_blocked_checked`** — the last is a
  re-discovery tally that reads exactly like throughput.

## 7. Guards

`test/ownership-chain-repeat-collapse.test.mjs` — 15 tests, **all mutation-verified RED**:

| mutation | tests failed |
|---|---:|
| pick LATEST instead of earliest | 5 |
| key on grantor only (drop the grantee) | 1 |
| drop `also_recorded_as` | 2 |
| collapse after continuity instead of before | 4 |
| drop same-date twin preservation | 2 |

Source assertions are anchored on stable identity tokens (`blocked_reason=eq.repeat_transfer_unrepresentable`,
`async function runA2bRedraftPass`), never a line number or a drifting region — the block-slice footgun.

Full suite **4,753 tests / 4,747 pass / 0 fail / 6 skipped**.

## 8. Not changed

- **The applier.** Its PK and its conflict handling are correct; the input was wrong. No migration.
- `mismatch` (49), `sponsor_spe` (25), `all_guarded` (7), `ambiguous_entity` (18), `no_entity` (18),
  `placeholder` (15) — untouched.
- `gov.ownership_history` — every raw record stays exactly as recorded.
- **The 3 `all_guarded` self-transitions A4b left for A2b** (`786` RGR, `7527` EPA, `14058` MAOB) are
  a *different* defect — punctuation-variant **self**-transitions, correctly guarded, not repeats.
  They are not in this population and A2b does not address them. Left named in §5 of the lane doc.

## 9. Verify

```sql
select blocked_reason, count(distinct research_task_id) tasks, count(*) links
from v_lcc_ownership_chain_apply_blocked group by 1 order by tasks desc;
```

Expect `repeat_transfer_unrepresentable` **absent (0)** after the 06:45 drafter re-drafts and 06:49
cron 244 applies; the other three blocked reasons unchanged at 18 / 18 / 15. Expect
`establish_ownership_history` `completed_ever` **314 → ~328**.

**Verify on `facts_inserted` / `tasks_completed`** (`v_lcc_ownership_chain_apply_run_health`), never
on the collapse existing or the blocked count alone.
