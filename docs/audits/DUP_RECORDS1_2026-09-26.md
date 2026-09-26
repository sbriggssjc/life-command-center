# DUP-RECORDS1 — duplicate property and owner rows (2026-09-26)

Scott's rule: merge into the most accurate source of truth, for all history, and only through the
reversible merges. The survivor is the more complete row. With fewer than two independent signals,
queue a card instead of merging.

## 1. The merge rule (dia)

`dia_dup1_merge_pair(keep, drop, batch, dry_run default true, card_note, p_human_confirmed default false)`
(`supabase/migrations/dialysis/20261016120000_dia_dup_records1_property_merge.sql`).

- **Signals** (`dia_dup1_signals`): parcel (normalized APN), address (street key: drops a `For Sale |`
  prefix, a unit letter and a trailing city; `Pky` = `Pkwy`), Medicare id, physical (year built and lot
  within 1%). A merge needs two.
- **Vetoes** (`dia_dup1_pair_signals`): two different CCNs; an operator conflict (the curated operator
  column, tenant text only when the operator is blank, legacy brands normalized); an address conflict
  (different street key, opposite directional, different unit letter). The city is never a veto.
- **Before the merge** it fills the keep row's blanks and supersedes the drop row's duplicate active
  listing. `dia_merge_property` deletes that listing otherwise.
- **After the merge** it reconciles listings to sales, records every close since the merge began
  (trigger closes included), and supersedes the open reviews it settled.
- Everything is logged in `dia_dup1_merge_log`; `dia_dup1_restore(batch)` undoes it newest-first. A
  rolled-back round trip restored every row, listing and close.
- The Decision Center `property_twin` verdict now calls it with `p_human_confirmed => true`.

## 2. Named cases

| case | outcome |
|---|---|
| Kissimmee 37696 / 37624 / 24669 | Merged into 24669 (backups 603, 604). Listing 12235 superseded into 12026, which closed sold by sale 14880. Owner Zela and the parcel filled. |
| Oak Forest 25570 / 38853 | 38853 merged into 25570 (backup 605). Parcel and owner NS Retail filled; listing 12686 closed by sale 14875. |
| Birmingham 35815 / 51242 (sale 15136) | One signal plus a street conflict → card. Review 17 stays open. |
| Dayton 27901 / 38412 | The flyer (intake `0e9cf33c`) names 1431, the DaVita. Listing 15006 superseded into 15281 on 27901 (price $2,037,500, cap 7.40%, seller The Gilbert Group filled). Whether 1403 and 1431 are one building can't be settled with no parcel on either row → card. |
| Gov Marathon | Listing `ebec7571` repointed 3741 → 41088 (`gov_dup1_repoint_listing`, batch `dup_records1_marathon_20260926`). It closed sold with sale `8f06315d`; review 12 superseded. |

Reviews 13, 14 and 18 superseded (`auto:dup_records1`).

## 3. Gov owner duplicates

`gov_dup1_merge_owner_dups` (government-lease `sql/20260926_gov_dup_records1.sql`) groups recorded owners
whose names differ only in case and punctuation (`GRAHAM OFFICE LLC` / `Graham Office, LLC`) and merges
each through `apply_owner_merge`, snapshotting the moved rows first.

- Batch `dup_records1_owners_20260926`: **84 merges across 78 groups**.
- Held: 1 card (Ray Fuller Farms, AR vs TX), 5 brokerage/junk groups, 5 groups with no legal form.
- `gov_dup1_restore_owner_merges(batch)` round trip passed (rolled back).
- The hub merge-follow repointed **24** contacts at the 13:23 tick. It missed 12:53 because the mirror
  had not synced. 2 new conflicts where the survivor already has a hub contact (55 on tombstones in all).

## 4. Stopping new duplicates

- **Same property for listing and sale.** `upsertDomainProperty` is the one resolver both channels use.
  Its equivalence fallback now treats `5340A` = `5340` and `Pky` = `Pkwy`, and refuses `5340A` vs `5340B`.
- **Junk addresses refused** at both property writers: `<dom>_address_is_junk` + a BEFORE trigger that
  raises 23514 on an insert or an address change. An unmerge re-insert is exempt.
- **Sidebar-sale feed.** `lcc_sidebar_sale_feed_rows` on LCC Opps + Railway `/api/sidebar-sale-feed`
  stage CoStar-sidebar sales into `<dom>_sidebar_sale_candidate`, idempotent on `(entity_id, row_key)`.
  The 05:40 cron is applied after the deploy.

## 5. Sizing

- **dia** (batch `dup_records1_sizing_20260926`): 10 merged, 71 carded, 4 skipped, 0 errors. 74 pairs
  with one signal and a veto were not carded (co-located clinics, different buildings). 9 junk-address
  rows remain.
- **gov**: 297 same-address pairs, 5 with a physical match, lease numbers never agree. No gov merger was
  built (`DUP-RECORDS1-gov-properties`).

## 6. Tests

- LCC `test/dup-records1.test.mjs` (23): two-signal gate, vetoes, supersede, restore, junk guard,
  unmerge exemption, the JS matcher, feed idempotency. Each rule has a mutation that turns it red.
- government-lease `tests/unit/test_dup_records1.py` (10): owner grouping, merge, restore, repoint,
  junk guard.
