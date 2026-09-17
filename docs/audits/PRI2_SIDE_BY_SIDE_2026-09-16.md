# PRI2 side-by-side — the Priority tab today (V1) vs the seller-prospect list (V2), one real day

**Measured:** 2026-09-16 on LCC Opps, live. **Why:** decision **S1** (`OPERATOR-CHECKLIST.md`) — flag
`priority_tab_v2` stays OFF until Scott has read the two top-20s and said which he would work first.
**Backlog:** `PRI2`, `PRI1`. **What to do with this page:** in the *Scott's read* column, mark each row
`work` / `skip` / `?`. Ten minutes. Flag ON follows the read, not the other way round.

## What each list is

**V1 — the Priority tab as it renders today.** `v_priority_queue`, **1,899 rows** in ten bands. 923 of
them are plumbing the app can do itself (P0.4 514 · P-CONTACT 217 · P0.5 173 · P-BUYER 19); the human
set is 976 (P1 229 · P2 142 · P3 228 · P4 14 · P5 59 · P8 304). The tab sorts by band, then days
overdue. The top 20 below is the human set in that order — **every one is P1 `lease_expiry_24mo`,
gov, with a next-touch date 668–729 days in the past.** The list is a two-year-old to-do.

**V2 — `v_lcc_seller_prospect_queue`, what PRI2 renders behind the flag.** **508 rows** (the seller
doctrine: $2.5M–$25M, newer lease, reason to sell, not yet reached), ordered `rank_value DESC,
years_into_term ASC` — i.e. **client value first**, then lease recency. The top 20 below is therefore
the twenty most valuable assets in band. Note what that does: 15 of 20 are `no_linked_person`, 8 of
20 carry `reason_to_sell_unmeasured` (in band on value + lease, no measured reason yet).

Overlap of the two top-20s: **one owner** (Highwoods Realty LP — different property in each). The
lists disagree almost completely, which is the point of reading them side by side.

## V1 — top 20 as the tab orders them (band → days overdue)

| # | who | band | why | days overdue | domain · property | Scott's read |
|---|---|---|---|---|---|---|
| 1 | Jason Kahler | P1 | lease_expiry_24mo | 729 | gov · 5049 | |
| 2 | Southern Exposure LLC | P1 | lease_expiry_24mo | 728 | gov · 8421 | |
| 3 | National Government Properties | P1 | lease_expiry_24mo | 725 | gov · 1128 | |
| 4 | Drinkard Development | P1 | lease_expiry_24mo | 714 | gov · 6139 | |
| 5 | Ferrous Development | P1 | lease_expiry_24mo | 714 | gov · 2703 | |
| 6 | Highwoods Realty Limited Partnership | P1 | lease_expiry_24mo | 714 | gov · 12548 | |
| 7 | Pool Edwin J | P1 | lease_expiry_24mo | 714 | gov · 5499 | |
| 8 | Highwoods Properties | P1 | lease_expiry_24mo | 714 | gov · 3836 | |
| 9 | STORK INVESTMENTS LLC | P1 | lease_expiry_24mo | 707 | gov · 4059 | |
| 10 | John and Karen Curry Enterprises LLC | P1 | lease_expiry_24mo | 699 | gov · 9795 | |
| 11 | Easterly Gov Properties (REIT) | P1 | lease_expiry_24mo | 692 | gov · 12575 | |
| 12 | Triad Investment Properties | P1 | lease_expiry_24mo | 688 | gov · 7603 | |
| 13 | Frank Sousa | P1 | lease_expiry_24mo | 687 | gov · 516 | |
| 14 | ARE-MARYLAND NO 24 LLC | P1 | lease_expiry_24mo | 683 | gov · 6951 | |
| 15 | Concourse Holding LLC | P1 | lease_expiry_24mo | 683 | gov · 8538 | |
| 16 | PLAINS PLAZA, LLC | P1 | lease_expiry_24mo | 683 | gov · 8621 | |
| 17 | Wavellite | P1 | lease_expiry_24mo | 679 | gov · 13213 | |
| 18 | FORT FAIRFIELD BP LLC | P1 | lease_expiry_24mo | 678 | gov · 7382 | |
| 19 | Syndicated Equities | P1 | lease_expiry_24mo | 675 | gov · 23282 | |
| 20 | Karen Kropp | P1 | lease_expiry_24mo | 668 | gov · 8632 | |

## V2 — top 20 as PRI2 orders them (value → lease recency)

| # | owner | property | why now | value | reach | Scott's read |
|---|---|---|---|---|---|---|
| 1 | WMC ATL, LLC | 157 Tradeport Dr, Atlanta GA (gov 4520) | debt + value_creation_developer | $24.9M | no_linked_person | |
| 2 | SPPI COMMERCIAL LLC | 1855 Gateway Blvd, Concord CA (gov 1207) | reason_to_sell_unmeasured | $24.3M | no_linked_person | |
| 3 | 60 SOMA FEE OWNER CA, LLC | 60 S. Market St, San Jose CA (gov 95) | reason_to_sell_unmeasured | $23.3M | no_linked_person | |
| 4 | Brooklyn Renaissance Plaza II LLC | 335 Adams St, Brooklyn NY (gov 10148) | reason_to_sell_unmeasured | $22.9M | no_linked_person | |
| 5 | STATE WAREHOUSE NOVA LLC | 10377 Mordor Dr, Lorton VA (gov 14406) | value_creation_developer | $22.9M | no_linked_person | |
| 6 | FD Stonewater | 10377 Mordor Dr, Lorton VA (gov 14406) | value_creation_developer | $22.9M | in_pipeline_untouched | |
| 7 | NGP V BROWARD LLC | 4451 NW 31st Ave, Fort Lauderdale FL (gov 3619) | debt | $22.9M | no_linked_person | |
| 8 | ET NOAA Building, LLC | 14200 Merritt Rd, Grandview MO (gov 8075) | value_creation_developer | $22.7M | no_linked_person | |
| 9 | BOYER GSA WAREHOUSE LC | 1125 W 12th St, Ogden UT (gov 14029) | value_creation_developer | $22.6M | no_linked_person | |
| 10 | Gladstone Commercial | 14700 Townsend Rd, Philadelphia PA (gov 11549) | debt | $22.4M | no_linked_person | |
| 11 | CHI 2051JAMIESON AVENUE LLC | 2051 Jamieson Ave, Alexandria VA (gov 14356) | value_creation_developer | $22.1M | no_linked_person | |
| 12 | BOYD WESLACO GSA LLC | 1501 E. Expressway 83, Weslaco TX (gov 12859) | reason_to_sell_unmeasured | $21.7M | no_linked_person | |
| 13 | MORGANTOWN GSA, LLC | 99 Research Park Rd, Morgantown WV (gov 229) | reason_to_sell_unmeasured | $21.3M | no_linked_person | |
| 14 | PHILLY OFFICE 1, LLC | 30 N 41st St, Philadelphia PA (gov 11596) | value_creation_developer | $20.9M | no_linked_person | |
| 15 | NGP V CENTENNIAL CO LLC | 12445 E Caley Ave, Centennial CO (gov 275) | debt | $20.3M | no_linked_person | |
| 16 | Gardner Tanenbaum Holdings | 2222 Market St, Saint Louis MO (gov 8196) | debt | $20.2M | in_pipeline_untouched | |
| 17 | WMC Properties | 157 Tradeport Dr, Atlanta GA (gov 4520) | debt | $20.1M | no_linked_person | |
| 18 | Highwoods Realty Limited Partnership | 1825 Century Blvd NE, Atlanta GA (gov 4509) | value_creation_developer | $20.0M | in_pipeline_untouched | |
| 19 | Boyd Royal Palm Beach LLC | 9300 Belvedere Rd, Royal Palm Beach FL (gov 3617) | reason_to_sell_unmeasured | $19.9M | no_linked_person | |
| 20 | BOYD IRVING II GSA LLC | 6500 Campus Cir Dr E, Irving TX (gov 12864) | reason_to_sell_unmeasured | $19.9M | no_linked_person | |

## What the two lists say, before Scott's read

- V1's top is not a ranking; it is the oldest overdue P1 rows. Nothing about value, reason to sell, or
  whether anyone has ever been reached. It is also **all gov** — the dialysis lane never reaches the
  top because its rows carry later next-touch dates.
- V2's top is a ranking, but by **value alone** inside the band — and value is not "why now". Eight of
  twenty are in band only because they are big and their lease is newer (`reason_to_sell_unmeasured`).
  If Scott's read is "I'd work the debt/developer rows first, not the biggest unmeasured ones", that is
  a one-line order change (`reason_to_sell` measured before unmeasured, then value), not a new score —
  and it is inside PRI2's "no new scoring engine" rule.
- Two rows (5/6 and 1/17) are the **same property with two owner entities** — the V2 list is per
  owner·property; the tab should collapse to one card per property with both owners, or the top 20 is
  really the top 18.
- 15 of V2's 20 have **no linked person**. Whatever Scott marks `work`, the first action on most of
  them is contact acquisition, which the P-CONTACT band was quietly doing for V1's population. PRI2's
  footer ("N resolved automatically today") is where that should show.

## Scott's read → flag decision

Mark the rows. Then one of: **ON as is** · **ON with the reason-first order** · **stay OFF, and here is
why**. Cowork turns the answer into the PRI2 follow-up (`PRI2-order` if the order changes; `PRI2-on`
is a one-line flag flip plus the byte-identical-when-OFF test already in the build).
