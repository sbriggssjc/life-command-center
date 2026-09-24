# POSTSHIP-R73 — finish what GOV-CU1 / GOV-CLASSIFY1 / SF-BRIDGE1 left open (deploy, re-run, one field map)

Backlog: `GOV-CU1-edge-deploy`, `GOV-CLASSIFY1-rerun`, `GOV-CLASSIFY1-saginaw-twin`, `SF-BRIDGE1-opened-at`. Source: Cowork round 73, 2026-09-23. Measured by Cowork.

## Measured (live, 2026-09-23 ~24:00 UTC)

- **`tranquil-delight` is live on `9d8bb05e`**: GOV-CLASSIFY1, GOV-CU1 and GOV-AVAIL2 are all in it (`verify:deploy` passes).
- **Edge functions NOT redeployed** (Dialysis_DB `zqzrriwuavgrquhisnoa`). `intake-salesforce` is v34, last updated before GOV-CU1. `intake-salesforce-files` is v31 (INTAKE-RESTAGE1). Neither carries `_shared/private-financial-names.ts`. The gov DB guard catches lender-only rows downstream, so this is defence in depth, not a leak.
- **GOV-CLASSIFY1 entities not re-run.** LCC Opps `d0210db5…` (Jellico) and `e2a7ab46…` (Tulelake) still have `domain = null`, last updated 19:52 / 20:05 UTC. Scott is re-saving one of them from the extension (Q56). CC owns the other re-runs.
- **SF Deal sync flow works.** Q54 closed: open deals with an address went from 12/43 to **29/43** (`metadata.address_source = sf_payload`). The 8 open SF deals still without one have no `Property2__c` in Salesforce, so that is not a flow defect. **`opened_at` is NULL on all 610 SF deals**: the flow now sends `CreatedDate`, but `normalizeDeal()` in `mcp/opportunity-sync.js` never maps it.

## Ask

1. **Deploy both SF edge functions** from `main`: `intake-salesforce` and `intake-salesforce-files`. Confirm with `list_edge_functions` that the versions and `updated_at` moved. Smoke `?action=requeue` stays secret-gated (401 without the header).
2. **GOV-CLASSIFY1-rerun.**
   - Scott's re-save (Q56) covers one of the two entities. Re-run the other with `force:true`.
   - Re-run the six sweep entities in the `GOV-CLASSIFY1-rerun` row.
   - For each, report the domain and the linked property id, and confirm no new gov or dia property was minted. Compare the count of properties created in the last hour before and after.
   - Saginaw `6c85fe57…` must stay `no_domain`.
3. **GOV-CLASSIFY1-saginaw-twin.** Route gov 31111 / 16297 (1040 N Towerline) into `gov_property_twin_review` through the existing SIDEBAR5 twin path (`sidebar5_*` reason style). Do not merge them.
4. **SF-BRIDGE1-opened-at.**
   - Map `CreatedDate` → `opened_at` in `normalizeDeal()`, and have the RPC fill it forward (never overwrite a non-null value).
   - Accept `deals.records` as well as `deals[]` in `ingestBatch`, so the round-72 envelope mistake degrades gracefully instead of returning a 400. Test both.
   - This is MCP code: it goes live only on the **standalone MCP** redeploy. Say so.
   - After Scott's redeploy, the next 30-minute sync should leave `opened_at` null on 0 of the SF deals.

Tests: the `CreatedDate` map, the fill-forward, and the `records` envelope. Each needs a mutation that turns it red.

## Done means

- Each backlog row above has its state and evidence updated.
- Deploy: edge functions by CC; Railway is **BOTH** services (the MCP change needs the standalone service).
- No doc moves: DOCMAP3 runs separately.
