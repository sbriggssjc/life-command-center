# Error triage — 2026-08-01 (morning error wave)

Five signals came in together and are connected. Most trace to two roots: (a) the app-boot crash (already
fixed), and (b) broken connector / field-priority infrastructure that *also* explains the cap-rate error and
the empty deal spine. This is the single most useful diagnostic pass we've had — the failures are a map of the
exact connection work we've been designing.

## 1. Boot Check failed — main (766df77): app won't boot
**Diagnosis:** the duplicate `invokeExtractionAI` import — the PR #1549 merge concatenated two whole copies of
`dossier-generator.js`. **Status: FIXED** in commit `1aae4e20` (truncated to 551 lines; `node --check` passes).
**Action:** confirm a deploy that includes `1aae4e20` boots (766df77 predates the fix).

## 2. Daily DB Checks failed — main (44fbf9e): field_source_priority schema drift (Issue #710)
**Diagnosis:** the field-source-priority ramp registers `folder_feed_bov` / `folder_feed_master` rules
(priority 9999) against columns that **don't exist** on `available_listings`, in **both dia and gov**:
`asking_cap`, `asking_price`, `listing_price`, `original_price`, `sold_cap_rate`, `last_price_change`
(+ `gov.sold_price`). Real columns include `initial_price`, `cap_rate`, `current_cap_rate`, `initial_cap_rate`,
`last_price`, `price_change_date`, `sold_price` (dia), `asking_cap_rate` (gov).
**Impact — a cap/pricing ROOT CAUSE:** our *authoritative* OM/BOV pricing feeds (`folder_feed_bov` = BOV
ingest, `folder_feed_master`) can't write asking price/cap because the target columns are wrong, so the OM
asking ($15,729,896 @ 6.00%) doesn't reliably land and the wrong CoStar/calc value (6.46%) wins. Fixing the
ramp is **upstream** of the cap-rate correction (prompt 01).
**Action:** prompt 09 — remap the rules to the real columns (nearby-column hints) or delete dead rules.

## 3. Twenty Power Automate flows failing (past week): the deal-spine connectors are DOWN
The digest names the exact flows that connect SF / Outlook / Sharefile:

| Flow | Failures | What it means |
|------|---------:|---------------|
| Http -> Get file (**LCC Get Artifact**) | **685** | artifact/OM download failing en masse (documents, dossier storage reads) |
| **SF Deal -> LCC Opportunity Sync** | **74** | the Salesforce Opportunity -> LCC sync — **why 35724 has no SF Opportunity / parties** |
| LCC - Outlook Intake to Teams (Hardened) | 30 | Outlook intake failing |
| Http -> Get Account/Contact records | 16 | account/contact resolution failing |
| LCC Processing Complete -> Move Message | 9 | intake housekeeping |
| RCM_Power_Automate | 7 | |
| SF Listing Activity -> LCC engagement | 7 | listing activity -> engagement |
| LCC List Folder (SharePoint) | 5 | Sharefile/SharePoint folder listing (documents) |
| Outlook Deal Thread Search | 4 | **the correspondence connection** |
| LCC — SF File Discovery | 3 | SF deal-room documents |

**Impact:** the "empty parties / no correspondence / no documents" on the deal dossier is **not just unbuilt —
the connectors are actively failing.** The connection design (prompts 02/06 + the packet contract) is right,
but the immediate blocker is broken flows.
**Action:** prompt 10 — triage + fix the failing flows, starting with **SF Deal -> LCC Opportunity Sync** and
**LCC Get Artifact**. This is the concrete mechanism behind prompt 02.

## 4. Comps pulling: engine OK, connector/agent reach broken
- **Claude Northmarq (Briggs CRE):** correctly refused to fabricate; had **no Supabase/LCC connector** in that
  chat and asked for a CoStar/SF export or an LCC Comps Generator run (good discipline — dialysis comps must
  come from the LCC engine or a real export, never web/general knowledge).
- **Copilot LCC Deal Agent:** failed to connect (Work IQ MCP), then **"An error has occurred. Error code:
  ConnectorOperationNotFound."**
- **Engine check (this session):** `mcp__LCC__query_comps` **works** — it returned a full comp set, so the
  Supabase comps engine is healthy. BUT it returned ~1.1M characters (32k lines) — an unbounded/unfiltered dump
  (the filter/limit did not visibly apply).
**Impact:** comps generation isn't broken at the engine; it is (a) **not reachable** from the field agents
(connector not registered / `ConnectorOperationNotFound`), and (b) **returns unusable volume** when reached.
**Action:** prompt 11 — register/repair the LCC comps action for the agents + **bound the output** (a targeted
comp set for the requested market, not the universe).

## Design / architecture implications
- **Field-source-priority is a foundation.** When the priority ramp drifts from the schema, authoritative
  feeds silently fail and the wrong source wins — exactly the 6.46% cap. The daily audit *catches* drift;
  it should alert louder and, ideally, block the ramp from shipping rules that don't match live columns. Add a
  discipline that **our own OM/BOV asking wins for our own listings.**
- **The deal spine is a set of PA flows, and they're failing.** Sequence corrected: **fix the flows (10)** ->
  **schema/packet (06)** -> **the dossier fills (02 verifies)**. Prompt 02 is reframed to sit on top of 10.
- **Observability gap.** 685 failures on one flow surfaced only in a weekly digest. The LCC app should surface
  connector/flow health (tie into Daily DB Checks) so failures don't accumulate silently for a week.
- **Agent connector reach.** The comps engine works but the field agents (Claude Northmarq, Copilot LCC Deal
  Agent) can't reach it. The LCC MCP/connector must be **registered + discoverable** in those surfaces with
  **bounded** outputs — otherwise brokers fall back to manual/again-fabricate territory.
- **A single "LCC health" surface** would connect all of this: PA flow failures, DB-check annotations,
  schema-drift, and connector reachability in one place (a candidate app panel + a good Ollama-summarized daily
  health digest).

## New queue items (drafted into docs/claude-code/prompts/)
- **08** — Deal-tab UI (the deal-surface layout; design was ready).
- **09** — field_source_priority schema-drift fix (#710) — unblocks OM/BOV pricing writes.
- **10** — PA flow failures triage/fix (SF Opportunity Sync, LCC Get Artifact, Outlook thread, SF File
  Discovery, SharePoint) — the real deal-spine connectors.
- **11** — comps connector reach + bounded-output fix (ConnectorOperationNotFound + 1.1M-char dump).

See `DOSSIER-PROGRAM-STATE-OF-PLAY.md` and `docs/claude-code/STATUS.md`.
