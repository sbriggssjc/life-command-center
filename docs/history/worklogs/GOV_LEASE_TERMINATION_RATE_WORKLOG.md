# Government Lease Termination Rate Worklog

## Objective
Rebuild `cm_gov_lease_termination_rate_m` and `_q` so active denominators come only from clean GSA snapshots, repair known partial `gsa_snapshots` / `gsa_inventory_snapshot_lines` months where source data is recoverable, and verify the 2018/2019 missing stacked-bar issue disappears.

## Constraints
- Government DB project: `scknotsqkcheojiaewwh`.
- Supabase view changes are live immediately; keep migration SQL in repo.
- Do not fabricate per-lease rows. If a partial snapshot month cannot be reconstructed from durable source rows, skip it in denominator logic and document the remaining source-data debt.
- Preserve existing view column contracts; append columns only if needed.

## Plan
1. Inspect live definitions, dependencies, and corrupt snapshot months.
2. Rebuild active denominator selection to use `clean_snap` / `snap_agg` rows only.
3. Repair source snapshots only when rows can be copied from an authoritative matching snapshot source.
4. Verify monthly and quarterly rows around 2018/2019 no longer contain the 11-lease dip.

## Progress
- 2026-08-11: Started from `CAPMARKETS_TAB_PACKET_WORKLOG.md` handoff and T8 prompt. The prior diagnosis shows `2019-02-28` used a raw `gsa_snapshots` month with only 11 distinct lease keys, while adjacent months are about 8,050 active leases.
- 2026-08-11: Live dry-run confirmed the clean-snapshot selector skips `gsa_snapshots` 2019-02 and carries the active denominator forward from 2019-01 (`total_active=8054`, `soft_term=2363`).
- 2026-08-11: Added and applied Government migration `supabase/migrations/government/20260811_cm_gov_lease_termination_rate_clean_active_snapshots.sql`. Monthly and quarterly termination-rate views now join `snap_agg` to `clean_snap` for active denominator selection. The migration also backfilled recoverable `gsa_inventory_snapshot_lines` rows for 2022-10 and 2022-11 from same-month `gsa_snapshots`, and annotated 2019-02 as requiring source re-ingest because both per-lease sources are partial.
- 2026-08-11: Verification passed live. `2019-02-28` changed from 11 active / 6 in-firm to 8,054 active / 5,691 in-firm. The full monthly view now has active inventory range 7,339–8,846 with zero sub-5,000 thin periods; 2018/2019 range is 8,047–8,193 with zero thin periods. 2022-10 line rows now match available same-month `gsa_snapshots` at 7,713; 2022-11 matches at 7,708. Header variance remains 1 and 6 rows respectively, requiring source re-ingest if exact header parity is required.
- 2026-08-11: Checked current frozen `cm_report_snapshots` gov packet (`Q2-2026`, frozen 2026-08-10). Its packet JSON flags `lease_termination_rate` as `Chart source fetch failed`, so the live view is the verification source for this fix; regenerate/refreeze the gov packet separately if the app is pinned to frozen packet output.
- 2026-08-11: Completed source re-ingest from official GSA fiscal-year lease inventory archives using a scoped local parser/upsert utility, then removed the downloaded archive artifacts and one-off utility from the worktree.
  - `2019-02-01`: official `February_2019_External_c.xls` parsed to 8,051 rows / 8,051 distinct leases. Live repair changed `gsa_snapshots` 11 -> 8,051 and `gsa_inventory_snapshot_lines` 0 -> 8,051.
  - `2022-10-01`: official `Oct_2022_External_C_(2).xlsx` parsed to 7,714 raw rows but 7,713 distinct lease numbers. The prior 1-row header variance was the duplicate lease key in the GSA source file, not a missing DB row. Header normalized to the per-lease table contract; `gsa_snapshots`, `gsa_inventory_snapshot_lines`, and `gsa_inventory_snapshots.record_count` now all equal 7,713.
  - `2022-11-01`: official `Nov_2022_External_(2)_C.xlsx` parsed to 7,714 raw rows but 7,708 distinct lease numbers. The prior 6-row header variance was duplicate lease keys in the GSA source file, not missing DB rows. Header normalized to the per-lease table contract; `gsa_snapshots`, `gsa_inventory_snapshot_lines`, and `gsa_inventory_snapshots.record_count` now all equal 7,708.
  - Independent live verification: `cm_gov_lease_termination_rate_m` now reads `2019-02-28` directly as 8,051 active / 2,357 outside firm term / 678 terminated TTM; neighboring months are 8,054 active. The chart/view carry-forward remains as protection for future corrupt snapshots but is no longer masking 2019-02 source debt.
