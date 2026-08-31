# Owner-role classification — the canonical design

> 📍 **The design for `entities.owner_role`, written to Scott's four stated constraints
> (2026-08-31).** Supersedes the three options in
> [`C12_C4a_DECISION_BRIEF_2026-08-31.md`](../audits/C12_C4a_DECISION_BRIEF_2026-08-31.md), which
> framed this as a build-or-don't choice before those constraints were known.
>
> **Parent canonical page:** [`bd-ranking-and-priority-queue.md`](bd-ranking-and-priority-queue.md)
> (the surfaces that consume the role). **Status: DESIGNED, NOT BUILT.**

## 0. Scott's constraints, and what each one settles

| constraint | what it rules out |
|---|---|
| *"the most accurate determination possible as the guiding principle"* | ⛔ **No value floor on the classification itself.** Suppressing an accurate determination to protect a downstream band is the wrong trade — the band gets fixed, not the truth. |
| *"this can change over time and isn't a one-time determination"* | ⛔ **No one-shot backfill stamping a column.** That is Dead-End **Class 8** — a chore repeated silently forever. The role must be **DERIVED and re-computed**. |
| *"automate as much as we can but that's secondary to accuracy"* | ⛔ **No inferring where the evidence is absent.** Automate the decidable; surface the rest. |
| *"resolution at the entity level would limit the work"* | ✅ One determination per **entity**, not per property — bounding the population at ~10k, not ~33k properties. |

⚠️ **The first constraint retires option B from C12** (classify + gate P0.4 to hold the flood down).
**P0.4's problem is that it has no value gate of its own** — that is a defect in P0.4, and the fix
belongs there, not in the classifier. See §4.

## 1. ⚠️ The vocabulary cannot express the most valuable state

`BD_OWNER_ROLES` declares `developer · user_owner · buyer · seller_flipper · operator`. Measured over
live organizations:

| state | orgs |
|---|---:|
| **currently owns ≥1 asset** | **6,308** |
| **owned before, owns nothing now** | **3,795** |
| …still typed `unknown` | **2,784** |
| both current and past | 316 |

**There is no role for "sold, and may sell again."** That is not a minor gap — Scott's stated model
is *"volume with repeat seller clients."* **A party that has sold to us before is the highest-value
prospect in the business, and the vocabulary types 2,784 of them as `unknown`.**

**Accuracy therefore requires a sixth state — `former_owner`** (or an equivalent). Without it, a
derived classifier that keys on *current* holding would take 3,795 real parties and correctly
conclude "not currently an owner", which is true and useless.

## 2. The determination — recorded facts only, in priority order

Every arm is a **fact already in the database**. None is a name guess. ⚠️ Every lexical owner
classifier measured in this arc landed at ~25% raw (P189, A3), 7% (P198), 4-of-6 guarded — **this
design deliberately contains none.**

| # | arm | evidence | population |
|---|---|---|---:|
| 1 | **`operator`** | `true_owners.is_operator_not_owner` + recorded `owner_type`/`owner_role` (P113) | 36 known |
| 2 | **`user_owner`** | holds ≥1 **current** `lcc_entity_portfolio_facts` row | **6,308** |
| 3 | **`former_owner`** ⭐ | held a fact that **ended**, holds none now | **3,795** |
| 4 | **`buyer`** | ≥2 `purchases` edges and no current holding | 2,478 have ≥2 edges |
| 5 | **`developer`** | the existing classifier (`properties.developer_name`) | 715, exhausted |
| — | **`unknown`** | **no qualifying evidence — an honest absence** | the remainder |

**Precedence matters and is a judgement to confirm:** an entity that *currently holds* and *has
bought repeatedly* is both. **Recommended: `user_owner` wins** — what they hold now is more
actionable than what they did. ⚠️ **Not measured: the overlap size.** It should be reported before
this ships, not assumed.

**Guards, applied to every arm** — all existing, none new: `lcc_owner_name_is_brokerage` (6 hits),
`lcc_is_placeholder_owner_name` (3), `lcc_owner_name_is_not_prospected` (124 — GWU is here, per the
drop-universities decision).

## 3. It must be DERIVED, and the churn measurement says that is safe

⚠️ **The accuracy constraint and the changes-over-time constraint both point at a view, not a
column.** A stamped column is a snapshot of the day it ran.

**And the volatility is negligible: over the last 90 days, 3 entities had a holding end and 1 had
one start.** A re-derived role would be **stable, not flapping** — which is what makes derivation
safe rather than noisy. ⚠️ **That number is also the thing to re-measure before building**; it was
taken on one day, and a bulk ingestion would move it.

Two shapes, both acceptable:

- **A view** (`v_lcc_entity_effective_role_derived`) — always current, zero staleness, no writer.
  ⚠️ `entity_effective_role` is read by `v_priority_queue_live` on every request; measure the plan
  before repointing it (the documented *"`LIMIT 5` without the `ORDER BY` lies"* footgun).
- **A recomputed column** behind a scheduled sweep, with a `role_source` + `role_computed_at`
  recording *why* — better for join performance, and it preserves a **manual override**, which
  `behavioral_override` already provides and which 374 entities already use. ⚠️ **A manual override
  must always win** — accuracy includes a human correcting the machine.

**Whichever is chosen, `role_source` is not optional.** A role with no recorded basis is exactly the
"status nobody earned" failure this repo has hit three times (A5's `gap_resolved`, B6b-lead's
`filtered_multi_tenant`, C7's proposed default-stamp).

## 4. ⚠️ P0.4 is a separate defect and must not be solved here

Classifying accurately puts **~2,949 entities** into `P0.4 resolve_ownership_control`, taking it
**555 → ~3,500**. **That is real and it is not a reason to classify less accurately.**

**P0.4 has no value gate**, which is a standing violation of the Consumption-Layer doctrine every
other producer in this system obeys. **The fix belongs to P0.4.** Options — unmeasured, and a
separate decision:

- give P0.4 a floor of its own (⚠️ **which floor must be NAMED — five distinct $500k floors already
  exist**, §4g);
- or narrow its predicate, since an entity we have just *positively classified* as a `user_owner`
  arguably no longer needs "resolve ownership control" at all;
- or accept the growth on a band that is explicitly a work queue, not a call list.

⚠️ **Unmeasured and it matters: whether a P0.4 floor would apply to newcomers only or to its
existing 555 rows.** Different changes, different consequences.

## 5. What this design does NOT do

- **No lexical classifier.** No arm reads a name to decide a role; names are used only by the
  existing exclusion guards.
- **No inference from absence.** `unknown` stays an honest "no qualifying evidence", and it will
  remain large — that is correct, not a failure.
- **No change to how a role is CONSUMED.** C6 removed the role from the deal-timing bands and C8
  added the resolved-owner arm to the brief; neither is touched.
- **No bucket or pitch decision.** Which tone a classified owner gets is
  `account-based-contact-intelligence.md`'s question — acquisitions vs disposition — and is still
  open.

## 6. Open questions for Scott

1. **`former_owner` — confirm the sixth state.** 3,795 parties, and repeat sellers are the model.
2. **Precedence when an entity is both a current holder and a repeat buyer.** Recommended
   `user_owner`; overlap size unmeasured.
3. **View vs recomputed column** — accuracy is identical; this is a performance and
   override-preservation trade.
4. **P0.4** (§4) — a separate decision, deliberately not bundled.
