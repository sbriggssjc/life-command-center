
ACI-phase2-unitC — REIT/fund role taxonomy: bench ranking (AC2) + Ollama function inference (AC3)
Read first: docs/architecture/account-based-contact-intelligence.md §3a (the role taxonomy — acquisitions / disposition / transaction-DD / broker, and why the target is the RIGHT function, not the highest-volume contact — the Easterly Pulliam/Shuler worked example), §7c Phase 2 ("what Scott asked for by name"), §7d (why ACI-phase1-2 did not attempt this — scope, not a defect) · STATUS.md 2026-09-10 (both reconciliation entries — this prompt is the named follow-up to Unit C's "not attempted, needs its own right-sized prompt").
Why this prompt exists, and why it's scoped the way it is
ACI-phase1-2 bundled four units in one PR; Units A/B shipped, Unit C (this work) did not — its own commit message says why: "a genuinely large surface... that could not be built and guarded to standard in the time available" alongside three other units. This prompt is Unit C alone — AC2 (bench ranking) + AC3 (Ollama role inference), nothing else bundled in. Do not also attempt AC1d(a/b), AC6, AC8, or AC9 in this pass; if any of them genuinely blocks AC2/AC3, name the blocker and stop rather than silently expanding scope.
What's already there (measured 2026-09-10, re-verify before building — these numbers move)
    • owner_contact_pivot.bench (jsonb) already exists as a column and is already populated on 1,622 of 5,488 rows (29.6%) — this is not a from-scratch build, it's ranking/scoring an existing structure and deciding what "populated" should mean going forward for the other 70%.
    • unified_contacts.title — 5.2% coverage (1,723 of 32,858), up from 1.9% in August but still the binding constraint on function inference. On the canonical worked example: Andrew Pulliam (Easterly Partners, 132 emails sent, last 2023-02-27) has title = NULL in unified_contacts today — the volume signal exists, the title signal does not. Ryan Shuler (the DD-manager counter-example from §3a) does not resolve in unified_contacts by name at all — check whether he's under a different name/email before assuming his row is simply thin.
    • unified_contacts.outlook_contact_id / total_emails_sent / last_email_date / engagement_score are live and current (synced through today per §7a) — these are the correspondence-volume/recency inputs AC2's ranking needs; they exist, they just aren't scored into bench yet.
    • Salesforce campaign membership keys on email domain, not company name (§3b) — reuse that join, do not re-derive a name-based one.
    1. AC2 — rank the bench, never collapse to one winner
For each owner/account with owner_contact_pivot.active_contact_entity_id or its own set of linked people, score every candidate person on: correspondence volume (total_emails_sent), recency (last_email_date/last_activity_date), two-way vs one-way (does a reply/inbound exist, not just outbound — check what's measurable here first), seniority signal (title text, when present), and inferred function (from AC3 below). Write the ranked bench into the existing bench jsonb column (read its current shape from the 1,622 populated rows first — extend it, don't redefine it, unless you find it's wrong for this purpose and say why). The bench is not one winner recorded once — Scott's explicit 08-26 doctrine: roles and firms change, so this must be a re-derivable ranking, not a decision recorded once. Ship as a planner (pure function in, ranked list out) plus the write path, mirroring the entity-parent-inheritance-planner.js pattern already proven in this repo (pure logic, separately wired) rather than a single monolithic handler.
    2. AC3 — Ollama infers function, not just orders by volume
Run the four-bucket taxonomy from §3a (acquisitions / disposition / transaction-DD / broker) over each bench candidate's available signal — title when non-null, correspondence subject lines (+ bodies where available per §7a), Salesforce role/campaign context. The target is the acquisitions contact, not the highest-volume one — re-run the Pulliap/Shuler logic live once real data is in front of you and confirm the taxonomy still separates them correctly (Pulliam EVP-Acquisitions = target; a DD manager = not, even with high volume). Carry confidence per P181 — every inferred role travels with a confidence value, and the surface (wherever this becomes human-visible — Decision Center lane, a card, a report) is gated on that confidence, never displayed as fact. Given 5.2% title coverage, expect and report the real split between "title says X" (high confidence) and "inferred from correspondence alone" (lower confidence, name it as such) — do not let the low-title-coverage population silently inherit the confidence of the well-titled 5.2%.
    3. Value-gate by owner, not by task
Per the existing P161/P180 doctrine already adopted in this repo: gate which owners get the Phase 2 treatment by owner rent/value, not by counting tasks. Reuse the existing value-gate mechanism (read how AC10/A5c/C2a/B1 gated before inventing a new threshold) rather than picking a new cutoff.
    4. What NOT to do in this pass (explicitly out of scope)
    • Do not fix AC6 (professional emails misfiled as personal), AC8 (v_lcc_prospecting_edge_review false negatives), or AC9 (competitor-broker edges on Easterly) — these corrupt Phase 2's input corpus per §7c, but fixing them is its own measured unit. If AC2/AC3's own guard surfaces a case that is clearly one of these three defects, name it and move on — do not stop to fix it.
    • Do not build a new value-gate mechanism, a new bench-storage shape, or a new confidence scale — reuse what exists (named above) or explain concretely why it doesn't fit before building something new.
    • Do not backfill title — 5.2% coverage is a measured ceiling on the current sync, not a gap this prompt closes.
Guard + ship
Mutation-guarded tests for the ranking planner (order changes correctly as inputs change — recency beats volume when explicitly tied, a reply outranks a one-way blast, etc.) and for the role-inference confidence gate (a NULL-title, low-signal candidate never reports high confidence). Positive control on the Pulliam/Shuler pair specifically, since it's the doc's own worked example and the easiest place to catch a regression. Reversible bench writes, same discipline as every writer this repo has shipped this arc.
Ship + record
Branch build/aci-phase2-unitC. STATUS.md entry naming what shipped vs what was sized/deferred. account-based-contact-intelligence.md §7d gets a follow-up subsection (do not overwrite it — this is Unit C's own outcome, filed the same way Unit A/B's were). PLANNED-BACKLOG.md AC2/AC3 rows updated from their current 🟢 (designed, not started) to whatever the real outcome is.
Ran an agent, ran 2 commands
Good, it's already cloned. Now let me spawn the agent with proper isolation using EnterWorktree, or since this is not a fresh git worktree situation, just run directly since we're already on a session branch.
Ran 2 commands
Given the scale of this task and low reasoning effort budget, I'll delegate the implementation to a background agent working directly in this cloned repo (no worktree needed since we're already isolated on the designated session branch).
Ran a command, ran an agent
I've kicked off implementation of ACI-phase2-unitC (bench ranking + Ollama role inference for the account-based contact intelligence system) as a background agent working directly in the life-command-center repo on branch claude/compassionate-einstein-i4xpj7.
Scope, per your spec:
    • AC2: pure ranking planner scoring bench candidates on volume/recency/two-way-vs-one-way/seniority/inferred function, writing to the existing owner_contact_pivot.bench jsonb column
    • AC3: Ollama-based role inference (acquisitions/disposition/transaction-DD/broker) with P181 confidence gating, explicitly separating title-based vs correspondence-inferred confidence given ~5.2% title coverage
    • Value-gated by owner rent (reusing the existing $500k-floor mechanism, not inventing a new one)
    • Explicitly excludes AC1d/AC6/AC8/AC9
    • Mutation-guarded tests including a positive control on the Pulliam/Shuler worked example
    • STATUS.md entry, doc §7d follow-up appended, backlog rows updated
    • Pushes to the designated branch, no PR
This will take a while given the codebase size. I'll report back with what shipped, test results, and what was measured live vs. assumed once it completes.
2 background commands completed
ACI-phase2-unitC shipped
Pushed to origin/claude/compassionate-einstein-i4xpj7. No PR opened (as instructed).
What was built:
    • api/_shared/bench-ranking-planner.js (AC2) — pure planner ranking bench candidates: two-way correspondence → inferred function priority → volume → recency → seniority → name; extends the existing owner_contact_pivot.bench jsonb shape (measured live: 1,622/5,488 populated) rather than redefining it. Value-gates via the existing cadenceSignalFloor() knob, per your instruction to reuse it.
    • api/_shared/bench-role-inference-planner.js (AC3) — title-hint path + Ollama correspondence inference, with a hard P181 confidence cap (correspondence-only evidence can never report 'high') and a verbatim-quote guard against hallucination.
    • api/_handlers/bench-rank-tick.js — GET dry-run (ungated) / POST write (flag-gated, not yet flipped on), ledger-before-write reversibility. Mounted in admin.js + server.js.
    • Migration for the ledger tables — written but not applied live.
    • 67 test assertions across 3 files, all passing; mutation-kill hand-verified on the two load-bearing rules.
    • Docs: STATUS.md entry, §7e appended to the account-based-contact-intelligence doc, PLANNED-BACKLOG rows updated.
Measured live (reads only, no writes): the bench population count, its exact jsonb shape, Pulliam's real row (title=NULL, 132 emails, Easterly Partners) — and importantly the actual two-way signal: email_bodies.is_sent split (48 inbound / 3 outbound), which is what AC2's "two-way beats volume" rule is calibrated against. Confirmed "Shuler" doesn't resolve by name in unified_contacts at all, matching the doc's caveat.
Not measured: a live ranking run or a live Ollama call — tests stub invokeExtractionAI deliberately.
Deliberately out of scope, untouched: AC1d(a/b), AC6, AC8, AC9 (per your instructions). One new gap found and filed rather than fixed: AC2-sf-context — the write handler doesn't yet populate AC3's Salesforce-context input, so role inference currently runs without SF campaign corroboration until that's wired.
Two operator steps still needed before this is live: apply the ledger migration, and create/flip the BENCH_RANK_WRITE feature flag.
Got it — noted. PR #2257 tracks this work now; I'll reference it going forward and any further commits go to the same branch to update it in place.


