# Claude Code (GovernmentProject repo) — harden autoCreateProperty: sanitize inputs + dead-letter the retry storm

## Status correction (grounded live 2026-06-11)
This supersedes R12 Unit 1's diagnosis. Re-grounded against LCC Opps `sf_sync_log`
+ the dia `properties` constraints:

- The **cross-domain misroute is ALREADY FIXED.** The R12 audit (2026-06-08) saw
  the bad insert hitting the **gov** DB; every row from 2026-06-09 targets
  `target_database='dia'` — correct for a DaVita property. No domain-gate change is
  needed anymore.
- The remaining failure is an **input-sanitization** bug, NOT
  `government_type='Healthcare'`. dia `public.properties` has only three CHECK
  constraints, and the one being violated is:
  `properties_year_built_positive_chk CHECK (year_built IS NULL OR (year_built >= 1600 AND year_built <= 2100))`.
  The writer inserts **`year_built = 0`** (placeholder for "unknown") instead of
  NULL → 23514. (Mapped from the failing-row tuple: `…, building_size=7312.00,
  year_built=0, …` for `10241 Lewis & Clark Blvd, Saint Louis, MO — DaVita
  Dialysis - St. Louis - MO`.)
- The storm is currently **DORMANT** — it fired hourly on the SAME stuck row
  (sequence IDs 44505→44514) until 2026-06-09 01:18, then went quiet (the source SF
  Task aged out of the sync window). ~140 `properties` sequence IDs were burned;
  that's harmless. But the defect is latent: the next intake with `year_built=0`
  (or any out-of-range/garbage numeric) re-starts the same hourly burn.

## Where
`autoCreateProperty` lives in **GovernmentProject** (the gov-side Copilot/SF intake
path — see `COPILOT_INTAKE_ARCHITECTURE_REVIEW.md` /
`copilot_ingestion_implementation_spec.md`; it's the Python/Edge writer that POSTs
the `properties` insert and logs to LCC `sf_sync_log`). Confirm the exact module by
grepping for `autoCreateProperty` and the `properties` insert column list.

## Fix (three small, independent units)

### Unit A — sanitize numeric fields before the insert (the actual fix)
Before building the `properties` insert, coerce placeholder/garbage numerics to
NULL rather than passing them through:
- `year_built`: if not an int in **[1600, 2100]** → NULL. (0, '', 'N/A', negative,
  future-garbage all become NULL.) This directly clears the live failure.
- Apply the same defensive coercion to the other numerics the writer sets
  (`land_area`, `building_size`, `year_renovated`, `occupancy_percent`, zips):
  empty/`0`-as-unknown/non-numeric → NULL. A property with unknown size should
  insert with NULL, never a sentinel that trips a CHECK or pollutes analytics.
- `state`: enforce the 2-letter shape (`^[A-Z]{2}$`) the dia
  `properties_state_two_letter` CHECK requires; otherwise NULL (don't fail the
  whole insert on a malformed state).

### Unit B — dead-letter / cooldown so a bad row can't retry forever
Mirror the `LLC_MAX_ATTEMPTS` dead-letter pattern already used elsewhere:
- Key the source row (SF object id / address) and count failed auto-create
  attempts. After **N** (e.g. 5) identical failures, mark the source **dead**
  (stop re-issuing) and log ONE terminal `sf_sync_log` row, not an hourly stream.
- This bounds sequence burn + log noise even if a future row hits a constraint the
  sanitizer didn't anticipate. The acute storm is over, but this is what makes it
  not recur.

### Unit C — capture the constraint name in the failure log (observability)
The current `sf_sync_log.error_message` records only PostgREST `code` + `details`
(the failing-row tuple), truncated, with **no constraint name** — which is why this
took a column-position mapping to diagnose. Include the PostgREST `message` /
`constraint` field (e.g. `properties_year_built_positive_chk`) in the logged error
so the next one is a 5-second read.

## Verify + ship
- After deploy, force one auto-create with a `year_built=0` (or unknown-year)
  payload → it inserts with `year_built=NULL`, status ok, no 23514.
- A deliberately-bad row → dead-letters after N attempts; `sf_sync_log` gets ONE
  terminal row, not hourly repeats; `properties` sequence stops advancing.
- Confirm on LCC Opps: `select count(*), max(created_at) from sf_sync_log where
  error_message ilike '%23514%'` stays flat after the deploy (no new rows).
- No reclaim needed (all failed inserts rolled back; only sequence IDs were spent).

## Note
This is gov-side Python/Edge, not the life-command-center Node app and not a Power
Automate flow — the original task label ("PA flow domain-gate") predates the
re-grounding. If GovernmentProject is out of scope this session, the storm being
dormant means there's no fire to put out; ship when convenient. The LCC-side
circuit-breaker mentioned in R12 is unnecessary now that the writer targets the
right DB — the durable fix is Units A+B here.
