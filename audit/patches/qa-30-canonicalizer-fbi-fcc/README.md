# QA-30 — Canonicalizer expansion (FBI hyphen + FCC)

**Severity: P3 cleanup.** Three federal misses noted during QA-28's
Chrome probe. The post-QA-24 canonicalizer correctly handled the bulk
of agency variants but had two small gaps:

1. "Federal Bureau-Investigation" (hyphen separator, no "of") — 1 prop
2. "FCC" + "Federal Communications Commission" — 3 props, agency not
   in canonicalizer map

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-30-canonicalizer-fbi-fcc
node audit/patches/qa-30-canonicalizer-fbi-fcc/apply.mjs --dry
node audit/patches/qa-30-canonicalizer-fbi-fcc/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-30-canonicalizer-fbi-fcc/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-30-canonicalizer-fbi-fcc -m "Merge audit/qa-30-canonicalizer-fbi-fcc"
git push origin main
```

## Fix

Two regex changes in `canonicalize_agency()`:

- **FBI broadened:** `federal\s+bureau\s+of\s+investigation` →
  `federal\s+bureau[\s-]+(of[\s-]+)?investigation`. Matches:
  - "fbi"
  - "federal bureau of investigation" (original case)
  - "federal bureau-investigation" (the actual data on gov)
  - "federal bureau-of-investigation"

- **FCC added:** new line
  `\m(fcc|federal\s+communications\s+commission)\M` → 'FCC'

Re-canonicalization UPDATE applied to `properties.agency_canonical`.

## Verified live (Supabase MCP, 2026-05-18)

| Raw agency                          | Properties | agency_canonical |
|-------------------------------------|-----------:|------------------|
| FBI                                 |        135 | FBI              |
| Federal Bureau of Investigation     |          1 | FBI              |
| Federal Bureau-Investigation        |          1 | FBI ← new        |
| FCC                                 |          2 | FCC ← new        |
| Federal Communications Commission   |          1 | FCC ← new        |

FBI bucket gained 1 property (negligible). FCC is now a new canonical
agency category with 3 properties.

## "Federal Building" left alone

The third miss QA-28 noted — a single property with `agency = "Federal
Building"` — is ambiguous. Could be a GSA-managed federal building,
could be the building name (not the tenant agency). Single property,
low value to force a classification. Canonicalizer continues to return
NULL; agency-breakdown filter will keep it in the "Unknown" bucket
via QA-28's private-Federal-name filter (which doesn't catch it, so
it stays in the chart as its own bucket — minor edge case).

## Files changed

- `supabase/migrations/government/20260518240000_gov_qa30_canonicalize_agency_fbi_hyphen_fcc.sql`
- `AUDIT_PROGRESS.md` (closeout)

No frontend changes. No Edge Function changes. No allowlist changes.
Migration applied live via Supabase MCP on 2026-05-18.
