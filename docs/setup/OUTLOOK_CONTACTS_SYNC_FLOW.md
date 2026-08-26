# Power Automate — Outlook contacts (LinkedIn-synced) → `unified_contacts`

Fills the **contact identity + TITLE** layer the account-based contact intelligence engine
needs (`docs/architecture/account-based-contact-intelligence.md`). Scott syncs LinkedIn into
his Outlook contacts, so this flow is what makes that data reachable by the LCC.

---

## Grounded contract (verified live 2026-08-26, LCC Opps `xengecqvemvfknjvbvrq`)

- **The receiver already exists and has NEVER been fed.** `api/_handlers/contacts-handler.js`
  accepts `outlook_contact_id`, carries a **Tier-3 match rule** on it, and renders an Outlook
  source badge. `unified_contacts` has `outlook_contact_id` / `last_synced_outlook`.
  Measured: **`outlook_contact_id` = 0 across all 31,038 rows; `last_synced_outlook` = never.**
  Salesforce by contrast is flowing (`sf_contact_id` = 17,298). There is no sender — no PA
  flow pulls `/me/contacts`.
- **Why it matters:** only **585 of 31,038 contacts (1.9%) carry a TITLE**, and title is what
  separates *acquisitions* from *disposition* from *DD* in the pursuit taxonomy.
- **Endpoint:** `POST /api/contacts?action=ingest` — **ONE contact per POST**, not a `records`
  array (this differs from the `outlook.messages` bridge).
- **Required:** `source` (must be `outlook`) **and** at least one of
  `first_name` / `last_name` / `email` / `phone`.
- **Role:** the endpoint runs `requireRole(user,'operator')` — use the same operator key the
  other operator-scoped flows use.

---

## ⚠️ PREREQUISITE — DO NOT RUN THIS FLOW BEFORE READING THIS

**`autoClassify()` decides personal-vs-business from the EMAIL DOMAIN ALONE**, and for
`source='outlook'` that is the only signal it uses. Anything at gmail / yahoo / icloud /
me.com / comcast.net (the `PERSONAL_DOMAINS` set) becomes **`contact_class='personal'`**.

**In CRE that rule is wrong, and it is wrong at scale.** Measured live:

| population | consumer-domain emails |
|---|---|
| Salesforce campaign members with an email | **2,468 of 6,553 — 38%** |
| resolved owners' ACTIVE contacts | **406** |

Real principals on Scott's own **`GSA Buyer`** campaign sit on consumer domains:
**Lee Elman** `lee.eii@me.com`, **James Brooke** `jamesbrooke.office@icloud.com`, and
Easterly-linked **Thomas P. Bohlinger** `thomaspbohlinger@gmail.com`. Small principals, family
offices and single-asset LLC owners routinely use consumer email — that is not a signal that
they are personal contacts.

This is the same trap as **P124**, where "exclude consumer-domain recipients" looked obviously
right and would have deleted the best BD exemplars from the voice corpus.

### ✅ RESOLVED SERVER-SIDE 2026-08-26 — no flow-side workaround needed

`autoClassify` now treats **business evidence (a job title or a company) as outranking the
email domain**; the domain is a tiebreak used only when nothing else is known. Fixed in the
handler rather than in the flow, deliberately, for three reasons:

1. The domain rule also governs the `iphone` and `calendar` paths — a flow-side fix would
   leave those broken.
2. **406 resolved-owner contacts and 2,468 campaign members are ALREADY misclassified** in
   existing rows; a flow-side fix cannot touch them.
3. Duplicating the rule into a PA flow is the normaliser-drift this codebase repeatedly warns
   about — one classifier, one definition.

Guarded by `test/contact-autoclassify.test.mjs` (6 tests, mutation-verified). It pins **both**
directions: evidence must win, **and** the domain tiebreak must survive for contacts we
genuinely know nothing about — making everything `business` would just be the opposite defect.
`icloud`'s personal default is deliberately unchanged, and the legacy 2-arg `calendar` caller
is unaffected.

**Still true regardless: never filter at ingest.** Write everything and mark provenance — a
contact wrongly dropped at ingest is invisible forever, whereas a wrongly-classified one is
measurable and fixable.

**⚠️ Not yet done: the existing rows.** The fix is forward-only. The 406 + 2,468 already
carrying `contact_class='personal'` need a separate, reversible backfill, and it must be
evidence-gated the same way — see the follow-up item. Do not blanket-flip them (the P164
lesson: a broadly-applied "obvious" rule cleared 103 individual owners and had to be reverted).

---

## A. Getting the contacts — TWO routes, use route 1

### ⚠️ No Graph Explorer needed (and Scott cannot use it)

Northmarq restricts Graph Explorer for sales/production accounts. **You do not need it.** The
**Office 365 Outlook** connector has a first-class **`Get contacts (V2)`** action whose
**Folder id** parameter is a **dropdown that lists your contact folders** in the PA designer.
That single control answers "which folders do I have?" — the question Graph Explorer would
have answered — and it runs under your own Outlook connection with no admin rights.

Prefer this route. It also avoids the raw-Graph `$select` / `$filter` fx pitfalls that have
bitten the other Outlook flows.

### Route 1 (PREFERRED) — `Get contacts (V2)`

1. **Recurrence** trigger, every 6 hours.
2. Action → **Office 365 Outlook → `Get contacts (V2)`**.
   - **Folder id:** open the dropdown. **Screenshot / note every folder it lists** — if
     LinkedIn syncs into its own folder you will see it here. Start with `Contacts`.
   - **Top:** `100`.
   - **Order By:** `lastModifiedDateTime desc` *(optional but keeps batches deterministic)*.
   - **Filter Query:** `lastModifiedDateTime ge @{variables('hwMark')}` *(add once the first
     full backfill has completed; leave empty for the initial run)*.
3. If the dropdown shows **more than one folder**, duplicate the action per folder (or loop an
   array of folder ids) — `Contacts` alone will not cover a LinkedIn-specific folder.

### ⚠️⚠️ `Title` IS NOT `JobTitle` — the trap that would silently defeat this flow

Confirmed against Scott's tenant (2026-08-26), the `Get contacts (V2)` dynamic-content panel
offers BOTH:

| connector field | what it actually is |
|---|---|
| **`Title`** | *"The contact's title"* — the **personal honorific**: Mr. / Ms. / Dr. |
| **`JobTitle`** | *"The contact's job title"* — **this is the one we want** |

They sit a few rows apart in the picker. Mapping `Title` → `unified_contacts.title` would fill
the column the pursuit taxonomy reads (acquisitions vs disposition vs DD) with honorifics —
and it would look like a *successful* sync, because title coverage would jump from 1.9% while
the values were useless. **Map `JobTitle`. Verify a real value lands (gate 2 below).**

### Fields confirmed present in this tenant

`Id`, `Display Name`, `Given name`, `Surname`, `Middle name`, `Nickname`, `File as`,
`Email addresses` (array of `{name, address}`), `Company name`, **`JobTitle`**, `Department`,
`Office location`, `Profession`, `Manager`, `Assistant name`, `Business phones` (array),
`Home phones` (array), `Mobile phone`, `businessAddress` / `homeAddress` / `otherAddress`
(each `{Street, City, State, Country Or Region, Postal code}`), `Business home page`,
`Categories`, `Birthday`, `Created time`, **`Last modified time`**, `Parent folder id`.

**Available and valuable but with NO home in the current ingest contract:** `Department`,
`Manager`, `Office location`, `Profession`. `Department` in particular is a strong signal for
the acquisitions/disposition/DD split — arguably stronger than a free-text job title. The
`POST /api/contacts?action=ingest` body has no `department` field today. **Do not cram it into
`title`** (that corrupts the field the taxonomy reads). Logged as a follow-up to extend the
contract; `Business home page` maps cleanly to the existing `website`.

### ⚠️ TWO folders in this tenant, not one

The Folder id dropdown shows **`Contacts`** and **`Shared Contacts Folder`**. `Contacts` alone
does not cover it. Run the action once per folder (or loop the two ids) — a shared folder is
exactly where a colleague-maintained or LinkedIn-fed list would live, and skipping it is
silent, invisible data loss.

### ⚠️ Confirm the real JSON keys before wiring expressions — without Graph Explorer

The picker shows DISPLAY names (`Given name`, `Company name`); the underlying JSON keys are
usually camelCase (`givenName`, `companyName`), but **do not assume**. A wrong key does not
error — it returns null, and the flow reports success while writing empty fields.

**Self-verifying step, no Graph Explorer needed:** inside the Apply-to-each, add a **Compose**
action with input `@{items('Apply_to_each')}`, run the flow ONCE, then open the run history and
read the Compose output. That is the actual JSON for one of your contacts, with the real keys.
Wire the body from that. Delete the Compose afterwards (or leave it — it is harmless).

### Route 2 (fallback) — raw Graph via "Send an HTTP request"

Only if `Get contacts (V2)` proves unusable. Same connector, so the same permissions; this is
just a lower-level call.

### A1. Trigger
**Recurrence**, every 6 hours (an address book changes slowly). Add a `hwMark` string variable
initialized to the last successful run in ISO-8601 UTC — same high-water mechanics as
`OUTLOOK_SENT_SWEEP_FLOW.md` A5. First run: set it to `1900-01-01T00:00:00Z` for a full
backfill.

### A2. Send an HTTP request (Office 365 Outlook), Method `GET`

```
https://graph.microsoft.com/v1.0/me/contacts?$select=id,givenName,surname,displayName,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle,businessAddress,personalNotes,lastModifiedDateTime&$filter=lastModifiedDateTime ge @{variables('hwMark')}&$top=100&$orderby=lastModifiedDateTime desc
```

> **fx pitfalls (inherited from the sent-sweep flow):** `@{variables('hwMark')}` must be a
> plain ISO-8601 UTC string, and do **not** wrap the whole URI in one `@{...}` — only the
> variable token is an expression, or it 400s.
>
> `$select` must include **`jobTitle` and `companyName`** — those are the entire point.
> `emailAddresses` is an **array of objects** (`{name, address}`), and `businessPhones` is an
> **array of strings**.

### A3. Parse + Apply to each
**Parse JSON** the response body, then iterate `@{body('Parse_JSON')?['value']}` — the
`?['value']` matters; iterating the raw body yields one bogus pass.

---

## B. POST each contact (inside Apply to each)

### B1. HTTP action
- **Method:** `POST`
- **URI:** `https://tranquil-delight-production-633f.up.railway.app/api/contacts?action=ingest`
- **Headers:**
  - `Content-Type: application/json`
  - `X-LCC-Key: <operator key>`
  - `X-LCC-Workspace: a0000000-0000-0000-0000-000000000001`

### B2. Body

```json
{
  "source": "outlook",
  "outlook_contact_id": "@{items('Apply_to_each')?['id']}",
  "first_name": "@{items('Apply_to_each')?['givenName']}",
  "last_name": "@{items('Apply_to_each')?['surname']}",
  "email": "@{first(items('Apply_to_each')?['emailAddresses'])?['address']}",
  "phone": "@{first(items('Apply_to_each')?['businessPhones'])}",
  "mobile_phone": "@{items('Apply_to_each')?['mobilePhone']}",
  "company_name": "@{items('Apply_to_each')?['companyName']}",
  "title": "@{items('Apply_to_each')?['jobTitle']}",
  "city": "@{items('Apply_to_each')?['businessAddress']?['city']}",
  "state": "@{items('Apply_to_each')?['businessAddress']?['state']}",
  "contact_class": "@{if(or(not(empty(items('Apply_to_each')?['companyName'])), not(empty(items('Apply_to_each')?['jobTitle']))), 'business', '')}"
}
```

> **B3 — `first()` on an empty array throws.** Guard the email and phone expressions:
> `@{if(empty(items('Apply_to_each')?['emailAddresses']), '', first(items('Apply_to_each')?['emailAddresses'])?['address'])}`
> and likewise for `businessPhones`. A contact with no email is legitimate (phone-only) and
> must still post — the endpoint accepts name-or-phone-only.
>
> **B4 — the `contact_class` expression is the prerequisite fix, flow-side.** It sends
> `business` when Outlook gives us a company or a title, and an empty string otherwise (the
> handler then auto-classifies). If you take the code-side fix instead, drop this line.
>
> **B5 — configure the action to CONTINUE on failure** (Settings → Configure run after →
> check `has failed`/`is skipped`), so one bad contact does not abort the whole batch. Collect
> failures into an array and surface the count.

### B6. Advance the high-water mark
Only after the loop completes without a terminal failure, set `hwMark` to the maximum
`lastModifiedDateTime` seen. **Do not advance on a partial batch** — a re-run is idempotent
(Tier-3 matches on `outlook_contact_id`), a skipped window is silent data loss.

---

## C. Verify (run these AFTER the first real batch)

```sql
-- 1. Did anything land at all? (was 0 before this flow existed)
select count(*) filter (where outlook_contact_id is not null) as with_outlook_id,
       max(last_synced_outlook)                               as last_sync,
       count(*)                                               as total
from unified_contacts;

-- 2. THE POINT OF THE EXERCISE — title coverage. Baseline 585 / 31,038 (1.9%).
select count(*) filter (where title is not null and title <> '') as with_title,
       count(*) as total,
       round(100.0*count(*) filter (where title is not null and title <> '')/count(*),1) as pct
from unified_contacts;

-- 2b. ⚠️ DID WE MAP `Title` INSTEAD OF `JobTitle`? Coverage would rise either way.
--     Honorifics here means the wrong field was wired. Expect ZERO.
select count(*) as honorific_titles
from unified_contacts
where outlook_contact_id is not null
  and lower(regexp_replace(coalesce(title,''), '[^a-zA-Z]', '', 'g'))
      in ('mr','mrs','ms','miss','dr','prof','rev','sir','mx');

-- 2c. Eyeball what actually landed — job titles should look like jobs.
select title, count(*) from unified_contacts
where outlook_contact_id is not null and title is not null and title <> ''
group by 1 order by 2 desc limit 20;

-- 3. ⚠️ THE CLASSIFIER GATE — business contacts must not be filed personal.
--    Expect ~0. If this is large, the prerequisite fix did not take.
select contact_class, count(*)
from unified_contacts
where outlook_contact_id is not null
  and (company_name is not null or title is not null)
group by 1;

-- 4. Did it find the people we actually care about?
select full_name, email, title, company_name, contact_class
from unified_contacts
where outlook_contact_id is not null
  and (email ilike '%easterly%' or email ilike '%ngpv.com' or company_name ilike '%easterly%')
order by full_name;
```

**Gate 3 is the one to watch.** A large `personal` count there means consumer-domain
principals were misfiled, and every downstream consumer (the pursuit taxonomy, the voice
corpus, the acquisition lane) inherits that error silently.

---

## D. Known unknowns — state them, do not guess

- **The committed flow definition can drift from the tenant.** `CreateDraftMessageV3` did not
  exist in this tenant when the draft flow was hand-imported (see the P125 notes in
  `CLAUDE.md`). Build this one in the PA designer rather than importing a definition, and if
  you hand-fix anything, fold the fix back into this doc.
- **Personal contacts will be in the address book.** That is expected and fine — we write
  everything and mark provenance rather than filtering at ingest. The `contact_class` split is
  how they are separated downstream, which is exactly why gate 3 above matters.
- **`/me/contacts` returns only the default contact folder.** If Scott keeps contacts in
  additional folders, they need `/me/contactFolders/{id}/contacts` as well — check
  `GET /me/contactFolders` once before assuming one folder covers it.
