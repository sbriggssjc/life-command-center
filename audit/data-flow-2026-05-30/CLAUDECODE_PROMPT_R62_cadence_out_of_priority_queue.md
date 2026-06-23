# Claude Code — R62: scope cadence-due bands out of the Priority Queue (the queue is pursuit; the Cadence Dashboard owns outreach)

## Why (live Priority Queue audit, 2026-06-22)
The Priority Queue is fundamentally sound — the "DO THIS FIRST" hero correctly leads with the
highest-value actionable target (Boyd Watterson $169M, P-BUYER) and the touch/pursuit bands
(P-BUYER, P1–P5, P8) are cleanly value-ranked (0 rank-zero). The one problem is band
COMPOSITION: the single biggest band is **P7 `steady_state_cadence_due` = 565 rows, 99.6%
rank-zero** — unordered steady-state outreach cadences that **duplicate the dedicated,
value-ranked Cadence Dashboard** (R34, `v_bd_cadence_dashboard`, ranked by `rank_value`).

Doctrine (R25 two-cockpit model, extended): the **Priority Queue = BD pursuit** (open
opportunities, buyers, resolve ownership/contact); the **Cadence Dashboard = outreach
cadence** (value-ranked, with the draft/log-touch flow). Cadence touches should live on the
dashboard, not as 565 unranked rows bloating the BD queue. R62 removes the cadence-TOUCH
bands from the queue; nothing is lost — the cadences still exist, still advance, and remain on
the dashboard (which already shows ALL active cadences, no phase filter — R34).

Live band composition (LCC Opps `v_priority_queue_enriched`):
- **P7 `steady_state_cadence_due` = 565** ← remove
- **P6 `onboarding_step_due` = 1** ← remove (also a cadence touch)
- **P0 `developer_overdue` = 0 now** ← remove the branch (it's a cadence touch; keep it off)
- P-CONTACT `select_prospecting_contact` = 163 ← **KEEP** (connect-work: "pick who to
  contact" unblocks the cadence; it's a queue action, not an outreach touch)
- P0.4 / P0.5 / P-BUYER / P1–P5 / P8 ← unchanged (pursuit + ownership resolution)

## The change
1. **`v_priority_queue_live`** (LCC Opps) — drop the three cadence-touch band branches
   (`developer_overdue` → P0, `onboarding_step_due` → P6, `steady_state_cadence_due` → P7)
   from the band CASE/UNION. Leave every other band's predicate **byte-identical** (this is
   a removal, not a re-rank). Keep P-CONTACT. Refresh the materialized cache
   (`lcc_refresh_priority_queue_resolved()`); `v_priority_queue_band_counts` +
   `v_priority_queue_enriched` inherit the change with no edit of their own.
2. **`api/admin.js`** — drop `P0`, `P6`, `P7` from `BAND_ORDER` (the queue API + band detail).
3. **`ops.js`** — remove the P0/P6/P7 band chips + their card renderers and the in-queue
   cadence CTAs (the "Log touch" / "Draft email" actions that belonged to those bands) —
   those flows already live on the Cadence Dashboard (R34 Unit 4). Make the queue header's
   existing **"Cadence dashboard →"** link prominent so the operator knows where outreach
   cadence moved. No other band's rendering changes.
4. **Do NOT touch** the cadence engine, `advanceCadence`, the reachability gate (R10/R20), the
   contact-acquisition workers, or `v_bd_cadence_dashboard`. Cadences continue to exist,
   advance, and surface on the dashboard exactly as before — they're just no longer mirrored
   into the BD queue.

## Verify (report back)
- **No collateral:** every retained band (P0.4, P0.5, P-BUYER, P1, P2, P3, P4, P5, P8,
  P-CONTACT) has a **byte-identical** member set pre/post — prove it with an md5 of each
  band's ordered `entity_id` set before vs after. Only P0/P6/P7 disappear.
- Queue total drops by ~566 (≈1,654 → ≈1,088); the band chips no longer show P0/P6/P7.
- The Cadence Dashboard still lists those 565 steady-state cadences (value-ranked), and the
  draft → mark-sent → advance loop still works there.
- Reversibility: documented (re-add the three CASE branches → the bands return).
- `node --check` (admin.js, ops.js); `ls api/*.js | wc -l` = 12; suite green. The
  `v_priority_queue_live` migration is the cache-or-live-safe pattern (refresh the cache after
  apply); JS ships on the Railway redeploy.

## Out of scope (noted)
- P-CONTACT (163, connect-work) stays in the queue by design. If you later want the queue to
  be *pure* pursuit, P-CONTACT could move too — but it's a connect action that gates cadence,
  so keep it here for now.
- The P0.4 rank-zero tail (287 value-less owner-resolution rows) is honest (sorts NULLS-LAST)
  and shrinks as R59/R6 resolve owners — not part of R62.

## Bottom line
The queue stops mirroring 566 unranked cadence touches that the value-ranked Cadence Dashboard
already owns, so "Priority Queue" means BD pursuit again — highest-value opportunities and
ownership resolution first — while outreach cadence lives on its dedicated, ranked surface.
