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

## JS writer guards (the go-forward cause-fix — ships on Railway redeploy)

The DB triggers/indexes are the backstop; these stop the duplicates at the source.

1. **gov `upsertGovListings` (`api/_handlers/sidebar-pipeline.js`) and the gov OM promoter
   path (`api/_handlers/intake-promoter.js`):** drop `listing_date` from the upsert conflict
   key and switch to **property-first**: look up the open active row for the property
   (regardless of source/date); PATCH it for the same iteration; only INSERT (and let the
   `supersede-prior-active` trigger retire the old one) for a genuinely new iteration. This is
   what stops the daily-OM-reingest row explosion (gov property 16350: 11 rows → 1).
2. **dia `promoteDiaPropertyFromOm`:** check for an open active row before INSERT instead of
   relying on the unique index to throw — PATCH-or-supersede explicitly.
3. **Availability-checker:** never stamp `off_market_date` on a row with NULL `listing_date`
   without first setting `listing_date = first_seen`; never stamp a future date (now also
   blocked by the CHECK).

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
