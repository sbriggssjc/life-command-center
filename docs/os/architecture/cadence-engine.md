# Cadence Engine — stage-aware pipeline monitoring
_Design straw-man, 2026-07-27. **Red-line the numbers** — they encode Scott's description and are meant to be edited._

## Two layers, one engine
- **Account layer (pre-deal / BD):** prospecting + nurture on accounts/contacts. Cadence-driven, tier-weighted.
- **Deal layer (SF Opportunity):** the six SF stages. First two are cadence-driven; the rest are contractual.

The engine computes, for every account and deal: its **state** → the applicable **cadence rule** → the
**next-action-due date** (= last relevant touch + interval) → **type** (email/call/VM/update) → **owner**
(us by default; a broker for production tasks) → **flag** (on-track / due / overdue). That feeds the weekly email.

## State → cadence map (STRAW-MAN — edit freely)

### Account layer (BD / nurture) — tier-weighted, ~4 touches/account/year average
| State | Who | Cadence (straw-man) | Types | Exit |
|---|---|---|---|---|
| **New prospect** (first ~6 mo) | any new account | **7 touches in 6 mo, increasing gaps**, alternating: day 0, +5, +12, +25, +45, +70, +100 | email ⇄ voicemail | a response/contact, OR a call-to-action, OR 7 done |
| **Nurture — Tier A** (top ~20%) | high value/engagement | ~**monthly** (every ~30d) | email/call mix | call-to-action |
| **Nurture — Tier B** (middle ~60%) | mid | ~**2×/year** (every ~180d) after the first 7 | email/call | call-to-action |
| **Nurture — Tier C** (bottom ~20%) | low engagement | **attrition review** — flag, no active cadence | — | attrition or re-tier |
| **Call-to-action active** | buy need / comps req / BOV req | accelerated, context-driven | context | converts to a BOV/deal or returns to tier |

### Deal layer (SF Opportunity stages)
| Stage | Regime | Cadence (straw-man) | Owner | Exit |
|---|---|---|---|---|
| **BOV** (post-delivery follow-up) | cadence | call @ delivery → email +7d → call +7d → email +14d → … increasing, alternating, until feedback | us | feedback → drives toward ELA |
| **ELA** (broad marketing) | cadence | **Seller:** update email every **14d** (unless seller asks for more). **Investors:** **weekly** outreach batch — expand audience by priority order, revisit at logical increments | us / broker | LOI Executed |
| **LOI Executed** | contractual | milestone/date (dossier checkpoints); satisfied by received emails | dates/parties | In Escrow |
| **In Escrow** | contractual | milestone/date | dates/parties | Non-Refundable |
| **Non-Refundable** | contractual | milestone/date | dates/parties | Closed |
| **Closed** (+ beyond) | nurture | back to account-tier cadence | us | — |

## Ball-in-court rule (from Scott)
**Default = OUR court until a response arrives.** The next action is owed on the timing the state's cadence
(or the contract) calls for. So the engine's core job in cadence mode is: "given last touch + state cadence,
when is the next touch due, and is it overdue?" A **production task** (produce the BOV, produce marketing) sets
owner = the assigned **broker** (internal) instead of an outbound touch. A party's inbound response advances/resets
the cadence (their turn processed → recompute).

## What the engine reads (all exists)
- **State:** SF Opportunity stage (mirrored to LCC) for deals; account cadence-phase for pre-deal.
- **Touch history + last-touch:** `activity_events` (calls/emails) + `unified_contacts.last_call_date /
  last_email_date / last_activity_date`; sequence position = count of touches since state entry.
- **Response detection:** inbound `activity_events` (direction) / mail-intake (future) → resets cadence.
- **Tier (A/B/C):** computed from value/engagement (`unified_contacts.total_volume, engagement_score,
  total_transactions, is_1031_buyer`) into 20/60/20 bands — OR a stored tier if you prefer manual control.

## New pieces to build
1. **Cadence rules as data** — this table becomes a `cadence_rules` config (or a `canon/cadence.md` module) so
   the timing is single-sourced and editable without code.
2. **`POST /api/pipeline/cadence-scan`** (engine) — computes next-action-due per account/deal, returns the ranked
   "due/overdue this week" digest (bounded).
3. **Tiering** — a scored 20/60/20 banding over accounts (or a manual tier field).
4. **Weekly pipeline email** — PA recurrence composes the digest grouped by stage; contractual milestones keep
   their own mid-week date/event nudges.
5. **(Phase 3) draft-and-hold** — for a due touch, auto-draft via `DraftOutreachEmail` / `DraftSellerUpdateEmail`
   into Outlook drafts for review; never auto-sent.

## The hard sub-system: investor outreach (ELA broad-marketing)
"Increase the audience every week, hit most-likely acquirers in priority order, revisit at logical increments"
is a **buyer-outreach campaign manager**, bigger than a touch cadence. It ties to the existing
`RunListingBdPipeline` (finds matching contacts) + `GenerateBatchDrafts`. Recommend treating it as its own
Phase-4 module (priority buyer list per listing + outreach-state tracking + revisit scheduling), with the weekly
email showing progress ("N new investors contacted this week, M in queue").

## Build sequence
- **Phase 1** — `cadence-scan` endpoint (deal layer: BOV + ELA-seller + contractual flags) + weekly pipeline email. Notify-only.
- **Phase 2** — account layer (new-prospect 7-touch + tier nurture) + tiering.
- **Phase 3** — draft-and-hold the due touches.
- **Phase 4** — investor-outreach campaign manager for broad marketing.

## Red-lines needed from Scott
1. The **new-prospect 7-touch intervals** (straw-man: 0/+5/+12/+25/+45/+70/+100 days) — adjust to your real spacing.
2. **Tiering** — compute A/B/C from value/engagement (which signals?), or set manually per account?
3. **Post-BOV sequence** exact spacing + when it stops (feedback only, or a max # of attempts?).
4. Whether **In Escrow / Non-Refundable** carry their own standard milestone sets (like the Fresenius PSA timeline) or are purely email-satisfied.
