# Outbound contact reconciliation — LCC as the hub of record

> **Status:** design, **measured 2026-08-26 (Prompt 184)**. The binding constraint turned out
> NOT to be writability: the hub knows almost nothing about an Outlook contact that did not
> come from Outlook (§4B), so the valuable outbound write is **CREATE, not PATCH** (§4C).
> Written 2026-08-26 from Scott's requirement: *"a cleaning and
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
| **Outlook** | `outlook_contact_id` on **2,809** rows | ✅ client-writable; API unproven (Probe B, §4) — but **the PATCH payload is ~211 field-values**, see §4B |
| **Outlook (new contacts)** | 30,024 hub rows absent from the address book | ✅ **the real payload — 487 value-gated CREATEs**, see §4C |
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

## ✅ RESOLVED 2026-08-26 — OUTLOOK IS WRITABLE. The marker is a migration artifact.

**Scott edited Ken Hedrick in Outlook desktop and it SAVED**, with the "This contact is
read-only" text still present in the notes. The marker does not describe the contact's current
state — it is residue from the **Stan Johnson Company → Northmarq migration**, corroborated by
the same `personalNotes` carrying `"Contact Imported:"` three and four times over and Lync 2010
references dated 2012–2014.

**Consequence: the outbound path is open.** Everything in §5 (field authority, fill-blanks,
conflict surfacing, honest counts) now applies, and the sequencing in §6 can proceed.

**⚠️ But the API is still the unknown.** Scott edited through the Outlook CLIENT. Whether
`PATCH /me/contacts/{id}` succeeds — and whether it *sticks* — is a separate question, because
**Graph can return `200` and discard the change**. Probe B remains required, and its
verification step (re-read the contact, do not trust the status code) is the whole point.

**Also learned from the edit dialog:** all three of Ken Hedrick's addresses are typed
**"Other email"** — none is marked primary. That is why `emailAddresses[0]` returned
`khedrick@stanjohnsonco.com` (his prior firm) and why `pickBestEmail` was necessary. It also
means **a "set the primary address" outbound write has no natural target field** in this
mailbox's data shape; ordering is the only signal, and reordering someone's address list is a
more invasive change than filling a blank.

---

### The original finding (kept for the record)

**Scott's probe (2026-08-26) showed 4 of 5 sampled contacts carrying**
`personalNotes: "This contact is read-only. To make changes, tap the link above to edit in
Outlook."`

Read-only contacts are **projections from a linked account** (the LinkedIn or iCloud sync
itself). If a contact is read-only, `PATCH /me/contacts/{id}` will fail or silently no-op —
and a silent no-op is the worst outcome, because the flow reports success while nothing changes.
That is the exact failure shape this codebase keeps finding.

**We cannot measure this from the database** — `personalNotes` was not ingested. So:

**FIRST STEP, before any outbound design work: determine what fraction of the address book is
writable.**

⚠️ **Do NOT do this by re-syncing.** `hwMark` is now set to `2026-08-26T16:00:00Z`, so a normal
run only picks up changed contacts — it would report on a handful of rows, not the address book.
Resetting the high-water mark to backfill a diagnostic field means another 88-minute run and
2,809 redundant writes. Neither is necessary.

### Probe A — how MANY are read-only (read-only, ~2 minutes, no schema change)

A manual flow, no writes, no ingest:

1. **Instant cloud flow** → **Manually trigger a flow**
2. **Office 365 Outlook → Get contacts (V2)** — Folder `Contacts`, **Top `100`**
3. **Compose** → Expression:
   `length(body('Get_contacts__V2_')?['value'])`
4. **Compose 2** → Expression (counts the read-only marker):
   `length(filter(body('Get_contacts__V2_')?['value'], item()?['personalNotes'] != null))`
5. Run, read both Compose outputs.

Step 4 counts contacts carrying ANY `personalNotes`; the read-only marker is the dominant
content of that field in this mailbox (observed in 4 of 5 sampled). If a finer count is wanted,
`contains(coalesce(item()?['personalNotes'],''), 'read-only')` is the exact test — but PA's
`filter()` is fussy about nested expressions, so start with the null test and refine only if the
number is ambiguous.

**Interpretation, decided BEFORE seeing the number** (so the result cannot be rationalised):

- **> 70% read-only** → outbound contact cleaning to Outlook is largely unavailable. Say so,
  stop, and reconsider whether the Salesforce-allowlist path alone is worth building.
- **30–70%** → viable for the writable subset; the projector must detect and skip read-only
  rows, and report the skipped count honestly rather than silently.
- **< 30%** → proceed as designed.

### Probe B — is it ACTUALLY writable (definitive, one row)

> **SHIPPED as `flow-lcc-probe-outlook-contact-write.json`** (Prompt 184), guarded by
> `test/outlook-contact-write-probe.test.mjs`. Import it, run `apply=false` to read the
> baseline, then `apply=true` on one contact carrying the marker.
>
> ⚠️ **The design sketched below could not answer its own question, and the shipped flow
> corrects it.** Writing `jobTitle` back to its *existing* value makes a successful write and a
> silent discard **re-read identically** — the re-read verifies nothing. The flow writes a
> sentinel derived from the baseline (so it is guaranteed to differ), re-reads to compare,
> **restores the original**, and re-reads again to prove it left no mark. Its verdict is
> computed from the re-read, never from the status code, and names
> `ACCEPTED_THEN_DISCARDED` explicitly rather than folding it into success.

The marker is inference; a PATCH is proof. In the same manual flow:

- **Office 365 Outlook → Update contact (V2)**, or an HTTP action
  `PATCH https://graph.microsoft.com/v1.0/me/contacts/{id}`
- Target **one contact you own and can verify**, ideally one you created yourself
- Set a harmless field — e.g. write `jobTitle` back to **its existing value**
- Read the response: `200` with the object = writable; `403`/`ErrorAccessDenied` = not

⚠️ **A `200` on a read-only contact is the dangerous case** — Graph can accept the call and
discard the change. **Verify by re-reading the contact**, not by trusting the status code. That
is the same lesson as the P125 Outlook draft seam, which returned an identical success response
for a threaded reply and a standalone message.

Of the 2,809 Outlook contacts, **1,767 also carry an SF id** and 1,042 are Outlook-only. If
Outlook proves unwritable, the 1,767 are still reachable through Salesforce — but only within
the §3 allowlist, which does *not* include contact-detail corrections. **So if Outlook is
read-only, the honest conclusion is that outbound contact cleaning is largely not available,
and we should say so rather than build a flow that no-ops.**

---

## 4B. Measured 2026-08-26 — the payload is ~211 field-values, and it is the wrong direction

**The writability question turned out not to be the binding constraint.** Before building the
projector, the payload it would carry was measured. It is close to empty, and the reason is
structural rather than fixable.

### The LCC holds almost nothing about an Outlook contact that did not come from Outlook

`unified_contacts.field_sources` records which source won each field. Across all **2,809**
Outlook-linked contacts:

| field | LCC value NOT sourced from Outlook | LCC value sourced from Outlook |
|---|---|---|
| `title` | **3** | 1,127 |
| `company_name` | **25** | — |
| `phone` | **39** | — |
| `mobile_phone` | **144** | — |

**≈211 field-values in total — 0.6% of the address book, and an UPPER BOUND**, because
`FIELD_PRIORITY` puts `salesforce` above `outlook` for `phone` and `title`. Some of those 39
phones are cases where Outlook *did* hold a number and Salesforce outranked it — those are
**conflicts, not blanks**, and are forbidden from an outbound write by the fill-blanks rule.
The genuinely clean subset is the 144 mobile numbers (`mobile_phone` ranks `outlook` above
`salesforce`, so a Salesforce-sourced mobile means Outlook had none).

This is not a defect. **It is what it means for the inbound sync to have worked.** The Outlook
contacts arrived *from* Outlook, so the hub's knowledge of them is Outlook's own knowledge
reflected back. A projector pointed at them would re-send Outlook its own data.

### ⚠️ `email_aliases` does NOT preserve multi-employer history at the claimed scale

The working assumption carried into Prompt 184 was that the history is preserved on **1,196
contacts**. Measured, that is wrong by an order of magnitude, and in a way that inverts the
conclusion:

| | rows |
|---|---|
| carry an `email_aliases` array | 16,811 |
| …of which the array is a **self-echo of the primary email** (no information) | **16,612** |
| carry any alias genuinely distinct from the primary | **199** |
| carry 2+ aliases | **14** |

The 16,612 self-echoes are all `match_method='sf_import'` — the Salesforce ingest wrote
`email_aliases = [email]`. Of the 199 real ones, **182 are `outlook_import`**.

**And that is the decisive point: those 182 came FROM Outlook.** `pickBestEmail` takes the
`emailAddresses` array Outlook sent, picks one as primary, and files the rest as aliases. So
every address in that history **is already in Outlook** — Ken Hedrick's `northmarq.com` address
included. Writing aliases back to Outlook is a no-op by construction.

### The stanjohnsonco primaries are an LCC display defect, not an outbound write

**98** Outlook-linked contacts carry a primary email at `@stanjohnsonco.com` — a firm that no
longer exists. **56 of them already have a live alternative on file**, overwhelmingly
`@northmarq.com` (Scott's own colleagues: Amy Dane, Andrew Ackerman, Carly Dietz, Bridgett
Kiefer…). The tempting reading is "56 contacts to correct in Outlook."

**Outlook already holds those addresses** — that is where the aliases came from. What is wrong
is which one the LCC calls primary: `pickBestEmail` returns the first *business* domain, and
`stanjohnsonco.com` is a business domain that happens to sort first. So this is a **hub-side
selection bug with a hub-side fix**, and pushing anything to Outlook for it would change
nothing. (`email_stale` is `false` on all 2,809 — the flag exists and nothing sets it.)

Related evidence for the migration-artifact reading in §4: Ken Hedrick's alias list includes
`khedrick20200306@stanjohnsonco.com` — a date stamped into the local part by the migration
tooling. That is a **tombstone address**, not employer history, and a consolidation pass should
recognise it as such rather than preserve it as a route.

---

## 4C. The real outbound payload is CREATE, not PATCH

The valuable asymmetry runs the other way. **30,024 of 32,833 contacts are not in the Outlook
address book at all.** Pushing all of them would be the Consumption-Layer failure this codebase
keeps documenting — 16,202 have an email and no evidence Scott has ever dealt with them.

Value-gated on **real correspondence** (`last_email_date` / `last_meeting_date` /
`last_call_date` non-null):

| population | count |
|---|---|
| not in Outlook, has an email | 16,202 |
| …**and Scott has actually corresponded with them** | **828** |
| …and carries a real first + last name | 825 |
| …and touched within 24 months | **487** |

**487 is the honest first payload.** It is a CREATE, so it overwrites nothing, cannot lose
curation, and needs no conflict model — the safest possible first write, and the one that
actually answers *"the contacts I use pop up where I use them."*

**It needs junk guards before a single row ships.** Inspecting the top of the ranked set found,
in the first twelve rows: `emails@campaigns.crexi.com` filed under the person-name "Patrick
Hammond"; a contact whose `full_name` is the firm "Hanley Investment"; and **Scott himself**, at
his own dead `sbriggs@stanjohnsonco.com` address with 26,228 sends. Reuse the existing
detectors (`tm-misparse.js::isMisparseName`, `isJunkContactName`) rather than writing a new one.

Note the set is broker-heavy. Under the account-based doctrine brokers are never *prospected* as
principals — but they are legitimate address-book entries, and this is an address book, not a
pursuit list. That distinction should be stated in the build, not discovered later.

---

## 4D. The merge problem, sized

Smaller than expected on the identity key, and permanently capped by a missing key:

- **Zero exact-email duplicates.** Tier-0 merging is clean.
- Building the full address set per contact (`email` ∪ `email_secondary` ∪ `email_aliases`):
  **24 addresses collide across 45 contacts.** That is the entire email-keyed duplicate
  population — a hand-workable list, not a project.
- **`email_secondary` is populated on 0 rows** — a third address column nothing writes.
- **14,465 of 32,833 rows (44%) carry no email at all.** They cannot be deduped on the identity
  key, and name-fuzzy matching is banned for identity here for reasons this repo has already
  paid for. **This is a stated ceiling, not a backlog.** The honest move is to record it rather
  than reach for `nameSimilarity`.

### ⚠️ `contact_merge_queue` has never held a row — on EITHER project

The prompt asked whether it is fed and worked. Measured: **0 rows on LCC Opps and 0 rows on
gov**, no row ever created on either.

The cause is a producer/consumer split across databases. Its only writer is
`intake-promoter.js::checkBrokerMergeCandidates` — a narrow, fire-and-forget path scoped to OM
listing brokers — and it is hard-coded to `domainQuery('government', 'POST',
'contact_merge_queue', …)`. The reader (`contacts-handler.js`, `operations.js::getOversight`)
goes through `govQuery`, which the **A9b cutover repointed to LCC Opps**. So even if the
producer fired, the triage UI would never see the row. Same shape as P182: a surface that reads
healthy over a link that no longer connects, and the same trap the `CONTACTS_HUB` note in
`CLAUDE.md` warns about — the function is called `govQuery` regardless.

**Fix the target before building anything on top of the queue**, and note that with 45
colliding contacts total, the queue's job today is small.

## 5. Rules for any outbound write (unchanged, and now barely exercised)

These stand, and the §4B measurement means they govern about 144 clean field-values today.

**Field authority already exists — reuse it.** `FIELD_PRIORITY` in `contacts-handler.js` ranks
sources per field. Outbound must respect the same ladder: **do not push a value to Outlook when
Outlook is the higher authority for that field.** One ladder, one definition, or the two
directions will disagree and oscillate.

**Never push a field the LCC inferred.** `pickBestEmail`'s chosen address is a *selection*, not
a correction. §4B shows the selection is currently WRONG on 56 rows, which is precisely why it
must never be projected.

**Fill blanks; do not overwrite curation.** A blank field in Outlook is an opportunity; a
populated one that disagrees is a CONFLICT, surfaced and never auto-resolved (P175a). The 39
non-Outlook phones must be split into these two classes before any of them ships.

**No primary-address reordering.** All three of Ken Hedrick's addresses are typed "Other email"
with none primary, so there is no field to write — ordering is the only signal, and reordering
someone's address list is far more invasive than filling a blank.

**Honest counts.** Report rows *changed*, verified by re-reading, never rows *sent* (P136b).
Dry-run before the first real write.

---

## 6. Sequencing — revised by the measurement

The original plan put "determine writability" first because everything depended on it. It no
longer does: **even a fully writable API has ~144 clean field-values to carry.** The order now
follows value.

1. **Run Probe B** — `flow-lcc-probe-outlook-contact-write.json`, `apply=false` first, then
   `apply=true` on one contact carrying the marker. It is ~2 minutes and it settles the question
   permanently. It gates step 3 only; steps 2 and 4 do not depend on it.
   ⚠️ **The original Probe B design could not answer its own question** — it wrote `jobTitle`
   back to its *existing* value, so a real write and a silent discard re-read identically. The
   shipped flow writes a sentinel guaranteed to differ, re-reads to compare, restores the
   original, and re-reads again to prove cleanup. `test/outlook-contact-write-probe.test.mjs`
   pins those properties.
2. **Fix `pickBestEmail`'s primary selection** (hub-side, no write surface, no probe needed).
   98 contacts show a dead firm as their primary address and 56 have the live one already on
   file. This is the largest correctness win available and it touches nothing outside the LCC.
3. **Build the CREATE projector for the 487** (§4C) — dry-run, junk-guarded, value-ranked,
   reporting rows *created* verified by re-read. Gated on Probe B.
4. **Repoint the `contact_merge_queue` writer** from `government` to the hub, then work the 45
   colliding contacts (§4D). Small enough to be finished, not merely started.
5. **Write down the Salesforce allowlist** (§3) and get Scott's explicit sign-off per entry.
6. **WebEx / Teams** — record "not used for external contacts here" and close them, unless
   ingest is shown to be worth building (Class 9).

**Do not build a PATCH projector for the 2,809 Outlook contacts.** It would re-send Outlook its
own data, run green, and change ~144 fields. That is the shape of failure this codebase names
over and over: a worker whose tally looks like throughput while the population does not move.

---

