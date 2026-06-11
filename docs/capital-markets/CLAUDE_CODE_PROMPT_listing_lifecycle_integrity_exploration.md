# Claude Code prompt — Listing-lifecycle integrity exploration (database-wide, receipts-first)

> Surfaced during R76 Layer C: `available_listings` carries MULTIPLE simultaneously-
> "active" rows per property (92 properties at a single dia quarter), and lifecycle
> transitions aren't enforced — a sale doesn't reliably close the prior listing; a
> new-broker re-list doesn't supersede the prior active row; the availability-checker
> isn't closing stale opens. The R76 observed-only engine MASKED this for the CM charts
> by counting DISTINCT property, but the underlying table is still polluted and feeds
> OTHER consumers (LCC app, BD engine, availability-checker, any count over
> available_listings). Scott wants ONE row per on-market iteration, one active row per
> property at a time, and clean state transitions across the whole DB.
>
> THIS IS AN EXPLORATION — audit + doctrine + a gated remediation plan. NO writes until
> the Phase-3 plan is independently verified at the gate. Both verticals (dia
> zqzrriwuavgrquhisnoa, gov scknotsqkcheojiaewwh).

## Doctrine target (Scott, 2026-06-10)

- Exactly **one active listing row per property** at any point in time — one on-market
  iteration = one row.
- **Sale closes the listing**: when a sale records for a property, its active listing →
  status `sold`/closed, removed from on-market counts as of the sale date.
- **Re-list supersedes**: when a new broker/listing appears for a property that still has
  an open prior listing, the prior active row → `superseded`; the new row is the active
  iteration.
- Multiple genuine iterations over time are fine as HISTORY (sequential, non-overlapping
  active windows) — never simultaneous.

## Phase 1 — AUDIT (read-only, both dia + gov). Receipts per category, per vertical.

1. **Simultaneous active duplicates** — properties with >1 active listing row at the same
   point in time (the R76 point-in-time definition). Count, distribution (2/3/4+ rows),
   by `data_source`/`listing_source`.
2. **Close-on-sale gap** — active listings whose property has a recorded sale AFTER the
   listing_date, but the listing is still open (not `sold`/closed). This is the prior
   listing that should have been closed by the sale.
3. **Phantom over-stamp** — listings with NULL listing_date + future/over-stamped
   off_market_date (the availability-checker writer issue; fold in Task-6c Phase-A here).
4. **Stale opens** — active listings not seen in >N days (the dia 241 open/no-last_seen,
   208 of them >2yr). These should be off-market/withdrawn.
5. **Re-list overlaps** — same property, 2+ active rows from DIFFERENT brokers/sources with
   overlapping active windows.

## Phase 2 — MAP the writers + existing lifecycle infra (read-only)

- Enumerate every writer that INSERTs/UPDATEs `available_listings` (CoStar sidebar, OM
  intake, availability-checker edge fn, `lcc-auto-scrape-listings`, sales sync, manual).
- Map existing lifecycle handling and where the gaps are: `close_listing_on_sale` trigger,
  `auto_supersede_expired_leases`, the availability-checker sold/off-market paths,
  `lcc_record_listing_check`. Which transitions ARE enforced, which aren't.
- Enumerate every CONSUMER of `available_listings` (the blast radius) — which counts/
  processes change if we collapse to one-active-per-property. (The R76 CM views already
  count DISTINCT, so they're safe; find the ones that aren't.)

## Phase 3 — DOCTRINE + remediation plan (dry-run JSON → gate, NO writes yet)

- Propose the canonical lifecycle state machine + the uniqueness rule (one active per
  property), with the exact transition triggers.
- **Backfill plan**: collapse existing simultaneous-active duplicates to one iteration
  (keep the most-authoritative/most-recent observed row; close/supersede the rest with
  provenance tags); close-on-sale the open-with-sale rows; off-market the stale phantoms.
  Per-category counts + a sample.
- **Writer fixes**: enforce at write time — close prior on sale, supersede prior on
  re-list, stop the future-off_market stamp.
- **Recurrence guard**: a uniqueness CONSTRAINT or trigger so simultaneous-active can't
  re-accumulate.
- Per-change before/after + blast-radius confirmation → Scott's independent verification
  before ANY write.

## Guardrails

- Receipts-first; NO writes until the Phase-3 plan is gated. Idempotent.
- Provenance-tag every state change; **never hard-delete** a listing — supersede/close and
  keep the history row.
- This is the ROOT-CAUSE companion to the R76 view-layer fix (which counts DISTINCT as a
  safety net). Fixing the data lets us eventually simplify the views, but **do not remove
  the distinct-count safety net** until the data is clean AND the recurrence guard is live.
- Subsumes Task-6c Phase-A (#61): the phantom-writer close is one slice of this.
