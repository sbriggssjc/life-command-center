# Work-product file hygiene — STANDING CONVENTION (apply to every request)

> Scott's directive (2026-06-22). These rules govern how master sheets and work-product files are
> named and organized in the shared Team Briggs PROPERTIES folder structure. **Apply automatically
> on every deliverable — do not wait to be asked.**

## Master sheets (and work-product files generally)
1. **One master sheet in the property folder base.** The single file in the base IS the latest/
   current version — never leave two master sheets side-by-side in the base.
2. **Archive older versions in an `Old/` subfolder** inside that same property folder (a "prior
   transaction / old" folder). Move, don't delete — keep the history.
3. **Name by date/year, never by status word.** Differentiate versions with the date or year
   (e.g. `..._MasterSheet_2026-06.xlsx`, prior `..._MasterSheet_2026-03.xlsx`). **Never** use
   `CORRECTED`, `PRIOR`, `FINAL`, `v2`, etc. in the filename — those are confusing. The date is the
   version.
4. When a new version is produced: save it date-named in the base, move the previous base file into
   `Old/` (date-named), and delete any transient intermediates so the base stays to exactly one.

## Naming pattern
`<PropertyShortName>_<KeyAddressOrParcel>_<DocType>_<YYYY-MM>.<ext>`
e.g. `Valley_207FobJames_MasterSheet_2026-06.xlsx`. DocType ∈ {MasterSheet, BOV, OM, SalesComps,
LeaseComps, BuyerShowings, …}. Supporting docs (DD findings, etc.) may sit in the base but are not
"master sheets" and don't count against rule 1.

## Worked example (Valley MOB, applied 2026-06-22)
- Base: `Valley_207FobJames_MasterSheet_2026-06.xlsx` (current) + `Valley_MOB_DD_Findings_2026-06.md`.
- `Old/Valley_207FobJames_MasterSheet_2026-03.xlsx` (the prior BOV-stage master, archived).
- Intermediate `_CORRECTED.xlsx` deleted (no status words in names).

This convention should also be reflected in the §4 naming/delivery section of
`WORK_PRODUCT_FRAMEWORK.md` and applied by the future master-sheet generator.

## Standard property-folder structure (the filing system)
```
PROPERTIES/
  <Bucket>/                         # A–Z by tenant/brand initial, or "Multi" for multi-tenant
    <Tenant or Brand>/              # CVS pharmacy · DaVita · Valley MOB …
      <City, ST>/                   # Philadelphia, PA
        <Property>_<Addr>_MasterSheet_<YYYY-MM>.xlsx   # ONE current master sheet (base)
        <Property>_..._DD_Findings_<YYYY-MM>.md         # current working notes (optional)
        Rec'd/        # received DD: leases, tax, deeds, seller emails (sub-folders OK)
        Marketing/    # OM, flyers, photos, marketing collateral
        Old/          # superseded versions / prior transactions (date-named)
```
- Fold legacy variant folders into this: `Raw/Diligence` → `Rec'd/`; ad-hoc `Pricing Update` →
  dated files (or a dated sub-folder); `Past Deals` → `Old/` (or a clearly-labeled prior-transaction
  sub-folder).
- A reference doc from outside our file system (e.g. a competitor's prior OM kept for expense/detail
  reference) lives in `Rec'd/` (or `Rec'd/Reference/`), clearly not a Northmarq work product.

## ⚠ Sync-root hazard (flagged 2026-06-22)
The Team Briggs library is currently synced to **two local roots** on this machine —
`C:\Users\scott\NorthMarq Capital, LLC\Team Briggs - Documents\` (the connected/working root) and
`C:\Users\scott\OneDrive - NorthMarq Capital, LLC\Team Briggs - Documents\` (a second sync). Two
roots of one SharePoint library cause exactly the "I edited one, you opened the other" confusion +
risk of sync conflicts. **Recommendation: keep ONE sync of the library** (stop syncing the
duplicate), and treat **SharePoint online as the source of truth**. Edits land in SharePoint and
propagate to whichever local root remains.
