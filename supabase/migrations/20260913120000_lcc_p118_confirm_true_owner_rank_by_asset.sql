-- ===========================================================================
-- P118 — the confirm_true_owner lane is value-ranked again
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- Consumption-Layer doctrine item 3: "surface actionable-only, VALUE-RANKED,
-- capped." This lane was ranked, but by the wrong quantity.
--
-- `lcc_refresh_decisions` seeded confirm_true_owner with
-- `rank_value := e.current_annual_rent_total` — the OWNER's portfolio rent
-- total. But a confirm_true_owner decision is about ONE asset: "is the domain
-- true owner of THIS property current, or stale?" When the owner entity has no
-- portfolio facts (very common — that is often *why* the owner needs
-- confirming) the rank was 0, and the row sank to the bottom of the lane.
--
-- Measured live before the change (status='open', the real openness test):
--   open confirm_true_owner ........................ 148
--   rank_value = 0 .................................  75  (51%)
--   ... of those, the ASSET's annual rent IS known ..  73
--   ... genuinely no value anywhere .................   2
--   annual rent sitting behind rank 0 .............. $194,149,982
--
-- All 73 are gov, median $810,599/yr at a median $34.86/SF — a sane federal
-- PSF, so the figure is not a unit error (the same cross-check used in P117).
--
-- FIX: fall back to the asset's own annual rent when the owner's portfolio
-- total is absent. A decision is worth at least the asset it concerns.
--   COALESCE(NULLIF(owner portfolio total, 0), this asset's annual_rent, 0)
-- Owner portfolio still WINS when present — an owner holding a portfolio is a
-- bigger conversation than any single building.
--
-- RESULT (verified live, after one lcc_refresh_decisions() run):
--   rank_value = 0 ....... 75 -> 2   (exactly the 2 measured as valueless)
--   median rank ..........  0 -> $498,431
--   top of lane .......... $23.7M, $19.6M, $17.1M annual rent
-- No backfill was needed: lcc_open_decision's ON CONFLICT DO UPDATE re-stamps
-- rank_value for an already-open row, and all 75 were still in the seed set.
--
-- SAFETY: rank_value drives ORDERING ONLY — it is not truth, no verdict, no
-- effect, no row created or closed. Reversible by re-running the pre-P118
-- definition (migration 20260608140000) and one refresh.
--
-- WHY THIS PATCHES THE LIVE DEFINITION INSTEAD OF PASTING A NEW BODY:
-- lcc_refresh_decisions is ~6.5k chars of supersede + seed logic owned by
-- 20260608140000 and later rounds. Re-pasting a full copy here would fork it,
-- and the two would drift on the next round. This rewrites exactly ONE
-- expression in whatever the current definition is, and RAISES if the anchor
-- text is not found -- so a changed base fails loudly instead of silently
-- no-op'ing (the "flag-gated no-op looks like a healthy pipeline" failure).
-- ===========================================================================

do $do$
declare
  v_old text := pg_get_functiondef('public.lcc_refresh_decisions'::regproc);
  v_new text;
  v_anchor text := 'e.entity_id, e.source_domain, e.source_property_id, NULL, e.current_annual_rent_total) AS id';
begin
  if position(v_anchor in v_old) = 0 then
    -- Already patched? Then this migration is a no-op, which is correct.
    if v_old ilike '%lcc_property_attributes a%' then
      raise notice 'P118 already applied - skipping';
      return;
    end if;
    raise exception 'P118: anchor not found in lcc_refresh_decisions - base definition changed, patch NOT applied';
  end if;

  v_new := replace(v_old, v_anchor,
    'e.entity_id, e.source_domain, e.source_property_id, NULL,
      COALESCE(NULLIF(e.current_annual_rent_total, 0),
               (SELECT a.annual_rent FROM public.lcc_property_attributes a
                 WHERE a.source_domain = e.source_domain
                   AND a.source_property_id = e.source_property_id),
               0)) AS id');

  if v_new = v_old then
    raise exception 'P118: substitution produced no change - refusing to replace';
  end if;

  execute v_new;
end $do$;

-- The scalar subquery above must never raise "more than one row returned".
-- Verified live: 0 duplicate (source_domain, source_property_id) keys in
-- lcc_property_attributes. This assertion keeps that true for any future apply.
do $chk$
declare v_dups int;
begin
  select count(*) into v_dups from (
    select 1 from public.lcc_property_attributes
    group by source_domain, source_property_id having count(*) > 1) x;
  if v_dups > 0 then
    raise exception 'P118: lcc_property_attributes has % duplicate (domain,property) keys - the rank subquery would raise', v_dups;
  end if;
end $chk$;
