# QA-25 — Unprospected Owners widget (reframe + actionable)

**Severity: P2.** "Missing SF Link 97%" on the Gov dashboard (and 79% on
the Dialysis dashboard) looked like a data-quality alarm but was actually
two layered problems: stub pollution + a fundamentally wrong frame.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-25-unprospected-owners-widget
node audit/patches/qa-25-unprospected-owners-widget/apply.mjs --dry
node audit/patches/qa-25-unprospected-owners-widget/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-25-unprospected-owners-widget/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-25-unprospected-owners-widget -m "Merge audit/qa-25-unprospected-owners-widget"
git push origin main
```

## The diagnosis (why the metric was lying)

Two problems compounded:

### (a) Stub pollution

The widget counted ALL `true_owners` rows, including owners that own zero
properties. Live counts (2026-05-18):

| Domain | Total true_owners | Zero-prop stubs | % stubs |
|--------|------------------:|----------------:|--------:|
| gov    |            14,106 |           6,303 |   44.7% |
| dia    |             3,422 |           2,580 |   75.4% |

Those stubs are residue from the LLC research queue and from owners whose
properties were later merged or deleted. They inflate the "missing SF"
denominator without representing anything actionable.

### (b) Wrong frame — there is no "link" to fix

The dashboard subtext read "missing Salesforce" — as if the link existed
in SF and the join was broken. It doesn't. On dia, `salesforce_accounts`
holds 5,004 rows that ARE Scott's CRM contact book, NOT a universe of
property owners:

- Exact-name matches between the 2,722 unlinked dia owners and the 5,004
  SF accounts: **0**.
- Best fuzzy-match (pg_trgm similarity) for the top 18 unlinked owners by
  prop count: **0.23 – 0.55** (every match is a different company; none
  is a real link).
- Gov has no `salesforce_accounts` table at all — `sf_account_id` is a
  free-text column with no source of truth.

The owners aren't "missing a link." They're **unprospected BD targets**.
The top dia unlinked owners — SMBC Leasing (104 props), Elliott Bay
Capital (65), MassMutual (57), Realty Income Corporation (25), AR Global
(24), Vereit (19), Healthcare Realty Trust (7) — are real prospects Scott
hasn't added to SF yet. The top gov unlinked owners — Boyd Watterson
Global (31), Prologis L.P. (24), Highwoods Realty (21), GPT Properties
Trust (16) — same story.

## The fix

Three coupled changes:

1. **Backing view** (gov + dia): `v_prospect_targets` returns owners that
   own ≥1 property with no SF account link, ordered by property count.
   Dia also excludes `is_operator_not_owner = TRUE` (operators like DaVita
   and Fresenius show up as tenants on properties they don't own).

2. **Reframed widget**: "Missing SF Link" → "Unprospected Owners". Numerator
   and denominator both filtered to active owners (≥1 property). Subtext
   changed from "groups missing Salesforce" → "active owners — click to
   view BD targets". The card is now clickable.

3. **Prospect modal**: clicking the card opens a sortable top-100 list of
   unprospected owners with property count, state, and (dia only) most
   recent contact status. Each row is a high-value BD target — owners
   ranked by how many properties they control.

## Verified live (2026-05-18)

Both views applied and the Edge Function (v16) was redeployed with
`v_prospect_targets` added to both `GOV_READ_TABLES` and `DIA_READ_TABLES`.

Top 10 from dia `v_prospect_targets`:

```
SMBC Leasing & Finance Inc       104
Elliott Bay Capital               65
MassMutual                        57
AEI Capital Corp                  51
Kingsbarn Realty                  34
Realty Income Corporation         25
AR Global                         24
Vereit                            19
Capital Square 1031               15
NetSTREIT Inc                      9
```

Top 10 from gov `v_prospect_targets`:

```
Boyd Watterson Global             31
Wise Developments LLC             31
Space Center Kansas City Inc      28
Potomac Creek Associates, L.L.C.  27
Prologis, L.P.                    24
2600 Tower LLC                    21
Highwoods Realty Limited P.       21
Pacific Oak/Verus GC Phoenix      21
El Dorado N&G LLC                 20
McClellan Realty, LLC             18
```

## Out of scope (future passes)

- Auto-archive zero-property owner stubs. 6,303 gov + 2,580 dia rows that
  serve no current purpose. Tag them `is_orphan_stub` after, say, a 90-day
  grace period.
- Two-way SF sync. Adding a "Create SF account" CTA to the modal would
  let Scott go from prospect list → SF account creation in one click.
  Out of scope here (requires SF write API + audit).
- Gov-side `salesforce_accounts` table. Today gov only stores the text
  ID, not the account row. If we ever want fuzzy-matching against the
  CRM, we'd need to mirror it from SF.

## Files changed

- `supabase/migrations/dialysis/20260518230000_dia_qa25_v_prospect_targets.sql`
- `supabase/migrations/government/20260518230000_gov_qa25_v_prospect_targets.sql`
- `supabase/functions/data-query/index.ts` — `v_prospect_targets` added to both allowlists
- `dialysis.js` — widget reframe + modal handler
- `gov.js` — widget reframe + modal handler
- `AUDIT_PROGRESS.md` (closeout)

Edge Function v16 deployed and views applied live via Supabase MCP on 2026-05-18.
