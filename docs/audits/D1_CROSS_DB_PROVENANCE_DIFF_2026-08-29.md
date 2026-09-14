# D1 — the cross-database provenance producer-set diff (2026-08-29)

**Backlog:** `D1` (P0d) · **Contract:** `data-coherence-invariants.md` **I2** ·
**Playbook:** `DEAD_END_AUDIT_PLAYBOOK.md` **Class 20** · **Kind:** AUDIT + a STANDING DETECTOR.
**Nothing was built.** No feeder, no backfill, no migration. One detector, one ledger, one guard.

---

## 0. The result in one paragraph

The two domains are **substantially coherent**. Of **69 producer-set differences** across 23
two-sided fact stores, **58 are legitimate** and explained (federal registers gov-only, operator and
CMS sources dia-only, each domain's own master-workbook import rounds). **11 are not**: 5 unexplained
and 6 unwired, and **none is B5-sized** — the largest is 1,021 rows of broker market intelligence,
against B5's 2,776 ownership rows over 2,000 properties. **The bigger finding is structural and the
prompt did not anticipate it: 12 tables exist in both domains and record provenance in only one, so
the diff cannot be run on them at all** — including **dia `ownership_history` (10,037 rows), the very
store B5 was about.**

⚠️ **This is close to the outcome the prompt named as real and valuable** — the domains are already
mostly coherent, and the detector's value is preventing the next divergence rather than fixing a
current one. It is not *entirely* that: D1a/D1b are genuine, and the 12 un-diffable tables are a
precondition failure worth fixing. But **no second B5 is sitting here, and saying otherwise to
justify the query would be the manufactured finding the prompt warned against.**

---

## 1. ⚠️ The invariant was wrong, and sizing it is what found that

I2 said: *group the fact store by its provenance column, split by domain.* That needs a table with
**both** a domain column and a provenance column. On LCC Opps **exactly one has both —
`lcc_entity_portfolio_facts`, the very table that found B5.** The stated detector has a **population
of one** and cannot generalise; written as *the* detector it overstated its own reach.

The form that generalises is a **cross-database diff of parallel tables**, gov vs dia — which is how
B5 was actually found. I2 is corrected in place. The intra-table form is **kept, as the B5 positive
control** (§4), not as the general query.

---

## 2. What the catalogue actually looks like

Provenance-shaped columns: **gov 43 tables, dia 78**. Classified:

| class | n | meaning |
|---|---:|---|
| **provenance on BOTH sides** | **28** | diffable — the detector's population |
| **table exists, provenance on ONE side** | **12** | ⚠️ **cannot be diffed at all** — §3 |
| table absent on one side | 51 | domain-specific by construction |

Of the 28: **23 diffed**, 4 **out of scope by recorded decision** (§5), 1 excluded by the cardinality
guard, and 5 both-sides-empty (no signal).

⚠️ **A naive query breaks on the first pair it meets.** `properties` uses **`data_source` in gov and
`source` in dia**. The column is resolved per table from the catalogue, never hard-coded.

⚠️ **And resolving by NAME is not enough either.** gov `property_financials` carries *both*
`data_source` and `source`; **`source` is populated on 0 of 98,510 rows.** Name-order precedence
picks the dead column. The resolver keys on **population**.

---

## 3. ⚠️ The finding the prompt did not anticipate: 12 stores that cannot be diffed

A producer-set diff has a precondition — **the store must record its producer.** Twelve tables exist
in both domains and record it in only one:

| table | has provenance | the other side |
|---|---|---|
| **`ownership_history`** | gov (`data_source`) | **dia: 10,037 rows, no provenance column** |
| `recorded_owners` | dia (`source`) | gov: 17,242 rows, none |
| `available_listings` | dia (`data_source`) | gov: 3,131 rows, none |
| `entity_registry_records`, `llc_research_queue` | gov | dia: none |
| `lease_escalations`, `listing_price_history`, `cmbs_loans`, `property_embeddings`, `pending_updates`, `match_logs`, `research_queue_outcomes` | dia | gov: none |

**`ownership_history` is the one that matters.** B5 was a finding *about ownership history
provenance*, and **the dia side of that store cannot answer the question at all.** If dia's ownership
history acquires a feeder nobody wired on gov — or loses one — this detector is structurally blind to
it. That is not a hypothetical: it is the exact shape of the defect the detector exists to catch.

**Not fixed here.** Adding a provenance column to a live store is a schema change with its own
writer-audit and backfill, and bundling it into an audit is how a repair becomes indistinguishable
from the producer (P176). Filed as **D1g**.

---

## 4. Positive control — ⚠️ 2 of 3, and the third is out of reach

**A run that surfaces nothing is a bug signal, not a clean bill of health.** From a cold start:

| control | fires? | evidence |
|---|---|---|
| **B5** | ✅ | `lcc_entity_portfolio_facts`: dia `sales_transactions_seller_exit` **2,310 facts / 1,554 entities**, gov **absent** |
| **B6c-dup** | ✅ | dia `property_sale_events` carries producers `sales_transactions` (2,646) and `ownership_history` (52); gov carries **neither** |
| **B6b** | ❌ **structurally out of reach** | `gsa_lease_change_facts` has **no provenance column at all** (0 of the 7 candidate names) |

⚠️ **B6b was never findable by this detector and claiming three-for-three would be false.** B6b was
found by B6a's skipped-step / overdue-cadence instrument — a different detector answering a different
question (*did this producer stop?* rather than *does the sibling domain have this producer?*). The
three instruments are complements, and §6 keeps them distinct.

⚠️ **B5's control fires even though B5 SHIPPED.** gov's equivalent work landed under different labels
(`gov_ownership_chain` 1,399, `sales_transaction` 164), so the bucket names still differ. **A naive
reading would re-report B5 as open.** That is precisely why acknowledgement-with-a-reason is the
mechanism and not an afterthought: B5 is the archetypal *explained* difference.

---

## 5. The triage

Every difference carries a verdict — **legitimate / unexplained / unwired** — and a **reason**, in
`scripts/d1-provenance-acknowledgements.json`. **69 entries: 58 legitimate, 5 unexplained, 6 unwired.**

**Ranked, deflated. Nothing here is B5-sized.**

| # | difference | raw | ⚠️ deflated value |
|---|---|---|---|
| **D1a'** | **buyer/seller sale-role contacts are never persisted — in EITHER domain** | dia parser reports a buyer contact on **540 of 942** captures, a seller on 549; gov 85/95 of 1,028. **Rows written: 0 and 0.** | **Highest raw value here — these are PRINCIPALS, the account-doctrine's actual target.** ⚠️ **But this is Class 2 (a producer with no consumer), NOT D1's class** — it is symmetric, so the cross-domain diff did not find it; reading the rows behind D1a did. Ceiling only: the `hasPii` gate and `validateContactIngest` drop an unmeasured fraction. |
| **D1a** | `contacts.costar_sale_contacts` — gov **1,021**, dia **0** | dia has 46 sale-linked contacts, stamped `costar_sidebar` instead | ⚠️ **Every row on both sides is a BROKER** (gov 1,187 `broker_listing` + 264 `broker_buyer`; **zero** buyer, **zero** seller). Per the account-based-contact-intelligence doctrine **brokers are never prospected as principals** — so this is **Tier-4 market intelligence, not a BD contact gap.** Code is domain-agnostic and dia's schema accepts the payload, so neither explains it. |
| **D1b** | `leases.email_intake` — dia **285**, gov **0 of 17,668** | gov *does* receive OM intake (224 properties, 369 contacts) | The intake arrives and only the **lease half** never lands. **Unsized:** how many gov OMs carry lease terms was not measured. |
| **D1c** | `property_sale_events` from `ownership_history` — dia 52, gov 0 | gov holds 18,969 ownership_history rows to dia's 10,037 | Same *shape* as B5, ~2% of the size. |
| **D1d** | `county_deed` → sales/PSE — gov 19 / 4, dia 0 | dia has `deed_records` and a `deed_extraction` producer | Small; completeness only. |
| **D1e** | `listing_status_history.sale_imported` — dia 31, gov 0 | — | ⚠️ **Lowest value and stated as such.** gov is **not** mishandling the close: 2,081 of 3,131 gov listings carry `sale_transaction_id`. What is missing is the **ledger of the transition**, not the transition. Buys auditability, not correctness. |
| **D1f** | `provenance_event_log.sf_account_contact_expansion` — gov 131, dia 0 | — | Small; completeness only. |

**Unexplained, sub-threshold but tracked** (acknowledged so they cannot grow unnoticed): gov
`properties.unknown_writer` **225** — a provenance value that literally means *unknown*, which defeats
every downstream provenance question; gov `contacts.comms_observed` 2; dia
`true_owners.h3_canonical_resolver` 4; dia `sales_transactions.salesforce_deal` 1.

**Legitimate, the pattern:** federal/state registers gov-only (`sam` 509, `tfc_state_inventory`
596/973/784, FRPP, `gsa_lease_diff` stubs 2,940); operator/CMS sources dia-only (`davita_subledger`
3,145, `auto_stub_from_clinic`); and each domain's own master-workbook import rounds.

⚠️ **Row-count disparity is not the signal, and `property_financials` is the case in point** —
**98,510 gov vs 676 dia**, entirely legitimate: dia's economics are reconciled in
`clinic_econ_reconciled`, a second store by design.

---

## 6. The detector, and the three design constraints the data forced

`scripts/d1-cross-db-provenance-diff.mjs` (I/O) over `api/_shared/provenance-diff-planner.js` (pure).
**Re-run cadence: MONTHLY**, plus on adding any ingestion source or domain database. Monthly because a
producer set only changes when someone ships a feeder — nightly would produce an unread report.
Exit 0 = nothing new; **exit 1 = a NEW, unacknowledged difference**; exit 2 = no credentials.

1. ⚠️ **Split the value before grouping.** `county_deed:<uuid>` and `gov_master_backfill_r71|h=<hash>`
   are one producer each; grouping raw drowns the diff in one-row buckets.
2. ⚠️ **A provenance column can hold a DATA VALUE.** gov `entity_match_candidates.source_name` holds
   **1,276 distinct entity names**. Caught by a cardinality guard — which **reports the cardinality
   with the exclusion**, never drops it silently.
3. ⚠️ **And the cardinality guard is NOT sufficient.** `ingestion_tracker.source` holds script names,
   dataset filenames **and temp paths** (`/tmp/tmpuab4ll9g.json`) across ~41 buckets — a data value at
   *modest* cardinality. Excluding such a table by a **name pattern** is how a detector starts
   returning comfortable zeros (P182), so each is named in an **out-of-scope list with a reason**, and
   **still emitted and counted**. Four tables: `ingestion_tracker`, `ingestion_log`,
   `lcc_health_alerts`, `entity_match_candidates`.

**Acknowledgement is not silencing.** `legitimate` silences a row; `unexplained`/`unwired` keep it
**rendering** as known and tracked. Every entry — and every synonym, and every out-of-scope decision —
**requires a non-empty reason**; the detector rejects entries missing one. That is the guard against
the failure B6d fixed one layer up: *a monitor that reports 40 legitimate differences every run is
noise and will be ignored within a month.*

⚠️ **Vocabulary drift is folded by SYNONYM, not by verdict** — `om_extraction` (gov) vs `om_intake`
(dia) is one pipeline; `connectivity4_` vs `connectivity2_recorded_resolution` is one resolver with
each domain's round number. **Only two groups qualified, and restraint was the right call: dia carries
BOTH `costar_import` (2,832) and `costar_sidebar` (596) on leases, so those are genuinely different
CoStar routes — folding them would have hidden a real difference.**

⚠️ **The ledger-completeness gate caught 5 differences I had missed by eye** (gov
`properties.costar_sidebar`, `costar_export` ×2, dia `property_sale_events.costar_sidebar`, gov
`rca_sidebar_manual_bootstrap`). **Verifying the ledger against the measured population, rather than
assuming it complete, is what made it complete.**

---

## 7. ⚠️ Honest limits

- **The script has never been executed.** The sandbox holds no domain credentials
  (`GOV_/DIA_SUPABASE_*` are unset), so **every number here was measured through the Supabase MCP
  seam, and the runner's I/O path — `.env.local`, the `exec_sql` seam, the catalogue query — is
  unexercised.** The pure logic is fully tested and was run against the real measured rows; the
  transport is not. **First credentialed run is an operator step.**
- **Not a cron.** Wiring it to a schedule before it has run green once would ship the badge people
  learn to merge past — the rule this repo already paid for. Filed as **D1h**.
- **Scope is gov ↔ dia.** LCC Opps is a third population where only `lcc_entity_portfolio_facts`
  supports the intra-table form; that is stated, not reported as a comfortable zero.
- **D1a and D1b are surfaced, not root-caused**, by design — sized for a follow-up prompt to act on
  without re-measuring.

## 8. Verify

```bash
node --test test/d1-cross-db-provenance-diff.test.mjs     # 18 tests
node scripts/d1-cross-db-provenance-diff.mjs --positive-control
```
Read **`unacknowledged`** (must be 0) and **the positive control (must FIRE)**. Never read
`differences_total` — 69 is the healthy steady state, and it will grow as legitimate
domain-specific sources are added.
