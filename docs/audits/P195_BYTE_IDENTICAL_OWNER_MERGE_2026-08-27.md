# P195 — merging the 60 byte-identical owner groups (2026-08-27)

P189 made this population visible and merged nothing. This is the pass that landed it.

**Result: 66 entities merged into 56 survivors; $102,216,468 of current annual rent consolidated.
4 groups / 25 entities were HELD and not merged — the prompt's premise was wrong about them.**

| | before | after |
|---|---:|---:|
| byte-identical blind groups | 60 | **4** (all held) |
| member entities | 147 | 25 |
| entities merged | — | **66** |
| survivors carrying the rent | — | **56** |
| current annual rent on survivors | — | **$102,216,468** |
| `auto_mergeable` (untouched, as required) | 3,053 | **3,053** |
| live backrefs left on a P195 tombstone | — | **0** |

Largest consolidations: **NGP Capital 5→1, $59.8M→$68.3M, 29→38 assets**; AVG Partners 4→1 ($8.85M);
GI Partners 3→1 ($8.62M); JLB Capital 3→1 ($4.45M, 8→9 assets); WMC Properties 2→1 ($4.44M);
NGP Group 3→1 ($2.57M, 6→9 assets).

---

## 1. ⚠️ A BYTE-IDENTICAL NAME IS NOT AN IDENTITY CLAIM WHEN EVERY TOKEN IS GENERIC

The prompt called this "the highest-confidence merge set in the system." For 56 of the 60 groups
that is right. For 4 it is exactly backwards, and the reason is structural rather than incidental.

`v_lcc_merge_candidates_normalizer_blind`'s own filter is
`coalesce(lcc_normalize_entity_name(name),'') = ''` — it selects the names that reduce to **nothing**
under the generic-CRE stoplist. That population is two different things wearing one label:

| | residue after the stoplist | what it is |
|---|---|---|
| `NGP Capital` ×5 | `ngp` (3 chars, under the normalizer's 4-char floor) | an acronym-named **real firm** — the P189 blind spot |
| `Capital` ×3, `Properties` ×2, `Partners Group` ×18 | **empty** | a **failed extraction**, not a firm |

Merging the second kind asserts that unrelated parties are one company. Measured on named rows:
the three `Capital` entities span dia + gov and carry three *different* external identities
(`rca/contact`, `salesforce/Account` + `rca/company`, `dia/true_owner`) and 15 relationships between
them — three separate real-world parties whose captured name got truncated to one word. The 18
`Partners Group` rows are emptier still: 17 of 18 have no domain, no identity, no relationship, no
portfolio fact, no pivot, minted in two bursts on 2026-06-24 and 2026-06-26.

`lcc_p195_name_has_distinctive_residue` is the gate. It is deliberately **narrow and scoped to this
pass** (the `lcc_p131_is_document_row_label` precedent) and must never be reused as a general name
filter. **Held: 4 groups / 25 entities / $158,846.**

The held group with real value is `capitalgroupproperties`, and reading its two rows is what
confirms the gate rather than merely rationalising it: one is a gov `true_owner` holding one asset
at $158,846; the other carries a **`costar/company` external_id of `capital properties`** — a
different company string entirely. That is a genuine ambiguity, and the doctrine says surface it,
never guess.

**The general lesson: when a detector's own filter is "this name reduces to nothing", the set it
returns is skewed towards precisely the names where a name-identity claim is weakest. Grade the
residue before treating identity as proven.**

## 2. ⚠️ `lcc_merge_entity` DOES NOT SNAPSHOT — AND ITS PIVOT DEDUP IS UNCORRELATED

Two facts about the shared merge path that are not written down anywhere else:

- It calls `lcc_reconcile_tombstone_backrefs(loser, winner, p_snapshot => **false**)`. Every dedup
  DELETE it performs — portfolio facts, external identities, relationships, watchers — is
  **unrecoverable**. Any caller that wants reversibility must snapshot first; `lcc_apply_fuzzy_merges`
  does not, so the auto-merge loop is irreversible today.
- Its `owner_contact_pivot` dedup is
  `delete ... where l.entity_id = p_loser and exists (select 1 from owner_contact_pivot w where w.entity_id = v_winner)`.
  The `EXISTS` is **uncorrelated**: it asks only whether the winner has a pivot *at all*.

Put together, that is a live data-loss path, and this pass walked straight into it. On
`bamproperties` the winner by ownership (`1d0b30a9`, 1 asset, $517k) had a pivot with **no contact**
(`enrichment_action = 'manual_research'`); the loser (`b430f8e8`) carried the group's **only named
contact, Alex Bias** (`recorded_owner_manager`). A bare `lcc_merge_entity` would have deleted it —
no error, no ledger, in the exact lane this pass exists to clean.

`lcc_p195_fold_pivot` runs **before** the merge and fills blanks only: the loser's contact moves onto
a winner that names nobody; a winner that already names someone **keeps them** and the difference is
recorded, not resolved. `active_source` is carried across **verbatim** rather than restamped — that
column is read with `<>` and `IN` predicates by the Tier 0 lane, and inventing a new value there is
the P194 trap. Verified after the run: Bam Properties' pivot holds Alex Bias with a
`p195_merge_fold` entry in `pivot_history` naming the entity it came from.

Across the whole pass the fold reported: 61 `loser_has_no_pivot`, 2 `winner_has_no_pivot_row_repoints`,
1 `same_contact_bench_folded` (NGP Capital — both sides already named Fran Cowan),
1 `loser_contact_folded_into_blank_winner` (Bam Properties), 1 `loser_pivot_empty_nothing_to_fold`.

## 3. Risks that were measured and turned out to be nil — with the positive control

**P175a (a ghost `is_current` fact contradicting an ENDED survivor fact) does not apply here.**
Across all 60 groups there were **zero** `(source_domain, source_property_id)` collisions between
members, so no portfolio fact was dedup-deleted; every one repointed. An implausibly clean zero is a
bug signal (P182), so the detector was pointed at a known positive: the same query shape finds
**2,678** properties fleet-wide held by 2+ live entities. The zero is real.

Likewise zero conflicting `entities.email` values within any group.

`portfolio_edges_moved` reads **0 for the whole no-owner slice**, which looks like a broken counter
and is not: the snapshot ledger records **no** `lcc_entity_portfolio_facts` rows for any of those 40
losers. They had none to move.

## 4. The 3 multi-owner groups, done individually with the named rows read

`ngpcapital` alone was two-thirds of the pass. Before merging it, both owners' asset lists were read
in full: `21db64c7` holds 29 gov assets, all `relationship_graph`; `cd890ebf` holds 9, mostly
`supersession` plus one `domain_true_owner`. **The two sets are disjoint** — and adjacent
(gov 23725/23726/**23727**/23728 split across the pair), which is what a single portfolio recorded
twice looks like. Winner: `21db64c7` by the ownership-first rule. After: 38 assets, $68.3M.

**This is not prompt 193's problem.** Every merged member's name is byte-identical `NGP Capital`;
`NGP VI ESSEX VT LLC` and its siblings are distinct SPEs, were never in this population, and were
not touched.

## 5. Winner selection

Ranked, deterministic, ownership first: `owns_assets desc → current_rent desc → portfolio_facts desc
→ external_ids desc → relationships desc → created_at asc → entity_id`. Ownership rather than rent,
because the entity that actually owns assets is the one every downstream consumer already points at.
Verified against the three high-stakes groups by hand before running.

Note the rule deliberately does **not** rank the pivot-bearing member up. The fold preserves the
contact regardless of who wins, so letting a contact-only husk beat the real owner would trade a
correct survivor for a redundant one.

## 6. Reversibility, proven by a round trip — which caught a real bug

`lcc_p195_snapshot_loser` writes every loser-side row (plus the *winner's* pivot, which the fold
mutates) into the house ledger `r40_merge_reconcile_backup` tagged `note = 'p195:<batch_tag>'`, so
there is one backup store and one reversal path rather than a second bespoke table.
`lcc_p195_unmerge('<batch_tag>')` restores it.

The round-trip gate ran a real merge on `dandmholdings`, unmerged it, and compared: both members
live, `pf 1/0`, `xid 1/1`, `rels 1/1`, blind groups back to 60, `auto_mergeable` still 3,053 — zero
residue. It then failed the first time with **`428C9: cannot insert a non-DEFAULT value into column
"is_current"`**. `lcc_entity_portfolio_facts.is_current` is `GENERATED ALWAYS` — a footgun already
documented in `CLAUDE.md`, and the review still shipped a `select *` restore over it. Only the round
trip caught it. **A reversal path that has never been run is a claim, not a capability.**

Two honest limits, stated rather than papered over: a `touchpoint_cadence` row the reconcile
*consolidated* had its counters summed into the winner's and unmerge does not subtract them; and the
winner's pivot is restored from its pre-merge snapshot, so anything written to it since the merge is
overwritten. Reverse promptly or not at all.

## 7. Class 8 — what re-creates the row tomorrow

Immediately after the pass: **0 portfolio facts, 0 assets, 0 identities, 0 pivots, 0 relationships,
0 cadences, 0 opportunities left pointing at any of the 66 tombstones.** `lcc_audit_merge_path_coverage()`
attributes **0** of its remaining stranded rows to P195 (the 12 stranded portfolio facts, 8
relationships and 302 `lcc_decisions.subject_entity_id` rows are all pre-existing; cron 238 already
sweeps the last of those).

A one-shot repair of a recurring producer is a chore you repeat silently forever (P176), so the
re-sweep is scheduled rather than remembered: `v_lcc_p195_resurrection_watch` +
`lcc_p195_check_resurrection()` on **pg_cron 243, 06:52 UTC** — the only free minute in the
06:20–06:58 block, and after `generate-research-tasks` (06:35) so a group re-minted overnight is
caught the same morning. It opens a deduped
`lcc_health_alerts(alert_kind='p195_duplicate_owner_resurrection')` when a group P195 cleaned
re-accumulates members, and auto-resolves when it does not. First run: `open_groups 0, regrown 0`.

Read `regrown_groups`, never `open_groups` — a group that was never merged is not a resurrection.

## 8. Not done, deliberately

- **The 4 held groups.** They are not duplicate *owners*; `partnersgroup` is 17 empty husks plus one
  Salesforce account, which is a junk-entity cleanup, and `capital`/`properties` are truncated
  captures needing a name repair. Filed as backlog **N10**. Merging them would consolidate $158,846
  and fabricate three parties.
- **No competing SPE detector** for the place-named SPEs `lcc_is_spe_shell_name` misses (P189's
  stated gap), and nothing touching the `jameshowardcpa.com` shared-CPA grouping.
- **`lcc_merge_entity` was not changed** to pass `p_snapshot => true`. It is the single path used by
  the auto-merge loop and widening its write volume is a bigger blast radius than this pass implies.
  The gap is now documented; making the shared path reversible is backlog **N11**.

## Reversal

```sql
select * from public.lcc_p195_unmerge('p195_20260827_no_owner');
select * from public.lcc_p195_unmerge('p195_20260827_one_owner');
select * from public.lcc_p195_unmerge('p195_20260827_multi_ngpgroup');
select * from public.lcc_p195_unmerge('p195_20260827_multi_jlbcapital');
select * from public.lcc_p195_unmerge('p195_20260827_multi_ngpcapital');
```
