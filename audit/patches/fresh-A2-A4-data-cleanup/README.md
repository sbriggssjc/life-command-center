# Fresh audit A-2 + A-4 — data cleanup

Two fresh-audit findings combined because both touch the upsert-writer
code path in `sidebar-pipeline.js`. After this merge, the daily
`ingest_write_failures` volume should drop materially.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/fresh-A2-A4-data-cleanup
node audit/patches/fresh-A2-A4-data-cleanup/apply.mjs --dry
node audit/patches/fresh-A2-A4-data-cleanup/apply.mjs --apply
git add -A
git commit -F audit/patches/fresh-A2-A4-data-cleanup/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/fresh-A2-A4-data-cleanup -m "Merge audit/fresh-A2-A4-data-cleanup: A-2 + A-4 data cleanup"
git push origin main
```

The SQL migration (loans CHECK allow NULL) is already applied via MCP.
This patch only commits the `.sql` file for repo provenance plus the
writer-side changes in `api/_handlers/sidebar-pipeline.js`.

## What changes

**A-2** — One line: the sales_transactions POST now passes a label.
The 269/24h log entries that previously appeared as anonymous 4xx
will now appear as `upsertDomainSales:initialInsert` rows that you
can filter on (`label='upsertDomainSales:initialInsert' AND http_status=409`
= the expected recoverable cases).

**A-4** — Two parts:
1. The `loans_status_check` now allows NULL (defensive — unknown-status
   loans don't reject the whole row).
2. New `mapLoanStatus()` inline helper in the loans writer maps
   CoStar's loan-status text to the allowed enum:

   | CoStar text matches | → mapped to |
   |---|---|
   | Outstanding, Current, Active, Performing, Open, In Good Standing | `active` |
   | Paid Off, Paid in Full, Closed-Paid, Satisfied | `paid_off` |
   | Matured, Mature | `matured` |
   | Default, Delinquent, Foreclosure, REO, Non-Performing, Distressed | `defaulted` |
   | Refinanced, Refi'd, Paid by Refi | `refinanced` |
   | Assumed, Assumption | `assumed` |
   | Anything else | `null` (CHECK now allows it) |

   Plus a fallback that strips the `Loan Status:` prefix from
   CoStar's concatenated header strings before the regex match.

## Verify after deploy

```sql
-- On LCC Opps, after a fresh CoStar capture:
SELECT label, http_status, count(*)
  FROM public.ingest_write_failures
 WHERE occurred_at > now() - interval '1 hour'
   AND (label = 'upsertDomainLoans:financing'
     OR label = 'upsertDomainSales:initialInsert')
 GROUP BY 1, 2 ORDER BY 1, 2;
```

Expected after the merge takes effect:
- 0 rows for `upsertDomainLoans:financing` (status now normalizes or
  is NULL-allowed).
- Some rows for `upsertDomainSales:initialInsert` with `http_status=409`
  — those are the EXPECTED recovery cases, now properly labeled.

```sql
-- Watch the loans_status_check rejection rate drop:
SELECT count(*)
  FROM public.ingest_write_failures
 WHERE label = 'upsertDomainLoans:financing'
   AND error_detail::text LIKE '%loans_status_check%'
   AND occurred_at > now() - interval '24 hours';
-- Should trend toward 0 after this deploys.
```

## What's next

- **A-3** — 579 unlabeled 400 errors / 24h. Need to grep for ungated
  `domainQuery` POST/PATCH/DELETE calls in sidebar-pipeline.js and
  add labels. Investigative.
- **A-5** — gov `agency_drift:agency_disagreement` review UI
  (807 cases, 204 excellent). Adapt the LLC Research widget pattern.
