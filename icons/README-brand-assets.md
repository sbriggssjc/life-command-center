# Brand Assets — Icons Folder

This folder holds the LCC app's PWA icons (`favicon.ico`, `icon-180.png`,
`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`). These are the
**LCC application** icons (Scott's personal command center), not Northmarq
corporate marks.

## Northmarq logo placement

If/when client-facing surfaces need the official Northmarq logo (e.g. email
templates, capital-markets PDF deliverables, the Capital Markets dashboard
header), drop the asset from the **Adobe CC Northmarq Asset Library** here:

| Filename                          | When to use                                           |
| --------------------------------- | ----------------------------------------------------- |
| `northmarq-logo-vertical.svg`     | Default — primary lockup with "Northmarq" wordmark.   |
| `northmarq-logo-horizontal.svg`   | Restrictive horizontal formats (footers, banners).    |
| `northmarq-brandmark.svg`         | The "n + star" mark alone, when space is constrained. |
| `northmarq-logo-white.svg`        | Reversed-on-dark (NM Blue or Black backgrounds).      |
| `northmarq-logo-black.svg`        | When NM Blue isn't appropriate (some print contexts). |
| `northmarq-north-star.svg`        | The standalone star accent (decorative, never large). |

## Brand rules — read before placing

The Brand Book (November 2024) is **strict** about logo handling. Sister
docs holding the canonical spec:

- `C:\Users\scott\DialysisProject\docs\brand\NORTHMARQ_BRAND.md`
- `C:\Users\scott\GovernmentProject\docs\brand\NORTHMARQ_BRAND.md`
- `C:\Users\scott\life-command-center\public\reports\cm_brand_tokens.json`

**Hard rules:**
- Logo only in **NM Blue (`#003DA5`), Black, or reversed-on-White**. No other colors.
- Minimum clear space = the height/width of the North Star (the ★ accent).
- **Never** recolor, glow, drop-shadow, 3D-extrude, outline, rotate, crop,
  place on a busy photo, place inside a white box on dark, or place on a
  low-contrast background.
- The North Star (★) may be used as a small standalone accent — small,
  supportive, never dominating, always far from the full logo.

## Why no logo files in this repo today

The official assets live in the corporate Adobe CC Northmarq Asset Library.
This repo's icons are LCC-specific (Scott's personal app), so the Northmarq
brandmark wasn't checked in. When a client-facing surface needs the logo,
pull the canonical asset from Adobe CC and place it here following the
filename convention above. Do **not** hand-recreate the logo from screenshots
or trace from PDFs — that violates the brand book's "Don't recreate / replace
any logo element" rule.
