# GOV-UX1-D5-gate — tightened seller-lead gate: review lane first, auto-create once it has earned it (LCC repo)

Backlog: `GOV-UX1-D5`, `GOV-UX1-D5-gate`. Checklist Q48, answered by Scott on 2026-09-23: *"I want to automate as much as possible but the overall objective is getting to accuracy and action."* Cowork recommended a hybrid of (a) and (b), and Scott is proceeding on it.
The measurements are in `docs/audits/GOV_UX1_NAVIGATION_OWNER_VERIFICATION_2026-09-22.md` §D, "D4 / D5 re-measured". **Re-measure before building.**

## Why a hybrid

- Auto-creating leads on today's gate would be inaccurate. 28 of the 54 owners qualify only through a `works_at` link, and the first page includes an address filed as an owner, a bank, REIT SPEs and repeat buyers.
- A review lane alone never becomes automation.
- So: build the **tight** gate, surface its output as a one-click lane, and **measure precision from Scott's own decisions**. Auto-create switches on only when that precision proves the gate. That is accuracy first, then action, then automation, all on evidence.

## Ask

1. **Tightened gate:** a view or function, one definition, used by both the lane and the automation. An owner qualifies only if all of these hold:
   - It is in the doctrine seller queue (`v_lcc_seller_prospect_queue`) with a measured reason to sell.
   - It has a linked person through a **decision-maker role**, not `works_at` or `parent_of`. This is the P161 rule; reuse its code.
   - Its name passes the existing junk and person-shape checks (`isJunkEntityName` / the owner-name guards). No bare addresses, banks or trustees; reuse the seller-queue exclusions, and don't write a new regex list.
   - It is not a repeat buyer (the same test `bridgeCreateLead` already refuses on).
   - It has no open lead.
   - The lead owner resolves through `lcc_cadence_point_person`, to fix the scheduled-caller `owner_user_id` gap CC found.
   - Report the count and grade the first 25 named rows in the response, one line each: keep or reject, and why.
2. **Review lane.** Show the gated owners where Scott already works: the Priority tab and/or the Home BD lane. Say which, and why. Each row has **Create lead** (through `bridgeCreateLead`, the only writer) and **Not a lead** (with a reason picklist). Record both decisions with the reason, so precision is measurable.
3. **Precision meter and switch.**
   - Store the decisions, and compute precision = creates ÷ (creates + rejects) over the last N decided rows.
   - Add a flag, default OFF, e.g. `seller_lead_autocreate`. When it's ON **and** precision ≥ 90% over at least 25 decisions, a tick auto-creates for newly qualifying owners.
   - Tag and log every auto-created lead so it can be listed and reversed. Idempotent.
   - The lane shows the meter ("18/20 accepted, 90% — auto-create eligible").
4. **Tests:**
   - each gate condition alone excludes an owner;
   - "Not a lead" suppresses the owner from the lane;
   - auto-create stays off below the threshold or with the flag off;
   - no second lead writer (AST/grep);
   - idempotency.
   Each test needs a mutation that turns it red.

## Do not touch

- The seller-queue view definition.
- `bd_opportunity_auto_seed_cadence`.
- D1–D3 (gov).

## Done means

- Backlog rows updated, plus a new checklist line for Scott: "work the lane; auto-create unlocks at 90%/25".
- Deploy = redeploy BOTH Railway services, then `npm run verify:deploy`.
