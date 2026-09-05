# SEC1-unit2 — two gov functions anyone with the anon key can call, then triage the 62

> **The anon key ships in the browser.** `gov_apply_om_confirmed_noi(p_property_id, p_noi, …)` lets
> an anonymous caller **write an NOI onto any gov property**, and
> `gov_truncate_sam_public_staging()` takes **no arguments and TRUNCATEs**. Those two first; the
> LCC-Opps 62 is a triage, not a sweep.

**Repo:** `life-command-center` · **Domains:** gov (`scknotsqkcheojiaewwh`), dia
(`zqzrriwuavgrquhisnoa`), LCC Opps (`xengecqvemvfknjvbvrq`)
**Canonical pages:** `docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md` (extend it) ·
`CLAUDE.md` §*"SECURITY DEFINER PRIVILEGES — the canonical statement"* — **the mechanism is stated
there ONCE. Point at it; do not restate it in a migration header or a new section.**

---

## 0. Standing rules

- **Small named batches, behavioural re-probe after each** (the MERGE1-sec / SEC1-merge-family
  pattern): revoke → re-run a real caller inside `BEGIN … ROLLBACK` → confirm it still works → next.
  **Never revoke a batch and assert only on the ACL.**
- **Every migration carries its own privilege stanza** — the guard
  (`test/sql-definer-privilege-stanza.test.mjs`) enforces it, and **it worked on its first real
  opportunity** (GOVDUP1-a's two new definer triggers shipped locked). Do not be the first to
  allowlist your way past it.
- **A decision to leave something anon is a RESULT, not a gap** — record the reason.
- Counts dated **2026-09-05**; re-measure and say if yours differ.

---

## 1. Unit 1 — the two sharp gov functions

| function | signature | why now |
|---|---|---|
| **`gov_apply_om_confirmed_noi`** | `(p_property_id bigint, p_noi numeric, p_as_of date, p_sf_file_id text, p_dry_run boolean)` | **anon can write an NOI onto ANY gov property** — a curated financial value, and NOI drives cap rate, which drives the CM book |
| **`gov_truncate_sam_public_staging`** | `()` → jsonb | **no arguments, TRUNCATEs** — nothing for a caller to get wrong |

Also in gov's residue: `gov_match_sam_public_extract(p_dry_run, p_batch)`; and
**`gov_pse_propagate_to_sale` returns `trigger`, so it is NOT RPC-callable** — lock it for tidiness,
not urgency, and say which of the two reasons applies.

**Prove safety by finding a SIBLING already living under the constraint** (SEC1-property's rule), not
from a doc. ⚠️ `supabase-keys.js` documents a fallback to a historically-anon key, so *"it's
server-mediated"* is **not** evidence on its own.

⚠️ **`gov_apply_om_confirmed_noi` is named for the OM intake path — find its real caller before
revoking.** If an edge function or PA flow calls it with the anon key rather than the service key,
the revoke breaks OM confirmation and you will only find out from the operator. **GOVDUP1-a just
proved a caller can live in a DEPLOYED artifact that is not in the repo** (`intake-salesforce` v23
vs a v1-era file): so **enumerate `list_edge_functions` on all three projects and `cron.job` command
text**, not just `api/`.

## 2. Unit 2 — the LCC Opps 62, triaged not swept

**A blanket revoke is refused** — `compute_feed_freshness` is a live counter-example and one is
enough. Produce a surface with, per function: does it take a **table or column name as a parameter**
(the MERGE1 severity), does a **real caller** exist (repo *and* deployed artifacts), what does it
mutate, and is there a **deliberate-anon reason** on record.

- ⚠️ **`lcc_apply_cleared_tombstones` is NOT the top of the list, despite an earlier filing saying
  so.** Its dynamic SQL runs over a **hard-coded `VALUES` map of column names**, not a
  caller-supplied table, and it defaults to `p_dry_run => true`. It still mutates mirror columns on
  `properties` across both domains when called with `false` — in scope, not first. **A regex over
  `pg_get_functiondef` produced that ranking and reading the function corrected it.**
- ⚠️ **The trigger axis is already measured — do not re-spend the query.** `returns trigger` means
  not RPC-callable; **0 of the 62 return trigger**, so it shrinks nothing here (it took gov's 5 to
  4).
- ⚠️ **Four `*_check_*` monitors are the `compute_feed_freshness` SHAPE**
  (`dia_check_fred_staleness`, `dia_check_market_turnover_batch_retirement`,
  `{dia,gov}_check_queue_slas`). A cross-DB pull may read them as anon **by design**. Check each;
  leaving one anon with a stated reason is the right outcome if that is what you find.

## 3. Unit 3 — cheap prevention while you are here

Port GOVDUP1-a's `sf_property_id` pre-link to **dia**. ⚠️ **Sized first, and it is prevention, not
cleanup:** dia's `_new_property` population is **65 rows / 64 distinct `sf_property_id`, exactly ONE
fan-out**, against gov's 53 of 125 — but the writer is live (**15 rows in the last 30 days**, newest
2026-09-03) and has no dedupe. ⚠️ **dia's payload column is `new_value->>'sf_property_id'`, NOT gov's
`source_context`** — a gov-shaped census returns 0 on dia and reads as clean. **Do not budget this as
a cleanup**; if it costs more than a small migration, file it and move on.

---

## 4. Out of scope

- **No `SECURITY INVOKER` conversions** — that changes what a function can read under RLS.
- **No change to `compute_feed_freshness` / `compute_feed_cadence`.**
- **No retroactive edits to the 219 allowlisted migrations.**
- **No new guard duplicating `sql-definer-privilege-stanza`** — that one stops *new* instances at
  test time; this is about *existing live grants*, which no source-level test can see.

## 5. Deliverables

1. Unit 1's functions locked, each with its own stanza and a `has_function_privilege()` assertion,
   **plus a named real caller re-probed after each revoke** — including the ones that returned
   "still works".
2. Unit 2's triage surface, with each of the 62 placed by what it does, and every
   **leave-it-anon** decision carrying a reason.
3. Unit 3 shipped or filed with the cost stated.
4. Mutation pass **N/N**, survivors named. ✅ GOVDUP1-a set the bar at 12/12 RED / 0 survivors —
   match it or say why not.

## 6. Verify on

- `has_function_privilege('anon', …)` **false** / `('service_role', …)` **true** on everything
  locked — asserted, never read off the REVOKE.
- **The census falling by exactly the number locked** (gov anon+mutating 5 → n) — the check that a
  revoke hit its intended population and nothing else.
- **A real caller of each locked function still working**, proven behaviourally.
