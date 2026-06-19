# Claude Code prompt — CONNECTIVITY #7: make owner resolution self-healing (close the re-accrual loop)

> From the recursive-connectivity audit (2026-06-19). The one-time owner-resolution backfills
> (#2 dia, #4 gov) cleared the existing 2,838 + 1,769 unresolved owners — but there is **no
> steady-state mechanism that resolves NEW recorded-owner-backed properties**, so the gap will
> slowly rebuild as ingestion continues. Everything downstream already self-heals (the
> bridge-eligible cron, the mirror-reconcile cron, the classified/entity-sync cron). This closes
> the one non-self-healing link with the same gated cron pattern. Receipts-first; gated; capped;
> reversible; reuse the resolvers already built — do NOT fork.

## Grounding (measured live 2026-06-19)
- **dia is propagate-only.** Trigger `properties_resolve_true_owner_biu` →
  `trg_properties_resolve_true_owner_from_recorded` (BEFORE INSERT/UPDATE) only copies a
  recorded_owner's EXISTING `true_owner_id` onto the property. When the recorded_owner is itself
  unresolved (`true_owner_id IS NULL` — the common case for a NEW owner), it does nothing, and
  nothing find-or-creates. This is exactly what produced the 2,838 backlog.
- **gov has no resolution trigger at all** (only `recorded_owners_canonicalize_biu` /
  metadata). gov resolution happens in the JS ingestion pipeline; the 1,769 backfilled were
  captures where it didn't resolve. New unresolved captures re-accrue.
- **Downstream is already self-healing** (do NOT touch): `lcc-bridge-eligible-fire/finalize`
  (every 4h, auto-bridges new in-use owners — verified running), `lcc-mirror-reconcile-*`
  (daily), `lcc-entity-sync-*` (classified enrichment). The resolvers from #2/#4 also already
  exist: dia `dia_resolve_canonical_true_owner_id` (find-or-create) + the `dia_is_artifact_owner_name`
  guard; gov `gov_connectivity4_resolve_owners(p_limit, p_dry_run)` (already capped/drainable:
  find-or-create + set `properties.true_owner_id` + provenance rank 35 + the
  `gov_connectivity4_resolution_log` ledger + `gov_is_artifact_owner_name` guard).

## Unit 1 — gov steady-state (nearly free: schedule the existing #4 resolver)
`gov_connectivity4_resolve_owners` already does everything a steady-state sweep needs (capped,
fill-blanks, artifact-guarded, provenance + ledger, reversible by `source='connectivity4_recorded_resolution'`).
- Schedule a **gentle** cron `gov-owner-resolution-sweep` (e.g. daily, or every 6h offset
  BEFORE the bridge cron's :50) calling `gov_connectivity4_resolve_owners(p_limit:=<cap>,
  p_dry_run:=false)` with a per-tick cap (e.g. 200) — gentle cadence per the connection-
  exhaustion lesson (NOT every-5-min). New unresolved recorded-owner-backed gov properties get
  resolved each tick; the existing bridge cron picks them up next.
- If `gov_connectivity4_resolve_owners` only targeted the original backfill scope, confirm its
  WHERE re-selects ANY current in-use unresolved property (not a frozen list) so it keeps
  finding new ones; adjust minimally if needed.

## Unit 2 — dia steady-state (small sweep wrapper)
#2 may have resolved inline (one-shot) rather than leaving a reusable drainable function. Add a
**`dia_resolve_recorded_owners_sweep(p_limit int, p_dry_run boolean default true)`** that mirrors
#2's logic exactly: select in-use unresolved recorded_owners (referenced by ≥1 property,
`true_owner_id IS NULL`, not merged) whose `name` PASSES `dia_is_artifact_owner_name`, cap to
`p_limit`, call `dia_resolve_canonical_true_owner_id(name)`, set `recorded_owners.true_owner_id`
(the existing property trigger then propagates to properties). Tag minted true_owners
`source='connectivity2_recorded_resolution'` (reuse #2's tag → the same REVERT runbook covers
sweeps). Then schedule a gentle cron `dia-owner-resolution-sweep` (daily or 6h, capped ~200,
offset before the bridge cron).
- Artifact names stay unresolved (routed nowhere new — they're already excluded from the bridge
  guard); do NOT mint a true_owner for them.

## Unit 3 — confirm the loop closes end-to-end
A new in-use recorded-owner-backed property, after one sweep tick + one bridge tick, should be:
resolved (`true_owner_id` set) → bridged (`external_identities(domain, true_owner)`,
`owner_role='unknown'`) → eligible for classified enrichment. Verify on a capped sweep that the
resolved owners actually flow through to the bridge.

## My gate (read-only, per domain)
- Capped first (dry-run then a small real tick): new/remaining in-use unresolved properties get
  resolved; 0 artifact names minted as true_owners; fill-blanks held (nothing pre-resolved
  overwritten, no merged row touched); reversible by the existing source tags + (gov) ledger;
  the cron is scheduled, active, gently-capped, and offset BEFORE the bridge cron.
- End-to-end: a sample of swept owners appears in the bridge (`external_identities`) on the next
  bridge tick — the loop closes.

## Guardrails
- Receipts-first; capped → gate → drain/steady; reversible; fill-blanks only; reuse the #2/#4
  resolvers + artifact guards + the existing bridge/mirror/enrichment crons — do NOT fork or
  hand-roll a second resolver. Gentle cron cadence (the 2026-05-29 connection-exhaustion lesson):
  daily or 6h with a per-tick cap, NOT high-frequency. ≤12 api/*.js (DB-side). Each domain's
  migration in its own repo (dia → Dialysis, gov → government-lease).
- Net: ingestion → resolution sweep → bridge → enrichment becomes a fully cron-backed
  self-healing pipeline, so the owner graph STAYS connected as new data arrives instead of
  requiring another manual backfill round.
