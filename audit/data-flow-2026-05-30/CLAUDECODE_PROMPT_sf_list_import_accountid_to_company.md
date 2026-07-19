# Claude Code (LCC) — resolve `AccountId` → company name in `sf-list-import` (unblocks Tier A institution seeding)

## Why (grounded live 2026-07-18, LCC Opps `xengecqvemvfknjvbvrq`)

The SF Campaign-list seed is COMPLETE and converged: **7,186 members across 57 lists**
(SAB GSA Prospects 3,925; KDL Seller 987; …), **all contact-linked**, every person resolved to
an entity, **0 unclassified** (5,923 seller-side / 145 buyer-side).

But `SF_LIST_SEED_INSTITUTION` was flipped ON and **`lcc_institution_contacts` seeded 0 rows.**
The flag is fine — there is nothing to match:

```sql
select count(*) total, count(company_name) has_company from lcc_sf_list_membership;
-- 7186 total, 334 has_company  → 95% NULL
```

**Root cause:** the two-step Contact resolve DROPS the company. `Get L2 members` selects
`CompanyOrAccount`, but `Select Members Lx` builds its rows from the **Get Contacts** output,
whose `$select` was `Id, FirstName, LastName, Email, Phone, MailingCity, MailingState` — no
account name. The SF connector can't traverse `Account.Name` in `$select`, so company was lost.

`api/_shared/sf-list-import.js` needs a company **NAME**:
- `normalizeMember` → `company: s(g('CompanyOrAccount','Company','company','AccountName','account'))`
- `processMember` → `if (m.company) ensureEntityLink({sourceType:'organization', seedFields:{name:m.company}})`
  then relates person→org (`works_at` edge, SF-CONFLATION doctrine)
- `deps.matchRegistryGap(company)` → `normalizeInstitution(company)` →
  `v_institution_registry_gaps?sponsor_norm=eq.<norm>` → gates `seedInstitutionContact`

## Already done (do NOT redo)

Scott has ALREADY edited the PA flow: `Get Contacts L2` and `Get Contacts L3` `$select` now
includes **`AccountId`**:
```
Id, FirstName, LastName, Email, Phone, MailingCity, MailingState, AccountId
```
So members now arrive carrying an SF **AccountId** (18-char) but still no account NAME.
**Do not add another PA resolve loop** — the chunking work is finished and stable
(chunk 20 / fx `join(items('Apply_to_each_chunk_Lx'), ' or ')` / retry / concurrency 4).

## What to build (LCC-side only; no SF writes; ≤12 api/*.js — edit existing files)

### Unit 1 — capture the AccountId (`api/_shared/sf-list-import.js`)
In `normalizeMember`, add a tolerant `account_id` field alongside `company`, read the same
tolerant way as the other fields (top-level PascalCase, lowercase, and nested `Contact`/`Lead`
objects): `g('AccountId','accountId','account_id')`. Pure; no behavior change when absent.

### Unit 2 — resolve AccountId → company name LOCALLY (no extra SF call)
LCC already holds SF Account identities from the SF-CONFLATION work
(`external_identities` where `source_system='salesforce' AND source_type='Account'`, ~2,027 rows,
all 18-char) pointing at organization `entities` rows that carry the account NAME.

- Add a dep `resolveAccountName(accountId) -> Promise<string|null>` wired in
  `buildDeps()` (`api/_handlers/sf-list-import.js`).
- **Batch it, don't N+1:** each POST carries ≤20 members. Collect the DISTINCT `account_id`s for
  the request, resolve them in ONE `external_identities?...&external_id=in.(…)` query joined/
  followed to `entities.name`, and serve per-member from an in-request Map.
- **15/18-char safety:** use the existing `api/_shared/sf-id.js` helpers (`sf15`, `toSf18`,
  `sfIdsMatch`) — LCC stores 18-char; match on the left-15 so a 15-char id still resolves.
- In `processMember`: `const company = m.company || (m.account_id ? await resolveAccountName(m.account_id) : null)`
  and use that ONE value for BOTH the org `ensureEntityLink` and `matchRegistryGap`.
  `m.company` (a real `CompanyOrAccount`) always WINS — the AccountId lookup is a fallback.
- **Never fabricate.** If the AccountId isn't a known LCC Account identity, company stays `null`
  and the member is recorded exactly as today (no org link, no registry match). No guessing from
  email domain in this unit.

### Unit 3 — make the coverage gap VISIBLE (honest counts)
Only accounts already in `external_identities` resolve, so coverage will be PARTIAL by design.
- Record the unresolved id on the membership row (e.g. `raw.sf_account_id_unresolved`) so the gap
  is measurable and a later backfill can fill it.
- Add to the route's response summary: `company_from_member`, `company_from_account_lookup`,
  `account_id_unresolved` counts, so a run reports its own coverage truthfully.

## Boundaries
Additive · fill-blanks (never overwrite a real `CompanyOrAccount`) · no fabrication · reversible ·
no SF writes · no new `api/*.js` (edit `_shared/sf-list-import.js` + `_handlers/sf-list-import.js`) ·
keep the existing per-member "never throws, a bad member is skipped" contract ·
`SF_LIST_SEED_INSTITUTION` gating unchanged.

## Tests (`test/`)
- `normalizeMember` captures `account_id` (top-level, lowercase, nested) and leaves it null when absent.
- `processMember`: real `CompanyOrAccount` WINS over the AccountId lookup; AccountId-only member
  resolves the name and uses it for BOTH the org link and `matchRegistryGap`; unresolved AccountId ⇒
  company stays null, no org link, no registry match, member still recorded.
- The batch resolver issues ONE lookup for N members sharing an account (no N+1) and is 15/18-safe.

## Verify (post-deploy — Cowork will run this)
1. `GET /api/sf-list-import` still returns dry-run JSON (route guard from PR #1415 intact).
2. Re-run the PA flow (the flow re-sends ALL members every run, so this backfills the existing
   6,852 null-company rows — no separate backfill script needed).
3. Expect on LCC Opps:
```sql
select count(*) total, count(company_name) has_company,
       count(org_entity_id) has_org
from lcc_sf_list_membership;                      -- has_company should jump well above 334
select count(*) from lcc_institution_contacts;    -- should go 0 → N (Tier A seeding fires)
select institution_name, contact_name, contact_email
from lcc_institution_contacts order by created_at desc limit 20;
```
4. Then Tier A fans each seeded sponsor contact across that sponsor's contactless SPE portfolio
   (`v_institution_contact_attachable` / `?_route=institution-contact-tick`).

## Follow-up if coverage is low (surfaced, NOT in this unit)
If `account_id_unresolved` is large, the clean fix is a **one-time "SF Get Accounts" PA flow** —
a simple paginated `Get records` on `Account` (`Id, Name`) POSTed to LCC to populate the Account
identity map. That is a flat, non-chunked pull (far simpler than the Contact resolve) and it makes
AccountId→Name resolve for everything, permanently. Do NOT build it in this round; measure first.
