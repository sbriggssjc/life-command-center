# LCC Fix List — Round 2 (Remaining Items)

Three items remain from the original audit. Two are Supabase edge function changes, one is a minor app.js polish. The edge function source is in the `ai-copilot` function on the `Dialysis_DB` Supabase project (ID: `zqzrriwuavgrquhisnoa`). The function has 6 files: `index.ts`, `utils.ts`, `handlers-a.ts`, `handlers-b1.ts`, `handlers-b2.ts`, `deno.json`.

**IMPORTANT:** After making changes to ANY edge function file, you must deploy the updated function using the Supabase MCP tool `deploy_edge_function` with project_id `zqzrriwuavgrquhisnoa` and function_slug `ai-copilot`. Bundle ALL file changes into a single deploy.

---

## Fix 1: Activities Server-Side Deduplication (P2)

**Severity:** Medium — 678 raw rows come back for Scott Briggs / Open, but only 316 are unique. The rest are true duplicates (identical across every column including null `sf_task_id`) created by repeated syncs. Client-side dedup already handles this in `app.js` lines 3770-3778, but 53% of the payload is wasted bandwidth.

**File:** `handlers-b1.ts` — function `handleGetSFActivities()` (starts around line 47)

**Root cause:** The query on `salesforce_activities` does a plain `.select()` with no deduplication. The table contains duplicate rows from multiple sync runs with no unique constraint.

**Fix — Option A (preferred): Deduplicate in the edge function query response.** After the pagination `while` loop collects `allActivities` (around line 50, after the `while` block ends), add a dedup step before enrichment:

```typescript
// Deduplicate activities by composite key (subject + contact + company + date)
const seen = new Set<string>();
const dedupedActivities: unknown[] = [];
for (const a of allActivities) {
  const rec = a as Record<string, unknown>;
  const key = `${rec.subject}|${rec.first_name}|${rec.last_name}|${rec.company_name}|${rec.activity_date}`;
  if (!seen.has(key)) {
    seen.add(key);
    dedupedActivities.push(a);
  }
}
```

Then change the enrichment line to use `dedupedActivities` instead of `allActivities`:
```typescript
const enrichedActivities = (dedupedActivities as Record<string, unknown>[]).map(a => { ...
```

Also update the response to include both counts so the client knows dedup happened:
```typescript
return jsonResponse({
  activities: filteredActivities,
  count: filteredActivities.length,
  total_fetched: enrichedActivities.length,
  total_raw: allActivities.length,          // ADD THIS — raw count before dedup
  total_for_owner: totalCount,
  category_summary: categorySummary,
  filters: { assigned_to: assignedTo, status: statusFilter, category: category || 'all', search: search || null },
  offset,
  version: 52                               // BUMP version
});
```

**Fix — Option B (also do, if feasible): Clean up the table.** Run this SQL to delete duplicate rows, keeping only one per composite key:

```sql
DELETE FROM salesforce_activities a
USING salesforce_activities b
WHERE a.ctid < b.ctid
  AND a.subject IS NOT DISTINCT FROM b.subject
  AND a.first_name IS NOT DISTINCT FROM b.first_name
  AND a.last_name IS NOT DISTINCT FROM b.last_name
  AND a.company_name IS NOT DISTINCT FROM b.company_name
  AND a.activity_date IS NOT DISTINCT FROM b.activity_date
  AND a.assigned_to IS NOT DISTINCT FROM b.assigned_to
  AND a.status IS NOT DISTINCT FROM b.status;
```

Then add a unique index to prevent future duplicates:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_sf_activities_composite
ON salesforce_activities (
  COALESCE(subject, ''),
  COALESCE(first_name, ''),
  COALESCE(last_name, ''),
  COALESCE(company_name, ''),
  COALESCE(activity_date, '1900-01-01'::date),
  COALESCE(assigned_to, ''),
  COALESCE(status, '')
);
```

After adding the unique index, update the sync handler (`handleSyncActivities` in `handlers-a.ts`) to use `onConflict` in its upsert so future syncs don't fail on the constraint — or use `INSERT ... ON CONFLICT DO UPDATE`.

**Do both A and B.** A is the immediate fix (edge function dedup), B prevents the problem from recurring.

---

## Fix 2: Email Sender Display Names (P3)

**Severity:** Low-Medium — ~240 flagged emails show sender_name as a mailbox alias (e.g., "Sbriggssjc", "Account", "Klargent", "Rfowlkes", "PostMaster") or as the raw email address itself (e.g., "parentalchoice@tax.ok.gov", "hamilton@paulbunyan.net") instead of a human-readable name.

**File:** `utils.ts` — function `parseSenderName()` (line 68) and `handlers-b2.ts` — function `handleSyncFlaggedEmails()` (line 10, the name resolution SQL)

**Root cause — Two issues:**

**Issue A:** `parseSenderName()` (utils.ts line 68-82) returns whatever Outlook provides in `from.emailAddress.name`, which for many emails is just the mailbox alias (no spaces, not a real name). It doesn't validate whether the name looks like an actual person name.

**Issue B:** The post-sync name resolution SQL in `handleSyncFlaggedEmails()` (handlers-b2.ts line 10) has two UPDATE statements:
1. First tries to match `sender_email` against `salesforce_contacts.email` — good, but only fires when `sender_name IS NULL OR sender_name = ''`. Since `parseSenderName` already set it to the alias, this never fires.
2. Falls back to `INITCAP(REPLACE(SPLIT_PART(sender_email, '@', 1), '.', ' '))` — same problem, only fires when sender_name is null/empty.

**Fix for Issue A — Update `parseSenderName()` in `utils.ts`:**

Replace the current function (lines 68-82) with:
```typescript
export function parseSenderName(e: FlaggedEmail): string | null {
  // Try explicit fields first
  let name: string | null = null;
  if (e.SenderName) name = e.SenderName as string;
  else if (e.sender_name) name = e.sender_name as string;
  else {
    const fromVal = e.from;
    if (typeof fromVal === 'string' && fromVal) {
      const angleMatch = fromVal.match(/^(.+?)\s*<[^>]+>$/);
      if (angleMatch) name = angleMatch[1].trim().replace(/^["']|["']$/g, '');
    } else if (fromVal && typeof fromVal === 'object') {
      const addr = (fromVal as Record<string, unknown>)?.emailAddress as Record<string, string> | undefined;
      if (addr?.name) name = addr.name;
    }
  }

  // Validate: if name looks like a mailbox alias (no spaces, or matches common
  // non-name patterns), return null so the post-sync SQL can resolve it properly
  if (name) {
    const trimmed = name.trim();
    // Reject if: contains @, has no spaces and is lowercase/mixed without clear name pattern,
    // or is a known placeholder
    const PLACEHOLDERS = ['account', 'postmaster', 'noreply', 'no-reply', 'mailer-daemon', 'info', 'support', 'admin', 'award', 'cfo'];
    if (trimmed.includes('@')) return null;  // It's an email address, not a name
    if (PLACEHOLDERS.includes(trimmed.toLowerCase())) return null;
    if (!trimmed.includes(' ') && trimmed.length < 30) {
      // Single word — could be alias like "Sbriggssjc" or legit org like "GovTribe"
      // If it matches the local part of the sender email, it's definitely an alias
      const email = parseSenderEmail(e);
      if (email) {
        const localPart = email.split('@')[0].toLowerCase().replace(/[._-]/g, '');
        if (trimmed.toLowerCase().replace(/[._-]/g, '') === localPart) return null;
      }
      // Otherwise keep it (could be a brand name like "GovTribe", "RingCentral")
    }
    return trimmed;
  }
  return null;
}
```

**Fix for Issue B — Update the name resolution SQL in `handleSyncFlaggedEmails()` (handlers-b2.ts line 10):**

Change the WHERE clauses from `sender_name IS NULL OR sender_name = ''` to also catch alias-style names. Replace the two SQL statements with:

```typescript
let namesResolved = 0;
try {
  // Step 1: Resolve from Salesforce contacts (highest quality)
  await d.rpc("exec_sql", { query: `
    UPDATE flagged_emails fe
    SET sender_name = TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')))
    FROM salesforce_contacts c
    WHERE LOWER(fe.sender_email) = LOWER(c.email)
      AND fe.sender_email IS NOT NULL
      AND c.first_name IS NOT NULL
      AND TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) != ''
  ` });

  // Step 2: For remaining bad names, use formatted email local part
  await d.rpc("exec_sql", { query: `
    UPDATE flagged_emails
    SET sender_name = INITCAP(REPLACE(SPLIT_PART(sender_email, '@', 1), '.', ' '))
    WHERE sender_email IS NOT NULL
      AND (
        sender_name IS NULL
        OR sender_name = ''
        OR sender_name LIKE '%@%'
      )
  ` });

  namesResolved = 1;
} catch (e) {
  results.errors.push(`Sender name resolution: ${(e as Error).message}`);
}
```

Key change: Step 1 now **always** overwrites with a Salesforce contact match (removing the `sender_name IS NULL` guard), since the CRM data is authoritative. Step 2 catches any remaining email-address-as-name cases.

**Bump the version number** in the response from 51 to 52 (same as Fix 1).

---

## Fix 3: More Drawer Auto-Dismiss Timing (P3)

**Severity:** Low — purely visual polish

**File:** `app.js` — function `navToFromMore()` (line 354)

**Root cause:** The current code at lines 356-357 removes the `open` class from the drawer and overlay synchronously, then immediately manipulates DOM classes for the page transition. The CSS transition on the drawer (slide-down animation) plays concurrently with the page swap, creating a brief visual overlap where both the closing drawer and the new page content are visible simultaneously.

**Current code (lines 354-374):**
```javascript
function navToFromMore(pageId) {
  // Close more drawer
  document.getElementById('moreDrawerOverlay').classList.remove('open');
  document.getElementById('moreDrawer').classList.remove('open');
  // Deactivate all nav buttons
  document.querySelectorAll('.bnav').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.more-drawer-item').forEach(i => i.classList.remove('active'));
  // Activate the more drawer item
  const moreItem = document.querySelector(`.more-drawer-item[data-page="${pageId}"]`);
  if (moreItem) moreItem.classList.add('active');
  // Show the page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  ...
}
```

**Fix:** Hide the drawer instantly (no transition) before navigating, then restore the transition property afterward:

```javascript
function navToFromMore(pageId) {
  const overlay = document.getElementById('moreDrawerOverlay');
  const drawer = document.getElementById('moreDrawer');

  // Instantly hide drawer (skip CSS transition)
  drawer.style.transition = 'none';
  overlay.style.transition = 'none';
  overlay.classList.remove('open');
  drawer.classList.remove('open');

  // Force reflow so the instant hide takes effect
  void drawer.offsetHeight;

  // Restore transitions for next open
  drawer.style.transition = '';
  overlay.style.transition = '';

  // Continue with existing navigation logic (unchanged from here)
  document.querySelectorAll('.bnav').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.more-drawer-item').forEach(i => i.classList.remove('active'));
  const moreItem = document.querySelector(`.more-drawer-item[data-page="${pageId}"]`);
  if (moreItem) moreItem.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // ... rest of the function unchanged
```

---

## Deployment Checklist

1. **Edge function changes (Fixes 1 & 2):** Edit `handlers-b1.ts`, `handlers-b2.ts`, and `utils.ts`. Deploy via Supabase MCP `deploy_edge_function` with project_id `zqzrriwuavgrquhisnoa`, function_slug `ai-copilot`. All files must be included in the deploy payload.
2. **Database cleanup (Fix 1B):** Run the DELETE and CREATE INDEX SQL statements via Supabase MCP `execute_sql`.
3. **Frontend change (Fix 3):** Edit `app.js` in the repo, commit, and deploy to Vercel.
4. **Verify:** After deploy, hit `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/sf-activities?assigned_to=Scott%20Briggs&status=Open` and confirm `total_raw` > `total_fetched` (dedup working) and version = 52.
