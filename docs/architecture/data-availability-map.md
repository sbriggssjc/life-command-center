# Data-availability map — what powers the intelligence layer (2026-07-31)

Audited while building the intelligence layer. The engines are built and correct; several
higher-value features are **data-starved**, not logic-starved. This maps each feature to its
source and whether that source is actually populated, so future work targets the *data* gap.

## Populated & working (intelligence built on real data)
| Feature | Source | State |
|---|---|---|
| Ownership reconciliation | `lcc_owner_evidence` (SF task/deal/email feeders) | ✅ populated, self-healing |
| Deal-health / risk scoring | `bd_opportunities` (stage, dates) + spine last-touch | ✅ live, surfaces real risk |
| Deal-stage next-steps | `bd_opportunities.stage` | ✅ live |
| Active-deal ranking + staleness | `bd_opportunities` + `v_activity_unified` | ✅ live (staleness caveated by coverage) |
| Prospecting pipeline | `v_priority_queue_enriched` (bands/reasons/rent) | ✅ populated (1,148) |
| Cadence touchpoints (who/tier/phase/channel/template) | `touchpoint_cadence` | ✅ populated (1,665 due) |
| Role-aware next-step framing | `entity_relationships` → `lcc_party_role` | ✅ populated |

## Empty or thin (features blocked until the data is populated)
| Would-be feature | Assumed source | Reality |
|---|---|---|
| Cadence content-awareness ("why now / what to say") | `contact_engagement` | **empty table (0 rows)** — the join in `lcc_my_day.tc0` is silently null |
| Relationship-value ranking of touchpoints | `unified_contacts` transactions/volume for touchpoint contacts | **thin** — 613/1,665 linkable, but 0 have transaction history, 37 have any last-activity date (they're cold prospects, not clients) |
| BD-angle per touchpoint | `v_priority_queue_enriched.reason` by touchpoint entity | **11%** — touchpoints are on *contacts*; reasons are on *assets*; only 179/1,665 join |
| Cadence-owner attribution | `touchpoint_cadence.owner_user_id` | **empty** — 7/1,776 populated |
| Active-deal last-touch / "going cold" (real vs. no-data) | `v_activity_unified` per deal entity | **coverage gap** — 11/40 open deals have any client touch (see `activity-coverage-audit.md`) |
| Content-aware deal next-steps | deal correspondence in the spine | blocked by the same coverage gap |

## The pattern
The intelligence *logic* is done. What's missing is **populated relationship/engagement/
correspondence data**. Three tables the design leaned on (`contact_engagement`, cadence owner,
per-contact `unified_contacts` history) are empty or thin, and deal correspondence isn't
ingested. So the next real unlock is **data population**, not more features:

1. **Deal-correspondence ingestion** (from `activity-coverage-audit.md`) — backfill + ongoing
   capture of deal threads into the spine, deal-linked. Unblocks: real staleness, content-aware
   deal next-steps, role-aware engine firing at volume.
2. **Populate `contact_engagement`** (or repoint cadence content to a live source) — compute
   per-contact response rate / preferred channel / last outcome from the spine. Unblocks:
   cadence content-awareness, relationship-value ranking of touchpoints.
3. **Cadence owner** — populate `touchpoint_cadence.owner_user_id` (or derive from the deal /
   reconciliation). Unblocks: owner-scoped touchpoints beyond the entity override.

## Cheap correctness cleanup (noted, low priority)
`lcc_my_day.tc0` joins the empty `contact_engagement` — harmless (always null; ranking falls
through to tier + overdue) but misleading. Remove or repoint when cadence content-awareness is
built on a real source.

## Recommendation
Pause net-new intelligence features (they'd render blank), and make the next work **data
population** — starting with deal-correspondence ingestion, which unblocks the most (staleness,
content-aware next-steps, and lets the role-aware engine actually fire). The engines are already
waiting for the fuel.
