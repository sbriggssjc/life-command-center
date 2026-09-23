# GOV-UX1-D5-gate-2 — response (CC, 2026-09-23)

Prompt: `docs/claude-code/prompts/done/GOV-UX1-D5-gate-2-bank-spe-sibling-sponsor-collapse.md`.
Backlog: `GOV-UX1-D5-gate-bank`, `GOV-UX1-D5-gate-buyerspe`, `GOV-UX1-D5-gate-sponsor`.

## What shipped

| unit | where | state |
|---|---|---|
| bank | `lcc_owner_name_is_plain_bank(text)`, OR-ed into `lcc_owner_name_is_bank_or_trustee` (migration `20261102280000`) | **live** (applied 2026-09-23) |
| buyerspe | view `v_lcc_seller_lead_gate_candidates`: each `dm_people[]` item now carries `shared_buyer_parent`/`_id`; `likelyBuyerSpeParent()` in `api/_shared/seller-lead-gate.js`; `planAutoCreate` skips `likely_spe_of` | view **live**; JS needs the redeploy |
| sponsor | `collapseSharedDecisionMakers()` (union by decision-maker `person_id`); sibling owners recorded `decided_via='cluster'` (CHECK widened, live); a lane "Not a lead" reversal reverses the siblings too | CHECK **live**; JS needs the redeploy |
| lane card | `ops.js`: "Same decision-maker also controls N more owners: …" and "Likely SPE of <parent> — kept off auto-create". Cache busters `2026092303`. | needs the redeploy |

Not touched: the precision view (still `decided_via='lane'`, last 25, ≥ 0.90), the flag (OFF), the cron, and `bridgeCreateLead`. No new JS regex list: the bank rule is SQL-only.

## 1. bank — measured before and after

The rule matches a name that ends in `Bank` (optionally `, N.A.` / `, The` / `Inc`), `Bank of X`, `… Bancorp`,
`… Bancshares`, `… Banking Corporation/Company`, or `Bank & Trust`. It **never** matches a name that carries an
SPE or real-estate suffix (`LLC`, `LP`, `Limited`, `Investors`, `Building`, `Plaza`, `Properties`, …) or a
charitable bank (`Food Bank`, `Blood Bank`, …).

- **Seller universe, bank-ish names (`\mban(k|c)`):** 32 of 42 match, and every one is a bank. The 10 that do
  not match are the right 10: `BANK BUILDING INVESTORS, LIMITED`, `First Bank Building LLC`, `BANCORP PLAZA LLC`,
  `Bank of Louisville,LLC` (ambiguous, so it stays for a human), `Gregory M Bancroft`, `TC II 7200 BANCROFT, LLC`,
  `TEP Flint Bankruptcy Court, LLC`, `Raj Halker Bank of` (junk), `Banc of California executives or board members`
  (junk) and `Ameriserv Financial Bank, Pensylvania`. That last one is a real bank the rule misses: its other
  spelling matches, and this one is stated here as a miss rather than patched.
- **Fleet-wide:** 621 of 935 bank-ish entity names match. The only false positive found was
  `Food Bank of Delaware`, and it is now excluded.
- **Queue rows removed (graded):** `v_lcc_seller_prospect_queue` went **502 → 498**. Exactly four rows left, all
  owned by **Truist Bank** (dia 26404 Brookline, 24148 Daly City, 24142 Inglewood, 25401 Decatur; $27.6M combined;
  reason `value_creation_developer`). All four are correct removals under Scott's 2026-09-14 rule that banks are
  not prospected.
- **Other consumers (before → after):** `v_lcc_seller_prospect_universe` 8,282 → 8,234; `v_lcc_top_seller_prospects`
  4,055 → 4,029; `v_lcc_tier0_owner_contact_candidates` 740 → 724. Unchanged: `v_lcc_owner_contact_decidability`
  318, `v_lcc_loan_maturity_worklist` 169, `v_lcc_user_owner_candidates` 15, `v_lcc_entity_roles` 11,625.

## 2. buyerspe

An owner is a **likely SPE of a repeat buyer** when *every* surviving decision-maker also holds a decision-maker
role (not `works_at`) on another live organisation that `lcc_resolve_buyer_parent` resolves to a repeat buyer.
One independent decision-maker is enough to keep the owner unflagged. The owner is **not** removed. It stays in the
lane with the note and is kept off the auto path.

Live flags (2 of 19 gated owners):
- **PASADENA SSA LLC** → Kiljuana Crawford also decides for 3 UIRC entities → *UIRC, Urban Investment Research Corp.* (the targeted case)
- **Opi Wf Owner LLC** → Andrew Piccirillo also decides for an entity resolving to *RMR Group*. The first round graded
  this owner "keep: RMR-managed REIT SPE, Scott's call". The rule now says what that grade said in words, and the
  decision stays Scott's.

## 3. sponsor collapse

Gated owners that share a decision-maker `person_id` (transitively) are shown as **one card**: the top-value owner,
with the rest listed as siblings. The key is the person, never a name. One lane decision is written for the card
(`decided_via='lane'`, counted by the meter) and for each sibling (`decided_via='cluster'`, **not** counted), all
tagged `batch_tag='cluster:<card entity_id>'`. The siblings leave the lane with the card. Reversing a lane
"Not a lead" brings the whole card back. An auto create writes its siblings under the auto batch tag.

Live: Karen Massey's five `ARC GS…001, LLC` SPEs (combined $44.3M) become **one card** headed by ARC GSIFLMN001
($14.8M). No other gated owners share a person.

REITs are not excluded by name. AR Global/GNL does not resolve as a repeat buyer, so the ARC card stays in the
lane as one conversation.

## 4. Re-grade, every card (live, 2026-09-23)

Funnel: 216 candidates (was 217; Truist gone) → **19 owners qualify** (was 20) → **15 cards** (4 siblings collapsed). 2 cards carry the SPE note.

| # | card | contact | note | first-round grade | now |
|---|---|---|---|---|---|
| 1 | FD Stonewater | "Fd Stonewater" | | reject (own-name contact) | reject |
| 2 | Highwoods Realty Limited Partnership | Brian Leary | | keep | keep |
| 3 | Opi Wf Owner LLC | Andrew Piccirillo | likely SPE of RMR Group | keep (Scott's call) | keep? (Scott's call; off auto) |
| 4 | ARC GSIFLMN001, LLC **+4 siblings** | Karen Massey | one conversation | 5 × reject | 1 × reject (or keep if Scott pursues AR Global dispositions) |
| 5 | Curtis Properties | Chris Curtis | | keep | keep |
| 6 | PASADENA SSA LLC | Kiljuana Crawford | likely SPE of UIRC | reject | reject (flagged, off auto) |
| 7 | WSSA LAKEWOOD LLC | George Farah | | keep | keep |
| 8 | HARBOR SQUARE HOLDINGS LLC | Srinivas Potluri | | keep | keep |
| 9 | GH WESTERVILLE, LLC | Brian J. Ellis (@nationwide.com) | | reject (lender-side contact) | reject |
| 10 | MMI Capital, LLC | Miller Heath | | keep | keep |
| 11 | JLB Capital | Philip Auerbach | | keep (check) | keep (check) |
| 12 | Welsh Properties | Clint Bryant | | keep | keep |
| 13 | Qtf LLC | Sally Lynn Strand | | keep | keep |
| 14 | Flywheel Gateway, LLC | Ben Hrouda | | keep | keep |
| 15 | Homestead Community Pharmacy | Muhizi Condo | | reject (tenant/operator) | reject |

**Projected precision: 10/15 = 67%** on the first round's grades (**60%** if Opi is rejected as an RMR SPE). It was
10/20 = 50%. The three classes this prompt named are closed: the bank is gone, the five-card REIT sponsor is one
card, and the UIRC sibling carries its note and is off the auto path. The remaining rejects are **different
classes**, none of which these three arms can reach:
- **FD Stonewater**: the decision-maker is the owner's name restated with no firm suffix. P164's
  `isOwnerNameRestated` fails safe on a suffix-less owner.
- **GH Westerville**: the contact sits at a lender (Nationwide), next to a debt signal.
- **Homestead Community Pharmacy**: the owner is the tenant/operator.

So auto-create correctly stays locked. The meter needs about 23 keeps in 25 decisions, and today's lane cannot reach
that on its own. That is the intended outcome: Scott's decisions now measure the gate, not the three known gaps.

## Tests

`test/gov-ux1-d5-gate-2.test.mjs`: 11 tests. **17 of 17 mutations turn it red**, covering: the bank OR removed; the
SPE-suffix exclusion, charity exclusion and ends-with-bank arm each removed; SPE `every`→`some`; SPE never set; the
auto path ignoring SPE; the view self-exclusion and decision-role filter each dropped; the collapse disabled; the
card representative reversed; sibling `decided_via` set to lane; the sibling batch tag dropped; `findGateCard`
ignoring siblings; reject siblings not recorded; sibling reversal dropped; the CHECK losing `cluster`. The first
mutation run found one survivor (the suffix exclusion): its fixtures were also excluded by `llc`/`limited`. It is
now pinned by `Bank of America Plaza` / `Bank of the West Building`. The bank rule is tested by evaluating the
migration's own regex literals, so there is no JS copy of the rule. Full suite: **7,003 pass / 0 fail**. Boot
check passes.

## Deploy

The migration is already applied (bank rule, CHECK, view). **Redeploy both Railway services**
(`tranquil-delight` for the lane/tick JS, and the MCP service `life-command-center` so both run the same `main`),
then run `npm run verify:deploy` (cache busters `2026092303`). Check: the Priority tab reads *Ready to become a
lead (15)*, the ARC card lists 4 siblings, and PASADENA / Opi show "Likely SPE of …".
Then Q51: Scott grades the lane.
