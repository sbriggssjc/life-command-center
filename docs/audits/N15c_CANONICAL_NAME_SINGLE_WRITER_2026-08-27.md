> **📍 CANONICAL REFERENCE: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md)**
> (entity identity + merges). **This file is the EVIDENCE for one round; read the canonical page
> first.** Predecessor: [`N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md`](N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md)
> (the measurement). ✅ **ALL THREE OBJECTS ARE NOW LIVE.** The trigger was applied and the
> backfill run at **2026-08-27 20:05 UTC** (batch `n15c_go`), after live `/version` was confirmed
> at `d8fcfbfef94a` — the N15c merge commit — and corroborated by reading the dual-read source at
> that sha. **15,402 rewritten / 537 held / 0 empty-string keys; invisible 10,336 → 537;
> `auto_mergeable` 3,040 → 3,040; Tier 0 ask 82 / auto 9 unmoved.** §3's deploy-order warning is
> kept as the record of why the order mattered. ⏳ **The Class-8 recurrence check is due
> 2026-08-28** — a backfill is not a fixed producer. **➡️ FOLLOW-UP LANDED:
> [`N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md`](N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md)**
> — every writer path was exercised and overridden, the 537 held rows were recomputed (drift 537 →
> 0), and §7's UNIQUE-key figure of 3,930 is superseded by **6,608**. ⚠️ The wall-clock arm of the
> Class-8 check is STILL outstanding: it was attempted 21 minutes after the trigger landed, over a
> population of ZERO new entities, so its "0" is not evidence.

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


---

## 10. Live outcome — applied 2026-08-27 (added after the fact)

PR #1850 merged as `d8fcfbf` at 19:54 UTC. The trigger and the backfill were applied the same
evening. Measured at 20:57 UTC:

| gate | result |
|---|---|
| `v_lcc_canonical_name_drift` | **0 rows** — every live entity's key equals `lcc_entity_canonical_key(name)` |
| positive control on that zero | wrong-key comparison returns rows (capped at 5,000); the zero is real, not a broken detector |
| `auto_mergeable` | **3,040** — unmoved, as predicted |
| `v_field_provenance_unranked` | **33** — unmoved |
| Tier 0 open cards | **91** — unmoved |
| live entities | **62,368** — unchanged |
| entities minted since the backfill | **0** |

**Two batches, not one.** `n15c_go` (20:03) rewrote the 15,402 attributable rows — the intended
backfill. **`n15e_go` (20:38) rewrote the 537 rows this round had deliberately held**, which the
gated function cannot produce (it filters on `lcc_n15c_canonical_is_attributable`), so it was a
deliberate operator decision. It is fully ledgered and reversible by batch tag.

⚠️ **The §7 caution about "discarding a captured string" was right in principle and mostly wrong in
substance.** Read on named rows, the held keys were dominated by junk rather than provenance: a whole
CoStar listing blob (`9647 Ridgeview St` keyed
`davita dialysis tulsa ok 9647 ridgeview st 5500 sf office building … 780 cap rate`), brokerage
pollution the P116 note describes (`… by colliers`, `… by cushman wakefield`), and raw unnormalized
strings stored verbatim (`State of Oklahoma | OKC Innovation Center - Oklahoma City - OK`) that could
never have matched anything. **Decision 1 of §7 is therefore closed.** Note one consequence of the
adopted rule worth knowing: `BREIT via Blackstone Real Estate Income Trust I` keys
`breit via blackstone real estate income i`, because `trust` is a stripped legal form.

### ✅ 2026-08-28 07:35 — THE PRODUCER IS VERIFIED FIXED

The nightly cron block ran. **3 entities minted** (02:21 and 06:30 UTC) and the trigger derived every
key correctly — `JACO SAVANNAH REALTY, INC.` → `jaco savannah realty`, `asset 4477`, `David Bibb`.
**Drift held at 0**, and each new entity is the ONLY live row on its key: **0 duplicate-key groups
were touched by a new mint.** So the trigger and the JS dual-read agree in production, and the
~4/day duplicate leak did not recur. This — not the backfill — is the verification the round turns on.

### ✅ 2026-08-29 07:35 — CONFIRMED AT SCALE: 4,618 mints, drift still 0

The 08-28 confirmation rested on 3 mints, which is thin. A bulk sync has since run: **4,618 entities
minted since the backfill** (live 62,346 → 66,901) and **`v_lcc_canonical_name_drift` is still 0**.

⚠️ **Drift = 0 is necessary and NOT sufficient, and this is exactly where that bites.** A duplicate
storm would also read drift 0 — the trigger would dutifully compute a correct key for every
duplicate. The gate that matters is *did a new mint land on a key that already had a live entity*:

| | |
|---|---:|
| new live rows | 4,618 |
| landed on a pre-existing live key (same entity_type) | **22 (0.48%)** |
| duplicate keys created **within** the batch | 47 |

**19 of the 22 are gov `asset` entities and are NOT an LCC minting defect.** Each colliding pair
carries a **different** `gov/asset/<property_id>` (`gov/asset/1366` vs `gov/asset/2187` for
`2003 W Adams Ave, El Centro, CA`), so they are **two rows in gov `properties` for one building**.
The asset path mints one entity per domain property id by contract, so LCC is faithfully mirroring a
domain-level duplicate. The names differ only by address punctuation — `5020 W. North Ave` /
`5020 W North Ave`, `303 "H" St` / `303 H St`, `St. Albans` / `St Albans` — which the N15c key
strips, so **the key is what made them visible.** Filed as **N20**.

**The genuine residual is 3 of 4,618 (0.06%)**: `Sukhpreet Sidhu`, `Alexander Moore` (person, gov)
and `Wasa Properties` / `WASA Properties` (organization, dia). These key identically and a dual-read
lookup would have found them, so they came from a writer that computes the key but does **not** look
up by it — `api/sync.js` and `api/domains.js` both POST `entities` directly. N15c gave those writers
the right key; giving them a lookup is a separate small change, filed as **N21**.

### ⚠️ CORRECTION: enforcing UNIQUE is a BIGGER job than §7 said — 3,930 → 8,136 groups

§7 decision 2 quoted 3,930 violating groups. That was measured on the OLD keys. On the N15c key
`v_duplicate_candidates` reads **8,136 groups** (6,600 by a direct `GROUP BY canonical_name` over live
entities). The extra ~4,200 are not an over-collapse — they are **pre-existing duplicates the
disagreeing keys were hiding**, and they are the whole point of the fix. Read on named rows, every
sampled group is unambiguously one party:

| key | members |
|---|---|
| `office properties income` | `Office Properties Income` ×2 + `Office Properties Income Trust` ×6 |
| `aei capital` | `AEI Capital` ×2, `Aei Capital Corp` ×2, `AEI Capital Corporation` ×2 |
| `brown brick and mortar` | `BROWN BRICK & MORTAR LLC` ×2 + `Brown Brick and Mortar LLC` ×3 |
| `rainier companies` | `Rainier Companies` ×2 + `The Rainier Companies` ×3 |
| `realty income` | `Realty Income` ×2, `Realty Income Corp.`, `Realty Income Corporation` ×2 |
| `rmr group` | `RMR Group` + `The RMR Group` ×4 |
| `artis` | `Artis` + `Artis Reit` ×3 |

Note `Realty Income` specifically: N15b documented that `dup-pair-planner.ownerCore` reduces it to the
**empty string**, so it "fails to match ITSELF". The N15c key groups all five. And the `trust`/`reit`
strips are Scott's adopted rule doing exactly what it was adopted for.

**So decision 2 is now a larger and better-evidenced call than when it was posed** — more to merge,
but the candidates are real. It remains Scott's.

### ⚠️ Drift = 0 proves the BACKFILL, not the producer — the note below is now SUPERSEDED by the
### verification above, and is kept as the reasoning that made the check worth running

**Zero entities have been minted since 18:00 UTC**, so no real ingestion has exercised the trigger
and the dual-read together. That is the Class 8 distinction this round exists to respect: a one-shot
backfill and a fixed producer look identical until the producer runs. **The check that matters is
still ahead** — a NEW `backfillable` row appearing in `v_lcc_canonical_name_drift` after the next
sync or capture means a writer escaped the trigger.

⚠️ **Also unconfirmed: whether the Railway redeploy carrying `d8fcfbf` had landed before the 20:03
backfill.** This sandbox cannot reach the Railway host (`http=000`; `api.github.com` returns 200, so
it is the egress policy, not the app). If the JS was not yet live, the dual-read was not live either
and the next mint against a backfilled name would create a duplicate. Nothing has minted, so no harm
has occurred — but confirm `/version` carries `d8fcfbf` before ingestion resumes.
