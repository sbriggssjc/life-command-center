# Bidirectional Email Flag Flow — Setup Guide

## How It Works

**Direction 1: Flag email in Outlook → Task appears in To Do → Syncs to Life Command Center**
- You flag an email in Outlook (desktop, web, or mobile)
- Power Automate detects the flag and creates a task in Microsoft To Do
- The task includes the sender, preview text, and a link back to the original email
- Your Life Command Center app shows it with a "Flagged Email" badge and "Open Email" button

**Direction 2: Complete task in Life Command Center / To Do → Email gets unflagged in Outlook**
- You check off the task in your app (or mark complete in To Do)
- Power Automate scans for completed email-linked tasks every 15 minutes
- It automatically marks the email flag as "Complete" in Outlook

---

## Prerequisites

- Microsoft 365 account (same one used for Life Command Center)
- Power Automate access (included with most M365 plans)
- Microsoft To Do lists already created (Work, Personal, House, Kids, Family, Health, Finance)

---

## Flow 1: Flagged Email → To Do Task

### Step 1: Create the Flow

1. Go to **flow.microsoft.com** and sign in
2. Click **+ Create** → **Automated cloud flow**
3. Flow name: `Flagged Email → To Do Task`
4. Choose trigger: search for **"When an email is flagged"**
5. Select **When an email is flagged (V3)** (Office 365 Outlook)
6. Click **Create**

### Step 2: Configure the Trigger

1. **Folder:** Inbox
2. **Importance:** Any
3. **Only with Attachments:** No
4. Leave other settings as default

### Step 3: Add a Variable for Target List

1. Click **+ New step** → search **"Initialize variable"**
2. **Name:** `TargetList`
3. **Type:** String
4. **Value:** `Work` (this is the default — most flagged emails are work-related)

### Step 4: Add Sender-Based Routing (Optional but Recommended)

This routes emails to the right To Do list based on who sent them.

1. Click **+ New step** → search **"Switch"** (under Control)
2. **On:** Click into the field → Dynamic content → select **From**
3. Add cases for your key contacts:

| Case | Equals (sender email) | Action |
|------|----------------------|--------|
| Case 1 | your-wife@email.com | Set variable `TargetList` = `Family` |
| Case 2 | school@school.edu | Set variable `TargetList` = `Kids` |
| Case 3 | doctor@healthcare.com | Set variable `TargetList` = `Health` |
| Case 4 | bank@bank.com | Set variable `TargetList` = `Finance` |
| Default | (everything else) | Leave as-is (stays "Work") |

For each case:
- Click **Add an action** → **Set variable**
- **Name:** `TargetList`
- **Value:** the list name (Family, Kids, Health, Finance, etc.)

**Tip:** You can add more cases later as you discover patterns.

### Step 5: Create the To Do Task

1. Click **+ New step** (after the Switch, not inside it)
2. Search for **"Add a to-do"** → select **Add a to-do (V3)** (Microsoft To Do)
3. Fill in:
   - **List:** Click in the field → **Expression** tab → type: `variables('TargetList')` → click OK
   - **Subject:** Click → Dynamic content → **Subject** (from the trigger)
   - **Importance:** `high`
   - **Body Content:** Click in the field and build this (mixing text and Dynamic content):

```
📧 From: [From]
📅 Received: [Received Time]

[Body Preview]

---
[EmailID:[Message Id]]
[EmailLink:https://outlook.office.com/mail/inbox/id/[Conversation Id]]
```

Replace the `[brackets]` with Dynamic content from the trigger:
- `[From]` → select **From**
- `[Received Time]` → select **Received Time**
- `[Body Preview]` → select **Body Preview**
- `[Message Id]` → select **Message Id**
- `[Conversation Id]` → select **Conversation Id**

**Important:** The `[EmailID:...]` and `[EmailLink:...]` lines are tracking markers. They MUST be exactly this format — the app and Flow 2 use them to link back to the email.

### Step 6: Save and Test

1. Click **Save**
2. Go to Outlook and flag any email
3. Wait 1-2 minutes, then check Microsoft To Do — you should see the task
4. Open Life Command Center and sync — the task should appear with a "Flagged Email" badge

---

## Flow 2: Completed Task → Unflag Email

### Step 1: Create the Flow

1. Go to **flow.microsoft.com**
2. Click **+ Create** → **Scheduled cloud flow**
3. Flow name: `Unflag Completed Email Tasks`
4. Repeat every: **15 minutes**
5. Click **Create**

### Step 2: Set Up the List Names

1. Click **+ New step** → search **"Compose"**
2. **Inputs:** paste exactly:
```json
["Work", "Personal", "House", "Kids", "Family", "Health", "Finance"]
```

### Step 3: Loop Through Each List

1. Click **+ New step** → search **"Apply to each"**
2. **Select an output:** Click → Dynamic content → **Outputs** from the Compose step

### Step 4: Get Completed Tasks

Inside the Apply to each loop:

1. Click **Add an action** → search **"List to-dos in a folder"** (Microsoft To Do)
2. **List:** Dynamic content → **Current item**
3. After it's added, click **Show advanced options**
4. **Status Filter:** `completed`

### Step 5: Loop Through Completed Tasks

1. Click **Add an action** (still inside the outer loop) → **"Apply to each"**
2. **Select an output:** Dynamic content → **value** from "List to-dos"

### Step 6: Check for Email ID and Unflag

Inside the inner loop:

1. Click **Add an action** → search **"Condition"**
2. **Left side:** Dynamic content → **Body content** (from the task)
3. **Operator:** contains
4. **Right side:** `[EmailID:`

In the **If yes** branch:

1. Click **Add an action** → search **"Compose"**
   - **Inputs:** Expression tab → paste:
   ```
   split(split(items('Apply_to_each_2')?['body']?['content'], '[EmailID:')[1], ']')[0]
   ```
   (Note: `Apply_to_each_2` may be named differently — use whatever the inner loop is named)

2. Click **Add an action** → search **"Send an HTTP request"** (Office 365 Outlook)
   - If you don't see this connector, search for **"Mark as read"** instead and use the alternative approach below

   **HTTP Request approach:**
   - **Method:** PATCH
   - **URI:** `https://graph.microsoft.com/v1.0/me/messages/` then add Dynamic content → **Outputs** from the Compose step
   - **Body:**
   ```json
   {
     "flag": {
       "flagStatus": "complete"
     }
   }
   ```

   **Alternative (simpler but less precise):**
   Instead of HTTP request, use **"Flag email (V2)"** action:
   - **Message Id:** Dynamic content → **Outputs** from the Compose step
   - **Flag Status:** Complete

### Step 7: Save and Test

1. Click **Save**
2. In Microsoft To Do, mark a task complete that has `[EmailID:...]` in the body
3. Wait for the flow to run (or click **Test** → **Manually**)
4. Check Outlook — the email flag should now show as completed

---

## Troubleshooting

**"The list was not found":**
Your To Do list names must exactly match: Work, Personal, House, Kids, Family, Health, Finance.

**Email link doesn't open the right email:**
The Conversation ID link format may vary. Try this alternative format in Step 5 of Flow 1:
```
[EmailLink:https://outlook.office365.com/owa/?ItemID=[Message Id]&exvsurl=1&viewmodel=ReadMessageItem]
```

**Flow runs but no task appears:**
Check the flow run history in Power Automate — click on the flow → **Run history** → click a run to see which step failed.

**"Open Email" button doesn't appear in the app:**
The task body must contain `[EmailLink:https://...]` exactly. Check the task in To Do to verify the body format.

**Unflag flow not working:**
The expression to extract the Email ID depends on the exact loop name. Check Power Automate's auto-generated names (Apply_to_each, Apply_to_each_2, etc.) and update the expression accordingly.

---

## What You'll See in the App

Tasks from flagged emails will appear with:
- A blue **"🏳️ Flagged Email"** badge showing the source
- A blue **"✉️ Open Email"** button that opens the original email in Outlook
- Automatic categorization based on sender (Work, Family, Kids, etc.)
- High priority by default (since you flagged it as important)

When you check off the task, the next time Flow 2 runs (within 15 min), the email will be marked as flag-complete in Outlook.
