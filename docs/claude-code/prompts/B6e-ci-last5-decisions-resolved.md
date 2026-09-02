# B6e-ci-last5 — both decisions resolved on measurement. Land them, then unmask.

**Repo: `Dialysis`.** Reads against **Dialysis_DB `zqzrriwuavgrquhisnoa`**. No LCC changes.

**Read first:** `docs/architecture/producer-health-and-ci-enforcement.md` §3 in `life-command-center`.

## Where this stands

`0 executed → 3,128 → 3,132`; `55 fail → 14 → 5`, with `executed` going **up** at every step.
**5 remain, and they were the two groups nobody should guess at.** Scott's direction, verbatim:

> *"Our overall objective is to get the most accurate determination possible… We don't want to lose
> valuable information but we want connected and clean and accurate data and want it to eventually
> get cleaned and updated completely."*

**Both were measured against the live database rather than decided by opinion. The answers are
below. Implement them.**

---

## Decision 1 — `test_financial_ground_truth` (3): keep BOTH constants; the real defect is elsewhere

**Measured on `clinic_econ_reconciled` (`model_version_id = 21`, computed 2026-09-01):**

| FY | rows | avg blended rate | avg rev/tx | avg medicare % |
|---:|---:|---:|---:|---:|
| 2021 | 6,510 | 375.44 | 380.27 | 35.04 |
| 2022 | 6,611 | 374.97 | 379.89 | 35.16 |
| 2023 | 6,700 | 374.27 | 379.25 | 35.31 |
| 2024 | 6,754 | 373.24 | 378.34 | 35.71 |
| **2025** | **61** | 377.58 | 384.57 | 40.47 |
| **2026** | **724** | **297.87** | 313.36 | **73.66** |

**The blended rate is essentially FLAT 2021→2024 — 375.44 → 373.24, a −0.6% drift over four
years — and the movement that exists is PAYER MIX, not rate** (medicare 35.04% → 35.71%).

### The verdict

1. ✅ **`RATES_2025` and `CMS_2023_RATES` holding identical values is DEFENSIBLE on the current
   data.** The rates genuinely have not moved materially between those vintages.
2. ⚠️ **But keep them as TWO NAMED CONSTANTS.** Collapsing them to one costs nothing today and
   **permanently destroys the ability to express a divergence** the moment CMS does move. That is
   Scott's *"don't lose valuable information"* applied to a constant instead of a row. **If they are
   currently one constant with two names, leave it that way and comment WHY they are equal — do not
   merge them.**
3. ✅ **The test-side one-liners are safe on the evidence** — the code sits within **0.3%** of the
   reconciled model while the test is **12.5% high**. `DEFAULT_PATIENTS` 79 → 72 and the
   2-payer/4-payer reconstruction: land them.

### 🚨 And the finding that outranks the question as asked

**FY2025 has 61 rows and FY2026 has 724, against ~6,700/yr for 2021–2024 — and FY2026's payer mix is
73.66% Medicare against a ~35% historical baseline.** Those are **not rate vintages. They are thin,
unrepresentative partial-year populations with a different composition.**

- ⚠️ **A ground-truth test calibrated against FY2025/2026 is calibrating on noise.** State which
  fiscal-year population each assertion covers, and **assert over 2021–2024 unless there is a stated
  reason not to**.
- **Report whether any current assertion silently spans all years** — an average over
  `fiscal_year >= 2021` is dominated by the dense years but *shifts* as the thin ones fill, which
  makes the test drift on its own with no code change.
- Say plainly whether FY2026's 73.66% Medicare is **real** (a genuine mix shift in the partial year)
  or an **ingestion artifact**. Do not assume; if it cannot be settled here, file it.

---

## Decision 2 — `test_listing_broker_update` (2): keep BOTH columns; resolve name → id in tiers

**Measured on `dia.sales_transactions` (4,783 rows):**

| | count |
|---|---:|
| broker **name** set | 2,111 |
| broker **id** set | 181 |
| **name set, id NULL** | **1,930** |
| **id set, name NULL** | **0** |
| distinct unresolved names | **528** |

🎯 **`id_set_name_null = 0` settles the design question.** On all 181 rows that already carry an id,
**the name was kept too.** The intended pattern is **BOTH columns**, and it simply stopped being
applied — so *"don't lose valuable information"* is not a new requirement here, it is the existing
design being restored.

### The verdict

1. ✅ **Ship the fix as proposed: move the broker-name normalisation into `update_field`**, which
   keeps the identity alias protecting every other caller. `available_listing_ingestor.py`'s guard
   against a name landing in the `_id` column stays intact and must be verified still firing.
2. ✅ **Never overwrite a populated `listing_broker_id`, and never clear `listing_broker`.**
   Fill-blanks only, both directions.
3. **Then resolve the 528 in TIERS, deterministic first** — the FK target `brokers` exists and holds
   **2,425 rows**:
   - **Tier 1 — exact case-insensitive `broker_name`: 422 of 528 (80%).** Deterministic, no fuzzy
     matching, no identity guessing. **This is the whole high-yield core.**
   - **Tier 2 — `normalized_name` (373) and `company` (209)**, applied only to what Tier 1 missed,
     and **only where unambiguous** (exactly one broker matches).
   - **Tier 3 — everything else goes to a REVIEW LANE, never an automatic match.**
4. ⚠️ **The residue is not noise, and its shape argues against ever fuzzy-matching it.** The
   unmatched sample: `Avison Young; Barnes` and `AY; Barnes` (**multi-broker co-listings, plus an
   abbreviation**), `Anthony Falcone` and `Babcock` (individuals / partial names), and
   `4802 D Dialysis, LLC` (**a property name misparsed into the broker slot**). A fuzzy matcher
   would confidently attach the wrong firm to several of these. **This is the `dup-pair-planner`
   lesson: grouping-for-review ≠ identity-for-write.**
5. **A multi-broker string is a real fact, not a defect** — record that it is one, do not pick one
   half of it.

**Verify on:** `name_set_id_null` falling from 1,930, `id_set_name_null` **staying 0**, and no
existing `listing_broker_id` changing. ⚠️ **Read the row delta, not the matcher's tally.**

---

## Then, and only then: the unmask

With the 5 cleared, remove the `|| echo` from the pytest line — **one line, and prove it green on
`main` before it counts**, exactly as the import check was. `pip-audit` and the secrets grep queue
behind it, one at a time.

⚠️ **A green check on your PR still means nothing until that lands** — the job reports success at 5
red or 55 red. **Read collected / executed / passed / failed out of the job log**, and `executed`
must not fall below **3,132**.

## Also in scope if cheap: `B6e-worktree-gitlinks`

Three `.claude/worktrees/*` gitlinks are committed with **no `.gitmodules`**, putting
`/usr/bin/git failed with exit code 128` in **every** CI job log (pre-existing, `325aca3`). ⚠️ **A
warning that appears in every log is one people stop reading** — that is the cost. Remove the
gitlinks or add the missing `.gitmodules`.

## Report back

The three-way comparison you land on for the rate constants and whether any assertion spans all
fiscal years; the FY2026 payer-mix verdict; `name_set_id_null` before/after with the tier split;
whether the unmask went green on `main`; `executed` throughout; and anything the sweep turns up that
outranks the task.
