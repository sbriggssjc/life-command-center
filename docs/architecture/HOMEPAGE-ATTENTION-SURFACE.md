# The homepage attention surface (HP1) — one door into Today and the Inbox

> **Read this before touching `api/_shared/today-sections.js`, `getTodaySections`, `v_inbox_triage`, or anything
> that renders Today's three lanes.** It is the single door into the HP1 arc. The canonical OPEN-work list is
> still `docs/os/PLANNED-BACKLOG.md` (rows prefixed `HP1-`) — this page is the map, not a second backlog.

**Status: the three symptoms Scott reported on 2026-09-12 are closed and live.** Deployed SHA
`ba22b8abac78` == `main`, verified via `/version` on `tranquil-delight` 2026-09-14.

---

## 1. What the app is for, in Scott's words

> *"The homepage should be a view of the work that needs the broker's attention and review in priority order."*

Every HP1 decision resolves against that sentence. Two corollaries earned the hard way:

- **A lane that is mostly plumbing is not an attention surface**, however correctly it is ranked.
- **Removing noise is not the same as hiding it.** Every exclusion shipped in this arc renders a pointer carrying
  the true, uncapped population (P159a/P180). An exclusion that cannot show its pointer does not ship.

## 2. The three symptoms, and what each turned out to be

| Reported | Root cause | Fixed by |
|---|---|---|
| **Intermittent HTTP 500 across all three Today lanes** | Six queries in one `Promise.all`; `opsQuery`'s 8 s `AbortController` makes `fetch` **throw**, not resolve `{ok:false}`, so the handler's `ok`-guard was dead code and one slow source killed all three lanes | **HP1-P0** — `Promise.allSettled`, per-lane `source_error`, explicit `timeoutMs`, degradation folded into `named_gaps`. A failed lane now says so instead of rendering *"Nothing here right now. ✓"* |
| **"My Work is well behind where the deals actually are"** | **The Salesforce opportunity upsert had never updated a row.** `{Prefer:…}` was passed as the 4th *positional* arg to the standalone MCP's `opsQuery(method, path, body, prefer)`, stringifying to `"[object Object]"`; PostgREST dropped `resolution=merge-duplicates` and ran a plain INSERT — 608 duplicate-key violations per run, under an **HTTP 200**, for 36 days | **HP1-P1a-fix** — routed through `rpc/lcc_upsert_bd_opportunities`. **HP1-P1d** now watches it |
| **"Data and notices that should be automated, at the top of our inbox"** | Two different lanes of machine output rendered as broker decisions | **HP1-P2a** (captured contacts), **HP1-P2misparse** (guard notifications), **HP1-P2f-urgent** (CRM plumbing) |

## 3. What Today and the Inbox contain now (measured 2026-09-14)

| Surface | Count | What it is |
|---|---|---|
| **Significant** | 518 | `v_lcc_seller_prospect_queue` — owners not yet reached |
| **Important** | 46 | open `bd_opportunities` — live deals |
| **Urgent** | **59** | `action_items` deal correspondence + `owner_source_conflict`. **Was ~1,664** |
| ↳ moved off Urgent | 1,603 | `contact_writeback` → BD worklist's **"Push to CRM"** chip, behind an honest pointer |
| **Inbox** | **92** | broker work. **Was 1,061** |
| ↳ moved off Inbox | ~880 | `new_contact_qualify` → `v_lcc_contact_qualify_worklist`, behind an honest pointer |
| ↳ disposed | ~105 | `contact_misparse_review` guard notifications — the guard now counts instead of notifying |

**Counts are honest.** `total_open` was the **capped page length** until **HP1-badge**; it is now a true
population from separate, parallel, single-column `limit=1` `count=exact` probes that never ride the row-fetch
request (that reattachment is the ~750 ms/request cost HP1-P0 removed). A failed probe renders **unknown** — never
`0`, never the page length.

## 4. The five rules this arc produced — apply them to any new lane

1. **Check the destination before routing anything off a surface.** `contact_writeback` had a working home
   (`api/_handlers/contact-writeback.js`, the "Push to CRM" chip) so it moved. `contact_misparse_review` had
   **zero readers anywhere in the repo** — routing it off would have deleted the only place it was visible, so it
   stayed and the gap was filed (P131).
2. **Never verify on an HTTP 200.** `ingestBatch` returned 200 while failing 100% of its writes for six weeks.
   Verify on the state delta — `UPDATED_not_inserted`, not a status code and not a green flow-run history.
3. **A monitor must be producer-keyed, not table-keyed.** `bd_opportunities` has a second producer, so
   `max(last_synced_at)` must carry `FILTER (WHERE sf_opp_id IS NOT NULL)`. The registry row named
   `salesforce_sync` watched a *different* Salesforce pipe and was correctly green through all 39 outage days.
4. **A detector that has never fired is not a detector.** Every guard here is positive-controlled.
5. **A skipped step must emit — to a counter, not to the broker.** The contact guard filed an Inbox row per
   successful block; 130 rows carried 294 rejections across only 42 distinct names.

## 5. Where the code lives

- `api/_shared/today-sections.js` — pure classification; `resolveTotalOpen()` is the honest-count rule.
- `api/operations.js::getTodaySections` (~2055) — the six row-fetches plus four parallel count probes.
- `api/queue.js` — `v2GetInbox`, `handleInbox`, `inboxHygienePointer()` (**the pointer pattern to copy**).
- `mcp/opportunity-sync.js` + `rpc/lcc_upsert_bd_opportunities` — the Salesforce ingest.
- `api/_handlers/sidebar-pipeline.js` (~2114) — the contact guard.
- ⚠️ **`/api/pipeline/ingest-opportunit{y,ies}` is registered TWICE.** `server.js:176`'s `mountLccMcp(app)` wins;
  `server.js:368-369` is unreachable (**HP1-P1a-dup**). Editing the wrong one changes nothing.

## 6. Guards that protect this work

`test/hp1-badge-today-total-open.test.mjs` · `test/hp1-p2a-inbox-hygiene-pointer.test.mjs` ·
`test/hp1-p2misparse-guard-disposition.test.mjs` · `test/hp1-p1d-sf-feed-freshness.test.mjs` ·
`test/uxt1a-today.test.mjs`. Doc guards: `backlog-id-uniqueness`, `backlog-table-shape`,
`status-header-integrity`, `status-line-budget`.

## 7. What is still open

Read the live rows — **do not trust this list to stay current**:
`grep '^| HP1-' docs/os/PLANNED-BACKLOG.md`. As of 2026-09-14 the notable ones:

- 🔴 **`HP1-P2misparse-fp`** — the guard blocks **real people** whose surnames are street words:
  *Brian Lane* `<blane@northmarq.com>` (a Northmarq colleague) and *Jim Street*.
- 🟠 **`-junkents`** (12 junk-chrome entities minted pre-guard) and **`-fanout-legacy`** (one mailbox stapled
  onto colleagues) — one reversible identity-cleanup unit.
- ⏳ **`HP1-P2b`** (announcement classes), **`P2c`/`P2e`** (ranking — sequenced last on purpose: ranking a noisy
  list ranks noise), **`P2d`** (OM titles), **`P1c`** (aged-out auto steps).
- ⚠️ **`HP1-P1a-orphan`** — rows the Salesforce feed **stopped sending**, still open at a stale stage. Fixing the
  feed fixed the rows it *sends*; it says nothing about the ones it no longer does.
