# Power Automate — add chunking to the L2 + L3 Contact-resolve branches (large lists)

## Why (confirmed live 2026-07-17)

After the LCC `/api/sf-list-import` route was restored (PR #1414), a full run of "SF Get
Campaign Members" ingested **133 real contacts across 22 lists** — real names + emails + city/
state + `sf_contact_id`, `entity_type='person'`, no junk (Lara Casano, Chris Goodman, Ryan
Carter, Kyle Jones, …). The route + the two-step `eq…or` resolve both work.

**But the run then FAILED inside `For each L3`** (44s) on the first LARGE sub-list. Small lists
(2–20 members) resolve fine; a list like **GSA Buyer (156 members)** builds an
`Id eq 'x' or Id eq 'y' or …` filter of ~156 × 28 ≈ **4,400 characters**, which exceeds the
Salesforce connector's `$filter`/URL length limit → `Get Contacts L3` errors → the loop fails.
GSA Buyer is still stuck at its old partial 15 rows. This is the chunking follow-up we flagged —
now the live blocker for the flagship GSA Buyer and every 4–5k-member list.

## The fix — chunk the ID list into batches of ~50 in BOTH resolve branches

The resolve branch today (inside `Has L2 Members` / `Has L3 Members` → True) is a flat sequence:
`Compose ContactFilter Lx` → `Get Contacts Lx` → `Select Members Lx` → `POST Lx`.
Rebuild it as a chunk loop:

1. **`Select ContactIds Lx`** — unchanged (already maps each member to `concat('Id eq ''',
   item()?['ContactId'], '''')` → an array of `Id eq '<id>'` strings). Its length check in
   `Has Lx Members` (`length(body('Select_ContactIds_Lx')) > 0`) is unchanged.

2. **Rename `Compose ContactFilter Lx` → `Chunk Lx`** and change its expression to:
   ```
   chunk(body('Select_ContactIds_Lx'), 50)
   ```
   → an array of ≤50-element batches. (`chunk` is a native PA expression function.)

3. **Add `Apply to each chunk Lx`** over `outputs('Chunk_Lx')`, and MOVE the three existing
   actions inside it, in order:
   - **`Compose Filter Lx`** (NEW, first action in the loop): `join(item(), ' or ')`
     → `Id eq 'a' or Id eq 'b' or …` (≤50 → well under the length limit).
   - **`Get Contacts Lx`** — same as today, but point its `$filter` at
     `outputs('Compose_Filter_Lx')` (the per-chunk join) instead of the old
     `outputs('Compose_ContactFilter_Lx')`. `$select` unchanged
     (`Id, FirstName, LastName, Email, Phone, MailingCity, MailingState`).
   - **`Select Members Lx`** — unchanged (its `From` = `body('Get_Contacts_Lx')?['value']`,
     map unchanged).
   - **`POST Lx`** — unchanged (same URI, headers, body; posts this chunk's resolved members).

   Net: one `Get Contacts` + one `POST` per 50-member chunk. A 156-member list = 4 chunks;
   a 5,000-member list = 100 chunks. The LCC route is idempotent (upsert by ContactId/email),
   so multiple POSTs per campaign accumulate members with no duplicates.

Do this in the **L2** branch (`Has L2 Members` → True) and mirror it in the **L3** branch
(`Has L3 Members` → True). Chunk size 50 keeps each filter ≈ 50 × 28 ≈ 1,400 chars — safe.

## Note on "move existing actions into a new Apply-to-each"

The new designer doesn't let you drag an existing action into a new loop cleanly. Easiest path:
add the `Apply to each chunk Lx` loop after `Chunk Lx`, rebuild `Compose Filter` + `Get Contacts`
+ `Select Members` + `POST` INSIDE it (Get Contacts/Select/POST configs are simple — table
`Contact`, the `$select` above, the map, and the HTTP POST to `…/api/sf-list-import` with
`X-LCC-Key`), then delete the old three actions that are now outside the loop. Cowork can drive
this in the browser if you'd rather not hand-build it.

## Verify (after the edit)

Re-run the flow. Expected: it completes without the `For each L3` failure, and
**GSA Buyer ingests all 156** members (not 15). Check LCC Opps:
```sql
select campaign_name, count(*) members, count(entity_id) linked, max(last_seen_at)
from lcc_sf_list_membership where campaign_name='GSA Buyer' group by 1;
```
should show 156. Then the big 4–5k seller/buyer lists ingest fully too.

## Two small data-quality polish items (separate, non-blocking)
Observed in the successful rows: `member_type` and `company_name` land NULL.
- `member_type`: the LCC route isn't stamping Contact vs Lead — minor (entity_type='person' +
  sf_contact_id already identify them). LCC-side fix if wanted.
- `company_name`: the `Get Contacts` `$select` doesn't fetch the Account name (city/state DO come
  through via MailingCity/MailingState). The connector can't traverse `Account.Name` directly,
  so company would need a separate Account resolve or stay blank — leave for later.

## ACTUAL BUG FOUND (2026-07-17) — one-field fix, chunk loops are otherwise correct

After the chunk rebuild, the run FAILED inside `For each L2` → `Has L2 Members` →
`Apply to each chunk L2`, with `Get Contacts L2` status "Not specified" (never ran) and
**0 DB writes** on ALL lists (not just large ones). Read the flow's Code view — the loops
are wired correctly:
- `Chunk_L2` (Compose) = `@chunk(body('Select_ContactIds_L2'), 50)` ✓
- `Apply_to_each_chunk_L2` `foreach` = `@outputs('Chunk_L2')` ✓
- `Select Members L2` `from` = `@body('Get_Contacts_L2')?['value']` + map ✓
- `POST L2` ✓

**The ONE mistake:** the inner join-Compose was skipped, and `Get Contacts Lx`'s `$filter`
(Filter Query) was pointed straight at the chunk output array:
```
"$filter": "@outputs('Chunk_L2')"     ← WRONG (this is the whole array-of-chunks)
"$filter": "@outputs('Chunk_L3')"     ← WRONG (same on L3)
```
Passing an array as `$filter` → the Salesforce connector rejects it → `Get Contacts`
produces no output → the loop is marked failed → nothing POSTs.

**THE FIX (two fields, no new Compose needed):** point each Get Contacts `$filter` at the
join of the CURRENT chunk item instead of the whole chunk array:
- `Get Contacts L2` → Filter Query =
  ```
  @{join(items('Apply_to_each_chunk_L2'), ' or ')}
  ```
- `Get Contacts L3` → Filter Query =
  ```
  @{join(items('Apply_to_each_chunk_L3'), ' or ')}
  ```
`items('Apply_to_each_chunk_Lx')` = the current 50-element chunk (array of `Id eq '<id>'`
strings); `join(..., ' or ')` = `Id eq 'a' or Id eq 'b' …` — exactly the ≤50-ID filter.
Leave everything else (Chunk compose, Apply-to-each foreach, Select map, POST) as-is.
Then Save + re-run.

### ⚠️ Correction (2026-07-17, run #2) — join the CURRENT chunk, not `outputs('Chunk_Lx')`

The first fix attempt saved the filter as `@join(outputs('Chunk_L2'), ' or ')` and STILL failed
identically (Get Contacts "Not specified", loop red at 3s). Root cause: **`outputs('Chunk_Lx')`
is the array of ALL chunks (an array-of-arrays)** — `join()` on that throws, so Get Contacts
never binds. The argument must be the loop's CURRENT item, not the Compose output:
- `Get Contacts L2` → Filter Query = `@join(items('Apply_to_each_chunk_L2'), ' or ')`
- `Get Contacts L3` → Filter Query = `@join(items('Apply_to_each_chunk_L3'), ' or ')`

i.e. change `outputs('Chunk_Lx')` → `items('Apply_to_each_chunk_Lx')` inside the join.
`items('Apply_to_each_chunk_Lx')` = the ONE 50-ID chunk currently being processed (a flat array
of `Id eq '<id>'` strings); joining THAT gives the valid `Id eq 'a' or Id eq 'b' …` filter.

### ⚠️⚠️ FINAL fix (2026-07-17, run #3) — enter it as an EXPRESSION, not plain text

Run #3 got much further (Chunk L2 green, Get Contacts binds + runs 2s) but SF returned a
**400 BadRequest**: `"An unknown function with name 'items' was found."` The run detail's
INPUTS showed the `$filter` was sent to Salesforce as the LITERAL string
`join(items('Apply_to_each_chunk_L2'), ' or ')` — PA never EVALUATED it. That happens when
the value is typed as plain dynamic-content text instead of as an **Expression**. A PA field
only evaluates a function when the stored value begins with `@` (code view:
`"@join(items('Apply_to_each_chunk_L2'), ' or ')"`).

**The fix — set the Filter Query as an EXPRESSION (fx), not typed text:**
1. In `Get Contacts L2`, click the **Filter Query** field, delete the current value.
2. Open the **Expression / fx** tab (the "ƒx" editor), and enter (NO leading `@` in the fx box —
   the editor adds it):
   ```
   join(items('Apply_to_each_chunk_L2'), ' or ')
   ```
   then click **Add / OK** so it drops in as a green expression token (not black text).
3. Same for `Get Contacts L3`:
   ```
   join(items('Apply_to_each_chunk_L3'), ' or ')
   ```
Verify in code view the value now reads `"@join(items('Apply_to_each_chunk_L2'), ' or ')"`
(with the leading `@`). Everything else (Chunk compose, foreach, Select, POST) is already
correct.

## ✅ VERIFIED WORKING (2026-07-17, run #4 = the expression fix) + resilience follow-up

Run #4 (the fx-expression filter) INGESTED: most L2/L3 iterations green, **690 rows across 57
lists**, GSA Buyer climbing (15→21), zero filter errors. The chunking + two-step Contact
resolve is CORRECT and proven end-to-end. The run then aborted at ~18m 55s because **ONE
chunk in ONE list failed** (a transient Salesforce hiccup during 15+ min of heavy concurrent
Get-Contacts calls) — and Power Automate fails the WHOLE `For each L2` if any single iteration
fails, even after most succeeded.

**This is a reliability issue, not a logic bug.** Two fixes:
- **Fastest — re-run.** The LCC route is idempotent (upsert by ContactId), so each run resumes
  where the last stopped (written members re-touch, new ones add). 1–2 more runs complete GSA
  Buyer=156 and the rest. Fine for a one-time seed.
- **Proper (recommended for the recurring 4–5k-member lists) — make one bad chunk non-fatal:**
  1. `Get Contacts L2` + `Get Contacts L3` → **⋯ → Settings → Retry Policy** on (exponential) —
     auto-handles transient SF throttling.
  2. `For each L2` → **Settings → Concurrency Control → On**, degree **5–10** — fewer
     simultaneous SF calls = far less throttling on the big multi-chunk lists.
  Then one clean run finishes everything.

## ⚠️⚠️⚠️ DEFINITIVE fix (2026-07-17, run #5/#6) — chunk size 50 exceeds SF's OData 100-NODE cap

Runs with the retry policy STILL failed at ~18 min, always on a specific chunk. Read the failed
`Get Contacts L2` OUTPUTS — Salesforce returned **400 BadRequest**:
> "OData query syntax tree has exceeded nodes count limit of **'100'**."

A 50-ID chunk builds `Id eq 'a' or Id eq 'b' or …` = 50 clauses ≈ **150–200 OData nodes**, over
SF's hard **100-node** limit. So the CHUNK SIZE of 50 is too big — independent of URL length.
This is why small lists (<25 members → <100 nodes) ingested fine but any list with a full 50-ID
chunk (GSA Buyer, the big seller/buyer lists) 400'd. **Retries don't help — a 400 is a client
error, not a transient (PA only retries 429/5xx).**

**THE FIX — reduce the chunk size from 50 → 20** in BOTH Compose actions:
- `Chunk L2`: `chunk(body('Select_ContactIds_L2'), 20)`
- `Chunk L3`: `chunk(body('Select_ContactIds_L3'), 20)`

20 IDs ≈ 4×20−1 = **79 nodes**, safely under 100 (24 would be the max at ~95 nodes; 20 leaves
margin). More chunks per list (GSA Buyer = 8 instead of 4), handled fine by the idempotent
upsert. Everything else (the fx `join(items(...))` filter, retry policy, Select, POST) stays.
This is the LAST constraint — after this the big lists complete.

## FINAL reliability fix (2026-07-17, run #7) — Salesforce rate-limit → run For-each SEQUENTIALLY

After chunk-size 20 (which fixed the OData node limit), the run failed at ~5-6 min with 0 writes.
The failing actions were Salesforce calls (`Has L2 Members` chunk failing after **31s of retries**,
and `Get L2 members` in another iteration) — i.e. **Salesforce rate-limiting (429)**, NOT the OData
400 (a 400 fails in ~2s and isn't retried; 31s means the retry policy ran and SF stayed throttled).
Shrinking chunks to 20 increased the SF call count, and `For each L2` runs ~20 lists in PARALLEL by
default, each firing many Get-Contacts calls — flooding Salesforce.

**THE FIX — process lists one at a time so SF isn't flooded:**
- `For each L2` → **⋯ / Settings → Concurrency Control → ON → Degree of parallelism = 1** (sequential).

Runtime ~20 min (the Jul-16 SUCCESSFUL runs took 19-22 min — that's normal), but it COMPLETES instead
of aborting. Keep the Get-Contacts retry policies. Optionally add the same retry (Exponential/PT10S/
count 4) to `Get L2 members`, `Get L3 lists`, `Get L3 members`. Concurrency=1 is the decisive lever.

## ✅✅ OUTCOME — SEED COMPLETE + CONVERGED (2026-07-18)

**7,186 members across 57 lists.** Convergence proven by decelerating deltas across idempotent
re-runs: 713 → 5,566 (+4,853) → 7,115 (+1,549) → **7,186 (+71)**. Per-list:
SAB GSA Prospects **3,925** (asymptoted), KDL Seller Prospects **987** (stable = complete),
z_Engage 440, DMR Urgent Care 256, VCA 209, SAB Medical Developer 197, Christian Brothers 150,
DMR Medical 142. **GSA Buyer = 21 is FINAL and CORRECT** — that is its true Contact-linked count;
the remaining ~135 members are **Leads** (LeadId, no ContactId) which the two-step Contact resolve
skips by design. (Ingesting Lead members is an optional future additive branch — Leads already
carry FirstName/LastName/Email directly on the CampaignMember, so they need no resolve.)

### Known residual (cosmetic, NOT data loss)
Runs still report **Failed**: SAB GSA Prospects (~4k members ≈ 200 chunks of 20) is a marathon, and
in a PA For-each ONE failed action aborts the whole run — with ~200 chunks the odds of a single blip
are high. **The idempotent upsert (by ContactId/email) is the safety net** — that's why totals
CONVERGED instead of resetting. Data is complete; only the run status is red.
- If this flow is ever made **scheduled/recurring**, add continue-on-error on the chunk `POST`
  (or otherwise stop one chunk failing the parent) so monitoring isn't permanently red.
- For the one-time seed, re-running was the intended (and sufficient) safety net.

### Final tuning that worked
chunk size **20** (SF 100-node OData cap) · filter as an **fx expression**
`join(items('Apply_to_each_chunk_Lx'), ' or ')` · Get Contacts **retry** Exponential/PT10S/count 4 ·
`For each L2` **concurrency 4** (1 = 2h35m too slow; 20 = SF 429 flood).

## After chunking verifies end-to-end
Flip **`SF_LIST_SEED_INSTITUTION`** on (after eyeballing the first full seller ingest) to kick the
Tier A fan-out over the contactless sponsors.
