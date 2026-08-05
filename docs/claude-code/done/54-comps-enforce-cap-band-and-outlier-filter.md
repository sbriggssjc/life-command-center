# Prompt 54 — Comps engine: clean the DISPLAYED set (cap band, reliability, formatting, DOM)

## Why (live connector export, 2026-08-05)
`generate_comps` for The Villages runs, resolves the subject, and returns a conforming workbook — but the DISPLAYED
comp set is not appraiser-clean. Downloaded and inspected the produced workbook:
- **Out-of-band caps in the selected rows:** Sold includes 1625 Unity Way NW at **7.15%** and On Market includes
  6450 Seminole Blvd at **7.77%** — above the subject 6.75% + 35 bps = **7.10% ceiling**. The response `summary`
  reports "6.41%-7.08%" (its "reliable sold primary set") but the actual sheet contains higher-cap rows — the
  cap-discipline band (prompt 52 / canon v1.4.0) is applied to the summary STAT, not as a hard filter on shipped rows.
- **Bad-data outliers shipped:** a Sold row with **0.54% cap and $3/SF rent**, On Market rows at **0.67% cap /
  $8/SF and $74/SF** — rent-or-SF errors (~10x off). Reliable-or-exclude, don't display.
- **Sold TENANT not standardized:** raw values ("DaVita Dialysis", "DaVita Kidney Care", "Fresenius Meical Care"
  [sic], "Davita ... (Dark)", CMS-code-prefixed names) instead of the canonical operator brand shown on On Market.
- **On Market STATUS blank** — the view carries `status` (Active); it must render (default **"Available"**).
- **BUMPS formatting drift:** a bare "2.75" (should be "2.75% / yr"), "2.5%/Yr" not normalized; blank bumps left
  blank (should default to **"Flat"** when there are no increases).
- **DOM errors:** Sold ON-MARKET/DOM either blank (0/25) or, where a list date exists, implausible — a **negative**
  DOM and several **>2,000 days** (stale/old list dates producing meaningless DOM).

(The hand-built DB-direct version filtered/normalized all of this: Sold caps 4.62-7.07%, RENT/SF 13-46, avg 6.28%,
canonical tenants, STATUS "Available", bumps normalized + "Flat" default, DOM blanked when <0 or >1000.)

## Task
1. **Cap band as a HARD filter on the displayed set** (not just the summary): every shipped Sold/On-Market row has
   displayed cap = rent/price **<= subject cap + 35 bps**, and the Sold set **average below the subject**. Out-of-band
   comps are excluded from the sheet (still fine for context stats), never merely flagged. The response `summary`
   cap range must MATCH the rows in the sheet.
2. **Reliability-or-exclude on displayed metrics:** drop comps with displayed **RENT/SF** outside ~12-60 or displayed
   cap < 4.5% (rent/SF/price errors); route to the review lane, do not ship.
3. **Canonical operator brand in TENANT on BOTH tabs.** Map raw tenant/operator to the brand (DaVita; Fresenius
   Medical Care incl. FMC/BMA/Bio-Medical/Renal Care Group/Liberty Dialysis; US Renal Care incl. USRC; American
   Renal; Innovative Renal Care; Renal Treatment Centers -> DaVita), strip CMS-code prefixes and "(Dark)" suffixes.
   Sold must match On Market.
4. **STATUS defaults to "Available"** (Active -> Available) or the actual listing status; never blank on On Market.
5. **BUMPS normalization:** "X%/Yr" / "X% annually" / "X% every N" -> "X% / yr" or "X% / N yrs"; a **bare decimal**
   ("2.75") -> "2.75% / yr"; a genuinely-empty bumps -> **"Flat"** (no increases), not blank.
6. **DOM plausibility:** join the real (non-synthetic) `available_listings.on_market_date` so Sold shows ON MARKET +
   DOM, BUT blank the date when the computed DOM is **< 0 or > ~1000 days** (stale/erroneous list date) rather than
   show a misleading DOM. Same guard on On Market.
7. Keep everything from 52 intact (operator = similarity anchor, drop bare dupes, displayed-cap basis) and the
   recency guarantee (a handful of trailing ~7-9-month sales).

## Verify
`generate_comps` for "The Villages DaVita — 1050 Old Camp Rd": every displayed cap <= 7.10%; no RENT/SF <12 or >60 or
cap <4.5%; Sold average below 6.75%; TENANT canonical and identical in style across both tabs; On Market STATUS
populated; no bare-decimal bumps and no blank bumps (empty -> "Flat"); no DOM < 0 or > 1000; response `summary`
matches the sheet. Confirm against the downloaded sheet, not just the JSON.

## Note (for Scott's call)
Woodland Hills (21,080 SF) doesn't rank into the top-25 by pure similarity to the 6,453-SF subject — correct. If we
want our OWN recent closings always included regardless of size, that's a separate "always-include-our-deals" rule.
