# Owner-role classification — the canonical design

> 📍 **The design for `entities.owner_role`, written to Scott's four stated constraints
> (2026-08-31).** Supersedes the three options in
> [`C12_C4a_DECISION_BRIEF_2026-08-31.md`](../audits/C12_C4a_DECISION_BRIEF_2026-08-31.md), which
> framed this as a build-or-don't choice before those constraints were known.
>
> **Parent canonical page:** [`bd-ranking-and-priority-queue.md`](bd-ranking-and-priority-queue.md)
> (the surfaces that consume the role). **Status: DESIGNED + FULLY MEASURED, NOT BUILT — blocked on
> the five decisions in §6.** Build prompt staged:
> `docs/claude-code/prompts/C13-owner-role-derived-classification.md`.

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

## 1. ⚠️ CORRECTION — my first draft had BOTH definitions wrong

**Scott, 2026-08-31, defining the two states:**

> *"`user_owner` is when a tenant like DaVita acquires the real estate to occupy it, or a vacating
> DaVita gets acquired by some tenant intending to operate the real estate as opposed to leasing it.
> `former_owner` means that we know of no current holdings by that company but they used to own a
> tenant in our target market."*

⚠️ **My draft defined `user_owner` as "holds ≥1 current portfolio asset" — 6,308 entities. That is
just *an owner*.** It would have labelled every REIT, fund and landlord in the system an
owner-occupier. **Wrong by roughly three orders of magnitude**, and it is the same failure this arc
keeps finding: I reached for the fact that was *easy to compute* rather than the one that *answers
the question*. **`user_owner` is about OCCUPANCY, not ownership** — the "user" is the user of the
space.

## 2. `user_owner` — the owner-occupier. ~10 entities, not 6,308.

**The signal: the owner of the property IS its tenant.** `lcc_property_attributes` already carries
`tenant_short` / `tenant_label`, so this is a comparison **within a single property row** — far more
constrained than matching two arbitrary owner names, which is why it survives where the lexical
classifiers this arc rejected did not.

Measured over **8,237 held properties that carry a tenant** (6,105 distinct owners): **6 exact
core matches, 13 including containment.** Read on named rows:

| owner | tenant | verdict |
|---|---|---|
| Atlantis Healthcare Group · Centers for Dialysis Care · Concerto Missouri · Gundersen Lutheran · **Mayo Clinic Dialysis** · Michigan Kidney Consultants · Northwest Kidney Centers · Puget Sound Kidney Centers · Sanford Health · **Wake Forest University** | same | ✅ **genuine owner-occupiers** — health systems and independents operating their own unit |
| **`FSC FMC Carbondale IL DST`** | `Fmc - Carbondale` | ❌ **a Delaware Statutory Trust named after its tenant** — an investor vehicle, not Fresenius |
| **`USGBF NIAID LLC`** | `NIAID` | ❌ **US Global Business Fund's SPE named after the federal tenant** |
| `Mena Dialysis` | `DaVita Mena Dialysis Center` | ⚠️ ambiguous — could be the local operator or a namesake SPE |

**10 of 13 genuine — and the 2 clear misses share ONE shape: an SPE or DST named after the tenant
it houses.** That is the sponsor↔SPE pattern this arc has met at every turn, arriving from a new
direction.

### ⚠️ At n = 13, human confirmation IS the accurate option

**A guard against "investor vehicle named after its tenant" would be a name test**, and every name
test measured in this arc landed at ~25% raw / 7% / 4-of-6 guarded. **With a candidate set of 13,
reading them is both cheaper and strictly more accurate than any rule** — and Scott's ordering is
accuracy first, automation second. **So: `user_owner` is a human-confirmed lane, not an automated
arm.** The automation that matters is *surfacing the candidates*, which is one query.

⚠️ **`Wake Forest University` and `Mayo Clinic Dialysis` sit inside the `not_prospected` guard's
territory** (the drop-universities decision). **They are still correctly `user_owner`** — the
classification is a fact about them; whether we *prospect* them is a separate gate. **Do not let the
prospecting guard suppress an accurate role.**

## 2b. `former_owner` — 3,795, and every one is in the target market

**Definition satisfied exactly.** Entities that held a portfolio fact which ENDED and hold nothing
now: **3,795 — 2,071 gov, 1,727 dia, and ZERO from any other domain.** Because
`lcc_entity_portfolio_facts` is fed only from the gov and dia domains, *"used to own in our target
market"* is structurally guaranteed rather than assumed.

| | entities |
|---|---:|
| **former owners** | **3,795** |
| …sold within 3 years | **784** |
| …sold within 5 years | **1,537** |
| **…already contactable** | **191** |

**191 are callable today** — a party that has sold to us before, with a contact on file, which is
precisely the *"volume with repeat seller clients"* model.

⚠️ **Recency must be carried, not baked into the label.** Someone who sold in 2015 and someone who
sold last year are both `former_owner` and are not the same prospect. **Expose `last_ownership_end`
alongside the role**; do not encode a cutoff into the classification, or the role starts lying the
day the cutoff stops matching how you work.

## 2c. The corrected arms

| # | arm | evidence | population | automated? |
|---|---|---|---:|---|
| 1 | **`operator`** | `is_operator_not_owner` + recorded `owner_type` (P113) | 36 known | ✅ recorded flag |
| 2 | **`user_owner`** | owner ≈ tenant **on the same property** | **13 candidates, ~10 genuine** | 👤 **human-confirmed** |
| 3 | **`former_owner`** | held a fact that ended, holds none now | **3,795** | ✅ deterministic |
| 4 | **`buyer`** | ≥2 `purchases` edges, no current holding | 2,478 have ≥2 edges | ✅ deterministic |
| 5 | **`developer`** | existing classifier (`properties.developer_name`) | 715, exhausted | ✅ existing |
| — | **`unknown`** | no qualifying evidence — an honest absence | the remainder | — |

⚠️ **There is no longer an arm that classifies the 6,308 current holders as anything.** Most are
landlords and investors, and **the vocabulary has no word for "owns and leases out"** — which is the
ordinary case. That is now the open question in §6, and it is a bigger gap than the one I originally
reported.

## 2d. ✅ The landlord gap, sized — and it splits along Scott's own distinction

§2c ended with *"no arm classifies the 6,308 current holders."* Measured 2026-08-31, they are **not
one population**, and the split is the one Scott stated at the outset: *"developers treated
differently than one-off owners, who are treated differently than buyers."*

**All 6,308 current holders:**

| shape | entities | |
|---|---:|---|
| **one asset, ≤1 purchase, no past holdings** | **4,870 (77%)** | the one-off owner |
| **two or more current assets** | **762** | **$1.47B** — the investor / portfolio owner |
| one asset but repeat buys or past holdings | 676 | active, single-asset today |
| SPE-shell-named | 150 (129 single-asset) | belongs to a sponsor, not standalone |
| already carry a role | 3,091 | mostly `buyer` |

**The 3,217 that are currently `unknown` — i.e. what a classifier would actually change:**

| proposed state | entities | current rent | **contactable today** |
|---|---:|---:|---:|
| **`investor_owner`** — 2+ current assets | **292** | **$583.9M** | 54 |
| **`one_off_owner`** — 1 asset, no buying activity | **2,448** | **$523.1M** | **279** |
| single-asset but active (repeat buys or past holdings) | 477 | — | — |
| SPE-shell-named | 35 | — | — |

### ⚠️ The one-off owners are the finding, and they invert the intuition

**2,448 one-off owners carry $523.1M — nearly as much as the 292 investors' $583.9M — and they are
five times more contactable (279 vs 54).**

That is not a footnote. Scott's stated sweet spot is **single-tenant deals of $2M–$20M, reached
through volume with repeat seller clients.** **The one-off owner of a single net-leased building
*is* that market.** A vocabulary that had only `investor_owner` would name the smaller, less
reachable half and leave the core of the business in `unknown`.

**So two states are required, not one** — and they are prospected differently, which is precisely
why the distinction has to exist in the data rather than in an operator's head.

⚠️ **Both are deterministic from recorded facts** (a count of current portfolio rows, a count of
`purchases` edges). **No name test, no inference.** The SPE-shell-named 35 and the 477
single-but-active should be **surfaced separately rather than forced into either bucket** — they
are genuinely ambiguous and, per the accuracy-first constraint, an honest `unknown` beats a guess.

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

## 4. ✅ P0.4 — measured 2026-08-31, and the flood dissolves rather than needing a gate

C12 said classifying accurately would take P0.4 from **555 → ~3,500** and that P0.4 needed a value
gate. **Measured, both the diagnosis and the proposed fix were wrong.**

### What P0.4's existing 555 rows actually are

| | rows |
|---|---:|
| P0.4 today | **555** |
| …**hold no current asset at all** | **371 (67%)** |
| …**have no known rent** | **469 (85%)** |
| …rent ≥ $500k | 28 |
| **…contactable** | **0** |

⚠️ **A value floor is the wrong instrument: 85% of the band has no known rent.** Gating on it would
suppress on **ignorance**, not on value — the P180 NULL-is-not-zero failure. **C12's option B is
refuted by its own population.**

⚠️ **And C6's reachability precondition is ALSO wrong here, for a different reason.** It looks like
the obvious parallel — it worked on the deal-timing bands — and applying it would take P0.4 to
**0 rows**, because **not one of the 555 is contactable.** But **P0.4 is a RESEARCH band, not a call
band**: you resolve ownership control by reading deeds and SOS filings, not by phoning someone.
**Reachability is the right precondition for a call and the wrong one for research.** Copying it
across would delete 555 rows of legitimate work.

### The actual problem: two different kinds of work under one label

| | rows | reachable | what the work IS |
|---|---:|---:|---|
| **P0.4 today** | 555 | **0** | research — go find out who controls this |
| **C4a's newcomers** | **2,949** | **290** | **BD activation** — we KNOW who owns it; nobody has started |

**These are not the same band.** An entity C4a has just positively classified as `one_off_owner` or
`investor_owner` **has had its ownership resolved — that is what the classification is.** Putting it
in a queue that asks *"resolve ownership control"* is asking a question already answered.

**So the newcomers do not belong in P0.4 at all**, and the "6× flood" is an artifact of routing them
into the wrong band — not something to be gated down. **Route them to a distinct BD-activation band**
(P0.5's shape: classified, no open opportunity, no cadence), where **290 are reachable today** and
the rest queue behind contact acquisition.

**P0.4 stays at 555 and keeps doing research.** ⚠️ **Its zero-contactable population is worth
noting separately** — it is doing upstream work whose output nobody currently consumes as a call,
which is a Consumption-Layer question for another day, **not a defect this design creates.**

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

> ⛔ **All five are BLOCKING.** The build prompt is written and staged at
> **`docs/claude-code/prompts/C13-owner-role-derived-classification.md`** — it does not run until
> these are answered, and **three of the five change what gets written.** Record the answers here,
> so the next reader sees the decision and not just the outcome.


1. ✅ **SIZED in §2d — and it needs TWO states, not one.** Of the 3,217 unknown current holders:
   **`investor_owner`** (2+ assets) = **292 / $583.9M / 54 contactable**, and **`one_off_owner`**
   (1 asset, no buying activity) = **2,448 / $523.1M / 279 contactable**. ⚠️ **The one-off owners
   carry nearly as much rent and are 5× more contactable — and a single net-leased building at
   $2M–$20M IS the stated sweet spot.** Confirm both names and that they are prospected
   differently.
2. **`former_owner`** — confirm (3,795; 191 contactable; recency carried separately, not baked in).
3. **`user_owner` as a human-confirmed lane** rather than an automated arm, given n=13.
4. **View vs recomputed column** — accuracy is identical; this is a performance and
   override-preservation trade.
5. ✅ **P0.4 — ANSWERED in §4: no gate needed.** The newcomers belong in a BD-activation band, not in a research band; P0.4 stays at 555. **Confirm the routing.**
