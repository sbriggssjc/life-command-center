# Claude Code — R63: make cadence track REAL relationships, not captured noise (drive work, don't check a box)

## Why (live Cadence Dashboard audit, 2026-06-22/23)
The cadence machinery is correct and complete (engine, draft, advance, reachability gate
R10/R20, contact-acquisition R16, value-rank R34, the OUTREACH#1 SF-activity→advance bridge).
**The problem is the population it's pointed at.** Grounded live on LCC Opps:

- **Active cadences: 318** (304 `prospecting`, the rest onboarding/steady_state/buy_side) +
  **519 already `paused`**. (The "836" seen in the raw view = active + paused; the
  operator-facing dashboard is the ~318 active.)
- **All 304 prospecting are overdue, and only 3 cadences have EVER been touched.** The loop
  has effectively never closed.
- **Root cause = population mismatch, NOT a wiring bug.** Scott's real outreach reaches **~16
  distinct entities in 60 days** (52 SF notes / 23 calls / 14 emails). The cadence table is
  auto-seeded on CoStar-captured contacts. **Only 3 overlap — and those 3 are exactly the 3
  ever touched.** So OUTREACH#1's bridge works perfectly; there is almost nothing to bridge.
- Of the 318 active cadences, only **133 carry any real BD signal** (126 SF-linked, 6 open
  opportunity, 4 connected-value, 2 with actual SF activity). **~185 are pure-capture noise**
  (no SF link, no value, no opp, never contacted).

Doctrine (Scott, 2026-06-23): *accurate information + a system that drives actual work
forward, not a checkbox.* A cadence should exist only where there's a real relationship/target
to work, and it should advance from Scott's real SF/Outlook outreach. Stop minting a cadence
for every captured contact. Same producer-gate + auto-retire doctrine as R60 (research) and
R62 (queue).

## Unit 1 — gate the cadence producer (stop seeding noise)
Identify every path that INSERTs a `prospecting` `touchpoint_cadence` row (candidates:
`bridgeCreateLead` / `lcc_open_prospect_opportunity` / the R5 `bd_opportunity_auto_seed_cadence`
trigger / `cadence-engine.js` create-on-read / any contact-capture→cadence path / a bulk
BD-engine seed). Gate creation: only seed a cadence when the entity has a **real BD signal** —
- an `external_identities` Salesforce identity (a CRM relationship), OR
- connected/portfolio value ≥ a floor (`lcc_entity_connected_value` / portfolio rollup;
  reuse the R60 `$500k`-style tunable knob), OR
- an open `bd_opportunity`, OR
- a P-BUYER selected / buy-side contact.
A bare captured contact (broker/owner contact from CoStar) does **NOT** get an auto-cadence —
it stays in `contacts`/inbox until promoted to a real target. Keep the R5 gate that already
blocks buyer-SPE prospect cadences. Reversible/idempotent; the dedup guard stays.

## Unit 2 — pause the pure-capture noise (reversible sweep)
Sweep the ~185 active cadences that carry **no signal** (not SF-linked, connected-value 0,
no open opp, no SF activity, `last_touch_at` null) → `phase='paused'`,
`metadata.pause_reason='no_bd_signal'`, prior phase stashed (mirror the R34 reversible pause;
NOT a delete). Leaves the ~133 signal-bearing cadences active. Idempotent. After this the
dashboard's "overdue" stops being 99%-of-everything and becomes a real signal.

## Unit 3 — close the loop from real outreach (the inversion — the part that drives work)
When Scott logs SF/Outlook activity (`activity_events` source_type='salesforce',
category call/email/meeting) on an entity that is a real target (SF-linked / value / opp) but
has **no active cadence**, ensure one exists and advance it — reuse OUTREACH#1's
`resolveCadenceForEntity` + `advanceCadence`. So the cadence table GROWS from the people Scott
actually contacts (his book), and his real outreach keeps the loop closing automatically,
instead of the table being a static pile of captures. (Small today — ~16 entities — but it's
the correct forward mechanism: real outreach seeds + maintains the cadence.)

## Unit 4 — honest dashboard
`getCadenceDashboard` defaults to the actionable set (signal-bearing AND has-contact),
value-ranked by `rank_value` (R34), with the real active count shown. Keep a "show all
(incl. paused / no-signal)" toggle for completeness, but the default is the workable set so the
operator sees real targets, not 300 overdue captures.

## Boundaries / verify
Reversible (pause, never delete); reuse R34 rank, R10/R20 reachability, OUTREACH#1 advance, the
R60 value-floor knob; do NOT change the engine math (`recommendNextTouch`/`advanceCadence`
sequence); ≤12 api/*.js. Report: before/after active-cadence count (≈318 → ≈133); a
capture-only contact no longer auto-seeds a cadence (Unit 1 test); ~185 paused with reason
(Unit 2, reversible); a synthetic SF activity on a real-but-uncadenced target seeds + advances
a cadence (Unit 3 test); dashboard default count = actionable set (Unit 4). `node --check`;
suite green. DB sweep applied live after a dry-run; JS ships on the Railway redeploy.

## Bottom line
The cadence system is built right but aimed at the wrong people — 300 overdue captures Scott
will never work, while his real 16-relationships/60-days barely appear. R63 points it at real
relationships (gate the seeder, pause the noise, grow it from actual SF outreach), so the
Cadence Dashboard becomes a worklist of people Scott actually pursues and the loop closes from
the outreach he's already doing — accurate, and driving real work.
