# Ownership-history lane — canonical reference

> **Read this first for anything touching `establish_ownership_history`.** It is the living
> subsystem doc: current state, how the lane is structured, the invariants, and what is left.
> The dated audits under `docs/audits/` are the **evidence trail** — go there for *why*, come here
> for *what is true now*.
>
> **Last measured: 2026-08-27 16:30 UTC.** Re-measure before quoting any number.

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

## 3. Current state (2026-08-27 16:30 UTC)

**Completed ever 314 · open 156 · skipped 1,766.** From 0 completions in 69 days.

| action | tasks | was (14:00) |
|---|---:|---:|
| `agrees` | 64 | 64 |
| `mismatch` | 49 | 49 |
| `sponsor_spe` | 25 | 25 |
| `all_guarded` | **7** | 18 |
| `awaiting_draft` | **11** | 0 |
| `no_records` | 0 (all 74 retired) | 0 |

⚠️ **The 11 in `awaiting_draft` are the A4b recovery mid-flight, not a defect.** A4b corrected the
gov guard; the drafts built from the old one were superseded so the 06:45 drafter re-drafts them and
cron 244 applies at 06:49. Run against the **real planner**, they classify **9 `agrees` + 2
`mismatch`** (`5379` Brookfield/BSREP II, `6992` TFO REVA — both sponsor↔SPE shaped, so A3 territory).
`awaiting_draft` returning to 0 is the completion signal; **verify on `facts_inserted` /
`tasks_completed`, never on the predicate.**

**+304 historical ownership facts** written to `lcc_entity_portfolio_facts` (12,724 → 13,028),
280 owners, **$579.9M**. **Badge reads human-actionable, not raw open.**

**Blocked `agrees` residue** (`v_lcc_ownership_chain_apply_blocked`):
`ambiguous_entity` 18 · `no_entity` 18 · `placeholder` 15 · `repeat_transfer_unrepresentable` 14.

**The 7 remaining `all_guarded` are correctly guarded, name by name:** three punctuation-variant
self-transitions (`786` RGR, `7527` EPA, `14058` MAOB — A2b's `gsa_lease_diff` flicker), `13080`
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
11. **Loosening a name guard needs the variant guard widened in the SAME change.** Admitting
   street-numbered names makes `10835 CAMARILLO STREET APARTMENTS LLC → 10835 CAMARILLO APARTMENTS
   LLC` read as a real transfer, and A2 would write it as history. The widening is
   street-token-equality (15 rows, **all 15 read as the same party**); the tempting
   ordered-token-subsequence alternative was measured and **rejected at 108 newly dropped rows across
   63 properties** to prevent one phantom.

## 5. What is left

| # | Item | Size |
|---|---|---|
| **A2b** | `repeat_transfer_unrepresentable` — one conveyance recorded on several dates (the `gsa_lease_diff` flicker). Producer fix. **A4b left its 3 `all_guarded` self-transitions untouched — they are the same flicker and belong here.** | 14 tasks / 32 links |
| **A4b-res** | `is_name_variant` still misses **spaced-letter legal forms and TIC** (`1201 CORBIN, L. L. C.`, `1325 J STREET L P`, `321 E 2nd St TIC`) — measured at **18 address-arm names**, sized deliberately and NOT folded into A4b, whose blast radius was graded on a different rule. | ~18 names |
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
| `docs/audits/V8_SPONSOR_FAMILY_REVIEW_2026-08-27.md` | Scott's 12 answers + the evidence check that changed 4 |
