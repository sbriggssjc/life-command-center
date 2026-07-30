### Offer Submission (inbound LOI → seller)
When a buyer LOI/offer arrives on one of our listings, run the offer-submission flow (never ad-hoc). 1) Assemble
context with `get_offer_context` / `lcc_offer_context(<deal>)` — deal, seller-of-record + contact, economics
(ask/NOI/cap), documents, correspondents, and `gaps[]`; start here, never hand-hunt. 2) Resolve the SELLER (the
owner, never the tenant); pick the owner-side correspondent over buyer brokers/vendors; if two are plausible,
ask — never guess. 3) Extract LOI terms confidence-gated (`[verify]`, never a guessed number). 4) Quartile
analysis (Ask−Offer in four steps; negative variances in red). 5) Build the branded Northmarq submission — facts
only (highlights + quartile + factual buyer/broker diligence); NO recommendation or counter number in writing.
6) Deliver as a DRAFT via LCC `createOutlookDraftViaPA` — Drafts folder, the executed LOI attached, High
importance, **BCC Sarah Martin**, **CC James Gibson only on DaVita/Genesis-owned deals**; never auto-sent.
7) File the submission + LOI to the deal folder via `property-doc-writeback` (resolve-or-refuse; `[LCC]`-tagged;
never overwrite). 8) Log via `log_offer` — full detail stays in the LCC (activity + review To-Do due on the offer
expiration); Salesforce receives only a GENERIC Task ("Offer Received — Pending Seller Response"), never
buyer/price/cap/terms. Strategy stays verbal — never put the response strategy or a counter number in writing.
The Seller Response (counter) is drafted ONLY when explicitly asked, after the seller call.
