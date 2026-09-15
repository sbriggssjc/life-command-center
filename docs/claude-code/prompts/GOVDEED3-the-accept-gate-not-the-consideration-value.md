# GOVDEED3 — the accept gate, not the `consideration` value

**Filed:** 2026-09-15 (Cowork), measured live against government (`scknotsqkcheojiaewwh`).
**Owner:** 👤 **`government-lease`**. This is a handoff, not a fix.
**Supersedes:** GOVDEED2 recommendation #3, which was **wrong and is retracted** — see below.

## GOVDEED2 shipped and is verified live

Step 1's `bridged` CTE now carries `AND d.recording_date IS NOT NULL` and `LIMIT p_limit`, matching
step 2 exactly. Confirmed by reading the live `pg_get_functiondef`. **The manufacturing has stopped.**

## I was wrong about `consideration`, and the refusal was correct

GOVDEED2 recommended guarding `consideration` with `_positive_or_none` so a `0` sentinel would stop
satisfying `has_value`. The round **declined**, citing `government-lease`'s own CLAUDE.md §13d: a `$0`
deed price is a real recorded fact (quitclaims, intra-sponsor transfers), it is deliberately
unguarded, and a test exists to fail if someone "fixes" it for consistency.

**That refusal was right and the recommendation is retracted.** Declining a handoff instruction
because it contradicts documented doctrine in the owning repo is exactly the correct behavior, and it
is the second time this week a round has improved a Cowork-written prompt by pushing back on it.

⚠️ Stated plainly: `government-lease` is not connected to this session, so Cowork **could not read
§13d directly** and is taking the round's report of it at face value. The reasoning stands on its own
merits regardless.

## But the underlying defect is real — the discriminator is the COMBINATION, not the value

Measured across the 4,908 dateless `deed_records` rows:

| field | count |
|---|---|
| `consideration = 0` | **4,854** |
| `consideration > 0` | **0** |
| `consideration IS NULL` | 54 |
| grantor NULL or a placeholder (`unknown` / `n/a` / empty) | **4,881** |

**Zero rows in this population have a positive consideration**, and 99.5% have a placeholder grantor.
So the `$0` quitclaim that §13d exists to protect **does not appear in this population at all** — the
doctrine and this defect are not actually in conflict. They only looked like it because GOVDEED2
aimed at the wrong target.

⭐ **This is the seventh instance of the class this repo keeps hitting: `consideration = 0` carries two
meanings — *"a genuine $0 transfer"* and *"the model had nothing to give me."*** §13d is correct that
the first meaning is real. The accept gate is wrong to treat the second as evidence.

## Recommended change — make the gate conjunctive on placeholders

Do **not** guard `consideration`. Instead, in `public_record_ingest.py::save_deed_record`, reject a
row when the payload is placeholder *as a whole*: no `recording_date`, no `document_number`, and a
placeholder or missing `grantor`. A real $0 quitclaim has a recording date and a document number and
still passes. A model returning `"recording_date":"unknown","grantor":"unknown","consideration":0`
does not.

Requirements:

- **Measure the discard population before shipping.** State how many of the 4,908 the new gate would
  have rejected and how many rows with a positive consideration or a real document number it would
  touch (expected: zero — confirm it).
- **A positive control**: a genuine $0 quitclaim fixture with a recording date and document number
  must still be accepted. §13d's existing test should keep passing untouched.
- Commit it in `government-lease`, and say whether §13d needs a sentence added distinguishing "a real
  $0" from "a placeholder payload containing a 0".

## Two consequences of GOVDEED2 worth recording before they are forgotten

1. ⚠️ **"No backfill" did not leave the 3,930 as NULL — it froze them as the manufactured value.**
   Verified: still **3,930**, unchanged. Because the guard removes those properties from `bridged`
   entirely, this producer can now *never revisit them*. They are not awaiting correction; nothing
   will correct them. The **478** manufactured owner-source conflicts are likewise still present, and
   government's `auto_fixable` is still **0**. That disposition decision is still open and is the real
   remaining work.
2. 🔍 **`LIMIT p_limit` in step 1 sits after a window function with no ordering**, so it truncates an
   arbitrary slice *after* `row_number()` is computed and can in principle drop `rn = 1` rows. Latent,
   not active: the dated bridged population is **729 rows across 178 distinct properties**, far under
   5,000. It matches step 2's existing shape, so it is consistent rather than novel — but if that
   population ever grows past the limit, the function becomes nondeterministic about which properties
   it updates. Worth a comment in the file at minimum.

## Prohibitions

- ⛔ Do not apply anything from `life-command-center`.
- ⛔ Do not add a positivity guard to `consideration`. That was GOVDEED2's error; §13d is right.
- ⛔ Do not backfill or infer a deed date.
