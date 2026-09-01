# Public records as an independent source lane (assessor / parcel / tax / deed)

> **START HERE for anything about assessor, parcel, tax or deed data as a SOURCE** — what it
> populates, where it sits on the authority ladder, and what is actually missing.
>
> **Scott's framing, 2026-09-01, and it is the correct one:** *"assessor data is valuable regardless
> of sale status or previous ingestion. It is just another independent public record source for
> property-related data — physical stats, ownership information and history, sales. It should be its
> own lane that populates all properties in the database that later code processes can evaluate
> against to find the most accurate representation of each property by field."*
>
> **Headline finding 2026-09-01: that lane is ALREADY BUILT and it has NEVER WRITTEN A FIELD.**

---

## 0. ⚠️ This page supersedes a wrong verdict issued the same day

`property-metadata-coverage.md` concluded **"no build — the population is stale sold comps."**
**That verdict was scoped to the 662-row `property_metadata_backfill_queue` and is wrong as a
statement about the public-records source.** The error was scoping a **SOURCE** to one
**CONSUMER's** gap list — the exact inversion `data-coherence-invariants.md` **I1** exists to
prevent, committed by the person who wrote I1.

**What survives from that page:** the fabrication finding (§3 there — the retired module had no
county adapter and asked gpt-4o to recall parcel facts), invariant **I12** (acres vs sq ft), and the
Ollama-corpus measurement. **What does not survive:** *"don't build"*, and every reach number in its
§5, because all of them used the queue as the denominator.

**The correct denominator is every property: dia 11,802 + gov 13,837.** A sold property's assessor
record is still ownership history, still a sale record, still physical stats.

## 1. The lane exists, in full, on both domains

| object | what it carries |
|---|---|
| `parcel_records` | `apn, county, state, assessed_value, owner_name, zoning, building_sf, lot_sf, year_built, year_renovated, land_use, mailing_address, raw_payload, data_hash, fetched_at` |
| `tax_records` | `apn, county, state, tax_year, assessed_value, tax_amount, amount_paid/due, is_delinquent, delinquent_amount, mailing_owner, mailing_address, raw_payload` |
| `deed_records` | `county, state, recording_date, document_number, deed_type, grantor, grantee, consideration, legal_description, grantor_address, grantee_address` |
| `property_public_records` | **the link + confidence layer** — `property_id, record_type, record_id, confidence, verified, verified_by, verified_at, notes` |
| `county_authority_cache` | **926 counties** with `assessor_url, recorder_url, tax_collector_url, clerk_url, gis_url` |

⚠️ **Note the keying, and keep it:** `parcel_records` / `tax_records` / `deed_records` are keyed on
**APN + county + state**, not `property_id`. The link goes through `property_public_records`. **That
is correct** — a public record exists independently of whether we hold a property row for it, which
is precisely Scott's "its own lane" requirement, already honoured.

**And the authority ladder is registered.** `county_records` sits at **priority 5** across **93
field rungs spanning BOTH domains** — `dia.properties.year_built / building_size / land_area /
lot_sf / zoning / assessed_value / parcel_number / recorded_owner_id / recorded_owner_name`,
`dia.ownership_history.*`, `dia.sales_transactions.*`, and the full gov mirror. `recorded_deed` sits
at **3**. Both **outrank** `om_extraction` (30–50) and `costar_sidebar` (45–60).

## 2. 🚨 The finding: the highest-registered source has never written a field

**`county_records` has ZERO rows in `field_provenance`. Ever.** Positive-controlled in the same
query: `recorded_deed` has 2,681 rows / 371 writes, so the detector fires. No tax/parcel/assessor
source variant exists under any other spelling (49 distinct sources checked).

**The tables fill and nothing consumes them.**

| leg | rows | properties linked | of 11,802 | producer |
|---|---:|---:|---:|---|
| **tax** | 25,621 | **9,107** | **77%** | live, fetched 2026-08-31 |
| **parcel** | 1,604 | 908 | 7.7% | live, fetched 2026-08-31 |
| **deed** (dia) | 178 | — | — | live, fetched 2026-08-31 |
| mortgage | 171 | 135 | 1.1% | **dead since 2026-05-10** |
| entity | 153 | 124 | 1.0% | **dead since 2026-05-10** |

**The clinching detail:** `dia.properties.year_built` carries **3,586 `field_provenance` rows and
the only source is `salesforce`** (priority 20). The county source registered at priority 5 — which
would outrank it on every one of those rows — has contributed nothing, while `parcel_records` sits
in the same database holding the answer.

**This is Dead-End Class 2 (a producer with no consumer) on the most extensively registered source
in the system**, and it is invisible to every existing check: the tables are non-empty and growing,
the producer is green, the ladder is registered, and the fields fill from somewhere else.

## 3. The three real gaps, in priority order

1. ⭐ **No reconciliation consumer.** Nothing reads `parcel_records` / `tax_records` and calls
   `lcc_merge_field` against the 93 registered rungs. **This is the whole of Scott's "later code
   processes evaluate against to find the most accurate representation per field"** — the lane is
   there, the evaluator is not. **Highest leverage by a wide margin: it needs no new acquisition, no
   new schema, and no new ladder entry.** Its immediate reach is the 9,166 already-linked properties
   (78%), not 662.
2. **The parcel leg is thin where the tax leg is strong** — 908 properties vs 9,107, and **only 41
   `parcel_records` rows carry `year_built` / `building_sf` / `lot_sf`** (670 carry `owner_name`).
   ⚠️ **The right question is not "can we reach county assessors" — the tax fetcher demonstrably
   reaches 77%.** It is *why does the same live producer return tax rows for 9,107 properties and
   parcel stats for 41?* Investigate the fetcher, do not assume acquisition.
3. **`confidence` and `verified` carry no information** — `confidence = 1.000` on all 23,728 rows
   and `verified = false` on every one. A constant is not a signal (the P139 lesson: a rank term
   that is a hard-coded constant reads like a value expression). Either populate it per record type
   and match quality, or stop presenting it as a confidence.

## 4. Design constraints, already paid for

- ⚠️ **Never an LLM recalling a parcel fact.** The retired `assessor_enrichment.py` had **no county
  HTTP call at all** — its one external request asked gpt-4o to recall parcel facts, which is
  fabrication by construction. A real lane fetches a record and stores `raw_payload` + `data_hash`;
  those columns already exist on all three tables. See `CLAUDE.md` → *Data-write discipline*.
- ⚠️ **I12 — acres vs square feet.** `parcel_records` carries `lot_sf`; `dia.properties` carries
  **both `land_area` (acres) and `lot_sf`**, with 3,702 paired rows, **0 equal**, ratio exactly
  43,560 on 91.1%. Any reconciliation must write **one** and derive the other, not populate whichever
  the source happened to express. Same hazard live at `sidebar-pipeline.js` ~4597.
- **Fill-blanks and priority-gated**, per the standing ladder — `county_records`@5 outranks
  `om_extraction` and the sidebars, so it may legitimately supersede them; it must not overwrite
  `manual`@1 or `recorded_deed`@3.
- **A sold property is in scope.** Its assessor record is ownership history, sale evidence and
  physical stats. **Do not gate this lane on listing status** — that gate is what produced the wrong
  verdict in §0.

## 5. What is NOT the answer here

Measured 2026-09-01 and refuted **as ways to fill these fields** — they remain refuted, and they were
always a different question from the source lane:

- **Ollama over documents we already hold** — 9 of 662 queue properties have usable document text.
  There is no corpus. P131 case (b) is empty.
- **Sidebar deliberate lookup as a backfill** — the extension already extracts `year_built`,
  `square_footage` and `lot_size` correctly; the gap rows have **neither** column, i.e. were never
  captured. Absence of capture, not a mapping loss.

**Neither refutation touches the public-records lane**, which acquires from a different source
entirely and is already 78% linked.

## 6. Where else to look

| for | read |
|---|---|
| the queue-scoped view (⚠️ carries the superseded verdict) | `docs/architecture/property-metadata-coverage.md` |
| the invariants this serves | `docs/architecture/data-coherence-invariants.md` — **I1**, **I5**, **I7**, **I12** |
| the ladder mechanics | `docs/architecture/data_quality_self_learning_loop.md` |
| open rows | `docs/os/PLANNED-BACKLOG.md` — `PR1`–`PR4` |
| the fabrication doctrine | `CLAUDE.md` → *Data-write discipline* |
