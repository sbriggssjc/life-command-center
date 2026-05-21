# Build Spec — Wire gov/dia contacts + owners into `unified_contacts`

**Date:** 2026-05-21
**Companion to:** `PROPAGATION_AND_SCHEDULING_REVIEW_2026-05-21.md` (§3g)
**Status:** specification for engineer implementation. No code/data changed. This replaces the idea of hard-merging the raw `contacts` table — that would fight the existing canonical layer.

## Objective & current state

`unified_contacts` is the canonical cross-source identity table (one `unified_id` per real-world person/entity), with link columns `sf_contact_id, gov_contact_id, dia_contact_id, recorded_owner_id, true_owner_id, outlook_contact_id, …` plus `merge_history, match_confidence, match_method`. The matcher `resolve_contact(email, phone, first_name, last_name, company_name)` returns `(unified_id, match_tier, match_score)` via a tiered cascade (email → phone+name → company+name → name-similarity), and `contact_aliases` records alias→canonical mappings.

**The layer is only populated from Salesforce.** Of 16,990 unified rows, all have `sf_contact_id`; **0** have `gov_contact_id`, `dia_contact_id`, or `recorded_owner_id`. So gov/dia contacts (9,859 raw on gov), owners, and sales buyer/seller are not in the canonical graph. This is why the 467 duplicate raw-contact clusters persist and why DQ-4 chain continuity can't be measured by entity.

## Goal

For every gov/dia `contacts` row, `recorded_owners`, and `true_owners` entity: resolve it to an existing `unified_id` (or create a new unified row), and populate the corresponding link column. Then downstream consumers (DQ-4 chain, ownership analytics, dashboards) key on `unified_id`, and duplicate raw rows collapse to one canonical entity as a by-product.

## Approach (idempotent, batched, reversible)

1. **Source iteration.** For each unresolved gov/dia entity (no matching `unified_contacts.<source>_id` yet), in batches of N (≤500):
   - **People** (have first/last/email/phone): call `resolve_contact(email, phone, first_name, last_name, company_name)`.
   - **Entities/companies** (LLCs, trusts — most CRE buyers/sellers/owners): `resolve_contact` is person-oriented; its company tier still requires a `last_name` similarity. **Add a company-resolution path**: match on a canonical company key (lowercase, strip punctuation + legal suffixes `llc|inc|corp|ltd|lp|llp` — the same tight key used in the owner merge) against `unified_contacts.company_name`. This is required because the bulk of net-lease counterparties are entities, not named people.
2. **On match** (tier/score above threshold — recommend tier ≤ 2 or company-key exact): set the link column (`gov_contact_id` / `dia_contact_id` / `recorded_owner_id` / `true_owner_id`) on the matched unified row; append to `merge_history` with `match_method`/`match_confidence`; write a `contact_aliases` row for the variant name.
3. **On no match:** insert a new `unified_contacts` row seeded from the source entity, with the link column set and `match_method='new_from_<source>'`.
4. **Then** map sales buyer/seller to `unified_id`: `sales_transactions.buyer_contact_id`/`seller_contact_id` → `contacts.contact_id` → `unified_contacts.gov_contact_id` → `unified_id`. For unresolved text-only buyers/sellers (~28% buyer / ~47% seller), run the buyer/seller string through the same company-resolution path to populate the FK first.

## Where the table should live (resolve before building)

Both gov and dia have their own `unified_contacts`. Since the schema carries *both* `gov_contact_id` and `dia_contact_id`, the intent appears to be a single **cross-domain** canonical table. Decide explicitly: one shared `unified_contacts` (recommend on LCC Opps, the orchestrator) that both domains write into, vs. per-domain tables that cross-reference. Building the wiring before settling this risks creating two divergent canonical graphs.

## Scheduling (per the scheduling review — do NOT add another every-minute job)

- Run as a **batched backfill** once (chunked, e.g. 500/run until drained), then a **low-frequency incremental** tick (every 15–30 min or post-ingestion) that only resolves *new/changed* source rows. Cap per-tick work (like the existing `limit=200` reconcile jobs). Avoid the every-minute / concurrent-MV pattern §3a flags.

## DQ-4 payoff (the original lever)

Once wired, chain continuity computes on `unified_id`:
```sql
-- seller(N) entity should equal buyer(N-1) entity
... LEFT JOIN unified_contacts ub ON ub.gov_contact_id = s.buyer_contact_id ...
```
The current 53%-by-raw-contact / ~28%-by-text break rate should drop materially, because same-entity-different-raw-row breaks disappear. Residual breaks are then *genuine* (missing intermediate transfers) → route to ownership research, not name-noise.

## Reversibility & safety

- Populate-only on link columns + `contact_aliases` inserts; reversible by nulling `gov_contact_id`/`dia_contact_id`/`recorded_owner_id` and deleting the alias rows tagged with this run's `match_method`.
- Log every resolution (run_id, source row, unified_id, tier/score) so a bad threshold can be replayed/reverted.
- Tune the match threshold conservatively first (high-confidence only); review the tier-2/3 fuzzy matches before lowering.

## Risks

- **Entity vs person matching:** `resolve_contact` as written under-serves company entities; the company-key path above is essential or most CRE counterparties won't resolve.
- **Over-merging distinct entities** sharing a canonical key (e.g. two unrelated "Smith LLC"): keep the same tight key (strip only legal suffixes, not semantic words like Group/Partners) used successfully in the owner merge, and require uniqueness before linking.
- **Cross-domain table ownership** (above) must be settled first.

*Spec only. No code or data changed.*
