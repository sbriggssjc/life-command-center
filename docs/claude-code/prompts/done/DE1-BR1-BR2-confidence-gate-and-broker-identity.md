# DE1 + BR1 + BR2 — gate the modeled figures, then make broker identity real

**Repo: `Dialysis`.** DB **Dialysis_DB `zqzrriwuavgrquhisnoa`**. No LCC changes.

**Read first, both canonical and both written to stop these being re-flagged as bugs:**
`docs/architecture/dialysis-economics-and-medicare-data.md` and
`docs/architecture/broker-and-firm-identity.md` (in `life-command-center`).

**Three units, in this order.** They are independent enough to ship separately — **do that** if any
one grows. ⚠️ **Unit 3 carries a hard prerequisite; read it before starting.**

---

## Unit 1 — DE1: gate the CM econ exhibits on measured-vs-modeled

**The facts, measured 2026-09-01 on `clinic_econ_reconciled` (`model_version_id = 21`):**

| FY | `hcris_form_265_11` | `partial_plus_default` | `national_default` | tier |
|---:|---:|---:|---:|---|
| 2021–2024 | **26,021** (6,590 clinics) | 523 | 31 | 98% **high** |
| 2025 | 58 | 2 | 1 | high / low |
| **2026** | **0** | **659** | **65** | **ALL low** |

**FY2026 contains ZERO measured payer mix** — 2026 cost reports have not been filed, so every row
falls back to a default. Its "73.66% Medicare / $297.87 blended" is **the fallback signature, not a
market shift**, and the signature is stable wherever it appears (~$295–301, 65–75% Medicare).

**Only 1 of 8 econ views (`v_clinic_econ_current`) has `confidence_tier` in a WHERE clause.**
`cm_dialysis_clinic_econ_trend_y` and `cm_dialysis_operator_unit_economics` — **both CM book
exhibits** — do not.

### What to do

**Gate both CM econ exhibits on `payer_mix_source = 'hcris_form_265_11'`** — the FACT — rather than
on `confidence_tier`, which is its proxy. Say in the view comment why.

- ⚠️ **This is LATENT, NOT LIVE. Do not describe it as a current book error.**
  `cm_dialysis_clinic_econ_trend_y` tops out at **2024** today, because its only protection is
  **`HAVING count(*) >= 1000`** — a row-count threshold. **FY2026 sits at 724. At 1,000 it enters the
  exhibit and the trend line breaks** (~375 → ~298, reading as a 20% rate collapse).
- **Keep the `HAVING` as well.** It guards a different thing (a year too thin to average at all).
  Two guards, each with a stated purpose.
- ⚠️ **`CREATE OR REPLACE VIEW` is append-only for columns.** If the column list changes at all,
  `drop view` + `create view`, or a replay from `main` errors 42P16.
- **Report the before/after row count per year for both views.** Expect **no change today** — that
  is the correct result and it is the proof the gate is additive rather than destructive. **A view
  whose output moves today means it was already admitting modeled rows and that is a bigger
  finding.**

⚠️ **Do NOT use `definition ILIKE '%confidence_tier%'` to audit this.** It matches the SELECT
projection, not a filter, and it reported three views as "careful" that are not. Test for the
predicate.

---

## Unit 2 — BR1: make the person/firm split real

**Measured:** `brokers` **2,425 rows** — `company` populated on **872 (36%)**,
**`broker_company_id` on 184 (7.6%)**, `broker_companies` holds **131 rows**. Meanwhile **299
`broker_name` values look like a firm** and **177 have `broker_name` == `company`** — the person
field holding a firm.

**The model is right and unpopulated. Populate it.**

1. **Type the rows**: for each `brokers` row, is `broker_name` a PERSON, a FIRM, or a composite
   (Unit 3)? ⚠️ **Use recorded facts before regexes** — `company`, `broker_company_id`, `contact_id`
   (1,916 populated) all carry evidence. A name-shape test is the *last* resort, and
   `lcc_looks_like_person`-style heuristics have a documented two-capitalised-tokens false positive
   that has already cost this codebase real companies.
2. **Where `broker_name` == `company` (177), the row is a FIRM filed as a person.** Link it to
   `broker_companies` (minting the company where absent) rather than deleting or renaming anything.
3. **Never overwrite a populated `broker_company_id`.** Fill-blanks only.
4. **Report the typed split** — persons / firms / composites / undecidable — and **leave the
   undecidable ones undecided.** An honest "cannot type this row" beats a guess.

---

## Unit 3 — BR2: resolve the 1,930 sales, deterministic first

### ⚠️ PREREQUISITE — read this before writing any backfill

**`B6e-ci-last5-decisions-resolved.md` has NOT been run.** It carries the `update_field` producer fix
(the broker-name normalisation branch that is currently dead because the alias is the identity
mapping). **Backfilling the FK while that producer is still broken is a one-shot repair of a live
producer — a chore repeated silently forever, the Class 8 failure this repo documents repeatedly.**

**So: either land the `update_field` fix in this same change, or stop at the PLAN for Unit 3 and say
so.** Do not ship the backfill alone.

### The work

**Measured:** 4,783 sales — name **2,111** · id **181** · **name-with-no-id 1,930** ·
**id-with-no-name 0** · **528 distinct unresolved names**. FK target `brokers` holds 2,425 rows.

- **Tier 1 — exact case-insensitive `broker_name`: 422 of 528 (80%).** Deterministic. **This ships
  on its own and is the whole high-yield core.**
- **Tier 2 — `normalized_name` (373) / `company` (209)** on Tier 1's residue, **only where exactly
  one broker matches.**
- **Tier 3 — REVIEW LANE. Never auto-matched.**

⚠️ **Do NOT fuzzy-match the residue.** Its shape is exactly what a scorer gets wrong:
`AY; Barnes` (an abbreviation of Avison Young), `Babcock` (a bare surname),
`Adrian Mendoza; Sean Sharko; Austin Weisenbeck` (a three-agent team), and
**`4802 D Dialysis, LLC` — a property name misparsed into the broker slot.**
**Grouping-for-review ≠ identity-for-write.**

**Rules that are not optional:**
- **Fill blanks in both directions; never overwrite an id, never clear a name.**
  `id_set_name_null = 0` is the existing design — **it must still read 0 afterwards.**
- **A `;` composite is a REAL FACT** (344 broker rows, **778 sales rows**). Record that a row is a
  co-listing; **never pick one half.** ⚠️ **49 rows carry `&` and no `;` and are mostly genuine firm
  names** (`Lee & Associates`) — **an `&` is part of a name, not a separator.**
- **Keep the raw captured string.** It is the evidence and it is what makes a wrong parse
  correctable later.
- Reversible, batch-tagged, and **run the reversal once before the batch.**

**Verify on:** `name_set_id_null` falling from 1,930, **`id_set_name_null` staying 0**, no existing
`listing_broker_id` changing, and the tier split. ⚠️ **Read the row delta, not the matcher's tally.**

---

## Out of scope, deliberately

**BR4 (143 duplicate-name groups) — after BR1/BR2, not now.** Resolving the firm link is what makes a
duplicate visible or explains it away; deduping first would merge two real people at the same firm.

**BR5 (display) and DE2 (render the tier)** are UI changes and follow the data.

## Report back

Per unit: what changed and what deliberately did not; DE1's before/after row counts per year for both
views (expect no change); BR1's typed split including the undecidable count; BR2's tier split, the
`id_set_name_null` check, and whether the producer fix landed with it or the backfill was withheld;
and anything the sweep turns up that outranks the task.
