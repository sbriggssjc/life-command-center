# OWNERGAP2-harris-c — the loader "wrote 0" twice on the real file, `real_acct.txt` has no `name` column, and 995 staged owners are the placeholder `CURRENT OWNER`

**Filed:** 2026-09-16 (Cowork), from Scott's first full-roll run (H6) and Cowork's repair of it.
**Owner:** LCC (`scripts/hcad-pdata-load.mjs`, `api/_shared/hcad-pdata-parse.js`,
`api/_shared/ownergap2-harris-pdata-match.js`). **Read first:** `prompts/done/OWNERGAP2-harris-b-…md`
and its response (PR #2531); the loader header's PROBLEM 1–3 notes.

## What happened on the real file (Scott's terminal, then Cowork's re-run from the VM)

Parsing was right — `1,628,306` lines → `71,276` F1/F2 rows, no duplicate accounts, no odd bytes.
Writing was wrong three ways, and the stage is only correct now because Cowork patched a **copy** of
the loader and re-ran it. **None of the fixes below are in the repo.**

1. **`resolution=merge-duplicates` never fired.** `upsertRows` POSTs to `hcad_real_acct_stage` with
   no `on_conflict=` and the comment claims PostgREST infers the arbiter from the plain unique index.
   It does not — PostgREST infers only the **primary key**; a unique index needs
   `?on_conflict=acct,file_year`. Every chunk containing one of the 37 already-staged accounts failed
   `23505 duplicate key value violates unique constraint "uq_hcad_stage_acct_year"` (19 of 72 chunks;
   53,000 rows landed, 18,276 did not). Fix: add `?on_conflict=acct,file_year` to the POST path.
   Keep the migration's index as is.
2. **The failure was invisible.** `streamLoadRealAcct.flush()` reads `r.ok` / `r.status` from
   `upsert(batch)`, but `upsertRows` returns `{ written, errors }` — so every chunk reports
   `chunk_at_0_failed:undefined` whether it succeeded or not, `written` never advances, and the
   summary says `wrote 0 of 71276` even when 53,000 rows landed. Fix: one return shape; on a
   non-2xx, print PostgREST's `code` + `message` (the 23505 above was only found by patching the
   script). Test: a chunk that fails must name its status and the first row's `acct`; a chunk that
   succeeds must count.
3. **`owner_name` was NULL on all 71,276 rows.** The 2026 `real_acct.txt` header is
   `acct, yr, mailto, mail_addr_1, …` — there is **no `name` column**, so `FIELD_CANDIDATES.owner_name`
   (`owner_name, name, owner1, owner_1`) matched nothing, and the parser header's claim that
   "real_acct.txt's own `name` column remains the source for owner_name" is wrong for this export.
   The harris-b prompt said it: **`owner_name` = `owners.txt` `name` at `ln_num 1`**, `mailto` →
   `owner_name_2`. The loader only used `owners.txt` for a *second* owner. Fix: when the real_acct
   header has no name column, `owner_name` comes from `owners.txt` (ln_num 1, file order) — and the
   loader must **refuse to `--apply`** if that leaves any row with an empty `owner_name` (print the
   count; a stage with null owners is worse than no stage). The upsert overwrote Cowork's 37 seeded
   owners with NULL before the re-run restored them — a fill-blanks rule on `owner_name` would have
   prevented that too.
4. **995 rows carry the placeholder `CURRENT OWNER`** (HCAD's own value when ownership is
   unresolved, e.g. acct `0010020000001`). The matcher must treat it as **no owner**: refuse with a
   named reason (`placeholder_owner`), never write it. Add it (and `OWNER UNKNOWN`, `UNKNOWN OWNER`
   if present in the file — count them) to the placeholder list, with a test against the real staged
   row. Confirm none was applied: `recorded_owners` where `source like 'ownergap2_public_assessor:harris_tx:%'`
   and `name ilike '%CURRENT OWNER%'` → 0 today.

## What the full roll showed (third live dry run, deployed `ac96fd45`, population 31 still open)

`resolved 1 / refused 30`: **27 `no_staged_rows`, 2 `no_records_returned`, 1 `no_matching_record`**.
Cowork checked the **whole file, all classes**, for 20 of the 27: the house numbers LCC holds do not
exist as HCAD situs addresses (`5208 Atascocita Rd` → HCAD has 5210/5212/5220; `6626 Antoine Dr` →
6601/6696/6700; `2254 Holcombe` → 2245/2249/2250/2265; `2920 Fulton` → 2901/2902 …). That is a
**situs-numbering gap, not a matcher bug** — resolving it needs a parcel discriminator (geocode →
parcel, or the tenant's suite in a larger center), which is the §P10a property-identity problem and
out of scope here. ⛔ Do not widen to "nearest number".
Two of the 30 are the **class filter**: `380 E Little York Rd` (acct `0222430000049`, class **C2**,
owner `380 LITTLE YORK LLC`) and `10311 S Post Oak Rd` (acct `0440360000028`, **C2**, `LUEL PARTNERSHIP
LTD`). C2 is the Texas PTAD "vacant commercial lot" class; HCAD carries these clinics under it. Whether
a C2 account with a matching situs may resolve is **Scott's decision (S5 in `OPERATOR-CHECKLIST.md`)**
— build the `--include-classes C2` switch and the matcher's class allow-list as a parameter, default
F1/F2, and report what changes with C2 on. The 1 resolved (`2626 South Loop West` → `AMALGAMATED HOUSTON
HOLDINGS LLC`, acct `1145390000003`, exact; the other `2626 W LOOP S` account correctly not taken) is
applied by Cowork on Scott's go, not by this round.

## Prohibitions

- ⛔ No name cleaning; no nearest-number matching; no class widening without the switch.
- ⛔ Do not reload the stage from the sandbox (no file there); the tests use the real staged rows.
- ⛔ Redeploy both Railway services and confirm `/version`.

## Reporting

The three loader fixes with their tests; the placeholder count by value; the C2 switch and the
dry-run by-cause table with and without it (Cowork runs the live one); the exact command for Scott's
next load (2027 file). If any step was skipped, say so.
