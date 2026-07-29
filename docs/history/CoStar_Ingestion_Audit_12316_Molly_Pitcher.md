# CoStar Ingestion Audit — 12316 Molly Pitcher Hwy, Greencastle PA

**Property:** FEMA Distribution Center (251,043 SF, built 2023)
**Lease:** Federal Emergency Management Agency · Single-tenant · NNN · Industrial/Distribution
**Last Sale:** $45,750,000 (11/13/2025) — ATAPCO → Boyd Watterson (Greencastle PA I FGF LLC)
**Lender:** CMFG Life Insurance Co — $23.5M (New Conventional)
**Date:** April 21, 2026

---

## TL;DR — Four code defects explain every anomaly in this run

| # | Severity | Area | Symptom in this ingest |
|---|---|---|---|
| 1 | **CRITICAL** | `extension/content/costar.js` → `extractTenants` / tenant-name extraction | `Domain: not matched`. FEMA was never written into `tenant_name`, `tenants[]`, or any classifier input, so `classifyDomain` saw only "distribution" and fell through to null. Property was NOT propagated to the government DB. |
| 2 | **HIGH** | `extension/content/costar.js` → `extractContactsFromDOM` (`findContactContainer` / `findContactBlocks`) | Every contact appears under 5–6 roles (CMFG tagged as Buyer + Seller + Lender + Listing Broker + true_buyer_contact). The DOM section walker resolves to a shared ancestor, so each section header paints its role onto the entire Contacts panel. |
| 3 | **HIGH** | `extension/content/costar.js` → text-parse `parsePersonBlocks` stop list | Titles bleed into contact names ("Senior Managing Director", "Senior Vice President", "Senior Managing Director, Capital Markets" appear as standalone contacts). Stop-pattern list does not include `true buyer`, `true seller`, `current owner`, `recorded owner`. |
| 4 | **MED** | `extension/content/costar.js` → `mergeSales` + `parseDeedHistory` | Two sale rows captured for the same ATAPCO→Boyd Watterson transaction (Nov 7 Transaction Detail + Nov 13 Recordation). `mergeSales` dedups by normalized `sale_date` only, so a transaction vs. recordation date mismatch leaves both rows. |

Because defect #1 fires first, defects #2–#4 never get the chance to write into the government DB — which is why every `Current LCC` field in the sidebar shows "—". The property landed in LCC Ops but nothing propagated downstream.

---

## 1. Root Cause: `Domain: not matched` on a federal‑tenanted building

### What the UI shows

```
Tenants
Tenancy: Single · Owner Occupied: No · Est. Rent: $6 - 7/SF (Industrial)
Federal Emergency Management Agency
251,043 SF
```

### What `classifyDomain` received

The classifier builds `searchText` from these fields (`api/_handlers/sidebar-pipeline.js:408–448`):

```js
metadata.tenant_name
metadata.primary_tenant
metadata.building_name
entityFields.name / description
metadata.asset_type            // "Distribution"
metadata.property_type
metadata.property_subtype
metadata.occupancy_details
metadata.sale_notes_raw
metadata.tenants[].name        // <-- FEMA should be here
metadata.contacts[].name
metadata.pdf_extracted_texts
```

`/\bfederal\b/` and `/\bfema\b/` are in `GOV_TENANT_PATTERNS` (line 45). Either would match "Federal Emergency Management Agency". So the classifier inputs had to be empty of tenant text for the run to return `null`.

### Why the inputs were empty

**(a) `tenant_name` extractor rejects "Tenancy …" as the value line.**
`extension/content/costar.js:762–768`:

```js
if (!data.tenant_name && /^tenants?$/i.test(line) && next
    && next.length > 2 && next.length < 80
    && /^[A-Z]/.test(next)
    && !TENANT_REJECT.test(next)
    && ...) {
  data.tenant_name = next;
}
```

The line after `Tenants` on this page is `Tenancy: Single · Owner Occupied: No · Est. Rent: $6 - 7/SF (Industrial)`. That string starts with `Tenancy`, which is listed in `TENANT_REJECT` (line 751). The extractor bails and never looks at `lines[i+2]` = `"Federal Emergency Management Agency"`.

**(b) `extractTenants` only looks for two section headers.**
`extension/content/costar.js:975–994`:

```js
if (/^tenants?\s+at\s+sale$/i.test(line)) { parseTenantSection(...); continue; }
if (/^tenant\s+detail$/i.test(line))      { parseTenantSection(...); continue; }
```

The Industrial Sale Comp page uses a bare `Tenants` header — neither regex matches, so `tenants[]` is empty.

**(c) `asset_type` was `Distribution`.**
No gov keyword; no hit.

Net result: `searchText` had only `"distribution"` (plus buyer/seller entity names, none of which contain gov keywords). `classifyDomain` returned `null`. `propagateToDomainDb` short-circuited with `{ propagated: false, reason: 'no_domain' }` (`sidebar-pipeline.js:885`). No Government DB writes occurred. That's why every `Current LCC` column is blank.

### Fix prompt

```
In extension/content/costar.js, fix FEMA-style tenant capture that is silently
dropped on Industrial Sale Comp pages.

1) Around line 762 (the "Tenants" header branch for tenant_name):
   - Do NOT hard-reject any line containing "Tenancy". Instead, when the next
     line starts with /tenancy|single\s+tenant|multi.tenant|est\.? rent|net
     lease|gross lease/i, SKIP that line and evaluate lines[i+2] (and i+3 if
     also a stats line) as the candidate tenant name.
   - Allow candidate names that start with any capital letter OR uppercase
     acronym — right now we accept /^[A-Z]/, which is fine, but we must also
     reject names that are SF-only ("251,043 SF") or owner-occupied flags.

2) Around line 975 (extractTenants), add a third header match:
     /^tenants?$/i        // bare "Tenants" header used on industrial pages
   Then in parseTenantSection, add "Tenancy:" / "Owner Occupied" / "Est. Rent"
   lines to the skip list (they are summary-bar values, not tenant names).

3) After extractTenants returns, if tenants[] is still empty but the page
   contains a single-tenant industrial block (detect via
   /tenancy:\s*single/i AND a following all-caps or Mixed-Case agency name
   followed by an SF value on the very next line), synthesize one tenant
   entry from that block.

Verify: on 12316 Molly Pitcher Hwy Greencastle PA, data.tenant_name must
equal "Federal Emergency Management Agency" and tenants[0].name must equal
the same. Then classifyDomain → 'government', GOV_TENANT_PRIORITY picks FEMA
as primary tenant, and propagateToDomainDb writes to government DB.
```

A small belt-and-suspenders tweak in the backend is also worth adding:

```
In api/_handlers/sidebar-pipeline.js classifyDomain (around line 408), ALSO
include metadata.tenants_raw and metadata.tenancy_block when present, and
ALSO include any line from metadata.sale_notes_raw. Today sale_notes_raw is
already pushed, but on Sale Comp pages the tenant name shows up in the
"Investment Highlights" / tenant summary block; we should push that too.
```

---

## 2. Every contact appears under 5–6 roles (Buyer = Seller = Lender = Broker)

### What the UI shows

- `Boyd Watterson Global`, `Greencastle PA I FGF LLC`, `Atapco Properties`, `Atapco Acquisitions LLC`, `JLL`, every JLL broker, AND `CMFG Life Insurance Company` all appear under **true_buyer_contact, Buyer, true_seller_contact, Seller, Listing Broker, Lender**.
- Standalone title strings ("Senior Managing Director", "Senior Vice President", "Senior Managing Director, Brokerage", "Senior Managing Director, Capital Markets", "Managing Director, Capital Markets", "Senior Comps Researcher") are stored as contact names.

### Two defects combining

**Defect 2a — DOM extractor's section resolver (`extractContactsFromDOM`, lines 1467–1510).**

```js
for (const header of sectionHeaders) {
  const container = findContactContainer(header.element);   // walks up 5 parents
  if (!container) continue;
  const contactBlocks = findContactBlocks(container, header.element);
  for (const block of contactBlocks) {
    const person = extractPersonFromBlock(block);
    person.role = header.role;                               // paints header role on ALL blocks
    contacts.push(person);
  }
}
```

`findContactContainer` (1521–1531) walks up to 5 ancestors and returns the first one that has any `mailto:`/`tel:` descendant. CoStar Sale Comp pages wrap every contact group (True Buyer / Recorded Buyer / True Seller / Recorded Seller / Listing Broker / Buyer Broker / Lender) inside a single `Contacts` panel that has mailto/tel links throughout. So every header — "True Buyer", "Lender", "Listing Broker", etc. — resolves to the SAME container and `findContactBlocks` returns the SAME list of blocks. Each header then stamps its role onto every block, producing the 5×–6× duplication we see.

**Defect 2b — text extractor's stop list (`parsePersonBlocks`, lines 1361–1376).**

When DOM extraction is active, it runs first and returns a non-empty list, so the text parser is skipped — but the DOM result is already corrupt. Even if we fell back to the text parser, its stop regex:

```js
/^(transaction\s+details|building|land\b|market|tenants?\s+at|public\s+record|
   my\s+notes|sources|verification|sale\s+comp|comparable|
   recorded\s+(seller|buyer)|lender|©\s*\d{4}|...)/i
```

includes `recorded (seller|buyer)` and `lender`, but does NOT include `true buyer`, `true seller`, `current owner`, `recorded owner`, nor `buyer broker` as full-line stops. That means parsing e.g. the Listing Broker section keeps going through the following True Buyer / Current Owner blocks, sweeping those people up as additional listing brokers.

### Title bleed

`parsePersonBlocks` relies on `isNameLine` (lines 1343–1355) vs `isTitleLine` (1357–1359). For CoStar's modern DOM layout, the first line after a person's name can be their title OR the NEXT person's name. The current logic:

```js
if (!current.title && isTitleLine(line)) { current.title = line; continue; }
if (current.title) { pushCurrent(); current = { name: line, type: 'person' }; continue; }
```

works when the line structure is `Name → Title → phone → email → Name → Title → …`, but CoStar DOM pulls titles out of child spans and then `textContent.split('\n')` interleaves title text with subsequent names. When the title contains a comma (`Senior Managing Director, Capital Markets`) and is on its own line, the code treats the line AFTER it as a brand-new person named "Senior Managing Director, Capital Markets" if there was no preceding name buffered. That matches the standalone title-as-name entries we see in the output.

### Fix prompt

```
In extension/content/costar.js:

A) Rewrite extractContactsFromDOM so section containers are scoped between
   adjacent section headers, not resolved via 5-parent walk.
   - Collect sectionHeaders in DOM order.
   - For header[i], define its container as: the common ancestor of
     header[i].element and header[i+1]?.element, sliced to the DOM range
     (header[i].element, header[i+1].element). Use a TreeWalker or a manual
     DOM slice so only nodes between the two headers are considered.
   - findContactBlocks should ONLY look inside that slice.
   - For the last header, use the common-ancestor range from header[last] to
     the next non-Contacts sibling section (My Notes / Sources / Verification
     / Documents / Assessment).

B) In parsePersonBlocks (line 1361):
   - Add these full-line stop patterns (^...$):
     true\s+(buyer|seller)
     current\s+owner
     recorded\s+(owner|buyer|seller)
     buyer\s+broker
     listing\s+broker
     seller
     buyer
   - Keep the existing `j > startIdx` guard so the header line that started
     this parser doesn't trip the stop immediately.

C) Tighten isContactNameGarbage / isNameLine to reject title-only strings:
   - A string is NOT a name if it matches /^(senior|junior|managing|executive|
     vice|chief|assistant)\s+(managing\s+)?(director|vice\s+president|vp|
     president|officer|partner|principal|consultant|broker|manager)\b/i
   - A string is NOT a name if it ends with ",\s*(capital\s+markets|
     brokerage|research|investment\s+sales|debt|equity)$"
   - A string is NOT a name if it equals "Senior Comps Researcher" (and
     similar — any pure-title token).

D) Add a dedupe pass in costar.js before sendMessage:
   - Group contacts by normalized name (lowercased, trimmed, punctuation
     stripped). Merge into a single contact whose roles[] is the union of
     observed roles. Emit ONE contact with roles[] (array) instead of N copies
     each tagged with a different role.
   - Preserve the existing single-role contract for downstream code by
     emitting a representative .role equal to the highest-priority role:
        listing_broker > buyer_broker > lender > true_buyer > true_seller >
        true_buyer_contact > true_seller_contact > buyer > seller > owner.
   - Downstream (sidebar-pipeline.upsertSidebarContacts, role-gated
     processors) already filter by role — they'll just see the strongest
     one per person.

E) Update api/_handlers/sidebar-pipeline.js upsertSidebarContacts (line 948)
   so that if contact.roles is an array, it writes ALL of them as separate
   contact_type rows in the government DB (or concatenates into the text
   column for dialysis DB). This preserves the "listing broker who is also
   the buyer broker" case without 5x duplication.
```

---

## 3. Duplicate sale rows for the same transaction

### What the UI shows

```
Nov 7, 2025   $45,750,000   Investment · Hold: 27 Months
11/13/2025    $45,750,000   Arms Length · Resale w/Financing · Special Warranty Deed
              Seller: ATAPCO ACQUISITIONS LLC
              Buyer: GREENCASTLE PA I FGF LLC
              Lender: Cmfg Life Insurance Co — $23,500,000 ...
```

Both rows are the same Boyd Watterson acquisition — **Nov 7** is CoStar's internal "Transaction Date" (signing/close), **Nov 13** is the County Recordation Date. The Transaction Details block captures Nov 7; `parseDeedHistory` from Public Records captures Nov 13.

### Defect

`mergeSales` (`extension/content/costar.js:420–451`) matches by `normalizeSaleDate(sale_date)`:

```js
const sDate = normalizeSaleDate(s.sale_date);
...
const matchIdx = existing.findIndex((e) => {
  const eDate = normalizeSaleDate(e.sale_date);
  if (eDate !== sDate) return false;   // <-- different ISO dates → no match
  ...
});
```

Nov 7 and Nov 13 normalize to different ISO strings, so `matchIdx = -1` and both rows get pushed. That cascades into the domain pipeline as two `sales_transactions` inserts, two `activity_events`, and (since both carry the same `$45.75M` buyer and lender) potentially two `loans` rows if `loan_amount` and `lender` survive on both.

### Fix prompt

```
In extension/content/costar.js mergeSales (line 420):

1) Enrich the match predicate:
   - If either side has a document_number (from parseDeedHistory), match on
     document_number first. Same doc # = same transaction regardless of date.
   - Else, match on sale_price within 5% AND (sale_date window <= 14 days OR
     buyer normalized names equal OR seller normalized names equal).
   - The 14-day window covers transaction-vs-recordation slip. Most deeds
     record within 10 business days of closing.

2) When two candidates match, keep the one with more fields (see existing
   saleFieldCount helper), then merge the secondary fields from the other.
   Prefer recordation_date over sale_date when both exist; store both as
   separate fields.

3) Add a unit test (in whichever test harness exists) that asserts two rows
   {date: "Nov 7, 2025", price: "$45,750,000"} and
   {date: "11/13/2025", price: "$45,750,000", document_number: "2025.22829"}
   merge into a single row.
```

In the LCC Ops pipeline (`api/_handlers/sidebar-pipeline.js:2193+ upsertDomainSales` and the loan writer around line 3097) add a defensive dedupe:

```
In upsertDomainSales and the loans writer, dedupe by the triple
(property_id, sale_price ±5%, sale_date ±14d) before insert. If a near-match
already exists in the table, merge the new fields into it instead of
inserting a second row.
```

---

## 4. Specific field gaps once domain propagation is restored

Assuming fix #1 lands and the pipeline reaches `propagateToDomainDbDirect` for this property, the `Current LCC` column should populate. The fields most at risk:

| CoStar field | Expected government_properties column | Notes |
|---|---|---|
| Building Size 251,043 SF | `rba` (sidebar-pipeline.js:1236 selects `rba` for `government`) | Should write correctly. |
| Year Built 2023 | `year_built` | Written by standard property upsert. |
| Lot Size 32.52 AC | `land_area` | Written. |
| Stories 1 | `stories` | `extractFields` captures stories; confirm government_properties has the column. |
| Parking 1.69/1,000 SF | `parking_ratio` | Text format — needs numeric parse in pipeline. |
| Zoning HC | `zoning` | Written. |
| Tenant: FEMA | `property_agencies` junction via `linkPropertyToGovAgency` (sidebar-pipeline.js:1490) | Requires FEMA to exist in `government_agencies.full_name`. Log a warning if lookup misses. |
| Parcel 01-A22-112A | `parcel_records` | Pipeline writes these; verify it ran. |
| Sale $45.75M / 11/13/2025 | `sales_transactions` | Depends on fix #3. |
| Lender CMFG $23.5M | `loans` | Writer at line 3097 skips rows without `loan_amount`; CoStar provides it. |
| True Buyer: Boyd Watterson Global | `true_owners` | Reconciler at line 2872 should link. |
| Recorded Buyer: Greencastle PA I FGF LLC | `recorded_owners` → properties.recorded_owner_id | Same ownership chain. |
| Seller: Atapco Acquisitions LLC | Prior owner in `ownership_history` | Should be written. |

The **`recorded_owner_name` / `true_owner_name` persistence bug** documented in the 15002 Amargosa audit (Issues 1–2 in `CoStar_Ingestion_Audit_15002_Amargosa.md`) still applies here and is still unfixed in `sidebar-pipeline.js`. After domain propagation works for this property, expect `properties.recorded_owner_name` to end up NULL even though `recorded_owner_id` is set. Apply that audit's **Prompt 1** (owner-name backfill after `reconcilePropertyOwnership`).

---

## Recommended rollout order

1. **Prompt in §1** (tenant extraction). Without this, nothing else propagates.
2. **Prompt 1 from 15002 Amargosa audit** (owner name persistence). Cheap, prevents the next confused sidebar diff.
3. **Prompt in §2** (contact section scoping + dedupe). Biggest CRM data-quality win — today every contact is tagged as Lender which corrupts prospecting lists.
4. **Prompt in §3** (sales merge). Prevents double-counted deals in underwriting pulls.
5. Re-run the pipeline on 12316 Molly Pitcher Hwy and verify `Current LCC` now shows RBA, year built, lot size, tenant, sale, and owner.

---

## Verification checklist for the re-run

After deploying the fixes, re-open the CoStar page and click Re-run Pipeline. The sidebar should show:

- `→ Government DB: 1 property, 1 sale, 1 loan, 1 owner, 1 true owner, N contacts`
- A `GOV` badge on the property header
- `Current LCC` filled in for every row in the "Proposed Updates from CoStar" table
- Exactly ONE entry per contact (Boyd Watterson once, JLL brokers once each, CMFG once)
- No contacts named "Senior Managing Director" or "Senior Comps Researcher"
- Exactly ONE row in `sales_transactions` for the 11/13/2025 deal (with document #2025.22829)
- FEMA linked via `property_agencies` to `government_agencies.full_name ILIKE '%Federal Emergency%'`
