# D1 — the cross-database provenance diff: find the next B5 before it costs two months

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `D1` (P0d).
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I2**.
**Playbook:** `DEAD_END_AUDIT_PLAYBOOK.md` **Class 20**.
**Kind:** **AUDIT + a STANDING DETECTOR.** Builds no feeder; ships the query that finds them.

---

## 0. Why this one

**B5 was found by a single `group by` on a provenance column** — gov had never consumed its own
`sales_transactions` as ownership history, while dia derived 2,207 of its 2,757 historical facts
from exactly that source. That one query was worth **+2,776 ownership rows across 2,000 properties,
677 of which had no history at all.**

**It was found by accident.** D1 makes it a standing check. **A missing feeder has no representation
anywhere** — no error, no zero row, no queue — so it is the one class in this repo that only a
deliberate diff can find.

---

## 1. ⚠️ My original D1 spec was WRONG, and the measurement corrected it

`data-coherence-invariants.md` **I2** says: *group the fact store by its provenance column, split by
domain.* **Measured 2026-08-29: on LCC Opps, exactly ONE table has both a domain column and a
provenance column — `lcc_entity_portfolio_facts`, the very table that found B5.** So the
intra-table version of this detector has a population of one and cannot generalise.

**The real detector is a CROSS-DATABASE diff of PARALLEL tables** — gov vs dia — which is how B5 was
actually found and how B6c found dia's `property_sale_events` differs from gov's.

**The parallel pairs, measured (est. rows, provenance column):**

| table | gov | dia | ⚠️ note |
|---|---:|---:|---|
| `property_financials` | **98,510** (`data_source`,`source`) | **676** (`source`) | ⚠️ **145× disparity — explain it** |
| `properties` | 20,495 (`data_source`) | 11,797 (**`source`**) | 🚨 **the provenance column is NAMED DIFFERENTLY** |
| `ownership_history` | 18,953 (`data_source`) | — | check dia's equivalent |
| `leases` | 17,650 (`data_source`) | 12,828 (`data_source`) | |
| `true_owners` | 16,224 (`source`) | 7,105 (`source`) | |
| `contacts` | 15,803 (`data_source`) | 6,005 (`data_source`) | |
| `sales_transactions` | 15,111 (`data_source`) | 4,783 (`data_source`) | **B5's table** |
| `property_sale_events` | 5,215 (`source`) | 2,734 (`source`) | B6c/B6c-dup |
| `property_documents` | 1,177 (`source`) | 1,378 (`source`) | |
| `loans` | 1,504 (`data_source`) | 655 (`data_source`) | |
| `recorded_owners` | — | 7,255 (`source`) | present on one side only |
| `available_listings` | — | 5,334 (`data_source`) | present on one side only |

⚠️ **`properties` alone proves a naive query cannot work:** gov uses `data_source`, dia uses
`source`. **Resolve the provenance column per table from the catalogue; never hard-code it.**

---

## 2. What to do

1. **Enumerate the parallel pairs from the catalogue**, resolving each side's provenance column by
   name. Include tables present on only ONE side — **that absence is itself a finding to explain.**
2. **For each pair, diff the producer SETS** — the distinct provenance values and their row/subject
   counts on each side. **A bucket present for one domain and absent for the other is the finding.**
3. **Triage every difference into one of three verdicts, and say which:**
   - **LEGITIMATE** — the domain genuinely lacks that source (dia has no GSA lease inventory; gov's
     tenant is a federal agency, so no operator-in-the-owner-slot).
   - **UNEXPLAINED** — needs a look. *This is the B5 bucket.*
   - **UNWIRED** — a source one side consumes and the other could but does not.
4. **Rank the UNWIRED/UNEXPLAINED by what they would move**, deflated. **Do not build any feeder in
   this prompt.**
5. **Ship the query as a standing detector** with a stated re-run cadence.

---

## 3. ⚠️ Rules

**3a. A DIFFERENCE IS NOT A DEFECT, and the surface must let one be marked explained.** The
invariant already says so. **A detector that reports 40 legitimate differences every run is noise
and will be ignored within a month** — which is the exact failure B6d just fixed one layer up. Give
it an acknowledgement mechanism, and **record the reason**, not just the acknowledgement.

**3b. Row-count disparity is NOT the signal — the producer SET is.** `property_financials` at
98,510 vs 676 may be entirely legitimate (gov tracks per-lease financials; dia does not). **Diff the
distinct sources, not the volumes.** Report volume only as context.

**3c. Split the provenance value before grouping.** Several carry a suffix —
`county_deed:<uuid>`, `gov_master_backfill_r71|h=<hash>` — so a raw `group by` yields thousands of
one-row buckets. `split_part(col, ':', 1)` / `split_part(col, '|', 1)` is what the working detector
used.

**3d. ⚠️ Do NOT re-open settled findings.** `sales_transactions` (B5 ✅ shipped),
`property_sale_events` (B6c/B6c-dup ✅), `gsa_lease_change_facts` (B6b ✅). **Confirm the detector
FINDS them — that is your positive control (P182) — then move on.** ⚠️ **A run that surfaces nothing
is a bug signal, not a clean bill of health.**

**3e. This is the third detector in this family; keep them distinct.** **I2/D1** asks *does the
other domain have this producer at all*. **I3/D2** asks *can this link column hold its target's
key*. **B6c-orphan** asks *does the key it holds still exist*. **Cite the sibling, do not merge
them.**

**3f. LCC Opps is a THIRD population and mostly out of scope.** Only
`lcc_entity_portfolio_facts` supports the intra-table form (§1). **Say so rather than reporting a
comfortable zero** — D2's sweep already recorded that LCC Opps' zero was **bounded, not clean**
(151 of 559 `_id` columns examined).

---

## 4. Verification

- **The detector re-finds B5, B6c and B6b** from a cold start (positive control).
- **Every difference carries a verdict** — legitimate / unexplained / unwired — **with a reason.**
- **The unwired candidates are ranked and DEFLATED**, and the top one is sized well enough that a
  follow-up prompt could act on it without re-measuring.
- **Nothing was built.** No feeder, no backfill.
- **A re-run cadence is stated**, and the surface can be acknowledged without being silenced.
- Guards mutation-verified RED, comments stripped before matching.

## 5. Deliverable

`docs/audits/D1_CROSS_DB_PROVENANCE_DIFF_2026-08-29.md`, plus the **BUILD-TURN-PROTOCOL closing
checklist**: `PLANNED-BACKLOG.md` (D1, and a row per unwired candidate),
`data-coherence-invariants.md` **I2** — ⚠️ **its detector row and its stated query both need
correcting per §1; the intra-table form has a population of one** — `DEAD_END_AUDIT_PLAYBOOK.md`
Class 20, and a STATUS entry.

⚠️ **If the honest answer is that every difference is legitimate, that is a real and valuable
result — say it plainly.** It would mean the two domains are already coherent, and the detector's
value is then *preventing the next divergence* rather than finding a current one. **Do not
manufacture a finding to justify the query.**
