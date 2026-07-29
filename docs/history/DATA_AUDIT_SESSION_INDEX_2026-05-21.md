# Data Audit & Remediation — Session Index

**Period:** 2026-05-20 → 2026-05-21
**Databases:** Dialysis_DB (dia), Government (gov), LCC Opps (control)
**Principle throughout:** reversible quarantine / merge / link — never silent delete. Code changes are spec'd for branch implementation, not applied to production app code.

---

## A. Done on the databases (live, reversible)

| # | What | DB | Result | Reverse via |
|---|------|----|--------|-------------|
| DQ-7 | Placeholder property batches quarantined | dia + gov | 2,381 flagged `duplicate_placeholder`; 6,638 set `intel_status='junk_no_data'` (1 survivor/addr) | clear flag / batch `created_at` window |
| DQ-7 | Genuine duplicate properties merged | dia + gov | 19 + 4 merged to survivors | `dq7_property_merge_map`/`_log` |
| DQ-7 | Collision detector views | dia + gov | `v_property_address_collisions` | drop view |
| DQ-1 | Out-of-band cap rates excluded from metrics | dia + gov | 55 + 518 | flip `exclude_from_market_metrics` |
| DQ-2 | Duplicate sales excluded (survivor noted) | dia + gov | 446 + 203 | flip flag |
| DQ-5 | Owner records merged (recorded + true owners) | dia + gov | ~3,156 dupes → survivors; ~4,637 FK repoints | `dq5_owner_merge_log` / `dq5_true_owner_merge_map` |
| DQ-10 | Price-less sidebar sales flagged for research | gov | 1,781 `needs_research` | flip flag |
| DQ-3 | Listing status casing normalized + 5 closed | gov | 7 + 5 | flip status |
| DQ-9 | Unlinkable sales flagged | gov | 415 `needs_research` | flip flag |
| 6120 | Office-address mis-ingest flagged + tracked | dia | 11 props + 3 listings + 15 leases; `dq7_office_misaddress_queue` | clear notes / drop queue |
| Owner unification | gov recorded_owners wired into `unified_contacts` | gov | 13,111 unified (12,209 new + 902 linked); 1,847 review; cron `unify-owners-incremental` (twice hourly) | null `recorded_owner_id` / delete `match_method='new_from_gov_owner'` |

Infra objects created (all reversible/droppable): `dq5_owner_merge_map`, `dq5_true_owner_merge_map`, `dq5_owner_merge_log`, `dq7_property_merge_map`, `dq7_property_merge_log`, `dq7_office_misaddress_queue`, `owner_unification_review_queue`, `company_canonical_key()`, `is_generic_gov_owner()`, `resolve_company()`, `unify_owners_tick()`, collision views, trigram + canonical indexes.

---

## B. Spec'd for code (branch implementation, NOT applied)

| Doc | Fix | Priority |
|-----|-----|----------|
| `DQ7_ROOT_CAUSE_AND_CODE_FIX_2026-05-21.md` | sidebar `upsertDomainProperty` dedup guard (normalized-addr existence check) | High |
| `INTAKE_FIXES_ADDENDUM_2026-05-21.md` §1 | LCC Opps → Supavisor pooler; stagger/de-densify crons | High (caused the outage) |
| `INTAKE_FIXES_ADDENDUM_2026-05-21.md` §2 | intake status-value bugs: matcher `'review_needed'`→`'review_required'`; promote `'promoted'`→`'finalized'` | High (one-line; feeds retry loop) |
| `INTAKE_FIXES_ADDENDUM_2026-05-21.md` §3 | OM-extractor office/contact-block address guard (`isOwnFirmAddress`) | Medium |
| `GovernmentProject/sql/DRAFT_gov_supersede_expired_lease_on_address_collision.sql` | supersede expired-lease property rows at collided addresses | Medium |
| `GovernmentProject/sql/DRAFT_resolve_company_and_owner_unification.sql` | the entity resolver (now also deployed live on gov) — deploy to dia + extend to buyer/seller | Medium |
| `PROPAGATION_AND_SCHEDULING_REVIEW_2026-05-21.md` | cadence fixes: dia every-minute linker → 5–15 min/event-driven; unified_contacts wiring (§3g) | Medium |

---

## C. Manual-review worklists (ready)

- `DQ7_PROPERTY_COLLISION_WORKLIST_2026-05-21.md` — 87 dia + 217 gov same-address groups to adjudicate (merge vs keep-both vs investigate).
- `dia.dq7_office_misaddress_queue` — 3 real listings + leases needing true subject addresses.
- `gov.owner_unification_review_queue` — 1,847 fuzzy/ambiguous owner matches (the score≈1.0 ones are safe to auto-promote).

---

## D. Key findings / opinions

1. **Two ingestion bugs, not bad matching:** sidebar fuzzy-dedup fan-out (DQ-7) and the OM extractor using the contact-block address (6120). The merge/clean *logic* is generally sound and conservative.
2. **The outage was connection exhaustion** on LCC Opps (60-conn ceiling, no pooler, dense same-minute crons) — resolved by restart; recurrence prevention is pooler + cron de-densification + the intake status-bug fix.
3. **Canonical entity layer was half-wired:** `unified_contacts` existed but was SF-only; `resolve_contact` is person-oriented and matched 0 entity owners. Built `resolve_company` and wired gov recorded_owners in.
4. **Scheduling is the main misalignment**, not logic: dia runs an every-minute linker + concurrent MV refresh against batch-fed data; LCC Opps packs high-frequency crons onto shared minutes.

---

## E. Open / next

- Deploy the spec'd code fixes on branches (pooler + intake status bug are highest-value).
- Extend owner unification to dia + true_owners + buyer/seller (then DQ-4 computes on `unified_id`).
- Work the three review worklists.
- **In progress:** audit of every reconcile/clean/dedup function across the three DBs for schedule correctness, logical gaps, and silent failures.

*All section-A items were SELECT-verified before/after. Reversal pointers are exact.*
