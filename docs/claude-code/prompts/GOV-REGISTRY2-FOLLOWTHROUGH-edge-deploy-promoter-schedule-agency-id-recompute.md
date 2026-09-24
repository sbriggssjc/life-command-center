# GOV-REGISTRY2-FOLLOWTHROUGH — make the new agency registry stay correct on its own

Backlog: `GOV-REGISTRY2` (the 🟡 SF edge redeploy), `GOV-REGISTRY2-promoter-schedule`, and the new `GOV-REGISTRY2-agency-id-stale`. Source: Cowork round 77 (2026-09-24), live.

## Measured (Cowork, live)

- **Gov Available after GOV-REGISTRY2:**

| `government_type` | listings | with no `agency_id` |
|---|---|---|
| State | 79 | 22 |
| Municipal | 15 | 3 |
| Federal | 335 | 41 |
| NULL | 39 | 39 |

- **Named rows resolve correctly:** 16297 → `MI-SAGINAW-CMH` "Saginaw Co. CMH"; 16334 → `TN-DHS`. `gov_resolve_agency('Health & Human Services Commission','TX','State')` → `TX-HHSC`.
- **`agency_id` goes stale when the agency text changes.**
  - Cowork restored 33519's agency to "Health & Human Services Commission": the last write in LCC `field_provenance` (2026-06-26 18:59:43), overwritten afterwards by an unrecorded "State of Texas".
  - `properties.agency_id` stayed on `TX-GOV` until Cowork set it to `TX-HHSC` by hand. Nothing recomputes `agency_id` on an agency write.
  - `gov_id3a_backfill_agency_ids` has no schedule (`GOV-REGISTRY2-promoter-schedule`). That's why this round's run filled 47 property + 7,818 `property_agencies` ids through aliases that had existed for weeks.
- **NCUA / FCA routing to gov is only in the repo.** Edge `intake-salesforce` is still v36 and `intake-salesforce-files` v32 (deployed for GOV-CU1, before GOV-REGISTRY2).

## Ask

1. **Recompute `agency_id` on write.** When `agency` / `agency_full_name` / `state` / `government_type` changes on gov `properties`, recompute `agency_id` through the one resolver (`gov_resolve_agency(text, state, type)`). If a trigger is right, use one. Don't stomp a manual override: use the ID3a override marker if one exists; otherwise add the smallest one and say so. Also cover `property_agencies` where its source text changes.
2. **Schedule the promoter.** Put `gov_id3a_backfill_agency_ids` on a cron after the gov ingests, or fold it into cron 52. It runs ledgered, reports its counts, and stays idempotent (a second run writes 0). Dry-run once live first.
3. **Redeploy both SF edge functions** (`intake-salesforce`, `intake-salesforce-files`) from `main`.
   - Use CC's GOV-CU1 method: diff live vs repo first, deploy with `verify_jwt:false`, read back byte-identical.
   - Two CC windows deployed the same code last time. Check `list_edge_functions` right before deploying, and don't deploy if the version already moved.
4. **Sweep once.** After 1–3, count gov properties whose `agency_id` disagrees with what the resolver returns for their current text/state/type. Fix those through the ledgered writer and report the count; the target is 0 left.

Tests: an agency text change recomputes the id; a manual override survives; the promoter is idempotent. Each needs a mutation that turns it red.

## Done means

- The backlog rows updated with the evidence.
- Gov migrations recorded in government-lease.
- Deploy: edge functions by CC; Railway BOTH services only if LCC code changes.
