# Owner-role classification — the canonical design

> 📍 **The design for `entities.owner_role`, written to Scott's four stated constraints
> (2026-08-31).** Supersedes the three options in
> [`C12_C4a_DECISION_BRIEF_2026-08-31.md`](../audits/C12_C4a_DECISION_BRIEF_2026-08-31.md), which
> framed this as a build-or-don't choice before those constraints were known.
>
> **Parent canonical page:** [`bd-ranking-and-priority-queue.md`](bd-ranking-and-priority-queue.md)
> (the surfaces that consume the role). **Status: DESIGNED + FULLY MEASURED, NOT BUILT — blocked on
> §6.** ⛔ **The staged prompt `C13` is SUPERSEDED — it encodes a single-valued role, which §2c
> refutes.** Do not run it; it needs rewriting to the multi-label model.

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

## 2c. ⚠️ STRUCTURAL CORRECTION — the role is MULTI-LABEL, not a single value

**Scott, 2026-08-31:** *"I think these categories can exist multiple iterations per one account."*

⚠️ **That breaks the shape of this design, not just its content.** Everything above assumed one role
per entity resolved by a precedence ladder. **It is a SET.** An account can be an `investor_owner`
**and** a `repeat_buyer` **and** a `former_owner` at the same time, and all three are true.

**Measured — and the truncation would fall exactly where it hurts most:**

| | entities |
|---|---:|
| carry **2 or more** labels | **957** |
| …**`investor_owner` + `repeat_buyer`** | **772** |
| `former_owner` + `repeat_buyer` | 142 |
| carry exactly one | 11,657 |

**772 entities are simultaneously an owner and an active acquirer** — and Scott's own rule is that
this combination *"might take a group from a seller prospect to a buyer prospect for our BD
treatment depending on the pacing."* **A single-valued column would pick one label and silently
destroy the other, on precisely the population whose dual status determines how it is worked.**

⚠️ **So `entities.owner_role` — a scalar column — is the wrong storage.** It needs a per-entity,
per-role record carrying evidence and dates. **The existing consumers are unaffected in kind:** every
one of them asks `owner_role IN (...)`, which becomes *"has role X"* against the set. And
`behavioral_override` already exists as a scalar escape hatch — **plausibly because someone
previously felt the single column was insufficient and worked around it.**

## 2c-i. Scott's definitions, verbatim

| role | Scott's words | reading |
|---|---|---|
| **`one_off_owner`** | *"a category of **individual investor** that only owns one of our target submarket category"* | ⚠️ **an INDIVIDUAL, one target asset** — my 2,448 counted any org with one asset, which is not this. **143 person-typed entities hold exactly one.** |
| **`investor_owner`** | *"anyone or firm or SPE that owns for the purpose of investing and probably should include **all of our prospects in the space**"* | **deliberately BROAD** — the default for owning-to-lease. **6,469.** SPEs included. |
| **`developer`** | *"buys and sells programmatically… pursuing a relationship with the tenant, showing sites, negotiating a lease, building for the tenant, and then usually selling to realize the arbitrage between build cost/cap and exit cap"* | ⚠️ **a BEHAVIOURAL signature — acquire → build → sell, repeatedly.** The existing classifier reads `properties.developer_name`, which is a *label*, not this behaviour. **Under-specified by what we hold; do not claim the current 715 satisfies it.** |
| **`repeat_buyer`** | *"anyone that has acquired more than one asset in our swimlane; the more frequent and recent the acquisitions, the more relatively important"* | **≥2 acquisitions — 3,258** — plus **pacing as a weight, not a label** |
| **`user_owner`** | *"fairly infrequent… good with it being a human determination"* | ✅ confirmed: human-confirmed lane, ~13 candidates |

## 2c-ii. ⚠️ Pacing is the signal Scott cares most about, and it is 49% unmeasurable today

He ties BD treatment to *pacing* — frequency and recency of acquisition. Measured over
organizations with ≥2 purchases:

| | entities |
|---|---:|
| repeat buyers | **2,726** |
| …last acquisition within 2 years | **43** |
| …within 5 years | 99 |
| …**apparently dormant 5+ years** | **2,627** |
| ≥5 purchases · ≥10 | 1,123 · 288 |
| repeat buyers who are contactable | 122 |

⚠️ **Do NOT read 2,627 as dormant. `ownership_start_date` is present on only 7,152 of 14,119
portfolio facts — 50.7%.** Roughly half of that "dormancy" is **missing dates, not inactivity.**
Reporting it as pacing would be the P180 NULL-is-not-zero failure on the single dimension Scott says
drives seller-vs-buyer treatment.

**So pacing must be surfaced as `pacing_unknown` wherever the dates are absent — never as
"dormant"** — and **improving `ownership_start_date` coverage is the binding constraint on the part
of this model that matters most.** That is a data-acquisition item, not a classifier one, and it is
newly the highest-value thread in this design.

## 2c-iii. The corrected model

**Per entity, a SET of roles**, each with its own evidence and dates:

| role | evidence | population | automated? |
|---|---|---:|---|
| `operator` | `is_operator_not_owner` / recorded `owner_type` (P113) | 36 | ✅ recorded flag |
| `user_owner` | owner ≈ tenant on the same property | 13 candidates | 👤 **human-confirmed** |
| `investor_owner` | ≥1 current portfolio fact | **6,469** | ✅ deterministic |
| `repeat_buyer` | ≥2 acquisitions in the swimlane **+ pacing** | **3,258** | ✅ count; ⚠️ pacing 49% blind |
| `former_owner` | held a fact that ended, holds none now | **3,801** | ✅ deterministic |
| `one_off_owner` | **individual** holding exactly one target asset | **143** | ✅ deterministic |
| `developer` | ⚠️ **behavioural — not yet specified from what we hold** | 715 *(a label, not the behaviour)* | ❌ **under-specified** |

⚠️ **`developer` is the one arm this design cannot yet honour.** Scott's definition is a *pattern of
behaviour over time* — build-to-suit for a named tenant, then sell. The existing 715 come from a
name field. **Detecting the real thing needs acquire→build→sell sequences per entity, which nobody
has measured.** Under accuracy-first, **the honest move is to keep the existing `developer` label as
what it is (a captured attribution) and flag the behavioural definition as unbuilt** — not to claim
the two are the same.

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

## 6. Where this stands after Scott's definitions (2026-08-31)

✅ **Answered by Scott:** `user_owner` is a human-confirmed lane · `one_off_owner` is an
**individual** with one target asset · `investor_owner` is broad and includes SPEs · `repeat_buyer`
is ≥2 acquisitions with pacing as a weight · `developer` is a behavioural pattern ·
**and the roles are MULTI-LABEL.**

⛔ **The staged build prompt `C13` is SUPERSEDED and must not be run.** It encodes a
precedence-ordered **single** role, which §2c refutes on 957 entities. It needs rewriting to the
set model before it is sent.

**Now open, in the order they block:**

1. ⚠️ **`ownership_start_date` is present on 50.7% of portfolio facts** — so **pacing, the dimension
   Scott says drives seller-vs-buyer treatment, is half unmeasurable.** This is now the
   highest-value item in the design and it is **data acquisition, not classification.**
2. ⚠️ **`developer` is under-specified.** Scott defines a behaviour (build-to-suit for a named
   tenant, then sell); we hold a name label. **Detecting the real thing needs acquire→build→sell
   sequences, unmeasured.** Keep the existing 715 as a captured attribution; do not claim it is the
   behaviour.
3. **Storage shape** — a per-entity/per-role table (with evidence + dates) rather than the scalar
   `entities.owner_role`. Consumers all ask `owner_role IN (...)`, which becomes *"has role X"*.
4. **Whether `one_off_owner` should be dia-only.** Scott's wording says *"our target submarket
   category (dialysis)"*; the measurement was cross-domain. **143 person-typed single-asset holders
   fleet-wide — the dia-only subset is unmeasured.**
