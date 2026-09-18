# RECON2-b — `medicare_clinics.status = 'removed'` is not a closure: fix the lease-expiration classifier's evidence before any fleet write

**Filed:** 2026-09-17 (Cowork round 31, from reconciling RECON2 unit 1 / PR #2571). **Owner:** LCC
(`supabase/migrations/dialysis/`, `test/`). **Read first:** `20260917220000_dia_recon2_lease_expiration_confirmation_model.sql`,
`docs/architecture/reconcile-property-spec.md` R5, backlog `RECON2`, STATUS round 31.

## Scott's rule (unchanged)
> Let's only allow leases to go inactive once we have confirmation that the lease expired.

## Measured (Dialysis_DB, Cowork, 2026-09-17 ~22:00 UTC)
- `dia_recon2_classify_expired_leases()` proposes `expired_confirmed` for 1,494 of 2,454 leases; **1,489 of
  those rest on `cms_closure`** = *any* `medicare_clinics` row on the property with `status in
  ('removed','closed','relocated')`.
- `medicare_clinics.status`: `removed` **7,690 of 8,547 rows (90%)**; `closed` 53; `relocated` 35; blank 555;
  `Active`/`active` 209. "removed" is an import/list state, not a closure.
- Of the 1,489 `cms_closure` leases, **1,481 sit on a property whose clinic row has `is_operating = true`**;
  215 have `last_seen_date` in 2026; 161 also have a non-closed clinic row on the same property. The top of
  the list by rent: leases 13217 ($2.40M, DaVita, exp 2026-07-31), 10060, 12369, 6721, 8826 — every one
  `status=removed`, `is_operating=true`. Run as built, the fleet write would have deactivated ~1,480 leases
  on operating clinics — the outcome the rule exists to prevent. Nothing was written; keep it that way.
- The 4 `termination_record` rows: 3 of 4 have an operating clinic on the property (a *prior* lease was
  terminated; the clinic stayed) — evidence the lease ended, fine, but say so in the evidence text.
- `dia_recon2_lease_expiration_state_guard` labels a lease with **NULL `lease_expiration`** `in_term`:
  3,801 rows (2,334 active). Unknown is not in-term.
- `dia_recon2_enqueue_expired_unconfirmed_research(false, 1000)` was run live: 1,000 open `pending_updates`
  rows, **563 of them on leases already `is_active = false`** (superseded history) — the function has no
  `is_active` filter.

## Build
1. **Evidence, redefined.** `cms_closure` requires, for *every* `medicare_clinics` row on the property:
   `is_operating is not true` AND `status in ('closed','relocated')` (never `removed`), and no row with
   `last_seen_date`/`cms_last_checked` newer than the lease expiration showing the clinic alive. First say
   what `status`, `is_operating`, `is_active`, `last_seen_date`, `is_primary_ccn`, `dedup_status` each mean
   and who writes them (file:line) — if two of them disagree for a clinic, that is a **Conflict** row for
   research, not evidence. Add the positive class too: clinic operating at the address past expiration →
   do **not** propose `holdover_confirmed` — **propose `expired_unconfirmed` with evidence note "clinic operating
   (CMS)"**; holdover vs renewal is exactly what research decides.
2. **NULL expiration** → a sixth state `expiration_unknown` (CHECK updated, backfill the 3,801, ledgered).
3. **Worklist hygiene.** Add `l.is_active` to the enqueue function; close the 563 tasks on inactive leases
   as `ignored` with a reason (ledgered, reversible); rank the remainder with "clinic operating" first.
4. Re-run the dry-run; report counts per state × evidence and a fresh **25-row sample** (10/10/5) *in the
   response body as a table* with clinic `is_operating`, `status`, `last_seen_date` beside each row.
5. Tests: a property with one `removed` + operating clinic must classify `expired_unconfirmed`.

## Prohibitions
⛔ No fleet write to `is_active` or to `expired_confirmed`. ⛔ No model. ⛔ STATUS/backlog edits only on
`origin/main` as it is at commit time; label your STATUS entry **(CC)**, not "(Cowork)", and do not take a
Cowork round number. **Parked:** one line each.
