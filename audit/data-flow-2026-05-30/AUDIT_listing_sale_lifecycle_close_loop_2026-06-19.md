# Audit — listing → sale lifecycle close-the-loop (2026-06-19)

**Question (Scott):** when a property we track on-market actually sells, does the deed/sale flow
back in — close the listing, record price/cap/buyer/date, update the owner, log the comp, and
trigger the right BD action? The "a deal closed, did the system *learn and act on* it" loop.

## Verdict: the DATA loop closes well; the ACTION loop is wide open

### What works (the data layer is healthy)
1. **gov sold-path:** 2,116 listings sold, **2,086 linked to a sale** via `sale_transaction_id`;
   only **3-4 active** listings have a post-listing same-property sale that didn't auto-close.
   Auto-scrape is live (9 `sold` + 163 `inferred_active` writes in 30 days).
2. **dia sold-path:** **0** active listings whose property already sold remain open — clean close.
3. **sale → ownership propagation:** 455 of 472 recent gov sales (96%) have an
   `ownership_history` segment dated at the sale — the new owner IS recorded when a sale lands.
4. `sale_transaction_id` FK links a closed listing to its sale (the comp linkage holds).

### The gaps

#### 1. HEADLINE — the BD action loop is open (0 of 65 events ever processed)
`lcc_listing_events` (LCC Opps) holds **65 sale events, ALL `processed_at IS NULL`** (gov 25,
dia 40, range 2026-02-23 → 2026-06-05). Two crons (`lcc-listing-event-sync-fire` :25,
`-finalize` :30, every 4h) **populate** the queue — but **no cron or handler consumes it.** The
R5 machinery to act on a sale all exists and is unused: the fan-out functions
(`lcc_listing_same_owner_cohort`, `lcc_listing_buyer_cohort`, `lcc_listing_geographic_neighbors`),
the triage view `v_lcc_listing_event_queue`, and `lcc_mark_listing_event_processed`. So a closed
deal never becomes a next-best-action:
- the **seller** is now a past client to nurture,
- the **buyer** is a new owner relationship + a future seller,
- the **same-owner cohort** is more properties to pursue,
- a **sale-leaseback** is a financing/advisory angle.
The queue fills every 4h and never drains. This is the core of the thread's question — the system
records the sale but does not act on it.

#### 2. dia listing-status vocabulary is fragmented (no gov parity)
gov uses a clean lowercase controlled vocab (`active`/`sold`/`superseded`/`under_contract`/
`withdrawn`/`orphan`) + `is_active`. dia is free-text: **`Sold`(1904) vs `sold`(1289)**,
`Active`/`active`/`Available`, `Superseded`/`superseded`, `closed`/`Closed but Obligated`,
`Off Market`, `Stale`, `Imported-Estimate`, `Draft-Commenced`, null — and **`is_active`
disagrees with `status`** ("Active" rows with `is_active=false`). Linkage is weaker on the legacy
capital-S set: **181 of 1,904 "Sold" have no `sale_transaction_id`** (vs 1,289/1,289 for
lowercase "sold"). Any status-keyed metric or close-loop logic is unreliable on dia.

#### 3. A few gov sold-path leaks (small, real)
3 active gov listings are overdue + never-verified yet have a recorded same-property sale at/after
the listing date and weren't auto-closed (property_ids 16306 / 16369 / 30949; sales 2024-12 →
2025-12). The matcher runs but isn't catching them (needs a code look at the match key/window).
Plus 1 case-variant `"Sold"` (gov) and an `under_contract` row with null `verification_due_at`
that's invisible to the overdue-based matcher.

#### 4. Event sync may be quiet/stalled (secondary)
0 new `lcc_listing_events` in the last 14 days (latest 2026-06-05). Could be a genuinely quiet
fortnight or a stalled fire cron — worth a glance, but secondary to the missing consumer.

## Fix doctrine → CLAUDE CODE PROMPT R48
The data closes the loop; the action doesn't. Wire the consumer, normalize dia, plug the leaks.
- **Unit 1 (headline) — the listing-event consumer.** A bounded, idempotent processor that drains
  `v_lcc_listing_event_queue`: per new sale event run the R5 fan-out and produce a **value-ranked
  Decision Center "new sale → act" lane** (human-gated, NOT auto-blast — matches the R5 buyer
  doctrine + Decision Center pattern): nurture-seller / new-buyer-relationship / pursue-cohort /
  flag-sale-leaseback. Mark processed via `lcc_mark_listing_event_processed`. Drains the 65 and
  keeps draining. Optionally add the missing process cron.
- **Unit 2 — normalize dia listing-status** to the gov controlled vocab (case-fold + synonym-map;
  reconcile `is_active` with `status`; backfill `sale_transaction_id` on the 181 legacy "Sold"
  where a sale matches). Reversible/snapshot. **Listing-count metrics may move — before/after for
  Scott**, per the metric-consistency doctrine.
- **Unit 3 — close the gov sold-path leaks.** Fix the matcher so overdue active listings with a
  recorded same-property sale at/after listing actually close (the 3); fold the case-variant
  `"Sold"`; decide `under_contract`/null-due handling. Small, reversible.

## Bottom line
The listing→sale DATA loop is healthy on gov and dia — sales close listings, record the comp, and
update ownership. The open loop is ACTION: 65 sale events sit unprocessed because the BD consumer
was never wired (only the sync crons run). R48 wires the consumer as a value-ranked, human-gated
Decision Center lane, brings dia's status vocab to gov parity, and plugs the handful of gov
sold-path leaks — so a closed deal finally becomes the next best BD action and keeps doing so as
new sales land.
