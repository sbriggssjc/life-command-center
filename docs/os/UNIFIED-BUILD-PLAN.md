# Unified Build Plan — one spine, shared substrates, no duplicate builds
_Master build sequence, 2026-07-27._ The single doc to work from. Detail lives in the linked design docs;
this is the order, the dependencies, and the anti-overlap invariant.

## The invariant (why nothing overlaps)
Every deal-intelligence capability reads/writes the **same shared substrates**. No feature forks a parallel store.
- **`activity_events`** — the ONE activity log: calls (SF write-back ✅), emails (Outlook pipeline ✅ live),
  milestones (status_change). Dossier AND cadence both read it.
- **`bd_opportunities`** — the ONE deal record: `entity_id, sf_opp_id, stage, is_open, amount, expected_close_date, owner`.
- **`entity_relationships`** — the ONE graph. Deal rosters are `deal_party` edges here (not a new table).
- **`entities`** — deals = `asset`, people = `person`.
- **Deal Dossier** = a **projection** over the above — it has no storage of its own.
> **Build rule:** a new capability must attach to these substrates. If you're about to create a sibling table
> for a concept that already lives here, stop — extend the substrate instead.

## Already LIVE — build ON, never rebuild
Dossier tools · SF write-back (`log_call`) + queue drainer · **Outlook email pipeline** (5,735 emails, distilled,
contact-resolved) · `bd_opportunities` (schema ready) · `entity_relationships` (109k edges) · `activity_events` ·
Cortex · connector **v4** · folder-watch flow · comps engine.

## Track 1 — Deal Intelligence spine  (dependency-ordered; the main sequence)
| # | Build | Reads/Writes (shared) | Design doc | Notes |
|---|---|---|---|---|
| 1 | **SF Opportunity Sync (inbound)** | → `bd_opportunities` (+ resolve/ensure deal `entities`) | cadence-engine.md | Mirror of the SF drainer. Stage feed + **dossier-at-BOV trigger**. |
| 2 | **Deal Roster** | → `entity_relationships` `deal_party` edges | deal-correspondence-attribution.md | From SF Opp contacts (#1) + `.md` rosters. Shared by dossier + cadence. |
| 3 | **Deal-Email Matcher** | reads Outlook `activity_events`(contact) + roster → writes `activity_events`(deal) | deal-correspondence-attribution.md | Strong signals (escrow#/address/OM-PSA) + roster; dedupe by message-id. |
| 4 | **`cadence-scan` endpoint** | reads `bd_opportunities` + `activity_events` | cadence-engine.md | Stage-aware next-action-due digest. Buildable calls-only, enriched by #3. |
| 5 | **PSA milestone-timeline population** | → `activity_events` (status_change) via `update_deal_dossier` | proactive-deal-monitor.md | At LOI-executed/PSA: always seed the explicit timeline (Fresenius pattern). |
| 6 | **Weekly pipeline email + contractual nudges** | reads #4/#5 | proactive-deal-monitor.md | PA recurrence; notify-only. |
| 7 | **Account layer** (new-prospect 7-touch + tiering) | `activity_events` + `unified_contacts` | cadence-engine.md | 7-touch 0/7/14/28/42/72/102. **Open: tiering computed-vs-manual.** |
| 8 | **Draft-and-hold** due touches | Draft tools → Outlook drafts | cadence-engine.md | Never auto-sent. |
| 9 | **Investor-outreach manager** (ELA broad marketing) | rides `RunListingBdPipeline` | cadence-engine.md | Buyer list + priority + revisit. |

## Parallel tracks (independent of the spine — run anytime)
- **Track 2 — SF write-back completion:** drainer → `create_task` + `advance_opportunity_stage`; connector
  write-target desc "deal or person"; **connector v4 repave** (retire duplicate agent actions); `updateOpportunity`
  fields beyond stage; `logActivity` idempotency key. *(SF-WRITEBACK-AND-DOSSIER-BUILD-STATE.md)*
- **Track 3 — Rollout / surfaces:** paste ChatGPT persona; sync Northmarq/Personal/Cowork bundles; create the two
  Copilot document specialists + delegation + Work IQ least-privilege; Office Script + its flow; correct the 4
  SharePoint `_WORKFLOW` docs. *(BUILD-STATUS.md)*
- **Track 4 — Security/hygiene (close-out):** **git push (now)**; rotate Supabase `service_role` key + Secure
  Inputs on drainer HTTP steps; rotate `LCC_API_KEY` (last); RLS hardening in a branch.

## Dependency map
```
SF Opportunity Sync ──> bd_opportunities ──┬─> cadence-scan ──> weekly pipeline email
   (Track1 #1)                             ├─> dossier-at-BOV
                                           └─> Deal Roster ──> Deal-Email Matcher ──┐
Outlook pipeline (LIVE) ──> activity_events(contact) ─────────────────┘             │
                                                                                    v
                                              activity_events(deal) ──> dossier correspondence + cadence last-touch
LOI/PSA stage ──> PSA milestone timeline ──> contractual nudges
```

## Recommended order
0. **git push** — bank this session.
1. **Spine 1→4** (SF sync → roster → matcher → cadence-scan) — the core loop; test on Fresenius + Frank Meyrath.
2. **Spine 5→6** (PSA timeline + weekly email) — surfacing; first real weekly pipeline email.
3. **Track 3 rollout** in parallel (independent — surfaces + Copilot specialists).
4. **Spine 7→9** (account layer, drafts, investor outreach).
5. **Track 2** write-back extensions + **Track 4** security to close out.

## Source-of-truth map (so no concept has two homes)
- Deal + stage → **`bd_opportunities`** (fed from SF Opportunity).
- All activity (call/email/milestone) → **`activity_events`** (calls: write-back; emails: Outlook pipeline; milestones: update_deal_dossier).
- Who's on a deal (roster) → **`entity_relationships` `deal_party`**.
- Contact ↔ SF ids → **`unified_contacts`**.
- Durable decisions/memory → **Cortex**.
- Human-readable deal snapshot → the `.md` dossier (a *rendered view*, not the system of record).
