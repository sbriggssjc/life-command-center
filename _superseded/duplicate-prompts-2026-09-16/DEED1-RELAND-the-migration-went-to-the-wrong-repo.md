# DEED1-RELAND — the reconciliation migration is real, correct, and in the wrong repository

## What happened

DEED1-reconcile asked for a migration that captures three objects which were changed
live on Dialysis_DB but exist in no migration file. CC wrote it, applied it, and
verified it — **and committed it to the `Dialysis` repo** (branch
`claude/trusting-faraday-7mdel3`, PR **#7412**), on the strength of that repo's own
`CLAUDE.md` saying *"Dialysis owns `supabase/migrations/*.sql`."*

**The work is correct.** Cowork re-verified every claim against the live database on
2026-09-16, independently of the response:

| check | live |
|---|---|
| `public.dia_owner_name_alias` exists | **true**, **1** row |
| `dia_owner_share_significant_token(text,text)` | present |
| financing-instrument regex in `v_owner_source_conflict` | present |
| `auto_fixable` total | **4** |

Nothing about the SQL needs redoing. The problem is only where the file lives.

## Why that is wrong here

`life-command-center/CLAUDE.md`, the **ONE REPO OWNS EACH DATABASE'S OBJECTS** table
(Scott's decision, 2026-09-12), line 375:

> | Dialysis_DB | **`life-command-center`** | where the work happens: operator registry,
> aliases, write guards, comps engine, market-brief producers. The Dialysis repo owns its
> CMS/NPI **ingestion** (rows, not schema) — **if it needs a schema change, it lands here** |

This migration is a schema change to Dialysis_DB: a new **table**, a function body, and a
view body. Under Scott's decision it lands in `life-command-center`. And an **alias table**
is squarely "aliases", which that row names explicitly.

⚠️ **So the drift is not closed, it moved.** Rebuilding Dialysis_DB from
`life-command-center` still restores the old comparator and the old regex, and still drops
`dia_owner_name_alias` entirely. That was the whole point of the reconcile.

⚠️ **And no detector covers it.** DEPLOY2's `migration_unapplied` enumerates files and
probes the DB — with no file in this repo there is nothing to enumerate. CC identified this
itself. It is the **DEPLOY3-unmerged** shape (applied to production, absent from git), now
for the fifth time, and the first involving a table.

## What to do

### 1. Re-land the migration in THIS repo

Author it at `supabase/migrations/dialysis/`, emitting DDL **from the live objects**
(`pg_get_functiondef`, `pg_get_viewdef`, `information_schema`) — **not** retyped from the
response, and **not** copied by hand out of the Dialysis repo's copy.

⚠️ **This is not fussiness.** The view body is **4,747 characters and contains `\m` / `\M`
word-boundary escapes**. Those escape sequences are ambiguous when read back through a
tool boundary, and a silently wrong regex changes which rows auto-fix — which is the exact
behaviour this migration exists to freeze. Emit; do not transcribe.

Requirements, unchanged from the original reconcile:

* Idempotent: `CREATE TABLE IF NOT EXISTS`, guarded `INSERT ... ON CONFLICT DO NOTHING`,
  `CREATE OR REPLACE` for the function and view.
* Preserve the alias row's `notes` **verbatim** — the provenance ("Human-confirmed pairing,
  not inferred") is the point of the row.
* The `UNIQUE (alias_token, canonical_token)` constraint already exists as a table
  constraint, not a separate index. Reproduce it as a table constraint; say so.
* Header states plainly that it was generated from live objects to close a drift, and is
  **not** the original authored migration.

### 2. Prove it changed nothing — with checksums, not adjectives

A reconciliation migration that alters behaviour is a bug. Cowork captured these from the
live database on 2026-09-16, **before** any re-land:

| object | `md5(...)` | length |
|---|---|---|
| `pg_get_viewdef('public.v_owner_source_conflict')` | `9fc5aa3f824b125853b3ac8c8a8388f1` | 4747 |
| `pg_get_functiondef(dia_owner_share_significant_token)` | `72b48cd949db4de5502812920b2e5dd0` | 2183 |

**After applying, both md5s must be unchanged.** A differing hash means the emit-and-replay
round trip altered the body — most likely the regex escaping — and is a **stop**, not a
cosmetic difference. Report both hashes in your response whether they match or not.

Also re-confirm: `auto_fixable` total **4**; the 4 bad rows (23902, 27709, 27042, 29087)
still **0** auto-fixable; the 4 good rows (37690, 22702, 27006, 37574) still **4**
(positive control — the guards must not have "fixed" things by excluding everything);
`dia_owner_share_significant_token('Sumitomo Bank Leasing And Finance Inc','SMFG')` →
**true**; an unrelated pair → **false**.

### 3. Resolve the doctrine conflict — do not just work around it

The two repos' `CLAUDE.md` files **contradict each other** about who owns Dialysis_DB
schema, and CC followed the other one in good faith. Left alone this recurs.

👤 **Scott decides; this prompt does not.** Report the conflict plainly and file a backlog
row (**DIA-OWNERSHIP-CONFLICT**) naming both texts and both locations. State what should
happen to Dialysis **PR #7412** — Cowork's read is that it should be **closed unmerged**,
with a comment pointing at the LCC migration, so one database does not end up with two
authoritative migration histories. ⛔ **Do not close or merge that PR yourself**, and do
not edit the Dialysis repo's `CLAUDE.md` from here.

## Prohibitions

* ⛔ Change no behaviour. If you find something worth fixing, file it.
* ⛔ Add no further `dia_owner_name_alias` rows. An alias asserted without human
  confirmation turns a blind comparator into a confidently wrong one.
* ⛔ Do not widen the deed-recency window — that is **DEED2** and it is blocked.
* ⛔ Do not delete or rewrite anything in the Dialysis repo.

## Deliverables

* `supabase/migrations/dialysis/` — the re-landed migration.
* `docs/os/PLANNED-BACKLOG.md` — update **DEED1**, file **DIA-OWNERSHIP-CONFLICT** 👤.
  Surgical row edits only.
* `docs/claude-code/STATUS.md` — entry below the `---` after the Open-threads table.

## Reporting

State: both md5s after applying and whether they matched; the seven behaviour checks; that
you did not touch the Dialysis repo; and the ownership conflict as an open decision for
Scott. If any step was skipped, emit that it was skipped.
