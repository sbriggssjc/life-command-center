# Provenance conflict resolution UI + learning loop — scope

Companion spec to
`docs/architecture/data_quality_self_learning_loop.md` (Phases 1–4) and
`audit/R4_PROVENANCE_PHASE3_2026-05-20.md`. Defines the close-the-loop
work to make the 212 open provenance items reviewable from the LCC UI
and to seed the Phase-4 learning loop.

Status: scoped, not built.

## Problem

After R4-6:

- `v_field_provenance_conflicts` = 212 open items
  - 193 need a domain-DB backfill (the value rejected at log time is
    now the higher-trust source under the new registry)
  - 19 are real same-priority disagreements
- `v_field_provenance_actionable` (drives the existing Ops UI panel)
  filters to rules in `warn`/`strict` mode only — so most of the 212
  are invisible to the panel today.
- The panel is display-only: no "Pick a winner" action, no domain
  write-back, no record of human decisions to learn from.

Goal: surface every open item in one place, let a data steward
resolve it in one click, write the chosen value back to dia/gov,
and accumulate the resolution stream as labeled training data for
priority adjustment.

## Out of scope (deferred)

- Two-way Salesforce push of resolutions (Phase 2.6).
- Cross-record merges (e.g. property A vs B duplicate). This is
  field-level resolution only.
- Schema-validity check at write-back time (assume the registry's
  schema check already gated the rule).

## Data model additions

### `field_provenance_resolutions` (new, LCC Opps)

One row per human decision. Append-only; the audit trail of every
resolve click. Seeds Phase-4 learning.

```
id                       BIGSERIAL PK
resolved_at              timestamptz default now()
resolved_by              uuid                     -- workspace member
workspace_id             uuid
target_database          text                     -- dia_db | gov_db | lcc_opps
target_table             text
record_pk_value          text
field_name               text
current_provenance_id    bigint  REFERENCES field_provenance(id)
attempted_provenance_id  bigint  REFERENCES field_provenance(id)
chosen                   text CHECK (chosen IN
                                ('current','attempted','custom','junk','defer'))
chosen_source            text                     -- e.g. 'manual_resolution'
chosen_value             jsonb
decision_notes           text
domain_write_ok          boolean
domain_write_response    jsonb                    -- HTTP / error envelope
```

### `field_priority_proposals` (new, LCC Opps)

Surface for the weekly accuracy roll-up. One row per proposed
priority change; humans approve / reject from a separate UI list.

```
id              BIGSERIAL PK
proposed_at     timestamptz default now()
target_table    text
field_name      text
source          text
current_priority int
proposed_priority int
sample_count    int                              -- resolutions counted
accuracy_rate   numeric                          -- chosen / total
rationale       text
status          text CHECK (status IN ('open','accepted','rejected','stale'))
resolved_at     timestamptz
resolved_by     uuid
```

### `v_field_provenance_review_queue` (new view, LCC Opps)

The unified read surface for the UI. Union of:

- All open `v_field_provenance_conflicts` rows (regardless of enforce_mode)
- Plus skip rows from `v_field_provenance_actionable` (warn/strict only)

Each row carries: `provenance_id, target_*, record_pk_value,
field_name, attempted_*, current_*, attempted_priority,
current_priority, enforce_mode, bucket` — where `bucket` is
`{ 'still_tied' | 'conflicting_source_now_wins' |
'current_source_now_wins' | 'warn_skip' | 'strict_skip' }` so the
UI can default-sort by actionability.

Rows already resolved (existence of a `field_provenance_resolutions`
row for the same `(database, table, record_pk, field)` after the
provenance row's `recorded_at`) are excluded.

## Cross-DB write path

Each domain DB (dia, gov) gets one RPC:

```
public.lcc_apply_field_resolution(
  p_target_table   text,     -- 'properties' / 'leases' / ...
  p_record_pk      text,
  p_field_name     text,
  p_new_value      jsonb,
  p_workspace_id   uuid,
  p_resolved_by    uuid
) RETURNS jsonb               -- { ok, before_value, after_value, schema_ok }
```

Server-side:

1. Validate `p_field_name` is a real column on `p_target_table`
   (`information_schema.columns` lookup); reject if not.
2. SELECT the current value into `before_value`.
3. UPDATE the column. Type-cast based on `pg_catalog` column type
   (we already do this in the OM promoter).
4. Insert a new `field_provenance` row via the LCC Opps PostgREST
   proxy with `source='manual_resolution'`, `decision='write'`,
   `confidence=1.0`, `source_run_id` = the resolution id. This
   becomes the new current authoritative row.
5. Return before/after/ok envelope.

Called from LCC Opps via the existing `data-query` Edge Function
allowlist (add the new RPC name). Same auth path as today.

Failure modes:

- Schema check fails → return `schema_ok=false`, no UPDATE, surface
  in the UI with a "Schema drift — register this column" prompt.
- UPDATE fails (RLS, FK) → return `ok=false` + error message; UI
  marks the resolution row with `domain_write_ok=false` and surfaces
  the error. Resolver can retry.

## API surface (LCC Opps)

### `POST /api/entities?action=resolve_provenance_conflict`

Body:
```
{
  provenance_id:  <bigint>,      -- the field_provenance row being resolved
  chosen:         'current'|'attempted'|'custom'|'junk'|'defer',
  custom_value:   <any>,         -- required iff chosen='custom'
  notes:          <string>       -- optional reviewer note
}
```

Behavior by `chosen`:

| chosen | Domain write | Log changes |
|---|---|---|
| `current` | none | mark attempted row `decision='superseded'`, `superseded_by_id` ← current row id |
| `attempted` | write attempted_value to domain DB | new `manual_resolution` provenance row (becomes current); mark old current row `superseded`; mark attempted row `superseded` ← new row id |
| `custom` | write `custom_value` to domain DB | new `manual_resolution` row; mark both prior rows `superseded` |
| `junk` | none | mark attempted row `decision='superseded'` with reason `marked_as_junk`. UI follow-up proposes a regex addition to the relevant `isJunk*` filter — written to a `parser_filter_proposals` table (Tier C). |
| `defer` | none | tag with `decision_review_deferred_until = now()+7d`; row hidden from queue until then |

Always writes a `field_provenance_resolutions` row.

Authorization: must be a workspace member with role
`data_steward` (new role) OR `admin`. New role added to existing
`workspace_members.role` enum.

### `POST /api/entities?action=resolve_provenance_conflict&batch=1`

Bulk variant. Body takes an array of `{provenance_id, chosen}` (no
custom values). Caps at 100 per call. Each row writes its own
resolutions log entry — no bulk SQL update.

Use case: the 193 "conflicting_source_now_wins" rows after this
round. One bulk call per `(target_table, field_name)` pair from
the UI batch button.

### `GET /api/entities?action=quality_provenance_review_queue`

Replaces / extends `quality_provenance`. Returns:
```
{
  rows:           [<v_field_provenance_review_queue rows>],
  bucket_counts:  { still_tied: 19, conflicting_source_now_wins: 193, ... },
  proposals:      [<field_priority_proposals where status='open'>]
}
```

Existing `quality_provenance` stays for backward compat but is
deprecated; the Ops widget reads the new endpoint.

## UI changes (`ops.js`)

### "Provenance Conflicts" panel becomes "Provenance Review Queue"

Header gains a bucket-filter chip row:
`[All 212] [Need backfill 193] [Still tied 19] [Warn skips X]`

Each row's existing card grows three buttons:
`[Keep current]` `[Use incoming]` `[⋯]` where `⋯` opens a dropdown
with `Custom value`, `Mark as junk`, `Defer 7d`.

Top of panel gets a "Bulk resolve 193 backfill candidates" button
visible only when that bucket is non-empty. Clicking opens a modal
that lists the `(table, field, pair)` groups, lets the steward
confirm group-by-group, and fires one batch-resolve call per group.

### "Proposed priority changes" panel (new)

Below the review queue. Lists `field_priority_proposals` rows with
status `open`. Each card shows current → proposed priority, sample
count, accuracy rate, rationale. Buttons: `[Accept]` (applies the
priority change immediately) / `[Reject]` (closes without change) /
`[Mute 30d]`.

## Learning loop (Phase 4 seed)

### `compute_field_source_accuracy()` SQL function

Runs weekly (`pg_cron` Sun 04:00 UTC).

For each `(target_table, field_name, source)`:
1. Count resolutions in the last 90 days where this source was the
   *chosen* source (`chosen='current'` and source = current
   provenance row's source, OR `chosen='attempted'` and source =
   attempted row's source).
2. Count resolutions where this source was the *rejected* side.
3. `accuracy_rate = chosen / (chosen + rejected)`.
4. If `chosen + rejected >= 20` AND `accuracy_rate < 0.30`: emit a
   `field_priority_proposals` row bumping this source's priority
   number by 10 (less trust). If `accuracy_rate > 0.90` and the
   source isn't already at min priority: propose dropping its
   priority by 5 (more trust).
5. Skips `manual_resolution` source (it's the resolution itself,
   not a learnable source).

Proposals with same `(table, field, source)` already in `open`
status are deduplicated — only one open proposal per tuple at a
time.

### What we explicitly do not do

- Auto-apply priority changes. Always go through the proposal
  queue. Humans approve.
- Adjust `min_confidence`. Out of scope this round; the priority
  number is the dominant lever.
- Cross-field learning ("if source X is bad at year_built, also
  distrust it for lot_sf"). Each (table, field) is independent.

## Implementation tiers

### Tier A — single-row resolve (~1.5 days)

Files:

- `supabase/migrations/<ts>_lcc_field_resolutions_phase4_a.sql`
  → `field_provenance_resolutions` table,
  `v_field_provenance_review_queue` view, `data_steward` role
  added to the existing role enum.
- `supabase/migrations/dialysis/<ts>_dia_lcc_apply_field_resolution.sql`
  + `supabase/migrations/government/<ts>_gov_...sql`
  → `lcc_apply_field_resolution()` RPC, identical signatures.
- `supabase/functions/data-query/index.ts` allowlist gains
  `lcc_apply_field_resolution`. Deploy to Dialysis_DB (the
  existing data-query host).
- `api/_handlers/entities-handler.js`:
  `quality_provenance_review_queue` GET + `resolve_provenance_conflict`
  POST. Role check via existing `authenticate(req,res)` +
  `workspaceMember.role`.
- `ops.js`: replace the Provenance Conflicts widget body with
  the review-queue renderer + per-row resolver buttons. Bucket
  filter chips. Single-row only this tier.

Verification gate before merging:

1. Resolve 3 hand-picked rows from each bucket — confirm domain
   DB before/after matches the resolution log, confirm the
   resolved rows drop out of the queue, confirm the resolution
   row carries the right reviewer / workspace ids.
2. Confirm the role gate refuses a non-steward user.
3. Confirm an attempted RPC against a non-existent column returns
   `schema_ok=false` and writes no UPDATE.

### Tier A.5 — bulk resolve (~0.5 day, after ≥ 10 real single-row resolutions)

- Add `batch=1` mode to `resolve_provenance_conflict` (array
  of `{provenance_id, chosen}`, capped at 100, one resolution
  row per item, single DB transaction).
- Add the "Bulk resolve 193 backfill candidates" button. Modal
  groups by `(target_table, field_name)` and demands a
  per-group confirmation before firing the batch call for
  that group.
- Verification: bulk a single `(table, field)` group, confirm
  every row writes its own resolution log entry and one rolled-up
  failure in the group does not roll back the others (best-effort
  per-row commit).

### Tier B — learning loop (~1 day, after Tier A.5 has ~30 resolutions accumulated)

- `field_priority_proposals` table.
- `compute_field_source_accuracy()` SQL fn (idempotent rerun;
  uses the locked 20/0.30 + 0.90 thresholds from "Decisions").
- pg_cron job `lcc-priority-proposals` Sun 04:00 UTC.
- `ops.js` "Proposed priority changes" panel + `accept` /
  `reject` / `mute_30d` API actions on each proposal.
- Verification: hand-seed a `(table,field,source)` with 20
  resolution rows skewed 80% rejected; run the fn; confirm one
  proposal row appears; click Accept; confirm the priority
  bumps and the resolution snapshot is recorded on the proposal.

### Tier C — follow-ups (each ~0.5 day, scheduled separately)

- `Custom value` input on the resolver card (already covered by
  the API's `chosen='custom'` branch — purely a UI add).
- `Mark as junk` → `parser_filter_proposals` table + a CI check
  that posts a comment on PRs touching `isJunk*` regexes
  surfacing any open proposals.
- `Undo last resolution within 24h`: reads the resolutions log,
  inverts the domain-DB write, marks the resolution row with
  `undone_at` / `undone_by`.
- Tenant-canonicalizer affordance on still-tied rows where both
  values normalize to the same canonical form (would auto-resolve
  a chunk of the dia.properties.tenant ties).

## Decisions (locked 2026-05-20)

1. **Role gate** → resolution requires `manager` level via the
   existing `requireRole(user,'manager')` helper. Investigation
   during Tier A showed the existing `user_role` Postgres enum
   is `owner > manager > operator > viewer` (4-level linear
   hierarchy); adding a `data_steward` peer requires an
   ALTER TYPE plus `ROLE_LEVELS` changes that ripple into every
   handler. The effective scope is identical (`operator` and
   `viewer` users can't resolve; `manager`, `admin`, and `owner`
   can). A real `data_steward` permission is reachable as a
   Tier C add when finer-grained gating becomes worth the
   migration.
2. **`manual_resolution` priority** → priority 1, confidence 1.0.
   Equal to `manual_edit`. Subsequent ties between
   `manual_resolution` and `manual_edit` are real human-vs-human
   disagreements and should re-surface in the queue.
3. **Defer window** → fixed at 7 days. Re-deferring resets the
   clock; the resolutions log records every defer so habitual
   defers are visible.
4. **Proposal trigger** → 20 samples in 90 days + accuracy < 0.30
   for "bump priority up by 10"; accuracy > 0.90 for "drop
   priority by 5". One open proposal per `(table, field, source)`
   at a time.
5. **Tier A** → single-row resolve only. Bulk modal moves to a
   new **Tier A.5** that ships after the single-row workflow is
   proven against a small batch (e.g. 10–20 resolutions) of the
   real backlog. Until A.5 lands, the 193 backfill candidates
   stay in the queue.

## Risk register

- **Live data writes from a UI click.** Mitigated by the
  before/after envelope returned from `lcc_apply_field_resolution`
  and stored in the resolutions log — every change is reversible
  with one SQL statement. Add an "undo last resolution" surface
  in Tier C.
- **Reviewer fatigue.** If the queue grows faster than humans
  can drain it, batched resolutions hide context. Mitigation: the
  bulk modal forces a per-group confirmation, not a single click
  for all 193.
- **Schema drift.** A column the resolver tries to write may not
  exist (we've hit this twice already on field_source_priority).
  The schema-validity check inside `lcc_apply_field_resolution`
  catches it; the UI surfaces a "register this column first"
  affordance.
- **Two reviewers, one row.** Use the provenance row's `id` as an
  optimistic lock — if the row's `decision` is no longer
  `conflict`/`skip` when the resolution writes, reject with
  `already_resolved`.
- **Learning loop misfires.** A streak of bad CoStar refreshes
  could over-bump CoStar's priority. Mitigation: proposals require
  human approval; rejected proposals get a 30-day mute.

## Open questions for a follow-up session

- Should `field_provenance_resolutions` rows feed back into the
  matcher's `staged_intake_feedback` table so the matcher and the
  field-priority engine share one accuracy stream? (Probably yes,
  with a join key.)
- For the still-tied bucket where both sources are wrong (e.g.
  brand-canonicalization mismatch on tenant), should the resolver
  card surface a "Run the canonicalizer" affordance that calls
  `canonicalizeTenant()` on both values and shows the canonical
  form? Could auto-resolve a chunk of the tenant ties.
- Multi-workspace: today the registry is workspace-agnostic
  (`field_source_priority` has no workspace_id). The resolutions
  log will carry workspace_id. Do we want per-workspace priority
  registries eventually, or keep one global registry?
