> 📍 **Part A measurement for UX-T1a.** The doctrine is
> [`docs/architecture/app-ux-review-2026-09-02.md`](../architecture/app-ux-review-2026-09-02.md) §0 + **§0b**
> (Scott's five answers) and `docs/os/canon/blocks/operator-doctrine.md` (1.8.0).
> Canonical topic page: [`bd-ranking-and-priority-queue.md`](../architecture/bd-ranking-and-priority-queue.md).
> **Measured 2026-09-03 against LCC Opps `xengecqvemvfknjvbvrq`, gov `scknotsqkcheojiaewwh`, dia `zqzrriwuavgrquhisnoa`.**
> **NOTHING WAS WRITTEN. No migration, no view, no JS.** Part B is deliberately **not** built — §8 says why,
> and which two decisions are Scott's.
>
> 🔴 **SUPERSEDED IN PART, 2026-09-03 by UX-T1a-gates** — both coverage gates are now closed
> (`docs/claude-code/responses/done/UX-T1a-gates.response.md`). **Two claims below are CORRECTED there
> and must not be quoted from this page:**
> 1. **§5a / §7d — "`loan_maturity` has no producer" is TRUE of `v_lcc_bd_worklist` and FALSE of
>    the handler.** `api/operations.js::assembleBdWorklist` has always fanned out to the domains'
>    `v_loan_maturity_watch` views, both live (gov 178 rows / dia 72). The Today tile was not blind
>    to debt. What was missing is that the fan-out emits `entity_id: null` — the signal could not
>    be attributed to an owner, which is the real blocker for an owner-keyed queue.
> 2. **§4a — the dia ceiling is 1,747 properties, not 1,940.** That 1,940 counts **1,986 SUPERSEDED
>    leases**; a superseded lease has been replaced and is not the lease in effect.
>
> Live state after UX-T1a-gates: dia `lease_expiration` in the mirror **0 → 1,747**;
> `v_lcc_bd_worklist.loan_maturity` **0 → 172** (109 owners); priority queue human surface
> **1,635 → 694**. **Re-derive every number on this page rather than quoting it.**

# UX-T1a Part A — the seller-first queue, measured gate by gate

**The doctrine's queue, computed strictly, is 23 rows / 23 owners / 22 properties.** Two gates produce
that: **newer lease** cuts 3,529 → 259 and **reason to sell** cuts 259 → 31. Both cuts are
**coverage-limited, not selectivity-limited** — the data that would populate them exists and is not
reachable from LCC. And the queue the operator sees today is **89.6% disjoint** from the doctrine's
population: of the 259 in-band newer-lease assets, **27** appear in `v_priority_queue`.

---

## 1. The funnel

| step | rows | owners | properties |
|---|---:|---:|---:|
| **G1** universe — current holdings (`is_current`) | 8,858 | 6,480 | 8,068 |
| **G2** + individual value $2.5M–$25M | 3,529 | 2,797 | 3,092 |
| **G3** + newer lease | **259** | 237 | 222 |
| **G4** + a reason to sell | **31** | 26 | 29 |
| **G5** + not yet reached | **23** | **23** | **22** |

The 8,068 reproduces OWN-T0's independently measured property count exactly — an unlooked-for
cross-check on the universe.

**It is under 50, and the prompt asks that this be said plainly: G3 (a 93% cut) and G4 (an 88% cut)
did it.** Neither is the doctrine being demanding. §4 and §5 show both are measurement gaps.

### Sensitivity — which gate is load-bearing

| variant | rows | owners |
|---|---:|---:|
| A — all four gates (strict doctrine) | 23 | 23 |
| B — drop `reason_to_sell` (debt unmirrored, §5) | 205 | 204 |
| C — drop `newer_lease` (dia mirror empty, §4) | 410 | 314 |
| D — band + not-reached only | 2,830 | 2,471 |
| E — band + newer lease only | 259 | 237 |
| **F — (newer lease OR reason to sell) + not reached** | **592** | **495** |

**F is the variant worth discussing.** Scott's §0.3 wording lists "newer lease, a reason to sell" as
characteristics of the sweet spot, and a reason to sell is independently sufficient — a maturing loan on
a *mid-term* lease is a strong prospect and variant A excludes it. F is also the only variant that lands
in the range an operator can actually work down over a quarter.

---

## 2. G1 — the universe, and the value basis

Value is **per individual property sale price** (§0b.3), never owner rent. `lcc_property_attributes`
carries no price column, so value is derived, and the basis had to be chosen by measurement.

| candidate basis | rows carrying it |
|---|---:|
| `lcc_property_attributes.annual_rent` | 7,210 |
| `lcc_property_attributes.noi` | 6,002 (**gov only** — see below) |
| `lcc_entity_portfolio_facts.sale_price` | 2,352 |
| `…facts.cap_rate` | 1,321 |
| **no value signal of any kind** | **1,208** |

- ⚠️ **dia carries ZERO `noi`.** `noi_p50` is null for all 2,127 dia current facts; gov's NOI/rent ratio
  is **0.703** — the documented FS haircut (gov `CLAUDE.md` §12). So **the basis must be domain-aware**,
  and a single expression across both domains would be wrong for one of them.
- Observed in-band cap rates: **dia 0.0632** (n=96), **gov 0.0755** (n=727). Used as the domain fallback;
  a per-asset `cap_rate` is preferred where present and in band.

**The ladder shipped in this measurement:** gov `noi / cap` · dia `annual_rent / cap` (dia rent is net
NNN — dia `CLAUDE.md`: *"dia cap rate = net rent (NNN), not NOI"*) · gov-without-NOI
`annual_rent × 0.703 / cap` · else **`value_unknown`**.

| basis | rows | below band | **in band** | above band |
|---|---:|---:|---:|---:|
| `noi_div_cap` (gov) | 6,002 | 2,995 | 2,604 | 403 |
| `net_rent_div_cap` (dia) | 1,203 | 294 | 902 | 7 |
| `gross_rent_haircut_div_cap` (gov) | 45 | 17 | 23 | 5 |
| `value_unknown` | **1,608** | — | — | — |
| **total** | 8,858 | 3,306 | **3,529** | 415 |

**`value_unknown` is 1,608 rows (18.2%) and is its own state, never $0** (P180). It is 1,208 rows with no
signal at all plus 400 whose only signal is unusable for their domain.

### ⚠️ 2a. THE OBVIOUS VALIDATION IS CIRCULAR FOR 25% OF GOV, AND `p75 = 1.000` IS THE TELL

Validating the derivation against `facts.sale_price` first read gov p50 **0.975 / p75 exactly 1.000**.
An exact 1.000 quartile is the Class-11 implausibility signal, and it was real: **280 of 1,111 gov rows
have a ratio within 0.5% of 1, and 278 of those carry their own `cap_rate`.** The gov framework derives
`noi_at_event = sold_price × ingested_cap_rate` (§12), so dividing back is a tautology. **A validation
against a column your own input was derived from is not a validation.** Excluding every row carrying its
own cap rate:

| basis | n | p25 | p50 | p75 | within 2× |
|---|---:|---:|---:|---:|---:|
| dia `net_rent_div_cap` | 321 | 0.912 | **1.103** | 1.434 | 274 (85%) |
| gov `noi_div_cap` | 403 | **0.250** | 0.763 | 1.148 | 222 (55%) |

### ⚠️ 2b. THE GOV "FAILURE" IS THE SALE-PRICE SIDE — SO `sale_price` MUST NOT BE THE BAND VALUE

gov's fat left tail is a **portfolio trade price attributed to each property individually**. Split by how
many properties share one price, the result is monotone:

| properties sharing the price | n | ratio p50 | within 2× |
|---|---:|---:|---:|
| 1 (unique price) | 203 | **0.949** | 67% |
| 2–4 | 153 | 0.584 | 48% |
| 5+ | 47 | **0.164** | 26% |

On the clean subset the derived value is **essentially unbiased (0.949)**. The estimate was never the
problem. **Consequence: computing the $2.5M–$25M band off `sale_price` — the literal reading of "the
individual property sale price" — would overstate per-property value by the portfolio multiple and admit
large portfolio assets as if they were band deals.** The derived NOI÷cap is the more faithful measure of
the doctrine's intent.

---

## 3. G2 — the band

3,529 rows / 2,797 owners / 3,092 properties in band; 3,306 below, 415 above, 1,608 unknown. The band is
**not** the binding gate.

---

## 4. G3 — newer lease: 3,529 → 259. THE DOMINANT CUT, AND IT IS A MIRROR GAP

### 🚨 4a. `lcc_property_attributes` HOLDS NO LEASE DATES FOR dia AT ALL

All **2,127** dia current facts read NULL for `lease_commencement`, `lease_expiration`,
`firm_term_remaining` **and** `term_remaining`. The gate the doctrine defines most precisely — Fresenius
and DaVita's 15-year standard — is **structurally uncomputable for dia from the mirror the queue reads.**

**It is a mirror gap, not absent data**, and that distinction is load-bearing. Tracing to source:

> 🔴 **CLOSED 2026-09-03 (UX-T1a-gates).** dia's `v_property_attributes_portfolio` — the mirror's
> source — never carried lease columns at all, while gov's always did; the break was the SOURCE
> VIEW, not the tick and not the apply function. Now mirrored: **1,747** properties, not the 1,940
> below (that figure counts 1,986 **superseded** leases). ⚠️ The §4b sub-counts also move once
> superseded rows are excluded: within-first-3-years **134** (not 71), ≥12 yrs remaining **30**
> (not 33). `initial_term_years` p50 **14.9** over live-lease properties confirms Scott's 15 years.


- dia `properties.lease_commencement` — 710 of 11,802 (6%); `wavg_lease_expiration` and
  `wavg_firm_term_expiration` are **NULL on all 11,802**. The columns exist and are empty.
- dia **`leases`** is where the data lives: 12,832 rows, 9,027 with an expiry, **3,823 future-dated
  across 1,940 distinct properties**, 10,654 with a start date.

**So dia's newer-lease gate is computable — from `leases`, which nothing mirrors.**

### 4b. The dia standard term, measured — Scott's 15 years confirmed

Across all 1,940 properties with a live lease: initial term **p50 15.0 / p90 21.0**. Scott's stated
15-year new-build standard is empirically the fleet standard.

| dia newer-lease definition | properties |
|---|---:|
| ≥12 years remaining (§0b.1 new-build rule) | **33** |
| ≥10 years remaining | 135 |
| ≥7 years remaining (retrofit rule) | 386 |
| **within first 3 years of initial term** (§0b.1 primary wording) | **71** |
| median years remaining | **4.0** |
| union of the two adopted definitions (used here) | **86** |

### ⚠️ 4c. THE LANE SHAPE HAS NO RECORDED FACT, AND THE OBVIOUS PROXY DOES NOT DISCRIMINATE

§0b.1 splits dia into new-build (15 yr) and retrofit/backfill (7–12 yr). **dia `properties` has no
`is_build_to_suit` column** — that is gov-only. The available proxy is `year_built` vs `lease_start`, and
measured it **fails**: median initial term reads **15.0 years in all three buckets**, including the ones
the proxy calls "retrofit".

So the proxy separates *"year_built is close to lease start"* from *"it isn't"*, which is not the same
question. Per doctrine (recorded facts, no invented classifier) **the uniform measured 15-year standard
is applied and the shape is reported as `lane_shape_unknown`** rather than dressing the proxy up as a
finding. Splitting dia by lane shape needs a recorded BTS fact that does not exist.

### 4d. gov — firm term is the operative measure, and gov leases are old

6,249 distinct gov properties in the universe:

| | properties |
|---|---:|
| has `lease_commencement` | 5,512 |
| **median years elapsed since commencement** | **10.3** |
| **within 3 years of commencement (newer)** | **415** |
| within 2 years | 106 |
| `firm_term_remaining > 0` | 2,046 (p50 **4.1** yrs) |
| firm term ≥ 5 yrs remaining | 888 |
| firm term ≥ 8 yrs remaining | 459 |
| **lease already expired (holdover)** | **1,642** |
| term unknown (no commencement, no firm term) | 571 |

Combined G3 population ≈ **501 properties** (gov 415 + dia 86) before the band gate; **259 rows / 222
properties** after it.

**`term_unknown` is 571 gov + 2,127 dia = 2,698 rows** — a coverage bucket, not a disqualification, and
it must be a named state rather than folded into "not newer".

---

## 5. G4 — a reason to sell: 259 → 31. THE STRONGEST D IS ENTIRELY UNREACHABLE

Coverage of the four D's over the 6,480-owner universe:

| D | signal | owners | status |
|---|---|---:|---|
| **Debt** | loan/CMBS maturity ≤24 mo | **0 in LCC** | 🚨 §5a — **no loan table exists in LCC** |
| **Death** | recorded `entity_type = 'person'` | 161 | recorded fact, but ⚠️ §5b |
| Death | trust/estate in the name | 265 → **154** | ⚠️ §5c — 42% false positive |
| **Divorce** | DST/TIC/LP/fund/partnership in the name | 305 | new regex, ungraded |
| Divorce | `lcc_is_spe_shell_name` | 150 | existing guard |
| **Value creation** | `developer` role (`v_lcc_entity_roles`) | **259** | ✅ recorded, discriminating |

`investor_owner` covers **6,447 of 6,480** and discriminates nothing. `repeat_buyer` 167,
`one_off_owner` 142, `buyer` 112, `user_owner` 10, `operator` 9.

### 🚨 5a. THE DEBT SIGNAL EXISTS, IS SIZED, AND IS INVISIBLE TO LCC — TWICE OVER

**LCC Opps holds no `loans`, `lenders`, `cmbs_loans` or maturity table of any kind.** At source:

> 🔴 **CLOSED 2026-09-03 (UX-T1a-gates), AND THE FRAMING BELOW IS CORRECTED.** `lcc_loan_maturity`
> now mirrors both domains (568 rows) and `v_lcc_bd_worklist` emits **172** `loan_maturity` rows /
> 109 owners / 122 properties. ⚠️ **But "these were never implemented" is wrong about the
> HANDLER** — `assembleBdWorklist` has always read the domains' `v_loan_maturity_watch` (gov 178 /
> dia 72). The claim is true only of the VIEW. The real gap was owner attribution: the fan-out
> emits `entity_id: null`. ⚠️ Also: 192 *loans* is **172 rows / 109 owners / 122 properties** —
> say which grain.


| domain | loan rows | with maturity | **maturing ≤24 mo** | properties |
|---|---:|---:|---:|---:|
| gov | 1,559 | 413 | **170** | 780 |
| dia | 660 | 155 | **22** | 424 |
| dia `cmbs_loans` | 234 | 10 | 0 | — |
| gov `cmbs_loans` | 76 | 0 | 0 | 65 |

**192 loans maturing inside 24 months across ~1,204 loan-bearing properties**, and dia even ships
`v_loan_maturity_watch` (72 properties). None of it reaches LCC.

**And the surface already has a slot for it.** `app.js:renderTodayBdActions` labels five signal types —
`loan_maturity` ("Loan maturity"), `suspected_sale`, `owner_source_conflict`, `contact_writeback`,
`ownership_chain`. Live, `v_lcc_bd_worklist` emits **only two**:

| signal_type | rows | owners |
|---|---:|---:|
| `ownership_chain` | 3,534 | 2,555 |
| `contact_writeback` | 1,646 | 1,646 |
| `loan_maturity` / `suspected_sale` / `owner_source_conflict` | **0** | **0** |

The view's definition is 1,134 characters and **does not mention `loan`, `suspected_sale` or
`owner_source_conflict` at all** — positive-controlled: the same detector returns `true` for
`ownership_chain` and `contact_writeback`. **These are not dead branches; they were never implemented.**
A consumer wired to a producer that does not exist (P137), on the home page, for the highest-value D.

### ⚠️ 5b. `entity_type = 'person'` IS A RECORDED FACT AND IS WRONG IN BOTH DIRECTIONS

C13c measured this already. It reproduced immediately in the strict 23: **`UIRC`** and
**`Gardner-Tanenbaum`** are both typed `person` and are both companies documented by name in P198.
36 of the 161 person-typed owners fail `lcc_looks_like_person`. Using person-typing as the death signal
imports that defect wholesale.

### ⚠️ 5c. MY OWN MEASUREMENT REGEX FALSE-POSITIVED ON FIRST CONTACT — 42%

The trust/estate arm matched **265** owners. **111 of them (42%) match on the phrase "REAL ESTATE"**,
because `\mestate\M` matches the second word. Three of the strict 23 rows are this exact defect:
`TAGHKANIC REAL ESTATE HOLDINGS I LLC`, `RGA REAL ESTATE HOLDINGS LLC`,
`Commercial Real Estate Acquisitions, LLC`. Excluding the phrase leaves 154.

**This is the concrete vindication of the prompt's "no new name regex" rule** — a regex written for
measurement, by an author who had read the warning, produced a 42% false-positive class inside one query.
It is reported for sizing and **must not decide a write** without the grading this repo demands of every
lexical gate (P189/A3/P196/P198 measured comparable arms at 25%, 7%, 4-of-6).

---

## 6. G5 — not yet reached: 31 → 23

§0b.4: never attempted a touchpoint **or** not in the BD pipeline at all; **any team member's touch counts.**

### ⚠️ 6a. THE OWNER-ONLY COUNT IS WRONG, AND THE OBVIOUS FIX IS WRONG IN THE OTHER DIRECTION

| definition of "reached" | owners |
|---|---:|
| an `activity_events` row on the owner entity itself | **19** |
| owners with any linked entity | 1,742 |
| …reached via **any** linked entity | 1,024 |
| owners with a linked **person** | 847 |
| **…reached via a linked person (correct)** | **34** |
| reached by any definition (direct ∪ person-link ∪ cadence ∪ open opp) | **618** |
| **NOT reached** | **5,862 (90.5%)** |

Two corrections, in opposite directions:

1. **19 is a false floor.** Touches land on the *person*, not the owner (C11/P188). Counting only the
   owner entity marks every owner whose contact we email as a virgin prospect.
2. **1,024 was a false ceiling — and it is the trap worth recording.** Following *any* link imports
   **asset**-entity events, and asset events are overwhelmingly machine-written: `rca_deed_record` 4,687,
   `intake_om` 4,164, `copilot_action` 3,547, `costar_deed_record` 2,370. Constraining to person links
   takes it **1,024 → 34**: ~990 owners were "reached" only through a system event on a building.

**Reach is a category question as well as an entity-type question.** Person events are genuine
correspondence — Outlook email 23,450 across 179 people, plus Salesforce email/meeting/call and Webex —
and only 2 of 24,139 are `system`. The predicate used here is `category IN ('email','call','meeting')`.

**The binding constraint is not missing touches — it is missing links.** 847 of 6,480 owners have a
linked person at all; 254 people carry correspondence. That is C11's finding restated: *the names exist,
the links do not.*

---

## 7. The surface today, against the doctrine

### 7a. `v_priority_queue` — 58% is not seller prospecting

| band | reason | rows | owners | doctrine reading |
|---|---|---:|---:|---|
| P0.4 | `resolve_ownership_control` | 555 | 555 | 🔧 research/automation |
| P-CONTACT | `select_prospecting_contact` | 231 | 231 | 🔧 Tier 0 / auto-attach |
| P8 | `agency_active_solicitations` | 213 | 118 | ✅ seller timing |
| P3 | `ten_year_window` | 166 | 128 | ✅ seller timing |
| P0.5 | `open_bd_opportunity_needed` | 148 | 148 | 🔧 CRM hygiene |
| P1 | `lease_expiry_24mo` | 147 | 100 | ✅ seller timing |
| P2 | `firm_term_ending_24mo` | 95 | 63 | ✅ seller timing |
| P5 | `aged_building_value_add` | 59 | 37 | ✅ seller timing |
| P-BUYER | `repeat_buyer_relationship` | 22 | 22 | 🔧 buyer — §0.3 says show deals |
| P4 | `recent_acquisition_streak` | 14 | 14 | ✅ seller timing |
| | **total** | **1,650** | | |

**956 of 1,650 rows (58%)** are automation, CRM plumbing or buyer work — measuring UX3/UX5/UX7 exactly.
Seller-timing bands are 694 (42%).

### 🚨 7b. THE EXISTING TIMING BANDS SELECT THE OPPOSITE OF "NEWER LEASE"

P1 `lease_expiry_24mo`, P2 `firm_term_ending_24mo` and P3 `ten_year_window` all select assets **late** in
their term. The doctrine's sweet spot is a lease in its **first 2–3 years**. These are near-disjoint
populations, and the overlap was measured:

| | rows |
|---|---:|
| doctrine population (in band + newer lease) | **259** |
| of those, owner appears anywhere in `v_priority_queue` | 54 |
| **of those, the exact (owner, asset) is in the queue** | **27 (10.4%)** |
| **absent from the queue entirely** | **232 (89.6%)** |

**The queue is not mis-ranked relative to the doctrine; it is largely about different assets.** This is
the single number that justifies Part B being a new view rather than a re-rank of the old one.

> 🔴 **QUALIFIED 2026-09-03 by UX-T1a-queue. The 27 reproduces exactly (27 of 285 in-band
> newer-lease rows), and the disjointness claim is TRUE OF THIS POPULATION ONLY.** Measured over
> the shipped variant-F queue, **181 of 520 (34.8%)** exact (owner, asset) pairs ARE in
> `v_priority_queue` — because the reason-to-sell half is dominated by maturing loans, which
> usually sit on a LATE-term lease, exactly what P1/P2/P3 select. **Quote 89.6% for the
> newer-lease population, never for variant F.** Consequence: the seller queue ships BESIDE the
> band queue rather than replacing it.

Note also that one asset can emit two rows for two owners — `pid 250` appears in the strict 23 twice
(`Gardner-Tanenbaum` and `Tep Pt. Huron, LLC`), which is the OWN-T0 sponsor↔SPE class (756 properties
with >1 current owner). Row / asset / owner counts are three different numbers here, as C6 §3 warned.

### 7c. Cadence — 67 days against a 6-month doctrine, and role is not an input

`PROSPECTING_SEQUENCE` (`api/_shared/cadence-engine.js`) sums to **67 days** for 7 touches
(0+10+15+10+12+10+10). §0b.4 asks for **7 touches in the first 6 months** (~180 days, ~26-day mean).
The sequence is **~2.7× too fast**.

Observed state of `touchpoint_cadence` (2,307 rows):

| | value |
|---|---:|
| rows | 2,307 |
| **never touched** | **2,123 (92%)** |
| ever touched | 184 |
| `phase = 'prospecting'` | 296 |
| **overdue** | **2,276 (98.7%)** |
| median configured gap (`next_due − last_touch`) | **28 days** |
| median days since last touch | 54 |
| reached touch 7 | 34 |
| emails / calls / meetings recorded | 18,480 / 74 / 12 |

- **The observed 28-day gap is close to the doctrine's ~26**, despite the 67-day sequence, because Tier C
  doubles spacing and post-sequence rows fall to a 90-day quarterly. **Quote both numbers: the sequence
  constant is 67 days; the realised spacing is 28.**
- ⚠️ **`current_touch` has a p50 of 0 and a max of 8,198.** A 7-step sequence cannot reach 8,198 — the
  counter is being advanced by something other than sequence position, so it cannot be read as
  "where are we in the cadence".
- **Tier is effectively all B** (41 rows tier A, 2 tier C), so `TIER_MULTIPLIERS` is inert in practice.
- **Role is not an input to spacing at all.** By role: `investor_owner` 583 cadences (9 ever touched),
  `repeat_buyer` 60, `one_off_owner` 58, `developer` 44 (**0 ever touched**), `former_owner` 20 — and
  **1,663 cadences sit on entities with no role at all** (they are keyed to contacts, not owners).
  §0b.4's role-differentiated steady state (developer ≈ monthly, investor ≈ quarterly, one-off ≈ 1–2/yr)
  has **no implementation**.
  ⚠️ `v_lcc_entity_roles` is multi-label (C13b), so that join fans out and the role rows sum above 2,307.

### 7d. Today — the home BD tile serves 100% plumbing

> 🔴 **CORRECTED 2026-09-03 (UX-T1a-gates): the renderer reads the HANDLER, not the view, and the
> handler already produced `loan_maturity` from the domains' `v_loan_maturity_watch`. The tile was
> not 100% plumbing.** The view's two arms are as described; the third BD-meaningful signal was
> reaching the tile without an owner attached.

`renderTodayBdActions` reads `/api/operations?action=bd_worklist&limit=5` → `v_lcc_bd_worklist`, which
emits only `ownership_chain` (3,534 — applied automatically by A2/cron 244) and `contact_writeback`
(1,646 — labelled "Push to CRM", which C1 established already has an automated consumer,
`sf_link_candidate`). **Neither earns a human under §0.2.** The three BD-meaningful signal types are
labelled in the renderer and never produced (§5a).

---

## 8. Why Part B was not built in this round

The prompt's own rule: *"If any gate cannot be computed from data we hold, name it as a coverage gap and
stop at that gate."* Two gates qualify, and shipping a view anyway would encode measured-bad predicates
into the surface the operator is meant to trust:

1. **G3 for dia** needs `leases` (3,823 live leases / 1,940 properties) mirrored into
   `lcc_property_attributes`. Until then a dia asset can only ever read `term_unknown`, and a view
   claiming to implement §0b.1 would silently exclude the whole dia swimlane.
2. **G4's debt arm** — the strongest D, 192 loans maturing inside 24 months — ~~has no LCC table and no
   producer behind the `loan_maturity` slot that already exists on the home page.~~
   ⚠️ **SUPERSEDED 2026-09-03 (UX-T1a-gates, re-verified by PR5d): `lcc_loan_maturity` holds 568 rows
   carrying exactly these 192, and `v_lcc_bd_worklist` emits 172 owner-attributed `loan_maturity` rows.**
   The maturity half of G4 is closed. What remains open is DISTRESS (watchlist / delinquency / DSCR),
   which reads 0 across all 285 gov CMBS loans because its only capture arm has never fired
   (`PR5d_COSTAR_CMBS_LOAN_ARM_2026-09-03.md`). Its death and divorce
   arms are only reachable through new lexical rules, one of which **measured 42% false-positive** (§5c)
   and the other of which is ungraded. Encoding those as a `reason_to_sell` column would ship exactly the
   class of gate this repo has refused four times (P189 25%, P198 7%, A3, P196).

**What is safe to build, and is the recommended Part B:**

- `v_lcc_seller_prospect_queue` over the spine with the gates as **named columns** —
  `in_band` · `value_basis` · `newer_lease` + `newer_lease_basis` · `reach_state` — with
  **`value_unknown` and `term_unknown` as first-class states**, and `reason_to_sell` restricted to the
  one **recorded** signal (`developer` role, 259 owners) plus an explicit
  `reason_to_sell_unmeasured` state. Rank on client value, then lease recency.
- **Variant F** as the operator population (592 rows / 495 owners) — the two signals as alternatives, not
  both-required, which is faithful to §0.3 and is the only variant with a workable size.
- Today split **Significant / Important / Urgent** (§0b.5), showing only what is due today, each section's
  count equal to the rows it renders.
- Move P0.4 / P-CONTACT / P0.5 / P-BUYER off the human surface (hide, do not delete — they have
  automated consumers).
- Cadence: **propose only.** Re-spacing to ~26-day means and a role-based steady state is a change to
  `advanceCadence`, the single advance owner, and deserves its own reversible round (UX-T1a-cadence).
  It also cannot be graded until `current_touch` is trustworthy (§7c).

**Sequenced backlog rows this measurement earns:**

| id | what | why it is first |
|---|---|---|
| ~~**UX-T1a-mirror-dia-lease**~~ ✅ **SHIPPED 2026-09-03** | mirror dia `leases` → `lcc_property_attributes` | 0 → 1,747 properties; dia `term_unknown` 2,127 → 1,252 |
| ~~**UX-T1a-debt**~~ ✅ **SHIPPED 2026-09-03** | produce `loan_maturity` into `v_lcc_bd_worklist` | 0 → 172 rows / 109 owners, owner-attributed (the domain fan-out was not) |
| ~~**UX-T1a-queue**~~ ✅ **SHIPPED 2026-09-03** | `v_lcc_seller_prospect_queue` (variant F) | **520 rows / 453 owners / 466 properties** (gov 405 / dia 115). Record: `docs/claude-code/responses/done/UX-T1a-queue.response.md` |
| **UX-T1a-today** | Significant / Important / Urgent split | depends on the queue |
| **UX-T1a-cadence** | 6-month spacing + role steady state | needs `current_touch` fixed first |
| **UX-T1a-touchcount** | `current_touch` max 8,198 | a cadence position nobody can read |

---

## 9. Verification for whoever picks this up

- **Every number here is a live measurement, not a plan.** Re-derive rather than quote — C6 §2 measured
  ordinary day-to-day drift in these very bands.
- **Say which grain you are quoting.** Rows ≠ assets ≠ owners: the funnel's last step is 23 / 22 / 23,
  and 756 properties carry more than one current owner.
- **Do not re-validate the value ladder against `facts.sale_price` without excluding rows that carry
  their own `cap_rate`** (§2a) — the answer is circular and reads as a clean 1.000.
- **Do not quote `sale_price` as per-property value for gov** (§2b) — it carries portfolio trades.
- **Read `reach_state` through the person link, and only human categories** (§6a) — the owner-only count
  is 19 and the any-link count is 1,024; both are wrong.
