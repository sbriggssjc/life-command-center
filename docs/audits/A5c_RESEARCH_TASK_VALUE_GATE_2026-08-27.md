# A5c — the research-task producer had no value gate

**Measured live 2026-08-27** against LCC Opps `xengecqvemvfknjvbvrq`, dia `zqzrriwuavgrquhisnoa`,
gov `scknotsqkcheojiaewwh`. Prior: `A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md` →
`A5a_AUTOCLOSE_TRUNCATION_FIX_2026-08-27.md`.

> ## The one-line result
>
> **The producer's pool is 71,448 rows and its actionable population is 2,530 — 3.5%.**
> The gate lives in each domain's `v_next_best_research` (`gate_pass` / `gate_reason` /
> `gate_value`) and the generator's **ranked mint head filters on it server-side**, so the head
> is drawn from the admitted population rather than filtered after the fact.
>
> **The membership probe deliberately does NOT share the filter.** It answers *does the gap still
> exist*, not *is it worth working* — and a probe that read the gated view would find every
> gated-out subject absent and close it as `gap_resolved`, which is the A5a defect returning in a
> disguise that looks like tidying up.

---

## 1. Why crons 34/35 were paused

A5a fixed the auto-close and, in doing so, showed what a **correct** producer emits:
`would_insert` = **1,000 gov + 1,586 dia = 2,586** on one `limit=2000` run, with cron 35 firing
every 30 minutes into a pool where **69,448 of 71,448 gaps had never had a task**. That is a
producer with no value gate.

Re-measured on this pool before building anything:

| fact | measured |
|---|---:|
| dia `true_owner_needs_salesforce` owners holding **zero** properties | **5,239 of 6,324 (83%)** |
| properties carried by operators + literal placeholders in that lane | **5,364 of 6,442 (83%)** |
| gov `owner_needs_salesforce` subjects holding zero properties | **7,690 of 13,724 (56%)** |

## 2. ⚠️ Every lane this producer feeds has ZERO real completions — and the lane everyone worries about is NOT one of them

The prompt's hard constraint was *do not starve `establish_ownership_history`*. It is
structurally impossible for this gate to touch it: that lane is fed by
**`v_lcc_ownership_chain_completeness`**, a different generator.

| producer | lane | open | real completions | real, 30d |
|---|---|---:|---:|---:|
| `v_lcc_ownership_chain_completeness` | `establish_ownership_history` | 156 | **314** | **314** |
| `v_lcc_ownership_chain_completeness` | `trace_ownership_to_developer` | 152 | **52** | 38 |
| **`v_next_best_research`** | `property_missing_recorded_owner` (both) | 1,185 | **0** | **0** |
| **`v_next_best_research`** | `true_owner_needs_salesforce` | 815 | **0** | **0** |
| **`v_next_best_research`** | `property_missing_true_owner` | 0 | **0** | **0** |

`real completions` counts `status='completed'` with an outcome that is **not** `gap_resolved`.
All **5,763** completions this producer has ever recorded are the A5a auto-close; **not one was
earned by a human, a worker or a verdict.** A5's warning applies in full — *check who writes a
terminal status before ranking lanes by it.*

## 3. The gate — measured effect, per lane, with exclusions named

**Fleet 71,448 → 2,530 admitted (3.5%).** Row counts are unchanged on both views (no join
fan-out): gov 41,805 → 41,805, dia 29,643 → 29,643.

### gov — 41,805 → 2,332

| lane | pool | **admitted** | excluded, by reason |
|---|---:|---:|---|
| `owner_needs_salesforce` | 13,724 | **1,675** | `owns_no_property` 7,690 · `below_value_floor` 3,487 · `value_unknown` 712 · `placeholder_owner` 160 · `public_body_not_prospected` 0 |
| `property_missing_recorded_owner` | 11,180 | **656** | `value_unknown` 7,814 · `below_value_floor` 2,710 |
| `property_missing_true_owner` | 28 | **1** | `value_unknown` 25 · `below_value_floor` 2 |
| `owner_needs_sos` | 16,873 | **0** | `lane_no_consumer` 16,873 |

### dia — 29,643 → 198

| lane | pool | **admitted** | excluded, by reason |
|---|---:|---:|---|
| `property_missing_county_record` | 9,761 | **109** | `value_unknown` 6,788 · `below_value_floor` 2,864 |
| `property_missing_recorded_owner` | 6,354 | **62** | `value_unknown` 4,487 · `below_value_floor` 1,805 |
| `true_owner_needs_salesforce` | 6,324 | **27** | `owns_no_property` 5,184 · `value_unknown` 661 · `below_value_floor` 259 · `merged_tombstone` 98 · `placeholder_owner` 61 · `operator_not_owner` 34 |
| `owner_needs_sos` | 7,204 | **0** | `lane_no_consumer` 7,204 |

**Value is per OWNER on the owner-keyed lanes.** gov `owner_needs_salesforce` is 1,675 rows over
**1,674 distinct recorded owners**, **$4.01B** of gov rent. dia `true_owner_needs_salesforce` is
**27 owners / $21.7M**. The property lanes are per property and are reported as such — blending
them would be the documented 2×/4.65× overstatement.

**⚠️ A5's "963 real prospectable owners" is not the admitted count and must not be quoted as one.**
963 was *owns ≥1 property and is not an operator/placeholder* — a **decidability** figure with no
value floor. Applying the floor takes it to 27. Both numbers are correct about different questions.

## 4. The four decisions, and why each is what it is

### 4a. Operators are excluded by RECORDED FACT, never by a name test

P113 is explicit: *never write a second name-based operator test, or the two definitions drift and
the panel and the feeder disagree.* The gate reads three recorded facts on `dia.true_owners` —
`is_operator_not_owner`, `owner_type='operator'`, `owner_role='operator'`.

| signal | owners caught | properties |
|---|---:|---:|
| `is_operator_not_owner` alone | 25 | 4,343 |
| **all three** | **36** | **4,479** |

The extra 11 are real: **Kaiser Permanente, Mayo Clinic Dialysis, Atlantis Healthcare Group, Wake
Forest University, Centers for Dialysis Care** — operators the boolean flag has simply never been
set on. ⚠️ **That is a gap in the flag, filed as backlog A5f, not a licence to add a regex.** The
name-based `is_known_operator()` was measured and is worse in both directions: it misses
`U.S. Renal Care` (the period defeats it) while `is_operator_not_owner` catches it.

**gov gets no operator arm at all**, deliberately — its tenant is a federal agency and the
documented `true_owner_is_operator` returns constant false there. A predicate that can never fire
is noise, not safety.

### 4b. Placeholders REUSE the existing guard; the extension is narrow and its blast radius was measured

Checked first, as instructed. `<dom>_is_strong_junk_owner_name` **already catches** `Unknown`,
`N/A`, `Various`, `Undisclosed`, `TBD`, `None` on both domains. It does **not** catch
`Independent` (754 properties), `Other` (110) or `State Owned` (20) — and neither does
`lcc_is_placeholder_owner_name`, which lists `independent` but not the other two.

So the gate delegates to the existing guard and adds an **anchored, exact-match** extension scoped
to itself (`lcc_p131_is_document_row_label` precedent). Blast radius measured over **every live
owner name and company_name on both domains** before shipping:

| table | rows matched | what they are |
|---|---:|---|
| dia `true_owners` | 3 | `Independent`, `Other`, `State Owned` |
| dia `recorded_owners` | 3 | same three |
| gov `recorded_owners` / `unified_contacts.company_name` | 0 | — |
| gov `true_owners` | 1 | `John Doe` |

**Zero real firms.** Exact match, never `contains` — P158a: a `contains` rule swallows real firms.
It is **not** exported into the shared junk guards, where a false positive is destructive.

### 4c. Value is the CANONICAL rent, and UNKNOWN IS GATED

dia uses **`v_property_attributes_portfolio.annual_rent`** — `proj.rent_now`, the confirmed
anchor/lease rent projected to today, which is already what LCC consumes as truth.
`properties.last_known_rent` / `.rent_imputed` would have admitted more (6,951 priced properties
instead of 4,154) and would have been a **second definition of value that drifts from the panel's**.
One definition, even when it is the thinner one. gov uses `properties.gross_rent`.

**A null rent is `value_unknown` and is GATED** — P161 measured this exact trade and gated it.
It is a named bucket, not silent loss, and it is the single largest exclusion in the fleet
(**20,487 rows**). ⚠️ **That is the real constraint on these lanes, and it is a coverage problem,
not a value one**: dia prices 4,154 of 11,796 properties (35%). Filed as **A5e**. Loosening the
floor to "admit unknowns" would let a coverage gap masquerade as a value judgement.

### 4d. The floor is the EXISTING knob — $500k, one function per domain

`dia_research_gate_value_floor()` / `gov_research_gate_value_floor()` return 500000: the same
number as the gov asset-mint floor, `CADENCE_SIGNAL_MIN_VALUE` and P161's weak-role floor.
**No per-lane floor was invented**, because no measurement justified one. The distributions differ
by domain (a dia clinic averages ~$223k of rent, a gov property ~$417k), so the same floor admits
5.6% of gov and 0.7% of dia — that asymmetry is the two portfolios being different sizes, which is
what a value floor is *for*. Changing it is one function body, in one place, per domain.

## 5. `owner_needs_sos` emits nothing, and that is a decision the prompt asked for

**24,077 rows (gov 16,873 + dia 7,204) are gated to zero with the reason recorded per row.**
Its acquisition path is externally blocked at the bot-wall — government-lease `CLAUDE.md` §25:
`W9_1_SOS_DIRECT` off, every adapter honest-blocked, the weekly `--apply` schedule **DISABLED**.
A task nobody can complete is not actionable at any value; this is P181's second axis
(*value AND decidability*) applied to a whole lane.

**The gate does not change its reachability and does not pretend to.** What it changes is that the
lane's zero is now **explicit and reasoned** rather than an accident of where the priority window
happened to fall. `gate_value` is still computed on every row, so re-admitting the lane the day
SOS-direct is unblocked is a one-predicate change. Backlog **A5g**.

## 6. ⚠️ The gov SF lane's gap was suspected stale and the suspicion was REFUTED

gov `owner_needs_salesforce` keys on gov `unified_contacts`, which `CONTACTS_HUB=ops` made a
pre-cutover snapshot: **30,714 rows, 5 updated in 7 days, 213 in 30.** So "no `sf_account_id`"
could plausibly have been a stale verdict about a link made on the live hub after the 2026-08-17
cutover — which would have made 1,675 first-ever tasks a fiction.

Sampled 40 admitted subjects against LCC Opps `unified_contacts`: **40 of 40 exist there and 0
carry an `sf_account_id`.** The gap is real. (This also re-measures the `CLAUDE.md` claim that the
gov copy is *"last written 2026-08-17, 0 rows touched since"* — it is 2026-08-26 and 213 rows in 30
days: a trickle, not frozen.)

## 7. What the first correct run emits — and what it does NOT

Open counts converge to **min(`limit`, admitted)** per domain and then plateau:

| domain | admitted | cron 34 (`limit=2000`) | cron 35 (`limit=300`) |
|---|---:|---|---|
| gov | 2,332 | mints up to 2,000, plateaus | tops up 300/run |
| dia | 198 | mints all 198 | — |

**⚠️ gov `owner_needs_salesforce` (1,675) dominates the admitted population and is the lane's
first-ever emission.** Stated loudly rather than smoothed: these are $500k+ gov owners with no
Salesforce account, human-answerable in the CRM, and they are 66% of everything the fleet will
mint. If that reads as too much surface, the knob is `gov_research_gate_value_floor()` — one
function body.

### The residue: existing open tasks below the gate STAY OPEN, on purpose

The probe is ungated, so **nothing is falsely closed** — but the 2,000 already-open tasks were
selected by the old ungated window and most are below the gate:

| domain | lane | open | admitted population (upper bound on how many can pass) |
|---|---|---:|---:|
| gov | `property_missing_recorded_owner` | 1,000 | ≤ 656 |
| dia | `true_owner_needs_salesforce` | 815 | ≤ 27 |
| dia | `property_missing_recorded_owner` | 185 | **11 (exact census)** |

**At least 1,306 of the 2,000 open tasks are below the gate and will remain open.** Retiring them
is a bulk state change with its own reversibility requirements and a distinct outcome value — it
is **deliberately not bundled here** (that is the P176 lesson: closing items is not closing a
lane, and a second bulk write in the same change is how a repair becomes indistinguishable from
the producer). Filed as **A5d**, alongside A5a's own A5b-repair.

## 8. Performance — measured both directions, because the two reads have different shapes

| read | before | after |
|---|---:|---:|
| gov ranked mint head, ordered | 1,149 ms | **591 ms** |
| gov membership probe, `entity_id in (…)` | 44 ms | **51 ms** |
| dia ranked mint head, ordered | ~192 ms | 684 ms |
| dia membership probe | — | **33 ms** |

The gov head got **faster**: the constant-false `owner_needs_sos` arm is pruned outright and the
sort set falls from 41,805 rows to 2,332. On both domains the gate's LATERAL rent aggregates report
**`never executed`** under the probe's id predicate — it still pushes into every UNION arm, so
A5a's completeness guarantee is not paid for twice.

## 9. Honest counts — what to read, and what lies

- **`admitted_head_exhausted`** — `true` means `feed` IS the whole admitted population for that
  domain; `false` means the head filled at `limit` and `feed` is only a **floor**. Reporting one as
  the other is the badge that lies.
- **`gate_reasons_seen`** — a leak check, not decoration. The server applies the gate, so this must
  contain only `admitted`. Anything else means the filter did not take.
- **`would_close` / `closed`**, never `feed` (A5a).
- **The dia research lane badge now counts gated rows.** Ungated it read **29,643** — the whole
  pool, 83% of which is owners holding nothing. `count=exact` because the planner's estimate over
  the gated view is off by ~58× (11,569 vs 198); measured 644 ms against a 3,500 ms lane timeout.

## 10. Verify

```sql
-- 1. The mint must be BOUNDED, not the pool. Expect hundreds per domain, plateauing.
select research_type, count(*) filter (where created_at > now()-interval '1 hour') minted_1h,
       count(*) filter (where status in ('queued','in_progress')) open_
from research_tasks where source_table='v_next_best_research' group by 1 order by minted_1h desc;

-- 2. A5a must not regress: gap_resolved-per-day stays ~0.
select count(*) from research_tasks
where source_table='v_next_best_research' and status='completed'
  and outcome::text ilike '%gap_resolved%' and completed_at > now()-interval '1 day';

-- 3. The gate itself, per lane (run on each domain DB).
select research_type, gate_reason, count(*) from v_next_best_research group by 1,2 order by 1,3 desc;
```

⚠️ **A small mint is the gate working.** The failure mode to watch for is the opposite: a mint in
the thousands means the filter is not in the selection path — check the run's `gate_reasons_seen`.

## 11. The durable lessons

- **A gate belongs in the SELECTION, not after the read.** A JS filter over the fetched head would
  have left the head full of rows nobody can work while the low-value tail below it never got
  reached — the pool would look gated and the surface would stay empty.
- **⚠️ The same filter on two reads of one view can be a correctness bug.** Mint asks *is it worth
  working*; probe asks *does the gap exist*. Sharing the predicate turns "we chose not to work
  this" into "the gap resolved" — A5a's defect, wearing the fix's clothes. Guarded by
  `test/nba-feed-value-gate.test.mjs` (10 tests, **all 9 mutations verified RED**), which strips
  comments before matching, because the file's own prose explaining the asymmetry made two
  assertions pass over a deleted line.
- **Ask what a recorded FACT says before reaching for a name test** (A2a), and when the recorded
  fact is incomplete, **file the gap in the fact rather than patching around it** (P113).
- **Check the existing guard before writing a new one, then measure what it misses.** Two-thirds of
  the placeholder question was already solved; the new predicate is 13 anchored literals with a
  measured blast radius of 7 rows.
- **A lane with no reachable consumer emits nothing, and says so per row.** An externally-blocked
  lane's zero should be a recorded decision, not an artifact of where a window fell.
