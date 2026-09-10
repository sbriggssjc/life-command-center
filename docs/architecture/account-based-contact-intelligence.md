# Account-Based Contact Intelligence — design brief

> **Status:** Tier 0 partially built and live (`TIER0_AUTO_ATTACH` on since 2026-08-28); Tiers 1-4
> still design, not built. Written 2026-08-26 from Scott's doctrine statement plus the live evidence
> that prompted it. Supersedes the narrower "pivot promoter" framing in
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` item 5d. **Re-checked 2026-09-10, phased build plan added
> — read §7 before building anything here; it corrects a stale claim in §5a.**

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

> ### ⚠️ CORRECTION (P186, 2026-08-26) — this section's PREMISE is half wrong, and the correct
> half points somewhere better.
>
> The claim "Salesforce already holds the buyer names, so the unlock is linking SF membership to
> the owner" was tested against the 41 high-value owners with an empty Tier-0 bench.
> **`lcc_sf_list_membership.org_entity_id` is 0 for ALL 41** — the Salesforce route yields nothing
> at the org level.
>
> Probing the owners' real email domains directly instead found **≈51 people at 9 owners worth
> $358M already sitting in `entities`** — Boyd Watterson ($179.8M, the largest owner in the
> system), Adam Portnoy (RMR's CEO), Sumit Roy (Realty Income's CEO), and **NGP's David Kent,
> Fran Cowan and Kim Phillips — exactly the three names this section predicted, in `entities`, not
> only in Salesforce.**
>
> So "the names were never missing, the LINKS were" is right, and the missing link is **not** the
> SF-membership join. It is the Tier-0 matching rule's own eligibility test, which excludes
> acronym firms (`length(token) >= 5`), cannot match a token that is not a domain prefix
> (`watterson` vs `boydwatterson`), and can stoplist a name down to nothing ("Realty Income
> Corporation"). Full measurement: `docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md`
> §6; playbook Class 13; build spec in `docs/claude-code/prompts/187-*.md`.
>
> **§3b's rule "match on email domain, never company name" survives intact and is reinforced** —
> it is the right key. The correction is about *which table to key it against*.

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

### ⚠️ FIRST: Scott already syncs LinkedIn → Outlook contacts. **This data IS now flowing into the LCC — see §7a, corrected 2026-09-10. The rest of this subsection is the 08-26 measurement that prompted building it; read as history, not current state.**

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

## 7. Status check + phased build plan (2026-09-10, Cowork)

Scott's direction 2026-09-10: automate owner→contact linkage end to end with minimal human-in-the-
loop, split by owner type — individual/small-firm owners get deterministic linkage (Tier 0); large
institutional buyers (REITs, funds) get the role-taxonomy treatment already designed in §3a (website +
Salesforce + prior correspondence to find the person in charge of the *right function*, not just any
person at the firm).

**This section does not redesign anything below — Tiers 0–4 above are still the adopted shape.** It
re-measures live state against the design (some of it has moved since 08-26/08-31, one claim below
was flatly wrong and needs correcting), and lays out the build order.

### 7a. Correction — §5a's "the receiver has never been fed" is now FALSE

Re-measured live 2026-09-10: `unified_contacts.outlook_contact_id` is populated on **2,835 of 32,858**
rows (was 0), `last_synced_outlook` ranges 2026-08-26 → **today**, and **2,829 rows synced in the last
7 days** — a Power Automate flow is running and current, not the dormant gap §5a described. Whoever
built this did not update this doc to say so; do not assume it is still 0, and do not re-propose
building the flow §5a called for — it exists. `title` coverage moved with it: **1,723 of 32,858 (5.2%)**,
up from 1.9%, but still the binding constraint on Tier 2 (§3a's role taxonomy needs a title to tell
acquisitions from disposition from DD).

### 7b. Live re-check of the open AC items

- **`TIER0_AUTO_ATTACH`** — `state='on'` since 2026-08-28, owner Scott. Confirms live, not re-verified
  further here (re-verify write counts before building on top of it).
- **`owner_contact_pivot.active_contact_entity_id` populated** — **1,440** rows today (was near-zero at
  the 08-27 "27 human attaches" measurement) — Tier 0 has been running and accumulating for two weeks.
  **Re-measure AC10's 11-owner/$240.5M suppressed-and-invisible population before building its fix** —
  the number is two weeks stale and pivot volume has grown 50×+ since it was taken.
- **AC7 (Andrew Pulliam duplicate)** — still live: two `entities` rows named "Andrew Pulliam" exist
  today. Not auto-resolved by anything since 08-26.

> ✅ **AC1b / AC7 / AC10 CLOSED 2026-09-10 (`build/aci-phase0`).** The stale-count warning above is now
> history, not a live blocker — re-measured before building, per its own instruction:
> **251 owners / $329,379,804.64** were suppressed-and-invisible (14 with no pivot row at all, 237 with
> a pivot row missing `active_contact_entity_id`) — up from the August 11/$240.5M, exactly as the ~50×
> pivot-growth warning predicted. `lcc_promote_linked_owner_contacts` (fill-blanks, ledger-before-write,
> reversible via `lcc_ac10_unpromote`) promoted **249 of 251** (2 carry no candidate surviving the
> junk/brokerage guards and are correctly left unpromoted rather than guessed at) —
> `v_lcc_ac10_promote_candidates` **251 → 0**. Forward-running daily cron at 06:12 UTC, not a one-shot.
> AC7's Pulliam duplicate merged (survivor `d6b0d27e-…`, 37 edges + the existing Easterly pivot
> reference; loser `537ecdd2-…`, 1 edge, merged via `lcc_merge_entity`, `lcc_entity_merge_log` id 170).
> AC1b's university-scope drift closed on both views. See `STATUS.md` 2026-09-10 for the full writeup;
> migrations `20261010120000_lcc_ac1b_*.sql` / `20261010140000_lcc_ac10_*.sql`; guards
> `test/ac1b-university-scope.test.mjs` / `test/ac10-promote-linked-owner-contacts.test.mjs`.

### 7c. Phased build order

**Phase 0 — small mechanical fixes that unblock or clean the rest (do first, cheap):**
- `AC1b` — two-line scope-drift fix (universities leaking into two views via the wrong predicate).
- `AC10` — promote an owner's already-linked person into `owner_contact_pivot` when one exists; re-measure
  the suppressed population first (§7b).
- `AC7` — merge the Andrew Pulliam duplicate through the existing reversible `lcc_merge_entity` path
  (same machinery as the C13g/OWN-T0e arc just closed — no new merge path).

**Phase 1 — finish Tier 0 (deterministic linkage, the individual/small-owner majority of the 87% gap):**
- `AC1d` remaining pieces (b: un-park signals from correspondence/SF/title/sponsor map; c: learning
  from `lcc_tier0_confirm_log` rejects) and `AC1e` (SPE-subsidiary inheritance — 19 of 107 cards are
  one question asked three times).
- This phase is what actually moves the 13%→higher owner-linkage number for the bulk of owners, since
  most of the 5,633 unlinked owners are not REIT-scale accounts.

**Phase 2 — the REIT/fund "who's in charge" treatment (Tiers 1–2, `AC2`/`AC3`):**
This is what Scott asked for by name today — large institutional buyers need the *right person for
the task*, not just any linked person. Now buildable where it wasn't in August: title coverage exists
and is growing (7a), correspondence and SF campaign membership are both already live inputs. Build:
- `AC2` — bench ranking (score each candidate person on correspondence volume, recency, two-way vs
  one-way, seniority signal, inferred function; keep a bench, never collapse to one winner).
- `AC3` — Ollama function/remit inference over subjects (+bodies where available), the four-bucket
  taxonomy from §3a (acquisitions / disposition / transaction-DD / broker), confidence carried per
  P181, gated surface.
- Value-gate by owner rent per the existing P161/P180 doctrine (never per-task, per-owner).

**Phase 3 — the standing loop + broker intelligence (`AC4`/`AC5`), plus the input-quality spin-offs
(`AC6`/`AC8`/`AC9`) that would otherwise corrupt Phase 2's correspondence signal:**
- `AC4` re-runs on new correspondence/transactions/replies; a reply redirect ("talk to X") is the
  strongest signal and should update the bench directly.
- `AC5` keeps broker relationships as Tier-4 market intelligence, never a pursuit target.
- `AC6` (professional emails misfiled as personal — corrupts the Tier 2 input corpus), `AC8`
  (`v_lcc_prospecting_edge_review` narrower than its name, returns false negatives on broker tests),
  `AC9` (7 competitor-broker edges on Easterly still wear the wrong role) should land before or
  alongside Phase 2/3, since they are measured defects in the exact signal Phase 2 depends on.

**Sequencing note:** Phase 0 and Phase 2 are the two genuinely separate asks in Scott's message today
(individual-owner automation vs. REIT/fund person-in-charge) — Phase 1 serves the first, Phase 2 the
second. They can build in parallel once Phase 0 clears; Phase 2 does not depend on Phase 1 finishing.

## 8. The recorded-owner → true-owner control-chain logic (2026-09-10, Scott's framing)

Scott's direction, close to verbatim, because the design follows from it: most of the recorded-owner
→ true-owner resolution is going to end up being logic and matching over addresses, names, emails,
and phone numbers. **If a recorded-owner LLC has a member whose address is a residence, the assessor
sends the tax bill to that same address, and that address is owned by another entity or directly by
that member, that member is the true owner in control for our purposes.** One member (or one family)
→ probably an individual owner, and the company and the contact are the same. Multiple members →
probably a partnership/company, and the contact is whichever member's address demonstrates control
(receives the tax bill, etc.). Ollama should review and improve this as the data works through the
pipeline, and the human-in-the-loop footprint should shrink over time, not stay fixed.

**This section formalizes that as a decision chain and states plainly what can run on data already
held for free versus what needs a paid source not yet turned on** (Scott's call, 2026-09-10: build
the logic now against free/existing data; accept it will under-cover the LLC-member scenario until
real member/mailing-address data is added later — do not silently degrade the design to fit, name
the gap instead).

### 8a. What the chain needs, and what actually exists today

| link in the chain | what it needs | what we hold, measured 2026-09-10 |
|---|---|---|
| Is the recorded owner an LLC/company or already a person? | `entities.entity_type` | Live — this is C13g's whole arc, now closed |
| Who are the LLC's members/managers? | SOS filing officer/member list | **Effectively nothing.** `llc-research.js` (OpenCorporates) is coded and gated on `OPENCORPORATES_API_KEY`, unset. Direct SOS scraping (`sos-proxy`, a residential-IP proxy Scott already runs) is live infrastructure but bot-wall-blocked on FL/CA/TX/AZ (Cloudflare/Incapsula), honest-blocked not silently zero. `entity_relationships` has **no member/manager edge type today** (`owns, associated_with, brokers, deal_party, developed, finances, guaranteed_by, leases, purchases, sells` — nothing modeling "person is a member of this LLC"). |
| Does a member's address match a residence? | a home address per member, classified residential-vs-registered-agent-service | `entities.address`/`normalized_address` exist as columns but are populated on **40 of 13,212 person entities (0.3%)** and **101 of 45,637 organizations (0.2%)** — the column exists, the data essentially doesn't. `true_owners.notice_address_1` is the one REAL, non-fabricated address field at scale (deed/SOS-derived, populated for the dia contactless population `address-reverse.js` was built against) and already has a built, tested classifier (`address-reverse.js::isRegisteredAgentServiceAddress`) that correctly excludes CSC/CT/Cogency/law-firm/PO-box addresses so a service address is never mistaken for a residence. |
| Does the assessor's tax bill go to that same address? | real `tax_records.mailing_address` / `mailing_owner` | **Fabricated for all practical purposes.** `public-records-source-lane.md` §2: the model leg (25,334 of 25,621 dia tax rows) is GPT-4o inventing plausible county records, not a county fetch — confirmed, not suspected. The one real leg (CoStar sidebar capture, 287 rows) has never once carried a `tax_amount` — a **measured ceiling of zero**, not a gap. Regrid (`Dialysis/src/regrid_client.py`) is a complete, never-run vendor client gated on `REGRID_API_KEY`, unset. |
| Does that address belong to another entity we already hold, or directly to the member? | cross-reference against `entities` | Buildable today wherever an address string exists on either side — but per the row above, the population to run it against is tiny until a real address source is wired. |

**Honest summary: the chain's LOGIC is sound and partly already built (the residential-vs-agent-service
classifier exists and is tested); the chain's DATA is not there yet for the specific mailing-address
corroboration Scott described.** Two of five links (member list, tax-bill mailing address) are
blocked on paid APIs or bot-walled scraping, per Scott's decision not pursued this round.

### 8b. What can be built now, on free/existing data, and what it will actually resolve

Per Scott's decision (build the logic now, free data only, accept under-coverage), Phase 1/2's build
should add a **Tier 0.5 — the control-chain classifier**, sitting between Tier 0 (email-domain match)
and Tier 1-2 (institutional bench + role inference), covering the individual/small-owner population
Tier 0 alone does not resolve:

1. **A new `entity_relationships` edge type is needed first — `llc_member`/`llc_manager`** (person →
   owner LLC), because none exists. Without SOS/OpenCorporates, the only sources able to populate it
   today are: (a) a human verdict recorded through the existing lane pattern (never a silent auto-mint
   — an unverified member claim is worse than no claim); (b) whatever member names already surface
   incidentally in correspondence, Salesforce, or deed grantor/grantee text and can be matched with
   the same discipline `entity-link.js` already applies elsewhere. Size this population before
   building — do not assume it is large.
2. **The single-member/family inference runs on `one_off_owner` (C13b/C13c) as its starting signal**,
   not a member count we cannot get for free — `one_off_owner` already exists as a classification and
   is the closest thing this repo has to "probably not an institution." Corroborate, don't invent a
   second classifier for the same question.
3. **`address-reverse.js`'s residential-vs-agent-service classifier runs against `true_owners.notice_address_1`**
   (the one real address field at scale) — where it resolves to a genuine residential address (not an
   agent-service address), that is a real, free signal worth a real confidence weight; where the owner
   has no `notice_address_1` or it resolves to an agent-service address, the chain stops there and says
   so rather than guessing.
4. **Cross-reference against `entities.address`/`normalized_address` wherever either side has a value**
   — small population today (§8a), but free, and it grows for free every time another part of the
   system (Tier 0, Outlook sync, a manual attach) fills in an address, so it should run as a standing
   check, not a one-time sweep.
5. **Everything this DOES resolve should be gated at the same confidence discipline as Tier 2 (P181)** —
   a residential-address match with no corroborating link is weaker evidence than a residential-address
   match PLUS an existing Tier-0 email-domain link to the same owner, and the two should not render
   identically on a card.

### 8c. Where Ollama fits, and the standing-improvement loop Scott asked for

Scott: *"we can use Ollama to help review as we work the data through the pipeline"* and the process
should improve over time with a shrinking human footprint — this is the same doctrine `account-based-
contact-intelligence.md` §4 Tier 2/3 already committed to for the institutional side, and it applies
here identically, not as a separate design:

- Ollama's job is not to invent the member list or the mailing address — it has none of that data
  either. Its job is **triage and rationale over what the deterministic chain above already produced**:
  when 8b's steps disagree (e.g., the address chain suggests one person, Tier 0's email-domain match
  suggests another), Ollama drafts the one-line "why these are/aren't the same control chain" the way
  `L10` (owner-resolution rationale) already scopes for the ownership-history side, carrying a
  confidence, never resolving silently.
- Every verdict — human or Ollama-assisted — writes to a ledger the same way `lcc_tier0_confirm_log`
  already does, so a reject demotes that signal for similar owners (the same living-loop mechanism
  §4 Tier 3 specifies) and the system's precision compounds instead of resetting each time.
- **The human-in-the-loop budget should be measured, not assumed** — the same `UX-process` doctrine
  (`app-ux-review-2026-09-02.md` §3) already adopted elsewhere: track how many cards a human actually
  had to touch per period and whether that count is falling as the ledger accumulates. If it isn't,
  that's a build defect worth surfacing, not a shrug.

### 8d. What this section does NOT change

Tiers 0-4 of the institutional design (§§1-7) are unchanged — REITs and funds do not have "members"
in this sense and stay on the role-taxonomy path. This section is additive, for the individual/
small-owner majority of the linkage gap that Tier 0 alone (email-domain match) does not reach because
no domain signal exists for a personal LLC with no public web presence.
