# Power Automate Flow: Microsoft To Do → Life Command Center

This flow runs every hour, pulls all your tasks from Microsoft To Do, and saves them as a JSON file on your OneDrive. The Life Command Center app can then import this file with one click.

---

## Setup Steps (10 minutes)

### 1. Go to Power Automate
Open **flow.microsoft.com** and sign in with your Microsoft 365 account.

### 2. Create a New Flow
Click **+ Create** → **Scheduled cloud flow**

- **Flow name:** `To Do → Life Command Center Sync`
- **Starting:** Today
- **Repeat every:** `1 hour` (you can change this later)
- Click **Create**

### 3. Add the "Initialize Variable" Action
This will hold all your tasks as we loop through lists.

- Click **+ New step** → search for **"Initialize variable"**
- **Name:** `AllTasks`
- **Type:** Array
- **Value:** leave empty `[]`

### 4. Add a "Compose" Action for Your List Names
- Click **+ New step** → search for **"Compose"**
- **Inputs:** paste this exactly:
```json
["Work", "Personal", "House", "Kids", "Family", "Health", "Finance"]
```

### 5. Add an "Apply to each" Loop
- Click **+ New step** → search for **"Apply to each"**
- **Select an output from previous steps:** Click the **Outputs** from the Compose step above

Inside the loop, add these actions:

#### 5a. Get To-Do Tasks
- Click **Add an action** → search for **"List to-dos in a folder"** (Microsoft To Do connector)
- **List name:** Use **dynamic content** → select `Current item` from the Apply to each
- Note: If this errors because a list doesn't exist yet, that's fine — the flow will skip it

#### 5b. Add Another "Apply to each" (Nested)
- **Select an output:** Choose **value** from the "List to-dos" step

Inside this nested loop:

#### 5c. Append to Array Variable
- Click **Add an action** → search for **"Append to array variable"**
- **Name:** `AllTasks`
- **Value:** Paste this (using dynamic content to fill in the values):

```json
{
  "title": "@{items('Apply_to_each_2')?['title']}",
  "listName": "@{items('Apply_to_each')}",
  "importance": "@{items('Apply_to_each_2')?['importance']}",
  "status": "@{items('Apply_to_each_2')?['status']}",
  "dueDateTime": "@{items('Apply_to_each_2')?['dueDateTime']?['dateTime']}",
  "body": "@{items('Apply_to_each_2')?['body']?['content']}",
  "createdDateTime": "@{items('Apply_to_each_2')?['createdDateTime']}",
  "isCompleted": @{if(equals(items('Apply_to_each_2')?['status'], 'completed'), true, false)}
}
```

**Important:** Replace `Apply_to_each` and `Apply_to_each_2` with the actual names Power Automate assigns to your loops. You can see these in the flow designer.

### 6. Create File on OneDrive (Outside Both Loops)
After the outer "Apply to each" loop ends, add:

- Click **+ New step** → search for **"Create file"** (OneDrive for Business connector)
  - If you use personal OneDrive, choose "OneDrive" instead
- **Folder Path:** `/Personal/Productivity/Life Command Center`
- **File Name:** `todo-sync.json`
- **File Content:** Select the `AllTasks` variable

**Important:** Use **"Update file"** instead of "Create file" if the file already exists. Or better yet, use the **"Create or replace file"** action if available.

### 7. Save and Test
- Click **Save** in the top right
- Click **Test** → **Manually** → **Run flow**
- After it runs, check your OneDrive folder — you should see `todo-sync.json`

---

## How to Sync in the App

1. Open the Life Command Center in your browser
2. Click **Settings** (top right)
3. Click the blue **Select To Do Sync File** button
4. Navigate to: `OneDrive > Personal > Productivity > Life Command Center`
5. Select `todo-sync.json`
6. The app merges new tasks in. Duplicates (tasks with the same title) are automatically skipped.

---

## How the Merge Works

The sync is **additive and non-destructive:**

- **New tasks** (titles that don't exist in your app yet) are added
- **Duplicate tasks** (matching titles) are skipped — your existing edits are preserved
- **Completed status** from To Do is respected
- **List names** are mapped to categories (Work list → Work category, etc.)
- **Importance levels** are mapped: High → Urgent, Normal → Medium, Low → Low
- **Due dates** are preserved and used to set the timeline (Today, This Week, This Month)

---

## Troubleshooting

**"List not found" error in Power Automate:**
Make sure you've created all 7 lists in Microsoft To Do with these exact names: Work, Personal, House, Kids, Family, Health, Finance.

**File not appearing in OneDrive:**
Check the folder path in the "Create file" step. It should match your actual OneDrive folder structure.

**No new tasks showing after sync:**
The app skips tasks with identical titles. If you renamed a task in To Do, it'll come in as a new task.

**Flow running but file is empty:**
Make sure the "Append to array variable" step is inside BOTH loops (the outer list loop and the inner task loop).

---

## Optional Enhancements

**Filter out completed tasks:** Add a **Condition** step inside the inner loop: only append if `status` is not equal to `completed`. This keeps your sync file smaller and focused on open tasks.

**Run more frequently:** Change the recurrence to every 30 minutes or even 15 minutes if you want near-real-time sync. The free Power Automate tier allows 750 runs per month.

**Add a notification:** After the file is created, add a "Send me a mobile notification" step so you know when fresh data is available.
