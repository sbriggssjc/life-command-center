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
| **`developer`** ⚠️ **see §2e — this is BUILT, not unbuilt** | *"buys and sells programmatically… pursuing a relationship with the tenant, showing sites, negotiating a lease, building for the tenant, and then usually selling to realize the arbitrage between build cost/cap and exit cap"* | ⚠️ **a BEHAVIOURAL signature — acquire → build → sell, repeatedly.** The existing classifier reads `properties.developer_name`, which is a *label*, not this behaviour. **Under-specified by what we hold; do not claim the current 715 satisfies it.** |
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

## 2e. ⚠️ CORRECTION — `developer` is NOT under-specified. It is defined, built, live, and defective in a known way.

**§2c-i said the behavioural definition was *"under-specified by what we hold"* and *"nobody has
measured"* it. That was wrong, and it was wrong because I did not look.** Scott: *"there should be
tons of details on this somewhere."* There are. **Five generations, 2026-05-22 → 2026-08-31.**

### Scott's definition was already the implemented one

> *"Developer is always going to be the **first owner in the chain of ownership with our target
> tenant's first action in that building**, build or lease, usually a retrofit. The developer will
> have acquired the land or vacant building, renovated, then the lease with our target tenant
> starts."* — 2026-08-31

**That is `v_gov_owner_at_first_gen`, shipped 2026-05-22** (migration
`government/20260522150100_gov_apply_owner_role_classification_v5.sql`) — *"owner at the
first-generation lease commencement"*, resolved as **"owner at time T = the `new_owner` of the most
recent transfer with `transfer_date <= T`."** Live today:

| gov view | rows |
|---|---:|
| `v_gov_owner_at_first_gen` | **3,667** |
| `v_gov_developer_candidates` | 354 (349 distinct) |
| `v_gov_owner_role_classification` = `developer` | **343** |
| `v_developer_chain_candidate` (UW#7) | 7,736 |

It even carries the **retrofit** case Scott names: the anchor predicate exists for **both**
`year_built` and **`year_renovated`** (`lease_anchored_to_year_renovated`), and a buyer counter-rule
(acquired >90 days after first-gen commencement ⇒ `buyer`, not developer).

### ⚠️ But its output reproduces a failure mode LCC already diagnosed and killed

Read on named rows, the 343 are dominated by **address-named single-asset SPEs at confidence 0.75** —
`1020 Lantrip, LLC` · `10668 SIERRA, LLC` · `2011 STEVENS POINT LLC` · `211 STREET LLC` ·
`2202 NORTH VAN BUREN, LLC` · `30th Street, LLC` · `3201 E UNIVERSAL LLC`. **Only 4 reach 0.85
(`dev_props ≥ 2`)**, and one of those, `GPT Properties Trust`, is a REIT.

**Both of those are documented, twice-killed failure modes on the LCC side:**

- `20260609140000` — *"the literal 'earliest owner + BTS-timing' rule alone produced **single-property
  individuals** — the gate caught it."*
- `20260609150000` — Signal B **DROPPED** because *"a REIT acquiring a build-to-suit near
  construction is the **BUYER in a sale-leaseback**, not the developer… A precision-correct
  chain/BTS signal (builder vs first net-lease buyer) is **deferred**."*

⚠️ **So the gov v5 view was never reconciled against the LCC lesson.** The definition is right; the
implementation predates the correction and reproduces exactly what the correction was written for.
**This is the real state, and it is neither "unbuilt" (my error) nor "working" (the view's row count).**

### What already exists that this design assumed did not

| thing | where | status |
|---|---|---|
| the doctrine, 3,334 lines | `docs/history/DEVELOPER_BD_AUDIT_v3.md` ⚠️ **duplicated verbatim in GovernmentProject and DialysisProject** | **the "tons of detail"** |
| current-vs-former developer | `entities.developer_status_active_until` — *"current = active project in the past 3–5 years"* | ✅ **column exists** |
| ⭐ **multi-label storage precedent** | **`entities.developer_flag_sources JSONB`** — *append-only array of `{source, confidence, observed_at}`* | ✅ **the set model already exists for ONE role** |
| `is_current_developer` | `v_entities_effective_role` | ✅ live |
| BTS → developer trigger | `dialysis/20260522180000_dia_bts_tracker_to_developer.sql` | ⚠️ **backfill was a no-op — 0 delivered rows** |
| proposed but NEVER built | `property_developers` junction · `is_retrofit` · `is_first_generation_lease_marker` · `leases.is_extension` | ❌ still unbuilt |

⚠️ **`developer_flag_sources` matters beyond `developer`:** it is an append-only `{source,
confidence, observed_at}` array on `entities` — **the multi-label shape §2c says the design needs,
already built for one role.** **C16 should extend that pattern, not invent a new table.**

## 2f. ✅ The reconciliation, measured — and it is blocked on CHAIN DEPTH, not on the rule

I recommended reconciling gov v5 against the June lesson (separate the builder from the first
net-lease buyer). **Measured, the diagnosis is right, the fix exists one domain over, and it cannot
be applied.**

### The defect is exact

`v_gov_developer_candidates` takes **the owner AT first-gen commencement**. It never requires that
the owner held the property **before** the lease started:

```sql
JOIN v_gov_owner_at_first_gen oaf USING (property_id, first_gen_commencement)
WHERE ps.is_build_to_suit = true            -- Rule A, 0.90
   -- or NOT build_to_suit                  -- Rule B, 0.80
```

**dia v5, same version, same date, HAS the guard** — its Rule A requires the owner *"held the
property continuously from ≥90 days BEFORE the first long-term lease through its commencement"*, and
its header names the exact pattern gov admits:

> *"Excluded by data integrity: owners whose `start_date` equals or precedes `lease_start` by <90
> days (the **'took title at delivery'** pattern that historically mis-classified buyers like
> Carrollwood, Butler Trust as developers)."*

**Scott's definition demands the same ordering** — *"acquired the land or vacant building,
renovated, **then** the lease starts."* One domain implemented it; the other did not.

### ⚠️ But the guard cannot be ported — the dates to apply it do not exist

| gov developer candidates | |
|---|---:|
| candidate rows / distinct owners | 354 / 349 |
| candidate properties **with ownership history** | **354 of 354** ✅ |
| …with any transfer dated **at or before** first-gen commencement | **1** |
| …**held ≥90 days before** (the dia test) | **1** |
| …no qualifying acquisition date | **353** |

⚠️ **This is not "no history" — every candidate property has ownership rows, and 70% of gov's 18,969
history rows carry a `transfer_date`. The chain simply does not reach back before the lease.** For
**353 of 354**, the recorded ownership begins *after* the tenant's first lease commenced.

**So the 343 are not wrong — they are UNVERIFIABLE.** With current chain depth we cannot distinguish
*"acquired the land, built, then leased"* (developer) from *"bought the completed building at
delivery"* (net-lease buyer). **That is precisely the discrimination the June migration deferred,
and it is deferred for a data reason, not a logic reason.**

### This converges with C14

⚠️ **Two independent threads now bottom out on the same missing data:**

- **C14 / pacing** — `ownership_start_date` on 50.7% of LCC portfolio facts, so repeat-buyer
  frequency and recency are half unmeasurable.
- **Developer** — the gov chain does not extend before the first lease on 353 of 354 candidates.

**Both are ownership-chain DEPTH and DATING**, which is what the A1–A5 / B1 / B5 lane has been
working on all along (`BD_PIPELINE_FUNNEL_AUDIT`: **149 of 13,835 gov properties have 2+ historical
owner links — 1.1%**).

**So the binding constraint on this entire design is chain depth, not classification logic.** The
rule for `developer` is settled and shipped; what it needs is history reaching further back.

⚠️ **What NOT to do:** do not add the ≥90-day guard to gov v5 as things stand — it would take the
population from 343 to **1**, which is not a precision improvement but a measurement of how little
chain we hold. **And do not "fix" the 343 by relaxing anything**; they are honest output of a rule
that cannot currently be verified. Label them by confidence and say so.

## 2g. ✅ C14 located precisely — it is DATE EXTRACTION on records we already hold

I recommended following B5's pattern: find a dated source nobody has consumed. **Measured over the
354 gov developer candidates, and the answer is neither "the data is missing" nor "the events
postdate the lease."**

| for the 354 candidate properties | |
|---|---:|
| have **deed records** | **351 (99%)** |
| have sales transactions | 285 |
| …with an `ownership_history` transfer **before** first-gen commencement | **1** |
| …with a **deed** dated before it | **1** |
| …with a **sale** dated before it | 14 |
| leases that predate our earliest deed for that property | **14** |

**The era is covered and the records are there.** Deeds span **1976 → 2026**; the candidate leases
span **1997 → 2024**, comfortably inside. Only 14 leases predate any deed we hold.

### ⚠️ The actual constraint: 824 of 5,819 gov deed records carry a `recording_date` — **14.2%**

**So this is a DATE-EXTRACTION problem on documents already in hand, not a data-acquisition
problem.** The deeds exist, attached to the right properties, from the right era. **What is missing
is the date parsed off them.**

That reframes C14 entirely:

- ⛔ **NOT county-record acquisition** (the expensive answer, and the one C2h/B4 already warned is
  "the most expensive conclusion available" when the tables named after the answer have not been
  read).
- ✅ **A deed-date extraction pass** over `deed_records`, which plugs into machinery that already
  exists: the **document-text / Document AI OCR chain** (gov `CLAUDE.md` §26, `document-text-tick`,
  the deed drain) and **ORE Phase 1 Unit C**, which already extracts grantor/grantee **addresses**
  from these same deeds. **Unit C proved the parse path works on this corpus; the recording date is
  a further field off the same documents.**

⚠️ **Do NOT infer a date.** A deed with no parsed recording date must stay undated — under
accuracy-first an honest gap beats a guessed year, and a fabricated acquisition date would corrupt
both the developer test *and* pacing, the two things it exists to unblock.

⚠️ **And re-measure before building:** 14.2% was taken on one day, and the OCR chain's crons
(160/167/169) have a documented history of being `active=false` with the byte-fetch blocked — that
is exactly the dated-blocker trap, so **check whether the chain is currently running before assuming
it will pick these up.**

### Why this is the right next thread

**Two independent, high-value threads bottom out here** — `developer` (§2f) and pacing (§2c-ii) —
and **both unblock from the same extraction.** It is bounded (5,819 rows), the corpus is already
attached to properties, the parse path is proven, and it needs **no new external source and no new
classifier.**

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
