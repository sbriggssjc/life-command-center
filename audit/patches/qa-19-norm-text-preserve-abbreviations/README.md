# QA-19 — `norm_text` clobbers canonical address data (P0)

**Severity: P0.** QA-12 + QA-18 canonicalized `properties.address` (and
~11K other addresses across the two DBs). But the detail panel header
still rendered `"1200 New Jersey Ave Se – Washington, DC"` — because
`v_property_detail` wraps every text column in `norm_text()`, which
called `initcap(trim(s))` and stripped "SE" back to "Se" on every
read. The same function is also used in `v_lease_detail`,
`v_ownership_current`, and `v_ownership_chain`.

Net effect: every read through any of those four views silently undid
~3 prior QA patches' worth of normalization work.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-19-norm-text-preserve-abbreviations
node audit/patches/qa-19-norm-text-preserve-abbreviations/apply.mjs --dry
node audit/patches/qa-19-norm-text-preserve-abbreviations/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-19-norm-text-preserve-abbreviations/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-19-norm-text-preserve-abbreviations -m "Merge audit/qa-19-norm-text-preserve-abbreviations"
git push origin main
```

## What `norm_text` does now

Two-branch policy:

1. **Mixed-case input** (has at least one upper AND one lower char):
   trust the upstream, just trim. Canonical data from QA-12 / QA-18
   backfills lands here and is left alone.

2. **All-upper or all-lower input** (legacy ingest from upstream
   pipelines that captured raw UPPERCASE county-recorder rows etc.):
   smart title-case using the same logic as `titlecase_address` from
   QA-18, with an expanded abbreviation preserve-set:
   - Direction codes: N, S, E, W, NE, NW, SE, SW
   - USPS: PO, POB
   - Federal agency acronyms: GSA, IRS, DOJ, FBI, VA, USPS, DOD, HHS,
     FDA, NIH, CDC, DOL, DOC, DHS, ICE, CBP, USCIS, TSA, USSS, ATF,
     DEA, USMS, BOP, HUD, DOT, FAA, FEMA, OPM, SEC, BLS, NRC, NLRB,
     EEOC, EPA, NOAA, USGS, USDA, DOE, USACE, NASA, USAF, USMC, USCG,
     LSC, UHT, OSHA, FCC, FTC, SBA, NSF, GAO, DHA
   - Dia-specific (dia migration only): DVA, FMC, NPI, CMS, ESRD,
     QIP, CKD

## Regression tests (verified on gov live)

| Input | Output |
|---|---|
| `"1200 NEW JERSEY AVE SE"` | `"1200 New Jersey Ave SE"` |
| `"1200 New Jersey Ave SE"` (already canonical) | `"1200 New Jersey Ave SE"` |
| `"GSA HEADQUARTERS"` | `"GSA Headquarters"` |
| `"GSA Headquarters"` (already canonical) | `"GSA Headquarters"` |
| `"po box 123"` | `"PO Box 123"` |
| `"WASHINGTON"` | `"Washington"` |
| `"  "` | `NULL` |

## Live impact (verified in browser)

Detail panel header on property 3198 (1200 New Jersey Ave SE):
- **Before:** `"1200 New Jersey Ave Se – Washington, DC"`
- **After:** `"1200 New Jersey Ave SE – Washington, DC"`

This fixes the rendering on every detail panel for both domains,
plus every read through `v_lease_detail`, `v_ownership_current`, and
`v_ownership_chain` that exposes address / city / county / agency.

## Why this slipped past QA-12 and QA-18

Both prior patches updated the `properties.address` column and added
INSERT/UPDATE triggers. They did not realize the data was passing
through a per-column `norm_text` wrapper on every read in the view
layer. The fix on the column was correct; the read-time mutation
re-applied the bug on every query.

Lesson: when canonicalizing data, audit every consuming view for
read-time normalization helpers (`norm_text`, `initcap`, `lower`,
`upper`, custom canonicalizers) — they will silently override
column-level fixes.

## Files changed

- `supabase/migrations/government/20260518190000_gov_qa19_norm_text_preserve_abbreviations.sql`
- `supabase/migrations/dialysis/20260518190000_dia_qa19_norm_text_preserve_abbreviations.sql`
- `AUDIT_PROGRESS.md` (closeout)

Both migrations applied live via Supabase MCP on 2026-05-18.
