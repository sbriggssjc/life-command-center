# Prompt 56 — Comps display cleanup: finish the STATUS / BUMPS / summary items scoped out of 54

## Why (live connector export, 2026-08-06 — post-54 verify against the downloaded sheet)

Prompt 54 landed and the appraisal-critical items are confirmed clean in the live workbook
(`generate_comps` for The Villages, downloaded and inspected): every displayed cap ≤ 7.10%
(Sold 5.21–7.08%, On Market 5.25–7.01%), RENT/SF all in-band (13.8–55.0), tenants canonical
(DaVita / Fresenius Medical Care / US Renal Care / American Renal), DOM all plausible. Chairs
blanks are the genuinely-absent rows (prompt 55) — correctly left blank.

But three items from prompt 54's ORIGINAL scope were narrowed out of the 54 response and are
verifiably still open in the shipped sheet:

1. **On Market STATUS is blank** on every row (the tab's STATUS column renders empty). Prompt 54
   item 4 asked for STATUS to default to **"Available"** (Active → Available), or the actual
   listing status — never blank.

2. **BUMPS are not fully normalized** (prompt 54 item 5). The downloaded Sold tab contains, verbatim:
   `1.75` (bare decimal), `10% every 5`, `5% after 5 years`, and blank cells rendered as empty;
   On Market contains `Fixed` and blank cells. This is the same bumps-formatting issue Scott has
   flagged repeatedly.

3. **The response `summary` cap range doesn't match the sheet** (prompt 54 item 1, last clause).
   The JSON `summary` says "6.41%–7.08%" (its "reliable sold primary set"), but the Sold tab
   displays caps down to **5.21%**. The stat range and the shipped rows must describe the same set.

## Task

1. **STATUS never blank on On Market.** Render the listing status — default **"Available"** when the
   source status is Active/blank, or the actual status (Under Contract, etc.) when present. Applies to
   the On Market tab; Sold has no STATUS column.

2. **Full BUMPS normalization + "Flat" default** (both tabs, Sold and On Market):
   - bare decimal `1.75` → `1.75% / yr`
   - `10% every 5` / `10% every 5 years` → `10% / 5 yrs`
   - `5% after 5 years` → `5% / 5 yrs` (or the correct standard form for a step at year 5)
   - `X% annually` / `X%/Yr` → `X% / yr`
   - genuinely-empty bumps → **`Flat`** (no increases), never blank
   - unify the no-escalation label to one token (`Flat`) so `Fixed` and blank both render `Flat`
   - preserve legitimate non-numeric escalations that are already meaningful (`CPI annually`) — don't
     force those into a percent form
   Use one shared normalizer so Sold and On Market render identically (this is the same convention as
   the subject's "10% / 5 yrs").

3. **Make the `summary` cap range describe the displayed set.** Either report the min–max of the caps
   actually shipped in the sheet, or clearly scope the stat (e.g. "reliable sold primary set (n=…)")
   AND ensure the displayed rows are the same set the range is computed over. No reader should see a
   summary range that excludes a row visible on the sheet.

Keep everything from 52/54 intact (cap band ≤ subject+35bps as a hard filter, reliability-or-exclude,
canonical tenants, on-market-date/DOM join, sold-average-below-subject).

## Verify

`generate_comps` for "The Villages DaVita — 1050 Old Camp Rd", downloaded and inspected against the
SHEET (not just JSON): On Market STATUS populated on every row (no blanks); no bare-decimal bumps, no
`X every N`, no blank bumps (empty → `Flat`), Sold and On Market bumps use the same convention; and the
`summary` cap range matches the min–max of the displayed rows (or is explicitly the labeled reliable
subset with the displayed rows drawn from it). Cap band, RENT/SF band, canonical tenants, and DOM
plausibility remain as verified post-54.
