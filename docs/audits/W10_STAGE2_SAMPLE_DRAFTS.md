# W10 Stage 2 — sample drafts (`/api/draft-assist`) — "does this sound like me?"

> **Read this to judge the VOICE, then flip `DRAFT_ASSIST`.** These three samples show what
> `/api/draft-assist` assembles across draft-types. **Honest note on provenance:** the actual draft prose is
> generated **on-prem** (Ollama on the GaryBuilt box, `invokeOnPremGeneration`) — it cannot be produced in the
> build sandbox (no egress to your box; that's the privacy win). The `body`/`subject` below are **representative
> hand-compositions in the BRIGGS-WRITING-VOICE profile**, showing the shape, terseness, and grounding the live
> endpoint targets. Run the real `GET /api/draft-assist?...` after redeploy to see the model's own text (it
> returns the same JSON shape shown here).
>
> Every sample obeys the doctrine: facts come only from the deal spine ("Not on file" for gaps), no fabricated
> number/date survives the validator, strategy stays verbal, and nothing is sent — GET writes nothing, POST
> saves a **draft**.

---

## Sample 1 — `follow_up` (external, warm) — HIGH-confidence bucket

**Request**
```
GET /api/draft-assist?purpose=follow_up&intent=confirm I got the rent roll, next step is I'll turn the BOV around this week&recipient=broker@example.com&entity_id=<deal-entity-uuid>
```

**Retrieval** — bucket `external_follow_up`, 5 real exemplars (ids cited in the response), e.g. openings like
*"Got it. Tenant does pay for the ground rent. I'll call him and walk him through that section of the lease."* /
*"I am. I'll work to get this tracked down ASAP. Stay tuned."*

**Facts used (from the spine)** — `property_label: Fresenius — Woodland Hills`, `deal_stage: BOV`,
`cap_rate: Not on file`, `parties: seller: <on file>`. **`voice_confidence`:** *"Retrieved 5 real past exemplars
of this draft-type; opening voice is well-supported. Grounded in Scott's sent-email openings (~255-char cap), so
sign-offs lean on the profile."*

**Draft (illustrative)**
```
Subject: Rent roll — got it
Got it, thanks. I have the rent roll. I'll turn the BOV around this week and send it your way.
Stay tuned.
```
*(No cap rate stated — it's "Not on file", so the validator/omission keeps it out. No invented number.)*

---

## Sample 2 — `broker_to_broker` (no deal id — relational, ZERO specific facts)

**Request**
```
GET /api/draft-assist?purpose=broker_to_broker&intent=introduce myself, I cover net-lease medical and would like to trade comps&recipient=agent@othershop.com
```

**Retrieval** — bucket `external_follow_up`, deterministic ranker (no entity → no facts). Exemplars are Scott's
real terse external openings.

**Facts used** — none (no `entity_id`). The endpoint asserts **zero specific facts** — `facts.source:
no_entity_relational`, `not_on_file: []`. **`voice_confidence`:** notes the relational draft rests on the
profile + tone, no deal facts claimed.

**Draft (illustrative)**
```
Subject: Quick intro
Wanted to introduce myself — I cover net-lease medical on the Team Briggs side at Northmarq. Always happy to
trade comps and market color. If you have anything trading in the space, send it over and I'll do the same.
```
*(Contains no price, cap rate, party, or date — a relational note by design. The fact-validator finds nothing to
strip.)*

---

## Sample 3 — `loi_ack` (LOW-confidence bucket — thin corpus, deferred to skill for strategy)

**Request**
```
GET /api/draft-assist?purpose=loi_ack&intent=acknowledge we received their LOI and we're reviewing with the seller&recipient=buyerbroker@example.com&entity_id=<deal-entity-uuid>
```

**Facts used** — `property_label`, `deal_stage: LOI`; price/terms deliberately **not** pulled into the ack
(strategy stays verbal — the offer-submission skill owns the substantive submission). **`voice_confidence`:**
*"This draft-type (loi_offer) is evidence-THIN in the corpus; the profile flags it LOW-confidence — treat the
draft as a starting point."*

**Draft (illustrative)**
```
Subject: LOI received
Received — thanks for getting this over. We're reviewing with the seller and I'll circle back with next steps.
```
*(A factual acknowledgment only. No counter, no recommendation, no numbers — the negotiation stays verbal /
in the offer-submission flow.)*

---

## What to check

1. **Does it sound like you?** Terse, leads with the answer, warm-but-direct, no "Dear", no filler.
2. **Are the facts real?** Every stated fact should trace to the spine; gaps read "Not on file", never invented.
3. **Anything flagged?** `fact_validation.flagged` lists any number/date the model tried to invent (stripped) —
   should be empty on a clean run.

If the voice lands, flip `DRAFT_ASSIST`→on (Cowork) to enable the POST save-to-Outlook-Drafts path. On-prem
generation requires `OLLAMA_URL` set on the Railway service.
