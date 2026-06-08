# Claude Code prompt — R12: Salesforce sync integrity

Audit grounded live 2026-06-08 across LCC Opps + gov + dia DBs. Net: the SF
identity-mapping layer is HEALTHY (1,910 entities mapped, 0 SF-id→many-entity
collisions, 2 trivial dual-id entities; sf_comps_staging null-import_batch
issue resolved — 0 now). Three real problems, ranked by severity. **Unit 1
lives in a different repo (GovernmentProject) — see the routing note.**

## Unit 1 — STOP the hourly cross-domain CHECK storm (highest severity)

`sf_sync_log` (LCC Opps) has 93 `silent_failure` rows, **newest today, one
per hour, going back to early May**. Every one is the same write:

```
autoCreateProperty.insert write failed: {"code":"23514", ...
  10241 Lewis & Clark Blvd, Saint Louis, MO ... DaVita Dialysis - St. Louis - MO ...}
```

Grounded root cause (verified by replaying the insert shape against both
domain DBs):
- The row is a **dialysis property** (DaVita St. Louis) but the writer targets
  the **gov** `properties` table (dia.properties has no `sf_leased` column;
  gov does — the insert's column set matches gov). A cross-domain misroute.
- It fails `properties_government_type_check` because the writer puts
  **`government_type = 'Healthcare'`** (the valid set is
  `Federal|State|Municipal|Other`). Confirmed live: `government_type='Healthcare'`
  → 23514; `NULL` or `'Other'` → inserts fine.
- Each hourly attempt **burns ~2 `properties` sequence IDs** (now at 44,487+)
  and logs a silent_failure — a slow-motion version of the LLC-tick storm.

**Routing:** `autoCreateProperty` is NOT in the life-command-center repo — it's
referenced in `GovernmentProject/COPILOT_INTAKE_ARCHITECTURE_REVIEW.md` and
`copilot_ingestion_implementation_spec.md` (a gov-side Copilot/SF intake
Edge Function or Python path). This unit must be fixed in **GovernmentProject**.
Fix shape there:
1. **Domain gate**: a dialysis-tenanted property (tenant matches
   DaVita/Fresenius/operator patterns, or asset is healthcare/dialysis) must
   NOT be auto-created in the gov DB — route to dia or reject.
2. **Enum mapping**: never write a free-text asset class into
   `government_type`; map to the valid enum or leave NULL.
3. **Dedup/cooldown**: an insert that failed for the same source key must not
   retry every hour forever — mark the source row dead after N attempts
   (the `LLC_MAX_ATTEMPTS` dead-letter pattern) so the storm stops.
4. Reclaim: nothing to reclaim (the inserts rolled back); just confirm the
   sequence burn stops after the fix.

If GovernmentProject is out of scope for this session, at minimum add a
**circuit breaker on the LCC side**: the path that records `silent_failure`
should detect a repeating identical failure (same address+error) and stop
re-issuing — but the real fix is the gov writer.

## Unit 2 — government_buyer opportunities never reach Salesforce

`v_lcc_government_buyer_sync_health` (LCC Opps) shows 2 open government_buyer
opps:
- NGP Capital — `hold_unmapped` (no SF account — correct, waiting on mapping)
- **Boyd Watterson Global — `ready_to_sync`** (SF account `0018W00002X08rlQAB`
  mapped) but **`sf_opp_id IS NULL`** — it has never been pushed.

Grounded gap: the only references to `v_lcc_government_buyer_sync_health` /
`sf_opp_id` in the codebase are **comments**. There is **no worker, route, or
cron that pushes a `ready_to_sync` government_buyer opp into Salesforce** —
the opportunity-creation loop ends at the LCC DB; the SF-push half was specced
(R5) but never built. The view reports readiness nothing consumes.

Build the push (LCC side):
1. A worker (admin.js or operations.js sub-route, no new function file) that
   reads `ready_to_sync` rows, creates the SF Opportunity on the **mapped
   PARENT `sf_account_id`** (never a subsidiary — the R5 doctrine), via the
   existing SF flow path (`/api/sync?action=outbound` / `salesforce.js`), and
   writes the returned SF id back to the opp's `sf_opp_id`. Effect-first,
   outcome-truthful (failure leaves it `ready_to_sync`, logs why).
2. `hold_unmapped` rows stay held and surface in the Decision Center
   `map_sf_parent_account` lane (already wired) — confirm the lane shows NGP.
3. Add the SF flow operation if `salesforce.js` lacks a create-opportunity op
   (mirror the `find_contacts_by_account` addition — it may need a
   corresponding Power Automate flow case; if so, SPEC it for Scott rather
   than assuming it exists, the way the contact-picker op was handled).
4. Idempotency: never create a second SF opp for an opp that already has
   `sf_opp_id`; dedup on the LCC opp id.
5. Cron only AFTER the route is verified live (the standing ordering rule).

## Unit 3 — confirm the disabled SF-link cron is intentional

`cron.job` (LCC Opps): **`lcc-sf-link-tick`** (`/api/sf-link-tick`, hourly) is
`active = false`. This is the SF identity-linking sweep. Determine whether it
was deliberately disabled (superseded by `ensureEntityLink` inline linking) or
accidentally — if the inline path fully covers it, drop the cron + route
cleanly and note it; if not, re-enable. Don't just flip it on blind: ground
what it does vs. what `ensureEntityLink` now covers, then decide. (Identity
mapping is currently healthy, which argues the inline path is doing the job —
but confirm before removing.)

## Verify + ship
- Unit 1 (GovernmentProject): after the fix, no new `silent_failure` rows
  appear in LCC `sf_sync_log` on the next hourly tick; sequence burn stops.
  If deferred, the LCC circuit-breaker stops re-issuing the known-bad write.
- Unit 2: Boyd's opp pushed to SF live (sf_opp_id populated) OR, if a new flow
  op is needed, the op spec delivered + the worker built and dry-run-verified;
  NGP stays held and shows in the map lane.
- Unit 3: a one-paragraph determination (keep/re-enable/remove) grounded in
  what the tick does.
- House rules: `node --check`; 12 functions; migrations idempotent; crons
  after routes; effect-first/outcome-truthful; report per-unit + which repo
  each fix landed in.
