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
| **Subject** | `LOI: [Tenant] - [City], [State] ([Buyer])` — as-sent standard (tenant included, full state name), e.g. `LOI: DaVita - Snellville, Georgia (Alexander Frid)`. Portfolio: `Portfolio LOI: [City, ST] + [City, ST] ([Buyer])` |
| **To** | **The seller contact resolved from the deal** — the LCC correspondence graph (who we've actually been emailing on this project) + the listing owner record — **never a hardcoded default**. (Snellville → **Frank Meyrath, VP, RCG Ventures, LLC · frankm@rcgventures.com**, pulled live from the deal's email thread. Note: the owner/seller is RCG Ventures — DaVita is only the tenant; do not assume DaVita/Genesis contacts from the tenant name.) |
| **CC** | James Gibson <jgibson@northmarq.com> — on **DaVita/Genesis-owned** deals (relationship-specific; the RCG-owned Snellville send had **no CC**). Confirm per owner — not universal. |
| **BCC** | Sarah Martin <smartin@northmarq.com> — standard. |
| **Importance** | High |
| **Attachment** | **The buyer's executed LOI PDF, exactly as received** (Scott forwards the signed LOI itself — e.g. `Signed LOI Davita .pdf`). A generated `Offer_DaVita_[City]_[ST].doc` is the **counter / Seller Response** artifact, not the initial submission. |
| **Signature** | The **full new-email block**, stored verbatim at `docs/os/voice/signatures/signature-full.html` (P126) — Northmarq / **Scott Briggs · Senior Vice President · Commercial Investment Sales** · D (918) 794-9787 · sabriggs@northmarq.com · 6120 S. Yale Ave., Ste. 300, Tulsa, OK 74136 · service-line tagline **"Commercial Real Estate \| Debt + Equity \| Investment Sales \| Loan Servicing \| Fund Management"** (measured 2026-08-25; previously written here as an unresolved "service-line tagline" placeholder) · northmarq.com. **(Tulsa office is the current block — supersedes the NY address in the old project reference.)** ⚠️ **This describes the FULL block only.** Scott's **reply** signature is a separate, compact block with **no address** — measured over 592 sent messages, his top-posted reply block carries the street address 0 times. Never apply this row to a reply. |

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
8. **Close** — offer to discuss a **response strategy** and invite a call. **(Strategy lives here — verbal, not written.)**
9. **Signature block** — the Tulsa Northmarq block above. (The `CC: James Gibson` line only on DaVita/Genesis deals.)

_Broker-row phrasing (as-sent): frame co-op as `Co-Broker (Buyer Broker Requesting X%)` when the commission is the
buyer-broker's ask rather than a settled term. Buyer paragraph includes 1031/motivation when known (e.g. "closed on
the relinquished property; must identify replacement by [date]"). No `[SALESFORCE]` placeholders survive to the
final — they're resolved or removed before the draft is saved._

### Styling (email HTML) — unified Northmarq brand (updated 2026-07-29)
Adopt the **Northmarq Capital Markets brand layer** (`public/reports/cm_brand_tokens.json`) that the Excel/PDF work
products share, so the email reads as one system with them — not the old plain-gray table spec:
- **Font:** Calibri Light / Calibri (brand deliverable standard), 11pt body, line-height 1.15.
- **Palette:** `nm_navy #003DA5` (header rows / label column fill, white bold text; subject line), `nm_pale #E0E8F4`
  (table zebra / value fills), `nm_bg_alt #E7E6E6` (thin table borders / dividers), `nm_text #191919` (body),
  `nm_text_muted #666666` (footnote/source), `nm_blue_mid #265AB2` (the deliberate fill-in tint). Negative
  variances in accounting red `#C00000`.
- **Shared grammar:** branded header (NORTHMARQ wordmark + "Offer Submission" label + subject-property identity
  block in `nm_navy`), the standard table style (navy header row, pale zebra, thin borders, right-aligned
  numerics), and a muted **footer band** (prepared-by + source attribution + non-binding disclaimer).
- Portfolio asset table keeps the `nm_navy` header fill + bordered total row. _(Realized in
  `Offer_Submission_Snellville_DaVita.html` — the format-standard reference.)_

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
6. **Save as an Outlook draft in the Drafts folder — never auto-send** (reuse `LCC Create Outlook Draft`): the
   branded HTML body, To = the resolved seller contact, BCC Sarah Martin (CC James Gibson only on DaVita/Genesis
   deals), High importance, **the buyer's executed LOI PDF attached** exactly as received. It lands in Scott's
   Drafts folder ready to review and send — nothing leaves the mailbox automatically.
7. **Save to files** — write the generated submission (and the LOI) to the **deal's folder in Team Briggs –
   Documents (SharePoint) / ShareFile**, the same folder the OM/listing docs live in, so the record is filed where
   the team expects it.
8. **Log/track in LCC + SF** — `activity_event` on the deal + advance to `offer_received`, create the review To-Do,
   register the LOI **expiration as a critical date** in cadence, link the LOI to the deal doc set; Salesforce offer
   record ("Offer Received — Pending Seller Response").
9. **Seller Response (on request)** — generate the DDP/standard counter from the seller's authorized terms.

## Built 2026-07-29 — context assembler + skill (rolled into the build)
- **`lcc_offer_context(deal)`** (OPS RPC, live; final `…_lcc_offer_context_v31.sql`) — the one connectivity call.
  Reads the **deal record first** (`bd_opportunities.metadata.listing` economics + `.seller` of-record/contact,
  captured at listing-signing), with `bov_extraction` + the correspondence graph as fallbacks; returns `deal`,
  `seller`, `seller_owner`, `economics`, `correspondents[]`, `documents[]`, and `gaps[]`. Multi-token resolver
  ("DaVita Snellville" matches by city). **Snellville now returns a complete, deterministic packet** — seller
  RCG Ventures / Frank Meyrath, economics ask $4,513,274 / NOI $255,000 / cap 5.65% — with only `documents_missing`
  left (OM not yet folder-indexed). The fragmented seller thread (attributed to *people's* timelines — Ryu, Brigham,
  Largent — not the deal) is bridged by city; those are people, not deal fragments, so they are **not** merged.
  **All human/PA/SF/SharePoint/deploy pieces to make this self-serve are in `offer-submission-SETUP-RUNBOOK.md`.**
- **`offer-submission` skill** (`offer-submission-SKILL.md`) — surface-agnostic; consumes `lcc_offer_context`, runs
  steps 1–10, degrades on `gaps[]`. Delivered for install; roll into the plugin/skill set.

### Connectivity gaps to close (so the packet fills without manual OM)
Found while grounding — the plumbing tables exist but this listing wasn't fully ingested:
1. **Entity reconciliation.** The seller thread lives on sibling entities, not the listing's deal entity — the
   assembler bridges by city today, but the reconcile engine should MERGE them so the deal is one entity.
2. **Economics + owner link.** No `lcc_cre_properties` row / `bov_extraction` for the listing → capture ask/NOI/cap
   + `owner_entity_id` (RCG) at listing-signing (SF + OM extraction), which also makes seller resolution deterministic
   (owner → active contact) instead of correspondence-heuristic.
3. **Document indexing.** The OM isn't in `sharepoint_documents` → point the folder-feed at the Team Briggs –
   Documents folder for the listing and index/link the OM/lease/PSA to the deal entity.

## Cross-surface invocation — one process, any chat (Scott's directive 2026-07-29)
The whole flow above must be a **single canonical LCC capability**, not a Claude-Project-only script, so that **any**
chat surface — Claude (Cowork/personal), ChatGPT, Copilot — can pick up "here's an LOI on our Snellville listing"
and produce the **same** output: the branded submission drafted, **saved to the Drafts folder**, the files **saved
to the deal folder**, and the offer **logged in the LCC**. Realize it as:
- **An LCC skill + MCP endpoint** (`offer-submission`) that takes `{deal | property, LOI file}` and runs stages 1–8,
  reusing the shared pieces: entity/deal match, correspondence-graph contact resolution, the analysis generator, the
  brand-token email builder, `LCC Create Outlook Draft` (→ Drafts), the folder-feed writer (→ Team Briggs Documents),
  and the `activity_events`/To-Do/critical-date loggers. One implementation; every surface calls it.
- **Surface parity via the canon.** Register the capability in `docs/os/surfaces/*.canon.md` so each surface
  (claude-cowork, chatgpt, copilot, northmarq) advertises the same command and output contract — same draft, same
  filing, same log, regardless of where the request is typed.
- **Deterministic output contract:** (a) a Drafts-folder email (branded, LOI attached, resolved recipient); (b) the
  submission + LOI filed to the deal folder; (c) an LCC offer log + To-Do + critical date. A surface that can't do
  one leg (e.g. no mailbox connector) still returns the artifact and queues the rest.

## §7 — Auto-context assembly (make it self-serve — Scott's directive 2026-07-29)
The single biggest lever: **a chat working an inbound offer should already have the listing context, without Scott
attaching the OM.** When LCC recognizes the subject is one of our listings (stage `listing_signed`/on-market), it
should auto-assemble and hand the generator:

- **Seller contact — resolved, not guessed.** Pull who we've actually been corresponding with on the deal from the
  **LCC correspondence graph** (`activity_events` + contact/entity resolution) and the listing owner record, and use
  that as the addressee. _(Verified live for Snellville: the graph already held the full email thread with **Frank
  Meyrath, VP, RCG Ventures, LLC — frankm@rcgventures.com**, incl. his Atlanta signature block — so the process
  addresses the seller correctly with zero guessing. It also surfaced a second RCG contact, Mike McMillen. Gap: his
  email wasn't yet promoted onto the deal's contact roster — link it so the generator reads it directly.)_
- **Listing economics** — ask price, in-place NOI, ask cap, $/SF, tenant/guarantor, lease structure (term
  remaining, escalations, expiration, options), seller-of-record + seller contact. Source: the **Salesforce listing
  record** (primary) + the OM. _(Verified for Snellville from the uploaded OM: ask **$4,513,274**, NOI **$255,000**,
  cap **5.65%**, 8,260 SF, Honey Dialysis LLC dba DaVita / guarantor DaVita Inc. NYSE:DVA (S&P BB), NNN, 14 yrs to
  3/31/2040, ~10% every 5 yrs. None of this was on the LCC deal record — exactly the gap.)_
- **Linked deal files** — the **Offering Memorandum** and listing documents from the **Team Briggs – Documents**
  shared folder (SharePoint) and Salesforce Files, linked to the deal entity so any chat/skill can open them. This
  reuses the folder-feed + `intake-salesforce-files` backfill we just fixed — point it at the listing's folder and
  index the OM/PSA/lease/DD docs against the deal.

**How to close it (build):**
1. **Populate the deal record at listing-signing** — when a deal reaches `listing_signed`, write ask/NOI/cap/lease/
   seller-of-record/seller-contact onto `bd_opportunities` (from the SF listing + OM extraction). One-time per listing.
2. **Link the listing document set** — index the Team Briggs – Documents folder for the property (OM, lease, PSA, DD)
   + SF Files against the deal entity, so the offer generator (and any chat) pulls the OM automatically.
3. **Expose a "deal context packet"** — a single call that returns the listing economics + linked files for a deal,
   so both the automation and an interactive chat start with full context instead of a blank slate + manual upload.

Until (1)–(2) land, the generator falls back to marked fill-ins (`[OM ASK]`/`[NOI]`/recipient). With them, the
Snellville-style email drafts end-to-end from the moment the LOI lands.

_Grounding note: the OM confirms the standard DaVita brokerage team (Scott Briggs SVP, Kelly Largent VP, Nathanael
Berwaldt Associate, Sarah Martin Sr. Transaction Manager; GA broker Brett Butler; Capital Markets Chad Owens / Mason
Brower) and seller-side facts — this is the context that should attach automatically._
