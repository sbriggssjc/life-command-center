# Outbound contact reconciliation — LCC as the hub of record

> **Status:** design. Written 2026-08-26 from Scott's requirement: *"a cleaning and
> reconciliation and updating of all contacts everywhere from the LCC (gated to Salesforce for
> our minimum logging necessary to comply with rules of engagement and marking territory
> internally), especially WebEx and Outlook and Contacts on my iPhone so the contacts I use are
> popping up with the latest information where I use them, not just in the LCC."*
>
> Companion to `account-based-contact-intelligence.md` (which is about WHO to pursue). This
> doc is about **making the clean record reach the places Scott actually works.**

---

## 1. The shift this represents

Every contact pipeline built so far is **inbound** — Salesforce, Outlook, calendar, domain DBs
all flow *into* `unified_contacts`. Nothing flows out. The LCC is a very well-informed system
that nobody's phone can see.

Outbound is a different risk profile and needs its own discipline:

- an inbound mistake is **contained** — it lands in one table and we fix it;
- an outbound mistake is **distributed** — it lands in Scott's phone, his colleagues' Outlook,
  and Salesforce, where it becomes someone else's source of truth.

**Therefore: outbound is a PROJECTION, never a transfer of authority.** The LCC publishes what
it believes; it does not conquer the destination. Every write is provenance-tagged, reversible,
and counted honestly (rows *attempted* vs rows *changed* — the P136b lesson: a send counter is
not a write counter).

---

## 2. What is actually possible — measured 2026-08-26, not assumed

| destination | identity we hold | verdict |
|---|---|---|
| **Salesforce** | `sf_contact_id` on **18,052** rows | ✅ writable, but **deliberately constrained** — see §3 |
| **Outlook** | `outlook_contact_id` on **2,809** rows | ⚠️ **BLOCKED PENDING A CHECK** — see §4 |
| **iPhone** | none, and none needed | ✅ **inherits from Outlook — do NOT build this** |
| **WebEx** | `webex_person_id` on **0** rows | ❌ impossible today — no identity to target |
| **Teams** | `teams_user_id` on **0** rows | ❌ same |

### ⚠️ iPhone requires NO integration

iOS contacts sync **from Exchange**. Fixing a contact in Outlook propagates to the phone through
Apple's own sync. Building a separate iPhone path would duplicate a sync that already exists and
introduce a third writer to the same record — the classic way two systems start fighting over a
field. **Outlook IS the iPhone path.**

### ❌ WebEx and Teams are blocked on INGEST, not on write-back

`webex_person_id` and `teams_user_id` are null on all 32,833 rows, so there is nothing to
address a write to. The handler already ships `ingest_webex_calls`, `send_webex` and
`send_teams` — receivers with no senders (playbook Class 9). **Ingest must come first**, and
only then does write-back become a question. Note it may not be worth it: if the firm does not
use WebEx for external contacts, the correct answer is "not used here", recorded, and closed.

---

## 3. Salesforce — minimum necessary, and this is a HARD constraint

`CLAUDE.md` is explicit and pre-dates this design:

> *Salesforce is minimum-necessary and NOT cleaned by LCC — LCC is the source of truth and
> reconciles around SF's dups/errors (never writes back to clean SF). Write back to SF only for
> direct team benefit.*

Scott's framing matches: writes exist **to comply with rules of engagement and mark territory
internally**, not to tidy Salesforce.

**Therefore the SF write surface is a SHORT ALLOWLIST, not a field sync:**

- ✅ activity / touch logging sufficient to establish who is working an account
- ✅ the territory-marking fields the rules of engagement actually key on
- ❌ **NOT** name, title, company, address, phone corrections
- ❌ **NOT** dedup or merge
- ❌ **NOT** "improving" SF data quality

**The allowlist must be written down explicitly and enforced in code**, because "while we're
here, let's also fix the title" is exactly how a minimum-necessary integration becomes a full
sync nobody agreed to. Anything not on the list is not written, and adding to the list is a
decision, not a refactor.

---

## 4. Outlook — one unknown blocks everything

**⚠️ Scott's probe (2026-08-26) showed 4 of 5 sampled contacts carrying**
`personalNotes: "This contact is read-only. To make changes, tap the link above to edit in
Outlook."`

Read-only contacts are **projections from a linked account** (the LinkedIn or iCloud sync
itself). If a contact is read-only, `PATCH /me/contacts/{id}` will fail or silently no-op —
and a silent no-op is the worst outcome, because the flow reports success while nothing changes.
That is the exact failure shape this codebase keeps finding.

**We cannot measure this from the database** — `personalNotes` was not ingested. So:

**FIRST STEP, before any outbound design work: determine what fraction of the address book is
writable.** Two ways, cheapest first:

1. **Ingest `personalNotes`** (or a derived `is_read_only` boolean) on the next contacts sync
   run and count it. One field, no new flow.
2. **A single-contact PATCH probe** in a manual flow against one known contact, and read the
   response.

Of the 2,809 Outlook contacts, **1,767 also carry an SF id** and 1,042 are Outlook-only. If
Outlook proves unwritable, the 1,767 are still reachable through Salesforce — but only within
the §3 allowlist, which does *not* include contact-detail corrections. **So if Outlook is
read-only, the honest conclusion is that outbound contact cleaning is largely not available,
and we should say so rather than build a flow that no-ops.**

---

## 5. If Outlook proves writable — the rules

**Field authority already exists — reuse it.** `FIELD_PRIORITY` in `contacts-handler.js` ranks
sources per field (`salesforce` > `outlook` > `outlook_gal` > `manual`, per field). Outbound
must respect the same ladder: **do not push a value to Outlook when Outlook is the higher
authority for that field.** One ladder, one definition, or the two directions will disagree and
oscillate.

**Never push a field the LCC inferred.** Only push facts with a real, citable source — a title
from the GAL, an email from correspondence. `pickBestEmail`'s chosen address is a *selection*,
not a correction, and pushing it would overwrite a user's own primary-address preference.

**Fill blanks; do not overwrite curation.** The standing rule everywhere else in this codebase.
A blank field in Outlook is an opportunity; a populated one that disagrees is a CONFLICT, and
conflicts are surfaced, never auto-resolved (P175a).

**Honest counts.** Report rows *changed*, verified by re-reading, never rows *sent*. And run a
dry-run mode that lists intended changes before the first real write — every repair in this
codebase that mattered was dry-run first.

---

## 6. Sequencing

1. **Determine Outlook writability** (§4). Everything downstream depends on it, and it is one
   field or one probe.
2. **Write down the Salesforce allowlist** (§3) and get Scott's explicit sign-off on each entry.
3. **Ingest WebEx/Teams identities** — or record "not used here" and close them (Class 9).
4. **Only then** build the outbound projector, dry-run first, Outlook before Salesforce.

**Do not start at step 4.** The temptation is to build the projector because it is the
interesting part; three of the four inputs it needs are currently unknown or unavailable.
