# Claude Code prompt — OPS: extend disk-size monitoring to dia + gov (close the LCC-only gap)

> From the operational-health audit (2026-06-18). The automation layer is HEALTHY (all three
> DBs: clean sizes, 0 real cron failures, retention + maintenance running). The one preventive
> gap: the disk-size alert that prevented the LCC auth-lockout incidents
> (`lcc_check_disk_health` + `lcc-disk-health-check`, hourly) is **LCC-only** — yet dia (5.5 GB)
> and gov (6.2 GB) are the LARGER DBs and have no disk-size tripwire. They don't host auth, so a
> disk-full there degrades the domain pipeline rather than locking out sign-in, but they should
> still alert before they hit the read-only cap. This is a small, additive, reversible mirror of
> the proven LCC pattern. Low urgency; no data risk.

## Grounding (measured live 2026-06-18)
- **LCC pattern to mirror:** `public.lcc_check_disk_health(p_warn_gb numeric DEFAULT 11,
  p_crit_gb numeric DEFAULT 12.5)` (SECURITY DEFINER) — computes `pg_database_size`, and at/above
  threshold opens a `disk_pressure` / `source='database_size'` row in `lcc_health_alerts` (with
  the top-5 largest tables in `details`), idempotent via NOT-EXISTS-open, auto-resolving when the
  size drops back. Cron `lcc-disk-health-check` runs it hourly.
- **Both domains already have the alert infra** (so this is just the missing check, not new
  plumbing): dia AND gov each have `public.lcc_health_alerts`, `v_lcc_health_alerts_open`,
  `lcc_check_cron_health`, and a `<domain>-cron-health-check` cron that already surfaces open
  alerts (+ the Teams push). A `disk_pressure` row written to the domain's `lcc_health_alerts`
  will flow to Scott automatically through the existing surfacing — **no new delivery wiring.**
- **Neither domain has a disk-health function or cron** (the gap). Current sizes: dia 5.5 GB,
  gov 6.2 GB.

## Unit 1 — mirror the check onto each domain (additive)
On **dia** (`zqzrriwuavgrquhisnoa`) and **gov** (`scknotsqkcheojiaewwh`), create
`public.<domain>_check_disk_health(p_warn_gb, p_crit_gb)` as a faithful mirror of
`lcc_check_disk_health` — same body, same `disk_pressure`/`database_size` alert shape into the
domain's own `lcc_health_alerts`, same idempotent-open + auto-resolve, same top-5-tables detail.
SECURITY DEFINER, `search_path=public`.
- **Thresholds:** Postgres can't read the provisioned disk cap (the LCC function carries this
  caveat). Determine each project's actual disk cap first (Supabase project/advisors, or the
  observed read-only point), and set `warn`/`crit` with headroom BELOW the cap. If the cap can't
  be confirmed, set conservative provisional defaults safely above current size (e.g. dia
  warn 8 / crit 9.5; gov warn 9 / crit 10.5 — both well above today's 5.5 / 6.2 with room) and
  **document them as provisional pending cap confirmation** (mirror LCC's own "raise after
  provisioning" note). Better a conservative tripwire than none.

## Unit 2 — schedule the crons
Schedule `dia-disk-health-check` and `gov-disk-health-check` hourly (offset from the existing
`<domain>-cron-health-check` so they don't collide), each calling the new function. Idempotent
(unschedule-then-schedule). The existing hourly cron-health-check + Teams push already surface
whatever lands in `lcc_health_alerts`, so once these write a `disk_pressure` row it reaches Scott
with no further wiring.

## Guardrails / gate
- **Additive + reversible** — new function + new cron per domain; drop the function and
  unschedule the cron to fully revert. No table changes, no data writes except an alert row when
  a threshold trips. No `api/*.js` change. Each domain's migration in its own repo (dia →
  Dialysis, gov → government-lease), mirroring the prior multi-repo connectivity work.
- **My gate (read-only):** each `<domain>_check_disk_health` exists and a manual call returns
  `severity='ok'` (both DBs are well under any sane threshold today, so it must NOT open a
  spurious alert); the two crons are scheduled + active + offset; thresholds are above current
  size with headroom and documented as provisional if the cap is unconfirmed; 0 spurious
  `disk_pressure` alerts opened by the gate run.
- Net: the disk-size tripwire that protects LCC now covers all three production DBs — the
  largest two (dia, gov) get the same early warning before they could ever hit a read-only cap,
  closing the one asymmetry the operational audit found.
