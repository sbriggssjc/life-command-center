# OWNERGAP2-harris-b — the Harris matcher queries the stage with LCC's street shape, not HCAD's; and the loader cannot read an 889 MB file

**Filed:** 2026-09-16 (Cowork), from the first live Harris dry run. **Owner:** LCC
(`api/_shared/ownergap2-harris-pdata-match.js`, `scripts/hcad-pdata-load.mjp`, `api/_shared/hcad-pdata-parse.js`).
**Precondition met:** `hcad_real_acct_stage` exists on Dialysis_DB (migration `20261012090000` applied
by Cowork 2026-09-16) and holds a **37-row targeted subset** of the real 2026 export (the accounts on
the target streets/house numbers), loaded by Cowork from the real file — so the fixes below can be
tested against real rows without a full load.

## What the live dry run showed (deployed `8ab35ec9`, `jurisdiction=harris_tx`, population 50)

`resolved 0 / refused 50`: **47 `no_staged_rows`, 3 `no_matching_record`**. Both are the matcher, not
the data — the 37 staged rows include the exact accounts for ~30 of the 50 (e.g. `5040 CRENSHAW RD →
CRENSHAW MOB LLC`, `2000 CRAWFORD ST → 2000 CRAWFORD PROPERTY LLC`, `18003 LONGENBAUGH RD → RUPANI
PROPERTIES LLC`, `20320 NORTHWEST FWY → WE 72 CYPRESS MEDICAL LLC`).

1. **Fetch shape.** `fetchHarrisPdataForProperty` queries `hcad_real_acct_stage?str=eq.<key>` with
   `harrisPdataStreetKeys()` output — `"CRENSHAW RD"`, `"CRAWFORD ST"`, `"N LOOP E"`, `"STATE HWY 249"`.
   HCAD's `str` column is the **bare street name**: `CRENSHAW`, `CRAWFORD`, `NORTH LOOP`,
   `STATE HIGHWAY 249` / `SH 249` (both spellings exist), with the suffix in `str_sfx` (`RD`, `ST`,
   `FWY`, `PKY`) and directionals in `str_pfx` / `str_sfx_dir`. Verified from the real file's header
   and rows (Cowork, `real_acct.txt` 2026-09-13). So 47 of 50 queries matched nothing.
2. **Compare shape.** For the 3 whose key happened to equal HCAD's `str` (`LIVE OAK`, `CENTER`,
   `LA CONCHA`), `resolveHarrisFromPdata` rejected with `street_mismatch`: LCC's address has **no
   suffix** (`1550 Live Oak`) and the candidate built from the row is `1550 LIVE OAK ST`. Run locally
   with the real staged row, `5040 Crenshaw Rd` resolves `exact`; `1550 Live Oak` does not.

## What to build

1. **Query by HCAD's shape.** Derive the stage key from the normalized street by stripping the
   trailing suffix token (`RD ST DR LN FWY PKY PKWY BLVD AVE HWY CT WAY`) and leading/trailing
   directionals (`N S E W NORTH SOUTH EAST WEST`); expand known spellings both ways
   (`STATE HWY 249` ↔ `STATE HIGHWAY 249` ↔ `SH 249`; `N LOOP E` ↔ `NORTH LOOP`; `FM 1960 RD W` ↔
   `FM 1960`; `NORTHWEST FWY` ↔ `NORTHWEST`; `SAM HOUSTON PKWY` ↔ `SAM HOUSTON`). Query `str=eq.` for
   each key **and** add `&str_num=eq.<n>` so the 200-row limit never truncates a busy street
   (`FANNIN` has hundreds of accounts). Keep the alias fallback order.
2. **Compare with the suffix optional** when the LCC address carries none; when both carry one,
   they must agree after normalisation (`PKY`=`PKWY`, `FWY`=`FREEWAY`, `HWY`=`HIGHWAY`). Directionals:
   an LCC directional must not contradict HCAD's `str_pfx`/`str_sfx_dir` when both are present.
3. **Test against the 37 real staged rows** (query them; do not invent fixtures): expected resolved
   for at least Crenshaw, Crawford (two accounts F1 + C2 → the F1 wins, or refuse if the rule says
   so — state which), Longenbaugh, Northwest Fwy 20320, Gemini, La Concha, Timberdale, Blalock,
   Alice, Rollingbrook, Garth, Fannin 8515, Clay, Live Oak, Center, Sam Houston 3327, FM 2920
   (two accounts, same owner → resolve), Little York 2711 (two accounts, two owners → refuse),
   Kirby 9001 (three accounts, three owners → refuse), 34th, Katy Fwy, SH 249 (three accounts, one
   owner → resolve), Chasewood Park. Report the by-cause table before and after.
4. **The loader must stream.** `real_acct.txt` inside `Real_acct_owner.zip` is **889 MB**; `readFileSync
   → string` and JSZip's `.async('string')` both fail (`RangeError: Invalid string length`, seen on
   Scott's machine). Read the zip entry / file as a stream (`node:stream` + `readline`, or `yauzl`),
   filter to `F1`/`F2` while streaming, and upsert in batches of 1,000 with `on conflict (acct,
   file_year)`. Also: **`owner_name` should come from `owners.txt` `name` (ln_num 1), with
   `mailto` in `owner_name_2`** — `mailto` carries care-of suffixes (`… % TERRELL MATTOX & ASSOC`,
   `… C/O BOXER PROPERTY`) that are mailing information, not the owner of record; Cowork's 37-row load
   already uses this mapping, so the loader must match it or the next upsert flips the names.
5. **Local credentials:** the loader warns `missing env vars … DIA_SUPABASE_URL` on Scott's machine
   and `.env.local` has none. Document `node --env-file=.env.local …` and which two variables
   (`DIA_SUPABASE_URL`, `DIA_SUPABASE_SERVICE_KEY`) to add from the Supabase dashboard — or make the
   loader accept `--dsn` — so the full-roll load can run from his terminal.

## Prohibitions

- ⛔ No name cleaning; copy the file's string (owners.txt `name` is already the clean column).
- ⛔ Do not widen matching until *something* returns — every rule above is a specific shape.
- ⛔ No real apply in this round; the dry run after redeploy is Cowork's, the apply is Scott's.

## Reporting

Before/after by-cause table on the 37 staged rows; the resolved/refused list with reasons; the
streaming loader's dry-run counts on the real zip (total / F1+F2 / a sample row) if credentials are
available, otherwise the exact command for Scott. If any step was skipped, say so.
