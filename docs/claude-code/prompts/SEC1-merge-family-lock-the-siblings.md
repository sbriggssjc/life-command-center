# SEC1-merge-family — the privilege sweep locked the functions it NAMED; the capability is still open

> **SEC1-property (09-04) locked `{dia,gov}_merge_property_reversible` + `*_unmerge_property`.
> MERGE1-sec (09-05) locked the four fold helpers. Both were correct.** Both enumerated **by name**,
> and a name census structurally cannot find a sibling that does the same thing under a different
> one. Measured live 2026-09-05: **`dia_consolidate_property_reviewed(p_keep_id, p_drop_id, …)` is a
> keep/drop property merge and is anon-executable.**

**Repo:** `life-command-center` · **Domains:** dia (`zqzrriwuavgrquhisnoa`), gov
(`scknotsqkcheojiaewwh`), LCC Opps (`xengecqvemvfknjvbvrq`)
**Canonical pages:** `docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md` (carries the live census);
`CLAUDE.md` §*"SECURITY DEFINER PRIVILEGES — the canonical statement"* — **the mechanism is stated
there ONCE as of 2026-09-05; do not restate it in a migration header, an audit doc, or a fifth
CLAUDE.md section. Point at it.**

---

## 0. Standing rules

- **Revoke in small NAMED batches with a behavioural re-probe after each** (the MERGE1-sec pattern):
  revoke → re-run a real caller inside `BEGIN … ROLLBACK` → confirm it still works → next batch.
  **Never revoke a batch and assert only on the ACL.**
- **Every migration you write here carries its own privilege stanza** — `revoke … from public, anon,
  authenticated` + a `has_function_privilege()` assertion in the same file. The guard
  (`test/sql-definer-privilege-stanza.test.mjs`) will fail you otherwise, which is the point.
- Counts below are dated **2026-09-05**. Re-measure; if yours differ, yours win, and say why.

---

## 1. The population

| function | domain(s) | signature | why it matters |
|---|---|---|---|
| **`dia_consolidate_property_reviewed`** | dia | `(p_keep_id, p_drop_id, p_batch, p_dry_run, p_reason)` | **a keep/drop property merge — the exact capability SEC1-property locked**, under another name |
| `dia_reverse_property_consolidation` | dia | `(p_drop_id, p_batch)` | its paired reversal |
| `dia_merge_twins` | dia | `(p_dry_run, p_mode, p_batch, p_max_miles, p_auto_miles)` | batch twin merge |
| `p31_property_consolidation_apply` | **dia + gov** | `(p_dry_run, p_batch_tag)` | batch consolidation |
| `p31_same_event_sales_apply` | **dia + gov** | `(p_dry_run, p_batch_tag)` | batch sales dedup |
| `gov_truncate_sam_public_staging` | gov | — | a TRUNCATE, anon-callable |
| `gov_apply_om_confirmed_noi`, `gov_match_sam_public_extract`, `gov_pse_propagate_to_sale` | gov | — | mutating; triage with the rest |
| `dia_check_fred_staleness`, `dia_check_market_turnover_batch_retirement`, `dia_check_queue_slas`, `dia_propagate_closed_sales_to_workbook`, `gov_check_queue_slas` | dia/gov | — | monitor/propagation writers; **check whether any is deliberately anon like `compute_feed_freshness` before touching it** |

Live totals: **LCC Opps 196 definer / 89 anon / 62 anon+mutating**, **dia 79 / 13 / 9**,
**gov 54 / 9 / 7**.

⚠️ **A `p_dry_run` default is not a mitigation** — an anon caller passes `false`.

---

## 2. Units

### Unit 1 — the merge family (dia + gov), highest value

Lock the six rows in the first block of §1. **`dia_consolidate_property_reviewed` first** — it is the
one that reproduces a capability already judged to need `service_role`.

**Prove safety the SEC1-property way, per function: find a SIBLING already living under the
constraint on the same code path.** For the consolidation family the sibling is
`dia_merge_property_reversible` — already `service_role`-only and called successfully by the
`property_twin` Decision Center lane through `domainQuery`. If a function has **no** such sibling,
say so and probe its real caller behaviourally instead of assuming.

⚠️ **`supabase-keys.js` documents a fallback to the historically-anon `DIA_SUPABASE_KEY`** when the
service key is unset, so *"the lane is server-mediated"* is **not** evidence on its own. That is the
exact trap SEC1-property avoided; do not walk into it.

### Unit 2 — triage the remaining LCC Opps 62 into a decision, not a sweep

**A blanket revoke is refused** — `compute_feed_freshness` is one counter-example and one is enough.
Produce a surface with, per function: does it take a **table or column name as a parameter**
(dynamic SQL, the MERGE1 severity), does a **PostgREST caller** exist, what does it mutate, and is
there a **deliberate-anon reason** on record.

- ⚠️ **`lcc_apply_cleared_tombstones` is NOT the top of this list, despite the earlier filing.** Its
  dynamic SQL runs over a **hard-coded `VALUES` map of column names**, not a caller-supplied table,
  and it defaults to `p_dry_run => true`. It still mutates mirror columns on `properties` across
  both domains when called with `false`, so it stays in scope — **but a regex over
  `pg_get_functiondef` produced its ranking, and reading the function corrected it. Read before you
  rank.**
- ⚠️ **Zero enumerated PostgREST callers is not proof nothing calls it** (CONTACT1: *a path that
  never runs cannot fail* — and its mirror, a caller you did not enumerate). Prefer a working
  sibling; failing that, probe.

### Unit 3 — close the audit-shaped hole, not just the functions

The reason this unit exists is that **two correct sweeps both enumerated by name.** Ship something
that makes the *capability* question askable next time — at minimum, record in the audit doc how the
family was found (`prosecdef` + `has_function_privilege('anon',…)` + a mutating-statement predicate,
across all three projects) so the next sweep starts from a census rather than a list.

**Do not** build a second guard that duplicates `sql-definer-privilege-stanza`. That one stops *new*
instances at test time; this is about *existing* live grants, which no source-level test can see.

---

## 3. Out of scope

- **No `SECURITY INVOKER` conversions.** Changing the security mode changes what the function can
  read under RLS — a different decision with a different blast radius.
- **No change to `compute_feed_freshness` / `compute_feed_cadence`** on either domain.
- **No retroactive edits to the 219 allowlisted migrations.** They are tracked debt.
- **No merges, consolidations or truncations executed.** This unit changes privileges only.

## 4. Deliverables

1. Migrations locking Unit 1's family, each **carrying its own privilege stanza** (the guard enforces
   this) and each asserting with `has_function_privilege()`.
2. A behavioural re-probe per batch, reported — including the ones that returned "still works".
3. Unit 2's triage surface, with `lcc_apply_cleared_tombstones` placed by what it does rather than
   by the regex that found it.
4. Mutation pass **N/N** on anything new in `test/`, survivors named. ⚠️ **Three guards this week
   were reported at a mutation strength they did not have** (GOVDUP1's "9/9" was 3 assertions;
   MERGE1's had none; SEC1's had none — though SEC1's two-direction positive controls are arguably
   stronger). **Report what you actually ran.**

## 5. Verify on

- `has_function_privilege('anon', …)` **false** and `('service_role', …)` **true** for every function
  locked — asserted, never read off the REVOKE.
- **A real caller of each locked function still works**, proven behaviourally.
- The three-project census re-run: **anon+mutating should fall on dia (9) and gov (7)**; LCC Opps'
  62 moves only as far as Unit 2 decides, and **a decision to leave one anon is a result, not a
  gap** — record the reason.
