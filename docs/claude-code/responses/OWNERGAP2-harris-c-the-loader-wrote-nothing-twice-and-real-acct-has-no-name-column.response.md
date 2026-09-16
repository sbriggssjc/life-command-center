# Response — OWNERGAP2-harris-c: the loader "wrote 0" twice, `real_acct.txt` has no `name` column, and 995 staged owners are `CURRENT OWNER`

**Prompt:** `docs/claude-code/prompts/done/OWNERGAP2-harris-c-the-loader-wrote-nothing-twice-and-real-acct-has-no-name-column.md`

## The three loader defects — all fixed, all guarded

### 1. `resolution=merge-duplicates` never fired

PostgREST infers an `ON CONFLICT` arbiter **without** an explicit `on_conflict=` param only from a
table's **primary key** — never from another unique index, even a plain-column one.
`hcad_real_acct_stage`'s PK is the `id bigserial`, which a fresh row never collides on, so every chunk
touching one of the 37 already-staged accounts hit
`23505 duplicate key value violates unique constraint "uq_hcad_stage_acct_year"` (19 of 72 chunks on
the real load; 18,276 of 71,276 rows never landed).

**Fixed:** `upsertRows` now POSTs to `hcad_real_acct_stage?on_conflict=acct,file_year` explicitly.

### 2. The failure was invisible

`streamLoadRealAcct.flush()` read `.ok`/`.status` off `upsertRows()`'s return value, but `upsertRows`
returns `{written, errors}` — a completely different shape. So the loader printed
`chunk_at_0_failed:undefined` for every chunk regardless of outcome, `written` never advanced, and the
final summary said `wrote 0 of 71276` even when 53,000 rows had actually landed.

**Fixed:** the real shape is read; a failed chunk now also carries the DB's own `code`/`message`
(`status=409,code=23505,message=duplicate key value violates unique constraint
"uq_hcad_stage_acct_year"`), not just an HTTP status.

### 3. `owner_name` was NULL on all 71,276 rows

The real 2026 `real_acct.txt` header is `acct, yr, mailto, mail_addr_1, ...` — there is no `name`-shaped
column at all, so `FIELD_CANDIDATES.owner_name` matched nothing. Per the harris-b prompt's own spec,
`owner_name` should come from `owners.txt` at `ln_num 1` (its first row per account, in file order —
the same ordering assumption the pre-existing `owner_name_2` fallback already made) when
`real_acct.txt`'s own column is absent for a row.

**Fixed:**
- `streamLoadRealAcct` fills `owner_name` from `owners.txt`'s first row per acct whenever
  `real_acct.txt`'s own field came back null, before falling back to `owner_name_2` from the second row.
- **`--apply` now REFUSES the whole write** (prints the count, writes nothing) if any staged row still
  has no `owner_name` after that fallback — a stage with null owners is worse than no stage. This meant
  restructuring `streamLoadRealAcct` to buffer the (small, already-filtered) staged-row set fully before
  writing, rather than flushing 1000-row batches as it streams. The RAW FILE TEXT is still never
  materialized as more than the current line (`node:readline`, one line at a time) — only the much
  smaller set of STAGED rows (tens of thousands, not the 889 MB source) is now held as one array. The
  1000-row HTTP batching this used to do inline now lives entirely inside `upsertRows`, which is
  unchanged in that respect (verified with a 2500-row end-to-end test asserting 3 POSTs of
  `[1000, 1000, 500]`).

## Item 4 — the placeholder owner (`CURRENT OWNER`) is filtered at match time, never staged as a real owner

Fixed in `api/_shared/ownergap2-harris-pdata-match.js`, not the loader — the stage keeps every row
`raw_row` includes for auditability; the MATCHER is where "is this a real owner" gets decided.

`isHcadPlaceholderOwnerName()` recognizes `CURRENT OWNER`, `OWNER UNKNOWN`, `UNKNOWN OWNER`, `UNKNOWN`
(case/whitespace-insensitive). `resolveHarrisPdataMatch` now filters placeholder names out **before**
grouping by owner:
- a placeholder-only match resolves to `reason: 'placeholder_owner'` (never writes the placeholder)
- a mix of one real owner + one placeholder for the same address resolves to the real owner alone
  (the placeholder is excluded from `distinctOwners`, `matchedRows`, and the written result)

Confirmed live: `select * from hcad_real_acct_stage where owner_name ilike '%CURRENT OWNER%'` was **NOT**
run against the live table from this sandbox (no egress/credentials here) — the guard is proven against
the documented shape (acct `0010020000001`) via the new unit tests instead. Cowork should re-run that
query post-deploy to confirm 0 of the 995 placeholder rows were ever written as a `recorded_owners.name`
value; nothing in this change could have written one even before today (no property in the current
population resolved through this path), so there should be nothing to reverse.

## The `--include-classes` switch (C2)

Two of the 30 refused properties in the full-roll dry run are `state_class='C2'` (Texas PTAD "vacant
commercial lot" — HCAD files these two clinics under it): `380 E Little York Rd` (acct
`0222430000049`, owner `380 LITTLE YORK LLC`) and `10311 S Post Oak Rd` (acct `0440360000028`, owner
`LUEL PARTNERSHIP LTD`).

Built as a **parameter**, never a default flip:
- **Loader** — `--include-classes C2,X2` stages the named classes alongside F1/F2, without staging the
  whole county the way `--include-all` does.
- **Matcher** — `buildHarrisPdataCandidates(address, rows, { includeClasses: ['C2'] })` /
  `resolveHarrisFromPdata(address, rows, { includeClasses: [...] })` /
  `fetchHarrisPdataForProperty(address, { includeClasses: [...] })` admit the named classes as
  `accountType: 'commercial'` when HCAD's own `state_class` mapping returns nothing — **never** for an
  account that already resolves to `'personal'` (Personal/BPP stays excluded regardless of
  `includeClasses`, tested explicitly).

**Whether C2 should ever be admitted is Scott's call (S5, per the prompt)** — this change makes it a
one-line, reversible, per-run decision rather than a code change, and does nothing to the class
allow-list on its own. The dry-run by-cause table with and without `--include-classes C2` needs a live
run against the real staged table (no egress from this sandbox); the two named C2 accounts above are
exactly what should move from `no_records_returned`/`no_staged_rows` to `resolved` once C2 is staged and
the switch is passed, assuming a single-account, single-owner match at the address (unverified — the
sandbox cannot query the live stage).

## Tests

`test/hcad-pdata-loader.test.mjs` (10 tests) — rewritten for the new `{written, errors}` shape, the
explicit `on_conflict=`, and the new streaming contract (buffer-then-write, batching now proven through
the REAL `upsertRows` end-to-end rather than a counting stub).

`test/ownergap2-harris-hcad-pdata.test.mjs` (+18 tests, 40 total) — new coverage for: `on_conflict=`
presence, the real `chunk_N_failed:status=…,code=…,message=…` error shape, `owner_name` filled from
`owners.txt` when the header has no name column, the `--apply` refusal on any missing `owner_name`
(and that it writes when none are missing), `--include-classes` staging (admits only the named class,
never a Personal one), the placeholder-owner guard (alone, and mixed with a real owner), and
`includeClasses` threaded through `buildHarrisPdataCandidates`/`resolveHarrisFromPdata`.

Full suite: **6,489 pass / 0 fail** (`npm test`), boot check green.

## Not done here

- **The live dry-run against the real staged table** (by-cause counts with and without `--include-classes
  C2`, and the placeholder-owner confirmation query) — this sandbox has no egress to Dialysis_DB.
  Cowork runs it live.
- **The 27 `no_staged_rows` situs-numbering gaps** — confirmed (per the prompt) to be a real
  parcel-identity problem, out of scope, not touched.
- **A reload of the real 2026 file** — not run here; the exact command for Scott's next load (once these
  fixes are on `main` and deployed) is:

  ```
  node --env-file=.env.local scripts/hcad-pdata-load.mjs \
    --file /path/to/Real_acct_owner.zip --file-year 2026 --apply
  ```

  (add `--owners /path/to/owners.txt` only if the zip does not already carry `owners.txt` inside it —
  it does, per the harris-b writeup, so this is normally unnecessary). Add
  `--include-classes C2` only after Scott decides C2 should be admitted.
