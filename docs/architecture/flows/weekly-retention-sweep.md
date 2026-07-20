# Flow 4 — Weekly Retention Sweep

Last updated: 2026-07-20
Owner: LCC architecture/audit track (Scott Briggs)
Part of: `closing-the-loop-overview.md` (prompt 3 — mailbox mechanics)
Tenant: `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` (NorthMarq Capital, LLC)
Connector: Office 365 Outlook (Scott's mailbox)

> **This is the ONLY flow that ever deletes** — and only permanently-deletes
> `Processed/Duplicates` items older than 30 days. Everything else it does is a
> **move** (aged `Processed/*` → a single `Archive/LCC-Processed` sink). Build it
> **last** (after Flows 1–3), because it operates on the `Processed/*` tree that
> Flow 1 populates.

## Intent

Keep the `Processed/` tree from growing without bound, on a weekly cadence, with
exactly one destructive action tightly scoped:

- **Permanently delete** items in `Processed/Duplicates` older than **30 days**.
- **Move** items anywhere under `Processed/*` older than **180 days** to a single
  `Archive/LCC-Processed` folder (reversible; never deleted).

## Trigger

- Type: **Recurrence** (scheduled).
- Frequency: **Weekly**, ~**Sunday 03:00 America/Chicago** (low-traffic window).
  Set the time zone in the Recurrence action so DST is handled by PA.
- No inputs — the flow discovers items by folder + received-date.

## Action topology

1. **Compose `AuditLog_start`** — `correlation_id = guid()`,
   `run_started = utcNow()`, and the two cutoffs:
   `dup_cutoff = addDays(utcNow(), -30)`, `archive_cutoff = addDays(utcNow(), -180)`.

2. **Delete branch (the only destructive step, tightly scoped):**
   - `Get emails (V3)` scoped to **`Processed/Duplicates` only**, filtered
     `receivedDateTime lt @{dup_cutoff}`, paged.
   - `Apply to each` → **Delete email (V2)** with the item id.
     Retry: **Exponential, 4×PT10S**.
   - **Guard:** the folder path is a literal constant `Processed/Duplicates` —
     never parameterized, never widened. If the folder can't be resolved, **skip
     the delete branch entirely** (fault branch), never fall back to a broader
     scope.

3. **Archive branch (moves, reversible):**
   - `Get emails (V3)` scoped to the `Processed/*` subfolders **excluding
     `Processed/Duplicates`** (Duplicates is handled by branch 2; don't move a
     duplicate you're about to delete), filtered
     `receivedDateTime lt @{archive_cutoff}`, paged.
   - Ensure `Archive/LCC-Processed` exists (create once if missing).
   - `Apply to each` → **Move email (V2)** to `Archive/LCC-Processed`.
     Retry: **Exponential, 4×PT10S**.

4. **Compose `AuditLog_summary`** — counts: `duplicates_deleted`,
   `aged_moved_to_archive`, plus the `correlation_id`. (Optional: post the summary
   to the shared health/ops channel so the sweep is observable.)

5. **Fault branch** — run-after has-failed/has-timed-out on either branch → shared
   Teams alert with the `correlation_id` and which branch failed. A failed sweep
   is a no-op that alerts, never a partial destructive run left silent.

## Locked constraints (verbatim)

- **"Do not: Set any flow to permanently delete on first pass — only the Weekly
  Retention Sweep deletes, and only from `Processed/Duplicates` after 30 days."**
  This flow is that sweep. The delete branch's folder is a hard-coded
  `Processed/Duplicates`; the 30-day cutoff is a hard-coded 30. No other flow
  deletes.
- The archive branch **moves**, never deletes — `Archive/LCC-Processed` is a
  retention sink, fully reversible.
- **Do not delete from `Processed/*` (non-Duplicates)** — aged non-duplicate items
  are archived (moved), not deleted.

## Observability controls

| Control | How |
|---|---|
| correlation_id | `guid()` first action; on every AuditLog + the fault alert. |
| Exponential 4×PT10S retry | On both Delete email and Move email actions. |
| Dead-letter / fault branch | Step 5; scoped so a failure never silently half-deletes. |
| Honest summary | Step 4 counts deleted vs moved; posted for auditability. |
| Null-safe accessors | Item ids read via `?[…]`; empty result sets are a clean no-op. |

## Verify after build

1. **Seed a test:** put one item in `Processed/Duplicates` with a received date >
   30 days old, and one in `Processed/News` (say) > 180 days old. Run the flow
   **manually**.
2. Confirm the `Processed/Duplicates` test item is **deleted** and the aged
   `Processed/News` item is **moved to `Archive/LCC-Processed`** — and nothing
   else is touched.
3. Confirm a `Processed/Duplicates` item **younger** than 30 days is **not**
   deleted, and a `Processed/*` item younger than 180 days is **not** moved.
4. Confirm the summary counts match, and the fault branch posts on a forced
   failure (e.g. temporarily point the delete branch at a nonexistent folder →
   it skips + alerts, never widens scope).
