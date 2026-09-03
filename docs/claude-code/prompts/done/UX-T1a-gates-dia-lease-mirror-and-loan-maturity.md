# UX-T1a-gates — make the queue's two coverage gates honest: dia lease dates into the mirror, loan maturity into the BD worklist (+ hide the plumbing bands)

> **Read first:** `docs/audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md` §4 (G3), §5 (G4), §7 (the
> surface today), §8 (why Part B stopped) · `docs/architecture/bd-ranking-and-priority-queue.md` (top
> banner) · `docs/os/canon/blocks/operator-doctrine.md` (1.8.0) · `supabase/migrations/20260812140000_lcc_w2_3_watermark_mirror_sync.sql`
> (how `lcc_property_attributes` is fed — ⚠️ read its "DISCOVERED PRE-EXISTING BLOCKER" note about dia
> anon-readability and re-measure whether P157 fixed it) · `supabase/migrations/20260911120000_lcc_p115_bd_worklist_decorrelate.sql`
> (`v_lcc_bd_worklist` shape) · `app.js:renderTodayBdActions` (the `loan_maturity` slot).

UX-T1a Part A stopped at two gates because the DATA the doctrine needs is not where the queue reads it.
Both are Class 2/20 shapes (a producer that exists in one domain and not the mirror; a slot rendered on
the home page that no view ever fills). This prompt closes both, then the queue (UX-T1a-queue) can be
built on honest gates. **Three units, each independently shippable and reversible. Measure → build →
verify on the state delta, per unit.**

## Unit 1 — UX-T1a-mirror-dia-lease: dia lease dates reach `lcc_property_attributes`

**Measured:** all 2,127 dia current facts read NULL for `lease_commencement` / `lease_expiration` /
firm term / term remaining in `lcc_property_attributes`; dia `leases` holds 3,823 future-dated leases
across 1,940 properties; `dia.properties.wavg_lease_expiration` is NULL on all 11,802.

1. **Find the break, don't assume it.** Does dia's `v_property_attributes_portfolio` (the mirror's
   source) expose lease columns at all? If yes, are they NULL at source (a dia-side derivation gap —
   `properties.*` lease columns never filled from `leases`) or dropped by `lcc_mirror_tick`'s `select=`
   list (the P113 `select=` trap)? If the view lacks them, **append** them (CREATE OR REPLACE is
   append-only for columns) derived from `leases` — the lease in effect today per property: prefer
   `superseded_at IS NULL`, commencement ≤ today ≤ expiration, longest remaining on a tie; carry
   `lease_source='dia_leases'` and `initial_term_years`. Positive-control the anon read
   (`SET LOCAL ROLE anon; select count(*)`) — the W2.3 note says dia views returned `[]` to anon;
   P157 flipped some to `security_invoker=off`; measure this one.
2. **Mirror fill-blanks only** (the existing COALESCE pattern), batch-tagged and reversible; drive the
   mirror explicitly for dia rather than waiting on the tick's cadence (the C2e lesson — a cron cap turns
   "mirror the set" into a lie for a week).
3. **Verify on the delta:** dia rows in `lcc_property_attributes` with a non-null `lease_expiration`
   **0 → ~1,900**; G3 re-run from the audit's §4 SQL — report dia's newer-lease count (expected ≈ 71 within
   first 3 years / 33 with 12+ remaining — if it differs, say why). Positive control: gov counts unchanged.

## Unit 2 — UX-T1a-debt: `loan_maturity` into `v_lcc_bd_worklist`

**Measured:** LCC Opps has no loan/CMBS table; gov `loans` 1,559 rows / 780 properties (170 maturing
≤24 mo), dia 660 / 424 (22), dia `v_loan_maturity_watch` (72 properties); `renderTodayBdActions` labels
`loan_maturity` and the view never emits it.

1. **Do not build a third loan store.** Add an anon-readable, non-PII **portfolio view** on each domain
   (`v_loan_maturity_portfolio`: property_id, maturity_date, original_amount, lender_name, source,
   updated_at — the same shape rule as the other `*_portfolio` views; `security_invoker=off`), and a
   mirror leg into a small `lcc_loan_maturity` table on the existing W2.3 keyset-tick pattern (its own
   leg in the mirror registry, watermark on `updated_at`). Fill-blanks, batch-tagged.
2. **Emit `loan_maturity` from `v_lcc_bd_worklist`** for owners with a maturity inside 24 months on a
   current holding, valued like the rest of the worklist, with the maturity date and months-to-maturity
   on the row. The slot is Significant/Important work by §0b.5 — it is a *reason to sell* the operator
   acts on, not plumbing. Keep `suspected_sale` / `owner_source_conflict` **unimplemented and say so in
   the view's comment** rather than half-filling them.
3. **Verify:** `v_lcc_bd_worklist` action_type distribution before/after (`ownership_chain` 3,534 ·
   `contact_writeback` 1,646 · **`loan_maturity` 0 → ~190**); the Today tile renders the new rows with
   the label the renderer already carries (C10: read the renderer's fields against the view's columns);
   named top-10 by value.

## Unit 3 — the plumbing bands leave the human surface (safe now, per the audit)

Hide **P0.4 `resolve_ownership_control` (555) · P-CONTACT (231) · P0.5 (148) · P-BUYER (22)** from
`v_priority_queue_enriched` / the Decision Center / Today **without deleting them** — they have automated
consumers (A2 cron 244; C1's `sf_link_candidate`; the Tier 0 lane). Implement as a `human_surface`
boolean on the band (a column, not a filter buried in a client) so the count the operator sees is
**694 seller-timing rows**, and record where each hidden band still runs. Honest counts: every badge
equals the rows shown.

## Discipline

Measure before build; state the denominator; unknown ≠ zero; no new name regex; fill-blanks, batch tag,
reversible, dry-run default; one owner per write; guards mutation-verified with comments stripped;
record `responses/UX-T1a-gates.response.md` with the three deltas first. Then UX-T1a-queue is unblocked.
