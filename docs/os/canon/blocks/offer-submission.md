### Offer Submission (inbound LOI → seller)
A buyer LOI/offer on one of our listings runs the offer-submission flow (never ad-hoc): 1) `get_offer_context` /
`lcc_offer_context(<deal>)` — deal, seller-of-record + contact, economics (ask/NOI/cap), documents,
correspondents, `gaps[]`; start here, never hand-hunt. 2) Resolve the SELLER (owner, never tenant); owner-side
correspondent over buyer brokers/vendors; two plausible → ask, never guess. 3) LOI terms confidence-gated
(`[verify]`, never a guessed number). 4) Quartile analysis (Ask−Offer in four steps; negative variances red).
5) Branded Northmarq submission — facts only (highlights + quartile + factual buyer/broker diligence); NO
recommendation or counter number in writing. 6) Deliver as DRAFT via `createOutlookDraftViaPA` — executed LOI
attached, High importance, **BCC Sarah Martin**, **CC James Gibson only on DaVita/Genesis-owned deals**; never
auto-sent. 7) File submission + LOI to the deal folder via `property-doc-writeback` (resolve-or-refuse,
`[LCC]`-tagged, never overwrite). 8) `log_offer` — full detail in LCC (activity + review To-Do due at offer
expiration); Salesforce gets only a GENERIC Task ("Offer Received — Pending Seller Response"), never
buyer/price/cap/terms. Strategy stays verbal; the Seller Response (counter) is drafted ONLY when explicitly
asked, after the seller call.
