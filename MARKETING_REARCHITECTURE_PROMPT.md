# Marketing → Prospect Pipeline Rearchitecture — Claude Code Prompt

## Context

The Marketing tab in `app.js` currently treats all Salesforce Opportunity records as one flat list. But these opportunities are actually prospects that belong in domain-specific pipelines:

- **Government** (221 deals) — federal/state/local agency tenants (VA, GSA, CBP, CA Dept. of, County, City of, etc.)
- **Dialysis** (99 deals) — dialysis clinic operators (FMC, DaVita, Innovative Renal, etc.)
- **All Other** (540 deals) — medical net lease (MOBs, surgical, behavioral health, medical buyers/developers)

### What's already done (Supabase)

1. **`v_opportunity_domain_classified` view** — already created and working. Classifies every open Opportunity into `government`, `dialysis`, or `all_other` using regex pattern matching on the deal name (subject field), with support for a manual `prospect_domain` override column on `salesforce_activities`.

2. **`salesforce_activities.prospect_domain TEXT`** column — added for manual domain overrides. When not NULL, it takes priority over auto-classification.

3. Current classification breakdown (970 contacts across 860 deals):
   - `all_other`: 540 deals / 622 contacts
   - `government`: 221 deals / 248 contacts
   - `dialysis`: 99 deals / 100 contacts

4. **Marketing tab already has** (from latest commit `4b2b00c`):
   - My Deals / All Deals toggle filtering by `assigned_to`
   - Reassign dropdown per deal card
   - Call history expandable panel per contact
   - Email template menu (4 templates: Initial Outreach, Follow-Up, Market Update, Meeting Request)
   - Deal-grouped card layout
   - Log call modal that writes to Salesforce
   - Team members: `Scott Briggs` (675 deals), `Kelly Largent` (3,490 deals)

---

## What needs to change

### 1. Marketing tab becomes a CRM Activity Hub

The Marketing tab should **stop** displaying Opportunity records as its primary content. Instead, it should focus on:

**Active CRM tasks** — calls to make today, follow-ups due, emails to send. These are the non-Opportunity activity records (`nm_type != 'Opportunity'`, or `nm_type IS NULL`). Think of it as a call sheet / daily action list.

The Marketing tab should show:
- **Today's Calls** — open tasks with `nm_type = 'Call'` or `task_subtype = 'Call'`
- **Follow-Ups Due** — tasks due today or overdue
- **Recent Activity** — last 10-20 completed calls/emails for context
- Keep the email templates, log call modal, and call history features
- Keep the My Deals / All toggle

### 2. Route Opportunities to domain Prospects subtabs

Add a **"Prospects"** subtab to each domain dashboard:

**Dialysis → Prospects subtab** (`app.js`, dialysis section)
- Query: `v_opportunity_domain_classified` with `domain = 'dialysis'`
- Show the deal-grouped card layout (same as current Marketing card style)
- Include all the action buttons (email templates, log, call, history)
- Filter: My Deals / All, priority, upcoming/overdue

**Government → Pipeline subtab** (already exists in `gov.js`)
- The Government Pipeline subtab currently shows `prospect_leads` from the lead pipeline
- Add a **new section** above or below the existing pipeline for SF Opportunity prospects
- Query: `v_opportunity_domain_classified` with `domain = 'government'`
- Same card layout with action buttons

**All Other tab**
- The "All Other" tab in the top business nav (currently shows count 779) should get a Prospects subtab
- Query: `v_opportunity_domain_classified` with `domain = 'all_other'`
- Same card layout

### 3. Frontend data flow changes

**In `app.js` `loadMarketing()`:**

Replace the current query to `v_marketing_deals` with:
```javascript
// Fetch domain-classified opportunities (for routing to domain tabs)
const opportunitiesRaw = await diaQuery('v_opportunity_domain_classified', '*', { limit: 2000 });

// Fetch CRM activities (calls, follow-ups — NOT opportunities)
const crmTasksRaw = await diaQuery('salesforce_activities', '*', {
  filter: 'status=eq.Open,nm_type=neq.Opportunity',
  order: 'activity_date.asc.nullslast',
  limit: 500
});

// Store opportunities globally so domain tabs can access them
window._mktOpportunities = {
  government: opportunitiesRaw.filter(d => d.domain === 'government'),
  dialysis: opportunitiesRaw.filter(d => d.domain === 'dialysis'),
  all_other: opportunitiesRaw.filter(d => d.domain === 'all_other')
};

// Marketing tab only renders CRM tasks
mktData = [...normalizedTasks, ...normalizedLeads];
```

**In `dialysis.js`** — add a Prospects subtab that reads from `window._mktOpportunities.dialysis` and renders the deal-grouped card layout.

**In `gov.js`** — add an SF Prospects section to the Pipeline subtab that reads from `window._mktOpportunities.government`.

**In `app.js` All Other section** — render from `window._mktOpportunities.all_other`.

### 4. Domain override UI

On each deal card (in any Prospects subtab), add a small domain reclassification dropdown:
```html
<select onchange="mktReclassifyDeal(activityId, this.value)">
  <option value="government">Government</option>
  <option value="dialysis">Dialysis</option>
  <option value="all_other">All Other</option>
</select>
```

This writes the `prospect_domain` column override:
```javascript
async function mktReclassifyDeal(activityId, newDomain) {
  // PATCH salesforce_activities SET prospect_domain = newDomain WHERE activity_id = activityId
  // Then re-sort local data and re-render
}
```

### 5. Marketing tab badge update

The Marketing tab badge count in the top nav should change from showing the total opportunity count (970) to showing **actionable CRM tasks due** (calls due today + overdue follow-ups). The em dash (—) currently shown should become a real count.

### 6. Shared rendering function

Since all three domain Prospects subtabs use the same card layout, extract a shared function:

```javascript
function renderProspectCards(container, prospects, options = {}) {
  // Reuse the deal-grouped card layout from current renderMarketing()
  // Options: { showDomainDropdown, showReassign, showEmailTemplates, showCallHistory }
}
```

This keeps the code DRY and lets all three domains share the same UX.

---

## Files to modify

| File | Change |
|------|--------|
| `app.js` | Refactor `loadMarketing()` to split opportunities vs CRM tasks. Extract `renderProspectCards()`. Add domain reclassify function. Update badge logic. |
| `dialysis.js` | Add Prospects subtab using `renderProspectCards()` for dialysis-domain opportunities |
| `gov.js` | Add SF Prospects section to Pipeline subtab using `renderProspectCards()` for government-domain opportunities |
| `index.html` | Add Prospects subtab button to Dialysis nav if not present. Update All Other section. |

## Database (already done — no action needed)

- `v_opportunity_domain_classified` view — ✅ created
- `salesforce_activities.prospect_domain` column — ✅ created
- Index on `prospect_domain` — ✅ created

## Verification

After implementation:
1. Marketing tab should show CRM activity tasks (calls, follow-ups), NOT opportunities
2. Dialysis → Prospects subtab should show ~99 dialysis deals
3. Government → Pipeline should show ~221 government deals in an SF Prospects section
4. All Other → Prospects should show ~540 deals
5. Domain reclassification dropdown should move deals between tabs
6. All action buttons (email templates, log call, call history, reassign) should work in every Prospects subtab
7. Marketing badge should show actionable task count, not opportunity count

## SQL migration file for version control

Save as `sql/20260318_opportunity_domain_classification.sql`:
```sql
ALTER TABLE salesforce_activities ADD COLUMN IF NOT EXISTS prospect_domain TEXT;
CREATE INDEX IF NOT EXISTS idx_sf_activities_prospect_domain ON salesforce_activities (prospect_domain) WHERE prospect_domain IS NOT NULL;

CREATE OR REPLACE VIEW v_opportunity_domain_classified AS
WITH classified AS (
  SELECT DISTINCT ON (subject, sf_contact_id)
    activity_id, subject AS deal_name, first_name, last_name,
    (first_name || ' ' || last_name) AS contact_name,
    company_name, email, phone, sf_contact_id, sf_company_id,
    activity_date, nm_notes, nm_type, task_subtype,
    status, assigned_to, created_at, prospect_domain,
    CASE
      WHEN prospect_domain IS NOT NULL THEN prospect_domain
      WHEN subject ~* '(^VA |veterans affairs|^GSA[ -]|USDA|^FBI[ -]|^CBP[ -]|^IRS[ -]|^SSA[ -]|^DOJ[ -]|^DEA[ -]|^USPS[ -]|^HHS[ -]|^HUD[ -]|^DOL[ -]|^EPA[ -]|^FAA[ -]|^FEMA[ -]|^FWS[ -]|Army|Navy|Air Force|Coast Guard|^DHS[ -]|Homeland Security|^ACOE[ -]|Bureau of|Census|Customs|Federal |USCIS|^ICE[ -]|Secret Service|Marshal|Corps of Eng|Reclamation|^BLM[ -]|Fish.*Wildlife|Forest Service|National Guard|National Preserve|^NPS[ -])' THEN 'government'
      WHEN subject ~* '(Dept\. of|Department of|County |City of |State of |Municipal|Probation|Corrections|^DMV[ -]|Motor Vehicles|State Police|^DOT[ -]|Dept of Health|^DCFS[ -]|Public Safety|Sheriff|District Attorney)' THEN 'government'
      WHEN subject ~* '^[A-Z]{2} Dept' THEN 'government'
      WHEN subject ~* '(dialysis|DaVita|Fresenius|^FMC[ -]|kidney|renal|nephrology|Innovative Renal|^DCI[ -]|Satellite Dial|U\.S\. Renal|American Renal|Greenfield Renal)' THEN 'dialysis'
      ELSE 'all_other'
    END AS domain,
    CASE
      WHEN subject ~ '^\*{0,5}\d+\s*-' THEN regexp_replace(subject, '^\*{0,5}(\d+)\s*-.*', '\1')::integer
      ELSE NULL
    END AS deal_priority,
    CASE
      WHEN subject ~ '^\*{0,5}\d+\s*-\s*' THEN trim(regexp_replace(subject, '^\*{0,5}\d+\s*-\s*', ''))
      ELSE subject
    END AS deal_display_name
  FROM salesforce_activities
  WHERE nm_type = 'Opportunity' AND status = 'Open'
  ORDER BY subject, sf_contact_id, activity_date DESC
)
SELECT * FROM classified;
```
