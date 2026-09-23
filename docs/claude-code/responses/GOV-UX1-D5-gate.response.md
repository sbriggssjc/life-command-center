# GOV-UX1-D5-gate — response (CC, 2026-09-23)

Prompt: `docs/claude-code/prompts/GOV-UX1-D5-gate-tightened-review-lane-then-auto.md` (Q48, the hybrid).

## What shipped

| piece | where | state |
|---|---|---|
| decision-maker role rule | `lcc_is_seller_lead_decision_role(role)` (migration `20261102260000`) | live |
| gate candidates, one row per owner, each condition a column | `v_lcc_seller_lead_gate_candidates` | live |
| the ONE gate definition (combines the columns + the JS-only name guards) | `api/_shared/seller-lead-gate.js::evaluateSellerLeadGate` | needs the redeploy |
| decision ledger (Create / Not a lead + reason, auto creates, reversals) | `lcc_seller_lead_gate_decision` | live |
| precision meter (lane decisions only, last 25, ≥ 0.90) | `v_lcc_seller_lead_gate_precision` | live |
| review lane | top of the Priority tab (`ops.js::renderSellerLeadLane`) → `GET/POST /api/seller-lead-gate` | needs the redeploy |
| auto-create tick | `/api/seller-lead-autocreate-tick`, cron `lcc-seller-lead-autocreate` (weekdays 13:10 UTC) | cron live; handler needs the redeploy; flag **OFF** |
| reversal | `POST /api/seller-lead-gate?action=reverse` `{entity_id}` or `{batch_tag}` | needs the redeploy |

**The only lead writer is still `operations.js::bridgeCreateLead`.** The lane and the tick call it through
`invokeCreateLead`, handing it a capturing `res`. The test asserts through the AST that neither new module POSTs
anywhere except its own ledgers. On the auto path the lead owner is `lcc_cadence_point_person(entity)` (a
`public.users` id), so `bd_opportunities.owner_user_id` and the seeded cadence belong to the point person, not
to whoever the cron authenticated as.

## Why the Priority tab (not the Home BD lane)

- The gated owners are a strict subset of `v_lcc_seller_prospect_queue`, and the Priority tab (v2, flag ON) already
  renders that queue. Scott decides them where he already works.
- The Home BD lane is small (limit 5), and `home_three_lanes` defaults OFF in `LCC_FLAGS`.

## The gate, conditions and live funnel (LCC Opps, 2026-09-23)

| condition | source | owners removed when applied in order |
|---|---|---:|
| in the seller queue with `reason_measured` | view scope | 217 candidates |
| a linked person with a decision-maker role (not `works_at`/`associated_with`/`contact`/`parent_of`/`child_of`/`subsidiary_of`/broker-ish), and not the owner's own name restated (P164) | SQL role rule + `isOwnerNameRestated` | −191 → 26 |
| owner name passes `lcc_owner_name_is_junk`, `isJunkEntityName`, `isAddressAsName` | reused guards | −0 → 26 |
| not a repeat buyer (`lcc_resolve_buyer_parent`, the test `bridgeCreateLead` refuses on) | SQL | −6 → 20 |
| no open `bd_opportunity` of any type | SQL | −0 → 20 |
| `lcc_cadence_point_person` resolves | SQL | −0 → 20 |
| no live lane/auto decision | ledger | −0 → **20** |

`4238 Washington Street` never gets as far as the name guard, because its only link is `works_at`. The name
guard still catches it: `isAddressAsName` → true, and a test pins that.

## Grading, all 20 rows (fewer than 25 qualify)

| # | owner | reason | contact (role) | verdict |
|---|---|---|---|---|
| 1 | FD Stonewater | developer | "Fd Stonewater" (manager) | **reject**, wrong_or_weak_contact: the "person" is the owner name restated with no email. The P164 guard fails safe because the owner name carries no firm suffix. |
| 2 | Highwoods Realty Limited Partnership | developer | Brian Leary @highwoods.com (prospecting_contact) | keep: a public REIT that sells, with a named person at the owner. |
| 3 | Opi Wf Owner LLC | developer | Andrew Piccirillo @rmrgroup.com (institution_decision_maker) | keep: an RMR-managed REIT SPE with the RMR contact. Scott's call on REIT dispositions. |
| 4 | ARC GSIFLMN001, LLC | developer | Karen Massey @ar-global.com | **reject**, repeat_buyer_or_reit: an AR Global REIT SPE |
| 5 | ARC GSFFDME001, LLC | developer | Karen Massey | **reject**: same sponsor as #4 |
| 6 | Truist Bank | developer | Andrew Rutherford @truist.com | **reject**, bank_or_lender |
| 7 | Curtis Properties | developer | Chris Curtis @curtisinvest.com | keep |
| 8 | ARC GSRNGME001, LLC | developer | Karen Massey | **reject**: same sponsor as #4 |
| 9 | PASADENA SSA LLC | debt + developer | Kiljuana Crawford (decision_maker) | **reject**, repeat_buyer_or_reit: the same person as UIRC's SPE (which the resolver does catch) |
| 10 | WSSA LAKEWOOD LLC | developer | George Farah @wssallc.com (decision_maker) | keep |
| 11 | HARBOR SQUARE HOLDINGS LLC | debt | Srinivas Potluri (institution_decision_maker) | keep: an individual principal with a debt reason |
| 12 | GH WESTERVILLE, LLC | debt | Brian J. Ellis @nationwide.com | **reject**, wrong_or_weak_contact: the contact is at Nationwide, likely the lender side of the debt signal |
| 13 | MMI Capital, LLC | developer | Miller Heath @mmi-capital.com | keep |
| 14 | JLB Capital | debt | Philip Auerbach @strategicgp.com | keep (check): the contact's domain is a different firm, possibly a GP partner |
| 15 | Welsh Properties | developer | Clint Bryant @welsh-properties.com | keep |
| 16 | ARC GSDALTX001, LLC | developer | Karen Massey | **reject**: same sponsor as #4 |
| 17 | ARC GSGTNPA001, LLC | developer | Karen Massey | **reject**: same sponsor as #4 |
| 18 | Qtf LLC | developer | Sally Lynn Strand | keep: an individual principal |
| 19 | Flywheel Gateway, LLC | developer | Ben Hrouda | keep: an individual principal |
| 20 | Homestead Community Pharmacy | debt | Muhizi Condo (economic_owner_contact) | **reject**, tenant_or_operator |

**Result: 10 keep, 10 reject.** The first page would score about 50%, so auto-create cannot unlock on today's
population. That is the intended outcome: the gate is much better than the 54-owner version, but not yet good
enough to write unattended. Scott's decisions will show whether that changes. The precision window is the
**last 25** lane decisions, so early rejects roll off as the gate improves.

The rejects fall into three gaps, each filed rather than patched here, because none can be closed without a new
regex list or a change to the shared seller-queue guards:
- `GOV-UX1-D5-gate-bank`: a plain bank passes `lcc_owner_name_is_bank_or_trustee` (it matches trustee shapes only).
- `GOV-UX1-D5-gate-buyerspe`: a repeat-buyer SPE the name resolver misses, found through a shared decision-maker.
- `GOV-UX1-D5-gate-sponsor`: five SPEs share one sponsor contact, so the lane offers five leads for one conversation.

## Tests

`test/gov-ux1-d5-gate.test.mjs`: 26 tests. **19 of 19 mutations turn a test red**, including every gate condition
removed on its own, the flag default, the lane-only precision window, the SQL role list and an injected domain
POST. The full suite ran 6,962 passing and 0 failing.

## Deploy

The migration is already applied, and the cron is live but no-ops until the JS ships (it returns 404 JSON, never
a write). **Redeploy both Railway services**, then run `npm run verify:deploy` (cache busters are now `2026092302`).
After that, open the Priority tab and check that *Ready to become a lead (20)* renders with its meter.
