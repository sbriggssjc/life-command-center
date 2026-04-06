# Copilot Rollout — Guided Testing Plan

> **Purpose:** Walk through every testable capability from the Wave 0-3 build, capture results, and report back for triage and repair.
> **Date:** 2026-04-06
> **Branch:** `claude/review-m365-copilot-rollout-qMpWT`
> **Tester:** _______________
> **Environment:** _______________  (e.g., `https://life-command-center.vercel.app` or `localhost:3000`)

---

## How to Use This Document

1. Work through each test in order — they build on each other
2. For each test, record the **Result** (Pass / Fail / Partial / Skipped)
3. If a test fails, capture the **error message** and a **screenshot** in the designated area
4. When complete, deliver this document back for triage — we'll fix everything flagged as Fail

### Result Key
- **Pass** — works as expected
- **Fail** — broken, error, or wrong behavior
- **Partial** — works but with issues or missing data
- **Skipped** — couldn't test (missing dependency, not configured)

---

## Pre-Flight Checklist

Before testing, confirm these are in place:

| Item | Status | Notes |
|------|--------|-------|
| Branch deployed to Vercel? | [ ] Yes / [ ] No | |
| `LCC_ENV` set in Vercel? | [ ] Yes / [ ] No | Value: _____________ |
| `LCC_API_KEY` set in Vercel? | [ ] Yes / [ ] No | |
| `OPS_SUPABASE_URL` + `OPS_SUPABASE_KEY` set? | [ ] Yes / [ ] No | |
| `GOV_SUPABASE_URL` + `GOV_SUPABASE_KEY` set? | [ ] Yes / [ ] No | |
| `AI_CHAT_PROVIDER` set? | [ ] Yes / [ ] No | Value: _____________ |
| `MS_GRAPH_TOKEN` set? | [ ] Yes / [ ] No | |
| Can access LCC in browser? | [ ] Yes / [ ] No | URL: _____________ |
| Copilot panel opens? | [ ] Yes / [ ] No | |

---

## Tier 1: Automated Smoke Tests

### Run the smoke test script

```bash
# Local dev server:
node test/smoke-copilot-actions.mjs

# Against production:
LCC_API_KEY=your-key node test/smoke-copilot-actions.mjs https://your-app.vercel.app
```

**Result:** [ ] Pass / [ ] Fail / [ ] Partial

**Passed count:** _____ / _____

**Failed tests (copy from terminal output):**
```
(paste failures here)
```

**Screenshot of test output:**

> [INSERT SCREENSHOT: Terminal showing smoke test results]

---

## Tier 2: Frontend Copilot Panel — Visual Testing

### Test 2.1: Copilot Panel Opens

1. Navigate to LCC in your browser
2. Click the Copilot FAB button (bottom-right, purple gradient circle)
3. Panel should slide up with welcome message and 6 suggestion chips

**Result:** [ ] Pass / [ ] Fail

**Do you see these 6 chips?**
- [ ] "Daily briefing"
- [ ] "Prospecting call sheet"
- [ ] "My queue"
- [ ] "Sync health"
- [ ] "Inbox triage"
- [ ] "Today's priorities"

**Screenshot:**

> [INSERT SCREENSHOT: Copilot panel open with chips visible]

---

### Test 2.2: Daily Briefing Flow

1. Click the **"Daily briefing"** chip
2. Wait for response

**Result:** [ ] Pass / [ ] Fail / [ ] Partial

**What appeared?**
- [ ] AI-generated text response about today's priorities
- [ ] Work count numbers mentioned
- [ ] Follow-up suggestion chips appeared after the response
- [ ] Error message (copy below)

**Error message (if any):**
```
(paste here)
```

**Screenshot:**

> [INSERT SCREENSHOT: Daily briefing response in Copilot panel]

---

### Test 2.3: Prospecting Call Sheet

1. Click the **"Prospecting call sheet"** chip (or type "Who should I call today?")
2. Wait for response

**Result:** [ ] Pass / [ ] Fail / [ ] Partial

**What appeared?**
- [ ] AI-generated call sheet text
- [ ] Contact list cards with heat badges (hot/warm/cool) and engagement scores
- [ ] Follow-up chips (e.g., "Draft email to [name]", "Relationship context")
- [ ] "No business contacts" message (this is OK if no contacts ingested yet)
- [ ] Error message

**How many contacts showed?** _____

**Screenshot:**

> [INSERT SCREENSHOT: Prospecting brief with contact cards]

---

### Test 2.4: Draft Outreach Email

1. After a prospecting brief, click the **"Draft email to [name]"** follow-up chip
   - OR type: "Draft an outreach email to John Smith"
2. You should see a confirmation prompt first (since this is a Tier 1 action)

**Result:** [ ] Pass / [ ] Fail / [ ] Partial

**Step 1 — Confirmation prompt appeared?**
- [ ] Yes, saw "requires explicit confirmation" message
- [ ] Yes, saw "Confirm and execute" button
- [ ] No, it executed immediately (this is a bug)
- [ ] Error

**Step 2 — Click "Confirm and execute"**
- [ ] Email draft appeared with subject line + body
- [ ] "requires_review" notice shown
- [ ] Follow-up chips appeared ("Create To Do follow-up", etc.)
- [ ] Error

**Screenshot of confirmation prompt:**

> [INSERT SCREENSHOT: Confirmation prompt for draft email]

**Screenshot of generated email draft:**

> [INSERT SCREENSHOT: Email draft result]

---

### Test 2.5: Pipeline Intelligence

1. Click the **"Pipeline health"** follow-up chip after any action
   - OR type: "How's the pipeline looking?"
2. Wait for response

**Result:** [ ] Pass / [ ] Fail / [ ] Partial

**What appeared?**
- [ ] AI-generated pipeline analysis text
- [ ] Pipeline stat chips (Active, Completed, Overdue, Stale, Escalations)
- [ ] Numbers look reasonable for your workspace
- [ ] Follow-up chips appeared

**Screenshot:**

> [INSERT SCREENSHOT: Pipeline intelligence with stat chips]

---

### Test 2.6: Relationship Context

1. Type: "Tell me about [a real contact name] before my call"
   - OR click "Relationship context" follow-up chip after a prospecting brief
2. Wait for response

**Result:** [ ] Pass / [ ] Fail / [ ] Partial

**What appeared?**
- [ ] Relationship card with health badge (strong/active/cooling/cold)
- [ ] Contact details (name, company, title, touchpoint stats)
- [ ] AI-generated relationship briefing
- [ ] "Contact not found" message (OK if name doesn't match)
- [ ] Error

**Screenshot:**

> [INSERT SCREENSHOT: Relationship context card + briefing]

---

### Test 2.7: Listing Pursuit Dossier

1. Type: "Generate a pursuit dossier for [property or entity name]"
2. Wait for response

**Result:** [ ] Pass / [ ] Fail / [ ] Partial

**What appeared?**
- [ ] Multi-section dossier text (Target Summary, Ownership, Market Position, Strategy, Call Prep, Next Steps)
- [ ] Follow-up chips ("Create follow-up task", "Draft outreach to owner")
- [ ] Entity data referenced from LCC
- [ ] "[DATA NEEDED]" placeholders where data was missing (this is expected)
- [ ] Error

**Screenshot:**

> [INSERT SCREENSHOT: Pursuit dossier output]

---

### Test 2.8: Guided Entity Merge

1. Type: "Show me duplicate entities" or "Any duplicates to clean up?"
2. Wait for response

**Result:** [ ] Pass / [ ] Fail / [ ] Partial

**What appeared?**
- [ ] Entity duplicate count + contact merge queue count
- [ ] "Found X entity duplicate group(s) and Y pending contact merge(s)"
- [ ] Follow-up chips
- [ ] "0 groups" (OK if no duplicates exist)
- [ ] Error

**Screenshot:**

> [INSERT SCREENSHOT: Entity merge results]

---

### Test 2.9: Document Generation

1. Type: "Generate a BOV for [property name]" or "Create a pursuit summary for [entity]"
2. You should see a confirmation prompt first

**Result:** [ ] Pass / [ ] Fail / [ ] Partial

**Confirmation prompt appeared?** [ ] Yes / [ ] No

**After confirming:**
- [ ] Document text generated (professional format with sections)
- [ ] OneDrive save card appeared ("Document Saved to OneDrive" with link)
- [ ] "Configure MS_GRAPH_TOKEN" message (this is OK if token doesn't have Files.ReadWrite)
- [ ] Follow-up chips appeared
- [ ] Error

**Screenshot:**

> [INSERT SCREENSHOT: Document generation result]

---

### Test 2.10: Microsoft To Do Task Creation

1. Type: "Create a To Do task: Follow up with client about proposal"
   - OR click "Create To Do follow-up" chip after an email draft
2. You should see a confirmation prompt first

**Result:** [ ] Pass / [ ] Fail / [ ] Partial / [ ] Skipped (no MS_GRAPH_TOKEN)

**After confirming:**
- [ ] "Task Created in Microsoft To Do" card appeared
- [ ] Task title, list name, status shown
- [ ] Task actually appeared in Microsoft To Do app
- [ ] Error about MS_GRAPH_TOKEN not configured (expected if not set)

**Screenshot:**

> [INSERT SCREENSHOT: To Do task creation result]

---

### Test 2.11: Natural Language Queries

Test that the AI understands operational questions using the enriched context.

| Question | Expected Behavior | Result | Notes |
|----------|-------------------|--------|-------|
| "What's my queue look like?" | References actual work count numbers | [ ] Pass / [ ] Fail | |
| "Any sync issues?" | References sync error count | [ ] Pass / [ ] Fail | |
| "What needs triage in the inbox?" | References inbox_new count | [ ] Pass / [ ] Fail | |
| "How many overdue items do I have?" | References overdue count | [ ] Pass / [ ] Fail | |
| "Summarize my activity this week" | Provides activity summary | [ ] Pass / [ ] Fail | |

**Does the AI reference specific numbers from your data (not generic advice)?** [ ] Yes / [ ] No

**Screenshot of a natural language response:**

> [INSERT SCREENSHOT: Natural language query showing real data]

---

## Tier 3: M365 Integration Testing

> **Prerequisites:** Power Automate flows activated, MS_GRAPH_TOKEN set, Teams channels created.
> Skip this section if Cowork hasn't finished portal setup yet.

### Test 3.1: Outlook Intake Pipeline

1. Go to Outlook
2. Flag any email
3. Wait 60 seconds
4. Check LCC inbox page — did a new intake item appear?
5. Check Teams Intake Notifications channel — did a card post?

**Result:** [ ] Pass / [ ] Fail / [ ] Skipped

**Intake item appeared in LCC?** [ ] Yes / [ ] No
**Teams card posted?** [ ] Yes / [ ] No
**Latency (seconds):** _____

**Screenshot of LCC inbox with new item:**

> [INSERT SCREENSHOT: Inbox item from flagged email]

**Screenshot of Teams intake notification card:**

> [INSERT SCREENSHOT: Teams channel with intake card]

---

### Test 3.2: Daily Briefing Teams Delivery

1. Manually trigger the daily briefing flow in Power Automate
   - OR wait for the scheduled run
2. Check the Daily Briefing Teams channel

**Result:** [ ] Pass / [ ] Fail / [ ] Skipped

**Card posted to Teams?** [ ] Yes / [ ] No
**Card sections visible:**
- [ ] Summary headline
- [ ] Work counts (Open, Inbox New, Sync Errors)
- [ ] Top priorities
- [ ] Domain highlights (Government, Dialysis)
- [ ] Action buttons (Open LCC Home, My Queue, Inbox, Sync Health)

**Degraded mode badge showing?** [ ] Yes / [ ] No / [ ] N/A

**Screenshot of Teams briefing card:**

> [INSERT SCREENSHOT: Daily briefing adaptive card in Teams]

---

### Test 3.3: Existing Power Automate Flow Health

Check each flow in Power Automate portal:

| Flow | Status | Last Successful Run | Notes |
|------|--------|---------------------|-------|
| Email Flag -> To Do | [ ] On / [ ] Off / [ ] Missing | _____________ | |
| To Do Complete -> Unflag Email | [ ] On / [ ] Off / [ ] Missing | _____________ | |
| Personal Calendar Sync | [ ] On / [ ] Off / [ ] Missing | _____________ | |
| Hardened Outlook Intake | [ ] On / [ ] Off / [ ] Missing | _____________ | |
| Daily Briefing to Teams | [ ] On / [ ] Off / [ ] Missing | _____________ | |

**Screenshot of Power Automate flow list:**

> [INSERT SCREENSHOT: Power Automate "My flows" showing all flows and their status]

---

## Tier 4: Auth & Security

### Test 4.1: Transitional Auth Gating

**With `LCC_ENV=production` and `LCC_API_KEY` set:**

| Request | Expected | Actual Result |
|---------|----------|---------------|
| Browser request (no credentials) | 401 Unauthorized | [ ] 401 / [ ] 200 (bug) |
| Request with `x-lcc-key: <valid>` | 200 OK | [ ] 200 / [ ] 401 |
| Request with `x-lcc-key: <wrong>` | 401 Unauthorized | [ ] 401 / [ ] 200 (bug) |

**With `LCC_ENV=development` (or unset):**

| Request | Expected | Actual Result |
|---------|----------|---------------|
| Browser request (no credentials) | 200 OK (transitional user) | [ ] 200 / [ ] 401 |

**Screenshot:**

> [INSERT SCREENSHOT: Browser dev tools showing 401 for unauthenticated request in production mode]

---

## Tier 5: Pre-Commit Guard

### Test 5.1: Function Count Guard

```bash
# Should show 12/12:
npm run check:functions

# Should pass (no error):
echo "test" > /tmp/test-hook.txt && git add /tmp/test-hook.txt 2>/dev/null; .github/hooks/pre-commit; echo "Exit: $?"
```

**Result:** [ ] Pass / [ ] Fail

**Function count:** _____ / 12

---

## Issue Summary

### Critical Issues (blocks deployment)

| # | Test | Description | Error/Screenshot |
|---|------|-------------|------------------|
| | | | |
| | | | |
| | | | |

### Important Issues (should fix before team rollout)

| # | Test | Description | Error/Screenshot |
|---|------|-------------|------------------|
| | | | |
| | | | |
| | | | |

### Minor Issues (cosmetic or enhancement)

| # | Test | Description | Error/Screenshot |
|---|------|-------------|------------------|
| | | | |
| | | | |
| | | | |

### Working Well (highlight wins)

| Test | Notes |
|------|-------|
| | |
| | |
| | |

---

## Environment Details

**Browser:** _____________
**OS:** _____________
**Vercel deployment URL:** _____________
**Deployment commit:** _____________
**Date tested:** _____________

---

## Next Steps After Testing

1. Deliver this document with all results and screenshots
2. We'll triage issues into: fix now / fix next sprint / known limitation
3. Fix critical and important issues
4. Re-run failed tests to verify fixes
5. Proceed with team rollout (add second user)
