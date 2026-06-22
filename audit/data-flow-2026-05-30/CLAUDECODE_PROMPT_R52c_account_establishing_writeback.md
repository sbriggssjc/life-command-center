# Claude Code — R52c: account-establishing contact writeback (org requires a Company on every Contact)

## Why (live Activation-5 drain + SF org check, 2026-06-21)
R52's dedup/mirror path is proven live (existing SF contact matched by email → identity mirrored).
But the **create path** fails: this Salesforce org **requires every Contact to be tied to a Company
(Account)** — `Contact.AccountId` is required (the Account object is relabeled "Company" in this org;
the Contact field shows as required "Company Name"). Our `upsert_contact` create sent no AccountId,
so new contacts can't be created. Grounded: of 1,223 writeback candidates, only **1** has a
resolvable SF Account today — so a "skip create without account" policy would create ~0 contacts.

**Doctrine (Scott, 2026-06-21):** don't skip and don't use a junk placeholder. Instead, for each
contact **establish the Company from the contact's associated True Owner**, attach the contact to it,
and **mirror the new SF Account id back onto the LCC owner entity** — so owner→SF-account coverage
compounds as the writeback runs (fixing the "1/1,223" problem over time). For a genuine **individual
investor** (no distinct owner org), the Company = the person's own name. Consolidate as better
account data arrives. Verified in SF: creating an Account/Company requires **only Company Name** (all
other fields optional), so the account upsert is a name-only create.

## House rules
Reuse the existing SF flow-op pattern (`callSfLookupFlow`), the R52 `upsertSalesforceContact`, the
R39 `ensureEntityLink` identity-mirror, the value-ranking + guards (junk / broker-as-person /
implausible). Effect-first / outcome-truthful. Gated behind the existing `SF_CONTACT_WRITEBACK`.
Reversible (identity mirrors + writeback log). ≤12 `api/*.js`; `node --check` + suite green. dia/gov
pipelines untouched (LCC-side + SF).

## Unit 1 — new SF flow op `upsert_account` (Scott wires the PA case; see the PA spec below)
`api/_shared/salesforce.js`: add `upsertSalesforceAccount({ name, idempotencyKey })`:
- guard: trim name; reject empty / junk (reuse `isJunkEntityName`-style guard) → `{ok:false,
  reason:'no_name'}`.
- POST `callSfLookupFlow({ operation:'upsert_account', name, idempotency_key })`.
- Flow contract — **find Account by Name (exact, Top 1) → if found return it, else Create with just
  Name**:
  - Success existing: `{ ok:true, created:false, account:{ Id, Name } }`
  - Success created:  `{ ok:true, created:true,  account:{ Id, Name } }`
  - Not implemented / error: `{ ok:false, reason:'unsupported'|... }` (tolerant, like the R52
    contact op + the R52b unmask — never throw on a non-string error).
- Return `{ ok, accountId, created, account, reason }`.

## Unit 2 — worker orchestration (`api/_handlers/contact-writeback.js`)
For each candidate (value-ranked, unchanged ordering), the per-row flow becomes:
1. **Resolve the company name** (the Account to attach), in priority order:
   a. The candidate's linked **True Owner organization** name — the org entity the person is
      `associated_with` / owned-by in the entity graph (the BD owner). Prefer an `entity_type=
      'organization'` owner.
   b. else the candidate's existing **`company`** field (already populated for 524/1,223).
   c. else **individual investor** → the person's own **name** (Company = contact name).
   Skip/ý-guard junk company names (reuse the guards); if no usable name resolves, record
   `skipped:'no_company_resolvable'` (rare) and move on.
2. **Resolve/create the SF Account:** if the resolved **owner entity already carries an
   `external_identities (salesforce, Account)` id**, reuse it (no flow call). Otherwise call
   `upsertSalesforceAccount({name})`.
   - On success, **mirror the SF Account id onto the LCC owner entity** via `ensureEntityLink`
     (`sourceSystem:'salesforce', sourceType:'Account', externalId:<accountId>`). For an individual
     investor (no separate owner org), mirror onto the **person** entity (person ≈ company here).
     This is the compounding coverage win — record it even when the contact step later no-ops.
   - On failure → record `unavailable` + the real `detail` (R52b); do NOT attempt the contact create
     (can't create a contact without its required Company).
3. **Upsert the Contact** via `upsertSalesforceContact({ ..., accountId:<resolved account id> })`
   (existing path; now always with an accountId). Mirror the SF Contact id onto the person (existing).
4. Outcome-truthful per-row result: include `company_resolved`, `account_id`, `account_created`,
   `sf_contact_id`, `created`, and on failure the real `detail`.

Keep the **dedup path** intact: if the contact already exists in SF (found by email), mirror its id
(created:false) as today — AND, if its owner entity lacks an SF Account link, still do step 2's
account mirror when the contact's `AccountId` is known from the found record (opportunistic coverage).

## Unit 3 — PA flow changes (Scott / co-build; spec)
1. **Re-add `item/AccountId` to the existing `upsert_contact` Create record** (it was removed during
   R52b debugging; it is the REQUIRED Company link): `item/AccountId = @{triggerBody()?['account_id']}`.
   Map it to the standard **Account ID** field (NOT RecordTypeId — that was the earlier bug).
2. **Add a new Switch case `upsert_account`** (mirrors `upsert_contact`, simpler):
   - **Get Account records** (generic "Get records", Salesforce Object Type = **Accounts**),
     Filter Query `Name eq '@{triggerBody()?['name']}'`, Top Count `1`. (Rename it
     "Get Account records from Salesforce" if you want a stable reference.)
   - **Condition**: `length(outputs('Get_Account_records_from_Salesforce')?['body/value'])` **is
     greater than** `0`.
     - **True** → Response 200:
       `{ "ok": true, "created": false, "account": { "Id": "@{first(outputs('Get_Account_records_from_Salesforce')?['body/value'])?['Id']}", "Name": "@{first(outputs('Get_Account_records_from_Salesforce')?['body/value'])?['Name']}" } }`
     - **False** → **Create record** (Object Type **Accounts**, `item/Name = @{triggerBody()?['name']}`
       — Name is the only required field) → Response 200:
       `{ "ok": true, "created": true, "account": { "Id": "<<Create record → Account ID token>>", "Name": "@{triggerBody()?['name']}" } }`
   - **GetTable note:** use the GENERIC "Get records" + explicit Object Type = Accounts (not a typed
     "Get Account records" action) — the typed action can't resolve its dynamic-schema `table` and
     blocks save (the exact issue hit on the contact read in R52).

## Verify (report back)
- `upsertSalesforceAccount` unit test against a fake flow client: existing-name → returns the id
  (created:false), new-name → create path (created:true), non-string error → graceful (no throw,
  reuses R52b coercion).
- Worker test: candidate with an owner org → account upserted + mirrored onto the owner entity +
  contact created with that AccountId + contact id mirrored onto the person; individual investor →
  account named after the person; account-upsert failure → contact NOT attempted, real detail
  recorded; existing-contact dedup path still mirrors (created:false).
- `node --check`; ≤12 api/*.js; suite green.

## After deploy (Scott + me)
Wire the PA `upsert_account` case + re-add `item/AccountId` to the contact create, set nothing new
(reuses `SF_CONTACT_WRITEBACK` + `SF_LOOKUP_WEBHOOK_URL`). Then I run a capped real drain: confirm an
Account is created/found, mirrored onto the owner entity, the Contact created under it, both ids
mirrored, and the broker-as-person guard rejects "Marcus & Millichap". Then broaden — and watch the
owner→SF-account coverage climb past 1/1,223 as accounts get established + mirrored.

## Bottom line
The org won't take a Contact without a Company, and almost no candidate has one yet. R52c makes the
writeback ESTABLISH the company from the contact's True Owner (individual → self-named), attach the
contact, and mirror the new Account id back into LCC — turning the org's constraint into a mechanism
that builds owner→account coverage every time it runs.
