# Claude Code — R48: close the listing→sale ACTION loop (wire the consumer + dia status parity + sold-path leaks)

## Why (audit live 2026-06-19 — see AUDIT_listing_sale_lifecycle_close_loop_2026-06-19.md)
The listing→sale DATA loop is healthy (gov 2,086/2,116 sold linked; dia 0 active-leak; 96% of
recent gov sales record an ownership_history segment). The ACTION loop is open:
- **`lcc_listing_events` = 65 events, 0 EVER processed** (gov 25, dia 40). Two SYNC crons
  (`lcc-listing-event-sync-fire` :25 / `-finalize` :30 every 4h) POPULATE it; **no consumer
  drains it.** The R5 machinery to act on a sale exists and is unused: fan-out
  `lcc_listing_same_owner_cohort` / `lcc_listing_buyer_cohort` /
  `lcc_listing_geographic_neighbors`, triage view `v_lcc_listing_event_queue`, and
  `lcc_mark_listing_event_processed`.
- **dia listing-status is fragmented** (`Sold`1904/`sold`1289, `Active`/`active`/`Available`,
  `Superseded`/`superseded`, `closed`/`Closed but Obligated`, `Off Market`, `Stale`, null;
  `is_active` disagrees with `status`); 181 legacy "Sold" lack `sale_transaction_id`. gov has a
  clean lowercase vocab + `is_active`.
- **3 gov sold-path leaks**: overdue + never-verified active listings (prop 16306/16369/30949)
  with a recorded same-property sale at/after listing, not auto-closed; + 1 case-variant `"Sold"`;
  + an `under_contract` null-`verification_due_at` row invisible to the overdue matcher.

## House rules (same as R5/R46/R47)
Reuse the R5 fan-out + mark-processed machinery — don't fork it. Human-gated BD (Decision Center
lane, value-ranked) — **NOT auto-blast outreach** (the R5 buyer doctrine). Reversible/snapshot for
the dia normalization; idempotent; effect-first/outcome-truthful verdicts; ≤12 `api/*.js`;
`node --check`; suite green; DB live after a dry-run; cache-or-live safe. dia status changes can
move listing-count metrics → **before/after for Scott** (metric-consistency doctrine); no
published number changes without his sign-off.

## Unit 1 (headline) — wire the listing-event consumer
A bounded, idempotent processor that DRAINS `v_lcc_listing_event_queue` (the 65 now + steady
state). Per unprocessed sale event, run the existing R5 fan-out and emit a **value-ranked
Decision Center "new sale → act" lane** (`decision_type='listing_event_action'`, reuse the
federated-lane + verdict machinery in `admin.js`/`ops.js` from R7/R46/R47). Each event resolves to
one or more BD actions, human-confirmed:
- **nurture_seller** — the seller is a past client → seed/refresh a buy-side or relationship
  cadence on the seller entity (reuse the cadence path; do NOT auto-send).
- **new_buyer_relationship** — the buyer is the new owner + a future seller → ensure the
  owner→asset edge + open a relationship (reuse R5/R6 owner resolution; if the buyer is a
  registered/affiliated parent, route to the existing P-BUYER path instead of duplicating).
- **pursue_cohort** — surface the same-owner cohort / geographic-neighbor fan-out as pursue
  targets (the operator picks which to work).
- **flag_sale_leaseback** — when `is_sale_leaseback` (already in `v_lcc_listing_event_queue`),
  flag the advisory angle.
- **dismiss** — not actionable (record + stop-asking).
Mark each event `processed` via `lcc_mark_listing_event_processed` only after its verdict/effect
lands (effect-first; a failed effect keeps it open). Add the missing **process cron** (gentle
cadence, e.g. hourly or every 4h offset from the sync) so the queue keeps draining. Verify the
fire cron is actually inserting (0 new events in 14d — confirm quiet vs stalled; fix if stalled).

## Unit 2 — dia listing-status → gov parity (reversible)
Normalize `available_listings.status` (dia) to the gov controlled vocab: case-fold + synonym-map
(`Sold`→`sold`, `Active`/`Available`→`active`, `Superseded`→`superseded`, `closed`/`Closed but
Obligated`→`sold` or a `closed` canonical, `Off Market`→`off_market`, `Stale`→a defined state,
`Imported-Estimate`/`Draft-Commenced`→decide). **Reconcile `is_active` with the canonical status**
(an `active` status ⇒ `is_active=true`, terminal ⇒ false) — fix the contradictory rows. **Backfill
`sale_transaction_id`** on the 181 legacy "Sold" rows where a same-property sale matches (reuse the
auto-scrape matcher logic; only fill blanks, never relink). Snapshot prior values to a reversible
backup (mirror R37/R42). Report the before/after listing-status distribution + any change to
active/sold counts for Scott BEFORE relying on it in metrics.

## Unit 3 — close the gov sold-path leaks (small)
- Fix the auto-scrape matcher so an overdue active listing with a recorded same-property sale
  at/after `listing_date` actually closes (the 3: 16306/16369/30949). Inspect
  `handleAutoScrapeListings` — likely the match key/window or per-tick cap is skipping them;
  make the sold-match deterministic for these.
- Fold the 1 case-variant gov `"Sold"` → `sold`.
- Decide `under_contract` + null-`verification_due_at` handling so it isn't invisible to the
  overdue matcher (backfill a due date or include null-due in the sweep).
Reversible; idempotent.

## Verify (report back)
Before/after: listing_events processed (0/65 → ?), the new lane's open count, a verdict
round-trip per action type (0 residue); dia status distribution before/after + active/sold deltas;
the 3 gov leaks closed + linked to their sale; no regression to the auto-scrape sold/inferred
counts or the P-BUYER/operator rollups. Confirm the process cron drains steady-state.

## Bottom line
The sale already updates the listing, the comp, and ownership — but the system never ACTS on the
closed deal. R48 wires the listing-event consumer as a value-ranked, human-gated Decision Center
lane (drains the 65 + keeps draining), brings dia's listing-status vocab to gov parity, and plugs
the few gov sold-path leaks — so a closed deal becomes the next best BD action and the lifecycle
loop is closed end to end.
