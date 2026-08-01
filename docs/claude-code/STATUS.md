# Claude Code queue — STATUS  (updated 2026-08-01, session 2c)

## Open (in `prompts/`)
| # | Prompt | Priority | State |
|---|--------|----------|-------|
| 09 | field_source_priority schema drift (#710) | P0 | open |
| 10 | PA flow failures (SF Opp Sync, LCC Get Artifact) | P0 | open |
| 08 | Deal-tab UI (render the live deal spine) | P1 | open — spine is now live, ready to render |
| 13 | Property & Contact tab connectivity | P1 | open |
| 14 | government-lease CI Test & Lint (68b293a) | P1 | open |
| 11 | Comps: connector reach + bounded output | P1 | open |
| 12 | LCC Health surface (observability) | P1 | open |
| 03 | Broker/role attribution | P1 | open (partly covered by the 02 conflict surfacing) |
| 04 | Loan propagation | P1 | open |
| 05 | Resolver by property-id | P1 | open |
| 07 | Data-backlog index (property-dossier) | mixed | index |
| 15 | Create SF Opportunity for 35724 | P1 | **HOLD — needs Scott's go-ahead (outward write)** |

## Done (in `done/`)
| # | Prompt | Resolved by |
|---|--------|-------------|
| 01 | Cap-rate reconciliation (35724 -> 6.00%) | PR #1551 (+ Dialysis #7355); rebuilt v_sales_comps (412 rows) + guard |
| 02 | Connect the deal spine | PR #1552 — packet assembly + reconciliation discipline; SF/Outlook fill gated |
| 06 | Deal-spine data model (schema) | PR #1552 — lcc_deal_* tables + lcc_deal_spine read model (built with 02) |
| 07/f2 | rent/SF + escalated rent | detail.js + entities-handler + dossier-generator |
| 07/f3 | transactions/listings timeline | entities-handler + dossier-generator + detail.js |
| 07/f4 | lease abstract (guarantor + responsibilities) | lease-extractor + leases.guaranty_scope + dossier |

## Recommended sequence
1) **09 + 14** (schema drift dia+gov; get CI green) + confirm **01** live. 2) **10** (fix PA flows; many HTTP
flows may recover post-deploy of 1aae4e20). 3) **08** (Deal-tab UI — the spine is live, render it) + **13**
(property/contact connectivity). 4) **11/12** (comps reach; health surface), then 03/04/05. **15 only on
Scott's approval.**

## Decision needed from Scott
**15 — create a back-fill SF Opportunity for the closed 35724 deal?** The deal spine is built, but this closed
deal has no SF Opportunity, so parties/commission stay "Not on file." Creating one is an outward write to
Salesforce (held pending your go-ahead). Option B is to leave 35724 comp-only and let future deals fill via the
fixed sync flow (prompt 10).

## Process: see `README.md`.
