# Fix: the SF "Get Deals" pull is missing all recent (2026) closings (for Scott)

> Diagnosis + fix spec for the Power Automate **"SF → LCC Object Sync"** flow
> (the `Deals` object leg). This is the **Part B** of the Deal Closing
> Announcement work (Part A = the email-flag ingest, built in LCC; see
> `docs/architecture/sf_deal_closing_email_ingest_PLAN.md`). This part is
> **mostly PA / SOQL config on Scott's side** — no LCC code change.

## Symptom (grounded live, dia `zqzrriwuavgrquhisnoa`, 2026-06-23)

`sf_deal_staging` is **current** (last `imported_at` today; pulled deals
modified through 2026-06-22) — but it carries **ZERO 2026 closings**:

| stage | rows | 2026-dated | newest close date |
|---|---|---|---|
| Closed IS | 61 | **0** | **2025-12-19** |
| Terminated IS | 55 | 0 | 2025-05-16 |
| Final | 18 | 0 | 2022-05-09 |
| Listing Signed | 7 | **7** | 2027-05-29 |
| In Escrow | 2 | **2** | 2026-08-21 |
| LOI Executed | 1 | **1** | 2026-07-16 |
| Non-refundable | 1 | **1** | 2026-05-29 |

The today-closed sample deal (US Renal – Covington GA, Opportunity
`006Vs00000IPJGQ`) is **not present**.

## Root cause

2026 deals **do** flow into staging while they are **open** (`Listing Signed`,
`In Escrow`, `LOI Executed`, `Non-refundable` all show 2026 dates) — so the
flow, the watermark, and the org connection all work. But the **closed/terminal**
stages stop in 2025. A deal that was visible as `In Escrow` / `LOI Executed`
**drops out of the pull the moment it flips to its closed StageName.**

That points at the **"Get Deals" StageName filter**, not the watermark. The
repo's own architecture note (`docs/architecture/salesforce_nm_authoritative_sync.md`
§3.6(A)) already flagged that dia closings historically carry **`CM - Closed IS`**
— a label that does **not** exist in staging at all — and that gov also uses
**`Final`**. The broadening of the filter was left as "Scott applies" and appears
**not yet applied**, so a freshly-closed `Sale Deal - Commercial` whose StageName
is `CM - Closed IS` (or another closed label outside the current filter) is
silently excluded.

(Org mismatch was ruled out: the announcement email's `006Vs…` Opportunity-Id
prefix **does** appear in staging alongside `0068W…`/`0061I…` — same org, mixed
15-char encodings.)

## The fix

In the PA "SF → LCC Object Sync" flow's **Get Deals** step (SF connector / SOQL):

1. **Broaden the StageName filter** from `StageName eq 'Closed IS'` to the full
   closed set:
   ```
   StageName IN ('Closed IS', 'CM - Closed IS', 'Final')
   ```
   Reconcile the exact label set against an unfiltered export — in particular,
   confirm the StageName a brand-new `Sale Deal - Commercial` close lands on
   today (open one of the recent `In Escrow`/`LOI` 2026 deals' closed twin and
   read its StageName). Add any other live closed label found.
2. **Confirm the query is firm-wide**, not scoped to a broker team / record type
   — the Deal Closing Announcements go to `Production_ALL@northmarq.com`, so all
   teams' closings should land (and the edge fn already vertical-filters to
   dia/gov, so pulling the whole closed universe is safe).
3. **One-time watermark reset / backfill** — the filter is watermark-gated, so it
   only catches *newly modified* deals going forward. The deals that already
   flipped to a closed StageName under the old filter need one full backfill pull
   (clear the watermark, or run the on-demand backfill described in
   `docs/architecture/salesforce_nm_authoritative_sync.md` §3.6 with
   `Filter: StageName eq 'Closed IS' or StageName eq 'CM - Closed IS' or
   StageName eq 'Final'`).

## Verify the fix

Re-run the staging check (dia + gov):
```sql
select count(*) filter (where stage in ('Closed IS','CM - Closed IS','Final')
                          and coalesce(expected_close_date,(raw_row->>'CloseDate')::date) >= '2026-01-01')
       as closed_2026
from public.sf_deal_staging;
```
- **Before:** 0. **After the filter + backfill:** non-zero, and the US Renal
  Covington GA deal (`sf_deal_id` ~ `006Vs00000IPJGQ…`) should appear with
  `stage` in the closed set.
- The daily `dia-nm-comp-promote` (05:40) / `gov-nm-comp-promote` (05:30) crons
  then auto-attribute the new closings — no further wiring (see
  `docs/capital-markets/NM_CLOSED_IS_DEAL_ATTRIBUTION_2026-06-23.md`).

## Relationship to Part A
Once this filter is fixed, the automated pull captures firm closings within a day
with no email step. The **email-flag path (Part A)** remains valuable for
**real-time** capture and **per-deal operator control**, and is idempotent
against the pull (both key `sf_deal_staging` on `sf_deal_id`). Build both; they
converge.
