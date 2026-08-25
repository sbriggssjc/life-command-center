---
name: offer-submission
description: >-
  Prepare a Team Briggs / Northmarq seller offer-submission from an inbound buyer LOI on one of our listings.
  Use whenever an LOI / Letter of Intent / offer to purchase is received (email + PDF) on a property we have
  listed, or when Scott says "submit this offer to the seller" / "draft the offer submission" / "LOI came in on
  [property]". Produces the branded HTML submission email (highlights + quartile analysis + factual buyer/broker
  diligence), saved as a DRAFT in the Drafts folder with the LOI attached, filed to the deal folder, and logged in
  the LCC. Strategy stays verbal — never put recommendations in writing. Also drafts the Seller Response (counter)
  ONLY when explicitly asked, after the seller call.
---

# Offer Submission (LOI → Seller)

The inbound-offer cycle: **LOI received → context assembled → seller submission email (draft) → seller call →
Seller Response (counter, on request).** This skill covers everything through the submission draft. Any chat
surface (Claude, ChatGPT, Copilot) runs the same steps and produces the same output.

## Inputs
- The **LOI** (PDF/email) — required.
- The **deal** — a property name/address (e.g. "DaVita Snellville" / "2155 Main Street East"). If not given, infer
  from the LOI subject/body.
- The **OM** — only if the LCC doesn't already have the listing economics (the context call reports this).

## Steps

### 1. Assemble deal context (one call)
Call **`lcc_offer_context(<deal>)`** (OPS RPC / MCP). It returns: `deal` (entity, address, city, state),
`seller_owner`, `correspondents[]` (external emails seen on the deal, most-recent first, with sample subjects),
`economics` (ask/NOI/cap or null), `documents[]`, and **`gaps[]`**. This is the connectivity layer — do not
hand-hunt for context; start here.

### 2. Resolve the seller contact — never guess
- Prefer `seller_owner` + its active owner-contact when present.
- Else pick from `correspondents[]` the **owner/seller side**, distinguishing it from buyer-side brokers, the
  tenant (DaVita), photo/vendor emails, and us. The seller thread reads like seller comments / BOV / pricing (e.g.
  "Voicemail – [Tenant] – [City]"); buyer-side reads like OM requests. If two plausible seller contacts remain,
  confirm with Scott — do not guess. _(Snellville → **Frank Meyrath, VP, RCG Ventures — frankm@rcgventures.com**.)_
- The owner is the SELLER; the tenant name is not the seller. (Snellville: RCG Ventures owns; DaVita is the tenant.)

### 3. Extract LOI terms
From the LOI PDF: purchase price, deposit, **DD period + commencement trigger**, financing (structure + any
contingency/termination right), close timeline, broker + commission, title/escrow designation, 1031 language,
expiration, and any non-standard terms. Confidence-gate — render an uncertain field as `[verify]`, never a guess.

### 4. Get listing economics
Use `economics` from step 1. If `gaps[]` includes `economics_missing`, ask for / open the **OM** (attached or in
the deal folder) and extract **ask price, in-place NOI, ask cap, lease structure, seller-of-record**. Verify every
number against the OM before use. _(Snellville OM: ask $4,513,274 · NOI $255,000 · cap 5.65%.)_

### 5. Buyer + broker diligence (facts only)
Salesforce (prior offers/closings under the buyer entity + broker) and web (buyer principal, 1031 status, equity
source, portfolio; broker firm + track record). Write factual paragraphs — entity, principal, 1031/motivation,
financing, notable term facts — with `[SALESFORCE: confirm …]` inline where CRM confirmation is needed. No opinion,
no recommendation. Resolve/remove all `[SALESFORCE]` placeholders before the draft is finalized for sending.

### 6. Quartile analysis
```
Spread = Ask − Offer ; step = Spread ÷ 4
Lower = Ask − step ; Middle = Ask − 2·step ; Upper = Ask − 3·step
Cap(row) = NOI ÷ Price ; Cap Difference = Cap(row) − Cap(Ask)
```
Negative dollar variances in red; credit-structure deals run against net proceeds to seller; portfolios show
blended cap + per-asset breakdown.

### 7. Build the branded email (Northmarq work-product brand)
- **Brand tokens** (`cm_brand_tokens.json`): `nm_navy #003DA5` header rows / label column (white bold),
  `nm_pale #E0E8F4` zebra, `nm_bg_alt #E7E6E6` borders, Calibri; negatives `#C00000`.
- **Subject:** `LOI: [Tenant] - [City], [State] ([Buyer])` (e.g. `LOI: DaVita - Snellville, Georgia (Alexander Frid)`).
- **Body:** branded header (NORTHMARQ + "Offer Submission" + property identity) → `[First],` → `Good [morning/
  afternoon]. I hope all is well.` (fill-in, never auto-selected) → "Please see the attached Letter of Intent for
  the acquisition of your [City], [State] project…" → **highlights table** (Price, Cap Rate, Deposit, Due Diligence
  (trigger), Financing, Close, Broker — co-op phrased `Co-Broker (Buyer Broker Requesting X%)`) → quartile
  **analysis table** → **buyer paragraph** (+ 1031/motivation when known) → **broker paragraph** → close offering a
  **response strategy** + call, noting the expiration → **Tulsa signature block**.
- **Recipients:** To = resolved seller contact; **BCC Sarah Martin**; **CC James Gibson only on DaVita/Genesis-owned
  deals** (not universal — confirm by owner).
- **Signature:** the **full new-email block** — `docs/os/voice/signatures/signature-full.html` (the canonical
  stored asset; P126). Northmarq · Scott Briggs · Senior Vice President · Commercial Investment Sales ·
  D (918) 794-9787 · sabriggs@northmarq.com · 6120 S. Yale Ave., Ste. 300, Tulsa, OK 74136 · **service-line
  tagline = "Commercial Real Estate | Debt + Equity | Investment Sales | Loan Servicing | Fund Management"**
  (measured 2026-08-25 off his sent mail — this line previously read "service-line tagline", a placeholder
  that resolved to no literal anywhere) · northmarq.com. ⚠️ This is the FULL block, correct for an offer
  submission (a new thread). His **reply** block is the compact one and carries **no address** — do not apply
  this description to a reply.

### 8. Deliver as a DRAFT — never auto-send
Save to the **Drafts folder** (via `LCC Create Outlook Draft`): branded HTML body, resolved recipient, BCC Sarah,
High importance, **the buyer's executed LOI PDF attached exactly as received**. Stop there — Scott reviews and sends.

### 9. File the record
File the submission + the LOI into the deal's folder in Team Briggs – Documents (SharePoint) — the same folder as
the OM/listing docs — via **`POST /api/property-doc-writeback`** `{ domain, property_id, file_name, doc_type,
content_base64 }` (base64 each file). This is the ONE filing mechanism: it resolves the destination folder
confidently or **REFUSES** (never a guessed write), `[LCC]`-tags the name, dedupes (never overwrites), uploads,
links the `property_documents` row, and records provenance. Resolve `domain` + `property_id` for the listing from
the deal (the offer-context packet / the asset's domain identity). On `422 folder_unresolved`, skip the file leg
(non-fatal) and note it — do not write to a guessed path.

### 10. Log in the LCC (+ Salesforce) — one call
Call **`lcc_log_offer(deal, offer)`** (RPC / `/api/pipeline/offer-log`): it writes the `activity_event` (offer
received), creates the review **To-Do** in `action_items` due on the offer expiration, and enqueues the Salesforce
**create_task** ("Offer Received — Pending Seller Response") to `sf_sync_queue`. Idempotent. Pass `offer` with an
ISO `expiration_date` (for the To-Do due date) plus the display fields.

## Standing rules
- **Facts-only in writing; strategy on the call.** No recommendation/counter number in the submission email.
- **Draft, never auto-send.** Human review before anything leaves the mailbox.
- **Never send with `[morning/afternoon]` or `[SALESFORCE]` placeholders live.**
- **Verify every number against the OM.** Flag non-standard terms in the body, not buried in the attachment.
- Escrow is fixed: **First American Title, Denver (Annie Arnwine)**; a buyer-designated alternative is a flagged conflict.
- "Stan Johnson Company" → **"Northmarq"** everywhere.

## Output contract (same on every surface)
1. A **Drafts-folder** email (branded, LOI attached, resolved recipient). 2. The submission + LOI **filed** to the
deal folder. 3. An **LCC offer log** + To-Do + expiration critical date (+ SF record). A surface that can't do one
leg (e.g. no mailbox connector) still returns the artifact and queues the rest.

## Graceful degradation (from `gaps[]`)
- `economics_missing` / `documents_missing` → request/open the OM, extract, proceed.
- `no_external_correspondent` or ambiguous seller → ask Scott for the seller contact.
- Low-confidence LOI fields → `[verify]`, never a guessed number.

## Follow-on (on request only)
After the seller call, draft the **Seller Response (counter)** from the seller's authorized terms — DDP form
(`DDP_LOI.docx`, seller = Genesis KC Development) for DaVita/Genesis deals, else the standard Seller Response form
(seller-of-record from the deal, e.g. RCG Ventures). Not produced at intake.

## Toolchain
`lcc_offer_context(deal)` (context assembler) · LOI/OM PDF extraction · Salesforce + web diligence · brand email
builder (`cm_brand_tokens.json`) · stage LOI → `intake-salesforce-files?action=upload-url` (signed URL) ·
`createOutlookDraftViaPA({to,bcc,subject,body_html,attachment_url})` → **Drafts** · file submission+LOI via
`POST /api/property-doc-writeback {domain,property_id,file_name,doc_type,content_base64}` → **deal folder**
(resolve-or-refuse · [LCC]-tag · dedupe · DB-link · provenance) · `log_offer(deal,offer)` (`/api/pipeline/offer-log`)
→ activity + To-Do + generic SF Task.
_(Deploy/PA wiring: `offer-submission-DELIVERY-LEGS.md` + `…DEPLOY-1.1-and-2.2.md`.)_
