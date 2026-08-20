# The supersession tie lane is a role artifact, not an evidence gap — 2026-08-19

**Status:** measured, nothing built. This changes what "owner" means for ~63
assets, so it needs a decision before it ships.

---

## 1. What I assumed, and what is actually there

`tie_on_winning_date` has sat at **233 assets** all session. I spent the day
chasing *ordering evidence* for it — SF notes (broke 0), the dia ownership
workbook (7), gov `ownership_history` (18). The premise was that a tie means
"several owners, no way to tell which is current."

Opening the lane says otherwise:

| tier | source | assets | avg tied candidates |
|---|---|---|---|
| 3 | `rel_purchase` | **202** | 3.9 |
| 5 | `rel_owns` | 31 | 3.0 |

**Not one tie comes from `gov_ownership_transition`.** Every one is
relationship-graph evidence, and the tied candidates share an *identical* date
because they are parties to **one transaction**, not competitors across time:

```
4302 S Main St   2024-11-14   SMBC Leasing & Finance Inc
                              SMBC Leasing And Finance Inc   ← same firm, 2 spellings
                              Phoenix Farmville Llc
                              Phoenix Realty Management

1946 Grand Ave   2025-09-02   Agree Central LLC              ← SPE
                              Agree Realty CORP              ← its parent REIT
                              Craig Burrows                  ← principal
                              Sage Hills Mhp Llc             ← his SPE
```

A date can never break these. They are identical **by construction**.

## 2. The mechanism

`entity_relationships` *does* distinguish roles — and richly:

| relationship | role | edges | assets |
|---|---|---|---|
| `purchases` | **buyer** | 1,568 | 202 |
| `purchases` | **true_buyer** | 810 | 189 |
| `sells` | seller / true_seller | 1,411 / 869 | 185 / 181 |

**`buyer` and `true_buyer` are both `purchases`.** `buyer` is the SPE on the
deed; `true_buyer` is the beneficial owner behind it. The `rel_purchase` evidence
feeder collapses them, so one sale yields two competing candidates at the same
date. Of the 202 tied assets, **every** candidate is a buyer or a true_buyer —
`neither = 0`.

That is why no amount of ordering evidence has moved this lane, and why the gov
work — correct on its own terms — was never going to touch it.

## 3. What preferring the beneficial owner would actually yield

**63 assets. Not 137.** The funnel matters more than the headline:

| | |
|---|---|
| tied assets (`rel_purchase`) | 202 |
| … with exactly one `true_buyer` | **137** |
| … whose true_buyer is an `organization` | 112 |
| … after the brokerage + org-marker guards | **63** |

The 137 figure is the one that looks quotable and is wrong by more than 2×.
Two existing guards eat the difference, both correctly:

- **25 true_buyers are people** — `Rodney Hildebrandt` over `Rah Advantage, Inc`,
  `Rakesh Alla` over `Rdah Series D Llc`, `Dr. Shaun Aure` over `Jones Rd Llc`.
  `lcc_supersede_property_owner` requires `entity_type='organization'`, so these
  land in `person_shaped_winner`. **They are not a loss** — a named principal
  behind an SPE is exactly the reachable contact the whole P137 exercise was
  chasing. They belong in the P114 attach lane, not in `lcc_property_owner`.
- **2 are brokerages** — `Newmark Group, Inc.` is recorded as the *true_buyer*
  over `NNN SFS Town Center LLC`. `lcc_owner_name_is_brokerage` already catches
  it. Worth noting the upstream capture is wrong, not just the guard being
  useful.

## 4. The decision this needs

Preferring `true_buyer` over `buyer` changes what `lcc_property_owner` **means**
for those assets: the beneficial owner rather than the title-holding SPE.

**The argument for:** it is what BD wants — Boyd Watterson is who you call, not
`Atlanta GA II SGF LLC`. It also matches LCC's existing lean, where
`domain_true_owner` already outranks `rel_purchase` precisely because it is the
curated beneficial owner.

**The argument against:** the SPE is the legal owner of record, and collapsing to
the parent loses that. The cleaner model is SPE in `lcc_property_owner` **plus** a
parent edge — which is more work and needs a relationship type LCC does not yet
carry.

**Not built pending that call.** It is a one-line precedence change in the
evidence feeder either way; the cost is in the semantics, not the code.

## 5. What is genuinely stuck

| | assets |
|---|---|
| resolvable by role precedence (§3) | 63 |
| true_buyer is a person → P114 attach lane | 25 |
| multiple true_buyers, still tied | 50 |
| no true_buyer at all | 15 |
| `rel_owns` tier-5 ties | 31 |

The 50-with-multiple-true-buyers are the only genuinely ambiguous ones, and
**24 of the 233 have a pair sharing an identical strict core** (`SMBC Leasing &
Finance Inc` / `SMBC Leasing And Finance Inc`) — those are merge candidates, not
ownership questions, and cleaning them is what makes the duplicate visible rather
than what hides it.
