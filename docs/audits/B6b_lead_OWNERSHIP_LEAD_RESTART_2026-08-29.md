# B6b-lead — the ownership-change lead lane: graded, funnelled, and NOT restarted (2026-08-29)

> 📍 **CANONICAL PAGE: [`../architecture/producer-health-and-ci-enforcement.md`](../architecture/producer-health-and-ci-enforcement.md)** — one door into the whole B6 arc (live producer state, CI enforcement status per repo, and the traps already paid for). **This file is EVIDENCE for its date.** Where it and the canonical page disagree, the page wins.

**Verdict: STOP. Do not restart `ingest_ownership`.** Not because the gate failed the test this
prompt set for it — it passed — but because the measurement that justified treating this restart as
different from every other dead producer, **"its consumer is confirmed alive," is refuted.** Across
all 7,729 `ownership_change` leads: **0 assigned, 0 contacted, 0 with a next action, 0 pushed to
Salesforce.** The Consumption-Layer rule is explicit — *a named consumer; if none, don't build the
producer.*

Diagnosis only. **Nothing was written to `ownership_history`, `prospect_leads`, or any gov table.**
Everything below is measured live against gov `scknotsqkcheojiaewwh` on 2026-08-29.

---

## 1. What was asked, and what each answer turned out to be

| # | Asked | Answer |
|---|---|---|
| 1 | Grade `is_same_owner` vs the normalized test | **91.80% agreement**, errs conservative. Does NOT fail the stop test. But 73 false acquisitions, and the **two highest-value would-write rows are both false**. |
| 2 | Credentialed dry run | **Could not run the Python** (no Supabase credentials in the sandbox). Substituted something stronger: the gate reproduced exactly and evaluated **exhaustively on all 16,492 rows** (§3). |
| 3 | Historical vs ongoing, separately | **584 total; 42 since the lane died.** Both far below the backlog's figure. |
| 4 | Restart with the deflation chain | **Not done — see the verdict.** The chain is measured and specified so the restart is a one-step decision. |
| 5 | Register it in B6a's producer registry | **Not done** — registering a producer nobody will restart adds a permanent RED row describing a decision, which is the badge-that-is-noise failure. |

---

## 2. ⚠️ The premise in §0 is refuted — the lane has no human consumer

B6b §9 and this prompt's §0 both cite: *7,729 leads, 2,041 worked, 208 pushed to Salesforce, 2,149
touched in the last 30 days.* **All three numbers are real and all three are mislabelled.** My query
reproduces each of them **exactly** — same rows, different reading:

| quoted as | actually is |
|---|---|
| 2,041 **worked** | `pipeline_status = 'filtered_multi_tenant'` (563 + 1,478) — an **automated exclusion filter**, not a person |
| 208 **pushed to Salesforce** | `sf_contact_id` is non-null (101 + 107) — a **matched existing SF contact**. `sf_lead_id` is **0 of 7,729**; `sf_sync_status` is `'pending'` for **all 7,729**. Nothing has ever been pushed. |
| 2,149 **touched in 30 days** | **1,216 of them on a single day, 2026-08-24** — one bulk sweep. Only **25 distinct update days** in the lane's entire life. |

The lane has exactly **two** `pipeline_status` values ever — `new` and `filtered_multi_tenant`. And
across all 7,729 leads, both origins:

```
assigned_to IS NOT NULL      0
last_contacted_at IS NOT NULL 0
next_action IS NOT NULL       0
sf_lead_id IS NOT NULL        0
```

> **⚠️ Every signal that looked like consumption is machinery.** This is the A5 lesson
> (*check who writes a terminal status before ranking lanes by it* — there, 596 completions were all
> one auto-close) and the P119 lesson (*a status set in bulk is not a per-item decision*) arriving
> together, on the one lane whose liveness nobody re-checked because it had already been "verified."

**And the evidence is 59% someone else's lane** (§4): of 7,729 leads only **3,199** trace to
`gsa_lease_diff`; **4,530** trace to `county_deed`. The actual lane's rate is
**563 / 3,199 = 17.6%**, not the 26% the prompt quotes — and 17.6% of an automated filter is 0%
human engagement.

---

## 3. `is_same_owner`, graded head-to-head on all 16,492 rows

**The reference test is the alnum key** — `regexp_replace(lower(x),'[^a-z0-9]','','g')`, the
A2-sanctioned comparator for SPE/initials-named parties (`lcc_ownership_chain_name_key`). It returns
**7,940**, reproducing the prompt's §2 figure exactly. (`gov_owner_strict_core` gives 8,446,
`gov_norm_owner_core` 8,679, `gov_norm_owner_name` 8,402 — none is the quoted number.)

**Method.** `normalize_entity` and arms 1/3/4 were reproduced faithfully in SQL (`str.replace` is
replace-all, and so is SQL `replace`, so the reproduction is exact). The `SequenceMatcher` arm cannot
be expressed in SQL, so the 8,014 rows the deterministic arms leave open were pruned by a **valid
necessary bound** (ratio ≥ 0.9 ⟹ `2·min(len) ≥ 0.9·(len_a+len_b)`) to 2,364 distinct normalized
pairs, and **real `difflib.SequenceMatcher` was run on every one of them locally**. Nothing is
sampled or estimated.

| | ref: same | ref: changed |
|---|---:|---:|
| **`is_same_owner`: same** (suppressed) | **A 7,867** | **C 1,279** |
| **`is_same_owner`: acquisition** (→ lead) | **B 73** ⚠️ | **D 7,273** |

- **Agreement 15,140 / 16,492 = 91.80%.** Reconciles exactly: A+B = **7,940** = the reference count.
- **`is_same_owner` suppresses MORE, not less** — 9,146 vs 7,940. It is the conservative one, so it
  does **not** flood the lane with false acquisitions. **The stop condition in the prompt's closing
  paragraph is not met.**

### Cell B — 73 events where a pure re-spelling becomes an acquisition

Read on named rows, **every one is punctuation on an acronym owner**:

| old | new | n |
|---|---|---:|
| `RGR INC` | `R.G.R, INC.` | 4 |
| `TORRE CHARDON, S.E.` | `TORRE, CHARDON SE` | 5 |
| `GOP 3, LLC` | `G.O.P. 3, LLC` | 2 |
| `CMRC LTD.` | `CMRC LTD` | 2 |
| `ADJ Corp.` | `ADJ CORP` | 2 |
| `ADM CAMARILLO LLC` | `A.D.M. CAMARILLO, LLC` | 1 |
| `AP SIERRA` | `AP-SIERRA` | 2 |

`normalize_entity` strips legal forms but **never punctuation**, so an acronym gaining or losing
periods defeats arms 1, 3 and 4; and because acronym names are short, `SequenceMatcher` lands at
**0.833–0.894** — just under the 0.90 threshold.

> ⚠️ **The brittleness is visible as a contradiction in the data**: `TORRE, CHARDON SE` →
> `TORRE CHARDON S E` scores **0.941** and is correctly suppressed, while `TORRE CHARDON, S.E.` →
> `TORRE, CHARDON SE` scores **0.889** and becomes a lead. **The same two parties, both directions,
> opposite verdicts** — decided by which side of 0.90 a character-diff ratio falls on.

### Cell C — 1,279 events suppressed that the reference calls changed

**Mostly correct, and the reference is the weaker test here.** By arm:

- **arm 1, 268** — legal-form-only: `NORTHWESTERN DEVELOPMENT CO` → `… COMPANY, LLC`,
  `TEXAS NAME LTD` → `TEXAS NAME LIMITED`. Correct; the alnum key cannot see these.
- **arm 3 (containment), 705** — entity conversions: `CENTRAL PARKING CORPORATION` →
  `CENTRAL PARKING LLC`, `Prologis, Inc.` → `PROLOGIS, L.P.`, `BAINS HOLDINGS, LIMITED` →
  `BAINS HOLDINGS LTD`. Mostly correct.
- **the ratio arm, 229** — **typo and OCR repair**, which nothing else catches:
  `BANDYWINE` → `BRANDYWINE`, `JG HOUSING SOLUTLONS` → `SOLUTIONS`,
  `CAPITOL AVENUE DEVELOPMENT` → `DEVELOPEMENT`.

**So neither test dominates: the correct rule is the UNION, not a replacement.** The alnum key
catches punctuation the ratio arm misses; the ratio arm catches typos the alnum key misses.

### ⚠️ arm 4 (first-three-words) is structurally wrong for this asset class

77 events. Government-leased SPEs are named after the **address**, so "first three words match" very
often means *same building* — which is exactly what a genuine sale looks like. Live:
**`2400 LAKE PARK PARTNERSHIP, LP` → `2400 Lake Park Atlanta Office, LLC`** is suppressed, and
`BANK OF NEW YORK, INC., THE` → `BANK OF NEW YORK MELLON CORPORATION, THE` (a merger) with it.

### ⚠️ `normalize_entity` mangles names — unanchored `str.replace`, confirmed in production

`n.replace(" CO","")` removes the substring **anywhere**, and `" CORP"` is applied before
`" CORPORATION"`. Measured on live lessor names:

```
MIDWEST INCOME PROPERTIES LLC  ->  MIDWESTOME PROPERTIES
JACKSON COUNTY PARTNERS LLC    ->  JACKSONUNTY PARTNERS
ACME CORPORATION               ->  ACMEORATION
```

Live rows in the would-write set: `ALACHUA,UNTY OF`, `GRAHAMMPANIES, THE`, `CERRITOSORATE TOWER`,
`JWBNSULTING AND PLANNING`, `TRIUNTY BUSINESS CAMPUS`, `550ORATE CENTER INVESTMENT GROUP`.

The harm is **order-dependent**: `ALACHUA, COUNTY OF` mangles to `ALACHUA,UNTY OF` while
`COUNTY OF ALACHUA` is untouched (no leading space at position 0) — so the same words in a different
order normalize differently and the comparison fails.

### ⚠️ arm 3's `length > 5` guard lets short sponsor names through

**`LCOR` → `LCOR ALEXANDRIA`** is containment, but `LCOR` is 4 characters, so the guard blocks the
arm and the row becomes an acquisition. **At $75.4M it is the single highest-value row in the
would-write set.** The second highest, `JPMORGAN CHASE BANK, NATIONAL ASSO` →
`MORGAN CHASE BANK, N.A.` at $26.3M, is a truncation of the same bank.

> **Both of the top two rows the producer would write are false acquisitions.** A 91.8% agreement
> rate is not a safety property when the errors concentrate at the top of the value ranking.

---

## 4. ⚠️ `route_to_pipeline` launders provenance — and today it would route the wrong population

`ingest_ownership.route_to_pipeline` reads **`ownership_history`**, not the events, and hard-codes
`"lead_source": "ownership_change"` for **every row it routes, regardless of `data_source`.**

Its input today (`research_status='pending' AND linked_lead_id IS NULL`) is **4,369 rows, of which
ZERO are `gsa_lease_diff`**:

| data_source | rows |
|---|---:|
| `sales_transaction_seller_exit` (**B5, written 2026-08-28**) | 2,776 |
| `costar_sidebar` | 1,240 |
| `county_deed:<uuid>` | 249 |
| deed_extraction / deed_records / owner_deed_reconcile / sales_transaction | 104 |

**Running `route_to_pipeline` today mints 4,369 leads labelled `ownership_change` from six other
producers — 2,776 of them B5's sale-derived transitions from the day before — and none from the lane
it names.** That is also why the lane's badge never looked dead: `county_deed` has been feeding it
under the same label all along.

Two structural consequences:

1. **The lead lane is downstream of the ownership-fact write.** There is no path from
   `gsa_lease_events` to `prospect_leads` that does not pass through `ownership_history`. So §4b of
   the prompt (*do not write ownership facts from this lane*) and "restart the lead lane" are, as the
   code stands, **mutually exclusive**. The restart needs `route_to_pipeline` to carry the origin
   before it can be scoped to one producer.
2. **`data_source` has unbounded cardinality** — ~250 distinct `county_deed:<uuid>` values. Any
   `GROUP BY data_source` fragments. It should be a source plus a key column.

---

## 5. The deflation funnel — measured, exact, applied end to end

Every stage below is a live count with the real gate applied (deterministic arms in SQL, real
`SequenceMatcher` locally). **The backlog's 10,635 is a pre-deflation number and must not be quoted.**

| # | stage | rows |
|---|---|---:|
| 0 | `gsa_lease_events` carrying a `lessor_name` pair (correct probe) | 16,907 |
| 1 | − missing an old or new side | −415 → **16,492** |
| 2 | − `is_same_owner` suppressions | −9,146 → **7,346 acquisitions** |
| 3 | − already in `ownership_history` (`source_event_id`) | −5,857 → **1,489 new events** |
| 4 | − no `lease_number` → `properties` match | −353 → **1,136 property-linked** |
| 5 | − A2b per-lease fan-out (collapse to one conveyance per party-pair per property) | → **998** across 761 properties |
| 6 | − P138 oscillating pairs (546 events carry a return leg) | → **584** |
| **=** | **would write** | **584 conveyances · 568 properties · $433.4M** |

- **584, not 10,635 — the backlog figure is 18× too high.** It counted usable events without ever
  applying the gate or the dedup.
- **Historical vs ongoing: 542 historical, 42 since the lane died (2026-03-31).** These remain two
  decisions, and the ongoing half is 7% of the work.
- **Value: median $213,304; 158 of 584 (27.1%) clear the standing $500k floor**, carrying $360.2M of
  the $433.4M. A value gate at the existing knob removes 73% of the volume and keeps 83% of the value.
- **Oscillation is 48% of the property-linked set** — far higher than elsewhere in this repo, because
  `gsa_lease_diff` is the producer P138's `is_oscillating_pair` was written for.

---

## 6. Confirmed safe, and confirmed still hazardous

✅ **The B5a fill-forward guard is LIVE and correct.** `propagate_ownership_to_property` now reads
`if new.transfer_date is not null and new.recorded_owner_id is not null`. This matters because
`ingest_acquisitions` writes `prior_owner`/`new_owner` as **text with no `recorded_owner_id`** — the
exact shape that nulled resolved owners before B5a. **Without that guard this restart would have
destroyed recorded owners on up to 568 properties.**

⚠️ **The text-only population is still growing**: `ownership_history` rows that are dated and carry no
`recorded_owner_id` are now **10,343** (7,567 at B5a). The guard contains the damage; it does not
reduce the population.

⚠️ **`find_matching_sale` has a loose fallback** — city+state within 365 days, accepted on
`buyer[:15] in new_lessor`. It stamps `sale_price` and `cap_rate` onto the ownership row. Not
exercised here; flagged before any restart.

---

## 7. Recommendation

**Do not restart until the lane has a consumer.** In priority order:

1. **Settle the consumer question first (Scott's call).** 7,729 leads exist and not one has been
   assigned, contacted, or given a next action. If nobody is going to work them, the correct action
   is to **retire the lane**, not restart it. This is the single decision that gates everything else.
2. **Fix the provenance laundering** (`route_to_pipeline` must carry the origin, not stamp
   `ownership_change` over six producers) — required before the lane can be scoped, and required
   before the existing 4,369-row residue is routed at all.
3. **Fix the three measured gate defects**: punctuation-insensitive comparison (union with the alnum
   key), anchored suffix stripping instead of `str.replace`, and arm 3's `length > 5` guard. Retire
   arm 4 or restrict it to non-address-named parties.
4. **Then restart with the §5 chain applied**, value-gated at $500k, batch-tagged and reversible,
   dry-run default — **584 rows, or 158 above the floor.**

**B6e is a genuine prerequisite and remains open**: `gsa_lease_diff` has no `field_source_priority`
rung, so a GSA lessor-of-record change and a recorded deed still cannot be adjudicated.

---

## 8. Verification, stated honestly

- **Not verifiable here:** the `feed_stale` alert for `prospect_leads_ownership_change` **stays open
  at 150 days**, correctly — nothing was restarted. That is the intended outcome, not a failure.
- **What was verified:** the gate grade is exhaustive over all 16,492 rows (no sampling); the
  confusion matrix reconciles to the reference count exactly (A+B = 7,940); the funnel's final stage
  was computed on all 967 candidate rows read in full; and all three of B6b's consumer numbers were
  reproduced exactly before being reinterpreted.
- **Positive control on the headline zero:** `assigned_to`/`last_contacted_at`/`next_action` are 0
  for this lane — and the columns exist and are populated elsewhere in `prospect_leads`, so the zero
  is a fact about the lane, not a missing column.
- **Guard shipped:** `tests/unit/test_changed_fields_jsonb_probe.py` (gov) fails on any
  `changed_fields ? '…'` / `changed_fields->>'…'` that omits the `#>> '{}'` unwrap — the Class 11
  trap that produced two published wrong findings (B6's G3 row, and B6b's own first probe).
