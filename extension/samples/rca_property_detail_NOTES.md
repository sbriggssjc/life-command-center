# RCA Property Detail Page — DOM structure notes

Sample captured 2026-04-27 from app.rcanalytics.com/property/{id}/summary.
Sample property: DaVita Vista Del Sol Dialysis, 15002 Amargosa Rd, Victorville CA.

The full HTML sample was provided inline in the build session; not committed
here because the page is ~250KB of Angular + Google Maps boilerplate. Below
is the structural summary needed to write extension/content/rca.js.

## Stable selectors

Property identity:
  h1.property-name              — "DaVita Vista Del Sol Dialysis"
  h5.property-address > span:nth-child(1)   — street ("15002 Amargosa Rd")
  h5.property-address > span:nth-child(2)   — city/state/zip ("Victorville, CA 92394 USA")
  .property-description span    — "11,780 sf"
  .property-description .text-lowercase   — "Suburban Office"

Property Characteristics:
  .panel-heading text "Property Characteristics" anchors the section.
  .PropertyCharacteristicsTable .row.row-no-gutters
    > label   — field name (e.g. "sf", "Year Built", "Property Type")
    > div > span — field value (e.g. "11,780", "2016", "Office")
  Some fields have multi-row values (Deed, APN — see .ExpandableList).

Tenants:
  .panel-heading "Tenant(s)" + as-of date span.
  table.tenants tbody tr > td.name   — each tenant name (e.g. "DaVita Dialysis")

Owners:
  .panel-heading "Owner(s)" anchors.
  .owner .owner-info-block .name a    — company name (e.g. "Vana Medical LLC")
  .owner .address                     — city/state/country
  .owner-bullet-block .bullet         — investor highlights snippet
  Expandable: legal-entity name + address (when "+" toggled)

Financing:
  .panel-heading "Financing" anchors.
  Each loan: .financing > .summary text "$3.4 m 1st Mortgage with First Citizens".
  Detailed metrics (when expanded): property-detail-metric pairs of label+metric:
    Loan Status, Loan Type, Loan Amount, Interest Rate, Debt Yield,
    Total Reserves, Term, Deal Appraisal, Originator, Lender Name,
    Lender Group, Special Servicer, Mortgage Broker, Original LTV,
    Loan dscr, Amortization Type, Origination, Defeasance Date,
    Prepayment Date, Original Maturity, Extension Maturity.

Property History (sales transactions):
  .panel-heading "Property History - N Events" anchors.
  Each row in tbody: tr.ellipsify
    td.transaction      — type/date/proptype ("Sale Feb '26 Office")
    td.propertyInfo     — sf/yearbuilt/bldgs ("11,780 sf 2016 1 bldg/1 flr")
    td.transactionPrice — price/$psf/caprate ("$5,362,000 approx $455 /sf")
    td.entities         — buyer/seller/lender chain (HTML with images per role)
    td.comments         — narrative ("100% occ.;Office - Sub/medical property; Tenants: ...")

## Mapping to LCC metadata schema (sidebar-pipeline.js writers)

  RCA field                         -> LCC metadata key
  --------------------------------    --------------------------
  property-name                       building_name
  property-address span 1+2           address, city, state, zip
  Characteristics: sf                 square_footage
  Characteristics: Year Built         year_built
  Characteristics: Property Type      property_type
  Characteristics: Property Subtype   property_subtype
  Characteristics: Land area          lot_size
  Characteristics: Submarket          submarket
  Characteristics: Walk Score         walk_score
  Characteristics: APN                parcel_number
  table.tenants tr.name[]             tenants[]
  Owner info-block name               contacts[] role=owner / current_owner_name
  Owner address                       — (separate; could be a contact entity)
  Property History rows -> Sale       sales_history[]:
    {date: "Feb '26", sale_price: "$5,362,000", price_per_sf: "$455",
     buyer: "Vana Medical LLC", seller: "Eugene A Blefari; ...",
     lender: "First Citizens", loan_amount: "$3.4m", deed_type, comments}
  Financing summary                   loan_history[] (currently sales-embedded)

## Implementation hints

1. RCA's text content is line-oriented after textContent extraction, similar
   to CoStar. The CoStar parser's textContent.split('\n') approach should
   work — anchor on the panel headings ("Property Characteristics",
   "Tenant(s)", "Owner(s)", "Financing", "Property History").

2. Better: use the stable CSS selectors above, querySelector against the
   live DOM. RCA's classes are component-scoped and stable across page loads.
   The CoStar parser is text-based because CoStar's selectors are not stable
   (they use SCSS hash classnames). RCA does not.

3. Attribution: in the metadata blob, set `metadata._source = 'rca'` so the
   server-side sidebar-pipeline.js can apply RCA-specific defaults. It may
   want to skip the `isJunkTenant` filter (RCA tenant rows are clean) and
   trust RCA's date/price formats.

4. URL detection: window.location.hostname.endsWith('rcanalytics.com')
   gates the RCA parser. window.location.pathname.startsWith('/property/')
   for the Property Details page.

5. Manifest patterns to add to extension/manifest.json content_scripts:
     "*://app.rcanalytics.com/*"
     "*://app2.rcanalytics.com/*"
