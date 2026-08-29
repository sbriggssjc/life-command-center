# C8 — the prospecting brief must admit resolved owners, not just labelled ones

**Read first:** `docs/audits/C8_PROSPECTING_BRIEF_EXCLUDES_THE_BOOK_2026-08-29.md` ·
`docs/architecture/bd-ranking-and-priority-queue.md` (esp. **§3** and the C6 precedent) ·
Dead-End playbook **Class 22, 23, 24** · `CLAUDE.md` Consumption-Layer doctrine.

**One JS change in `api/operations.js`.** No migration, no new view, no cron.

---

## 1. The defect

`handleProspectingBrief` (`api/operations.js:~4805`) — the operator call sheet — gates on:

```js
const BD_OWNER_ROLES = 'developer,user_owner,buyer,seller_flipper,operator';
```

Its comment states the intent: *"Brokers and unclassified intermediaries have owner_role='unknown'
and must be excluded."* **The intent is right; `owner_role` is the wrong instrument.** Measured live
over the 311 eligible `v_bd_cadence_dashboard` rows:

| | rows | rank value |
|---|---:|---:|
| shown today | **80** | $442,805,301 |
| excluded as `unknown` | **231** | — |
| …**resolved owners in `lcc_property_owner`** | **47** | **$515,176,328** |
| …flagged brokerage | **3** | — |
| …genuinely unclassified | 181 | — |

**It excludes 3 brokerages and 47 real owners, and the excluded owners outweigh everything shown.**
Excluded by name: **Easterly Gov Properties ($114.9M, 85 properties)**, NGP Capital, USAA Real
Estate, US Fed Properties Trust, Elman Investors, Gardner Tanenbaum, GI Partners, Trammell Crow,
Clarion Partners. ⚠️ **Two of the five declared roles — `user_owner` and `seller_flipper` — have
never been written to any entity** (Class 22), and `unknown`, which covers **93.9%**, is not in the
vocabulary at all.

## 2. What to build

Admit a row when **either**:

- its `owner_role` is in `BD_OWNER_ROLES` (unchanged), **or**
- **the entity is a resolved owner** — it has a row in `lcc_property_owner` —

and in **both** arms, exclude `lcc_owner_name_is_brokerage(entity_name)`.

This is **C6's rule on a second surface**: admit on the **per-asset fact** the system already holds,
not on the party-level label (**Class 24**). It also makes the brokerage guard **explicit** rather
than an accident of the role label — which is what the comment always intended.

⚠️ **`v_bd_cadence_dashboard` does not expose "is a resolved owner".** Decide and **say which** you
did: append a boolean to that view (⚠️ `CREATE OR REPLACE VIEW` is **append-only for columns** —
add at the END, never mid-list, or 42P16), or filter in the handler with a second query. **Prefer
the view** — the handler already fails soft to a fallback path, and a second round trip there is an
N+1 waiting to happen.

## 3. Predicted delta — assert against this

| | today | expected |
|---|---:|---:|
| brief rows served | **80** | **127** |
| added rank value | — | **+$515,176,328** |
| brokerages admitted | 0 | **0** |
| the 181 genuinely-unclassified rows | excluded | **still excluded** |

**A prediction that matches is the evidence the change did what you think.** If it does not match,
find the mechanism before adjusting either side (the A2 / C2e-T2a lesson).

## 4. ⚠️ Read these three rows before shipping

`lcc_owner_name_is_brokerage` has a **documented false positive** — it matches bare `\mmarcus\M`
and `\mnai\M`, so a genuine *"Marcus Family Trust"* trips it (P116). Only **3** rows are affected.
**Read all three by name and report them.** If one is a real owner, say so rather than silently
letting the guard drop it.

## 5. Discipline

- **The fallback path must get the same gate.** `handleProspectingBrief` falls back to another
  source when the queue returns nothing; a gate fixed in one branch and not the other is the
  **A1 `V2_MAP`** failure (a filter implemented in one branch silently stops filtering in the other).
  **Check the whole handler, not just the line the audit names.**
- **Do not "fix" this by removing the gate.** 181 unclassified rows would flood a call sheet — the
  producer-without-a-value-gate failure. The gate stays; its instrument changes.
- **Do not add a role classifier.** Every lexical owner classifier measured in this arc landed
  ~25% (P189, A3), 7% (P198), 4-of-6 guarded. Whether an owner leaves `unknown` is **C4a**, still
  Scott's doctrine call, and deliberately out of scope.
- **Assert on the state delta**, never on "it compiles".
- ⚠️ **`user_owner` and `seller_flipper` stay in `BD_OWNER_ROLES` for now** — removing them is a
  literal no-op (0 rows each) and changing two things at once makes the delta unreadable. Report
  that they are dead; do not remove them in this change.

## 6. Report back

- Rows served before and after, against §3, plus the rank-value delta.
- **The 3 brokerage-flagged names, read individually.**
- Whether the fallback branch carries the same gate.
- Which mechanism you used for "is a resolved owner", and why.
- ⚠️ **One thing to flag, not fix: `Brandywine Realty Trust` appears at $34,920,891.77 with 0
  current properties. That is the N18 fabricated `attributed_rent` value** (the gov-wide
  `max(annual_rent)`), surfacing here as a rank. **N18 fixed the developer-classification view; this
  is a different consumer of the same shape.** Confirm whether `rank_value` shares that defect and
  report it — it is filed as **C8b** and is **out of scope for this change**.
