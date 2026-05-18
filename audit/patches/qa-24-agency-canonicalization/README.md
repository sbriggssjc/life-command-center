# QA-24 — Agency Breakdown canonicalization (P1)

**Severity: P1.** The Gov dashboard's Agency Breakdown widget was
splitting VA-related properties into multiple buckets, masking the
fact that **Veterans Affairs is the #1 federal tenant by property
count**, not the #3 it appeared to be.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-24-agency-canonicalization
node audit/patches/qa-24-agency-canonicalization/apply.mjs --dry
node audit/patches/qa-24-agency-canonicalization/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-24-agency-canonicalization/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-24-agency-canonicalization -m "Merge audit/qa-24-agency-canonicalization"
git push origin main
```

## Two bugs, one impact

### (a) Canonicalizer regex missed singular "Veteran Affairs" (data)

`canonicalize_agency` matched `\m(va|veterans\s+affairs|...)\M` but
the source data had **1,217 rows** with "US Department of Veteran
Affairs" (singular). Those rows had `agency_canonical = NULL`.
Combined with 289 rows under "US Department of Veterans Affairs - 1"
(a suffixed variant the canonicalizer DID catch), VA appeared as
657 in `agency_canonical` but the raw column had 1,217 + 289 = 1,506+
VA-related properties hiding under non-canonical names.

**Fix:** change `veterans\s+affairs` → `veterans?\s+affairs`. Same
pattern applied to the other VA alternatives (`veterans?\s+health`,
`department\s+of\s+veterans?`).

### (b) Frontend dashboard grouped by raw `agency` (UI)

`gov.js` `portfolio.forEach(p => { const a = p.agency || 'Unknown'; … })`
was bypassing the canonical column entirely. Even after the regex
fix, the dashboard would still group by whatever raw string the
upstream gave.

**Fix:** prefer `p.agency_canonical || p.agency || 'Unknown'`.
`distinctAgencies` count also updated.

## Live impact (verified)

Before:
```
US Department of Veteran Affairs        1,217
General Services Administration (GSA)   1,083
SSA                                       781
US Department of Agriculture (USDA)       439
Social Security Administration (SSA)      428
US Department of Veterans Affairs - 1     289
Federal Bureau of Investigation (FBI)     282
USDA                                      177
```

After (canonical):
```
VA      1,875   ← +1,218 (was hidden across 3 buckets)
SSA     1,320
GSA     1,267
USDA      623
FBI       421
LSC       314
DOL       166
NAVY      142
```

VA is now correctly displayed as the **#1 federal tenant**, ~1.5×
the previous #1 (GSA at 1,083).

## What this patch did NOT address

- **Non-federal entities tagged as "Federal"** — 1,000+ properties
  have "Federal Credit Union" / "10 Federal Self Storage" / etc. as
  the `agency` value. They're private businesses with "Federal" in
  the name, not federal agencies. Out of scope here — the
  canonicalizer correctly returns NULL for them (no federal match),
  and the frontend now falls back to the raw string. They appear at
  the bottom of the breakdown rather than polluting the top. A
  future patch could add an ingest-side filter to flag these.
- **State and local government tenants** — Florida DoH, Mississippi
  DoH, Shelby County Government, etc. The canonicalizer is
  federal-only by design. Same fallback behavior.

## Files changed

- `supabase/migrations/government/20260518220000_gov_qa24_canonicalize_agency_veteran_singular.sql`
- `gov.js` — `distinctAgencies` + `agencyMap` group-by use canonical
- `AUDIT_PROGRESS.md` (closeout)

Migration applied live via Supabase MCP on 2026-05-18.

## Other findings from QA pass #8 (not in this patch)

- **8–14 second page-render delay** on Gov dashboard — several
  "loading..." widgets resolve only after long async waits.
- **SF PROSPECTING 0%** — 431 SF-linked owner groups, 0 with any
  prospecting activity in 180 days. Likely accurate data, not a
  display bug.
- **MISSING SF LINK 97%** — 13,675 of 14,106 ownership groups missing
  Salesforce. Real data gap.
- **Non-federal "Federal" entities in dataset** (above).
