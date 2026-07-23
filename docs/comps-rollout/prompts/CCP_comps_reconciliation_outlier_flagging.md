# Claude Code Prompt — Comps Cap/Rent Reconciliation + Outlier Flagging + Dialysis Review Queue

## Objective
Team Briggs policy is "deliver the most accurate information we have." Today a sold comp can reach
the export with a **rent that doesn't reconcile to its reliable cap** — e.g. Pearland (dia sale_id 7980,
property 35837): the template computes `SOLD CAP = RENT ÷ SOLD PRICE = 210,087 ÷ 4,776,704 = 4.40%`, but
the reliable `cap_rate_final = 7.00%` (source_reported) and `rent_at_sale = 307,588`. That 4.40% is an
outlier that should be **flagged at comps-generation time and routed to the dialysis workflow for
correction** — not silently shipped, and not silently "fixed" by swapping the rent basis.

**Do NOT change the displayed rent basis globally.** Keep RENT = the in-place rent we show today.
Add a reconciliation layer that detects and surfaces divergence, and a queue to fix the source data.

## Scope: both DBs where applicable (dialysis primary; government has separate NOI col so lower risk).

## Implement
1. **Reconciliation signal (per sold comp), computed in the comps engine (`mcp/comps-tools.js`
   `runComps`, after the rows are normalized).** For each sold comp compute:
   - `implied_cap = displayed_rent / sale_price` (dialysis: RENT/price; gov: NOI/price).
   - `reliable_cap = cap_rate_final` (dia) / `sold_cap_rate` (gov).
   - Flags (tag each that trips, with the numbers):
     - `cap_mismatch` when `abs(implied_cap - reliable_cap) > 0.0075` (75 bps) and both present.
     - `rent_disagreement` when the available rent sources disagree beyond 10% — compare
       lease-view `annual_rent`, `anchor_rent`, and `rent_at_sale` (from `raw`); flag if
       `max/min > 1.10`.
     - `price_over_ask` when `sale_price > 1.10 * coalesce(last_price, initial_price)` (sold >10%
       over last ask — Pearland sold $4.78M on a $3.63M ask) or `< 0.85 *` (well under ask).
     - `no_reliable_cap` when there's no reliable cap at all (already excluded by the gate, but tag
       if it slips through).
   - Attach `review_flags: [...]` + `review_detail: {implied_cap, reliable_cap, rents:{...}, ask, sold}`
     to the comp. **Non-destructive** — the comp is still returned/exported; it's just marked.
2. **Surface at generation.** Add to `runComps` meta a `flagged_for_review` count and a compact list
   (`comp_id`, address, the tripped flags, the numbers). `formatCompsMarkdown` gets a trailing
   "⚠ N comps flagged for review" line so whoever runs the pull sees it immediately. The generator
   (`comps_generator.py`) does not need a new column — flagging lives in the engine/response, not the
   workbook grid (Scott: keep the grid clean).
3. **Dialysis review queue (persist for follow-up).** Create `dia_comp_review_queue` on the dialysis DB
   (id, sale_id/property_id, comp_id, flags text[], detail jsonb, implied_cap, reliable_cap,
   first_flagged_at, status default 'open', resolved_at, resolution_note). Upsert on (sale_id, flags-hash)
   so re-pulls don't duplicate. A row lands here whenever a comp trips a flag. This is the worklist the
   dialysis workflow drains to correct rent/cap at the source so future pulls are clean. Add the same
   shape on the gov DB (`gov_comp_review_queue`) for parity even if lower volume.
4. **Options normalization (Scott: "options don't follow a standardized output").** Renewal options come
   through as free text ("2, 5 yr", "Three, 5-Year Options", "2, 5yr", "Two, 5-Year Options"). Add a
   `normalizeRenewalOptions()` in the comps engine that parses count + term-length → canonical
   `"(N) M-yr"` (e.g. `(2) 5-yr`, `(3) 5-yr`); pass through unrecognized shapes unchanged and log them.
   Apply on the comp before export so every surface emits the standard form.
5. **Docstring/contract cleanup (`comps_generator.py` + the `generate_comps` MCP tool description).**
   The input contract still lists `property_name`, `submarket`, `buyer`, `seller`, `financing`, which
   have **no column** in any current template, and the old short forms `st`/`init_price`/`yr_built`
   (now aliased, keep the aliases). Trim the documented default contract to the real columns and note
   that buyer/seller/financing are **opt-in only** (Scott: keep them out of comps unless the user
   explicitly requests them) — do not add those columns to the templates now.

## Verify / report
- Re-pull dialysis sold comps; confirm Pearland (7980) trips `cap_mismatch` + `price_over_ask`, lands in
  `dia_comp_review_queue`, still appears in the set, and the meta shows the flag. Confirm clean comps
  (e.g. South Bend 7.59%) are NOT flagged.
- Report how many of the current live sold set flag, grouped by flag type (a first worklist size).
- Confirm options render as `(N) M-yr` across a sample and list any shapes the normalizer passed through.

## Guardrails
- Non-destructive: flagging never drops or alters a comp's values; it annotates + enqueues.
- Thresholds as constants at the top of the module so Scott can tune (75 bps / 10% / ±10-15% ask).
- Reversible migrations for the queue tables. No change to the reliability gate or the RPC output contract
  beyond the additive `review_flags`/`review_detail` fields. Logged, dry-run first.
