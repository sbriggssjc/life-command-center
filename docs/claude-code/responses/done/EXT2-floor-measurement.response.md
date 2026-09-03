# EXT2 — the floor re-run (workstation, 2026-09-03): the check passed, the named residual risk FIRED, and one small defect fell out of it

**Reconciled by Cowork from `bakeoff/agreement.json` (local). Findings only.** Same 10 arm-A docs,
extractor at the EXT2 build (`f83c2d99`, #2078). The check was defined as *both sides agree on
`year1_rent_source`* — not the rate alone.

## 1. The source agreement — 7 of 8 decided docs agree

| doc | base src | ctrl src | rent (both) | note |
|---|---|---|---|---|
| 255 | schedule_period_1 | schedule_period_1 | 101,568 = 101,568 | **agrees — but see §2** |
| 299 | schedule_at_rent_commencement | schedule_at_rent_commencement | 92,704 ≈ 92,786 | the two-period residue is GONE |
| 336 | base_rent | base_rent | 75,000 | |
| 386 / 425 / fixtures | base_rent | base_rent | equal | |
| 431 | schedule_period_1 | schedule_at_rent_commencement | **105,558 = 105,558** | source label differs, VALUE identical — rent commencement resolved on one run only |
| 327 | schedule_period_1 | — | — | control run returned no JSON (model failure, not EXT2) |

`credit_entity_basis`: `tenant_is_counterparty` on both sides everywhere except **431**, where the
baseline quoted the guaranty clause (`"Guarantor hereby unconditionally guarantee…"`) and the control
omitted it → basis flips `express_guaranty` / `tenant_is_counterparty`. **The code is behaving as
decided** (no quote, no credit move); the variance is model field-omission, the same class as EXT1b's
doc 228 commencement omission.

## 2. 🚨 The named residual risk fired on doc 255, and it produced a DOUBLE COUNT

EXT2's response §4 said: *if a lease's schedule states the BLENDED figure in period 1 while
`base_rent` quotes the base alone, the blended figure wins — doc 255's `year1_rent_source` is the row
to read.* Exactly that happened: `base_rent.as_stated = "$7,445 per month"` (the lease's Base Rent),
but schedule period 1 states **$8,464** (base + equipment), the schedule outranks the quote, so
`year1_rent = 101,568` — the blend. Defensible on its own (the lease's schedule states it). **Not
defensible:** `year1_total_rent = 113,796` = 101,568 + the Equipment Rent row (12,228) — **equipment
counted twice**, because the total-resolver adds `additional_rent` on top of a schedule figure whose
composition it cannot know.

**→ EXT2a (small):** when `year1_rent_source` is `schedule_*`, `year1_total_rent` is **null** with
note `schedule_composition_unknown` — unless the schedule figure equals the base quote (composition
known: base alone). No arithmetic inference beyond that equality check. 👤 Spot-check for Scott: the
Chesterbrook Champaign lease — does its rent schedule state $8,464 as "Rent"? If so, which figure do
you want as `year1_rent` for BOV: the lease's schedule figure (current behaviour) or its defined
"Base Rent" ($89,340 with equipment carried separately)?

## 3. Housekeeping findings

- **Doc 255's tesseract side produced NO tenant this run** (`agree=0/4` on the console) and doc 327's
  control returned no JSON — single-call model failures, not regressions; the EXT arc's numbers are
  self-control (baseline vs control), which read 7/8.
- Self-agreement aggregate this run ≈ 42/47 (89%) vs 94% last run — small-n motion; the DECIDED
  counts per field are what to read (the standing rule).
- Arm B ran incidentally (tesseract only, no baseline): 141pp and 118pp read in one pass again;
  doc 407 conf=68.2 / clauses 1/4 is the known garbled scan class.

## 4. What this closes

**EXT2's verification is DONE and the build works as decided** — the residue is one small resolver
rule (EXT2a) plus one lease spot-check. The extractor arc (EXT1 → EXT1b → EXT2) is otherwise closed;
remaining extractor variance is model field-omission between calls, not computation, labels, or
definitions.
