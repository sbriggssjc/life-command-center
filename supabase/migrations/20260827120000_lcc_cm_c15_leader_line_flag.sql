-- Feature-flags registry row for the CM native-chart c15 leader-line extension
-- (idempotent; safe to re-run). Round-3 item 2 regression: the per-dLbl c15
-- (Chart-2012) leader-line extension corrupts the CM Excel export (Excel
-- schema-rejects it -> "file is corrupt" / repair prompt), so its emission is
-- now gated behind CM_EMIT_C15_LEADER_LINES and DEFAULTS OFF. This keeps the
-- daily-briefing "Dormant Capabilities" section honest about the off feature.
insert into public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
values
  ('CM_EMIT_C15_LEADER_LINES',
   'Emit the per-dLbl c15 (Chart-2012) leader-line extension on floated CM chart data labels so Excel draws a leader from a moved label back to its point on line/bar charts.',
   'api/_shared/cm-native-chart-injector.js dLblXml',
   'CM_EMIT_C15_LEADER_LINES',
   'off', '2026-08-09', 'scott',
   'DISABLED by default: the current c15 structure corrupts the workbook (invalid c15:layout child in the per-dLbl c:ext; showLeaderLines/leaderLines emitted per-dLbl instead of at c:dLbls level). Labels still float via the valid plain c:layout offset; leaders are temporarily absent. Do NOT enable until Scott''s Excel-authored labelsample.xlsx supplies the exact valid target XML and its children are added to C15_EXT_ALLOWED_CHILDREN (the validateChartExtWhitelist gate rejects unvetted c15 children so a schema-invalid chart can never ship).')
on conflict (flag) do update
  set purpose = excluded.purpose,
      surface = excluded.surface,
      env_var = excluded.env_var,
      notes   = excluded.notes;
