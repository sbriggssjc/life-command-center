# Claude Code (GovernmentProject) — auto-apply high-confidence property_id matches (stop discarding computed connections)

## Why (grounded live on the gov DB `scknotsqkcheojiaewwh`, 2026-06-26)

`pending_updates` is gov's matching-decision queue (a proposed write:
`table_name.field_name` `old_value`→`new_value`, with a `confidence` + `reason`).
It is leaking high-value, high-confidence connections via expiry:

- Status mix: **expired 3,355**, pending 2,257 (growing), auto_resolved 768,
  approved 137, rejected 7. The producer outpaces the human consumer, so updates
  **expire unworked** — the Consumption-Layer failure.
- The safe, high-value slice is **`field_name='property_id'`** (link a record to a
  property): 2,914 rows. The other classes are deliberately OUT of scope —
  `recorded_owner_id` (1,155, avg conf 0.60, 0 ≥0.90, ownership is sensitive per
  R51/R6), `_new_property` (597, CREATES rows), `lease_number` (897, no
  confidence).
- **Critically, `pending_ge_95 = 0` everywhere** — every high-confidence (≥0.95)
  property link has ALREADY expired. The system computed them and threw them away:
  **~496 sales→property + ~77 listing→property** at ≥0.95, all expired.
- Recoverable NOW: of the 496 expired ≥0.95 `sales_transactions.property_id`
  matches, **334 target sales are still unlinked (`property_id IS NULL`)** — real
  connections to restore (the other 162 got linked since → re-applying is a
  harmless no-op). Plus the ~77 `available_listings.property_id` at ≥0.95.

Scott's decision (2026-06-26): **threshold ≥0.95, retroactive + forward**,
`property_id` links only, on the safe target tables. Reversible (`old_value` is
recorded). dia is out of scope (this is a gov-pipeline issue).

## Scope guardrails (do NOT exceed)

- **Only `field_name='property_id'`**, and **only target tables
  `sales_transactions` and `available_listings`** (the two with a real ≥0.95
  population). Do NOT auto-apply property_id for `sam_lease_opportunities` /
  `gsa_leases` / `federal_lease_awards` (those had 0 at ≥0.95 — leave to the
  human/decision lane).
- **Only `confidence >= 0.95`.**
- **Never** auto-apply `recorded_owner_id`, `_new_property`, `lease_number`,
  `matched_*`, or any row that CREATES a record. Ownership + row-creation stay
  human-reviewed.
- **Fill-an-unlinked-FK only:** apply only when the target record's `property_id
  IS NULL` (don't overwrite an existing link — if it's already linked, mark the
  pending_update resolved as a no-op, don't clobber). This preserves the
  one-property-per-record / canonical-metric doctrine and can't create duplicate
  links.
- The target property must still exist (FK valid) — skip + log if not.

## Unit 1 — forward: auto-apply ≥0.95 property_id at match time (the durable fix)

Find the producer that writes `pending_updates` for property matches (the gov
matcher / linker — likely `gsa_property_matcher.py`, `link_and_extract.py`, and/or
`cross_propagate.py`; trace where `pending_updates` rows with
`field_name='property_id'` are inserted). For a `sales_transactions` /
`available_listings` → `property_id` match with **confidence ≥ 0.95** and the
target currently unlinked:
- **Apply the FK directly** (UPDATE the target `property_id`) AND record the
  decision as `pending_updates` `status='auto_applied'` (or `approved`) with
  `resolved_by='auto_highconf'`, `resolved_at=now()`, keeping `old_value` (NULL)
  and `new_value` for reversibility — instead of leaving `status='pending'` to
  expire. (Reuse the existing apply path if one exists for `approved` rows, so the
  cap-rate / propagation side-effects fire exactly as a human approval would.)
- Below 0.95, or any out-of-scope field/table: behavior unchanged (still queue for
  human review). This is purely "auto-resolve the safe subset," per the
  Consumption-Layer doctrine — the producer now has a named auto-consumer for its
  highest-confidence output.
- Make the threshold an env/config constant (e.g. `PENDING_AUTOAPPLY_MIN_CONF=0.95`)
  so it's tunable without a code change.

## Unit 2 — retroactive: recover the expired ≥0.95 backlog (dry-run first)

One-shot recovery (a guarded SQL migration on the gov DB, or a Python one-shot —
your call, but it MUST be dry-run-first and reversible):
- Select `pending_updates` where `field_name='property_id'`,
  `table_name IN ('sales_transactions','available_listings')`,
  `status='expired'`, `confidence>=0.95`, and the target record's `property_id IS
  NULL` and the proposed property exists.
- **Dry-run** reports the exact counts (expect ~334 sales + the still-unlinked
  listings) and a sample before any write.
- **Apply:** set the target `property_id = new_value`, flip the pending_update to
  `status='auto_applied'`/`resolved_by='auto_highconf_backfill'`/`resolved_at=now()`
  (keep `old_value`), so the action is logged + reversible. Let the same approval
  side-effects fire (so the gov cap-rate framework recomputes for the now-linked
  sale, per the gov CLAUDE.md §12 — linking a sale to its property is exactly when
  a cap-rate history row should derive).
- **Reversibility:** every applied row is identifiable
  (`resolved_by='auto_highconf%'`, `old_value` recorded) so a single
  `UPDATE … SET property_id = NULL WHERE …` can revert. State the revert query in
  the migration comment.
- Idempotent: re-running applies nothing new (targets already linked → no-op).

## Boundaries / verify

- GovernmentProject (Python + a gov DB migration); feature branch per its
  CLAUDE.md; end with merge + test commands.
- `python -c "import src.run_pipeline"` (or the relevant module);
  `python -m pytest tests/ -x -q`.
- **Dry-run proof BEFORE any write:** the recovery dry-run reports ~334 unlinked
  sales (+ listings) — matches the grounding. Then a capped real apply on a small
  batch, verified reversible, before the full backfill.
- **Live proof (Cowork will verify):** `sales_transactions` ≥0.95-matched rows go
  from `property_id IS NULL` → linked; the cap-rate history derives for the newly
  linked sales; `pending_updates` high-conf property rows move to `auto_applied`;
  a fresh matcher run on a ≥0.95 sales match auto-applies instead of creating a
  `pending` row that would expire.
- Do NOT touch the expiry job itself, the out-of-scope fields, or dia.

## Documentation

Update GovernmentProject CLAUDE.md: high-confidence (`≥ PENDING_AUTOAPPLY_MIN_CONF`,
default 0.95) `property_id` matches on `sales_transactions` / `available_listings`
now auto-apply (fill-unlinked-FK only) with `resolved_by='auto_highconf'` instead
of queuing→expiring; the one-shot backfill recovered the expired ≥0.95 set;
reversible via `old_value` + `resolved_by`. recorded_owner_id / _new_property /
low-confidence stay human-reviewed.

## Bottom line

The gov matcher computes hundreds of ≥0.95 record→property links and then lets
them expire unworked — ~334 sales (+ listings) are sitting unlinked right now
because their high-confidence match was discarded. Give that high-confidence
output a named auto-consumer: apply ≥0.95 `property_id` links directly (forward)
and recover the expired backlog (retroactive), reversibly and dry-run-first —
fill-unlinked-FK only, ownership and row-creation untouched. Pure Consumption-Layer
"auto-resolve the safe subset."
