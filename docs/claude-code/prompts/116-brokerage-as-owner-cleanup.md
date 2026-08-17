# Prompt 116 — Brokerages recorded as property owners (46 rows, two classes, one surprise)

**Origin:** surfaced 2026-08-15 when the P112-A2 cadence enrolment dry-run put **Marcus & Millichap**
($4.99M connected value) at the top of the list — one confirm away from cold-prospecting a competitor's
brokerage as if it were a landlord. Classified and dry-run 2026-08-16.
Register: `connectivity-and-open-threads.md` §4d.

**Why it matters:** these render as the owner on the property panel's Current Owner card and ownership
ladder, they feed comps/exports/matching, and they are eligible for cadence enrolment. A brokerage in the
owner slot is not a cosmetic defect — it is a wrong counterparty.

---

## Grounded classification (live, verified — do not re-derive)

`lcc_owner_name_is_brokerage()` (built for the supersession tier, migration `20260907120000`) is the
ready-made detector. Against `lcc_property_owner`:

| source | owner rows | brokerage-as-owner |
|---|---|---|
| `relationship_graph` | 1,763 | **42** |
| `domain_true_owner` | 401 | **4** |
| `supersession` | 418 | **0** ← its guard held |

Split by shape:

| class | rows | distinct owner entities | meaning |
|---|---|---|---|
| **(a)** suffix-polluted `"<owner> by <brokerage>"` | **27** | 27 | the **owner is correct**, the NAME carries a CoStar artefact |
| **(b)** pure brokerage | **19** | **7** | the **owner is wrong** |

Class (b) entities: `Marcus & Millichap`, `Capital Pacific`, `Stan Johnson Co`, `Lee & Associates`,
`NAI Pfefferle`, `Svn®`, `Trammell Crow Co (CBRE)`.

---

## ⚠️ The surprise that changes the design — DO NOT just rename

The obvious class-(a) fix is "strip the ` by <broker>` suffix", mirroring `_BROKER_SUFFIX_RE_R5` which
`detail.js` already applies **at render time** (the stored value was never cleaned). A dry-run of the strip
produced 27 clean, correct-looking names.

**But 17 of the 27 stripped names collide with an entity that ALREADY exists with the clean name:**

| polluted | clean | existing clean entities |
|---|---|---|
| `DP Brighton LLC by Marcus & Millichap` | `DP Brighton LLC` | 1 |
| `Mielkemark LLC by Stan Johnson Co` | `Mielkemark LLC` | **2** |
| `Michael Moore by Matthews™` | `Michael Moore` | 1 |
| `MassMutual Asset Finance LLC; SMBC LEASING & FINANCE INC by Colliers` | *(same, minus suffix)* | 1 |
| …13 more | | |

**So this is a duplicate-entity problem, not a naming problem.** The CoStar capture minted
`"X LLC by Broker"` as a *separate entity* from the existing `"X LLC"`. Renaming in place would produce two
entities with identical names — making the duplication invisible instead of fixing it, and leaving the
property pointed at the wrong (duplicate) entity with its own split portfolio, cadence and contact history.

---

## What to build

### Unit 1 — class (a), the 17 colliding rows: RE-POINT, then merge
1. Re-point `lcc_property_owner.owner_entity_id` to the **existing clean entity** (the real owner). This is
   a correction, not a fill-blank — reversible via a batch-tagged ledger holding the prior value.
2. File the polluted entity as a merge candidate through the **existing** machinery —
   `v_lcc_merge_candidates` / `lcc_merge_entity` — **do not invent a second merge path**. `lcc_merge_entity`
   is the single "move backrefs loser→winner" implementation (two-step DELETE-then-UPDATE) and it
   reconciles portfolio/identities/relationships/cadence.
3. `Mielkemark LLC` has **2** existing clean entities — ambiguous, so **abstain** and route to review rather
   than guessing which is the survivor.

### Unit 2 — class (a), the ~10 non-colliding rows: safe to clean in place
No clean twin exists, so strip the suffix on `entities.name` **and** the denormalised
`lcc_property_owner.owner_name`. Re-check collisions immediately before writing — Unit 1 may have created
some.

### Unit 3 — class (b), 19 rows / 7 entities: the owner is WRONG
Remove the owner assignment (the asset reverts to an honest "Unresolved") into a batch-tagged ledger, and
surface the affected assets in a review **view** so they can be re-resolved. Prefer a view over a table —
Prompt 114's lesson: a review table with no consumer is an un-consumed producer.
**Do not silently leave them**: an unresolved owner is honest; a brokerage in the owner slot is misinformation.

### Unit 4 — stop the bleeding upstream
**42 of 46 came from `relationship_graph`.** That feeder has no brokerage guard, so it will re-create these.
The supersession feeder already guards with `lcc_owner_name_is_brokerage()` and produced **0**. Add the same
guard to the graph feeder — one predicate, same function, no second definition.

---

## Discipline
Additive · reversible by batch tag · idempotent · **dry-run default** · conservative (ambiguity → review,
never guess) · reuse `lcc_owner_name_is_brokerage()` and `lcc_merge_entity` rather than writing new
equivalents.

## Deliverable
1. Re-verify the classification and the **collision count** before building — both are the load-bearing
   facts and both are cheap to re-measure.
2. Units 1–4, dry-run first, with the per-unit counts reported honestly (if a unit turns out to be smaller
   than stated, say so — the numbers above are from a single dry-run).
3. Before/after: brokerage-as-owner rows **46 → ?**, and confirm `supersession` stays at 0.
4. Update `connectivity-and-open-threads.md` §4d and
   `panel-redesign-verification.md` §3.3.

## Out of scope
- The wider duplicate-entity backlog (`v_lcc_merge_candidates` at large) — only the 17 created by this
  specific capture artefact.
- Cleaning Salesforce (LCC reconciles around SF; it does not clean it).
