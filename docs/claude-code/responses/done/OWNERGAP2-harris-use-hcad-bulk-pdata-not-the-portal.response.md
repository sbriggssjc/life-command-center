# Response — OWNERGAP2-harris: resolve the 50 Harris County owners from HCAD's free bulk PDATA export

**Prompt:** `docs/claude-code/prompts/done/OWNERGAP2-harris-use-hcad-bulk-pdata-not-the-portal.md`
**Branch:** `claude/trusting-gates-nddmdn`

## Network reachability — hcad.org is NOT reachable from this sandbox

```
$ curl -sS -o /dev/null -w "%{http_code}" --max-time 10 https://hcad.org/pdata/pdata-property-downloads.html
curl: (56) CONNECT tunnel failed, response 403
```

The agent proxy's own status endpoint confirms it is a **policy denial**, not HCAD's bot wall this time:

```json
"recentRelayFailures": [
  {"kind": "connect_rejected", "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
   "host": "hcad.org:443"}
]
```

So neither `Real_acct_owner.zip` nor `pdataCodebook.pdf` could be fetched from here. Everything below was
built to spec and tested against synthetic/fixture data — no real HCAD row exists anywhere in this change,
and nothing here treats fixture data as if it were real.

## What was built

### 1. Staging table — `supabase/migrations/dialysis/20261012090000_dia_ownergap2_harris_hcad_pdata_stage.sql`

`hcad_real_acct_stage(acct, owner_name, owner_name_2, mail_addr_1/2, mail_city, mail_state, mail_zip,
str_num, str, str_sfx, site_addr_1/2/3, state_class, is_commercial_class, raw_row jsonb, source_file,
file_year, loaded_at)`. Idempotent unique key `(acct, file_year)`. `raw_row` keeps every column the
loader saw so a wrong column-name assumption is correctable without a re-download.

⚠️ **`is_commercial_class` is UNVERIFIED against the real codebook.** No egress meant the codebook PDF
could not be read. The migration uses the Texas Comptroller's published state-class taxonomy (the same
one every Texas CAD, including HCAD, files under): `F1` = Real, Commercial; `F2` = Real, Industrial;
`L1` = Personal, Commercial; `L2` = Personal, Industrial. This is stated as an assumption needing
operator verification in the migration header and the column comment — not hidden, not treated as fact.

### 2. Pure parser — `api/_shared/hcad-pdata-parse.js`

Two documented assumptions, both stated and both defensive:

- **Delimiter**: assumed tab (every documented consumer of HCAD's PDATA text export describes it as
  tab-delimited with a header row), but the parser SNIFFS the header line and picks whichever delimiter
  (`\t`, `,`, `|`) actually splits it, so a differently-delimited file does not silently mis-parse.
- **Column names**: HEADER-DRIVEN, never positional. `FIELD_CANDIDATES` maps each logical field to
  several known-documented candidate header spellings; the parser refuses (`missing_required_columns`)
  rather than guessing when the one required field (`acct`) cannot be found. Extending the candidate
  list is a one-line change if a real export uses a header name not yet listed — never a re-derivation
  of column positions.

Also carries the commercial-class classification (`isCommercialRealClass`, `isCommercialPersonalClass`,
`isAnyCommercialClass`) and `harrisStateClassToAccountType()`, which maps a staged `state_class` onto
the SAME `'commercial'`/`'personal'` vocabulary the pre-existing payload-only Harris adapter
(`ownergap2-sources.js`) already uses — one classification, two feeds.

### 3. Matcher — `api/_shared/ownergap2-harris-pdata-match.js`

Turns staged rows into OWNERGAP2 candidates and resolves through the **same shared matcher**
(`ownergap2-address-match.js::resolveOwnerFromCandidates`) Philadelphia and the payload path already
use — one matcher, three feeds, one set of ambiguity rules:

- A Personal/BPP account (`state_class` L1/L2) is EXCLUDED, never treated as an owner candidate.
- The Commercial account is preferred over a co-located Personal account (PDR2's rule) — verified live
  in a test on the exact Crenshaw/Fresenius scenario named in the original OWNERGAP2 ticket:
  `CRENSHAW MOB LLC` (F1) resolves; `FRESENIUS MEDICAL CARE` (L1) is excluded.
- An untyped `state_class` is never admitted as the owner — fails safe, never open.
- Multi-account ambiguity among two different commercial owners refuses (`needs_parcel_discriminator`),
  never guesses.
- The FM 1960 / Cypress Creek Pkwy alias (from `ownergap2-address-match.js::STREET_ALIASES`) resolves a
  row filed under either spelling.
- `fetchHarrisPdataForProperty()` queries the stage table via `domainQuery` and fails CLOSED — an
  unreachable Dialysis_DB or an empty stage reports `no_staged_rows`/`stage_query_failed`, never a
  fabricated match.

### 4. Loader — `scripts/hcad-pdata-load.mjs`

Operator-facing CLI. Accepts a **LOCAL path** — a downloaded `Real_acct_owner.zip`, an already-extracted
`real_acct.txt`, or a directory containing either — so it needs no live internet access to run. Dry-run
by default; `--apply` writes. `owners.txt` (if present in the zip/dir or passed via `--owners`) folds a
second owner name into `owner_name_2`, fill-blanks only. Idempotency comes from the DB's
`(acct, file_year)` unique index + `Prefer: resolution=merge-duplicates`.

**Verified against a real, synthetic zip built with `jszip`** (already a transitive dependency, now a
direct one — was already pinned at `^3.10.1` in the lockfile, so this is a stability fix, not a new
install):

```
$ node scripts/hcad-pdata-load.mjs --file /tmp/.../Real_acct_owner.zip --file-year 2026
[hcad-pdata-load] parsed 3 lines -> 2 rows (1 skipped blank/no-acct)
[hcad-pdata-load] commercial (F1/F2/L1/L2) = 2 of 2 -- ... UNVERIFIED against the real codebook PDF
[hcad-pdata-load] DRY RUN -- pass --apply to write to hcad_real_acct_stage.
```

### 5. Wired into the tick handler — `api/_handlers/ownergap2-owner-resolve-tick.js`

For `jurisdiction=harris_tx`, the PDATA stage is now tried FIRST. If it does not resolve (stage empty
for that street, or genuinely unresolved), the pre-existing operator-supplied payload path is tried as
a fallback — kept, never removed, exactly as the ticket asked. No cron is registered; both Harris paths
require an explicit operator-invoked CLI/HTTP call, same as before.

## Tests

`test/ownergap2-harris-hcad-pdata.test.mjs` (21 tests) + `test/hcad-pdata-loader.test.mjs` (4 tests):

- header-driven parsing + refusal on a missing required column
- `raw_row` recoverability
- `owners.txt` folding
- commercial-class filter **positive AND negative control** (F1/F2/L1/L2 in; A1/B/C1 real-residential/
  multifamily/vacant-lot classes explicitly OUT)
- the matcher refusing a Personal-only account
- Commercial preferred over co-located Personal (the exact Crenshaw scenario)
- an untyped `state_class` refused, never admitted
- multi-account ambiguity refused
- the FM 1960/Cypress Creek Pkwy alias
- `stageRowToLocation` fallback behaviour
- provenance-required-to-write, reusing the exact `assertCitation`/`planOwnerWrite` functions the
  existing OWNERGAP2 guard suite already exercises
- loader idempotency: the upsert call shape is identical across two runs of the same parsed rows, the
  `Prefer: resolution=merge-duplicates` header is asserted, a failed chunk is reported not dropped, and
  a 1,200-row export batches at 500/chunk (3 calls) so a large export cannot silently truncate

```
$ node --import ./test/_helpers/net-guard.mjs --test test/ownergap2-harris-hcad-pdata.test.mjs test/hcad-pdata-loader.test.mjs
# tests 25
# pass 25
# fail 0
```

**Full suite, after the change:**

```
# tests 6407
# suites 971
# pass 6401
# fail 0
# cancelled 0
# skipped 6
```

## What remains before a real Harris run (operator steps)

1. Download `Real_acct_owner.zip` from `https://hcad.org/pdata/pdata-property-downloads.html`
   (no login, no CAPTCHA — a plain static-file download).
2. **Recommended**: read `https://hcad.org/assets/uploads/pdf/pdataCodebook.pdf` and confirm the
   `state_class` codes this build assumes are commercial (F1, F2, L1, L2). If the codebook disagrees,
   edit `HCAD_COMMERCIAL_REAL_CLASSES` / `HCAD_COMMERCIAL_PERSONAL_CLASSES` in
   `api/_shared/hcad-pdata-parse.js` — the stage's `raw_row` column means no re-download is needed to
   correct a wrong mapping, only a re-flag.
3. Dry-run the loader: `node scripts/hcad-pdata-load.mjs --file /path/to/Real_acct_owner.zip --file-year 2026`
   — read the printed counts (total rows, commercial rows, a sample row) before trusting anything.
4. Apply: add `--apply`.
5. Redeploy both Railway services and confirm `/version` (per the ticket's §Prohibitions — not done
   here, since nothing shipped that touches a live handler's runtime behavior beyond adding a new
   import; still the correct next step before a real tick).
6. Dry-run the tick: `GET /api/admin?_route=ownergap2-owner-resolve-tick&jurisdiction=harris_tx` — read
   the by-cause table (§4 of the OWNERGAP2 prompt) before a real apply.
7. Real apply: `POST` the same route with `batch_tag=ownergap2_harris_tx_<date>`, then run the six gate
   items from the OWNERGAP2 prompt's §5 (spot-check 5 written owners by hand against the source,
   `recorded_owner_id` before/after, `true_owner_id` untouched, the fabrication-guard positive control
   both ways, `get_property_context` on a newly-resolved property).

No live data exists in this sandbox and none was fabricated — steps 3–7 above are the operator's, not
run here, per the ticket's explicit instruction not to run a real apply.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013sv1ZVaCwgVw88zsbCS76K
