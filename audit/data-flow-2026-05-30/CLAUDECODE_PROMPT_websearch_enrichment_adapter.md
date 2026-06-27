# Claude Code (life-command-center) — build the web-search enrichment service (unlock high-value contact acquisition)

## Why (the high-value outreach unlock, verified live 2026-06-26)

The outreach chain is now proven end-to-end: the owner-contact-enrich worker
returns 200 (auth fix #1355), attaches contacts, seeds value-gated cadences
(#1353), and they surface in the work-surface (#1352). BUT the free-attach owners
are low-value (88 owners; only 2 ≥ $500k, 1 ≥ $1M, top $1.52M). **The high-value
owners — 357 contactless owners worth ≥ $1M, up to ~$27M — are gated on external
enrichment**: in the worker they fall to `sos_manager_lookup` /
`address_reverse_lookup`, which are unconfigured, so they queue to manual research.

The LCC-side adapter is ALREADY BUILT and safe: `api/_shared/web-search-enrich.js`
(`buildWebSearchAdapter` / `extractPrincipalCandidates`) does deterministic,
role-cue-anchored extraction (managing member / registered agent / manager /
principal / member), guards every candidate to a plausible human name
(`looksLikePersonName` + `isImplausiblePersonName`), drops the owner-firm name,
and requires a labeled hit (no snippet name-grabbing, no LLM, no hallucination).
**Confident match ⇒ attach (worker guards re-apply); no confident match ⇒ manual
worklist.** It just needs its deferred `search()` fetcher wired to a real service.

**Leverage:** the worker's enrichment chain runs web-search as **step 5 — the
catch-all after the routed sos/address/deed adapters** (owner-contact-enrich.js
~line 236). So configuring web-search alone catches ALL contactless enrichment
types (sos + address + deed + web), not just web_search-typed rows. One adapter
unlocks the whole 357 high-value set (and the broader ~3,520 tail over time).

## The contract (already fixed on the LCC side — match it exactly)

`webhookFetcher('OWNER_ENRICH_WEBSEARCH_URL')` (owner-contact-enrich.js:69) POSTs:
```
POST <OWNER_ENRICH_WEBSEARCH_URL>
content-type: application/json
body: { "args": [ "<query string>", <row object> ] }
```
and expects the JSON response to be a **result array** the parser consumes:
```
[ { "title": "...", "snippet": "...", "url": "..." }, ... ]
```
(`buildWebSearchAdapter`'s `search(query, row)` returns exactly this list;
`extractPrincipalCandidates` does the rest.) The query is already composed by the
adapter: `"<owner_name> <state> <notice_city> manager managing member registered
agent"`. **The service does NOT parse names or call an LLM** — it just runs a web
search on `args[0]` and returns the top ~10 normalized results.

## Unit 1 — the search-proxy edge function

Build `supabase/functions/owner-contact-websearch/index.ts` (Deno, LCC Opps —
the docai-ocr / SHAREPOINT-wrapper pattern):
- `POST` `{args:[query, row]}` → run a web search on `query` → return
  `[{title, snippet, url}]` (top ~10; map the provider's fields). `GET` = health
  probe (`{ready, configured}`, no spend).
- **Search backend — free-tier first** (Scott's free-over-paid preference): use
  **Brave Search API** (free tier ~2,000 queries/mo, simple JSON: `web.results[]`
  → `{title, description→snippet, url}`) keyed on `BRAVE_SEARCH_API_KEY`. (Serper.dev
  is a fine alternative — `organic[]` → `{title, snippet, link→url}` — pick one,
  make the provider a small switch.) 357 owners + retries fits the free tier.
- **Auth:** `webhookFetcher` sends NO auth header (only content-type), so either
  (a) gate the function on a shared secret carried in the configured URL query
  (`OWNER_ENRICH_WEBSEARCH_URL=…/owner-contact-websearch?key=<secret>`), checked
  in the handler, and deploy `--no-verify-jwt`; OR (b) add an optional
  `x-webhook-key` header to `webhookFetcher` from an env and check it. Prefer (a)
  — no change to the shared fetcher. Document which.
- Resilient: provider error / rate-limit / empty → return `[]` (the adapter then
  returns `no_confident_match` → manual worklist; never throws into the worker).
  Cap results, ~8s timeout.

## Unit 2 — tests + activation

- Unit-test the field-mapping (provider JSON → `[{title,snippet,url}]`) and the
  empty/error → `[]` path. The LCC-side parser already has its own tests — don't
  duplicate; just prove the proxy returns the shape the parser expects.
- `node --check`; suite green; no new api/*.js (the edge function is not an
  api/*.js); no migration.
- **Activation (Scott + Cowork, post-merge):** Scott provisions the free Brave
  (or Serper) API key; Cowork deploys the edge function (Supabase MCP) and Scott
  sets `BRAVE_SEARCH_API_KEY` (function secret) + `OWNER_ENRICH_WEBSEARCH_URL`
  (Railway env, incl. the `?key=` secret). Until then the adapter stays
  `unconfigured` (exact current behavior — deploy-order safe).

## Verify live (Cowork, after activation)

Fire `lcc_cron_post('/api/owner-contact-enrich-tick?limit=25', …)` and confirm:
the web-search step returns results for a real high-value owner, the parser
extracts a labeled principal (or abstains → manual), the worker attaches a
guard-passed contact, a value-floor owner gets a seeded cadence, and a ≥$1M owner
appears in the work-surface focus session — top value climbing from ~$598k toward
the $1M+ owners. Spot-check a couple of attached names against their source URL to
confirm the role-cue extraction is correct (no wrong-person attaches).

## Boundaries

- The LCC parser/guards/confidence are DONE — do not rebuild or loosen them
  (the discipline: labeled-role cue required, human-name guarded, no LLM, no
  guess-attach). The edge function is ONLY a search proxy.
- Free-tier provider; resilient to provider failure; reversible (each attach is a
  person entity + relationship + pivot pointer; unset the env to disable).

## Documentation

Update life-command-center CLAUDE.md: the web-search enrichment service
(`owner-contact-websearch` edge fn) behind `OWNER_ENRICH_WEBSEARCH_URL` — a thin
free-tier search proxy returning `[{title,snippet,url}]`; the existing
`web-search-enrich.js` parser does the labeled-role extraction + guards; it's the
worker's catch-all step so it covers all enrichment_action types; activation =
Brave/Serper key + the two envs.

## Bottom line

One thin search-proxy edge function lights up the already-built, already-safe
web-search enrichment adapter — the worker's catch-all step — turning the 357
high-value contactless owners into guard-checked contacts → value-gated cadences →
workable focus cards. This is the actual high-value payoff of the whole outreach
build-out.
