# UX-T1a-gates — the two coverage gates made honest, and the plumbing bands hidden

**Measured and applied live 2026-09-03** against LCC Opps `xengecqvemvfknjvbvrq`,
gov `scknotsqkcheojiaewwh`, dia `zqzrriwuavgrquhisnoa`.
Guard `test/uxt1a-gates-coverage.test.mjs` — 18 tests, **19/19 mutations RED**.

## The three deltas, first

| | before | after |
|---|---:|---:|
| **Unit 1** dia rows in `lcc_property_attributes` with a `lease_expiration` | **0** of 17,225 | **1,747** |
| **Unit 2** `v_lcc_bd_worklist` `loan_maturity` rows | **0** | **172** (109 owners / 122 properties) |
| **Unit 3** priority-queue rows on the operator surface | 1,635 (58% plumbing) | **694** seller-timing (941 hidden, not deleted) |

Positive controls: gov `lcc_property_attributes` unmoved (13,838 / 11,493 / 11,725 / 11,847);
`v_lcc_bd_worklist`'s two existing arms unmoved (ownership_chain 3,534 / contact_writeback 1,646);
priority-queue total unchanged at 1,635.

**The gate that this unblocks:** dia's newer-lease gate was *structurally uncomputable* — all
2,127 dia current facts read `term_unknown`. It now contributes **56 in-band newer-lease rows /
53 owners / 41 properties** where it contributed **zero**, and dia `term_unknown` falls
**2,127 → 1,252**.

---

## Unit 1 — UX-T1a-mirror-dia-lease

**The break was the dia SOURCE VIEW, not the tick and not the apply function.** dia's
`v_property_attributes_portfolio` never carried lease columns; gov's always did. Diffing the two
views' column lists found it in one query, before reading either the tick or the apply function.
**When one of two near-identical feeds works, diff their column lists first.**

Three edits, and **any one alone is a silent no-op**: the source view (append six columns derived
from `leases`), the tick's dia `select=` list, and the dia branch of
`lcc_apply_property_attributes_page` — which had never handled lease columns at all.

- ⚠️ **THE HONEST CEILING IS 1,747 PROPERTIES, NOT THE AUDIT'S 1,940.** That 1,940 counts **1,986
  SUPERSEDED leases** — a lease that has been replaced is not the lease in effect. Non-superseded:
  1,776 properties, of which 1,747 resolve to a row in `properties`. The prompt's "~1,900"
  inherits the same overcount.
- ⚠️ **THE W2.3 "dia is not anon-readable" NOTE IS STALE** and was re-measured rather than quoted:
  the view reads `security_invoker=off` and returns 11,802 rows to `anon`. P157 fixed it.
- **`firm_term_remaining` is an honest NULL for dia (0 of 1,747), not 0.** There is no firm-term
  fact in that domain; `0` would read as "none remaining" — the PR1a/PR1b sentinel class.
- **`lease_source` names WHICH lease answered** — `in_effect` 1,579 / `start_unknown` 124 /
  `not_yet_commenced` 44 — so a consumer can tell "in effect" from "expiry known, start unknown"
  instead of reading both as one fact.
- **Scott's 15-year standard reproduces**: `initial_term_years` p50 **14.9** / p90 **15.1** over
  the 1,747 live-lease properties. ⚠️ The same statistic over *all* 4,225 properties with an
  initial term reads **10.0** — dragged by expired short leases. Say which population.
- ⚠️ **My newer-lease sub-counts differ from the audit's §4b** (within-first-3-years **134** vs
  their 71; ≥12 yrs remaining **30** vs 33; union **143** vs 86), because the superseded exclusion
  changes which lease is selected per property. The audit says re-derive rather than quote; these
  are the re-derived figures.

**⚠️ pg_net dispatches a queued request only on COMMIT.** Driving the re-walk with a loop inside
one transaction fired exactly one page and then blocked on its own pending id — it read as a
working loop and moved nothing. One page per transaction.

## Unit 2 — UX-T1a-debt

🚨 **THE AUDIT'S PREMISE IS PARTLY REFUTED, AND IT CHANGES WHAT THIS UNIT IS FOR.** §5a/§7d
report that `loan_maturity` "has no producer" and that the Today tile serves 100% plumbing. That
is true of `v_lcc_bd_worklist` and **false of the handler**: `assembleBdWorklist` has always
fanned out to the domains' `v_loan_maturity_watch` views, **both live** (gov 178 rows / dia 72).
The Today tile was not blind to debt.

What was genuinely missing — and what this unit delivers — is that **the domain fan-out emits
`entity_id: null`**. It cannot resolve an LCC owner, so the debt signal could not be joined to an
owner, a cadence, a role or a reach state, and therefore **could not feed an owner-keyed seller
queue**. That is UX-T1a-queue's actual blocker, and only a SQL-resident mirror fixes it.

- **No third loan store.** Non-PII `v_loan_maturity_portfolio` on each domain (identical column
  lists, `security_invoker=off`), mirrored onto the existing W2.3 keyset-tick as its own leg →
  `lcc_loan_maturity`, **568 rows (gov 413 / dia 155)**, reproducing both sources exactly.
  ⚠️ Neither view exposes a lender contact column; both domains' `lenders` carry them.
- ⚠️ **192 loans is 172 ROWS / 109 OWNERS / 122 PROPERTIES.** The prompt's "~190" counts loans.
  Rows ≠ properties ≠ owners here for a structural reason: a sponsor and its SPE can both be
  current owners of one asset (OWN-T0's 756-property class), so 99 of the 172 rows sit on an asset
  with more than one owner. Both rows are true; `owners_on_asset` rides in `detail`.
- ⚠️ **TEACHING THE MIRROR A NEW LEG NEEDS FIVE EDITS, NOT THREE.** The first pass made three
  (key column, apply dispatch, source path); every assertion passed, every wiring probe returned
  true, **and the leg did nothing** — `lcc_mirror_tick('loan_maturity', …)` returned
  `{"fired":0,"applied":0,"consumed":0}`, byte-identical to a leg that is genuinely caught up. The
  two it missed were a DEFAULT leg array and a hard-coded allowlist `CONTINUE`. **A `CONTINUE` is
  invisible to a detector that only asks whether the new code is PRESENT.** Found by walking the
  leg and reading the state delta.
- 🚨 **I NEARLY SHIPPED A DOUBLE-PRODUCER THAT WOULD HAVE DEGRADED MY OWN ARM.** With both
  producers feeding one dedup keyed on `(signal_type, domain, property_id)` and resolved on
  `rank_value` alone, the domain row (`entity_id: null`) can WIN — and would have won **exactly on
  the 39 unpriced rows**, where the LCC arm reports NULL → 0. The card would then name a maturing
  loan with nobody to call. Fixed by deciding **attribution before value**; value still breaks ties
  within a class, so no other signal type changes.
- **`rank_value` is NULL, never 0, when the asset is unpriced (P180)** — 39 of 172. This
  deliberately differs from the two existing arms, which COALESCE to 0; the divergence is named,
  not silently copied. The renderer's `money()` already renders '' for a non-positive value.
- **`is_distressed` was read by the renderer and set by nothing** (hard-coded `false` for every
  LCC row) — C10's class one field over, invisible because the ⚠ badge simply never appeared. Now
  fed from gov `loan_status='defaulted'`. Positive-controlled: **active 410 / NULL 155 / defaulted
  3**, so it discriminates and is genuinely 0 inside the 24-month window rather than unreachable.
- ⚠️ **`LCC_SIGNAL_TYPES` was hard-coded to two arms**, so the new arm would have been fetched by
  nothing and been invisible on every surface. The length check was `=== 2`; it is keyed on the
  array now.
- **Guards positive-controlled**: brokerage / placeholder / not-prospected fire on **0 of 172**
  here and on **813 / 100 / 629** of 66,941 live entities fleet-wide — the zero is this
  population's property, not a broken predicate. Tombstones excluded (P175): 0 today, guard stays
  because the merge path runs ~285×/month.
- **The domain views have real defects, reported not fixed** (they belong to the domain repos):
  gov's `v_loan_maturity_watch` picks the **LATEST** maturity per property and applies **no upper
  bound at all**, so its `<=24mo` label is a catch-all; its `matured` band reaches back to
  **2000-05-31**. This arm picks the **soonest** and is bounded.

**🔴 Known, stated, not fixed — `UX-T1a-debt-badge`:** the summary badge counts the domain views
only, while the list merges both. gov's LCC properties are a strict **subset** (106 of 178, 0
outside), but dia's are not — **2 of 16 are absent from dia's watch view** — so the badge
undercounts by exactly 2 (250 vs 252). An exact union needs the merged list, which the count-only
path deliberately avoids fetching.

## Unit 3 — the plumbing bands off the human surface

**941 rows hidden / 694 shown** — and 694 reproduces the audit's seller-timing figure exactly.
Hidden: P0.4 `resolve_ownership_control` 555 (A2/cron 244), P-CONTACT 216 (Tier 0 auto-attach),
P0.5 148 (CRM hygiene), P-BUYER 22 (buyers are pursued by showing them deals, §0.3).
⚠️ P-CONTACT reads **216** against the audit's 231 — ordinary drift; re-derive, don't quote.

- **A flag, not a filter, and nothing is deleted.** `lcc_priority_band_is_human_surface(text)` is
  the single owner; filtering inside the view would hide these rows from the automated consumers
  too. **Hidden ≠ unreachable**: an explicit `?band=` request still serves a hidden band.
- ⚠️ **Keyed on `priority_band`, not `reason`.** `reason` carries per-row suffixes
  (`agency_active_solicitations:23`, `repeat_buyer_relationship:238`), so a reason-keyed predicate
  would match some rows of a band and not others.
- **Fails OPEN**: an unclassified band is shown. An unknown band appearing as noise is a visible
  problem; one hidden by default is an invisible one.
- **The chip counts gate on the SAME predicate** — `v_priority_queue_band_counts` carries the flag
  and the handler filters both paths. A chip counting a band the list does not show is a lying
  badge (P139).
- The view was rebuilt **mechanically** (`SELECT q.*, … FROM (<live body>) q`) rather than by
  restating 6.7 KB, where a transcription slip would be silent. Prior body kept in
  `_uxt1a_pq_enriched_body_backup_20260903`.

## Traps paid for in this round

- **`CREATE OR REPLACE VIEW` matches columns BY POSITION.** Inserting `is_distressed` mid-list
  failed **42P16 "cannot change name of view column loan_ref to is_distressed"** — a mid-list
  insert renames everything after it. New columns go at the END of **every** view in the chain.
- **Read each domain's schema; never assume the sibling's.** dia's `lenders.lender_name` vs gov's
  `lenders.name` failed 42703 on first apply.
- **A guard that matches a shape is defeated by a name that legitimately appears elsewhere** —
  three of my own guards survived their mutations and were found by the mutation pass, not by
  reading them: the dedup ordering check (the `entity_id` declarations remain after deleting the
  branch — replaced with a **behavioural** test that invokes `assembleBdWorklist`), the
  superseded-exclusion check (a second lateral still carried one), and the replacement assertion
  (pinning the IF condition, not the RAISE). A fourth matched the **summary** `select=` instead of
  the list one — the very C10 class under test.

## Verification

```sql
-- Unit 1
select source_domain, count(*) filter (where lease_expiration is not null) le,
       count(lease_source) src, count(initial_term_years) init
from lcc_property_attributes group by 1;        -- dia 1747/1747/4225; gov 11725/0/0
-- Unit 2
select signal_type, count(*), count(distinct entity_id) from v_lcc_bd_worklist group by 1;
-- Unit 3
select human_surface, count(*) from v_priority_queue_enriched group by 1;  -- f 941 / t 694
```

**Read the state delta, never the wiring.** Every wiring probe in Unit 2 returned `true` while the
leg moved nothing.

## What is NOT done

- **UX-T1a-queue is unblocked, not built.** Both gates are honest now; the queue view is next.
- **G4's death/divorce arms remain unreachable** — the debt arm is the only D this round makes
  available. The 42%-false-positive trust/estate regex is still not a write.
- `UX-T1a-debt-badge` (above); the gov/dia `v_loan_maturity_watch` defects (latest-not-soonest, no
  upper bound, `matured` to 2000) are filed for the domain repos.
- The Today tile's Significant/Important/Urgent split (UX-T1a-today) and cadence work are untouched.
