# UX-T1a — the seller-first queue and the Today page, re-cut to the doctrine (measure first, then build)

> **Read first:** `docs/architecture/app-ux-review-2026-09-02.md` §0 + **§0b** (Scott's five answers —
> do NOT re-ask them) · `docs/os/canon/blocks/operator-doctrine.md` (1.7.0) · `CLAUDE.md` → *The
> operator doctrine for every surface* · `docs/architecture/owner-role-classification.md` §7/§9
> (`v_lcc_entity_roles`) · `supabase/migrations/20260522200000_lcc_priority_queue_view.sql` +
> `20260522300000_…_bands_p1_p3.sql` (the current bands) · `api/_shared/cadence-engine.js`
> (`PROSPECTING_SEQUENCE`, `TIER_MULTIPLIERS`, `COOLDOWNS`) · the UX1 finding in `PLANNED-BACKLOG.md`
> §P16 (the outreach tile) · `docs/audits/C11_CALL_SHEET_CONTACT_BASIS_2026-08-31.md` (what a call-sheet
> row must carry).

The home page and `v_priority_queue` were built band-by-band from audit findings. Scott's doctrine says
what the queue IS: **seller prospecting, ranked by client value, delivered as today's tasks inside a
cadence, split Significant / Important / Urgent** — and buyer-contact plumbing leaves the human surface.
This prompt is **Part A measure, Part B build**, and Part B is shaped by what Part A finds. Do not skip to
B.

## Part A — measure the population each doctrine gate admits (no writes)

Build the seller-prospect candidate set as a **dry-run SQL/report**, one gate at a time, and record the
count and the top-10 named rows after EACH gate (P182: a gate that admits everything or nothing is a bug
signal). Value is per **property sale**, never per owner rent (§0b.3).

1. **Universe:** current holdings in `lcc_entity_portfolio_facts` (`is_current`), joined to the property's
   estimated value. State which value you used — `lcc_property_attributes` price/rent-derived value,
   `latest_sale_price`, or NOI ÷ a swimlane cap — and how many rows have NONE (P180: unknown is not $0;
   report `value_unknown` as its own bucket, never drop it silently).
2. **Band:** individual-property value **$2.5M–$25M**. Count in / below / above / unknown.
3. **Newer lease (§0b.1) — relative to the swimlane standard term, not an absolute N.** Compute
   `years_elapsed_of_initial_term` and `years_remaining`. Dialysis: ≥12 remaining on a new build, 7–10 on a
   retrofit/backfill (`is_build_to_suit` / year_built vs lease commencement decides which shape); gov:
   **firm** term remaining via `gov_firm_term_fields` (§23 of the gov `CLAUDE.md`) — firm is gov-only.
   Report how many candidates have NO lease term on file (this is the §23–27 tail; it is a coverage bucket,
   not a disqualifier — label it `term_unknown`).
4. **Reason to sell (§0b.2) — the four D's, each mapped to data we HOLD.** Enumerate the signals available
   today and their coverage: *debt* (`loans`/CMBS maturity within 24 mo; `cmbs_loans`), *death* (individual /
   trust / estate-shaped owner name — use the RECORDED `entity_type` + existing guards, no new name regex),
   *divorce* (partnership / DST / TIC / fund in the owner name or structure — again existing detectors only;
   `lcc_is_spe_shell_name` etc.), *value creation* (developer role from `v_lcc_entity_roles`; a recent
   renewal/option/expansion in `gsa_lease_events` / `leases`; a sibling asset sold). **Report coverage per
   signal** — expect most to be thin; that thinness is a finding, not something to fix here.
5. **Not yet reached (§0b.4):** no `activity_events` touch by ANY team member, AND no `touchpoint_cadence`
   row / no open `bd_opportunities`. Count `never_touched` vs `in_pipeline_untouched` vs `touched`.
6. **The intersection** = the seller-prospect queue. Report its size, value distribution, and the top 25 named
   rows with the gate each passed. ⚠️ If it is under ~50 rows, say so plainly and show which gate did it —
   that is the honest input to the decision, not a reason to loosen a gate silently.

Also measure the current surface against the doctrine, each as a number:
- `v_priority_queue` bands today: how many rows per band, and **which bands are buyer/plumbing work**
  (P-BUYER, P-CONTACT, agency-drift/provenance lanes) vs seller prospecting.
- Cadence vs §0b.4: `PROSPECTING_SEQUENCE` sums to **67 days** for 7 touches; the doctrine says **6
  months**. Report the observed median gap between consecutive touches on live cadences, and how many
  accounts exceed 1 touch/quarter vs fall under it, split by role (`v_lcc_entity_roles`: developer /
  investor_owner / one_off_owner / former_owner).
- The Today page: which tiles exist, what each reads, and which are Significant / Important / Urgent by
  §0b.5 (the C10 lesson: read the renderer's fields against the view's columns).

**Write Part A up as `docs/audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md` BEFORE any code.** If any
gate cannot be computed from data we hold, name it as a coverage gap and stop at that gate.

## Part B — build (shaped by A)

1. **`v_lcc_seller_prospect_queue`** — the doctrine's queue as ONE view over the spine: the gates above as
   COLUMNS (`in_band`, `newer_lease`, `newer_lease_basis`, `reason_to_sell[]` with the D it belongs to,
   `reach_state`), value per property, and a `rank_value` that is **client value first, then recency of
   the lease**. Unknowns are their own states (`value_unknown`, `term_unknown`), never false. Read on
   named rows before wiring. `not materialized` where a point query needs it (C13b §7.7); profile with
   the handler's real ORDER BY.
2. **Today = the day's tasks only, in three sections** (§0b.5): **Significant** (seller-prospect touches
   due today from the cadence, ranked by `rank_value`) · **Important** (BOV/ELA/listing-marketing tasks
   due) · **Urgent** (deal correspondence and pipeline actions due ≤ 90 days). Each section states its
   question in one line. Nothing appears that is not due today; the count on each section is the count
   of rows shown (honest counts).
3. **Buyer/plumbing leaves the human surface:** P-BUYER, P-CONTACT and the provenance/agency-drift
   lanes are removed from Today and from the human bands; they already have automated consumers
   (C1's `sf_link_candidate`, PR8's lanes). Do not delete the bands — hide them from the operator
   surface and note where they still run.
4. **Cadence reconciliation:** propose the sequence spacing that yields 7 touches in ~6 months and the
   role-based steady state (developer/large holder ≈ monthly; investor_owner ≈ quarterly; one_off /
   former ≈ 1–2/yr). **Propose, with the measured delta from Part A; do not change spacing in this
   prompt** — cadence advance has a single owner and the change deserves its own reversible round
   (UX-T1a-cadence).
5. **Guard:** the view's gates are named columns (a test asserts each gate name exists and that
   `value_unknown`/`term_unknown` are distinct states); the Today renderer reads only columns the view
   has (the C10 shape); comments stripped; mutation-verified; report RED counts.

## Discipline

Measure before build; state the denominator; unknown ≠ zero; no new name regex (use recorded facts and
existing guards); no cadence spacing change here; no producer without a consumer; every count on a tile
is the count of rows the tile shows. Record `responses/UX-T1a-seller-first-queue-and-today-recut.response.md`
with the Part A table first.
