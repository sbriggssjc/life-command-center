# C2e-T2a — tranche two, step one: owner rent ≥ $100k (2026-08-28)

**APPLIED to production. gov only; no dia asset was minted.**
Batch `c2e_gov_eligible_t2a_20260828` (mint) + `c2e_t2a_evidence_20260828` (evidence).
Reversible by batch tag — runbook in §7.

Predecessors: [`C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md`](C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md) §6
(the analysis this implements) · [`C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md`](C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md)
Canonical state: `docs/architecture/connectivity-and-open-threads.md` §4f–§4k.

---

## 1. Headline

| | before | after | delta |
|---|---:|---:|---:|
| **gov asset anchors** | 5,425 | **7,995** | +2,570 |
| asset anchors, both domains | 7,147 | **9,717** | +2,570 |
| **gov asset coverage** (of 13,837 non-archived) | 39.2% | **57.8%** | +18.6 pts |
| `lcc_property_owner` rows | 6,065 | **8,636** | +2,571 |
| distinct resolved owner entities | 3,743 | **5,992** | +2,249 |
| `lcc_property_owner_evidence` rows | 12,479 | **15,050** | +2,571 |
| live entities | 64,304 | **66,874** | +2,570 (+4.00%) |
| plan view remaining | 4,811 | **2,241** | −2,570 |

**The eligible-set promise holds: 2,570 minted · 2,570 resolved an owner · 0 evidence-less ·
0 orphan entities.** `skipped` was 0, and the function's tally agrees with the row-count delta.

Population reproduced C2e §6 exactly before anything was written: 2,570 properties / 2,300 owners /
**396 already contactable (17.2%)** — indistinguishable from tranche one's 21.3%. The slice is
contiguous with tranche one: its top owner rent is **$543,718** against tranche one's cut at
**$543,782**.

---

## 2. ⚠️ The prediction was +44 and the answer was +46 — and the 2-row gap is the finding

`v_duplicate_candidates` **8,160 → 8,206 (+46)**. Predicted **+44** before the write
(10 new groups from existing singletons + 34 forming only within the batch).

**The gap is not noise. `lcc_mint_gov_asset_entities` passes
`lcc_normalize_entity_name(m.name)` as `canonical_name`, and the N15c `BEFORE INSERT` trigger
overwrites it with `lcc_entity_canonical_key(name)`.** Measured on the batch: all 2,570 rows carry
the **trigger's** key, and only **2,497 (97.2%)** equal what the function passed — the trigger
silently overrode 73 rows. Re-running the same prediction against the key actually written gives
**12 + 34 = 46**, matching exactly.

- **This is the trigger working, exactly as N15c intended** — one writer for the dedup key. The
  argument inside the mint function is now **dead code that reads like the answer**, which is
  precisely why it produced a wrong prediction: anyone reading the mint function will derive the
  wrong canonical key.
- **The durable rule: predict a canonical-key effect with the key the WRITER actually persists, not
  the one the calling function passes.** Where a `BEFORE` trigger owns a derived column, the
  caller's argument is a suggestion. (Same family as the P182/P157 traps — the stored value is not
  the value you wrote.)
- Filed as **N15g**: remove the now-inert `lcc_normalize_entity_name` argument from
  `lcc_mint_gov_asset_entities` (cosmetic, not urgent — the trigger is authoritative either way).

---

## 3. The merge surfaces did not move, and the claim is ATTRIBUTED

| surface | before (22:24:52Z) | after (22:32:33Z) |
|---|---:|---:|
| `v_lcc_merge_candidates` | 5,194 | **5,194** |
| `auto_mergeable` | 3,006 | **3,006** |
| `v_lcc_merge_candidates_normalizer_blind` | 64 | **64** |
| `v_lcc_canonical_name_drift` | 0 | **0** |

Structural, as C2e established: those views filter `entity_type = 'organization'` and a minted asset
is `entity_type = 'asset'`.

⚠️ **`merges_since_baseline = 0`** — checked against `lcc_entity_merge_log` (130 rows, newest
13:27:16Z, i.e. nine hours before this work). Per §4i.5, "the gate did not move" is only meaningful
with a timestamp and an attribution; the other Cowork thread was quiet during this window, so the
zero is genuinely this batch's.

**Drift detector positive-controlled both before and after**: real drift 0 against **64,304**
(pre) / all live rows under a deliberately wrong key. The zero is a reading, not a blind detector.

---

## 4. ⚠️ Tier 0 moved by +4, not the predicted ~+20 — and every card is attributed

| band | before | after | of which on a T2a-resolved owner |
|---|---:|---:|---:|
| **`auto`** | 9 | **9** | **0** |
| `ask` | 91 | 92 | **1** |
| `parked_domain_only` | 155 | 158 | **3** |
| lane `_open` | 100 | 101 | — |

**The safety statement is exact: the `auto` band — the only one that can trigger an unattended
write — did not grow, and zero `auto` cards sit on any owner T2a made resolvable.** The `ask` +1 and
`parked` +3 are precisely the 1 and 3 cards on T2a owners; nothing else moved.

**C2e predicted ~+20 Tier 0 cards and the answer was +4.** That is a real population signal, not a
miss: Tier 0 needs a person we already hold whose email domain matches the owner's name, and this
slice is far less known to us — **160 of 2,300 owners (7.0%) carry a second identity**, against
tranche one's 12.9%. Resolving an owner only makes "who do we call there" *askable*; it does not
manufacture a bench.

---

## 5. The evidence drive, and the 7 rows that remain

Driven explicitly, as required — **cron 225 caps at 400/run**, so on the schedule alone 2,570
entities would have sat matching the retire predicate for most of a week.

`lcc_ingest_domain_owner_evidence(false, 3000, 'c2e_t2a_evidence_20260828')` →
`evidence_written 2578`, `assets_resolved 2571`, `ambiguous_logged 1`.

⚠️ **`evidence_written` is a write counter, not a row-count delta** — the table grew by **2,571**.
The 7-row difference is idempotent re-writes onto rows cron 225 already held, and it lines up
exactly with the 7 candidates still reading `eligible`:

**All 7 residuals are brokerages** — `Stan Johnson Co` ×4, `SVN®`, `NAI Pfefferle`,
`Bradford Allen Realty Services`; `lcc_owner_name_is_brokerage` returns true on every one. They clear
the candidate view and score zero at reconcile, because `lcc_reconcile_property_owner` filters
brokerages *inside* its scoring CTE. **That is the sixth guard working, permanently, on 7 rows that
will never resolve — not a T2a defect and not a backlog to close.**

**dia:** 3 of the 7 residuals are gov (the same 3 C2e left) and 4 are dia. The function takes no
domain argument, so **1 dia property gained a resolved owner** — work cron 225 would have done at
its next run. **No dia asset entity was minted; dia is otherwise untouched.**

Owner arithmetic reconciles to the row: 3,743 + (2,300 − 52 already resolved elsewhere) + 1 dia
owner = **5,992**.

---

## 6. 👤 T2b — sized live with the corrected method; still Scott's call

**2,241 properties / 2,054 owners** remain in `v_lcc_c2e_asset_mint_plan`
(803 owners under $50k · 715 at $50–100k · 536 rent-unknown).

| | tranche one | **T2a (actual)** | **T2b (predicted)** |
|---|---:|---:|---:|
| properties | 2,000 | 2,570 | 2,241 |
| owners | 1,145 | 2,300 | 2,054 |
| already contactable | 21.3% | **17.2%** | **3.7%** (76) |
| known beyond gov | 12.9% | 7.0% | **1.9%** (38) |
| new duplicate groups | +20 (1.00%) | **+46 (1.79%)** | **+26 (1.16%)** |
| Tier 0 cards | +23 | **+4** | fewer still |
| `auto_mergeable` | 0 | **0** | 0 (structural) |

**What T2a's outcome implies for T2b — the two axes moved in opposite directions.**

1. **The graph cost is now measured twice and is not the issue.** T2a ran *hotter* than C2e
   predicted on duplicates (1.79% vs 1.50%) and far *colder* on Tier 0 (+4 vs ~+20). **T2b's
   predicted duplicate rate (1.16%) is LOWER than T2a's actual** — computed with the corrected key
   against the live post-T2a graph, not extrapolated. There is no cliff, and C2e's finding that the
   floor's stated purpose was largely not real now holds across 4,570 minted entities.
2. **The owner cliff is real and it arrived exactly where C2a said.** Contactability
   21.3% → 17.2% → **3.7%** is the collapse, and it is a *prospect-quality* fact, not a technical
   one. These owners are dominated by cities, counties, state DOTs, corporate occupiers and private
   individuals.

**Recommendation: T2b is safe to run and low-value to run.** Nothing measured argues against it on
graph grounds — it is cheaper than the tranche just completed. The decision rests entirely on
whether Scott wants *"resolve all ownership, rank later"* applied to a population that is ~96%
un-contactable today, against `v_priority_queue`'s job being to rank. **Not run. No default taken.**

⚠️ **Whatever is decided, drive the evidence ingest in the same pass** (cron 225's 400/run cap).

⚠️ **Public-body counts remain LOWER BOUNDS.** `lcc_looks_like_person` returns true for
`CITY OF SALEM` and `BROOME COUNTY` (A3/P196). A pattern match over T2a's owners gives 182 of 2,300
(7.9%) as a public-body floor; the `lcc_looks_like_person` reading of 618 is a *different and
broader* measure and the two must not be quoted interchangeably. **No second name classifier was
written** — deliberately (normaliser drift).

---

## 7. Reversal

Batch-tagged. **Identities before entities** (P141):

```sql
delete from lcc_property_owner          where entity_id in (select id from entities where metadata->>'mint_batch'='c2e_gov_eligible_t2a_20260828');
delete from lcc_property_owner_evidence where entity_id in (select id from entities where metadata->>'mint_batch'='c2e_gov_eligible_t2a_20260828');
delete from external_identities         where metadata->>'mint_batch'='c2e_gov_eligible_t2a_20260828';
delete from entities                    where metadata->>'mint_batch'='c2e_gov_eligible_t2a_20260828';
```

Every row carries an honest `metadata.minted_because`: *"the gov true_owner resolves ID-to-ID to a
live LCC entity on this same pass (C2e eligible set); tranche 2a, owner gov portfolio rent >= $100k
per connectivity-and-open-threads.md 4i.4"* — true on both clauses, via the `p_reason` caller
argument migration `20260828140100` added for exactly this.

⚠️ The 1 dia owner resolution is **not** covered by that reversal (it carries no T2a mint batch on
its entity). It is legitimate cron-225 work and should be left alone.

---

## 8. What was NOT measured

- **Whether a resolved owner converts to a call.** "Already has an active contact" is a
  reachability proxy, not evidence of conversion. Unchanged from C2a/C2e.
- **Search and UI cost.** Entity count is now **+7.2% over the pre-C2e graph** (62,356 → 66,874);
  the SPA's search and count tiles were not exercised.
- **The 3,362 gov properties with no `true_owner_id`** — still the largest remaining lever, still a
  gov-side capture question (**C2f**). Untouched.
- **T2b.** Sized, not run.
- **dia.** 84% operator-blocked (P113); its levers are `is_operator_not_owner` and rent coverage
  (A5e), not a floor.
