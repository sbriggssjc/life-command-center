# A2a — merging the duplicate entities that blocked the ownership chains

**2026-08-27 · LCC Opps (`xengecqvemvfknjvbvrq`) · migration `20260827210000`, applied live · batch `a2a-20260827-r1`**

## The only number that counts

```
research_tasks where research_type='establish_ownership_history'
  status='completed' :  288  →  314      (+26)
  status open        :  182  →  156
```

**26 tasks completed, 30 historical ownership facts written, 26 of the 30 landing on an
entity this pass created by merging.** No new applier was built: A2's cron-244 function
consumed the merges unchanged.

| | before | after |
|---|---:|---:|
| `establish_ownership_history` completed ever | 288 | **314** |
| open | 182 | 156 |
| `agrees` bucket open | 90 | **64** |
| `ambiguous_entity` blocked tasks | 48 | **18** |
| …blocked groups | 43 | 17 |
| `lcc_entity_portfolio_facts` | 13,028 | 13,058 (**+30**) |
| …of those reading `is_current` | — | **0** |
| live entities | 62,394 | 62,366 (**−28**) |
| tombstones | 2,411 | 2,439 |
| `v_lcc_portfolio_ownership_conflict` | 0 | **0** |
| `mismatch` / `all_guarded` | 74 / 18 | **74 / 18 (untouched)** |

**Merges performed is an input, not an outcome.** 28 losers merged into 26 winners; the
outcome is the 26 tasks and 30 facts above. Read `tasks_completed` and `facts_inserted` on
the A2 run, and `groups_merged` only as the cost side of the ledger.

## Re-measured first: the sizing in the brief was wrong three ways

The A2 writeup said *48 tasks / $210.6M*; the A2a brief said *~50 tasks / 54 links / 45
parties*. Measured 2026-08-27: **48 tasks, 52 links, 43 distinct grantor keys, 44 owners.**

The dollar figure is the one worth correcting, because value is **per OWNER** and this
population inflates on two independent axes — one owner carries several blocked tasks, and
one task carries several blocked links:

| aggregation | figure |
|---|---:|
| sum per blocked LINK | $83.2M |
| sum per blocked TASK | $76.7M |
| **sum per distinct OWNER** | **$72.0M** |

None of the three reproduces $210.6M, so that number is simply wrong rather than a
different-but-defensible cut. `v_lcc_a2a_ambiguity_merge_plan.blocked_owner_rent`
deduplicates by `task_entity_id` so the per-owner figure is the one the surface reports.

## The gates: what merged, what was held, and what each guard cost

**26 groups merged / 28 losers · 17 groups held / 18 tasks / $13.7M.** Every hold reason is
named on `v_lcc_a2a_ambiguity_hold_watch`; a count with no reason is what P196 fixed for the
Tier 0 parks.

| verdict | groups | tasks | owner rent |
|---|---:|---:|---:|
| `merge` | 26 | 30 (28 ambiguity-only) | — |
| `held:name_variant_beyond_case` | 10 | 11 | $9.9M |
| `held:person_typed_member` | 7 | 7 | $3.7M |

### `held:name_variant_beyond_case` — 10 groups

The gate is `count(distinct lower(name)) = 1`: P195's byte-identical standard, relaxed only
for case. Nine of the ten differ **only by punctuation inside the legal form** and are
probably the same party — `800 K Street Associates, LLC` / `800 K STREET ASSOCIATES, L.L.C.`,
`Ten Fifteen Jackson Keller Partners LP` / `TEN FIFTEEN JACKSON KELLER PARTNERS, L.P.`,
`Watumull Properties Corp` / `WATUMULL PROPERTIES CORP.` — but "probably" is not the standard
for a write that asserts who owned a building, and the additional evidence that would settle
them (a shared identity, a shared asset) **is absent on all ten**: every one is an empty husk
paired with a populated row.

The tenth is why the gate exists rather than being a formality: **`Mr Champa LLC` vs
`M.R. Champa, LLC`** — an honorific or two initials, and nothing on either row decides it.

### `held:person_typed_member` — 7 groups

No member may be typed `person`. Two humans sharing a name is ordinary, and a
person↔organization merge answers a question nobody asked. Four are genuinely person-shaped
(`Robert Clark`, `John Frew`, `Abdallah Taha`, `Steve Beckman`); three are firms carrying one
mistyped `person` row (`Matan Companies`, `Precor Ruffin`, `FD Stonewater`) and are the
cheapest of the held set to release once someone retypes that row.

> **⚠️ The obvious implementation of this gate would have held six real companies.**
> `lcc_looks_like_person` is the natural thing to reach for, and over these 43 names it
> returns TRUE for **`CANO FAMCO`, `Hokanson Companies`, `HORAK DEVELOPMENT IV, L.P.`,
> `Matan Companies`, `Precor Ruffin` and `USAA Real Estate`** — six organisations, including
> the $62M one. It is the documented two-capitalised-tokens false positive (A3 §guards,
> P196 §sponsor detector). The gate reads the **recorded `entity_type`** instead: that is a
> fact LCC holds about the row, not a guess about the string. `test/a2a-ambiguity-merge.test.mjs`
> goes red if the regex ever appears in this migration.

### Two guards that fired on nothing — reported, not dropped

`lcc_p195_name_has_distinctive_residue` passes **43 of 43**, and the placeholder/brokerage
guard rejects **0 of 43**. A gate that never rejects is indistinguishable from a broken one,
so both were pointed at a known positive before being believed: P195 measured the residue gate
holding 4 groups on its own population (`Capital`, `Properties`, `Partners Group`). It
discriminates; this population simply carries no pure-generic names. Both are retained so the
next batch is graded by the same rules.

### The comparators that were NOT used

`lcc_owner_strict_core` (A2 measured it collapsing `BAMMF (8) LLC` onto `BAMMF (3) LLC` on
this exact population) and `lcc_normalize_entity_name` (P189: NULL for acronym firms, strips
`group|partners|capital`). The grouping key stays `lcc_ownership_chain_name_key` — the same
comparator A2's applier and the drafter already use, so all three agree about what one name is.

## The winner rule, and the pivot that proves why it is not rent-first

P195's ordering, unchanged: `owns_assets → current_rent → portfolio_facts → external_ids →
relationships → created_at → id`. It deliberately does **not** promote the pivot-bearing
member, because `lcc_merge_fold_pivot` preserves the contact regardless of who wins — and the
batch exercised exactly that: `Hokanson Companies` merged 3→1 onto the member that owns 2
assets, while the group's only named contact (`Stephen Hokanson`) sat on a **loser** and was
carried across by the fold.

## No third merge driver

Every write goes through **`lcc_merge_entity`** and every reversal through
**`lcc_unmerge_entity`**. P195 needed an external snapshot driver only because the shared
function had none; P196 gave it one. What A2a adds on top is a **plan** (which pairs, which
winner, and why a group is held) and a **batch ledger** (`lcc_a2a_merge_log`) so a batch can be
reversed as a unit — not a second implementation of the merge itself. The guard test fails on
a hand-rolled `merged_into_entity_id` write, on a bespoke restore, and on any direct call to
`lcc_merge_snapshot_loser` / `lcc_merge_fold_pivot` / `lcc_reconcile_tombstone_backrefs`.

## Round trip proven on THIS population, before the batch

P195's reversal failed its first live attempt on `428C9 is_current is GENERATED ALWAYS`;
P196's failed on a BEFORE-INSERT trigger silently defeating `ON CONFLICT DO UPDATE`. Neither
was findable by reading the code, so the requirement is a real round trip on the real rows.

**`USAA Real Estate` (3 members, $62.0M)** was chosen because it is both the highest-stakes
group in the batch and the **only** one where the destructive path fires: winner and loser
both hold an `owner_contact_pivot`, so `lcc_merge_entity`'s dedup-DELETE runs.

```
merge   3 → 1 live · pivot_note same_contact_bench_folded / loser_has_no_pivot
        er_selfloop_deleted: 1 · xids_repointed: 2 · cadence_repointed: 1
        group leaves v_lcc_ownership_chain_apply_blocked · winner keeps
        "Joseph Capra / worklist_sweep" (active_source carried VERBATIM — P194)
unmerge losers_reversed 2, both `restored` (no residue)
diff    153 rows before / 153 after across entities, portfolio facts, identities,
        relationships, pivot, property-owner, evidence, cadence, opportunities
        → LOST 0 · NEW 0 · CONTENT_DIFFERS 0   (updated_at excluded)
        usaa live members 3 · ambiguity groups 43 · auto_mergeable 3,053 · conflicts 0
```

The deleted self-loop relationship and the folded pivot bench both came back byte-identical.

## ⚠️ The merge surfaced a second defect it did not cause — and 2 tasks moved rather than drained

I predicted 28 tasks would drain. **26 did.** The two that did not are the finding:

| task | property | grantor | dates |
|---|---|---|---|
| `02f36b86` | gov 14293 | `ROSSLYN CENTER ASSOCIATES L.P.` | 2015-10-01, 2016-03-01 |
| `96ddc7fb` | gov 3891 | `Gate Properties LP` / `GATE PROPERTIES LP` | 2014-07-01, 2015-05-01 |

Both moved from `ambiguous_entity` to **`repeat_transfer_unrepresentable`** (tasks 12 → 14,
links 28 → 32). A2 blocks when one `(grantor_entity, property)` pair carries links on more than
one date, and **while the two case-spellings were two entities, each pair carried exactly one
link** — the duplicate entity was *masking* a repeat transfer. Both are the P138
`gsa_lease_diff` lessor-field flicker: one conveyance recorded twice, with the lessor name
written in two different cases, which is precisely why it produced two entities in the first
place.

**A duplicate entity can conceal a second defect, and merging it is what makes the second one
visible.** The two tasks are no worse off — they were never going to complete — but they are
now blocked for the honest reason, and their alternate dates are on
`v_lcc_ownership_chain_apply_blocked.repeat_transfer_dates` for whoever widens the drafter's
`(from, to, date)` dedup key. `no_entity` (18 tasks) and `placeholder` (15) did not move.

## `auto_mergeable` 3,053 → 3,041, and why that is not a side effect

P195 held this constant; A2a moves it by 12, and the 12 are the point. Verified: **0**
auto-mergeable groups still contain any A2a winner or loser — the 12 groups left the candidate
set because A2a merged them away. They were real duplicate groups the detector had already
flagged; the other 14 merged groups were normalizer-blind or review-gated and were never in it.
**Nothing wires up `lcc_apply_fuzzy_merges`, and nothing here is scheduled.**

## Gates

- **Reversal proven on real data before the real run** (above): 153/153, 0 lost, 0 new, 0 changed.
- **`is_current` invariant:** 0 of the 30 written facts read current.
- **Ledger 1:1 with effect:** 30 `fact_inserted` + 26 `task_completed` against +30 table rows.
- **Completion rule holds:** of the 26 completed properties, **0 can be re-seeded** into
  `establish_ownership_history`; 23 moved to `trace_ownership_to_developer`, 3 left the
  worklist. A task completed without a fact would be re-minted tomorrow (A2 §seed predicate).
- **No partial applies:** 0 tasks carry ledger rows while still open.
- **No new ownership conflicts:** `v_lcc_portfolio_ownership_conflict` 0 before and after.
- **Scope untouched:** `mismatch` 74, `all_guarded` 18, `no_entity` 18, `placeholder` 15 — all
  unchanged. (`repeat_transfer` moved 12 → 14; see above — surfaced, not touched.)
- **`npm test`** with `test/a2a-ambiguity-merge.test.mjs` (13 tests), **mutation-verified red
  on fourteen separate breakages** and green on restore: a hand-rolled merge; a bespoke
  restore; `lcc_owner_strict_core` as the gate; `lcc_looks_like_person` as the person gate;
  rent-first winner ranking; promoting the pivot bearer; lumping the hold reasons into one
  label; dry-run defaulting to false; iterating the live view instead of the snapshot; dropping
  the execution-time liveness re-check; a non-unique open-ledger index; oldest-first reversal;
  scheduling a sweep; and re-deriving a gate in the driver instead of reading the verdict.

## Reversal

```sql
select * from public.lcc_a2_unapply_ownership_chains('a2-chain-a2a-20260827');  -- the facts
select * from public.lcc_a2a_unmerge('a2a-20260827-r1');                        -- the merges
```
Reverse in that order — the facts sit on the merge winners.

## ⚠️ I triggered the apply; I did not wait for cron 244

Cron 244 fires at 06:49 UTC and had already run before the merges landed, so the drain above
comes from calling **its own function** — `lcc_a2_apply_ownership_chains(false,
'a2-chain-a2a-20260827', null, 'a2a_manual_trigger')` — at 13:50 UTC, not from the cron. Stated
plainly because a number I produced by hand is not evidence that the loop closes unattended.
Tomorrow's 06:49 run is that evidence, and it should be a quiet no-op on this population:
`tasks_would_complete` is now **0**, with 64 `agrees` tasks left open and every one of them
blocked for a reason this pass did not address.

## What this does NOT claim

- **64 `agrees` tasks are still open.** 18 ambiguity (held above), 18 `no_entity`, 15
  `placeholder`, 14 `repeat_transfer`, minus the 1 task carrying two reasons.
- **A3 / A4 / A4b untouched.** `mismatch` 74 and `all_guarded` 18 are unchanged and still
  waiting on Scott's sponsor confirms.
- **Nothing is scheduled.** The duplicate producer recurs (below), so this will have work again
   — but an unattended merge sweep is exactly what P196 declined to enable while
  `auto_mergeable` stands at 3,041 ungraded. `v_lcc_a2a_ambiguity_merge_plan` is derived from
  the live lane, so a group that comes back reappears there; that is the watch, and re-running
  the dry run is the check.

---

# ⚠️ The producer question: `r9_chain_connect` is NOT the source, and the real one is bigger

The brief asked whether these duplicates trace to `r9_chain_connect` (cron 104), which mints a
prior-owner entity per chain name. **Measured, and refuted.**

- **`ensureEntityLink` cannot mint a case-variant of a name it can already see.**
  `normalizeCanonicalName` lowercases *and* strips punctuation, so it is strictly looser than
  `lcc_ownership_chain_name_key` on exactly the axis these duplicates differ on.
- **The creation order says the same.** Across the 43 ambiguity groups, of the 48
  later-created (i.e. duplicating) entities only **12 are r9**; **36 came from something
  else**. r9 is the FIRST entity in 18 of the 43 groups — more often the victim than the cause.

**The actual mechanism is that `entities.canonical_name` — the dedup key itself — is written
by more than one normalizer.** Byte-identical names carry disagreeing canonical values:

```
"671 Poplar LLC"             → "671 poplar llc"              vs "671 poplar"
"BALTARA ENTERPRISES, L.P."  → "baltara enterprises, l.p."   vs "baltara enterprises l p"
"LSREF4 Bison, LLC"          → "lsref4 bison, llc"           vs "lsref4 bison"
```

One writer stores `lower(name)` verbatim; another stores the legal-form-stripped form. A
producer looking up `canonical_name = <its own normalization>` misses the existing row and
mints. **24 of the 43 ambiguity groups share one canonical_name** — those duplicates were
minted by paths that never consulted it at all (the later rows carry `gov/true_owner`,
`salesforce/Account`, `salesforce/Contact`, `costar/company`, `rca/contact`, `dia/true_owner`).

**Fleetwide: 2,037 byte-identical live-name groups covering 4,156 entities carry disagreeing
`canonical_name` values** (against 2,622 groups where it agrees). That is the duplicate factory,
and it is not one producer — it is one column with several authors, which is the normaliser
drift `CLAUDE.md` warns about, sitting in the dedup key.

Separately and still true: r9 holds **5,207 live entities, 4,943 of them with no portfolio fact
and no owned asset**, and **2,017 duplicate an older live entity** under the chain-name key. It
is a large unattached population worth retiring on the gov feeder's own predicate — but it is
downstream of the canonical_name defect, not the cause of it.

**Not fixed here, as instructed — filed as backlog `N15` (canonical_name single-writer) and
`N16` (retire r9's unattached output).** Fixing N15 needs a decision about which normalization
`canonical_name` should carry, and rewriting 4,156 rows changes what
`v_lcc_merge_candidates` groups — a graded change, not a repair.
