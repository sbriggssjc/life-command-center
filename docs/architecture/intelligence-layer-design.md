# LCC intelligence layer — design (2026-07-31)

The plumbing is done: My Day surfaces the right work (to-dos, active deals, cadence
touchpoints, pipeline), ownership self-heals, and to-dos self-update from correspondence.
The **intelligence layer** makes each item *smart and specific* — not "Confirm marketing
launch" but "Buyer countered $4.2M, 20 days DD — respond by Fri." This doc designs that layer
on top of what exists, with a recommended build order.

## Principle
Intelligence = **read the latest context, decide the sharpest next action, rank by impact.**
Everything routes through the existing AI seam (`invokeExtractionAI` → cloud today, GaryBuilt
Ollama later) and writes back through the engines we already have (`lcc_advance_todos`,
`action_items`, the reconciliation override). No new surfaces — smarter content in the ones built.

## Components (composable; each stands alone)

### 1. Role-aware next-step engine  ✅ **BUILT (2026-07-31) — ships on next redeploy**
Today `deriveNextStep` (next-step-ai.js) is **seller-framed**: its intents map to
seller_follow_up / review_counter / advance_to_contract. Generalize to the correspondent's
**premise** relative to the deal — seller, buyer, cooperating broker, or other — and frame
intents + action types per role:
- **seller** (current): needs_time→seller_follow_up, counter→review_counter, accepted→advance_to_contract, pass→log_pass.
- **buyer**: interested→send_om/schedule_tour, needs_time→buyer_follow_up, made_offer→review_offer, wants_info→send_info, passed→log_pass.
- **broker**: sent_listing→review_listing, wants_bov→prep_bov, intro→qualify_relationship.

Premise is resolved deterministically from the entity graph via **`lcc_party_role(party, deal)`**
(`sells`/`owns`→seller, `purchases`→buyer, `brokers`→broker, else other), defaulting to seller.
`next-step-ai.js` gained `intentMapFor(premise)` — the same premise-neutral intents map to
role-appropriate action types/verbs (buyer_follow_up / review_offer vs seller_follow_up /
review_counter). `logInboundCorrespondenceDualAnchor` resolves the premise and passes it to
`deriveNextStep`; `lcc_advance_todos` already accepts the derived title/type (Phase 1), so no DB
change there. 25 unit tests green. **Built; live on next redeploy** (`lcc_party_role` already
applied). Directly serves the buy-side relationships (Boyd Watterson, Easterly) in touchpoints.

### 2. Content-aware deal next-steps
The deal-stage engine writes a generic line per stage. When a deal *has* recent activity
(the ~11 with spine coverage today, growing as ingestion improves), read the last touch +
offer context and write the specific action instead: LOI-executed with "DD ends 8/14" →
"Confirm DD waiver & schedule closing call by 8/12." Same `title` field, gated on having
content; deterministic stage line is the fallback. Composes with #1's `deriveNextStep`.

### 3. Cadence content-awareness ("what to say")
Cadence surfaces *who* to touch and the channel; add *why now / what to say* from the
contact's engagement (last outcome, deals transacted, preferred channel, best time) + any
relevant new listing. Turns a touchpoint row into a ready-to-act prompt. Uses `contact_engagement`
(rich today) — not blocked by the deal coverage gap.

### 4. Deal-health / risk scoring  ✅ **BUILT & LIVE (2026-07-31)** — `lcc_deal_health(owner, limit)`
A per-deal 0–100 risk score from signals we already compute, with plain-English reasons:
past expected_close_date (+40), late-stage (LOI/non-refundable) & quiet >7d (+30), listing
quiet >14d (+15), no logged activity (+10), aged >180d in early stage (+10). Owner-scoped via
the reconciliation override. First run: 6 at-risk — led by DaVita Portfolio 4 (risk 70: LOI,
15d past close & quiet), then off-market listings 276–703d past close (data-cleanup / re-engage).
**Next:** fold `risk_score` + `reasons` into `lcc_my_day` active_deals so My Day leads with deals
in trouble; tune weights from observed accuracy. Pure-DB + tunable; mirrors the evidence pattern.

### 5. Local-model execution (GaryBuilt)
All of the above run through the AI seam. Once GaryBuilt/Ollama is stood up (playbook shipped
earlier), these background AI tasks — extraction, next-step derivation, cadence drafting — move
on-prem at zero cloud cost, cloud staying the fallback. No redesign; a config flip per the
`ollama` seam already in `ai.js`.

## Recommended build order
1. **Role-aware next-step engine** — bounded, extends live code, immediate buy-side value.
2. **Deal-health / risk scoring** — pure-DB, makes My Day lead with deals in trouble, not blocked by coverage.
3. **Cadence content-awareness** — leverages rich `contact_engagement`, high daily-driver value.
4. **Content-aware deal next-steps** — best after the ingestion coverage deep-dive lands.
5. **Shift execution to GaryBuilt** — when the box is up; config-only.

## Doctrine (unchanged)
Deterministic-first (AI only escalates the ambiguous tail), never-block (AI failure → generic
fallback), provenance-tagged (every AI-derived field stamped), reversible, honest confidence.
