# Deal Backbone — Design Refinements (post-BUILD-01, real data)

_2026-07-28. Written after 592 real deals landed on `bd_opportunities`. Closes three gaps the
original plan did not fully address: the **stage→cadence model** against the real in-org stages,
**staleness/deletes**, and **owner-scoping**. Attaches to the existing shared substrates — no new
stores (per the UNIFIED-BUILD-PLAN invariant)._

## Ground truth (the 34 open deals, 2026-07-28)
| Stage | Open | Owned by Team Briggs (4 users) | Regime |
|---|---|---|---|
| Listing Signed | 15 | 7 | A — active listing |
| Off-Market Listing | 6 | 1 | A — active listing |
| BOV | 5 | 5 | A — pursuit (pre-listing) |
| LOI Executed | 5 | 4 | B — contractual |
| identified | 2 | 2 | A — early pursuit |
| Non-Refundable | 1 | 0 | B — contractual |

558 of 592 are terminal (219 closed-won, 339 closed-lost = Regime C). **19 of 34 open deals are
Team-Briggs-owned; 15 are other brokers' deals inside the same record types.**

---

## Gap 1 — Stage→cadence model (the real stages, three regimes)

The original cadence-engine doc predates the real stage vocabulary. Refined mapping — every
in-org stage resolves to exactly one **regime**, which sets who drives the next action and how:

**Regime A — Active listing / pursuit (cadence-driven; ball-in-court defaults to US).**
Proactive, spaced touches. The `cadence-scan` engine owns these.
- `identified`, `BOV` → *pursuit*: win the listing. Touch the seller/decision-maker on the
  new-prospect spacing (0/7/14/28/42/72/102) until BOV→ELA or dead.
- `ELA`, `Listing Signed` → *active marketing*: two parallel cadences — (1) buyer/investor outreach
  (rides the ELA broad-marketing manager, Spine #9), (2) seller status updates on a fixed beat
  (e.g. weekly while listed). Ball-in-court flips to *them* only while awaiting a specific reply.
- `Off-Market Listing` → *quiet marketing*: targeted buyer outreach only; no public beat.

**Regime B — Contractual (milestone/deadline-driven; NOT cadence touches).**
`LOI Executed`, `In Escrow`, `Non-Refundable`. These are governed by **PSA milestone dates**, not
touch spacing. The Proactive Deal Monitor (Spine #6) + PSA timeline (Spine #5) own these: seed the
explicit milestone timeline at LOI/PSA, then nudge on overdue/due-soon. `cadence-scan` should
*skip* Regime B for touch cadence (avoid double-driving) but *surface* its milestone state.
The endpoint already emits `needs_psa_timeline` for these stages — that's the trigger.

**Regime C — Terminal (nurture; low-frequency).**
- `Closed` / `Closed IS` (won) → *relationship nurture*: post-close thank-you, then periodic
  value-touch (comp shares, market updates). Also feeds Gap-adjacent work: **closed-won = comps**
  (see the separate cross-domain note).
- `Terminated IS` (lost) → *revive*: low-frequency re-touch (e.g. 2×/yr) + capture the why.

> **Design rule:** regime is derived from `stage`, not stored separately. A tiny `STAGE_REGIME`
> map (A/B/C) lives next to `STAGE_MAP` and is read by `cadence-scan` and the deal monitor so both
> agree on who drives each deal. New stages default to Regime A (safe: they get surfaced, not ignored).

---

## Gap 2 — Staleness & deletes (the full-refresh blind spot)

The sync is a full-refresh every 30 min: every deal in the SF filter set gets its `last_synced_at`
bumped. A deal that is **deleted in SF, or re-typed out of the 6 record types**, simply *stops
appearing* — it is never updated again, but it also never gets closed or removed. It lingers as a
false-open deal.

**Detection (no new store, no destructive action):** `last_synced_at` freshness is the signal.
After a successful sync, any `is_open` deal whose `last_synced_at` is older than **2× the sync
interval** (≈ now − 70 min) has vanished from the SF pull.

**Handling — flag, never auto-delete:**
- Mark `metadata.sf_stale = true` + `metadata.sf_stale_since` on those rows.
- Surface them in a "went dark in SF — verify" bucket (part of the reconciliation review or a
  monitor line). A human confirms: deleted (→ archive/close), re-typed (→ expected, mute), or a
  sync gap (→ ignore, it'll refresh).
- Never delete on absence alone — SF hiccups and record-type edits are recoverable; a wrong delete
  loses the deal's LCC history (`activity_events`, roster edges).

**Where it runs:** cheapest as a tail step of `cadence-scan` (Spine #4) — it already reads
`bd_opportunities`; add one freshness query. No separate job needed.

---

## Gap 3 — Owner-scoping (team vs owned)

15 of 34 open deals sit in Team Briggs record types but are owned by other Northmarq brokers.
`owner_user_id` (mapped from `lcc_users.salesforce_owner_id`) is the scoping key; unmapped owners
keep their raw SF id in `metadata.owner_sf_user_id`.

**Decision (Scott, 2026-07-28): a deal is *in consideration* only if it is a Team Briggs deal —
owned by, or a partnership/co-broke involving, a Team Briggs user. Everything else is EXCLUDED by
default, unless explicitly included.**

A deal is "Team Briggs" if EITHER:
- **Owned** — `owner_user_id` ∈ the 4 Team Briggs users (19 open today), OR
- **Partner** — a Team Briggs user is on the deal team / roster (co-broke, split, partnership),
  even when the owner is someone else. This signal comes from **Deal Roster (Spine #2)** — SF
  Opportunity Team Members + the `.md` rosters → `entity_relationships` `deal_party` edges. Until the
  roster exists only *owned* is detectable; partnership deals are picked up the moment Spine #2 lands
  (which now has a concrete reason to be the next build).

Everything else is **excluded from consideration** — it may still sit in the backbone as inert data
(other brokers' closed sales are latent comps), but it drives no cadence, monitor, or NBA.

**Explicit-include override:** `metadata.team_briggs_include = true` forces a deal in-scope
regardless of owner/roster (the rare "we're quietly involved" case). Set by hand or a rule.

> **Design rule:** every cadence/monitor/NBA query filters to Team-Briggs scope —
> `owner_user_id ∈ TB_USERS  OR  exists deal_party edge to a TB user  OR  metadata.team_briggs_include`.
> Default is **exclusion**; nothing is hard-coded to "all deals." This is the same discipline that
> keeps the debt pipeline out — non-TB deals are silent unless explicitly opted in.

---

## What this changes downstream (so the spine stays coherent)
- `cadence-scan` (Spine #4): reads `stage` → regime; **skips Regime B** for touch cadence, runs A,
  low-freq C; filters to **Team-Briggs scope** (owned OR partner-on-roster OR explicit include —
  default exclude); appends the **staleness** flag pass.
- **Deal Roster (Spine #2) is now the next build** — it is the only way to detect *partnership*
  Team Briggs deals (owner is another broker but a TB user is on the team). Without it, scope is
  owner-only and co-broke deals are wrongly excluded.
- Proactive Deal Monitor (Spine #6): owns Regime B via the PSA timeline; consumes the stale bucket.
- `STAGE_REGIME` map ships in `mcp/opportunity-sync.js` (next to `STAGE_MAP`) so producer + consumers
  share one definition.
- No schema changes. Regime, staleness, and scope are all derivations over `stage`, `last_synced_at`,
  and `owner_user_id` — the substrates already hold everything.
