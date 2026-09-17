# RECON2 (unit 1) + RECON1-b — a lease goes inactive only on confirmed expiration; finish the Banning clinic

**Filed:** 2026-09-17 (Cowork round 29). **Owner:** LCC (`supabase/migrations/dialysis/`, `api/`, `test/`).
**Read first:** `docs/architecture/reconcile-property-spec.md` (R3, R5 — this round amends both), the
RECON1 migration `20260917180000_dia_recon1_banning_clinic_reconcile.sql` and its follow-up
`20260917213000_dia_recon1_lease_guard_disable_pending_recon2.sql`, backlog rows `RECON1`, `RECON1-b`,
`RECON2`, `docs/claude-code/STATUS.md` rounds 28–29.

## Scott's rule, verbatim (2026-09-17)

> Let's only allow leases to go inactive once we have confirmation that the lease expired. We can leave
> it in an unconfirmed status until further research or evidence updates it.

He also chose: **show him a sample of 25 before anything is written to the fleet.**

## What is true (Dialysis_DB, measured by Cowork 2026-09-17 ~21:15 UTC)

- `leases`: **2,454** rows `is_active = true` with `lease_expiration < current_date`; 0 of them `status = 'holdover'`.
- `leases.status` is free text with no CHECK and no agreed vocabulary. Distinct (status, is_active) today:
  NULL/true 4,955 · `active`/true 1,066 · `Active`/true 402 · `Draft-Commenced`/true 84 · `superseded`/false
  5,483 · `placeholder`/false 317 · `active`/false 274 · NULL/false 228 · plus single digits of `Terminated`
  /true (4), `closed`/true (6), `Closed but Obligated`/true (5), `superseded`/true (5), `MTM`/true (1),
  `Active`/false (5), `Draft`, `placeholder`/true, `superseded_duplicate`. `status` cannot carry the new
  state without first being cleaned — do not overload it.
- RECON1's trigger `trg_dia_recon1_lease_active_guard` flipped `is_active` on expiration date alone. It is
  **disabled** (round 29 migration, applied live); it had flipped 0 rows. It contradicts the rule above.
- Banning (property 29894): leases 23211 / 11734 / 16852 / 13362 all inactive; sale 15042 (2026-09-14,
  3.70% cap) has **no lease behind it on the record**. The OM intake `e26e414f…` carried a lease abstract.
- Sale 15042 holds the literal `Not on file (pending deed)` in `buyer_name` and `seller_name`. The deed
  task was never created: `dia_recon1_run_log` → `task_insert_failed`, `pending_updates_status_check`
  (allowed: new, open, pending_review, retry, needs_match, needs_clarification, unresolved, resolved,
  ignored, skipped, error, quarantined).
- Listing 14798 (Scott's 2026-07-30 listing — the one that sold) reads `superseded`; shell listing 12350
  reads `sold`.

## Build

**1. The expiration-confirmation model (R5, rewritten).** Add to `leases` a dedicated, CHECK-constrained
column — suggested `expiration_state text` ∈ `in_term` | `expired_unconfirmed` | `expired_confirmed` |
`holdover_confirmed` | `renewed_confirmed` — plus `expiration_evidence jsonb` (source, reference, date,
who/what recorded it) and `expiration_state_at`. Rules, all deterministic:
- past `lease_expiration`, no evidence → `expired_unconfirmed`; **`is_active` is not touched.**
- `is_active → false` **only** with evidence: a newer lease on the same property/tenant
  (`parent_lease_id` / supersession), a recorded termination, CMS showing the clinic closed or moved from
  the address, a sale/OM/lease abstract stating the successor lease, or an operator decision in the app.
- evidence of continued occupancy with no new lease → `holdover_confirmed` (stays active).
- Replace the disabled trigger with one that only **sets `expired_unconfirmed`** (never `is_active`), and
  drop the old function. Every state change writes a ledger row (extend `dia_recon1_run_log` or a
  `lease_expiration_ledger`), reversible from `prior_value`.
- Amend `reconcile-property-spec.md` R5 to say this, with Scott's sentence quoted.

**2. Readers.** Rent roll, property context packet, comps/cap-rate paths and the BOV/OM exhibits must
render `expired_unconfirmed` honestly — *"Expired <date> — renewal not on file (unconfirmed)"* — not
"Active" with a flat schedule and not silently dropped. List every reader of `leases.is_active` you find
(`api/`, views, MCP tools) with file:line and what it does today; change only what is needed for the label.

**3. The sample, before any fleet write.** Dry-run the classifier over the 2,454 and produce a table Scott
can read: counts per proposed state and per evidence type, then **25 rows** (stratified: 10 that would go
`expired_confirmed`, 10 `expired_unconfirmed`, 5 `holdover_confirmed`/`renewed_confirmed` if any) with
property, tenant, expiration, the evidence found, proposed state. **Stop there.** The fleet write is a
second run after Scott reads the sample; the round ships the function dry-run-default.

**4. A research worklist.** `expired_unconfirmed` leases become rows in the existing research queue
(review the existing lanes first — `county_records_needed`, the owner-gap lanes — and reuse one), ranked
by property value signals already on file, so "further research or evidence" has a place to land.

**5. RECON1-b — finish Banning, through machinery.** (a) Create the deed task with a valid
`pending_updates` status via the existing task path; (b) set `buyer_name`/`seller_name` on sale 15042
back to NULL and carry "not on file, deed pending" in an explicit field/flag or the task link — amend R3
so no rule ever stores a sentinel in a party-name column; add a test that greps the migrations for it;
(c) make 14798 the `sold` listing and 12350 `superseded`; (d) add the part-1 trace table RECON1 skipped to
the spec; (e) run the OM's lease abstract through the existing extractor path and stage the result for
Scott's confirmation — do not insert a lease he has not confirmed; (f) orphan `ownership_history` 1275
waits for the deed.

## Prohibitions

⛔ No lease goes inactive on date alone — anywhere, including backfills. ⛔ No fleet write in this round;
sample first. ⛔ No guessed evidence; "unconfirmed" is the honest state. ⛔ No model in the classifier.
⛔ Do not overload `leases.status`; cleaning its vocabulary is out of scope (park it). ⛔ Edit `STATUS.md`
and `PLANNED-BACKLOG.md` only as they are on `origin/main` at commit time (⑤-CC) — and do write your
entry and row edit this time. Migrations in `supabase/migrations/dialysis/`, applied via the loop;
redeploy both Railway services if `api/` changes and confirm `/version`.

## Reporting

The reader list (file:line); the classifier's counts; the 25-row sample as a table; Banning before/after
(Available, Recent closed sales, Rent Roll, Ownership, the deed task id); what was skipped and why.
**Parked:** anything noticed out of scope, one line each.
