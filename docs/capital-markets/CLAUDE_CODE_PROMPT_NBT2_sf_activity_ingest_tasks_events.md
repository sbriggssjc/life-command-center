# Claude Code prompt — NBT Phase 2: SF activity ingest for Tasks (all statuses) + Events

> From the cadence-targeting / next-best-touchpoint work. Scott confirmed the "progress with
> accounts" signal should come from his Salesforce **Tasks AND Events**, **deal-linked or not**,
> **including completed Tasks** (the completed ones ARE the prospecting history — which contacts
> have been worked). Grounded live 2026-06-20 in the browser + SQL. This makes the LCC ingest
> turn that activity into `activity_events` that drive the next-best-touchpoint engine and the
> cadence advance. Receipts-first; gated; reuse the OUTREACH#1 machinery — do NOT fork.

## Grounding (measured live 2026-06-20, LCC Opps + the PA flow)
- The PA flow **"SF → LCC: Activity Sync"** = Recurrence → set `Watermark` → Salesforce
  **Get records (Task)** `LastModifiedDate gt @{Watermark}` → HTTP POST to LCC. Scott + I
  **widened the watermark live** from `now−24h` to `now−10y` and raised Top Count 200→2000, so
  the Task pull now returns ALL reachable Tasks each run (history + forward), no status/deal
  filter. **That half is done.**
- **Even widened, only ~89 activity records are reachable**, spanning **~8 distinct Salesforce
  owner ids** — so the connection is **team-wide, not scoped to Scott only** (scope is NOT the
  limiter). And **0 of the 89 carry a captured completion status**.
- **Root cause of the thin history (Scott's lead + the data):** Scott reports a Salesforce admin
  **bulk auto-completed his open Tasks**. Salesforce **archives completed Activities older than
  ~1 year** and **excludes them from standard SOQL/connector queries** (they need
  `isArchived=true` / `queryAll`). So his real prospecting history — now completed and aged — is
  in SF's **archived activity store, invisible to the normal pull**. The wide watermark can't
  reach archived rows; this is a platform limitation, not a filter we can flip.
- The OUTREACH#1 work already built: `sf-activity-ingest.js` (`deriveSfCategory(type, subject)`),
  the cadence **contact-hop** (advance a cadence by `contact_id = activity.entity_id`), and the
  `lcc_cadence_advance_failures` observability table. Reuse all of it.

## Unit 1 — ingest Tasks of ALL statuses (open + completed), deal-linked or not
Extend the SF→activity_events ingest so a Task becomes an `activity_events` row regardless of
`IsClosed`/`Status`:
- **Never drop a completed Task.** Map: `ActivityDate`/`CreatedDate` → `occurred_at`;
  `deriveSfCategory(TaskSubtype||Type, Subject)` → category (Call/Email/note…); `WhoId` → the
  contact person entity, `WhatId` → the account/deal entity (deal-linked or not — both null is
  fine); `OwnerId` → capture the activity owner (whose-book signal); `Subject`/`Description` →
  recorded on the row.
- **Capture `Status` / `IsClosed` + completion date** on the activity row metadata, BUT treat it
  as a **SOFT signal** — Scott's note: an admin bulk-auto-completed open Tasks, so
  `IsClosed=true` does NOT reliably mean "successfully worked." Do NOT infer "contacted /
  responded" purely from completion. Tag admin-mass-completed rows if detectable (same
  LastModifiedDate + same modifier across many) so the engine can discount them.
- **Prospecting-history use:** each Task = "this contact/account was touched." Feed the NBT
  engine's `last_touch_at` / `days_since_touch` (the `v_next_best_touchpoint` columns) and the
  cadence advance via the existing contact-hop. A completed historical Task should mark the
  contact as **already prospected** (so NBT can de-prioritize re-prospecting) — even if the
  completion is soft.

## Unit 2 — ingest Events (meetings)
SF **Event** has a different shape than Task — handle it explicitly:
- Map: `StartDateTime` (fallback `ActivityDate`) → `occurred_at`; category = `meeting`; `WhoId` →
  contact, `WhatId` → account/deal; `Subject`/`Description`; `OwnerId`. Events have **no `Status`**
  — don't assume Task fields. Resolve entity + advance the cadence via the same contact-hop.
- **Do not enable the flow-side Event pull until this ingest mapping is live** (POSTing Events the
  ingest can't parse would create malformed/dropped rows). Once shipped, the flow Event pull is a
  copy of the Task flow with the object switched to Event (Scott/I add it in the browser).

## Unit 3 — the archived-history problem (flag + scope honestly, don't fake it)
The deep prospecting history (completed Tasks > ~1 year old) is **archived in Salesforce and not
returned by the standard connector query**. Options to surface to Scott (do NOT silently assume):
- (a) a one-time pull using `queryAll` / `isArchived=true` if the connection/connector supports it
  (the standard PA "Get records" likely does NOT — may need a custom SOQL action or the Bulk API);
- (b) accept that LCC's activity history starts ~now and builds forward (go-forward capture is
  reliable; deep archived history may be impractical).
Report which is feasible with the current connection; don't pretend archived rows will appear from
a wider watermark (they won't).

## My gate (read-only)
- A synthetic **completed** Task (deal-linked AND a standalone one) ingests → `activity_events`
  with correct category, `occurred_at`, status captured-but-soft, `WhoId` contact + `WhatId`
  account resolved (null WhatId tolerated); the contact-hop advances the matching cadence; the
  contact is marked already-prospected for NBT.
- A synthetic **Event** ingests → category `meeting`, `StartDateTime`→occurred_at, entity resolved,
  cadence advanced; no Task-field assumptions break it.
- Counts reconcile; 0 residue; the admin-auto-completion caveat is honored (completion not treated
  as "worked"); the archived-history feasibility is reported, not faked.

## Guardrails
- Receipts-first; reuse `sf-activity-ingest.js` / `deriveSfCategory` / the OUTREACH#1 contact-hop /
  `lcc_cadence_advance_failures` — do NOT fork a second ingest. ≤12 api/*.js. The flow-side Task
  widening is already live; the Event pull is added to the PA flow only AFTER this ingest ships.
- Net: Scott's Tasks (all statuses) + Events become the activity history that drives "who's been
  prospected / when last touched," feeding the next-best-touchpoint engine — with the archived
  deep-history limitation surfaced honestly rather than papered over.
