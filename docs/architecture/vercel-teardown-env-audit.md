# VERCEL-LIVE1 — environment-variable audit before the Vercel project is deleted (2026-09-18)

**Source:** Scott's screenshots of `vercel.com/scottbs-projects/life-command-center/settings/environments/production`
(five screens, names only — values never left the dashboard). The dashboard truncates long names (`SO…ET`), so
each is matched here against the names the current `main` actually reads (`process.env.X` across `server.js`,
`api/`, `mcp/`, `scripts/`, `lib/`, `supabase/functions/`, plus `bov-generator/`, `resolver/`, `pipeline/`).
**The screenshots skip the block between `FOLDER_FEED_…` (Jun 11) and `INTAKE_EXTRACTION_ENABLED` (Apr 20)** — that
gap is unaudited; Scott to scroll it once more before deleting.

## What to do with it

1. On Railway (`tranquil-delight` service **and** the standalone MCP service), confirm every name in **column A is
   set**. Anything missing there is the one thing deletion would lose. Compare names, not values.
2. Column B needs no action — the current code never reads it (retired features, Vercel-only build settings, or
   names that belong to another service).
3. Column C (ambiguous) — open the variable on Vercel to read the full name, then place it in A or B.
4. Then: Vercel → Project → Settings → General → **Delete Project** (or pause deployments first if you want a day
   of "nothing broke"). `life-command-center-nine.vercel.app` stops answering; the stale client dies with it.

## A — read by current code on `main` (must exist on Railway)

| Vercel name (as shown) | resolves to | read by |
|---|---|---|
| `MOVE_QUEU…EXECUTOR` | `MOVE_QUEUE_EXECUTOR` | api |
| `SO…ET` | `SOS_PROXY_CF_ACCESS_CLIENT_SECRET` | api (SoS proxy) |
| `SOS_PROXY…LIENT_ID` | `SOS_PROXY_CF_ACCESS_CLIENT_ID` | api |
| `SO…EN` | `SOS_PROXY_TOKEN` | api |
| `CF…ET` / `CF_ACCESS…LIENT_ID` | `CF_ACCESS_CLIENT_SECRET` / `CF_ACCESS_CLIENT_ID` | api (Cloudflare Access to the on-box services) |
| `AI_EXTRAC…_PRIMARY` | `AI_EXTRACTION_PRIMARY` | `api/_shared/ai.js` |
| `MAILBOX_MIRROR`, `W74_ROLE_ISSUES`, `W75_ACTION_SUMMARY` | same | api intake / action summary |
| `TAGGED_CO…_ENABLED` | `TAGGED_COMM_INTAKE_ENABLED` | api |
| `DEAL_COMM…_ENABLED` / `DEAL_EMAI…_ENABLED` | `DEAL_COMMS_PROPAGATE_ENABLED` / `DEAL_EMAIL_MATCH_ENABLED` | api |
| `RESOLVER_URL`, `ORE_USE_RESOLVER` | same | api (owner resolver) |
| `BOV_SERVICE_URL`, `BO…EN`, `BO…EY` | `BOV_SERVICE_URL`, `BOV_BRIDGE_TOKEN`, `BOV_API_KEY` | api (BOV bridge) |
| `LCC_PRIMA…SPACE_ID` | `LCC_PRIMARY_WORKSPACE_ID` | api |
| `MCP_BASE_URL` | same | api |
| `CE…EY` | `CENSUS_API_KEY` | api |
| `OLLAMA_URL`, `OLLAMA_MODEL` | same | `api/_shared/ai.js` (on-box path) |
| `OUTLOOK_S…HOOK_URL` | `OUTLOOK_SEARCH_WEBHOOK_URL` | api |
| `SUPABASE_URL`, `SU…EY` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | everywhere |
| `NEXT_STEP_AI`, `CONTACTS_HUB` | same | api |
| `OCR_CLOUD…STRESORT`, `OC…EY` | `OCR_CLOUD_GPT4O_LASTRESORT`, `OCR_CLOUD_OCR_KEY` | api (OCR) |
| `DECISION_…EED_WINS`, `DECISION_…RITEBACK` | `DECISION_OWNER_DEED_WINS`, `DECISION_GOV_WRITEBACK` | api |
| `PA_MOVE_M…HOOK_URL`, `PA_COMPLE…TASK_URL` | `PA_MOVE_MESSAGE_WEBHOOK_URL`, `PA_COMPLETE_TASK_URL` | api (Power Automate callbacks) |
| `PA…ET` | `PA_WEBHOOK_SECRET` (or `PA_OUTLOOK_DRAFT_SECRET` — check) | api / edge auth |
| `SF_LIST_S…TITUTION`, `SF_CONTAC…RITEBACK` | `SF_LIST_SEED_INSTITUTION`, `SF_CONTACT_WRITEBACK` | api |
| `LC…EY` (×2) | `LCC_API_KEY`, `LCC_SERVICE_ROLE_KEY` | api / scripts |
| `AI_CHAT_PROVIDER`, `AI_CHAT_POLICY`, `AI_CHAT_MODEL`, `AI_MODEL` | same | `api/_shared/ai.js` |
| `PORT`, `LCC_ENV` | same | `server.js` |
| `FOLDER_FE…_EXTRACT`, `FOLDER_FE…CH_ROOTS` | `FOLDER_FEED_ASYNC_EXTRACT` / `FOLDER_FEED_LEASE_EXTRACT`, `FOLDER_FEED_ENRICH_ROOTS` | api |
| `INTAKE_EX…_ENABLED`, `TEAMS_COL…_ENABLED` | `INTAKE_EXTRACTION_ENABLED`, `TEAMS_COLD_ALERTS_ENABLED` | api |
| `OP…EY` | `OPENAI_API_KEY` (most likely; also possible `OPENCORPORATES_API_KEY`) | api |
| `MS…EN` | `MS_GRAPH_TOKEN` | api |
| `OPS_SUPAB…ANON_KEY` | `OPS_SUPABASE_ANON_KEY` | api |
| `WEBEX_CLIENT_ID` | same | api |

## B — not read by current LCC code (no action; safe to lose)

`SU…SN` (a DSN — nothing on `main` reads a `*_DSN`), `TIER0_AUTO_ATTACH` (read from `workspaces.config` / DB, not env),
`NIXPACKS_…_VERSION` (Railway build setting, meaningless on Vercel), `SOS_PROXY_URL` (only in a 2026-08 migration
comment), `FR…EY` (`FRED_API_KEY` — the FRED reader is on the Dialysis side / market briefs, not this repo),
`AI_EXTRAC…PROVIDER` (`AI_EXTRACTION_PROVIDER` — only a flag-seed migration mentions it), `RESOLVER_…O_REJECT` /
`RESOLVER_AUTO_LINK` (read by `resolver/app/config.py` — the resolver service's own env, not the web app's),
`RE…EY` ×2 (no `RESEND_*`/`RE*_KEY` read on `main`; open to read the full name), `PA_DEALFO…FILE_URL` (nothing reads
it), `BOV_ALLOW…REVIEWED`, `LCC_OPS_URL`, `PUBLIC_BASE_URL` (read by `bov-generator/*.py` — the BOV service's env,
lives on `pacific-love`), `AI_PROVIDER` (`pipeline/ai_research.py` only), `NODE_OPTIONS` (runtime tuning; set on
Railway if it was doing something — check its value before deleting).

## C — unaudited

The scrolled-past block between Jun 11 and Apr 20, and the two `RE…EY` names.
