# PR12 — `field_provenance` silently dropped any value carrying a quote, newline, tab or control char

**Date:** 2026-09-02 · **Target:** LCC Opps `xengecqvemvfknjvbvrq`
**Shipped:** migration `20261010120000_lcc_pr12_provenance_hash_bytea_safe.sql` (applied live) ·
`api/_shared/field-priority-guard.js` · guard `test/pr12-provenance-hash-and-failure-signal.test.mjs`
(12 tests, **17/17 mutations RED**) · full suite **5,099 tests / 5,093 pass / 0 fail / 6 skipped**.

---

## 1. The mechanism, and it is broader than the backlog row said

`value_text_hash` was

```sql
GENERATED ALWAYS AS (encode(sha224(coalesce(value::text,'')::bytea), 'hex')) STORED
```

`value` is `jsonb`. Rendering jsonb to text emits **backslash** escapes — `\"` `\\` `\b` `\f` `\n`
`\r` `\t` `\uXXXX`. The `text -> bytea` cast uses bytea's **escape** input format, which accepts only
`\\` and `\ooo`. Everything else raises **22P02**, which aborts the *whole* `lcc_merge_field()` call.

**Rolled-back control on the live function, pre-fix:**

| value | result |
|---|---|
| `'"C" - Commercial'` | **`22P02` invalid input syntax for type bytea** |
| `'C Commercial'` | `NO_ERROR` |

⚠️ **The backlog row named the double quote. The real set is wider, and the extra members matter:**

| breaks | does **not** break |
|---|---|
| `"` anywhere in the value | a jsonb object's own delimiter quotes — `{"a": "b"}` has no backslash |
| newline, tab, CR, backspace, formfeed, any control char | non-ASCII (`café`, `日本`) — passes through as raw UTF-8 bytes |
| the same, **inside a jsonb object's or array's string members** | numbers, booleans |

A literal backslash is the odd one out: it renders `\\`, which bytea *accepts* but collapses — so it
stored fine and hashed **differently** from its own text. That is the only class whose hash the fix
changes, and there are **0 of them** in the table.

**Exact rule, validated 14/14 against the live cast:** after collapsing `\\` pairs, ANY remaining
backslash errors.

---

## 2. ⚠️ The measurement trap I walked into first

The first census arm was `count(*) filter (where value::text like '%\%')` and it returned a clean,
confirming **0**.

**Backslash is `LIKE`'s own escape character**, so `'%\%'` parses as *"a literal `%`"* — the predicate
was structurally unable to express the question and answered with a plausible number instead of an
error. Same family as the P157 `reloptions` and P182 deparse traps, committed while auditing for
exactly this class. Re-done with `strpos()` (no escape semantics) **and a positive control on the same
query shape**, which fired on all 1,270,785 rows while the real arms read 0.

---

## 3. Size of the loss — three different numbers, and only one of them is a loss

Censused every `field_source_priority` rung that resolves to a real column, applying
`to_jsonb(col::text)` (what `lcc_merge_field` would receive for a text value):

| domain | rungs asked | resolve to a column | break-class values | columns |
|---|---:|---:|---:|---:|
| dia | 221 | 213 | **25** | 11 |
| gov | 240 | 229 | **54** | 17 |
| **total** | **461** | **442** | **79** | **28** |

Anti-joined against `field_provenance` on `(target_table, record_pk_value, field_name)` — positive
control: `gov.properties.address` carries 12,866 provenance rows, so the join shape resolves:

- **79** exposed
- **12** have a provenance row — and ⚠️ **those 12 are proven NOT AFFECTED**, not proven lost. Their
  writer (`om_extraction` → `available_listings.listing_broker` / `broker_email`) passes a jsonb
  **ARRAY**, which renders `["A", "B"]` with no backslash and records fine. The domain column stores
  the array *serialised as text*, which is what my `to_jsonb(col::text)` census saw.
  **The census therefore OVER-COUNTS wherever a caller passes structured jsonb.**
- **67** carry no provenance row at all.
- **1** is a **demonstrated** loss: dia `parcel_records.zoning` `ef1edd79…` = `"C" - Commercial`.
  PR2's backfill is *known* to have attempted it — it recorded 2,532 rows of 2,533 — and **231 sibling
  PKs on that exact (table, field) were written the same day**. That is the only place where a writer
  is known to have tried and the row is absent.

🚨 **The cumulative historical loss cannot be measured, and saying so is part of the answer.** A value
that was break-class when it was written and was later overwritten with a clean one leaves **nothing
behind** — no row, no marker, no error. So **67 is a snapshot of current exposure, not a running
total**, and no number in this document is a lifetime figure.

The residue is real curated data, not junk: `DOUBLE "Z" BROADCASTING, INC.`,
`TCC BUILDING "R" ASSOCIATES, L.P.`, `Tony "T.J." Morice, SIOR`, `J. Robert "Robbie" Dodd, Jr.`,
`107 "H" St E`, `1717 South "J" St` — plus JSON-array-in-a-text-column (**BR1**) and HTML fragments
in `properties.address`. Now that the writer is fixed these re-record on the next write; nothing is
backfilled (§7).

### 3a. ⚠️ The 79 answers the question as posed and is NOT the exposure — `lcc_merge_field` is called for UNREGISTERED fields too

Found by the *post-fix* check, not by the census: **8 break-class rows were written within two hours
of the migration** — live `costar_sidebar` writes of `dia.sales_transactions.notes` and
`sale_notes_raw`, multi-line OM narrative, every one of which would have raised 22P02 and been lost
the day before. All 8 hashed correctly.

Those columns are **not `field_source_priority` rungs**, so a census scoped to "ladder-governed
columns" — which is what was asked for — **structurally could not see them**. `lcc_merge_field` is
called for unregistered (table, field) pairs as well; it just takes the
`unregistered_source_filling_blank` / `..._with_existing_value` branch. Re-measured on the free-text
columns that provenance demonstrably writes:

| column | type | non-null | break-class |
|---|---|---:|---:|
| dia `sales_transactions.notes` | text | 2,969 | **927 (31%)** |
| dia `sales_transactions.sale_notes_raw` | text | 447 | **60** |
| gov `sales_transactions.sale_notes_raw` | text | 269 | **47** |
| dia / gov `sales_transactions.sale_notes_extracted` | **jsonb** | 250 / 184 | **0 / 0** |

⚠️ **`sale_notes_extracted` is the 12-jsonb-arrays trap for the third time in this audit.** The
`to_jsonb(col::text)` predicate first read **250 of 250 and 184 of 184 — 100%**, which is precisely
the implausibly-clean number that should stop you. It is a **jsonb** column, so the caller passes it
directly and its real break count is **0 / 0**. *Check the column's TYPE before believing a
break-rate; the predicate must match what the caller actually hands `lcc_merge_field`.*

**Corrected exposure: 67 registered + 1,034 unregistered free-text = ~1,101 currently-exposed values,
against the 67 this document reported one section earlier.** That is a **16× correction to my own
headline**, and the direction is the important part: the dominant population is not the quoted owner
name the backlog row named, it is the **newline** in ordinary multi-line narrative text, on
free-text columns nobody registered. `notes` at 31% is the real shape of this defect.

It is also not exhaustive — these are the free-text columns provenance is *known* to write. Sized in
backlog **PR12a**.

---

## 4. PR5c is NOT explained by PR12

PR5c reads *"33 rungs on six LCC-internal tables have never seen a `field_provenance` row, and four of
the six have a live `lcc_merge_field` call site inside `catch (_e) {}` — so the zero cannot distinguish
'never ran' from 'ran and the stamp was dropped'."* Measured:

| column | break-class / non-null |
|---|---|
| `entities.name` | **23 / 69,462 (0.03%)** |
| `entities.canonical_name` | 0 / 69,462 |
| `entities.email` | 0 / 11,767 |
| `entities.phone` | 0 / 9,911 |
| `lcc_property_owner.owner_entity_id` | 0 / 8,638 |
| `lcc_entity_portfolio_facts.ownership_start_date` / `_end_date` | 0 / 7,152 · 0 / 5,261 |
| `lcc_cre_properties.*` (6 columns) | 0 / 311 each (address 0 / 74) |
| `lcc_cre_property_documents.*` (3 columns) | 0 / 1,066 each |

17 of the 19 pairs resolve to a real column; `entity_relationships.developed` / `.owns` are
relationship **types**, not columns. **If a dropped stamp were the cause, the rate would have to be
~100%. It is ~0.** The zero is real: those lanes do not write provenance. **PR5c is gradeable now.**

---

## 5. The async path is the same defect, with one difference that matters

There is **no `provenance_event_log` table**. `lcc_flush_provenance_events(p_domain, p_events jsonb,
p_default_confidence)` takes the events as a **parameter** and calls `lcc_merge_field` — so both
writers hit **one table, one generated column, one defect**.

The difference: the flush wraps each call in `EXCEPTION WHEN OTHERS` and **returns** the failure in
`errors[]`, so it is not silent at the RPC boundary the way the JS fail-open was.

⚠️ **But `v_max_id` is assigned BEFORE the try block**, so an errored event still advances
`max_event_id`. Any caller that advances its watermark on that value skips the event **permanently**.
Not changed here (PR12 removes the error that would trigger it); noted so the next person does not
have to re-derive it.

---

## 6. `::bytea`-over-jsonb-text sweep — one instance, fleet-wide

Swept generated columns and defaults, function bodies, CHECK constraints, expression indexes and view
definitions on **all three projects** (LCC Opps, dia, gov):

- **`public.field_provenance.value_text_hash` is the only first-party instance.**
- Everything else matching is Supabase internals — `vault.create_secret` / `update_secret` /
  `decrypted_secrets` and `pgsodium.*` — and they use `decode(...,'base64')` / `convert_to(...)`
  correctly.

Pinned class-wide by the guard, which fails if any migration reintroduces a digest over a
`::text … ::bytea` cast.

---

## 7. The fix — and why it needed no table rewrite

**The obvious paths all rewrite the table.** `DROP COLUMN` + `ADD COLUMN ... GENERATED ... STORED`,
and PG17's `ALTER COLUMN ... SET EXPRESSION`, both rewrite **1,270,785 rows — 497 MB heap + 528 MB
indexes = 1,025 MB — on a 5,804 MB database whose documented worst failure is disk-full → GoTrue
cannot INSERT a session row → TOTAL SIGN-IN LOCKOUT.** ⚠️ **Free disk is not measurable from SQL or
from the Supabase MCP surface**, so that transient could not be sized. That is the honest constraint,
and it is what made the cheap path worth looking for.

**Two measurements made the cheap path provably safe:**

1. **`ALTER COLUMN ... DROP EXPRESSION` is metadata-only.** Probed on a scratch table in this very
   database: `pg_relation_filenode` **2831316 before, 2831316 after**, every stored value
   byte-identical. It converts a generated column to a plain column and **retains the data**.
2. **0 of 1,270,785 stored `value`s contain a backslash at all**, so the new expression reproduces
   every existing hash byte-for-byte. **The whole population, not a 10k sample.**

So: `DROP EXPRESSION` (metadata-only) + a BEFORE INSERT/UPDATE-OF-value trigger computing
`encode(sha224(convert_to(coalesce(value::text,''),'UTF8')),'hex')`. `convert_to` builds bytea from
the text's actual UTF-8 bytes and never parses escapes — that is the entire fix.

**Sub-second `ACCESS EXCLUSIVE`. No rewrite. No backfill. No transient disk. All 1,270,785 hashes
preserved exactly.**

⚠️ A BEFORE trigger is weaker than `GENERATED ALWAYS` in one way: a caller *can* supply the column.
The trigger assigns unconditionally, so a supplied hash is ignored and never trusted. Pinned by the
guard. Precedent: N15c made `entities.canonical_name` a single trigger-owned derived column for the
same reason.

**Post-fix verification**

| check | result |
|---|---|
| `lcc_merge_field` with `'"C" - Commercial'` | `NO_ERROR` (was `22P02`) |
| … with a newline value | `NO_ERROR` |
| … with `{"a": "say \"hi\""}` | `NO_ERROR` |
| hash of the quoted value | `b290856c…` = the `convert_to` hash computed before any change |
| rows after the rolled-back control | 1,270,785 — **0 residue** |
| stored hashes ≠ new expression | **0 of 1,270,785** |
| positive control (deliberately mutated expression) | **1,270,785 mismatches** |
| `attgenerated` on the column | now empty (plain column), 1 trigger |

**Deploy order — stated rather than left to be derived:** this migration is safe in **either** order
relative to the Railway deploy. It is **not** a `CHECK` enforcing new writer output, so the standing
*"constraint after writer deploy"* rule does not apply; it strictly **widens** what `lcc_merge_field`
accepts. The deployed JS keeps working unchanged, and the JS change only adds a signal that then reads
zero.

**Nothing is backfilled, on purpose.** The source, confidence and run id of a historical write cannot
be reconstructed, and a fabricated provenance row is worse than a missing one (P180: unknown is not a
value). The loss is recorded as a number and a date, here and on the lane page.

---

## 8. The JS half — fail open, but never silently

`shouldWriteField` **still fails open**: losing a curated value because its provenance could not be
recorded is strictly worse than losing the provenance. What changed is that the failure now leaves a
trace:

- **the DB's own SQLSTATE and message**, via `describeProvenanceFailure()` reading PostgREST's
  `{code, message, details}` error body — never `http_<status>`. A status code cannot name a cause;
  this is the same lesson as *"a PostgREST 409 is not necessarily a conflict"*.
- **a process-local counter**, `getProvenanceFailureStats() -> { total, byCode:[{code, message, count,
  targets}] }`. ⚠️ **Read `provenance_failed`, never `recorded`** — a re-discovery tally reads exactly
  like throughput while nothing moves.
- **a deduped `lcc_health_alerts(alert_kind='provenance_write_failed', source='lcc_merge_field:<sqlstate>')`**,
  opened at most once per SQLSTATE per process (the gate is a per-FIELD hot path; a GET+POST per
  failure would be its own outage). Severity `warn` — the column default and 482 of 485 live rows;
  `warning` is 3-row drift.
- the same treatment on **`recordFieldWrites`**, the audit-only path, so both `lcc_merge_field` call
  sites feed one counter instead of drifting.

`provenanceRecorded` is now on every return, so a caller can tell *recorded* from *failed open*.

---

## 9. Two guard defects the mutation pass found

1. **A source detector for a code shape must blank string LITERALS, not only comments — and the order
   is comments first.** My own migration's `COMMENT ON COLUMN … IS '…value::text::bytea…'` names the
   banned shape inside a **quoted string**, so a comments-only stripper reported the defect the
   migration had just removed. Blanking literals fixes it, but blanking them *before* stripping
   comments is worse than not blanking at all — a bare apostrophe in prose opens a string the scanner
   never closes and swallows the code behind it. Both halves and the ordering are positive-controlled.
   (OCR1c, in a new file, by the author who had just read the rule.)
2. **The historical migration must be exempted BY PATH, never by weakening the pattern.**
   `20260425210000_lcc_field_provenance_and_priority.sql` legitimately still states the expression it
   built. It is excluded by filename, and a companion test asserts **the exemption is not vacuous** —
   the exempted file must still contain the shape, or the allowlist has rotted into a lie (P182, plus
   the duplicate-definition guard's stale-allowlist rule).

---

## 10. Verify on

- `select count(*) from field_provenance where value_text_hash is distinct from
  encode(sha224(convert_to(coalesce(value::text,''),'UTF8')),'hex')` → **0**, with the mutated-expression
  positive control at 1,270,785.
- A rolled-back `lcc_merge_field` call with a quoted value → `NO_ERROR`, 0 residue.
- `provenance_failed` / the `provenance_write_failed` alert: fires in the offline control, and should
  read **0** in the 24 h after the Railway deploy.
- `v_field_provenance_unranked` unchanged — PR12 is not a registration change. ⚠️ It is a **30-day
  rolling window that moves**; re-measure rather than quoting a figure.
- ⚠️ **Do not verify on "the 79 fell"** — the writer is fixed, but a row only re-records when
  something writes it again. The number that moves first is the *next* break-class write succeeding.
