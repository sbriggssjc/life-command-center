# Claude Code prompt — Round 74: Salesforce as authoritative source for is_northmarq (both verticals) + #20 cap-basis resolution

> Scott's directive: make Salesforce the LIVE authoritative source for
> `is_northmarq` on BOTH dialysis and government, replacing the unreliable
> R23 broker-string backfill. CRITICAL CONSTRAINT (Scott): Salesforce data is
> entered by many people, so single SF fields are NOT trustworthy — "Is
> Government" is not always checked, "Dialysis" subtype is not always set
> (especially multi-tenant deals), so a subtype/flag filter MISSES deals we
> want. The sync must use MULTIPLE search/pull strategies, not one field.
>
> ARCHITECTURE CONSTRAINT (confirmed in repo, Scott-confirmed): ALL Salesforce
> access goes through POWER AUTOMATE — Scott's SF org requires SSO and he has no
> admin rights to register a Connected App for direct OAuth. `api/_shared/
> salesforce.js` documents this: it's a PA webhook proxy (`SF_LOOKUP_WEBHOOK_URL`)
> doing single-record lookups only (`find_account_by_name`, `find_contact_by_email`).
> A bulk channel also exists: the `intake-salesforce` edge function +
> `sf_comps_staging` + `sf_sync_log` (the May 126k-row backfill) and a healthy
> SF identity map (1,910 entities mapped via `external_identities`
> source_system=salesforce). So "make it LIVE" is NOT a new direct connector —
> it is a POWER AUTOMATE FLOW that Scott builds (he has PA access) which pushes
> the closed-won deal universe into a staging table on a cadence, with the
> classifier + matcher running LCC-side. CC's deliverable: define the PA flow
> CONTRACT (the exact JSON shape + fields PA must return — model it on the
> `data.xlsx` columns + the existing PA proxy pattern) AND build the LCC-side
> ingestion → classify → match → flag. CC does NOT stand up direct SF auth.
> Scott's action item out of this round: build/extend the PA flow to that
> contract. Reuse `sf_comps_staging` if its shape fits; else define a sibling
> staging table.

```
CONTEXT — the spot-check that motivated this (dia, 286 SF "dialysis" deals):
  Seller/listing-side (240): 150 correctly flagged, 50 in-DB-UNflagged,
  40 missing-from-DB (~14 of which are referral/advisory/fee, not real comps).
  Dia DB has 315 is_northmarq vs master's 183 NM-listed — so the flag is BOTH
  over- and under-set. The R23 broker-string heuristic is unreliable in both
  directions. Gov: re-deriving from master L.BROKER got NM to 6.79% (≈deck
  6.78%) — gov master attribution is decent; dia needs the CRM.

TASK 1 — Salesforce reachability + identity model (design first, no writes)
  Confirm via the existing intake-salesforce path (or a read connector) what's
  queryable: Opportunity/Closed-Won deals with Lead Broker, Team, Deal Type,
  Direct/Co-Broke, Close Date, Sales Price, Cap Rate, City/State, Tenant,
  Property Type, Subtype, "Is Government", Building SF, ELA. The 'data.xlsx'
  Scott exported IS this object (DEAL NAME, SALES PRICE, CAP RATE, CLOSE DATE,
  LEAD BROKER, TEAM, DEAL TYPE, CITY, STATE, TENANT, PROPERTY TYPE, etc.).
  AUTHORITATIVE NM RULE (Scott-confirmed): a deal is Northmarq iff the LISTING
  broker is Stan Johnson Co ("SJC")/Northmarq OR Team Briggs — i.e. NM had the
  LISTING. In SF terms: Direct/Co-Broke in ('Direct (Both)','Co-Broke
  (Seller)') AND Team/Lead-Broker is a Northmarq team (the deck counts
  NM-LISTED sales). Buy-side-only deals are NM track record but NOT "NM-listed"
  for the value-prop chart — tag them separately (is_northmarq_buyside) so we
  can report both without polluting the listing-side cap comparison.

TASK 2 — MULTIPLE pull strategies (Scott's integrity constraint)
  Do NOT filter SF on a single subtype/Is-Government field. Pull the closed-won
  universe and classify OUR way, using several signals OR'd together:
  DIALYSIS membership (any of):
    - Tenant name ~ dialysis operators (DaVita, Fresenius/FMC, US Renal/USRC,
      American Renal, Satellite Healthcare, Innovative Renal Care, Dialysis
      Clinic Inc, Aqua, Biomat, CVS Kidney/Satellite, Dialyze Direct, …)
    - Subtype='Dialysis' (when set)
    - Deal Name ~ dialysis keywords
    - Property linkage to a known dia property_id
    For MULTI-TENANT deals where dialysis is one tenant, INCLUDE if any
    dialysis operator is a tenant (Scott: multi-tenant deals get mis-subtyped).
  GOVERNMENT membership (any of):
    - "Is Government"=true (when set)
    - Tenant/agency ~ federal/state/municipal agency patterns (GSA, SSA, DHS,
      VA, FBI, USPS, DEA, courts, DMV, state/county/city names as tenant…)
    - Lease number format (GS-/LVT/LFL/… gov lease IDs)
    - Property linkage to a known gov property_id
  Document the operator/agency dictionaries; make them a maintainable config.

TASK 3 — match SF deals to our DB + set is_northmarq (dry-run → gate → commit)
  For each SF-classified NM-listed deal, fingerprint-match to our sales
  (state + close_date ±120d + sold_price ±6%, the established tolerant gate;
  fall back to city for thin matches). Then per vertical:
    a. SET is_northmarq=true on matched deals that the CRM says are NM-listed
       (recovers the 50 dia unflagged + any gov).
    b. UN-FLAG current is_northmarq=true deals that the CRM (and master)
       does NOT attribute to NM-listing — the contaminants (gov 169→~66 already
       validated; dia 315→the CRM-authoritative set).
    c. Report flags-added / flags-removed / net, and the new NM-vs-non-NM
       averages per vertical. Provenance-tag (is_northmarq_source='salesforce').
  Gate: dry-run plan JSON (per-vertical counts + 30-row samples of add/remove)
  → Scott's verification → commit. Flag-column only; no price/term/cap writes.

TASK 4 — the ~missing real deals (track-record completeness)
  SF NM-listed deals that fingerprint-match NOTHING in our DB (≈26 real dia
  single-asset sales after dropping referral/advisory/fee/portfolio rows;
  +gov equivalents) → stage as an import candidate set (the 7d pattern:
  property attach-or-create + sale insert + master/SF provenance). Separate
  gated mini-round AFTER the flag fix; report the count + $ volume so Scott can
  scope it. Do NOT import referral/advisory/fee/portfolio rows (not single-asset
  comps).

TASK 5 — #20 value-prop chart cap basis (resolves the spread)
  After the flag is authoritative, the NM line matches the deck (gov 6.79 ≈
  6.78) but the MARKET line is ~48bps low vs the deck's non-NM (our broad-DB
  transaction caps run below the deck's master-curated caps). The deck is built
  on curated comps. Decision for Scott (present both, recommend): 
    (A) Compute cm_{gov,dia}_nm_vs_market on the CURATED-COMP cap basis (prefer
        master/SF-confirmed cap where present, else sold_cap_rate) so it
        reproduces the deck's full ~50-72bps spread — faithful to the
        client-facing value-prop chart.
    (B) Keep broad-DB caps and document the narrower spread as the
        market-universe view.
  Recommend (A) for this specific flagship chart (it IS the deck). Keep the 2yr
  TTM window (thin NM cohort, Layer-A precedent) on both lines.

TASK 6 — make it LIVE (the durable fix, via Power Automate)
  The sync is a PA-push → LCC-ingest loop (NOT a direct SF query — see the
  architecture constraint at top):
    (a) PA flow (Scott builds, to CC's contract): on a cadence (weekly), query
        SF closed-won deals and POST the universe to an LCC HTTP endpoint /
        Supabase Edge Function, landing rows in a staging table (sf_comps_staging
        or a sibling). Contract = the data.xlsx field set (Deal Name, Sales
        Price, Cap Rate, Close Date, Lead Broker, Team, Deal Type, Direct/
        Co-Broke, City, State, Tenant, Property Type, Subtype, Is Government,
        Building SF, ELA) + a stable SF record Id for idempotency.
    (b) LCC ingest (CC builds): on each push, run the Task-2 multi-strategy
        classifier (dia/gov membership) + the Task-3 matcher + flag re-derivation
        over the staged universe, idempotently (upsert on SF Id; re-derive
        is_northmarq from scratch each run so corrected SF data propagates).
        Log to sf_sync_log; surface adds/removes per run. The multi-strategy
        classifier + operator/agency dictionaries (Task 2) are the durable
        config — version them in the repo.
  Until the PA flow exists, the one-shot path (Tasks 1-4 run over the data.xlsx
  Scott exported + a manual re-export) delivers the fix now; Task 6 makes it
  self-maintaining. CC defines the contract + builds (b); Scott builds (a).
  Cross-reference R12 audit: the existing `intake-salesforce` / `autoCreateProperty`
  path has a known cross-domain misroute (dia property → gov table,
  government_type='Healthcare' → 23514) — do NOT reuse that writer's domain
  routing; the dia/gov split must come from the Task-2 classifier, not a single
  SF field.

TASK 6c — listing_date backfill for the over-stamp wall (from R73 #9 follow-up)
  ~222 dia listings have NULL listing_date + a FUTURE off_market_date (the
  availability-checker over-stamp artifact that inflated the active count).
  Backfill a real listing_date via the evidence ladder: (1) availability-checker
  page markers (last_checked / raw capture), (2) CoStar capture date, (3)
  sale-anchor (sale_date − median DOM, dia ~196d); tag listing_date_source;
  dry-run → gate → commit; re-verify cm_dialysis_market_turnover_m (recent
  active should rise toward ~130 on REAL dates). Audit gov for the same pattern.
  6c-ROOT: find the writer stamping a FUTURE off_market_date on undated rows
  (check availability-checker / lcc-auto-scrape-listings / lcc_record_listing_check)
  and stop it — without this the backfill re-accumulates.

ORDER: 1 (SF reachability) → 2 (classifier) → 3 (flag re-derivation, gated,
both verticals) → 5 (cap basis, Scott's call) → 4 (missing-deal import, separate
gate) → 6 (live cron). Gov #20 clean-flag commit can ship immediately (already
validated) ahead of the full SF wiring; dia waits for the SF-authoritative set
(the master-only re-derivation regressed dia to 7.29% — do NOT ship it).
Standard gates; flag-column writes only until Task 4.
```
