# V8 — sponsor-family confirmations: the review sheet

**Prepared 2026-08-27 (Cowork) for Scott.** Source: `v_lcc_ownership_sponsor_family_proposals`
(A3, PR #1816). **Nothing is confirmed. Nothing moves until you decide.**

---

## The question you are answering, precisely

For each row: **is the recorded grantee an SPE of this sponsor — such that a chain terminating at
the SPE should count as terminating at the sponsor we hold as owner?**

You are **not** deciding who owns the building. Both facts are true and both survive: the SPE holds
title, the sponsor is who we prospect. You are deciding whether they are **the same ownership
family**.

**A YES costs:** if wrong, we assert a false ownership fact and a chain lands on the wrong party.
**A NO costs:** the chain stays in the mismatch lane and someone looks at it again later. **When
unsure, say no** — the asymmetry is real.

## ⚠️ Read before deciding

1. **Every proposal here rests on a SINGLE arm** (`arms_used = 1` on all 12) — either `lead_token`
   (sponsor's leading word) or `token_contained`. **None has corroboration from a second signal.**
2. **`token_entities_fleetwide` is the collision risk**, not a quality score. It counts how many
   live entities anywhere carry that token. High numbers mean the token alone is meaningless — the
   confirm is keyed `(sponsor entity, token)` precisely so it cannot leak, but it tells you how
   much of the judgement is doing the work.
3. **The guards already removed the easy false positives** — street-shaped names, brokerages, and
   (at a measured cost of 2 real misses) person-shaped names. What remains needs you.

---

## The 12, ranked by what they resolve

### 1. Boyd Watterson Asset Management, LLC — `boyd` · **20 chains · $179.8M** · fleet 129
```
Boyd Bethesda III GSA, LLC · Boyd Chantilly II GSA, LLC · BOYD PHOENIX GSA LLC
BOYD SACRAMENTO GSA, LLC · Boyd Watterson · Boyd Watterson Global · Boyd Watterson JV UBP
```
**This is the decision that matters — 20 of the 32 resolvable chains.** The four `BOYD <city> GSA`
entities are textbook GSA SPEs (named for city + agency).

⚠️ **But it also folds in three name-variants of the sponsor itself**, and one deserves a beat:
**`Boyd Watterson Global`** may be a *fund* while `Boyd Watterson Asset Management` is its
*manager* — legally different entities. **`Boyd Watterson JV UBP` is a joint venture**, which may
have an outside partner. Confirming `boyd` treats all seven as one family.
**If you want the SPEs but not the JV, say so — that is a narrower confirm and worth doing.**

### 2. FGF Management LLC — `fgf` · 2 chains · $6.2M · fleet 67
`GERMANTOWN MD I FGF, LLC · TYSONS CORNER VA III FGF, LLC`
Place + roman numeral + sponsor suffix. Textbook SPE naming. **Low risk.**

### 3. Sunflower Capital Partners — `sunflower` · 1 chain · $14.6M · fleet 6
`Cr Sunflower Lessee LLC`
⚠️ **"Lessee", not "Owner".** A lessee entity is not necessarily the title holder, and the `Cr`
prefix is unexplained. **Highest rent of the singles — worth checking before yes.**

### 4. Highwoods Properties — `highwoods` · 1 chain · $5.8M · fleet 9
`HIGHWOODS REALTY LIMITED PARTNERSHIP`
The classic REIT / operating-partnership pair. **Low risk.**

### 5 & 11. ⚠️ Madison Capital Group — `madison` · **listed TWICE** · fleet 67
- `Madison Capital Group or affiliated pr…` — 1 chain, $3.2M
- `Madison Capital Group LLC` — 1 chain, $1.2M
- **Both propose the same grantee: `MADISON-OFC WESTON POINTE FL LLC`**

**This is not two decisions — it is two LCC entities for one firm.** Confirming both attaches one
SPE to two "sponsors". **Do not confirm either yet.** This is an **A2a-style duplicate-entity
merge**; after the merge it becomes one clean decision. *(A3 anticipated exactly this — it is why
the registry key is (sponsor entity, token) rather than token alone.)*

### 6. RXR Realty — `rxr` · 1 chain · $2.3M · fleet 3
`RXR 32 OLD SLIP REIT LLC` — sponsor + address + REIT. **Low risk**, and `rxr` barely collides.

### 7. Commonwealth Commercial Partners — `commonwealth` · 1 chain · $2.1M · fleet 32
⚠️ `Commonwealth Owner LLC` — **generic.** "Commonwealth" is a common word and this name carries no
distinguishing element. **Needs a look at the property before yes.**

### 8. American Realty Capital (ARC) — `arc` · 1 chain · $1.9M · fleet 46
`ARC NYC123WILLIAM, LLC` — ARC's known convention (sponsor + city + street). Plausible, though
`arc` is a high-collision token. **Low-moderate risk.**

### 9. CARRINGTON, LLC — `carrington` · 1 chain · $1.8M · fleet 7
⚠️ `THE CARRINGTON COMPANY` ← `CARRINGTON, LLC`. These read like **two different firms**, not a
sponsor and its SPE. **Check before yes.**

### 10. Sequoia Holdings — `sequoia` · 1 chain · $1.3M · fleet 11
`B9 SEQUOIA THE MILE OWNER LLC` — "The Mile" is a known development; `B9` is unexplained (a JV
partner code?). **Moderate.**

### 12. East Lake Management & Development Corp — `east` · 1 chain · $0.8M · fleet 226
`EAST LAKE MGT & DEV CORP` — **literally the same name abbreviated.** Safe *despite* `east` being
the highest-collision token in the set (226), because the match is the whole name, not the token.
**Low risk** — and a good illustration that fleetwide collision ≠ this proposal's risk.

---

## Recommended disposition

| verdict | rows |
|---|---|
| **Confirm** | Boyd (⚠️ decide on the JV first), FGF, Highwoods, RXR, East Lake |
| **Check first** | Sunflower ("Lessee"), Commonwealth (generic), Carrington (reads as a different firm), Sequoia (`B9`) |
| **Hold — merge first** | **Both Madison rows** — duplicate entities, not two decisions |

Confirming just **Boyd + FGF + Highwoods + RXR + East Lake** resolves **24 of 32** chains.

## How to confirm

```sql
insert into lcc_ownership_sponsor_family (sponsor_entity_id, sponsor_token, confirmed_by, confirmed_at, notes)
select sponsor_entity_id, sponsor_token, 'scott.briggs', now(),
       'V8 review 2026-08-27: GSA SPEs named city+agency'
from v_lcc_ownership_sponsor_family_proposals
where sponsor_token = 'boyd';
```

Repeat per token you accept. **One row per (sponsor entity, token)** — never a bare token.

**Then verify the lane moved:**
```sql
select action, count(*) from v_lcc_ownership_history_lane_split group by 1 order by 2 desc;
```
Expect `mismatch` to fall and `sponsor_spe` to rise by the same amount. **`agrees`, `all_guarded`
and `no_records` must not move** — if they do, something touched a bucket it should not have.

**Reversal:** delete the row. A3's positive control confirmed `boyd`, saw mismatch 74→54 and
sponsor_spe 0→20, then rolled back with **0 residue** — so this is reversible, and that was proven
rather than asserted.
