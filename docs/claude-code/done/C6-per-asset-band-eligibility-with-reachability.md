# C6 — let a CURRENT HOLDING satisfy the seller-side bands, gated on reachability

**Read first:** `docs/architecture/connectivity-and-open-threads.md` §4o + §4p ·
`docs/audits/C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md` ·
`docs/audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md` (**§5b carries the sizing**) ·
Dead-End playbook **Class 22, 23, 24** · `CLAUDE.md` Consumption-Layer doctrine and the **P112**
reachability precondition.

This is a **one-view change on LCC Opps** (`xengecqvemvfknjvbvrq`). No JS, no new cron, no new table.

---

## 1. The defect, in one paragraph

`v_priority_queue_live`'s `gov_owner_props` CTE gates every gov deal-timing band on
`effective_owner_role = ANY (ARRAY['developer','user_owner'])`. That column is a **party-level
identity**; the bands ask a **per-asset question**. The CTE has **already joined
`lcc_entity_portfolio_facts ON is_current = true`** — the per-asset ownership fact — and then
discards it in favour of the global label. Consequences, all measured 2026-08-28:

- **`user_owner` is 0 of 66,874 live entities.** Half the gate has never matched a row (Class 22).
- **578 owners typed `buyer` hold a gov property with a lease expiring inside 24 months, $410.4M** —
  Boyd Watterson (45 gov assets), Prologis, RMR Group, HC Government Realty Trust. **Their labels
  are correct**; they are also the current owner of an expiring building (Class 24).
- **P1 shows 74 rows against 1,216 eligible gov properties.**

## 2. What to build

**In `v_priority_queue_live` only.** Replace the role predicate in **`gov_owner_props`** with:

> the entity holds a **current** gov asset (already true via the existing join) **AND** the owner is
> **reachable** — an `owner_contact_pivot` row with a non-null `active_contact_entity_id`.

Apply it to the four gov deal-timing arms that read `gov_owner_props`: **P1 `lease_expiry_24mo`,
P2 `firm_term_ending_24mo`, P3 `ten_year_window`, P8 `agency_active_solicitations`**.

### ⚠️ Do NOT touch `aged_props` / P5

Three independent reasons, all measured:

1. **P5 is 83% of the flood** — 58 → 1,681 under the naive rule.
2. **It is the weakest signal in the set** — "built 25+ years ago, not renovated in 15" describes a
   large share of the portfolio and implies no timing at all.
3. ⚠️ **`aged_props` is NOT gov-scoped** — it joins `lcc_entity_portfolio_facts` with **no
   `source_domain` filter**, so **it covers dia too** (26 → 565 dia rows). Changing it is a
   cross-domain change; nothing in this arc has been. **Leave the role gate on P5.**

### ⚠️ Reachability is load-bearing, not a nicety

Without it the same change emits **3,235 rows over 2,719 owners, of whom only 11% can be
contacted** — cadences that can never advance and only age into "overdue", which is the documented
**P112** failure. With it: **497 rows / 303 owners, every one callable.**

Reuse the existing reachability definition. **Do not invent a second one** —
`v_lcc_owner_reachability` already reports four definitions side by side and
**`reachable_hero_qualified` is the one this repo says to quote**. Read it before choosing;
`owner_contact_pivot.active_contact_entity_id` is the minimal form and may be what the view can
join cheaply. **State which you used and why.**

## 3. Predicted deltas — assert against these

| band | today | expected after |
|---|---:|---:|
| P1 `lease_expiry_24mo` | 74 | **149** |
| P2 `firm_term_ending_24mo` | 32 | **95** |
| P3 `ten_year_window` | 62 | **163** |
| P8 `agency_active_solicitations` | 76 | **213** |
| **the four together** | **244 rows** | **497 rows / 303 distinct owners** |

**Must NOT move:** P5 (58) · P0.4 (552) · P0.5 (148) · P-CONTACT (231) · P-BUYER (22) · P4 (12) ·
every dia row. **A prediction that matches is the evidence the change did what you think** — and
when it does not match, find the mechanism before adjusting either side (the A2 / C2e-T2a lesson;
T2a's 2-row miss was a real defect).

## 4. Discipline this repo requires

- **`CREATE OR REPLACE VIEW` is append-only for columns** — do not insert one mid-list (42P16). This
  change should add **no** columns.
- **Commit the WHOLE view body** in the migration. P194: *"read the live definition as the
  authority" is not a substitute for committing the view* — the next rebuild silently regresses
  otherwise. gov `CLAUDE.md` rule 12 is the mirror (running but not merged).
- **The queue reads a materialized cache** (`lcc_priority_queue_resolved`, refreshed every 5 min by
  `lcc-priority-queue-refresh`). Call `lcc_refresh_priority_queue_resolved()` after applying, or
  measure `v_priority_queue_live` directly — **and say which**, because comparing a fresh live view
  against a stale cache will look like the change did nothing.
- **Positive-control the zeros** (Class 11). Before believing "P5 unchanged", verify the detector
  can see a change at all.
- **Verify on the state delta**, never on "the view compiles".
- **Reversible:** the prior view body, verbatim, in the migration footer.

## 5. ⚠️ What this change does NOT decide

**Firing a band is not choosing the pitch.** `account-based-contact-intelligence.md` is explicit
that acquisitions and disposition are different contacts, tones and buckets, and that the buy-side
relationship is the funnel *into* the disposition conversation. This change makes the signal
**visible**; which bucket the call lands in is **C4a**, which is Scott's doctrine call and is
deliberately still open. **Do not add a bucket, a tone, or a prospecting-style column here.**

Also out of scope: **C4b** (whether `user_owner` gets a producer or comes out of the predicate),
**C4c** (broker assignment, ~2% — and ⚠️ three different user tables; go through
`lcc_cadence_point_person()`, never re-derive), **C4a** (what promotes an owner out of `unknown`).

## 6. Report back

- The four band counts before and after, against §3.
- The **unchanged** set, with the positive control that proves the detector works.
- Which reachability definition you used, and why.
- Whether you refreshed the cache or measured the live view.
- ⏰ **173 owners have a gov lease expiring within 90 days and are invisible today; 14 contactable.**
  After this change, how many of those 14 surface? ⚠️ **Do not assert any lease is terminal** —
  `lcc_property_attributes` carries a **date, not an outcome**; renewal, extension and holdover are
  indistinguishable in that column.
