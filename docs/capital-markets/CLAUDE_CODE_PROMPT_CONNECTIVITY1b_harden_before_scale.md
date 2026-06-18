# Claude Code prompt — CONNECTIVITY #1b: harden the owner-bridge before scaling to gov + broad

> The dia conservative batch (392 owners bridged, 679→1,071) is verified good — 100%
> `owner_role='unknown'` (no invented archetypes), reversible, ~98.7% clean real owners. But
> the gate found ~4-5 slips and a definition drift that WILL scale up on gov (3,530) + the
> broad dia pass. Three quick hardening steps before 10×-ing the volume. Receipts-first;
> reversible; gated.

## Step A — sweep the slips from the 392 (reversible)
The genuinely-bad in the batch (the rest of the flagged names are legit — numbered-address
LLCs, "The X" firms, 1031 sponsors, trusts all PASS):
- **Placeholder junk** (not owners): `1031 Exchange Buyer`, `200512484 IRA`, `Buyer 1031
  Exchange: Yes` → revert their bridge (delete entity + identity via the
  `bridge_source='connectivity1_inuse_unknown_owner'` tag) or route to the junk lane.
- **Composite** `919 Investments LLC; Smbc Leasing & Finance Inc` → split (two real owners)
  or route to the merge/split lane — don't leave it as one dirty entity.
- **Operator check** `Davita Hemodialysis Center LLC` → confirm: if the property's CMS
  operator == this name AND it's the recorded owner (owner-operator/sale-leaseback), it's a
  legit owner — KEEP; if it's a pure operator mis-recorded as owner, revert. Use the
  operator-agreement signal you already built.

## Step B — tighten the mint guard for generic placeholders (before scaling)
The current junk guard catches phone/email/contact-header bleed but NOT these. Extend it
(anchored so legit owners pass) to reject at mint:
- account-number / IRA placeholders: `^\d{5,}\s*(ira\b|llc)?$`, `\bIRA$` preceded by digits.
- form-field bleed: `exchange buyer`, `buyer.*:\s*(yes|no)`, `:\s*(yes|no)$`.
- bare descriptors: `^(1031 )?exchange buyer$`, `^buyer$`, `^seller$`, `^escrow`.
- composite `;`-joined two-org names → route to split/merge, don't mint as one.
- **MUST still PASS** (regression-test): `1121 California Avenue LLC`, `5311 Clyde LLC`,
  `850 & 6651 Des Moines LLC`, `The Granger Group`, `Cottonwood 1031 Properties`,
  `Cs1031 Birmingham Mob Dst`, `The DeCarion Living Trust` — these are real owners.
Reuse the existing `ensureEntityLink` junk-guard path (one place), add these patterns there
so gov + the broad pass inherit them.

## Step C — fix the eligibility definition (use the live join, not the stale counter)
Measured live: the denormalized `current_property_count > 0` = **395**, but the live
`ownership_history` (active) join = **896** current-owners, and the full in-use set
(referenced by any recorded_owner) = **2,956**. The counter UNDERCOUNTS current owners by
~500 — CC's batch missed them.
- For the gov + broad passes, define eligibility via the **live `ownership_history` /
  `recorded_owners` join**, NOT `current_property_count`. Build a per-domain
  `v_bridge_eligible_owners` view (dia: live ownership_history; gov: `properties.true_owner_id`
  FK since gov lacks the counter) so the mechanism is one view per domain.
- **Flag the `current_property_count` drift (395 vs 896) as a data-quality follow-up** — a
  denormalized counter out of sync with live ownership; it likely undercounts elsewhere too
  (any ranking/filter reading it). Separate fix; note it.

## Then — green-light the scale (gated, per pass)
1. **dia top-up to live current-owners (896):** re-run the bridge with the Step-B guard + the
   Step-C live definition; picks up the ~500 current-owners the stale counter missed.
2. **gov conservative (current-owners via `properties.true_owner_id`):** same mint, gov
   eligibility view, Step-B guard.
3. **broad dia (2,956 full in-use) + broad gov:** after the conservative passes gate clean.
4. **Durable steady-state:** point the 4h sync (or a parallel tick) at
   `v_bridge_eligible_owners` so new in-use owners auto-bridge; the existing classified cron
   still upgrades any of them to a real archetype on top (enrichment, automatic).

## My gate (per pass)
- Step A: the 3-4 slips reverted/split/confirmed; the 392 minus slips all real owners.
- Step B: the regression set still mints; the placeholder set is rejected.
- Step C: eligibility reads the live join; the drift logged.
- Scale: each pass — owners bridged are real (sampled), 0 operator/junk leaks under the
  tightened guard, owner_role='unknown' honest, reversible by tag, graph visibility confirmed.

## Guardrails
- Reversible (the `bridge_source` tag); fill-blanks; never overwrite curated; one guard path
  (`ensureEntityLink`); the live classified cron untouched (enrichment-on-top intact).
  Capped batch → gate → drain, every pass.
