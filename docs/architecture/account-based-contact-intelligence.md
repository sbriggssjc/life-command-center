# Account-Based Contact Intelligence — design brief

> **Status:** design, not built. Written 2026-08-26 from Scott's doctrine statement plus the
> live evidence that prompted it. Supersedes the narrower "pivot promoter" framing in
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` item 5d.

---

## 1. The doctrine this implements (Scott, 2026-08-26)

Recorded close to verbatim, because the design follows from it:

1. **The ACCOUNT is the primary pursuit** for a large repeat buyer. *Who* to call at that
   account is a **separate, secondary function** — and it is not one decision, it is a
   standing one.
2. **Contact determination is value-based and ONGOING, not one-and-done.** It must update as
   new information and new transactions are ingested.
3. **Professionals change roles and firms.** Track where prior contacts moved, so a past
   working relationship can be leveraged at their new employer.
4. **Never pursue brokers for a principal-buyer working relationship.** But broker↔buyer
   history is *valuable market intelligence*, and should be kept and surfaced:
   - which brokers have transacted with this buyer, and how many;
   - **gaps where we could represent the buyer as a BUYER'S rep**;
   - where our largest competitors are selling deals, so we can shape a value proposition
     against them.
5. **Email correspondence explains WHY we contacted someone**, and therefore what function
   they cover — that should shape who we pursue and for what.
6. Preferred shape: **Ollama automates it; humans give feedback** as replies arrive, as new
   information lands, or when a contact redirects us to the right person.

## 2. The defect that prompted it

`v_owner_contact_worklist` excludes any owner that already has a linked person — correct, they
need no *acquisition*. **But nothing promotes that person into `owner_contact_pivot`.** Of 120
suppressed owners ($875.3M): 72 work as designed, 37 have an empty pivot, and **11 have no
pivot row at all ($240.5M)** — invisible to the contact engine.

**Easterly Government Properties is the worked example, and it is stark.** The owner panel
reads "— none". What we actually hold:

| linked to the OWNER entity | in our data but NOT linked |
|---|---|
| 7 competitor brokers — CBRE, JLL, Newmark, Cushman, Avison Young — all roled `prospecting_contact` | **Andrew Pulliam** `apulliam@easterlyreit.com` — **71 emails**, 37 edges |
| 2 personal-email contacts of uncertain provenance | **Lucas Shuler** `lshuler@easterlyreit.com` — **51 emails** |
| | 5 more @easterlyreit.com / @easterlypartners.com with 0 emails |

**122 emails with two Easterly principals, and the system says we have no contact.** The
principals were never linked; only the brokers were.

## 3. Functional role is inferable from correspondence — demonstrated

From subject lines alone, no body parsing:

- **Andrew Pulliam** — *"188 Harvest Lane, Williston, VT — Escrow 202500342NCS — Closing
  Documents"*, *"draft press release"* → transaction closing + corporate communications.
- **Lucas Shuler** — *"188 Harvest Lane Prorations"* → closing finance / accounting.

That is exactly the "what does this person cover" signal Scott described, and the cheap tier
(subjects) already carries it. Bodies would refine it; they are not required to start.

## 3a. The ROLE TAXONOMY — pursuit target depends on function, not volume (Scott, 2026-08-26)

Correspondence volume is **not** the selector. The worked example:

| person | emails | role | pursue? |
|---|---|---|---|
| **Andy Pulliam** | 71 | **EVP – Acquisitions & Portfolio Manager** | **YES — primary buy-side target** |
| Lucas Shuler | 51 | due-diligence / transaction manager *for that deal* | No — deal execution, not pursuit |

**Why acquisitions is the buy-side target:** we prospect a buyer by *showing them deals they
might buy*, so the pitch belongs with acquisitions.

**The funnel theory that makes this the right entry point:** the acquisitions contact
recommends us and pulls us into disposition conversations — because **disposition teams
routinely ask their own acquisitions team who the best brokers in the space are.** When that
happens we get a name and title on the disposition side, which we then pursue in a more
traditional seller/developer manner but in a **REIT / institutional disposition tone**. That
name is kept **IN ADDITION to** the acquisitions contact, never as a replacement.

So the taxonomy has at least four buckets, and they drive different behaviour:

| bucket | pursuit mode |
|---|---|
| **acquisitions** | primary buy-side: show deals |
| **disposition** | seller/developer BD tone, institutional register |
| **transaction / DD / asset mgmt** | not a pursuit target; useful for deal execution |
| **broker** | never a principal-buyer target; Tier-4 market intelligence only |

**The signal for which is which is in the correspondence** — specifically the **timing and
history of what INITIATED each deal-flow topic** (the initial showing). Who we sent the first
offering to, and who replied, distinguishes acquisitions from the DD manager who appears later
in the same thread. That is a stronger and cheaper signal than title parsing.

## 3b. Salesforce already holds the buyer names — under the WRONG company

Scott: *"That name also shows up on our buyer lists in Salesforce for each of these top buyers
already (GSA Buyer under Team Briggs groups)."* Verified — and it resolves the puzzle:

`lcc_sf_list_membership` holds **7,186 rows**; campaign **`GSA Buyer`** has 21 members. It
contains the principals for **three of the four invisible owners**:

| owner (invisible, no pivot) | rent | principal in `GSA Buyer` | filed under company_name |
|---|---|---|---|
| Easterly Gov Properties | $85.0M | **Andrew Pulliam** `apulliam@easterlyreit.com` | **"Government Investment Partners LLC"** |
| NGP Capital | $59.8M | David Kent, Kim Phillips, Fran Cowan `@ngpv.com` | "NGP V" / "National Government Properties" |
| Elman Investors | $29.0M | Lee Elman, James Brooke | "Elman Investors Inc" |

**Every one has `linked_to_owner = false`.** The names were never missing; the LINKS were.

**⚠️ MATCH ON EMAIL DOMAIN, NEVER COMPANY NAME.** Searching `company_name ilike '%easterly%'`
returns **nothing** — Pulliam is filed under "Government Investment Partners LLC". The email
domain `easterlyreit.com` is what identifies him. This is the same identity-vs-fuzzy discipline
as `lcc_owner_strict_core`: the human-entered label is unreliable, the machine key is not.

**Also surfaced:** duplicate owner entities — Easterly at $85.0M *and* $0; NGP at $59.8M, $8.5M
and $0; Elman at $29.0M and $447k. Merge candidates, and they inflate any per-name rollup.

## 3c. Live test of the "people move" case — and why naive enrichment is dangerous

Scott believed Pulliam had recently moved firms. Searched (2026-08-26):

- **Role CONFIRMED, exactly as Scott described it:** Andrew G. Pulliam, **Executive Vice
  President – Acquisitions and Portfolio Manager**, Easterly. His own bio covers "sourcing,
  underwriting, structuring, closing, asset management and disposition".
- **Move NOT substantiated.** Easterly's team page, ZoomInfo, LinkedIn and RocketReach all
  still show him there; no departure announcement found. That is not proof he hasn't moved —
  team pages lag and there may be no release — but the public record does not support it today.
- **⚠️ The results contained a DIFFERENT Andrew Pulliam** ("VP of Financial Operations at
  Integra"). **A name-keyed enrichment would have confidently moved him to the wrong company.**
  Any web/LinkedIn enrichment must key on email domain + employer corroboration, and must
  record its confidence and its source URL — never overwrite a known employer on a name match.

## 4. Proposed shape

**Tier 0 — link what we already know (deterministic, no LLM).**
Match person entities to the owner by **email domain** ↔ owner identity, and create the
`entity_relationships` edge + promote the best into `owner_contact_pivot`. Easterly alone
yields 7 people, 2 with heavy correspondence. Value-gate by owner rent; reuse the P161-gated
`owner-reachable-via` resolver (it already excludes brokers via `NON_REACHABLE_ROLES` and
value-gates weak `works_at` links). **Broker-only owners must fall THROUGH to acquisition
rather than be suppressed** — that is the P166 doctrine applied at the pivot.

**Tier 1 — rank the bench, don't pick one winner.**
An account has several relevant people. Score each on: correspondence volume, recency,
two-way vs one-way, seniority signal, and inferred function. Keep a **bench** (the pivot
already has a `bench` column) rather than collapsing to a single "the contact".

**Tier 2 — Ollama infers function and drafts the account strategy.**
Feed subjects (+ bodies where available) per person and ask for: function/remit, evidence
quote, and confidence. **Carry the confidence and gate the surface on it** — this is the P181
lesson: a worker's residue must escalate with its confidence attached, or a 0.80 judgement and
a 0.28 guess wear the same label.

**Tier 3 — the standing loop.**
Re-run on new correspondence, new transactions, and on reply. A reply that redirects us
("talk to X") is the highest-quality signal available and should update the bench directly.
**Never a one-and-done write** — every conclusion carries `as_of` and is revisited.

**Tier 4 — broker intelligence, kept separately and deliberately.**
Never a prospect target. Surfaced as account intelligence: who has transacted with this buyer,
volume, recency, and **where the gaps are** (markets/product where we could represent them as
a buyer's rep, and where competitors are winning their business).

## 5. Non-negotiables

- **Brokers are never promoted to the pivot**, at any tier.
- **Every conclusion is evidence-backed and reversible**, with the correspondence that
  produced it citable.
- **Confidence travels with the escalation** (P181).
- **Value per OWNER, never per task** (P180).
- **A curated `answerable`/actionable flag is updated in the same change** as any new capture
  path (P180).

## 5a. External enrichment sources — what is actually available

Scott asked whether LinkedIn or similar public/social sources can be ingested. Honest answer,
ranked by legitimacy and effort:

### ⚠️ FIRST: Scott already syncs LinkedIn → Outlook contacts. **That data is NOT in the LCC.**

Scott (2026-08-26): *"I already sync LinkedIn with my contacts in Outlook so we should have
that data already reflected in our Outlook connections."* The sync into Outlook is real; the
step from Outlook into the LCC has never happened. Measured live on `unified_contacts`
(31,038 rows):

| column | populated |
|---|---|
| `sf_contact_id` | 17,298 — Salesforce IS flowing |
| `company_name` | 31,004 |
| **`outlook_contact_id`** | **0** |
| **`last_synced_outlook`** | **never** |
| `icloud_contact_id` | 0 |
| **`title`** | **585 (1.9%)** |

**The receiver is fully built and has never been fed.** `api/_handlers/contacts-handler.js`
accepts `outlook_contact_id`, carries a **Tier-3 match rule** on it, and renders an Outlook
source badge in the UI; `unified_contacts` has the columns. There is simply no sender — no
Power Automate flow pulls `/me/contacts`, unlike the existing Outlook mail/calendar bridges.
A dormant capability that looks like a healthy quiet pipeline (playbook Class 5), except here
it is *unfed* rather than flag-gated, so even the feature-flag registry does not show it.

**Why this is the highest-leverage enrichment item, not just a nice-to-have:** the role
taxonomy in §3a needs a TITLE to distinguish acquisitions from disposition from DD — and we
have a title on **1.9%** of contacts. Outlook contacts (LinkedIn-synced) are the natural
source for exactly that field, for exactly the people Scott already knows. It also closes the
"where did this person go" case without any scraping: a LinkedIn-synced Outlook contact
updates its company/title when the person moves.

**Build it as a Power Automate flow mirroring the existing Outlook bridges** (`api/bridges.js`
pattern, `X-LCC-Source-User-Id` normalized through `resolveSourceUserId` — see the P116
footgun where the wrong user-id space silently rejected 10,470 writes), POSTing into the
contacts-handler endpoint that already exists. Delta-sync on `lastModifiedDateTime`.

### Other sources

| source | verdict |
|---|---|
| **LinkedIn connections CSV export** (Settings → Get a copy of your data → Connections) | ✅ Still useful as a one-shot backfill / cross-check, and as the fallback if the Outlook contact sync proves lossy. It is your data, export is a supported feature, no ToS issue. |
| **Company team pages** (`easterlyreit.com/company/team/`) | ✅ Fetchable, authoritative for current roster, and the pattern already exists in this codebase (the SOS residential-proxy work). Best signal for *departures* — a name disappearing from a team page is evidence. |
| **SEC filings** (REIT officers, proxy statements) | ✅ Authoritative, free, well-structured for public buyers like Easterly. |
| **Paid enrichment APIs** — ZoomInfo, RocketReach, Apollo, Clearbit | ✅ Legitimate, licensed, API-based. Cost per lookup; would need a value gate exactly like the SAM lookup budget. ZoomInfo already surfaced Pulliam correctly in the test above. |
| **Scraping LinkedIn profiles/search** | ❌ **Do not.** It violates LinkedIn's ToS, they actively block it, and `hiQ v. LinkedIn` did not make it safe to do at scale from a company system. The SOS proxy exists to reach *public government records*, not to launder a ToS violation. |
| **LinkedIn official APIs** | ⚠️ Real but effectively closed — the useful people-search endpoints require a Sales Navigator partnership agreement, not self-serve. Worth checking whether Northmarq already holds a Sales Navigator enterprise licence, which would change this line. |

**Recommended sequence:** connections CSV (free, yours, immediate) → team-page fetch on a
cadence for the top N accounts by value → paid API only for the residue, value-gated. Every
enriched fact carries `source`, `source_url`, `confidence` and `as_of`, and **never silently
overwrites** a fact we hold from correspondence.

## 6. Spin-off defects found while investigating (each its own item)

1. **Professional emails are landing in the "personal" bucket.** Scott flagged this
   independently; it is very likely the same bucketing that produced P124's
   `cold_bd_outreach` catch-all in `draft-assist`. Needs its own measurement — a professional
   counterparty misfiled as personal corrupts both the voice corpus and this engine's inputs.
2. **`Andrew Pulliam` is duplicated** — two live person entities on the same address, 37 edges
   vs 1. Merge candidate.
3. **`v_lcc_prospecting_edge_review` (P166) does NOT contain the Easterly broker edges**, so it
   is narrower than its name implies and returned a false zero when used as a broker test. The
   detector needs widening before it is trusted again.
4. **7 competitor-broker edges on Easterly wear role `prospecting_contact`** — real, wrong per
   doctrine, and not the cause of the suppression. Re-role, don't delete: they are the
   Tier-4 intelligence.
