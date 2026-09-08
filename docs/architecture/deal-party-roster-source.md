# Deal-Party Roster — Source Re-Spec (finding from BUILD 02 Slice B)

_2026-07-28. Break-out design note. BUILD 02 Slice B tried to build the external-party roster from
Salesforce **OpportunityContactRole** and found it **empty for Team Briggs deals** — 7,201 OCR rows
firm-wide, **0** on any of the 592 backbone deals (confirmed after 15-char id normalization ruled out
a format mismatch). Conclusion: **standard SF contact roles are not where Team Briggs tracks deal
parties.** This re-specs where Slice B and the deal-email matcher get their party data._

## What we know now
- **Team roster (Slice A) works** — internal brokers come from **Deal Team Member** (OpportunityTeamMember).
  192 edges, scope is accurate. Unchanged.
- **External parties (seller / buyer / counsel / escrow) are NOT in OpportunityContactRole** for TB deals.
- So the "roster signal" the deal-email matcher was going to lean on does not exist in the obvious SF object.

## Candidate sources for the external-party roster (in priority order to verify)
1. **Custom `Deal_Participants__c` object — CHECKED, NOT THE SOURCE (2026-07-28).** Its only deal relationship
   is `Fannie_Mae_Deal__c → Lookup(Fannie Mae Deal)` — a lending/agency object, **not** the Opportunity. It has
   no Opportunity lookup and no Contact lookup; participants are name text (`First_name__c` / `Middle_name__c` /
   `Last_Name__c` / `participantIds__c`) + `Participant_Role__c` (multi-select). **Conclusion: this is the debt
   side's participant object; it does not carry Team Briggs IS deal parties.** Combined with the empty OCR
   result, **no structured SF object holds TB external parties** — the roster must come from the `.md` rosters
   and/or be email-derived.
2. **The `.md` dossier rosters (SharePoint).** The design already names these (deal-correspondence-attribution.md
   §1). Fresenius has one. Authoritative but sparse (only deals with a maintained dossier). Good as a
   supplement / for deals not in the custom object.
3. **The CRE relationship graph (109k edges).** `brokers` / `sells` / `purchases` / `owns` edges on the asset
   are *candidate* parties — lower precision, use only to suggest, not assert.
4. **Email-derived (byproduct of the matcher).** People on strong-signal-matched deal threads become roster
   members automatically. Turns the dependency around (see below).

## The bigger implication — the deal-email matcher (Spine #3) pivots to strong-signal-primary
The matcher was specced as **strong signals + roster signal**. With no SF-OCR roster, invert the emphasis:
- **Primary = strong signals** (buildable NOW, no roster needed): property **address / city+state** match
  (the asset entity already has these), **escrow file #** (e.g. `NCS-1288731E-SC`), **OM/PSA reference** in
  subject/thread. These attribute email → deal on their own.
- **Secondary = roster** (whatever we get from `Deal_Participants__c` / `.md`), used to *raise confidence*
  and to disambiguate (an escrow officer touches many deals).
- **Roster as output, not just input:** every person on a matched thread becomes a `deal_party` edge
  (`source: 'email_derived'`), so the roster self-builds from correspondence even where SF/`.md` are empty.

This is arguably a *better* design — it doesn't block the matcher on a roster source that may never be
complete, and it produces the roster as a side effect.

## Two identity/data design rules this build also surfaced (canonize once)
1. **SF id normalization.** SF ids are 15- or 18-char; LCC stores mostly 15 (`unified_contacts.sf_contact_id`:
   16,946 @ 15-char vs 343 @ 18). **Rule: match SF↔LCC ids on the 15-char prefix, everywhere.** Applied ad hoc
   in `deal-roster.js`; belongs in a shared `enc`/id-normalize helper so every future SF join inherits it.
2. **Contact-entity resolution is incomplete and caps the roster + matcher.** Only **5,651 of 17,289** SF
   contacts in `unified_contacts` resolve to a person entity (~11.6k have `sf_contact_id` but no `entity_id`).
   A **contact-entity resolution backfill** (by email/name) is its own build; until it runs, any party or
   email-sender that isn't entity-resolved silently drops.

## Recommended next steps
1. ✅ **DONE 2026-07-28 — `Deal_Participants__c` inspected via SF Object Manager.** Confirmed NOT the TB party
   source (its `Deal` lookup is `Fannie_Mae_Deal__c`, the lending/agency object, not the Opportunity). No
   re-point. Net: **no structured SF object holds TB IS deal parties** → matcher (email-derived) + `.md` rosters
   are the roster. Contact-entity backfill (A2) therefore defers to the matcher's lazy resolution — no bulk build.
2. **Disable / pause the empty OCR flow** — it pulls 7,201 rows daily and writes nothing.
3. **Build the matcher strong-signal-primary** regardless of #1 — it doesn't depend on the roster source.
4. Backlog: the SF-id-normalize helper + the contact-entity resolution backfill.
