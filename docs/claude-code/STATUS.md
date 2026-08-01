# Claude Code queue — STATUS  (updated 2026-08-01, session 2)

## Open (in `prompts/`) — recommended order reflects the error triage
| # | Prompt | Priority | State | Note |
|---|--------|----------|-------|------|
| 09 | field_source_priority schema drift (#710) | P0 | open | fails Daily DB Checks; upstream of cap/pricing |
| 10 | PA flow failures triage/fix | P0 | open | SF Opp Sync + LCC Get Artifact = the deal-spine connectors |
| 01 | Cap-rate reconciliation (35724 -> 6.00%) | P0 | open | do with/after 09 |
| 06 | Deal-spine data model (schema) | P0 | open | targets buildDealPacket |
| 02 | Connect the deal spine (SF/Outlook/Sharefile) | P0 | open | sits on top of 10 (flows are the mechanism) |
| 11 | Comps: connector reach + bounded output | P1 | open | engine OK; agents can't reach + dump too big |
| 03 | Broker/role attribution | P1 | open | |
| 04 | Loan propagation | P1 | open | |
| 05 | Resolver by property-id | P1 | open | |
| 08 | Deal-tab UI | P1 | open | after 02/06 populate data |
| 07 | Data-backlog index (property-dossier P0-P3) | mixed | index | |

## Recommended sequence
1) **09** (unblock pricing writes) + **01** (correct 35724 cap) — the cap/pricing truth.
2) **10** (fix the broken PA flows) — restores the SF/Outlook/Sharefile connectors.
3) **06** (schema) + **02** (connect) — populate the deal spine onto the packet.
4) **08** (Deal-tab UI) — render it. Then 03/04/05/11/07 as capacity allows.

## Recently completed (context)
| Work | Resolved by |
|------|-------------|
| Dossier generator production wiring | PR #1549 (merged) |
| Duplicate-file build fix (Boot Check / Railway) | commit 1aae4e20 (verify deploy boots) |
| Closed-deal asset entity + deal-spine wiring | PR #1550 |
| 35724 lease escalation + rent_at_sale | Dialysis #7354 (note: set the WRONG 6.46%; see prompt 01) |
| P0 CMS clinic-economics correction | commit f4518ada |

## Process
See `README.md`. Cowork checks `responses/` each chat, verifies, updates docs, moves finished prompts to
`done/`, and keeps this table current.
