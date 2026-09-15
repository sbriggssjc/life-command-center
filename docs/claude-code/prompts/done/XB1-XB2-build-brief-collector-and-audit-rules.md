# XB1 + XB2 — The build brief's collector and audit rules, with its first output already measured

**Repo: `life-command-center`.** This is the third of the three things Scott asked for when P18 started —
*"almost like it's an executive briefing from the CDO or CTO on the build and processes in place"* — and
the only one not yet started. The market briefs are live and self-monitoring; the operator funnel is live
and self-monitoring. This is what watches the build itself.

**Read first:** `docs/architecture/EXEC-BRIEFS-SPEC.md` **§5** (XB is specified there — collector, audit
rules, synthesis, surfaces) · `docs/os/PLANNED-BACKLOG.md` **XB1–XB4** ·
`docs/architecture/data-coherence-invariants.md` **I11** and the "I11 can fail INVERTED" note ·
the MB2e / FEED2 / OC-v2 monitors as the shape to copy.

## Why now, in one line

Every guard we built this week found a real defect within a day of existing — and **each one was found
because a human went looking.** XB is the thing that looks without being asked.

## Scope: XB1 (collector) + XB2 (rules). NOT XB3/XB4.

Build the deterministic half. `#/exec` (XB3) and the Ollama narrative (XB4) come after, and are much
easier once `build_brief_snapshots` has real rows. **Do not build a dashboard in this unit** — a surface
with nothing behind it is how we got "looks live, does nothing" three times already.

## Cowork ran the audit by hand 2026-09-14 — these are the real first-run findings

**Reproduce these numbers.** They are the acceptance test: if the automated rules disagree with the hand
run, one of the two is wrong and that must be resolved before shipping, not papered over.

| rule | measured now | note |
|---|---|---|
| **Branch debt** | **618 local branches**, 14 unmerged to `origin/main` | repo hygiene; Scott has asked repeatedly for a clean trail |
| **Long-dark flags** | 68 flags: 37 on, 29 off — **15 off >3 weeks, 11 off >60 days**, oldest `SF_LIST_SEED_INSTITUTION` off since **2026-05-30** (3.5 months) | a flag off for a quarter is either dead code or forgotten work |
| **Producers not completing** | `sidebar_contact_guard` — **31 runs, 31 skipped, 0 completions ever** since 2026-09-12, `skip_reason: blocks_all_chrome_or_duplicate` | ⭐ see the rule refinement below |
| **Producers skipped by design** | `p_rss` — 3 runs, all skipped, `skip_reason: flag MARKET_BRIEF_PRSS is off` | **correct**, must NOT alert |
| **Prompts without responses** | 4 of 8 in `prompts/` | one is a false positive — see below |
| **Doc size** | STATUS 2,257 / budget 2,500 · BACKLOG 1,178 | guards already exist for both |

### ⭐ Rule refinement the hand run produced — do not collapse these two

`p_rss` and `sidebar_contact_guard` both read "skipped, never completed". They are **completely
different**:

- **Skipped because a flag is off** is the system working. `p_rss` is correct and must stay silent.
- **Skipped for an operational reason, 31 times running**, is a stall wearing a skip's clothes — a
  producer that looks alive and has never once done its job.

So the rule is **not** "alert on producers with no completions". It is: *alert on a producer whose skips
are NOT flag-gated and which has not completed in N runs.* This is the same distinction FEED2 taught
(a dead feed vs. a feed nobody checked) and MB2e (dead vs. contributing nothing). **Each fault shape gets
its own named finding** — that rule has now paid off three times.

### The false positive is itself a finding

The orphan check flagged `MB2bc-…` as having no response, but the response exists, filed as
`MB2b desktop response.docx`. **The prompt↔response naming convention is not enforced**, so any orphan
rule will produce noise until it is. Either enforce the convention (a guard test) or match on a
recorded prompt id rather than a filename prefix — **do not ship a rule that cries wolf**, per the FEED2
lesson that a monitor nobody trusts is worse than none.

## What to build

1. **`build_brief_snapshots`** (migration): one row per collector run — `collected_at`, `git_sha`,
   plus a `jsonb` payload of raw measures and a `jsonb` array of findings `{rule, severity, subject,
   measured, detail}`. Additive, reversible, with a runbook, like every migration this program has shipped.
2. **Collector**: deterministic only. Repo side (branches, prompts/responses, doc sizes, GENERATED-file
   edits) + DB side (flags, `producer_runs`, `lcc_health_alerts`, `cron.job`). Runs nightly **and** on
   push to `main` per §5. Every finding must carry the measurement that produced it — a finding a human
   cannot re-derive is not a finding.
3. **Rules** as above, each one named and independently testable, with fixtures for both the firing and
   the silent case (the positive control pattern from `feed2-streak-checks-not-days.test.mjs`).
4. **A read endpoint** returning the latest snapshot as JSON. No UI.

## What NOT to do

No dashboard, no Ollama narrative, no email — those are XB3/XB4. Don't auto-fix anything the audit finds;
this unit reports. Don't fold distinct fault shapes into one generic "unhealthy" finding. Don't let a rule
alert on an intended state (flag-off skips, budget-compliant docs). Don't add cloud-model calls — repo
content is a private corpus, on-box Ollama only, and that is XB4 regardless.

## Ship + record

Deploy is Railway + Supabase (**not** an edge function): apply the migration, redeploy **both** Railway
services, confirm `/version` moved, then run the collector once and **report the findings table**. That
table — measured, next to Cowork's hand-run numbers above — is the deliverable, not the diff.
Update `docs/os/PLANNED-BACKLOG.md` (**XB1, XB2**), `EXEC-BRIEFS-SPEC.md` §5, `STATUS.md` (≤12 lines).
