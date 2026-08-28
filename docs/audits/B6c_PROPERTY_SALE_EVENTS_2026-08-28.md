# B6c — `property_sale_events`: the table has a future, the two link columns do not

**Date:** 2026-08-28 · **Window:** data-process & automation audit (lettered prompts)
**Backlog:** `B6c` · carries **`D2`** · **Contract:** `data-coherence-invariants.md` **I3**
**Source:** [`B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md`](B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md)
**Outcome: DIAGNOSIS ONLY. No migration shipped. No column dropped. No type changed.**

---

## 0. The answer, up front

The B6c brief asked one question before any repair: **does `property_sale_events` have a consumer,
and is it the right table for the job?** Measured on both live domains, in the DB catalogs and in
the application code:

| subject | verdict | evidence |
|---|---|---|
| the **table** | ✅ **alive and load-bearing — keep it** | 6 live gov triggers, the LCC detail panel's declared canonical write target (2 write paths), read + write allowlisted on both domains, 6 dia objects read it |
| **`ownership_history_id`** | ❌ **retire — ZERO readers anywhere** | 0 hits across 620 gov objects, 0 across dia, 0 in app code; 0 of 5,208 gov rows; 52 of 2,730 dia rows; **no FK on either domain** |
| **`sales_transaction_id`** | ⏸️ **hold — one reader, dia-only** | `fn_listing_close_if_sold` (dia). gov: 0 readers; gov's own listing-close trigger does not use it |

**So the type defect is real and the repair is mostly not worth doing.** Fixing `bigint`→`uuid` on
`ownership_history_id` would build a link that nothing on either domain has ever followed — Dead-End
**Class 2**, a producer with no consumer — and 56% of the gov population it would link is the
retired circular `ownership_change_stub*` source.

**⚠️ And the audit found something bigger than the type defect on the way past it.** See §5: the
application calls `property_sale_events` canonical for writes while **76 of 76** gov views that read
a sale store read `sales_transactions` and **zero** read `property_sale_events`. Six real priced
sales, up to **$10.8M**, exist only in the UI table and are invisible to every analytic surface.
**That is the finding worth acting on, and it is not a type change.**

---

## 1. The type defect, confirmed exactly

### 1a. gov (`scknotsqkcheojiaewwh`)

| column | type | intended target | target PK | verdict |
|---|---|---|---|---|
| `property_id` | `bigint` | `properties.property_id` | `bigint` | ✅ + FK declared |
| **`sales_transaction_id`** | **`bigint`** | `sales_transactions.sale_id` | **`uuid`** | ❌ **impossible**, no FK |
| **`ownership_history_id`** | **`bigint`** | `ownership_history.ownership_id` | **`uuid`** | ❌ **impossible**, no FK |

A writer raises `22P02`. Nobody ever wrote one, so nobody ever saw it. **`property_id` is the only
FK on the table.**

### 1b. The positive control holds — and is narrower than it looks

dia's identical table carries the same `bigint` link columns, but dia's **targets** are `integer`,
so they are assignable:

| domain | `sales_transaction_id` | populated | FK? | `ownership_history_id` | populated | FK? |
|---|---|---:|---|---|---:|---|
| gov | `bigint` vs `uuid` | **0 / 5,208** | no | `bigint` vs `uuid` | **0 / 5,208** | no |
| dia | `bigint` vs `integer` ✅ | **2,432 / 2,730 (89.1%)** | **yes** | `bigint` vs `integer` ✅ | **52 / 2,730 (1.9%)** | **no** |

**The sales side proves the design works. The ownership side does not.** Even where the column can
be populated and has been for four months, it sits at **1.9%**, has **no FK on either domain**, and
has **no reader on either domain**. *"Fix the type and the join lights up"* is unsupported by the
one working instance — which is exactly why the brief said to answer before repairing.

---

## 2. What the table actually holds

**gov: 5,208 rows.** Every id column except `property_id` is empty:

| column | populated | | column | populated |
|---|---:|---|---|---:|
| `sale_date` | 5,208 | | `buyer_id` | **0** |
| `property_id` | 4,832 | | `seller_id` | **0** |
| `seller_name` | 5,097 | | `broker_id` | **0** |
| `buyer_name` | 5,065 | | `sales_transaction_id` | **0** |
| `price` | 2,015 | | `ownership_history_id` | **0** |
| `cap_rate` | 1,332 | | | |

It holds **text party names only**. Not just the two link columns — *every* id column in the table
is empty, which reframes it from "two broken FKs" to "an entity-resolution layer that was designed
and never built."

**By source — 56% is the retired circular mechanism:**

| source | rows | newest | note |
|---|---:|---|---|
| `ownership_change_stub` | 2,571 | 2026-03-27 | minted **from** ownership history |
| `ownership_change_stub_spe_rename` | 348 | 2026-03-27 | same, SPE renames |
| `excel_master` | 1,291 | 2026-03-05 | one-time import |
| `costar_export` | 994 | 2026-03-09 | one-time import |
| `county_deed:*` | 4 | 2026-04-06 | |

**2,919 of 5,208 (56.0%)** are `ownership_change_stub*`. Linking those back into `ownership_history`
is a loop. B5 measured this same class at **2 of 2,776 (0.07%)** and shipped over it; here it is the
**majority of the population**, and that difference is the whole reason a backfill is not safe.

**⚠️ One fact the brief did not have: `max(updated_at)` is 2026-08-04**, four months after the last
insert. It is not a second writer — 13 `excel_master` rows moved that day, consistent with the
cap-rate recompute path (`gov_recompute_caps_for_property`). Inserts genuinely stopped 2026-04-06.

---

## 3. Who reads it — measured, and positive-controlled

### 3a. The detector, and its control

A regex over `pg_get_viewdef` / `pg_get_functiondef` is the **P182 deparse trap**, so it was pointed
at known positives before its zeros were believed. Over **620 gov objects** (views + matviews +
functions, `prokind in ('f','p')`):

| probe | hits |
|---|---:|
| `recorded_owner_id` | 58 |
| `sold_cap_rate` | 48 |
| `buyer_name` | 5 |
| **`ownership_history_id`** | **0** |
| **`sales_transaction_id`** | **0** |
| `zzz_nonexistent_col` (control) | 0 |

**The detector fires. The zeros are real.** (Column *names* survive deparse unchanged — it is
operators and predicates the deparser rewrites — so a column-name grep is a safe use of this source.)

### 3b. The table's real consumers

**gov — the table is load-bearing:**

- **6 live triggers**, three of them table-specific: `trg_pse_close_listing`
  (→ flips a concurrent `available_listings` row to Sold), `trg_pse_propagate_sale`
  (→ writes `properties.latest_sale_price` / `latest_deed_date` / grantor / grantee),
  `trg_gov_auto_cap_rate_on_sale_event` (→ `cap_rate_history`, §12 of the gov contract).
- 2 functions mention it (`gov_recompute_caps_backfill`, `gov_recompute_caps_for_property`).
- **⚠️ Both PSE-specific trigger functions were read in full. Neither touches either link column** —
  they use `property_id`, `sale_date`, `price`, `cap_rate`, `buyer_name`, `seller_name`.

**dia — 6 objects:** `v_property_latest_sale`, `v_dia_consolidate_listings_candidates`,
`dia_consolidate_property_listings`, `dia_merge_property`, `merge_dialysis_dup_property`, and
`fn_listing_close_if_sold`.

**Application (LCC):**

- `detail.js` — **the declared canonical write target.** Two write paths (`_salesSaveTransaction`,
  the Intel-tab prior-sale save), both commenting *"the legacy `sales_transactions` sink has been
  retired for write paths … new rows always land in `property_sale_events`."* Also reads it, with a
  `sales_transactions` fallback.
- `api/_handlers/entities-handler.js:2139` — a sale-probe read.
- `api/_shared/allowlist.js` — in **GOV_READ, GOV_WRITE, DIA_READ, DIA_WRITE**; mirrored in the
  `data-query` edge function. The write path is live and allowlisted on both domains.

### 3c. The link columns' consumers — the decisive result

**`ownership_history_id`: ZERO readers.** Not one view, matview, function or trigger on gov or dia;
no reference in `api/`, `detail.js`, or any handler. Its only appearances repo-wide are the
migrations that created it and the audit docs that describe it.

**`sales_transaction_id`: exactly one reader, dia-only** — `fn_listing_close_if_sold`, which reads
`pse.sales_transaction_id` to stamp `available_listings.sale_transaction_id` when a listing
auto-closes. It is genuinely load-bearing there, and it is why dia has the FK.

**gov has no reader, and gov does not need one:** gov's equivalent trigger
(`pse_close_listing_on_sale`) closes the listing off `sale_date` / `cap_rate` alone.

---

## 4. Is it the right table for the job? — the duplication

`property_sale_events` and `sales_transactions` both describe "a sale of a property":

| | gov rows |
|---|---:|
| `sales_transactions` | **15,111** |
| `property_sale_events` | **5,208** |
| PSE rows with an **exact** `(property_id, sale_date)` twin in `sales_transactions` | **4,825 (92.6%)** |
| …within ±31 days | 4,832 |
| PSE rows on a property with **no** `sales_transactions` row at all | **0** |

Broken down for a hypothetical backfill: **4,205 unique matches · 620 ambiguous · 7 with no match.**

**So `property_sale_events` is ~93% a second representation of rows `sales_transactions` already
holds** — and `sales_transaction_id` is precisely the column that would record the correspondence.
It has never been able to.

---

## 5. ⚠️ The finding that outranks the type defect: the two stores disagree about which is canonical

`detail.js` says, in its own comments, that `property_sale_events` is **canonical** and
`sales_transactions` is **legacy, retired for writes**. The database says the opposite:

| | reads `sales_transactions` | reads `property_sale_events` |
|---|---:|---:|
| **all gov views** | **76** | **0** |
| of which `cm_gov*` (Capital Markets export) | 30 | 0 |

**Every analytic surface — the CM book, the comps engine, the cap-rate-by-term charts, the market
metrics — reads `sales_transactions`. Not one reads `property_sale_events`.** And no trigger or
function propagates PSE → `sales_transactions` (PSE's triggers write to `properties` and
`available_listings` only, while the reverse direction *does* exist via
`trg_gov_listing_propagate_to_sale`).

**A sale an operator enters through the LCC property panel therefore never reaches the comps
spine.** Today that is a small population, because the bulk producer stopped in April — but it is
already non-empty, and it is not noise:

| sale_event_id | source | date | price | cap | buyer |
|---|---|---|---:|---:|---|
| 1275 | excel_master | 2022-08-04 | **$10,800,000** | — | 4820 Square Holdings LLC |
| 5044 | excel_master | 2013-11-06 | $5,571,500 | 11.82% | UIRC, Urban Investment Research Corp. |
| 2202 | costar_export | 2020-10-16 | $4,000,000 | 9.83% | Government Investment Partners |
| 5604 | excel_master | 2011-01-05 | $3,280,000 | 9.25% | Syndicated Equities |
| 3861 | costar_export | 2016-07-19 | $3,000,000 | — | Washington Alliance Capital, LLC |
| 5831 | excel_master | 2004-12-22 | $2,550,000 | 10.00% | Jana Collins LLC |
| 4024 | ownership_change_stub | 2016-03-01 | — | — | *(stub)* |

**Six real priced comps, invisible to every chart in the book.** The seventh is a stub.

**This is a doctrine collision, not a bug in either half.** Both stores are individually correct and
each has a coherent set of consumers; nothing errors, and no test can see it, because it is a
property of the *connection* — precisely the class `data-coherence-invariants.md` exists for. Filed
as **B6c-dup**.

---

## 6. Recommendation — ranked, and mostly "do not build"

**6a. KEEP the table.** It is the UI's write path and carries three behavioural triggers. Retiring it
means moving the LCC detail panel's writes to `sales_transactions`, which is B6c-dup's decision, not
a side effect of a type audit.

**6b. RETIRE `ownership_history_id` on both domains — do not repair it.** Zero readers anywhere;
0/5,208 gov; 1.9% on dia after four months; no FK on either domain; and 56% of the gov population it
would link is the retired circular stub source. Repairing the type builds a link nobody follows.
**Not dropped in this change** for two reasons, both worth stating: dia holds **52 real values** that
a `DROP COLUMN` destroys with no consumer making it urgent, and the drop only makes sense alongside
B6c-dup. **Snapshot those 52 rows before any drop.**

**6c. HOLD `sales_transaction_id` on gov — do not retype yet.** Retyping is genuinely cheap and
zero-risk (0 of 5,208 populated, so the DDL cannot fail on data), and there is a *proven consumer
pattern* one domain over. But gov has no reader today and gov's own listing-close trigger does not
want one. **If the two stores consolidate under B6c-dup, this column disappears rather than getting
fixed** — so deciding it now would be deciding it twice.

**6d. ⚠️ The `feed_stale` alert should be re-scoped, not "resolved".** `property_sale_events` is
registered in `feed_freshness_registry` on `created_at` at **45 days**; it currently reads
**`is_stale=true`, age 144 days**. But its bulk producer is genuinely, deliberately retired, and its
**only live producer is an operator form with no cadence at all.** A 45-day expectation there will
alert whenever nobody happens to type a sale in for six weeks — the *"expectation nobody chose"* that
B6a warned about, and it will sit open forever. Either de-register it with the reason recorded, or
re-register it as a **declared** irregular feed. **Do not leave a permanent open alert for a
producer that was retired on purpose.**

**6e. B6c-dup (new, ranked above all of the above):** decide whether the LCC panel writes to
`sales_transactions`, or whether PSE gains a propagation path into it. That is what makes
operator-entered comps visible to the book.

---

## 7. D2 — the I3 link-column type sweep

### 7a. The detector

For every column named `<base>_id` in a base table, resolve a candidate target
(`base`, `base+s`, `base+es`, `base y→ies`, `base+_records`) with a single-column PK and compare
types. Full SQL in §7e.

**⚠️ One refinement the sweep earned while running: a declared FK is authoritative, and Postgres
already enforces type compatibility on one.** `available_portfolios.portfolio_id` was flagged
`uuid` vs `portfolios.portfolio_id integer` — but its *declared* FK points at
`sales_portfolios.portfolio_id` (uuid→uuid, correct). **The name-derived guess was wrong and the
declaration was right.** So D2 only ever needs to examine columns with **no FK**; every FK'd column
is compatible by construction. Applying that rule removes a whole false-positive class for free.

### 7b. Coverage and positive control

| project | `_id` cols | single-PK tables | pairs evaluated | mismatches |
|---|---:|---:|---:|---:|
| gov `scknotsqkcheojiaewwh` | — | — | ~103 | **5** |
| dia `zqzrriwuavgrquhisnoa` | — | — | ~69 differing-or-mismatched | **12** |
| LCC Opps `xengecqvemvfknjvbvrq` | 559 | 260 | **151** | **0** |

**Positive control:** the sweep independently rediscovered **both** known gov columns as `MISMATCH`,
and correctly classified dia's twin as compatible (`int_family_ok`, and the sales side FK'd). It is
not returning zeros because it cannot fire.

**⚠️ LCC Opps returned an empty mismatch list, and that is a bounded zero, not a clean bill.** It
evaluated **151 of 559** `_id` columns (27%); the other 408 do not resolve to a name-derived target
table and were **not examined**. Stated as a ceiling rather than reported as "LCC is clean."

### 7c. Genuine findings

**⚠️ The signature: every genuinely mismatched, undeclared link column found across both domains is
0% populated.** A column that cannot hold its value never gets one. Conversely, a mismatched column
that *is* populated is nearly always a false positive (an external vendor id, or a uuid stored as
text). **Populated-ness is the cheapest triage signal in this sweep** — use it before reading names.

| # | project | column | type vs PK | populated | note |
|---|---|---|---|---:|---|
| 1 | gov | `property_sale_events.ownership_history_id` | `bigint`/`uuid` | **0 / 5,208** | **B6c** |
| 2 | gov | `property_sale_events.sales_transaction_id` | `bigint`/`uuid` | **0 / 5,208** | **B6c** |
| 3 | dia | `available_listings.true_owner_id` | `integer`/`uuid` | **0 / 5,334** | ⚠️ dormant on a **live central table** |
| 4 | dia | `property_sale_events.broker_id` | `uuid`/`integer` | **0 / 2,730** | ⚠️ **mirror image of B6c** — gov's `broker_id` is fine, dia's is broken |
| 5 | dia | `sales_portfolios.recorded_owner_id` | `integer`/`uuid` | 0 / 134 | |
| 6 | dia | `sales_portfolios.true_owner_id` | `integer`/`uuid` | 0 / 134 | |
| 7 | dia | `available_portfolios.recorded_owner_id` | `integer`/`uuid` | 0 / 32 | |
| 8 | dia | `available_portfolios.true_owner_id` | `integer`/`uuid` | 0 / 32 | |
| 9 | dia | `client_feedback_log.property_id` | `uuid`/`integer` | 0 / **0 rows** | empty table |
| 10 | dia | `call_outcomes.user_id` | `text`/`uuid` | 0 / **0 rows** | empty table |

**Low severity — works, but untyped (real, not false positives):**

| # | project | column | type vs PK | populated | why it works |
|---|---|---|---|---:|---|
| 11 | gov | `gov_comp_review_queue.property_id` | `text`/`bigint` | 111 / 111 | values are numeric strings (`10062`); resolves via cast |
| 12 | dia | `dia_comp_review_queue.property_id` | `text`/`integer` | 291 / 291 | same convention, **both domains** — deliberate, not drift |
| 13 | dia | `user_query_history.user_id` | `text`/`uuid` | 13 / 13 | values are uuid strings |

**⚠️ #4 is the one worth reading twice.** The two domains' copies of `property_sale_events` are
broken on *different* columns: gov's `broker_id` is `uuid` against a `uuid` PK (fine) while dia's is
`uuid` against an `integer` PK (broken); gov's two link columns are broken while dia's are fine.
**Neither domain's table is a safe template for the other** — the I2 same-shape invariant, failing on
column types rather than on producers.

### 7d. Accepted false positives — named, not "fixed"

| project | column | why it is not a defect |
|---|---|---|
| dia | `sales_portfolios.portfolio_id` | **It is that table's own PRIMARY KEY**, not a link. The sweep matched a PK against a same-named PK elsewhere. |
| dia | `available_portfolios.portfolio_id` | Declared FK → `sales_portfolios.portfolio_id` (uuid→uuid). The declaration beats the name guess (§7a). |
| gov | `sf_activity_history_import.sf_activity_id` | 88,099 rows of **Salesforce external ids** (`00T8W00005CIozn`). An external vendor reference, not an FK — and a naming collision: `sf_activities.sf_activity_id` is an internal uuid with the same name. |
| gov | `gov_om_noi_writethrough_log.sf_file_id` | 0 rows; a Salesforce file id (text). Target PK is `file_id`, so the name match is coincidental. |
| dia | `lcc_users.salesforce_contact_id` | Salesforce external id (text). |

**Nothing in §7c or §7d was repaired in this change** — the brief is explicit that D2 names, sizes
and ranks. One repair per change.

### 7e. The detector SQL (reusable — this is I3's detector)

```sql
-- I3 / D2: undeclared link columns whose type cannot hold their target's PK.
-- A DECLARED FK is authoritative and type-checked by Postgres, so examine only unFK'd columns.
-- ⚠️ Positive-control it before believing a zero (P182): point it at a known-bad pair first.
with pkraw as (
  select tc.table_name tbl, kcu.column_name pkcol, c.data_type pktype
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
  join information_schema.columns c
    on c.table_schema = kcu.table_schema and c.table_name = kcu.table_name
   and c.column_name = kcu.column_name
  where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
),
pk as (  -- single-column PKs only
  select tbl, min(pkcol) pkcol, min(pktype) pktype from pkraw group by tbl having count(*) = 1
),
cols as (
  select c.table_name tbl, c.column_name col, c.data_type coltype,
         left(c.column_name, length(c.column_name) - 3) base
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.column_name like '%\_id'
),
fk as (
  select tc.table_name tbl, kcu.column_name col
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
)
select c.tbl, c.col, c.coltype, pk.tbl target, pk.pkcol, pk.pktype
from cols c
join pk on pk.tbl in (c.base, c.base || 's', c.base || 'es',
                      regexp_replace(c.base, 'y$', 'ies'), c.base || '_records')
where pk.tbl <> c.tbl
  and not exists (select 1 from fk where fk.tbl = c.tbl and fk.col = c.col)  -- §7a
  and c.coltype <> pk.pktype
  and not (c.coltype in ('smallint','integer','bigint')
       and pk.pktype in ('smallint','integer','bigint'))
order by c.tbl, c.col;
```

Then triage each hit by **populated count first** (§7c), and read the values before calling
anything a defect.

---

## 8. Verification

| item | state |
|---|---|
| §2 question answered in writing | ✅ §0 / §3 / §6 |
| detector positive-controlled | ✅ §3a (620 objects, 3 known positives, 1 known negative) |
| D2 sweep run on all three projects | ✅ §7b — LCC's zero **bounded**, not claimed clean |
| accepted false positives named | ✅ §7d |
| repaired anything | ❌ **deliberately not** — see §6 |
| `feed_stale` alert | ⏳ open at 144 days; **§6d says re-scope, not resolve** |

**Nothing shipped, so there is nothing to guard.** When B6b/B6c-dup act on §6, the guard belongs
with the change that makes it, mutation-verified and stripping comments before matching — this
document quotes the broken predicate repeatedly and would otherwise satisfy a naive source grep
(the **N18/A5c** lesson).

---

## 9. Filed follow-ups

| id | what | rank |
|---|---|---|
| **B6c-dup** | The canonical-store collision (§5). UI writes PSE; 76/76 analytic views read `sales_transactions`; 6 real priced comps invisible to the book. **Decide the direction before touching either link column.** | 🔴 highest |
| **B6c-oh** | Drop `ownership_history_id` on both domains; **snapshot dia's 52 values first**. | 🟡 after B6c-dup |
| **B6c-feed** | Re-scope or de-register the 45-day `property_sale_events` freshness expectation (§6d). | 🟡 |
| **D2-dia** | dia's 8 dormant mismatched link columns (§7c #3–#10), led by `available_listings.true_owner_id`. | 🟡 |
| **D2-shape** | gov and dia's `property_sale_events` are broken on *different* columns — neither is a template for the other (I2, on types). | 🟢 |
