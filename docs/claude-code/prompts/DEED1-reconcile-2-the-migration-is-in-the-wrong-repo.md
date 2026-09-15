# DEED1-reconcile-2 — the reconciliation migration landed in the wrong repository

**Filed:** 2026-09-15 (Cowork), verified live.
**Follows:** `DEED1-reconcile-the-migration-that-was-never-written.md`, whose live work was correct.

## The round itself was done correctly

Verified against Dialysis_DB (`zqzrriwuavgrquhisnoa`), not the summary. All seven checks reproduce
**identically** after the reconcile, which is exactly the requirement — a reconciliation that changes
behavior is a bug:

| check | value |
|---|---|
| `auto_fixable` total | **4** (deed_newer_stale 1, stale_seller 3) |
| the 4 bad rows (23902, 27709, 27042, 29087) | **0** auto_fixable |
| the 4 good rows (37690, 22702, 27006, 37574) | **4** auto_fixable |
| SMFG pair | `true` |
| unrelated control | `false` |
| `dia_owner_name_alias` rows | **1** (the human-confirmed pairing, intact) |

The migration was emitted from `pg_get_functiondef` / `pg_get_viewdef` rather than retyped, made
idempotent, and applied. The reasoning in the round was sound throughout.

## The defect: it was committed to `sbriggssjc/Dialysis`, not here

`20260915200000_dia_deed1_reconcile_live_drift.sql` is on branch
`claude/trusting-faraday-7mdel3`, PR **#7412**, in the **Dialysis** repo. It does not exist anywhere
in `life-command-center` — confirmed by search.

**So the drift is not closed. It moved.** Rebuilding Dialysis_DB from `life-command-center` still
restores the old comparator and drops the alias table, which was the entire point of the round.

### Why it went wrong — and it is not a careless mistake

The round read a `CLAUDE.md` and followed it. The problem is that **`life-command-center`'s own
`CLAUDE.md` gives two different answers to "who owns Dialysis_DB's schema."**

- **The ownership doctrine table** (the "ONE REPO OWNS EACH DATABASE'S OBJECTS" section) says
  Dialysis_DB → **`life-command-center`**, with an explicit carve-out: *"The Dialysis repo owns its
  CMS/NPI **ingestion** (rows, not schema) — if it needs a schema change, it lands here."* It even
  names the examples: *"operator registry, **aliases**, write guards, comps engine."*
- **The migration-inventory table** further down says Dialysis_DB → **`Dialysis`**, tagged
  👤 *"not formally confirmed by Scott, but the evidence is one-sided."*

`supabase/migrations/dialysis/README.md`, written 2026-09-16, sides with the doctrine and is
unambiguous: *"new dia schema work belongs here, is applied from here, and is live."*

An alias table, a comparator function and an owner-conflict view are **schema**, and are the doctrine
table's own named examples. So the doctrine is right and the inventory line is the stale one — it was
written as an inference about *where migration FILES currently sit*, which is a different question
from *who owns the objects*, and the two got recorded in the same file as if they were the same
claim.

## Scope

1. **Port the migration into `life-command-center`** at
   `supabase/migrations/dialysis/20260915200000_dia_deed1_reconcile_live_drift.sql`, byte-identical
   to what was applied. Do not re-derive it; it is already correct and already live.
2. **Close Dialysis PR #7412** (or convert it to a no-op), and say in its description that the file
   moved to `life-command-center` per that repo's ownership doctrine. ⚠️ Leaving it open is the
   dangerous outcome: a dia migration sitting in a repo that does not own those objects can be
   re-applied from there later and overwrite a running object — the precise hazard the `government/`
   retirement (I16) was created to prevent.
3. **Fix the contradiction in `CLAUDE.md`.** The inventory line for Dialysis_DB must stop reading as
   an ownership verdict. State the two facts separately: the Dialysis repo *carries a large historical
   migration set*, and `life-command-center` *owns the schema objects*. Cross-reference
   `supabase/migrations/dialysis/README.md` so the next reader lands on the unambiguous page.
4. **Re-verify after porting** — the same seven checks, unchanged.

## Prohibitions

- ⛔ Do not re-apply anything to Dialysis_DB. The objects are already correct and verified; this is a
  file-location fix, not a database change.
- ⛔ Do not resolve the contradiction by changing the doctrine table. 👤 Formally confirming
  Dialysis_DB's owner is **Scott's call**, and the doctrine + the dia README already agree; the
  inventory line is what is out of step.
- ⛔ Do not delete or rewrite `supabase/migrations/dialysis/README.md` — it is the page that got this
  right.
