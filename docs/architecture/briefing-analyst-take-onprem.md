# P138 / R8 Stage 1 — the daily brief's "Analyst's Take", generated on-box

**Status:** built, tested, scheduled, and **LIVE**. ⚠️ **Re-measured 2026-08-26:**
`BRIEFING_ANALYST_TAKE_ONPREM` reads **`on`** in `feature_flags_registry` and today's
`briefing_intel_snapshot` carries a **774-char** take with `analyst_take_meta.source =
'onprem_ollama'` (2026-08-25 and every prior row: length 0). The "flag OFF, awaiting the
operator gate" status below was true when written. **One gate item may still be open:** the
`briefing-intel-snapshot` edge fn must carry `if (row.analyst_take == null) delete
row.analyst_take;` or a manual snapshot re-fire upserts NULL over the on-box take. The fn is at
v21 with an `updated_at` of 2026-08-26, consistent with the deploy having run — confirm the
deployed source. Tracked as `docs/os/PLANNED-BACKLOG.md` row **V4**.
**Date:** 2026-08-26

---

## 1. What was actually broken (re-measured, and the prompt's premise was wrong)

The briefing email has rendered an "Analyst's Take" section since v2
(`api/_handlers/briefing-email-handler.js::renderAnalystTake`, reading
`briefing_intel_snapshot.analyst_take`). The section has been rendering **nothing**.

Measured live on LCC Opps (`xengecqvemvfknjvbvrq`) 2026-08-26:

| | |
|---|---|
| snapshot rows | 67 (2026-05-23 → 2026-08-26) |
| rows that ever carried a take | **11** |
| last non-empty `analyst_take` | **2026-07-07** |
| `capital_markets` on the recent rows | **also 0 chars** |

**The originating prompt said the generator is "gated on `ANTHROPIC_API_KEY`; when
unset it pushes the warning `ANTHROPIC_API_KEY not set — skipped AI generation`."
That is not the live state.** Every row from 2026-07-08 onward carries a different
warning, written by the edge function itself:

```
Anthropic API 400: {"type":"error","error":{"type":"invalid_request_error",
"message":"Your credit balance is too low to access the Anthropic API. ..."}}
```

The key is set. The account is out of credit. Two consequences worth stating plainly:

1. This is the *dated-blocker* trap in reverse — the prompt described a
   configuration gap and the reality is a **billing** failure, which has a
   completely different fix. Re-measuring first is what caught it.
2. **The same outage emptied `capital_markets` too.** The prompt scoped this build to
   `analyst_take` and this build honours that scope — but fixing `analyst_take` does
   **not** fix the capital-markets sub-narrative, and nobody should read a repaired
   Analyst's Take as evidence the cloud path recovered. See §7.

## 2. Why generation moves on-box

The Analyst's Take synthesises **private LCC data**: work counts, scored priorities,
named cooling contacts, deal-propagation deltas naming live deals. Standing doctrine
is that a private corpus never egresses to a cloud model, so generation goes through
`api/_shared/ai.js::invokeOnPremGeneration` — the **fail-CLOSED** GaryBuilt/Ollama
seam with no cloud fallback. (`invokeExtractionAI` is deliberately *not* used: it
walks to a cloud provider on a local failure, which is exactly the egress this
surface forbids. A test asserts the handler never references it.)

The macro lines folded into the payload are **public market data read back out of our
own snapshot row**. That is not an egress event, and the block labels it as such.

This is the first net-new **on-box generation** build; every prior on-prem surface was
annotation-only. The guardrails are the same: fail-soft, grounded, human reads the
output — a brief, never an auto-action.

## 3. What shipped

| file | role |
|---|---|
| `api/_shared/briefing-analyst-take.js` | **pure** planner: voice extraction, priority selection, signal assembly, signal-block rendering, density gate, prompt builder, output normaliser, **fabrication guard** |
| `api/_handlers/briefing-analyst-take-tick.js` | the tick: fetch → generate on-box → validate → write, all fail-soft |
| `server.js` / `api/admin.js` | mount + dispatch `/api/briefing-analyst-take-tick` |
| `supabase/migrations/20261001121000_…sql` | `analyst_take_meta` column, `feature_flags_registry` row, pg_cron job 240 — **all applied live** |
| `supabase/functions/briefing-intel-snapshot/index.ts` | edge fn now **omits** `analyst_take` when it has none (see §5) — **committed, NOT yet deployed** |
| `test/briefing-analyst-take.test.mjs` | planner + wiring guards (17 tests) |
| `test/briefing-analyst-take-tick-e2e.test.mjs` | the real handler end-to-end over a stubbed `fetch` (13 tests) |

### Routes

```
GET  /api/briefing-analyst-take-tick               dry run: signals + block + density. No model call, no write.
GET  /api/briefing-analyst-take-tick?generate=1    + renders a take inline for human grading. STILL no write.
POST /api/briefing-analyst-take-tick               generate + write. Flag-gated.
POST /api/briefing-analyst-take-tick?force=1       regenerate over an existing take.
POST /api/briefing-analyst-take-tick?dry_run=1     treated as a dry run.
```

`?generate=1` on GET is intentionally **not** flag-gated: grading a sample is the
precondition for turning the flag on, so it cannot itself require the flag.

## 4. The signal set — reused, labelled, capped

Assembled from the existing `briefing-data.js` fetchers (no re-derivation):
`fetchWorkCounts`, `fetchMyWork`, `fetchInboxSummary`, `fetchRecentSfActivity`,
`fetchHotContacts`, `fetchDiaPipeline`, `fetchPipelineRollup`,
`fetchDealPropagationDelta`, `fetchIntelSnapshot`, `fetchLccHealthSnapshot`.
Every figure is rendered as pre-formatted prose carrying **the table or view it came
from**, never raw JSON (the v5.3 lesson the edge function already records).

Three decisions in here are load-bearing:

- **⚠️ `buildStrategicPriorities` is deliberately NOT called.** It is the obvious
  "reuse, don't re-derive" target and it has a **side effect**: under
  `TEAMS_COLD_ALERTS_ENABLED` it posts up to three outbound *"Warm Contact Going
  Cold"* Teams alerts, plus one `rpc/get_contact_recommendation_weight` round trip
  per candidate. Calling it from a 10:18 cron would **double-send those alerts** —
  once here, once when the brief renders at 12:30. The tick instead reuses the shared
  **scorer** (`scoreItem` / `deriveItemTitle`, the actual ranking authority) and
  applies the identical strategic-3 / important-3 / urgent-4 / cap-7 selection in
  `rankTodayPriorities`, which is pure and unit-tested against that rule.
- **⚠️ No pipeline dollar figure is ever sent.** `fetchPipelineRollup` hard-codes
  `total_value: 0` and `weighted_value: 0` because the SF `Amount`/`Probability`
  fields are not in the projection it reads. Passing those through would render
  "$0 pipeline" — which reads as *worthless*, not as *unvalued* (P180: NULL is not
  zero). The block states the value is **not on file** and instructs the model not to
  state one. A test asserts `$0` never appears in the block.
- **Cooling contacts are labelled as unranked.** The email's "recommended calls" are
  re-weighted per contact by an RPC this tick does not call, so the block says the
  ordering is raw `engagement_score` — the take never claims an ordering it did not read.

A carried-over (non-today) macro snapshot is flagged `NOT today's data, say so if you
use it` rather than passed off as current.

## 5. Two writers, one column — how they stop fighting

`analyst_take` now has **one owner**, and the ownership is enforced on both sides:

- **The tick writes with a `PATCH`** of exactly two columns
  (`analyst_take`, `analyst_take_meta`) scoped to
  `?as_of_date=eq.<CT today>&workspace_id=is.null`. It cannot touch `market_data`,
  `sector_news`, `capital_markets`, `reading_list` or `warnings`, and it cannot mint a
  duplicate row. Only when today's row does **not** exist (a manual run ahead of the
  10:00 edge cron) does it fall back to a `merge-duplicates` upsert carrying only
  those keys — PostgREST derives the `ON CONFLICT … DO UPDATE` column list from the
  payload **keys**, so omitted columns are preserved, not nulled. A test asserts the
  writer names none of the edge function's columns.
- **The edge function now omits `analyst_take` when it produced none**
  (`if (row.analyst_take == null) delete row.analyst_take;`). Without this, any
  re-fire after 10:18 — a manual curl, a backfill, the hourly self-heal — would upsert
  `null` over the on-box take and the brief would go **silently empty again**. A test
  asserts the guard is present.

*(The hourly self-heal, jobid 87, only fires when **no** row exists for today, so it is
not a clobber path in normal operation. The guard is for the manual re-fire.)*

## 6. Never fabricates — and a rejected take is thrown away, not patched

`validateAnalystTake` re-reads the generated prose against the signal block:

- **Any ungrounded number or date REJECTS the whole take.** One retry is issued
  naming the fabricated tokens back to the model, if the time budget allows; a second
  failure leaves `analyst_take` untouched. Deliberately *not* draft-assist's behaviour
  of substituting `[Not on file]` — a brief riddled with that is worse than an empty
  section, and the email already degrades to empty gracefully.
- **The number regex is stricter than `draft-assist-core.js`'s `NUM_TOKEN` on
  purpose.** That one requires 3+ digits for a bare number (`\d[\d,]{2,}`), which is
  right for prose about prices and wrong here: the dangerous fabrication in a brief is
  a small **count**. *"You have 9 overdue actions"* when the truth is 7 reads perfectly
  and is a lie. A test covers exactly that case.
- **Proper names are reported, never fatal** (`analyst_take_meta.ungrounded_names_reported`).
  The name regex over-fires on ordinary capitalised prose, and killing a whole take on
  a false positive would be the P158a mistake — the obvious guard being the
  destructive one.

A **thin** day (`assessSignalDensity` → `level: 'thin'`) gets a prompt that demands
one short factual paragraph and explicitly forbids padding: *"A short honest take is
the correct output; padding it with market commentary you were not given is a
failure."* The quiet day is where an invented take would slip through easiest.

## 7. Fail-soft, and never silently empty

Every failure path returns **HTTP 200**, leaves `analyst_take` exactly as it was, and
names its reason: `flag_off`, `already_written`, `model_unavailable`,
`empty_generation`, `fabrication_rejected`, `write_failed`.

Each **unchosen** failure opens a deduped `lcc_health_alerts` row
(`alert_kind='briefing_analyst_take_empty'`, `source='briefing_analyst_take_tick'`),
and a successful write **resolves** it — the auto-retire half of the doctrine.

**`flag_off` deliberately opens no alert.** An off flag is a state someone *chose*, and
`feature_flags_registry` plus the brief's own "Dormant Capabilities" section already
surface it; an alert row describing a decision would sit open forever, which is the
badge-that-is-mostly-noise failure.

`analyst_take_meta` carries the provenance a later reader needs:
`{source:'onprem_ollama', model, generated_at, density, signal_counts, prompt_chars,
voice_basis, attempts, ungrounded_names_reported, fetch_errors, elapsed_ms}`.
`source='onprem_ollama'` is what distinguishes an on-box take from the old cloud ones.

## 8. Verification performed

- **Unit + wiring:** `test/briefing-analyst-take.test.mjs` — 17 tests.
- **End-to-end over stubbed HTTP:** `test/briefing-analyst-take-tick-e2e.test.mjs` —
  13 tests running the **real handler**: dry run makes no model call and no write;
  apply writes a non-empty take via a scoped PATCH; the payload reaches
  `OLLAMA_URL/v1/chat/completions` and no cloud host; a `$42.5M` fabrication is
  rejected with nothing written and an alert opened; a down model, an existing take,
  and a flag-off run each fail soft correctly.
- **Negative controls (each confirmed to turn the suite RED, then reverted):**
  removing the edge-function guard; weakening the fabrication guard so numbers stop
  being fatal; making the handler write `market_data`.
- **Full suite:** `npm test` → **4,511 pass / 0 fail / 6 skipped**.
- **DB:** `analyst_take_meta` column present; `BRIEFING_ANALYST_TAKE_ONPREM`
  registered `state='off'`; pg_cron jobid **240** `18 10 * * 1-5` active.

**Not verified, and cannot be from here — say so rather than implying otherwise:** the
sandbox has no `OLLAMA_URL`, no Cloudflare Access credentials and no Railway
deployment, so **no live take has been generated by the real local model**. Every
model interaction above is a stub. Grading a real sample is step 3 of the gate below,
and it is the step that decides whether the flag flips.

## 9. Operator gate (in order)

1. **Merge + let Railway redeploy `main`**, then `npm run verify:deploy`. The route
   404s until this lands, so cron 240 is a harmless no-op in the meantime.
2. **Deploy the edge function** — committed here but **not deployed**:
   `supabase functions deploy briefing-intel-snapshot --project-ref xengecqvemvfknjvbvrq --no-verify-jwt`
   (it currently runs `verify_jwt=false`; keep it). Required *before* step 4, or a
   manual re-fire of the snapshot can null the on-box take. Deployed version at time
   of writing was **v20**, byte-identical to the pre-change repo file — no drift.
3. **Grade a real sample, with the flag still off:**
   ```
   GET /api/briefing-analyst-take-tick?generate=1
   ```
   Read `analyst_take` against `signal_block` in the same response. Ask of every
   sentence: *is this figure in the block?* Check `generation.ungrounded_names_reported`.
   Confirm `voice_profile.basis === 'sections'` and that the prose sounds like Scott —
   short, direct, specifics over adjectives, no filler, no headings or sign-off.
   If it fails, fix the prompt; do **not** flip the flag.
4. **Flip the flag** (Railway env `BRIEFING_ANALYST_TAKE_ONPREM=on`, or
   `UPDATE feature_flags_registry SET state='on', off_since=NULL WHERE flag='BRIEFING_ANALYST_TAKE_ONPREM';`).
5. **Verify the next morning — on the take, not on the tick.** "The tick ran" is not
   the assertion:
   ```sql
   SELECT as_of_date,
          length(analyst_take)                AS take_len,
          analyst_take_meta->>'source'        AS take_source,
          analyst_take_meta->>'model'         AS model,
          analyst_take_meta->>'density'       AS density,
          analyst_take_meta->'signal_counts'  AS signals,
          length(capital_markets)             AS cm_len
     FROM briefing_intel_snapshot
    WHERE as_of_date = (now() AT TIME ZONE 'America/Chicago')::date;
   ```
   Expect `take_len > 0` and `take_source = 'onprem_ollama'`. Then **read the email**.
   And check nothing is stuck open:
   ```sql
   SELECT * FROM lcc_health_alerts
    WHERE alert_kind = 'briefing_analyst_take_empty' AND resolved_at IS NULL;
   ```

## 10. Still open (not this build)

- **`capital_markets` is still empty and still cloud-dependent.** Same Anthropic
  billing failure, same seven-week outage, untouched here because the prompt scoped
  this to `analyst_take`. Either restore Anthropic credit or give that section the same
  on-box treatment — it reads public market data only, so it is the easier of the two.
- **The edge function still calls Anthropic** for both sections. Once credit is
  restored it will start writing `capital_markets` again; it can no longer overwrite
  `analyst_take` with a null, but if it ever produces a *non-null* take it would
  overwrite the on-box one. Gate its `analyst_take` half off when the on-box path is
  proven.
- **R8 Stage 2** — the same on-box generation pattern for CM quarterly book copy
  (higher stakes: client-facing).
