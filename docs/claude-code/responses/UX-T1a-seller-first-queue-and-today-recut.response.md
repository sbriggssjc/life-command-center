# UX-T1a — Part A measured; Part B deliberately NOT built (and why)

**Full evidence: [`docs/audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md`](../../audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md).**
Measured 2026-09-03 against LCC Opps `xengecqvemvfknjvbvrq`, gov `scknotsqkcheojiaewwh`, dia
`zqzrriwuavgrquhisnoa`. **Nothing was written — no migration, no view, no JS, no cadence change.**

## Part A — the funnel

| step | rows | owners | properties |
|---|---:|---:|---:|
| **G1** universe — current holdings (`is_current`) | 8,858 | 6,480 | 8,068 |
| **G2** + individual value $2.5M–$25M | 3,529 | 2,797 | 3,092 |
| **G3** + newer lease | **259** | 237 | 222 |
| **G4** + a reason to sell | **31** | 26 | 29 |
| **G5** + not yet reached | **23** | **23** | **22** |

**It is under 50 and here is which gate did it: G3 cuts 93%, G4 cuts 88%.** Neither is the doctrine being
demanding — both are coverage gaps. Sensitivity: drop G4 → 205 · drop G3 → 410 · **(G3 OR G4) + G5 → 592
rows / 495 owners** (variant F, the recommended population). The 8,068 reproduces OWN-T0's independently
measured property count exactly.

## The five findings that matter

1. **🚨 The existing queue is 89.6% disjoint from the doctrine's population.** Of the 259 in-band
   newer-lease assets, **27** appear in `v_priority_queue` at the (owner, asset) grain; **232 are absent
   entirely.** Cause: P1 `lease_expiry_24mo`, P2 `firm_term_ending_24mo` and P3 `ten_year_window` select
   assets **late** in term, while the doctrine's sweet spot is the **first 2–3 years**. This is the number
   that makes Part B a new view rather than a re-rank. Separately, **956 of 1,650 queue rows (58%)** are
   automation, CRM plumbing or buyer work (UX3/UX5/UX7, measured).

2. **🚨 `lcc_property_attributes` holds no lease dates for dia at all** — all 2,127 dia current facts read
   NULL for commencement, expiration, firm term and term remaining. It is a **mirror gap, not absent
   data**: dia `leases` holds **3,823 future-dated leases across 1,940 properties**. Measured there, the
   initial term is **p50 15.0 / p90 21.0 — Scott's 15-year standard confirmed empirically** — but only
   **33** properties have 12+ years remaining and **71** are within the first 3 years of term
   (median remaining **4.0 years**). ⚠️ The BTS-vs-retrofit lane shape has **no recorded fact** (no
   `is_build_to_suit` on dia) and the `year_built`-vs-`lease_start` proxy **does not discriminate** —
   median initial term reads 15.0 in every bucket — so the uniform standard was applied and the shape
   reported unknown rather than inventing a classifier.

3. **🚨 The strongest reason-to-sell is sized, exists, and is invisible to LCC — twice.** LCC holds no
   loan/CMBS table; at source there are **192 loans maturing inside 24 months** (gov 170, dia 22) across
   ~1,204 loan-bearing properties, and dia even ships `v_loan_maturity_watch`. **And the home page already
   has the slot:** `renderTodayBdActions` labels `loan_maturity`, `suspected_sale` and
   `owner_source_conflict`, but `v_lcc_bd_worklist` emits **only** `ownership_chain` (3,534) and
   `contact_writeback` (1,646) — its definition never mentions the other three (positive-controlled). Not
   dead branches: never implemented. So **the Today BD tile serves 100% automation/plumbing**, both of
   whose lanes already have automated consumers (A2/cron 244; C1's `sf_link_candidate`).

4. **⚠️ My own measurement regex false-positived on first contact — 42%.** The trust/estate arm matched 265
   owners; **111 match on the phrase "REAL ESTATE"**. Three of the strict 23 rows are exactly that
   (`TAGHKANIC REAL ESTATE HOLDINGS I LLC`, `RGA REAL ESTATE HOLDINGS LLC`, `Commercial Real Estate
   Acquisitions, LLC`). Written by an author who had read the warning. Also `UIRC` and
   `Gardner-Tanenbaum` — both companies named in P198 — are typed `person` and so read as a death signal
   (C13c reproducing). Reported for sizing; **must not decide a write.**

5. **⚠️ "Reached" is wrong in both directions, and the obvious fix is the worse one.** Owner-entity only =
   **19** owners (a false floor — touches land on the person, C11/P188). Following *any* link = **1,024**
   (a false ceiling — it imports machine-written **asset** events: `rca_deed_record` 4,687, `intake_om`
   4,164, `copilot_action` 3,547). Person links plus human categories only = **34**. Reached by any
   definition **618**; **not reached 5,862 (90.5%)**. The binding constraint is not missing touches but
   missing links — 847 of 6,480 owners have a linked person at all.

## Value basis — chosen by measurement, and one validation was circular

dia carries **zero `noi`** (gov-only) and gov's NOI/rent ratio is **0.703** (the FS haircut), so the basis
is domain-aware: gov `noi/cap`, dia `annual_rent/cap` (dia rent is net NNN), gov-without-NOI
`rent × 0.703/cap`, else **`value_unknown` — 1,608 rows (18.2%), a state, never $0.**

⚠️ Validating against `facts.sale_price` first read gov **p75 = exactly 1.000**. Real: **280 of 1,111 rows
have a ratio within 0.5% of 1 and 278 carry their own `cap_rate`** — the gov framework derives
`noi = price × cap` (§12), so dividing back is a tautology. Excluding those, dia tracks trades at p50
**1.103** (85% within 2×) and gov at **0.763 with p25 0.250**. ⚠️ That gov tail is the **sale-price** side:
split by how many properties share one price, ratio p50 runs **0.949 (unique) → 0.584 (2–4) → 0.164 (5+)**
— portfolio trades attributed per property. **So `sale_price` must not be the band value for gov**, even
though "individual property sale price" reads like it should be.

## Cadence — 67 days vs 6 months, and role is not an input

`PROSPECTING_SEQUENCE` sums to **67 days** for 7 touches against the doctrine's ~180 (**2.7× too fast**),
but the **realised** median gap is **28 days** (Tier C doubling + a 90-day quarterly fallback) — close to
the doctrine's ~26. **Quote both.** State of `touchpoint_cadence`: 2,307 rows, **92% never touched**,
**98.7% overdue**, 34 reached touch 7. ⚠️ **`current_touch` has p50 0 and max 8,198** — a 7-step sequence
cannot reach that, so cadence position is unreadable. Tier is effectively all B (41 A, 2 C), so
`TIER_MULTIPLIERS` is inert, and **role is not an input to spacing at all** (`developer` 44 cadences, **0
ever touched**; 1,663 cadences sit on entities with no role, keyed to contacts not owners).
§0b.4's role-differentiated steady state has no implementation.

## Why Part B was not built

Per the prompt's own rule — *name it as a coverage gap and stop at that gate*. Building the view now would
encode a 42%-false-positive predicate and a dia-blind term gate into the surface the operator is meant to
trust, which is the class of gate this repo has refused four times (P189 25%, P198 7%, A3, P196).

**Sequenced, and the first two make the queue's gates honest:**

| id | what |
|---|---|
| **UX-T1a-mirror-dia-lease** | mirror dia `leases` → `lcc_property_attributes` (unblocks G3 for the whole dia swimlane) |
| **UX-T1a-debt** | produce `loan_maturity` into `v_lcc_bd_worklist` from the 192 maturing loans (the slot exists) |
| **UX-T1a-queue** | `v_lcc_seller_prospect_queue`, variant F, gates as named columns, `value_unknown`/`term_unknown` first-class, `reason_to_sell` restricted to the recorded `developer` signal + `reason_to_sell_unmeasured` |
| **UX-T1a-today** | Significant / Important / Urgent, due-today only, honest counts |
| **UX-T1a-cadence** | 6-month spacing + role steady state — **propose only**; single advance owner, and ungradeable until `current_touch` is fixed |
| **UX-T1a-touchcount** | `current_touch` max 8,198 |

Also recommended and safe now: move P0.4 / P-CONTACT / P0.5 / P-BUYER off the human surface (hide, not
delete — they have automated consumers).

## Traps recorded for the next chat

- Do not re-validate the value ladder against `facts.sale_price` without excluding own-`cap_rate` rows.
- Do not quote `sale_price` as per-property gov value (portfolio trades).
- Read reach through the **person** link and human categories only.
- Say which grain you quote: rows ≠ assets ≠ owners (756 properties carry >1 current owner; `pid 250`
  appears twice in the strict 23 as a sponsor↔SPE pair).
- `v_lcc_entity_roles` is multi-label — joining it fans rows out.
- Re-derive every number; C6 §2 measured ordinary drift in these bands.
