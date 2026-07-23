# Flagged-email cleanup — Path B PA-designer build sheet (first capped run, cap = 25)

Last updated: 2026-07-23
Owner: LCC architecture/audit track (Scott Briggs)
Companion to: `flagged-email-cleanup-sweep.md` (design + decisions).
Status: **Build this as an INSTANT (manual-trigger) flow, run the read-only pass,
then the capped-25 delete, spot-check, THEN broaden.** Path B (native Microsoft
To-Do connector), 90-day cutoff. No raw Graph.

> **Hard guard (never weaken):** a task is deleted only when
> **`status == 'completed'` AND `completedDateTime` is older than 90 days.** Open /
> incomplete tasks are never enumerated for deletion. First run is manual + capped
> at 25 because To-Do deletes are NOT API-reversible.

## Connector + prerequisites
- Connection: **Microsoft To-Do (Business)** — the same OAuth connection Flow 6
  (`todo-completion-poll.md`) already uses. No new connection, no app registration.
- Actions used: **Lists**, **List to-do's by folder (V2)**, **Delete a to-do (V2)**,
  plus **Filter array**, **Compose**, **Initialize/Increment variable**, **Delay**,
  **Condition**, **Apply to each** (all built-in), and optionally **Post message in
  a chat or channel** (Teams) for the summary/fault alert.
- Create it as **Instant cloud flow → "Manually trigger a flow"** so YOU press Run
  and watch each run. (You switch the trigger to Recurrence only in the Broaden
  step at the end.)

---

## Naming note (so the expression references below resolve)
Power Automate turns action display names into expression keys by replacing spaces
with `_` and stripping most punctuation. To make the formulas below copy-paste
exact, **name each action exactly as the bold heading says** (e.g. name the list
action `List_flagged_tasks`, not the default "List to-do's by folder (V2)"). Where
a formula references an action, it uses that exact name.

---

## PART 0 — Read-only validation pass (build these, run once, DELETE nothing)

Build steps 1–11 first, run the flow, and inspect the run — **no Delete action yet.**
This confirms the field shapes (`status`, `completedDateTime/dateTime`) and that the
Filter selects the intended old-completed tasks before anything is destroyed.

### 1. Trigger — **Manually trigger a flow**
No inputs.

### 2. **Initialize variable** — name `per_run_cap`
- Name: `per_run_cap` · Type: **Integer** · Value: `25`

### 3. **Initialize variable** — name `deleted`
- Name: `deleted` · Type: **Integer** · Value: `0`

### 4. **Compose** — name `cutoff_utc`
Inputs (Expression):
```
formatDateTime(addDays(utcNow(), -90), 'yyyy-MM-ddTHH:mm:ss.fffffff')
```
Produces e.g. `2025-04-24T15:30:00.0000000` — a UTC, no-`Z`, 7-decimal string that
matches the To-Do `completedDateTime/dateTime` format exactly (so the string
comparison in step 8 is apples-to-apples).

### 5. **Compose** — name `correlation_id`
Inputs (Expression):
```
guid()
```

### 6. **Lists** (Microsoft To-Do, Business)
No parameters. Returns every To-Do list, each with `id`, `displayName`,
`wellknownListName`.

### 7. **Filter array** — name `Find_flagged_list`
- **From** (Expression):
  ```
  outputs('Lists')?['body/value']
  ```
- Switch the condition to **Edit in advanced mode** and paste:
  ```
  @equals(item()?['wellknownListName'], 'flaggedEmails')
  ```
  **Fallback** (only if a run shows `wellknownListName` isn't populated by the
  connector): use the English display name instead —
  ```
  @equals(item()?['displayName'], 'Flagged email')
  ```

### 8. **Compose** — name `flagged_list_id`
Inputs (Expression):
```
first(body('Find_flagged_list'))?['id']
```

### 9. **Condition** — name `List_resolved`
- Left (Expression): `empty(outputs('flagged_list_id'))`
- Operator: **is equal to**
- Right: `false`
- **If no** branch: **Terminate** (Status = Failed, Message
  `Flagged email list not found`) — or a Teams alert. Do NOT proceed without a
  resolved list id.
- Everything below lives in the **If yes** branch.

### 10. **List to-do's by folder (V2)** — name `List_flagged_tasks`
- **To-do list**: pick "Enter custom value" and set (Expression):
  ```
  outputs('flagged_list_id')
  ```
- **Leave pagination at its DEFAULT** (Settings → Pagination OFF, or the default
  threshold). Do **not** raise it to 50k/100k — one modest page per run is the
  whole point (a full 60k pull is slow + throttle-death).

### 11. **Filter array** — name `Completed_and_old`
- **From** (Expression):
  ```
  body('List_flagged_tasks')?['value']
  ```
  (If your connector version returns the array directly as the body, use
  `body('List_flagged_tasks')` — check the run output shape; see the run-inspection
  note below.)
- **Edit in advanced mode** and paste this null-safe condition (open tasks have a
  null `completedDateTime`; `coalesce` gives them a year-9999 fallback so `less`
  never errors and they never qualify):
  ```
  @and(equals(item()?['status'], 'completed'), less(coalesce(item()?['completedDateTime']?['dateTime'], '9999-12-31T00:00:00.0000000'), outputs('cutoff_utc')))
  ```

### 11b. **Compose** — name `eligible_count`
Inputs (Expression):
```
length(body('Completed_and_old'))
```

### ▶ Run the read-only pass now and INSPECT the run
1. Save → **Test → Manually → Run flow**.
2. Open the run. On **`List_flagged_tasks`**, expand one task's raw JSON and
   confirm the field shapes the formulas assume:
   - `status` is a string equal to `"completed"` on completed tasks.
   - `completedDateTime` is an **object** `{ "dateTime": "…", "timeZone": "UTC" }`
     (the formula reads `completedDateTime/dateTime`). If the connector **flattened**
     it to a single string field, tell me — the step-11 expression changes to
     `item()?['completedDateTime']` and the fallback format may differ.
   - The array path is `body/value` (adjust step 11 "From" if it's just `body`).
3. On **`Completed_and_old`** + **`eligible_count`**: eyeball the selected items —
   every one should be a genuinely old (90d+) completed flagged email, and NONE
   should be open/recent. If anything open or recent appears, STOP and fix the
   filter before adding the Delete action.
4. Sanity-check `eligible_count` against the ~60,520 total (it can be small this
   page — that's the expected low-yield-per-page behaviour; you just re-run).

Only once the selected set looks exactly right do you add PART 1.

---

## PART 1 — Add the capped-25 delete

### 12. **Compose** — name `batch_to_delete`
Inputs (Expression):
```
take(body('Completed_and_old'), variables('per_run_cap'))
```
`take` returns at most 25 (or all, if fewer) — the hard per-run cap.

### 13. **Apply to each** — name `Delete_each_task`
- **Select an output** (Expression):
  ```
  outputs('batch_to_delete')
  ```
- **Settings** (⋯ → Settings on the Apply to each): **Concurrency Control = ON,
  Degree of Parallelism = 1** (serial — critical for staying under the throttle).

Inside the loop, in order:

#### 13a. **Delay** (built-in) — name `Pace_delay`
- Count: `1` · Unit: **Second** (paces deletes under the ~100 calls/60s ceiling).

#### 13b. **Delete a to-do (V2)** — name `Delete_task`
- **To-do list** (custom value, Expression):
  ```
  outputs('flagged_list_id')
  ```
- **id** / **To-do id** (Expression):
  ```
  item()?['id']
  ```
- **Settings → Retry Policy**: **Exponential**, Count `4`, Interval `PT10S`
  (absorbs a 429 with its `Retry-After`).

#### 13c. **Increment variable** — `deleted`
- Name: `deleted` · Value: `1`

### 14. **Compose** — name `AuditLog_summary`
Inputs (Expression — paste as a single expression, or build as JSON with inline
expressions):
```
json(concat('{"correlation_id":"', outputs('correlation_id'), '","cutoff_utc":"', outputs('cutoff_utc'), '","page_size":', string(length(body('List_flagged_tasks')?['value'])), ',"eligible_in_page":', string(outputs('eligible_count')), ',"cap":', string(variables('per_run_cap')), ',"deleted_this_run":', string(variables('deleted')), '}'))
```
(Or simpler: a plain-text Compose with the five values on separate lines — the
point is just an auditable per-run record.)

### 15. (Optional) **Post message in a chat or channel** (Teams)
Post `AuditLog_summary` to your ops channel so multi-day progress is observable.

### 16. Fault branch (observability)
On **`Delete_each_task`** (or `List_flagged_tasks`), add a parallel action via
**⋯ → Configure run after → has failed / has timed out** → a Teams alert including
`outputs('correlation_id')`. A failed run then alerts instead of half-deleting
silently.

---

## PART 2 — Run the capped-25, then SPOT-CHECK
1. **Run flow** (manual). It deletes at most 25.
2. In the **Microsoft To-Do UI**, open the **Flagged email** list:
   - Confirm ~25 old (90d+) **completed** flagged tasks are gone.
   - Confirm **no open/incomplete or recent task moved or disappeared.**
3. In the run history, confirm `deleted_this_run = 25` (or the eligible count if the
   page had fewer) and `page_size`/`eligible_in_page` look sane.
4. **Confirm the live poll still works:** flag a fresh test email → let it stage →
   complete its native task → confirm Flow 6 (`todo-completion-poll.md`) still files
   it. The cleanup must not disturb the recent working set the poll scans.

Only after all four check out do you broaden.

---

## PART 3 — Broaden (after the capped run is confirmed safe)
1. **Raise the cap:** `per_run_cap` (step 2) → `200`, then `500` once a couple of
   runs are clean. Keep serial (Degree 1) + the 1s pace delay.
2. **Automate the cadence:** replace the **Manually trigger a flow** trigger with a
   **Recurrence** trigger — start **Every 1 hour**, then **Every 30 minutes** once
   pacing is proven. (Everything else is unchanged.) Set the Recurrence time zone.
3. Let it drain over the accepted **2–5 day** window. Watch the `deleted_this_run`
   summaries + fault alerts.
4. **Low-yield note (expected):** `List_flagged_tasks` returns from the top of the
   list in no guaranteed order and intermixes open + completed, so some runs delete
   far fewer than the cap. That's normal — the delete-shrinks-the-list property
   advances the window across runs; just let it keep running (raise frequency if
   it's crawling). If yield is persistently near-zero, that's the signal to revisit
   Path A (a one-shot Graph script) per `flagged-email-cleanup-sweep.md`.
5. **Stop condition:** when several consecutive runs report `eligible_in_page = 0`,
   the backlog is drained. Either turn the flow off, or leave it running as a cheap
   maintenance sweep (it then only trims newly-aged-out completed tasks and keeps
   Flow 6's scan light).

## Reversibility
- The flow is disable-able any time (turn off the trigger).
- Deleted To-Do tasks are **not** API-recoverable — which is exactly why the read-
  only pass + capped-25 + spot-check gate every broadening step. There is no undo
  table; the guard is the tight `completed + 90d` filter, the small batch, and your
  eyes on the To-Do UI between steps.
