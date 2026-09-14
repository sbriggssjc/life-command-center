# Prompt 57 — Comps: OPTIONS normalization + lease-term discipline (exclude no-term / short-term / no-price comps)

## Why (live connector export, 2026-08-06 — post-56 verify against the downloaded sheet)

Prompt 56 fixed STATUS (On Market now "Available" on every row), BUMPS (both tabs normalized —
"Flat", "10% / 5 yrs", "2% / yr", "CPI annually"), and the summary range (now matches the sheet).
Confirmed in the downloaded workbook. Four issues remain, all verified against the sheet:

### 1. OPTIONS is not normalized (both tabs, many formats)
The OPTIONS column ships every raw spelling side by side. From the live Sold + On Market tabs, verbatim:
`(3) 5-yr`, `(2) 5-yr`, `3`, `None`, `Two (2) Five (5) Year`, `three five-year options`,
`One, Five-Year Period`, `Two (2), Five (5) Year`. BUMPS got a shared normalizer in 56; OPTIONS never did.

### 2. Sold comps with NO lease expiration, or < 3 years remaining at close, are being displayed
The TERM math is correct — it's term **at the sale date** (e.g. 614 S Cannon Blvd shows 9.96 yr from its
2025-09 sale; 1201 Pennsylvania 14.15 yr). The problem is the *selection*: comps that don't support a
long-term subject are ranking into the top-25. From the live Sold tab:
- **No lease expiration at all** (EXP + TERM blank): `2520 B F Terry Blvd` (TX), `582 Pole Line Rd E` (ID),
  `2500 Commercial Dr` (LA).
- **< 3 yr remaining at close**: `320 Gideon Creek Way` (NC) = **0.24 yr**, `6020 Enterprise Pkwy` (OH) =
  1.72 yr, `311 140th St S` (WA) = 2.84 yr.
For an appraisal supporting a subject with ~12 yr of term, a comp with no term or a sub-3-year (sometimes
sub-1-year) stub is a poor comparable and skews the set. Either the comp genuinely has a short/absent lease
(exclude it from the displayed appraisal set) OR the DB is holding a stale lease that predates the sale while
the property actually re-leased at closing (the "wrong lease at sale" case Scott flagged).

### 3. On Market row with no price
`1550 Goodman Ave` (OH, DaVita) ships on the On Market tab with LAST PRICE (and INITIAL PRICE) blank — a
just-listed row with no ask captured. With no price there's no cap; it's not a usable comp.

### 4. On Market row with no lease details
`1775 NW 80th Blvd` (FL) ships with EXP + TERM blank — same no-term problem as #2, on the On Market tab.

## Task

1. **OPTIONS normalizer (one shared function, both tabs, same convention as BUMPS).** Canonical form
   **`(N) M-yr`** — N renewal options of M years each:
   - `Two (2) Five (5) Year` / `Two (2), Five (5) Year` → `(2) 5-yr`
   - `three five-year options` → `(3) 5-yr`
   - `One, Five-Year Period` → `(1) 5-yr`
   - `(3) 5-yr` / `(2) 5-yr` → unchanged (already canonical)
   - a bare count with no term (`3`) → keep the count but mark the unknown term consistently
     (e.g. `(3)` — do NOT assume 5-yr); prefer pulling the option term from the lease record when available.
   - genuinely none → **`None`** (explicit, consistent — same idea as BUMPS "Flat"), never blank.
   Sold and On Market must render OPTIONS identically.

2. **Lease-term discipline on the DISPLAYED appraisal set** (reliability-or-exclude, extended to term):
   - **Use the lease in effect at the sale** for TERM (confirm the join selects the lease whose commencement
     ≤ sale date and expiration ≥ sale date, i.e. the lease-at-close — not merely the latest or an expired
     row). Where the only lease on file expires at/before the sale but the property clearly re-leased at
     closing, treat the term as **stale/unknown** and route to review — do NOT display a misleading sub-year
     stub, and do NOT fabricate a term.
   - **Exclude from the displayed set** (Sold and On Market) any comp with **no lease expiration** or with
     **remaining term at close < 3 years** (Scott's stated floor). Route excluded comps to the existing
     review lane / keep them for context stats; never delete, never merely flag-and-ship. A long-term subject
     appraisal should not display a no-term or sub-3-year comp.
   - Make the 3-year floor a named constant so it's tunable.

3. **Exclude On Market listings with no price.** A listing with no INITIAL/LAST price yields no cap and is not
   a usable comp — drop it from the On Market tab (route to review). `1550 Goodman Ave` must not ship.

4. Keep everything from 52/54/56 intact (cap band ≤ subject+35bps hard filter, reliability-or-exclude,
   canonical tenants, STATUS "Available", normalized BUMPS, on-market-date/DOM join, sold-average-below-subject,
   summary-matches-sheet).

## Verify

`generate_comps` for "The Villages DaVita — 1050 Old Camp Rd", downloaded and inspected against the SHEET:
- OPTIONS uses ONE format on both tabs (`(N) M-yr` or the unknown-term form / `None`); no `Two (2) Five (5) Year`,
  `three five-year options`, `One, Five-Year Period`, or bare mixed spellings.
- No Sold or On Market row with a blank lease expiration, and none with remaining term at close < 3 years
  (`2520 B F Terry Blvd`, `582 Pole Line Rd`, `2500 Commercial Dr`, `320 Gideon Creek Way`, `6020 Enterprise Pkwy`,
  `1775 NW 80th Blvd` are gone from the displayed set, or carry a real ≥3-yr lease-at-sale term if one exists).
- No On Market row with a blank price (`1550 Goodman Ave` gone).
- STATUS, BUMPS, cap band, RENT/SF band, canonical tenants, DOM, and summary-matches-sheet remain as verified post-56.
- Report how many comps moved to the review lane and why (no-term / short-term / no-price), so the exclusions are auditable.
