# Claude Code prompt — E2E#7: cadence-seed trigger conflict blocks opportunities (+2 console bugs)

Paste into Claude Code, run from the **life-command-center** repo. Found during
the final live verification of PR #1024 (which otherwise passed: negative-case
banner ✓, lead-row idempotence ✓, `already_open` reuse ✓, placeholder name heal
✓ — Palestra now reads "Palestra Properties").

---

## (a) THE BLOCKER — `bd_opportunity_auto_seed_cadence` dies on pre-existing cadences

**Verified live 2026-06-03:** create-lead on gov 5450 (Bloomington IRS) created the
lead but **silently produced no opportunity** (the insert is non-fatal-logged).
Reproduced the exact insert in SQL with rollback; the true error:

```
23505: duplicate key value violates unique constraint "uq_cadence_contact_property"
```

Chain: `bd_opportunities` INSERT → `bd_opportunity_auto_seed_cadence` trigger →
`touchpoint_cadence` INSERT → **unique violation** (a cadence already exists for
that contact+property key — 5450's asset entity "Acquest Development" carries one
of the ~305 pre-seeded BD-engine cadences) → **the whole opportunity insert rolls
back**. Blast radius: **any entity with a pre-existing cadence row can never get
an opportunity** through create-lead or open_opportunity — a wide, silent class.

**Fix the trigger** (migration on LCC Opps `xengecqvemvfknjvbvrq`): when the
seed INSERT hits `uq_cadence_contact_property`, do not blow up the transaction.
Preferred semantics: `ON CONFLICT ON CONSTRAINT uq_cadence_contact_property DO
UPDATE` to **reactivate/link** the existing cadence — set its
`bd_opportunity_id` to the new opportunity, revive `phase` from
dormant/terminal to the onboarding phase, and recompute `next_touch_due` —
so the pre-existing row becomes the live cadence for the new opportunity.
(Plain DO NOTHING is acceptable as a fallback but leaves the cadence unlinked
and possibly dormant; prefer the reactivate-and-link form.) Idempotent migration;
verify by re-running the exact insert above (it must succeed and link the
existing Acquest cadence), then live: create-lead on gov 5450 yields an
opportunity (currently the lead exists but `opps for 5450 = 0` via that path).

## (b) dia activity feed 400 on every property detail

Console (recurring, every detail load):
`diaQuery v_sf_activity_feed: HTTP 400 — column v_sf_activity_feed.sf_account_id does not exist`
(detail.js queries `v_sf_activity_feed` with a select that includes
`sf_account_id`). Fix either side: drop the column from the select, or add it to
the dia view if consumers need it — check which the renderer actually uses.

## (c) Emails widget crash

`renderRecentEmails (app.js:6625): ReferenceError: jsStringArg is not defined`
— recurring; the Today emails widget render dies. Likely a typo'd helper name
from a recent round. Fix the reference, `node --check`, and confirm the widget
renders.

## Design notes to address or explicitly defer (state which in the PR)

1. **Org-vs-asset entity duality defeats cross-flow idempotence.** The queue's
   `open_opportunity` anchors on the OWNER/org entity (e.g. Bloomington IRS LLC,
   `f92770a4…`), while property-flow create-lead anchors on the ASSET entity from
   `lookup_asset` (e.g. "Acquest Development", `84af8dc1…`). The idempotence
   guard keys on `entity_id`, so the same property can get two open opportunities
   via the two flows (Bloomington now has the org-entity one from testing).
   Recommend: the opp-dedupe in `bridgeCreateLead` ALSO checks
   `metadata->>'source_property_id'`, and/or property-flow prefers the queue's
   owner entity (the priority-band response already returns `entity_id`).
2. **Legacy dia leads lack `source_ref`**, so the new lead-dedupe misses rows
   created before the stamp (e.g. Palestra's 21:12 lead). One-line backfill:
   `UPDATE marketing_leads SET source_ref = <property> WHERE source='property_flow'
   AND source_ref IS NULL` — derive from the matched property where recoverable,
   else leave (dedupe just won't see them).

## Verify + ship
- SQL probe insert for entity `84af8dc1…` succeeds and links the existing cadence.
- Live: create-lead on gov 5450 → opportunity exists for 5450; no 23505 in logs.
- Detail load console clean of the `v_sf_activity_feed` 400 and `jsStringArg` error.
- Migrations idempotent; `node --check`; function count unchanged. Merge + deploy
  commands at the end (note any migration that must follow/precede the deploy —
  the trigger change is DB-only and safe to apply immediately).
