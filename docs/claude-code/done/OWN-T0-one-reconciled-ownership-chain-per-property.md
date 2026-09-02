# OWN-T0 — the property panel shows several ownership stores and reconciles none of them; measure the disagreement, then give the panel ONE chain

> **Scott, 2026-09-02, on UX23:** *"almost every property I open seems to have similar errors —
> gaps or lapses in owners, even conflicting on the property's own ownership history tab, like no
> reconciliation is occurring."* He is right at population scale, and the instrument that should
> have said so reads zero. **This prompt measures the disagreement across every store the panel
> reads, fixes the one writer defect that manufactures it, and defines the single reconciled view
> the panel must read. It does not redesign the panel** (that is UX-T2/UX-T1d).

**Read first:** `docs/architecture/ownership-history-lane.md` (the subsystem) ·
`docs/architecture/property-owner-subsystem.md` + `property-owner-source-authority-and-doctrine.md`
(the ladder: manual > domain_true_owner > rel_purchase > sf_seller > rel_owns) · `CLAUDE.md` →
"`lcc_reconcile_property_owner` scores an ownership CHAIN as competing claims" (876 unresolved, the
recency floor) and P175a (`v_lcc_portfolio_ownership_conflict`) · `data-coherence-invariants.md`
(I1: one fact, one store) · `detail.js` / `detail-entity-tabs.js` — the Ownership tab renderer.

## 0. Measured 2026-09-02 (LCC Opps), before anything is built

```sql
with cur as (select source_domain, source_property_id, count(distinct entity_id) n
             from lcc_entity_portfolio_facts where is_current group by 1,2)
select count(*) filter (where n>1), count(*) filter (where n>2), count(*) from cur;
-- 756 · 33 · 8,068   → 9.4% of properties have >1 CURRENT owner
```

- `lcc_property_owner` (the resolved owner) **disagrees with the current portfolio fact on 667 of
  8,223 linked assets (8.1%)**.
- `v_lcc_portfolio_ownership_conflict` = **0 rows.** It detects P175a's ghost-vs-ENDED pair on a
  merged entity; it cannot see two LIVE entities both marked current on one property. **The
  standing detector is blind to the class the operator sees on every record.**
- `chain_2plus` is 178 fleet-wide (B1) — most properties hold ONE link, so a "gap" between the
  developer and the current owner is the DEFAULT state, not an error. The panel does not say so.

## 1. Measure — the disagreement matrix (deliverable §1)

The Ownership tab renders, side by side, some or all of: (a) `lcc_property_owner` (resolved
owner + confidence), (b) the domain's `properties.true_owner_id` (via `v_property_owner_facts_
portfolio`, with the P113 operator flag), (c) `lcc_entity_portfolio_facts` current + historical
rows, (d) gov `v_ownership_transitions_portfolio` / dia's equivalent-or-absent, (e)
`owner_contact_pivot` + the person edges (the "Contacts" block), (f) `lcc_property_owner_evidence`.
**Enumerate exactly which of these the renderer reads** (grep the tab, not the docs), then produce,
over ALL asset entities on both domains:

| pair | agree | disagree | one side missing | n |
|---|---:|---:|---:|---:|
| resolved owner (a) vs current fact (c) | | | | |
| resolved owner (a) vs domain true_owner (b) — excluding P113 operator rows | | | | |
| current fact (c): count of distinct current owners per property (1 / 2 / 3+) | | | | |
| latest transition grantee (d) vs current fact (c) | | | | |
| contact pivot (e) subject vs resolved owner (a) | | | | |

Read **ten named properties** across the disagreement cells — the Class-11 rule; a rate alone will
mislead here as it did on `repeat_buyer` (8×) and A5 (100%).

## 2. Fix — the ONE writer defect this measurement will almost certainly name

Two live entities both `is_current` on one property means **a later fact arrived and the earlier
one's `ownership_end_date` was never closed** — supersession is missing or not firing on the
feeder path (A2's rule: *every historical fact carries a non-null `ownership_end_date`*; the
gov-transition feeder and `lcc_finalize_entity_portfolios` each write current facts). Find the
writer(s) that insert a current fact without ending the prior current on the same
`(source_domain, source_property_id)`; make supersession the single owner of that transition
(date-ordered — the later `ownership_start_date` wins; **a tie or a missing date is a CONFLICT row,
never a guess**). Batch-reversible; dry-run first; predict the 756 → N delta and assert on it.
⚠️ Do not "fix" by deleting a fact (P175a: a ghost-vs-ended pair can be a genuine contradiction);
end-date it with provenance.

## 3. Define — `v_lcc_property_ownership_reconciled` (the ONE view the panel reads)

One row per (asset, link), from the developer/first owner to today, with: `owner_entity_id`,
`start`, `end`, `is_current`, **`source` per link** (transition / purchase edge / domain true_owner
/ manual), `confidence`, and three explicit states the panel must render as words rather than
silence: `gap` (no recorded link between two dated owners), `conflict` (two candidates for one
interval, both shown, neither chosen), `operator_not_owner` (P113). It reads the same evidence the
ladder scores; it does not add a fifth store. `detail.js`'s Ownership tab reads THIS and nothing
else; the other stores stay as evidence behind a "show sources" disclosure.

## 4. Fix the instrument

Extend `v_lcc_portfolio_ownership_conflict` (or add `v_lcc_property_multi_current`) so the 756
show up **before** §2 runs — positive control — and read 0 after, with the residual named (the
genuine ties). A detector that reads 0 over a 9% defect is the P182 class.

## 5. Do not

- No panel redesign, no new tabs (UX-T2). No new evidence source. No merges (P195/A2a own those).
- Do not touch the authority ladder's rungs; use it.
- Do not close a current fact on a name match — identity is by entity id through
  `external_identities`, never fuzzy (P138 doctrine).

## 6. Report back

- §1 matrix with the ten named rows; the writer(s) named with line refs; the supersession delta
  (predicted vs actual); the detector before/after; the view's column list and the diff of what the
  Ownership tab read before vs after. Guards: supersession mutation-verified; the panel's read is a
  single view name (a test that fails if a second store is queried by the tab).
