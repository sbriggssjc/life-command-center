# Prompt 72 — W8 U3 micro-fix: deed/activity evidence column names

**Grounding:** Scott's post-71 `?score=1&n=6` (2026-08-07). The 71 loud-error surfacing worked and
exposed the residual: EVERY gov chain candidate logs two scan_errors —
`column deed_records.id does not exist` (source `deed`) and
`column activity_events.activity_id does not exist` (source `activity`) — so chain
`evidence_sources` still reads `{sale_notes:1, deed:0, activity:0, intake:0}`. The 71 fix
live-validated the intake schema but not these two queries. Flag `W8_U3_LINK_PROPAGATION` is now
ON (Cowork, 2026-08-07): person_email arm is productive; chain arm is skip-marked, so fixed
evidence changes the hash and rows re-enter automatically.

## Do (small)

1. Query the LIVE schemas first (gov `scknotsqkcheojiaewwh` `deed_records`; ops
   `xengecqvemvfknjvbvrq` `activity_events`) for the actual pk/order/select columns; fix the two
   evidence queries in `gatherChainEvidenceBlocks` (`api/admin.js`). Also check the dia deed-source
   equivalent if one is wired.
2. While there: chain `intake` source hit 0 despite 7,713 `match_property_id` rows — the scored
   subjects were all gov; verify the intake match filter works for gov property ids (type/cast,
   domain qualifier) and isn't dia-only.
3. Re-verify per-source counts in a local/dry-run; add a regression test asserting the two queries
   select columns that exist (schema-pinned fixture or a select-list constant validated in test).

## Acceptance

- Re-run `?score=1` (chain candidates): scan_errors empty (or new honest errors), `deed`/`activity`
  per-source counts > 0 for properties that have deeds/activity, chain rows with real evidence get
  scored instead of assembly-skipped.

Commit with the repo Co-Authored-By + Claude-Session trailer.
