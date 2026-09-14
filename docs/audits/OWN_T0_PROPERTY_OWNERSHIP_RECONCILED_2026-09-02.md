# OWN-T0 — the property panel shows several ownership stores and reconciles none of them

**2026-09-02 · LCC Opps (`xengecqvemvfknjvbvrq`), gov (`scknotsqkcheojiaewwh`)**
Canonical page: [`docs/architecture/ownership-history-lane.md`](../architecture/ownership-history-lane.md) § OWN-T0.
Migration: `supabase/migrations/20260902160000_lcc_own_t0_property_ownership_reconciled.sql` (applied live).
Guard: `test/own-t0-ownership-reconciled.test.mjs` — 20 tests, **25/25 mutations RED**.

> **Scott, UX23:** *"almost every property I open seems to have similar errors — gaps or lapses in
> owners, even conflicting on the property's own ownership history tab, like no reconciliation is
> occurring."*

He is right at population scale, and the instrument that should have said so read **zero**.

---

## 1. What the panel actually reads (grepped, not assumed)

`_udTabOwnership` (`detail.js`) assembled its answer from four stores that nothing reconciled:

| # | store | how the panel gets it | what it renders |
|---|---|---|---|
| a | `lcc_property_owner` | `/api/entities?action=lookup_asset` → `ent.property_owner` | the **Current Owner** card + confidence |
| b | domain `v_ownership_current` | `qFn` on the domain DB | the **ownership ladder** (recorded / true owner, P113 operator flag) |
| c | `lcc_entity_portfolio_facts` | the owner card's portfolio line, the owner panel | "Owns N properties" |
| d | domain `v_ownership_chain` | `qFn` on the domain DB | the **Ownership History** timeline |

`_udResolvedOwnerRef` prefers (a); the ladder immediately beneath renders (b). **When they disagree the
panel prints one name in the headline and a different one two lines down, with no relationship
between them and no statement that they differ.** That is the "conflicting on the property's own
ownership history tab".

---

## 2. The disagreement matrix (measured live, 2026-09-02)

| pair | comparable | agree | disagree | notes |
|---|---:|---:|---:|---|
| resolved owner (a) vs **current portfolio fact** (c) | 5,964 | 5,297 | **667 (11.2%)** | the brief's "667 of 8,223 / 8.1%" reproduces exactly; the honest denominator is the 5,964 assets that carry BOTH, so the rate is 11.2% |
| resolved owner (a) vs **domain true_owner** (b), P113 operator rows excluded | 7,678 | 6,418 | **1,260 (16.4%)** | 425 excluded as operator, 101 unresolvable to an entity |
| **current owners per property** (c) | 8,068 | 7,312 single | **756 (9.4%)** with >1 · 33 with ≥3 | dia 286 of 1,819 (15.7%) · gov 470 of 6,249 (7.5%) |
| gov's **latest recorded transition grantee vs `properties.true_owner_id`** | 3,474 | 1,965 | **1,509 (43.4%)** | the largest cell in the matrix — and it is **inside the domain database**, before LCC sees it |
| contact pivot (e) vs resolved owner | 8,223 resolved | 4,992 have a pivot, 1,857 a named contact | **32** multi-current properties carry ≥2 owners each with a named contact | the contact story is split across two owner records on those |

`v_lcc_portfolio_ownership_conflict` — the standing detector — read **0**.

**⚠️ Cell (d) as literally specified could not be measured, and that is a finding.** The LCC-side
comparison needs a mirror of `v_ownership_transitions_portfolio` and **LCC has none** — the only
route the transitions take into LCC is A2's chain-apply, which lands in
`lcc_entity_portfolio_facts` (1,399 links, 0 current). So the reconciled view is built from
LCC-resident stores only; the gov-internal comparison above is the honest substitute and is
strictly more alarming.

### Ten named rows, read (Class 11 — a rate alone would have misled, and did)

| property | owner A | owner B | rent |
|---|---|---|---:|
| gov/11504 2970 Market St | Brandywine Realty Trust *(reconciled)* | **Cira Square Master Tenant LLC** *(county_records, 2023)* | $34.9M |
| gov/14203 6595 Springfield Center Dr | USAA Real Estate | **Usgbf Tsa LLC** *(gsa_lease_diff, 2021)* | $26.7M |
| gov/3063 45 L St NE | Trammell Crow Co | **USBGF SENTINEL SQUARE III, LLC** | $24.1M |
| gov/3181 600 19th St NW | George Washington University | **George Washington University (The)** | $23.8M |
| gov/6890 6100 Wabash Ave | NGP Capital | **CoreCivic** *(county_records, 2018)* | $23.2M |
| gov/14197 | Boyd Watterson AM | **Boyd Ashburn, LLC** | $18.9M |
| gov/14398 | NGP Capital | **NGP VI FALLS CHURCH VA LLC** | $9.9M |
| gov/14194 | GI Partners | **GI TC 801 FOLLIN LANE, LLC** | $8.6M |
| gov/5405 | Easterly Gov Properties (REIT) | **EGP 2300 Des Plaines LLC** | $7.4M |
| gov/12575 | Easterly Gov Properties (REIT) | **EastGroup Properties, Inc.** | $3.7M |

Reading the **top 60 by rent** rather than counting them, the class is dominated by
**sponsor ↔ SPE** — Boyd/FGF ×8, NGP V/VI/VII ×5, EGP/USGP ×9, USGBF ×2, GI, USBGF, URG, Jemal,
SkyTower, KPG. Three further shapes fall out of the same read and each needs a **different**
answer:

* **gov/3181** is **one party, two entities** — a merge (P195 / A2a), not an end-date.
* **gov/12575** is **two different REITs** sharing the `egp` token — exactly the collision A3
  measured and refused to key on.
* **gov/11504** has a **master TENANT** sitting in the owner slot.

---

## 3. The producer defect — the fill-blanks predicate is at the wrong grain

Every writer of `lcc_entity_portfolio_facts` keys its "already recorded?" test on
`(entity_id, source_domain, source_property_id)` — the **owner**-property pair. **Not one asks
whether the PROPERTY already has a current owner.** P117
(`lcc_sync_property_owner_to_portfolio`) is the clearest and dominant instance:

```sql
  left join lcc_entity_portfolio_facts pf
    on  pf.entity_id            = o.owner_entity_id     -- the OWNER
   and pf.source_domain        = o.source_domain
   and pf.source_property_id::text = o.source_property_id
  where pf.entity_id is null;          -- "FILL-BLANKS: never touch an existing row"
```

Measured: **632 of the 756 (83.6%)** multi-current properties are exactly one `lcc_property_owner`
row plus at least one row from another source, and **p117-beside-p117 is 0** (it cannot create two
of its own). The remaining 124 are within-source (`gsa_lease_diff` alone 49, unattributed 38, …).

**The function has NO cron.** It is a one-shot whose own drift view
(`v_lcc_portfolio_owner_sync_gap`) invites re-running it. Dry run, before → after:

| verdict | before | after |
|---|---:|---:|
| `insert` | 2,595 | **2,115** |
| `skip_property_has_current_owner` | — | **480** ($400,274,132) |
| `skip_operator` / `skip_brokerage` | 6 / 5 | 6 / 5 |

**480 is the growth prevented.** It is not a reduction of the existing 756 — see §4.

*(Related, also true and not the dominant mechanism: `lcc_finalize_entity_portfolios` DOES compute
supersession on its gov arm, but only `over (partition by property_id)` **within the incoming
payload** — it can never end a current row written by a different producer, and the dia arm does
not supersede at all.)*

---

## 4. ⚠️ THE PRESCRIBED REPAIR WAS IMPLEMENTED IN THOUGHT, MEASURED ON NAMED ROWS, AND REFUTED

The brief said: end-date the earlier owner, date-ordered; a tie or a missing date is a conflict.
That is the right rule for a **stale** owner and the wrong remedy for **this** population, because
most of these pairs are not rival claims — they are one asset held at two levels and **both rows
are true**. The sponsor is who we prospect; the SPE is who is on the deed and the GSA lease.

It also could not have been executed as written: **523 of the 756 are only partially dated** and
**121 carry no date at all** (P117 writes `ownership_start_date` NULL by design — "we know they own
it NOW, we do not know when they acquired it"), so date-ordering decides **101**. And
`is_current` is `GENERATED ALWAYS AS (ownership_end_date IS NULL)`, so un-currenting a row means
**writing a date we do not have** — fabrication.

**So no portfolio fact is end-dated, deleted or repointed by OWN-T0.** What ships instead:

* the **producer fix** (§3), so the class cannot grow;
* the **view** (§5), which states the disagreement instead of silently picking;
* the **detector** (§6), so it is countable.

The **11** properties whose two current facts collapse to ONE survivor (a tombstone still holding a
live fact beside its survivor — the P175a class: `Meridian Property` / `Meridian Property Company`,
`Port Authority Of New York & New Jersey, The` / `The Port Authority…`) are collapsed **in the
view** by resolving through `lcc_entity_survivor`, and reported by the detector as their own defect
class for a repair that owns the merge path.

---

## 5. `v_lcc_property_ownership_reconciled` — the ONE view the panel reads

One row per (asset, owner link) across every LCC-resident store, survivor-collapsed, carrying
`evidence_level` (what KIND of record made the claim), `is_primary` + `primary_reason`,
`property_state`, `conflict_class`, `gap_before` and `start_date_unknown`. Head view:
`v_lcc_property_ownership_current`. Route: `GET /api/entities?action=ownership_chain&domain=&property_id=`.

| property_state | conflict_class | properties | rent |
|---|---|---:|---:|
| `single_current_owner` | — | 10,084 | $1.469B |
| `only_non_owner_claims` | — | **7,678** | $8.1M |
| `conflict` | `unclassified_rival` | 1,614 | $1.363B |
| `conflict` | `duplicate_entity` | 417 | $137.7M |
| `conflict` | `sponsor_family_confirmed` | 64 | $88.9M |

`no_current_owner` (history only, no primary row) is a further **185** properties.

* **`property_state` counts OWNER CANDIDATES, not every claim.** The first cut counted every current
  link and **884 properties read `conflict` purely because a P113 operator/tenant sits in the owner
  slot** — a known non-owner the panel already guards on. Operator / brokerage / placeholder links
  stay on the row **flagged** and are excluded from the count and the class. `only_non_owner_claims`
  = 7,678 is the honest "no owner on file" number that state makes visible.
* **The conflict count over what the panel SEES is larger than 756**, because the panel also reads
  the resolved owner and the domain true_owner where neither has a portfolio fact. 2,095 properties
  are in conflict on the view against 745 in the facts store alone.
* **`conflict_class` is ordered and every arm rests on a recorded fact** — the N15c canonical key
  for `duplicate_entity`, the **human-confirmed** `lcc_ownership_sponsor_family` for
  `sponsor_family_confirmed`, and the existing single-owner name rules for operator / brokerage /
  placeholder. The fall-through is an explicit `unclassified_rival`, an honest "we do not know",
  never an unearned positive (P124).
* **No lexical sponsor guess.** A3 measured `lcc_tier0_sponsor_brand_token` at **3 of 74** on GSA
  SPEs (a government SPE is named for its city and agency, not "Propco") and ~25% precision
  generally; P198 measured co-proposal at 7%. A GENUINE sponsor/SPE pair that is unconfirmed stays
  `unclassified_rival` — and the confirm is one row in the registry. Live it catches **64** of the
  ~1,614.
* **The chain gap is reported, never bridged.** It can only fire where BOTH sides are dated, which
  is **60 links fleet-wide**; `start_date_unknown` (21,295 of 28,435) is the far larger honest state.

### Evidence-level distribution (28,435 links)

| evidence_level | links | current | undated |
|---|---:|---:|---:|
| `domain_record` | 11,722 | 11,722 | 11,722 |
| `lease_record` | 4,630 | 3,632 | 257 |
| `reconciled` | 4,485 | 4,477 | 4,406 |
| `transaction_record` | 2,608 | 395 | 1,968 |
| `unattributed` | 1,965 | 1,428 | 15 |
| `title_record` | 1,626 | 1,520 | 1,557 |
| `chain_apply` | 1,399 | **0** | 1,370 |

⚠️ **Both mapping arms were wrong on the first cut and reading the LABEL DISTRIBUTION is what found
it, not reading the code.** `evidence_level='other'` held **3,364** links and every one was
something the map should have named: 1,965 with no recorded source (the `fact` CTE coalesces null
to the STRING `'unattributed'`, so the `is null` arm never saw them) and 1,399 A2 rows whose source
is `gov_ownership_chain:<uuid>`, not `ownership_chain…`. Corrected, `other` reads **0**. A label
that says "Other" for "we do not know where this came from" is P180 one layer up.

⚠️ **Stated, not fixed:** `ownership_source` carries a **per-row UUID** on two producers
(`county_deed:<uuid>`, `gov_ownership_chain:<uuid>`), so it cannot be grouped on without a prefix
strip — a producer defect.

### ⚠️ `not materialized` is load-bearing, not decoration

The panel opens this view for ONE property. Measured without it: **1,013.9 ms / 216,947 buffers**
for a 3-row point query, because a CTE referenced more than once is **always** materialized
(C13b §7.7) so the predicate cannot push down — `fact` aggregated all 14,119 portfolio rows and
`domain_owner` joined all 31,160 owner-fact rows on **every panel open**, and the materialized CTEs
were then re-scanned (`loops=3`). With it: **20.1 ms / 674 buffers — 50× faster, 322× fewer
buffers**, every leg an index scan. Aggregates over the whole view are byte-identical before and
after.

The **detector** hit the sibling footgun: its first cut used correlated scalar subqueries against
the reconciled view and **timed out at 60 s**. Hoisted to one LEFT JOIN against the head view.

---

## 6. The detector that read zero

`v_lcc_portfolio_ownership_conflict` is **correct and narrow**: it requires a tombstone that is
CURRENT beside a survivor that has **ENDED** (the P175a shape). It is structurally unable to see two
LIVE entities both marked current on one property — 745 of the 756. It is left alone.
`v_lcc_property_multi_current` is the complement and carries both defect classes rather than lumping
them, because they need different repairs.

**Positive control (2026-09-02): 756 properties / $903,291,687** — 745
`multi_current_distinct_parties` + 11 `tombstone_duplicate_current`, 632 of them carrying a P117
row. That reproduces the independently measured baseline exactly, so the zero it replaces was the
instrument (Class 11).

---

## 7. Verify

```sql
-- the defect, countable for the first time
select defect_class, count(*), sum(annual_rent)::bigint from v_lcc_property_multi_current group by 1;
-- the producer cannot grow it
select * from lcc_sync_property_owner_to_portfolio(true, null);   -- expect skip_property_has_current_owner > 0
-- what the panel now shows
select property_state, conflict_class, count(*) from v_lcc_property_ownership_current group by 1,2;
```

**⚠️ Verify on `skip_property_has_current_owner` and on the detector's `defect_class` split — never
on 756 going down.** Nothing here end-dates a fact, so 756 is expected to hold. The number that
moves is the growth that does not happen.

---

## 8. Filed, not fixed

| id | finding |
|---|---|
| **OWN-T0a** | **1,509 of 3,474 gov properties (43.4%)** disagree between their latest recorded transition grantee and `properties.true_owner_id` — a domain-internal reconciliation, upstream of everything here. |
| **OWN-T0b** | LCC has **no mirror of `v_ownership_transitions_portfolio`**, so the reconciled view cannot carry the domain's transition chain directly; it sees only what A2's chain-apply has landed. |
| **OWN-T0c** | **417 `duplicate_entity` conflicts** are merge candidates for P195/A2a. `lcc_entity_canonical_key` keeps a trailing parenthesised `(The)` (`george washington university the`), so a `(The)` suffix variant is invisible to it **and to `v_duplicate_candidates`** — an N15c blind spot. |
| **OWN-T0d** | **11 `tombstone_duplicate_current`** properties: a tombstone still holds a live current fact beside its survivor. The merge path should have deduped; the view collapses them, the data does not. |
| **OWN-T0e** | **~1,550 unconfirmed sponsor/SPE pairs.** Each confirm is one row in `lcc_ownership_sponsor_family` and clears every property in that family — A3 measured `boyd` alone at 20 of 24. A value-ranked confirm lane is the highest-leverage follow-up. |
| **OWN-T0f** | `ownership_source` carries a per-row UUID on `county_deed:` and `gov_ownership_chain:`. |
| **OWN-T0g** | `lcc_finalize_entity_portfolios`' gov supersession window is scoped to the incoming payload; a property whose owners split across pages gets two current rows. dia does not supersede at all. |
