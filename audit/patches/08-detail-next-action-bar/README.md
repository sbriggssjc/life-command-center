# Item #8 Phase A — Sticky next-action bar on detail.js

Pins the highest-value open gap for the current property to the bottom
of the detail panel. Companion to the Item #6 completeness rail.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/08-detail-next-action-bar
node audit/patches/08-detail-next-action-bar/apply.mjs --dry
node audit/patches/08-detail-next-action-bar/apply.mjs --apply
git add -A
git commit -F audit/patches/08-detail-next-action-bar/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/08-detail-next-action-bar -m "Merge audit/08-detail-next-action-bar: sticky next-action bar"
git push origin main
```

No SQL migration needed — reuses the existing `v_next_best_action` view
that's been live on dia + gov since Item #4.

## Smoke test

1. Hard-reload the app.
2. Open any property in the unified detail panel (click from the NBA Home
   rail, a list, or via search). Try one of each domain — dia + gov.
3. Confirm a sticky bar appears at the **bottom** of the panel showing:
   - **NEXT ACTION** label
   - Severity chip (CRIT / HIGH / MED / LOW, color-coded)
   - Suggested action text (e.g. "Research recorded owner for 1234 Main St")
   - Meta line: value estimate · target tab
   - "Take action →" button
   - Top border stripe color-matched to severity
4. Click anywhere on the bar (or the "Take action →" button) → the
   relevant tab activates (Ownership & CRM for owner gaps, Rent Roll for
   lease drift, Operations for CMS drift, etc.).
5. Open a property with **no open gaps** (rare — try a high-completeness
   government property with a full lease) → the bar should be hidden.
6. Confirm the bar is **sticky**: scroll the panel body and the bar stays
   pinned to the bottom of the viewport.

## How it works

Reuses `v_next_best_action` directly per-property:

```
GET /v_next_best_action?property_id=eq.<id>
   &order=gap_value.desc.nullslast
   &limit=1
```

This runs in parallel with the existing detail-load Promise.all (index 7),
so it adds zero latency to the open path. The view already encodes the
NOI ÷ cap_rate valuation (Item #4 v3) and the dedupe / junk filter
(v3.2), so the action text and severity reflect the same priorities as
the Home NBA rail.

Gap type → tab mapping:

| Gap type | Tab |
|---|---|
| `missing_recorded_owner` | Ownership & CRM |
| `llc_research_pending`   | Ownership & CRM |
| `lease_tenant_drift`     | Rent Roll |
| `orphan_sale_owner`      | Deal History |
| `stale_active_listing`   | Overview |
| `cms_chain_drift:*`      | Operations |

## What's next (Phase B follow-ups)

- Per-action inline workflows (e.g., open the SoS lookup directly from the
  bar for `missing_recorded_owner` rather than just routing to the tab).
- Multi-step action sequences for properties with several queued gaps —
  show the top 3 inline with a "next" affordance instead of just one.
- "Mark complete" button on the bar that records the action in
  `activity_events` and re-fetches the next-action.
