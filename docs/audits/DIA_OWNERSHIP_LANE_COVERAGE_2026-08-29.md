# dia Deals ▸ Ownership — what the lane actually covers, and what it can never cover

**Measured live on `zqzrriwuavgrquhisnoa` (Dialysis_DB), 2026-08-29.** Follow-up to the
statement-timeout fix (`supabase/migrations/dialysis/20261003120000_*`), which made the
lane render. This document answers the next question: **the lane shows 16 canonicals /
61 variants / 500 properties — what is causing the gap, and why are the buyers not
linked to the company record?**

Nothing here is built. Every number is a measurement; every recommendation names what it
would cost and what it would risk.

---

## 1. The funnel, end to end

| stage | count | note |
|---|---:|---|
| dia properties | **11,797** | |
| ├─ no `recorded_owner_id` at all | **6,353** | the lane is structurally blind to these |
| │   └─ of which `true_owner` is a flagged OPERATOR | 4,028 | the P113 tenant-in-the-owner-slot trap |
| │   └─ of which no owner of any kind | 1,503 | |
| └─ has a `recorded_owner_id` | **5,444** | |
| distinct `recorded_owners` | **7,255** | |
| └─ matching one of the 38 `owner_canonical_patterns` regexes | **72** | **1.0%** |
| └─ landing in a cluster of ≥2 (what the lane shows) | **61** | 11 are pattern singletons |
| canonicals shown | **16** | |
| properties covered | **500** | 9.2% of owner-bearing properties, 4.2% of all |

### ⚠️ The headline: this lane is a readout of a 38-row hand-curated allowlist, not a detector

`v_recorded_owner_canonical_clusters` groups on `dia_canonicalize_owner_name(name)`, and
that function returns `btrim(name)` — **the name itself** — for anything that does not match
one of the 38 regexes in `owner_canonical_patterns`. So an owner can only ever cluster if
somebody hand-wrote a pattern for it, **or** if two owner rows carry byte-identical names.

Measured: **there are ZERO byte-identical duplicate `recorded_owners.name` values.** The
second path contributes nothing. **100% of what the lane shows is the 38 patterns showing
themselves.** 7,183 of 7,255 owners (99.0%) cannot appear no matter how many variants they
have.

That is the gap. It is not a bug — the lane does exactly what it was built to do — but the
panel's framing ("Each row is one canonical entity … sorted by total properties, biggest
leverage first") reads as *a survey of the duplicate-owner problem*, and it is not one.

---

## 2. How much bigger is the real population?

Grouping the same owner set by looser keys, with the **property** coverage each would add:

| grouping key | groups | variants | properties |
|---|---:|---:|---:|
| exact canonical — **what ships today** | **16** | 61 | **500** |
| byte-identical `name` | 0 | 0 | 0 |
| case + punctuation insensitive | **300** | 631 | 463 |
| `dia_norm_owner_name` (strips legal forms) | **385** | 826 | 652 |

**⚠️ Read the two columns in opposite directions.** The looser keys find ~20× more GROUPS
but roughly the *same* number of properties — 463 and 652 against today's 500. The 38
patterns were written for the big consolidators (SMBC 165 properties, Realty Income 72,
MassMutual 47), so the curated set is already capturing most of the *value*; the long tail
is hundreds of two-row name variants holding one or two properties each.

So: **expanding the grouping key is a data-hygiene win, not a coverage win.** If the goal is
"see more of the portfolio", the lever is §4, not this.

**⚠️ And do not wire `dia_norm_owner_name` straight into a write path.** `CLAUDE.md`
documents this hazard three times over for the sibling normalizers
(`dup-pair-planner.ownerCore`, `lcc_normalize_entity_name`, `lcc_owner_strict_core`): a
legal-form/generic-token stripper is sanctioned for **grouping candidates for review** and
banned for **identity**. 385 groups is a review queue, not 385 merges.

---

## 3. "Link these buyers to the true company record" — the premise has moved

The panel says: *"Resolving the canonical's `true_owner_id` once auto-fills any linked
properties whose `true_owner` is still NULL (via the migration-V propagation trigger)."*

**Measured: there are no NULLs left to fill.**

| | count |
|---|---:|
| properties with a `recorded_owner_id` **and** `true_owner_id IS NULL` | **0** |
| `recorded_owners` already linked to a `true_owner` | 7,138 of 7,255 |
| lane variants still unlinked | **6 of 61** |
| `dia_unify_canonical_true_owners(true)` — dry run, today | **0 created, 14 owners, 7 properties** |

The propagation already ran. The seeder the (old) empty state recommended is essentially
drained: it would move 14 recorded_owners and 7 properties, not 500.

### ⚠️ The real blocker is that the owner slot is occupied by the TENANT

Of the **500** properties in the lane, what sits in `properties.true_owner_id`:

| | properties | share |
|---|---:|---:|
| a flagged **operator** (`is_operator_not_owner`) — DaVita, Fresenius, American Renal | **395** | **79%** |
| a placeholder (`Independent` / `Other` / `State Owned`) | 5 | 1% |
| something that reads like a real landlord | **100** | 20% |

Read on named rows: **Realty Income Corporation** is the recorded owner on 72 properties
whose "true owner" is *American Renal Associates* and *DaVita Inc.* **MassMutual** holds 47
whose true owner is *Fresenius Medical Care*. **Elliott Bay Capital** holds 25, all reading
*DaVita Inc.* These are the net-lease landlords sitting behind the operator, which is the
documented **P113** trap — dia files the tenant in the owner slot at scale.

**So "link the buyer to the company record" is not a fill-blanks operation on this
population — it is a supersession decision** (replace a flagged operator with the landlord),
and `dia_unify_canonical_true_owners` deliberately refuses it: its plan requires
`is_operator_not_owner IS NOT TRUE` on the target. That refusal is correct; it just means
the tool cannot do the job being asked of it.

**The good news: the system already knows.** 395 of 395 are *flagged*, not inferred — the
`is_operator_not_owner` boolean is set. A supersession pass has a reliable predicate to work
from and does not need a new name-based operator test (writing a second one is the
normaliser drift `CLAUDE.md` warns about).

### The genuinely small, decidable part

Setting the operator question aside, the lane's own true-owner hygiene is a **10-row job**:

- **6 variants carry no `true_owner_id`** — SMBC ×3, Agree Realty ×1, Healthcare Realty ×1,
  Capital Square 1031 ×1.
- **4 canonicals resolve to two different `true_owners` each** — SMBC/SMFG, AEI Capital /
  AEI Capital Corporation *(and a third, `Aei Capital Corp`, holding 8 properties — AEI is
  split three ways)*, Healthcare Realty Trust / Healthcare Realty Trust Incorporated,
  Societe Generale / SG Mortgage Finance Corp.

### On the LCC side ("the company record in the app")

Checked `external_identities(source_system='dia', source_type='true_owner')` on LCC Opps for
the 10 `true_owners` behind those splits:

- **8 of 10 resolve to a live LCC entity**, none pointing at a tombstone.
- **2 have no LCC entity at all**: `SMFG` and `AEI Capital Corporation`.
- `Healthcare Realty Trust` and `Healthcare Realty Trust Incorporated` are **two separate LCC
  entities sharing `canonical_name = 'healthcare realty'`**, so they already sit in
  `v_lcc_merge_candidates` (5,194 rows / 3,006 auto-mergeable fleet-wide).

Fleet-wide: **6,568** dia `true_owner` identities exist on LCC against **1,128** dia
true_owners that actually hold a property — so the entity linkage is broadly in place. The
duplication is not missing links; it is the *same split* mirrored one level up.

---

## 4. ⚠️ Two pattern precision defects, found by reading the rows

The 38-pattern table is not just narrow — two of its regexes over-capture, and both were
found only by reading named rows rather than a rate.

**`^healthcare\s+realty(\s+trust)?` has no end anchor**, so it matches
**`HealthCare Realty Solutions`** and canonicalizes it to `Healthcare Realty Trust`.
Different company. (It is, tellingly, the one *unlinked* member of that cluster — the
mis-grouping is why it never got a true owner.)

**`^(sumitomo\s+bank\s+leasing|smbc\s+leasing|sumitomo\s+mitsui)` matches any
`sumitomo mitsui …`**, so **`Sumitomo Mitsui Trust Bank`** — Sumitomo Mitsui Trust Holdings,
a **different corporate group** from SMBC/SMFG — is canonicalized into SMBC **and is already
linked to SMBC's `true_owner_id`**. The wrong link is written, not merely proposed.

Also folded into SMBC: **`SMBC Leasing & Finance Inc, Stanley F & Jane M Banach`** — a
prefix match that swallows two named individual co-owners. That is the P158a hazard
(`&` in an owner name is usually people, not a firm) reaching a write path.

**Blast radius today is ZERO: all three rows hold 0 properties.** That is precisely why this
is worth correcting now rather than after they acquire one. It is a two-line change to
`owner_canonical_patterns` (anchor the Healthcare pattern; narrow the Sumitomo alternation),
but it is a judgement about *company identity*, so it is **surfaced, not applied** —
`CLAUDE.md`'s standing rule is that an owner is never invented and ambiguity goes to a human.

---

## 5. What the panel currently claims that is no longer true

| panel text | measured |
|---|---|
| "auto-fills any linked properties whose `true_owner` is still NULL" | **0** such properties exist |
| "Run `dia_unify_canonical_true_owners` on the DB to seed" *(old empty state)* | dry run: 0 created / 14 owners / 7 properties. Corrected in the timeout fix so it is only shown when the query genuinely succeeded and returned 0 rows. |
| "Each row is one canonical entity … biggest leverage first" | true, but the row **set** is 38 hand-written patterns, which the copy does not say |

---

## 6. Recommendations, in the order they pay

1. **Fix the panel copy** *(shipped with this document)* — state that the lane is
   pattern-driven and that the true-owner slot may hold the operator. A surface that
   overstates its own coverage trains the operator to think the problem is solved.
2. **Decide the two pattern defects (§4)** — Scott's call, 0 properties at risk, ~10 minutes.
3. **The 10-row true-owner hygiene job (§3)** — 6 unlinked variants + 4 split canonicals.
   Small, decidable, and it also clears two LCC merge candidates.
4. **Size the operator-supersession question (§3) before building anything** — 395 of 500
   lane properties, and 4,028 more with no recorded owner at all. This is the only lever that
   moves *coverage* materially, and it is a genuine doctrine decision (overwriting a
   populated, flagged owner slot), not plumbing.
5. **Do NOT widen the grouping key to chase group count** — §2 measured the trade: ~20× the
   groups for roughly the same properties, using a normalizer that is banned for identity.
   If it is built, it is a review queue with a human verdict, never an auto-merge.

## 7. Verify

```sql
-- funnel
select count(*) filter (where recorded_owner_id is null) as no_recorded_owner,
       count(*) filter (where recorded_owner_id is not null) as has_recorded_owner
from properties;

-- the lane is bounded by the pattern table
select count(*) from recorded_owners ro
 where exists (select 1 from owner_canonical_patterns p
                where lower(btrim(ro.name)) ~ p.match_regex);   -- 72 of 7,255

-- the owner slot holds the tenant
select count(*) filter (where t.is_operator_not_owner is true) as operator,
       count(*) as lane_properties
from v_recorded_owner_canonical_clusters c
join properties p on p.recorded_owner_id = c.recorded_owner_id
left join true_owners t on t.true_owner_id = p.true_owner_id;  -- 395 of 500

-- the seeder is drained
select * from dia_unify_canonical_true_owners(true);           -- 0 / 14 / 7
```
