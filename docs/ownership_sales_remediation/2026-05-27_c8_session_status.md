# Ownership & Sales Remediation — 2026-05-27 Session Status (C8)

Picks up after PR #951 (B8 Data Health dashboard tile, merged + deployed). Focus this round: **C8 — RCM/LoopNet auth fix**.

## What the investigation found (and why the framing was wrong)

The original plan described C8 as "Power Automate flow currently 401ing on the marketing_leads ingest so 0 RCM/LoopNet inquiry leads are landing" — a small Power Automate header tweak. Diagnostic queries said otherwise:

| Source | Total rows | Last 7d | Last 30d | Most recent |
|---|---:|---:|---:|---|
| `rcm` | 73 | 3 | 30 | 2026-05-22 (5d ago) |
| `loopnet` | **0** | 0 | 0 | — |

**RCM is actively landing leads.** The 401-symptom framing was stale (from before the webhook auth fix landed in `api/sync.js::authenticateWebhook`, which is now in production).

`ingest_write_failures` on LCC Opps shows **zero 401s** on any `lead`/`rcm`/`loopnet`/`marketing_leads` path.

The `lead-ingest` Edge Function health check returns green:
```
{
  "dia_configured": true,
  "webhook_secret_configured": true,
  "marketing_leads_accessible": true
}
```

A probe POST to `/lead-ingest?action=loopnet` with a synthetic email body returned **`201 Created`** and successfully created both a `marketing_leads` row and a matched `salesforce_activities` Task — proving the server-side path is fully functional.

## Real root cause

`.github/PA_FLOWS.md` had **Flow 3 mis-scoped**: it described "Live Listing Ingest (LoopNet/CoStar)" as a scheduled daily job that ingests new listings from saved search criteria. But the underlying handler (`api/sync.js::handleLoopNetIngest` → Edge Function `lead-ingest?action=loopnet`) is built to parse **inbound inquiry emails** — completely different semantics, different trigger, different payload shape.

A PA flow built from the old doc would never have populated `marketing_leads` correctly even if it were running. And RCM — which *is* working — was undocumented in PA_FLOWS.md entirely.

So: **no code or auth bug. Doc gap.**

## What landed this session

Rewrote `.github/PA_FLOWS.md` flows section:

- **Flow 3 — LoopNet Inquiry Email Ingest (marketing_leads)** — full rewrite. Correct trigger (Outlook new email in `Inbox/Property marketing/LoopNet`), correct purpose (parse inquiry email body into a lead row), correct endpoint, full request-payload spec, full parser-field map (what labels the parser looks for in `raw_body`), step-by-step Power Automate build instructions, PowerShell `Invoke-RestMethod` verify recipe.

- **Flow 4 — RCM Inquiry Email Ingest (marketing_leads) — NEW.** RCM's flow was undocumented despite being the working reference implementation. Now documented as the canonical pattern, with the inline-format note (RCM's `Html_to_text` collapses to one line; parser has a regex specifically for that). Verify recipe included.

- **Flow 5 — Live Listing Ingest (LoopNet/CoStar saved searches)** — kept the old scheduled-daily-listing description (which had value) but renumbered and clarified it points at `/api/live-ingest` (not `/api/loopnet-ingest`) so the two paths can't be conflated again.

## What the user needs to do

The fix is **build the LoopNet Power Automate flow per the new Flow 3 spec**. Steps are documented end-to-end. After the flow is enabled and at least one LoopNet inquiry email arrives, watch for:

```sql
select * from dia.marketing_leads
where source='loopnet' order by ingested_at desc limit 10;
```

Or watch the Domain Health Summary tile (B8) — `marketing_leads` rollup will become visible once any LoopNet rows land.

## Plan status

- ✅ **DONE** (24, ↑1): F1-F4, C1, C2, C3 (N/A), C4, C6, **C8 (this round)**, B8, B1, B2, B4, B5, B7, A1, A2, A3, A4 (partial), A5, A6, A7
- ⬜ **TODO** (8, ↓1): C5, C7, C9, B3, B6, A4b, A8, A9

## Audit-log inventory (LCC Opps)

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 31 | C8_loopnet_pa_flow_docs_2026_05_27_001 | all | 0 (doc-only) |

## Files changed

| File | Change |
|---|---|
| `.github/PA_FLOWS.md` | Flow 3 rewrite, Flow 4 add, Flow 5 renumber |

No code changes. No migrations. No new cron workers.

## Symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur |
| Missing many elements of a sales transaction | ⏳ MEANINGFUL PROGRESS, visible in B8 tile |
| Ownership history not in unison | ✅ FIXED + auto-close trigger + visible |
| RCM/LoopNet 401ing → 0 leads landing | ⏳ **RCM is fine (73 rows / 3 last 7d)**; **LoopNet needs the user to build the PA flow** per Flow 3 spec |

## Recommended priorities for next session

1. **A4b — deed-records orphans research** (232 dia + 88 gov true orphans — needs investigation pass; mix of federal bleed-through, legacy imports, genuine orphans)
2. **C5 — EXCLUDE constraint hardening** (formalize what A6a's trigger enforces de facto; structural protection)
3. **C9 — standard ingest contract** (long-term anti-regression — CI check that audits writers against a contract)
4. **B6 — provenance review queue staffing**
