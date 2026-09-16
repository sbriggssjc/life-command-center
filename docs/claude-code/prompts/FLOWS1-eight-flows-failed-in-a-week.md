# FLOWS1 — eight Power Automate flows failed last week, one of them 709 times; trace the LCC side of each

**Filed:** 2026-09-16 (Cowork) from `docs/claude-code/SB notes/8 of your flow(s) have failed.eml`
(Microsoft digest, week ending 2026-09-12). Triage row **SBN-1**.
**Owner:** LCC for everything on this side of the HTTP boundary; the flows themselves are Scott's
(Power Automate, tenant `fccf69d3…`). **Read first:** `docs/os/POWER-AUTOMATE-DEPLOYED-CATALOG.md`,
`docs/architecture/power-automate-flow-audit.md`, `docs/INFRA_ALERT_CLASSIFICATION.md`,
`docs/architecture/flows/*.md` for each flow named below.

## The digest

| flow (digest name) | failures / week | catalog id |
|---|---:|---|
| Http → Get file (**LCC Get Artifact**) | **709** | `c63003a0-…` |
| LCC – Outlook Intake to Teams (Hardened) | 41 | `45faffcc-…` (`outlook-intake-hardened`) |
| LCC List Folder (SharePoint) | 39 | — |
| SF Listing Activity → LCC engagement | 35 | `a81b5708-…` |
| LCC Processing Complete → Move Message | 7 | — |
| LCC Flagged Email Intake | 6 | `44227dbb-…` |
| Http → Switch, Get Account records, Respond (account), Get Contact re… | 6 | — |
| Outlook Calendar – Life Command Center Sync | 1 | — |

A digest carries counts, not causes. The run-level error text lives only in the Power Automate run
history, which nothing in this repo can read. So this round is split:

- **Scott** drops **one screenshot of one failed run per flow** (the red step + its error body) into
  `docs/claude-code/SB notes/` — that is the only way the failure reason enters the repo.
- **This prompt** does everything that can be done from the LCC side *without* those screenshots,
  so the screenshots land on a diagnosis, not a blank page.

## What to do from the LCC side (measure, don't guess)

1. **Get Artifact, 709/week ≈ 100/day.** Find every LCC caller of that flow's HTTP trigger (grep the
   flow id, `Get Artifact`, and the SharePoint path it fetches, in `api/`, `scripts/`, `supabase/`,
   pg_cron on all three projects). For each caller: how often does it run, and what does it pass? A
   709 count with a ~100/day cadence usually means a **scheduled caller retrying against a moved or
   deleted file** — find the schedule that matches the arithmetic before reading anything else.
   Check `infra_alerts` / the alert classification table for the same period: is this failure
   already classified, and as what?
2. **Outlook Intake (41) and Flagged Email Intake (6)** share the intake path (`docs/architecture/
   flows/flagged-email-to-todo*.md`, `outlook_intake_team_visibility_workflow.md`). Read LCC's
   intake endpoint logs for the week (Railway; `/api/intake*`): were the failures **LCC 5xx/4xx
   responses** (ours) or **flow-side** (theirs — connector auth, Teams card, SharePoint)? Split the
   41 by that line if the logs allow; if they don't, say so and say what logging is missing.
3. **SF Listing Activity → LCC engagement (35).** This flow POSTs to an LCC route. Same question:
   did LCC refuse it (schema drift on the payload, 413, auth), and does the `sf_activity` /
   engagement table show a gap for the week that matches?
4. **List Folder (39), Processing Complete → Move (7), Switch/Get Account (6), Calendar (1)**:
   catalog each (trigger, what LCC endpoint if any, last known-good), one paragraph apiece, and
   mark which are LCC-facing at all. A flow that never touches LCC is Scott's to fix; say so plainly.
5. Produce a **per-flow table**: LCC-facing? · suspected side · evidence · what the screenshot must
   show to confirm · the fix if it is ours. Where a fix is ours and obvious (a route that 500s on a
   payload it should accept), fix it in this round with a test; otherwise stop at the diagnosis.

## Prohibitions

- ⛔ Do not touch a flow definition (`flow-*.json` at the repo root are exports, not sources — see
  `docs/flows/README.md`); do not "fix" a flow by hand-editing its export.
- ⛔ Do not silence an alert or lower a threshold to make the digest quieter
  (`CLAUDE.md` → "A monitor's threshold is part of the monitor").
- ⛔ No retries or resends of intake mail.

## Reporting

The per-flow table, the Get-Artifact caller arithmetic, the intake log split, what was fixed and
tested, and the exact list of screenshots still needed from Scott (flow name → which run step). If
any step was skipped, say so.
