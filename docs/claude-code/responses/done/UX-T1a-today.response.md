# UX-T1a-today — Today recut into Significant / Important / Urgent (2026-09-03)

Read first: `docs/os/canon/blocks/operator-doctrine.md` (1.8.0) ·
`docs/architecture/bd-ranking-and-priority-queue.md` (top banner, this section appended) ·
`docs/claude-code/responses/done/UX-T1a-queue.response.md` ·
`docs/claude-code/responses/done/UX-T1a-gates.response.md`.

## 1. What was measured, per canon bucket

### Significant — new-client research, first outreach, follow-ups (pays in 5 yrs)

`v_lcc_seller_prospect_queue` (LCC Opps): **520 rows** total, split by `reach_state`:

| reach_state | n |
|---|---:|
| `no_linked_person` | 384 |
| `in_pipeline_untouched` | 97 |
| `never_touched` | 39 |

Every row in this view is, by the view's own gates (UX-T1a-queue), an owner not yet reached — so
the whole view IS the Significant population; no further gate was needed.

`touchpoint_cadence.current_touch` was re-checked per the prompt's instruction and is unreadable
again: `min=0, p50=0, max=8298` over 2,308 rows — a 7-step sequence cannot reach 8,298, confirming
the UX-T1a-touchcount finding this file's own doctrine already documents. Fell back to the seller
queue's `reach_state`, exactly as the prompt instructed rather than guessing at a cadence position.

### Important — BOVs, ELAs, touches that generate a BOV or a working buyer, marketing live listings (pays within a year)

Checked, in order:

- `bd_opportunities` open rows: **47** (`is_open=true`); 0 explicitly `type='buyer'`. This is the
  one real recorded producer for "a touch that generates a BOV or a working buyer" — an open
  Opportunity IS that touch's container.
- `lcc_deal_milestone`: 29 rows total, keys are `loi | psa | escrow | diligence | financing |
  marketing | close`. `key='marketing' AND status='next'` (a scheduled-but-not-yet-launched
  listing) = **0 rows**. No key for "BOV" exists at all — `deal-milestone-cues.js`'s cue engine has
  no BOV rule.
- `action_items.title` free text (`deal_next_step` rows) literally contains phrases like *"Deliver
  BOV & set listing discussion"* — a real BOV-adjacent intent — but it is unstructured prose behind
  an AI-derived title, not a discrete "BOV due/generated" fact, and titles cannot be classified into
  a BD signal without the lexical/lookalike classification this codebase's doctrine bans for
  identity-adjacent decisions. It was left where it is (a deal-correspondence next step, Urgent),
  not reclassified by regex.
- `lcc_listing_events`: 115 rows, but its columns (`sale_price`, `buyer_name`, `seller_name`,
  `cap_rate`, `event_date`) describe a SALE EVENT, not a marketing touch on one of our own live
  listings. No column identifies "this is our listing, still marketing."

**Named gaps** (carried into the response's `named_gaps` array, never fabricated with a
heuristic): no producer states "a BOV was generated/is due"; no producer states "marketing a live
listing" as a discrete task.

### Urgent — pipeline management, deal correspondence (pays in ~90 days)

- `v_lcc_bd_worklist.owner_source_conflict` (`auto_fixable=true`): gov **0**, dia **8**.
- `v_lcc_bd_worklist.contact_writeback`: **1,568** — CRM push, named explicitly by the prompt as
  Urgent's "pipeline management" half.
- `action_items` open/in_progress (deal correspondence): **58** total —
  `deal_next_step` 34, `send_info` 8, `reply_overdue` 4, `review_response` 3, `schedule_call` 3,
  `seller_follow_up` 3, `follow_up` 2, `advance_to_contract` 1. Every row is tied to `entity_id`
  (the deal) with a `due_date`, joined to `entities.name` for the card title.
- `v_lcc_bd_worklist.loan_maturity`: **172** rows, `≤24mo` window. Checked whether a 90-day
  sub-slice is expressible: the view carries `months_to_maturity`/`maturity_band` but the canon's
  window is ~90 days ≈ 3 months, and `maturity_band` only buckets at coarser widths
  (`matured`/broader bands) with no clean "≤90 days" cut recorded anywhere upstream — so per the
  prompt's own instruction, it is placed in neither Important nor Urgent by fabricated cut; it
  stays reachable via the Priority Queue / BD worklist, unchanged.
- `v_lcc_bd_worklist.ownership_chain`: **3,534** rows. Excluded from Urgent — since A2 (cron 244)
  this lane is auto-applied by a scheduled sweep; its consumer is a cron, not a human, which is
  exactly the "minimum effective dose" doctrine (`CLAUDE.md`'s operator doctrine section).

## 2. What was built

- **`api/_shared/today-sections.js`** — pure, injectable, no I/O. `buildSignificantSection`,
  `buildImportantSection`, `buildUrgentSection`, `assembleTodaySections`. Each section returns
  `items` (capped, `TODAY_SECTION_LIMIT=8`) and `total_open` (the full population) as two distinct
  numbers — never blended (P159a). `money()` treats `null`/`undefined`/`''` as unknown, never `$0`
  (P180 — caught by the guard's own first run: `Number(null)` is `0`, `Number.isFinite(0)` is
  `true`, and the naive coercion collapsed an unpriced row's value to `0` before the fix).
- **`api/operations.js::getTodaySections`** (`GET ?action=today_sections`) — fetches the four
  sources (seller queue, `bd_opportunities`, `action_items`, `v_lcc_bd_worklist` + domain
  `owner_source_conflict`) and calls `assembleTodaySections`. Reuses `assembleBdWorklist` (the
  existing, tested pure function the full BD worklist already uses) for the Urgent worklist half —
  never a second, divergent shape for `contact_writeback`/`owner_source_conflict`. Entity names are
  resolved with ONE bounded `entities?id=in.(...)` fetch (no FK exists on `bd_opportunities.entity_id`
  or `action_items.entity_id` for PostgREST to embed — P132's rule: never trust an unhinted embed).
- **Front end** (`index.html` + `app.js`): the "Work Your Outreach" and "Top BD Actions" widgets are
  replaced by ONE "Today" widget with three labelled subsections (Significant/Important/Urgent),
  each stating the canon's one-line question. `renderTodaySections()` replaces
  `renderOutreachOnramp()`/`renderTodayBdActions()` at both call sites (`handlePageLoad('pageHome')`
  and the boot sequence). "Top Data Gaps to Close" (the NBA data-completeness panel) is UNCHANGED —
  it already carries an honest, non-BD label and is not one of the three sections by design.
- **`pageSellerProspectQueue`** — the seller queue's first front-end surface (its own response
  noted "no front-end yet"). `renderSellerProspectQueuePage()` reads `GET
  /api/seller-prospect-queue` verbatim (chips filter server-side, real `pagination` block), added to
  `ROUTE_SLUG_TO_PAGE` as `seller-prospects`. Significant's "See all →" navigates here.

## 3. Verification

- `node --test test/uxt1a-today.test.mjs` — **11/11 pass** (a 12th assertion inside one test brings
  it to 12 total assertions across 11 `test()` blocks): count-equals-rows-shown for every section,
  P180 null-never-0 for both Significant and Important, overdue-always-outranks-value for Urgent,
  value-breaks-ties-within-a-class, loan_maturity/ownership_chain never silently admitted, and
  `named_gaps` always present (even on an all-empty input — an empty Today is a real finding, not
  an error).
- `node --check app.js`, `api/operations.js`, `api/_shared/today-sections.js` — clean.
- **Full suite**: `npm test` → **5,384 tests / 5,378 pass / 0 fail / 6 skipped** — identical
  fail/skip counts to before this change (no regression), `test/frontend-duplicate-definitions.test.mjs`
  and `test/operations-subroutes.test.mjs` both green (the new `today_sections` action needed no
  `server.js` route — it rides the already-mounted `/api/operations` `?action=` dispatch).

## 4. State delta vs the three unstructured cards

| before | after |
|---|---|
| "Work Your Outreach" — cadence dashboard, no section label | **Significant** — 520-row seller-prospect queue, capped 8, "See all →" to a real page |
| "Top BD Actions" — 5 mixed signal types, no section label, loan_maturity/ownership_chain mixed in with contact_writeback | **Important** — 47 `bd_opportunities` open rows, capped 8, named gaps stated |
| (none — deal correspondence had no Today card at all) | **Urgent** — 58 `action_items` + 1,576 worklist rows (contact_writeback + owner_source_conflict), capped 8, overdue-first ranking |

Nothing that was reachable before is gone: `contact_writeback`/`owner_source_conflict` still reach
the operator (now under Urgent, correctly labelled as pipeline hygiene rather than "BD actions");
`loan_maturity`/`ownership_chain` are still reachable via the Priority Queue / BD worklist page,
unchanged.
