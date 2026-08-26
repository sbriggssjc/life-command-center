# Prompt 96 — Outlook display-name capture (the single unlock for all three W9.4 comms sub-arms)

**Grounding:** prompt 94's honest finding (`docs/audits/W9_4_comms_harvest_dryrun_2026-08-12.md` +
ROLLOUT_STATUS W9.4 row): the comms-harvest arm is built and correct but input-starved — of 7,751
business-attributed correspondence rows, **0 carry a header display name** because the Outlook
ingestion path flattens Graph's `{name, address}` recipient objects to the bare email string.
Preserving display names lights up ALL THREE sub-arms at once (header pairs, signature attribution
context, create-contact). Forward-only — no backfill required (Graph history re-sync is a separate
decision; note feasibility, don't build it).

## Do

1. **Trace the exact flattening point:** the correspondence/Outlook ingestion path (candidates:
   the PA flagged-email flow POSTing `/api/intake?_route=outlook-message`, the correspondence
   ingestion per `docs/architecture/correspondence-ingestion-design.md`, any Graph sync worker).
   Ground which layer discards `{name}` — if it's LCC JS receiving a full Graph payload, fix in
   code; if the PA flow itself only sends addresses, fix the JS to ACCEPT the richer fields AND
   write the exact PA flow-change steps for Scott (never guess-modify flows).
2. **Capture forward-only:** persist `metadata.from_name` + `metadata.to_names[]` (name+address
   pairs) on new `activity_events`/correspondence rows — additive, fill-blanks, no schema break
   (metadata jsonb preferred; if a column is warranted, additive migration first per
   deploy-ordering).
3. **Wire to the comms index:** confirm `harvestBuildCommsIndex` reads the new fields (94 built it
   expecting them); the `?score=1` dry-run's `comms_counts` becomes non-zero as new mail ingests.
4. **Also probe the second starvation finding:** 0 correspondence entities map to a `true_owner` —
   verify whether that's the same missing-name issue (attribution keyed on names that were never
   stored) or a separate linkage gap; report, don't scope-creep the fix.
5. **Tests:** ingestion preserves names (fixture with a Graph-shaped payload), index reads them,
   privacy scoping unchanged.

## Acceptance

- New inbound mail rows carry from/to display names; after a few days' accrual,
  `GET /api/reachability-harvest-tick?score=1&n=10` shows non-zero `comms_counts` with verbatim
  quotes → Scott reviews → Cowork flips `W9_2_REACHABILITY_HARVEST` (one flag, three arms).
- If a PA flow change is required: exact click-path steps documented for Scott.

Commit with the repo Co-Authored-By + Claude-Session trailer.
