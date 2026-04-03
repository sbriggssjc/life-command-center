# Build the To Do Sync Flow — Step by Step

Open **flow.microsoft.com** side by side with this guide and follow each step.

---

## STEP 1: Create the Flow

1. Click **+ Create** (left sidebar)
2. Click **Scheduled cloud flow**
3. Fill in:
   - **Flow name:** `To Do Sync`
   - **Starting:** today's date
   - **Repeat every:** `1` → `Hour`
4. Click **Create**

You'll see the flow editor with a **Recurrence** trigger already placed.

---

## STEP 2: Initialize the Variable

1. Click **+ New step**
2. Search for: `Initialize variable`
3. Click **Initialize variable** (under "Variable")
4. Fill in:
   - **Name:** `AllTasks`
   - **Type:** `Array`
   - **Value:** leave completely blank

---

## STEP 3: Get Tasks from Your First List

We'll start with just the **Work** list, then duplicate for the others.

1. Click **+ New step**
2. Search for: `List to-dos`
3. Click **List to-dos in a folder** (Microsoft To Do connector)
   - If prompted to sign in, sign in with your Microsoft account
4. In the **List** dropdown, select **Work**
   - (If you don't see your lists, make sure you created them in Microsoft To Do first)

---

## STEP 4: Loop Through the Tasks

1. Click **+ New step**
2. Search for: `Apply to each`
3. Click **Apply to each** (under "Control")
4. Click inside the **"Select an output from previous steps"** box
5. In the Dynamic content panel, find **value** under "List to-dos in a folder" and click it

---

## STEP 5: Build Each Task Object and Append

Inside the "Apply to each" loop:

1. Click **Add an action** (inside the loop)
2. Search for: `Append to array variable`
3. Click **Append to array variable**
4. **Name:** select `AllTasks`
5. **Value:** Click inside the Value field, then switch to the **Expression** tab and paste:

```
json(concat('{"title":"', replace(items('Apply_to_each')?['title'], '"', '\"'), '","listName":"Work","importance":"', items('Apply_to_each')?['importance'], '","status":"', items('Apply_to_each')?['status'], '","dueDateTime":"', if(empty(items('Apply_to_each')?['dueDateTime']), '', items('Apply_to_each')?['dueDateTime']?['dateTime']), '","body":"", "createdDateTime":"', items('Apply_to_each')?['createdDateTime'], '"}'))
```

**If the expression above is too complex or gives errors**, use this simpler alternative:

1. Instead of "Append to array variable", search for **Compose** and add it inside the loop
2. In the Compose Inputs, build it using Dynamic Content:
   - Click **Inputs**, then paste this template and fill in dynamic content:

```
{
  "title": [DYNAMIC: title],
  "listName": "Work",
  "importance": [DYNAMIC: importance],
  "status": [DYNAMIC: status],
  "dueDateTime": [DYNAMIC: due date/time],
  "body": "",
  "createdDateTime": [DYNAMIC: created date/time]
}
```

Replace each `[DYNAMIC: ...]` by clicking in that spot and selecting the matching field from the Dynamic Content panel under "List to-dos in a folder".

3. Then add **Append to array variable** after the Compose:
   - **Name:** `AllTasks`
   - **Value:** Select **Outputs** from the Compose step (Dynamic Content)

---

## STEP 6: Duplicate for Each List

Now you need to repeat Steps 3-5 for each of your other lists. The fastest way:

1. Click the **three dots (...)** on the "List to-dos in a folder" step → **Copy to my clipboard**
2. After the "Apply to each" block, click **+ New step** and paste

**OR** (easier approach) — just repeat Steps 3-5 six more times, changing:

| Repetition | List Dropdown | listName in the JSON |
|-----------|--------------|---------------------|
| 2nd | Personal | `"Personal"` |
| 3rd | House | `"House"` |
| 4th | Kids | `"Kids"` |
| 5th | Family | `"Family"` |
| 6th | Health | `"Health"` |
| 7th | Finance | `"Finance"` |

**Important:** Each "List to-dos" + "Apply to each" + "Append" block should be sequential (not nested inside each other). You'll have 7 separate blocks stacked vertically.

**Tip:** Power Automate will auto-rename duplicated actions (e.g., "Apply_to_each_2", "Apply_to_each_3"). That's normal and fine.

---

## STEP 7: Write the File to OneDrive

After ALL seven list blocks:

1. Click **+ New step**
2. Search for: `Create file` and select **Create file** (OneDrive for Business)
   - If you use personal OneDrive, select **OneDrive** instead
   - Sign in if prompted
3. Fill in:
   - **Folder Path:** Click the folder icon and navigate to:
     `Personal > Productivity > Life Command Center`
   - **File Name:** `todo-sync.json`
   - **File Content:** Click inside the field, then select `AllTasks` from Dynamic Content (under "Variables")

**Important: On subsequent runs, this will error because the file already exists.** To fix this:
- Delete the "Create file" step
- Instead, search for **Update file** (OneDrive for Business)
- Or search for **Create or update file** if available
- Use the same folder path and filename

---

## STEP 8: Save and Test

1. Click **Save** (top right)
2. Click **Test** (top right)
3. Select **Manually** → click **Run flow**
4. Wait for it to complete (30-60 seconds)
5. Check your OneDrive folder — you should see `todo-sync.json`

If all steps show green checkmarks, you're done!

---

## STEP 9: Sync to the App

1. Open `life-command-center.html` in your browser
2. Click **Settings** (top right of the app)
3. Click the blue **Select To Do Sync File** button
4. Navigate to your OneDrive > Personal > Productivity > Life Command Center folder
5. Select `todo-sync.json`
6. You'll see a green message: "X new tasks added, Y duplicates skipped"

From now on, the flow runs every hour. Whenever you want fresh tasks in the app, just click the sync button and pick the file again.

---

## Troubleshooting

**"The list was not found" error:**
The list name in To Do must EXACTLY match. Go to Microsoft To Do and verify you have lists named: Work, Personal, House, Kids, Family, Health, Finance.

**"File already exists" error on step 7:**
Switch from "Create file" to "Update file" or "Create or replace file". See Step 7 above.

**The loop says "No items":**
That list is empty in To Do — add a test task to it and run again.

**Dynamic content not showing:**
Click inside the field first, then look for the Dynamic Content panel on the right. If it doesn't appear, click "Add dynamic content" below the field.

---

## QUICK START (Minimum Viable Flow)

If the full 7-list setup feels overwhelming, start with just ONE list:

1. Recurrence (1 hour)
2. Initialize variable: AllTasks (Array)
3. List to-dos in a folder: **Work**
4. Apply to each → Append to array
5. Create file on OneDrive: todo-sync.json

Get that working first, then duplicate for the other 6 lists. You can always add them later.
