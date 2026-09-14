# C13c — `one_off_owner` carries its confidence, and the known-wrong rows are recorded as reviewed (2026-09-01)

**One view change on LCC Opps** (`v_lcc_entity_roles` + `v_lcc_entity_role_ambiguity`), one ledger
insert, one partial index. No new table, no cron, no consumer repointed. Migration
`supabase/migrations/20261006120000_lcc_c13c_one_off_owner_confidence.sql`, applied live to
`xengecqvemvfknjvbvrq`. Guard `test/c13c-one-off-owner-confidence.test.mjs` (9 tests, **21/21
mutations RED**). Design page: `../architecture/owner-role-classification.md` §7.4 / §8 / §9.

| | before | after |
|---|---:|---:|
| `one_off_owner` total | 142 | **142 — unchanged in COUNT** |
| …`_sf_corroborated` | — | **13** |
| …`_unverified` | — | **129** |
| routed to ambiguity as `entity_type_contradicted_by_named_review` | 0 | **21, named** |
| `investor_owner` · `former_owner` · `repeat_buyer` · `developer` | 6,447 · 3,786 · 385 · 718 | **unchanged** |
| `user_owner` · `buyer` · `operator` | 10 · 124 · 29 | **unchanged** |
| total role rows · multi-role entities | 11,641 · 954 | **unchanged** |
| P0.4 | 555 | **555** |
| `v_lcc_user_owner_candidates` | 15 | **15** |

---

## 1. Every measurement in the prompt reproduced exactly

Over the 142: `salesforce/Contact` **13** · `salesforce/Account` **0** · `works_at` edges either
direction **0** · `lcc_owner_name_has_org_marker` **0** · fails `lcc_looks_like_person` **28**.

The corroborated 13 are the 13 the prompt names, `Law Offices` included.

---

## 2. What shipped — a confidence split, not a deletion

`evidence_arm` — which the view already makes mandatory on every row — now carries the confidence:

- **`individual_single_current_asset_sf_corroborated`** (13): `entity_type='person'` **and** a
  `salesforce/Contact` identity.
- **`individual_single_current_asset_unverified`** (129): `entity_type='person'` only, and the row
  **says so on its face** — `evidence_detail.individual_evidence` reads
  `'entities.entity_type ONLY'` with a caveat naming the defect.

**The membership test is byte-identical to C13b's.** 142 → 13 would discard `Maslow Robert C &
Michele C` and every genuine individual simply absent from Salesforce; asserting all 142 flat is
what put a $22.8M institutional manager on a one-off-individual lane. P181 one layer down: the
escalation carries the worker's confidence and the surface gates on it.

**The reviewed institutional rows are a LEDGER, not a stoplist.** 21 rows in
`lcc_entity_role_confirmation` (`role='one_off_owner'`, `verdict='rejected'`,
`confirmed_by='c13c_named_review'`), and the new ambiguity kind JOINS that table. The classifier
contains no name literal; a guard goes red if one appears, in `=` or in `NOT IN` form.

---

## 3. ⚠️ The one tension in the brief, named rather than resolved silently

§3 says the reviewed rows should "stop being emitted as individuals". §5's assertion table says
`one_off_owner` is **"142 — unchanged in COUNT"** and splits it **13 / 129**, which leaves no room
for a suppressed set. **The numeric assertion governs** (numbers over prose is this repo's own
rule), and suppression has a real cost this unit was told not to pay: every one of the 21 also
carries `investor_owner`, **correctly**, so today a wrong `one_off_owner` removes nobody and admits
nobody, while suppressing it is a behaviour change on an arm §4 puts out of scope.

Verified, not asserted: **all 21 keep `investor_owner`** after the change.

Filed as **C13f** — suppress the reviewed rows from the arm — for a unit that can grade the consumer
impact rather than inferring it.

---

## 4. The routed 21, and where each was read

The 15 the prompt's §1 names, all drawn from the 28 that fail `lcc_looks_like_person`:

`Jamestown` $22,801,678 · `SkyREM` $1,479,324 · `Deoworks` $1,105,712 · `Protea Primewest (PPW)`
$985,045 · `Everbank` $787,226 · `Gofsco` $604,924 · `AEI NET Lease Portfolio XIII D` $294,496 ·
`Alexandria` · `Brixmor` · `AvalonBay` · `BREIT` · `LaSalle` · `MIT` · `Komatsu` · `EJME` (last
eight: no rent on file).

**Plus the 6 the design page §7.4 read and recorded**, which §1's table cannot contain because §1
is drawn from the name-test FAILURES and these all **pass** `lcc_looks_like_person`:

`Gates Hudson` **$19,632,143** · `Metropolitan Life Insurance` **$11,847,129** · `Gladstone
Commercial` $2,693,128 · `Beverly Wilshire` $1,973,752 · `Samaritan's Purse` $1,954,199 · `Apollo
Global RE` (no rent).

⚠️ **That is why the count is 21 and not ~15.** Restricting to §1's list would leave the arm's **#2
and #3 by rent** — $19.6M and $11.8M — unmarked while marking `EJME` at $0. Both sets are reads a
human recorded in a canonical document; the ledger records which read each came from
(`provenance` in the `evidence_note`).

**⚠️ Names I read and did NOT route**, because no recorded human read covers them:
`Eaton Vance RE` ($1,081,104), `Hendrick Automotive` ($647,157), `Orrick; Daniel Rot` ($839,358),
`Louise Bon Atlanta` ($602,513). Adding them would be me making the name judgement §4 forbids the
classifier from making. They belong to whoever extends the review.

**Disjointness proven, not assumed:** routed ∩ corroborated = **0**.

---

## 5. ⚠️ The honest quality of the uncorroborated 129 — read on 10 named rows

Nobody had measured this. The 28 name-test failures are **not** a random sample of the 129, so a
deterministic sample (`order by md5(entity_id::text) limit 10`) was read instead:

| name | rent | read |
|---|---:|---|
| Fred Hall · Rudy Guerrino · Kevin Truan · Sujit Singh · Roy Ghazimorad | — / $175,006 | **individuals** |
| Brenda M · Kristen E | $271,583 · $251,766 | **individuals** (truncated capture, not a firm) |
| James D Hollingsworth; Thomas P Hollingsworth; Gail Hollingsworth | — | **individuals** (three of them) |
| Peter Hanson RE | — | **ambiguous** — an `RE` suffix reads as a firm named after a person |
| Everbank | $787,226 | **NOT an individual** (already routed) |

**8 of 10 clear individuals, 1 clearly not, 1 ambiguous — ~80%.** That is materially better than
the 28-failure subset implies, and it is the number that justifies keeping the 129 rather than
deleting them. **State it as a 10-row read, not a rate**: n=10.

---

## 6. Sizing the `entities.entity_type` defect fleet-wide — filed as C13g, not started

Live population: **56,192 entities** — 43,154 `organization`, 13,038 `person`.

**Non-lexical contradictions (a FLOOR, both directions):**

| signal | entities | current rent |
|---|---:|---:|
| typed `person`, carries a `salesforce/Account` identity | **338** | $0 (none holds a portfolio fact) |
| typed `organization`, carries a `salesforce/Contact` identity | **76** | **$181,839,547** |
| typed `person`, is the TARGET of a `works_at` edge | 0 | — |
| typed `organization`, is the SOURCE of a `works_at` edge | 0 | — |

**414 of 56,192 (0.74%)** carry a directly contradicting recorded identity. `works_at` produces
**zero** contradictions in either direction, so it carries no signal here at all — worth recording
so nobody re-derives it.

⚠️ **THE LEXICAL ESTIMATES ARE REFUTED AS INSTRUMENTS, AND ONE OF THEM IS A TRAP.**
`lcc_looks_like_person` flags **13,225 of 43,154 org-typed entities (30.6%), carrying $535.7M** —
and that number **must not be reported as a defect count**. It is the documented
two-capitalised-tokens false positive at scale: on this very arm it passes `Gates Hudson`,
`Metropolitan Life Insurance` and `Gladstone Commercial`, all firms. It measures the regex, not the
population (playbook Class 11). The mirror is equally uninformative:
`lcc_owner_name_has_org_marker` flags **19 of 13,038** person-typed entities and **0 of the 142**.

**The only defensible size is a hand read.** On the 142 read by name, **21 are organizations ≈ 15%**.
Extrapolated to 13,038 person-typed entities that is **~1,950**, from one non-random sample — an
estimate, offered as such, not a measurement.

---

## 7. ⚠️ The producer, found while sizing — and it explains the direction of the error

External identities on the 142:

| source | entities |
|---|---:|
| `rca` / `contact` | **115** |
| `costar` / `contact` | 32 |
| `dia` / `true_owner` | 19 |
| `salesforce` / `Contact` | 13 |
| `crexi` / `contact` | 3 |
| `rca` / `company` · `costar` / `company` | 2 · 1 |

**The arm is dominated by transaction-vendor "contact" captures** — the buyer/seller party slot of
an RCA or CoStar deal record, which is where a COMPANY name gets filed as a "contact" and then
minted `person`-typed in LCC. That is the mechanism behind `Jamestown`, `BREIT` and `AvalonBay`
being typed `person`, and it is a producer question, not a classifier question.

⚠️ **And the tempting inverse signal was measured and rejected.** Three of the 142 carry a
vendor `company` identity while typed `person` — which looks like a clean negative corroboration.
Read on named rows it is **2 of 3**: `Metropolitan Life Insurance` and `ARC Thrift Shop` are firms,
and **`Sarita Mutscher` is a real individual** who also happens to be one of the SF-corroborated 13.
At n=3 and 67% that is the same class as every lexical signal this arc has rejected. **Not wired.**

---

## 8. `salesforce/Contact` coverage — growing, but the ceiling is structural

10,083 identities total. **395 created in the last 30 days across 22 distinct days**, newest
2026-08-31 — a live feed, not a one-shot. But the July 2026 month alone holds **8,328** of them, so
"growing" describes a bulk sync plus a real trickle, not a steady climb.

**On the arm specifically it went ~2 → 13 in 90 days (11 of the 13 added in that window), all of
them by 2026-07-31.** So the split's 13 is itself mostly a product of the July sync.

⚠️ **The ceiling is not the sync's pace — it is that this arm sits outside the SF-covered pool.**
**9,819 of 13,038 live person-typed entities (75%) already carry a `salesforce/Contact`**, against
**13 of 142 (9%)** here. The arm is drawn from RCA/CoStar transaction captures (§7), which the CRM
has never held. **So corroboration will not climb to 75% by waiting**: closing the gap means
reconciling vendor-captured parties into the contact hub, which is a different unit with a
different cost. **9% is a ceiling worth stating, and its cause is the population, not the feed.**

---

## 9. Performance — measured both ways, buffers as the evidence

§7.7 made shape load-bearing on this view. The corroboration is a **CTE** mirroring `op`, never a
per-row `EXISTS` (an expression referenced in all nine VALUES rows is evaluated nine times per
candidate).

| shape | C13b | C13c, no index | C13c, shipped |
|---|---:|---:|---:|
| single-entity probe (the consumer mapping's `EXISTS`) | 60 buffers | **63** | **63** |
| ranked scan (`role = ? order by rent limit 50`) | 39,968 | 50,861 (+27%) | **44,204 (+10.6%)** |

The probe is **+3** — one index probe; the `sfc` predicate pushes straight down, which is the
property §7.7's rewrite exists to protect. The ranked scan's +27% was entirely the `sfc` leg
reading 10,083 rows and fetching every heap tuple; **P118 corollary 2** applies (the aggregate is
already hoisted, so an index IS the fix) and **corollary 3** is why this partial index is reachable
(`sfc` states the index predicate verbatim). The leg alone goes **10,893 → 4,236** as an Index Only
Scan. Built non-concurrently, ~10k entries on a 70,540-row table.

**Wall-clock is not quoted as evidence** — it moved 748 → 349 ms across the same change on a box
where §7.7 already recorded 2–4× session variance.

---

## 10. Verify

```sql
-- the split, and that the count did not move
select role, evidence_arm, count(*) from v_lcc_entity_roles
where role = 'one_off_owner' group by 1,2;        -- 13 corroborated + 129 unverified = 142

-- ⚠️ if any OTHER arm moved, stop
select role, count(*) from v_lcc_entity_roles group by 1;
-- investor_owner 6447 / former_owner 3786 / developer 718 / repeat_buyer 385
-- one_off_owner 142 / buyer 124 / operator 29 / user_owner 10

-- the reviewed rows reached the surface, and did not leak into the user_owner lane
select ambiguity_kind, count(*) from v_lcc_entity_role_ambiguity group by 1;
select count(*) from v_lcc_user_owner_candidates;  -- 15, unchanged

-- the safety property
select count(*) from lcc_priority_queue_resolved where priority_band = 'P0.4';  -- 555

-- ⚠️ verify on the ARM POPULATIONS, never the row count — 11,641 rows would be
-- the same number if every entity carried one wrong label.
```

**Reverse:** `delete from lcc_entity_role_confirmation where role = 'one_off_owner' and
confirmed_by = 'c13c_named_review';` then re-apply
`20261005120000_lcc_c13b_entity_roles_multilabel.sql`; `drop index if exists
public.idx_extid_salesforce_contact_entity;`.

---

## 11. Filed, not started

- **C13f** — suppress the 21 reviewed rows from the `one_off_owner` arm (§3's tension). Needs a
  consumer-impact grade; the count assertion says not here.
- **C13g** — repair `entities.entity_type`. Floor 414 contradicting rows / $181.8M; hand-read
  estimate ~1,950 person-typed organizations. **The lexical instruments are refuted** (§6), so this
  needs a producer fix at the RCA/CoStar capture path (§7), not a sweep.
- **C13h** — reconcile vendor-captured parties into the contact hub, which is the only thing that
  moves the 9% corroboration ceiling (§8).
