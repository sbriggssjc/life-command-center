> 📍 **CANONICAL PAGE FOR THIS TOPIC: [`docs/architecture/bd-ranking-and-priority-queue.md`](../architecture/bd-ranking-and-priority-queue.md)** — current state, decisions and traps.
> This audit is the dated EVIDENCE; the canonical page is what to read first.
> **Canonical section:** [`docs/architecture/connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) §4q.
> **SHIPPED 2026-08-29.** Migration `supabase/migrations/20261002110000_lcc_c6_current_holding_seller_bands.sql`,
> applied live to LCC Opps (`xengecqvemvfknjvbvrq`). One view. No JS, no new cron, no new table
> (beyond the reversal ledger). Follows [`C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md`](C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md).

# C6 — a current holding now satisfies the gov seller-side bands, gated on reachability

`v_priority_queue_live.gov_owner_props` gated four gov deal-timing bands on
`effective_owner_role = ANY (ARRAY['developer','user_owner'])` — a **party-level identity** answering
a **per-asset question**, while the CTE was already holding the per-asset fact (`f.is_current = true`)
and discarding it. That predicate is replaced by the **P112 reachability precondition**. Current
holding is established by the join that was already there.

**P1 74 → 149 · P2 32 → 95 · P3 61 → 163 · P8 76 → 213.** Four predictions, four exact hits.
**303 owners, every one callable.** Six bands and all of dia unchanged, positive-controlled.

---

## 1. Result — measured on `v_priority_queue_live` AND on the refreshed cache

| band | before | after | predicted | owners after |
|---|---:|---:|---:|---:|
| P1 `lease_expiry_24mo` | 74 | **149** | 149 ✅ | 100 |
| P2 `firm_term_ending_24mo` | 32 | **95** | 95 ✅ | 63 |
| P3 `ten_year_window` | **61** | **163** | 163 ✅ | 127 |
| P8 `agency_active_solicitations` | 76 | **213** | 213 ✅ | 118 |
| **four bands** | **243 rows** | **620 rows / 497 assets** | — | **303** ✅ |

**Unchanged, all verified:** P0.4 555 · P-CONTACT 231 · P0.5 148 · P5 58 · P-BUYER 22 · P4 12 ·
every dia row. `lcc_priority_queue_resolved` was refreshed and agrees with the live view on all ten
bands.

**Structural safety, measured not asserted:** `unreachable_rows_emitted` = **0** (every row in the
four bands has a live `owner_contact_pivot.active_contact_entity_id`) and
`nongov_rows_in_gov_bands` = **0**.

## 2. ⚠️ RE-MEASURE THE BASELINE, NOT JUST THE BLOCKER — TWO OF THE BRIEF'S "TODAY" FIGURES HAD MOVED

The brief's today-column was measured 2026-08-28. On 2026-08-29 **P3 read 61, not 62**, and
**P0.4 read 555, not 552**. Both are ordinary live drift, and both would have been reported as
change-induced deltas had the baseline not been re-taken in the same session. The four-band total
today is therefore **243**, not 244. *(The A3 lesson: re-measure the population, not just the
blocker.)*

## 3. ⚠️ THE PREDICTED "497 ROWS" IS AN ASSET COUNT, NOT A ROW COUNT — AND THE 4% GAP WAS THE FINDING

The four per-band predictions were hit exactly and the owner count was hit exactly, but the stated
total did not reconcile: **149 + 95 + 163 + 213 = 620, not 497.** A 4% discrepancy against a
prediction is trivially shruggable. Chased, it is a real distinction:

| basis | before | after |
|---|---:|---:|
| queue **rows** | 243 | **620** |
| distinct **(entity, property)** | 194 | **497** |
| distinct **owners** | 148 | **303** |

**497 is `count(distinct (entity_id, source_property_id))`.** The queue emits one row per
**(owner, property, band)**, so an asset tripping both P1 and P8 emits two rows. Both numbers are
correct about different questions — the same shape as C1's *"two correct counts that are the same
number are probably not the same set"* and the per-owner-vs-per-task inflation this repo measures
repeatedly. **Quote 620 for surface load, 497 for assets, 303 for owners.** The brief's own table
already implied 620; only its label said otherwise.

*(This is the C2e-T2a discipline paying off a second time: a prediction that matches is evidence the
change did what you think, and the residual is where the mechanism lives.)*

## 4. ⚠️ WHICH REACHABILITY DEFINITION — AND WHY NOT THE ONE `CLAUDE.md` SAYS TO QUOTE

`CLAUDE.md` says to quote **`reachable_hero_qualified`**, so `v_lcc_owner_reachability` was read
first, as required. **It cannot serve as a join predicate here, for two structural reasons:**

1. **It is a single-row AGGREGATE view.** Every column is a scalar `count(*)`. There is no per-owner
   membership surface to join to. Using it would mean reconstructing ~40 lines of its CTEs inside
   the queue view — **a second copy of a definition**, which is the normaliser drift this repo warns
   about a dozen times (`lcc_normalize_entity_name`, the P134 re-derived GROUP BY, the A1 SQL/JS
   classifier mirror).
2. **Its population is a different one.** Its `owners` CTE resolves through
   `lcc_property_owner` joined to `entity_type = 'asset'` entities — not the queue's
   `lcc_entity_portfolio_facts` join. Measured overlap with the pivot: **263 of 1,441 / 495**, with
   **232 hero-only** and **1,178 pivot-only**. Gating on it would exclude owners for a reason
   unrelated to reachability.

**Used instead: `owner_contact_pivot.active_contact_entity_id IS NOT NULL`** — the fact the Tier 0
arc (P188/P194 `applyTier0Attach`) **writes**, and the one `v_owner_contact_enrich_queue` already
keys on as *this owner has a contact*. No second definition is introduced.

**The choice was also confirmed by the predictions.** The pivot form reproduces C5 §5b's four band
figures and its owner count exactly. The hero-qualified form does not — it yields **P1 105 · P2 70 ·
P3 100 · P8 169 = 444 rows / 166 owners**, materially narrower. C5 §5b was measured with the pivot;
this build matches what was graded, rather than silently substituting an ungraded gate.

⚠️ **`CLAUDE.md`'s instruction is about REPORTING the reachability metric, not about gating a
queue.** Those are different jobs and the same string can be right for one and wrong for the other —
the hazard-travels-with-the-technique rule (P189, A2), applied to a definition rather than a
comparator.

## 5. Reachability is load-bearing, and the flood is the proof

Without it the same change emits **3,235 rows over 2,719 owners, of whom 11% are contactable** —
cadences that can never advance and only age into "overdue", the documented **P112** failure at
scale. With it: **620 rows / 303 owners, 0 unreachable.**

## 6. P5 kept its role gate — with a positive control (Class 11)

"P5 = 58, unchanged" is only worth stating if the detector can see a change at all. The same P5
shape with the role gate dropped returns **1,681 rows, 565 of them dia** — reproducing C5 §5b
exactly. So the zero-delta is a measurement, not a broken counter.

The three reasons P5 was excluded, restated because the third is the one that is easy to miss:
83% of the naive flood · the weakest signal in the set (implies no timing) · and **`aged_props`
joins `lcc_entity_portfolio_facts` with NO `source_domain` filter, so it covers dia too.** Changing
it is a cross-domain change; nothing in this arc has been.

dia rows today appear only in P0.4/P0.5/P4/P5/P-CONTACT/P-BUYER — **none of the four changed bands**,
and `gov_owner_props` is `source_domain = 'gov'`-scoped, so dia is unchanged structurally as well as
by count.

## 7. ⏰ The 90-day question — all 14 surface

**173 owners hold a gov lease expiring within 90 days and were invisible; 14 contactable.** Both
figures reproduce exactly. **All 14 now appear in P1** (17 rows — some hold more than one expiring
asset), in both the live view and the refreshed cache.

| owner | role | soonest expiry |
|---|---|---|
| Greenleaf Management | unknown | 2026-08-31 |
| **Boyd Watterson Asset Management, LLC** | **buyer** | **2026-08-31** (4 assets in window) |
| Karen Curran | unknown | 2026-08-31 |
| MERLIN MANN INVESTMENTS, LLC | unknown | 2026-09-08 |
| Reva Clearwater, LLC | buyer | 2026-09-14 |
| Impey's Vermont Real Estate | unknown | 2026-09-26 |
| Elman Investors | unknown | 2026-09-30 |
| R.g.r, Inc. | buyer | 2026-09-30 |
| Glickco, LLC | unknown | 2026-10-13 |
| Easterly Gov Properties (REIT) | unknown | 2026-10-20 |
| CAPE MORAINE, LLC | buyer | 2026-10-26 |
| COMMISSIONERS OF THE LAND OFFICE | buyer | 2026-11-02 |
| HAI Advisors | unknown | 2026-11-02 |
| John E. Traeger Trust No. 1 | buyer | 2026-11-27 |

⚠️ **`lcc_property_attributes` carries a DATE, not an OUTCOME.** Renewal, extension and holdover are
indistinguishable in that column. **Nothing here asserts any lease is terminal — read the asset
before acting on any date above.** Boyd Watterson's 2026-08-31 is two days out and has been
invisible throughout.

## 8. How the view change was verified — deparse diff, not eyeballing

The prior definition was captured into `lcc_c6_view_backup` **before** the replace, then the new
`pg_get_viewdef` was diffed against it line-by-line. The entire diff:

```
only_in_OLD:  WHERE eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text])
only_in_NEW:  WHERE (EXISTS ( SELECT 1
only_in_NEW:      FROM owner_contact_pivot ocp
only_in_NEW:     WHERE ocp.entity_id = eer.entity_id AND ocp.active_contact_entity_id IS NOT NULL))
```

330 lines → 332. **Nothing else moved** — no column added, removed or reordered, no other predicate
touched. Restating a 330-line view by hand is exactly where a silent regression enters; the
deparse-diff is what makes "I only changed one thing" a measurement instead of a claim. *(P194: a
migration that changes a view must carry the WHOLE view — and the diff is how you prove the copy is
faithful.)*

## 9. Reversibility, and the cache

`lcc_c6_view_backup` holds the prior definition **verbatim** under `batch_tag = 'c6_20260829'`, so
reversal needs no transcription; the runbook is in the migration footer. Reverting means restoring
the one `gov_owner_props` WHERE clause and re-running
`lcc_refresh_priority_queue_resolved()`.

⚠️ **The queue is served from a materialized cache** (`lcc_priority_queue_resolved`, cron
`lcc-priority-queue-refresh`, every 5 min). It was refreshed explicitly (1,646 rows) and measured
alongside the live view; **comparing a fresh view against a stale cache reads exactly like "the
change did nothing."**

## 10. Guard

`test/c6-current-holding-seller-bands.test.mjs` — 8 tests, **all 10 mutations verified RED**
(restore the role gate *with and without* `::text`; drop the reachability `NOT NULL`; drop
`aged_props`' gate; drop `f.is_current`; drop the gov scoping; drop the cache refresh; drop the
reversal capture; add a band arm; blunt the header quote).

⚠️ **It strips SQL comments first, and its first test is the positive control for that stripper.**
The migration header quotes the removed role gate **six times** while explaining why it went, so a
detector reading raw text passes over the gate's deletion — and would keep passing if someone
restored it. Same class as A1's prose detector, A5c's deleted assignment, N18's re-reported bug and
B1's held-lane discussion.

⚠️ **The control also caught a blind spot in the guard's own regex.** It initially required
`'developer'::text`, matching only Postgres's deparsed spelling — a hand-written restore without
casts would have walked straight through. `::text` is now optional. *An over-strict detector returns
a confident wrong zero* (P182 deparse, P189 `IS NOT DISTINCT FROM`).

CTE bodies are sliced by **matching parentheses from the named CTE's opening `(`** — a structural
boundary — never by line offset, which is the block-slice footgun this repo has paid for three times.

## 11. What this does NOT decide

- **The pitch.** `account-based-contact-intelligence.md` is explicit that acquisitions and
  disposition are different contacts, tones and buckets, and that the buy-side relationship is the
  funnel *into* the disposition conversation. **C6 makes the signal visible; which bucket the call
  lands in is C4a — Scott's doctrine call, deliberately still open.** No bucket, tone or
  prospecting-style column was added.
- **C4b** — whether `user_owner` gets a producer or leaves the predicate. It still matches 0
  entities, and it still gates P0.4, P0.5 and P5.
- **C4c** — broker assignment (⚠️ three different user tables; go through
  `lcc_cadence_point_person()`, never re-derive).
- **Whether the 303 contacts are the disposition decision-maker.** `owner_contact_pivot` says a
  contact is active, not that they decide dispositions.
- **dia.** No dia band was widened or sized.

## 12. Follow-on worth naming

**The four bands now emit 620 rows where the whole queue was 1,267.** The deal-timing share rises
from ~19% to ~38% of the surface — which is the point — but the per-asset emission means a
multi-asset owner like Boyd Watterson now occupies several rows. **Nothing here caps or dedupes per
owner**, and the Consumption-Layer rule (*surface actionable-only, value-ranked, capped*) is about
what reaches a human. Whether the operator surface should collapse to one card per owner with an
asset count is a ranking-layer question, not a view question — **sized here, not built.**
