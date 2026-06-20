# Claude Code — R53: turn ownership conflict/change into a sale-discovery + research signal (GSA lessor + deed)

## Why (audit live 2026-06-20 — see AUDIT_ownership_conflict_as_sale_signal_2026-06-20.md)
Owner disagreement/change across four sources (recorded_owner, deed grantee, GSA lessor, sale
buyer) is the same signal — a likely ownership transfer we haven't fully recorded — and we never
converge it into a "suspected sale → research" pipeline:
- **GSA lessor change is buried + orphaned + stale.** `gsa_leases.lessor_name` is on 6,483 props
  (94.5% match owner; 356 conflict). No `lessor_change` event type — **16,310 "modified" events
  carry a lessor change in `changed_fields`**, buried. **ALL 261,254 `gsa_lease_events` have
  `property_id = NULL`** (joinable via `lease_number`→`gsa_leases`, not linked). Diff stale since
  **2026-03-01**.
- **Deed conflict isn't mined as a sale.** R51 reconciles the 630 deed-vs-owner conflicts (deed
  wins) but never emits "this property likely sold — find price/date/buyer."

**Depends on R51** (the `v_owner_source_conflict` view + owner-priority wiring). Sequence after
R51 merges. gov is the focus (dia parallel where the data exists).

## House rules
Reuse R51's `v_owner_source_conflict` + R46/R51 research-task + Decision-Center machinery — don't
fork. Value-ranked by rent; idempotent (no dup research tasks — reuse the R21 dedup discipline);
reversible; never auto-write a `sales_transactions` row from an inference (emit a CANDIDATE +
research task, human-confirm — a suspected sale is a lead, not a recorded fact). ≤12 `api/*.js`;
suite green; DB live after dry-run. Don't fabricate price/date — that's what the research is for.

## Unit 1 — link GSA events to properties (prerequisite)
Backfill `gsa_lease_events.property_id` from `lease_number`→`gsa_leases.property_id` (one-time +
on write going forward in `gsa_monthly_diff`). Report linked %. Without this the events can't drive
property-level signals.

## Unit 2 — elevate the GSA lessor change → suspected-sale signal
Detect `event_type='modified' AND changed_fields ∋ lessor_name` as a first-class **lessor_change**
(a new event_type or a derived view `v_gsa_lessor_change`). For each (property-linked) lessor
change with no matching `sales_transactions` row in the window:
- open a value-ranked **`trace_unrecorded_sale` research task** (find price/date/buyer), and
- treat the new lessor as a fresh owner candidate → feed R51 reconciliation + R47 parent
  resolution (the lessor becomes a corroborating owner source).
Idempotent per (property, lessor_from→lessor_to).

## Unit 3 — deed conflict → suspected sale (extend R51)
For R51's `v_owner_source_conflict` rows of kind `deed_newer_stale` (deed grantee ≠ prior owner)
with NO matching `sales_transactions` row: emit a `trace_unrecorded_sale` research task + a sale
CANDIDATE (property, suspected grantor→grantee, deed date as the suspected sale date — flagged
"suspected, unconfirmed"). Surface in the Decision Center (reuse R51's lane / a sibling lane):
verdicts `confirm_sale` (operator supplies/öconfirms price → writes a real `sales_transactions`
row via the normal path), `not_a_sale` (refinance/correction → record + stop-asking), `research`.

## Unit 4 — corroborate ownership across the four sources + direct research
A view that, per property, aligns recorded_owner / latest_deed_grantee / GSA lessor / latest sale
buyer and classifies: `all_agree` (no action), `deed+lessor_agree_owner_stale` (high-confidence →
auto-reconcile via R51), `all_disagree` (→ research). Add `gsa_lessor` to the field-source-priority
owner ladder as a corroborating source (below recorded_deed/county, above aggregators). Value-ranked.

## Unit 5 — re-run the stale GSA diff (operational)
The GSA monthly diff is stale (last 2026-03-01). Same recurring-feed fix as USAJobs/SAM: confirm
the ingest/diff job runs (it's a gov pipeline step — `gsa_monthly_diff` / `ingest_gsa_*`); if it's
a scheduled job that stalled, surface the runbook + (if applicable) fold into the feed-ingest
schedule. So lessor changes are current going forward.

## Verify (report back)
- `gsa_lease_events.property_id` linked % before/after (0 → ?).
- `v_gsa_lessor_change` count + how many lack a matching sale (the suspected-sale set);
  `trace_unrecorded_sale` tasks generated (value-ranked, deduped).
- A deed-conflict → suspected-sale candidate round-trip (confirm_sale writes a real sales row;
  not_a_sale stops asking); 0 residue.
- The corroboration view's class distribution (all_agree / owner_stale / all_disagree).
- No fabricated sales rows (candidates only until confirmed); suite green; ≤12 api/*.js.

## Bottom line
A landlord/owner change IS the sale tell, and we capture all four owner sources but let the change
sit buried, orphaned, and stale. R53 links the GSA events, elevates the lessor change, turns
deed/lessor/owner conflicts into value-ranked suspected-sale research + candidates, corroborates
ownership across the four sources, and refreshes the stale diff — so an ownership change becomes a
discovered deal and directed research, not silent drift.
