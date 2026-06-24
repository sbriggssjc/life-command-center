# Claude Code prompt — T4c: on-market-date PROVENANCE model + email-date backfill + mass-forward guard

> **Supersedes T4b.** Scott's reframe (2026-06-24): the dia June "surge" is an **ingestion-provenance
> problem, not a data problem.** Every fake-dated row is an OM that arrived by email and was ingested;
> at one point the entire `teambriggsdialysis@gmail.com` mailbox was mass-forwarded to LCC Intake, so the
> ingest timestamps clustered. The date we *received/processed* an OM is NOT reliable evidence of the true
> on-market date. The fix is to model on-market date as a first-class, source-ranked field and recover it
> from the best available evidence — never to default to the processing clock. dia `zqzrriwuavgrquhisnoa`,
> gov `scknotsqkcheojiaewwh`, intake on LCC Opps `xengecqvemvfknjvbvrq`.

## Receipts (grounded 2026-06-24)
- `available_listings` carries only `created_at` (ingest timestamp) and `listing_date` (currently just the
  fallback = ingest date, `listing_date_source IN ('capture_date_fallback','date_unknown_r70b34','date_unknown')`).
  **There is no on-market date and no email date on the listing** — so the timing charts have nothing but
  the processing timestamp to plot. That is the surge.
- `staged_intake_items` carries **`internet_message_id`** (the RFC Message-ID of the original Gmail email)
  + `created_at` (ingest) + `source_type`. **The email's true Date header is NOT stored in a column** — it
  is recoverable via `internet_message_id` → Gmail (and the Power Automate flagged-email flow already has
  `receivedDateTime`/`sentDateTime` in the message object; it just isn't persisted).
- The fake-dated population is **657 dia rows spanning 2023-11-27 → 2026-06-24** (CC, T4 chat) — NOT just
  June. Target the whole flagged set; June is only the visible cluster.
- `last_seen` is populated on 641/657 — but that is the **capture/verification** date (when the
  availability-checker last saw the row, ~May–Jun 2026 for the bulk). It is the right tool for FRESHNESS,
  **not** for market-entry timing — anchoring the timing series on `last_seen` just relabels the Q2-2026
  step "captured in Q2" instead of "listed in Q2." Same surge, different label. Do not use it as the
  market-entry anchor.

## The model — three distinct dates, never collapsed
1. **`ingested_at` / `created_at`** — when LCC processed the OM. Operational only. NEVER a market signal.
2. **`om_first_received_at`** — the *earliest* time the OM email hit the mailbox (the original broker send,
   not the mass-forward). Capture going forward (see §Ongoing).
3. **`on_market_date`** + **`on_market_date_source`** + **`on_market_date_confidence`** — what the charts
   read. **Stop the silent default**: ingestion must never write `listing_date = created_at /
   'capture_date_fallback'`. If no real market date can be established, `on_market_date` stays NULL and the
   row is **excluded from the added-per-month + DOM series** (it may still count in the point-in-time
   "active inventory, date unknown"). A NULL is honest; a fabricated load-date is the surge.

## The evidence ladder (same logic for backfill AND every future ingest, highest confidence first)
1. **Salesforce `Comp__c.On_Market_Date__c`** — keyed by the `sf_entity_id` already stored on each intake
   (in `staged_intake_items.raw_payload`). This is Northmarq's own human-recorded on-market date for the
   comp — deal-specific and authoritative, so it OUTRANKS platform first-seen and the email heuristic.
   Source `salesforce_comp`, highest confidence. **Run server-side** (see §Execution) — the SF OAuth lives
   in the app, not in a CC session.
2. **CoStar / LoopNet / RCA** "date listed" / days-on-market when a `listing_url` or platform match exists.
   Source `costar`/`loopnet`/`rca`.
3. **Earliest email received date.** Trace `available_listings.intake_artifact_path →
   staged_intake_artifacts → staged_intake_items.internet_message_id → Gmail`, read the message Date
   header, take the **EARLIEST** message for that property (original send, ignore the mass-forward). Source
   `email_earliest`. *Resolves the "~403 genuinely-June-ingested" tail SF doesn't cover — they are
   June-INGESTED, not June-on-market; the earliest email date predates June for many.*
4. **Fallback** — `om_first_received_at` (earliest receipt), tagged `om_received_fallback`, LOW confidence,
   only when 1–3 fail. **Never the mass-forward `created_at`.** Where even this is unrecoverable, HOLD:
   `on_market_date` NULL, excluded from the timing series — do not invent a date.

The artifact-path date (`lcc-om-uploads/YYYY-MM-DD/`) is a weak proxy for #4 only.

## Session scope — sandbox (now) vs app (deferred)
None of the ladder sources are runnable in a CC sandbox (SF + Gmail + CoStar/RCA all live behind the app's
OAuth/connectors; verified there is NO persisted email Date locally — `staged_intake_items` holds only
`internet_message_id`, and the artifact-path date itself clusters in June). So **do not run the recovery in
this session and do not fabricate.** In-session (no OAuth) deliverables:
1. The model change (the `on_market_date`/source/confidence fields; kill the silent
   `listing_date = created_at/'capture_date_fallback'` default; add `source_email_date` for ongoing capture).
2. **The honest de-surge — hold the fake-dated set out of the TIMING series.** In the dia + gov
   added-per-month / DOM / ramp views, the fake set (`listing_source IN ('lcc_intake_om','email_om',
   'om_extraction')` × `listing_date_source IN ('capture_date_fallback','date_unknown_r70b34','date_unknown',
   'om_lease_inference', NULL)`) is treated as `on_market_date = NULL` → excluded from the timing axis, while
   KEPT in the freshness-gated point-in-time active count. Zero invented dates; de-surges the chart today.
   Supersedes both the "count the ingest date" interim and the "`last_seen` entry-anchor" stopgap.
3. Build (do NOT run) the server-side recovery worker + ongoing email-Date capture + mass-forward guard.
4. Verify published history (≤2026-03-31) byte-identical; series no longer steps at Q2-2026 because the
   fake set is HELD, not because of a fabricated date.
Deferred to the app (OAuth): running the recovery worker, which progressively fills `on_market_date`; held
rows then re-enter the timing series at their real months.

## Execution (where each source runs)
The recovery is a **server-side LCC backfill worker** (sub-route, ≤12 api/*.js; GET=dry-run / POST=drain;
capped; reversible — same posture as geocode-tick / llc-research-tick), NOT a CC-session query. It runs on
Railway where the SF OAuth/client already exists (reuse the comp-sync / ascendix / activity-ingest client).
Per row in the fake-dated set, it walks the ladder: SF `Comp__c.On_Market_Date__c` by `sf_entity_id` first
(step 1), then platform, then the Gmail message-id traceback, then hold. Scott triggers + gates it on the
deployed app; CC builds it but cannot run the SF query from its session (expected). The **dry-run reports
coverage** — how many of the ~404 gov active + dia 657 carry a populated `On_Market_Date__c` (sf_entity_id
lives in `raw_payload`, so the dry-run is the only way to measure SF reach vs. platform/email/hold).

## Backfill sequence (now)
- **Phase 1 (biggest win, data you already own):** message-id → Gmail traceback for the email-sourced set;
  set `on_market_date` from the earliest message Date. Resolves the large majority of the 657.
- **Phase 2:** platform list date where a CoStar/RCA match or URL exists (upgrades confidence, overrides #1).
- **Phase 3:** Salesforce join for the remainder.
- **Residual:** stays NULL/unestablished + falls to the manual worklist already delivered
  (`OM_Intake_OnMarket_Date_Research.xlsx`) — the catch-net, not the primary mechanism.
- Reversible: log prior `listing_date`/source before overwrite.

## Ongoing ingestion (so it never recurs)
- **Capture the email Date at ingest** as a real column on `staged_intake_items` (e.g.
  `source_email_date`), read from the flagged-email flow's `receivedDateTime`/`sentDateTime`. Then ladder
  step 1 becomes a local read, not a Gmail round-trip.
- **Mass-forward guard:** detect a batch (N ingests sharing a near-identical `created_at` burst) and force
  those rows to derive `on_market_date` from the ladder (email/platform), never from `created_at`. Because
  the on-market date is now sourced from the immutable email Date / platform — and the rule takes the
  EARLIEST message — re-forwarding the whole mailbox again cannot move any market date.
- The availability-checker should keep flipping stale rows to off_market so the active set self-corrects.

## gov scope (grounded 2026-06-24 — important: do NOT touch the sales-proxy)
The gov change this round is the SAME intake-date recovery as dia, NOT a sentinel/synthetic change.
Breakdown of gov `available_listings`:
- **Leave alone (intended history):** `synthetic_from_sale` (1,391, all `is_active=false`, 2012–2025 — the
  deliberate sales-proxy) and `master_curated_sale` (692, `is_active=false`, back to 1997 — curated import).
  Excluding these would delete real turnover history. The earlier "exclude synthetic_from_sale / replace the
  ≥20 sentinel" steer is **RETRACTED** — `synthetic_from_sale` is the intended proxy, the 2014-10-22 cluster
  is already correctly handled, and the sentinel is doing no harm. **Leave the ≥20 sentinel as-is.**
- **T4c target (the real mirror of dia 657):** `listing_source IN ('lcc_intake_om','email_om',
  'om_extraction')` with `listing_date_source IN ('capture_date_fallback','date_unknown_r70b34',
  'om_lease_inference', NULL)` — ~404 active `capture_date_fallback` + 80 active `date_unknown` + inactive
  tail (119+63) + `om_lease_inference` (48, a lease-derived guess, also not a true on-market date — include,
  lower-stakes). Recover via the email-date ladder (step 1), then platform/SF, hold where unrecoverable.
- **Platform-batch unknowns:** `crexi` (all stamped 2026-03-12) and `salesforce_ascendix` (all 2026-03-31)
  get their date from the platform/SF (ladder steps 2/3), not email.

## Relationship to T4 (the already-correct baseline)
T4 is at a safe baseline (real inventory included, no suppress-guard, no published quarter touched). This
prompt is the durable fix that lets the dia active/timing series read a REAL market-entry date instead of
the ingest clock. Keep the T4 freshness gate (`last_verified_at >= now()−12mo AND
consecutive_check_failures < 3`) and the gov record-class test (exclude `synthetic_from_sale` /
`is_active=false`) — those are correct and orthogonal. Do NOT settle for the `last_seen` entry-anchor as
the final timing fix; it's an acceptable stopgap that removes the false 2024 back-dating but still steps
everything into Q2-2026. The email-date ladder is the real anchor.

## Gate (verify live)
- The 657 flagged dia rows (and gov equivalent) carry `on_market_date` from the email/platform ladder with
  a recorded `on_market_date_source` + confidence; the timing series ramps organically (no Q2-2026 step),
  added-per-month distributes across real months, DOM computes off real dates.
- Unrecoverable subset is NULL/held + reported (count), never fabricated. No double-count of OM-intake vs
  CoStar for the same property (de-dup on property_id).
- Point-in-time active count still reflects real fresh inventory (freshness gate), unchanged.
- Ongoing: a new OM ingest writes `source_email_date`; a simulated mass-forward does not move any
  `on_market_date`. Reversible (prior values logged). dia + gov.

## Boundaries
On-market date is sourced from evidence (email/platform/SF), never the processing clock. Hold the
genuinely-unrecoverable; never invent a date. `last_seen` is freshness, not market entry. Reversible.
No change to published (completed-quarter) history. ≤12 api/*.js.
