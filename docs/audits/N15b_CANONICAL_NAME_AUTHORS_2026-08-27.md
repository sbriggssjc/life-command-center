> **📍 CANONICAL REFERENCE: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md)** (entity identity + merges) and **[`docs/architecture/ownership-history-lane.md`](../architecture/ownership-history-lane.md)** (the chains). **This file is the EVIDENCE for one round; read the canonical pages first.** ⚠️ Its recommendation is NOT applied — three decisions are pending in §6.

# N15b — `entities.canonical_name` has SEVEN authors, and the merge detector is not one of its readers

**Measured live on LCC Opps (`xengecqvemvfknjvbvrq`), 2026-08-27, over 62,363 live entities**
(`merged_into_entity_id IS NULL`). **Nothing was written.** This is the measure/propose/gate step
the brief asked for; the normalization choice is Scott's call and is stated at the bottom.

---

## Headline

| fact | value |
|---|---:|
| live entities | 62,363 |
| **invisible to `ensureEntityLink`'s own lookup by their own name** | **10,340 (16.6%)** |
| …of which organizations | 9,658 |
| live duplicate entities attributable to key disagreement | 3,636 |
| new such duplicates since the 07-29→08-05 burst (21 days) | **79 (~4/day, most recent 2026-08-26)** |
| byte-identical-name groups disagreeing on `canonical_name` | 2,028 groups / 4,138 entities |

`api/_shared/entity-link.js:1024` — the choke point every mint funnels through — looks up
`entities?canonical_name=eq.<normalizeCanonicalName(name)>`. **10,340 live rows carry a
`canonical_name` that is not what that function computes from their own `name`**, so re-encountering
any of those names misses and mints. That is the factory, stated as one number.

⚠️ **`canonical_name` has NO unique constraint** — only `idx_entities_canonical
(workspace_id, canonical_name)`, a plain btree. It is a *de facto* dedup key that nothing enforces.

---

## 1. The writer census — seven authors, four of them live and distinguishable

| # | writer | normalization | rows it explains |
|---|---|---|---|
| 1 | `api/_shared/entity-link.js::normalizeCanonicalName` (`ensureEntityLink`, `operations.js`, `intake.js`, `sync.js`, `admin.js`, `sidebar-pipeline.js`) | lower · strip `llc\|inc\|corp\|ltd\|co\|company\|group\|partners\|lp\|llp` · `[^a-z0-9\s]`→**space** | **52,023** (largest) |
| 2 | `api/_handlers/entities-handler.js` **×2** (POST create ~2686, PATCH update ~2840) | **inline copy of #1** except `[^a-z0-9\s]`→**deleted** | 49,832 |
| 3 | SQL `lcc_finalize_classified_owners` (dia/gov owner sync) | `LOWER(TRIM(name))` — **verbatim, no strip at all** | the 9,285 verbatim-only cohort |
| 4 | SQL `lcc_finalize_bridge_eligible_owners` | `LOWER(TRIM(resolved_name))` — verbatim | (in the same cohort) |
| 5 | SQL `lcc_register_owner_parent` (R47) | `lower(btrim(v_name))` — verbatim | " |
| 6 | SQL `lcc_mint_gov_asset_entities` (P141), `cortex_promote_entities`, `cortex_approve_promotion` | `lcc_normalize_entity_name(name)` — the SQL normalizer | 46,045 |
| 7 | **name-repair paths that update `name` and never recompute `canonical_name`** | (none — the value goes stale) | 540 |

**#1 and #2 are genuinely different and both live**: `"BALTARA ENTERPRISES, L.P."` → `baltara
enterprises l p` under #1, `baltara enterprises lp` under #2. 2,369 live rows match #1 and not #2;
178 match #2 and not #1.

### Attribution (mutually exclusive buckets)

| sql_norm | verbatim | js #1 | js #2 | rows | first seen |
|:--:|:--:|:--:|:--:|---:|---|
| ✓ | ✓ | ✓ | ✓ | 29,842 | 2026-03-27 |
| ✓ | ✗ | ✓ | ✓ | 14,002 | 2026-04-07 |
| ✗ | **✓** | ✗ | ✗ | **9,285** | **2026-05-22** |
| ✗ | ✓ | ✓ | ✓ | 2,563 | 2026-04-13 |
| ✗ | ✗ | ✓ | ✓ | 2,398 | 2026-04-09 |
| ✓ | ✗ | ✓ | **✗** | 2,070 | 2026-04-10 |
| ✗ | ✗ | ✗ | ✗ | **540** | 2026-04-09 |
| (sql_norm NULL — P189 blind spot) | | | | 1,070 | |

The 29,842 top row is why this survived eighteen months: for a name with no legal form and no
punctuation every normalization is a no-op, so **the disagreement is invisible until two writers
meet on the same name.**

---

## 2. Two premises in the brief were wrong — both corrected by measurement

### ⚠️ 2a. The "3,400 rows match no known normalization → there is a third author" premise resolves to **540**, and they are not a normalizer at all

Adding the two JS normalizations to the comparison takes the unexplained set from 3,941 → **540**.
The third and fourth authors were exactly the two JS copies. The 540 that remain are **`canonical_name`
left stale after `name` was later repaired** — the value is not a function of the current name at all:

| `name` (now) | `canonical_name` (stale) |
|---|---|
| `Scott W. Beynon` | `buyer contactsscott w beynon 801 568 1031 p` |
| `Neil Slater` | `seller contactsneil slater 712 336 4650 p` |
| `9647 Ridgeview St` | `davita dialysis tulsa ok 9647 ridgeview st 5500 sf office building…` |
| `Tulsa, OK` | `6120 s yale ave suite 300 tulsa ok 74136` |
| `[JUNK] 1 of 2,000 Records` | `1 of 2000 records` (pre-`[JUNK]`) |

This is the **inverse** failure: a writer that updates `name` and not `canonical_name`. It needs a
different fix from the normalization question (recompute on name change), and it is why "pick one
normalization" alone would not close the gap.

### ⚠️ 2b. `v_lcc_merge_candidates` does NOT read `canonical_name` — the feared `auto_mergeable` blast radius is structurally ZERO

The brief's gate ("how group membership changes… the delta to `auto_mergeable`… whether any group
that becomes auto-mergeable contains a sibling SPE") cannot be answered as posed, because the view
**groups on `lcc_normalize_entity_name(e.name)`**:

```
group_key := CASE WHEN norm_name IS NOT NULL THEN norm_name ELSE 'dc:'||domain_core END
```

`canonical_name` appears in the `normalized` CTE as a **dead passthrough column** — selected, carried
through `qualifying`, and never used in a predicate, a `GROUP BY`, or the final projection.
`auto_mergeable` is computed from `raw_name_compatible`, `owner_role`, `external_identities` and
`pinned` — none of which touch it. **Rewriting `canonical_name` cannot move `auto_mergeable`, cannot
change group membership, and cannot feed `lcc_apply_fuzzy_merges` a new group.**

Also unsatisfiable as written: verify criterion (b) asks that `671 Poplar` and `Baltara` surface as
one group each. **Each is now a single live entity** — A2a already merged them. There is nothing left
to group.

---

## 3. The blast radius that IS real — two views and five JS lookups

| surface | how it keys | effect of a rewrite |
|---|---|---|
| `api/_shared/entity-link.js:1024` (`ensureEntityLink`) | `canonical_name=eq.<#1>` | **the mint decision** — this is the one that matters |
| `api/operations.js:5772`, `api/admin.js:7955`, `:10523` | `canonical_name=eq.` | duplicate probes / linked-entity resolution |
| `api/intake.js:1605` | `canonical_name=ilike.*…*` | person lookup |
| `v_duplicate_candidates` | `GROUP BY canonical_name` | output changes directly (today **3,930 groups / 8,495 entities**) |
| `v_lcc_developer_classification_candidates` | `JOIN … ON e.canonical_name = lcc_normalize_entity_name(developer_name)` | see below |
| `v_lcc_merge_candidates`, `v_entities_effective_role`, `v_lcc_operator_affiliates` | passthrough column only | **no logic change** |

**`v_lcc_developer_classification_candidates` is already ~19% blind** and nobody has noticed: it joins
`canonical_name` against `lcc_normalize_entity_name(developer_name)`, but only 73.8% of entities
carry that value. Measured: **222 of 274** developer candidates resolve an entity today;
**269 of 274** would if `canonical_name` were aligned to `lcc_normalize_entity_name`. That view is a
constraint on the choice — it is the one surface that *wants* the aggressive normalizer.

---

## 4. The choice, graded on named rows

Collapse behaviour over the 43,228 live organization entities:

| candidate key | distinct keys | rows collapsed |
|---|---:|---:|
| `lcc_ownership_chain_name_key` (lower + strip punctuation, **no token removal**) | 37,961 | 5,267 |
| **`normalizeCanonicalName` (#1, today's de-facto standard)** | 37,563 | 5,665 |
| `lcc_owner_domain_core` (**pure legal forms only**) | 37,405 | 5,823 |
| `lcc_normalize_entity_name` (aggressive; NULL for 1,070) | 36,423 | 6,805 |

### ⚠️ The current standard (#1) strips SEMANTIC tokens, and that is the risky class

`normalizeCanonicalName` strips `group|partners|company|co` on top of legal forms. Graded on 20
random pairs it collapses that `chain_key` does not, ~14 are plainly the same party
(`Hunter Properties` / `Hunter Properties, Inc.`) — but the residue is not benign:

| A | B | shared key |
|---|---|---|
| `WOODLAND GROUP, LLC` | `Woodland Llc` | `woodland` |
| `Carlyle` | `Carlyle Group` | `carlyle` |
| `Madison Realty` | `Madison Realty Group` | `madison realty` |
| `Brookwood Financial Partners, LLC` | `Brookwood Financial Partners` | `brookwood financial` |

This is the documented `Century Park Partners == Century Park Properties LLC` hazard in a milder
dress — and it bites **harder here than in the merge detector**, because `ensureEntityLink` links on
this key **automatically, with no human review**. A merge candidate gets a verdict; a canonical-name
collision just silently becomes the same entity.

### `lcc_owner_domain_core` grades materially cleaner

18 random pairs it collapses that `chain_key` does not — 15–16 unambiguously the same party, and the
wins are exactly the variance a dedup key *should* absorb:

`McCleary and Earley Inc` / `McCleary & Earley, Inc.` · `Adair and Associates` / `Adair & Associates` ·
`BERNARD WHITE & SONS` / `Bernard White and Sons` · `Kilroy Realty Corporation` / `Kilroy Realty` ·
`Liberty Property Limited Partnership` / `LIBERTY PROPERTY LTD. PARTNERSHIP` ·
`Physicians' Capital Investments, LLC` / `Physician?S Capital Investments` (mojibake) ·
`DODG CORPORATION` / `Dodg Corp`

**Its named residue is the `trust|dst|reit` strip**, which conflates a legal *vehicle* distinction:
`SE VALPO LLC` / `Se Valpo Dst`, `Rainier Rockford DST Trust` / `Rainier Rockford Llc`,
`Chiapelone` / `Chiapelone Trust`. That is the sponsor↔SPE shape A3 and P198 keep meeting. It is
**stated, not patched** — 2 of 18.

⚠️ It also `string_agg(tok,'')` with **no separator**, which is fine for domain comparison and would
create `Gate Way`/`Gateway` collisions as a name key. Reusing it verbatim is not the proposal;
reusing its **token rule** with a space join is — and a space-joined variant is a new function, which
is the normaliser drift this repo keeps paying for. That tension is the decision.

---

## 5. Recommendation (not applied)

1. **Adopt the `lcc_owner_domain_core` token rule** — strip only pure legal-entity forms, keep every
   semantic token (`group`, `partners`, `company`, `capital`, `holdings`, `properties`, `realty`).
   It is strictly safer than today's #1 for a key that drives an unreviewed link, and its residue is
   named and small. **Do not adopt `lcc_normalize_entity_name`**: it is documented banned-for-identity,
   it returns NULL for 1,070 live entities, and as a lookup key it would auto-link
   `Century Park Partners` to `Century Park Properties LLC`.
2. **Then `v_lcc_developer_classification_candidates` must be repointed** to
   `lcc_normalize_entity_name(e.name)` rather than `e.canonical_name` — it is the one surface that
   wants the aggressive normalizer, and it should compute it rather than depend on the column
   carrying it. That also fixes the 52 candidates it silently drops today.
3. **Fix the producer, not the column.** A one-shot rewrite of 4,138 rows is Class 8. The durable fix
   is one function with one caller-facing entry point. Prefer a `BEFORE INSERT OR UPDATE OF name`
   trigger on `entities` that derives `canonical_name` — it covers the three SQL writers, both JS
   writers, and closes the §2a staleness class in the same stroke, because it recomputes on a name
   change. ⚠️ It must **set `NEW.canonical_name` and return NEW unconditionally** — a trigger that
   returns NULL to skip a row silently defeats `ON CONFLICT DO UPDATE` (P196), and
   `lcc_finalize_classified_owners` upserts `ON CONFLICT (id) DO UPDATE`.
4. **Delete the inline copy in `entities-handler.js` (both sites)** and import `normalizeCanonicalName`.
   Two copies of one rule is how #1 and #2 drifted apart on a single character.
5. **Add the unique index only after the rewrite**, and only if Scott wants the key enforced — today
   3,930 groups would violate it.

**Not proposed:** any change to `v_lcc_merge_candidates`, `auto_mergeable`, or
`lcc_apply_fuzzy_merges`. They do not read this column.

---

## 6. What needs Scott

- **Which token rule** (§4) — the `trust|dst|reit` residue is a judgement about whether a DST and its
  LLC should share a dedup key. Measured, not decidable by regex.
- **Whether the 540 stale rows are recomputed** from the current `name`, which would discard the
  original captured string some of them preserve.
- **Whether `canonical_name` becomes an enforced unique key** or stays advisory.

## 7. Verify by (per the brief)

Not rows rewritten. By: (a) the writer census above, every entry pointing at one function;
(b) ⚠️ **criterion (b) is unsatisfiable as written** — `671 Poplar` and `Baltara` are single live
entities post-A2a, and `v_lcc_merge_candidates` does not read this column in any case; substitute
*"`ensureEntityLink` finds an existing row for all 10,340 currently-invisible entities"*;
(c) ⚠️ **`auto_mergeable` should move by ZERO**, and a non-zero move means the change touched
something it should not have; (d) re-run the §1 recurrence query a day later — post-burst mints
should go to 0 against today's ~4/day.

## 8. Positive control (Class 11)

The JS emulations were pointed at known positives before any count was believed. They reproduce the
A2a-documented stored values byte-for-byte: `671 Poplar LLC` → verbatim `671 poplar llc` vs
normalized `671 poplar`; `BALTARA ENTERPRISES, L.P.` → verbatim `baltara enterprises, l.p.` vs
`baltara enterprises l p` (#1) vs `baltara enterprises lp` (#2). No detector in this audit returned
an implausible zero.

⚠️ **Correction to `A2a_AMBIGUOUS_ENTITY_MERGE_2026-08-27.md`:** it describes
`normalizeCanonicalName` as lowercasing "*and* stripping punctuation". It also strips a nine-token
legal-form stoplist. The A2a conclusion is unaffected — it is still strictly looser than
`lcc_ownership_chain_name_key` on the axis those duplicates differ on, so r9 remains refuted as the
producer — but the function is not the simple one the sentence describes.

## 9. The recurrence is a BURST plus a trickle — do not quote the 30-day number

`1,879 in 30 days` is burst-dominated and would misrepresent the rate.

| era | new duplicate entities | note |
|---|---:|---|
| through 2026-07-28 | 1,768 | 1,091 verbatim-canonical, 1,008 bridge-sourced |
| **2026-07-29 → 08-05** | **1,789** | a CoStar/Salesforce sync backfill; 8 days |
| **2026-08-06 → 08-27** | **79** | ~4/day, ongoing, most recent 2026-08-26 |

The steady-state figure is the **79**. The burst clusters on eight days, which is the
bulk-set-status shape this repo warns about; quoting the blended rate would have overstated the
ongoing leak by ~24×.
