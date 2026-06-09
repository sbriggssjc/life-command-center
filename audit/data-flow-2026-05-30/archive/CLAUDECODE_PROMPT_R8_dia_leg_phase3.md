# Claude Code prompt — R8: dia owner-facts leg + Decision Center Phase 3

Paste into Claude Code, run from the **life-command-center** repo. Three
units, ordered; same slice discipline as R7 (each independently shippable,
backward-compatible by construction, verified before the next). Read
`audit/data-flow-2026-05-30/LCC_DECISION_CENTER_DESIGN.md` Phase 3 section
for the doctrine.

## Unit 1 — dia owner-facts leg (close the R6 gap)

R6 shipped tier-0 domain-truth resolution for gov only; dia was deferred. The
infrastructure is ready: `lcc_property_owner_facts` already CHECKs
`source_domain IN ('dia','gov')`, the sync's domain loop already no-ops dia
with a NOTICE, and the resolver/views are domain-agnostic once mirror rows
exist.

- **dia anon view** (dia DB `zqzrriwuavgrquhisnoa`, migration FIRST — the R6
  rule): `v_property_owner_facts_portfolio` mirroring the gov one —
  `property_id, recorded_owner_name, true_owner_name, developer_name` via
  LEFT JOINs to dia `recorded_owners`/`true_owners` (names only, no PII
  contact fields; same grant posture as gov: anon+authenticated SELECT).
  Note dia properties also carry `tenant`/`operator` — do NOT expose those
  here; owner facts only.
- **Extend the sync**: `lcc_sync_property_owner_facts` gains the dia leg
  (vault secrets `dia_supabase_url`/`dia_supabase_anon_key` — same pattern;
  page count sized to dia's ~44k properties, so raise the page loop or
  page-size accordingly and keep the tick time-budgeted; consider 2,000/page).
  The finalize already upserts by domain; keep the ANALYZE.
- **Run it once live** after the view lands; report dia mirror row count.
- **Effects to verify**: dia P0.4 rows gain `resolve_true_owner_name`
  context; any dia entity whose property's true_owner maps to a registered
  buyer parent (Elliott Bay, Sumitomo/SMBC, ExchangeRight, AEI, Realty
  Income, Agree…) flows through tier-0 into P-BUYER; band counts shift —
  report before/after (the byte-identical rule does NOT apply here, this is
  an intended membership change; instead report WHICH entities moved and
  spot-check two).
- Extend `v_lcc_ownership_chain_completeness` to dia (the view is currently
  gov-filtered) and let the chain-research generator cover both domains —
  rent-prioritized merge, same idempotency.

## Unit 2 — Phase 3a: gate-predicate sweep (no premature CTAs anywhere)

R6 fixed the queue's premature "Open opportunity"; the same doctrine must
hold on EVERY surface. Inventory every stage-advancing CTA and make each
read the SAME readiness state the queue/banner use (the priority-band
payload + resolution state — one truth everywhere):

- **Detail page**: "Mark as Lead" / "Add to Pipeline" / "Create the lead"
  next-step banner / "Open opportunity" — each must check the gate:
  unresolved owner → the CTA is "Resolve owner" (not lead/opp); resolved but
  unconnected → "Connect" first; buyer-parent/SPE → the R5 refusal path with
  the Government Buyer alternative. Most of this exists piecemeal — the
  sweep is about consistency: find CTAs that bypass the checks (e.g. the
  fallback-summary panel's "Mark as Lead", search-result actions, contacts
  page actions, inbox "Assign"/"Promote" paths that can create leads).
- **Bulk actions**: "Open top N" already gates; verify any other bulk
  (bulk_assign, bulk_triage) can't advance ungated subjects.
- **Copilot/agent actions** (`api/operations.js` action surface): the same
  gates must apply to create_lead / open_opportunity / initiate_cadence
  invoked via Copilot — verify the RPC-level guards (R5 trigger) cover every
  path, and the agent gets a structured refusal it can relay (not a 500).
- Deliverable: a short table in the PR — every stage-advancing CTA × the
  gate it checks × where the check lives (UI/API/DB). Fix the gaps; the DB
  trigger remains the last line.

## Unit 3 — Phase 3b: automation → decision-lane funnel

Engines that hit ambiguity must emit a decision row (`lcc_open_decision`),
not park work in hidden statuses. Wire these named producers (each small):

1. **Matcher ambiguous hits**: when the intake matcher finds MULTIPLE
   candidate properties above threshold (the multi-candidate case it
   currently parks as unmatched/review), emit `decision_type=
   'match_disambiguation'` with the candidates in context — verdicts: pick
   candidate A/B/… (runs the existing promotion), "none — create property"
   (F4 path), Research. Lane renders like the others (list-federated).
2. **LLC dead-letter rows**: the `LLC_MAX_ATTEMPTS=8` cap now marks rows
   `dead` — each dead row emits `decision_type='llc_research_dead'` (subject:
   owner, context: attempts + last error) — verdicts: "Resolve manually
   (SOS link)" (the existing Research-page action), Retry (reset attempts),
   Park. Keeps dead work visible instead of silent.
3. **Availability-checker bot-blocks**: the `availability_checker_botblock`
   alert exists; mirror it as a decision (subject: domain, context: share +
   sample listings) — verdicts: "Verify top 5 manually →" (deep-link),
   Acknowledge. Auto-supersede when the alert auto-resolves.
4. Confirm the Phase-1 foundation producer (whichever was wired) still
   emits, and document the producer pattern in CLAUDE.md (3 lines: when an
   engine can't decide, call `lcc_open_decision`; sweep auto-supersedes when
   the predicate clears; verdicts ride existing machinery).

Anti-bloat: all three are bounded producers (ambiguous matches are rare;
dead LLC rows are capped; botblock is per-domain singleton) — seeded mode is
fine, with the auto-supersede sweep.

## Verify + ship
- Unit 1: dia mirror populated (report count); two dia tier-0 resolutions
  spot-checked; chain view covers dia; no gov regression (Boyd FGF still
  resolves; ARLINGTON still P0.4).
- Unit 2: the CTA×gate table; one previously-ungated CTA demonstrated
  refusing pre-gate and offering the right prior step.
- Unit 3: one real decision row per producer (use synthetic/live-safe
  triggers; matcher one can be exercised with a crafted two-candidate
  intake), verdict round-trip on one, auto-supersede demonstrated.
- House rules: `node --check`; 12 functions; migrations idempotent, dia view
  BEFORE the sync extension; crons after routes; ANALYZE after bulk loads;
  effect-first/outcome-truthful verdicts; cap context jsonb (ids+scalars).
- Slices: Unit 1 may apply DB-side immediately (cache-or-live pattern);
  Units 2–3 ship on the Railway redeploy. Report per-unit status.
