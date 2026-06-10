# Claude Code — R16b: populate the SF Task Due Date (`activity_date`)

## Why
R16 shipped SF Task creation (`create_opportunity` = open Task on a Contact,
NMType). We **omitted ActivityDate** because Power Automate's date field rejected
a typed default expression (saved it as literal text → runtime failure). Fix it
from the LCC side so the value is always a clean date string, then the PA field
becomes a simple click-to-insert token. An open touchpoint without a due date
doesn't surface on the rep's "due" worklist, so this closes that gap.

## Unit 1 — `api/_shared/salesforce.js::createSalesforceTask`
- Add an optional `activityDate` (alias `activity_date`) param.
- **Always include `activity_date` in the POST body.** If the caller doesn't
  supply one, default to **today** in `YYYY-MM-DD` (UTC). Never send null.
- Keep everything else (who_id/subject/nm_type/status/what_id/idempotency_key)
  and the tolerant ok:false behavior unchanged.

## Unit 2 — callers pass the real due date where they have it
The touchpoint's true due date is the cadence's `next_touch_due` (date portion).
Pass it as `activityDate`; the helper defaults to today only when absent.
- `api/operations.js` `bridgeSelectBuyerContact` (buyer) + `bridgeSelectProspectingContact`
  (seller): when they create the Task, pass `activityDate` = the row's
  `next_touch_due::date` (the cadence they just seeded/attached). Fallback today.
- `api/admin.js` `handleGovBuyerSync`: pass `activityDate` = the opp's buy-side
  cadence `next_touch_due::date` if resolvable (it already resolves the primary
  contact from the cadence — read `next_touch_due` in the same place), else today.

## Unit 3 — PA flow (Scott, documented; not Claude Code)
Two small edits on flow `c3744e93-…` (classic/native designer):
1. In the **trigger** ("When an HTTP request is received"), extend the Request
   Body JSON Schema to include `who_id, subject, nm_type, status, activity_date,
   what_id` (additive — keep all existing properties so the other operations'
   tokens still resolve). This makes each a **Dynamic content token**.
2. In **Create record**, re-add **Task Due Date Only** and set it by **clicking
   the `activity_date` dynamic-content token** (NOT a typed expression — that's
   what failed before). Since LCC now always sends a valid `YYYY-MM-DD`, the
   field is never null and the date-format validation passes.
Document this in `PA_FLOW_create_opportunity_case_recipe.md` (Follow-up section).

## House rules
`node --check` on salesforce.js / operations.js / admin.js; `ls api/*.js | wc -l`
≤ 12 (edits only, no new files); effect-first + outcome-truthful; idempotent.
Ships on the Railway redeploy; the PA trigger-schema + Due Date field re-add
(Unit 3) is the cutover that makes due dates appear on the created Tasks.

## Test
After deploy + PA edit: `select_buyer_contact` (or the gov-buyer sync) →
the SF Task carries **Due Date = the cadence's next_touch_due** (or today when
none). Confirm on the contact's open activities. Re-run = still idempotent
(`already_synced`), no duplicate.
