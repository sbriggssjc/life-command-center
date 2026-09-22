# GOV-UX1: Gov Available navigation, owner panel, verification parity, and an automation audit (2026-09-22)

Source: `SB notes/done/gov availables view.docx` → TRIAGE SBN-23 / SBN-24 / SBN-25. Backlog row `GOV-UX1`.
Guard: `test/gov-ux1-navigation-owner-verification.test.mjs` (22 tests; the 11 mutations listed in §4 each turn it RED).

## A. The background jump to Dialysis (SBN-24): FIXED

**Mechanism, found by reading the router, not guessed:**

1. The **Business sub-tabs** (Dialysis | Government | …, `#bizSubTabs`) switched `currentBizTab` but **never wrote the
   hash**. Only the bottom-nav buttons did. So `#/dia` → click "Government" left the hash reading `#/dia`.
2. Opening any row runs `_routeSetDetailHash`, which built the new hash from `_routeCurrentPageSlug()`. That function
   **preferred the slug already in the hash**, so it wrote `#/dia?d=prop:gov:…`.
3. The push fires `hashchange` → `applyRoute()` → `_routeIsPageActive('pageDia')` is false (the active bnav is
   `pageGov`) → `navTo('pageDia')` → the background switched to **Dialysis › Overview** behind the property panel.

A second, independent path: `ROUTE_PAGE_TO_SLUG` was built with `Object.fromEntries`, so the LAST slug won and
`pageBiz` reverse-mapped to `'capmarkets'`. `applyRoute`'s capmarkets branch forces
`currentBizTab = 'dialysis'`, so a detail opened on any non-domain Business tab (Prospects, All Other) would also
yank the lane.

**Fix (app.js):**
- `_routeLivePageSlug()` reads the page from the live DOM (`.page.active` + `currentBizTab`), which cannot be stale.
  `_routeCurrentPageSlug()` and `_routeClearDetailHash()` use it.
- `ROUTE_PAGE_TO_SLUG` keeps the FIRST slug (`pageBiz → business`). `capmarkets` stays an inbound alias.
- The sub-tab click writes `#/gov` / `#/dia` through the existing guarded `_routeSetPageHash`.

## B. The owner click (SBN-25): FIXED

**Measured live, LCC Opps 2026-09-22:**
- `ff84dd24-8177-4166-ada2-99402eabdf7b` "Gold Circle Properties" is live (canonical_name `gold circle properties`).
- `fe43e581-…` has the same name and is merged into it.
- `external_identities(gov, true_owner, ff84dd24…)` points at the survivor.

The panel's owner click called `_openEntityByNameSmart(name)`. That ran `/api/entities?action=search&q=…`, a substring
ILIKE on the raw display string `"Gold Circle Properties, LLC"`, which matches neither `name` nor `canonical_name`.
It found nothing and fell back to `openEntityDetailByName`, which **replaced the primary property panel** with
"No entity found". Without the suffix the same search returns the live row AND its tombstone. `openEntityDetailByName`
then reads two rows as "Multiple entities found".

**Fix: one resolver.**
- `api/_shared/owner-entity-resolve.js::planOwnerResolution` is pure and tested. Its ladder, in order:
  1. `entity_id`
  2. the domain `true_owner` identity, merge-followed. This is the id the Next-step "Owner resolved" card reads.
  3. an exact `canonical_name = normalizeCanonicalName(q)` match, merge-followed and deduped. Legal suffixes are
     stripped by the existing N15c key, never a fuzzy match.

  Two or more live parties on one key comes back **ambiguous with candidates**. It never guesses.
- `GET /api/entities?action=resolve_owner` serves it (`entities-handler.js`).
- `action=search` now excludes tombstones, adds an exact canonical-key arm, and sorts exact matches first.
- **Client:** `_resolveOwnerEntity` (detail-panel-shell.js) is the single client entry. `_openEntityByNameSmart(name, hint)`,
  "Work this owner", the Current Owner chip, "research owner →" and `openEntityDetailByName` all go through it.
  `_udResolvedOwnerRef` now carries `db` + `true_owner_id`, so the chip resolves by the same identity as the card.
- **Stacked panel:** a resolved owner opens in the existing **companion dock beside the property** (`openCompanionEntity`,
  dual-width). On a narrow screen it opens in the entity panel, which pushes a `_detailStack` level, so ← Back returns
  to the property. No new panel pattern was built; both already existed. An **unresolved** owner with a property panel
  open never replaces it. It shows a candidates/none card in the dock, or a toast when there is no room.

Known gap, not changed: a dotted `L.L.C.` keys to `… l l c`. That is the live `lcc_entity_canonical_key` behaviour
(N15c), and changing it re-keys the whole table.

## C. One verification surface (SBN-23): FIXED

`listing-verification.js` (new classic script, loaded before `gov.js`/`dialysis.js`, shared `?v=` buster) is now the
single component. The dia and gov functions are thin wrappers over it:
`renderListingVerificationCard`, `renderRecentDiaVerificationsPanel`, `renderGovListingVerificationCard` and
`renderRecentGovVerificationsPanel`.

| | before | after |
|---|---|---|
| placement | gov: Sales › Available · dia: Overview On-Market block | **Sales › Available in both** |
| headline | dia `overdue (30d+)` · gov "due now" (the "9") | **`overdue (30d+)` in both** (`data-lv-headline="overdue_30d"`) |
| Recent panel default | dia Evidence · gov All (50/50 cron-only rows) | **Evidence in both**; cron rows read "cron-only · timer advance" |

**Why Sales › Available:** the digest counts listings, and that tab is where those listings are rows the operator can
open and verify. An overview tile has nothing to act on beside it.

**DOM-level assertion (in the guard):** with the screenshot's summary (`due 9`, `overdue_30d 80`) and 50 cron-only
rows, both lanes render headline `80`, `overdue (30d+)`, `data-lv-filter-active="evidence"`, zero `lv-row` elements,
and the line *"50 cron-only timer advances (not verifications)"*. The two lanes' HTML is identical except for the lane
attribute.

## D. Automation: measured, not built

Standing doctrine: *only human-in-the-loop work belongs in a priority list; anything the code can decide, the code
decides and logs.* All counts below are live on 2026-09-22.

### Open instances by class (`v_next_best_action` + the property-panel spine)

| class | gov | dia | evidence the code already holds when it raises the prompt |
|---|---:|---:|---|
| `missing_recorded_owner` | 4,186 | 5,862 | none. The owner is unknown, so the source must be acquired |
| `agency_drift:agency_disagreement` | 1,481 rows / 1,239 props | — | `properties.agency` vs `leases.tenant_agency`, raw strings |
| `agency_drift:lease_agency_but_property_agency_null` | 46 / 45 | — | the lease names an agency and the property is blank |
| `lease_tenant_drift` | — | 3,528 | the lease tenant differs from the property tenant |
| `cms_chain_drift:operator_transition_candidate` | — | 2,570 | CMS chain differs from the property operator |
| `cms_chain_drift:cms_chain_but_property_tenant_null` | — | 16 | CMS names a chain and the property tenant is blank |
| `orphan_sale_owner` | 266 | 368 | a sale names a buyer that is not linked as owner |
| `stale_active_listing` | — | 213 | the listing is active past its verification window |
| `llc_research_pending` | 9 | 4 | an SOS research row is open |
| "Create the lead" (owner resolved, no open opp) | 7,052 owners | 656 owners | the resolved owner entity, and no open `bd_opportunities` row |
| "Add to cadence" (open opp, no cadence) | 35 of 43 open opps, fleet-wide | | the opp exists and no `touchpoint_cadence` row does |

### Agency drift: the one ID3a-drift asked to measure first

The view compares **raw strings**: `lower(trim(p.agency))` vs `lower(trim(l.tenant_agency))`, with a substring escape.
It never reads `agency_canonical`, the column ID3a's fold writes. This is the ID3a-drift finding, now sized.

Of the 1,644 underlying (property, lease) rows:
- **600** are on a **superseded** lease and **802** on an **expired** lease. The view has no lease-currency filter, so
  history is reported as drift.
- **308** agree once both sides go through `canonicalize_agency()`. These are spelling only.
- **654 rows / 565 properties** are live and still disagree after canonicalizing. Of those, **272** have the property
  saying *GSA*: GSA is the lessee of record, the lease names the occupying agency, and the screenshot case
  ("GSA" vs "DHS") is one of these. **340** have a lease string the canonicalizer does not recognise. **4** properties
  are genuinely multi-tenant.

### Ranked recommendation (build is a follow-up prompt)

| # | rule | acts on | false-positive risk | verdict |
|---|---|---|---|---|
| 1 | **Fix the drift detector, not the data.** Canonicalize both sides, and read only the current, unsuperseded lease. | removes ~990 of 1,481 view rows (superseded / expired / spelling) | none. It narrows a detector | **build first**. This is ID3a-drift's "extend the check" |
| 2 | **GSA → occupying agency, automatically.** When the property agency canonicalizes to GSA and the one live lease names a single canonical federal agency, write `agency_canonical` from the lease, ledgered and reversible. | ~272 rows | low. GSA-as-lessee is structural; multi-tenant (4) and unrecognised lease strings are excluded | **build**, dry-run first, owned by government-lease (the gov DB) |
| 3 | **Fill a blank property agency from the lease** (`…property_agency_null`). | 46 rows / 45 props | low. Fill-blanks only, from a current lease | **build** alongside #2 |
| 4 | **Add to cadence: auto-seed on an open opp.** `cadenceSeedDecision()` already gates reachability, so apply it to the 35 open opps with no cadence. | 35 | low. P112's gate already refuses unreachable parties | **build**. The Next-step "Add to cadence" button then disappears for these |
| 5 | **Create the lead: never automatic on "owner resolved" alone.** 7,708 owners lack a lead. Auto-minting would be the Consumption-Layer failure: a lead per captured row. Gate on the doctrine seller queue instead (`v_lcc_seller_prospect_queue`: 439 owners, 436 without a lead, 218 with a measured reason to sell, **98 with a linked person and no lead**). | 98 (the strict gate) | medium. A lead is a human commitment to pursue | **recommend a gated rule**: auto-create only for seller-queue owners with a reason to sell AND a linked person. Otherwise keep the button, and hide it outside the seller queue |
| 6 | **The rest of the agency drift** (340 unrecognised + ~380 true disagreements) | ~720 | high | **human**. It is a judgement or a registry gap; widen `canonicalize_agency` first (ID3a) and re-measure |
| 7 | `lease_tenant_drift` (3,528) / `operator_transition_candidate` (2,570) | dia | unmeasured here | **measure next** with the same canonicalize-and-current-lease treatment as #1 before any rule; the raw-string shape is likely identical |

Lead creation must reuse the existing BD opportunity writer, `operations.js::bridgeCreateLead` (`create_lead`, which
already seeds the cadence). A second writer would be the two-writers-one-fact defect.

## 4. Mutations (each turns the guard RED)

A1 hash-first slug · A2 last-slug-wins map · A3 sub-tab without hash write · B1 planner counts a twin separately ·
B2 unresolved owner replaces the panel · B3 client skips the resolver · B4 owner ref drops `true_owner_id` ·
B5 search keeps tombstones · C1 headline back to "due now" · C2 gov Recent default back to All · C3 dia overview card
restored.

## 5. Deploy

JS only, with no migration. Redeploy **both Railway services**, then run `npm run verify:deploy` (the new
`listing-verification.js` is probed as a `<script src>`). The cache busters moved as a set: `2026092203 → 2026092204` (after merging main, which had already moved the set to `2026092203`),
and `gov.js` joined the set.
