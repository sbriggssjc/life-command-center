# GOV-AVAIL1 — Gov › Deals › Sales › Available: wrong addresses, our own office as a listing, agency in 270 spellings

Source: Scott's note `SB notes/done/gov availables view.docx` (2026-09-22, 5 screenshots) → TRIAGE `SBN-21`, `SBN-22`, `SBN-23`.
Cowork measured everything below live on the government DB (`scknotsqkcheojiaewwh`) and LCC Opps (`xengecqvemvfknjvbvrq`) on 2026-09-22.
**Re-measure before you build.** These are hypotheses with evidence, not facts.

## What Scott saw (his words)

- "There's a handful of addresses in here that are not being ingested or stored correctly. We also have the agency showing in many different versions, some short form and some longer form."
- "The first entry on the above is our firm's Tulsa address. Trace this ingestion or propagation error."
- "Looks like we have a handful of ingestion or verification errors here."

## Measured

**1. Our Tulsa office shows as an active gov listing (SBN-22). Traced end to end.**
- `available_listings` `c04dc749-f602-41cd-8040-1af2ef62c02b`: `address='6120 South Yale Avenue, Suite 300'`, Tulsa OK, `listing_source='lcc_intake_om'`, `listing_status='active'`, `listing_date=2026-09-22`.
- It is attached to gov `property_id=11255`, whose address is **`5110 South Yale Ave`** (a different civic number).
- The source is LCC Opps `staged_intake_items` `9c2dc902-91e3-4472-91e0-70a107560dc7` (created 12:15 UTC).
  - File: `USRenalMOB_Findlay_OH_OM_SB.pdf`, a **dialysis** OM for a property in Findlay, OH.
  - Seed: Salesforce `Listing__c` `a0jVs00000GuTfdIAF`, `source_vertical: "dia"`.
- The extraction ran on the local model (`ai_final_provider: ollama`, `qwen2.5:14b`, `pdf_text_len 45038`).
  - It returned `address: "6120 South Yale Avenue, Suite 300"`, city Tulsa: the **listing broker's office block** (Team Briggs), not the subject.
  - `tenant_name: null`, `asking_price: null`.
- Matching and promotion:
  - `match_status: matched`, `match_confidence: 0.97`, `match_domain: "lcc"`, `match_property_id: 658c4713-a0f7-4f27-b03f-46d4fcb625db`.
  - `promotion_ok: true`, `promotion_listing_id: c04dc749…`.

That is four failures in one chain:
- (a) the OM extractor accepted the broker/firm contact address as the subject address;
- (b) nothing rejects an address that is our own office (or any listing firm's office);
- (c) a 0.97 match was accepted between 6120 and 5110 South Yale (different civic numbers);
- (d) a `source_vertical: dia` document was promoted into the **government** listings table.

A second instance of (a) is live: `2800 Post Oak Blvd, Suite 500, Houston, TX 77056` stored as the address of a **Brownsville, TX** listing (`costar_sidebar`). Its city field disagrees with its own address text.

**2. Addresses (SBN-21).**
- `v_available_listings` has 498 rows.
- 111 addresses carry city/state/ZIP inside `address` (e.g. `13923 Gold Cir, Omaha, NE 6…`, `167 N Main Street, Washington, PA 15301`).
- 3 addresses carry a suite.
- 3 duplicate-address groups. Example: Malta MT, `47152 US Highway 2` (property 16193, `costar_sidebar`) vs `47152 US-2` (property 40643, `lcc_intake_om`). Both were created today, 5 min apart: one building, two properties, two active listings.
- Sources: `lcc_intake_om` 379 · `costar_sidebar` 59 · `salesforce_ascendix` 48 · `crexi` 12.

**3. Agency (SBN-21).**
- 270 distinct `agency` strings across 498 rows; 14 are blank.
- GSA alone appears as 18 spellings (`GSA`, `General Services Administration (GSA)`, `U.S. General Services Administration`, `GSA Tenant`, `GSA - UDSA APHIS`, `GSA-General Services Administration, Be Well Clinical Studies`, …).
- The gov DB already has the registry: `government_agencies`, `gov_agency_aliases`, `property_agencies`, `v_gov_agency_*` (the ID3a series). **The Available view does not display the canonical agency.** Read `v_available_listings`' definition and the ID3a canonicalizer before building anything.

**4. Non-government rows in the gov Available list (SBN-23).**
- 60 rows have `government_type IS NULL`.
- Visible tenants include `Davita Kidney Care` (Long Beach, `lcc_intake_om`), `Psychiatric Services`, `Youth Services Network`, `Midjit Market, Inc.`, `Recover Together, Inc.`, `Gomez Cardiovascular Clinic`, and `—` (Stanton TX).
- Some may be legitimately government-leased (a county psychiatric service, for example). Measure, classify, and don't guess.

## Ask

A. **Trace and fix the chain in §1** at every link, not just the last one.
   - The OM extractor must not take a broker/listing-firm office block as the subject address. Look for signals: "Exclusively listed by", broker name/phone/email next to the address, and our own office addresses.
   - Add a small registry of known brokerage office addresses, seeded from what the DB already holds for `listing_firm` / broker companies, with 6120 S Yale Ave Ste 300 Tulsa as the first row.
   - Reject a match whose civic numbers differ.
   - Never promote a `source_vertical: dia` document into gov tables (and the reverse).
   - Read the existing intake-classify / promote code and `sameStreetRest()` / the SIDEBAR3-c guard before adding a parallel check.

B. **Clean the live residue, reversibly and ledgered.** Quarantine the Tulsa listing (`c04dc749…`) and the Post Oak Blvd listing. Do not delete; follow LEASEJUNK1's quarantine-plus-log-plus-restore pattern. Leave property 11255 itself alone unless you prove the listing was its only change. Re-run the Findlay OM to the right place, or record why it can't be.

C. **Address normalization for display and matching.** Strip city/state/ZIP from `address` when they duplicate the row's own city/state/zip fields. Flag (don't auto-fix) rows where they disagree, like the Brownsville/Houston row. Route the 3 duplicate-address groups into the existing gov twin/merge review lane if one exists. If none exists, report that; don't merge.

D. **Show the canonical agency in the Available list** (short name + full name on hover) from the ID3a registry. Measure how many of the 270 strings resolve today and file the unresolved tail. Don't write a new alias table.

E. **Report the 60 `government_type IS NULL` rows** grouped by source and likely class (government-leased / not government / unknown). Decide nothing; produce the list and a recommended rule.

## Do not touch

- The ID3a canonicalizer's own logic, beyond calling it.
- Any dialysis listing data (the reverse-direction guard in A is fine).
- Anything in the UI outside the Available tab's agency and address cells (the UI defects are `GOV-UX1`).

## Done means

- Tests: the Findlay extraction case (the broker block rejected), a civic-number mismatch rejected, and a dia→gov promotion refused. Each has a mutation that turns it red.
- Live counts before/after for §2–§4 in the response, and the backlog row `GOV-AVAIL1` updated.
- Deploy note: engine code = redeploy BOTH Railway services (`tranquil-delight` + the standalone MCP).
