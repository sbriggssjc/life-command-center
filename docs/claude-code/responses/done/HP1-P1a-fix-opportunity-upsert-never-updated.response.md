# HP1-P1a-fix — response

Units 2, 3, 4 shipped. Unit 1 boxed as instructed (mechanism found by reading source, not
re-probed live).

## Unit 1 (boxed, ~15 min)

`mcp/opportunity-sync.js` called
`opsQuery('POST', 'bd_opportunities?on_conflict=workspace_id,sf_opp_id', row, { Prefer:
'resolution=merge-duplicates,return=representation' })`. This module is mounted on two
incompatible `opsQuery` signatures:

- `api/_shared/ops-db.js::opsQuery(method, path, body, opts)` — a plain `{Prefer: ...}` object
  with no `headers`/`countMode`/`timeoutMs` key is treated as **legacy headers** and spreads
  correctly. This path is fine.
- The standalone MCP's own `mcp/server.js::opsQuery(method, path, body, prefer)` — `prefer` is
  interpolated directly as a single header **string**: `Prefer: prefer || 'return=representation'`.
  Handed an object, undici's `Headers` coerces it via `String()` to the literal `"[object Object]"`.
  PostgREST cannot parse that as a Prefer directive and silently falls back to a plain INSERT with
  no `ON CONFLICT` handling — exactly the observed 608× duplicate-key violation.

Not independently re-verified against a live probe (time-boxed per the prompt); the fix removes
the dependency on this header entirely rather than reconciling the two signatures, so it is correct
whichever `opsQuery` implementation actually served the traffic.

## Unit 2 — RPC-first fix

`supabase/migrations/20261101170000_lcc_hp1p1a_opportunity_upsert_rpc.sql`:
`lcc_upsert_bd_opportunities(p_deals jsonb)` — one `INSERT ... ON CONFLICT (workspace_id,
sf_opp_id) DO UPDATE` per array element, `SECURITY DEFINER`, revoked from `public`/`anon`/
`authenticated`, granted to `service_role` only, asserted with `has_function_privilege()` (passes
`test/sql-definer-privilege-stanza.test.mjs`). Returns `inserted`/`updated`/`skipped(+reason)` per
row. `processDeal` (`mcp/opportunity-sync.js`) now calls this RPC instead of the raw PostgREST
upsert — no `Prefer` header needed at all, so the header-signature mismatch can't recur here.
Also includes a one-time `_hp1_p1a_bd_opportunities_pre_fix_backup` snapshot table (created via
`CREATE TABLE IF NOT EXISTS ... AS SELECT * FROM bd_opportunities`), per the prompt's caution to
snapshot before the first live run.

## Unit 4 — stop re-stamping `closed_at`

Lives in the RPC's `ON CONFLICT DO UPDATE SET`: `closed_at = COALESCE(bd_opportunities.closed_at,
EXCLUDED.closed_at)`, same for `closed_won`. An existing non-null value is preserved; it is set
only on the genuine transition into closed (existing NULL, incoming non-null). The 569
already-closed rows keep their Aug-3/4 insert timestamp exactly as documented — not recoverable,
and this stops it recurring on every future 30-min sync.

## Unit 3 — a batch endpoint must not lie with 200

`ingestBatch` now returns **502 / `ok:false`** when `total > 0 && failed === total`; a partial
failure stays 200 but adds `partial: true`. Both the single (`ingest`) and batch (`ingestBatch`)
paths carry `errors[].detail` through, not just the label.

## Unit 5 — guards

`test/hp1-p1a-opportunity-upsert.test.mjs`, 6 tests, all green:

1. a second sync of the same `sf_opp_id` UPDATEs (never re-collides on the unique key) — proven
   against a hand-rolled model of the migration's exact `ON CONFLICT` shape, not a live DB (sandbox
   has none). Mutation-checked: reverting the 502-on-full-failure line makes test 3 fail red.
2. `closed_at` survives a re-sync of an already-closed deal.
3. a fully-failed batch returns non-2xx.
4. a partial failure stays 200 and is flagged.
5. source guard: writes go through `rpc/lcc_upsert_bd_opportunities`, never the old
   `bd_opportunities?on_conflict=` PostgREST path (comment-stripped so the fix's own explanatory
   comment, which quotes the removed call, can't satisfy the grep it's guarding against).
6. migration source guard: the `COALESCE` preservation lines and the SEC1 revoke/assert stanza are
   present.

⚠️ **This is the JS/RPC contract only.** The prompt's own verification query
(`UPDATED_not_inserted` must move from 0 into the hundreds) still needs to run against the real
Supabase project after this migration and the Railway/MCP redeploys ship — that cannot be done from
this sandbox.

## Not done here (operator steps, per the prompt's cautions)

- Snapshot table is created by the migration itself now, but confirm it captured the pre-fix state
  before the first real batch run lands (it runs at migration-apply time, which should be before
  the next PA cron fires — verify the migration applied before 06:00/06:30/etc. UTC).
- No `LastModifiedDate` filter added to the PA flow (full refresh stays, as instructed).
- `LCC_API_KEY` rotation — not done; do after the feed is verified working, per the prompt.
- After the first live run: verify `UPDATED_not_inserted` is non-zero, re-measure HP1's 37/22
  numbers, and check `lcc_generate_deal_next_steps()`'s auto-retire against the ledger for the
  expected large-but-legitimate retire wave.

**Deploy:** migration first, then redeploy both Railway services (tranquil-delight + the standalone
MCP), then `npm run verify:deploy`.
