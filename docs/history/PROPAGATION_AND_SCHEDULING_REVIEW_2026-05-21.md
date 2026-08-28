# Resolution / Propagation Code + Scheduling Review

**Date:** 2026-05-21
**Scope:** pg_cron schedules and the resolution/propagation logic on LCC Opps, Government, and Dialysis. Opinion on whether cadence + triggers align with the project objective.
**Objective (as I understand it):** ingest GSA/FRPP/CMS/CoStar/OM data, resolve & match entities (properties, owners, contacts, leases), enrich, and surface accurate net-lease investment intelligence — *without* the data-quality defects this audit surfaced (duplicate/mis-addressed properties, mis-resolved owners, stranded intakes).

---

## 1. Cron inventory by database

| DB | # jobs | Highest frequency | Character |
|----|--------|-------------------|-----------|
| **LCC Opps** | 23 | every 5 min (×3) | Orchestrator: HTTP-posts to Vercel/edge via `lcc_cron_post`/pg_net |
| **Dialysis** | 24 | **every 1 min** (`auto_link_and_refresh_property_queue`) | Heavy: in-DB linkers + many `REFRESH MV CONCURRENTLY` |
| **Government** | 14 | every 1–2 h | Light: mostly nightly MV refreshes |

Government is well-tuned. **The propagation load is concentrated on Dialysis + LCC Opps**, and that's where the alignment issues are.

---

## 2. What's working well (keep)

- **`dia_auto_merge_property_duplicates` (hourly) is sound.** It groups by normalized (state, address), and **only auto-merges groups where the distinct-operator count ≤ 1** — refusing multi-operator addresses (which is exactly why it correctly left 6120 S Yale and the 87 ambiguous groups for human review). Survivor selection is a sensible richness score (tenant + size + year + medicare + sales). This is the right conservatism; my manual high-confidence merges used the same principle.
- **Government's nightly-batch cadence** matches how GSA/FRPP data actually arrives (quarterly/annual). No over-scheduling there.
- **Health/observability crons** (`lcc_check_cron_health`, availability bot-block alerts) are appropriate.
- **dia auto-supersede lease trigger** and the **gov cap-rate triggers** are event-driven (fire on the write that matters) — the right model.

## 3. Misalignments (recommend changing)

### 3a. Dialysis `auto_link_and_refresh_property_queue` runs **every minute** — far faster than the data changes
It runs three linkers (`auto_link_exact_address_singletons`, `auto_link_orphan_properties_to_clinics`, `auto_link_high_confidence_property_candidates`) **and a `REFRESH MATERIALIZED VIEW CONCURRENTLY`** every 60 seconds = 1,440 runs/day. The underlying properties change in **batches** (CoStar sidebar captures, hourly SF-files extract, nightly CMS/GSA syncs), so the vast majority of those 1,440 runs do no useful work but still scan `properties` and rebuild an MV — steady CPU + connection consumption on a shared 60-connection database.
**Recommend:** drop to every 5–15 min, or make it event-driven (run when the link queue is non-empty / after an ingestion batch). A `CONCURRENT` MV refresh every minute is the most expensive part and the least justified.

### 3b. LCC Opps cron density + same-minute alignment is what tips it over 60 connections
Three jobs run every 5 min (`refresh-work-counts`, `lcc-retry-stranded-extractions`, `dia-link-provenance-replay`), plus `lcc-geocode-backfill` (*/10), `lcc-merge-log-reconcile` (*/15), and several */30 jobs — many landing on minute 0 simultaneously, each opening a connection via pg_net to post to Vercel/edge. Combined with PostgREST connection churn (the logs showed a flood of fresh connections, i.e. the app isn't using the pooler), this is the mechanism behind today's outage.
**Recommend:** (1) move app + edge functions to the **Supavisor transaction-mode pooler** (port 6543); (2) **stagger** the high-frequency jobs off shared minute marks (e.g. `1-59/5`, `3-59/5`, `2-59/5` rather than all `*/5`); (3) consolidate where possible — `refresh-work-counts` + `dia-link-provenance-replay` both every 5 min could be merged or slowed to 10–15 min.

### 3c. The retry loop turns a code bug into sustained load
`lcc-retry-stranded-extractions` runs every 5 min; combined with the `staged_intake_items_status_check` bug (matcher writes invalid `'review_needed'`, promote writes invalid `'promoted'` — see the intake addendum), intakes that fail their status transition get re-touched repeatedly. **Fixing the status values (one-word change) removes a recurring DB-load source**, not just a log error.

### 3d. Two parallel dedup mechanisms with different scoping
There's the **DB-side** `dia_auto_merge_property_duplicates` (hourly, operator-aware) **and** the **Python** `property_consolidation.py` whose `BACKFILL_PROPERTY_SOURCES` set only covers `gsa_inventory_gap_backfill` / `frpp_inventory_gap_backfill`. Two dedup paths with different rules can disagree about what to merge and make behavior hard to reason about.
**Recommend:** pick one as the source of truth (the DB function is the better-designed one) and have the Python path defer to it, or at least align their scoping.

### 3e. Coverage gaps the schedule doesn't close (need the guards, not more cron)
Running the auto-merge more often wouldn't have prevented today's problems — the actual ingestion bugs (sidebar fuzzy-dedup fan-out; OM extractor using the contact-block address) create rows the conservative auto-merge correctly won't touch. Those need the **write-time guards** in the DQ-7 + intake handoffs (normalized-address existence check, `isOwnFirmAddress` denylist), not schedule changes.

### 3f. Cross-domain reconcile reacts to bulk entity changes — size your own batch operations accordingly
`dia-link-provenance-replay` (*/5) and `lcc-merge-log-reconcile` (*/15) exist to propagate dia/gov entity changes into LCC backrefs. A large one-shot change on dia/gov (e.g. this audit's ~4,600 owner-FK repoints + ~9,000 quarantine flags) generates a reconcile/replay backlog these jobs then chew through — plausibly a contributor to today's LCC load spike. Not a code defect, but worth knowing: **bulk entity surgery should be throttled or run in a maintenance window**, and these reconcile jobs should cap per-tick work (merge-reconcile already uses `limit=200`, which is good).

---

## 3g. The canonical entity-resolution layer is built but only half-wired (important)

gov has a real entity-resolution architecture — `unified_contacts` (16,990 rows, canonical `unified_id`), the tiered `resolve_contact()` matcher, and `contact_aliases` (2,549 mappings). The `unified_contacts` schema has columns to link every source: `sf_contact_id`, `gov_contact_id`, `dia_contact_id`, `recorded_owner_id`, `true_owner_id`, `outlook_contact_id`, etc., plus `merge_history`/`match_confidence`.

**But it's only populated from Salesforce.** All 16,990 unified rows have `sf_contact_id`; **0** have `gov_contact_id`, `dia_contact_id`, or `recorded_owner_id`. None of the 9,859 raw gov contacts roll up into the unified layer. So the canonical graph today covers SF contacts only — gov/dia sales buyer/seller and owners are **not** connected to it.

**Consequences:**
- The 467 duplicate raw-contact clusters persist because the unification that would collapse them was never run for gov/dia.
- DQ-4 ownership-chain continuity can't be measured by canonical entity: comparing `seller_contact_id` to the prior `buyer_contact_id` gives a 53% break rate, but those FKs point at *raw* (duplicated) contacts, so the same entity under two raw rows reads as a break. Mapping through `unified_id` returns nothing because the gov linkage is empty.

**Recommendation (this is the aligned fix — NOT a one-off contacts hard-merge):** finish wiring gov/dia into the existing unification layer — run `resolve_contact()` over gov/dia contacts + owners and populate `unified_contacts.gov_contact_id` / `dia_contact_id` / `recorded_owner_id`. That is the system's intended dedup mechanism; doing it makes DQ-4 computable on `unified_id` and collapses the 467 duplicate clusters as a by-product. A parallel hard-merge of the raw `contacts` table would fight this design (and its `merge_history`) and is not recommended.

## 4. Net opinion

The **logic** of the resolution/propagation functions is generally conservative and correct (especially the operator-aware auto-merge). The problems are about **cadence and connection discipline**, not bad matching:

1. The system over-schedules in-DB propagation on Dialysis (every-minute linker + concurrent MV refresh) relative to a batch-fed dataset.
2. LCC Opps lacks connection pooling and packs many HTTP-posting crons onto the same minutes, against a 60-connection ceiling — the direct cause of the outage.
3. A couple of one-line code bugs (intake status values) convert into recurring load through the retry cron.

Fixing those three — pooler + de-densify/stagger high-frequency crons + the status-value fix — aligns the runtime behavior with the objective (accurate, current intelligence) **without** the periodic instability. The matching/merge logic itself mostly just needs the write-time guards already specced, not re-architecting.

*Read-only review. No schedules or code were changed.*
