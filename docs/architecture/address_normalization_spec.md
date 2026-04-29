# Address Normalization Spec

**Canonical rules for USPS-style address normalization across the
Dialysis and Government domain databases.**

The same rules are implemented as two SQL functions on two separate
Supabase projects:

| Database | Function name | Migration of record |
|----------|---------------|---------------------|
| Dialysis | `dia.dia_normalize_address(text)` | `Dialysis/supabase/migrations/20260429220000_property_link_normalize_address_and_singletons.sql` |
| Government | `gov.normalize_address_txt(text)` | `government-lease/sql/20260429_gov_pending_orphan_sweep.sql` |

These two functions **must stay byte-equivalent** — anywhere we
normalize, we want both domains to produce identical canonical forms,
otherwise cross-domain matching (e.g. a CMS clinic whose address came
from one source vs a property whose address came from another) will
fail silently.

## Why two copies instead of one

The Dialysis and Government databases live in separate Supabase
projects with separate PostgREST endpoints. Cross-database function
calls would require Postgres FDW or HTTP RPC — both significantly
heavier than a duplicated function definition.

Tradeoff accepted: drift risk, mitigated by the cross-link `COMMENT`
on each function and the drift-check below.

## Canonical rules (in order)

The function takes `text` and returns `text`. Order matters because
later substitutions can interact with earlier ones (e.g. directionals
must run before street types so `north drive` becomes `n dr`, not
`n drive` then `n dr`).

### 1. Lowercase

```
input  : "35 WEST LAKESHORE DRIVE"
output : "35 west lakeshore drive"
```

### 2. Punctuation strip

Remove `.,;:` (dots, commas, semicolons, colons). Apostrophes,
hyphens, slashes, and the `#` (suite indicator) are preserved.

```
input  : "1234 Main St., Apt. 5"
output : "1234 main st apt 5"
```

### 3. Whitespace collapse

Multi-space runs → single space; trim leading/trailing.

### 4. Directionals (run BEFORE street suffixes)

| Long form     | Short |
|---------------|-------|
| `northeast`   | `ne`  |
| `northwest`   | `nw`  |
| `southeast`   | `se`  |
| `southwest`   | `sw`  |
| `north`       | `n`   |
| `south`       | `s`   |
| `east`        | `e`   |
| `west`        | `w`   |

Two-word forms (`northeast` etc.) must run before single-word forms,
otherwise `north` would consume the prefix of `northeast`.

### 5. USPS street suffixes (Pub 28)

| Long form     | Short  |
|---------------|--------|
| `boulevard`   | `blvd` |
| `avenue`      | `ave`  |
| `street`      | `st`   |
| `drive`       | `dr`   |
| `road`        | `rd`   |
| `highway`     | `hwy`  |
| `lane`        | `ln`   |
| `court`       | `ct`   |
| `circle`      | `cir`  |
| `parkway`     | `pkwy` |
| `place`       | `pl`   |
| `plaza`       | `plz`  |
| `square`      | `sq`   |
| `terrace`     | `ter`  |
| `trail`       | `trl`  |
| `alley`       | `aly`  |
| `expressway`  | `expy` |
| `freeway`     | `fwy`  |
| `turnpike`    | `tpke` |
| `center`      | `ctr`  |

### 6. Unit designators

| Long form     | Short  |
|---------------|--------|
| `suite`       | `ste`  |
| `apartment`   | `apt`  |
| `building`    | `bldg` |
| `floor`       | `fl`   |
| `room`        | `rm`   |

### 7. Final whitespace cleanup

Collapse and trim again (in case any substitution introduced doubles).

## Examples

| Input                                   | Output                       |
|-----------------------------------------|------------------------------|
| `35 WEST LAKESHORE DRIVE`               | `35 w lakeshore dr`          |
| `35 W. Lakeshore Dr.`                   | `35 w lakeshore dr`          |
| `2149 E WARNER RD STE 109`              | `2149 e warner rd ste 109`   |
| `2149 East Warner Road Suite 109`       | `2149 e warner rd ste 109`   |
| `100 N. Main Street, Building A`        | `100 n main st bldg a`       |

## Adding a new rule

1. Update **both** SQL function bodies (Dialysis + Government).
2. Update the table above so this doc tracks the rules.
3. Update the `COMMENT` on both functions if the cross-link wording
   needs to change.
4. Run the drift check to confirm parity:

```sql
-- On each DB:
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('dia_normalize_address', 'normalize_address_txt');

-- Compare results manually (function name will differ but body should match).
```

## Why no GovBot/DialysisGPT-side normalize?

LCC clients (browser JS) don't normalize before querying — they pass
raw user input to the DB and let SQL functions normalize on read.
This avoids the third copy of the rules in client code. JS-side
normalization should only be added if a client needs to display
normalized addresses for preview purposes.

## Drift detection

A monthly cron should compare the two function bodies after stripping
the function name from the source. Drift means the recurring
auto-link cron in dia + the matcher in gov will start producing
different canonical forms for identical input — silent match-quality
regression.

```sql
-- TODO: add this as a scheduled check that posts to LCC ops if
-- the canonical-rule MD5 differs between DBs.
```

---

*Last sync verified: 2026-04-29. Both functions byte-equivalent at
this date.*
