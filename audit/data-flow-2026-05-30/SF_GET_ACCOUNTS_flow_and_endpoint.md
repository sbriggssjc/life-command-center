# SF Get Accounts — bulk Account→Name map (unblocks 5,449 members + multiplies Tier A)

Two pieces: an **LCC endpoint** (Claude Code) and a **PA flow** (Scott). Build the endpoint
first — the flow needs somewhere to POST.

## Why (grounded live 2026-07-19/20, LCC Opps `xengecqvemvfknjvbvrq`)

The AccountId→company resolution (PR #1417) works and lifted `has_company` 334 → **1,333**,
which seeded **108 institution contacts** covering **135 contactless owners / $110.3M rolled-up
rent**. But it can only resolve AccountIds LCC already knows:

```
members with an unresolved AccountId ....... 5,449
DISTINCT accounts missing .................. 4,667
Account identities currently in LCC ........ 3,769
```

So ~76% of members carry an AccountId we can't name. Filling the map roughly **triples**
known accounts and should take `has_company` from 1,333 toward ~6,800 — and because Tier A
seeding is strictly downstream of company, it multiplies seeded sponsors by roughly the same
factor.

**This is the simple pull.** No chunking, no Contact resolve, no OData node limit — the
entire six-round chunking saga was caused by `CampaignMember.Id eq …` filters. A flat
`Get records` on Account has none of that.

---

## Part 1 — LCC endpoint (Claude Code)

### Build `?_route=sf-account-import` as a sub-route of `operations.js`

**≤12 `api/*.js` — do NOT add a new file.** Handler in `api/_handlers/sf-account-import.js`;
dispatch in `operations.js` **before** the bare-action bridge router, and add it to the
`SUBROUTE_DISPATCH` single-source list + `test/operations-subroutes.test.mjs` guard from
PR #1415 (this route class has regressed off the deployed build four times — it must ship
with the guard entry, not after).

- `GET` = dry-run: report how many accounts are already known and how many list members are
  waiting on an unresolved AccountId. No writes.
- `POST` body: `{ accounts: [ { Id, Name }, … ] }` — batches of up to ~200.

### Per account (idempotent, guarded, never fabricates)

Mint/attach the organization exactly the way the existing SF-CONFLATION path does — **reuse
`ensureEntityLink`, do not write `external_identities` directly**:

```js
ensureEntityLink({
  sourceSystem: 'salesforce', sourceType: 'Account', externalId: <18-char Id>,
  seedFields: { name: <Name>, org_type: 'company' }, domain: 'lcc',
  metadata: { via: 'sf_account_import' },
})
```

- **15/18-char safety:** normalize with `toSf18` from `api/_shared/sf-id.js` before writing,
  and match on left-15 (`sf15`) when checking existing rows. LCC stores 18-char.
- **Guards apply:** `isJunkEntityName` rejects structural garbage. An Account whose Name fails
  the guard is skipped and counted, never minted.
- **Idempotent:** re-running the flow must not create duplicates — `ensureEntityLink` dedups
  by external identity then canonical name. A second full run should report ~0 created.
- **Never fabricate** a name. Missing/blank `Name` → skip, count it.

### Backfill the already-ingested members (the payoff)

New accounts don't retroactively fix the 5,449 rows that already recorded
`raw.sf_account_id_unresolved`. Add a **bounded, resumable** backfill in the same handler
(`POST ?_route=sf-account-import&backfill=1&limit=500`):

- select `lcc_sf_list_membership` rows where `raw ? 'sf_account_id_unresolved'` and
  `company_name IS NULL`
- resolve the account name from the now-populated map (one batched
  `external_identities?external_id=in.(…)` → `entities.name`, **not** N+1)
- on hit: set `company_name`, run the same org `ensureEntityLink` + person→org `works_at`
  relate that `processMember` does, clear `raw.sf_account_id_unresolved`
- on miss: leave the row untouched (still measurable)

This avoids a 90-minute PA re-run to achieve the same thing.

### Response summary (honest counts)

`accounts_received`, `accounts_created`, `accounts_matched_existing`, `accounts_skipped_guard`,
`accounts_skipped_no_name`, and for backfill: `members_scanned`, `members_resolved`,
`members_still_unresolved`.

### Boundaries

LCC Opps only · no SF writes · no dia/gov writes · additive/reversible (revert a batch via
`metadata->>'via' = 'sf_account_import'`) · never fabricate a name · keep the existing
"a bad record is skipped, never throws" contract.

---

## Part 2 — PA flow "SF Get Accounts" (Scott)

Far simpler than the Campaign Members flow. **Do not copy its chunking** — none of it applies.

1. **Trigger** — Manual (`workflow_dispatch`-style). One-time pull; re-runnable later.
2. **Salesforce → Get records**
   - Object: `Account`
   - `$select`: `Id, Name` *(these two only — more columns is more payload for no gain)*
   - Filter: leave empty for the full pull. If you want a smaller first pass, filter to
     recently-modified.
   - **Pagination: ON**, threshold ~100,000 (SF connector defaults to 2,000 rows without it —
     that's the one thing that will silently truncate this flow).
3. **Chunk** — Compose: `chunk(outputs('Get_records')?['body/value'], 200)`
   *(enter via the **fx/Expression editor** — a green token, not typed text. Same trap as the
   Contact resolve.)*
4. **Apply to each chunk** — over `@outputs('Chunk_Accounts')`
   - **Select** → map each item to `{ "Id": @item()?['Id'], "Name": @item()?['Name'] }`
   - **HTTP POST** → `https://tranquil-delight-production-633f.up.railway.app/api/sf-account-import`
     - Headers: `Content-Type: application/json`, `X-LCC-Key: <key>`
     - Body: `{ "accounts": @{body('Select_Accounts')} }`
     - Retry: Exponential, PT10S, count 4
   - **Concurrency: 4** (matches what proved stable on the Contact flow)

At 200/batch and ~8,500 accounts that's ~43 POSTs — minutes, not the 80-minute Contact
marathon.

---

## Verify (Cowork, post-deploy)

1. `GET /api/sf-account-import` returns dry-run JSON (not the bridge "Invalid POST action"
   error — that's the PR #1415 regression signature).
2. Run the PA flow, then on LCC Opps:

```sql
-- Account map should roughly triple from 3,769
select count(*) from external_identities
 where source_system='salesforce' and source_type='Account';
```

3. Run the backfill (`POST …&backfill=1&limit=500`, repeat until `members_resolved` = 0), then:

```sql
select count(*) total, count(company_name) has_company,
       count(*) filter (where raw ? 'sf_account_id_unresolved') still_unresolved
from lcc_sf_list_membership;                    -- has_company 1,333 → expect ~6,000+

select count(*) from lcc_institution_contacts;  -- 108 → expect a large multiple
select count(*) rows, count(*) filter (where rank_value >= 1000000) ge_1m,
       round(sum(rank_value)/1e6,1) rent_m
from v_institution_contact_attachable;          -- 135 / 20 / $110.3M → expect all up
```

4. Spot-check ~5 newly-resolved companies against their SF Account, and confirm a re-run of
   the flow reports ~0 accounts created (idempotency).

## Then

Fan the seeded sponsors across their contactless SPE portfolios:
`POST /api/operations?_route=institution-contact-tick` (GET first for the dry-run).
