# Ownership-history lane — canonical reference

> **Read this first for anything touching `establish_ownership_history`.** It is the living
> subsystem doc: current state, how the lane is structured, the invariants, and what is left.
> The dated audits under `docs/audits/` are the **evidence trail** — go there for *why*, come here
> for *what is true now*.
>
> **Last measured: 2026-08-28 12:35 UTC.** Re-measure before quoting any number.
>
> 🔗 **Sibling subsystem, same entity graph:**
> [`tier0-owner-contact-system.md`](tier0-owner-contact-system.md) — matching a PERSON to an owner
> (the Decision Center Tier 0 lane, the sponsor map, owner-entity merges). **The two share
> `lcc_merge_entity`, `lcc_owner_sponsor_domain` and the owner entities themselves**, so a merge
> confirmed there changes the chains here. Read that page before touching entity identity; read
> this one before touching ownership history.

---

## 1. What this lane is, and why it existed unconsumed for 69 days

`establish_ownership_history` seeds a research task per gov property whose LCC ownership record has
`owner_links <= 1` — i.e. we hold a current owner but no **history**. The P138–P141 feeder only ever
fed `is_latest_for_property`, so the chain was never populated.

**It produced 545 items and consumed none for 69 days.** Not for lack of answers: P131/P133 had
already drafted **545 record-cited chains** into `lcc_clean_assist_proposals`. The lane failed
because it presented **four structurally different jobs under one label** — *confirm what you
already believe*, *your ownership record is contradicted*, *this cannot be answered*, and *we
distrust every record we have* — which trains an operator to skip all of it.

## 2. The four (now five) actions

`v_lcc_ownership_history_lane_split` classifies every open task from the **structured payload**
(`terminates_at_current_owner`, `draftable`, `insufficient_reason`, `continuity.contiguous`) —
**never from the rendered `reason` prose**, which is the P182 text-detector trap.

| action | meaning | consumer | state |
|---|---|---|---|
| `agrees` | chain ends at the owner we hold — a **confirmation** | **A2** auto-applies (cron 244, 06:49) | ✅ live |
| `mismatch` | last grantee ≠ our owner | **A3** sponsor confirms → `sponsor_spe` | ✅ live |
| `sponsor_spe` | resolved: grantee is an SPE of a confirmed sponsor | — (terminal) | ✅ live |
| `no_records` | no transfers on file | **A4** auto-retires (cron 245, 06:51) | ✅ live |
| `all_guarded` | transfers exist, **all** guard-rejected | **A4b** corrected the guard; residue is correct | ✅ live |

⚠️ **`awaiting_draft` and `unrecognised_payload` are kept as distinct states** — a task the drafter
has not reached is *not* `no_records`, and a payload matching nothing must surface rather than be
absorbed into a bucket it does not belong to.

## 3. Current state (2026-08-28 12:35 UTC — after B1)

**Completed ever 1,237 · open 644 · skipped 355.** From 0 completions in 69 days, then
336 after A2/A2a/A2b/A4b, then **1,237** after B1 split the value floor by consumer and
re-opened the 1,414 gov tasks it had been suppressing.

**The goal metric moved: gov properties with any ownership history 1,272 → 2,173; with a
chain (2+ historical links) 149 → 177.** `lcc_entity_portfolio_facts` 13,077 → 14,010.

| action | tasks | human_gate | was (08-28 07:25) |
|---|---:|---|---:|
| `agrees` | 197 | not_human | 51 |
| `no_records` | 173 | not_human | 0 |
| `mismatch` | 48 + **72 below floor** | actionable / below_value_floor | 48 |
| `all_guarded` | 7 + **51 below floor** | actionable / below_value_floor | 7 |
| `sponsor_spe` | 43 | not_human | 25 |
| `awaiting_draft` | 53 | awaiting_draft | 0 |

⚠️ **THE OPERATOR'S BADGE DID NOT MOVE — `human_actionable` is 55, exactly as before B1**,
and that is the design, not a coincidence. 123 newly-drafted `mismatch`/`all_guarded` cards
are below $500k and held at `human_gate='below_value_floor'`. **89% of the newly-drafted
population routes to automation** (`agrees` → A2 cron 244, `no_records` → A4 cron 245,
`sponsor_spe` terminal). See `docs/audits/B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md`.

⚠️ **`any_history` moved 7× harder than `chain_2plus` (+901 vs +28), and that is the
POPULATION, not a shortfall** — only 210 of the 1,501 below-floor properties carry ≥2
guard-passing transitions. **The binding constraint on chain DEPTH is now the A2-blocked
residue, not the floor**: `ambiguous_entity` 126 links / 123 properties (the A2a
duplicate-entity class, which applies unaided once merged), `no_entity` 49/47,
`placeholder` 44/31, `repeat_transfer_unrepresentable` 2/1.

⚠️ **The drafter clamps `limit` to 500 and scans a 600-row lane window**
(`lane_scan_capped: true` reports it honestly), so `backlog_remaining: 0` means *nothing
fresh in the scanned window*, never *nothing left in the lane*. The lane advances only as
A2 completes tasks and they leave it. That is the real throughput cap, and it is why the
53 `awaiting_draft` drain over the next nightly cycles rather than at once.

⚠️ **Observability gap, surfaced not fixed:** several
`lcc_ownership_chain_draft_run_log` rows are opened `status='started'` and never closed —
today's 06:45 cron run included — while the handler returns HTTP 200 and writes its
proposals. **Read the pg_net response body or the proposal delta, not the run log.**

### Pre-B1 state, retained as the yardstick (07:25 UTC)

| action | tasks | was (08-27 17:15) |
|---|---:|---:|
| `agrees` | 51 | 64 |
| `mismatch` | 48 | 49 |
| `sponsor_spe` | 25 | 25 |
| `all_guarded` | **7** | 7 |
| `awaiting_draft` | **0** | 11 |
| `no_records` | 0 (all 74 retired) | 0 |

⚠️ **`agrees` FALLING is the applier working, not a regression.** A2 completes an `agrees` task, and
a completed task leaves the open lane — so the bucket drains downward. Read the run, not the badge:
cron 244's 06:49 run (`a2-chain-20260828064900`) **considered 73** — i.e. A4b's +9 did land — and
wrote **`facts_inserted` 23 / `tasks_completed` 22**. Ledger 1:1 with the run's own counters
(23 `fact_inserted` rows over 22 properties). Arithmetic reconciles exactly:
`agrees` 64 **+9** (A4b re-draft) **−22** (applied) = 51; `mismatch` 49 **+2** (A4b: `5379`, `6992`)
**−3** (R60 Sweep A at 05:10 skipped `1223`/`14324`/`75` as `chain_gap_resolved_or_changed`,
unrelated to A4b) = 48. **`sponsor_spe` unmoved at 25**, as required — A3 territory.

**A4b landed and is verified on named rows.** `awaiting_draft` 11 → 0; the 7 remaining `all_guarded`
are exactly the 7 predicted (`786` `1429` `7527` `7966` `9995` `13080` `14058`). **No phantom prior
owner was written**: property `1429` (Camarillo) has **0** rows in the apply ledger, held by the
widened street-token name-variant guard, and the 7 same-party renames that guard also catches
(`1525` `2967` `6858` `6917` `6937` `7111` `7153`) have **0** ledger rows between them, ever.

⚠️ **8 of the 9 recovered `agrees` applied; `1284` did not, and the reason is NOT A4b.**
`GUR NORDHOFF, LLC → 19851-53 NORDHOFF LLC` now drafts correctly and classifies `agrees` — then A2
blocks it one step later as **`ambiguous_entity`** (the grantor resolves to more than one LCC
entity). That is the pre-existing duplicate-entity class **A2a** owns. A guard fix can only carry a
chain as far as the next blocker; expect a repair to move rows *between* blocked reasons, not only
out of them.

**357 historical ownership facts** written by A2 across 347 owners
(`lcc_entity_portfolio_facts` now 13,077). **Badge reads human-actionable, not raw open.**

**Blocked `agrees` residue** (`v_lcc_ownership_chain_apply_blocked`, links / properties):
`placeholder` 26 / 15 · `ambiguous_entity` 21 / 19 · `no_entity` 20 / 18.
`repeat_transfer_unrepresentable` is now **0** — A2b's drafter-side collapse worked.

**A2b collapsed one conveyance recorded on several dates** — 14 tasks / 14 properties / **32 links →
15**, 18 folded away, 12 distinct owners, **$26.2M** (per OWNER; the per-link sum reads $88.5M, a 3.4×
overstatement). Fixed in the DRAFTER, never the applier: the PK — one interval per party per property
— is right, the input was wrong. **All 14 now report `contiguous: true`**, because `A→B, A→B` was also
manufacturing a phantom chain break.

⚠️ **It is NOT the P138 `gsa_lease_diff` flicker, despite what A1/A2 and `CLAUDE.md` say.** That
flicker has a **return leg** (`A→B` *and* `B→A`) and is caught by `is_oscillating_pair`; this
population has none. It is *one conveyance observed more than once*, two ways: **per-lease fan-out**
(a GSA building carries many leases and the lessor of record updates on each separately — one
distinct `lease_number` per date, **13 of 13** testable properties; property 3123 is 8 rows across 8
leases) and **cross-source lag** (property 3891: `costar_sidebar` has the sale at 2014-07,
`gsa_lease_diff` the paperwork at 2015-05).

**The 7 remaining `all_guarded` are correctly guarded, name by name:** three punctuation-variant
self-transitions (`786` RGR, `7527` EPA, `14058` MAOB — **not** A2b's population and not a flicker;
a punctuation-variant *self*-transition is a different defect from one conveyance recorded twice), `13080`
`COMM 2014-UBS5 HARWOOD CENTER, LLC` (a CMBS trust, deliberately an artifact), `9995` PMMC (a genuine
strict-prefix name variant), `7966` (a concatenated brokerage — `gov_strip_brokerage_suffix` only
strips a `by <brokerage>` suffix), and `1429` Camarillo (six `Unknown` grantors plus the street-token
variant A4b now catches). **There is no further recoverable population here.**

**Six sponsor families confirmed:** `boyd` `highwoods` `rxr` `arc` `east` `sunflower`.
**Held:** `fgf` (90 SPEs — possibly a Boyd program), `commonwealth` (15 unrelated parties),
`madison` ×2 (duplicate entities), `carrington` / `sequoia` (name-derived evidence only).

## 4. Invariants — each earned by a live failure

1. **Classify from structured booleans, never from `reason` prose.** Both agreed at 380/73/92 when
   tested, and only the structured one survives a wording change *and* exposes the 74/18 split.
2. **A partial apply flips the lane's own seed predicate.** One written link takes `owner_links` to
   ≥2, so R60 Sweep A closes the still-open task as `skipped` — leaving its remaining links
   unapplied **and invisible forever**. **The unit of work is the whole task, not the link.**
3. **Every historical fact needs a non-null `ownership_end_date`.** `is_current` is
   `GENERATED ALWAYS AS (ownership_end_date IS NULL)`, so a historical fact without one reads as a
   **current** owner in the priority queue and rent rollups.
4. **At a chain gap, report — never bridge.** An unrecorded intermediate owner is exactly the thing
   that must not be invented. Where the END is unknown, the party is **not written at all**.
5. **Resolve entity ids through `lcc_entity_survivor()` before any GROUP BY** — existence is not
   liveness, and two ids collapsing to one survivor otherwise hit *"ON CONFLICT DO UPDATE cannot
   affect row a second time."*
6. **Name comparators are not interchangeable.** `lcc_owner_strict_core` was measured and
   **rejected** here (it collapses `BAMMF (8) LLC` onto `BAMMF (3) LLC`); the applier uses
   `lcc_ownership_chain_name_key`, unambiguous-only. **The hazard travels with the technique.**
7. **A confirm is keyed `(sponsor entity, token)`, never a bare token** — `east` names 226 live
   entities, `boyd` 129, and `egp` names two different REITs.
8. **Report `facts_inserted` / `tasks_completed`, never `links_already_present`** — a re-discovery
   tally reads exactly like throughput.
9. **An address-shaped name test must be gated on a legal-form check.** `\m[0-9]{5}\M` sat as a bare
   disjunct in the gov `*_is_clean` predicate, so **a street number ≥ 10000 disqualified the SPE named
   after it** — the commonest owner-name shape in this portfolio (`EGP 17101 BROOMFIELD LLC`). The
   discriminator is measured, not assumed: over every name the arm rejects, the junk carries **no**
   legal form and every real party carries one; the residue after gating is 3 pasted addresses,
   3 of 3 correct. **Narrow the arm, never delete it** — nothing else catches those three.
10. **A corrected guard is INVISIBLE without a re-draft, and that is not the same bug as A4's.**
   `fresh` excludes any task carrying a proposal, so all 18 `all_guarded` tasks kept the stale draft
   the old guard produced: fix the view, change nothing on any surface. The sensor
   (`runA4bRedraftPass`) is keyed on **state** — this task says every transfer was guarded away, and
   the gov view now passes one — never on "A4b shipped", so it equally covers records simply
   improving, and it is not a chore repeated the next time a guard moves (Class 8).
12. **A repeated observation is not a repeated conveyance — collapse it in the PRODUCER, keeping the
   EARLIEST date.** The link's `transfer_date` becomes the grantor's `ownership_end_date`, so a later
   observation can only ever OVERSTATE a tenure (by up to 700 days here). Corroborated, not assumed:
   over every party pair gov holds from **both** `costar_sidebar` and `gsa_lease_diff`, the recorded
   sale is earlier **26 of 26**, 0 same-day, 0 later, mean lag 161 days. The later dates are **not
   wrong data** — every folded row's `ownership_id` rides the survivor's `also_recorded_as` (48 of 48
   traceable), and gov's records are never touched. **The collapse key includes the GRANTEE**, so a
   grantor who sold to B and later to C is genuine repeat ownership, does not collapse, and stays
   blocked — which is right, because one interval per party cannot represent that either.
13. **Loosening a name guard needs the variant guard widened in the SAME change.** Admitting
   street-numbered names makes `10835 CAMARILLO STREET APARTMENTS LLC → 10835 CAMARILLO APARTMENTS
   LLC` read as a real transfer, and A2 would write it as history. The widening is
   street-token-equality (15 rows, **all 15 read as the same party**); the tempting
   ordered-token-subsequence alternative was measured and **rejected at 108 newly dropped rows across
   63 properties** to prevent one phantom.

## 5. What is left

| # | Item | Size |
|---|---|---|
| ~~**B1**~~ | ✅ **DONE 2026-08-28** — the $500k floor now applies PER CONSUMER: none on the automated gov `establish_ownership_history` path, unchanged on anything reaching a person. 1,414 re-opened (reversible, batch `b1-reopen-20260828`); lane 336 → 1,237 completions; gov chains 149 → 177; **`human_actionable` unmoved at 55**. | — |
| **B1-res** | ⚠️ **The A2-blocked residue is now the binding constraint on chain DEPTH, not the floor** — `ambiguous_entity` **126 links / 123 properties** (A2a class: applies unaided once merged), `no_entity` 49/47, `placeholder` 44/31. This is where the next `chain_2plus` movement comes from. | 201 links |
| **B1-trace** | `trace_ownership_to_developer` keeps the $500k floor — **983 below-floor skips** held. Its consumer (cron 145 `developer-chain-resolve-tick`) has NOT been graded the way A2 has; grading it is the decision, not an assumption. | 983 |
| **B1-dia** | dia keeps the floor and **cannot be lifted by a flag** — it has no `v_ownership_transitions_portfolio`, so a dia task can never be drafted. Building the dia side is the prerequisite. | 516 |
| ~~**A2b**~~ | ✅ **DONE** — `repeat_transfer_unrepresentable` collapsed in the drafter, 32 links → 15, all 14 unblocked. See §4 invariant 12 and the audit. | — |
| **A2b-res** | ⚠️ **A4b's 3 `all_guarded` self-transitions (`786` RGR, `7527` EPA, `14058` MAOB) were NOT A2b's population and are still open.** They are punctuation-variant **self**-transitions, correctly guarded — a different defect from a repeated conveyance, and the earlier note that they "are the same flicker" was wrong on both counts. | 3 |
| **A4b-res** | `is_name_variant` still misses **spaced-letter legal forms and TIC** (`1201 CORBIN, L. L. C.`, `1325 J STREET L P`, `321 E 2nd St TIC`) — measured at **18 address-arm names**, sized deliberately and NOT folded into A4b, whose blast radius was graded on a different rule. | ~18 names |
| **A4b→A2a** | `1284` (`GUR NORDHOFF, LLC`) is the one recovered `agrees` A2 could not apply — blocked `ambiguous_entity`, i.e. an A2a-class duplicate entity, not a guard defect. It applies unaided once merged. | 1 task |
| **V8a** | Settle **Boyd ↔ FGF** before confirming `fgf` — 90 SPEs ride on it. | 👤 |
| **V8c** | Merge the Madison duplicates, then one clean confirm. | 2 |
| **A3-residue** | ~31 chains with no sponsor family — the genuine integrity lane. **Sized, surface deliberately not built.** | ~31 |
| **P1c / J1–J4** | **JV / fund ownership is multi-party and the chain is single-valued.** `Boyd Watterson JV UBP` resolves to Boyd alone; its partner is invisible. Leasehold vs fee is a real split, not a weaker claim. | design |
| — | **`r9_chain_connect` (cron 104) mints prior-owner entities and attaches them to nothing** — 291 of the 331 grantors A2 resolved were its unattached output. A2 is its missing consumer. | ~4,900 |

## 6. Evidence trail (dated audits — the *why*)

| doc | what it establishes |
|---|---|
| `docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md` | the lane-by-lane throughput audit that found this one; **983 → 695** tasks in never-completed lanes |
| `docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md` | the four-action split; structured-vs-prose classification |
| `docs/audits/A2_OWNERSHIP_CHAIN_APPLY_2026-08-27.md` | the applier; the seed-predicate trap; 0 → 288 |
| `docs/audits/A2a_AMBIGUOUS_ENTITY_MERGE_2026-08-27.md` | duplicate-entity merge; round trip proven before the batch |
| `docs/audits/A3_OWNERSHIP_MISMATCH_SPONSOR_FAMILY_2026-08-27.md` | sponsor↔SPE; why the bare-token key was rejected |
| `docs/audits/A4_OWNERSHIP_LANE_RETIRE_AND_ADJUDICATE_2026-08-27.md` | the 74 retired; the guard defect measured |
| `docs/audits/A4b_TRANSITION_CLEAN_GUARD_2026-08-27.md` | the street-numbered-SPE defect: fleet-wide size, the measured discriminator, the variant pairing, the re-draft sensor |
| `docs/audits/A2b_REPEAT_CONVEYANCE_COLLAPSE_2026-08-27.md` | one conveyance on several dates: the mechanism corrected off "flicker", the 26-of-26 date rule, and why a dormant producer still needed a sweep |
| `docs/audits/V8_SPONSOR_FAMILY_REVIEW_2026-08-27.md` | Scott's 12 answers + the evidence check that changed 4 |
| `docs/audits/B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md` | the value floor split by CONSUMER: the measured cost of the automated path, why dia and `trace_` are held, and the two gates that treat unknown value in opposite directions |
