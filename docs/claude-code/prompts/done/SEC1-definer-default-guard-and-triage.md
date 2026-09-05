# SEC1-definer-default — stop re-learning that a new SECURITY DEFINER function is anon-executable

> **The rule has been paid for FOUR times in nine days and nothing enforces it.** B6d
> (`compute_feed_cadence`) → OCR2 (`<dom>_merge_document_extracted_data`) → ADDR1b
> (`gov_merge_property_apply`) → **MERGE1**, where the same PR that fixed a data-loss defect
> shipped four destructive definer helpers reachable by `anon`. Each was found by a human reading
> privileges after the fact. **This unit builds the thing that finds it before merge.**

**Repo:** `life-command-center` · **Domains:** LCC Opps (`xengecqvemvfknjvbvrq`), dia
(`zqzrriwuavgrquhisnoa`), gov (`scknotsqkcheojiaewwh`)
**Canonical page:** create or extend the SEC1 page; `CLAUDE.md` already carries the mechanism twice
(B6d and OCR2) — **do not add a third copy, point at one.**

---

## 0. Standing rules

- **Nothing is revoked in Unit 1.** Build the guard first; a guard that lands alongside a batch of
  revokes cannot tell you which revoke broke something.
- Every count below is dated **2026-09-05** and is a hypothesis to re-measure.
- The guard **strips comments then blanks string literals** before matching (OCR1c ordering — and
  it matters acutely here, because a migration that explains this rule in its own header will
  otherwise satisfy a grep for the fix).
- ⚠️ **Report the mutation pass as N/N with any survivor named.** Two guards shipped this week
  reporting a strength they did not have (see **MERGE1-guard-mutations**); this one guards a
  *security* invariant, so an untested assertion is worse than none.

---

## 1. The mechanism, stated once (do not re-derive it)

Postgres grants `EXECUTE` to **`PUBLIC`** on every newly created function. Supabase additionally
ships `ALTER DEFAULT PRIVILEGES` granting `EXECUTE` to **`anon` and `authenticated` explicitly**.
So a fresh `SECURITY DEFINER` function is reachable by an anonymous caller through **two independent
grants**, and:

- `REVOKE ... FROM public` alone is a **no-op for the two roles that matter** (OCR2's finding)
- `REVOKE ... FROM anon, authenticated` alone leaves the **PUBLIC** grant standing (B6d's finding)

**Revoke from all three, then ASSERT with `has_function_privilege()`** — never read the privilege off
the `REVOKE` you just wrote. A **VIEW** gets no default PUBLIC grant, which is why B6d's view half
was effective and its function half was not.

---

## 2. Size (2026-09-05, re-measure)

**Source side** — migrations under `supabase/migrations/**`:

| | count |
|---|---:|
| migrations creating a `SECURITY DEFINER` function | 236 |
| …carrying **no** `revoke` stanza at all | **154** |

**Live side** — LCC Opps `public` schema:

| | count |
|---|---:|
| `SECURITY DEFINER` functions | 196 |
| …executable by `anon` | **89** |
| …anon **and** containing a mutating statement | **62** |
| …anon **and** mutating **and** using `execute format` (dynamic SQL) | **1** — `lcc_apply_cleared_tombstones` |

Re-run the same three counts on dia and gov; SEC1-wider measured **dia 13 / gov 9** definer functions
anon-executable on 2026-09-05, before MERGE1 added and then removed four.

---

## 3. Units

### Unit 1 — the guard (build this first, revoke nothing)

`test/sql-definer-privilege-stanza.test.mjs`. For every `.sql` under `supabase/migrations/**` that
creates or replaces a `SECURITY DEFINER` function, require **both**:

1. a `revoke` naming **all three** of `public`, `anon`, `authenticated` for that function, and
2. an assertion using `has_function_privilege(` in the same file.

**⚠️ The two hard parts, and neither is the regex:**

- **The 154 pre-existing offenders must not make the guard red on day one** — a guard that is red on
  every run is a badge people learn to merge past, which is exactly the N9 failure this repo already
  paid for (`test-suite.yml` was never green once on `main`). **Pin the existing population in an
  explicit allowlist keyed by FILE PATH**, and make a **stale allowlist entry also fail** so the list
  cannot rot into a lie (the `frontend-duplicate-definitions` pattern). New migrations are guarded;
  old ones are a tracked debt with a number.
- **Exempt the DELIBERATE anon grants BY NAME, never by weakening the pattern.**
  `compute_feed_freshness` is anon-executable **by design on both domains** — the LCC cross-DB pull
  reads `v_feed_freshness` as anon, and revoking it silently blinds the freshness monitor. An
  exemption is a named row with a reason, and **the reason is part of the test**. Weakening the
  pattern to "not fire on this one" is how a detector starts returning comfortable zeros (P182).

The guard must go **RED on the pre-fix MERGE1 migration** (`20260905120000_*_merge1_fold_on_collision.sql`
before its `20260905130000_*` companion existed) — that is its positive control, and it is a real
historical file, not a synthetic one.

### Unit 2 — triage the 62, do not sweep them

**A blanket revoke is refused.** SEC1-wider already established that `compute_feed_freshness` breaks
if swept, and one counter-example is enough to make a sweep the wrong instrument. Instead, classify
the 62 anon-executable mutating definer functions on LCC Opps into a review surface with, per
function: whether it takes a **table or column name as a parameter** (dynamic SQL — the MERGE1
shape, and the highest severity), whether any **PostgREST caller** exists, and what it mutates.

- **Start with `lcc_apply_cleared_tombstones`** — the one function that is anon + mutating + dynamic
  SQL. Read what it does before proposing anything.
- ⚠️ **A censused zero PostgREST callers is not proof nothing calls it** (CONTACT1's lesson: *a path
  that never runs cannot fail*, and the mirror — a caller you did not enumerate). **Prove the
  constraint is safe the SEC1-property way: find a SIBLING already living under it** on the same
  code path, rather than reasoning from a doc or a grep.
- Revoke in **small named batches with a behavioural re-probe after each**, exactly as MERGE1-sec
  did (revoke → re-run the caller inside `BEGIN … ROLLBACK` → confirm it still works). Never revoke
  and assert only on the ACL.

### Unit 3 — one canonical home

`CLAUDE.md` states this mechanism twice already (B6d's §, OCR2's §) and is about to state it a
third time. **Consolidate to one section, leave pointers at the other two**, and record the
four-instance history so the next reader sees the pattern rather than one anecdote.

---

## 4. Out of scope

- **No revokes in Unit 1.** The guard ships alone and green.
- **No change to `compute_feed_freshness`** on either domain.
- **No `SECURITY INVOKER` conversions.** Changing a function's security mode changes what it can
  read under RLS — a different decision with different blast radius.
- **No retroactive migration edits** to the 154. They are allowlisted debt, not a rewrite.

## 5. Deliverables

1. The guard, green on `main`, with the pre-fix MERGE1 migration as a **named positive control**.
2. The allowlist of 154 (or your re-measured count) with stale entries failing.
3. The Unit 2 triage surface + a read of `lcc_apply_cleared_tombstones` on named rows.
4. Mutation pass **N/N**, survivors named.

## 6. Verify on

- **The guard is RED on the pre-fix MERGE1 migration and GREEN on `main`** — both, or it proves
  nothing. A guard that has never been red is not known to work.
- **The allowlist count**, not the pass/fail — a green run with 154 exemptions and a green run with
  0 mean opposite things.
- `has_function_privilege('anon', …)` on any function Unit 2 touches, **before and after**, plus a
  behavioural re-probe of a real caller.
