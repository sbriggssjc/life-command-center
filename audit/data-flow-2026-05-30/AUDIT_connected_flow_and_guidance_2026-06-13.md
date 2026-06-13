# Audit — End-to-end connectedness, enrichment, and whether the app guides user time
**Grounded live 2026-06-13 across LCC Opps + gov + dia.**

The question: is the whole flow connected and enriched by every source, and does the
app guide the user to where their time matters most — connect-the-data (research) or
the next prospecting touch?

## 1. The connected flow — strong spine, two thin links
The relationship graph is RICH at the asset/transaction layer:
`purchases 20,714 · sells 18,182 · leases 15,626 · finances 12,748 · owns 9,395 ·
brokers 5,166`. Property↔owner↔transaction is well-connected. Two links are thin:

- **Owner → contact (the outreach layer): `associated_with` = 2,782** across ~11,000
  owner orgs. Most owners have NO human contact — which is exactly why the outreach
  loop was starved (only 3 of 409 cadences ever touched). R16 (just shipped) is
  filling this for SF-mapped entities; P-CONTACT surfaces the rest.
- **Property → true owner (gov): only 37% covered** (7,105 of 19,108). The ownership
  layer is the single weakest enrichment. (dia is healthier at 76%.)

## 2. Enrichment by source — automated sources strong, research/doc sources thin
| layer | source | gov | dia |
|---|---|---|---|
| geocode | geocode-tick cron | 89% | 86% |
| investment score | scorer | 98% | — |
| tenant | ingest/CMS | — | 83% |
| true owner | county/ingest/research | **37%** | 76% |
| NOI / rent | OM / CoStar / CMS | 57% | (anchor 9%, rest via leases) |

The split is structural: **cron/automated sources (geocode, scoring) are near-
complete; the layers that need DOCS or MANUAL RESEARCH (owner, financials, contacts)
are partial** — and those are precisely the things the app should be guiding the user
to connect.

## 3. Guidance — the app surfaces the WHAT, but doesn't prioritize the WHICH
The app surfaces a large, well-categorized worklist:

- **Connect-the-data (~1,800):** P0.4 resolve-ownership 543 · P-CONTACT select-contact
  325 · confirm_true_owner 177 · junk_entity_name 746 · map_sf 16 · disambiguation 30.
- **Next-touch (~270):** P1/P2/P3/P5/P8 gov triggers 224 · P7 steady-state 68 ·
  P-BUYER 21 · P4 14 · P6 2.

Connect-work dwarfs touch-work — and that's CORRECT: the data must be connected before
touches can happen, and the app rightly says "connect first." Two real guidance gaps:

### Gap A (the headline) — connect-work isn't value-ranked
The touch bands ARE value-ranked (R14 rollup + `rank_annual_rent`), so once data is
connected the app guides touches by portfolio value. But the big CONNECT bands are
NOT: **P0.4 is 59% rank-zero, P-CONTACT is 99% rank-zero.** So the app tells the user
"resolve these 543 owners / find contacts for these 325" with no signal on WHICH are
highest-value. A user could burn research time connecting a worthless owner while a
high-value one waits. The app guides the *category* of work but not the *priority
within it* — the missing half of "guide where to spend time."

**Why it's fixable:** the rank-zero connect entities lack a `portfolio_facts` edge,
but they DO carry rich `owns`/`purchases`/`leases` relationships to assets — and
those assets have value (`lcc_property_attributes`). Joining the entity's connected-
property value (via the relationship graph) into the P0.4/P-CONTACT rank would let the
app sort connect-work by the dollars at stake, so the user researches the biggest
owners and contacts first.

### Gap B — junk cleanup competes with real connect-work
`junk_entity_name` (746) is the single largest "work" item but is low-value cleanup
(mostly R11-retyped person-name artifacts). It inflates the apparent workload and
competes for attention with high-value ownership/contact connection. It should be
demoted/batch-dispositioned, not presented peer-to-peer with revenue-driving connect
-work.

## Top recommendation
**Value-rank the connect-the-data bands (P0.4, P-CONTACT) using the entity's
connected-property value from the relationship graph**, so the app guides the user to
research/connect the highest-value owners and contacts first. This completes the
"guide where to spend time" doctrine: the app already prioritizes touches by value;
this extends the same value lens to the connect side, which is where 87% of the
surfaced work currently lives. Secondary: demote the junk-cleanup lane so it doesn't
crowd the worklist.

## What's healthy (no action)
- Geocode + scoring enrichment (cron-driven) — near-complete, self-maintaining.
- The asset/transaction relationship graph — rich and well-connected.
- The connect-vs-touch categorization — correct; the app does point at the right
  *kinds* of work.
- Contact layer — the known gap, already being addressed (R16 + P-CONTACT).
