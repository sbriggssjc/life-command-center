# HP1-P1a-fix — the SF opportunity upsert has NEVER updated a row

**Filed 2026-09-12 from a live read-only diagnosis (Cowork), after HP1-P1a.** Supersedes HP1-P1a's
framing: the feed did not "stop". It has **never been able to UPDATE**, only INSERT, since the day it
was built. Everything below is measured. Re-measure before building — that is this repo's rule.

---

## The measurement

**The flow is healthy and is NOT the problem.** `SF Deal → LCC Opportunity Sync` (PA flow
`eb1181ba-7b33-482d-bf12-62f4243162fc`): Recurrence every 30 min, Salesforce `Get records` on
`Opportunity` filtered by six `RecordTypeId` values, **no `LastModifiedDate` filter — it is a FULL
REFRESH**, then ONE POST of the whole array to `/api/pipeline/ingest-opportunities`.

Run 2026-09-12 06:00 UTC, status **Succeeded**:

| step | result |
|---|---|
| `Get records` | **608 records returned** |
| `HTTP` POST | **200** |
| response body | `{"ok":true,"total":608,"succeeded":0,"failed":608,...}` |
| every `errors[].error` | `upsert_failed`, `status: 502` |

Postgres logs, same second (`06:00:43`–`06:00:44Z`), 608 times:

```
duplicate key value violates unique constraint "bd_opportunities_workspace_id_sf_opp_id_key"
```

**So the upsert is executing as a PLAIN INSERT.** `Prefer: resolution=merge-duplicates` is not taking
effect and PostgREST never emits the `ON CONFLICT … DO UPDATE`.

**Ruled out, do not re-walk:**

- The unique constraint **exists and is inferable** — `UNIQUE (workspace_id, sf_opp_id)`, a plain
  two-column btree, not partial and not an expression index (so it is NOT the documented
  "expression/partial index is invisible to PostgREST" case).
- **Direct SQL works.** `INSERT … ON CONFLICT (workspace_id, sf_opp_id) DO UPDATE` was probed live
  inside a rolled-back transaction and succeeded. The SQL is fine; the failure is at the PostgREST layer.
- **Nothing regressed.** The upsert call is unchanged since `83cd873f` (2026-07-27); the constraint
  since `20260522190100`. `deal_name`/`property_address` were added 2026-07-28, a week before the
  break, and wrote fine on 08-03 — so this is not a stale PostgREST schema cache (PGRST204).
- **Not auth, not RLS.** A duplicate-key error proves the INSERT reached the table and executed.
- **Not the Salesforce side.** 608 records arrive every 30 minutes.

**Why it looked fine for six weeks:** on 2026-08-03 the table was empty, so all 590 rows INSERTed
with no conflict; 15 more on 08-04. Every run since has collided. The only writes that have landed
are **5 brand-new `sf_opp_id`s** (08-20, 09-03, 09-07, 09-09) — and all five have
`created_at == last_synced_at` **to the second, i.e. all five are INSERTs. Zero UPDATEs have ever
succeeded.**

## What that means (this is the point)

**No stage change and no close has ever propagated from Salesforce into LCC.** The deal backbone
learns a deal exists at creation and is frozen at that instant forever. This is the single root cause
under all of HP1 Finding 2: 22 of 50 open deals past their `expected_close_date` (ECU Physicians MOB
**746 days**, ATEK Brainerd 683, GSA-MSHA Oakwood 515), stages frozen, 57 of 66 `action_items`
overdue, the My Work graveyard — all of it is downstream of a backbone that cannot be updated.

⚠️ **`closed_at` on all 569 closed rows is the Aug 3/4 INSERT timestamp, not the real close date.**
Those dates were never captured and are not recoverable from LCC.

---

## Units

### Unit 1 — establish the PostgREST reason (TIME-BOXED, then move on)
One probe against the live endpoint with a single known-existing `sf_opp_id`, reading the **`detail`**
field the single-deal route returns (`/api/pipeline/ingest-opportunity` returns it; `ingestBatch`
throws it away — that is Unit 3). Record the verbatim PostgREST error. **Box this at ~30 minutes.**
The fix does not depend on the answer, and a wrong guess here costs nothing if Unit 2 lands.

### Unit 2 — fix the write, RPC-first
This repo has already reached this conclusion once and written it down:

> *PostgREST's write surface is NARROWER than SQL's … Use an RPC taking a `jsonb` array, not a
> PostgREST upsert.*

Ship `lcc_upsert_bd_opportunities(p_deals jsonb)` — a `SECURITY DEFINER` function doing a single
`INSERT … ON CONFLICT (workspace_id, sf_opp_id) DO UPDATE`, returning per-row outcomes
(`inserted` / `updated` / `skipped` + reason) so the caller can count honestly. `processDeal` keeps
owning entity resolution, stage mapping and owner mapping; only the final write moves.

⚠️ **Definer privileges:** the migration MUST carry `revoke … from public, anon, authenticated` plus a
`has_function_privilege()` assertion in the SAME file — `test/sql-definer-privilege-stanza.test.mjs`
enforces this and it is the repo's most-repeated security defect.

⚠️ **Do not "fix" this by dropping or widening the unique constraint.** It is correct and it is the
only thing preventing duplicate opportunities.

### Unit 3 — a batch endpoint must not return 200 when it wrote nothing
`ingestBatch` currently ends `return res.status(200).json({ ok: true, ...summary })` **unconditionally**
— it returned `ok: true` with `failed: 608`. Power Automate reads the status code, sees 200, and
reports Succeeded. **That is why six weeks of total failure was invisible from both ends.**

Return a non-2xx (502) when `total > 0 && succeeded === 0`, and set `ok: false`. Consider a partial
signal when `failed > 0 && succeeded > 0` — but **a fully-failed batch must be loud**. Also carry
`errors[].detail` through, not just the label: `upsert_failed` cost a diagnosis cycle that `detail`
would have ended immediately.

### Unit 4 — stop re-stamping `closed_at`
`processDeal` sets `closed_at: isClosed ? new Date().toISOString() : null` on every sync. Once Unit 2
lands, the first successful run overwrites the close timestamp on **569** already-closed deals with the
restart time. Preserve an existing non-null `closed_at` on update; set it only on the transition into
closed. (The historical dates are already lost — do not fabricate them; this stops the loss recurring.)

### Unit 5 — guards
- A test that a batch whose deals all fail returns **non-2xx** (mutation-verify it goes RED).
- A test that a second upsert of the same `sf_opp_id` **UPDATEs rather than erroring** — the assertion
  this whole defect existed for. Prove it against a real round trip, not a mock.
- A test that `closed_at` survives a re-sync of an already-closed deal.

---

## Verification — and what does NOT count

**Does not count:** HTTP 200. A green PA run. `summary.succeeded`. Any self-reported tally. All four
have read healthy for six weeks over a 100% failure rate.

**Counts:** re-run the flow, then read the DB —

```sql
select count(*) filter (where last_synced_at > now() - interval '1 hour') as touched_this_run,
       count(*) filter (where last_synced_at > now() - interval '1 hour'
                          and created_at < now() - interval '1 day') as UPDATED_not_inserted
from bd_opportunities;
```

`UPDATED_not_inserted` must be in the hundreds. **That number has been 0 for the life of this feed;
it is the only honest signal that the defect is fixed.**

Then re-measure HP1's own numbers: open rows frozen at 2026-08-03 (**37** today) must go to 0, and
the count of open deals with a past `expected_close_date` (**22** today) should fall as real closes
finally land.

---

## Cautions

⚠️ **Snapshot `bd_opportunities` before the first live full run.** 608 rows change at once, six weeks
of stage drift lands in a single batch, and it is the first UPDATE this table has ever taken from this
path. Take a backup table with a batch tag and state the reversal in the migration header.

⚠️ **Expect a large auto-retire.** `lcc_generate_deal_next_steps()` retires on stage change, so a
backlog of real closes will retire many `deal_next_step` tasks in one pass. **Verify that against the
ledger** rather than being surprised — and confirm it is retiring tasks for deals that genuinely
closed, not silently clearing the queue.

⚠️ **Do NOT add a `LastModifiedDate` filter to the PA flow to "reduce load".** The full refresh is
what heals six weeks of missed changes in one run. A delta window would permanently strand them.

⚠️ **Keep `last_synced_at` stamped unconditionally on every write.** It is the only column that
distinguishes *the feed touched this row* from *this row changed*, and reading `updated_at` instead is
what hid this outage for six weeks (HP1-P1a's own corrected finding).

🔐 **`LCC_API_KEY` is exposed** — it sits in plaintext in the PA flow's HTTP header and was flagged as
exposed on 2026-08-03 (backlog SEC1, never done; these runs succeeding proves it was never rotated).
Rotate it after the feed is verified working, and update the flow header in the same change.

**Deploy:** engine code ⇒ redeploy **both** Railway services (tranquil-delight + the standalone MCP),
then `npm run verify:deploy`. The migration ships first, the JS after.

**Standing rules:** never fabricate — "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with
the repo's `Co-Authored-By` + `Claude-Session` trailer.
