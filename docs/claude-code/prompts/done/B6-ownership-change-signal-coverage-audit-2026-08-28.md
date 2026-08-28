# B6 — every signal that reports a change of OWNER or LESSEE, and whether anything consumes it

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6`.
**Kind:** **AUDIT + DESIGN. Build nothing in this prompt** beyond read-only views needed to measure.
**Parent:** B5 (`B5-gov-seller-exit-ownership-feeder-2026-08-28.md`) — B6 is the systematic sweep
that B5 is one instance of. **Playbook class:** `DEAD_END_AUDIT_PLAYBOOK.md` **Class 20**.

---

## 0. Scott's framing (2026-08-28), which is the spec

> *"On ownership history being fed by sales transactions or change in the leased inventory over
> time, we have various places that a change in ownership or lessee will be reported that we need
> to ensure is working to feed transaction history (comps) and ownership history to ensure we are
> getting to 100% coverage. GSA reports lease inventory as well as all the SAM.gov data or other
> public records that we should be working — together or against each other over time — to generate
> these changes and direct next action. Dialysis as well. We want the LCC app and code processes
> designed to drive and propel forward all these elements together and against each other."*

**Three requirements, and they are separable:**

1. **COVERAGE** — every source that can report an owner/lessee change reaches BOTH stores it should:
   **transaction history (comps)** and **ownership history**.
2. **CORROBORATION** — sources are read *against* each other over time. Two independent sources
   agreeing is stronger evidence than either alone; **disagreeing is a finding, not a tie to break
   silently.**
3. **NEXT ACTION** — a detected change drives a next step (a BD signal, a comp, a call), not just
   a row.

---

## 1. What I already measured — start from here, do not re-derive

**B5's finding (the instance):** gov never consumed its own `sales_transactions` as ownership
history. 9,514 named sellers / 4,697 dated properties, **1.8% consumed**, ~3,080 net-new rows.
dia does exactly this via `sales_transactions_seller_exit`.

**Two more, measured 2026-08-28, both unconsumed:**

**(a) `gov.gsa_lease_change_facts` — 336,303 rows, and it carries a landlord-change signal
spanning THIRTEEN YEARS.**

| measure | value |
|---|---:|
| rows with `landlord_change_flag` | **38,213** |
| distinct leases affected | **8,845** |
| carrying BOTH `lessor_name_old` and `lessor_name_new` | **38,055** |
| snapshot range | **2013-02-01 → 2026-02-01** |
| what `ownership_history` holds from `gsa_lease_diff` | **6,648 rows / 3,704 properties** |

**(b) `gov.property_sale_events` — 5,208 rows carrying `ownership_history_id` AND
`sales_transaction_id` columns. BOTH are populated on ZERO rows.** The table that exists to *join
comps to ownership history* has never linked a single row to either. **That is the connective
tissue Scott is describing, already modelled and never wired.**

⚠️ **38,213 is a RAW SIGNAL, not 38,213 conveyances, and you must deflate it before quoting it.**
Three known inflators, all already documented and all present here:

- **flicker with a return leg** — `gsa_lease_diff` emits an "acquisition" every time the GSA lessor
  field flickers between an SPE and its parent (P138, `is_oscillating_pair`). The DATE is real, the
  DIRECTION is not.
- **per-lease fan-out** — a building carries many leases and the lessor of record updates on each
  separately, so ONE conveyance emits one row per lease (A2b: property 3123, 8 rows across 8 leases).
  **This table is keyed on `lease_number`, so it is maximally exposed to it.**
- **name variants** — a re-spelling of the same lessor is not a change of landlord.

**`leases_affected = 8,845` is closer to the truth than 38,213, and properties will be fewer still.**
Report the deflated number and show the deflation.

---

## 2. The deliverable — a signal → consumer matrix

**Enumerate every source, in BOTH domains, that can report a change of owner or lessee.** For each,
answer these seven columns. **An empty cell is a finding; say so rather than leaving it blank.**

| column | question |
|---|---|
| **signal** | table/feed and what a "change" looks like in it |
| **volume** | raw rows · deflated events · distinct properties · date range |
| **→ ownership history** | does it reach `ownership_history` / `lcc_entity_portfolio_facts`? via what? what %? |
| **→ transaction history (comps)** | does it reach `sales_transactions` / the comps surface? what %? |
| **standing or one-shot** | is there a cron/handler, or was it a backfill? (**Class 8**) |
| **corroborates / contradicts** | which other signals cover the same event, and what happens today when they disagree |
| **next action** | does a detected change produce a BD signal, cadence, comp, or queue row — or nothing? |

**Candidate sources — this list is a STARTING POINT, not a boundary. Enumerate from the schema.**

- **gov:** `gsa_lease_change_facts` (336k) · `gsa_lease_events` (234k) ·
  `gsa_inventory_snapshot_lines` (1.11M) / `gsa_snapshots` (1.19M) · `gsa_lease_timeline` (16k) ·
  `gsa_leases` · `leases` · `federal_lease_awards` (9,968) · `sam_lease_opportunities` (6,451) ·
  `sam_entities` (281) · `state_lease_snapshots` (4,482) / `state_lease_events` (577) ·
  `sales_transactions` (15k) · `property_sale_events` (5,208) · `deed_records` (5,744) ·
  `parcel_owner_xref` (9,409) · `broker_transactions` (2,634) · `recorded_owners` ·
  `available_listings` / `listing_verification_history` (6,823) · `ownership_research_queue` (17,665)
- **dia:** `sales_transactions` · the seller-exit feeder · `true_owners` · CMS/`medicare_clinics`
  operator changes · `available_listings` · the CoStar sidebar capture path
- **LCC-side:** `lcc_listing_events` · `external_identities` · the intake/OM channel

⚠️ **`ownership_research_queue` at 17,665 rows is itself suspect** — check whether it has a consumer
before treating it as a source (**Class 2**), and check whether its open count equals a query window
(**Class 18**, the A5 defect).

---

## 3. Rules for the audit itself

**3a. Do NOT date a feeder off `updated_at` on an upserted table.**
`lcc_entity_portfolio_facts` has **no creation timestamp**, and the nightly
`lcc_finalize_entity_portfolios` re-upsert touches **11,828 of 14,076 rows every day** — so every
source reads "written today." I made this exact mistake and caught it only by checking whether
*everything* read today. **Find producers in CODE.**

**3b. The detector for a missing feeder is a provenance `group by`, split by domain** (Class 20).
A source bucket present for one domain and absent for another IS the finding. It needs no
hypothesis. **A missing feeder produces no error, no zero row and no queue — there is nothing to
audit but the absence itself.**

**3c. Quote the ANTI-JOINED count.** Raw source volume is meaningless; what matters is what the
consumer does not already record. And **report coverage and depth as two numbers** — B1 moved
`any_history` +901 and `chain_2plus` +28.

**3d. Positive-control every zero** (P182). `se_linked_to_ownership = 0` above is believable only
because the columns exist and other tables link fine. An implausibly clean result is a bug signal.

**3e. Corroboration is a DESIGN question, and the doctrine already exists — do not invent a second
one.** `field_source_priority` (lower = more trusted), the supersession tiers, and
`lcc_property_owner_evidence` already model "several sources, one truth." **Say where each new
signal lands on the existing ladder and why.** A GSA lessor-of-record change and a recorded deed
are different KINDS of claim: one is *who the government pays*, the other is *who holds title* —
and in a ground lease or an SPE structure **both can be right at once** (Scott, on Sunflower:
a ground lease splits fee from leasehold and the leasehold SPE is a genuine owner). **A
contradiction goes to a review lane, never to a silent winner.**

**3f. "100% coverage" is the goal for CONSUMPTION, not for certainty.** Every source that reports a
change should reach a store or be explicitly declined with a reason. **Some events will remain
unknowable** — say which, rather than closing the gap with a guess. Never fabricate.

**3g. Rank the findings by what they would move**, with the deflators applied, and flag anything
where the honest answer is *"do not build this"* — A3, P196, P198 and C1 all ended that way.

---

## 4. Output

`docs/audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md` — the matrix, the ranked gaps with
deflated sizing, and a proposed **signal → evidence → store → next-action** architecture that reuses
the existing apply path and authority ladder rather than adding a parallel one.

Fold the conclusions into `docs/architecture/connectivity-and-open-threads.md` (the canonical
connectivity map), add backlog rows for each actionable gap, and write a STATUS entry.
**Do not build the feeders here** — B5 is already in flight and its result should inform the shape.
