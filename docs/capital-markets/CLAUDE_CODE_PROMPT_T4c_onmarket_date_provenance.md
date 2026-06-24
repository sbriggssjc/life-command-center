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
1. **Earliest email received date.** Trace `available_listings.intake_artifact_path →
   staged_intake_artifacts → staged_intake_items.internet_message_id → Gmail`, read the message Date
   header, and take the **EARLIEST** message for that property (original send, ignore the mass-forward).
   Source `email_earliest`, high confidence. *This is the answer to "how do I handle the ~403
   genuinely-June-ingested" — they are June-INGESTED, not June-on-market; their earliest email date is the
   real anchor and for many predates June.*
2. **CoStar / LoopNet / RCA** "date listed" / days-on-market when a `listing_url` or platform match exists
   — the canonical market date; overrides #1 where present. Source `costar`/`loopnet`/`rca`.
3. **Salesforce** listing/opportunity list date or stage-change date. Source `salesforce`.
4. **Fallback** — `om_first_received_at` (earliest receipt), tagged `om_received_fallback`, LOW confidence,
   only when 1–3 fail. **Never the mass-forward `created_at`.** Where even this is unrecoverable, HOLD:
   `on_market_date` NULL, excluded from the timing series — do not invent a date.

The artifact-path date (`lcc-om-uploads/YYYY-MM-DD/`) is a weak proxy for #4 only — prefer the actual
email Date via the message-id, which is more precise and not subject to re-upload.

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
