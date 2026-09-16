# GOVDEED4 — 80% of the dated gov deeds carry a date the model was told to invent, and nothing downstream can tell

**Filed:** 2026-09-16 (Cowork), every number below measured live on government (`scknotsqkcheojiaewwh`).
**Owner:** 👤 **government-lease** — the fix is in `src/public_record_ingest.py` and, if a column is
added, in a `government-lease/sql/` migration. This file is the handoff, not the fix. ⛔ Nothing here
is applied from `life-command-center`.
**Source round:** GOVDEED2 (shipped, gov PR #400) fixed `propagate_deed_to_property` so a **NULL**
`recording_date` no longer wins. This is the non-NULL half of the same defect: the dates that DO
survive that guard are mostly not dates.

## How it was found

The C2g 111-pair read (`docs/audits/C2g_58_PAIR_READ_2026-09-15.md` §5) noticed six of its pairs
carried `latest_deed_date = '2023-10-01'`, each with the sponsor as grantor. One query up: **130
properties** show that exact day. One query further: it is the single most common `recording_date`
in `deed_records`, and the payloads explain why.

## The mechanism — it is in the prompt, and the flag it produces is ignored

`src/public_record_ingest.py`, the gpt-4o extraction prompt (lines 107–108):

> 4) For each transfer, provide date_confidence as "high", "medium", or "low".
> 5) If exact day is unknown but month/year is known, use YYYY-MM-01 and set date_confidence="low".

So the model is *instructed* to emit a day-01 date when it does not know the day — and, being the
same no-county-fetch recall path GOVDEED1/2 described, it emits one when it does not know the
month or the year either. `save_deed_record` then:

- parses it straight into `recording_date` (line 1164) — no confidence check;
- reads `date_confidence` (line 1177) and stores it **only inside `raw_payload`** (lines 1228–1229);
- lets that date satisfy `has_chronology_key` (line 1179), so a row with a placeholder grantor
  (`"Prior Owner"`, `"Previous Owner Name"`) and an invented date passes the accept gate.

Nothing downstream — `propagate_deed_to_property`, `ownership_history`, `v_owner_source_conflict`,
LCC's `gov_ownership_transition` feeder — can see `raw_payload.date_confidence`. A low-confidence
day-01 guess is indistinguishable from a recorded instrument date.

## What it has produced

| measurement (`deed_records`, `recording_date IS NOT NULL`) | value |
|---|---:|
| dated rows | **844** |
| … `raw_payload.date_confidence = 'low'` | **676 (80%)** |
| … of the 676, day-of-month = 01 | **676 of 676** |
| … of the 676, no `document_number` | 667 |
| … of the 676, grantor is a placeholder (`Prior Owner`, `Previous Owner Name`, `unknown`) | 451 |
| rows with `date_confidence = 'high'` AND a `document_number` | **2** |
| unflagged (`∅`) / `medium` | 145 / 21 |
| top values: `2023-10-01` / `2023-01-01` / `2025-01-01` | **486** / 117 / 43 |
| `properties.latest_deed_date` currently sourced from a `low` deed | **493** |
| `ownership_history` rows whose `transfer_date` matches a `low` deed | 25 |
| created span of the `low` rows | 2026-04-03 → **2026-09-14**, 16 run-days — still producing |

`2023-10-01` on 486 rows is not "month/year known, day unknown." It is a default the model reaches
for, and rule 5 gave it a legitimate-looking shape to put it in. ⚠️ **After GOVDEED2 these rows are
now the *winning* deed** on their properties: the NULL guard removed the dateless competitor and left
the low-confidence one as `rn = 1`.

Dialysis is **not** affected: `Dialysis_DB.deed_records` has 230 dated rows, 0 flagged `low`, no
clustering (top date appears 3 times). The dia prompt/pipeline differs; do not "fix" it in sympathy.

## What to build — for government-lease to author, review and own

1. **Honour the flag at write time.** A `date_confidence = 'low'` date must not be written to
   `recording_date`. Two honest shapes; pick one and say which:
   - store it as a new nullable `recording_date_approx date` + keep `date_confidence` as a real column
     (so a consumer *can* choose to use a month/year hint, explicitly); `recording_date` stays NULL;
   - or drop it entirely and keep only the `raw_payload` copy.
   In either shape `has_chronology_key` must **not** be satisfied by an approximate date — a
   placeholder grantor plus a guessed date is exactly the row the gate exists to refuse.
2. **Rule 5 of the prompt** should stop inviting the shape. Either remove the `YYYY-MM-01` instruction
   (ask for `null` when the day is unknown, with `date_confidence` describing what *is* known), or keep
   it only if step 1 guarantees the value never lands in `recording_date`.
3. **The 676 existing rows** need a disposition — the same question as GOVDEED-478 (LCC backlog) and it
   should be decided together: they are assertions, not measurements. Sizing options is a separate
   round; ⛔ do not backfill a "real" date from anywhere, and do not delete evidence rows without a
   ledger.
4. A test that a payload with `date_confidence='low'` produces a NULL `recording_date` (or the approx
   column), and a positive control that `'high'` with a document number still writes.

## Prohibitions

- ⛔ Do not apply any of this from life-command-center.
- ⛔ Do not promote `medium` to "real" by omission — 21 rows, unmeasured here; read them before deciding.
- ⛔ Do not touch dia.
- ⛔ Do not fabricate a recording date from `created_at`, a sale record, a lease commencement, or a
  neighbouring row (the `2023-10-01` in `scripts/gov_master_sold_full.json` is a lease `COM` date on an
  unrelated Corpus Christi property — coincidence, checked, not a source).

## Reporting

State: which shape was chosen for step 1 and why; the before/after counts of `recording_date IS NOT
NULL`; whether the test's positive control fired; and that the 676 stay as-is pending the disposition
round. If any step was skipped, say so.
