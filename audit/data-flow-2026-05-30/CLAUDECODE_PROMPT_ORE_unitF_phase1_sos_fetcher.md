# Claude Code (GovernmentProject) — ORE Unit F Phase 1: per-state SOS detail fetcher (framework + FL + AZ PoC)

## Why (root-caused live 2026-06-27)

The high-value contact problem traces to one root: **we don't fetch SOS managers —
we AI-*infer* them ~1 in 5.** `public_record_ingest.py` passes property context +
generic SOS URLs to the LLM and asks it to extract managers, but never fetches the
actual state Secretary-of-State entity detail page. So `entity_registry_records`
has managers for only **1,735 of 8,262 (~21%)**, uniform across states (the
inference ceiling), and the other 6,527 came back with `managers: []`,
`registered_agent: null`, `file_number: null` — fetched context, no principals.
Unit A wired the 21% into the owner records (132 → 1,423 managers, now flowing to
outreach), but those are AI-inferred **candidates**, and the high-value owners are
mostly in the 79% we never fetched.

Scott's decision (2026-06-27): **build the per-state SOS detail fetcher** — fetch
the real managing-member / registered-agent from each state's SOS, the authoritative
source he currently looks up by hand. This Phase-1 slice builds the framework + 2
proof-of-concept states; later phases expand coverage.

## Architecture — `src/sos_detail_fetcher.py` (new module)

A dispatcher + per-state handlers. The entities to enrich carry `entity_name` +
`formation_state` but **`file_number` is NULL** for the empties, so the flow is
**name-search**, not id-lookup:

```
fetch_managers(entity_name, formation_state) ->
  { managers:[{name,role}], registered_agent, registered_agent_address,
    file_number, status, source_url, raw_html, match:'exact|none|ambiguous' }
```
1. Dispatch by `formation_state` to a state handler.
2. State handler: SOS business-entity SEARCH by name → pick the entity (conservative
   match: exact normalized name; **`ambiguous` if >1 candidate — return without
   guessing**; `none` if not found) → fetch its detail page → parse managers/members
   + registered agent (+ agent address) + file_number + status.
3. Return structured; the caller writes it.

## Phase 1 scope — framework + TWO free, manager-listing states

Build the dispatcher + these two handlers (chosen: free, no account, detail pages
that list managers/members + registered agent, high volume):
- **Florida — Sunbiz** (`search.sunbiz.org`): free, no login; detail page lists
  Authorized Persons / Managers (MGR/MGRM) + Registered Agent + address. FL = 425
  entities.
- **Arizona — eCorp** (`ecorp.azcc.gov`): free; lists Members/Managers + Statutory
  Agent. AZ = 477 entities.
(Do NOT build Texas in this phase — SOSDirect requires a paid account; flag it as a
paid-state for a later decision. Note CA bizfileonline as the next free target.)

## Write-back + flow-through (reuse Unit A's path)

For a matched entity, UPDATE its `entity_registry_records` row: `managers`,
`registered_agent`, `registered_agent_address`, `file_number`, `status`, refreshed
`raw_payload` (the SOS detail), `fetched_at`, and a source marker
(`source='sos_direct'` — distinct from the AI-inferred rows so we can tell verified
from inferred). Then the **existing Unit A sync** (`gov_sync_sos_registry_managers`,
daily 03:20) propagates the new managers → `recorded_owners.manager_name` → the
CONTACT-SELECTION signal pull → outreach. Don't rebuild that; just populate the
registry and let it flow. (A verified `sos_direct` manager should also be allowed to
**override** an earlier AI-inferred one for the same entity — higher authority.)

## Re-runnable backfill

A mode that selects `entity_registry_records` rows for the covered states (FL, AZ)
with empty managers, runs `fetch_managers(entity_name, state)`, and fills them.
Idempotent (skip rows already `source='sos_direct'`); resumable; bounded per run.

## DISCIPLINE — non-negotiable (public-records scraping)

- **Respect each site's robots.txt + ToS**; gentle rate-limit (≈1 request / 2-4s,
  serial per host, like the availability-checker), browser-shaped User-Agent,
  retries with backoff.
- **NEVER bypass or solve CAPTCHAs.** If a state gates search/detail with a CAPTCHA
  or bot-block, the handler returns `blocked:'captcha'` and the row is logged + left
  for a different approach — do not attempt to defeat it.
- Fail soft: a fetch/parse error logs and returns `none`/`error` — never crashes the
  ingest pipeline. Per-host failure counters; back off a host that starts blocking.
- Only public business-entity search data; no credentials, no login-walled content.

## Sandbox caveat — fixture-test the parsers

Claude Code's sandbox has no egress to SOS sites, so you can't live-test the
fetchers there. Build the **parsers against saved sample HTML fixtures** (commit 2-3
real Sunbiz + eCorp detail-page HTML samples under `tests/fixtures/sos/`) and
unit-test the manager/agent extraction against them. The live HTTP layer is
validated post-deploy (by Scott or the worker) — same model as the OCR / web-search
adapters. Keep the HTTP fetch and the HTML parse as separate, independently-testable
functions.

## Verify

- `python -c "import src.sos_detail_fetcher"`; `python -m pytest tests/ -x -q`
  (parser unit tests green against the fixtures).
- **Dry-run first** (no writes): run the backfill in report mode over a sample of FL
  + AZ empty-manager rows → report match rate (exact/ambiguous/none/blocked) and a
  sample of (entity → managers found) pairs. Scott eyeballs correctness against a
  couple of real Sunbiz/eCorp pages.
- Then a **capped real backfill** (e.g. 25 FL + 25 AZ) → confirm
  `entity_registry_records` managers populate with `source='sos_direct'`; the Unit-A
  sync then lifts `recorded_owners.manager_name` for those FL/AZ owners; spot-check 3
  against the live SOS page.

## Documentation

Update `docs/OWNERSHIP_RESOLUTION_ENGINE.md` (Unit F) + gov CLAUDE.md: the SOS
detail fetcher (name-search → detail → managers/agent), `source='sos_direct'`
(verified, overrides AI-inferred), Phase 1 = FL + AZ; the ToS/rate-limit/CAPTCHA
discipline; the fixture-test + live-validate model; TX is paid (deferred);
per-state expansion is the follow-on.

## Bottom line

Stop inferring SOS managers and start fetching them. Build the dispatcher + two
free, manager-rich state handlers (Florida, Arizona) end-to-end — name-search →
detail page → real managers/agent → into the registry → through Unit A's sync to the
owner records and outreach. Disciplined (ToS, rate-limit, no CAPTCHA-bypass),
fixture-tested, dry-run-gated. This is the first real slice of fetching authoritative
ownership-control data — the foundation of the whole engine.
