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

## 5f. Inverse evidence (cap → rent) — SHIPPED, applied live — batch `phase5f_20260808`

Every `(price, cap)` pair is a rent observation: **implied rent = price × cap**, entered as
**stated-tier evidence BELOW documents**. The builder's highest-confidence-per-year dedup guarantees
documented/higher evidence always wins — implied rent only anchors gap years and previously-empty
properties.

- **Three channels** (grounded populations): `listing_creation` (initial_price × initial_cap_rate,
  ~0.60), `listing_stated_cap_update` (last_price × last_cap_rate where
  `last_cap_rate_source='master_or_manual'` **and the cap actually changed**, ~0.60), `sale_cap_no_rent`
  (sold_price × stated cap where `rent_at_sale IS NULL`, ~0.70). **Our own 5a-derived caps are excluded
  at source** so a derived cap can never round-trip back to rent.
- **Ladder tiers** `('stated','listing_implied',0.60)` / `('stated','sale_implied',0.70)` — always below
  documents.
- **`dia_rent_implied_evidence`** — append-only tiered store (not written into `leases`/`sales`, which
  would inflate documented evidence). **`dia_build_property_rent_timeline`** reads it as a 4th source
  (Phase 2 body verbatim + one INSERT + implied-source provenance stamp).
- **Ancestry:** `dia_provenance_parents` extended so an implied timeline row resolves to its
  listing/sale source (`provenance.implied_source_*`). This closes the loop with the reconcile guard
  shipped in Increment 1 — an implied rent is blocked from corroborating/deriving its own source.
- **Sanity gate:** extraction is set-based and PSF-gated `[5,200]` — garbage goes to
  `rent_reconcile_queue`, never the store (and the builder re-gates on consume).
- **T9d price-only refresh stays unhooked** (documented at the hook site): a price move at constant
  stated cap moves cap expectations, not rent; `listing_stated_cap_update` fires only on a *changed*
  stated cap.

**Grounded live result:**

| metric | value |
|---|---|
| candidate `(price, cap)` pairs | **2,599** |
| stored implied evidence | **2,539** |
| PSF-gated → review queue | **60** |
| properties affected | **1,608** |
| properties with **no documented rent** that gained a timeline | **150** (159 implied stated rows now live) |
| remaining affected (documented-rent) | ~1,458 — implied evidence stored, absorbed on next rebuild (**5i boundary**) |

**Acceptance** (self-rolling-back gate, property 29984, 0 residue): rebuild landed an implied
listing-sourced row (year 2011, basis `stated`, conf 0.60); `dia_check_ancestry(that row, listing 10224)`
= **TRUE** → the listing is blocked from corroborating/deriving its own implied rent; documented DaVita
evidence still won its years.

**Reversal:** `SELECT public.dia_revert_inverse_rent_evidence('phase5f_20260808');` then rebuild affected
properties.

---

## 5b. Listing validation + capless fills — SHIPPED, applied live — batch `phase5b_20260808`

Timeline rent validates broker-stated on-market caps and fills capless actives — **stated caps are
never overwritten**, and every derivation is ancestry-checked.

- **Validation:** for on-market listings (canonical `v_dia_on_market`) with a timeline rent conf≥0.7,
  compute timeline-implied cap = `rent / asking_price`; divergence > **75 bps** → the
  `dia_listing_cap_review` lane (`v_dia_listing_cap_review_open` is the Teams card's source). Stated
  caps are queued, never mutated.
- **Capless fill:** truly-capless actives (NULL across `current/last/cap/initial_cap_rate`) get an
  implied cap in the **labeled `dia_listing_implied_cap` side tier** — never written into
  `available_listings` (trigger-safe; a derived cap never masquerades as stated). Surfaced via
  `v_dia_listing_cap_enriched` (`effective_cap` + `cap_tier` = `stated` | `rent_timeline_implied`) —
  spec 5b-iii's labeled quality tier for reconstructed listing views.
- **Teams card:** `api/_shared/dia-listing-cap-review-card.js` (`runListingCapValidation`) — a
  non-blocking, drop-in cron/route runner that invokes the SQL validator and posts one ranked card of
  the divergent reviews via the existing `sendTeamsAlert` pipeline.
- **Ancestry:** a listing whose current-year timeline rent descends from its own 5f implied evidence is
  skipped (self-validation blocked).

**Grounded live:** 145 on-market with timeline rent conf≥0.7 → **57 flagged divergent** (max 432 bps),
**1 truly-capless active filled** (candidates capless by only 2 columns carried a cap in `initial`/`cap`
and were correctly validated instead), **10 skipped by the Ancestry Rule**. **0 stated caps
overwritten.** Reversal: `SELECT public.dia_revert_listing_cap_fill('phase5b_20260808');`

---

## 5g. BOV / diligence ingest hook — SHIPPED, applied live

When a BOV / underwriting workbook is built from diligence docs (rent roll, lease abstract), or a
comps-engine run surfaces a verified rent correction, the confirmed rent/commencement/term/bumps feed
the timeline as **documented** evidence (provenance = `bov_id` + doc ref). Every workflow that *learns*
a rent teaches the system.

- **Ladder tier** `('contract','bov_confirmed',0.95)` — documented, just below a directly-executed
  lease, above OM/stated/implied.
- **`dia_bov_confirmed_evidence`** store; the builder reads it as a **5th contract-basis source** — BOV
  rent wins the highest-conf-per-year dedup over stated/implied/projected. An `implied_source_kind='bov'`
  provenance stamp ancestry-links the row.
- **`dia_ingest_bov_rent_evidence(...)`** — SQL entry point (ancestry-checked; rebuilds the property's
  timeline immediately). **`api/_shared/dia-bov-evidence-hook.js`** (`ingestBovRentEvidence`) is the
  non-blocking JS hook for the `bov-underwriting` output step + comps verified corrections. Reversal:
  `dia_revert_bov_evidence(bov_id)`.

No BOV/diligence table exists in dia today (BOV is skill-driven; the deal spine lives in LCC Opps), so
this ships the durable **entry point + documented channel**; grounded rows arrive when a BOV/comps run
calls the hook (the SOS/SAM "mechanism-ships-first" pattern).

**Acceptance** (self-rolling-back gate, property 21868, 0 residue): year 2015 projected (rent 135,046,
conf 0.70) → after BOV ingest **basis `contract`, rent 999,111, conf 0.95, `bov_confirmed=true`**;
`dia_check_ancestry(row, bov)` = TRUE. Documented BOV rent beat the projection.

---

## 5c / 5d / 5e. Serving layer — SHIPPED, applied live (read-only, no mutations)

- **5c — term serving.** `dia_property_term_at_date(property_id, as_of default CURRENT_DATE)` → remaining
  firm/total term, `lease_phase`, options total/remaining, firm & final expiry, `expiry_basis`
  (`lease_documented` | `convention_modeled`), confidence. Documented `lease_expiration` preferred, else
  convention-modeled. `lease_phase` + `options_remaining` derive from **one effective firm anchor** so
  all term fields are mutually coherent. Exporter term buckets + comps-engine TERM read this.
- **5d — structure read-model.** `v_dia_lease_structure_current` (bump_pct, interval, next_bump_date,
  options, expense_structure, basis, confidence) from the resolved tenant convention (authoritative
  decimals — no unit ambiguity). Comps exports read it; **no write-back** of fitted structure.
- **5e — lease comps serving.** `v_dia_lease_comps_enriched` (commencement, expiration, starting_rent,
  rent_psf_current, structure, rent_basis, rent_confidence) → `generate_comps` / Briggs Lease Comps.
  **Input fields only**; formula-protected columns computed downstream, untouched.

**Grounded live:** `v_dia_lease_structure_current` 10,808 rows; `v_dia_lease_comps_enriched` 4,789 rows;
**12 undisclosed-term on-market actives now carry a modeled term** via 5c. Read-only → ancestry N/A;
reversible via `DROP`.

---

## 5i. Propagation job — SHIPPED, applied live (the promulgation mechanic)

Nightly, for every property whose timeline gained a new version or a confidence (corroboration) change
since the last run, re-derive the dependent artifacts (5a caps, 5b listing implied caps) **for that
property only** — bounded, provenance-tracked, ancestry-checked. One new OM improves every sale,
listing, and comp that property touches by morning.

- The **5a/5b engines gained a `p_property_id` filter** (NULL = all; unscoped behaviour identical).
- **`dia_propagate_rent_intelligence(since default last-run, dry_run, limit)`** — selects changed
  properties, re-derives per property with per-property error isolation, logs the run to
  `dia_rent_propagation_log`. **pg_cron `dia-rent-propagation` @ `55 6 * * *`**; a baseline log row was
  seeded so the first run only processes changes from ship time forward (5a/5b already ran globally).

**Acceptance — the flagship round-trip** (self-rolling-back gate, property 22449, 0 residue): inject an
OM/BOV-confirmed rent → the timeline rebuilds → the next propagation run (scoped to the **1 changed
property**) derives the sale's cap (sale 73: `cap_rate_final` NULL → **0.07000**), records **1 sale_cap
provenance edge**, and the 2024 timeline row **ancestry-links to the BOV** (full OM → timeline → sale
cap chain); the 5c term view updates. This is exactly the specified promulgation acceptance.

---

## 5h. Convention auto-refit — SHIPPED, applied live — batch `phase5h_20260808`

Quarterly, re-fit `tenant_lease_conventions` empirically from structured `lease_escalations` (modal
**annualized** bump + median interval, n≥20). Material annualized drift (>25 bps) writes a **new
versioned row** (`effective_from`) — **history is never mutated**. The conventions stop being seeds and
start being findings.

- **Compare annualized rates.** A stored `10%/5yr` annualizes to 1.92%/yr, so raw-bump comparison would
  false-trigger; the interval is folded into the annualized rate (the sole material-change test).
- **`approved_standard` rows are curated:** a divergence is **surfaced** (Teams note +
  `dia_convention_refit_log`), never auto-overridden — only empirical/fallback rows get a new version.
- **`dia_refit_tenant_conventions(...)`** + **`api/_shared/dia-convention-refit-card.js`** (Teams note).
  **pg_cron `dia-convention-refit` @ `0 7 1 1,4,7,10 *`**.

**Grounded live:** **fresenius GRADUATED** — empirical_modal 0.017/1yr (flagged, n=324) → new
empirical_refit **0.0200/1yr** (n=541, un-flagged); the 1990 row preserved. **davita NO CHANGE** (10%/5yr
≡ 1.92% vs empirical 2.00%, 7.6 bps — no false trigger). **usrc DIVERGENCE SURFACED** (approved_standard
2.5% vs empirical 2.0%, 50 bps — human review, not overridden).

---

## 5j. Learning metrics — SHIPPED, applied live (one panel, QoQ)

Proof, on one panel, that the engine is getting smarter quarter over quarter.

- **`dia_rent_learning_metrics`** snapshot store + **`dia_capture_rent_learning_metrics(snapshot_date)`**
  — captures ~64 metrics per snapshot: coverage classes, derived_cap / usable_cap / implied_evidence /
  listing_implied_cap / bov_evidence / provenance_edges counts, timeline rows + properties, corroborated
  rows, confidence avg/median/≥0.7, basis mix, open review + reconcile queues, convention refits, and
  research backlog by tenant × state (top 40, dimension-tagged) for burn-down.
- **`v_dia_rent_learning_panel`** — the one panel: latest snapshot vs the prior, per metric, with `delta`
  + `pct_change` (QoQ). The packet / daily briefing read this view. **pg_cron
  `dia-rent-learning-metrics` @ `30 5 1 1,4,7,10 *`** (quarterly).

**Baseline snapshot (2026-08-08, 64 metrics):** evidence_timeline **4,466** (was 4,316 pre-5f),
derived_cap **148**, implied_evidence **2,539**, usable_cap **2,875**, provenance_edges **2,688**,
confidence avg **0.6302** / median **0.6500**, convention_refits **1**, listing_cap_review open **57**.
Deltas populate on the next quarterly snapshot.

---

## Program close-out — the engine is complete

All ten units (keystone + 5a–5j) are shipped and applied live to dia `zqzrriwuavgrquhisnoa`, each with
grounded counts and an acceptance gate. Every piece of information — a listing price/cap, a lease, a
sale, an OM, a BOV, a comp review — now yields a rent that propagates to every artifact tied to that
property, and the system gets smarter each pass:

- **The Ancestry Rule** (`dia_check_ancestry` + `rent_evidence_provenance`) governs every derivation and
  corroboration path — proven to fire on real data (88 self-anchored sales skipped in 5a; the reconcile
  self-confirmation hole closed).
- **Self-improving loop:** 5f (inverse evidence) + 5g (BOV/diligence) feed the timeline; 5h turns
  conventions from seeds into findings; 5i (nightly propagation) promulgates one new OM to every
  dependent artifact by morning; 5j proves the gains on one panel.
- **Enrichment / serving:** 5a (+148 derived caps), 5b (listing validation + labeled fills), 5c/5d/5e
  (term / structure / lease-comps read-models).

**Three new crons:** `dia-rent-propagation` (nightly), `dia-convention-refit` +
`dia-rent-learning-metrics` (quarterly).

**Vertical portability.** The Ancestry Rule model (`rent_evidence_provenance` + `dia_check_ancestry`),
the evidence-store + builder-consumption pattern (5f/5g), and the derivation engines (5a/5b) are
structurally identical for government reuse — swap `dia_*` for `gov_*`, the timeline/sale tables for the
gov equivalents, and reuse the same edge/BFS/skip-and-log shape.

---

## Reversal / verification

- 5a caps: `SELECT public.dia_revert_sale_cap_derivation('phase5a_20260808');`
- 5f inverse evidence: `SELECT public.dia_revert_inverse_rent_evidence('phase5f_20260808');`
- 5b listing fills: `SELECT public.dia_revert_listing_cap_fill('phase5b_20260808');`
- 5g BOV evidence: `SELECT public.dia_revert_bov_evidence('<bov_id>');`
- 5h refit: delete the new-vintage `empirical_refit` rows + the batch's `dia_convention_refit_log` rows.
- 5c/5d/5e serving views + 5j panel: `DROP` (read-only).
- Crons: `SELECT cron.unschedule('dia-rent-propagation' | 'dia-convention-refit' | 'dia-rent-learning-metrics');`
- Ancestry re-check any pair: `SELECT public.dia_check_ancestry('timeline', '<tid>', 'sale', '<sale_id>');`
- Published CM cap views unchanged in definition; STATED caps byte-identical (fill-blanks on
  `cap_rate_final IS NULL`); Phase 2/3/4 published series basis-labeled, unchanged.
