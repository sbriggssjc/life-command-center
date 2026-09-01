> ⛔⛔ **SUPERSEDED 2026-09-01 — DECIDED AND BUILT. Do not act on this brief's options.**
> Its §3 offers Scott three choices (A classify-and-flood, B classify-with-a-P0.4-gate, C retire
> `user_owner`). **He chose none of them, because the framing did not survive his own definitions:**
> the role is **MULTI-LABEL**, `user_owner` means **owner-occupier** (~13, human-confirmed), and the
> feared P0.4 flood **never materialised — P0.4 is 555 → 555**, because C6 had already removed the
> role from the deal-timing bands and C13b repoints no consumer.
>
> ⚠️ **Three of this brief's numbers are also refuted:** its "3,217 unknown holders" framing led to
> `user_owner` being sized at thousands (it is **13**); `repeat_buyer` at **2,478** counted purchase
> **EDGES** and is **401** (`entity_relationships` has no unique key on `(from,to,type)`); and the
> `investor_owner`+`repeat_buyer` overlap is **167, not 772**.
>
> ✅ **Read instead: [`docs/architecture/owner-role-classification.md`](../architecture/owner-role-classification.md) §7**
> (the shipped state) and §2c (why the shape is a set). **Kept for the sizing method and the
> consumer-blast-radius table in §2, which remain the useful part.**

> 📍 **CANONICAL PAGE: [`docs/architecture/bd-ranking-and-priority-queue.md`](../architecture/bd-ranking-and-priority-queue.md) §7.**
> **Diagnosis only — nothing written, and nothing recommended for build.**
> 👤 **This is a DECISION BRIEF for Scott.** C4a has been open as an abstraction since 2026-08-28;
> this puts numbers on it so it can be decided.

# C12 — C4a sized: the classifier is easy, its consumer is the problem

**Measured live 2026-08-31 on LCC Opps.**

> ## The one-line finding
>
> **The signal is clean and obvious: 3,217 `unknown` organizations hold a current portfolio asset**
> — that is a *recorded fact*, not a name guess, and reading the top 16 by rent returns Easterly,
> NGP Capital, USAA, US Fed Properties Trust, Government Properties Income Trust, Elman, Piedmont
> REIT — **zero brokerages, zero placeholders.** It would also give **`user_owner` its first
> producer ever** (C4b).
>
> ⚠️ **And shipping it as-is would take P0.4 from 555 rows to ~3,500.** **2,949 of the 3,217 would
> enter `resolve_ownership_control`** — a 6× flood of the band that already makes the queue 57%
> data-completion work. **The classification is right; its consumer is not ready for it.**

---

## 1. The candidate signals, measured

Population: **38,837 `unknown` organizations** (the other ~24k unknowns are persons and assets).

| signal | entities | notes |
|---|---:|---|
| **holds ≥1 current portfolio asset** | **3,217** | a recorded fact — this is what "owner" means |
| …holds ≥2 | 292 | |
| …holds ≥5 | 30 | |
| **has ≥1 `purchases` edge** | 2,883 | |
| …**≥2 — a repeat buyer** | **2,478** | Scott's own investor-vs-one-off distinction, already modelled |
| **holds an asset but never bought** | **2,691** | legacy / one-off owners |
| holds an asset **and is contactable** | 373 | |

### Read on named rows — the top 16 holders by portfolio rent, all currently `unknown`

Easterly Gov Properties **85 assets / $114.9M** · NGP Capital 31 / $68.3M · USAA Real Estate 8 /
$62.0M · US Fed Properties Trust 35 / $53.7M · **Government Properties Income Trust 36 / $39.7M** ·
Brandywine 1 / $34.9M · Elman Investors 30 / $29.0M · Trammell Crow 1 / $24.1M · USGBF NSF LLC ·
**George Washington University 2 / $23.8M** · GIC Real Estate · Nuveen/Hana · The Claremont Group ·
Cambridge Holdings · Allan Bailey Johnson Group · **Piedmont REIT**.

**Every one is a genuine owner.** Guards over the whole 3,217: **brokerage 6 · placeholder 3 ·
not-prospected 124**. ⚠️ **George Washington University is in the not-prospected 124** — Scott's
"drop all universities" decision (P190/C2) already covers it, and any rule must apply that guard.

## 2. ⚠️ The blast radius — this is the decision

`owner_role` has **two consumers with opposite needs**:

| consumer | after C6/C8 | effect of classifying 3,217 as `user_owner` |
|---|---|---|
| the **deal-timing bands** (P1/P2/P3/P8) | **no longer read the role at all** — C6 replaced the gate with *holds a current asset + reachable* | **none** |
| **P0.4 `resolve_ownership_control`** | admits `developer`/`user_owner`, no open opp, not a buyer SPE, **not connected** | **+2,949 rows — 555 → ~3,500** |
| **P0.5 `open_bd_opportunity_needed`** | same, but connected | +203 |
| the **prospecting brief** | admits on role **OR** resolved-owner (C8) | **little or none** — most already qualify via the resolved-owner arm |

**The band that would absorb almost all of it is the one whose growth already makes the queue 57%
data-completion work.** P0.4 has **no value gate** — that is why 2,949 flows straight in.

⚠️ **Note the irony worth stating plainly: P0.4's job is *"resolve ownership control"*, and these
3,217 are exactly owners whose control we have not resolved. Admitting them is arguably correct.
It is also 6× a band nobody is working.** Correct and unusable are not mutually exclusive.

## 3. 👤 The decision — three options, each with its measured consequence

**A — Classify and let P0.4 absorb it.** Honest, and the queue becomes ~80% data-completion work.
**Not recommended** without B.

**B — Classify, and give P0.4 a value gate at the same time.** The Consumption-Layer doctrine
already requires every producer to have one; P0.4 does not. ⚠️ **Which floor is its own question —
there are five distinct $500k floors in this system (§4g) and any new one must be NAMED, not
assumed.** At ≥2 current assets the candidate set is **292**, at ≥5 it is **30**.

**C — Classify nothing; retire `user_owner` instead.** Defensible now that C6/C8 removed the role
from the surfaces that matter. ⚠️ But it discards a clean, recorded signal about 3,217 real owners,
and leaves 93.9% of entities in a bucket that means nothing.

**My reading, offered not asserted: B.** The signal is too clean to throw away and too large to
ship unguarded. **But the floor is a business judgement about how you want to work owners, not a
technical one** — which is why this is a brief and not a prompt.

## 4. What this settles about C4b

**`user_owner` is not a mistake to be removed — it is a role with an obvious producer nobody
built.** *Holds a current asset* is precisely what the token means. C4b's disposition should follow
whatever is decided here: **option B or C makes it live; option C retires it.** It should not be
decided separately.

## 5. What was NOT measured

- **Whether the 2,478 repeat buyers should become `buyer`.** Most are probably already typed
  `buyer`; the overlap was not computed.
- **dia.** The named rows are gov-dominant.
- **What a P0.4 value gate would do to the band's existing 555 rows** — a floor applied to
  newcomers only, versus to the whole band, are different changes with different consequences.
  **Unmeasured, and it matters for option B.**
- **Any effect on the 434 edge-split groups (C9b)** — classification does not touch them.
