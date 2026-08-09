-- Round-3 item 2 (DEFINITIVE fix) — the CM native-chart c15 (Chart-2012)
-- data-label extension now mirrors exactly what Excel writes (empirically
-- confirmed against Scott's Excel-authored labelsample.xlsx): a per-dLbl <c:ext>
-- carrying ONLY <c15:showDataLabelsRange val="0"/>, plus a dLbls-level <c:ext>
-- carrying ONLY <c15:showLeaderLines val="1"/>. The three corrupt children that
-- broke the workbook (<c15:layout>, a per-dLbl <c15:showLeaderLines>, and the
-- <c15:leaderLines> stroke block) are removed. The structure is valid, so it is
-- no longer env-gated — the CM_EMIT_C15_LEADER_LINES flag / c15LeaderLinesEnabled()
-- gate were removed from the injector. The validateChartExtWhitelist gate now
-- whitelists exactly the two vetted children and rejects any other c15 child (and
-- any ext that mixes the two levels), so a schema-invalid chart can never ship.
--
-- Flip the registry row to 'on' and record that the capability is always-on
-- (no env var). Idempotent; safe to re-run.
update public.feature_flags_registry
   set state    = 'on',
       env_var  = null,
       off_since = null,
       purpose  = 'Emit the c15 (Chart-2012) data-label extension on CM chart labels: a per-dLbl <c:ext> with <c15:showDataLabelsRange val="0"/> and a dLbls-level <c:ext> with <c15:showLeaderLines val="1"/>, so Excel draws leader lines from floated labels back to their points and opens the workbook clean.',
       notes    = 'ALWAYS ON (no longer env-gated). Definitive round-3 item-2 fix: structure matches Excel''s own output (labelsample.xlsx). Corrupt children (c15:layout / per-dLbl c15:showLeaderLines / c15:leaderLines) removed; only <c15:showDataLabelsRange> (per-dLbl) and <c15:showLeaderLines> (dLbls-level) are emitted and whitelisted. validateChartExtWhitelist rejects any other c15 child or a mixed-level ext. Do not re-add custom leader strokes without a new empirical Excel test.'
 where flag = 'CM_EMIT_C15_LEADER_LINES';
