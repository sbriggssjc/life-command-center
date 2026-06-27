# Claude Code prompt — T9d (rewrite): provenance-first listing currency — recover dates, keep every evidenced deal

> Replaces the rejected exclusion-based T9d (reverted). **Doctrine (Scott, 2026-06-26):** a listing is
> evidence of an "available for sale" deal if we hold ANY real source for it — an OM, flyer, email summary,
> fax, comp, or CoStar/RCA capture. A live URL is NOT required; commercial has no MLS, and we'll never reach
> 100%. So: **keep every provenance-backed listing; recover its true on-market date from the source document;
> infer exits conservatively; and fix the ingest path so it stays accurate going forward.** Never delete or
> exclude an evidenced deal for lacking a URL or a clean date. dia `zqzrriwuavgrquhisnoa`. Constructive
> (date recovery, not exclusion); reversible; no fabricated dates; ≤12 api/*.js. Run AFTER the revert.

## The problem (grounded live 2026-06-26)
The dia available count was both inflated and (under the rejected fix) wrongly collapsed. Root facts:
- **The mass-email import stamped a single 2026-06 `listing_date_source='capture_date_fallback'` date** on a
  batch of historically-received OMs — a fake *ingest* date, not the real receipt date. That fake-recent date
  is what surges the impending 2026-06-30 quarter (272). The TRUE date sits behind the listing's
  `intake_artifact_path` (the OM/email/flyer) and in the intake pipeline.
- **183 active-open listings have NULL `on_market_date`; 91 of them carry an intake artifact**
  (`offering_memorandum`/`om`/`flyer`/`marketing_brochure`/`email_update`/`comp`) — real evidenced deals
  missing only a clean entry date. These must be DATED, not dropped.
- There is no live re-verification (0/323 ever URL-checked) — so currency is entry + exit + a generous
  age-out backstop, NOT a live check.

## Unit 1 — recover the true on-market date from provenance (the core, constructive)
Build an on-market-date recovery that fills/repairs `on_market_date` from the **earliest real evidence** we
hold for each listing, in priority order (use the earliest credible date — a property may be marketed more
than once, but for a given listing record use the earliest evidence of THAT listing):
1. `sf_on_market_date` (already recovered, T4c) — keep.
2. **The intake artifact's source date** — trace `intake_artifact_path` (+ the intake/promotion linkage to
   the LCC `staged_intake_items` / artifact metadata) to the **email received date / OM document date** and
   use it. This is the T4c analog for the OM/email/flyer channel and is the main recovery.
3. A genuine `listing_date` (where `listing_date_source` is a real capture — CoStar/RCA capture date — NOT
   `capture_date_fallback`).
4. Any other real first-evidence timestamp (first_seen, a real created/received date).
- **Replace the fake `capture_date_fallback` dates** with the recovered real date. Stamp
  `on_market_date_source` to record provenance (e.g. `om_receipt`, `email_receipt`, `costar_capture`,
  `sf_on_market_date`) + a confidence. **No fabrication:** only real evidence dates; where the precise date is
  unknown but the artifact exists, use the artifact's received date (the best real evidence) and flag the
  confidence — do NOT invent a date and do NOT fall back to today/ingest time.
- Reuse the `cm_dia_t9d_on_market_sweep_backup` (don't drop) + add a fresh backup of any row whose
  `on_market_date` this changes, for reversibility.

## Unit 2 — currency model: keep every evidenced deal, window it honestly
Rebuild `cm_dialysis_active_listings_m`/`_q` membership as:
> available at `period_end` iff the listing has real provenance AND a recovered `on_market_date <= period_end`
> AND `(off_market_date IS NULL OR > period_end)` AND `(sold_date IS NULL OR > period_end)` AND
> `(period_end - on_market_date) <= MAX_DOM_CAP`.
- **MAX_DOM_CAP = a GENEROUS plausible-listing-life cap** (e.g. the p90 closed DOM ≈ 1356d, or wider) — it is
  a backstop to age out deals we've simply lost track of (no recorded exit), NOT a pruning tool. A deal stays
  counted across its real on-market→(exit or on_market+cap) window, so it is correctly "available" in its
  historical window AND correctly NOT "available now" if that window has passed.
- **Retire** the `last_seen/url_last_checked/last_verified_at/listing_date` currency proxy and the
  `listing_date` entry gate. Keep the synthetic guards (`data_source<>'synthetic_from_sale'`,
  `listing_date_source NOT LIKE 'sale_anchor%'`). `listing_date` stays raw/audit.
- **A listing with provenance but still no recoverable date after Unit 1** is NOT deleted — keep it, flag it
  `date_uncertain`, and (decide + report) either (a) include it via its artifact-received date if any, or
  (b) hold it in a `date_uncertain` bucket surfaced separately so it's visible, not silently dropped. Default
  to KEEPING evidenced deals; exclude only rows with NO real provenance at all.

## Unit 3 — fix the INGEST path so this stays accurate going forward (the durable half)
This is the "remains accurate as new ingestion occurs" requirement. In the OM/email/capture promotion path
(`intake-promoter.js buildDiaListingRow` and the sidebar/CoStar capture path):
- Set `on_market_date` at promotion from the **source-document date** (email received date / OM date /
  capture date), NOT a `capture_date_fallback = today` stamp. The fake-fallback that caused this whole surge
  must not be written as a market-entry date again.
- Keep `last_seen`/`last_verified_at` reserved for genuine live sightings/checks (T9c) — do not stamp them as
  a proxy for currency.
- So a newly-ingested OM lands at its real on-market date and is correctly windowed by Unit 2 — no recurrence.

## Unit 4 — fold in the close-on-sale landmine (surfaced by the prior round)
`fn_listing_close_if_sold`: with a NULL `on_market_date` its sale-match window collapses to "any past sale on
the property," so it can auto-close a listing as Sold against an old/unrelated sale; it also hit an orphaned
`property_sale_events.sales_transaction_id=5701` (dangling FK). After Unit 1 most listings have a real
`on_market_date`, but harden the trigger: require the matched sale to be within a sane window of the listing's
on_market_date (not "any past sale"), and null/repair the orphaned `5701` FK. Reversible.

## Unit 5 — verify (report before/after)
- **2026-03-31** active: should be the honest evidenced count (NOT 75, NOT a fabricated 122 — the genuinely-
  available-then count, with recovered dates). Report it + the composition (recovered-date / sf / costar /
  date_uncertain).
- **2026-06-30**: the fake-date surge is gone (no 2026-06 `capture_date_fallback` entries) — report the honest
  number, materially below 272.
- **No evidenced deal dropped:** the count of provenance-backed listings excluded for lack of a URL/date = 0
  (date_uncertain ones are kept/surfaced, not deleted). Report recovered vs date_uncertain counts.
- Asking-cap quartiles / DOM / market-size / turnover / backlog all read sane on the recovered basis.
- If membership at published quarters changes, footnote it as a recovery-driven restatement (the T4c pattern).

## Gate
- Every evidenced (OM/flyer/email/fax/comp/capture) listing is retained; dates recovered from real provenance
  (no fabrication, no today/ingest fallback); the fake `capture_date_fallback` entry dates are replaced.
- Currency = entry + exit + generous age-out; the proxy is retired; ingest path no longer writes a fake
  market-entry date (forward-safe). Close-on-sale trigger hardened + orphan 5701 repaired.
- Before/after reported; 0 evidenced deals excluded for lack of URL/date; reversible; dia only; ≤12 api/*.js.

## Boundaries
- Constructive recovery, never exclusion-by-default. The count is best-effort and will never be 100%
  (commercial has no MLS; principal-to-principal and never-shared listings exist) — represent what we have
  evidence for, dated as accurately as the evidence allows, and don't drop evidence we hold.
