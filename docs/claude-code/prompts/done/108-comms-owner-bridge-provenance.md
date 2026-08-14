# Prompt 108 — W9.6 comms_owner_bridge provenance: make the owner-attribution writes observable

Grounding (read first): the W9.6 confirm writer in `api/admin.js` (the `comms_owner_attribution_review` verdict
branch, ~line 9231–9256), the field-level provenance doctrine in CLAUDE.md ("Every cross-table field write to
curated tables is observed"), `rpc/lcc_merge_field` (signature below), the `field_source_priority` row already
registered for this source, `comms_owner_attribution_apply_log` (the reversible ledger — the backfill source).

## The gap (grounded live, 2026-08-14)

Scott worked all 22 W9.6 proposals → **22 confirmed, 22 `comms_owner_attribution_apply_log` rows, and the
`correspondence_entity_owner_llc` metric moved 2.5%→9.3%** — the writes landed. **But `field_provenance` has 0
`comms_owner_bridge` rows**, so these owner-attribution edges are invisible to the provenance ledger / Decision
Center provenance lanes, violating "every cross-table curated write is observed."

**Root cause (diagnosed):** the confirm writer stamps provenance via `rpc/lcc_merge_field` (admin.js ~9243), but
(a) the call is wrapped in a **swallowed** try/catch (`catch (_e) { /* provenance best-effort */ }`, ~9251) that
hides whatever is failing, and (b) it passes **`p_value: JSON.stringify(ownerEid)`** while the RPC param is
`p_value jsonb` — a double-encoded string that the RPC almost certainly rejects (or stores wrong). The fsp
lookup itself is fine — the row `('public.activity_events','linked_entity_ids','comms_owner_bridge',45,record_only)`
matches the call's `p_target_table`/`p_field_name`/`p_source`.

`lcc_merge_field(p_workspace_id uuid, p_target_database text, p_target_table text, p_record_pk text,
p_field_name text, p_value jsonb, p_source text, p_source_run_id text, p_confidence numeric, p_recorded_by uuid)`.

## Do

1. **Un-swallow the error (make it loud).** Replace the silent `catch (_e) {}` with a logged warning (the
   provenance failure must surface in logs, not vanish) — mirror the "loud errors" discipline the ticks use. The
   append + apply_log remain the reversible record, but a provenance failure should be visible, not hidden.
2. **Fix the `p_value` encoding.** Pass the value the way the RPC's `jsonb` param expects — **grep a WORKING
   `lcc_merge_field` caller first** (e.g. the reachability fill-blanks writer or a naming-hygiene writer) and
   match how they pass `p_value` (almost certainly the raw value / a JS object, NOT `JSON.stringify(...)`).
   Confirm `p_target_database:'lcc'` is what the RPC expects for an ops-local `public.activity_events` write
   (the RPC takes a `p_target_database` arg even though `field_source_priority` is keyed only by table/field/
   source — verify the RPC's internal use of it). Verify against a single live confirm that a
   `field_provenance` row with `source='comms_owner_bridge'` now lands.
3. **Backfill the 22 already-confirmed bridges.** From `comms_owner_attribution_apply_log.reversal`
   (`owner_entity_id` + `activity_event_ids`), insert the missing `field_provenance` rows (source
   `comms_owner_bridge`, `decision='write'`, one per representative row per the existing writer's convention) so
   the already-worked attributions are observable too. Idempotent (don't double-insert if a matching provenance
   row already exists); reversible/tagged.

## Acceptance
- After a fresh confirm (or a re-run), `field_provenance` shows `comms_owner_bridge` rows; `v_field_provenance_
  unranked` **stays 0** (the fsp row already exists — no new drift); the owner bridges appear in
  `v_field_provenance_current` / the actionable provenance views.
- The 22 historical bridges are backfilled (idempotent) and visible.
- The provenance call no longer fails silently (loud log on failure).
- A structural test: the confirm path records provenance on success; the `p_value` is passed in the RPC-correct
  shape (regression guard against the double-encoding).
- Docs: STATUS note (the 2026-08-14 W9.6 milestone entry flagged this as the follow-up) + ROLLOUT W9.6 row touch;
  prompt → `done/`.

Small, additive, reversible. Commit with the repo Co-Authored-By + Claude-Session trailer. One PR. Report the
post-fix `comms_owner_bridge` provenance count (live confirm + backfill).
