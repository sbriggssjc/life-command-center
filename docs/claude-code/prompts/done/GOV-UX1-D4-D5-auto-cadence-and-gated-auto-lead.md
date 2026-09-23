# GOV-UX1-D4 → D5 — auto-seed cadence on open leads; gated auto-create of leads (LCC repo)

Backlog: `GOV-UX1-D4`, `GOV-UX1-D5`. Scott approved all of Q46 on 2026-09-23. D4 comes first, then D5.
The measurements are in `docs/audits/GOV_UX1_NAVIGATION_OWNER_VERIFICATION_2026-09-22.md` §D. **Re-measure before you write.**

## D4: add to cadence automatically when an open BD opportunity has none

- 35 of 43 open `bd_opportunities` have no `touchpoint_cadence` row (fleet-wide, 2026-09-22).
- Use `cadenceSeedDecision()` (`api/_shared/cadence-engine.js:229`), the shared reachability gate already used by `contact-attach.js`. It refuses unreachable parties. Do not write a second gate.
- Seed the backlog once, then keep it true going forward: any open opp that lacks a cadence gets one. Put the forward path at the writer or on an existing tick, and say which and why.
- Log every seed. When the gate refuses, record the reason rather than silently skipping.
- After this, the property panel's "Add to cadence" Next-step should disappear for these opps. Verify.

## D5: gated auto-lead

- Never create a lead on "owner resolved" alone. 7,708 resolved owners lack a lead, and minting all of them is the Consumption-Layer failure (a lead per captured row).
- Gate: the owner is in the doctrine seller queue (`v_lcc_seller_prospect_queue`), **and** has a measured reason to sell, **and** has a linked person, **and** has no open lead. There were 98 on 2026-09-22.
- Create through the **existing** writer `bridgeCreateLead` (`api/operations.js:2284`, action `create_lead`). It already seeds the cadence, so D4's path must not double-seed. Do not add a second lead writer.
- Idempotent: re-running creates nothing new. Every auto-created lead is tagged (e.g. `source='auto_gated_seller_queue'` or the existing equivalent column) and logged, so it can be listed and reversed.
- Forward path: evaluate on the tick/refresh that already maintains the seller queue. Report the cadence you chose.
- The UI keeps a manual "Create lead" button for owners outside the gate, and hides it where a lead now exists.

## Do not touch

- The seller-queue view's definition (PERF-SPQ2 just made it single-pass).
- The gov agency rules (the government-lease prompt).

## Done means

- Tests for the gate (each of the four conditions alone fails it), for idempotency, for no double cadence seed, and for "no second writer" (grep/AST). Each needs a mutation that turns it red.
- Live before/after counts.
- Backlog rows updated.
- Deploy = redeploy BOTH Railway services, then `npm run verify:deploy`.
