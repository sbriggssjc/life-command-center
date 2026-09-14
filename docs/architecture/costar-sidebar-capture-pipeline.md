# The CoStar sidebar capture pipeline — canonical topic page

> **START HERE before touching `extension/content/costar.js`, `api/_handlers/sidebar-pipeline.js`, or
> anything that asks "where did this property/sale/parcel value come from".** Created 2026-09-04 by
> consolidating the PR2 → SALE1 → SALE1a → ADDR1 → ADDR1a arc, which is five separate defect
> investigations into **one producer**. Siblings: `public-records-source-lane.md` (the parcel
> SOURCE question), `field-provenance-ladder.md` (which source wins on a column),
> `entity-identity-and-dedup.md` (the party rows this producer mints),
> `broker-and-firm-identity.md`, `om_intake_pipeline.md` (the OTHER intake channel).
> ⚠️ **gov's property-address duplicates are NOT this producer.** `docs/architecture/gov-property-duplicates.md`
> (GOVDUP1) traced the largest single duplicate class (the 154-row `unknown_writer` husk fan-out) to
> a `data_source IS NULL` insert path this pipeline does not use — this pipeline always stamps a
> real `data_source` (`costar_sidebar`) — and could not locate the actual writer in any accessible
> repo; see that page's Unit 1 for what was ruled out.

## 1. What it is

Scott opens a CoStar property page in Chrome with the LCC extension and presses Extract. The
content script (`extension/content/costar.js`) scrapes the rendered page; the payload posts to
`api/_handlers/sidebar-pipeline.js::process_sidebar_extraction`, which writes **directly to the
domain DBs** (dia `zqzrriwuavgrquhisnoa` / gov `scknotsqkcheojiaewwh`) — it does **not** go through
`stageOmIntake`. It is the largest single producer in the system and the only genuine public-record
acquisition dia has.

| writer | table | notes |
|---|---|---|
| `upsertDomainProperty` | `properties` | address, stats; the ADDR1 belt lives here |
| `upsertDomainSales` | `sales_transactions` | the SALE1 overwrite guard lives on its re-match PATCH |
| `upsertPublicRecords` | `parcel_records`, `tax_records` | PR2 taught it to carry the stats it was handed |
| `unpackContacts` / `upsertSidebarContacts` | `entities`, `contacts` | ENTC's person-junk gate |
| `upsertLoanRecords` | `loans` | summary only — the CMBS detail arm has never fired (PR5d) |
| `upsertDocumentLinks` / `captureDocumentBytesAtIngest` | `property_documents` | session-bound CDN links must be fetched in-tab |

> ⚠️ **NOT this producer: gov's 399 duplicate-address property groups.** They were nearly filed here
> as an ADDR continuation. Measured 2026-09-05, the producer is **`excel_master` — one spreadsheet
> import of 9,633 rows on 2026-03-05** — plus an unidentified `unknown_writer`. See
> `gov-property-duplicates.md` / backlog **GOVDUP1**. *A defect that resembles this one's shape is
> not evidence it came from this one.*

⚠️ **This producer's defects share a shape: it reads the right PAGE and the wrong REGION of it.**
Four of the five arcs below are that, and the fifth (SALE1) is the same producer overwriting a value
it should have left alone.

## 2. Defects found and fixed — the arc

| id | date | what was wrong | how it was found |
|---|---|---|---|
| **Prompt 89** | 08 | a TrafficMetrix traffic-count TABLE parsed as a contact list; street names minted as PERSON entities | operator noticed junk contacts |
| **PR2** | 09-02 | the parcel writer built its INSERT from `apn/county/state/assessed_value` only and **dropped the building stats the capture sent**; `tax_amount` stashed in `raw_payload` instead of its column. 🚨 **The load-bearing half was the PARSER** — CoStar's dominant lot format `"1.00 (43,560 sf)"` (68% of captures) fell through to `parseSF` and read as **1 square foot** | a ladder-source triage asked why a registered source had never written |
| **SALE1** | 09-03 | (a) the re-match PATCH **silently overwrote a non-null `sold_price`** with a later capture's figure — Hillsboro's 2009 deed moved from $1,233,000 to the current LISTING price; (b) dia stamped `sale_notes_raw` on EVERY sale where **gov already gated it to `isMostRecentSale`** | one operator capture; proven against `cap_rate_history`, the only run ledger dia has |
| **ADDR1** | 09-03 | the Contacts tab's **broker office address won the property street** — `FOREIGN_PARTY_HEADER_RE` lacked `Sales Company` / `Sales Contacts` / `Listing Contacts` / `Property Manager`, so the first address-shaped line the one-pass scanner met was SRS's Newport Beach office | operator screenshot; **city/state/zip were RIGHT and only the street was wrong** — that asymmetry was the diagnostic |
| **SALE1a** | 09-04 | 29 propagated prices **nulled, none reset** (zero deed corroboration) | the review view SALE1 shipped |
| **ADDR1a** | 09-04 | the two residual bleed rows dispositioned; the bare-`Buyer` worry **refuted by reading the code path** | — |

## 3. The guards now in place — and which one actually closes each class

- **Address bleed → the SERVER-SIDE BELT, not the regex.**
  `api/_shared/contact-address-bleed-guard.js::findContactOfficeAddressBleed` is **role-agnostic**:
  it compares any captured contact's address to the property's exact street regardless of the header
  that labelled it, and `upsertDomainProperty` refuses the write outright. **The class is closed by
  construction rather than by enumerating headers** — which is why ADDR1a correctly declined to widen
  the regex further. Review lanes: `v_dia_contact_office_address_bleed_review` (**0**),
  `v_gov_contact_office_address_bleed_review` (**1** — ADDR1b).
- **Price overwrite → `upsertDomainSales`' PATCH guard.** A >1% disagreement with an already-recorded
  non-null `sold_price` keeps the recorded value and stamps `[price-disagreement …]` on
  `cap_rate_notes`. Shared by both domains. Review lane `v_dia_sale1_price_review`.
- **Narrative bleed → `isMostRecentSale`,** dia now matching gov. Gov's own comment states the rule:
  *the notes describe the displayed/most-recent deal.*
- **Parcel stats → one parser.** `parcelStatsFromMetadata` is the single owner of the unit rule (I12);
  the backfill script imports it rather than reimplementing.
- **Person junk → `planContactMinting`** takes an injected person-only `isJunkContactName`.
- Guards: `addr1-costar-foreign-party-header`, `addr1-contact-office-address-bleed`,
  `pr2-sidebar-parcel-stats`, `entc-junk80-and-p195-unmerge`.

## 4. Transferable lessons (each cost a real investigation)

- **Read the right REGION, and prove which one.** The producer is on the correct page every time;
  four defects are about which block it read. When a captured value is wrong, ask *which section of
  the page it came from* before asking whether the value is wrong.
- **An asymmetry in what came out right is the diagnostic.** ADDR1: city/state/zip correct, street
  wrong ⇒ different fields, different sources ⇒ the street's source is the bug.
- **A backfill is not a producer proof.** PR2's dia numbers reproduced from a backfill while the
  forward writer was unproven; the proof needed a subject with **no existing row** (an existing row
  makes the write invisible).
- **`cap_rate_history` records what was FIRST RECORDED, never what is TRUE.** SALE1a nulled 29 prices
  rather than resetting them because zero had deed corroboration. **A missing comp beats a wrong comp.**
- **The sibling branch often already has the answer.** dia's notes bug was fixed by copying gov's
  existing gate; gov's own comment explained why.
- **Merge, don't delete, and look before choosing.** 37491 and 37503 were phantoms whose attached
  history was real (37503 carried **7 leases**); 50990 and 37783 were REAL properties that lost a
  street. Same symptom, opposite action — decided by looking for a twin, not by assuming one.
- **Declining to widen a pattern is a real answer.** ADDR1a read the code path, found `true_buyer`
  already covered, and left the regex alone — a header regex that matches too much starts rejecting
  the subject property's own address and fails silently in the other direction.

## 5. Live state — dated, re-measure before quoting

**2026-09-04:** dia address-bleed review **0** · gov **1** (property 9893, `245 Park Ave`/Raton NM) ·
`v_dia_sale1_price_review` **133** (`ledger_disagreement` 100 after SALE1a's 29 nulls,
`deed_says_undisclosed` 33) · gov `ledger_disagreement` **127**, only 4 listing-matched ·
dia `costar_sidebar` parcel rows **933**, gov **1,527** (both backfilled; forward writer proven on
dia 09-03 via APN `08H-61-0665`) · `loans.costar_loan_id` **0 of 2,219** on both domains (PR5d).
🚨 **Corrected 2026-09-05 (PR5d-c): the Loan tab HAS now been captured and still wrote nothing.**
PR5d concluded case (c) — *the scanner is live and correct, the page has simply never been captured.*
Scott captured property 3302 and its Loan page on 09-04/05: **0 `loans` rows updated in 24h**, the
property row untouched, and **7 staged extractions in 30h with not one loan-shaped key.** So it is
case **(a) the scanner does not fire there, or (b) the payload is dropped before the writer** — not
a coverage gap. Next input is a screenshot + confirmation the sidebar shows a capture on that tab.

⚠️ **Corrected 2026-09-04:** an earlier note here said gov's sale spine has "a different dominant
producer (GSA/deed feeds)". **It does not — gov is 72% CoStar (sidebar+export), the same family as
dia**; that was inferred from gov's small listing-match share without measuring the producer mix.
The failure DISTRIBUTION differs (gov: 2 of 98 listing-bleed, ~18% A2b repeat-conveyance, ~80%
unclassified), not the producer.
✅ **Corrected 2026-09-04 (ADDR1b-merge): gov CAN now merge safely** — `gov_merge_property_reversible`
+ `gov_unmerge_property` + `gov_property_merge_backup` are live, the FK walk is at call time, the
round trip is fingerprint-verified, and the destructive `gov_merge_property` raises. The phantom
class is therefore dispositionable on gov the same way it is on dia. *Was:* ⚠️ **gov cannot merge safely:** `gov_merge_property_reversible` does not exist and `gov_merge_property`
is a **hard delete with no snapshot** — so gov's only safe ADDR/dedup disposition today is
quarantine (ADDR1b-merge).

**Open:** ~~`SALE1c`~~ ✅ · `SALE1c-gov` (98 rows classified, ~80% unclassified residue) · **`ADDR1b-merge`** (port dia's reversible merge to gov) · `PR5d-a`/`PR5d-b` (the CMBS loan
arm — 👤 Scott has Loan-tab access; a screenshot of a CMBS-financed property is the next input) ·
`PR11` (the model-leg quarantine) · `ADDR1a` residue: none.
**Open:** `PR5d-a`/`PR5d-b` (the CMBS loan arm — 👤 Scott has Loan-tab access; a screenshot of a
CMBS-financed property is the next input) · `PR11` (the model-leg quarantine) · `ADDR1a` residue:
none · **`ADDR1b-merge`** (gov has no reversible property-merge RPC — only `gov_merge_property`,
hard-delete, no snapshot — so a future gov phantom-twin can only be quarantined, never merged, until
this ships).

## 6. SALE1c + SALE1c-gov + ADDR1b — closed 2026-09-04

**dia's 8 `linked_same_listing` rows, read individually against `cap_rate_history` event_type
('sale' vs 'listing') and sibling/duplicate rows:** 7 of 8 were listing bleed
(`copied_from_linked_listing`) — each carries a distinctly-dated, distinctly-typed `'sale'`
ledger event (often with a named buyer/duplicate-superseded sibling row) at a DIFFERENT price than
the current `sold_price`, which instead matches the linked listing's ask. **Nulled** (490, 575, 623,
667, 881, 5471, 14538 — batch `sale1c-null-2026-09-04`, backup
`_sale1c_price_reset_20260904_backup`), `calculated_cap_rate` nulled on all 7; `cap_rate_final` was
nulled too except where the DB's own cap-rate trigger re-derived it from a `broker_stated`/
`source_reported` rung (independent of the nulled price — sale 5471 kept `0.0584 broker_stated`,
matching the SALE1a precedent exactly). **1 of 8 (sale 7972) is genuine** — two independently
dated/sourced records (`backfilled from ownership_history` + a separate `historical_csv_import` sale
six months later) agree with the current price against three same-batch listing echoes; left alone.
⚠️ **This reverses the "leave them alone, ambiguous" read SALE1a shipped with** — the per-row
`cap_rate_history` event-TYPE split (`'sale'` vs `'listing'`) that SALE1a's cruder "earliest
observation" method couldn't see is what made 7 of 8 decidable without a deed.

**The 902/903 dedup pair was a duplication defect, not a genuine two-hop same-day flip.** Sale 902
(2017-07-27, $1,065,000, buyer Fultheim/seller Bhandari) is a mis-dated DUPLICATE of sale 14010
(2021-01-20, same buyer/seller/price, `master_xlsx_backfill_r72`); sale 903 (buyer Bhandari/seller
Glaves, same date, null price) is a phantom bridge row stitching 904's buyer to 902's seller — no
independent evidence either hop happened. Real chain: 904 (Ritchie Development→Jack Glaves,
2017-07-27, $778,000, already `duplicate_superseded`) then 14010 (Bhandari→Fultheim, 2021-01-20,
$1,065,000, live). Both 902 and 903 moved to `transaction_state='duplicate_superseded'`
(batch `sale1c-dedup-2026-09-04`) — the underlying duplication is fixed, not the unique-index
constraint dodged (there was never a real collision: `ux_sales_transactions_dedup_live` only covers
`transaction_state='live'`, and 903 was already `needs_review`). `v_dia_sale1_price_review`:
100 → 92 `ledger_disagreement`.

**SALE1c-gov: re-measured at 98 rows (not 127 — re-derive, never quote), and it is NOT dia's
shape.** Split by `data_source`: `costar_sidebar` 41 / `costar_export` 30 / `excel_master` 23 /
`gov_master_backfill_r71` 4. ⚠️ **This corrects the standing claim that gov's spine has "a different
dominant producer (GSA/deed feeds vs dia's CoStar capture)"** — CoStar (`sidebar`+`export`) is
**72%** of the population, the SAME dominant producer family as dia. What differs is the DEFECT, not
the producer: joining `current_price` against every gov listing-price column
(`asking_price`/`original_price`/`initial_price`/`last_price`, both via `sale_transaction_id` and
property-wide) finds only **2 of 98** rows where the current price matches a listing figure — the
listing-bleed mechanism that dominates dia is nearly absent on gov. A secondary A2b-style
repeat-conveyance signature (current price matches a sibling sale or a differently-dated ledger
event on the same property) covers **18 of 98 (18%)**. The remaining ~80 rows show no single
mechanism — average disagreement is 50–98% of the earlier value across every source bucket, wider
and messier than dia's. **Measured and classified, not fixed** — no gov row was written. gov is
protected going forward by the same shared `upsertDomainSales` guard SALE1 shipped; its historical
residue needs a different remedy than dia's null-the-listing-bleed rule, sized separately.

**ADDR1b: gov's one address-bleed row (property 9893, `245 Park Ave`/Raton NM ← J.P. Morgan Asset
Management's NYC office) is quarantined, not merged.** No twin: the other 3 Raton properties are all
VA/Whittier St leases with a different agency and lease number; 9893 carries its own real
`lease_number` (`LNM16668`), agency and a `notes` field naming USPS as the GSA lessor — a genuine
lease record that lost its street, the dia 50990/37783 shape. `address` nulled, `city`/`state` kept,
`address_source='contact_office_bleed_quarantined'`, dated note (backup
`_addr1b_gov_quarantine_20260904_backup`). **No merge was attempted** — gov's only property-merge
function, `gov_merge_property`, is a hard delete with no snapshot/reversal, so a merge here would
have been irreversible on a repo whose entire discipline is reversible writes; that gap is filed as
`ADDR1b-merge`, not worked around. `v_gov_contact_office_address_bleed_review`: 1 → 0.
