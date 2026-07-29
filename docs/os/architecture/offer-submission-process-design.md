# Offer Submission Process (LOI → Seller) — design spec

_2026-07-29. Automates what we just did by hand for the Snellville DaVita offer: when a buyer's LOI is
received by email on one of our active listings, LCC prepares a **facts-only offer-submission email to the
seller** (draft, for Scott's review — never auto-sent), logs the offer against the deal, and tracks the
expiration as a critical date. Strategy/recommendation stays verbal (a call), per Team Briggs practice — so the
generated writing is terms-only._

## Where this fits
This is the **Seller Communication → "offer summary"** template (`template_library_spec.md` §2.1) wired to a
trigger, drawing on the **Deal Documents** merge schema (`assets/work-product-templates/deal-docs/merge_schema.json`).
It reuses machinery we already have — the Outlook intake pipeline, OM/document extraction, deal-address/entity
matching, the "LCC Create Outlook Draft" flow, `activity_events`, and cadence/critical-date reminders. Nothing
net-new in the plumbing; it's a new detection + generation lane on top.

## The trigger chain (six stages)

### 1. Detect an offer (on the existing intake)
Every inbound email already lands in `staged_intake_items` (the Hardened intake flow). Add an **offer
classifier** on that stream — an email is a candidate offer when it matches signals like:
- an attachment whose name matches `/l\.?o\.?i|letter of intent|offer/i` (e.g. "Signed LOI Davita.pdf"), **or**
- body text matching `/letter of intent|\bLOI\b|intent to purchase|offer to purchase/i`, **and**
- it's from an **external** sender (not an internal/team address), **and**
- it resolves to one of **our active listings** (stage `listing_signed` / on-market) — see stage 3.

Precision matters (don't misfire on chatter): require the attachment/subject signal **plus** a listing match
before promoting to "offer received."

### 2. Extract the salient terms
Run the LOI attachment through document extraction (extend the existing OM-extraction path to an **LOI profile**)
to pull the merge-schema fields:
`purchaser`, `buyer_broker`, `purchase_price`, `price_structure` (cash vs. new financing), `dd_days`,
`emd_amount`, `closing_days`, `psa_responsibility`, `title_escrow`, `buyer_broker_commission`, `expiration`.
Keep a raw-text fallback + confidence flags; anything low-confidence renders as `[verify]` in the draft rather
than a wrong number. (For Snellville these parsed cleanly: $4.2M = $1.68M cash + $2.52M new first TD, 45-day DD,
15-day close, $125K deposit, seller prepares PSA, seller's-choice title, 2.5% buyer-broker, expires 7/31 5pm PDT.)

### 3. Match to the listing (+ resolve the seller)
Match the property named in the LOI to the active-listing entity using the deal-address / entity resolution we
already built (addr_key + tenant + city). On a unique match, pull the deal's `seller_of_record` and seller
contact for the addressee. **Gap to close:** the LCC deal record is currently sparse (no seller-of-record /
contact / asking / NOI stored on `bd_opportunities`). Populate those on listing signing (from SF or the listing
packet) so the addressee and any future analysis have a source. Until then, the draft leaves `[Seller contact]`
as a marked blank.

### 4. Generate the facts-only submission email
Populate the **Offer Summary Submission** template (new — register in the template library) from stages 2–3:
- Subject: `Offer Received — {property_tenant}, {address}, {city}, {state}`.
- Body: one-line "we've received a signed LOI," the salient-terms bullet list (verbatim facts, no editorializing),
  and a **call-to-action to discuss by phone**. No opinion, cap-rate comparison, or recommendation in writing.
- Signature: Scott Briggs / Northmarq (merge default).
- Attach the executed LOI.

### 5. Deliver as a draft — never auto-send
Create the email as an **Outlook draft in Scott's mailbox** (reuse `LCC Create Outlook Draft`), addressed to the
seller contact, LOI attached. Scott reviews, adjusts the call-to-action window, and sends. This is a
permission-required action (sending on the user's behalf) — the automation stops at the draft.

### 6. Log & track
On "offer received":
- Write an `activity_event` on the deal entity (`category: note`, source `offer_intake`) capturing the terms.
- Advance the deal to an **`offer_received`** substage (or a flag) so the pipeline reflects it.
- Create a **To-Do**: "Review & submit offer to seller — {tenant} {city} (expires {expiration})".
- Register the **expiration as a critical date** in the cadence engine so it surfaces in the briefing and pings
  before 5:00 PM 7/31-type deadlines. Store the LOI in the deal's document set.

## Follow-on: the Seller Response (counter) — on request only
Once the seller decides (by phone), a second, explicit step drafts the **Seller Response to LOI** from
`Seller_Response_TEMPLATE.docx` — the buyer-facing counter, populated with the seller's authorized terms. This is
**not** auto-generated at intake; it's triggered when Scott asks (or checks off "seller authorized response"),
because it carries the seller's negotiating position (verbal → written only when directed).

## Build order (proposed)
1. **Template:** register "Offer Summary Submission (Seller)" in the template library (facts-only body + call-to-action).
2. **Classifier + LOI extraction:** offer detection on `staged_intake_items` + the LOI extraction profile.
3. **Listing match + seller fields:** wire the match to active listings; backfill `seller_of_record`/contact on
   `bd_opportunities` at listing signing (closes the stage-3 gap).
4. **Draft + log:** Create-Outlook-Draft + `activity_event` + To-Do + critical-date on match.
5. **Seller Response (on-request)** generator from the existing template.

## Guardrails
- **Facts-only in writing; strategy on the phone.** The generated email never contains opinion, valuation
  comparison, or recommendation. (Seller-decision terms live in the on-request Seller Response, drafted only when directed.)
- **Draft, never auto-send.** Human review before anything leaves the mailbox.
- **Confidence-gated extraction.** Low-confidence fields render as `[verify]`, never a guessed number.
- **Precision-gated detection.** Requires an LOI signal **and** an active-listing match before firing.
