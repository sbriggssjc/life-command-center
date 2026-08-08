# Rent Intelligence Engine — Phase 5 Report: The Self-Improving Loop

**DB:** dia `zqzrriwuavgrquhisnoa` · **Repo:** life-command-center ·
**Branch:** `claude/rent-intelligence-phase-5-rxxzu9` · **Date:** 2026-08-08

> Phase 5 opens the self-improving loop. Its governing law — **the Ancestry Rule** — is the one thing
> that makes self-improvement safe rather than self-confirming, so it ships **first, applied live, and
> enforced in the existing reconcile loop**, before any new producer. The first concrete
> self-improvement unit (**5a, sale-cap derivation**) ships on top of it as the proof case.
>
> **This increment: the keystone (Ancestry Rule) + 5a, both applied live and proven.** The remaining
> units (5b–5e enrichment, 5f–5j self-improving loop) are **designed and grounded below** for
> subsequent reviewed increments — the responsible cadence for a live production financial database
> (dry-run-first · reversible · one reviewed increment at a time), which is this program's own
> doctrine.

---

## The Ancestry Rule (keystone — SHIPPED, applied live)

**Law:** no evidence item may corroborate, derive, or raise the confidence of anything in its own
provenance chain. Rent derived from a listing's cap can never validate that listing's cap; a cap
derived from timeline rent can never anchor the timeline year it was derived from; a projection is
never evidence. **Corroboration/derivation is legitimate only between provenance-INDEPENDENT items.**

Made mechanically checkable via a provenance graph:

- **`rent_evidence_provenance`** — directed edges (`derived` DEPENDS ON `source`). Node = `(kind, id)`
  where kind ∈ {`timeline`, `sale`, `sale_cap`, `listing`, `lease`, `bov`}. relation ∈
  {`derived_from`, `anchored_on`, `corroborated_by`}. `dia_record_provenance_edge(...)` is the
  idempotent writer.
- **`dia_provenance_parents(kind, id)`** — direct upstream nodes, combining the **explicit** edge
  table with the **implicit** provenance already carried in `property_rent_timeline` (evidence row →
  `lease`/`sale` via its `provenance` jsonb; projected row → its nearest-prior evidence anchor,
  matching builder semantics). This means the rule works on **all existing data with no edge
  backfill**.
- **`dia_ancestry_reachable(from, goal)`** — one-directional BFS over parents (depth-capped, visited
  set).
- **`dia_check_ancestry(evidence, target)` → boolean** — **symmetric independence test**: TRUE when
  evidence and target are provenance-dependent in *either* direction (one lies in the other's chain),
  or identical. Callers **skip + log** on TRUE.

> **Design note — why symmetric.** The two canonical hazards run in opposite directions: (5a/5f) the
> evidence *descends from* the target (a sale's own rent deriving that sale's cap); (reconcile) the
> evidence is an *ancestor of* the target (a listing corroborating a timeline row that was derived
> from it). Both are self-confirmation. A one-directional test caught only the first — the synthetic
> gate below is exactly what exposed it — so the check tests both directions.

**Enforced in the existing loop.** `dia_reconcile_rent_evidence` (Phase 3) previously raised
confidence on surrounding projected years without an independence check. The Phase 5 rebuild adds the
guard: the evidence node (via `p_source_ref.evidence_kind`/`evidence_id`) may not corroborate any
timeline row in its own chain; circular rows are excluded (`skipped_circular`), an all-circular
verdict is `skipped_ancestry`, and a surviving corroboration records a `corroborated_by` edge. Fork /
queue paths are byte-identical to Phase 3.

**Acceptance — proven both directions:**

| check | result |
|---|---|
| stated timeline row vs its own sale (`dia_check_ancestry`) | **TRUE** (circular) |
| stated timeline row vs an unrelated sale | **FALSE** (no over-blocking) |
| identity | **TRUE** |
| projected row → resolves to its *actual* nearest-prior anchor | precise (a lease, not the sale, when that is the true anchor) |
| reconcile gate — BLOCKED (listing the rows descend from) | verdict `skipped_ancestry`, raised **0**, `skipped_circular` **2** |
| reconcile gate — CONTROL (unrelated listing) | verdict `corroborated`, raised **2** |

The reconcile gate ran as a self-rolling-back synthetic transaction (RAISE after capture) → **0
residue**.

---

## 5a. Sale-cap derivation (SHIPPED, applied live — batch `phase5a_20260808`)

For sales **2016+, `sold_price>0`, `cap_rate_final IS NULL`** where the current rent timeline carries
rent at the sale year with **confidence ≥ 0.7**: derive `cap = rent_annual / sold_price` into the
existing recalc fields, **fill-blanks only** (so STATED caps are byte-identical), **ancestry-checked**
per candidate (the rent used may not descend from THIS sale), banded **[0.03, 0.15]** else queued.

- New distinct quality label **`derived_rent_timeline`** (CHECK constraint extended additively) so a
  derived cap never masquerades as verified/stated in the CM cap views. `rent_source` /
  `cap_rate_source` = `rent_timeline`; `cap_rate_method` = `rent_timeline_div_price_phase5a`;
  `cap_rate_confidence` = timeline conf≥0.85 → `medium` else `low`.
- Provenance edge `('sale_cap', sale_id) derived_from ('timeline', tid)` recorded per derived cap
  (148 edges), so future inverse-evidence (5f) built on these caps is blocked from re-corroborating
  its own timeline year.
- **Reversible:** `dia_sale_cap_derivation_log` (old values) + `dia_revert_sale_cap_derivation(batch)`.
  Dry-run default; idempotent (fill-blanks + method tag).

**Grounded live result:**

| metric | value |
|---|---|
| candidates seen (timeline rent conf≥0.7 at sale year) | **301** |
| derived | **148** |
| **skipped_circular (Ancestry Rule)** | **88** |
| queued out-of-band | **65** |
| usable (non-implausible) `cap_rate_final` caps | **2,757 → 2,875** |
| CM sold-cap-by-term chart new plottable dots | **+44** (35 term-bucketed) |

> The spec's "~475 sales / +22% density" was an ungrounded estimate; the figures above are the
> grounded truth. The Ancestry Rule is not theoretical here — **88 of 301 real candidates are
> self-anchored** (the sale's own `rent_at_sale` seeded the timeline year), and deriving their cap
> from that rent would be circular. Acceptance spot-check: skipped sales 44 / 56 / 84 each have a
> `stated` timeline row at the sale year whose `provenance.sale_id` equals the sale itself.

---

## Continuation — designed & grounded for the next increments

Each remaining unit is scoped to ship as its own reviewed, dry-run-first, reversible increment on this
branch. All call `dia_check_ancestry` in every derivation/corroboration path (violations skip + log).

- **5b — listing validation + fills.** (i) actives with stated caps: compute timeline-implied cap;
  divergence > 75 bps → `listing_cap_review` queue + Teams card; **never overwrite stated**. (ii) fill
  the capless actives via `cap_rate_method='rent_timeline'`. (iii) reconstructed listing views may use
  as-of implied caps only as a **labeled** quality tier. Ancestry: a listing-implied cap may not
  validate a timeline year that descends from that listing.
- **5c — term serving.** `v_dia_property_term_at_date(property_id, as_of)` → remaining firm term,
  `lease_phase`, options remaining, expiry, basis, confidence. Wire to exporter term buckets (modeled
  terms conf≥0.7, labeled) and comps-engine TERM inputs; report resolution of the undisclosed-term
  actives.
- **5d — structure read-model.** `v_dia_lease_structure_current` (bump_pct, interval, next_bump_date,
  options, basis, confidence). Comps exports read it. **No write-back** of fitted structure to
  `leases`/`lease_escalations` — documented evidence writes back only via the Phase 3 loop.
- **5e — lease comps serving.** `v_dia_lease_comps_enriched` → `generate_comps` / Briggs Lease Comps
  mapping. Input fields only; formula-protected columns untouched.
- **5f — inverse evidence (cap → rent).** Every `(price, cap)` pair is a rent observation. Extract
  implied rent = `price × cap` as `stated`-tier evidence at listing CREATION, stated-cap updates where
  the source is broker-stated NOI, and sales with a stated cap but no rent. Confidence tiered **below
  documents** (listing-implied ~0.6, sale-implied ~0.7); unit-normalize + sanity-gate through the
  Phase 3 path so garbage queues. **T9d price-only refresh stays unhooked** (a price move at constant
  stated cap restates cap expectations, not rent — document at the hook site). Ancestry: implied rent
  is blocked from corroborating its own listing/sale — **the reconcile guard shipped this increment
  already enforces exactly that** (proven by the CONTROL/BLOCKED gate above).
- **5g — BOV / diligence ingest hook.** When a BOV / underwriting workbook is built from diligence
  docs (rent roll, lease abstract), confirmed rent/commencement/term/bumps feed the timeline as
  **documented** evidence (provenance = `bov_id` + doc ref) through the Phase 3 reconcile path. Wire
  into the `bov-underwriting` output step and comps-engine verified-rent corrections. Every workflow
  that *learns* a rent teaches the system.
- **5h — convention auto-refit.** Quarterly job re-fits `tenant_lease_conventions` empirically (modal
  bump/interval per tenant, n≥20 structured leases), writing a **new versioned row** (`effective_from`)
  on material drift (>25 bps bump or interval change); never mutates history. FMC's flagged placeholder
  graduates when its n clears. Teams note on refit.
- **5i — propagation job.** Nightly, for each property whose timeline gained a version/confidence
  change since last run, re-derive dependent artifacts (5a caps, 5b implied caps, 5c terms) **for that
  property only** — bounded, provenance-tracked, ancestry-checked. The promulgation mechanic: one new
  OM improves every sale, listing, and comp that property touches by morning. (Round-trip acceptance:
  inject one OM on a multi-artifact property → next run its sale cap, listing implied cap, and term
  view all update with linked provenance.)
- **5j — learning metrics.** Extend `cm_dia_rent_coverage_*` + the packet/daily briefing with trend
  metrics: coverage-class deltas QoQ, research-backlog burn-down (tenant × state), corroboration rate,
  confidence-distribution drift, derived-cap population growth — one panel that shows the system is
  getting smarter quarter over quarter.

**Vertical portability.** The Ancestry Rule model (`rent_evidence_provenance` + `dia_check_ancestry`)
and the 5a derivation pattern are structurally identical for government reuse — swap `dia_*` for
`gov_*`, the timeline/sale tables for the gov equivalents, and reuse the same edge/BFS/skip-and-log
shape.

---

## Reversal / verification

- Revert 5a: `SELECT public.dia_revert_sale_cap_derivation('phase5a_20260808');`
- Ancestry re-check any pair: `SELECT public.dia_check_ancestry('timeline', '<tid>', 'sale', '<sale_id>');`
- Published CM cap views unchanged in definition; STATED caps byte-identical (fill-blanks on
  `cap_rate_final IS NULL`).
