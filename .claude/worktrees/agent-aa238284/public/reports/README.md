# Capital Markets Report PDFs

This directory holds publicly-servable PDFs attached to outreach drafts via the
Microsoft Graph "create_outlook_draft" flow.

The Graph attach step fetches these by `public_url` set in the
`capital_markets_reports` table (LCC Opps project: xengecqvemvfknjvbvrq).

## Files expected here

| File | Source | Used for |
|------|--------|----------|
| `state-of-gov-leased-2024-q2.pdf` | OneDrive → Team Briggs → Brochures and Deliverables → GSA State of the Market - Quarterly Report → `State of the Government-Leased Market (2024-Q2).pdf` | Government domain outreach |
| `dialysis-market-filter-2025-q4.pdf` | OneDrive → Team Briggs → Brochures and Deliverables → Dialysis State of the Market - Quarterly Report → `The Dialysis Market Filter (4Q-2025).pdf` | Dialysis domain outreach |

After dropping the PDFs in this folder, update the DB rows:

```sql
-- LCC Opps
UPDATE capital_markets_reports
   SET public_url = '/reports/state-of-gov-leased-2024-q2.pdf'
 WHERE domain = 'government' AND quarter_year = '2024-Q2';

UPDATE capital_markets_reports
   SET public_url = '/reports/dialysis-market-filter-2025-q4.pdf'
 WHERE domain = 'dialysis' AND quarter_year = '2025-Q4';
```

Vercel serves `/public/*` at the site root, so `https://<site>/reports/foo.pdf`
maps to `public/reports/foo.pdf`.

Size limit: Graph single-request attachments cap at ~3 MB base64. Anything larger
needs the upload-session flow (not yet implemented).
