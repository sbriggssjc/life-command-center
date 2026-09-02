# PR8 — the provenance relabel: registered-for-this-field is the allowlist, and the history is recoverable

**Repo: `life-command-center`.** Writes against **LCC Opps `xengecqvemvfknjvbvrq`** (one migration).
No Dialysis / government changes.

**Read first:** `docs/architecture/public-records-source-lane.md` §2a (*"The trap that would have
hidden a wiring either way"* and the 2026-09-02 decomposition beneath it), then `CLAUDE.md`
§"Field-level data provenance".

## What is already measured — do not re-derive, verify

`lcc_flush_provenance_events(p_domain, p_events, p_default_confidence)` carries

```
v_first_class := ARRAY['splink_v1','sf_link_review_human','splink_v2','sf_account_contact_expansion']
```

and merges every other event as `source = 'domain_trigger'`. **It also stamps
`source_run_id := v_src || ':evt' || v_id`, so the original name survives on every row.** Live:

| `source` | `split_part(source_run_id, ':evt', 1)` | rows | fields | writing |
|---|---|---:|---|---|
| `domain_trigger` | **`agency_classifier`** | **17,277** | gov `government_type` on `sales_transactions` 9,134 · `properties` 6,564 · `leases` 1,146 · `property_agencies` 433 | 2026-07-30 → **today** |
| `domain_trigger` | `qa22_davita_brand_canonicalize` | 94 | `dia.properties.tenant` | one-shot 2026-07-30 |

`field_source_priority` has **6 rungs for `domain_trigger` @90** (the five fields above plus
`gov.properties.agency_canonical`), **1 rung for `qa22_…` @90**, and **NO rung for
`agency_classifier` at all.**

So three things are true at once, and each is a defect of a different kind:

1. **`agency_classifier` is a live producer writing 17,277 provenance rows under a name that is not
   its own, at a catch-all rung, with no registration.** PR5's reverse arm ("21 write-but-
   unregistered, all benign `cleanup_run_*`") could not see it — the relabel hid it. *A source
   wearing the catch-all's name is unregistered without ever reading as unregistered.*
2. **`qa22_…` is registered and counted in PR5's "39 never written"** while 94 of its rows exist.
   The 39 is 38 — and any future source that goes through this path will read the same way.
3. **The PR1 verification (`field_provenance where source='county_records'` going non-zero) could
   never have observed success.** Class 11 applied to a verification.

## Build

### A. Replace the literal allowlist with the registry

The allowlist should be **"this source has a `field_source_priority` row for THIS table and
field"** — the registry *is* the allowlist, and the function already does that EXISTS check as its
second condition. Drop the `v_first_class` literal; keep the EXISTS. A registered source passes
through under its own name; an unregistered one still lands as `domain_trigger` (that is the
correct honest fallback for a writer nobody has ranked — do not raise).

⚠️ **This is a behaviour change on a live path — measure it before and after in one session:**
run the flush over a captured batch of today's events with the old and new function bodies (in a
transaction, rolled back) and diff the `(table, field, source, decision)` counts. **Predict the
delta first**: only the two sources above should move, and only where a rung exists.

⚠️ **Read `lcc_merge_field` before assuming the rung swap is neutral.** Today `agency_classifier`
writes at `domain_trigger`@90. Registering it at a *higher* rung (lower number) changes which
writes WIN against existing values — that is the whole point of the ladder, and it is also how a
generated value climbs above a curated one. **Register it at 90 first** (byte-identical outcome,
correct name), and file the re-rank as a separate decision with the evidence for what
`agency_classifier` actually is (deterministic classifier over agency names? LLM? — read the
producer's external call, per `CLAUDE.md`'s assessor-enrichment lesson).

### B. Register `agency_classifier` — at the rungs it actually writes, and only those

Four gov `government_type` rungs @90. Not `agency_canonical` (measured 0 rows from it — do not
register a rung nobody can exercise; that is PR7's class). Then `v_field_provenance_unranked`
should not move (it was 35; state before/after).

### C. Expose the effective source — APPEND-ONLY, never a rewrite

`field_provenance` is append-only by contract. **Do not UPDATE `source` on 17,371 rows.** Ship
`v_field_provenance_effective_source` (or add `effective_source` to `v_field_provenance_current`
at the END of the select — `CREATE OR REPLACE VIEW` is append-only for columns) computed as
`coalesce(nullif(split_part(source_run_id, ':evt', 1), ''), source)`, guarded so a `source_run_id`
that does not carry the `:evt` shape falls back to `source` (positive-control that guard on a
`recorded_deed` row).

### D. Re-run PR5's detector on the effective source, both arms

Registered-never-written and written-unregistered, keyed on the effective source. Quote the new
counts against 39 / 21 and name every row that moved. **The `cleanup_run_*` finding stays benign;
say so rather than re-deriving it.**

### E. Guard

A `test/*.test.mjs` that asserts the flush function's migration body contains **no literal
`v_first_class` array** and that the pass-through predicate names `field_source_priority`.
Strip comments before matching — the migration header will discuss the old literal at length, and
a raw grep passes over its own deletion (A5c / N18). Mutation-verify it red.

## What NOT to do

- Do not add `county_records` to anything. PR1's verdict stands: the producer generates its values
  and the consumer must not be wired until `REGRID_API_KEY` is real (PR1d).
- Do not "fix" PR5's 39 by registering sources speculatively. Registration follows a writer, never
  precedes one.
- Do not touch `lcc_merge_field`.

## Report back

The before/after diff of the flush over a captured batch (predicted vs actual) · the rung set
registered for `agency_classifier` and what its producer's external call talks to ·
`v_field_provenance_unranked` before/after · PR5's two counts re-keyed on the effective source, with
every moved row named · the guard's mutation results · anything in the sweep that outranks the task.
