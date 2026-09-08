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
| **New prospect** (first ~6 mo) | any new account | **7 touches in 6 mo, increasing gaps**, alternating: day 0, 7, 14, 28, 42, 72, 102 (weekly → biweekly → ~monthly) | email ⇄ voicemail | a response/contact, OR a call-to-action, OR 7 done |
| **Nurture — Tier A** (top ~20%) | high value/engagement | ~**monthly** (every ~30d) | email/call mix | call-to-action |
| **Nurture — Tier B** (middle ~60%) | mid | ~**2×/year** (every ~180d) after the first 7 | email/call | call-to-action |
| **Nurture — Tier C** (bottom ~20%) | low engagement | **attrition review** — flag, no active cadence | — | attrition or re-tier |
| **Call-to-action active** | buy need / comps req / BOV req | accelerated, context-driven | context | converts to a BOV/deal or returns to tier |

### Deal layer (SF Opportunity stages)
| Stage | Regime | Cadence (straw-man) | Owner | Exit |
|---|---|---|---|---|
| **BOV** (post-delivery follow-up) | cadence | **RESET the New-Prospect 7-touch clock** (same spacing/rule) at BOV delivery; alternating email/VM until feedback | us | feedback → drives toward ELA |
| **ELA** (broad marketing) | cadence | **Seller:** update email every **14d** (unless seller asks for more). **Investors:** **weekly** outreach batch — expand audience by priority order, revisit at logical increments | us / broker | LOI Executed |
| **LOI Executed** | contractual | build explicit milestone timeline from the LOI terms → dossier checkpoints | dates/parties | In Escrow |
| **In Escrow / Non-Refundable** (PSA / Executed PSA) | contractual | **ALWAYS carry an explicit PSA milestone timeline** (like the Fresenius set); satisfied by received emails/manual | dates/parties | Closed |
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

## The Deal Dossier is the per-deal SPINE (BOV → close)
**Decision (2026-07-27):** every deal gets a Deal Dossier created at **BOV commencement** and maintained through
**closing**, continuously updated by **all email and call activity** in the system. This makes the dossier the
single per-deal substrate that BOTH regimes read:
- **Cadence mode** reads the dossier's activity stream for last-touch / next-action-due.
- **Contractual mode** reads the dossier's milestone timeline (populated explicitly at PSA/executed).

Feeds into the dossier (`activity_events`, projected by `get_deal_dossier`):
- **Calls / manual touches** — `log-activity` (BUILT: writes `activity_events`, SF gets link-only).
- **Emails** — **mail-intake (NOW a near-term dependency)**: inbound/outbound deal-mail distilled into
  `activity_events` so the dossier self-updates and cadence last-touch is accurate. Without it, the dossier only
  sees calls, not email — so this moves up from "future" to **backbone**.
- **Milestones** — at PSA/executed, populate the explicit timeline via `update_deal_dossier`.

Lifecycle: **BOV → create dossier + start 7-touch clock → (feedback) → ELA cadence → LOI/PSA → build milestone
timeline, switch to contractual → Closed → dossier archived, account returns to nurture.**

## Deal backbone already exists: `bd_opportunities`
LCC already models the pipeline: `bd_opportunities` = { `entity_id` (deal), `sf_opp_id`, `stage`, `is_open`,
`amount`, `expected_close_date`, `owner_user_id`, `vertical`, opened/closed_at }. Plus `pipeline_velocity`
(days-in-stage stats). **The table is ready; the SF-Opportunity feed is NOT** — every current row is an
LCC-generated BD prospect (`sf_opp_id` null, non-SF stages, `last_synced_at` null). So the monitor's foundation
is an **inbound SF Opportunity sync** (the mirror of the outbound SF drainer we built):
SF Opportunities (StageName ∈ BOV/ELA/LOI Executed/In Escrow/Non-Refundable/Closed) → upsert `bd_opportunities`
(resolve/create the deal asset entity → `entity_id`; map StageName → `stage`; set `is_open`, `amount`,
`expected_close_date`). An Opportunity hitting **BOV** stage landing here **is** the dossier-at-BOV trigger.

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
- **Phase 1** — (a) **Inbound SF Opportunity sync** → `bd_opportunities` (the dossier-at-BOV trigger + stage feed); (b) `cadence-scan` endpoint reading `bd_opportunities` + `activity_events` (BOV 7-touch reset, ELA-seller-14d, contractual flags); (c) **weekly pipeline email**. Notify-only.
- **Phase 2** — **Mail-intake** (email → `activity_events`) so dossiers self-update from email; PSA milestone-timeline population at executed.
- **Phase 3** — account layer (new-prospect 7-touch + tier nurture) + tiering; draft-and-hold the due touches.
- **Phase 4** — investor-outreach campaign manager for broad marketing.

## Red-lines needed from Scott
1. ✅ RESOLVED — New-Prospect 7-touch = **days 0, 7, 14, 28, 42, 72, 102** (weekly x3 → biweekly x2 → ~monthly x2). Drives BOTH new-prospect AND post-BOV (same reset clock). [Note: 72 & 102 are 30-day steps; if strict same-weekday alignment is wanted, 70 & 98 keep every touch on the anchor weekday.]
2. **OPEN — Tiering**: compute A/B/C from value/engagement (which signals?), or set manually per account?
3. ✅ RESOLVED — Post-BOV = reset the New-Prospect 7-touch clock and match.
4. ✅ RESOLVED — In Escrow / Non-Refundable (PSA/Executed PSA) ALWAYS carry an explicit PSA milestone timeline.
