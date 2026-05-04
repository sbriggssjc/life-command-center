-- Capital Markets Phase 0 — follow-ups (Briggs broker pattern + cap_rate_by_lease_term)
--
-- Two small additions discovered while inspecting the actual gov sales table
-- and the master workbooks:
--
-- 1. The L. BROKER column in gov / dialysis sales is "; "-delimited and Scott's
--    AVERAGEIFS uses three NM patterns: 'Northmarq' OR 'SJC' OR 'Briggs'.
--    Sample row in Sold tab confirms: L. BROKER = 'SJC; Briggs'. Adding the
--    'Briggs' pattern. Also documenting that match_pattern is matched
--    against the WHOLE broker field (not split tokens), so '%Briggs%' will
--    catch 'SJC; Briggs', 'Briggs', and any future combinations.
--
-- 2. The gov master 'All Charts' tab has a chart we missed in the initial
--    catalog: cap rate split by remaining lease-term bucket (10+yr, 6-10yr,
--    <5yr — cols O, P, Q). This is its own template, not a subspecialty
--    of cap_rate_by_credit (which uses Federal/State/Municipal as dim).
--    Adding cap_rate_by_lease_term as a Phase 1 chart template.
--
-- Mirror updates already landed in:
--   - public/reports/cm_chart_catalog.json
--   - public/reports/CAPITAL_MARKETS_ARCHITECTURE.md (BN-column root cause)

------------------------------------------------------------
-- 1. Add Briggs broker pattern
------------------------------------------------------------
insert into public.cm_nm_broker_patterns (match_pattern, effective_from, effective_until, notes) values
  ('%Briggs%',  date '2002-01-01', null,
   'Scott Briggs personal name. Appears in CoStar both standalone and combined as ''SJC; Briggs'' or ''Northmarq; Briggs''. Confirmed via gov.Sold sample row L. BROKER = ''SJC; Briggs''. Caveat: ''Briggs Freeman'' (Texas commercial brokerage) and other Briggs-named firms could trigger false positives — Phase 1 will validate against the live data and tighten the pattern if needed.')
on conflict (match_pattern) do update
  set effective_until = excluded.effective_until,
      notes = excluded.notes;

------------------------------------------------------------
-- 2. Add cap_rate_by_lease_term chart template
------------------------------------------------------------
insert into public.cm_chart_catalog
  (chart_template_id, name, chart_type, data_shape, metric_focus, y_format_token,
   applies_to_verticals, subspecialty_friendly, view_name_template, phase, notes) values
  ('cap_rate_by_lease_term',
   'Cap Rate by Remaining Lease Term',
   'LineChart',
   'time_series_quarterly_by_dim',
   'cap_rate',
   'percent_basis_points',
   array['gov','dialysis'],
   true,
   'cm_{vertical}_cap_by_term_q',
   1,
   'Gov has this directly in the master workbook as 3 buckets (10+yr, 6-10yr, <5yr) keyed off lease_expiration - sale_date. Cols O/P/Q on All Charts tab. Dialysis can mirror once we lock the bucketing convention.')
on conflict (chart_template_id) do update
  set name = excluded.name,
      chart_type = excluded.chart_type,
      data_shape = excluded.data_shape,
      applies_to_verticals = excluded.applies_to_verticals,
      subspecialty_friendly = excluded.subspecialty_friendly,
      view_name_template = excluded.view_name_template,
      phase = excluded.phase,
      notes = excluded.notes;

------------------------------------------------------------
-- 3. Document broker-field semantics on cm_nm_broker_patterns
------------------------------------------------------------
comment on table public.cm_nm_broker_patterns is
  'Editable Northmarq attribution rules. The is_northmarq_brokered GENERATED '
  'column on each vertical''s sales table evaluates EXISTS (SELECT 1 FROM '
  'cm_nm_broker_patterns p WHERE sales.broker ILIKE p.match_pattern AND '
  'sale_date BETWEEN p.effective_from AND p.effective_until). Note: the '
  'broker field in gov/dialysis sales tables is "; "-delimited (e.g. ''SJC; '
  'Briggs'') — ILIKE handles this naturally since each pattern uses %wildcards%. '
  'Add new producers/firms via INSERT, no code change required.';
