> **📍 CANONICAL REFERENCE: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md)** — live state, the objects, the decisions already made, and the traps paid for. **This file is the EVIDENCE for one round; read the canonical page first to find out whether you need this one.**

# P198 — the "two generic-stem cards" were the residue of the arm holding up half the lane

> **Outcome:** the recommended tightening of `ev_company_matches_owner` was **measured and
> refuted, and NOT shipped.** One read-only view was added
> (`v_lcc_tier0_coproposed_owner_duplicates`, migration `20260827230000`) surfacing **3
> owner-merge decisions**, two of them on the highest-rent owner in the system.
> Lane unchanged by the view: **ask 87 / auto 9 / parked 137 / pairs 696**.
> **Scott approved all three merges and they are DONE (§5) — lane now ask 84 / auto 9 / parked 137.**

---

## 1. The recommendation that was wrong

STATUS 2026-08-27 recommended tightening `ev_company_matches_owner` because two `ask` cards
rest on a generic eight-character word stem — `innovati` (*Innovation 2100 LLC* ←
"Innovative Renal Care", a dialysis **operator**) and `corporat` (*Corporate Plaza LP* ←
"Corporate Realty Inc"). The framing was *a leaky arm producing two bad cards.*

The comparator has two arms (both cores ≥ 6):

```
containment   position(company_core in owner_core) > 0  OR  the reverse
prefix8       both cores ≥ 8  AND  left(company_core,8) = left(owner_core,8)
```

Split the 87 `ask` cards by which arm carries their link evidence:

| the card's only link evidence | cards | rent |
|---|---:|---:|
| containment — survives any tightening | 24 | $30.9M |
| **prefix8 ONLY** | **28** | **$146.9M** |
| no link evidence at all (un-parked by domain strength or the curated sponsor map) | 35 | $84.7M |

**28 of 87 cards and $146.9M rest on the arm proposed for removal — including Easterly at
$85.0M, the highest-rent card in the lane.** Cross-cut by `match_strength` it is structural,
not incidental:

| match_strength | containment | **prefix8 only** | no link evidence | total |
|---|---:|---:|---:|---:|
| `weak_partial` | 7 | **25** | **0** | 32 ($156.6M) |
| `curated_sponsor` | 0 | 0 | 24 | 24 |
| `domain_is_core_prefix` | 9 | 2 | 5 | 16 |
| `exact` | 7 | 1 | 3 | 11 |
| `core_is_domain_prefix` | 1 | 0 | 3 | 4 |

The zero in that table is the finding. P194's un-park rule is `n_link_evidence > 0`, so a
`weak_partial` card reaches the operator **only because** link evidence exists — and for 25 of
32 of them, the prefix8 arm *is* that evidence. **The arm is not a leak in the lane; it is the
door into it.** Tightening it would have parked ~$147M of reach to remove five wrong cards
worth ~$5.6M.

**This is P179 Class 2 read backwards.** That rule says *measure the throughput of whatever a
promotion would displace.* The mirror is the one that bit here: **before demoting a rule,
measure what currently depends on it.** A rule's false positives are visible on the surface;
what it holds up is not.

## 2. Reading all 44 prefix8 rows — it is right far more often than it is wrong

Sorted by rent, the top of the list is entirely correct: Easterly ← Easterly Partners
(Andrew Pulliam), Cambridge Properties ← Cambridge Holdings, Carnegie Mgmt & Dev ← Carnegie
Companies, Franklin Street Properties ← Franklin Street Real Estate Services, Woodbranch
Management ← Woodbranch Lafayette VA, Westfield Realty ← Westfield Company. The Briarcliff SPE
family (3 owners × 3 people) and the Landmark, Omni, Majestic and True North rows are all real.

Clear false positives — **5 of 30 cards, ~$5.6M**:

| owner | employer | shared 8 | why wrong |
|---|---|---|---|
| Michael Downing Realty | Michael Development Ltd | `michaeld` | a shared **given name** |
| Westlake Village Natomas LP | Westlake Farms Inc | `westlake` | a **place** name; a farming company |
| Corporate Plaza LP | Corporate Realty Inc | `corporat` | a **generic business word** |
| Innovation 2100 LLC | Innovative Renal Care | `innovati` | generic; and an operator, not an owner |
| Maple Tree Place Owner LLC | Mapletree Investments | `mapletre` | place word (P196 already named it) |

Borderline and left alone: Imperial, Bellevue, Landmark, Jefferson, Envision — place or common
words where the match may still be right.

**Every one is a one-second reject**, because P188 put the employer string and the `match_key`
on the card. The failures cluster on the same three shapes P196 already guards for — place,
person, generic — but at ~83% card precision, and with the arm carrying $146.9M, the trade
does not favour a comparator change. **Recorded as a stated residue, not patched.**

## 3. What was built instead — and the signal that was rejected on the way

Easterly is the #1 and #3 card by rent and it is **one firm rendered as two owner entities**
(`Easterly Government Properties` / `Easterly Gov Properties (REIT)`), each × 2 domains, all
proposing the **same** person. That is N3a, the wording half of P189's blind spot, sitting at
the top of the surface Scott works.

P189 measured and rejected grouping on the shared email domain (**25%** — a domain is shared
because an SPE family shares its sponsor's). A narrower signal was tested: **the lane proposing
the same person, on the same domain, for two different owners.**

| signal | pairs | verdict |
|---|---:|---|
| co-proposal alone | 95 | **7% useful** — 88 pairs are unrelated names |
| …of which name cores are unrelated | 88 | sibling SPEs — never merge |
| …of which cores share an 8-char opening | **7** | the view |

**Co-proposal alone is worse than the signal P189 already rejected.** It is a candidate
generator, not a merge rule, and its residue is again dominated by sponsor families.

The 7, read on named rows: **Easterly ✅ same firm · Gardner-Tannenbaum / Gardner Tanenbaum
Holdings ✅ same firm (a spelling variant) · Cambridge Holdings / Cambridge Properties ⚠️
probable · three Briarcliff SPE pairs ❌ · UIRC Douglas AZ / Van Horn TX ❌** (different
properties in different states — merging those would be the fabrication P195's gate exists to
prevent).

`v_lcc_tier0_coproposed_owner_duplicates` ships those 7 with a `verdict_hint`, **read-only,
and deliberately carrying no `auto_mergeable` column** — `lcc_apply_fuzzy_merges` loops on that
flag, and admitting an ungraded key there would auto-merge sibling SPEs into each other. Merge
through `lcc_merge_entity`, reversible since P196.

### ⚠️ Two instrument failures in one session, both caught by implausibility

- **`min(a.owner_name)` collapsed both sides of the pair to the same string**, so the first run
  reported **95 pairs / 95 identical cores / 0 / 0**. A detector returning *everything* in one
  bucket and *nothing* in every other is a bug signal, not a finding (P182). Keyed properly it
  is 0 / 7 / 88 — the exact opposite conclusion.
- **`lcc_name_has_spe_marker` is named backwards.** It detects a **portfolio/sponsor** marker
  (Properties, Holdings) and returns **FALSE for every name literally containing the string
  "SPE"** — all three Briarcliff rows, both UIRC rows. It separates this population correctly
  *because* of that inversion (both true duplicates are portfolio-marked on both sides; all four
  SPE-sibling pairs are not), which is a tiebreak worth surfacing on 7 rows and far too thin to
  promote to a rule. **Read the function, never the function's name.**

## 5. EXECUTED 2026-08-27 16:28 UTC — Scott approved all three; all three merged

| pair | winner | loser | snapshot rows | pivot |
|---|---|---|---|---|
| Easterly | Easterly Gov Properties (REIT) | Easterly Government Properties | 67 | `same_contact_bench_folded` |
| Cambridge | Cambridge Holdings | Cambridge Properties Inc | 27 | `same_contact_no_change` |
| Gardner | Gardner Tanenbaum Holdings | Gardner-Tannenbaum | 14 | `loser_has_no_pivot` |

Winners by P195's **ownership-first** rule, not rent: Easterly REIT owns **79 assets vs 10**;
Gardner Holdings **13 vs 4**; Cambridge tied at 1 asset each so it fell through to rent
($9.32M vs $3.88M).

| | before | after |
|---|---:|---:|
| live entities | 62,366 | 62,363 (−3) |
| lane `ask` | 87 | **84** |
| lane `auto` | 9 | 9 |
| parked | 137 | 137 |
| candidate pairs | 696 | 684 |
| Easterly: assets / current rent | 89 / $114,864,150 across **two** entities | **89 / $114,864,150 on ONE** |
| `lcc_entity_merge_log` | 32 | 35 |
| rows left in the co-proposal view | 7 | **4** (the sibling-SPE pairs, correctly) |

**Six cards became three**, one per firm — Easterly is now a single card at $114.9M with 7 eligible
people. **All three are `reversible = true`** in `v_lcc_entity_merge_reversibility` (P196),
snapshotted, undoable with `lcc_unmerge_entity(loser)`.

**Both duplicate pairs already carried the SAME confirmed contact on both sides** (Alison Bernard
on both Easterly entities, Constance MacOn on both Cambridge entities) — Scott had confirmed the
same person twice, once per duplicate. Nothing was lost to the pivot fold, and the double-confirm
is itself independent evidence the duplicates were real.

### ⚠️ `auto_mergeable` moved 3,041 → 3,043, and chasing it found the next defect

P195 held that counter at 3,053 → 3,053 and A2a moved it 3,053 → 3,041 with a verified reason, so
a move is always checked. Cause here is benign: each of the three winners now **heads a
byte-identical duplicate group that was already `auto_mergeable`**, and giving the survivor more
assets flipped two groups' winner selection. But it surfaced that **the same three firms carry 9
MORE duplicate entities**:

| firm | further duplicates | what they carry |
|---|---:|---|
| Easterly Gov Properties (REIT) | 3 (all byte-identical names) | 15 relationships |
| Gardner Tanenbaum Holdings | 4 | **5 assets and 244 relationships — one entity alone holds 240** |
| Cambridge Holdings | 2 | 2 relationships |

All nine carry **$0 current rent**, so they are invisible to every rent-ranked surface. The Gardner
row matters most: **that firm's deal history is split across two live entities**, which is exactly
the P177 failure — a survivor under-reporting the transaction history prospecting ranks on.

**Not merged — Scott approved three named pairs, and an approval is not extended by inference.**
Sized and surfaced as backlog **N3h**. ⚠️ Gardner's `min_loser_sim` is **0.667** (not
byte-identical) so it needs reading; Easterly and Cambridge are 1.000.

## 4. Verify by

The three decisions, not the view existing:

```sql
select owner_a_name, owner_b_name, domain, shared_people, combined_rent, verdict_hint
from v_lcc_tier0_coproposed_owner_duplicates order by combined_rent desc;
```

Confirming Easterly should take the lane from **87 → 85 ask cards** and collapse four cards on
one firm into two. Nothing else in the lane may move: **ask 87 / auto 9 / parked 137 / pairs
696** were identical before and after this migration, by construction — nothing reads the new
view.
