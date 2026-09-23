# GOV-UX1-D5-gate-2 — close the three gaps behind the lane's 50% precision before Scott grades it

Backlog: `GOV-UX1-D5-gate-bank`, `GOV-UX1-D5-gate-buyerspe`, `GOV-UX1-D5-gate-sponsor` (filed by CC 2026-09-23 with the D5 gate).

## Why now

- The live gate passes 20 owners, and CC graded only **10 as real seller leads**.
- The rejects cluster into 3 fixable classes: five `ARC GS…` REIT SPEs sharing one AR Global contact, Truist Bank, and `PASADENA SSA LLC` (a UIRC SPE sibling).
- If Scott works the lane as it stands, the precision meter will read about 50%, and auto-create will never unlock for reasons the code can fix.
- Fix the classes first, so Scott's decisions measure the gate, not its known gaps. Accuracy → action → automation.

## Ask (one unit each, measure before and after)

1. **bank:** widen `lcc_owner_name_is_bank_or_trustee` (or add a bank-owner arm) so a plain bank owner (`Truist Bank`, `… Bank, N.A.`, `… Bancorp`) is excluded. It feeds `lcc_owner_name_is_not_prospected` and therefore the seller queue, so report exactly which queue rows it removes and grade them. Don't add a private regex list in JS.
2. **buyerspe:** add a shared-decision-maker arm. An owner whose only decision-maker is also the decision-maker of an entity that `lcc_resolve_buyer_parent` resolves to a repeat buyer is treated as that buyer's sibling and excluded from the auto path. Surface it in the lane with a "likely SPE of <parent>" note rather than silently dropping it.
3. **sponsor:** collapse SPEs that share one decision-maker into **one** lane card (one conversation = one lead), keyed on the decision-maker. Don't hard-exclude REITs by a name pattern. If the sponsor is a repeat buyer, (2) handles it.
4. Re-grade the lane after 1–3, listing each row, and report the projected precision.
5. Tests for each arm, plus the collapse, each with a mutation that turns it red.

## Do not touch

- The lane UI, flag, meter and tick beyond what the collapse needs.
- `bridgeCreateLead`.

## Done means

- Backlog rows updated.
- Deploy = redeploy BOTH Railway services.
- Checklist Q51 note: grade the lane after this ships.
