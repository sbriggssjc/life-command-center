# Claude Code — R52: close the contact loop (promote captured fields + write authoritative contacts back to Salesforce)

## Why (audit live 2026-06-20 — see AUDIT_contact_acquisition_and_writeback_2026-06-20.md)
Contact aggregation + dedup are healthy (R39 email-key, R40 person-complete merge, R16/R20
acquisition). The gaps:
- **One-way loop:** the ONLY Salesforce write op in the codebase is `create_opportunity`
  (`api/_shared/salesforce.js`) — no `create_contact`/`upsert_contact`. Contacts flow IN
  (CoStar/SF pull), opportunities flow OUT, but a captured/resolved contact is NEVER pushed to the
  CRM. **1,157 of 2,034 emailable LCC person entities (57%) have an email but no Salesforce
  Contact identity** — stranded prospecting contacts.
- **Thin fields:** 4,172 persons → 49% email, 34% phone, **0% address**; the richest captured
  fields live in `entity.metadata.contacts` jsonb, not always first-class on the person.

## House rules
Reuse the existing SF flow-op pattern (`callSfLookupFlow` / the `create_opportunity` rollout) +
the R39 email-key + provenance machinery — don't fork. Upsert-by-email so SF is never duplicated.
Writing to the CRM is a **deliberate, gated** action (lower-risk than sending, but not auto-blast):
value-ranked, and either operator-triggered or behind an env gate. Never write junk/implausible/
broker-as-person (reuse the guards). Reversible (mirror the SF identity back so it doesn't
re-write). ≤12 `api/*.js`; `node --check`/suite green; DB live after dry-run.

## Unit 1 — promote captured contact fields to first-class (+ address)
When a contact is captured (sidebar `metadata.contacts`, intake, SF pull), ensure its
email / phone / company / **mailing address** land on the `person` entity (first-class fields),
not only in `metadata.contacts` jsonb. Add the **address** dimension: source it from SF contact
mailing address (the pull) + county owner records where linked. Resolve the authoritative value
per field via the field-provenance pattern (verified > SF > CoStar capture). This makes the
contact queryable + writable.

## Unit 2 — Salesforce contact writeback (the headline)
Add a `create_contact` / `upsert_contact` SF flow op (Scott wires the PA flow, mirroring
`create_opportunity`). LCC side: `upsertSalesforceContact({name,email,phone,company,address,
account_id})` in `salesforce.js`, **upsert by email** (the flow's SOQL finds an existing Contact
by email and updates, else inserts) so it never dupes. On success, mirror
`external_identities (salesforce, Contact, <sf_id>)` back onto the person so it's not re-written.
Target set: the 1,157 emailable persons missing from SF, **value-ranked** by the linked
owner/property value (work the highest-value contacts first). Effect-first/outcome-truthful;
gated (env flag or operator action); reversible (the identity mirror + a writeback log).

## Unit 3 — surface + drive it (don't auto-blast the CRM)
A value-ranked view `v_lcc_contact_writeback_candidates` (emailable persons w/o SF Contact, +
linked value) and a Decision-Center-style lane or a bounded worker (mirror the R16
contact-acquisition tick) that pushes them on a gated cadence / operator confirm. Report
before/after: SF-Contact-identity coverage (877 → ?), candidates remaining.

## Verify (report back)
- Unit 1: a captured contact's email/phone/company/address present as first-class person fields
  (spot-check one sidebar-captured contact); address coverage > 0.
- Unit 2: a synthetic upsert round-trip against a fake SF flow client — new email → insert path,
  existing email → update path (no dupe), identity mirrored back, fully reverted 0 residue. Gated
  off by default.
- Unit 3: the candidate view returns the ~1,157 value-ranked; the writeback is gated/deliberate.
- Guards: junk/broker never written; `node --check`; ≤12 api/*.js.

## After deploy (Scott)
Wire the `create_contact`/`upsert_contact` PA flow (mirror the `create_opportunity` flow), set the
flow URL env, then run a small gated batch and confirm the contacts appear in Salesforce
(upsert-by-email, no dupes).

## Bottom line
The system learns contacts but the CRM never sees them. R52 promotes captured fields (incl.
address) to first-class, resolves the authoritative value, and writes it back to Salesforce
upsert-by-email — value-ranked and gated — so the 1,157 stranded contacts power prospecting where
Scott actually works.
