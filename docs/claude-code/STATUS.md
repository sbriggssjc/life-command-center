# Claude Code queue — STATUS  (updated 2026-08-01, session 2b)

## Open (in `prompts/`) — order reflects the error triage
| # | Prompt | Priority | State |
|---|--------|----------|-------|
| 09 | field_source_priority schema drift (#710) | P0 | open |
| 10 | PA flow failures triage/fix (SF Opp Sync, LCC Get Artifact) | P0 | open |
| 06 | Deal-spine data model (schema) | P0 | open |
| 02 | Connect the deal spine (SF/Outlook/Sharefile) | P0 | open (sits on 10) |
| 11 | Comps: connector reach + bounded output | P1 | open |
| 12 | LCC Health surface (observability) | P1 | open |
| 13 | Property & Contact tab connectivity | P1 | open |
| 03 | Broker/role attribution | P1 | open |
| 04 | Loan propagation | P1 | open |
| 05 | Resolver by property-id | P1 | open |
| 08 | Deal-tab UI | P1 | open |
| 07 | Data-backlog index (property-dossier P0-P3) | mixed | index |

## Done (in `done/`)
| # | Prompt | Resolved by |
|---|--------|-------------|
| 01 | Cap-rate reconciliation (35724 -> 6.00%) | PRs lcc #1551 (merged) + Dialysis #7355 (merge pending); rebuilt v_sales_comps (412 rows), added guard view + tests |
| 07/f2 | rent/SF + current-escalated-rent | detail.js + entities-handler + dossier-generator + backfill |
| 07/f3 | transactions/listings timeline | entities-handler + dossier-generator + detail.js |

## Recommended sequence
1) **09 + verify 01** (pricing truth; 01 merged, confirm live). 2) **10** (fix broken PA flows — note many HTTP
flows may recover once 1aae4e20 deploys). 3) **06 + 02** (populate the deal spine). 4) **08** (Deal-tab UI) +
**13** (property/contact connectivity). Then **11** (comps reach), **12** (health surface), 03/04/05/07.

## Recently completed (context)
Dossier generator wiring PR #1549; Boot Check fix 1aae4e20; closed-deal entity PR #1550; CMS economics f4518ada;
cap-rate PR #1551 (+ Dialysis #7355). Process: see `README.md`.
