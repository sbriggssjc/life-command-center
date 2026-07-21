# Salesforce Schema Intake — what I need to design the comps tools

**For:** Scott
**Purpose:** the exact metadata I need to (a) write the Power Automate query flow, (b) build the field-mapping tables into the canonical comp schema, and (c) decide whether Power BI is a better read surface for some of it.
**How to use:** fill in / attach what you can under each section. The single biggest shortcut is Section F (a few real sample exports) — if you only do one thing, do that.

---

## Why this specific list

You said everything hangs off **Property**, with **Comps, Listings, Leases, Deals** related to it, and Ascendix is just an in-Salesforce search/export layer. That's ideal: it means the Power Automate Salesforce connector can query those native objects directly using the connected user's permissions — no Ascendix API, no Connected App. To write those queries and map the results into one canonical comp shape, I need the **object API names, the field API names, the picklist values, and the relationship fields.** Everything below is in service of those four things.

---

## A. Object identity (per object)

For each of: **Property, Comp, Listing, Lease, Deal** (and any others that carry comp data — e.g. Account/Company, Contact/Broker, Space/Suite):

- [ ] **API object name**, not just the label. This is the one that bites: is it standard (`Property__c`) or an Ascendix **managed-package object with a namespace prefix** (e.g. `axtn__Property__c` or similar)? The prefix must be exact or every query fails.
- [ ] Is it a **custom object**, a **managed-package object**, or **standard**? (Affects connector permissions.)
- [ ] Rough **record count** (order of magnitude is fine: hundreds / thousands / tens of thousands). Sizes result caps and pagination.

*Fastest way to get this: Salesforce Setup → Object Manager → click the object → the API Name is shown at the top.*

---

## B. Field inventory (per object)

For each object above, the fields that carry comp-relevant data. For each field I need **API name + label + data type**:

- [ ] **Identity/address:** name, address line, city, state, zip, county, market/submarket, and **any latitude/longitude** fields.
- [ ] **Property attributes:** property type, property subtype, building SF / RBA, land area, year built, year renovated, class.
- [ ] **Sale/Comp fields:** sale price, price per SF, cap rate, NOI, sale/close date, buyer, seller, occupancy at sale, verified/confidence flag.
- [ ] **Lease fields:** lease type (NNN/gross/modified), base rent, rent per SF, term (months), commencement date, expiration date, escalations, TI allowance, free rent, effective rent, renewal options, tenant name, tenant credit/type.
- [ ] **Deal/Listing status fields:** stage/status, on-market/closed flags, list price, asking rent, DOM.

*Fastest way to get this: Object Manager → Fields & Relationships → there's an export, or a screenshot of that field list works. Even better, Section F.*

---

## C. Controlled vocabularies (picklists) — critical

The whole multi-source merge keys off two normalized vocabularies, so I need the **actual picklist values** (not paraphrases) for:

- [ ] **Property Type** picklist — every value. (So I can map "MOB", "Medical Office", etc. into one canonical `medical_office`.)
- [ ] **Property Subtype** picklist, if separate.
- [ ] **Comp Type / Record Type** — how you distinguish a sale comp vs a lease comp vs a listing. Is it a Record Type, a picklist, or separate objects?
- [ ] **Lease Type** picklist (NNN / gross / etc.).
- [ ] **Deal/Listing Status** picklist — and **which values mean "a real, closed, usable comp"** vs a prospect/listing. This becomes the default quality filter.
- [ ] **Market / Submarket** — is it a free-text field, a picklist, or a related object? And does it align to MSAs or to your own regions?

---

## D. Relationships (how the objects connect)

I need the **relationship/lookup field API names** so a query can join them:

- [ ] The lookup field on **Comp → Property** (API name of the field, e.g. `Property__c` on the Comp object).
- [ ] The lookup on **Listing → Property**, **Lease → Property**, **Deal → Property**.
- [ ] Any link from **Property → Account/Company** or **→ Broker/Contact** you'd want surfaced.
- [ ] Is address stored **on the Property** (and inherited by comps), or **duplicated on each comp/listing**? Tells me where to read it from.

---

## E. Attached files (OMs, flyers) — enrichment path

You noted comps/listings often have OMs and flyers attached that support the data. That's valuable — the tool can return links to them, and an agent can even read an OM to fill or verify a field. I need to know the mechanism:

- [ ] Are attachments stored as modern **Salesforce Files** (`ContentDocument` / `ContentDocumentLink`), classic **Attachments**, or something Ascendix-specific?
- [ ] Is there any **field or naming convention** that distinguishes an OM from a flyer from other docs (a document-type field, or file-name pattern)?
- [ ] Roughly what share of comp/listing records **have** a usable OM/flyer attached?

*(This one can wait — it's a Phase-later enhancement — but knowing the storage model now shapes the schema.)*

---

## F. The shortcut that beats everything above: sample exports

If you can pull **3–5 real records per object as a spreadsheet export (with the column headers = field names)** — one export for Comps, one for Listings, one for Leases, one for Properties, one for Deals — that single deliverable gives me API-ish field names, real data types, real picklist values, and how the fields actually get populated in practice. An Ascendix export of a handful of comps you're comfortable sharing is perfect. Redact anything client-confidential; I mainly need the **structure**, not the deals.

- [ ] Comps export (few rows, all columns)
- [ ] Listings export
- [ ] Leases export
- [ ] Properties export
- [ ] Deals export

---

## G. Power Platform inventory (Power BI / Power Apps / Power Automate)

You mentioned Power BI and other Power Apps you have access to but haven't used here. These could give us a cleaner read surface than live Salesforce for some requests, so:

- [ ] **Power BI:** Is any Salesforce comp/property data **already modeled in a Power BI dataset or dataflow**? If yes: which objects/fields, and how often does it refresh? *(If a dataset already joins Property + Comps + Leases, we may be able to query that via Power Automate's "Run a query against a dataset" action (DAX) and get pre-joined, pre-cleaned data faster than hitting Salesforce record-by-record.)*
- [ ] **Power Apps:** Any existing canvas or model-driven app that already surfaces comps/listings? If so, what data source does it sit on (Dataverse, direct Salesforce, a dataflow)?
- [ ] **Power Automate:** Confirm the existing flows' **Salesforce connection** is a user/account that can **read** all of Property/Comp/Listing/Lease/Deal (the connector inherits that user's object + field permissions). If those flows run as a limited service account, we may need its permission set widened to see comp fields.
- [ ] Any **governance limits** on creating new flows or on the connector (DLP policies, environment restrictions) I should design around.

---

## What I'll do once I have A–F (G is a bonus)

1. Turn the field inventory into the **canonical comp schema + a Salesforce→canonical mapping table** (data, not code, so it's editable later).
2. Spec the **Power Automate query flow** exactly: trigger, the SOQL/filter it runs against the real object + field names, pagination, and result cap.
3. Decide, using Section G, whether **Power BI is the better read path** for aggregated/market-level requests while the flow handles record-level pulls.
4. Update the main design doc to drop the Connected App path and make Power Automate (+ optional Power BI) the permanent surface.

The two answers that unblock the most work: **the exact API object names + namespace prefix (Section A)** and **any one real sample export (Section F).**
