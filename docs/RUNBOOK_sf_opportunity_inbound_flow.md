# RETRACTED — there is no Salesforce Opportunity object

**This runbook described a flow that cannot work. Do not build it.**
Superseded 2026-08-17 by P124. Kept, rather than deleted, so the wrong path is
not re-derived.

---

## What was wrong

Scott: *"the Opportunities we track in Salesforce are open Activities or Tasks
with the field NM Type 'Opportunity' and remain open. We don't have an object in
Salesforce called Opportunities."*

He is right. The codebase already said so in three places I read past:

| where | what it says |
|---|---|
| `api/admin.js:16645` | *"create the SF **Task** on the primary CONTACT (WhoId). A government buyer carries **NMType BLANK (never 'Opportunity')**."* |
| `api/_shared/salesforce.js::createSalesforceTask` | posts `{ operation:'create_opportunity', who_id, subject, nm_type, status:'Open', activity_date, what_id }` — a **Task** |
| `api/admin.js:16664` | `bd_opportunities.sf_opp_id := sf.task.Id` — a **Task** id |

I had even quoted `sf.task.Id` back while investigating and did not register it.

## The three errors

**1. Wrong object.** The seeded bridge's handler reads `p.AccountId`,
`p.StageName`, `p.Amount`, `p.CloseDate` — Opportunity fields. A Task has
`WhoId`, `WhatId`, `Subject`, `Status`, `ActivityDate` and the custom `NM Type`.
None of the four exist on it.

**2. Wrong transport.** This org's Salesforce integration does not use the
`/api/bridges` connector path at all. It goes through `SF_LOOKUP_WEBHOOK_URL`
Power-Automate **flow ops** — `create_opportunity`, `opportunities_by_ids`,
`find_account_by_name`, `owners_by_ids`, `reassign_task_owner` — documented in
[`connectivity-and-open-threads.md`](architecture/connectivity-and-open-threads.md) §C.

That is why `connector_bridges` held exactly one row (`outlook.messages`) and no
`sf.*` bridge. **I read that absence as a gap. It was evidence of a different
architecture** — and the doc naming the real ops was in the repo the whole time.

**3. The premise itself.** P122 claimed the dormant sync was *"the ONLY path that
would carry SF Amount into LCC."* **A Task has no Amount field.** There is no deal
value in this Salesforce to sync. `bd_opportunities.amount` is not un-synced — it
is **unfillable from that source**, and registering it as a dormant capability
implied it could be switched on.

## What this means for ranking — nothing changes

P121 gives an open opportunity a flat **$5,000** tier. I called that a placeholder
awaiting real figures. **It is the correct behaviour**, because no real figure
exists.

Nor can a deal be valued from its property: only **3 of 614** `bd_opportunities`
rows carry a `source_property_id` (2 of them open). Deal value reaches the ranking
solely through the **entity's portfolio rent**, which `lcc_decision_entity_value`
already uses.

The "re-evaluate P121's tier and the `milestone_confirm` rank once amounts land"
note is **withdrawn**. Amounts will not land.

## Actions taken (P124)

- Dropped the `sf.opportunities` connector bridge — it modelled a non-existent object.
- Dropped the `SF_OPPORTUNITY_INBOUND_SYNC` flag — the registry is for capabilities
  that are *off*, not ones that *cannot exist*. Leaving it would guarantee someone
  re-derives this path later.

## If you ever do want SF-side deal value

It would have to be a **custom field on the Task** (there is no standard one), and
it would arrive through a new `SF_LOOKUP_WEBHOOK_URL` flow op alongside
`opportunities_by_ids` — not through a connector bridge. That is a Salesforce
configuration decision first, an LCC one second.

## The lesson worth keeping

I inferred an architecture from an absence (`no sf.* bridges` → "a gap") instead
of reading the architecture doc that described the real one. The correct move,
when a whole class of integration appears missing, is to assume it is done
differently and go find where — not to fill the apparent hole.
