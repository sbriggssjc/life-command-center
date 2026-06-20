# Audit — contact acquisition / resolution / writeback (2026-06-20)

**Question (Scott):** how do we aggregate contact names/emails/phones/addresses across CoStar,
Outlook, Salesforce, and existing LCC data, resolve/dedupe them — and are we writing an
authoritative contact BACK to Salesforce and/or LCC for prospecting?

## Verdict: aggregation + dedup are solid; the data is thin on phone/address and the loop is one-way — we never write a resolved contact back to Salesforce

### Sources we aggregate (inbound — healthy)
- **CoStar / CREXi / RCA sidebar** — rich deal contacts (buyer/seller/broker with email, phone,
  company) captured into `entity.metadata.contacts` AND promoted to `person` entities.
- **Salesforce** — pulled via `find_contacts_by_account` (R16 contact-acquisition worker).
- **Outlook / SF activity** — `sf-activity-ingest` routes correspondence into the timeline.
- **Intake OMs** — broker/principal contacts from offering memoranda.
- **Existing LCC entities** — the person graph.

### Resolution / dedup (healthy — already hardened)
Email-as-write-key dedup (R39), person-complete merge with backref repoint (R40), SF
contact-acquisition (R16), person-self-contact (R20). The choke point (`ensureEntityLink`) applies
junk/implausible/broker guards. This machinery is in good shape.

### Coverage gaps (the data is thin)
4,172 active `person` entities:
- **email 2,031 (49%)**, **phone 1,434 (34%)**, **address 0 (0%)**, **neither email nor phone
  2,003 (48%)**.
- Persons carry **no address at all** — the `entities.address` field is unused for people; mailing
  addresses (which SF contacts and county owner records both have) aren't aggregated onto the
  person.

### The headline gap — the contact loop is ONE-WAY (no writeback to Salesforce)
The only Salesforce WRITE operation in the entire codebase is **`create_opportunity`**
(`api/_shared/salesforce.js`). There is **no `create_contact` / `upsert_contact` / contact
update** path. So:
- Contacts flow IN (CoStar capture, SF pull) and opportunities flow OUT — but a contact the system
  captures or resolves is **never pushed to Salesforce**, the CRM where prospecting actually
  happens.
- **1,157 of 2,034 emailable LCC person entities (57%) have an email but NO Salesforce Contact
  identity** — captured-from-CoStar/intake contacts the CRM doesn't have. Each is a usable
  prospecting contact stranded in LCC.
- There's also no "authoritative contact" record concept written back into LCC's own domain
  `contacts` tables — the `person` entity is the de-facto store, and the richest fields
  (email/phone/company from a capture) live in `entity.metadata.contacts` jsonb, not always
  surfaced as first-class entity fields.

## Fix doctrine → R52 (close the contact loop: enrich + write back)
1. **Promote captured contact fields to first-class** — ensure a captured contact's email / phone /
   company / mailing address land on the `person` entity (and/or LCC `contacts`), not just in
   `metadata.contacts` jsonb, so they're queryable + writable. Add the **address** dimension
   (from SF mailing address + county owner records).
2. **Write an authoritative contact BACK to Salesforce** — a `create_contact` / `upsert_contact`
   PA flow op (mirroring the `create_opportunity` rollout), **upsert by email** so it never
   duplicates an existing SF Contact, gated + human-deliberate (writing to the CRM is lower-risk
   than sending, but should be a chosen action, not auto-blast). Target: the 1,157 emailable
   contacts SF is missing, value-ranked (by the linked owner/property value). Mirror an
   identity back (`external_identities salesforce/Contact`) so it doesn't re-write.
3. **Authoritative-contact resolution** — when multiple sources disagree on a person's email/phone,
   pick the authoritative value (verified > SF > CoStar capture) via the field-provenance pattern,
   and that resolved value is what's written back.

## Bottom line
The system aggregates and dedupes contacts well, but the loop is one-way: 1,157 emailable contacts
captured from CoStar/intake never reach Salesforce, persons carry no address, and there's no
contact writeback op at all. R52 promotes captured fields to first-class (incl. address), resolves
the authoritative value, and pushes it back to the CRM (upsert-by-email, gated) so the contacts the
system learns actually power prospecting where Scott works.
