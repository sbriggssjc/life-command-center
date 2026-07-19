# Infra-Alert Classification & Priority Scoring

Scott flags Vercel / GitHub **build & deploy failure** emails in Outlook exactly
like any deal email — the existing **Flag → To Do** Power Automate flow. This
feature makes those alerts recognizable, ranked, and scannable in the To Do list
**with zero extra steps** — no new folder, flag, label, or button. The only user
action stays *flag the email*.

## What happens

In `api/intake.js`, the `outlook-message` route handler (the endpoint the
Flag → To Do flow POSTs to):

1. **Classifies** the flagged email — if the sender domain is Vercel/GitHub, or
   the subject looks like a CI-CD failure, it is tagged `domain='infra'` and
   `source_system` (`vercel` | `github` | `unknown`).
2. **Priority-scores** it against Scott's open queue using **the same
   `scoreItem()` engine the daily briefing uses** (`api/_shared/briefing-data.js`)
   — reuse, not a duplicated scoring engine. The urgency signal (a build
   *failure* = high) is passed through; there is **no client-facing deadline**;
   the default weight lands **below active deal-deadline emails** (deal keywords
   add 70–100) but **above a bare FYI / reference email**.
3. **Stores** the numeric score on `inbox_items.priority_score` (+ `domain`,
   `priority`, and a `metadata.{kind,source_system,priority_tier}` block).
4. **Returns** a `priority_tier` (`HIGH` / `MED` / `LOW`) and a ready-to-use
   `todo_title` (e.g. `"[HIGH] Vercel build failed — soccer-video"`) so the
   Flag → To Do flow prefixes the To Do task title. It does **not** run the OM
   extractor on the alert (an infra email is not a listing OM).

Nothing about the dialysis / government / net-lease classification path changes —
`infra` is a separate, additive tag on the same intake endpoint.

## Where the patterns live (edit here)

**`api/_shared/intake-classify.js`** is the single source of truth:

| Export | Purpose |
| --- | --- |
| `INFRA_SENDER_DOMAINS` | `{ vercel: ['vercel.com'], github: ['github.com','githubapp.com'] }` — domain (or subdomain, e.g. `notifications.github.com`) → `source_system`. |
| `INFRA_SUBJECT_PATTERNS` | Subject fallbacks: `build failed`, `deploy(ment) failed`, `workflow run failed`, `ci/pipeline/check/job/run failed`, `Action required:`. Anchored on failure/attention wording (not bare "build"). |
| `detectInfraAlert({senderEmail, subject})` | `{ isInfra, sourceSystem, matchedBy }` — sender-domain match wins, subject is the fallback. |
| `infraUrgency(subject)` | `high` (failure/error) · `medium` (action required) · `low` (soft notice). |
| `buildInfraScoringItem({subject, senderEmail})` | The pseudo-item `scoreItem()` scores: urgency rides in `priority`, no `due_date`, `source_type='flagged_email'`, empty `body` (so a long alert body can't trip deal/pursuit keywords). |
| `priorityTierFromScore(score)` | Buckets the score: `>=40 → HIGH`, `>=20 → MED`, else `LOW`. |

Calibration (on the shared `scoreItem()` scale):

| Alert | urgency | pseudo `priority` | score | tier |
| --- | --- | --- | --- | --- |
| `Build failed …` | high | `urgent` (+30) + flagged (+10) | 40 | **HIGH** |
| `Action required: …` | medium | `high` (+20) + flagged (+10) | 30 | **MED** |
| `Vercel weekly digest` | low | `low` (0) + flagged (+10) | 10 | **LOW** |

To add a provider or pattern, edit the two constants above — the handler and the
Power Automate flow inherit it automatically.

## Power Automate flow (Scott's side)

- **Trigger scope**: the Flag → To Do flow must trigger on **Inbox (any folder)**,
  not a Gmail-forwarding sub-folder. With the Gmail forwarding hop removed,
  Vercel/GitHub alerts now arrive **directly in the Northmarq inbox**, so the
  flow must watch the inbox it lands in.
- **To Do title**: read `todo_title` (or `priority_tier`) from the intake
  endpoint's JSON response and use it as the To Do task's title/subject, so the
  task reads `[HIGH] Vercel build failed — soccer-video` and is scannable
  without opening each item. No new step for the user — the flow already POSTs
  to `/api/intake?_route=outlook-message` and gets this back.

## Data / reversibility

- Migration `supabase/migrations/20260719210000_lcc_infra_alert_priority_score.sql`
  adds `inbox_items.priority_score integer` (additive, idempotent
  `ADD COLUMN IF NOT EXISTS`). Reverse with
  `ALTER TABLE public.inbox_items DROP COLUMN priority_score;`.
- Only infra alerts set `priority_score` / `domain='infra'`; every other flagged
  email is untouched (default `priority='normal'`, `priority_score` NULL).
- Tests: `test/infra-alert-classify.test.mjs`.
