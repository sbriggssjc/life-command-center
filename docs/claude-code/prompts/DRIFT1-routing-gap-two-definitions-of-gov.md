# DRIFT1-routing-gap — one Salesforce property, two answers to "is this gov?"

> **Found by the merge-blocking `npm test` on PR #2150, not by an audit.** Two tests were asserting
> that the intake path routes like the promotion path. **It does not**, and the difference is a
> class of property that is silently skipped at intake with no row, no error and nothing to count.

**Repo:** `life-command-center` · **Domains:** dia (`zqzrriwuavgrquhisnoa`), gov
(`scknotsqkcheojiaewwh`)
**Canonical page:** `docs/architecture/edge-function-deploy-drift.md` carries the discovery — extend
it, or move this to whichever page owns SF intake. **Pick one and say which.**

---

## 1. The two implementations

| module | consumer | terms |
|---|---|---|
| `supabase/functions/intake-salesforce/sf-config.ts` → `GOV_SIGNALS` **(deployed v23)** | the **intake** path | `gsa`, `federal`, `government`, `department of`, `veterans affairs`, `social security`, `united states of america`, `u.s. government`, `u.s. department` — **federal only** |
| `supabase/functions/_shared/sf-deal-promotion.ts` → `GOV_STATE_SIGNALS` | `sf-promotion-worker` | `state of `, `department of `, `human services`, `child protective services`, `children's protective services`, `adult protective services`, `family protective services`, `criminal justice`, `juvenile justice`, `parks and wildlife`, `comptroller`, `general land office`, `railroad commission`, `workforce commission`, … |

Deployed `routeVertical` ends `return { vertical: null, resolved: false, reason: "no_match" }`.

**Worked examples, both real shapes:**

- `Texas Health and Human Services` — matches `human services` on promotion, **matches nothing** on
  intake.
- `TX Dept of Family Protective Services HQ` — misses intake's `"department of"` **on the
  abbreviation alone** (`Dept of`).

⚠️ **This is normaliser drift at MODULE level** — two copies of one judgement, diverged. It is the
same class this repo has paid for repeatedly (`lcc_normalize_entity_name` vs `ownerCore` vs
`strictOwnerCore`; the JS-copy-of-a-SQL-classifier rule) and the reason it stayed invisible is that
**the tests asserted the two agreed.**

---

## 2. ⚠️ Sizing this is the hard part — the population leaves no trace

A row that routes `null` is **skipped before staging**: no `sf_property_staging` row, no error, no
queue entry. **It cannot be counted from the destination side** — Class 20 exactly (*a missing feeder
has no representation anywhere; every other detector in this repo examines rows that exist*).

**Two honest ways to size it — do at least one, and say which:**

1. **Dry-run re-route over history.** `sf_property_staging.raw_row` holds the original payload for
   rows that *did* stage. Re-run **both** signal lists over those `raw_row`s and count where the
   verdicts differ. ⚠️ **This UNDER-counts by construction** — it can only see rows that got in, and
   the population of interest is the rows that did not. **Say so; do not present it as the total.**
2. **Ask the source.** Count Salesforce properties whose name/tenant matches `GOV_STATE_SIGNALS` and
   not `GOV_SIGNALS`. ⚠️ **LCC's Salesforce surface is a read-only Power Automate proxy** (C1) — if
   that count is not reachable, **say it is not reachable** rather than substituting the
   under-counting proxy silently.

⚠️ **Do not size it from gov `properties`.** Rows that were skipped never arrived, so a gov-side
count measures what got through, not what was lost — the exact inversion this unit exists to avoid.

---

## 3. The decision, and it is NOT automatically "merge the lists"

**Three options. Measure, then choose, and record the reason:**

- **One shared list, imported by both** — the obvious answer and the one that matches this repo's
  single-owner doctrine. ⚠️ **But it widens what intake admits into gov**, and the wider list is
  keyword-based: `state of ` and `comptroller` are broad, and intake feeds property CREATION
  (GOVDUP1-a: `autoCreateProperty`). **Widening a creation path is a bigger decision than widening a
  classification path.** Size how many *additional* rows would route to gov before adopting it.
- **Keep them separate deliberately**, with a comment at each site saying why intake is narrower.
  Legitimate if the intake path should be conservative — but then **the tests must assert the
  divergence**, not the agreement.
- **Widen intake to a measured subset** — e.g. add the abbreviation `dept of` and the unambiguous
  state-agency terms, leaving the broadest ones out. **Justify each term you add.**

⚠️ **Whatever you choose, do not silently delete the sibling.** Two lists that disagree is a defect;
one list that quietly loses half its terms is a worse one.

---

## 4. Deployment reality

⚠️ **`intake-salesforce` is a Supabase EDGE FUNCTION on Dialysis_DB, and the committed body now
matches deployed v23 (`sf-2026-05-v8`).** Changing `sf-config.ts` in the repo **does nothing until
the function is redeployed** — the DRIFT1 lesson, running the other way. **If this unit changes
routing, say explicitly that a deploy is required and that the repo alone does not ship it**, and
leave the deploy to the operator rather than performing it.

✅ **And keep the committed body honest**: if you change the file without deploying, the header must
say so, or the next reader inherits exactly the GOVDUP1-a confusion in reverse.

---

## 5. Out of scope

- **No redeploy** of `intake-salesforce` or `sf-promotion-worker`.
- **No backfill** of skipped properties — they were never created; re-creating them from a widened
  rule is a separate decision with GOVDUP1-a's duplicate hazard attached.
- **No change to `autoCreateProperty`** itself.
- **No new signal list.** If the answer is a shared one, it replaces both.

## 6. Deliverables

1. The size, by whichever method(s) are actually available, **with the method's limitation stated**.
2. The decision among §3's three options, with the reason and the per-term justification if
   widening.
3. Tests that assert **whichever invariant is chosen** — agreement or deliberate divergence. The
   current tests were corrected to deployed behaviour; they should now encode the decision rather
   than the accident.
4. An explicit statement of whether a deploy is required and that it has **not** been performed.
5. Mutation pass **N/N**, survivors named.

## 7. Verify on

- **The count of `raw_row`s where the two lists disagree** — before and after, with the
  under-count caveat attached every time it is quoted.
- ⚠️ **Not on "the lists now match"** — matching is one of three valid outcomes, and the wrong one if
  the measurement says intake should stay narrow.
- If a deploy happens later: **`routeVertical`'s `no_match` rate on new staging rows**, which is the
  only measurement that sees the real population.
