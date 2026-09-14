# A3 — the ownership `mismatch` lane is mostly a REPRESENTATION question, not a data error

**2026-08-27 · LCC Opps (`xengecqvemvfknjvbvrq`) · migration `20260827180000`, applied live**
**Nothing is written. No confirmation is seeded. No lane count moves today.**

## 0. Re-measured first — the population moved under the prompt

The A3 brief was written against `mismatch = 73`. Live today it is **74 chains / 46 owners /
$403.0M**, because **A2 landed in between** and drained `agrees` 380 → 90. The dated-blocker
doctrine applies to a population size exactly as it applies to a blocker: re-measure before
quoting. Every number here is from this run.

## 1. What the 74 actually are

| class | chains | owners | decisions | rent (per owner) |
|---|---:|---:|---:|---:|
| `sponsor_family_candidate` | **32** | 12 | **12** | $221.0M |
| `unexplained` | 31 | 27 | — | $344.6M |
| `name_variant` | 11 | 10 | — | $47.1M |

**⚠️ Those rent figures DOUBLE-COUNT.** Three owners span two classes (Boyd Watterson,
Easterly, DEAMO), so the class sums ($612.6M) exceed the lane's distinct total of **$403.0M**.
Quote the distinct figure. Value is per OWNER — Boyd's $179.8M appears on 24 chains and is one
owner.

**The honest headline is decisions, not chains: 32 chains collapse into 12 confirmations, and
Boyd Watterson alone is 20 chains in one.**

### The 12 proposals, value-ranked

| sponsor | token | chains | arm | rent | fleet-wide entities carrying the token |
|---|---|---:|---|---:|---:|
| Boyd Watterson Asset Management, LLC | `boyd` | **20** | lead_token | $179.8M | 129 |
| FGF Management LLC | `fgf` | 2 | token_contained | $6.2M | 67 |
| Sunflower Capital Partners | `sunflower` | 1 | token_contained | $14.6M | 6 |
| Highwoods Properties | `highwoods` | 1 | lead_token | $5.8M | 9 |
| Madison Capital Group or affiliated principals | `madison` | 1 | lead_token | $3.2M | 67 |
| RXR Realty | `rxr` | 1 | lead_token | $2.3M | 3 |
| Commonwealth Commercial Partners | `commonwealth` | 1 | lead_token | $2.1M | 32 |
| American Realty Capital (ARC) | `arc` | 1 | token_contained | $1.9M | 46 |
| CARRINGTON, LLC | `carrington` | 1 | lead_token | $1.8M | 7 |
| Sequoia Holdings | `sequoia` | 1 | token_contained | $1.3M | 11 |
| Madison Capital Group LLC | `madison` | 1 | lead_token | $1.2M | 67 |
| East Lake Management & Development Corporation | `east` | 1 | lead_token | $0.8M | **226** |

Read on named rows: **12 of 12 are plausible-or-genuine.** The weakest is `east` — a generic
word — and its blast-radius column says so on the card.

## 2. ⚠️ The prompt's prescription was measured and partly rejected

The brief said: reuse `lcc_owner_sponsor_domain` (P190), one confirm per sponsor TOKEN. Two
measurements say a token-scoped confirm is the wrong key **for this question**:

1. **A bare token is not bounded.** Live entities carrying each proposed token as a standalone
   word: `east` **226**, `boyd` **129**, `fgf` 67, `madison` 67, `arc` 46, `commonwealth` 32 —
   and the samples are the exact noise class P196 warned about (`1 EAST BROWARD OWNER LLC`,
   `100 East PropCo LLC`; for `boyd`, the surnames `Boyd Alexander`, `A Boyd Charles E and
   Holly`). In `lcc_owner_sponsor_domain` a wrong token merely fails to join to a person. Here
   it would assert a false **ownership** fact. The confirm is therefore keyed
   **(sponsor entity, token)**.
2. **The PK cannot express a case already in the data.** `madison` is proposed by **two** owner
   entities (`Madison Capital Group LLC` and `Madison Capital Group or affiliated principals`,
   both pointing at `MADISON-OFC WESTON POINTE FL LLC` — itself a duplicate-owner signal for
   P189/P195). And `egp` names **both** `Easterly Government Properties` and `EastGroup
   Properties, Inc.`, whose SPEs are `EGP 116 Suffolk LLC` and `EGP 85 Charleston LLC`. A
   `sponsor_token` primary key holds one row per token and carries neither pair.

**This is not the second-registry drift.** The drift warning is about a second *detector*; the
detector here is shared — `lcc_ownership_sponsor_token` composes `lcc_tier0_brand_token` and the
very guard predicates `lcc_tier0_sponsor_brand_token` uses, **extracted into named functions in
Unit 1 so there is one copy of each**. The two tables answer different questions at different
scopes and neither derives from the other.

**⚠️ And a contact confirm does not answer the ownership question — it is evidence on the card.**
Letting Scott's 8 existing `lcc_owner_sponsor_domain` rows resolve ownership chains for free
was tested: they resolve **0 of 74**, so it buys nothing — and it would let a contact-matching
decision, whose own proposal gate reads ~4-of-6 on named rows (P196), silently settle an
ownership fact. That is the P188 finding restated.
`v_lcc_ownership_sponsor_family_proposals.also_confirmed_for_contacts` surfaces it; nothing
inherits.

## 3. ⚠️ The P196 SPE-marker guard drops 24 of 27 genuine rows here

`lcc_tier0_sponsor_brand_token(grantee, owner)` returns non-null for **3 of 74**. The
SPE-marker requirement (`property|properties|holdings|owner|propco|holdco|fund`) is what drops
the rest: a government SPE is named for its city and agency (`BOYD SACRAMENTO GSA, LLC`), not
"Propco". Keeping it would reduce A3 to a rounding error while reading like a working gate. It
is **not applied**, and the predicate is not weakened — the omission is named at the call site.

The other three guards **are** applied, and their cost is measured, not assumed:

| guard | fires | outcomes changed |
|---|---:|---|
| street | 3 | **0** — none of the three carried a shared token anyway |
| brokerage | 0 | 0 |
| person | 3 labelled | **2 real false negatives**, both named below |

The two the person guard costs are `City of Oakland` ← `PORT DEPARTMENT OF THE CITY OF OAKLAND`
and `Glenn Olds or related individual/entity` ← `U-Land, Glenn Olds, LLC`. Both are genuine.
Both are also `lcc_looks_like_person` **false positives** — "City of Oakland" is not a person —
a pre-existing guard defect, **named here and not patched**. Kept per P196's stated trade: a
false negative costs one card; a false positive asserts a stranger's firm over an SPE family.

**⚠️ This is not P187's rejected acronym arm.** P187 *inferred* a fact from one name and scored
~30–40% because 27.6% of owner names are entirely uppercase. This requires the token on **both
sides of a deed for the same property** — the candidate space is one grantee per chain.

## 4. The residue, sized and characterised — no surface built for it

**31 chains / 27 owners / $344.6M**, named by which guard dropped them:

| `unexplained_reason` | chains | owners | rent |
|---|---:|---:|---:|
| `no_shared_brand_token` | 25 | 21 | $296.1M |
| `grantee_reads_as_street` | 3 | 3 | $19.2M |
| `owner_reads_as_person` | 3 | 3 | $29.3M |

Reading them, the residue is itself two populations:

- **Acronym / place-named SPEs a human would likely confirm** but no rule can safely propose:
  `BRE 1200 Wall Street Owner LLC` ← Blackstone, `BOF DPC Denver West Park 54 LLC` ←
  Brookfield, `EGP 116 Suffolk LLC` ← Easterly, `JPPF WATERFRONT PLAZA` ← Jamestown,
  `KR Menlo Park` ← Kilroy, `PCPI SHORELINE SQUARE` ← PCCP, `PDCREF2 BALLSTON` ← Penzance,
  `USGBF Nci Lab` ← US Global Business Fund, `MACH I AREP CARLYLE CENTER` ← AREP,
  `CFEP PRUNEYARD` ← Cypress Equities, `TCC BUILDING "R" ASSOCIATES` ← The Cafaro Company.
- **Genuinely different parties — the real integrity lane:** `DEAMO LLC.` ← `LuLu Hsu`,
  `TIAA CREF` ← `Boyd Watterson`, `STAG INDUSTRIAL HOLDINGS` ← `Clarion Partners JV MRP
  Industrial`, `Jamestown LP` ← `Manhattan Chelsea Market LLC`, `Resnick family` ←
  `BLDG MANAGEMENT CO., INC.`, `DigitalBridge Group` ← `ZCOLO, LLC`, `Northwood Investors` ←
  `NEEP INVESTORS HOLDINGS LLC`, `EastGroup Properties, Inc.` ← `EGP 85 Charleston LLC`
  (an acronym **collision** with Easterly), `RMR` ← `Government Props Income Trust`
  (manager ↔ REIT).

That second group is the ~20–30 the brief predicted. **Its surface is not built here** — it is
sized so the decision to build one can be made on numbers.

## 5. Stated gaps — reported, not patched

- **`lcc_is_spe_shell_name` detects 4 of 31 residue grantees.** The documented place-named-SPE
  under-detection, live: `BELTSVILLE GSA FDA, LLC`, `Lorton GSA LLC`, `BOYD PHOENIX GSA LLC`
  are all missed. **Not widened** — a second SPE detector is the drift this repo keeps warning
  about.
- **Confirming `boyd` resolves 20 of Boyd's 24 chains, not 24.** The four left carry no Boyd
  token at all: `BELTSVILLE GSA FDA, LLC`, `Lorton GSA LLC`, `MAITLAND FL I FGF LLC`,
  `Tacoma WA I FGF, LLC`. Report 20.
- **Two of those four carry the `fgf` token, and `FGF Management LLC` is a separate owner also
  proposing `fgf`.** Boyd holds two properties whose deeds record FGF SPEs — either a
  Boyd/FGF JV or a genuine attribution question. Surfaced, never folded.
- **`lcc_looks_like_person` calls `City of Oakland` and `TIAA CREF` people.** Pre-existing.
- **`name_variant` (11 chains) stays HUMAN-ACTIONABLE.** It is detected with
  `lcc_owner_strict_core`, which **A2 measured and rejected for writes on this exact
  population** (it equates `BAMMF (8) LLC` with `BAMMF (3) LLC`). Labelling a card with it is
  safe; retiring 11 cards on it would be an automated name judgement nobody asked for. Note it
  also *misses* obvious variants — `East Lake Management & Development Corporation` ←
  `EAST LAKE MGT & DEV CORP` lands in the sponsor bucket instead, and that is fine.

## 6. Gates

- **P180 equivalence, both directions, on every pre-existing column of
  `v_lcc_ownership_history_lane_split`: 0 rows differ**, 256 rows before and after.
- **P196 behaviour unchanged by the guard extraction: 0 of 696 Tier 0 rows change token.**
- **Positive control (P182 — never trust a zero without pointing the detector at a known
  positive).** A self-rolling-back synthetic gate inserted the `boyd` confirmation and measured
  the lane:

  | | before | with `boyd` confirmed |
  |---|---:|---:|
  | `mismatch` | 74 | **54** |
  | `sponsor_spe` | 0 | **20** |
  | `human_actionable` | 92 | **72** |
  | `agrees` | 90 | **90** ✓ |
  | `no_records` | 74 | **74** ✓ |
  | `all_guarded` | 18 | **18** ✓ |

  Rolled back; **0 confirmations seeded, 0 residue.**
- **`npm test`: 4,683 pass / 0 fail / 6 skipped.**
- **`test/ownership-mismatch-classify.test.mjs`** (18 tests), mutation-verified RED on: folding
  `sponsor_spe` into `agrees`; re-typing the street regex instead of calling the shared
  predicate; dropping the person guard; making `confirmed_by` nullable; seeding a confirmation;
  keying the table on the token alone.

## 7. How to confirm a sponsor

```sql
select * from v_lcc_ownership_sponsor_family_proposals;   -- read grantees + token_entities_fleetwide

insert into lcc_ownership_sponsor_family (sponsor_entity_id, sponsor_token, confirmed_by, notes)
values ('<sponsor_entity_id>', 'boyd', 'scott 2026-08-27',
        'Boyd Watterson GSA SPEs + the Global fund/manager pair.');
```

Reverse: `delete from lcc_ownership_sponsor_family where confirmed_by = '<who>';`

## 8. What this does NOT claim

**`mismatch` is still 74 and the lane's `human_actionable` badge still reads 92.** A3 ships the
classification, the confirm registry and the proposals; **the movement is Scott's 12
confirmations**, and the verify is the query in §6 run again after them. Nothing here completes
a research task, writes an ownership fact, or touches `agrees` / `no_records` / `all_guarded`.

**A3b (not built, named):** teaching A2's apply path to consume `sponsor_spe` so a confirmed
family's chain is written into `lcc_entity_portfolio_facts`. That is a materially larger
decision — it writes — and nobody has graded it.
