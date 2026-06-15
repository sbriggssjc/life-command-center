# Audit — self-improving feedback loops (instrumented but open)
**Grounded live 2026-06-15.** Question: does the system use OUTCOMES to improve future
behavior, or capture signals it never acts on?

## Meta-finding
The architecture is **richly instrumented for self-improvement** — engagement
counters, a full template-learning scaffold, a provenance-learning loop, accuracy
rollups — but **almost every loop is open**: signals are captured/rolled-up, yet they
don't (yet) change behavior. The system is *built to learn* but *not yet learning*.
Causes split three ways: dormant (no data yet), producer-unwired (won't feed even
with data), and flag-gated/unadopted.

## Loop-by-loop
| loop | scaffold | state | gap |
|---|---|---|---|
| **Template performance → selection** | 23 `template_definitions` + `template_sends`/`template_performance`/`template_refinements`/`high_performing_templates` + rollup cron | **0 rows fed**; selection static (`T-001` for all) | **producer unwired** — `record_send` doesn't write `template_sends` (even the 1 real send didn't), so the loop can't feed even as volume ramps; selection never reads `high_performing_templates` |
| **Engagement → cadence** | engine consumes `consecutive_unopened`/`emails_replied`/`unsubscribe_status`/escalation (cadence-engine.js) | consumer WIRED; producers thin | no open-tracking on the mailto/copy send path → `emails_opened` can't populate → `consecutive_unopened` will mis-count every send as "unopened" and wrongly deprioritize at ≥2; reply capture not wired from SF/email-intake into `emails_replied` |
| **Provenance → registry learning** | R13 Unit 2 (`DECISION_PROVENANCE_LEARN`, `manual_decision` priority rule) | **OFF** — 0 `manual_decision` rows | flag-gated (Scott's blessing); manual conflict resolutions don't teach → conflicts re-litigate |
| **Disambiguation → match learning** | match_disambiguation lane | **0 ever decided** (34 open) | unadopted — lane not worked, so no learning + matches stay unresolved |
| **Matching accuracy** | `matcher-accuracy-rollup` cron | runs | reports; unclear it adjusts thresholds/aliases (likely report-only) |

## Why it matters now
The outreach loop just got unblocked (R16/R20: ~217 reachable owners). As sends ramp,
the template + engagement loops are exactly what should make outreach *get better over
time* — but they'll stay flat unless their **producers** are wired. Two are correctness
risks, not just missed learning:
- `consecutive_unopened` auto-deprioritize will MIS-FIRE (penalize engaged contacts)
  because opens are untrackable on the mailto path.
- `record_send` not writing `template_sends` means the whole template-learning
  investment yields nothing even at volume.

## Recommended closes (R24) — wire the producers so the built loops actually learn
1. **`record_send` → template + engagement producers.** On a recorded send, write a
   `template_sends` row (template_id, cadence, contact, ts) + increment `emails_sent`,
   so `template_performance`/`high_performing_templates` rollups have data. This is
   the single highest-leverage wire — it activates the entire dormant template loop.
2. **Reply capture → `emails_replied`.** Route inbound replies (SF-activity
   `email`/reply tasks + `email_intake`) into the cadence `emails_replied` counter +
   the engine's "active engagement / converted" path, so a reply escalates/pauses
   correctly.
3. **Fix `consecutive_unopened` for the no-open-tracking reality.** Until open
   tracking exists (needs an ESP/pixel — a separate, bigger feature), do NOT
   increment `consecutive_unopened` on a mailto send (no open signal ≠ unopened), or
   gate the ≥2 auto-deprioritize on open-tracking being active. Prevents wrongly
   deprioritizing engaged contacts.
4. **Template selection → use `high_performing_templates`.** Once #1 feeds data, the
   draft/template picker should prefer the best-performing template for the
   phase/segment instead of static `T-001`. (Ship after #1 has accrued data.)
5. **Enable provenance learning (R13 flag).** Cheap, built — flip
   `DECISION_PROVENANCE_LEARN` so manual conflict resolutions teach the registry and
   conflicts stop re-litigating. Scott's blessing (it writes a `manual_decision`
   priority rule).

## Verdict
The self-improvement scaffolding is a real asset — the gap is the last wire on each
loop (the producer) plus one correctness guard (`consecutive_unopened`). Closing
them turns the now-unblocked outreach engine from "static" into "gets better the more
it's used," which is the project's self-improving objective. #1–#3 are the priority
(they ride the send path that's about to get real volume); #4–#5 follow.
