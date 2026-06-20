# Audit — ownership conflict as a sale signal + GSA lessor name → ownership (2026-06-20)

**Question (Scott):** (1) a clear conflict of recorded entities on a deed may indicate a sale —
are we prompting research on those gaps? (2) the GSA lease inventory carries the Landlord
(lessor) recorded entity — does it fill ownership-history / sales-propagation gaps or direct
research?

## Verdict: the GSA lessor IS captured but its CHANGES (the sale tells) are buried, orphaned, and stale; owner-source conflicts are reconciled (R51) but never framed as "suspected sale → research"

### GSA lessor name — captured + consistent, but the signal in its CHANGE is untapped
- `gsa_leases.lessor_name` is populated on **6,483 gov properties** and matches the current
  recorded/true owner **94.5%** (6,127) — so it's a real, mostly-consistent owner source. **356
  mismatch** (a third owner source that can conflict — likely a sale the owner didn't catch up to).
- **0 owner-less properties have a lessor** — so the lessor isn't sitting on owner-gaps to fill;
  its value is in CHANGE detection, not gap-fill.
- **The lessor CHANGE — the strongest gov sale tell — is not surfaced.** `gsa_lease_events` has
  no `lessor_change` event type; **16,310 "modified" events carry a lessor change in
  `changed_fields`**, buried inside generic modifications. No sale-suspected signal, no research
  task, no ownership update fires from a landlord change.
- **The events are orphaned:** all **261,254 `gsa_lease_events` have `property_id = NULL`** — none
  are linked to a property (joinable via `lease_number`→`gsa_leases`, but not denormalized), so
  even if a consumer wanted to act on a lessor change it has no property to act on.
- **The GSA diff is stale** — last event 2026-03-01 (same recurring-feed stall as USAJobs/SAM/OPM).

### Deed-vs-owner conflict — reconciled (R51) but not treated as a sale discovery
R51 reconciles the 630 gov deed-grantee-vs-recorded-owner conflicts (deed wins). But a deed
grantee that differs from the prior owner **is itself evidence of a transaction** — frequently an
unrecorded/uncaptured SALE. Today nothing turns that conflict into a "this property likely sold —
research the transaction (price, date, buyer)" research task or a `sales_transactions` candidate.
The conflict is fixed as a data-quality reconciliation, not mined as a BD/market-intel event.

### The unifying insight (Scott's framing)
Owner disagreement/change across **four** sources — recorded_owner, deed grantee, GSA lessor, sale
buyer — is the same signal: **a likely ownership transfer we haven't fully recorded.** Each is a
research lead (who, when, how much) and a BD trigger (new owner relationship; the seller is a past
client). We capture all four but never converge them into a "suspected sale" pipeline.

## Fix doctrine → R53 (turn ownership conflict/change into a sale-discovery + research signal)
1. **Link GSA events to properties** — backfill `gsa_lease_events.property_id` via
   `lease_number`→`gsa_leases.property_id` (and on write going forward) so events are actionable.
2. **Elevate the GSA lessor change** — detect `changed_fields ∋ lessor_name` as a first-class
   `lessor_change` signal; for each, open a **suspected-sale research task** (value-ranked) and a
   `v_owner_source_conflict`-style row. The new lessor is a fresh owner candidate → feed the R51
   reconciliation + R47 parent resolution.
3. **Deed-conflict → suspected sale** — extend R51: when a deed grantee differs from the prior
   owner with no matching `sales_transactions` row, emit a `trace_unrecorded_sale` research task
   (find price/date/buyer) and a sale candidate, value-ranked. Reuse the research-task +
   Decision-Center machinery (R46/R51); idempotent.
4. **Corroborate ownership across the four sources** — where GSA lessor + deed grantee agree but
   recorded_owner disagrees, that's high-confidence the owner is stale → auto-reconcile (R51
   path); where they disagree, direct research. Use the GSA lessor as a corroborating owner source
   (add it to the field-source-priority owner ladder alongside the deed).
5. **Re-run the GSA diff** (it's stale since March) so lessor changes are current — same operational
   fix as the USAJobs/SAM feed recovery.

## Bottom line
The GSA landlord name is captured and the deed conflict is reconciled — but the *change* in either
(the actual sale tell) is buried, orphaned (events have no property_id), stale (diff since March),
and never converted into directed research. R53 links the events, elevates the lessor change,
turns deed/lessor/owner conflicts into value-ranked "suspected sale" research + sale candidates,
and uses the four owner sources to corroborate ownership and direct the rest — so an ownership
change becomes a discovered deal, not a silent data drift.
