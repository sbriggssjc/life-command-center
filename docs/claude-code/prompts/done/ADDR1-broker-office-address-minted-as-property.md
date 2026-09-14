# ADDR1 — the CoStar Contacts tab's broker office address is being captured as the PROPERTY address, minting phantom properties

**Repo: `life-command-center`.** Writer is the sidebar capture path
(`extension/content/costar.js` → `api/_handlers/sidebar-pipeline.js`); damage is in
**Dialysis_DB `zqzrriwuavgrquhisnoa`** (`properties`, and whatever attached to the phantoms).
Check **gov `scknotsqkcheojiaewwh`** for the mirror. **Diagnosis + a scanner fix + a reversible
repair of the named rows. No bulk address rewriting.**

**Read first:** `CLAUDE.md` § "TrafficMetrix table-as-contact-list misparse" (Prompt 89 — the same
producer reading the wrong region of a CoStar page and minting entities from it; `tm-misparse.js`
is the existing guard for the CONTACT version of this bug) and § "Property-identity and address
resolution" (`docs/architecture/property-identity-and-address-resolution.md`), plus the PR2 blocks
in `public-records-source-lane.md` (same writer, recently repaired).

## The live evidence — verify these two rows first

Scott captured `E10196 County Road P — DaVita Dialysis Center, Wisconsin Dells, WI 53965`
(CoStar id 10205459) **while the Contacts tab was open**. The page's Sales Company block leads with
**SRS Capital Markets, 680 Newport Center Dr, Suite 300, Newport Beach, CA 92660**.

| property_id | address | city / state / zip | stats | attached | created |
|---|---|---|---|---|---|
| **37491** | `680 Newport Center Dr` | **Wisconsin Dells, WI 53965** | 7,895 SF · 2017 · 45,302 lot | **1 sale, 3 listings** | 2026-09-03 20:14 |
| **50990** | `680 Newport Center Dr` | **Gary, IN 46408** | 7,500 SF · 1992 | — | 2026-09-02 |
| 35722 (the REAL one) | `14 Co Rd P` | Wisconsin Dells, WI 53965 | 7,895 SF · 2017 · 45,302 lot | | |

**37491 is a phantom duplicate of 35722** carrying the true property's stats under the broker's
street, and it has already accumulated a sale and three listings — so it competes with the real
row in every surface that reads `properties`. 50990 proves it is not a one-off.

## Answer these

1. **Which field does the scanner read for the property address, and why does the Contacts tab
   change it?** Read `extension/content/costar.js`. Likely shape: the address is scraped from the
   first address-looking block in the DOM rather than from the property header
   (`E10196 County Road P … Wisconsin Dells, WI 53965`) or the CoStar property id. **Name the
   selector and the file:line.** ⚠️ The city/state/zip came out RIGHT and only the street was
   wrong — that asymmetry is the clue; say what explains it.
2. **How large is the class?** The naive detectors are too loose — *108 addresses across 2+ cities /
   242 rows* and *98 across 2+ states / 202 rows* on dia are dominated by placeholders
   (`Dialysis Unit`, `TBD`, `1 sect`) and genuinely common street names, **not** this bug. Build the
   detector on what is distinctive: a property whose street address matches a **brokerage or
   contact office address** we already hold (`entities` / `unified_contacts` / `brokers` /
   `broker_companies`), or a street that appears with a city/zip belonging to a different property.
   ⚠️ `broker_companies` is mis-populated (BR1) — do not use it as a clean match target without
   saying so. Quote the count on **both** domains.
3. **Is the capture tab recoverable from the record?** Does the staged capture / entity metadata
   record which CoStar tab was open (`pageUrl` ends `/contacts`)? If so, that is both a detector for
   historical rows and a guard for new ones.
4. **What attached to the phantoms?** For each, list the sales, listings, loans, parcel records,
   entity links and provenance rows. **A phantom with a sale attached is a repoint question, not a
   delete.**

## Build

- **Scanner fix:** take the property address from the property header / CoStar property id, never
  from a contacts block. If the header is unavailable, **write no address rather than a wrong one**
  (the standing rule). Guard it with a fixture built from the real page shape, mutation-verified.
- **Server-side belt:** in `sidebar-pipeline.js`, refuse a property address that matches a known
  contact/office address on that same capture — the `tm-misparse.js` precedent, scoped to this gate,
  never a general address filter. Count the refusals so the rate is visible.
- **Repair the named rows only:** repoint 37491's sale/listings to 35722 if they are the same asset
  (verify by CoStar id / stats / operator, not by name), then soft-retire the phantom the way the
  junk lane does — reversible, batch-tagged, **never a hard delete**. Same for 50990 if it is a
  duplicate; if it is a real Gary IN property that merely lost its address, fix the address instead.
- Anything the detector finds beyond these two goes to a **review view**, not an automatic repair.

## Verify on

- The selector named with file:line, and the city-right/street-wrong asymmetry explained.
- Class size on both domains, with the placeholder noise excluded and the exclusion stated.
- 37491 and 50990 dispositioned, with what attached to each and where it went.
- A new capture on the Contacts tab of a known property writes the CORRECT street (or none).
- `properties` row count moves by exactly the number retired; nothing else changes.

## What NOT to do

- No bulk address rewrite, no fuzzy address matching, no delete. Do not "fix" the 108/98 loose-
  detector rows — most are not this bug, and PR1a's lesson is that a sentinel or a common name
  written as a fact is a different defect from a mis-scraped one.

## Report back

The selector + mechanism · class size both domains · the two phantoms' attachments and disposition ·
the scanner fix + server belt with mutation-verified guards · anything that outranks this.
