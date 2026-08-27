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
**If you want the SPEs but not the JV, say so — that is a narrower confirm and worth doing.** All of these are approved. I think we connect JV LLC or SPEs like we do recorded owner to LLC/SPE to true owner in the LCC app/database but link to multiple true owners for each true owner in the JV. Partnerships are going to be a good example of this down the road. We will have investors that own assets outright, in JV and maybe in a fund like a DST or something similar. Build this for a group like Boyd but all the SPEs above are in the control of Boyd. 

### 2. FGF Management LLC — `fgf` · 2 chains · $6.2M · fleet 67
`GERMANTOWN MD I FGF, LLC · TYSONS CORNER VA III FGF, LLC`
Place + roman numeral + sponsor suffix. Textbook SPE naming. **Low risk.** Both of these are also Boyd Watterson subsidiaries. 

### 3. Sunflower Capital Partners — `sunflower` · 1 chain · $14.6M · fleet 6
`Cr Sunflower Lessee LLC`
⚠️ **"Lessee", not "Owner".** A lessee entity is not necessarily the title holder, and the `Cr`
prefix is unexplained. **Highest rent of the singles — worth checking before yes.** Lessee in the Landlord/Tenant traditional context like this will suggest the ownership of the real estate has been split into a ground lease (ownership of the dirt) and leasehold interest (ownership of the improvements on leased land). This title of the SPE indicates an ownership of the leasehold and the SPE would be the contractual counterparty to the Tenant in the LL/T relationship. 

### 4. Highwoods Properties — `highwoods` · 1 chain · $5.8M · fleet 9
`HIGHWOODS REALTY LIMITED PARTNERSHIP`
The classic REIT / operating-partnership pair. **Low risk.** Approved. 

### 5 & 11. ⚠️ Madison Capital Group — `madison` · **listed TWICE** · fleet 67
- `Madison Capital Group or affiliated pr…` — 1 chain, $3.2M
- `Madison Capital Group LLC` — 1 chain, $1.2M
- **Both propose the same grantee: `MADISON-OFC WESTON POINTE FL LLC`**

**This is not two decisions — it is two LCC entities for one firm.** Confirming both attaches one
SPE to two "sponsors". **Do not confirm either yet.** This is an **A2a-style duplicate-entity
merge**; after the merge it becomes one clean decision. *(A3 anticipated exactly this — it is why
the registry key is (sponsor entity, token) rather than token alone.)* I'd say were merge this into one true company in the LCC. 

### 6. RXR Realty — `rxr` · 1 chain · $2.3M · fleet 3
`RXR 32 OLD SLIP REIT LLC` — sponsor + address + REIT. **Low risk**, and `rxr` barely collides. Approve this. 

### 7. Commonwealth Commercial Partners — `commonwealth` · 1 chain · $2.1M · fleet 32
⚠️ `Commonwealth Owner LLC` — **generic.** "Commonwealth" is a common word and this name carries no
distinguishing element. **Needs a look at the property before yes.** So long as there is more evidence than just the name that connects these entities, I approve. 

### 8. American Realty Capital (ARC) — `arc` · 1 chain · $1.9M · fleet 46
`ARC NYC123WILLIAM, LLC` — ARC's known convention (sponsor + city + street). Plausible, though
`arc` is a high-collision token. **Low-moderate risk.** Approve this. 

### 9. CARRINGTON, LLC — `carrington` · 1 chain · $1.8M · fleet 7
⚠️ `THE CARRINGTON COMPANY` ← `CARRINGTON, LLC`. These read like **two different firms**, not a
sponsor and its SPE. **Check before yes.** So long as there is more evidence that connects these two other than just the name, this is approved. (address, principals, other SPEs named similarly, SF data or prior ownership research data in our old spreadsheets, etc.)

### 10. Sequoia Holdings — `sequoia` · 1 chain · $1.3M · fleet 11
`B9 SEQUOIA THE MILE OWNER LLC` — "The Mile" is a known development; `B9` is unexplained (a JV
partner code?). **Moderate.** So long as there is data other than just the name, this is approved. 

### 12. East Lake Management & Development Corp — `east` · 1 chain · $0.8M · fleet 226
`EAST LAKE MGT & DEV CORP` — **literally the same name abbreviated.** Safe *despite* `east` being
the highest-collision token in the set (226), because the match is the whole name, not the token.
**Low risk** — and a good illustration that fleetwide collision ≠ this proposal's risk. This is approved. 

---

---

# ✅ Scott's answers + the evidence check (Cowork, 2026-08-27)

Scott approved most rows, three of them **conditionally**: *"so long as there is more evidence than
just the name."* **That condition was tested. It fails on two, is weak on one, and one row is worse
than it looked.**

**What "evidence" exists at all:** for Commonwealth, Carrington, Sequoia and FGF the sponsor
entities carry **no email, no phone, no metadata company, zero (or one) relationships**, and their
only `external_identities` row is the **`gov` source record itself** — which is the thing being
matched, not independent corroboration. gov `true_owners` adds nothing: **no `contact_info`, no
`sf_account_id`, no `state`** on any of them.

So the only evidence available is **naming-program structure** — whether the SPE belongs to a
systematic, multi-property convention. That is still name-derived, and it is weaker than address or
principals, but it is not nothing. Counts in gov `true_owners`:

| token | SPEs sharing the convention | reading |
|---|---:|---|
| `boyd` | **140** | a large, systematic program |
| `fgf` | **90** | `<CITY> <ST> <ROMAN> FGF, LLC` — a program ⚠️ see below |
| `B9 SEQUOIA` | **5** | `B9 SEQUOIA <asset> OWNER` — consistent; `B9` is a stable program prefix, not a stray JV code |
| `carrington` | 6 | 3 are name variants of one firm (`Carrington Companies`, `Carrington Company, The`, `CARRINGTON, LLC`) |
| `commonwealth` | 15 | ⚠️ **mostly unrelated parties** |

## ⛔ Commonwealth — the condition FAILS. Recommend NOT confirming.

The 15 "Commonwealth" entities are demonstrably **different parties**, including government bodies:
`Commonwealth Of Virginia Department` · `Commonwealth Ports Authority` ·
`Commonwealth Partners, L.l.c.` · `Commonwealth Development` ·
`Commonwealth Centre Investors II, LLC` · `Commonwealth Acquisition Groups` · `5309 Commonwealth LLC`.

`Commonwealth Owner LLC` carries **no distinguishing element** and could belong to any of them.
There is no address, principal, SF record or shared identity linking it to Commonwealth Commercial
Partners. **This is exactly the case the "more than the name" test was designed to catch.**

## ⚠️ FGF — HOLD. Scott's own note makes this the riskiest row in the set.

Scott: *"Both of these are also Boyd Watterson subsidiaries."* If that is right, confirming
`fgf → FGF Management LLC` **attributes Boyd's assets to the wrong sponsor** — and this is not a
2-chain decision: the sponsor map is **forward-looking**, and there are **90 FGF SPEs** in gov.

**Settle the Boyd↔FGF relationship first.** If FGF is a Boyd program, the confirm should point at
**Boyd**, not FGF Management. No LCC relationship currently records either way.

## ⚠️ Carrington — weak. Name-family only.

Three Carrington variants suggest one firm, but every signal is still the name. Scott's condition
is arguably unmet. **Low value ($1.8M, 1 chain) — recommend deferring rather than spending judgement.**

## 🟡 Sequoia — pattern evidence only, and it is real but name-derived.

`B9 SEQUOIA` is a consistent 5-member program, so `B9` is a program prefix rather than noise. That
answers the specific worry raised, without producing independent evidence. **Scott's call —
recommend yes if naming-program consistency counts as "more than the name" to him; it is the
honest boundary of what we hold.**

## Domain knowledge Scott added, worth keeping

- **"Lessee" is not a weaker claim** — it signals a **ground lease / leasehold split**: fee (dirt)
  and leasehold (improvements) are separate estates, and the leasehold SPE is the landlord
  counterparty to the tenant. `Cr Sunflower Lessee LLC` is therefore a genuine ownership interest.
  **Sunflower approved.** *(This belongs in the domain model, not just this review — a leasehold
  owner is a real owner.)*
- **Madison → merge into one LCC company** (Scott). Confirmed as an A2a-style duplicate.

## Revised disposition

| verdict | rows |
|---|---|
| **Confirm now** | **Boyd** (all 7, incl. JV — Scott approved explicitly), **Highwoods**, **RXR**, **ARC**, **East Lake**, **Sunflower** |
| **Hold — wrong sponsor risk** | **FGF** (90 SPEs; settle Boyd↔FGF first) |
| **Hold — merge first** | **Madison ×2** |
| **Recommend NO** | **Commonwealth** (15 unrelated parties incl. government bodies) |
| **Scott's call** | **Sequoia** (program evidence only) · **Carrington** (name-family only, $1.8M) |

**Confirming the six clean rows resolves 24 of 32 chains** — the same coverage as the original
recommendation, without the two risky attributions.

## Recommended disposition *(original, superseded by the block above)*

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

### The six clean confirms, ready to run

```sql
-- Boyd (20 chains, $179.8M) · Highwoods · RXR · ARC · East Lake · Sunflower
-- Deliberately EXCLUDES: fgf (Boyd-subsidiary question), madison (duplicate entities),
--                        commonwealth (15 unrelated parties), carrington + sequoia (Scott's call)
insert into lcc_ownership_sponsor_family
  (sponsor_entity_id, sponsor_token, confirmed_by, confirmed_at, notes)
select p.sponsor_entity_id, p.sponsor_token, 'scott.briggs', now(),
       'V8 review 2026-08-27; evidence check in docs/audits/V8_SPONSOR_FAMILY_REVIEW_2026-08-27.md'
from v_lcc_ownership_sponsor_family_proposals p
where p.sponsor_token in ('boyd','highwoods','rxr','arc','east','sunflower')
on conflict do nothing;

-- verify: mismatch should FALL and sponsor_spe RISE by the same amount;
-- agrees / all_guarded / no_records must NOT move.
select action, count(*) from v_lcc_ownership_history_lane_split group by 1 order by 2 desc;
```

**Reversal:** `delete from lcc_ownership_sponsor_family where confirmed_at::date = current_date;`

**Then verify the lane moved:**
```sql
select action, count(*) from v_lcc_ownership_history_lane_split group by 1 order by 2 desc;
```
Expect `mismatch` to fall and `sponsor_spe` to rise by the same amount. **`agrees`, `all_guarded`
and `no_records` must not move** — if they do, something touched a bucket it should not have.

**Reversal:** delete the row. A3's positive control confirmed `boyd`, saw mismatch 74→54 and
sponsor_spe 0→20, then rolled back with **0 residue** — so this is reversible, and that was proven
rather than asserted.
