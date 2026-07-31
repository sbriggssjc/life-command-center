# Property-Owner Source Authority + Salesforce Doctrine (2026-07-31)

Capture of this session's changes. **All DB items below are already applied live to Supabase (OPS).**
The two code/repo items at the bottom are pending the device bridge reconnecting.

## Doctrine: Salesforce is a SOURCE, not truth
(Reinforced by Scott, 2026-07-31; extends the existing CLAUDE.md "SF is minimum-necessary" note.)
Salesforce is data entered by many brokers — it will contain duplicates, wrong, and stale records. The
LCC treats SF as **one reconcilable source among many**, never automatically accurate. The LCC merges
and cleans toward the most accurate internal record. **LCC writes back to Salesforce ONLY when there is
a direct team benefit** — e.g. correcting an email/contact record, adding someone to a BD marketing
list/group for prospecting campaigns, or marking territory for rules-of-engagement via a logged call —
never merely to "sync." Any future SF-write feature must be scoped to a concrete team benefit.

## Property-owner source-authority ladder (migration `20260818310000`, LIVE)
Evidence weights encode authority; recency decay still applies on top. Higher wins.

| Source | Weight | Meaning |
|---|---|---|
| `manual` | 8.0 | human-verified / curated pin (see `lcc_pin_property_owner`) |
| `deed_recorded` | 6.0 | county deed / public record |
| `rel_purchase` | 4.0 | a recorded purchase transaction (title transferred) |
| `sf_seller` | **3.5** | the deal's SF Opportunity Account — a broker-entered hint, NOT truth |
| `rel_owns` | 3.0 | an ownership-graph edge |

`sf_seller` was **lowered 4.5 → 3.5** so a recorded purchase overrides it (ownership transfers on a
close) and any higher-authority source wins — while it still resolves our own listings when it's the
only evidence. Existing `sf_seller` evidence rows were updated to 3.5 and re-reconciled (coverage held
at 32/40 open deals). Also fixed: `lcc_reconcile_property_owner` now records the winning evidence's
actual `source` instead of hardcoding `relationship_graph` (migration `20260818300000`).

## Manual pin — the human-authority override (migration `20260818310000`, LIVE)
`lcc_pin_property_owner(p_entity_id, p_owner_entity_id, p_note)` records `manual` (weight 8) evidence so
a verified owner beats `sf_seller`/graph, then reconciles. Reversible: delete the manual evidence row +
re-reconcile.

## Genesis KC Development resolution (LIVE)
Scott: DaVita runs a wholly-owned in-house developer; **title is acquired and sold with Genesis KC
Development, LLC (a Delaware LLC)**. The SF Opportunity Account was just whatever a broker keyed in
(often "DaVita Healthcare Partners" = the operator), so it must not be trusted as the owner.
- Created entity **Genesis KC Development, LLC** (`d45f3645-7b94-40fa-b65d-50c7fcca0ffd`, organization, dia).
- Scott confirmed all 8 DaVita-account open listings have **Genesis** as seller (and "Realty Income" in
  the *DaVita Portfolio 4 - Realty Income* name is the **buyer**, not the owner; that portfolio =
  Banning/Omaha/Queens/Succasunna sold to Realty Income). Pinned Genesis (manual) on all 8 →
  9 assets now owned by Genesis, source `manual`, confidence 0.696 (beating the SF account).
- Snellville correctly kept "RCG Ventures" (a real landlord, not one of the 8).

## Pending code/repo sync (device bridge was down at end of session)
1. **`api/_handlers/sf-seller-owner.js`** — change the constant `SF_SELLER_WEIGHT` from `4.5` to
   **`3.5`** (so future worker runs record the new authority weight, matching the DB). One-line edit.
2. **Repo mirrors + doc** — mirror `20260818300000_property_owner_source_label.sql` (DONE earlier) and
   `20260818310000_property_owner_source_authority.sql` into `supabase/migrations/`, and fold this
   file's ladder + doctrine into `docs/architecture/property-owner-subsystem.md`. (Migration
   `20260818300000` file was written to the repo; `20260818310000` still needs mirroring.)
