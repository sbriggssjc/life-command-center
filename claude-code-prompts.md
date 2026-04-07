# LCC Feature Build Prompts for Claude Code

Use these prompts one at a time. Each is a self-contained task description.

---

## Prompt 1: Reorganize Bottom Nav — Promote Domain Tabs to Primary Nav

```
TASK: Reorganize the LCC bottom navigation so that Dialysis and Government are primary nav tabs instead of sub-tabs hidden under Business.

CURRENT STATE:
- Bottom nav has 5 tabs: Today, Pipeline, Inbox, Contacts, More
- "Business" is in the More drawer, and when opened it shows sub-tabs: Dialysis, Government, Marketing, Prospects, All Other
- Dialysis and Government are the two most-used domains but require 2 taps to reach (More → Business → domain tab)

DESIRED STATE:
- Bottom nav should have 6 tabs: Today, Dialysis, Government, Pipeline, Inbox, More
- Dialysis tab navigates directly to pageBiz with the dialysis sub-tab active
- Government tab navigates directly to pageBiz with the government sub-tab active
- The More drawer should contain: Contacts, Business (for Marketing/Prospects/All Other), Calendar, Messages, Entities, Research, Metrics, Sync, Data Quality, Settings
- The "Business" entry in More should still work but now only show Marketing, Prospects, All Other sub-tabs (since Dialysis & Government have their own primary tabs)

FILES TO MODIFY:
1. index.html — Bottom nav <nav class="bottom-nav"> at line ~287. Replace Contacts button with Dialysis and Government buttons. Move Contacts to the More drawer grid.
2. app.js — navTo() function and the bottom nav click handler. When data-page is "pageDia" or "pageGov", call navTo('pageBiz') then switchBizTab('dialysis') or switchBizTab('government').
3. styles.css — The .bottom-nav currently styles for 5 items. May need to adjust for 6 items (smaller icons/text or a scrollable row).
4. app.js — switchBizTab() and the bizSubTabs rendering: When navigating via primary nav to Dialysis/Government, auto-set the sub-tab and hide the sub-tab bar (since the user already selected the domain from the primary nav, showing sub-tabs is redundant — OR keep them visible for switching between sub-domains).

SVG ICONS TO USE:
- Dialysis: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="9"/></svg>
- Government: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>

CONSTRAINTS:
- Do NOT create new .js files in /api/. This is frontend-only.
- Maintain the existing pageBiz architecture — Dialysis and Government still render inside #bizContent via the existing domain tab system. The primary nav buttons are just shortcuts that set the active domain tab.
- The active state highlighting on the bottom nav should work correctly: when viewing Dialysis content, the Dialysis primary nav button should be highlighted (active class), not the More button.
- Run `node -c app.js` after changes to verify syntax.
```

---

## Prompt 2: Sales History Tab in Property Detail Sidebar

```
TASK: Add a "Sales History" tab to the unified detail panel that shows the full transaction chain for a property.

CURRENT STATE:
- detail.js contains openUnifiedDetail() which renders a tabbed sidebar overlay for properties, clinics, and other entities
- The detail panel already has tabs (Overview, Research, etc.) rendered via a tab bar
- Sales comp data exists in both gov and dia Supabase backends in tables like `sales_comps` or `transactions`
- The detail panel receives a record object and a type string (e.g., 'dia-clinic', 'gov-property')

DESIRED BEHAVIOR:
1. Add a "Sales" tab to the detail panel tab bar (for property-type records only — dia-clinic, gov-property, dia-property)
2. When clicked, query the appropriate Supabase backend for all sales/transactions matching that property_id
3. Render a vertical timeline showing each transaction:
   - Sale date (formatted)
   - Sale price (formatted as currency)
   - Price per SF (if available)
   - Cap rate (if available)
   - Buyer and Seller names
   - Source (CoStar, County Records, etc.)
4. Sort by date descending (most recent first)
5. If no sales history exists, show "No recorded transactions" with a prompt to add one
6. Include an "Add Transaction" button that opens an inline form with: date, price, buyer, seller, price_psf, cap_rate, source, notes

FILES TO MODIFY:
1. detail.js — Add 'sales' to the tab list for property-type records. Add renderDetailSalesTab() function.
2. For data fetching, use the existing diaQuery() or govQuery() proxy functions depending on record domain. The detail panel already knows the domain from the type parameter.

QUERY PATTERNS:
- Dialysis: diaQuery('sales_comps', '*', { filter: `property_id.eq.${propertyId}`, order: 'sale_date.desc' })
- Government: govQuery('sales_comps', '*', { filter: `property_id.eq.${propertyId}`, order: 'sale_date.desc' })

STYLING:
- Use the existing dark theme variables (--bg, --s2, --text, --text2, --accent, --border)
- Timeline style: vertical line on the left with dot markers at each transaction
- Match the existing detail panel card/section styling

CONSTRAINTS:
- Do NOT create new API files. Use existing diaQuery/govQuery proxy functions.
- Run `node -c detail.js` after changes to verify syntax.
```

---

## Prompt 3: Click-Through Entity/Contact Navigation

```
TASK: Build click-through entity and contact navigation so that clicking an entity name anywhere in the app opens a dedicated entity detail view with contact info, activity history, ownership history, and linked holdings.

CURRENT STATE:
- entityLink() function in app.js renders clickable entity name badges throughout the UI
- pageEntities exists as a page in index.html with an entity list
- pageContacts exists with contact cards
- Entity data comes from the Ops Supabase canonical model (entities table, contacts table)
- The unified detail panel (detail.js) can show entity details via openUnifiedDetail()

DESIRED BEHAVIOR:

### A. Entity Default View
When clicking any entity name badge (operator, owner, buyer, seller, broker), open the detail panel with an entity-focused view showing:

1. **Header**: Entity name, type (operator/owner/broker/investor), status
2. **Contact Card**: Primary contact name, phone, email, mailing address (from contacts table linked by entity_id)
3. **Activity Timeline**: Recent activities/interactions from the canonical model (activities table filtered by entity_id), showing date, type, subject, and notes — most recent first, limit 20
4. **Ownership Portfolio**: Properties owned by this entity — query properties table where owner_entity_id matches. Show address, city/state, property type, and tenant name. Each property row should be clickable to open its own detail panel.
5. **Transaction History**: Sales where this entity was buyer or seller — from sales_comps where buyer_entity_id or seller_entity_id matches. Show date, address, price, and role (Buyer/Seller).

### B. Contact Default View
When clicking a contact name, open the detail panel with:
1. **Header**: Contact name, title, company/entity name
2. **Contact Info**: Phone(s), email(s), mailing address, LinkedIn (if available)
3. **Linked Entity**: Clickable link to the parent entity
4. **Activity Timeline**: Activities linked to this contact_id

### C. entityLink() Update
Update the entityLink() function so that onclick calls openUnifiedDetail() with the entity data and type='entity'. If only a name string is available (no entity_id), do a quick lookup: query the entities table by name to get the entity_id, then open the detail.

FILES TO MODIFY:
1. app.js — Update entityLink() onclick handler
2. detail.js — Add entity and contact tab renderers: renderEntityOverviewTab(), renderEntityPortfolioTab(), renderEntityTransactionsTab(), renderContactDetailTab()
3. detail.js — Update openUnifiedDetail() to handle type='entity' and type='contact' with appropriate tab configurations

DATA QUERIES (use existing proxy functions):
- Entity lookup: fetch('/api/entity-hub?_route=entities&id=eq.{id}')
- Contacts for entity: fetch('/api/entity-hub?_route=contacts&entity_id=eq.{id}')
- Properties for entity: govQuery or diaQuery on properties table with owner filter
- Activities: fetch from canonical activities

CONSTRAINTS:
- Do NOT create new API files. Route through existing entity-hub.js and proxy endpoints.
- Handle the case where entity_id is not known (name-only) — do a search-then-open flow.
- The detail panel overlay already has the open/close pattern. Reuse it.
- Run `node -c app.js && node -c detail.js` after changes.
```

---

## Prompt 4: Export Comp Data to Excel Template

```
TASK: Add an "Export to Template" button on the Sales and Lease comp table views that exports the currently displayed comp data into a formatted Excel file matching the Briggs CRE comp template layout.

CURRENT STATE:
- Both gov.js and dialysis.js render comp tables via renderGovSales(), renderDiaSales(), etc.
- These tables show paginated rows with columns like address, city, state, sale_date, sale_price, price_psf, cap_rate, buyer, seller, sf, etc.
- The comp data is already loaded in memory (e.g., govData.sales, diaData.sales or similar arrays)

DESIRED BEHAVIOR:
1. Add an "Export" button in the comp table header area (next to pagination controls)
2. When clicked, generate a .xlsx file using SheetJS (cdnjs link already available)
3. The Excel file should have:
   - Header row with column names matching Briggs template: Address, City, State, Sale Date, Sale Price, Price/SF, Cap Rate, SF, Year Built, Buyer, Seller, Tenant, Property Type, Source
   - Data rows populated from the currently filtered/displayed comp set (not just the current page — all filtered results)
   - Basic formatting: bold headers, currency format on price columns, percentage format on cap rate, date format on sale date
   - Auto-column-width for readability
   - Sheet name: "Sales Comps" or "Lease Comps" depending on context
4. Trigger a browser download of the file named like "LCC_Sales_Comps_2026-04-07.xlsx"

IMPLEMENTATION:
- Load SheetJS from CDN: <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
- Add the script tag to index.html
- Create a shared utility function exportCompsToXlsx(data, type) in app.js that:
  a. Maps the comp array to the template column layout
  b. Creates a workbook with XLSX.utils.json_to_sheet()
  c. Applies column widths via ws['!cols']
  d. Triggers download via XLSX.writeFile()
- Add the Export button in both renderGovSales() in gov.js and renderDiaSales() in dialysis.js

FILES TO MODIFY:
1. index.html — Add SheetJS CDN script tag before app.js
2. app.js — Add exportCompsToXlsx(data, type) utility function
3. gov.js — Add Export button to renderGovSales() header, with onclick calling exportCompsToXlsx(govFilteredSalesData, 'sales')
4. dialysis.js — Add Export button to renderDiaSales() header, with onclick calling exportCompsToXlsx(diaFilteredSalesData, 'sales')

COLUMN MAPPING (sales):
{ address: r.address, city: r.city, state: r.state, sale_date: r.sale_date, sale_price: r.sale_price, price_psf: r.price_psf || r.price_per_sf, cap_rate: r.cap_rate, sf: r.building_sf || r.sf, year_built: r.year_built, buyer: r.buyer || r.buyer_name, seller: r.seller || r.seller_name, tenant: r.tenant || r.tenant_name, property_type: r.property_type, source: r.source || r.data_source }

CONSTRAINTS:
- Do NOT create new API files. This is 100% client-side.
- Run `node -c app.js && node -c gov.js && node -c dialysis.js` after changes.
- Verify the SheetJS CDN URL is accessible.
```

---

## Notes on Data Pipeline Issues (Not Code Fixes)

These items from the testing notes are **data/backend issues** that can't be fixed from the frontend. They need attention in the respective Supabase backends or edge functions:

1. **Open Activities count shows 633** — This comes from the ops DB materialized view `mv_work_counts`. The view query or the Salesforce sync may need filtering adjustments.

2. **Flagged Emails capped at 1,050** — The edge function at `/sync/flagged-emails?limit=500` has a hard limit. Increase the limit parameter or implement pagination in the edge function.

3. **Dialysis DB Health shows all zeros** — The `v_counts_freshness` view in the Dia Supabase is returning empty results. Check if the view exists and has data, or if the underlying tables it references have been renamed/restructured.

4. **"Briggsland Capital" entity name** — This appears to be test/placeholder data in the ops DB entities table. Needs manual cleanup in Supabase.
