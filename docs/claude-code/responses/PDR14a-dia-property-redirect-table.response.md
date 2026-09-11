# PDR14a — one canonical, permanent redirect table for every dia property merge

**Status:** shipped to `claude/pdr14a-dia-property-redirects` (pushed, **no PR opened** — awaiting
instruction). Migration **applied live** to dia `zqzrriwuavgrquhisnoa` and **committed in the same
change** (the "running but not merged" rule).

**PDR14b can start once this merges.** The resolver's shape is exactly as specified —
`dia_resolve_property_id(bigint) returns bigint` — with **one constraint the LCC side must honour**:
it is `SECURITY DEFINER` and **granted to `service_role` only**. Call it through
`domainQuery('dialysis', …)` (the direct-PostgREST service-key path the property-twin lane already
uses), **never** through `diaQuery`/the `data-query` edge function, which is anon-keyed and would get
a 403. See §6.

---

## 1. What shipped

| object | role |
|---|---|
| `dia_property_redirects` | the ONE table any consumer checks. `dropped_property_id`, `kept_property_id`, `merged_at`, `source`, `batch_tag`, `note`, `reversed_at` |
| `dia_resolve_property_id(bigint) -> bigint` | the resolver PDR14b calls |
| `v_dia_property_redirect_resolved` | flattened read surface (derived, so it cannot go stale) — `dropped_property_id`, `recorded_survivor_id`, `final_survivor_id`, `is_chained`, provenance |

Files (dia repo, branch `claude/pdr14a-dia-property-redirects`, commit `8b45b71`):

- `supabase/migrations/20260911120000_dia_pdr14a_property_redirects.sql`
- `tests/test_pdr14a_property_redirects.py`

---

## 2. Live counts — measured before and after, not assumed

**Ledger census (the five tables, live 2026-09-11):**

| ledger | rows | reversed/excluded | span |
|---|---:|---:|---|
| `dia_property_merge_backup` | 588 | 2 unmerged | 2026-08-14 → 2026-09-11 |
| `property_merge_log` | 656 | — | 2026-04-29 → 2026-05-17 |
| `p31_property_consolidation_log` | 12 | 0 (all `decision='applied'`) | 2026-08-04 |
| `dia_property_consolidation_log` | 6 | 3 reversed | 2026-08-05 |
| `dq7_property_merge_map` | 19 | — | 2026-05-21 |

**Backfill:** 1,276 candidate rows → **1,267 rows in `dia_property_redirects`** (9 duplicates
deduplicated; source-priority order merge_backup > dia_consol_log > p31 > property_merge_log > dq7).

**Zero conflicting mappings** across all five ledgers — no `dropped_property_id` maps to two different
survivors — which is what makes the partial unique index on `(dropped_property_id) WHERE reversed_at
IS NULL` safe rather than optimistic.

**LCC orphan positive control (live against LCC Opps `xengecqvemvfknjvbvrq`):**

| | count |
|---|---:|
| distinct dia-linked `domain_property_id` values | 1,246 |
| still live in dia `properties` | 1,157 |
| **orphaned (point at a deleted id)** | **89** ← reproduces the investigation exactly |
| **of those, now resolvable via `dia_resolve_property_id`** | **31** |
| still unresolved (no trace in any ledger) | 58 |

⚠️ **The spec predicted "28 explained / 61 unexplained"; measured it is 31 / 58.** The three extra come
from things a per-ledger count cannot see: **chained** resolution (a survivor that has itself since
been merged away) and the **soft-merge** column `properties.merged_into_property_id`, which no ledger
tally covers. Per the brief, the 58 are out of scope.

**DaVita / Donna TX positive control (the case named in the spec):**

```sql
select dia_resolve_property_id(37722), dia_resolve_property_id(23545),
       dia_resolve_property_id(37710), dia_resolve_property_id(39874);
-- 39874 | 39874 | 39874 | 39874   ✅
select dia_resolve_property_id(999999999);  -- NULL  ✅ (never a false match)
select dia_resolve_property_id(null);       -- NULL  ✅
```

(That case is a direct 3→1 merge recorded in `dia_property_merge_backup` on 2026-09-11, not a chain.)

---

## 3. Three design decisions, each measured rather than assumed

### 3a. Raw pairs + recursive resolver, **not** a pre-flattened table

**43 of the 1,276 backfilled rows have a `kept_property_id` that is itself now gone** — chains are
real, not hypothetical. Pre-flattening would require every new merge to rewrite every historical row
pointing at the id it just dropped: a second write path that can partially fail and then silently lie,
and one **none of dia's existing merge functions is built to maintain** (each writes only its own row).
The recursive walk is derived from raw facts at read time and therefore cannot go stale. The flattened
form still exists — as a VIEW, which is likewise derived.

### 3b. ⚠️ The hook goes in `dia_merge_property`, **not** `dia_merge_property_reversible`

The spec's stated assumption ("if `dia_merge_property_reversible` is the one shared function both
detectors call…") **does not hold**. Read off the live catalog:

```
dia_auto_merge_property_duplicates  -> dia_merge_property                          (geospatial cron, DIRECT)
dia_merge_twins                     -> dia_merge_property_reversible -> dia_merge_property
dia_merge_strong_id_twins           -> dia_merge_property_reversible -> dia_merge_property
p31_property_consolidation_apply    -> dia_merge_property
```

`dia_merge_property(integer,integer)` is the **only** function carrying the `DELETE FROM
public.properties`, and **the geospatial cron calls it directly** — hooking only the reversible wrapper
would have missed the highest-volume producer entirely. One INSERT in the primitive covers all four
callers.

Two further paths drop or supersede a properties row **without** going through it, and are hooked
separately:

- **`merge_dialysis_dup_property`** — legacy, its own `DELETE`, no ledger of its own.
- **`dia_consolidate_property_reviewed`** — a **SOFT** merge: it sets
  `properties.merged_into_property_id` and the drop row *survives*. The resolver honours that column
  too, so a superseded-but-live row still resolves forward.

Callers label their own provenance through `set_config('dia.merge_source', …, true)` rather than a new
function parameter — adding a defaulted argument to `dia_merge_property` would make every existing
2-arg call fail `42725 "function is not unique"` (the documented overload footgun).

### 3c. A live property always resolves to **itself**, checked before any redirect is followed

**10 of the 19 `dq7_property_merge_map` rows name a `duplicate_id` that is still live** and carries no
`merged_into_property_id` — that map was planned and at least partly never applied. Adjudicating each
would be guesswork. Instead the resolver follows a redirect only for an id that is absent-or-soft-merged,
so those 10 rows are **structurally inert** rather than actively wrong, and an unmerge that failed to
clear its redirect is **self-healing**. The rows are still recorded, with a `note` — evidence is not
deleted here.

---

## 4. Safety properties

- **The redirect INSERT is gated on the state delta (`v_n > 0`).** `dia_merge_property` catches its own
  delete failure and reports `properties_delete_failed`; a redirect written over that would assert a
  merge that did not happen.
- **Reversal stamps `reversed_at`; nothing hard-deletes a redirect row.** `dia_unmerge_property` clears
  the live redirect for the pair; the resolver only follows `reversed_at IS NULL`.
- **Hop cap (20) + cycle guard**, mirroring `lcc_entity_survivor` — a cycle must terminate, never hang,
  and an exhausted cap returns NULL ("cannot resolve"), never a halfway answer.
- **`SECURITY DEFINER` privilege stanza applied in full**: revoked from `public` **and** the explicit
  `anon`/`authenticated` grants (removing either alone is a no-op), then **asserted** with
  `has_function_privilege()` rather than read off the REVOKE just written.
- **Idempotent**: every patch is guarded on `position('dia_property_redirects' in v_def) = 0`; the
  backfill is `ON CONFLICT DO NOTHING`. Re-running the migration is a no-op.
- **Reversal runbook** is in the migration foot; the backfill is re-derivable from the five ledgers at
  any time.

### ⚠️ On the function patches being anchored rather than full bodies

`dia_merge_property` is 7.4 KB carrying sixteen rounds of prior fixes (MERGE1's fold-on-collision, the
ownership/PSE unique-violation handling, the sales-child repoint). Re-stating a hand-transcribed copy
is the **P194 hazard in its more dangerous direction**: a stale copy silently *reverts* work nobody
remembered was in there. Each patch is therefore a `DO` block that asserts its anchor appears **exactly
once** and `RAISE`s otherwise — it can only ever insert, it cannot regress, and it cannot pretend to
have applied. All seven patches were verified live on `pg_get_functiondef` after applying.

---

## 5. Verification performed

**Behavioural round trip, live on dia, inside a self-rolling-back transaction — 0 residue:**

1. three synthetic properties created; a live, never-merged id resolves to **itself** ✅
2. A merged into B via `dia_merge_property_reversible` → a redirect row appears with
   `source='merge_reversible'` and the caller's `batch_tag` ✅, and A resolves to B ✅
3. B then merged into C → **A resolves to C, not B** (chained) ✅
4. `dia_unmerge_property` → the redirect is `reversed_at`-stamped ✅ and A resolves to **itself** again ✅
5. residue check afterwards: 0 test properties, 0 test redirects, table still 1,267 rows ✅

**Guard:** `tests/test_pdr14a_property_redirects.py` — **30 passed, 2 skipped**, and **18/18 mutations
verified RED**. Comment stripping is quote-aware (single-quote *and* dollar-quoted bodies) and is
load-bearing: the migration's own header discusses dq7, the live-self rule, `reversed_at`, and quotes
every anchor it patches, so a raw-source grep would match the prose and pass straight over a regression.

⚠️ **Two guard defects were found by the mutation pass, not by reading them** — worth recording because
both are recurring families:

- A whole-file grep for `reversed_at` **passed over a dropped COLUMN**, because the index and the
  resolver both mention the name. Now scoped to the `CREATE TABLE` body.
- **`dia_merge_property` is a PREFIX of `dia_merge_property_reversible`**, so a loose
  `raise exception 'PDR14a: {fn}[^']*'` let the sibling's anchor assertion satisfy the check for the
  primitive — the one function the whole unit depends on. Now anchored on `{fn} ` followed by a space.
- Two further count-with-slack assertions (anchor assertions, idempotence guards) were green after
  mutating a single occurrence; both are now per-function / exact-count.

The two live checks skip without a real `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (CI has no DB
egress, and the resolver is service_role-only). They call PostgREST directly rather than through the
supabase SDK, so they cannot go red for SDK-version reasons.

---

## 6. 👉 What PDR14b needs to know

1. **Signature is as specified:** `dia_resolve_property_id(p_property_id bigint) returns bigint`.
   - live and never merged → the same id
   - merged (any depth, including chains) → the **current live survivor**
   - never existed / hard-deleted with no redirect / cycle / beyond 20 hops → **NULL**, never a guess
2. **⚠️ It is `service_role`-only.** Use `domainQuery('dialysis', …)`, not `diaQuery` and not the
   `data-query` edge function. No edge-allowlist change is needed or possible for it. If PDR14b needs
   an anon-reachable path, that is a deliberate decision to make explicitly — do not widen the grant
   casually, and re-assert with `has_function_privilege()` if you do.
3. **For a bulk reconcile of the 89, prefer the view.** `v_dia_property_redirect_resolved` gives
   `dropped_property_id → final_survivor_id` in one read (also `service_role`); the per-id RPC is for
   point lookups.
4. **31 of the 89 will resolve; 58 will return NULL.** NULL means *no redirect on file* — it must NOT
   be written back as a pointer, and it is not evidence the entity is junk.
5. **Nothing in dia writes back to LCC.** PDR14a records and resolves; the LCC-side repoint is PDR14b's
   to design (and `property_merge_log.reconciled_lcc_at` claiming 100% reconciled while LCC still shows
   stale pointers is a good reason for PDR14b to assert on the **state delta** — entities repointed —
   rather than on a stamp).
6. **Forward coverage is automatic.** Any future merge through any of the six paths writes its redirect
   in the same transaction, so PDR14b's reconciler only ever has to handle the delta, not re-derive
   history.

---

## 7. Explicitly not done (per the brief)

- No further archaeology on the 58 unexplained orphans.
- PDR2 (the LCC-side ownership guard gap) untouched.
- **No change to what `dia_auto_merge_property_duplicates` or `dia_merge_strong_id_twins` decide to
  merge** — this unit only adds a durable record of merges that already happen, plus a way to resolve
  them.
- No PR opened.

## 8. Noted, not fixed

- `dia_consolidate_property_reviewed`'s reversal path (whatever clears `merged_into_property_id`) does
  not yet stamp `reversed_at` on its redirect. Today the population is 2 rows and both are live
  soft-merges, so nothing is wrong; if that lane grows a reversal, it should stamp the redirect the way
  `dia_unmerge_property` does.
- `revert_property_link_outcome` also deletes from `properties`, but it reverts a *link outcome* rather
  than performing a merge (there is no surviving keep id to redirect to), so it is deliberately not
  hooked.
