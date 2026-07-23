# Flagged-email To-Do cleanup — research + build spec (DESIGN ONLY, not yet approved)

Last updated: 2026-07-23
Owner: LCC architecture/audit track (Scott Briggs)
Status: **PLAN APPROVED (Scott, 2026-07-23) — build in the PA designer, then the
capped-first-run spot-check gates broadening.** No delete has run yet.
Tenant: `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` (NorthMarq Capital, LLC)

## Decisions locked (Scott, 2026-07-23)
- **Cadence:** batched scheduled sweep spread over multiple days (2–5 days) — the
  safe pace, accepted over any one-shot risk.
- **Age guard:** delete only `status = completed` AND **completed 90+ days ago**
  (`cutoff = today − 90d`). Open/incomplete tasks are never touched, on any run.
- **Path:** **PATH B — native To-Do connector** (below). The raw-Graph test is
  **skipped** (tenant blocks Graph app registrations); Path A is retained only as
  a documented fallback if Path B's per-run yield proves too low.

> **This is real personal history (flagged emails going back to 2023), not
> automation junk.** Treat it with far more caution than the "Business
> Development" list wipe. The ONLY thing this cleanup ever deletes is a To-Do
> task that is **BOTH `status = completed` AND completed 90+ days ago**. Open /
> incomplete tasks are never touched, on any run, under any code path.

## Why this exists — the load-bearing constraint

Microsoft auto-creates a native **"Flagged email"** To-Do list whenever any
Outlook message is flagged. It has accumulated **60,520 tasks**. This list is now
load-bearing: **`todo-completion-poll.md` (Flow 6) scans it every 30 minutes** and
matches completed tasks back to `staged` emails by subject
(`linkedResources[0].displayName == subject`). At 60k tasks the poll's per-run
"List to-do's by folder (V2)" fetch is a genuine performance/cost drag, so pruning
the old-completed backlog also directly speeds up the live poll.

Cleanup goal: delete **completed + 90+-day-old** tasks only, leaving the small
recent/open working set the poll actually needs to scan.

---

## PART 1 — Research findings (the three questions)

### Q1. Does Microsoft Graph support server-side `$filter` on `status` + `completedDateTime`? — YES.

`GET /me/todo/lists/{listId}/tasks` supports the `$filter`, `$top`, `$orderby`,
`$count`, `$select`, `$expand` OData parameters. Both target fields are filterable:

- **`status`** is a plain enum on `todoTask` → `status eq 'completed'` works.
- **`completedDateTime`** is a `dateTimeTimeZone` **complex type**; you filter its
  sub-property with a comparison operator (not `eq` on the complex type itself):

  ```
  GET /me/todo/lists/{listId}/tasks
      ?$filter=status eq 'completed' and completedDateTime/dateTime lt '2025-04-24T00:00:00Z'
      &$top=100
  ```

  This complex-type date filter **does work on the To-Do `/tasks` endpoint**
  (confirmed in the field; note To-Do differs from **Planner**, where
  `completedDateTime`/`percentComplete` filters are silently ignored — do not
  reason from Planner behaviour here).

- **Robust fallback** if the complex-type filter ever misbehaves in a given
  environment: filter on **`lastModifiedDateTime`** (a plain `Edm.DateTimeOffset`,
  always filterable) plus `status eq 'completed'`, then re-check `completedDateTime`
  client-side before deleting:

  ```
  ?$filter=status eq 'completed' and lastModifiedDateTime lt '2025-04-24T00:00:00Z'
  ```

  For a completed flagged-email task, `lastModifiedDateTime ≈ completedDateTime`
  unless it was edited after completion, so this is a safe superset to
  client-verify.

- **Paging is server-driven** via `@odata.nextLink` + `$top` (page size). **There
  is no `$skip`** on this endpoint — you cannot random-access page N. You follow
  `@odata.nextLink`, OR (better for a delete sweep) you delete the page you
  fetched, which shrinks the result set so the *next* run's first page surfaces
  the next batch. This "delete shrinks the window" property is what makes the
  batched design below resumable without `$skip`.

### Q2. Does the native "List to-do's by folder (V2)" PA connector action expose a filter? — NO server-side filter.

The Microsoft To-Do (Business) connector's **"List to-do's by folder (V2)"**
action takes only a **To-do list** id and returns the collection (the connector
auto-follows pagination up to its configured threshold). It does **not** expose a
"Filter Query" / OData `$filter` parameter the way SQL / SharePoint / Dataverse
connectors do. That is exactly why the live poll (Flow 6) filters
`status eq 'completed'` **client-side** (a Filter-array data operation over the
connector output), not in the connector.

**Consequence for a 60k cleanup:** to get server-side filtering (fetch ONLY
completed+old, not all 60k), you need a **raw Graph call**, which in PA means
either the generic **HTTP** premium action or the **"HTTP with Microsoft Entra ID
(preauthorized)"** connector / a Graph custom connector — **all of which require an
Azure AD app registration.** Per the repo's standing constraint (see
`todo-completion-poll.md`: *"Northmarq IT blocks Azure AD app registrations, so
there is no Graph service token … this is why the whole system runs on Power
Automate connectors"*), that path is presumed blocked. **→ This is the single
decision that shapes the whole design (Path A vs Path B below): confirm whether
ANY raw-Graph path is available before building.**

### Q3. Power Automate / connector throttling to design around.

- **To-Do (Business) connector**: treat as a **soft ceiling of ~100 API calls per
  60 seconds per connection** (the common M365 personal-productivity connector
  default; the Delete + List actions both count). Exceeding it returns **HTTP 429
  "Rate limit is exceeded. Try again in N seconds."** with a `Retry-After` header.
- **Underlying Graph mailbox throttle** (the harder ceiling): Outlook/Graph applies
  roughly **10,000 requests per 10 minutes per app + mailbox** with **~4 concurrent
  requests max**; over-limit → **429 + Retry-After**.
- **Each task delete = one API call.** 60,520 tasks (say ~55k eligible after the
  90-day/completed filter) is therefore **~55k DELETE calls minimum** — an
  irreducible volume problem no design avoids.
- **Pacing math:** at a deliberately-conservative **~100–150 deletes/minute** (well
  under both ceilings, single concurrency, small delay), 55k deletes ≈ **6–9 hours
  of active API time.** A single flow run cannot safely sustain that (the
  Apply-to-each would ride the connector throttle for hours and risk mid-run 429
  cascades). **→ This MUST be a scheduled flow that deletes a bounded batch per run
  and repeats over multiple runs/days.** At ~500 deletes/run, hourly ⇒ ~4–5 days;
  every-30-min ⇒ ~2–3 days. That multi-day runtime is the tradeoff to confirm with
  Scott.

---

## PART 2 — Design (two paths; pick per Q2 availability)

### Decision gate BEFORE building: is any raw-Graph path available?

**RESOLVED (Scott, 2026-07-23): build PATH B directly — the Graph test is skipped.**
The steps below are retained for reference / a future revisit if Path B's per-run
yield is too low. To revisit, confirm ONE of these works in the tenant (in priority
order):

1. **Microsoft Graph PowerShell** (`Connect-MgGraph -Scopes Tasks.ReadWrite`,
   device-code) — uses a Microsoft **first-party, pre-consented** client, so it
   may work even where custom app registrations are blocked. If it connects and
   `Get-MgUserTodoListTask` returns data → **Path A** (fastest, cleanest).
2. **PA "HTTP with Microsoft Entra ID (preauthorized)"** connector against
   `graph.microsoft.com` — usually needs an app registration → likely blocked.

If neither works → **Path B** (native connector, in Power Automate).

Either path: **completed + 90-day filter, delete-only, bounded batch, repeat,
never touch open tasks.**

---

### PATH A (PREFERRED, if raw Graph is available) — server-side-filtered drain

Cleanest and most efficient: fetch ONLY completed+old tasks, delete a page,
repeat. Because Graph `$filter` narrows server-side, you never enumerate the recent
/ open set at all. Runnable as a one-shot script (a few hours, attended) OR as a
scheduled Graph-HTTP flow; the logic is identical.

Pseudocode (Graph PowerShell / Node / any delegated-Graph runner as Scott):

```
listId   = <resolve 'Flagged email' list — see Path B step 2 for how>
cutoff   = (today − 90 days) as ISO-8601 Z         # e.g. 2025-04-24T00:00:00Z
deleted  = 0 ;  perRunCap = 2000                    # attended one-shot can go higher; a flow keeps this ~500
url = "/me/todo/lists/{listId}/tasks?" +
      "$filter=status eq 'completed' and completedDateTime/dateTime lt '{cutoff}'" +
      "&$top=100&$select=id,status,completedDateTime"

while (url and deleted < perRunCap):
    page = GET url                                  # 1 read
    for task in page.value:
        assert task.status == 'completed'           # belt-and-suspenders
        assert task.completedDateTime.dateTime < cutoff
        DELETE /me/todo/lists/{listId}/tasks/{task.id}   # 1 delete
        deleted += 1
        sleep 300–600 ms                            # pace under the throttle
        on 429: honor Retry-After, then retry the SAME id
    url = page.'@odata.nextLink'                    # server-driven paging; NO $skip
log deleted, remaining-estimate
```

- **Efficiency:** `$filter` means every fetched row is a delete candidate — no
  wasted enumeration of the 5k recent/open tasks the live poll needs.
- **Resumable:** on the next run the same `$filter` re-selects what's left; the
  already-deleted rows are gone. No cursor state to persist.
- **Safety:** re-assert `status`+`completedDateTime` per row before each DELETE
  (never trust the filter alone); honor `Retry-After`; cap per run; log counts.
- **One-shot vs scheduled:** an attended one-shot script can raise `perRunCap` and
  drain 55k in ~2–4 hours at a safe pace with a progress log. If it must live in
  PA, wrap the same loop in a scheduled Graph-HTTP flow at ~500/run.

---

### PATH B (FALLBACK — tenant-compatible, native To-Do connector only)

Used when no raw-Graph path exists (the presumed default). No server-side filter,
so we **over-fetch a bounded page, filter client-side, and delete a capped batch**,
repeating on a schedule. The **delete-shrinks-the-list** property (Q1) advances the
window across runs without `$skip`.

#### Trigger
- **Recurrence** (scheduled). Start **hourly** (or every 30 min once pacing is
  confirmed safe). Set the time zone in the Recurrence action.
- No inputs — the flow discovers tasks by list + status + completedDateTime.

#### Action topology
1. **Compose `AuditLog_start`** — `correlation_id = guid()`,
   `run_started = utcNow()`, `cutoff = addDays(utcNow(), -90)`,
   `per_run_cap = 200` (a variable — start LOW, raise only after a clean run).
2. **Resolve the "Flagged email" list id** — the To-Do (Business) **"Lists"**
   action, filtered/looked-up by `wellknownListName eq 'flaggedEmails'` (**discover
   it each run — never hardcode**; it can differ per environment/account). Take
   that single list's `id`.
3. **List a bounded page** — **"List to-do's by folder (V2)"** on that list.
   **Leave connector pagination at (or near) its DEFAULT** — do **NOT** raise it to
   50k/100k (pulling the whole 60k list into one run is slow + throttle-death). One
   modest page per run is the point.
4. **Filter array (client-side, the eligibility gate)** — keep only items where
   **`status == 'completed'` AND `completedDateTime/dateTime < cutoff`**. This is
   the ONLY place eligibility is decided; both conditions are required. (Blank/absent
   `completedDateTime` ⇒ NOT eligible — a defensive `less(...)` on a null must
   evaluate false; verify in the designer.)
5. **Take the first `per_run_cap` items** — `take(body('Filter'), variables('per_run_cap'))`
   — so a run never deletes more than the cap even if the page is large.
6. **Apply to each** (over the capped, filtered slice) → **"Delete a to-do (V2)"**
   with the task `id`.
   - **Concurrency = 1** (Settings → Concurrency Control OFF, or degree 1) — serial,
     to stay under the throttle.
   - **Add a short delay** action (~0.5–1s) before each Delete, OR a "Delay until"
     pattern, to pace under ~100 calls/60s.
   - **Retry policy: Exponential, 4 × PT10S** on the Delete action (absorbs a 429).
   - **Increment a `deleted` counter.**
7. **Compose `AuditLog_summary`** — `page_size`, `eligible_in_page`,
   `deleted_this_run`, `cutoff`, `correlation_id`. (Optional: post to the shared ops
   channel so the sweep is observable across days.)
8. **Fault branch** — run-after has-failed/has-timed-out on the List or the
   Apply-to-each → shared Teams alert with the `correlation_id`. A failed run is a
   no-op that alerts; nothing is left half-deleted-and-silent.

#### The honest caveat with Path B (state it plainly to Scott)
"List to-do's by folder (V2)" returns from the top of the list in the connector's
default order (not guaranteed oldest-completed-first), and it intermixes open +
completed. So a given run's page may contain only a handful of eligible
(completed+90d) rows → **per-run yield can be low and the drain can take many more
runs than the raw math suggests.** It is still correct and safe — it just may be
slow. Mitigations, in order:
- Run it more frequently (every 30 min) once a clean run is confirmed.
- If yield is persistently poor, that is the signal to revisit **Path A** (a
  one-shot Graph script), which sidesteps ordering entirely.

---

## Safety invariants (BOTH paths — do NOT weaken)
- **Delete only `status == completed` AND `completedDateTime` older than a
  hard-coded 90 days.** Both conditions, every path, every run. Never parameterize
  the "completed" requirement away.
- **Open / incomplete tasks are never enumerated for deletion** (the filter
  excludes them; Path A's `$filter` and Path B's Filter-array both require
  `status == completed`).
- **The "Flagged email" list only** — resolve it via `wellknownListName` each run;
  never hardcode an id; never widen to another list.
- **Bounded per-run cap** + serial deletes + pacing + `Retry-After`/exponential
  retry — so a run can never runaway-delete or trip a throttle cascade.
- **Delete is not reversible** in Graph (a deleted To-Do task does not go to a
  recoverable bin via the API). Mitigate with a **capped first run + spot-check**
  before broadening (see below). Do a small (cap = 25) real run first, eyeball that
  exactly the intended old-completed tasks vanished and nothing recent/open moved,
  THEN raise the cap.
- **Never a single Apply-to-each over 60k+ items** — the throttle-and-timeout
  failure mode the whole design exists to avoid.

## Verify (first real run — capped, then broaden)
1. **Dry-count first (read-only):** run the List + Filter (Path B) OR the `$filter`
   GET with `$count` (Path A) and record how many tasks are eligible
   (completed + 90d). Sanity-check the number against the 60,520 total.
2. **Capped real run (cap = 25):** delete 25, then in the To-Do UI confirm 25
   old-completed flagged tasks are gone and **no open/recent task changed.**
3. **Confirm the live poll still works** — flag a test email, let it stage, complete
   its native task, confirm Flow 6 still files it (the cleanup must not disturb the
   recent working set the poll scans).
4. **Broaden** — raise the cap (e.g. 200–500/run), raise frequency, and let it drain
   over the confirmed multi-day window. Watch the summary counts + fault alerts.
5. **Stop condition** — when a run's `eligible_in_page` is 0 across several
   consecutive runs, the backlog is drained; disable or leave the sweep running as a
   low-cost maintenance job (it then just trims newly-aged-out completed tasks).

## Reversibility / rollback
- The flow itself is deletable/disable-able at any time (turn off the Recurrence).
- Deleted tasks are NOT API-recoverable — hence the capped-first-run discipline
  above. There is no undo table; the guard is the tight filter + the small first
  batch + the spot-check.
