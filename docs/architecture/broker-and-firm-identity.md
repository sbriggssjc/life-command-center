# Broker & firm identity — how names are stored, and what is NOT a defect

> **START HERE before flagging a broker name, a `;` in a name field, or a null
> `listing_broker_id` as bad data.** Several things here look wrong and are **understood**. The
> genuine gaps are named in §4.
>
> **The rule: `broker_name` is NOT a name field. It is a composite string** holding — variously —
> one person, one firm, a firm and an agent, or a whole listing team.

**Measured 2026-09-01 · DB `zqzrriwuavgrquhisnoa`.**

---

## 1. The model that already exists

| object | rows | populated |
|---|---:|---|
| `brokers` | **2,425** | `broker_name` 2,425 · `company` **872 (36%)** · `normalized_name` 2,383 · `contact_id` 1,916 (79%) |
| `broker_companies` | **131** | the firm table |
| `brokers.broker_company_id` | — | **184 (7.6%)** — the firm FK is barely used |
| `sales_transactions` | 4,783 | `listing_broker` name **2,111** · `listing_broker_id` **181** |

**The FK targets are real:** `sales_transactions.listing_broker_id` and `procuring_broker_id` both
FK to `brokers.broker_id`.

⚠️ **CORRECTION 2026-09-02 — this page originally said "the model is right, it is unpopulated." That
was wrong and complacent. It is right in SHAPE and MIS-POPULATED in content: the composite defect was
written into the firm registry too.** Measured on `broker_companies` (131 rows):

| | count | share |
|---|---:|---:|
| `company_name` containing a `;` | **73** | **56%** |
| single-token rows (`ay`, `cb`, `acre`, `cook`) | 28 | 21% |
| rows that read as a person's name | 9 | 7% |
| `colliers%` family rows | **7** | — |

Live examples: **`cbre; smyth & colliers; patel`** minted as one company; **`colliers`,
`colliers international`, `colliers; mason`, `colliers; olaiz`, `colliers; patel`, `colliers; spisak`,
`colliers; yeggy`** as seven separate firms; `callander commercial` beside
`callander commercial; callander`; and `colin cornell` as a company.

**So the real distinct-firm count is far below 131.** Any resolution that matches against
`broker_companies` as it stands will attach agents to composite pseudo-firms. **Repair the registry
before, or as part of, using it as a match target** (`BR1`).

## 2. ✅ NOT A DEFECT — keeping the name beside the id is the DESIGN

`listing_broker` name set with `listing_broker_id` NULL: **1,930**.
`listing_broker_id` set with the name NULL: **0**.

🎯 **On all 181 rows that carry an id, the name was kept too.** The intended pattern is **both
columns**, always. So *"don't lose the name"* is not a new requirement — it is the existing design,
which simply stopped being applied to new rows.

> **Never treat a populated `listing_broker` as redundant once the id lands. Fill blanks in both
> directions; overwrite neither.**

## 3. 🚨 The composite string — the finding that reframes "cleaning" this

**344 of 2,425 `brokers` rows (14%) and 778 `sales_transactions` rows contain a `;`.** The convention
is undocumented and carries **at least three different facts**:

| example | what it actually is |
|---|---|
| `Acre Advisors; Reid` | **firm ; agent** |
| `Acre; Peters` | **firm (abbreviated) ; agent** |
| `Alamo Capital; Wiegand` | firm ; agent |
| `Adrian Mendoza; Sean Sharko; Austin Weisenbeck` | **three agents — a listing team** |
| `Alex Freemon; Greg Freemon` | two agents (and probably related) |
| `Avison Young; Barnes` **and** `AY; Barnes` | the same firm, once spelled out and once abbreviated |

Plus **49 rows with `&` and no `;`** — mostly legitimate firm names (`Lee & Associates`), which is
the documented P158a hazard: **an `&` is usually part of a real name, not a separator.**

⚠️ **So "clean the strings" is the wrong instinct and would destroy information.** A co-listing is a
*real fact*; collapsing `Avison Young; Barnes` to either half asserts something false. **The answer
is to PARSE into the model that already exists, and keep the raw string as the evidence.**

## 4. The genuine gaps, named

1. **The firm FK is 7.6% populated** (184 of 2,425) and `broker_companies` holds only 131 rows,
   while **299 `broker_name` values look like a firm** and **177 have `broker_name` == `company`** —
   i.e. the person field is holding a firm. **The person/firm split is modeled and not enforced.**
2. **1,930 sales carry a broker name with no FK**, so they are invisible to `broker_ranking.py` and
   to any relationship analysis. **528 distinct names.**
3. **143 duplicate-name groups** in `brokers` (2,280 distinct names across 2,425 rows).
4. **`4802 D Dialysis, LLC` appears as a broker name** — a property/entity name misparsed into the
   broker slot. There will be others.

## 4a. ✅ SHIPPED 2026-09-02 (BR2) — 846 resolved, and the producer was fixed with it

| | before | after |
|---|---:|---:|
| `listing_broker_id` set | 181 | **1,027** |
| name set / id NULL | 1,930 | **1,084** |
| **id set / name NULL** | **0** | **0** ✅ |

**The `update_field` producer fix landed in the same change as the backfill** — the prerequisite
held, so this is not a one-shot repair of a live producer (Class 8). **`id_set_name_null` stayed at
0**, which is the invariant that proves no name was destroyed.

**1,084 remain**, and they are the Tier 2/3 population: composites, abbreviations, bare surnames and
misparses. **They stay unresolved on purpose.**

## 5. How to resolve it — deterministic first, review lane for the rest

**Tier 1 — exact case-insensitive `broker_name`: 422 of 528 (80%).** No fuzzy matching, no identity
guessing. **This is the whole high-yield core and it should ship on its own.**

**Tier 2 — `normalized_name` (373) and `company` (209)**, applied only to Tier 1's residue, and
**only where exactly one broker matches**.

**Tier 3 — REVIEW LANE. Never auto-matched.** Multi-broker strings, abbreviations (`AY` →
Avison Young), bare surnames (`Babcock`), and misparses.

⚠️ **Do NOT reach for `nameSimilarity` / fuzzy matching on the residue.** Its shape is exactly the
population fuzzy matching gets wrong: an abbreviation and a surname and a co-listing all look like
"a near match" to a scorer. **Grouping-for-review ≠ identity-for-write** — the rule this repo has
paid for repeatedly (`dup-pair-planner.ownerCore`, `lcc_normalize_entity_name`,
`lcc_owner_strict_core`).

## 6. Display — the answer to *"shown cleanly everywhere"*

**Yes, and it follows from the model rather than from string cleaning:**

- **Render the FIRM from `broker_companies` and the AGENT from `brokers`** — two fields, because
  they are two facts. A UI that shows one blended string reproduces the defect at the display layer.
- **A co-listing renders as a list, not a string.** Once parsed, `Avison Young; Barnes` is one firm
  and one agent; `Adrian Mendoza; Sean Sharko; Austin Weisenbeck` is three agents.
- **Keep the raw captured string available** (a tooltip, a provenance field) — it is the evidence,
  and it is what makes a wrong parse correctable later.
- ⚠️ **Never display a resolved id without its name**, and never a name the parse could not resolve
  as though it were resolved. **"Not on file" beats a confident wrong firm** — brokers are Tier-4
  market intelligence, and attaching the wrong one corrupts the relationship graph the BD lane ranks
  on (`account-based-contact-intelligence.md`).

## 7. Where else to look

| for | read |
|---|---|
| why brokers are never prospected as principals | `account-based-contact-intelligence.md` |
| the identity-vs-fuzzy rule | `CLAUDE.md` → *dup-pair-planner … never for IDENTITY* |
| open rows | `../os/PLANNED-BACKLOG.md` — `BR*`, `B6e-ci-listing-broker` |
