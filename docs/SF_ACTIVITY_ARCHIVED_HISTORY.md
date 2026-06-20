# SF activity ingest — the archived deep-history problem (NBT Phase 2, Unit 3)

> Grounded live 2026-06-20 in the browser + SQL alongside the Power Automate
> "SF → LCC: Activity Sync" flow. This is the HONEST feasibility report the NBT
> Phase 2 prompt asked for — surfaced, not papered over.

## What we measured

- The PA flow was widened live: the Task watermark went from `now−24h` to
  `now−10y` and Top Count 200 → 2000, so the connector returns **all reachable**
  Tasks each run, with no status / deal filter.
- Even widened, only **~89 activity records are reachable**, across **~8 distinct
  Salesforce owner ids** — so the connection is **team-wide, not Scott-scoped**
  (scope is not the limiter), and **0 of the 89 carry a captured completion
  status** worth trusting.

## Root cause (Scott's lead + the data)

A Salesforce admin **bulk auto-completed** Scott's open Tasks. Salesforce then
**archives completed Activities older than ~1 year** and **excludes archived
Activities from standard SOQL / connector queries** — they only come back with
`isArchived = true` / `queryAll`. So Scott's real prospecting history (now
completed and aged past a year) sits in Salesforce's **archived activity store,
invisible to the normal pull**. A wider watermark cannot reach it — this is a
platform limitation, not a filter we can flip.

## Options (do NOT silently assume — reported, not faked)

**(a) A one-time archived pull.** Use `queryAll` / `isArchived = true` to read
the archived Activities once.
- The standard PA "Get records" (Dataverse-style) action **does not** expose
  `queryAll` / `isArchived`, so it almost certainly **cannot** reach them.
- Feasible only via a **custom SOQL action** (PA "Send an HTTP request to
  Salesforce" against `/services/data/vXX.0/queryAll/?q=...`) or the **Bulk API**
  (`queryAll` job). Both need the SOQL/REST surface, not the standard connector
  step. Owner-scope still applies (the connection sees ~8 owners' rows).

**(b) Accept go-forward capture.** LCC's activity history **starts ~now and
builds forward**. Every Task/Event logged from here on flows through this ingest
reliably; the deep archived back-history is treated as impractical to import.

## Recommendation

Ship **(b)** as the working assumption (the ingest is correct and reliable for
go-forward + whatever the standard query still returns), and pursue **(a)** only
as a deliberate one-shot via a custom `queryAll` SOQL action / Bulk API job if
the deep history proves necessary — never by widening the standard connector
watermark, which will keep returning the same ~89 non-archived rows.

## What the ingest does with what it CAN see

- Tasks of **all statuses** (open + completed, deal-linked or not) land an
  `activity_events` row. A completed Task is the prospecting record and is never
  dropped.
- `Status` / `IsClosed` / completion date ride in metadata as a **soft** signal;
  an admin bulk-completion fingerprint (≥5 closed Tasks sharing an exact
  `LastModifiedById` + `LastModifiedDate`) is tagged `bulk_completed` so the
  engine can discount it. **Completion is never read as "successfully worked."**
- Events anchor on `StartDateTime`, are categorized `meeting`, and advance the
  matching cadence via the same trigger contact-hop.
- Writing the SF `activity_events` row (+ the cadence advance) IS the
  "this contact is already prospected" signal the NBT engine reads
  (`v_next_best_touchpoint.last_touch_at` = the cadence's `last_touch_at`, else
  the latest SF `activity_event` for the entity).
