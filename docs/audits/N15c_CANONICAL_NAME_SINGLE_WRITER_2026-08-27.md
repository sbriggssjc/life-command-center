> **📍 CANONICAL REFERENCE: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md)**
> (entity identity + merges). **This file is the EVIDENCE for one round; read the canonical page
> first.** Predecessor: [`N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md`](N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md)
> (the measurement). ⚠️ **Two of the three objects are applied live; the TRIGGER is deliberately
> not — see §3.**

# N15c — `entities.canonical_name` gets one writer

**Built 2026-08-27 against LCC Opps (`xengecqvemvfknjvbvrq`), 62,368 live entities.**
N15b measured and wrote nothing. This round ships the rule, the single writer, the tests and the
standing instrument. Scott's decision on the token rule is implemented as stated.

---

## 1. Headline

| fact | value |
|---|---:|
| live entities | 62,368 |
| **invisible to `ensureEntityLink`'s own lookup today** | **10,336** |
| **invisible after the backfill** | **537** — exactly the rows held for Scott |
| rows the backfill rewrites | 15,402 |
| rows already correct | 46,429 |
| writers of this column — **N15b said 7, the build found 10** | 10 |
| `auto_mergeable` | **3,040 → 3,040** |
| `lcc_owner_domain_core` output changed on | **0 of 103,710 values** |

---

## 2. The rule, and the one thing that had to be right

**Scott, 2026-08-27: a DST, its Trust and its LLC are ONE entity — the true owner.** So the
`trust|dst|reit` strip is correct and adopted; what N15b listed as that rule's "named residue" is
the desired behaviour. ⚠️ Individual investors holding **fractional** positions in a DST/TIC/JV are
backlog **N17** and must not be modelled by splitting this key — fractional interest is a
*relationship*.

**The key is the token stoplist of `lcc_owner_domain_core`, joined with SPACES.** Measured over the
43,219 live organizations:

| join | distinct keys | rows collapsed |
|---|---:|---:|
| **space-joined (adopted)** | **37,519** | 5,700 |
| no separator (`lcc_owner_domain_core` as-is) | 37,404 | 5,815 |

The 115 fewer keys under the no-separator form are **false collisions**, demonstrated on the named
row: `Gate Way` → `gate way` and `Gateway` → `gateway` stay apart under the space join and **collide**
without it. Pinned by a test.

**One token list, two join styles** — `lcc_entity_name_tokens` owns the stoplist;
`lcc_entity_canonical_key` joins on `' '`, `lcc_owner_domain_core` on `''`. Two lists is the
normaliser drift this repo has paid for repeatedly.

### The refactor is provably a no-op for every existing caller
`lcc_owner_domain_core` underwrites P187, P188, P194, P196, P197 and P198. Its output was compared
against the refactored form over **all 62,368 live entity names plus every `company_name` in
`lcc_sf_list_membership` and `unified_contacts` plus hostile edge cases (NULL, empty, `İstanbul`,
tabs, apostrophes, `O'Brien & Sons, L.L.C.`) — 103,710 values, 0 mismatches.**
⚠️ Class 11: that zero was not believed until the same detector was pointed at deliberately-wrong
variants — a space join and a reversed token order each reported **~59,800 mismatches**. (A third
mutation, appending `LLC` to every name, correctly reported 0 — because appending a stopword *is* a
no-op. That is the rule working, not a blind detector.) Tier 0 surfaces are unmoved and provably so:
ask 82 / auto 9 / parked 137 / `auto_mergeable` 3,040.

---

## 3. ⚠️ Deploy order — the trigger is NOT applied, on purpose

This repo's standing rule is *"additive schema before the writer deploy; a constraint that enforces
new writer output AFTER it."* The trigger is the second kind, and here it has teeth: it writes the
N15c key, and the **currently deployed** `ensureEntityLink` still looks rows up by the pre-N15c key.
Applying the trigger and running the backfill against the old build would make 15,402 rows
unfindable at once and turn a ~4/day duplicate leak into a spike.

| migration | contents | state |
|---|---|---|
| `20260827230000_..._entity_name_tokens` | the token functions + `lcc_owner_domain_core` refactor + the developer-view repoint | **applied live** |
| `20260827230100_..._canonical_backfill_and_drift` | the trigger FUNCTION (inert), the attributability gate, the ledger, the backfill (dry-run default), `v_lcc_canonical_name_drift`, the `field_source_priority` row | **applied live — nothing writes** |
| `20260827230200_..._canonical_name_trigger` | **`CREATE TRIGGER` — the one statement that activates it** | **NOT applied** |

**The shipped JS is DUAL-READ**: `ensureEntityLink` queries the current key *and* the legacy key in
one PostgREST `in.(...)`, preferring an exact hit on the current key. That makes the order safe in
either direction once the JS is live, and it is what lets the 537 held rows keep resolving.

### The post-deploy sequence
```
curl -s https://<railway-host>/version              # the DEPLOYED sha, not the merged one
git merge-base --is-ancestor <branch-sha> <deployed-sha>
# then:
psql> \i supabase/migrations/20260827230200_lcc_n15c_canonical_name_trigger.sql
psql> select * from lcc_n15c_backfill_canonical_names(true);              -- dry run
psql> select * from lcc_n15c_backfill_canonical_names(false, 'n15c_go');  -- apply
psql> select drift_class, count(*) from v_lcc_canonical_name_drift group by 1;
```
Reverse a batch by `batch_tag` against `lcc_n15c_canonical_backfill_log`.

**The round trip was run, not asserted** (P195). Against live rows, inside a transaction that
rolls back: 200 rewritten, 200 ledgered, 0 still drifted, then the documented reversal restored all
200 **byte-identically**. Residue afterwards: ledger 0 rows, drift unchanged, `auto_mergeable`
3,040, triggers on `entities` 0.

---

## 4. The writer census was wrong — there are TEN, and grep is why the fix is at the DB

N15b listed seven; the prompt added an eighth (`w8_u5_naming_hygiene`). The build found **two more**,
and a **twelfth normalization** hiding in a defensive ternary.

| # | writer | normalization | disposition |
|---|---|---|---|
| 1 | `entity-link.js::normalizeCanonicalName` | JS #1 | **is now the one rule** |
| 2–3 | `entities-handler.js` POST + PATCH | inline copy, drifted by one character | deleted, imports #1 |
| 4–6 | `lcc_finalize_classified_owners`, `lcc_finalize_bridge_eligible_owners`, `lcc_register_owner_parent` | `lower(trim())` verbatim | trigger overrides |
| 7 | `lcc_mint_gov_asset_entities`, `cortex_promote_entities` | `lcc_normalize_entity_name` | trigger overrides |
| 8 | `admin.js` naming-hygiene verdict | **`rpc/lcc_normalize_entity_name` — the AGGRESSIVE normalizer**, banned-for-identity | recompute removed; trigger owns it |
| **9** | **`api/sync.js:2718`** — POST + PATCH `entities` | JS #2 | **missed by the census**; routed through #1 |
| **10** | **`api/domains.js:356/372`** via `buildCanonicalName` | JS #2 | **missed by the census**; routed through #1 |
| — | `api/operations.js` ×2 | `(typeof normalizeCanonicalName === 'function') ? … : newName.toLowerCase()` | **a 12th normalization in a dead fallback branch** — removed |

⚠️ **This is the argument for fixing it at the database.** Three separate passes over the same
codebase produced three different writer counts. A `BEFORE INSERT OR UPDATE OF name` trigger does not
care how many writers there are, and it closes the staleness class in the same stroke because it
recomputes when a name-repair path rewrites `name`.

- ⚠️ The trigger sets `NEW.canonical_name` and **returns `NEW` unconditionally**. A BEFORE trigger
  that returns NULL to skip a row silently defeats `ON CONFLICT DO UPDATE` (P196) — and
  `lcc_finalize_classified_owners` upserts `ON CONFLICT (id) DO UPDATE` through this table. Proven
  live in the rolled-back gate: the DO UPDATE runs and the conflict path derives the key.
- It is `UPDATE OF name`, deliberately **not** a bare `UPDATE`, so an unrelated write does not
  recompute — the 537 held rows stay held.

---

## 5. The empty key — and a real firm rescued from it

98 live entities reduce to no tokens (`--` ×89, `Llc`, `Corporation`, `LC`, `The`, `Trust`,
`The Corporation Trust Incorporated`). They get a **`dc:`-namespaced fallback**, provably disjoint
from every real key because a real key is `[a-z0-9 ]+` and can never contain a colon — the same
device and prefix as `v_lcc_merge_candidates_normalizer_blind` (P189).

⚠️ **This is strictly better than today, and the reason is a live defect.** **114** entities share
`canonical_name = ''` right now, and one of them is **`Partners Group`** — a real firm whose two
semantic tokens are *both* stripped by the outgoing normalizer, leaving it keyed identically to `--`
junk. Under the adopted rule it keys `partners group`. `CO` is rescued the same way. The
contentless population *shrinks* 114 → 98.

---

## 6. `v_lcc_developer_classification_candidates` — the repoint was not optional

⚠️ **N15b's "222 of 274" does not reproduce, and the view's own row count is not the measurement.**
The view returns **5 rows**, because 269 candidates are already in
`lcc_developer_classification_log`; the 274/277 is the underlying candidate population, and the
resolution rate lives in the join inside `named_c`, not in the view's output.

Measured over the 277 candidates:

| join | resolves |
|---|---:|
| `e.canonical_name` (today) | 218 |
| **`lcc_normalize_entity_name(e.name)` (repointed)** | **267** |
| `e.canonical_name` *after* N15c lands | **196** ← the regression the repoint prevents |

So this is the one surface that wants the aggressive normalizer, and leaving it alone would have made
it **worse**, not merely unchanged. It now computes what it needs instead of depending on another
writer to leave the value in a shared column. Live effect: 5 → 6 rows, 3 previously-blind candidates
resolved. There is already a functional index `idx_entities_norm_name_org`, so the join is an index
scan at 0.04 ms.

**Stated, not hidden:** the LEFT JOIN fans out where a normalized name matches several entities
(`Curtis` → 2). Pre-existing in kind; potential rows across all candidates go **323 → 363**. Two
entities sharing a normalized name is genuine ambiguity and surfacing both is the never-guess rule;
the classification log keys on `(source_domain, candidate_norm)`, so one decision clears all rows for
a candidate.

### ⚠️ Surfaced, NOT fixed: `attributed_rent` is a self-comparison and is fabricated
The view's rent subquery correlates on **`pof.source_property_id = pof.source_property_id`** — a
column compared to itself. The plan shows it as a `One-Time Filter`, and the consequence is
measurable: **`attributed_rent` has exactly ONE distinct value across every row of the view**
(`$34,920,891.77`), which is the **gov-wide** sum of all current portfolio facts, not the
candidate's. It is a one-character defect (`pf.` not `pof.`) and it is also ~1,509 ms of the view's
1,666 ms.

**Not fixed here**: it changes a number an operator classifies on, in a subsystem this round does not
own, and nobody has graded the corrected ranking. Backlog **N18**.

---

## 7. What needs Scott — surfaced, not guessed

1. **The 537 stale rows.** `canonical_name` left behind after `name` was repaired
   (`Scott W. Beynon` still keyed `buyer contactsscott w beynon 801 568 1031 p`). Recomputing
   discards a captured string some of them preserve. They are **excluded from the backfill by
   construction** — `lcc_n15c_canonical_is_attributable` admits a row only when its stored key is
   explainable as some prior normalization *of the current name*. They are the entire residual
   after the backfill (10,336 → 537) and they carry **33 organizations**; the rest are people/assets.
   To fold them in: `select * from v_lcc_canonical_name_drift where drift_class='held_stale_name_repair'`.
2. **Whether `canonical_name` becomes an enforced UNIQUE key.** Not proposed here. Today the index is
   a plain btree `idx_entities_canonical (workspace_id, canonical_name)` and 3,930 groups would
   violate a unique constraint.

---

## 8. Verify by — not rows rewritten

| # | criterion | state |
|---|---|---|
| a | `ensureEntityLink` finds an existing row for the currently-invisible entities | **10,336 → 537**, and the 537 are the held population. Simulated; realised by the post-deploy backfill |
| b | `lcc_owner_domain_core` byte-identical | ✅ **0 of 103,710**, with the detector positive-controlled |
| c | `auto_mergeable` moves by ZERO | ✅ **3,040 → 3,040** |
| d | developer view resolves 267 of 277 | ✅ (up from 218; 196 had it been left alone) |
| e | **Class 8, a day later**: re-run the recurrence query; post-fix mints of disagreeing pairs should go to **0** against today's ~4/day | ⏳ **this is the check that separates a fixed producer from a backfill** — run it after the trigger lands |

The standing instrument is **`v_lcc_canonical_name_drift`**. ⚠️ **Read `drift_class`, not the total**:
after the backfill the total should hold at the held rows only, and a **new `backfillable` row means a
writer escaped the trigger.** That is the number that says whether the producer is fixed.

---

## 9. Tests

`test/entity-canonical-key.test.mjs` — 8 tests, **all 8 mutation-verified RED**: no-separator join,
dropping `trust` from the stoplist, adding `group` to it, stripping `the` at any position, an empty
key instead of the `dc:` fallback, defeating the dual-read, treating `&` as a plain separator, and an
inline copy restored in `sync.js`.

Every `[name, expected]` pair is a **real live entity name paired with the output SQL actually
returned for it** — 279 adversarial pairs were compared live (non-ASCII, ampersands, leading
articles, dotted legal forms, embedded newlines, the empty-key set) and the behaviour-complete subset
is kept in the file. The character test is **exhaustive over the corpus's real alphabet**: all 98
distinct characters present in any live entity name, checked for identical `lower()` mapping and
`[^a-z0-9]` classification.

⚠️ **The inline-copy guard had to be rewritten mid-build.** Its first version matched the *shape*
`canonical_name: x.trim()`, and the mutation that assigned an inline copy to a local `const` walked
straight through it — the "guard checks the label, not the substance" failure. It now **resolves the
assigned identifier** to its initializer. Rewriting it is what surfaced the 12th normalization in
`operations.js`.

Full suite: **4,755 pass / 0 fail / 6 skipped.**
