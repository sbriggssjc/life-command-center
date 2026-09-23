# GOV-CU1 — "Federal Credit Union" tenants are being filed as federal-government properties

Backlog: `GOV-CU1`. Source: Scott, 2026-09-23: "there are a ton of Navy Federal Credit Union deals in there. I'm not sure that those are truly government tenancy deals."

**Scott is right. A federal credit union is a private, member-owned cooperative with a federal charter, not a government tenant.** The word "Federal" is being read as a government signal.

## Measured (gov DB, 2026-09-23)

- **705** `properties` have an agency matching "credit union", **all** with `government_type='Federal'` and `agency_canonical` null.
- By source:
  - 669 are `data_source='junk_backfill_archived_2026-06-09'`. They were already archived as junk in June, but they still carry the Federal type.
  - 16 are `om_intake`, 13 `unknown_writer`, 6 `excel_master`, 1 `tier0_unarchived_genuine_2026-06-16`.
- **15 rows are in the live Available list** (`v_available_listings`), all `listing_source='lcc_intake_om'`. The spellings: Navy Federal Credit Union / NAVY FEDERAL CREDIT UNION, Chartway, Digital, First Tech, Langley, Mission, Neches, Truliant and University Federal Credit Union.
- 8 leases and 8 sales hang off credit-union properties.
- Adjacent names that must NOT be read as government either: "First Federal Savings & Loan Association", "Third Federal Bank", "Third Federal Savings & Loan".

## Ask

1. **Find the classifier path** that sends an OM whose tenant is a credit union into the gov vertical (OM intake → `routeFileVertical` / the intake domain classifier / `GOV_SIGNALS` style lists that match "federal"). Make "Federal Credit Union", "Federal Savings", "Federal Bank" and "Farm Credit" **non-government** signals that outrank a bare "federal". Check the sidebar classifier and the Salesforce-files router too.
2. **Clean the residue reversibly, following the GOV-AVAIL1 pattern (log + restore):**
   - The 15 Available rows come off the gov Available list.
   - The live non-archived credit-union properties (~36) get flagged out of the gov universe. They're a net-lease retail/bank-branch asset, not gov.
   - Say where they should live, if anywhere: the general net-lease lane, or nowhere. Don't move them into another vertical in this prompt; report and file.
   - The 669 already-archived rows keep their archive. Only fix their misleading `government_type`, logged.
3. **Guard:** a test that each credit-union / thrift / farm-credit spelling classifies as non-gov, while "Federal Bureau of Investigation" / "Federal Aviation Administration" still classify as gov. Each needs a mutation that turns it red.
4. **Report** the before/after gov Available count and the gov property count.

## Done means

- Backlog updated.
- Gov migration in `government-lease` (I16).
- Deploy = redeploy BOTH Railway services if LCC code changes.
