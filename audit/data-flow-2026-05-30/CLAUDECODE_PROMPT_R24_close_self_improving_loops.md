# Claude Code — R24: close the self-improvement loops (wire the producers)

## Why (grounded live 2026-06-15)
The system is richly instrumented for self-improvement but the loops are OPEN — the
SCAFFOLDS exist, the CONSUMERS exist, but the PRODUCERS that feed them aren't wired,
so outcomes never change behavior. With outreach just unblocked (R16/R20: ~217
reachable owners, sends about to ramp), the template + engagement loops should make
outreach get better over time — they won't unless their producers are wired now.
Grounded:
- `template_definitions` 23, but `template_sends`/`template_performance`/
  `high_performing_templates`/`template_refinements` ALL 0 — and the one real send
  didn't write `template_sends`. The whole template-learning loop is unfed.
- The cadence engine (cadence-engine.js) CONSUMES `consecutive_unopened` /
  `emails_replied` / `unsubscribe_status` / escalation, but the mailto/copy send path
  has no open-tracking, so `emails_opened` can't populate and `consecutive_unopened`
  will mis-count every send as "unopened" (wrongly deprioritizing engaged contacts at
  ≥2). Reply capture isn't wired into `emails_replied`.
- Provenance learning (R13 Unit 2) is flag-OFF (0 `manual_decision` rules).

## Unit 1 (highest leverage) — `record_send` feeds the template + engagement producers
On a recorded send (the R10 Unit 4 `record_send` path + the cadence advance):
- INSERT a `template_sends` row (`template_id` from the cadence's `next_touch_template`,
  cadence/entity/contact ids, sent_at) so `template_performance` /
  `high_performing_templates` rollups (and the `lcc-template-health-rollup` cron) have
  data to learn from.
- Increment the cadence `emails_sent` (confirm it already does; ensure
  `template_sends` is written in the SAME path so they can't diverge).
This single wire activates the entire dormant template-learning loop the moment sends
ramp. Verify `template_performance` accrues after a send; `high_performing_templates`
populates once the rollup runs with ≥N sends.

## Unit 2 — reply capture → `emails_replied` + the engagement path
Route inbound replies into the engagement counters so the engine reacts:
- The SF-activity sync (`/api/sf-activity`) already mirrors SF tasks; when a task is a
  reply/inbound `email` on a cadence's contact/entity, increment that cadence's
  `emails_replied` and trigger the engine's "active engagement / converted" branch
  (pause/escalate). Same for `email_intake` inbound replies.
- Reuse the existing activity→cadence advance plumbing (R10 Unit 2 asset→owner hop);
  a reply is a high-signal touch.

## Unit 3 (correctness guard) — don't penalize "unopened" when opens are untrackable
The mailto/copy path has no open signal, so treating every send as `consecutive_unopened++`
mis-fires the ≥2 auto-deprioritize on engaged contacts. Until open-tracking exists
(needs an ESP/pixel — explicitly OUT of scope here), EITHER:
- don't increment `consecutive_unopened` on a send whose channel has no open tracking
  (the mailto/copy path), OR
- gate the `consecutive_unopened >= 2` branch (cadence-engine.js ~line 179) on an
  "open-tracking active" flag (default false).
So the engine only deprioritizes on REAL unopened signals, never on absence of a
signal.

## Unit 4 (after Unit 1 accrues data) — template selection uses performance
Once `template_sends`/`high_performing_templates` have data, the draft/template picker
(currently static `T-001` for all prospecting cadences) should prefer the
best-performing template for the phase/segment. Fall back to the default when there's
not yet enough data for a template/segment (cold-start). Ship this AFTER Unit 1 has
accrued sends — no point selecting on empty performance data.

## Unit 5 (cheap, flag) — enable provenance learning
Flip `DECISION_PROVENANCE_LEARN` (R13 Unit 2) so a manual provenance-conflict
resolution writes the `manual_decision` priority rule and the conflict stops
re-litigating. It's built + verified (R13); this is activation, gated on Scott's
blessing since it writes to the shared priority registry.

## Boundaries / house rules
- No ESP/open-tracking build in this round (Unit 3 makes the engine correct WITHOUT
  it). dia/gov pipelines untouched. Reuse existing send/activity/advance plumbing —
  don't fork. ≤12 `api/*.js`; `node --check`; suite green.
- Acceptance: a recorded send writes `template_sends` + `emails_sent`; a logged reply
  bumps `emails_replied` + hits the engagement branch; `consecutive_unopened` no
  longer increments on the no-open-tracking send path; (after data) selection prefers
  high-performing templates; provenance learning flag documented for activation.

## Verdict
The self-improvement asset is real; the gap is the last producer-wire on each loop
plus one correctness guard. Closing Units 1–3 turns the now-unblocked outreach engine
from static into one that gets better the more it's used — the project's
self-improving objective. Units 4–5 follow once data accrues / on your blessing.
