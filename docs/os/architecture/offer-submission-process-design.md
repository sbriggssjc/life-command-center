# Offer Submission Process (LOI → Seller) — design spec (v2, grounded in the live Claude Project)

_2026-07-29. Rebuilt from Team Briggs's actual process docs (`Seller_Offer_Submission_Process.md`,
`LOI_Process_Workflow.md`) and the Succasunna worked example. Supersedes the v1 facts-only-bullets draft — the real
seller submission is a full analytical package (highlights + quartile analysis + factual buyer/broker diligence),
with negotiating **strategy still reserved for the call**. This spec is both the human SOP and the LCC automation target._

## The cycle
**LOI received → analyzed → seller submission email → seller feedback call → Seller Response Form (counter).**
Two deliverables: the **Seller Submission Email** (HTML) and, post-call, the **Seller Response Form** (DOCX). This
doc governs the email; the counter form is governed by the DDP/standard template rules (§6).

## Inputs (three)
1. **The LOI** — price, deposit, DD period **+ commencement trigger**, financing contingency (+ any termination
   right), close timeline, broker/commission, title designation, 1031 language, non-standard terms.
2. **The Offering Memorandum** — **ask price, in-place NOI, ask cap**, seller entity, lease structure. _(Required
   for the quartile analysis — the one input the LCC deal record doesn't yet store; see §7.)_
3. **Buyer's broker cover email** — where 1031 status, equity source, and motivation usually live.
Research is then run against Salesforce (prior offers/closings), buyer + broker web/LinkedIn, CoStar.

## The Seller Submission Email

### Header block
| Field | Standard |
|---|---|
| **Subject** | `LOI: [City], [State] ([Buyer Entity])` (portfolio: `Portfolio LOI: [City, ST] + [City, ST] ([Buyer])`) |
| **To** | DaVita/DDP deals → Michelle Pagnano <michelle.pagnano@davita.com>; Marshall Stewman <marshall.stewman@davita.com> |
| **CC** | James Gibson <jgibson@northmarq.com> — **always** |
| **BCC** | Sarah Martin <smartin@northmarq.com> — as applicable |
| **Importance** | High |
| **Attachment** | `Offer_DaVita_[City]_[ST]_[MM_DD_YY].doc` |

### Body sequence
1. Salutation — first name(s) only.
2. `Good [morning/afternoon]. I hope all is well.` — **left as a fill-in; never auto-selected.**
3. One line: *"Please see the attached Letter of Intent for the acquisition of your [City], [State] project.
   Details can be found in the attached, but highlights are as follows:"*
4. **Highlights table** — rows: `PRICE` · `CAP RATE` (or `BLENDED CAP` on portfolios) · `DEPOSIT` · `DUE DILIGENCE`
   (show trigger in parens, e.g. `30 Days (Execution of PSA)`) · `FINANCING` (if none: `No Contingency Stated`; note
   any termination right) · `CLOSE` · `BROKER`. Non-standard structures get their own rows (gross / seller credit /
   **net to seller**); leasehold adds `GROUND LEASE`, expiration, `RENEWAL OPTIONS`, rent schedule.
5. **Quartile analysis table** — 5 columns (Ask | Lower 25% | Middle 50% | Upper 75% | Initial Offer) × 4 rows
   (Price | Cap Rate | Dollar Difference | Cap Difference):
   ```
   Spread = Ask − Offer ; step = Spread ÷ 4
   Lower = Ask − Spread×0.25 ; Middle = Ask − Spread×0.50 ; Upper = Ask − Spread×0.75
   Cap Rate = NOI ÷ Price ; Cap Difference = row cap − ask cap (bps)
   ```
   Negative dollar variances in **red**; on credit-structure deals run against **net proceeds to seller**;
   portfolios show blended cap + per-asset breakdown.
6. **Buyer background paragraph** — facts only (entity, formation state, principal(s), 1031 status + deadline,
   equity source, portfolio, financing plan, prior visits). Inline `[SALESFORCE: confirm prior offers from …]`.
7. **Broker / track-record paragraph** — name, title, firm profile, prior transactions with our team, prior
   buyer-broker pairings. Facts only; `[SALESFORCE: …]` where CRM confirmation is needed.
8. **Close** — offer to discuss counter strategy, invite a call. **(Strategy lives here — verbal, not written.)**
9. **Signature block** + `CC: James Gibson, Managing Director | Northmarq`.

### Styling (email HTML)
Font `Aptos, Calibri, sans-serif` 11pt, line-height 1.15. Highlights table ~420pt, 1pt `#7F7F7F` borders,
`#F2F2F2` odd-row banding, label column bold+uppercase. Analysis table ~641pt, bold underlined header, `#F2F2F2`
even-row banding, right-aligned numerics. Portfolio asset table `#1F3864` header fill, white bold, bordered total.

## Standing rules (guardrails)
- **Never send with `[morning/afternoon]` or `[SALESFORCE]` placeholders live** — deliberate fill-ins for Scott.
- **Counter fields stay blank until after the seller call.** No strategy/recommendation in the submission email.
- "Stan Johnson Company" → **"Northmarq"** everywhere.
- Escrow is fixed: **First American Title, Denver (Annie Arnwine)**; a buyer-designated alternative is a flagged conflict.
- **Verify every number against the OM before delivery.**
- Flag non-standard terms **in the email body**, not buried in the attachment.

## Filing & logging (Phase 4)
- **ShareFile** — save the sent email + attachment to the deal folder.
- **Salesforce** — log the offer: property, buyer entity, buyer broker+firm, price + cap, key terms, date received,
  status **"Offer Received — Pending Seller Response."**

## Seller Response Form (Phase 5, post-call) — on request only
Drafted after the seller call, with the authorized counter terms. **Template selection:** DDP form (`DDP_LOI.docx`)
for DaVita / Genesis KC Development deals (Seller pre-populated **Genesis KC Development, LLC**); Standard
`Seller_Response_Form.docx` for all other sellers. Counter price expressed as `$X or a Y.YY% cap rate`; DD/EMD/close
per the seller's direction. Not auto-generated at intake — triggered when Scott directs it.

## LCC automation mapping (how each phase becomes automatic)
The intake spine already ingests these emails; this adds a detection + generation lane on top. Maps 1:1 to the
"Future Automation Opportunities" in `LOI_Process_Workflow.md`:
1. **Detect** an offer on `staged_intake_items`: LOI attachment/subject signal **and** a match to an active listing
   (stage `listing_signed`/on-market) **and** external sender. Precision-gated (both signals required).
2. **Extract** LOI terms (extend OM-extraction to an LOI profile) → structured deal terms; confidence-gated
   (`[verify]` on low confidence).
3. **Analysis generator** — Ask + NOI + Offer → the quartile table (deterministic math).
4. **Diligence** — auto-run the Salesforce (prior offers/closings) + web (buyer/broker) lookups, drop results into
   the paragraphs as drafts with `[SALESFORCE: …]` confirmations left for Scott.
5. **Email template engine** — populate the HTML email (header block, highlights, analysis, diligence) from the
   extracted data + merge schema; leave the deliberate fill-ins.
6. **Deliver as an Outlook draft — never auto-send** (reuse `LCC Create Outlook Draft`): To DaVita/DDP contacts,
   CC James Gibson, BCC Sarah Martin, High importance, LOI attached.
7. **Log/track** — `activity_event` on the deal + advance to `offer_received`, create the review To-Do, register the
   LOI **expiration as a critical date** in cadence, save the LOI to the deal doc set; ShareFile + SF logging (Phase 4).
8. **Seller Response (on request)** — generate the DDP/standard counter from the seller's authorized terms.

## §7 — the one data gap to close
The quartile analysis needs **ask price + in-place NOI**, and the seller-of-record/contact for addressing — none of
which are on the LCC `bd_opportunities` record today (verified: Snellville deal metadata is sparse). Capture these on
listing-signing (from SF or the OM/listing packet) so the generator has a source; until then the email leaves
`[OM ASK]` / `[NOI]` and the recipient as marked fill-ins.
