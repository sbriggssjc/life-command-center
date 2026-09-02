# PR5 — the 39 registered ladder sources that have never written a field

**2026-09-02 · LCC Opps `xengecqvemvfknjvbvrq` · diagnosis-heavy, one registration.**
Migration `supabase/migrations/20261009120000_lcc_pr5_ladder_source_triage.sql` (applied live).
Guard `test/pr5-ladder-source-triage.test.mjs` (13 tests, **15/15 mutations RED**).
Operator check `scripts/check-field-source-priority-columns.mjs`.

---

## 0. The headline number is real and it is not a defect count

Keyed on `v_field_provenance_effective_source` (i.e. after PR8 recovered relabelled names):

| | before | after |
|---|---:|---:|
| registered **sources** (distinct) | 68 | **68** |
| registered **rungs** | 2,140 | **2,141** |
| never written | 39 | **39** |
| write-but-unregistered (source grain) | 21 | **21** |
| `v_field_provenance_unranked` (field grain, 30d) | 30 | **29** |
| rungs carrying a PR5 verdict | 0 | **426** |
| rungs marked `PR7:orphan_column` | 0 | **49** |

⚠️ **The registered-source count does NOT move, and getting that wrong is this audit's own
mistake, caught on review.** `costar_sidebar` was already a registered source with 73 rungs, so
adding a 74th changes the RUNG count and not the SOURCE count — the exact source-grain-vs-field-grain
confusion §3 is about, committed by the person writing §3. **State which grain a count is on.**

`never_written` staying at 39 is the **expected** result, not a failure: no rung was deleted,
and the count only moves when a producer actually runs. `write_but_unregistered` staying at 21 is
also expected — see §3, where the brief's prediction was wrong for a structural reason.

**Of the 39, only 14 are rungs nothing will ever exercise.** The rest split into six other causes
that all read as the same zero:

| verdict | sources | rungs | what it means |
|---|---:|---:|---|
| `build_pending` | 9 | 209 | a producer is planned, gated, or has never fired |
| `refused_by_decision` | 1 | 93 | `county_records` — PR1/PR8 refused it on measurement |
| `retire` | **14** | 42 | no writer anywhere, or the string is a different vocabulary |
| `writer_live_zero_rows` | 6 | 30 | a correct `lcc_merge_field` call site exists and has produced nothing |
| `exercised_elsewhere` | 7 | 11 | **the source is live — on a second ladder** |
| `retired_by_decision` | 1 | 9 | `gliner_extract` — demoted on measurement, rung kept on purpose |
| `keep_structural` | 1 | 6 | `domain_trigger` — by design never the effective source |

Every verdict, with its evidence, is written into `field_source_priority.notes` and surfaced on
**`v_field_source_priority_triage`**. The evidence is in the database now, not only in this file.

---

## 1. 🚨 The biggest finding inverts the question: seven of the "never written" are live

Six of the 39 — `manual`, `rel_purchase`, `rel_owns`, `sf_seller`, `domain_true_owner`,
`gov_ownership_transition` — are the **property-owner authority ladder** on
`lcc.lcc_property_owner`, documented in `CLAUDE.md` under *Property-owner feeders*. Measured:

| source | rows in `lcc_property_owner_evidence` | last write |
|---|---:|---|
| `rel_purchase` | 5,667 | 2026-08-17 |
| `domain_true_owner` | 5,402 | **2026-09-02 — today** |
| `rel_owns` | 2,459 | 2026-07-31 |
| `gov_ownership_transition` | 1,484 | 2026-08-19 |
| `sf_seller` | 32 | 2026-07-31 |
| `manual` | 8 | 2026-07-31 |

**15,052 rows.** They are not unexercised — they are scored by `lcc_reconcile_property_owner`,
which has never emitted a `field_provenance` row. The seventh, `property_sale_events`, is the same
shape one database over: B6c-dup's `trg_gov_pse_propagate_to_sale` records into **gov's own**
`field_value_provenance`.

> **⚠️ A "never written" detector keyed on ONE ledger reports a second ledger's entire population
> as absent.** This is PR10 ("one source, two ladders") at seven times the size, and it is the same
> shape as P197, where a consumer reading one employer column reported "not on file" for people
> whose employer was on file in three other places. **Before recording that a source has never
> written, enumerate the ledgers, not just the rows.**

### 1a. And `field_provenance` has never run on any LCC-internal table

> ⚠️ **CORRECTED 2026-09-02 by PR5c — this heading is false as written, and the ANSWER is below
> it.** `field_provenance` HAS run on an LCC-internal table: `public.activity_events` carries
> **22 rows** from `comms_owner_bridge` (2026-08-14), plus one `audit_run_log` smoke row. The true
> claim is narrower: *it has never run on any of the six tables carrying these 33 rungs.* The
> exception is the whole finding — that lane is the one that passes `p_target_database='lcc_opps'`
> and does not `JSON.stringify` its value, and **five siblings pass a string the
> `field_provenance_target_database_check` REFUSES** (`'dia'`, `'gov'`, `'lcc'`, `'lcc_db'`), so
> they raise **23514 on 100% of calls** into a bare `catch`. `lcc_merge_field` always inserts a row
> — write, skip and conflict all land — so zero rows means the RPC never completed.
> Full measurement + the 33-rung verdict table: `docs/audits/PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md`.

| target_table | rungs | provenance rows | physical table on LCC Opps |
|---|---:|---:|---|
| `entities` | 13 | **0** | yes |
| `entity_relationships` | 2 | **0** | yes |
| `lcc.lcc_property_owner` | 6 | **0** | yes |
| `lcc.lcc_entity_portfolio_facts` | 2 | **0** | yes |
| `public.lcc_cre_properties` | 7 | **0** | yes |
| `public.lcc_cre_property_documents` | 3 | **0** | yes |

**33 rungs governing a merge path that has never run on those tables.** Four of the six have a live
`lcc_merge_field` call site (§2), so this is not "nobody built it" — it is "it is built and has
produced nothing".

> ⚠️ **A naive existence check reports the wrong five tables.** `to_regclass('lcc.lcc_property_owner')`
> is NULL because **`lcc.` is a LOGICAL database prefix, exactly like `dia.`/`gov.` — not a schema**.
> The tables that genuinely have no physical counterpart are `comp_provenance`, `comparable_sales`,
> `deal_provenance`, `listing_provenance` and bare `properties` — and between them they hold
> **526,192 provenance rows**, because they are Salesforce-side logical namespaces. Reading the
> prefix as a schema flags six live tables and misses five real namespaces. (Class 11.)

---

## 2. `writer_live_zero_rows` — six correct call sites, nothing to show

| source | call site | why zero |
|---|---|---|
| `comms_observed` | `api/admin.js:9727` `p_source` | reachability-harvest verdict path; `reachability_harvest_apply_log` holds **2** rows |
| `w9_2_internal_harvest` | `api/admin.js:9798` | same lane |
| `w8_u3_link_propagation` | `api/admin.js:10609` | target `entity_relationships` — 115,790 rows, 0 provenance |
| `folder_feed_cre` | `api/_shared/cre-registry.js:398` | `lcc_cre_properties` holds 311 rows, `..._documents` 1,066, 0 provenance on either |
| `lcc_generated` | `api/_handlers/property-doc-writeback.js` | the authoritative-document channel, priority 1 |
| `availability_scraper` | `supabase/functions/availability-checker/index.ts:490` | a real `lcc_merge_field` POST from the edge function |

> ⚠️ **Every one of these stamps is wrapped in `catch (_e) { /* provenance is best-effort */ }`.**
> So "never written" here **cannot distinguish "the lane never ran" from "it ran and the stamp was
> silently dropped"** — which is exactly the **PR12** failure mode (a value containing a double
> quote aborts `lcc_merge_field` with 22P02 and `shouldWriteField` fails open). Sizing PR12 is
> upstream of grading these six.
>
> ✅ **ANSWERED 2026-09-02 (PR5c), and it was neither.** Replaying each site's exact payload in a
> rolled-back transaction: **5 of these 6 raise 23514** — `field_provenance_target_database_check`
> accepts only `lcc_opps`/`dia_db`/`gov_db`, and they send `'dia'`, `'gov'`, `'lcc'`, `'lcc_db'`.
> The sixth, `lcc_generated`, returns `decision=write` at rung 1: its call is correct and its lane
> has not run. ⚠️ The `w8_u3` lane is additionally **unreached** — `prior_owner_link` has 2 rows
> ever, both terminal non-applies (the 26 `applied` reviews are a `person_email_merge` sub-lane
> that creates no edge). All five callers fixed; see
> `docs/audits/PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md`.

---

## 3. ⚠️ The brief's predicted reverse-arm delta was wrong, and the reason is the detector's GRAIN

The brief expected `write-but-unregistered` **21 → 20** as the `costar_sidebar` →
`gov.properties.government_type` member left. It stayed **21**, and it always would have:
**`costar_sidebar` is a registered source with 73 rungs**, so it never appeared in a
source-grain arm at all. All 21 members are, as PR5 originally reported, benign one-shot
`cleanup_run_*` batch tags from the May 2026 remediation.

The `government_type` gap exists only at **(table, field, source)** grain, which is what
`v_field_provenance_unranked` keys on — and there it is **1 of 30**, not 1 of 1:

| target_table.field | source | writes 30d | succeeded | skipped |
|---|---|---:|---:|---:|
| `gov.properties.government_type` | costar_sidebar | 54 | 16 | 38 |
| `gov.sales_transactions.government_type` | costar_sidebar | 11 | 7 | 4 |
| `dia.sales_transactions.{updated_at, data_source, property_id, exclude_from_market_metrics}` | costar_sidebar | 98 each | 33 | 65 |
| …23 more | costar_sidebar / om_extraction / salesforce | | | |

**A detector's grain decides what it can see.** The two arms answer different questions and must
never be quoted as one number. The other 29 are §7 backlog **PR5a**; most are operational columns
(`updated_at`, `data_source`, `property_id`) that arguably do not belong on an authority ladder at
all, which is a decision, not a gap.

---

## 4. The one registration, and the four decision classes it changes

### Measured first: who wins today

On `gov.properties.government_type`, all time:

| effective source | rows | writes | skips | decision reason |
|---|---:|---:|---:|---|
| `agency_classifier` | 6,564 | 6,564 | 0 | all `no_prior_provenance` |
| `costar_sidebar` | 54 | 16 | 38 | all 38 `unregistered_source_with_existing_value` |
| `om_extraction` | 1 | 1 | 0 | `no_prior_provenance` |

Current value held by: classifier **6,564**, sidebar **16**, om_extraction **1**.
**No source has ever superseded another on this field.** The vendor capture loses to the domain's
own deterministic classifier on every contested record, and the rung is chosen to keep it that way:

```
('gov.properties', 'government_type', 'costar_sidebar', 95)   -- BELOW agency_classifier@90
```

⚠️ This is deliberately below `costar_sidebar`'s own `gov.properties` family (45–70) — a per-field
call, because on `government_type` an in-DB rule engine over curated lookups is authoritative and a
CoStar page label is not. **It is paired with `agency_classifier`: if PR10 re-ranks that source,
this rung moves in the same change.** The pairing is stored in the rung's `notes`, not only here.

### 🚨 You cannot register a source without changing behaviour

`lcc_merge_field` does not treat "unregistered" as a low rung — **it is a different branch**:

* unregistered + no prior → `write`
* unregistered + prior value is NULL → `write unregistered_source_filling_blank`
* unregistered + prior has a value → `skip`, **always**
* an unregistered *current* value is overridable by anyone → `replacing_unregistered_source`

So registration is never a no-op in either direction. A **72-combination replay** (3 sources × 3
sources × {same, different value} × {seeded value, seeded null}, run twice in one transaction that
was rolled back) measured exactly four decision classes changing:

| class | before → after | exposure on the live population |
|---|---|---:|
| **A** cur=`agency_classifier` holding NULL, new=`costar_sidebar` | `write unregistered_source_filling_blank` → `skip lower-priority` | **0 records** |
| **B** cur=`costar_sidebar`, new=`costar_sidebar`, different value | `skip` → `write same_source_refresh_newest_wins` | 16 |
| **C** same, identical value | `skip` → `write same_priority_same_value_refresh` | 16 (cosmetic) |
| **D** cur=`om_extraction`, new=`costar_sidebar` | `skip` → `write replacing_unregistered_source` | 1 |

**Predicted = actual.** Total exposure **17 records**; the 38 skips against a classifier value stay
skips and only their stated reason improves.

> ⚠️ **Class A is a genuine loss of coverage and the branch order is why: once both priorities are
> known, `lcc_merge_field` never looks at the null again.** It is 0 records today because no
> `agency_classifier` row on this field holds a null value — hypothetical, not impossible. It is
> also the argument against ever "tidying up" the ladder by deleting rungs.

`om_extraction` remains unregistered on this field (1 row, 2026-08-20) — named, not fixed.

---

## 5. PR7 re-measured: 19 orphan pairs, not 1 — and only one is live

PR7 was filed for `gov.properties.recorded_owner_name`. Checking every rung against each domain's
`information_schema` found **19 (table, column) pairs carrying 49 rungs**. Splitting by *when the
writes stopped* is what turns an alarming row count into an accurate reading:

| state | pairs | detail |
|---|---:|---|
| **LIVE** | 1 | `gov.properties.recorded_owner_name` — 448 rows, **28 in the last 30 days**, newest 2026-08-25. gov has `recorded_owner_id` only. Six rungs incl. `county_records`@10 and `gsa_lessor`@20. |
| **STOPPED** | 5 | `gov.sales_transactions.buyer_name` (7,916, ended 2026-07-29), `.seller_name` (6,039, 2026-07-29), `.procuring_broker` (33, 2026-07-14), `gov.properties.tenant` (16) and `.parcel_number` (9), both 2026-04-28 |
| **NEVER** | 13 | 0 provenance rows ever — the `folder_feed_bov`/`folder_feed_master`@9999 price rungs, plus `dia.recorded_owners.sf_company_id` |

**The gov `buyer_name`/`seller_name` residue is closed, not live.** `SALES_PROV_FIELDS`
(`sidebar-pipeline.js:298`) is explicitly *"a superset across dia + gov … only keys actually
present in the SENT payload are recorded"*, and the gov branch was corrected to write
`buyer`/`seller` in late July — those fields run to **2026-09-02** while `buyer_name`/`seller_name`
stop dead at 2026-07-29. The ledger faithfully recorded what the payload carried; the defect was
upstream and is fixed. **13,955 rows that read like live drift are historical, and only the dates
say so.**

`dia.recorded_owners.sf_company_id` is simply on the **wrong table** —
`dia.true_owners.sf_company_id` exists and is separately registered.

`gsa_lessor`'s zero is now explained: **both** its rungs are on
`gov.properties.recorded_owner_{name,id}`, and the `_name` one cannot exist.

### The standing check, and why it is a script

`scripts/check-field-source-priority-columns.mjs`. It probes through **PostgREST**, not
`information_schema`: a `GET /<table>?select=<cols>&limit=0` returns 42703 naming the column, which
is the same surface every writer uses, so it answers *"can a write name this column?"* rather than
*"does a schema mirror say so"* — and it needs no new database object on either domain (relevant
while **SEC1** is open).

> ⚠️ **It is an operator-run check, NOT a merge gate, and this file will not pretend otherwise.**
> It cannot be a repo test (neither domain schema is derivable from this repo, and a committed
> column census would rot in the *wrong* direction — a legitimately added column would turn it red
> over correct code) and it cannot be a SQL view (no database can see both the rungs and the
> columns). Its pure half is unit-tested; its network half is not. `--baseline` exits 0 while the
> reported set is a subset of the 19 measured here, so only a **new** orphan is worth waking up for.
> A probe that fails for any reason other than 42703 **aborts** rather than reporting the table
> clean — an auth error must never be laundered into a clean bill of health.

---

## 6. PR9 stated, not decided — and the framing changes with the data

`manual_verify` sits at priority **20**, below `manual_edit`@1, governing **673 rows**. Framed as
*"a human verifying a value ranks below a human asserting one"* it looks wrong. The field
distribution says it is a different question entirely:

| target_table.field | rows |
|---|---:|
| `dia.medicare_clinics.property_id` | 339 |
| `dia.properties.medicare_id` | 334 |

**All 673 rows are one thing: a human confirming a clinic↔property LINK on two id columns.** It
competes there with `auto_link_exact_singleton`, `auto_link_high_confidence`,
`auto_link_orphan_property` and `auto_stub_from_clinic` — automated linkers — not with
`manual_edit`. `manual_verify` has never asserted a *value*.

👤 **Scott's call, and the honest input is:** is a human-confirmed link meant to outrank an
automated one (rung < the `auto_link_*` family) or merely to be recorded (today's @20)? It is not
the `manual_edit`@1 comparison the row was filed under.

---

## 7. What was found and NOT fixed

| id | finding |
|---|---|
| **PR5a** | `v_field_provenance_unranked` holds **29** other (table, field, source) gaps after this change — 23 `costar_sidebar` / 5 `om_extraction` / 1 `salesforce`, dominated by `dia.sales_transactions` operational columns (`updated_at`, `data_source`, `property_id`, `exclude_from_market_metrics`, `rent_source`, `cap_rate_confidence`). Decide per column whether an authority ladder should govern bookkeeping fields at all. |
| **PR5b** | `om_extraction` is unregistered on `gov.properties.government_type` (1 row) and on 4 `dia.sales_transactions` fields where it has **0 successful writes and 6 skips each**. |
| **PR5c** | **33 rungs on six LCC-internal tables have never seen a `field_provenance` row** despite four of the six having live call sites. Grade against PR12 first. |
| **PR5d** | `costar_cmbs_loan` holds **121 rungs — the largest single source in the ladder — for a capture arm that has never produced a row**: `loans.data_source` carries no `costar_cmbs_loan` on either domain. Either the CoStar CMBS tab is never captured, or the arm is unreachable. |
| **PR5e** | `gov_ownership_chain`: `api/_shared/ownership-chain-apply.js:44` exports `A2_PROVENANCE_SOURCE` and **nothing imports it**. A2 wrote 304 portfolio facts with no provenance stamp. |
| **PR7a** | The one LIVE orphan — `gov.properties.recorded_owner_name`, 28 writes/30d. Point the writer at `recorded_owner_id`, or add the column to gov. |
| **PR7b** | The 5 STOPPED orphan pairs (13,955 rows) are closed at source; decide whether to prune the 15 rungs now that nothing writes them. ⚠️ Pruning is **not** neutral — see §4. |

---

## 8. The transferable lessons

1. **Before recording that a source has never written, enumerate the LEDGERS.** Seven of 39 were
   live on a second ladder; one of them wrote the same day the audit ran.
2. **A detector's GRAIN decides what it can see.** Source-grain and (table, field, source)-grain
   answer different questions; 21 and 30 are both correct and neither is the other.
3. **"Unregistered" is not a rung, it is a different algorithm.** Registering or de-registering a
   source changes merge outcomes in both directions. Prove it with a replay; never assume neutral.
4. **A rung with no producer is not automatically a defect.** `gliner_extract`'s was kept on purpose
   after a measurement, and the reason lived only in a code comment where no ladder audit would
   find it. Move the reason into `notes`.
5. **Split an orphan population by WHEN it stopped.** 13,955 rows that read as live drift were
   historical residue from a writer fixed five weeks earlier.
6. **A logical prefix is not a schema.** `lcc.` reads like one and is not; the check that assumed so
   flagged six healthy tables and missed five real namespaces.
7. **State which GRAIN a count is on — and this audit got its own headline wrong once.** It first
   reported "68 → 69 registered sources"; registering a rung on an already-registered source moves
   the rung count (2,140 → 2,141) and leaves the source count at 68. Same confusion as §3, one line
   later.
8. **Anchor a parse on a token, never an offset.** The triage view's first cut used
   `split_part(notes, 'PR5:', 2)` and silently returned NULL for 26 rungs the PR7 marker stamped in
   front — 400 verdicted before the regex, 426 after.
