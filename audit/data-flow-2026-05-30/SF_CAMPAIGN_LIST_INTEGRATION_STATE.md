# Salesforce "Lists" ↔ LCC integration — state, object model, learnings, roadmap

**Living reference (2026-07-17).** How Scott's Salesforce prospecting/buyer/seller "Lists"
(a.k.a. "Groups") map to Salesforce objects, how we ingest them into the LCC, every quirk we've
hit, the current flow, and the roadmap (including the future LCC→Salesforce group-member
writeback). Future chats: start here.

---

## 1. Business context (why this matters)
- Scott's "Lists"/"Groups" are the richest curated contact source: **buyer lists** (repeat gov
  buyers like Boyd Watterson) and **seller-prospect lists** (owners we've prospected, by broker
  + product type). They drive quarterly Capital Markets email sends, marketing blasts, and call
  lists — used by the **marketing team**, not just BD, and are also used for tracking/sends
  **outside** the LCC's scope. So the Salesforce lists are a shared, live asset.
- LCC use: buyer lists → P-BUYER buy-side contact pool; seller lists → owner-prospect resolution
  + **seed the institution registry** (real, non-fabricated sponsor contacts that gate the Tier A
  fan-out over ~$34M+ of contactless portfolio).
- **Future (planned):** once the LCC cleans/propagates ownership + contacts, we will **add group
  members from the LCC back into Salesforce** (a Salesforce WRITE — gated, minimum-necessary,
  per the SF-as-source doctrine). This integration must be fully understood so that
  bidirectional sync is safe. Not built yet.

## 2. The object model (CONFIRMED live 2026-07-16/17)
- **"Groups"/"Lists" = standard Salesforce `Campaign`** records in a hierarchy. Confirmed by
  Object Manager: the "Vision GM" app is the managed package **`gmpkg`** (Vision Group
  *Management*) — every `gmpkg__*` object is UI plumbing (permissions, Gantt, grids, bulk-action
  jobs). **There is NO custom `gmpkg__Group__c` and NO custom member/junction object.** Vision GM
  is a custom *interface* over standard Campaign + CampaignMember.
- **Members = standard `CampaignMember`** records (link a Campaign to a Contact OR a Lead).
- **Hierarchy** (via `Campaign.ParentId`): `Team Briggs` (root, Id `7018W000000O627QAC`) →
  level-2 lists (Buyer Lists, SAB/KDL/JTS/NKB Seller Prospects, SAB GSA/Dialysis/Medical/OFS
  Prospects, Office Principals, VCA/Christian Brothers/DMR Owners, plus junk: `New Name`×6,
  `delete`, `z_Engage`, `z_Old Team Members`, `All Contacts`) → level-3 lists (e.g. `Buyer
  Lists` → **GSA Buyer** = 156 members; the seller parents → product sublists).
- Each Campaign record carries: `# Campaign Members` (rollup), `Broker Team`, `Group Path`
  (e.g. `/Team Briggs/Buyer Lists/GSA Buyer`), `ParentId`, `Active`, Record Type `Child Node`.
- **`Prospect` in Object Manager = the standard `Lead` object** (relabeled). Prospects = Leads.

## 3. THE critical Salesforce quirks (the whole reason this is hard)
1. **CampaignMember's own name/email fields are BLANK for Contact members.** `CampaignMember.
   FirstName/LastName/Email/Phone/City/State` are populated only for **Lead** members (and a few
   Contact members where someone typed them in manually — often junk, e.g. a member whose name
   came through as "founder and ceo"). For normal **Contact** members these fields are empty; the
   real name/email live on the related **Contact** record.
   - Proof: GSA Buyer = 156 CampaignMembers, **all Type=Contacts**, but a naive
     `Get CampaignMember` + POST landed only **15** in the LCC — a scattered subset (not
     alphabetical → not a page cap), i.e. exactly the ~15 whose CampaignMember fields happened to
     be populated. The other 141 came through blank and were dropped by the route's name/identity
     guard.
2. **The Power Automate Salesforce connector CANNOT traverse relationship fields.** So you can't
   `$select Contact.Email` through CampaignMember (same limit that broke `Who.Name` on the SF
   activity flow). To get a Contact member's real data you must do a **second query on the
   `Contact` object** keyed by `ContactId`.
3. **OData filter syntax, not SOQL:** use `eq` not `=`; string literals in single quotes;
   `LIKE`/`= true` error ("Syntax error at position N"). `IsActive eq true`, `ParentId eq '…'`.
4. **Expressions must be `fx` tokens, not typed text.** Typing `concat(...)`/`first(...)`/
   `outputs(...)` as plain text into a field makes PA send the literal formula string →
   "unknown function 'body'/'first'…". Enter via the Expression (`fx`) editor so it renders as a
   colored chip. (Recurring gotcha — hit it 3×.)
5. **`Id IN ('')` (empty list) fails.** Parent/empty/junk campaigns (Buyer Lists, New Name,
   delete, z_*, All Contacts) have 0 direct members → the resolve step must be guarded with a
   `length(...) > 0` Condition.
6. **`Id IN (…)` has a LENGTH CAP.** SOQL/connector filter length caps around ~4,000 chars
   (~150–200 ids). **Several lists have 4,000–5,000 members** → a single `Id IN (…all ids…)` is
   impossibly long and WILL fail. Large lists must **chunk** the ContactIds (~150 per batch) and
   loop. (This is the current architecture's biggest remaining requirement — see §6.)

## 4. The LCC side (BUILT + live)
- **Route `/api/sf-list-import`** (PR #1412; sub-route of operations.js; migration for
  `lcc_sf_list_membership` applied live). Per member: reconcile the person by **email (R39
  tier)** so existing CoStar/RCA/SF people ATTACH (no dup); name from the contact fields (Unit-C
  guard); relate person→company as a `works_at` **edge** (not an identity-on-person); write a
  `lcc_sf_list_membership` row (`campaign_name`, `product_type`, `side`, `broker`, `status`);
  route buyers → P-BUYER pool, sellers → owner-prospect + (flag `SF_LIST_SEED_INSTITUTION`)
  seed `lcc_institution_contacts`. Idempotent (upsert by ContactId/email). No SF writes.
- **PR #1413** hardened the route to read Lead-linked members (LeadId) + read denormalized
  fields case-insensitively/nested, and improved seller classification: broker-prefixed
  `* Prospects` (`SAB|KDL|NKB|JTS|DMR`) and `* Owners` lists → `side=seller`; `deriveBroker`
  prefers the explicit prefix.
- **Route body contract:** `{campaign_id, campaign_name, parent_id, members:[…]}` where each
  member carries `ContactId/LeadId, FirstName, LastName, Email, Phone, City, State,
  CompanyOrAccount`. Requires `campaign_id`.
- **Env/flags:** `SF_LIST_IMPORT_URL` (engages the route), `SF_LIST_SEED_INSTITUTION` (default
  OFF — turn on after eyeballing the first seller ingest).
- **LCC base URL** (for the flow's HTTP POST): `https://tranquil-delight-production-633f.up.
  railway.app/api/sf-list-import`, header `X-LCC-Key` (same key as the SF-activity flow).

## 5. Current state (2026-07-17)
- **627 Contact members loaded + classified** (buyer 114 / seller 112 / unknown 401) — the
  subset whose CampaignMember fields were populated. **0 Lead identities** — confirmed the
  members are Contacts, and the ~90% with blank CampaignMember fields are still missing.
- The naive one-query flow undercounts massively (GSA Buyer 15/156). The **two-step resolve**
  (CampaignMember → ContactIds → Get Contacts by Id → POST) is the fix, BUT the current
  IN-list implementation keeps failing on PA syntax and **will not scale to the 4-5k lists
  without chunking (§3.6).**
- Whole-org noise from an early un-scoped run was cleared (deleted 1,351 `lcc_sf_list_membership`
  rows; table now holds only Team Briggs data). The scope fix (walk the `Team Briggs` subtree by
  name → L2 → L3) is in place.

## 6. The durable flow — current design + the required chunking
**Flow shape (scoped to Team Briggs):**
1. `Get_TeamBriggs_root` (Campaign, `Name eq 'Team Briggs'`) → Compose `teamBriggsId` =
   `first(body('Get_TeamBriggs_root')?['value'])?['Id']`.
2. `Get_L2_lists` (Campaign, `ParentId eq '<teamBriggsId>'`, pagination on).
3. `For_each_L2`: `Get_L2_members` (CampaignMember, `CampaignId eq '<L2.Id>'`) →
   `Select_ContactIds_L2` (map `item()?['ContactId']`) → **Condition** `length(...) > 0` →
   [resolve+POST] → then `Get_L3_lists` (Campaign, `ParentId eq '<L2.Id>'`) → `For_each_L3`
   (same resolve+POST).
- **Resolve+POST block (per campaign):** `Compose_ContactFilter` =
  `concat('Id IN (''', join(body('Select_ContactIds_X'), ''','''), ''')')` [entered as an `fx`
  token] → `Get_Contacts` (Contact, filter `outputs('Compose_ContactFilter_X')`, select
  `Id, FirstName, LastName, Email, Phone, MailingCity, MailingState`, pagination on) →
  `Select_Members` (map Contact fields → route shape: `ContactId←Id, City←MailingCity,
  State←MailingState`, rest 1:1) → `POST` (members = `body('Select_Members_X')`).
- **⚠️ REQUIRED for scale — chunk the ContactIds:** replace the single `Compose_ContactFilter` +
  `Get_Contacts` with: `Compose_Chunks` = `chunk(body('Select_ContactIds_X'), 150)` → an
  `Apply_to_each` over the chunks → per chunk build `Id IN (…150 ids…)` from `item()` →
  `Get_Contacts` → `Select_Members` → `POST` (or collect + POST once). Without chunking, any
  list > ~200 members fails on filter length. **This is the next fix to implement.**
- **Company caveat:** the two-step gets name/email/phone/city/state but NOT company (Contact's
  company is `Account.Name`, a traversal). Contacts we already know keep their company via the
  email-reconcile; net-new contacts arrive company-less (affects the registry seed, which
  matches on company). Optional 3rd lookup (collect `AccountId`s → Get Accounts → map name)
  would restore it. The **DOM scrape** does get company (Vision GM resolves it) — a fallback.

## 7. Debugging history (so we don't repeat it)
- `IsActive = true` → OData error → `IsActive eq true`.
- `ParentId eq 'first(body(...))'` literal → must insert the Id as an `fx`/dynamic token.
- Unscoped `IsActive eq true` pulled the WHOLE org (167+ campaigns, all offices) → scope to the
  Team Briggs subtree.
- `Get_Contacts` "unknown function 'body'" → the `concat(...)` Compose was typed as text, not an
  `fx` token.
- Empty parent/junk lists → `Id IN ('')` fails → add the `length > 0` guard.
- **Open (current):** `For_each_L2` still fails with the generic "No dependent actions
  succeeded" and 0 rows land — need the SPECIFIC failed inner action's error. Prime suspects:
  a still-literal `Compose_ContactFilter`, a mis-set `Select_ContactIds` map, or (for the big
  lists) the IN-list length cap requiring chunking.

## 8. Fallback (proven, complete) — the DOM scrape
Vision GM's rendered member table resolves each member to the real Contact email/name/company.
A shadow-DOM scrape (recursive `walk(shadowRoot)` over the `c-is-vision-gm-member-view` table,
paginating the UI) extracted ALL 156 GSA buyers + 344 sellers with full data incl. company.
Two CSVs were generated (`GSA_Buyer_list_156.csv`, `NetLease_Seller_Prospects_bucket.csv`).
Transport into the LCC: browser→route POST is CORS/auth-blocked; the clean path is
Scott re-uploads the CSVs → read in-context → POST via `lcc_cron_post` per list. Good for a
one-time load; NOT self-updating (the durable flow is for that). Note: scrape only covers the
lists we opened; the durable flow covers all + the 4-5k lists.

## 9. Roadmap
- **Now:** finish the durable two-step flow (get the specific error; add chunking for 4-5k
  lists). Then full member counts land (GSA Buyer → 156, big lists → thousands), classified,
  deduped, company-optional.
- **Then:** turn on `SF_LIST_SEED_INSTITUTION` after eyeballing the first full seller ingest →
  Tier A fan-out over the contactless sponsors.
- **Later (planned, gated):** **LCC → Salesforce group-member writeback** — as the LCC cleans/
  resolves owners + contacts, add/update `CampaignMember` rows in Salesforce (a SF WRITE:
  minimum-necessary, gated, per the SF-as-source doctrine; the marketing team relies on these
  lists, so writes must be deliberate + reversible). Design TBD — this doc is the prerequisite
  understanding.

## 10. Session 2026-07-17 — the durable two-step resolve WORKS; now blocked on the LCC route

### The connector does NOT support the OData `IN` operator (either case)
The two-step Contact resolve failed at `Get Contacts` with `400 "Syntax error at position 5
in 'Id IN (…)'"` — and lowercasing to `Id in (…)` failed IDENTICALLY. The Salesforce Power
Automate connector's `$filter` parser accepts only `eq` / `and` / `or` (proven: `CampaignId
eq …` / `ParentId eq …` work everywhere). **Do NOT use `in` — build an `eq…or` chain.**

### Fix applied to the flow (both L2 and L3 resolve branches), via the browser designer:
1. **`Select ContactIds L2/L3` Map** changed from the bare `ContactId` token to the expression
   `concat('Id eq ''', item()?['ContactId'], '''')` → emits `["Id eq '0038…'", …]`.
2. **`Compose ContactFilter L2/L3`** changed from `concat('Id in (''', join(…), ''')')` to
   `join(body('Select_ContactIds_L2'), ' or ')` → `Id eq 'a' or Id eq 'b' or …`.
   (`Get Contacts` `$filter` still points at `outputs('Compose_ContactFilter_Lx')`, unchanged.)
Saved clean ("flow is ready to go"). **Verified live in a test run: `Get Contacts L2`
returns 200** — the SF connector resolve is fixed end-to-end (`Get L2 members` → `Select`
→ `Compose` → `Get Contacts` 200 → `Select Members` 200).

### Remaining blocker — the LCC `/api/sf-list-import` route regressed (NOT a flow bug)
The run now fails one step later at **`POST L2` → 400** from
`https://tranquil-delight-production-633f.up.railway.app/api/sf-list-import`:
`{"error":"Invalid POST action. Bridge: log_activity, complete_research, …"}`. That is the
`operations.js` BRIDGE action-router — i.e. the POST reached operations.js but the
`sf-list-import` sub-route dispatch **did not match** and fell through. Same class as PR
#1408/#1410 (a stale-`main` Railway redeploy dropped the sub-route). Production is the
**Railway Express `server.js`** (vercel.json rewrite is legacy/no-op), so the route must be
mounted in server.js AND dispatched in operations.js before the bridge router. It WAS
working 2026-07-16 (627 rows ingested), so a redeploy since dropped it.
→ Fix prompt written: `CLAUDECODE_PROMPT_ORE_restore_sf_list_import_route.md`.

### Still pending after the route is restored
- **Chunking (mandatory for the 4-5k lists).** The `eq…or` filter has NO chunking yet; it
  passed on small NKB Prospects but a 4-5k-member `Id eq…or…` filter will exceed the
  connector URL/filter length. Add `chunk(body('Select_ContactIds_Lx'), 50)` + an inner
  Apply-to-each (Compose join per chunk → Get Contacts → Select Members → POST) in BOTH
  branches once a full run verifies.
- Then verify GSA Buyer = 156, seller lists match Vision GM totals, no dup persons; then
  flip `SF_LIST_SEED_INSTITUTION` for the Tier A fan-out.

### Route restored (PR #1414) + verified live 2026-07-17
The `sf-list-import` dispatch (plus 4 siblings — `sf-contact-resolve-tick`,
`owner-reconcile-tick`, `owner-reconcile-engine-tick`, `institution-contact-tick`) was reverted
by a stale-branch merge in `operations.js`; PR #1414 restored all five verbatim with `do NOT
remove` guards, shipped on the Railway redeploy. Post-deploy run: **POSTs return 200 and 133
real contacts across 22 lists ingested** into `lcc_sf_list_membership` — real names + emails +
city/state + `sf_contact_id`, `entity_type='person'`, correctly classified by side/product/
broker, no junk (the two-step resolve delivers exactly what CampaignMember couldn't). Email-tier
reconcile holds (no dup persons).

### CHUNKING is now the confirmed live blocker (not theoretical)
Same run then FAILED inside **`For each L3`** on the first LARGE sub-list. Small lists (2–20)
resolve fine; **GSA Buyer (156)** builds a ~4,400-char `Id eq…or…` filter that exceeds the
connector's `$filter`/URL length limit → `Get Contacts L3` errors → loop fails. GSA Buyer is
stuck at its old partial 15. **Fix = chunk the ID array into ~50-member batches in BOTH resolve
branches** (`chunk(body('Select_ContactIds_Lx'), 50)` → Apply-to-each → per-chunk
`join(item(), ' or ')` → Get Contacts → Select Members → POST; route is idempotent so multiple
POSTs/campaign don't dup). Build guide: `PA_FLOW_add_chunking_to_resolve_branches.md`. This
unblocks GSA Buyer's 156 AND the 4–5k-member lists.

### Two small data-quality polish items (non-blocking, observed in the good rows)
`member_type` lands NULL (route doesn't stamp Contact-vs-Lead; entity_type+sf_contact_id already
identify). `company_name` lands NULL (the `Get Contacts` `$select` doesn't fetch `Account.Name`
— connector can't traverse it; city/state DO come via Mailing fields). Both later, LCC-side or
a separate Account resolve.
