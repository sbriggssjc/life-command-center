# Claude Code prompt — Round 74b: run the authoritative classifier against the ALREADY-STAGED SF universe

> Discovery this session (verified live in Power Automate + Supabase): the SF
> closed-won deal universe is **already staged** in `sf_deal_staging` on BOTH
> domain projects — we do NOT need Scott's manual export or a backfill to do the
> de-contamination. The hourly `SF -> LCC: Object Sync` PA flow has been pulling
> closed deals for weeks; its `Get Deals` step was just fixed (filter broadened
> from a name-keyword list to `StageName eq 'Closed IS'`, additive + watermark-
> gated, verified live). Full pipeline + field map: `docs/architecture/
> salesforce_nm_authoritative_sync.md` §3.5 / §3.6 (READ THIS FIRST).
>
> So R74's flag re-derivation runs **now**, against staged data — this is the
> real lever for the dia value-prop chart, not the historical backfill (which is
> a long-tail refinement, deferred).

## Where the data is

| Vertical | Table | Stage filter | Captured |
|---|---|---|---|
| dia | `zqzrriwuavgrquhisnoa.public.sf_deal_staging` | `raw_row->>'StageName' = 'Closed IS'` | 3,320 |
| gov | `scknotsqkcheojiaewwh.public.sf_deal_staging` | `StageName IN ('Closed IS','Final')` (gov uses BOTH closed labels) | 560 + 800 |

Each row carries parsed columns PLUS the full SF record in **`raw_row` jsonb**.
The classifier reads `raw_row`. Field map (use these exact SF API names):

- **NM listing side** → `raw_row->>'Direct_Co_Broke_sjc__c'`
  (`Direct (Both)` / `Co-Broke (Seller)` = NM-listed; `Co-Broke (Buyer)` =
  buy-side only → `is_northmarq_buyside`, NOT listing-side).
- **NM team (authoritative)** → `SJC_Broker_Team_Name_sjc__c`, `SJC_Broker_Team_sjc__c`, `Broker_Name__c`.
- **vertical signals** → `Tenant_Names_sjc__c` / `Tenants_sjc__c` (operator/agency match — the multi-strategy core), `Property_Type_Subtype__c`, deal `Name`.
  ⚠️ **`Agency_sjc__c` is NOT a gov signal** — it's the listing-agreement type ("Exclusive"/"Non-Exclusive"). Use `GOV_AGENCY_PATTERNS` on tenant/name/seller instead.
- **cap** → `Closing_Cap_Rate_sjc__c` / `CapRate_sjc__c` / `Deal_Cap_Rate__c`; **price** → `Sale_Price_Report_sjc__c`; **location** → `City_sjc__c`/`State_sjc__c`; **timing** → `Close_Date_sjc__c`/`CloseDate`; **id** → `id18_sjc__c`/`Legacy_ID_sjc__c`.

## Task (dry-run → my gate → commit; flag-column writes only)

1. **Classify** every staged closed deal via `sf-nm-classifier.js`
   (`classifyDeal` → vertical + NM-listed/buyside + comp/exclude). Multi-strategy
   per Scott's integrity rule — never a single field; split multi-tenant strings
   and match each tenant. Report which signals fired.
2. **Match** each NM-listed comp to our domain `sales_transactions`:
   `state` + `close_date` ±120d + `sold_price` ±6%, city to confirm thin matches
   (the established tolerant gate). Per vertical (dia → dia DB, gov → gov DB).
3. **Re-derive `is_northmarq` from scratch** per vertical and diff vs current:
   - **add** `is_northmarq=true` on matched deals the CRM lists as NM-listed,
   - **remove** on currently-flagged deals the CRM does NOT attribute to NM-listing,
   - tag `is_northmarq_source='salesforce'`.
4. **Re-evaluate the dia Task-3 held buckets** against this fuller universe
   (the prior plan was built on Scott's date/stage-filtered `data.xlsx`; the
   staged universe supersedes it as the authoritative CRM input):
   - the **84 held null-broker removes**, the **144 non-city-confirmed adds**,
     and the **4 Task-4 no-match** deals — resolve each now that we have the full
     CRM record (tenant, team, direct/co-broke, city) for matching.
   - flag the 2 known contradictions (sale_id 8327 / 13137, `M&M; Glass` but SF
     `Co-Broke (Seller)`) — SF is authoritative on NM involvement; confirm.
5. **Report** (the dry-run plan JSON → my verification gate):
   - per-vertical adds / removes / net, NEW NM-vs-non-NM **TTM 2yr** averages
     (so we can see dia move toward the deck's 6.38%), 30-row add/remove samples,
     and the `is_northmarq_source` provenance breakdown.
   - the count of SF NM-listed deals that fingerprint-match NOTHING (the Task-4
     import candidates — report count + $ volume; do NOT import here).

## Gates / guardrails

- Dry-run plan JSON first → my independent SQL verification (tolerant-match
  sampling + competitor-broker spot-check on removes) → commit.
- **Flag-column + `is_northmarq_source` only.** No price/term/cap writes.
- Idempotent / re-run-safe; provenance-tagged `salesforce`.
- The historical backfill (non-name-matched long-tail) is DEFERRED (separate
  gated job; the edge fn self-filters by vertical so it's constraint-safe when we
  do it). Gov SF is low-urgency (charts run off the master import).
- Order: dia first (the flagship #20 lever), then gov cross-check.
