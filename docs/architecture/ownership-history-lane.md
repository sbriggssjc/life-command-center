# Ownership-history lane — canonical reference

> **Read this first for anything touching `establish_ownership_history`.** It is the living
> subsystem doc: current state, how the lane is structured, the invariants, and what is left.
> The dated audits under `docs/audits/` are the **evidence trail** — go there for *why*, come here
> for *what is true now*.
>
> **Last measured: 2026-09-02 (post-OWN-T0).** Re-measure before quoting any number.
>
> 🧭 **What the PROPERTY PANEL reads is § OWN-T0 at the foot of this page** — the reconciled view
> `v_lcc_property_ownership_reconciled` is the single ownership read for the panel, and the
> 756-property multi-current defect it made countable.
>
> 📇 **Topic index for the whole ownership→contact chain (~20 files, and two that are named
> misleadingly): [`connectivity-and-open-threads.md`](connectivity-and-open-threads.md) §0.**
> That page is the LIVING DOC for the chain end to end; this one owns its slice.
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

## 3. Current state (2026-08-28 — after B1a)

**Completed ever 1,302 · open 579 · skipped 355.** From 0 completions in 69 days, then
336 after A2/A2a/A2b/A4b, then 1,237 after B1 split the value floor by consumer, then
**1,302** after B1a merged the duplicate entities blocking the `ambiguous_entity` chains.

**gov properties with any ownership history 1,272 → 2,173 → 2,238; with a chain (2+
historical links) 149 → 177 → 178.** `lcc_entity_portfolio_facts` 13,077 → 14,010 → **14,076**.

⚠️ **B1a refuted the premise it was filed under.** It was filed as *"duplicate entities are
now the binding constraint on chain DEPTH"*; the merge drained 69 links out of
`ambiguous_entity` and moved `chain_2plus` by **one** — because **64 of the 65 completed
tasks carried exactly one link**. Duplicates were the binding constraint on chain
**EXISTENCE** (+65 `any_history`), never on depth. See §3a.

| action | tasks | human_gate | was (post-B1) |
|---|---:|---|---:|
| `agrees` | 132 | not_human | 197 |
| `no_records` | 173 | not_human | 173 |
| `mismatch` | 120 (48 actionable + **72 below floor**) | actionable / below_value_floor | 120 |
| `all_guarded` | 58 (7 actionable + **51 below floor**) | actionable / below_value_floor | 58 |
| `sponsor_spe` | 43 | not_human | 43 |
| `awaiting_draft` | 0 | awaiting_draft | 53 |

⚠️ **`agrees` 197 → 132 is the applier working, not a regression** (§3 pre-B1 note): a
completed task leaves the open lane, so the bucket drains downward. **B1a touched only
`agrees`** — `mismatch`, `all_guarded`, `no_records` and `sponsor_spe` are unchanged, and
the `awaiting_draft` 53 drained through the nightly drafter as expected.

⚠️ **THE OPERATOR'S BADGE DID NOT MOVE — `human_actionable` is 55, exactly as before B1**,
and that is the design, not a coincidence. 123 newly-drafted `mismatch`/`all_guarded` cards
are below $500k and held at `human_gate='below_value_floor'`. **89% of the newly-drafted
population routes to automation** (`agrees` → A2 cron 244, `no_records` → A4 cron 245,
`sponsor_spe` terminal). See `docs/audits/B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md`.

⚠️ **`any_history` moved 7× harder than `chain_2plus` (+901 vs +28), and that is the
POPULATION, not a shortfall** — only 210 of the 1,501 below-floor properties carry ≥2
guard-passing transitions.

### 3a. ⚠️ Chain DEPTH is source-limited, not blocker-limited (measured 2026-08-28, B1a)

The A2-blocked residue was filed as the next constraint on depth. **It is not, and the
number is small enough to close the question.** If the *entire* remaining residue were
unblocked tomorrow it would yield **12** `chain_2plus` properties in total:

| blocked reason | links | properties | would reach `chain_2plus` |
|---|---:|---:|---:|
| `ambiguous_entity` | 57 | 55 | **1** |
| `no_entity` | 49 | 47 | **1** |
| `placeholder` | 44 | 31 | **8** ⚠️ unrecoverable by design |
| `repeat_transfer_unrepresentable` | 4 | 2 | **2** |

And across the whole remaining open lane (132 tasks with a plan): **99 carry exactly one
link**, 26 carry two, 7 carry three or more, max 6. gov's ownership feed mostly records
**one transition per property** — so the ceiling on depth is the records on file, not any
blocker LCC can clear. The next `chain_2plus` movement has to come from **new records**, not
from draining this lane.

> ⚠️ **"New records" does NOT mean "acquire deeds" — corrected the same day.** The first
> reading of this paragraph concluded the constraint was external (deed acquisition), on the
> strength of gov holding only **876 grantor-bearing deed records and 325 deed documents**.
> **That was wrong, and one join disproved it.** gov `sales_transactions` holds **9,514 named
> sellers across 4,697 dated properties**, of which `ownership_history` has consumed **169
> rows (1.8%)** — **3,080 net-new (property, seller, date) rows across 2,114 properties.**
> dia already converts exactly this source via a **`sales_transactions_seller_exit`** feeder
> (2,207 of its 2,757 historical facts); **gov has never had one.** That feeder is backlog
> **B5** and it is the answer to **B4** (why dia out-depths gov).
> **The records this lane is short of are already on box.** See
> `docs/audits/BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md` §3c.
>
> **Durable lesson:** *"the source is exhausted"* is a claim about **every table that could
> carry the fact**, not about the tables named after it. Enumerate them before concluding
> that data must be acquired — acquisition is the most expensive conclusion available.

⚠️ **The largest depth reservoir in the residue is `placeholder` (8 of the 12), and it is
permanently blocked on purpose** — the placeholder is the GRANTOR (`Previous Owner → Third
Avenue Partners, LLC`), so there is no party to write and invariant 4 forbids inventing one.

### 3b. ⚠️ Two corroboration signals for entity identity are STRUCTURALLY unobservable (B1a)

Beyond byte-identical-after-case, the natural corroboration for "same party" is a shared
`external_identities` row, a shared owned asset, or an overlapping portfolio fact. Over the 42
held groups all three return **0** — and two of those zeros say nothing at all:

| signal | held groups | fleetwide control | verdict |
|---|---:|---:|---|
| shared `external_identities` triple | 0 | **0** | ⚠️ structurally impossible |
| shared owned asset | 0 | **0** | ⚠️ structurally impossible |
| overlapping portfolio fact | 0 | **3,923** | ✅ genuine zero |

`external_identities` is UNIQUE on `(workspace_id, source_system, source_type, external_id)`
**excluding `entity_id`** (P178), and `lcc_property_owner` is keyed on `entity_id` = the ASSET.
Two live entities can never share either. **Reporting "0 of 42 share an identity" would be
restating a unique constraint as a measurement** — the P182 family, where a predicate
structurally unable to express the question returns a plausible number. Point every
corroboration detector at a known positive before believing its zero.

⚠️ **The drafter clamps `limit` to 500 and scans a 600-row lane window**
(`lane_scan_capped: true` reports it honestly), so `backlog_remaining: 0` means *nothing
fresh in the scanned window*, never *nothing left in the lane*. The lane advances only as
A2 completes tasks and they leave it. That is the real throughput cap; it is why B1's 53
`awaiting_draft` drained over the following nightly cycles rather than at once (now 0).

⚠️ **Observability gap, surfaced not fixed:** several
`lcc_ownership_chain_draft_run_log` rows are opened `status='started'` and never closed —
today's 06:45 cron run included — while the handler returns HTTP 200 and writes its
proposals. **Read the pg_net response body or the proposal delta, not the run log.**

### 3c. ⚠️ It WAS source-limited — and the source was gov's own sales table (B5, shipped 2026-08-28)

§3a concluded depth needs new RECORDS and named county-deed capture as the constraint. Measured
correctly, wrong table. **B5 built the feeder gov never had** — `sales_transactions_seller_exit`, the
source that supplies 2,207 of dia's 2,757 historical facts.

**Live on gov now:** `ownership_history` **16,177 → 18,953** (+2,776 transitions / 2,000 properties);
transitions view **9,595 → 12,371** rows and **4,698 → 5,555** properties (**+857 gaining a first
transition ever**); properties with **2+ guard-passing links 1,376 → 2,118 (+742)**. Idempotent,
batch-reversible. Full writeup: `docs/audits/B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md`.

**The ceiling graded down honestly: 3,080 → 2,776 links, 2,114 → 2,000 properties.**

- **⚠️ The port is SEMANTIC, not literal.** dia's `ownership_history` is interval-shaped so its
  producer closes a tenure; gov's is transition-shaped, and a gov sale names the buyer too — so gov
  gets a complete two-party dated transition, which is *stronger* than a seller exit.
- **⚠️ A2b's earliest-wins rule does NOT reproduce on this population.** A2b measured
  costar-vs-lease-diff at earliest **26 of 26**; here the sale row is **later 217 times and earlier
  34** against an already-recorded pair. The anti-join therefore keys on the **party pair at any
  date**, not on the date. *Quote A2b's rule for the population it was measured on.*
- **⚠️ Depth at the SOURCE is not depth in the FACTS.** 1,376 view-level 2+ properties convert to
  only **178** `chain_2plus` today (12.9%). Report the two separately; do not read +742 as +742.
- **B5 is the missing CONSUMER for a producer that already mints the parties.**
  `r9_chain_connect` (cron 104) has read gov `sales_transactions.seller/buyer/developer` for months
  and nothing ever attached its output — A2 previously measured 291 of 331 resolved grantors as r9's.
- **⚠️ It exposed a destructive bug in a shared write path.**
  `trg_propagate_ownership_to_property` had no guard on `NEW.recorded_owner_id`, so any dated
  name-only row **NULLed `properties.recorded_owner_id`** — silently, unrecoverably. **7,567 live rows
  are in that shape**, and B5 alone would have destroyed **1,446 of 9,312 (15.5%)**. Proven on
  property 7370 and rolled back, both directions. Fixed fill-forward (B5a). **Do not revert it.**
- **⚠️ The stale-draft trap, for the THIRD time** (after A4b's stale guard verdict and A2b's stale
  collapse). 527 of 579 open tasks already carried a pre-B5 draft and the drafter prepares only
  `fresh` = open ∧ undrafted, so B5 would have converted on **52**. Closed by `runB5RedraftPass`,
  keyed on STATE (*"the planner now yields more links than this draft used"*), so it self-clears and
  catches the next source too. **It is JS — it needs a Railway deploy; the gov half is already live.**

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
| ~~**B1-res**~~ | ✅ **DONE 2026-08-28 (B1a)** — 59 groups / 63 losers merged (batch `b1a-20260828-r1`), `ambiguous_entity` **126 → 57 links**; A2 applied 66 facts / completed 65 tasks. ⚠️ **And it REFUTED its own premise**: `chain_2plus` moved 177 → **178**, because 64 of the 65 tasks carried one link. Duplicates blocked chain EXISTENCE (+65 `any_history`), not depth. See §3a. | — |
| **B1a-held** | **52 groups held, every one named**: `name_variant_beyond_case` **42**, `person_typed_member` 9, `rival_identity_same_system` 1. ⚠️ Two of the three corroboration signals are **structurally unobservable** (see §3b) — the 42 are unprovable, not merely unproven. The 9 person-typed release cheaply once someone retypes the mistyped row. | 52 groups |
| **B1a-depth** | ⚠️ **The whole remaining blocked residue is worth 12 `chain_2plus` properties** (§3a). Depth is source-limited: 99 of 132 remaining tasks carry ONE link. New depth needs new RECORDS — **and they are already on box: backlog B5, the `sales_transactions` seller-exit feeder gov lacks and dia has (3,080 net-new rows / 2,114 properties).** Not deed acquisition. | 12 props · **B5 = 2,114** |
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
| `docs/audits/B1a_AMBIGUOUS_ENTITY_MERGE_2026-08-28.md` | the duplicate-entity merge that refuted its own premise: depth is source-limited, the round trip proven on the P196 duplicate-edge shape, and the two corroboration signals a unique key makes unobservable |
| `docs/audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md` | the property panel's single reconciled chain: the disagreement matrix across four stores, the wrong-grain fill-blanks predicate, and why blanket supersession was measured on named rows and refuted |


---

## OWN-T0 — one reconciled chain for the property panel (2026-09-02)

**Audit:** [`docs/audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md`](../audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md)
**Migration:** `supabase/migrations/20260902160000_lcc_own_t0_property_ownership_reconciled.sql` (applied live)
**Guard:** `test/own-t0-ownership-reconciled.test.mjs` (20 tests, 25/25 mutations RED)

Scott, UX23: *"conflicting on the property's own ownership history tab, like no reconciliation is
occurring."* Measured, he is right at population scale and the standing detector read **zero**.

### What ships

| object | what it is |
|---|---|
| `v_lcc_property_ownership_reconciled` | **the ONE view the property panel reads.** One row per (asset, owner link) across every LCC-resident store, survivor-collapsed, carrying `evidence_level`, `is_primary` + `primary_reason`, `property_state`, `conflict_class`, `gap_before`, `start_date_unknown`. |
| `v_lcc_property_ownership_current` | its one-row-per-property head (properties with a CURRENT claim only). |
| `v_lcc_property_multi_current` | the detector that read zero. **756 properties / $903.3M**, split `multi_current_distinct_parties` 745 / `tombstone_duplicate_current` 11. |
| `lcc_ownership_evidence_level` / `_sponsor_family_token` / `_conflict_class` | the three single-owner helpers behind it. |
| `GET /api/entities?action=ownership_chain&domain=&property_id=` | the panel's read. |
| `lcc_sync_property_owner_to_portfolio` | producer fix — fill-blanks moves to the PROPERTY grain. |

### The invariants this adds

* **Fill-blanks on a property fact is a question about the PROPERTY, not about one owner.** Every
  writer of `lcc_entity_portfolio_facts` keys on `(entity_id, domain, property)`, so "already
  recorded?" was asked of the owner. That minted a second CURRENT owner on **632 of 756** properties.
  A re-run of P117 under the old predicate would have added **480 more** ($400.3M); it now names them
  `skip_property_has_current_owner`.
* **⚠️ A multi-current property is USUALLY NOT A DATA ERROR — it is one asset held at two levels.**
  Read on the top 60 by rent, the class is dominated by **sponsor ↔ SPE** (Boyd/FGF, NGP V–VII,
  EGP/USGP, USGBF, GI, USBGF, URG, Jemal, SkyTower, KPG). The sponsor is who we prospect; the SPE is
  who is on the deed and the GSA lease. **End-dating either destroys a true fact**, which is why
  OWN-T0 writes no `ownership_end_date` at all and the guard goes red if a future cleanup does.
  It also could not have been executed as prescribed: 523 of 756 are only partly dated, 121 not at
  all, and `is_current` is `GENERATED ALWAYS`, so un-currenting a row means inventing a date.
* **The panel's job is to STATE the disagreement, not resolve it.** `is_primary` + `primary_reason`
  name a headline owner from an authority ladder over recorded facts; every other current claim stays
  on the row and `property_state='conflict'` says so in words.
* **A P113 operator is flagged and excluded from the owner COUNT, never dropped.** Counting every
  claim made **884** properties read `conflict` over a known non-owner. `only_non_owner_claims`
  (**7,678 properties**) is the honest "no owner on file" state that produces.
* **No lexical sponsor guess decides an ownership fact.** A3 measured
  `lcc_tier0_sponsor_brand_token` at 3 of 74 on GSA SPEs; P198 measured co-proposal at 7%. Only the
  **human-confirmed** `lcc_ownership_sponsor_family` clears a pair (64 properties today). An
  unconfirmed sponsor/SPE pair stays `unclassified_rival` — and one confirm clears a whole family.
* **⚠️ `not materialized` on the four base CTEs is load-bearing.** Without it the panel's point query
  is **1,013.9 ms / 216,947 buffers**; with it **20.1 ms / 674** (C13b §7.7 — a multiply-referenced
  CTE is always materialized, so the predicate cannot push down). The detector hit the sibling
  footgun and **timed out at 60 s** on correlated subqueries before being hoisted.
* **⚠️ Read the LABEL DISTRIBUTION, not just the code.** `evidence_level='other'` held 3,364 links
  and every one was something the map should have named — 1,965 whose source is the STRING
  `'unattributed'` (not null, so the `is null` arm never saw them) and 1,399 A2 rows sourced
  `gov_ownership_chain:<uuid>`. Corrected, `other` reads 0.

### Live state (2026-09-02)

| property_state | conflict_class | properties |
|---|---|---:|
| `single_current_owner` | — | 10,084 |
| `only_non_owner_claims` | — | 7,678 |
| `conflict` | `unclassified_rival` | 1,614 |
| `conflict` | `duplicate_entity` | 417 |
| `conflict` | `sponsor_family_confirmed` | 64 |
| `no_current_owner` | — | 185 |

**Verify on `skip_property_has_current_owner` and the detector's `defect_class` split — never on 756
going down.** Nothing here end-dates a fact, so 756 is expected to hold; the number that moves is the
growth that does not happen.

### Open (OWN-T0a…g) — see the audit §8

`OWN-T0a` gov's own transition-vs-`true_owner` disagreement (**1,509 of 3,474, 43.4%**) ·
`OWN-T0b` no LCC mirror of `v_ownership_transitions_portfolio` · `OWN-T0c` 417 duplicate-entity
merges (and `lcc_entity_canonical_key` keeps a trailing `(The)`) · `OWN-T0d` 11 tombstone duplicates ·
**`OWN-T0e` ~1,550 unconfirmed sponsor/SPE pairs — one confirm clears a family; the highest-leverage
follow-up** · `OWN-T0f` per-row UUIDs in `ownership_source` · `OWN-T0g`
`lcc_finalize_entity_portfolios` supersedes only within its own payload (gov) and not at all (dia).
