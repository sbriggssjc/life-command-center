# C1B-GOV-GATE-fix — the `lane_no_consumer` marker is on the wrong arm; seal `owner_needs_salesforce`, unseal `owner_needs_sos`

**Filed:** 2026-09-16 (Cowork). Decision by Scott 2026-09-16: **seal SF, unseal SOS**.
**Owner:** 👤 **government-lease** — `v_ownership_gaps` lives there (LCC's copy under
`supabase/migrations/government/` is retired; ⛔ do not re-apply it, its README says why).
**Backlog:** LCC `C1B-GOV-GATE` (found 2026-09-16), unblocks the gov arm of `C1C-SPLIT`.

## What is live today (gov, measured 2026-09-16)

| `gap_type` | rows | `gate_pass = true` | `gate_reason` values |
|---|---:|---:|---|
| `owner_needs_salesforce` | 13,727 | **1,838** | admitted, below_value_floor, owns_no_property, placeholder_owner, value_unknown |
| `owner_needs_sos` | 16,861 | **0** | **lane_no_consumer** |
| `property_missing_recorded_owner` | 11,183 | 653 | admitted, below_value_floor, value_unknown |
| `property_missing_true_owner` | 24 | 1 | admitted, below_value_floor, value_unknown |

C1b (2026-09-08) meant to seal `owner_needs_salesforce` — the lane with no consumer — so the
generator would stop minting into it. The marker landed on `owner_needs_sos` instead. Effect: the
SF lane kept minting (175 tasks in 8 days, 156 of them on 09-13; 1,851 open in LCC), and the SOS
lane — which **OWNERGAP2** ("match owners from free sources", LCC backlog) is about to consume —
has been sealed for a week for no reason. The mint path itself is correct (`gate_pass=is.true`
server-side in `api/_shared/nba-feed-sweep.js`); the defect is entirely in which arm carries the
marker.

## What to build

1. In `v_ownership_gaps`: the `owner_needs_salesforce` arm gets `gate_pass = false`,
   `gate_reason = 'lane_no_consumer'`, `gate_value = NULL`. The `owner_needs_sos` arm gets back the
   ordinary predicate the SF arm carries today
   (`NOT gov_research_gate_is_placeholder_owner(...) AND NOT is_generic_gov_owner(...) AND n_props > 0
   AND owner_rent >= gov_research_gate_value_floor()`) with the ordinary reasons.
2. A test that reads **which arm** carries `lane_no_consumer` — not that the string exists
   somewhere in the view (that is exactly the check that passed while this was wrong). Positive
   control: the same test against the current definition fails.
3. Report the after-state of the table above. Expected: SF passing **0**, SOS passing some number
   > 0 (unknown until run — do not predict it, measure it).

## After it lands (LCC side, not this prompt)

The gov arm of `C1C-SPLIT` can run: `lcc_c1c_retire_sf_lanes` with `p_research_types =
'{owner_needs_salesforce}'`, dry run first, expecting ≈1,851 gov rows. That is an LCC action and
will be its own step once this view change is verified live.

## Prohibitions

- ⛔ Do not re-apply LCC's retired `supabase/migrations/government/` copy of C1b.
- ⛔ Do not retire tasks from this prompt; the view change only.
- ⛔ Do not touch dia's gaps view.
