# Owner Reconciliation Engine

**Status: LIVE (2026-07-31).** Determines the best-answer owner for every deal by
reconciling weighted, timestamped, provenance-tagged evidence from all available sources —
no single source is treated as truth. Writes `lcc_entity_owner_override` with a confidence
score; **never** clobbers a manual/human override.

## Why
Salesforce Account owner is a generic integration user; SF Task coverage is partial
(activity logged against contacts or as email isn't captured); email captures some reps but
not all. Any one source is thin or biased. Reconciling them — with recency decay and
confidence — is robust and resilient, and grows monotonically better as feeders are added.

## Model
`lcc_owner_evidence(entity_id, candidate_owner, source, weight, observed_at, detail, updated_at)`
— one weighted vote per (deal, source, candidate). PK `(entity_id, source, candidate_owner)`
so re-runs are idempotent (strongest weight / latest observation wins).

Scoring (per deal): `score(candidate) = Σ weight × recency_decay(observed_at)`, where
`recency_decay = max(0.25, 1 − age_days/365)` — old evidence still counts, recent counts more.
`confidence = top_score / total_score` (share of all evidence). The winner is written to the
override only when `confidence ≥ min_confidence` (default 0.55); ties/low-confidence stay
unassigned (honest — visible to everyone until a signal breaks the tie). The override `note`
carries `conf`, `margin`, and the per-candidate score+sources breakdown for provenance.

### Source weights (initial, tunable)
| source | weight | meaning |
|---|---|---|
| `sf_opportunity` | 1.0 | explicit deal owner (Opportunity.OwnerId) — *feeder pending* |
| `deal_owner` | 0.9 | owner of record on an open `bd_opportunities` deal — **live** |
| `sf_task` | 0.8 | assignee of the SF Task on the account (WhatId/AccountId) — **live** |
| `email_outbound` | 0.7 | team member who sent mail on the deal — **live** |
| `call_outbound` | 0.7 | team member who placed a call — *feeder pending* |
| `sf_account_team` | 0.6 | Account Team member — *feeder pending* |
| `cadence_owner` | 0.5 | owner on a `touchpoint_cadence` row — **live** (empty until cadence owner is populated) |
| `sf_campaign` | 0.5 | rep whose prospect/campaign list the contact is on — *feeder pending* |
| `research` | 0.4 | LCC research/other tools — *feeder pending* |
| `manual` | — | human override; wins outright, never overwritten by the engine |

## Functions (DB, live)
- `lcc_record_owner_evidence(entity, candidate, source, weight, observed_at, detail)` — generic vote sink.
- `lcc_ingest_email_owner_evidence()` — feeder: `outlook_sent.from` → lcc_user → deal.
- `lcc_ingest_deal_owner_evidence()` — feeder: open `bd_opportunities.owner_user_id` → deal entity.
- `lcc_ingest_cadence_owner_evidence()` — feeder: `touchpoint_cadence.owner_user_id` → entity.
- `lcc_record_sf_owner_evidence(p_map, source, weight)` — feeder: SF-id→owner map → evidence.
- `lcc_reconcile_owner(entity, min_conf, write)` — score one deal, optionally write.
- `lcc_reconcile_all_owners(min_conf, write)` — reconcile every deal with evidence.
- `lcc_reconcile_owners_run(min_conf, write)` — orchestrator: refresh email feed + reconcile all.

## Routes
- `POST /api/sf-owner-sync` — pulls SF Task owners via the PA flow, records them as
  `sf_task` evidence, then runs the orchestrator (email feed + reconcile). `?dry=1` shows the
  SF owner breakdown without writing.
- `POST /api/owner-reconcile` — no-Salesforce reconcile run (email feed + reconcile). This is
  the endpoint the **background AI / LCC** calls to "clean and connect" ownership on demand.
  `?dry=1` scores without writing; `?min_confidence=0.6` to tune.

## Schedules
- `lcc-sf-owner-sync-weekly` — Mon 06:30 UTC — full SF pull + reconcile.
- `lcc-owner-reconcile-daily` — 05:30 UTC — email feed + reconcile (keeps ownership fresh
  as mail flows in, between weekly SF pulls).

## First live result (2026-07-31)
12 deals reconciled at confidence 1.0: **9 → Scott** (email_outbound), **3 → Kelly**
(sf_task: Capri Development, Mike Spisak, Ryan Michaels). SF Task alone had resolved only 3
(all Kelly, 0 Scott); adding the email feeder captured Scott's 9. Coverage compounds with
each feeder.

## Roadmap — more feeders (each is additive; the engine doesn't change)
1. **Separated "SF owner signals" PA flow** (Scott leans this way): one richer flow op that
   returns, per account, *all* SF ownership signals in one call — Task owners (WhatId **and**
   WhoId→contact→account), Opportunity.OwnerId, Account Team members, and Campaign/prospect-list
   membership. LCC maps each to a `source` + weight and records evidence. This replaces the
   single-signal `owners_by_ids` op and makes SF a rich multi-signal provider.
2. **Call feeder** — `webex_call` outbound → `call_outbound` evidence (mirror of email).
3. **WhoId broadening** — capture contact-logged tasks (resolve `Who.AccountId`).
4. **Research feeder** — when LCC research/enrichment identifies the working rep.
5. **Tuning** — adjust weights/decay/min_confidence from observed accuracy; surface
   low-confidence/tie deals for a quick human tap (which becomes a `manual` vote).
