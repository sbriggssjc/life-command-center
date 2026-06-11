# Proposed migrations — Listing-Lifecycle Remediation (GATED)

**Nothing here is applied.** Each `.sql` defaults to `ROLLBACK`. These live OUTSIDE
`supabase/migrations/{government,dialysis}/` on purpose, so no migration runner can pick
them up before the gate. On sign-off, move each into the matching domain migrations folder
with a timestamp prefix and flip `ROLLBACK`→`COMMIT` (and run the `CONCURRENTLY` index
separately).

Read `00_GATE_SHEET.md` first — it states the 5 decisions with recommendations and the
counts to independently verify.

## Files & apply order (after sign-off)

| Order | File | DB | Txn-safe? | Notes |
|---|---|---|---|---|
| 1 | `gov_backfill.sql` | gov | yes (ROLLBACK default) | G1 collapse dups · G2 close-on-sale (2-tier) · G3 phantom repair · G4 stale opens |
| 2 | re-audit gov | gov | — | confirm active = DISTINCT property, 0 overlaps |
| 3 | `gov_writer_guards.sql` | gov | mostly | close-on-sale trigger + supersede-prior-active trigger + future-date CHECK; **one-active index is CONCURRENTLY, run separately** |
| 4 | `dia_backfill.sql` | dia | yes (ROLLBACK default) | D1 end superseded windows · D2 collapse same-day dups · D3 status normalize · D4 contradictions (no active-count change) |
| 5 | re-audit dia | dia | — | confirm ~0 point-in-time overlaps, active 806=806 |
| 6 | `dia_writer_guards.sql` | dia | yes | future-date CHECK + active⇄off_market trigger (index + close trigger already exist) |
| 7 | JS writer guards | app | — | see below — coordinated with the sales-dup family |

## JS writer guards (the go-forward cause-fix — IMPLEMENTED in this commit, ships on Railway redeploy)

The DB triggers/indexes are the backstop; these stop the duplicates at the source. **These
JS edits are part of this PR and release in lockstep with the DB guards** (deploy-order-safe
either way: the DB trigger/index backstops a stale writer, and the property-first writer is
correct even before the index exists).

1. **gov OM promoter — `api/_handlers/intake-promoter.js` (DONE).** Was inserting via
   `on_conflict=source_listing_ref` (the intake_id) with only a same-date 23505 fallback, so
   each daily OM (new intake_id + drifting `listing_date`) minted a fresh active row
   (property 16350: 11 rows). Now **property-first**: look up ANY active row for the property
   and PATCH it (enrich; never write `is_active`/`listing_status`/`listing_date`); INSERT only
   when none exists. This is the fix for the 143 `lcc_intake_om` excess rows.
2. **gov sidebar — `api/_handlers/sidebar-pipeline.js::upsertGovListings` (DONE).** Its
   active-row pre-check was scoped to `listing_source=costar_sidebar&listing_status=Active`,
   so a CoStar re-scrape sat beside an OM-sourced active row. Broadened to **property-first**
   (`is_active=eq.true`, any source) so all channels converge onto one active row.
3. **dia OM promoter — `intake-promoter.js` (ALREADY property-first).** It already looks up any
   `is_active=true` row for the property and PATCHes it (Round 76eg) — which is exactly why
   dia's snapshot is already 1:1. No change needed; gov now matches it.
4. **Availability-checker (FOLLOW-UP, not in this commit).** The edge function should never
   stamp `off_market_date` on a row with NULL `listing_date` without first setting
   `listing_date = first_seen` (the G3 phantom cause). Future-date stamps are already blocked
   by the `al_off_market_not_future` CHECK in the writer-guard SQL. The TS edge-function edit
   is a small focused follow-up.

> **Minor follow-up:** the gov sidebar convergence PATCH still writes the capture's
> `listing_source`/`listing_date` onto the converged row (pre-existing behavior, now applied to
> a possibly-OM row). That relabels source + shifts the window start to the latest touch — a
> fidelity nit, not a duplicate. Excluding those from the sidebar PATCH (as the OM-promoter
> path now does) is the clean follow-up if window-start fidelity matters.

## Coordinate with the sales-dup root-cause family (one fix, not two)

The **dia phantom-dup sales** and the **gov listing re-ingest dups** are the *same
root-cause family*: a re-capture mints a duplicate row because the **dedup/conflict key
includes the capture date**, so a date variant evades the conflict. Fix the cause once, in
the same shape on both writers:

| Surface | Wrong key (date in it) | Correct key |
|---|---|---|
| **Listings** (this work) | `(property_id, listing_source, listing_status, listing_date)` | **property-first**: one open active row per property; new capture PATCHes it, a new iteration supersedes the prior |
| **Sales** (sibling thread) | conflict/fingerprint that includes `sale_date` | **price/property fingerprint**: `(property_id, round(sold_price), buyer/seller)` — drop `sale_date` from the identity so a re-captured sale with a date variant updates instead of inserting |

Both land the same doctrine: **identity = the real-world object (this property's current
on-market iteration / this property's sale), not the capture event.** Keeping the two writer
guards in lockstep (same review, same release) avoids fixing the symptom twice and re-opening
it on the side we didn't touch.
