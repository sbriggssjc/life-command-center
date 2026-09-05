# SEC1-definer-default — anon-executable SECURITY DEFINER triage (2026-09-05)

**Status: guard built (Unit 1, shipped); this doc is the light-touch Unit 2 note — a
starting list for an operator to verify live, not a completed audit.** No live database
was queried to produce this file (the sandbox that built the guard has no Supabase
credentials); everything below is drawn from what CLAUDE.md and the repo's migration
history already say. Every named function needs a live
`has_function_privilege('anon', oid, 'EXECUTE')` check before anyone acts on it.

## What's actually new here

**Unit 1 — the guard.** `test/sql-definer-privilege-stanza.test.mjs` scans every `.sql`
file under `supabase/migrations/**` (root + `dialysis/` + `government/`) for a migration
that creates a `SECURITY DEFINER` function, and requires — in the SAME file — both a
`revoke ... from public, anon, authenticated` statement and a `has_function_privilege(`
assertion. **219 of 220** such migrations in the repo predate this rule and are carried
on a file-path ALLOWLIST (with two deliberate exemptions named below); the guard's job
from here is to stop that count growing, not to retroactively fix 219 files.

The mechanism (revoke from all three roles, assert with `has_function_privilege()`,
never trust the REVOKE statement as proof) is already documented twice in CLAUDE.md —
the **B6d** `compute_feed_cadence`/`compute_feed_freshness` section and the **OCR2**
section — and is not repeated here.

## Known anon-executable mutating SECURITY DEFINER functions (from CLAUDE.md, unverified live)

- **`lcc_apply_cleared_tombstones`** (LCC Opps) — named directly in this task's spec as
  the one anon-executable, mutating, dynamic-SQL function on LCC Opps worth checking
  first. Not independently re-confirmed here; verify with
  `has_function_privilege('anon', 'public.lcc_apply_cleared_tombstones'::regproc, 'EXECUTE')`
  (adjust the signature if it's overloaded) before treating this as settled.
- **`gov_merge_property_apply`** — CLAUDE.md's ADDR1b-merge section: renamed from an
  older name, and the RENAME landed **without** re-applying the revoke — the new name
  stayed `anon`/`authenticated` executable while dia's equivalent was already locked.
  Fixed per that section's dated note, but re-verify live given how many times this
  specific mistake (porting a function without porting its privileges) has recurred.
- **`_dia_merge_fold_one_row` / `dia_merge_fold_table`** and their gov twins
  (**MERGE1 / MERGE1-sec**) — shipped anon-executable in
  `20260905120000_{dia,gov}_merge1_fold_on_collision.sql`, fixed 10 minutes later in
  `20260905130000_{dia,gov}_merge1_fold_function_privileges.sql`. These are the guard's
  own positive control (Unit 1's test file asserts the follow-up migrations satisfy the
  stanza) — they are the reason this task exists, not new information, but worth
  re-verifying live since the fix migration must actually have been APPLIED (a DB
  migration applies instantly once run, but "committed to the repo" and "run against the
  live database" are two different facts — see CLAUDE.md's "merged is not running" /
  "running but not merged" doctrine).
- **`lcc_p195_unmerge` / `lcc_unmerge_entity` / `lcc_a2a_unmerge`** — CLAUDE.md's ENTC
  section says these three were narrowed to `service_role` on 2026-09-03, with `anon`/
  `authenticated` revoked from both the `public` grant and the explicit per-role grants,
  and asserted with `has_function_privilege()`. Recorded as fixed there; still worth a
  live spot-check given the pattern's recurrence rate in this repo.

## Deliberately anon-executable — do not "fix" these

- **`compute_feed_freshness`** / **`compute_feed_cadence`** (gov + dia) — the LCC
  cross-DB pull reads `v_feed_freshness` as `anon`, and revoking that grant would
  silently blind the freshness monitor (CLAUDE.md, B6d section). Both are named in the
  guard's ALLOWLIST with this exact reason so nobody "completes" the sweep by locking
  them down.

---

# ✅ THE LIVE CENSUS THIS DOC ASKED FOR — measured from Cowork, 2026-09-05

Everything above was written without DB access and correctly flagged itself as unverified. The
three-project census follows. **Re-measure before quoting; these are dated.**

| project | `SECURITY DEFINER` fns | anon-executable | …and mutating | …and dynamic SQL |
|---|---:|---:|---:|---:|
| **LCC Opps** `xengecqvemvfknjvbvrq` | 196 | **89** | **62** | **1** |
| **dia** `zqzrriwuavgrquhisnoa` | 79 | 13 | **9** | 0 |
| **gov** `scknotsqkcheojiaewwh` | 54 | 9 | **7** | 0 |

**Spot-checks the doc asked for, all confirming what it recorded:** the four MERGE1 fold helpers
are locked on both domains (`anon` false, `authenticated` false, `service_role` true,
`proacl = {postgres=X,service_role=X}`); `gov_merge_property_apply` is locked; the three ENTC
unmerge functions are locked. `compute_feed_freshness` remains anon on both domains **by design**.

## 🚨 The finding: the property-merge family is only HALF locked

SEC1-property locked `{dia,gov}_merge_property_reversible` + `*_unmerge_property`; MERGE1-sec locked
the four fold helpers. **The same capability is still anon-executable under other names:**

| function | domain | signature | note |
|---|---|---|---|
| **`dia_consolidate_property_reviewed`** | dia | `(p_keep_id, p_drop_id, p_batch, p_dry_run, p_reason)` | **keep/drop property merge — the exact capability SEC1-property locked**, reachable by anon under a different name |
| `dia_reverse_property_consolidation` | dia | `(p_drop_id, p_batch)` | the paired reversal |
| `dia_merge_twins` | dia | `(p_dry_run, p_mode, p_batch, p_max_miles, p_auto_miles)` | batch twin merge |
| `p31_property_consolidation_apply` | **dia + gov** | `(p_dry_run, p_batch_tag)` | batch consolidation |
| `p31_same_event_sales_apply` | **dia + gov** | `(p_dry_run, p_batch_tag)` | batch sales dedup |
| `gov_truncate_sam_public_staging` | gov | — | a TRUNCATE, anon-callable |

⚠️ **This is the ADDR1b lesson at the level of the AUDIT rather than the function.** ADDR1b recorded
*"porting a function carries its logic, not its privileges"*; SEC1-property then enumerated **by
name** and locked what it named. **A capability census would have caught these; a name census could
not.** Before declaring any privilege sweep complete, ask *what else can do this same thing?* rather
than *did I lock the functions on my list?*

Mitigating, and it must be said: most of these default to `p_dry_run` and several are reversal or
review paths. **None is a reason to leave them anon** — an anon caller passes `false`.

## ⚠️ Correction to the filing prompt: `lcc_apply_cleared_tombstones` is NOT the MERGE1 shape

The SEC1 prompt called it *"the one function that is anon + mutating + dynamic SQL — the MERGE1
shape"* and told the next unit to start there. **Read live, that is wrong in the important half.**
Its dynamic SQL is built over a **hard-coded `VALUES` map of column names**, not a caller-supplied
table — so an anon caller cannot point it at an arbitrary table, which was the whole reason the
MERGE1 helpers were severe. It also defaults to **`p_dry_run => true`**.

It still mutates mirror columns across dia/gov `properties` when called with `false`, so it stays on
the list — but **at the severity of the family above, not ahead of it.** *A shape matched by a
`pg_get_functiondef` regex is a hypothesis; read the function before ranking it.*

## What this doc is NOT

> ✅ **The gap this section describes was closed the same day — see "THE LIVE CENSUS THIS DOC
> ASKED FOR" above.** The text below is kept because naming the gap precisely is what made it
> cheap to close.

It is not a census of every SECURITY DEFINER function in either live database (LCC
Opps / dia / gov) — that needs Supabase credentials and a proper query against
`pg_proc`/`pg_namespace`/`has_function_privilege()`, which this sandbox cannot run. The
219-entry ALLOWLIST in `test/sql-definer-privilege-stanza.test.mjs` is the closest thing
to a full list of *migrations* that never shipped the stanza; whether the function each
one creates is still live, still anon-executable, and still mutating (vs. read-only,
vs. already re-locked by a later un-triaged migration) is exactly what an operator with
live DB access needs to check next, function by function, starting with the ones named
above.

## ✅ Unit 1 SHIPPED, same day — the property-merge family is now fully locked

Migrations `supabase/migrations/dialysis/20260905120000_dia_sec1_merge_family_lockdown.sql` and
`supabase/migrations/government/20260905120000_gov_sec1_merge_family_lockdown.sql`, applied live.

Revoked `execute` from `public, anon, authenticated` on:

- dia: `dia_consolidate_property_reviewed(bigint,bigint,text,boolean,text)`,
  `dia_reverse_property_consolidation(bigint,text)`,
  `dia_merge_twins(boolean,text,integer,numeric,numeric)`,
  `p31_property_consolidation_apply(boolean,text)`, `p31_same_event_sales_apply(boolean,text)`
- gov: `p31_property_consolidation_apply(boolean,text,integer)`,
  `p31_same_event_sales_apply(boolean,text)`

**Safety proof, the SEC1-property way — a sibling already living under the constraint on the same
code path**, not a documented claim: `dia_merge_property_reversible`/`dia_unmerge_property` and
`gov_merge_property_apply` were already `service_role`-only and are called successfully by the
`property_twin` lane via `domainQuery` (service key). Re-verified live, post-revoke, with a real
dry-run call as `service_role` — `dia_consolidate_property_reviewed(30746,29713,'sec1_probe',true,
'probe')` returned its normal plan output (fk_moves, would_fill, active_listing_survivor) unchanged;
`p31_same_event_sales_apply(true,'sec1_probe')` on gov likewise. Each migration also carries its own
in-transaction `has_function_privilege()` assertions (anon false / authenticated false / service_role
true) that ran and passed at apply time.

Final census, all seven: `anon_exec=false`, `service_role_exec=true`.

**`gov_truncate_sam_public_staging`** was named in this doc's own table above but is a monitor/staging
TRUNCATE, not a merge-family function — it stays in Unit 2's triage, not Unit 1.

## Unit 2 / Unit 3 — status: triaged, not swept

The LCC Opps 62 (anon + mutating SECURITY DEFINER) were **not** individually classified in this
session — that is a real per-function read (table/column parameter? PostgREST caller? deliberate-anon
precedent?) for 62 functions, not something a name or regex census can responsibly finish inside one
pass. What's confirmed:

- `lcc_apply_cleared_tombstones` is **not** the MERGE1 shape (dynamic SQL over a hard-coded column
  map, not a caller-supplied table) — corrected above; it stays in the queue at ordinary severity,
  not head-of-line.
- `compute_feed_freshness` / `compute_feed_cadence` remain anon **by design** — do not sweep them.
- No blanket revoke was applied to the 62. That refusal is the Unit 2 result for this pass, not a gap
  silently left open: a name/regex census cannot safely rank or clear this list, and doing it properly
  needs the same per-function read this doc gave the merge family.

Unit 3 (closing the audit-shaped hole itself) is partially done: this doc + the census above already
record *how* the family was found (`prosecdef` + `has_function_privilege('anon',…)` +
`pg_get_functiondef ~* mutating-statement` across all three projects), so the next sweep starts from
that method rather than a name list. No new automated guard was built for *existing* live grants
(only `test/sql-definer-privilege-stanza.test.mjs` guards *new* migrations, which is a different
problem) — flagged as open, not attempted, given the scope of this pass.
