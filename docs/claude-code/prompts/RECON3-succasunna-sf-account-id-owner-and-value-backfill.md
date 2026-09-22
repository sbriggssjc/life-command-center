# RECON3 — 175 Righter Rd, Succasunna NJ (DaVita, property_id 27266): raw Salesforce Account IDs stored as owner/buyer/seller names, a stale $10.3M estimate sitting next to a closed $2.6M sale, and a sidebar-polluted lease tenant

**Filed:** 2026-09-22 (Cowork), from Scott's SB note *Dialysis Property - Sept 22.docx* (SBN-19) — 12
screenshots of a property our team just sold, plus the exported client report *DaVita Renal Center Of
Succasunna — Net-Lease Asset Profile _ Northmarq.pdf* Scott added to the folder after the fact (SBN-20,
see Bug 4 below). **Owner:** LCC (dia intake/ingest paths in `api/`,
`supabase/migrations/dialysis/`, `test/`). **Read first:** `docs/architecture/property-identity-and-address-resolution.md`
(§P10a), RECON1's response (`docs/claude-code/prompts/done/RECON1-one-clinic-three-properties-ingestion-never-reconciles.md`,
same reconciliation-gap class, different property), RECON2's spec (`docs/architecture/reconcile-property-spec.md`),
backlog rows `RECON1`, `RECON2`, `PI1`-`PI8`.

## Scott's intent, verbatim

> Here are a handful of screenshots from a property our team recently sold that is clearly not
> reconciling across many different sources or inputs like we want it to so that there is one single
> source of truth for the property in the LCC that's being connected and propagated everywhere. …
> I want to audit and track this property and sales and listing and lease to all places in the
> database that we have designed and intended its records to be included and summarized and related
> or located. Ensure we are hitting those places and all the data is connected from all sources,
> reconciled against each other and there's one source of accurate and connected truth.

This is the same class of problem RECON1 diagnosed on the DaVita Banning clinic and RECON2 is building
a general `reconcile_property()` for — this is a second, independently-discovered concrete case,
different failure mode. Use it as a second test case against RECON2's spec once that lands; do **not**
build a third one-off reconciler for just this property.

## What is true for this one property (Dialysis_DB, measured 2026-09-22, `property_id = 27266`)

**The property.** 175 Righter Rd, Succasunna, NJ 07876 (Morris County). DaVita, CCN 312623, 12
stations, 4,704 SF, single-tenant medical office. Listed by us Jul 30, 2026 at $2.6M, **sold Sep
8/9, 2026 for $2,587,220 (6.65% cap, Scott Briggs broker)** — confirmed live in `sales_transactions`
(`sale_id 15170`) and in the app's own Activity Log / Deal History tabs.

**Bug 1 — raw Salesforce Account IDs stored as names, not just displayed wrong.** This is not a
rendering bug; the raw ID is what's actually in the database:
- `sales_transactions.buyer_name` = `'0018W00002X08eTQAR'`, `seller_name` = `'0018W00002XDlmDQAT'`
  (`sale_id 15170`). `sf_deal_id` is `null` on this row — this sale was never matched to a Salesforce
  Opportunity, which is consistent with the app's own "No Salesforce Opportunity — Create SF Account
  before opening Opportunity" banner on the Overview tab despite the pipeline stage already reading
  `SOLD`.
- `recorded_owners.name` **and** `recorded_owners.canonical_name` = `'0018W00002X08eTQAR'` (row
  `recorded_owner_id = 634c88c0-ebde-4f69-919e-054e7da327a0`, `updated_at = 2026-09-20 12:40 UTC` —
  i.e. written two days ago, after the sale, not stale legacy data). `true_owner_id` is populated
  (`aa4ee5d4-3832-4289-8541-2cda9e67a150`) but that `true_owners` row's `name` is also unresolved.
- `properties.recorded_owner_name` = `'0018W00002X08eTQAR'`, `properties.true_owner_name` = `null`,
  propagated from the above via `reconcilePropertyOwnership()` (`api/_handlers/sidebar-pipeline.js:10267`),
  which is working correctly — it's faithfully propagating whatever `recorded_owners.name` already
  holds. **The actual defect is upstream of that function**: wherever this sale's buyer/seller first
  got written from Salesforce never resolved the Account ID to the Account's `Name` field. Not yet
  located exactly — grepped `buyer_name:` write sites (`sidebar-pipeline.js:7197,7946`, `detail.js`
  several, `dialysis.js:12185`, `gov.js:3056,3226`) without conclusively identifying which path this
  particular sale went through; the Deal History card's own note says "Staged from LCC OM intake
  `ebb910ed-7ba3-4ace-8f29-82e14cf45c9c`", which points at `intake-promoter.js` as the likely entry
  point, not a sidebar capture. **Part (a) of this prompt: find that exact write path and fix it to
  resolve the SF Account ID -> Account Name before writing `buyer_name`/`seller_name`/`recorded_owners.name`.**
- **Blast radius unknown — not measured.** This is one property found by accident from a client note,
  not a targeted search. Part (b): a live query for how many `recorded_owners.name` / `sales_transactions.buyer_name`
  / `seller_name` rows match a Salesforce ID pattern (`^001[A-Za-z0-9]{15}$` — the 18-char Account ID
  prefix) across both Dialysis_DB and government, then a backfill pass through the same resolver this
  prompt builds for part (a).

**Bug 2 — the property's estimated value never updates once a real sale closes.**
`properties.current_value_estimate = 10257374.40` (~$10.3M) sits unchanged next to a confirmed closed
sale of $2,587,220 twelve days ago. Root cause, read directly from the function:
`reconcilePropertyOwnership()` (`api/_handlers/sidebar-pipeline.js:10346-10349`):
```js
// 3. Back-fill current_value_estimate from the latest sold price
if (latestPrice && !prop.current_value_estimate) {
  patch.current_value_estimate = latestPrice;
}
```
This only fills `current_value_estimate` when it is **empty**. It was already populated (presumably by
whatever earlier valuation model runs against listed/unsold properties), so a genuine closed sale —
the single most authoritative value signal that exists — never overwrites a stale pre-sale estimate.
**Part (c): fix the guard to prefer a closed sale over a modeled estimate** (e.g. always overwrite when
the latest `ownership_history`/`sales_transactions` row is newer than whatever produced the existing
estimate, or drop the "current estimate" concept entirely once a property is `SOLD` and show the sale
price instead — Scott's own words, "Est. value is clearly miscalculated," support the second reading).
Measure how many other `SOLD`-pipeline properties carry a stale pre-sale `current_value_estimate` before
deciding the fix is scoped correctly here or needs to be broader.

**Bug 3 — the active lease's tenant is the property's own display name, not the actual tenant.**
`leases` for property 27266:

| lease_id | tenant | lease_start | data_source |
|---|---|---|---|
| 16621 (active, drives Rent Roll) | `DaVita dialysis clinic in Succasunna` | 2025-12-28 | `costar_sidebar` |
| 9108 (2017, superseded) | `Davita Renal Center Of Succasunna` | 2017-06-01 | `null` |
| 24514 (2017, superseded) | `DaVita Kidney Care` | 2017-05-01 | `davita_subledger` |

The active lease's `tenant` is literally this listing's page title, not an operator/tenant name — a
CoStar sidebar misparse (same defect class as `SIDEBAR2`/`SIDEBAR3`/`SIDEBAR4`, worth checking whether
those fixes' guard covers this field). The app's own suggested fix, "Back-fill properties.tenant from
active lease tenant ($2.6M value)," would copy this same bad string one level up — **do not run that
suggestion as-is; fix the lease row's tenant first** (canonical form should read `DaVita` or `DaVita
Kidney Care`, matching the two historical rows and the operator field already correct everywhere else
on this property's own Overview/Operations tabs).

**Design gap — comparison cohort tables carry no rent or patient-count columns.** The Operations tab's
"Nearby Owner Cohort" (17 rows) and "Competitive Landscape" (5 rows) tables show address/city/distance/owner/operator/tenant
only. "Comparative Rankings" ranks By Patients and By Revenue but not by rent. Scott's words: "we also
aren't showing comparable rents or patient counts in these comparison cohort groups." Add rent/SF and
current patient census as columns to both tables if the underlying data already exists per-property
(it does — `leases.rent_per_sf`, CMS patient census are both populated on this very property).

**Documents tab — thin and (per Scott) non-functional.** Only 2 attachments, both named identically
`DaVita_Succasunna_NJ_OM_SB.pdf` (one from SharePoint dated Jul 31, one from Supabase dated Jul 30 —
likely the same file landed twice from two ingestion paths). Scott: "Neither of these two links work
and we're missing all the diligence files we have for this asset" (rent roll, lease abstract — these
live in ShareFile per his note, not yet connected to this property). Not independently verified from
here (link-click behavior isn't observable from a screenshot) — **part (d): reproduce the broken
`Open ↗` links, and separately audit why only the OM made it into Documents when ShareFile evidently
holds more for this deal.**

**Bug 4 (SBN-20) -- the client-facing Asset Profile export has zero sale-status awareness.** Scott
exported this property's Northmarq-branded "Dialysis Net-Lease · Asset Profile" PDF on 2026-09-22 at
6:42 AM -- **two weeks after the property closed** (sold 2026-09-09, `sale_id 15170`, $2,587,220) --
and added it to this SB note as the "exported client report" his original note referenced (flagged as
missing when SBN-19 was first triaged; it wasn't fabricated, just filed a few hours later). The export
itself, read end to end, contains **no sale indicator anywhere**: no "SOLD" badge, no closed-sale date
or price, no banner -- it presents live Risk Assessment (35/100, "Moderate Risk"), a 15%-weighted "Lease
Expiration" score, and a cap-rate/value crosswalk exactly as it would for an active listing. Traced to
the generator: `_udExportOperations()` (`detail.js:5436`) builds this HTML purely from
`_udCache.property`/`_opsExtraCache` (CMS, HCRIS, rankings, lease) and never reads `pipeline_stage`
(tracked separately on `property_intel`, see `detail.js:2246`) or checks `sales_transactions` for a
closed sale on this property. **This is a business-risk-grade gap, not a cosmetic one** -- nothing stops
this same button from generating and being sent to a client/investor as a current analysis of a
property Team Briggs no longer has under contract or listed.

Two things in this same export are worth keeping as corroborating evidence for Bugs 2/3 above, not new
defects: the $172,050 "Contract rent" figure matches lease 16621's `rent`/`annual_rent` exactly
(verified live), so the underlying rent number is right even though that same row's `tenant` field is
the bad display-name string (Bug 3). And the export's own rent-based "implied
real-estate value" crosswalk ($2.29M-$2.87M across a 6.0-7.5% cap range) lands close to the actual
$2.587M sale price -- a sharp contrast with the sidebar's stale $10.3M `current_value_estimate` (Bug 2),
and a hint that the export's cap-rate crosswalk (not the sidebar's never-overwrite estimate) is the
right model to prefer once a property is `SOLD`.

## What this prompt asks for



1. **Trace and fix the SF-Account-ID-as-name write path** (part a above) — find where this sale's
   `buyer_name`/`seller_name`/`recorded_owners.name` got written as raw Salesforce IDs, add the
   Account-Name resolution step, and correct property 27266's rows as the first proof case.
2. **Measure the blast radius** (part b) and backfill every other row this same defect hit, across
   both Dialysis_DB and government.
3. **Fix `current_value_estimate` to prefer a closed sale over a stale model estimate** (part c),
   after measuring how many other `SOLD` properties are affected.
4. **Fix lease 16621's `tenant`** and re-check the CoStar sidebar tenant-capture path for the same
   misparse class `SIDEBAR2`-`4` already fixed elsewhere.
5. **Reproduce (or refute) the two broken Documents links** and account for the missing diligence
   files (part d) — file as its own follow-up if it turns out to be a ShareFile-connection gap rather
   than an LCC bug.
6. **Design-gap addendum**: add rent/SF and patient-census columns to the Nearby Owner Cohort and
   Competitive Landscape tables (non-blocking, can ship separately).
7. **Gate the Asset Profile / client-report export on sale status** (Bug 4/part e) -- before
   `_udExportOperations()` (`detail.js:5436`) renders, check `sales_transactions` (and/or
   `pipeline_stage`) for a closed sale on the property and, if one exists, replace the live
   Risk Assessment / Lease Expiration scoring with a closed-sale banner (date, price, buyer once
   Bug 1 is fixed) so this export can never be sent out as if the deal were still live. Consider
   whether this same gate belongs on every export/report generator, not just this one, as part of
   the blast-radius measurement in part (b).

⛔ Do not build a new one-off reconciliation script for this single property — RECON2 is already
building the general `reconcile_property()` this case should ultimately run through. Where this
prompt's fixes are narrower than RECON2's eventual scope (e.g., the SF Account-ID resolver), build
them as reusable helpers RECON2 can call, not inline one-property patches.
