# QA-23 — Chain DaVita brand canonicalization into `norm_text` (P1)

**Severity: P1.** QA pass #6 (verification of QA-22) opened a DaVita-
tenanted dia property and the detail panel header still read
`"Davita Lakewood Community Dialysis Center"` — even though QA-22's
`properties.tenant` backfill went 2,531 bad rows → 0. The page_title
sources from `leases.tenant` and `medicare_clinics.facility_name`
FIRST, both of which had thousands of "Davita" rows that QA-22
didn't touch.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-23-norm-text-chain-davita
node audit/patches/qa-23-norm-text-chain-davita/apply.mjs --dry
node audit/patches/qa-23-norm-text-chain-davita/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-23-norm-text-chain-davita/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-23-norm-text-chain-davita -m "Merge audit/qa-23-norm-text-chain-davita"
git push origin main
```

## Root cause

`v_property_detail__base` builds the `page_title` column from:

```sql
COALESCE(
  norm_text(pl.tenant),                  -- LATERAL join to leases
  norm_text(pmc.facility_name),          -- LATERAL join to medicare_clinics
  norm_text(p.tenant::text),             -- properties.tenant
  norm_text(p.address)
)
```

The first two are pulled from LATERAL joins. For property 38564, both
`leases.tenant` and `medicare_clinics.facility_name` had the brand
written as "Davita Lakewood Community Dialysis Center". Affected:

| Table.column | "Davita" prefix rows |
|---|---|
| `leases.tenant` | 2,348 |
| `medicare_clinics.facility_name` | 6 |

The QA-19 `norm_text` trusted mixed-case input as-is (correct
behavior for not clobbering canonical data). So even though
`norm_text` was running on these strings, it returned them unchanged.

## Fix

Chain `public.canonicalize_davita_brand(text)` onto `norm_text`'s
output. Applies to ALL paths — trusted-mixed-case AND
smart-title-case. Idempotent (DaVita stays DaVita) and cheap (one
`regexp_replace` per call).

One function changed → 4 dependent views auto-fixed:
- `v_property_detail`
- `v_lease_detail`
- `v_ownership_current`
- `v_ownership_chain`

No table backfill needed — the existing rows aren't mutated, just
displayed correctly on every read.

## Verified live

Property 38564:
- **Before:** `page_title = "Davita Lakewood Community Dialysis Center – Lakewood, WA"`
- **After:** `page_title = "DaVita Lakewood Community Dialysis Center – Lakewood, WA"` ✓

## Why this slipped past QA-22

QA-22 fixed the **write path** (`properties.tenant` backfill +
trigger). I assumed the detail panel header sourced from
`properties.tenant`. It doesn't — it falls through 4 sources, with
the property-level one being THIRD. Both upstream sources had the
same bad casing in much larger counts.

Lesson: when a view's column is built via `COALESCE` over multiple
upstreams, fixing one source isn't enough. View-level
canonicalization is more robust.

## Files changed

- `supabase/migrations/dialysis/20260518210000_dia_qa23_norm_text_chain_davita_brand.sql`
- `AUDIT_PROGRESS.md` (closeout)

Migration applied live via Supabase MCP on 2026-05-18.

## Future-proofing

The same pattern (chain brand canonicalization into norm_text) can
be extended to other brands that need case correction — e.g.
"FMC" → "FMC" is already handled by QA-19's abbreviation list,
"U.S. Renal Care" is already correctly-cased upstream, etc. If a
new brand needs canonicalization, add a helper like
`canonicalize_davita_brand` and chain it into norm_text the same way.
