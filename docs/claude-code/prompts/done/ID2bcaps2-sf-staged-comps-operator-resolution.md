# ID2b-caps-2 — Resolve the Salesforce-staged comps through the operator aliases, and make a duplicate display label impossible

**Repo: `life-command-center`** (owns Dialysis_DB). Finishes ID2b-caps. Small, and the gate is the point.

**Read first:** `docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md` **including the Cowork addendum** ·
`docs/os/PLANNED-BACKLOG.md` §P0d ID2a-cleanup, ID2b-caps, **ID2b-caps-2** · the ID2b-caps migration
(`20260912130000_dia_id2bcaps_rpc_query_comps_operator_id.sql`) · `api/_handlers/market-brief-psql-tick.js`
(`planOperatorCapRateBands`) · `api/_shared/market-brief-facts.js` · `mcp/comps-tools.js` · `CLAUDE.md` Core doctrines.

## Why this, why now (Cowork live dry run, deployed `c5fc261f`, 2026-09-12)

ID2b-caps' passthrough is correct on the arms it covered, and those bands are now id-keyed. But the run returns **five**
per-operator bands, two pairs sharing a display name:

| fact key | label | n |
|---|---|---|
| `cap_rate_ttm_band:5` | Fresenius Medical Care | 63 |
| `cap_rate_ttm_band:fresenius_medical_care` | **Fresenius Medical Care** | 12 |
| `cap_rate_ttm_band:4` | DaVita | 68 |
| `cap_rate_ttm_band:davita_dialysis` | DaVita Dialysis | 10 |

Two bands claiming the same operator with different numbers is worse than the original split, and a broker reading the
brief cannot tell which is right.

**Root cause, measured — a third comp source the passthrough never reached.** The sale and listing arms read dia
`properties`, where coverage is good (every TTM DaVita/Fresenius sale row resolves: DaVita 49, Fresenius 39, Fresenius
Medical Care 1). The leftovers come from **`sf_comp_staging`** — the Salesforce-staged comps, i.e. **Team Briggs' own
closed deals**, the most authoritative comps we have — which has no property link and therefore no `operator_id`. It
holds **196 `DaVita Dialysis`** and **179 `Fresenius Medical Care`** rows, spelled exactly as `dia_operator_aliases`
already maps them (`DaVita Dialysis` → 4, `Fresenius Medical Care` → 5). Nothing resolves them, because the tick's text
fallback never consults the alias table.

## 1. Resolve the SF-staged arm

Pick one and justify it:

- **(a)** Resolve `sf_comp_staging.tenant` through `dia_operator_aliases` inside `rpc_query_comps`'s SF arm, so it
  returns `operator_id`/`operator_canonical` like the other arms. Additive; `tenant` stays byte-identical.
- **(b)** Give `sf_comp_staging` its own `operator_id` column, resolved by the same resolver and protected by the same
  write guard as `properties`/`leases` — which also fixes every other consumer of that table, not just the brief.

**(b) is the source-of-record answer** (`CLAUDE.md`: fix it where the fact is owned, guard the writer) — take it unless
measurement says otherwise, and say what else reads `sf_comp_staging` today. Unresolvable tenants stay text, go to the
existing review lane, and are reported.

## 2. Make the duplicate-label class impossible

Ship the invariant, not just the fix: **two live `market_brief_facts` rows in the same lane and section may never carry
the same display label.** Enforce it where the facts are written (a guard in the fact builder plus a test), so any
future fallback that re-mints a canonical-looking label fails loudly instead of shipping. Add the same check to the
brief's render path if that is a separate surface.

## 3. Re-run the gate — this is the deliverable

Dry-run the tick against the deployed build and paste the full band list. Required:

- one **Fresenius Medical Care** band (63 + 12 = **75**), one **DaVita** band (68 + 10 = **78**), one **US Renal Care**
  band (6), and **no** `cap_rate_ttm_band:<text>` keys for operators that have an id
- whole-market band **n≈169, unmoved**
- the old text-keyed fragments **superseded**, not left live beside the merged bands

If any number differs, report it and stop rather than adjusting the expectation.

## 4. What NOT to do

Don't touch `tenant`/`comp_tenant` text or `operatorTier()` selection. No registry/alias edits beyond what §1 resolves.
Don't flip `MARKET_BRIEF_PSQL` (MB-b's call). Don't edit the ID2b-caps audit doc's original claims — the addendum
stands as the record.

## Guard + ship

Tests: SF-arm resolution fixtures (including an unresolvable tenant), the duplicate-label invariant, supersede of the
text-keyed fragments, and a byte-compare proving existing RPC fields are unchanged. Full suite green. Branch → PR → CI
→ merge → redeploy BOTH Railway services.

## Ship + record

Update `PLANNED-BACKLOG.md` §P0d (ID2b-caps, ID2b-caps-2, MB1e), the audit doc (a second addendum with the passing
gate), `docs/architecture/EXEC-BRIEFS-SPEC.md` §9, `STATUS.md`, `CURRENT-STATE.md`. Report: the resolution path chosen
and why, what else reads `sf_comp_staging`, the full band list from the live dry run, and the review-lane count.
