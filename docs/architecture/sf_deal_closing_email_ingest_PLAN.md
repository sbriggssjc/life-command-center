# Deal Closing Announcement email → recorded sale (PLAN, 2026-06-23)

> 🗄️ **HISTORICAL (DOCMAP1, 2026-09-08).** Explicit "Status: PLAN (no code written yet)" from 2026-06-23; verify still-unbuilt against CURRENT-STATE.md/PLANNED-BACKLOG.md before treating as live design.
>
> Kept for the record — nothing below was edited; treat any status/data claim in it as a
> point-in-time snapshot, not current state.

> Status: **PLAN (no code written yet)**. Scott approved approach = **Both**
> (build the email path **and** diagnose/fix the automated SF pull — Part B is
> `docs/setup/PA_FLOW_get_deals_closed_stage_fix.md`). Depth = **plan first**.
> Build Part A on `claude/gifted-bardeen-01csn4` on Scott's go.

## The ask (Scott)

Northmarq's Salesforce emails a **"Deal Closing Announcement"** to
`Production_ALL@northmarq.com` for **every firm closing** — including deals that
are NOT Scott's team's (the sample is *US Renal – Covington, GA*, **Team Harf**).
Scott wants to drop these in an **"LCC Intake" Outlook folder + flag** them, and
have LCC ingest the closing → pull the deal details (from the email and/or
Salesforce) → record the sale and update status / buyer / seller / price / cap.

## What happens today (the gap)

Every flagged email hits `api/intake.js :: handleOutlookMessage` →
`stageOmIntake` → the **OM (offering-memorandum) extractor**, which reads a
*listing for sale* (asking price, cap rate, tenant). A closing announcement is a
**closed sale**, not a listing — the OM extractor's `not_a_listing_doc` guard
rejects/mis-handles it. **It never records a sale, marks sold, or sets
buyer/seller.** No code anywhere recognizes the `salesforce@northmarq.com`
sender or the "Deal Closing Announcement" subject (confirmed via grep).

## What already exists downstream (reuse, don't fork)

There is a verified **closed-deal pipeline** the email should feed:

- **`sf_deal_staging`** — a table on the dia + gov Supabase projects, refreshed
  hourly by the "SF → LCC Object Sync" Power Automate flow (`intake-salesforce`
  edge fn `?action=objects`, which classifies vertical and routes dia→dia /
  gov→gov / drops others).
- **`dia_promote_nm_comps` / `gov_promote_nm_comps`** (daily crons
  `dia-nm-comp-promote` 05:40 / `gov-nm-comp-promote` 05:30) consume
  `sf_deal_staging WHERE stage='Closed IS'`, classify dia-vs-gov via
  `sf-nm-classifier.js` (which already maps "US Renal" → dialysis), match the
  existing property, **record the sale** (price/cap/date + buyer/seller side),
  dedup against any existing sale, and tag it Northmarq
  (`is_northmarq_source='salesforce_closed_is_deal'`). Recording the sale closes
  the listing / marks the property sold via existing triggers. See
  `docs/capital-markets/NM_CLOSED_IS_DEAL_ATTRIBUTION_2026-06-23.md`.

So the email path is a **second producer into `sf_deal_staging`**, NOT a new
sale-writing path of its own.

## Grounded receipts (live, dia `zqzrriwuavgrquhisnoa`, 2026-06-23)

- This exact deal (US Renal **Covington GA**, SF Opportunity `006Vs00000IPJGQ`,
  closed 2026-06-23) is **NOT in `sf_deal_staging`**. Only "Covington" row is a
  different deal (DaVita Covington **TN**, Terminated).
- The hourly sync **is current** (last import 17:18 today) — **but zero 2026
  Closed-IS deals are staged.** Newest `stage='Closed IS'` close date = **2025-12-19**.
- 2026 deals DO flow while **open** (`Listing Signed` → 2027, `In Escrow`
  2026-08, `LOI Executed` 2026-07) but every **closed/terminal** stage stops in
  2025 → deals are pulled while open then **drop out the moment they close**
  (the Part-B root cause: the "Get Deals" StageName filter misses the
  closed-stage label, e.g. `CM - Closed IS`).
- The property **exists** in dia (`35481` / `35780`, "USRC Covington, 4179 Baker
  St, Covington GA") — **only the sale is missing.** (Note: `35481`/`35780` look
  like a duplicate property — flagged below.)

**Conclusion:** the email workflow fills a *real* gap — recent firm closings are
not reaching LCC via the automated path, and these are firm-wide (other teams')
closings Scott would otherwise never capture. It is NOT redundant with the daily
pull today.

## The email payload (what we can parse)

The HTML body is a fixed label→value table (see the sample `.eml`). Available
fields, all inline:

| Field | Sample value | Notes |
|---|---|---|
| Deal Name | US Renal - Covington, GA | + SF Opportunity link `/lightning/r/Opportunity/006Vs00000IPJGQIA5/view` |
| Deal Type | Sale Deal - Commercial | |
| City, State | Covington, GA | |
| Sale Price | $2,410,000 | |
| Cap Rate | 7.61% | |
| Closing Date | 06/23/2026 | |
| Property Type | Healthcare | |
| Property Subtype | Dialysis | → `classifyVertical` ⇒ dia |
| Seller Company | Alliance Consolidated Group of Companies LLC | + SF Account `/Account/0018W00002X0hiMQAR/view` |
| Buyer Company | Srinivas Kothakonda and Naveen Budda | + SF Account `/Account/001Vs00000zPFVbIAO/view` |
| Deal Team / Broker | Team Harf / Isaiah Harf | |

The email carries everything needed — **no live SF Opportunity fetch is
required** (and the PA proxy has no "fetch Opportunity by Id" op anyway; see
"alternatives"). The SF Account Ids are a bonus for BD-entity linkage (A6).

## Part A — implementation plan (LCC code)

### A1. Detect + branch — `api/intake.js :: handleOutlookMessage`
After `subject`/`sender` are computed and the dedup/inbox_item row is created,
branch when: `sender.email === 'salesforce@northmarq.com'` **AND** `subject`
starts with `Deal Closing Announcement` (case-insensitive). Route to the new
handler and **skip** the `stageOmIntake` OM bridge. Still create the
`inbox_items` row (visible + linkable), tag `metadata.kind =
'deal_closing_announcement'`.
- Robustness: also accept the embedded `/lightning/r/Opportunity/` link as a
  secondary signal; the sender+subject pair is the primary gate.

### A2. Parser (pure, unit-tested) — new `api/_shared/sf-closing-email-parse.js`
`parseClosingAnnouncement(html) → { deal_name, city, state, sale_price,
cap_rate, close_date, property_type, property_subtype, seller_company,
seller_account_id, buyer_company, buyer_account_id, sf_opportunity_id,
deal_team }` (any field nullable). Extract by walking the label→value `<td>`
pairs; pull the Opportunity Id + Account Ids from the `/lightning/r/...` hrefs;
`sf_opportunity_id` normalized to 18-char via `sf-id.js toSf18`. Pure function,
deps-free, so it unit-tests against the sample `.eml` fixture.

### A3. Handler — new `api/_handlers/sf-deal-closing.js`
(Sub-route, **no new `api/*.js`** — keeps ≤12. Imported by `intake.js`.) Build
an **SF-managed-package-shaped object** and **upsert into `sf_deal_staging`** so
the existing promote machinery consumes it. The exact read contract confirmed
from the live `dia_promote_nm_comps` Closed-IS leg — the row MUST satisfy:
- `stage = 'Closed IS'`
- `deal_type` NOT `ILIKE 'D&E%'` (set `'IS CM'` or leave null)
- **`raw_row->>'Deal_Price__c'`** = numeric string **> 0** (this is the price
  gate — it reads `raw_row`, not the parsed `deal_price` column)
- close date via parsed `expected_close_date` column **or** `raw_row->>'CloseDate'`
- match keys in `raw_row`: `Tenant_Names_sjc__c` (operator, e.g. "US Renal
  Care"), `City_sjc__c`, `State_sjc__c`, `Property_Address_Line_1__c` (absent
  from the announcement → omit; match falls to city+tenant+price+date),
  `Property_Type_Subtype__c`, `Seller_Company_sjc__c`, `Buyer_Company_sjc__c`
- `Direct_Co_Broke_sjc__c` — **the announcement does not state NM's side**, so
  leave null → the promote tags it **unsided** (`p_tag_unsided=true`, correct for
  a firm-wide closing where we only know NM closed it)
- `sf_deal_id` = the 18-char Opportunity Id (idempotency key — converges with the
  automated pull once Part B is fixed)
- `StageName='Closed IS'` and the parsed columns (deal_price, deal_cap_rate,
  property_city/state, seller/buyer company, property_subtype) set for
  observability + the other promote legs.

**Vertical routing:** classify via `classifyVertical()` (`sf-nm-classifier.js`,
the canonical classifier — reuse, don't duplicate) and write to the matching
domain's `sf_deal_staging` via `domainQuery(domain, 'POST',
'sf_deal_staging?on_conflict=sf_deal_id,source_system', row, {Prefer:
'resolution=merge-duplicates'})`. (`domainQuery` accepts `'dialysis'`/`'government'`.)

> **Alternative considered (documented, not chosen):** POST the SF-shaped object
> to the `intake-salesforce` edge fn `?action=objects` to reuse its vertical
> routing + column parse. Rejected as primary because it adds a network hop to an
> edge fn whose URL/host project + exact payload contract would need verifying,
> and `classifyVertical` already IS the shared routing decision. Keep as a
> fallback if direct-write proves awkward.

### A4. Record the sale — trigger the existing promote
Recommended **real-time**: after the upsert, the handler async-calls
`domainQuery(domain, 'POST', 'rpc/<dia|gov>_promote_nm_comps',
{p_dry_run:false})` (idempotent; matches Covington GA + $2.41M + 2026-06-23 + US
Renal → property `35481`/`35780`, writes the sale, dedups, NM-tags). Best-effort:
a failed/slow promote never fails the email — the daily cron is the backstop.
- The promote fn is whole-universe + bounded + idempotent; a per-email call is
  acceptable. If it proves heavy, fall back to relying on the daily cron (≤24h).

### A5. Link back
Patch the `inbox_items` row: `metadata.staged_sf_deal_id` (+ domain), and
post-promote the matched `property_id` / `sale_id`, so the inbox card deep-links
to the property + the SF Opportunity.

### A6. Optional enrichment (nice, not required for v1)
Stash the buyer/seller **SF Account Ids** in `raw_row` so a later pass can mirror
SF identities onto the buyer/seller BD entities (the CONNECTIVITY#3 /
`salesforce-sync.js` machinery). Per Scott's "go with recommendations" — keep the
ids in `raw_row`, defer the actual identity-mirror pass to a follow-up.

### A7. Tests (headless, deps-injected — codebase pattern)
- `test/sf-closing-email-parse.test.mjs` — parse the sample `.eml` → expected
  fields; tolerate missing rows; Opportunity/Account Id extraction; `toSf18`.
- `test/sf-deal-closing.test.mjs` — detection gate (sender+subject); the built
  staging row satisfies the promote contract (stage / `raw_row.Deal_Price__c` /
  close date / match keys); idempotent on re-flag; `classifyVertical` routes
  dia vs gov; a gov-agency announcement routes to gov.
- `node --check` clean; `ls api/*.js | wc -l` == 12.

## Prerequisites / caveats (surface up front)

- **PA dependency (REQUIRED):** the flagged-email PA flow must POST the **full
  HTML body** (`body_text` / `body_html`). This email's plain-text MIME part is
  empty; the deal table is HTML-only, and `bodyPreview` (255 chars) won't reach
  the table. Without the full body the parser has nothing to read.
- **Duplicate property:** dia has both `35481` and `35780` ("USRC Covington").
  The announcement has no street address, so matching leans on
  city+tenant+price+date. The promote dedup mitigates duplicate *sales*, but
  won't merge the two property rows — flag as a data-quality cleanup
  (`v_data_quality_issues` duplicate_property_address).
- **Boundaries:** fill-blanks / dedup (the promote already enforces "match,
  don't duplicate"; `cur_src IS NULL` guard never relabels a curated source);
  reversible per-channel (`is_northmarq_source='salesforce_closed_is_deal'`,
  created-from-deal `data_source='salesforce_deal'`); ≤12 api/*.js; dia/gov
  pipelines otherwise untouched.

## Convergence with Part B
Both the email path and the automated pull key `sf_deal_staging` on `sf_deal_id`,
so they're idempotent against each other. Once Part B (the "Get Deals" stage
filter) is fixed, the email becomes a real-time / per-deal-control supplement —
no double-recording.

## Open decisions (carried to build time)
1. Real-time vs daily promote trigger (A4) — recommend real-time.
2. Scope = all flagged announcements (the flag IS the filter) — confirmed.
3. A6 SF-Account enrichment = stash ids now, mirror later — confirmed.
