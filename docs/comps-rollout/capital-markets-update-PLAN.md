# Capital Markets Report — One-Prompt Automation Plan

**Scope:** Dialysis Market Filter (now) → Government Market Filter (next) → all net-lease swimlanes (future)
**Author:** Prepared for Scott Briggs · August 2026
**Companion files:** `capital-markets-update-SKILL.md` (drop-in skill), `comps-engine-SKILL.md` (deal-level comps)

---

## 1. What this session proved
The Q1 2026 copy edits were generated **without the Excel export**. Every figure came straight from the
`cm_dialysis_*` views in the Dialysis DB (`zqzrriwuavgrquhisnoa`), pinned to `period_end = '2026-03-31'`, and
reconciled to the chart callouts marketing had already built ($0.83B TTM volume, ~191 TTM count, ~6.9% TTM cap,
$4.4M TTM deal size, 142.2 valuation index). The database layer for full automation **already exists** — the
May 2026 build that created `cm_view_registry`, `cm_period_anchor`, and the ~70 `cm_dialysis_*` views did most
of the work. What's missing is a thin orchestration layer and four data fixes.

## 2. Gaps observed (each cost a manual step or a [CONFIRM] flag this cycle)

| # | Gap | Symptom this cycle | Fix |
|---|-----|--------------------|-----|
| G1 | **No as-of snapshot.** Views compute live; listings data drifts after quarter-end. | Draft's On-Market table (273/6.84%/511 DOM) no longer matches live (292/6.83%/470); KPI views returned Q2/Q3 2026 windows. | Quarterly `cm_report_snapshots` freeze (§4). Charts and copy come from the same frozen packet. |
| G2 | **Snapshot-only views have no history.** `cm_dialysis_available_by_tenant` / `_by_term_bucket` return current-day only. | Couldn't reproduce the 3/31 by-tenant table; had to trust the draft. | Add `period_end`-keyed variants or fold into the G1 snapshot job. |
| G3 | **10Y UST is quarter-average, not quarter-end close.** `cm_dialysis_macro_rates_q` averages dailies. | Copy says "~4.20% (quarterly avg)" + [CONFIRM] flag. | Add `treasury_10y_close` column (last obs of quarter) to the macro view. |
| G4 | **10+ yr seller sentiment under-sampled** (`n_long_term` = 3–5; nulls). | Page 45 core read is qualitative only. | Widen the core cohort window server-side (trailing 8 quarters) and label it. |
| G5 | **Historical restatement not versioned.** Expanded capture restated TTM volume $497M → $765M at YE25. | Manual "restated series" disclosure decision. | Snapshot table (G1) freezes each edition; add a `restatement_note` the skill surfaces when a frozen prior-edition figure differs >5% from live recompute. |
| G6 | **Value-prop thin-sample rule is manual.** Q1 NM TTM printed 8.77% on a tiny sample. | Tiles/chart/letter diverged in the draft. | Encode server-side: packet returns `value_prop.basis_period` = latest TTM with NM n ≥ 15, plus sample counts. |

## 3. Target architecture — three layers, one prompt

```
TRIGGER   Quarterly (2 wks after quarter-end): Power Automate → Teams card:
          "Q2-2026 packet frozen — attach marketing draft PDF and run /capmarkets-update"
DATA      LCC MCP server (Railway): get_capmarkets_packet(vertical, quarter)
          → freezes (or retrieves) cm_report_snapshots row
          → returns ONE JSON packet: every page's figures, comparatives, long-run stats, samples, flags
COPY      Claude + capital-markets-update skill: "Update the Dialysis Market Filter for Q2 2026" + draft PDF
          → skill calls the tool, writes page-by-page copy in 4Q2025-final style, emits the marketing email
            with [CONFIRM] flags auto-generated from the packet
```

## 4. Build spec

### 4a. Snapshot table (Dialysis DB, migration)
```sql
CREATE TABLE cm_report_snapshots (
  snapshot_id    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vertical       text NOT NULL,            -- 'dialysis' | 'government' | future swimlanes
  fiscal_quarter text NOT NULL,            -- 'Q2-2026'
  period_end     date NOT NULL,
  packet         jsonb NOT NULL,           -- full page-keyed figure packet
  frozen_at      timestamptz DEFAULT now(),
  frozen_by      text,                     -- 'auto' | user
  UNIQUE (vertical, fiscal_quarter)
);
```
Freeze job queries every registered view in `cm_view_registry` for the anchor `period_end`, assembles the
packet, inserts. Idempotent — re-runs return the frozen row, never recompute.

### 4b. Packet shape (page-keyed, mirrors the report)
```jsonc
{
  "vertical": "dialysis", "quarter": "Q1-2026", "period_end": "2026-03-31",
  "comparatives": { "prior_q": "2025-12-31", "year_ago": "2025-03-31" },
  "pages": {
    "p19_volume_caps": { "ttm_volume": 834142290, "ttm_count": 191, "yoy_pct": 0.624,
                          "cap_ttm": 0.0694, "cap_uq": 0.0742, "cap_lq": 0.0613 },
    "p27_cost_of_capital": { "ust_10y_close": null, "ust_10y_avg": 0.0420,
                             "loan_constant_low": 0.0719, "loan_constant_high": 0.0750 },
    "p54_value_prop": { "basis_period": "2025-12-31", "basis_reason": "latest TTM with NM n>=15",
                        "nm_cap": 0.0670, "non_nm_cap": 0.0733, "addl_proceeds": 265788, "nm_n": 22 }
  },
  "flags": [ {"page": "p43", "type": "series_basis", "msg": "…"},
             {"page": "p45", "type": "thin_sample", "msg": "core n=3"} ],
  "restatement": { "vs_prior_edition_pct": 0.54, "note_required": true }
}
```
Flags are generated by code rules (thin samples n<10, null series, close-vs-average rates, >5% restatement), so
the [CONFIRM] list is deterministic.

### 4c. MCP tool on the LCC server
`get_capmarkets_packet({ vertical, quarter })` → freeze-or-fetch → return packet. One tool, both verticals, all
future swimlanes; the `vertical` column already exists in `cm_view_registry`.

### 4d. Data fixes
G2 (period-keyed tenant/term views), G3 (`treasury_10y_close`), G4 (core sentiment window), G6 (value-prop
basis selector) — each a small view change.

## 5. The skill
`capital-markets-update-SKILL.md` drops into the lcc-deal-intelligence plugin alongside `comps-engine`. It
encodes the trigger phrases, the packet call, the 4Q2025-final style guide, the never-copy-forward rule, flag
rendering, and the single-markdown output contract. Until the MCP tool ships, its fallback mode queries the
`cm_*` views directly with a pinned `period_end` — usable today.

## 6. Government Market Filter path
1. The gov DB (`scknotsqkcheojiaewwh`) has `capital_markets_quarterly` with the same column families. Build
   `cm_gov_*` views mirroring the dialysis set — copy-adapt, swap the tenant taxonomy (federal/state/municipal,
   lease-number joins), add government pages (agency credit, OPM workforce, FRPP occupancy).
2. Register them in `cm_view_registry` with `vertical='government'`.
3. The same MCP tool and skill then serve the Government Filter with zero new orchestration.
4. Every additional swimlane = a registered set of views.

## 7. Ready-to-paste Claude Code prompt
```
Repo: life-command-center
Build the Capital Markets Report packet layer (dialysis first, government-ready).
1. Migration (Dialysis DB zqzrriwuavgrquhisnoa): create cm_report_snapshots
   (vertical, fiscal_quarter, period_end, packet jsonb, frozen_at, frozen_by;
   UNIQUE(vertical, fiscal_quarter)).
2. View fixes:
   a. cm_dialysis_macro_rates_q: add treasury_10y_close = last daily observation
      on/before period_end (keep the existing average column, relabel it _avg).
   b. Create cm_dialysis_available_by_tenant_q and _by_term_bucket_q keyed by
      period_end (reconstruct from listing history like cm_dialysis_on_market_snapshot_q).
   c. cm_dialysis_seller_sentiment_q: add pct_price_change_long_term_8q — the core
      price-change rate over a trailing 8-quarter closing window, with n.
3. New module api/_handlers/capmarkets-packet.js:
   buildPacket(vertical, quarter): read cm_view_registry for the vertical, pull each
   registered view at the anchor period_end plus prior_q and year_ago comparatives and
   long-run stats (avg, max+date), assemble a page-keyed JSON packet. Include a
   value_prop block that selects the latest TTM period where NM sample n >= 15 and
   reports basis_period + basis_reason + sample counts. Generate flags[]: thin_sample
   (n<10), null_series, rate_basis (close missing → average used), restatement (frozen
   prior-edition figure vs live recompute differs >5%). Freeze-or-fetch semantics
   against cm_report_snapshots — never recompute a frozen quarter.
4. Register MCP tool get_capmarkets_packet({vertical, quarter}) on the LCC MCP server
   (life-command-center-production.up.railway.app), same auth pattern as query_comps.
   Return the packet plus a compact markdown figure table.
5. Cron: Railway scheduled job, 14 days after each quarter end, calls buildPacket for
   every distinct active vertical in cm_view_registry and posts a Teams card via the
   existing Power Automate webhook.
Do not modify any cm_dialysis_* view semantics beyond the three fixes above — the
report copy pipeline depends on their current definitions.
```

## 8. Claude vs. local Ollama
Use Claude for the copywriting pass (style fidelity, flag reasoning, value-prop methodology — runs once a
quarter, cost trivial). Use a local model / plain Python for the **deterministic QC pass**: re-read the emitted
email, extract every bolded figure, diff it against the frozen packet. Claude writes; the checker verifies.

## 9. Quarterly runbook (replaces SOP Steps 1–6 once built)
1. Teams card arrives: packet frozen. (Auto)
2. Download marketing's draft PDF.
3. Prompt: *"Update the Dialysis Market Filter for Q# YYYY"* + attach the draft PDF.
4. Review the email's flag section — everything else is verified against the frozen packet.
5. Send to marketing.

**Interim (before the MCP tool ships):** the same prompt works today — the skill's fallback queries the `cm_*`
views directly with a pinned `period_end`. The only thing lost until G1 lands is the freeze guarantee, so run
the update within ~2–3 weeks of quarter-end while listing drift is small.
