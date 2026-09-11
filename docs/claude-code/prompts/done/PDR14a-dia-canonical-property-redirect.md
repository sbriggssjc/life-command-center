# PDR14a — one canonical, permanent redirect table for every dia property merge, past and future

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc — the code lives in the other repo, this repo just tracks the ask and the
response.

**Read first:** `docs/os/PLANNED-BACKLOG.md` §P17 PDR14 (this finding, measured 2026-09-11) · this is a
companion to `PDR14b-lcc-domain-property-reconciliation.md`, filed for the `life-command-center` repo —
read that one too, since PDR14a exists to feed it.

## Why this, why now

`life-command-center` (LCC) keeps a cross-domain `entities` table whose `metadata.domain_property_id`
points at a dia `properties.property_id`. When dia merges two property rows, the dropped id stops
existing — and nothing tells LCC. Measured 2026-09-11: **89 of 1,245 dia-linked LCC entities (7.1%)
already point at a deleted `property_id`.**

Investigating *why* surfaced the real problem this prompt fixes: dia has **five different, overlapping
tables** that record merge/consolidation history, none of them the single source of truth, none of them
covering everything:

| table | coverage found |
|---|---|
| `dia_property_merge_backup` | 588 rows, 2026-08-14 onward — explains 12 of the 89 orphans |
| `property_merge_log` | 656 rows, April–May 2026 — explains 11 of the 89 (its own `reconciled_lcc_at` column claims 100% reconciled, but LCC still shows stale pointers for every one of them — whatever it did, it didn't write back to LCC) |
| `p31_property_consolidation_log` | explains 5 of the 89 |
| `dia_property_consolidation_log` | checked, explains 0 of the 89 |
| `dq7_property_merge_map` | 19 rows, one batch, explains 0 of the 89 |

**28 of 89 explained across five separate tables. 61 have no trace anywhere.** Circumstantial evidence
(entity-creation timestamps clustering tightly around `property_merge_log`'s earliest entry, several
placeholder-named entities) points at early, pre-audit-log-era cleanup rather than ongoing loss — but
that is not certain, and per Scott's explicit direction, **the fix should not depend on ever nailing down
the exact cause of the 61.** It should make the system correct and self-monitoring going forward,
regardless.

## 1. One canonical, permanent redirect table

Create a single table — e.g. `dia_property_redirects` — that is the one place any consumer (LCC, a
report, a future script) checks to resolve a dropped `property_id` to its live survivor. Minimum shape:
`dropped_property_id`, `kept_property_id`, `merged_at`, `source` (which mechanism produced this row —
`geospatial_cron` / `strong_id` / `manual` / `backfilled_property_merge_log` / etc.), `reversed_at`
(nullable, mirrors the existing reversible-merge doctrine this repo already follows). Support **chained
resolution** — a property can be merged more than once over time (A→B, later B→C) — either via a
recursive lookup query/function or by keeping the table pre-flattened to always point at the current
live survivor (pick whichever this repo's existing merge functions can maintain more reliably, and say
which you chose and why).

## 2. Backfill it from all five existing ledgers

Populate `dia_property_redirects` from `dia_property_merge_backup`, `property_merge_log`,
`p31_property_consolidation_log`, `dia_property_consolidation_log`, and `dq7_property_merge_map` — every
row across all five, deduplicated, chained where the same property appears in more than one. This alone
should resolve the 28 of 89 already explained. Report the real count after backfill, not assumed.

## 3. Every current AND future merge/consolidation path writes here — no exceptions

Every function in this repo that drops a `properties` row in favor of another — the existing geospatial
`dia_auto_merge_property_duplicates` cron, PDR13's new `dia_merge_strong_id_twins`, and
`dia_merge_property_reversible`/`dia_unmerge_property` themselves (the shared machinery both detectors
already route through) — must write a `dia_property_redirects` row as part of the same transaction, and
remove/reverse it on unmerge. If `dia_merge_property_reversible` is the one shared function both
detectors call, the write likely belongs there once, not duplicated per-detector — confirm and use
whichever is actually correct for this codebase's structure.

## 4. Expose a resolver function

A single, well-tested SQL function or RPC — e.g. `dia_resolve_property_id(id) returns bigint` — that
takes any `property_id` (live or historically dropped) and returns the current live survivor, or the
same id back if it was never merged, or `null` if it truly no longer exists and was never merged (a
genuine hard delete, distinct from a merge). This is the function `PDR14b` (the LCC-side prompt) will
call.

## 5. What NOT to do in this pass

- Do not attempt to determine the cause of the 61 unexplained orphans through further historical
  archaeology — that investigation has already been done this session and the marginal value of more
  digging is low. Build the resolver to be correct going forward; the 61's specific cause is not this
  prompt's job.
- Do not touch `PDR2` (the LCC-side ownership guard-gap) — unrelated, filed separately.
- Do not change how `dia_auto_merge_property_duplicates` or `dia_merge_strong_id_twins` decide *what* to
  merge — this prompt only adds a durable record of merges that already happen, and a way to resolve
  them.

## Guard + ship

Mutation-guarded tests: a chained resolution (A merged into B, B later merged into C) correctly resolves
A → C, not A → B. A genuinely never-merged, still-live `property_id` resolves to itself. A truly
nonexistent id (never in `properties`, never in the redirect table) returns null, not a false match.
Positive control using three or four of the real backfilled cases from step 2 as fixtures. Confirm live
that `dia_resolve_property_id` correctly resolves at least the 28 explained orphans from this
investigation, and ideally the DaVita/Donna-TX case specifically (`37722`/`23545`/`37710` should all
resolve to `39874`).

## Ship + record

Branch name of your choice. Response saved to `life-command-center`'s `docs/claude-code/responses/` per
the usual convention, and please flag clearly whether `PDR14b` (the LCC-side prompt) can start once this
merges, or if the resolver's shape changed from what's described here in a way that affects it.
