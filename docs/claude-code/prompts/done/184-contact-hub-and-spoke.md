# Prompt 184 — hub-and-spoke contact consolidation: find the writable home

> **Origin:** 2026-08-26. The inbound half is built and proven (2,809 Outlook contacts, 1,130
> titles, 98 acquisitions contacts). The outbound half is blocked on one unanswered question.
> Read `docs/architecture/contact-reconciliation-outbound.md` first.

---

## The goal (Scott, 2026-08-26)

> *"Consolidate and merge and clean our contacts so that all sources render clean and the
> latest data everywhere based on the latest information we have ingested in the LCC, on every
> place we access the data — email, calls, etc. ... a unified hub-and-spoke two-way cleaning
> and consolidating chain with all sources as the spokes and the LCC as the centralized hub."*

**LCC is the hub. Outlook, iPhone, WebEx, Salesforce are spokes.** Today every arrow points
inward. The goal is that a correction made once in the LCC appears everywhere Scott actually
works.

---

## What is already settled — do not re-litigate

| question | answer | evidence |
|---|---|---|
| iPhone integration | **not needed** | iOS syncs contacts from Exchange; fixing Outlook propagates. A separate path would be a third writer fighting for the same fields. |
| WebEx / Teams write-back | **blocked on INGEST** | `webex_person_id` and `teams_user_id` are 0 / 32,833 — no identity to address a write to. |
| Salesforce scope | **short written allowlist** | Existing doctrine: LCC never writes back to *clean* SF. Territory marking / rules-of-engagement logging only. Explicitly NOT name/title/company/phone corrections. |
| Outlook writability (CLIENT) | **✅ RESOLVED — writable** | Scott edited Ken Hedrick in Outlook desktop on 2026-08-26 and it **saved**, with the "read-only" text still in the notes. The marker is residue from the Stan Johnson → Northmarq migration, not a live link. |
| Outlook writability (**API**) | **⚠️ STILL THE BLOCKER** | The client edit proves the contact is not locked. It does **not** prove `PATCH /me/contacts/{id}` works — Graph can return `200` and discard. **Probe B, with a re-read, is still required.** |

---

## The question this prompt exists to answer

**Where do these contacts actually live, and where can they be edited?**

`/me/contacts` returns them and marks them read-only. Read-only in Graph means they are a
**projection of some other store**. Find that store.

### ✅ ANSWERED 2026-08-26 — it was a migration artifact

Scott edited a read-only-marked contact in Outlook desktop and it saved. **The investigation
below is retained because it explains WHY, and because the API question is still open** — but
do not re-run steps 1, 3, 4 or 5. **Go straight to Probe B (the PATCH + re-read).**

One thing the edit dialog revealed that changes a design assumption: Ken Hedrick's three
addresses are all typed **"Other email"**, none primary. So `emailAddresses[0]` ordering is
arbitrary — which is why `pickBestEmail` exists — and **there is no natural "primary address"
field to write back to.** Reordering a user's address list is more invasive than filling a
blank, so primary-address correction is out of scope unless Scott asks for it explicitly.

### The original lead: a mailbox migration, not a live link

Scott's hypothesis, and the probe data supports it. The `personalNotes` on real contacts contain:

- `"Contact Imported:"` — repeated **several times per contact**, each with a different address
- `"This contact was added from Microsoft ® Lync 2010"` — dated **2012, 2013, 2014**
- accreted address history: `Business Street: … Business Street: … Business Street: …`

These contacts predate Northmarq. Scott was at **Stan Johnson Company**, which Northmarq
acquired; his contacts carry `@stanjohnsonco.com` addresses alongside `@northmarq.com` ones
(Ken Hedrick has both plus a `companyName` of "Newmark" — three employers, no current-firm
email). **The read-only marker may be an artifact of the migration tooling rather than a live
link to another account.** That distinction decides everything:

- **artifact** → the contacts may be editable in Outlook desktop/web despite the API marker,
  and a PATCH may simply work. **Test it.**
- **live link** → find the linked account (iCloud? a legacy Exchange mailbox? LinkedIn's own
  sync?) and either clean at that source or break the link and take ownership.

### Investigate, cheapest first

1. **Read the Probe A result** (`docs/architecture/contact-reconciliation-outbound.md` §4).
   If ~100% carry the marker, the marker is systemic and tells us nothing discriminating —
   go to (2).
2. **Probe B — PATCH one contact and RE-READ it.** A `200` is not proof; Graph can accept and
   discard. This is the only definitive test, and it is one contact.
3. **`GET /me/contactFolders`** — already done: `Contacts` and `Shared Contacts Folder` (the
   latter returned 0 items and is almost certainly the GAL, not a contacts folder).
4. **Check `parentFolderId`** on the read-only contacts. All sampled rows shared one
   `parentFolderId` — confirm whether every read-only contact sits in the same folder, which
   would point at a single linked source rather than per-contact provenance.
5. **Ask Outlook desktop/web directly** — open one of these contacts in the Outlook client and
   see whether it is editable there. If it is, the API marker is misleading and the whole
   blocker dissolves. **This is a 30-second manual test and should be step 1 for the operator.**

---

## If Outlook proves writable — build the hub-and-spoke

Rules, all inherited from things this codebase has already paid to learn:

- **Outbound is a PROJECTION, not a transfer of authority.** An inbound mistake is contained;
  an outbound mistake lands on Scott's phone, his colleagues' Outlook, and Salesforce, where it
  becomes someone else's source of truth.
- **Reuse `FIELD_PRIORITY`** (`contacts-handler.js`). It already ranks sources per field.
  Do not push a value to a spoke that outranks the LCC for that field, or the two directions
  will oscillate.
- **Fill blanks; never overwrite curation.** A populated field that disagrees is a CONFLICT —
  surface it, never auto-resolve (P175a).
- **Never push an inferred value.** `pickBestEmail`'s choice is a *selection*, not a
  correction; pushing it would overwrite a user's own primary-address preference.
- **Honest counts.** Report rows *changed*, verified by re-reading. A send counter is not a
  write counter (P136b). Dry-run before the first real write.
- **The multi-employer history is an ASSET, not noise.** `email_aliases` already preserves it
  (1,196 contacts). Ken Hedrick's stanjohnsonco → northmarq → Newmark trail is exactly the
  "where did this person go" signal the BD doctrine wants. **Consolidation must not collapse it.**

---

## The merge problem, which is harder than the sync

Scott wants contacts *consolidated*, not merely synced. Before any two-way write:

- **How many duplicates exist?** `unified_contacts` is 32,833 rows after the Outlook sync
  merged 1,014 into existing records — but merging happened on **exact email** (Tier 0) only.
  Same person, two addresses = two rows.
- The `contact_merge_queue` table exists. Is it fed? Is it worked? (Class 2 / Class 9 check.)
- **A merge is destructive and must be reversible.** `dia_merge_property_reversible` is the
  pattern: snapshot before, undo function, never a hard delete.
- **⚠️ Do not merge on name similarity.** `dup-pair-planner.ownerCore` reduces "Realty Income
  Corporation" to the empty string; `lcc_normalize_entity_name` makes "Century Park Partners"
  equal "Century Park Properties LLC". Both are banned for identity. Email is the identity key.

---

## Deliverable

Answer the writability question with evidence, then either:

- **a sequenced build plan** for the hub-and-spoke (Outlook first, Salesforce allowlist second,
  WebEx only if ingest proves worthwhile), with the merge problem sized before any write; or
- **an honest "this is not available on this mailbox, here is why"** — which is a perfectly good
  outcome and cheaper than a projector that runs green and changes nothing.
