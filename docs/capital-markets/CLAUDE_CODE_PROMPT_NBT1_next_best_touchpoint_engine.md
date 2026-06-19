# Claude Code prompt — NEXT-BEST-TOUCHPOINT #1: point the engine at Scott's real accounts (Phase 1) + the SF-Activity sync spec (Phase 2 foundation)

> From the cadence-targeting audit (2026-06-19). Scott's direction: "LCC should drive the next
> biggest value touchpoint based on the research and progress with accounts, that learns and
> adjusts as we gather feedback or responses (or lack thereof)." The audit found the cadence
> engine is pointed at the WRONG universe — 493 cold auto-generated prospects Scott never
> contacts — while his real SF book + the value-ranked owner graph have no systematic
> touchpoint engine. This re-orients it. Receipts-first; gated; reversible; incremental slices.

## Grounding (measured live 2026-06-19, LCC Opps — verified by the gate)
- **The misalignment:** 493 prospecting cadences (431 person / 82 org, auto-generated from
  CoStar captures, seed_source none). Scott's tracked SF outreach reached only **10 entities in
  180 days**; **8 of 10 had no cadence**; 491 of 493 cadences he never touches. Open BD
  opportunities: **6**. The engine and his real activity are disjoint.
- **What's USABLE for ranking (rich):** the value-ranked owner graph from the connectivity work
  — 10,169 bridged owners; **399 SF-linked accounts that ARE owners AND carry connected-property
  value** (`lcc_entity_connected_value`), 666 SF-linked owners total, 193 already in
  `lcc_priority_queue_resolved`. This intersection (his SF book ∩ valued owners) is the real seed.
- **What's NOT usable yet (be honest, don't rank on it):** the 12,100 synced SF "Deals" are
  **staging residue** (`skip_reason='no_match'`, payloads nulled by retention) — NOT a usable
  deal-stage signal. Touchpoint history is sparse (**84 SF activity events all-time**) because
  the SF sync pulls Companies/Deals/Listings/Comps/Properties but **NOT Activities/Tasks** — so
  "progress / last-contact / responses" barely exists in LCC yet (that's Phase 2).
- So Phase 1 ranks by **research value** (have it), and the progress/learning signal layers in
  once Phase 2 (the SF-Activity sync) lands.

## PHASE 1 — Slice 1a: the ranking view (read-only, gate FIRST)
Build **`v_next_best_touchpoint`** — one row per Scott-relevant account, the value-ranked "who to
touch next." Seed = entities that are **SF-linked AND a true_owner** (his book ∩ owner graph),
UNION the open `bd_opportunities` accounts. Columns: entity_id, name, entity_type,
`sf_account_id`, `rank_value` (reuse the EXISTING `rank_annual_rent` / connected-value chain from
R11/R17 — do NOT invent a new value metric), `last_touch_at` (from the cadence if one exists, else
the latest SF activity_event — sparse for now), `days_since_touch`, `has_open_opportunity`,
`priority_band` (left-join `lcc_priority_queue_resolved`). Order by `rank_value DESC NULLS LAST`.
No writes. This is the surface that answers "next biggest value touchpoint."
- **Gate 1a:** the view returns the ~399–666 real SF owner accounts value-ranked (top rows are
  genuine high-value owners Scott would recognize, not cold auto-prospects); reuses the existing
  value chain (no new metric); read-only.

## PHASE 1 — Slice 1b: re-point the engine (mutation, gate SECOND)
After 1a is verified, align the cadence engine to the view — reversibly:
- **Seed cadences** for the top-ranked `v_next_best_touchpoint` accounts that lack one (reuse the
  EXISTING cadence-seed path / `ensureEntityLink` contact attach — do NOT fork), `owner_role`-honest,
  tagged `metadata.seed_source='next_best_touchpoint'` (reversible).
- **Retire the cold auto-prospects:** the 491 auto-generated prospecting cadences Scott never
  works → set `phase='paused'` (the R34 reversible pattern; stash prior phase in metadata) so they
  leave the active dashboard WITHOUT hard-delete. Keep any that ARE in the value-ranked set.
- **Cap + gate first:** seed/retire a capped batch (25) → STOP for the gate → then drain.
- **Gate 1b:** the active cadence set now reflects his valued SF accounts (sample = real
  high-value owners); the cold auto-prospects are paused (reversible, recoverable); the
  value-ranked dashboard (`v_bd_cadence_dashboard` + R34 rank) surfaces the right "next touch";
  nothing hard-deleted.

## PHASE 1 — Slice 1c: wire the dashboard/queue to it
Point the cadence dashboard "next best touchpoint" header at `v_next_best_touchpoint` (value-ranked),
so the daily driver shows his real accounts. Bump `?v=` if the render changes. (Keep the in-app
draft/sender out of scope — Scott works Outlook/SF.)

## PHASE 2 — the SF-Activity sync (Power Automate extension spec — Scott's SF side + the ingest map)
This unlocks "progress + learns from responses." The SF sync (Power Automate → object_intake)
already pulls Companies/Deals/Listings/Comps/Properties; it must ALSO pull **Activities**:
- **SF objects to add to the PA flow:** `Task` (calls/emails/to-dos) and `Event` (meetings).
  Pull BOTH open and completed, with a rolling historical window (e.g. last 24 months) + ongoing.
- **Fields needed per record:** `Id`, `WhoId` (Contact/Lead), `WhatId` (Account/Opportunity/
  custom), `Subject`, `Description`, `ActivityDate`, `Status`, `TaskSubtype`/`Type`
  (Call/Email/…), `CallDisposition`, `IsClosed`, `OwnerId` (→ "whose book"), `CreatedDate`,
  `LastModifiedDate`. For `Event`: `Id`, `WhoId`, `WhatId`, `Subject`, `StartDateTime`,
  `EndDateTime`, `OwnerId`.
- **Ingest mapping (CC, LCC side):** extend the existing `object_intake` → activity path so
  `sf_object_type IN ('Task','Event')` maps to an `activity_events` row — category derived from
  `TaskSubtype`/`Type` (reuse the OUTREACH#1 `deriveSfCategory(type, subject)` so generic Tasks
  whose subject is real outreach categorize call/email, genuine notes stay `note`), `occurred_at`
  from `ActivityDate`/`StartDateTime`, entity resolution via `WhoId`→contact / `WhatId`→account
  (→ the cadence contact-hop from OUTREACH#1 advances the right cadence). `OwnerId` → capture the
  account-owner / "Scott's book" signal on the entity (the missing ownership flag).
- This is partly **Scott's SF/PA configuration** (adding Task/Event to the flow's object list +
  fields) and partly **CC's ingest mapping**. Deliver the CC ingest side + a precise checklist
  Scott hands to the PA flow. Once Activities flow in, `v_next_best_touchpoint.last_touch_at` /
  `days_since_touch` become real, and the learning loop (R24 engagement/response signals) has fuel.

## My gate
- 1a read-only view correct + value-ranked from the existing chain; 1b capped re-seed/retire is
  reversible, real accounts in / cold prospects paused (not deleted), dashboard reflects it; the
  Phase 2 ingest maps Task/Event → activity_events correctly on a synthetic record (entity
  resolved, category derived, cadence advanced) — exercised once the PA flow is extended.

## Guardrails
- Receipts-first; capped → gate → drain; reversible (metadata tags / paused-not-deleted); reuse
  the existing value chain (R11/R17), cadence-seed + contact-hop (OUTREACH#1), R34 dashboard rank,
  `deriveSfCategory` — do NOT fork or invent a parallel engine. Rank only on USABLE signals
  (research value now; progress/last-touch once Phase 2 lands — never fabricate a progress score
  from the unusable Deal residue). ≤12 api/*.js. Bump `?v=` on dashboard render changes.
- Net: the engine points at Scott's real, valued accounts (next biggest value touchpoint), the
  cold-prospect noise is retired (reversibly), and the SF-Activity sync brings in the progress +
  response signal so it can "learn and adjust as we go."
