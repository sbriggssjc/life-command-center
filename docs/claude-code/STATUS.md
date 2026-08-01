# Claude Code queue — STATUS  (updated 2026-08-01)

## Open (in `prompts/`)
| # | Prompt | Priority | State |
|---|--------|----------|-------|
| 01 | Cap-rate reconciliation (35724 -> 6.00%) | P0 | open |
| 02 | Connect the deal spine (SF Opp + Outlook + Sharefile) | P0 | open |
| 03 | Broker/role attribution (our role authoritative) | P1 | open |
| 04 | Loan propagation (entity.metadata.loans -> loans table) | P1 | open |
| 05 | Resolve assets by property-id identity, not address | P1 | open |
| 06 | Deal-spine data model (commission/milestones/diligence/roles/summary) | P0 | open |
| 07 | Data-backlog index (property-dossier P0-P3; see followup doc) | mixed | index |

## Recently completed (for context)
| Work | Resolved by |
|------|-------------|
| Dossier generator production wiring | PR #1549 (merged) |
| Duplicate-file build fix (Railway) | commit 1aae4e20 (merged/live) |
| Closed-deal asset entity + deal-spine wiring | PR #1550 |
| 35724 lease escalation carry-forward + rent_at_sale | Dialysis #7354 (note: drove the wrong 6.46% cap -> see prompt 01) |
| P0 CMS clinic-economics correction | commit f4518ada (verify + close) |

## Process
See `README.md`. Cowork checks `responses/` each chat, verifies, updates docs, moves finished prompts to `done/`,
and keeps this table current.
