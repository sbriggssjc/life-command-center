# Architecture: Lease Consolidation, Ownership Alignment, Salesforce Cross-Referencing

## Current State Problems

### 1. Lease Proliferation
Single-tenant properties accumulate multiple lease rows from different sources (master import, CoStar sidebar, PDF intake) that represent the SAME logical lease with extensions/renewals. Example: property 29799 has 5 lease rows for one DaVita lease.

Root causes:
- Tenant name variants ("Davita Green Bay Dialysis" vs "DaVita Dialysis" vs "DaVita Dialysis - MT")
- Different date ranges represent extensions, not separate leases
- No concept of lease continuity — each ingestion creates a new row if exact match fails
- `superseded_at` column exists but is never populated

### 2. Ownership History Misalignment
Ownership chain is disconnected from sales and listings. Lender names (from mortgage deeds) appear as false owners.

Root causes:
- `ownership_history.sale_id` exists but is never populated
- `available_listings.sale_transaction_id` exists but is never populated
- No lender-name filter — mortgage deeds with bank names create false ownership
- `recorded_owners.true_owner_id` not resolved for sidebar-created owners
- Duplicate ownership rows (same start date, different owner IDs)

### 3. Salesforce Cross-Reference Gaps
978 of 1598 true_owners (61%) have no Salesforce link. Sidebar-created recorded_owners never get resolved to true_owners or checked against Salesforce.

Root causes:
- `upsertDomainOwners()` creates recorded_owners but never resolves to true_owners
- No SF matching runs during ingestion
- No batch job to reconcile existing unlinked owners

---

## Design

### 1. Lease Consolidation — Parent-Child Model

**Schema additions:**
```sql
ALTER TABLE leases ADD COLUMN parent_lease_id INTEGER REFERENCES leases(lease_id);
ALTER TABLE leases ADD COLUMN term_number INTEGER DEFAULT 1;
ALTER TABLE leases ADD COLUMN term_type TEXT CHECK (term_type IN ('original', 'extension', 'renewal', 'amendment'));
```

**How it works:**
- Each property+tenant has ONE "original" lease (the earliest term)
- Extensions/renewals reference the original via `parent_lease_id`
- `superseded_at` is set on the previous term when a new term arrives
- Only the latest term has `is_active = true` and `superseded_at IS NULL`
- `term_number` auto-increments (1=original, 2=first extension, etc.)

**Pipeline logic (`upsertDomainLeases` changes):**
1. Fetch ALL leases for property (including superseded)
2. Fuzzy-match incoming tenant name to existing leases (existing logic)
3. If match found:
   a. Compare dates — if incoming dates differ from existing active lease:
      - Set `superseded_at = NOW()` on existing active lease
      - INSERT new row with `parent_lease_id` = original's lease_id
      - `term_number` = max existing term_number + 1
      - `term_type` = 'extension' (or 'renewal' if gap > 30 days)
   b. If dates same → PATCH existing row (update rent, SF, etc.)
4. If no match → INSERT as new 'original' lease

**Cleanup migration:**
For property 29799 specifically (and pattern for all properties):
- Identify the "chain" by normalized tenant name
- Sort by lease_start ASC
- First = original (term 1), subsequent = extensions (term 2, 3...)
- Set parent_lease_id on extensions
- Mark all but the latest as superseded
- Delete truly garbage duplicates (no dates, no rent, pure duplicates)

### 2. Ownership History Alignment

**A. Link ownership_history → sales_transactions**
In `upsertDomainOwners()`, after creating an ownership_history entry, find the matching sale_id:
```js
// Match by property_id + date (within 7 days) + price (within 5%)
const saleMatch = await domainQuery(domain, 'GET',
  `sales_transactions?property_id=eq.${propertyId}` +
  `&sale_date=gte.${shiftDate(saleDateStr, -7)}&sale_date=lte.${shiftDate(saleDateStr, 7)}` +
  `&select=sale_id,sold_price&limit=3`
);
```
Set `sale_id` on the ownership_history row.

**B. Link available_listings → sales_transactions**
In `upsertDialysisListings()`, for sold listings (status='Sold'):
```js
// Match by property_id + off_market_date ≈ sale_date
const saleMatch = sales.find(s => 
  normDate(s.sale_date) === normDate(listing.off_market_date)
);
if (saleMatch) listing.sale_transaction_id = saleMatch.sale_id;
```

**C. Lender/bank filter for ownership**
Add a `LENDER_PATTERN` regex alongside existing `MORTGAGE_DEED_TYPES`:
```js
const LENDER_PATTERN = /\b(bank|bancorp|bankcentre|bancshares|credit\s*union|mortgage|lending|savings\s*(and|&)?\s*loan|financial\s*services|capital\s*one|wells\s*fargo|chase|citibank|us\s*bank|jpmorgan|bmo|pnc|td\s*bank|fifth\s*third|truist|regions|citizens|key\s*bank|comerica|zions|m\s*&\s*t\s*bank|first\s*national|umpqua|glacier|webster|atlantic\s*capital|midwest\s*bankcentre)\b/i;
```
Before creating ownership_history for a buyer, check:
```js
if (LENDER_PATTERN.test(sale.buyer)) {
  console.log(`[upsertDomainOwners] skipping lender buyer: ${sale.buyer}`);
  continue;
}
```

**D. Auto-resolve recorded_owner → true_owner**
After `ensureRecordedOwner()`, if the recorded_owner has no `true_owner_id`:
1. Normalize name → search `true_owners` by `normalized_name`
2. If match found → PATCH recorded_owner with `true_owner_id`
3. If no match → create new true_owner from recorded_owner data, then link

**E. Ownership dedup**
Before inserting ownership_history, also check for same `property_id` + `ownership_start`:
- If another row exists for same date with different owner → keep the non-lender one
- If both are legit (e.g., JV partners) → keep both

### 3. Salesforce Cross-Referencing

**Trigger points:**
1. **During ingestion** (sidebar pipeline) — after true_owner is resolved
2. **Batch reconciliation** — pg_cron job for unlinked true_owners

**Matching algorithm (multi-signal):**
```
For each true_owner without salesforce_id:
  1. Exact normalized_name match against unified_contacts.company_name
     → if sf_contact_id or sf_account_id exists, link
  
  2. Fuzzy name match (Levenshtein ≤ 3 or token overlap > 70%)
     → flag for review, don't auto-link
  
  3. Related entity expansion:
     a. Get all recorded_owners for this true_owner
     b. Get all LLC/SPE names from sales_transactions buyer/seller
     c. Match any of these against unified_contacts
  
  4. Address reinforcement:
     a. If name match found, verify city+state match
     b. Boost confidence if address also matches
  
  5. Link hierarchy:
     true_owner.salesforce_id → sf Contact ID (person)
     true_owner.sf_company_id → sf Account ID (company)
     recorded_owner.contact_id → dia contacts table
```

**Pipeline integration:**
In `upsertDomainOwners()`, after resolving true_owner:
```js
if (!trueOwner.salesforce_id) {
  const sfMatch = await crossReferenceSalesforce(trueOwner, domain);
  if (sfMatch) {
    await domainPatch(domain,
      `true_owners?true_owner_id=eq.${trueOwner.true_owner_id}`,
      { salesforce_id: sfMatch.sf_contact_id, sf_company_id: sfMatch.sf_account_id }
    );
  }
}
```

**Batch job (pg_cron, weekly):**
```sql
-- Find unlinked true_owners, attempt match via LCC unified_contacts
SELECT to.true_owner_id, to.normalized_name, to.city, to.state
FROM true_owners to
WHERE to.salesforce_id IS NULL
  AND to.sf_company_id IS NULL
ORDER BY to.updated_at DESC
LIMIT 200;
```
POST to a new Vercel endpoint or Edge Function that runs the matching algorithm.

---

## Implementation Order

1. **DB Migrations** (Dialysis DB):
   - Add `parent_lease_id`, `term_number`, `term_type` to leases
   - No new tables needed — all columns exist, just unused

2. **Cleanup existing data** (property 29799 as prototype):
   - Consolidate leases → chain with parent_lease_id
   - Remove Midwest BankCentre from ownership_history
   - Link ownership_history rows to sale_ids
   - Link listings to sale_transaction_ids
   - Resolve recorded_owners → true_owners

3. **Pipeline changes** (sidebar-pipeline.js):
   - `upsertDomainLeases()`: parent-child consolidation logic
   - `upsertDomainOwners()`: lender filter, sale_id linking, true_owner resolution, SF cross-ref
   - `upsertDialysisListings()`: sale_transaction_id linking

4. **Batch reconciliation**:
   - SQL function to consolidate existing lease duplicates across all properties
   - SQL function to link existing ownership_history → sales
   - SF cross-reference batch for unlinked true_owners

5. **Verification**:
   - Re-ingest 1751 Deckner
   - Verify lease chain, ownership timeline, SF matches
