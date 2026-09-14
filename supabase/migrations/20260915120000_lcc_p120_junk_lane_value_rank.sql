-- ===========================================================================
-- P120 — the junk lane is value-ranked instead of identity-counted
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- Scott asked whether the junk_entity_name lane had a deterministic
-- auto-confirmable subset (the 45 pipe-composites) the way the property-twin
-- lane got one in P106. Measured live: it does NOT, and the measurement
-- redirected the work.
--
-- WHY NO SPLITTER: both prior rounds' notes describe the pipe-composites as
-- "<person> | <firm>". Live they are at least five different shapes:
--   brokerage office/branch  CBRE | Raleigh · SVN | Chicago Commercial   (18)
--   two-party composite      Chad Middendorf | Green Rock USA            (22)
--   REVERSED firm|person     Choice One Development, LLC | Michael Milone
--   firm | firm (JV)         American Real Estate Partners | Davidson Kempner
--   multi-party LIST         Paseo LLC | Property Acquisition Assoc LLC | …(2)
--   role label / empty       Office | Investment Specialist · "PCI |"     (3)
-- A blanket split would be wrong for most, and `CBRE | Raleigh` is not junk at
-- all -- it is a real broker office that happens to contain a pipe. And the
-- value gate settles it: **0 of the 45 own any asset.** Building a splitter for
-- them would be engineering against the doctrine's own value floor.
--
-- WHAT THE LANE ACTUALLY NEEDED: `rank_value` was `COALESCE(i.n,0)` -- the
-- external-identity COUNT. Verified exactly: rank_value ∈ {0,1,2,4} and equals
-- identity_count row for row. So the lane was ordered by "how many vendor ids
-- does this junk name carry", which is unrelated to whether it deserves
-- attention. Doctrine item 3: actionable-only, VALUE-RANKED, capped.
--
-- Measured live across the 164 open rows:
--   any real BD value (portfolio rent / owns assets / open opp) ....   7
--   nothing attached at all ....................................... 137  (84%)
--   portfolio rent across the lane ................................ $21.0M
--
-- New rank = portfolio rent (dollars dominate) + tiers for open opp (5000),
-- owns assets (1000), on cadence (100), in Salesforce (10), with
-- identity_count/10 kept as a sub-1 deterministic tiebreaker so the valueless
-- bulk still orders stably. The value components are also written into the
-- decision context so a card can show WHY it ranks where it does.
--
-- Ordering only: no verdict, no effect, no row created or closed.
--
-- NOTE: re-ranking is what EXPOSED the P117 bug fixed in P117a -- the top of
-- the lane immediately showed a junk placeholder holding $19.4M of portfolio
-- rent. A lane sorted by identity count would never have surfaced it.
--
-- Patches the live definition in place (see P118 for the reasoning); raises if
-- the anchor is missing so a changed base fails loudly.
-- REVERSAL: re-run the pre-P120 definition (20260608140000) + one refresh.
-- ===========================================================================

do $do$
declare
  v_old text := pg_get_functiondef('public.lcc_refresh_decisions'::regproc);
  v_new text;
  v_anchor text := $a$        'domain', e.domain, 'identity_count', COALESCE(i.n,0))),
      e.id, e.domain, NULL, NULL, COALESCE(i.n,0)) AS id$a$;
  v_repl text := $r$        'domain', e.domain, 'identity_count', COALESCE(i.n,0),
        'portfolio_rent', (SELECT sum(f.annual_rent) FROM public.lcc_entity_portfolio_facts f
                            WHERE f.entity_id = e.id AND f.is_current),
        'owns_assets', (SELECT count(*) FROM public.lcc_property_owner o WHERE o.owner_entity_id = e.id),
        'on_cadence', EXISTS (SELECT 1 FROM public.touchpoint_cadence t WHERE t.entity_id = e.id))),
      e.id, e.domain, NULL, NULL,
      COALESCE((SELECT sum(f.annual_rent) FROM public.lcc_entity_portfolio_facts f
                 WHERE f.entity_id = e.id AND f.is_current), 0)
      + CASE WHEN EXISTS (SELECT 1 FROM public.bd_opportunities b WHERE b.entity_id = e.id AND b.is_open) THEN 5000 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM public.lcc_property_owner o WHERE o.owner_entity_id = e.id) THEN 1000 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM public.touchpoint_cadence t WHERE t.entity_id = e.id) THEN 100 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM public.external_identities x WHERE x.entity_id = e.id
                            AND lower(x.source_system) IN ('salesforce','sf')) THEN 10 ELSE 0 END
      + LEAST(COALESCE(i.n,0), 9) / 10.0) AS id$r$;
begin
  if position(v_anchor in v_old) = 0 then
    if v_old ilike '%portfolio_rent%' then
      raise notice 'P120 already applied - skipping';
      return;
    end if;
    raise exception 'P120: anchor not found in lcc_refresh_decisions - base changed, patch NOT applied';
  end if;
  v_new := replace(v_old, v_anchor, v_repl);
  if v_new = v_old then
    raise exception 'P120: substitution produced no change - refusing to replace';
  end if;
  execute v_new;
end $do$;
