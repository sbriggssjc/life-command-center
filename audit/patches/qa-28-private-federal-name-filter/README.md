# QA-28 — Private "Federal" name filter on Agency Breakdown (P2 cleanup)

**Severity: P2.** After QA-24's agency canonicalization, the Agency
Breakdown chart was cleaned up at the top (VA correctly ranked #1, etc.)
but the **bottom** still had ~827 properties polluting the long tail
under names like "Campco Federal Credit Union", "10 Federal Self
Storage", "First Federal Lakewood". These are private businesses with
"Federal" in the name — not federal tenants.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-28-private-federal-name-filter
node audit/patches/qa-28-private-federal-name-filter/apply.mjs --dry
node audit/patches/qa-28-private-federal-name-filter/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-28-private-federal-name-filter/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-28-private-federal-name-filter -m "Merge audit/qa-28-private-federal-name-filter"
git push origin main
```

## Scope (verified live, 2026-05-18)

The 13 distinct non-federal raw `.agency` strings that have `agency_canonical IS NULL` and contain "federal":

| Pattern                                              | Properties | Action  |
|------------------------------------------------------|-----------:|---------|
| Campco Federal Credit Union                          |        162 | FILTER  |
| 10 Federal Self Storage                              |        154 | FILTER  |
| First Federal Lakewood                               |        141 | FILTER  |
| Digital Federal Credit Union                         |        130 | FILTER  |
| United Teletech Financial Federal Credit Union       |        125 | FILTER  |
| True Sky Federal Credit Union                        |        114 | FILTER  |
| SchoolsFirst Federal Credit Union \| Edupro ...      |          1 | FILTER  |
| Pacific Dental \| SchoolsFirst Federal Credit Union  |          1 | FILTER  |
| Federal Building                                     |          1 | KEEP    |
| FEDERAL WAY CROSSINGS                                |          1 | FILTER (Federal Way is a WA city, not federal) |
| Federal Bureau-Investigation                         |          1 | KEEP (canonicalizer miss — hyphen variant) |
| Federal Highway Self Storage                         |          1 | FILTER  |
| Federal Communications Commission                    |          1 | KEEP (canonicalizer miss — FCC not in map yet) |

826 properties filtered out of the breakdown. Three remain that probably
deserve canonicalizer treatment in a future pass (FBI hyphen variant,
FCC, Federal Building → GSA) — noted but not addressed here to keep
this patch tightly scoped to "filter pollution."

## Fix

Pure frontend change in `gov.js`:

1. New helper `_govIsPrivateFederalNamedEntity(name)` — case-insensitive
   regex classifier for private-business "Federal" patterns:
   - `federal credit union`
   - `federal savings`
   - `federal bank`
   - `^first federal`
   - `self storage` / `self-storage` anywhere
   - `^<digits> federal` (covers "10 Federal Self Storage")
   - `^federal way` (Federal Way, WA — city name)

2. Agency Breakdown `forEach` rolls private-named rows into the
   "Unknown" bucket instead of the long-tail chart. The chart now
   focuses on real federal/state/local government tenants.

3. `distinctAgencies` count excludes these same private names.

## Why filter, not delete?

The properties themselves are real records (often with legitimate sales
or ownership data) — they just shouldn't show up under "Federal
Agencies." Filtering at the chart level is reversible and keeps the
data available for other surfaces (sales comps, etc.).

## Out of scope

- **Canonicalizer fixes for FBI/FCC/Federal Building** — three known
  misses surfaced during this audit. Single-property each, low priority.
  Could be folded into a "QA-29: canonicalizer expansion" patch later.
- **Ingest-side classification** — could add an `is_private_entity`
  column to properties at ingest time so this lookup doesn't need to
  run every render. Premature at 826 rows.
- **State/local government "Federal" overlap** — none found in the data.

## Files changed

- `gov.js` — `_govIsPrivateFederalNamedEntity` helper + Agency Breakdown filter
- `AUDIT_PROGRESS.md` (closeout)

No SQL changes. No Edge Function changes. No allowlist changes.
