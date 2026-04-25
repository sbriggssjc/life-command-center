# Claude Code / Cowork Instructions — Life Command Center

> **CRITICAL: Read .github/AI_INSTRUCTIONS.md before modifying any files in /api/.**

## Vercel Hobby Plan Constraint

HARD LIMIT: 12 serverless functions max (12 .js files in /api/).
Currently at 9 functions (Phase 4b freed 3 slots via edge migration).
data-proxy, daily-briefing, diagnostics absorbed into admin.js + Supabase Edge Functions.

## Rules

0. LCC_API_KEY auth is production-ready (Phase 6b). Frontend auth.js auto-injects X-LCC-Key via global fetch interceptor. To enforce: set LCC_API_KEY + LCC_ENV=production in Vercel.
1. NEVER create new .js files directly in /api/
2. Add new endpoints as sub-routes (use ?action= or ?_route= query param patterns)
3. New utility/handler code goes in /api/_shared/ or /api/_handlers/
4. After ANY /api/ change, verify: `ls api/*.js | wc -l` must be <= 12
5. Update vercel.json rewrites when adding new sub-routes
6. Use descriptive Round-numbered commit messages, never generic "GPT changes"
7. See .github/AI_INSTRUCTIONS.md for full architecture and routing patterns

## Architecture Quick Reference

- LCC orchestrates, domain Supabase backends execute domain logic
- Contacts + Entities consolidated into entity-hub.js (routes to _handlers/)
- Bridge + Workflows consolidated into operations.js
- Intake functions consolidated into intake.js
- admin.js: workspaces, members, flags, connectors, diagnostics (config/diag/treasury), edge proxies (data-query, daily-briefing)
- Supabase Edge Functions: data-query (gov/dia PostgREST proxy), daily-briefing (snapshot orchestration) on LCC Opps project
- pg_cron on LCC Opps: scheduled jobs — `refresh_work_counts` (5min), nightly preassemble/cross-domain-match, daily briefing, weekly report, history cleanup, `lcc-cleanup-orphan-om-uploads` (storage hygiene), `matcher-accuracy-rollup`
- `lcc_cron_post()` helper reads API key from Supabase Vault, POSTs via pg_net to Vercel or Edge endpoints
- All rewrites defined in vercel.json — order matters (specific before catch-all)

## OM Intake Pipeline — three channels, one shared path

All three OM intake channels converge on `api/_shared/intake-om-pipeline.js::stageOmIntake`:

1. **Email** (Power Automate flagged-email) → `POST /api/intake?_route=outlook-message`
2. **Sidebar** (Chrome extension / CoStar capture) → `api/_handlers/sidebar-pipeline.js` (does NOT go through stageOmIntake; writes domain DBs directly — Phase 2.2 instrumentation pending)
3. **Copilot Studio** (agent action) → `POST /api/intake/stage-om` → action_id `intake.stage.om.v1` → `handleIntakeStageOm`

Email flow REQUIRES the PA HTTP PUT body to use `base64ToBinary(items('Apply_to_each')['contentBytes'])` — passing raw `contentBytes` writes base64-text instead of binary (Bug E, fixed 2026-04-25). The extractor has a `recoverIfBase64Wrapped` safety net.

When an email has no OM-eligible attachment, `handleOutlookMessage` synthesizes a `text/plain` artifact from subject+body so the email body itself is ingested. The extractor handles `text/*` mime types by skipping pdf-parse and feeding the decoded text directly to AI.

See `docs/architecture/om_intake_pipeline.md` for the full reference.

## Multi-model AI fallback for extraction (2026-04-25)

The OM extractor (`api/_handlers/intake-extractor.js::callAiExtraction`) routes through `invokeExtractionAI` in `_shared/ai.js` rather than `invokeChatProvider` directly. The fallback chain:

1. **Primary** — whatever `invokeChatProvider` routes to (typically Claude via the Supabase edge function)
2. **On 429 / 5xx** — walk the `AI_EXTRACTION_FALLBACK_CHAIN` env (JSON array of `{provider, model}`); default is `[{"provider":"openai","model":"gpt-4o-mini"}]`. OpenAI sits in a separate rate-limit pool from Claude.
3. **On final failure** — sleep 35s, retry primary once
4. Returns the result with a `tried` array describing which providers/models were attempted

Each per-artifact diagnostic now records `ai_chain`, `ai_fell_back`, `ai_final_provider`, `ai_final_model` so the SQL audit can see fallback frequency:

```sql
SELECT
  intake_id,
  raw_payload->'extraction_result' AS extraction
FROM staged_intake_items
WHERE raw_payload->'extraction_result'->'diagnostics'->0->>'ai_fell_back' = 'true';
```

Required env: `OPENAI_API_KEY` in Vercel. Override the chain with `AI_EXTRACTION_FALLBACK_CHAIN='[{"provider":"openai","model":"gpt-4o"}]'` to use a different fallback model.

Also: text/plain artifacts (email-body intakes) are capped at 80K chars vs 200K for PDFs — most flyer emails have all the deal data in the first 30-50K chars; the rest is signature blocks and forwarded thread history that burns tokens for no extraction value.

## Field-level data provenance (Phase 1, 2026-04-25)

LCC Opps now has three artifacts that observe every cross-table field write to curated tables:

- **`field_provenance`** — append-only log keyed on `(target_database, target_table, record_pk_value, field_name)`. Records source, confidence, source_run_id, decision (`write|skip|conflict|superseded`).
- **`field_source_priority`** — per-field source ranking. Lower priority = higher trust. Seeded with rules like `county_records` (10) beats `om_extraction` (50) for `dia.properties.address`; `om_extraction` (30) beats `costar_sidebar` (70) for `dia.leases.rent`. `enforce_mode` is `record_only | warn | strict` for gradual rollout (today: all `record_only`).
- **`lcc_merge_field()`** — single SQL function that records provenance and returns the decision. Application write paths consult the decision; in record_only mode UPDATEs still run unchanged.
- Views: `v_field_provenance_current` (latest authoritative per field), `v_field_provenance_conflicts` (open same-priority disagreements pending review).

Currently instrumented: OM intake promoter (Phase 2.1). Pending: CoStar sidebar, CMS sync, county records sync, manual edits, Salesforce.

See `docs/architecture/data_quality_self_learning_loop.md` for the Phase 1-4 rollout plan and `supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql` for the schema.

## Junk-value filters (sidebar parser defense)

`api/_handlers/sidebar-pipeline.js::upsertDomainLeases` has an `isJunkTenant()` filter that rejects bad tenant names BEFORE writing to `leases`. It catches:

- Demographics (`population`, `median age`, `daytime employees`, `traffic vol`)
- Street name fragments (`Foo Ave N`, `Bar St SW`)
- OM table-of-contents headers (`Loan`, `Financials`, `Changes`, `Recent Changes`, `Investment Highlights`, etc.)
- NAICS sector names (`Health Care and Social Assistance`, `Retail Trade`, etc.)
- CoStar UI labels (`Smallest Space`, `Max Contiguous`, `Office Avail`, `Retail Avail`, `Tenancy`, `Owner Occupied`, `Rent`, `Service Type`, `For Lease at Sale`)

When extending: keep the regexes anchored `^...$` so legitimate tenant names containing these words aren't false-positived (e.g., "First National Bank" is fine; bare "Financials" is not).

## Dialysis `v_sales_comps` — `rent` semantics

As of `supabase/migrations/20260416120000_v_sales_comps_projected_rent.sql`,
the dialysis `v_sales_comps` view returns rent *projected to CURRENT_DATE*,
not Year-1 base rent. Consumers need to know:

- `rent` — current rent, escalated from the anchor (property `anchor_rent` when
  `anchor_rent_source IN ('lease_confirmed','om_confirmed')`, else
  `leases.annual_rent`) through `properties.lease_bump_pct` /
  `lease_bump_interval_mo`. Projection math lives in
  `api/_shared/rent-projection.js` (`projectRentAtDate`) and is mirrored in
  SQL by the `public.dia_project_rent_at_date()` helper.
- `base_rent` — the Y1 `leases.annual_rent` figure (what `rent` used to be).
  Render it as a secondary value when you need to show the unescalated rent.
- `rent_per_sf` — projected rent / `leases.leased_area`, NOT the Y1 figure.

Downstream writers that still need Y1 rent should pull `base_rent`. The
current dialysis.js Sales Comps loader (`loadDiaSalesCompsFromTxns`) bypasses
the view and assembles rows from `sales_transactions` + `leases` directly, so
it continues to show Y1 rent until switched over to the view.
