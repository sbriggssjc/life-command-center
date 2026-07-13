# Claude Code (life-command-center) — intake lane: sanity-gate garbage prices + normalize cap-rate display

## Why (verified live on LCC Opps `xengecqvemvfknjvbvrq` 2026-06-30, post PR #1376)

The rebuilt "Staged intake — needs review" lane is now workable (103
create-candidates, content rendered, value-ranked by asking price). Verifying it
live surfaced two small data-quality issues the fix made VISIBLE (it didn't
create them — they were always in the extractions):

1. **Garbage asking prices poison the top of the value rank.** Of 400 priced
   `review_required` items, **393 are plausible; only 4 are junk** — topped by
   `$750,200,011,294,000` ($750 trillion). Those top two cards are a
   multi-property OM the extractor mashed into one row: address
   `1208 Scottsville Road|350 Preakness Avenue`, tenant
   `Fresenius Medical Care Holdings, Inc.|Walgreen Eastern Co., Inc.`, and two
   prices concatenated into one absurd number. Because the lane sorts by price,
   this garbage sits at **#1** — exactly where you want the realest deal.
   Live counts: `>1B` = 3, `100M–1B` = 1, plausible (100k–100M) = 393,
   max = 750200011294000.
2. **Cap-rate display is inconsistent** — some cards render `cap 0.0555`
   (decimal) and others `cap 5.24` (percent), because the source `cap_rate`
   field is stored both ways across extractions.

## Unit 1 — asking-price sanity gate (display + ranking only; do NOT mutate the extraction)

In the `intake_disposition` classifier / card projection (`intake-classify.js` +
`admin.js fetchFederatedSource`), treat an implausible asking price as
**not a usable rank value**:
- Define a sane ceiling (e.g. `INTAKE_ASKING_PRICE_MAX` ≈ **$1,000,000,000** — a
  $1B single-asset net-lease deal is already far beyond anything in this book;
  tune if you prefer $500M). A parsed `asking_price` above the ceiling is
  **treated as absent for ranking** (rank by it as NULL → sorts to the bottom,
  not the top) AND flagged on the card as a suspect value rather than shown as a
  clean price.
- On the card, render a suspect price distinctly — e.g. `⚠ price looks wrong
  ($750,200,011,294,000)` or simply suppress the number and show `price: suspect`
  — so the operator sees it needs re-extract, not that it's a $750T deal. The
  **Re-extract (OCR)** action is the natural next step for these (the underlying
  OM is a multi-property doc that needs re-parsing / splitting).
- This is display + ranking only — do **not** overwrite `raw_payload`'s stored
  value (preserve the audit trail; the real fix is re-extraction).
- Optional (nice-to-have): also flag the pipe-concatenated multi-address /
  multi-tenant shape (address or tenant containing `|` or a 2-element array) as
  "multi-property OM — needs split/re-extract", since that's the actual root
  cause of the garbage number. Keep it a soft flag, not a hard exclusion.

## Unit 2 — normalize cap-rate on the card

Normalize the displayed cap rate to ONE format (recommend percent, e.g.
`5.55%`). The stored `cap_rate` arrives both as a decimal (`0.0555`) and as a
percent (`5.24`). Use the standard heuristic already used elsewhere in the app:
a value `< 1` is a decimal (×100), a value `≥ 1` (and ≤ ~20) is already a
percent; values outside a sane band (e.g. > 25) render as suspect / omitted.
Apply at the card render layer (`ops.js`) — display only, don't mutate the
source. (If a shared cap-rate formatter already exists, reuse it.)

## Boundaries / verify

- life-command-center; `intake-classify.js` (rank value), `admin.js`
  (projection/order), `ops.js` (card render); no new api/*.js (stays 12); no
  migration; no domain (dia/gov) writes; no mutation of `raw_payload`.
- **Verify (live, read-only):** after deploy the lane's top cards are the real
  high-value deals (the $750T row sorts to the bottom / shows a suspect flag, not
  #1); cap rates all render in one format (e.g. `5.55%`); the 103 count is
  unchanged (this is ranking/display, not gating).
- `node --check` (intake-classify.js, admin.js, ops.js); suite green; extend the
  classifier test: an above-ceiling asking_price yields a NULL/suspect rank value
  (not a top sort); a decimal and a percent cap both normalize to the same
  displayed string.

## Documentation

Update CLAUDE.md (intake_disposition lane): asking prices above
`INTAKE_ASKING_PRICE_MAX` are treated as suspect (ranked NULL + flagged on the
card, Re-extract prompted; raw payload preserved); multi-property pipe/array
address+tenant flagged as needs-split; cap-rate display normalized to one format.
Display/ranking only — the real fix for a suspect row is re-extraction.

## Bottom line

Value-ranking only works if the top of the list is trustworthy. Four garbage
extractions (a $750T multi-property mash-up at #1) currently sit above 393 real
deals — sanity-gate implausible prices so they rank last + flag for re-extract,
and normalize the cap-rate display. Small, display-only, reversible; makes the
now-workable lane actually trustworthy at the top.
