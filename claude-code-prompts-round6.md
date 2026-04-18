# Claude Code Prompts — Round 6

Targets remaining issues from Round 5 verification plus new user-reported email link pain point. Ordered by user priority: email links first.

> **Hard constraints (read before touching /api/):**
> - Vercel Hobby: max 12 `.js` files in `/api/`. We are AT the limit. Do NOT create a 13th.
> - Add new handlers under `/api/_shared/` or `/api/_handlers/` and route via `?action=` or `?_route=`.
> - See `.github/AI_INSTRUCTIONS.md` and `CLAUDE.md` for routing rules.
> - After any `/api/` change: `ls api/*.js | wc -l` must be ≤ 12.

---

## R6-1 — Email links open Outlook Desktop, not Web App (and stop "moved or deleted" errors)

**Problem (user reported):**
Every email link in LCC (Briefing, Inbox, Contact drawers, Pipeline cards, Today's Emails) currently opens in **Outlook Web App** (`outlook.office.com/mail/...`). Scott wants them to open in the **Outlook Desktop client**. Additionally, many links surface a **"This email has been moved or deleted"** error — the Graph REST id we store becomes invalid as soon as the message moves folders (e.g., Archive → Inbox, Focused → Other, or any rule-based move).

**Root cause:**
1. `outlookWebLink()` in `app.js` (~lines 303–321) builds `https://outlook.office.com/mail/deeplink/read/{graph_rest_id}` URLs. That scheme is web-only.
2. Graph REST ids are **not stable** across folder moves. The stable identifier is `internet_message_id` (RFC 5322 `Message-ID` header), which we already store in `inbox_items.metadata.internet_message_id` (and sometimes as a top-level column).
3. There is no desktop-protocol handoff. Outlook Desktop registers the `ms-outlook:` / `outlook:` URL schemes on Windows and macOS when installed, but we never emit them.

**Fix (in `app.js`):**

1. Replace `outlookWebLink()` with a new helper `outlookLinks(email)` that returns **both** a desktop URL and a web fallback, preferring stable identifiers:

   ```javascript
   // Build both desktop (ms-outlook:) and web fallback links.
   // Prefer internet_message_id (stable across folder moves) over graph rest id.
   function outlookLinks(email) {
     if (!email) return { desktop: '', web: '' };

     const meta = email.metadata || {};
     const inetId =
       email.internet_message_id ||
       meta.internet_message_id ||
       meta.message_id ||
       '';
     const restId =
       meta.graph_rest_id ||
       email.graph_rest_id ||
       email.id ||
       email.email_id ||
       '';
     const rawWeb =
       email.web_link ||
       email.external_url ||
       email.outlook_link ||
       '';

     // ---- Desktop (ms-outlook: protocol) ----
     // Outlook Desktop registers these handlers on Windows/macOS when installed.
     // `ms-outlook://restoremail?...` is the modern "New Outlook" scheme.
     // Classic Outlook responds to `outlook:` with an EntryID, which we don't have,
     // so we use the search-by-messageid fallback which both clients honor.
     let desktop = '';
     if (inetId) {
       // Strip angle brackets if present; Outlook dislikes them in the URL.
       const cleanId = String(inetId).replace(/^<|>$/g, '');
       desktop = `ms-outlook://emails/open?messageId=${encodeURIComponent(cleanId)}`;
     } else if (restId) {
       desktop = `ms-outlook://emails/open?id=${encodeURIComponent(restId)}`;
     }

     // ---- Web fallback ----
     let web = '';
     if (rawWeb) {
       // Normalize legacy OWA host to modern one.
       web = rawWeb
         .replace('https://outlook.office365.com/owa/', 'https://outlook.office.com/mail/')
         .replace('outlook.office365.com/mail/', 'outlook.office.com/mail/');
     } else if (inetId) {
       // Searching by Message-ID finds the email wherever it lives now.
       const cleanId = String(inetId).replace(/^<|>$/g, '');
       web = `https://outlook.office.com/mail/inbox/search/${encodeURIComponent('"' + cleanId + '"')}`;
     } else if (restId) {
       web = `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(restId)}`;
     }

     return { desktop, web };
   }

   // Back-compat shim so existing call sites keep compiling while we migrate.
   function outlookWebLink(email) {
     return outlookLinks(email).desktop || outlookLinks(email).web || '';
   }
   ```

2. Add a click handler that **tries desktop first, falls back to web** after a short timeout (desktop protocol handoff is silent on failure):

   ```javascript
   // Attach to window so inline onclick= works; also used by addEventListener wiring.
   window.openOutlookEmail = function (evt, desktopUrl, webUrl) {
     if (evt && evt.preventDefault) evt.preventDefault();
     if (!desktopUrl && !webUrl) return false;

     // If no desktop URL, just open web.
     if (!desktopUrl) {
       window.open(webUrl, '_blank', 'noopener');
       return false;
     }

     // Detect whether the protocol handoff succeeded. If the tab loses focus
     // within ~1200ms, the desktop app grabbed it. Otherwise, open web fallback.
     let handed = false;
     const onBlur = () => { handed = true; };
     window.addEventListener('blur', onBlur, { once: true });

     // Use a hidden iframe to avoid navigating the top frame on failure.
     const frame = document.createElement('iframe');
     frame.style.display = 'none';
     frame.src = desktopUrl;
     document.body.appendChild(frame);

     setTimeout(() => {
       window.removeEventListener('blur', onBlur);
       try { frame.remove(); } catch (_) {}
       if (!handed && webUrl) {
         window.open(webUrl, '_blank', 'noopener');
       }
     }, 1200);

     return false;
   };
   ```

3. Update **every** call site that currently emits an email link. Grep for `outlookWebLink(`, `deeplink/read`, `outlook.office`, and any `<a href=` that references `email.web_link` / `email.external_url`. Replace with:

   ```javascript
   const links = outlookLinks(email);
   // In the template:
   `<a href="${escapeAttr(links.web)}"
       onclick="return openOutlookEmail(event, ${JSON.stringify(links.desktop)}, ${JSON.stringify(links.web)})"
       target="_blank" rel="noopener">Open in Outlook</a>`
   ```

   Known call sites to audit (at minimum):
   - `renderBriefingEmails()` (Briefing tab email cards)
   - `renderInboxTab()` / `renderInboxList()` (Inbox)
   - `renderContactDetailOverlay()` → recent emails section
   - `renderPipelineCardEmails()` (Pipeline hover/expand)
   - `renderTodaysEmails()` (Home quick card)

4. **Backend hardening** (`/api/sync.js` handler for `flagged_emails` and any `inbox_items` read path): when projecting rows to the frontend, always include `internet_message_id` at the top level:

   ```javascript
   // Inside the select/map for inbox_items:
   internet_message_id: row.internet_message_id || row.metadata?.internet_message_id || null,
   graph_rest_id:       row.metadata?.graph_rest_id || row.id || null,
   ```

   If the Supabase edge function (`ai-copilot`) doesn't currently persist `internet_message_id` into `inbox_items.metadata`, add that field to the Graph → DB mapper (it's `message.internetMessageId` in Graph's JSON).

5. **Acceptance checks:**
   - Click any email link in Briefing, Inbox, Contact drawer, Pipeline. Outlook Desktop opens to the correct message. No "moved or deleted" error even for messages that were archived/moved after ingestion.
   - If Outlook Desktop is not installed (test in a fresh Chrome profile), the link falls back to the web search-by-message-id URL and still lands on the correct message.
   - No console errors from the iframe handoff.

---

## R6-2 — Email sync endpoint regressed to `db_query_failed`

**Problem:**
R5-5 attempted to harden `/api/sync.js` → `flagged_emails` GET. Prior behavior: returned HTTP 200 with `{ items: [], count: 0 }`. Current behavior: returns HTTP 500 `{ error: "db_query_failed" }`. Frontend now shows the error banner instead of the empty state.

**Investigate:**
1. Read `/api/sync.js` lines ~259–324 (the `flagged_emails` GET branch).
2. Check the exact Supabase query — most likely suspects:
   - `.eq('archived', false)` against a column that doesn't exist.
   - `.order('received_at')` against a column renamed to `received_datetime` or similar.
   - `.select('internet_message_id, ...')` where the column is only on `metadata`.
3. Run the query directly via the Supabase MCP against the OPS project on the `inbox_items` table to see the real error. Do NOT guess.
4. Wrap the query in a try/catch that logs the PostgREST error `message`, `details`, `hint`, and `code` to Vercel logs — currently the error is swallowed.

**Fix:**
- Restore a working `select` that only touches columns that actually exist (verify with `list_tables` or a `select *` LIMIT 1 first).
- On any DB error, return HTTP 200 with `{ items: [], count: 0, degraded: true, reason: err.message }` so the UI keeps rendering the empty state instead of a red banner.

**Acceptance:**
- `curl .../api/sync?action=flagged_emails` returns 200.
- Briefing tab "Flagged Emails" section renders with either real rows or the empty state — no red error card.

---

## R6-3 — Properties "Avg Building SF" shows "—"

**Problem (R5-2 unresolved):**
The Properties tab aggregate header card for "Avg Building SF" shows `—`. Other aggregates (count, avg year built) render fine, so the query runs; the column read is wrong.

**Investigate:**
1. In `dialysis.js` around line ~5337, find the query that projects properties for aggregation. Grep for `building_sf`.
2. Verify the actual column name in the DIA `properties` table via Supabase MCP `list_tables` / `execute_sql "select column_name from information_schema.columns where table_name='properties'"`. Likely candidates: `bldg_sf`, `rba`, `building_size_sf`, `sqft`.
3. Update the select and the JS aggregator (`d.building_sf`) to match the real column. If multiple candidate columns exist, prefer `rba` (rentable building area), then fall back.

**Acceptance:**
- Properties tab shows a real number for Avg Building SF (e.g., "7,842 SF"), and the value matches a hand-run AVG query on the underlying column.

---

## R6-4 — Touchpoint counts are zero for Sarah Martin & Nathanael Berwaldt

**Problem (R5-6 unresolved):**
Contact detail drawer for Sarah Martin and Nathanael Berwaldt shows Touchpoints = 0 despite clearly-visible email threads with both contacts in `inbox_items`.

**Investigate:**
1. Find the touchpoint query in `/api/entity-hub.js` or `/api/_handlers/contacts.js`. Grep for `touchpoint`, `touch_points`, `interactions`.
2. The join is almost certainly on `contacts.email = inbox_items.from_email` but those two contacts have multi-address (`sarah.martin@… / smartin@…`) or name-only matching. Confirm by running:
   ```sql
   select from_email, to_emails, count(*)
   from inbox_items
   where from_email ilike '%martin%' or to_emails::text ilike '%martin%'
   group by 1,2 order by 3 desc;
   ```
3. If the contact has multiple email aliases stored in `contacts.email_aliases` (or similar), the query must join against the alias set, not just `contacts.email`.

**Fix:**
- Expand the touchpoint query to join on **any** of a contact's known email addresses. If there's no aliases table/column, create one (OPS Supabase): `alter table contacts add column if not exists email_aliases text[] default '{}'` and seed it from observed `from_email`/`to_emails` matches.
- Also match on `reply_to` and the address portion of `to_emails` / `cc_emails` (parse display-name-wrapped addresses).

**Acceptance:**
- Sarah Martin and Nathanael Berwaldt show non-zero touchpoint counts matching the number of `inbox_items` rows that reference any of their addresses.

---

## R6-5 — Dialysis & Government Highlights contain duplicates

**Problem:**
`buildDomainSignals()` in `/api/daily-briefing.js` (~lines 858–892) iterates `[...myWork, ...inboxSummary.items]` and pushes every matching title into `govHighlights` / `diaHighlights`. When an item appears in both `myWork` and `inboxSummary.items` (common for open tasks tied to recent emails), it gets listed twice.

**Fix:**
Add dedup keyed on a stable identifier, preferring `id` → `external_id` → normalized title:

```javascript
function buildDomainSignals(myWork, inboxSummary, unassignedWork, hotContacts, diaPipeline) {
  const govHighlights = [];
  const diaHighlights = [];
  const seenGov = new Set();
  const seenDia = new Set();

  const keyFor = (item) =>
    item.id ||
    item.external_id ||
    item.task_id ||
    (item.title ? String(item.title).trim().toLowerCase() : null);

  const allOpsItems = [...(myWork || []), ...(inboxSummary.items || [])];
  for (const item of allOpsItems) {
    const domain = inferDomain(item);
    const k = keyFor(item);
    const title = item.title || '(Untitled)';
    if (domain === 'government' && k && !seenGov.has(k)) {
      seenGov.add(k);
      govHighlights.push(title);
    }
    if (domain === 'dialysis' && k && !seenDia.has(k)) {
      seenDia.add(k);
      diaHighlights.push(title);
    }
  }
  // ... rest unchanged
}
```

**Acceptance:**
- No duplicate titles in Briefing → Domain Highlights for either Gov or Dialysis.

---

## R6-6 — Market Intelligence highlights show "(Untitled)"

**Problem:**
The Market Intelligence card in the Briefing shows several `(Untitled)` entries. These come from the same `buildDomainSignals` path or from `global_market_intelligence` fallback when items are missing `title`.

**Fix:**
1. In `buildDomainSignals` and the `global_market_intelligence` fallback (`/api/daily-briefing.js` ~lines 956–984), **skip** items that have no derivable title:
   ```javascript
   const title = item.title || item.subject || item.name || item.headline;
   if (!title || String(title).trim() === '') continue;
   ```
2. If the upstream data genuinely has no title for a record (check 2–3 sample rows via Supabase MCP), backfill a synthetic title at the source: `"Email from {sender_name}"`, `"Task: {task_type}"`, etc., depending on the item type.

**Acceptance:**
- Zero `(Untitled)` entries visible anywhere in the Briefing UI.

---

## R6-7 — Properties states facet contains junk values (97 states)

**Problem:**
Properties tab state filter dropdown has **97** entries including `AD`, `AG`, duplicate `AL`, and other non-US codes. Real answer should be ~50 (+ DC, PR, territories).

**Investigate:**
1. Find the distinct-states query (likely in `dialysis.js` property loading, or `/api/_handlers/properties.js`). Grep for `distinct` and `state`.
2. Check raw data:
   ```sql
   select state, count(*) from properties group by 1 order by 1;
   ```
   Expect to see: lowercase `al` vs uppercase `AL` duplicates, leading/trailing whitespace, full names (`Alabama`), and foreign codes.

**Fix:**
- Normalize at query time: `upper(trim(state))` and filter to the canonical 50 states + DC + US territories set. In the frontend dropdown builder, pass the list through a whitelist:
  ```javascript
  const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP']);
  const cleanStates = rawStates
    .map(s => String(s || '').trim().toUpperCase())
    .filter(s => US_STATES.has(s));
  const uniqueStates = Array.from(new Set(cleanStates)).sort();
  ```
- Also write a one-off OPS migration to normalize the underlying column so the cleanup is permanent:
  ```sql
  update properties set state = upper(trim(state)) where state is not null;
  ```

**Acceptance:**
- State dropdown shows ≤ 56 entries, all valid US codes, no duplicates.

---

## R6-8 — Team Signals still shows Open: 0 / Overdue: 0

**Problem (R5-4 partial):**
`mv_work_counts` refresh fixed the aggregate but the Team Signals strip on the Briefing still renders `Open: 0, Overdue: 0`. The MV has non-zero rows when queried directly.

**Investigate:**
1. Read `/api/daily-briefing.js` `fetchWorkCounts()` (~lines 113–151). Confirm which materialized view and columns it selects.
2. Run the same query the function runs directly via Supabase MCP. If the MV returns rows but `fetchWorkCounts` returns 0, the issue is field mapping (e.g., `count_open` vs `open_count`).
3. Check whether the Briefing response `global_signals.team` object is being consumed correctly by the frontend — grep `team_signals`, `teamSignals`, `global_signals.team` in `app.js`.

**Fix:**
- Align the field names end-to-end: API returns `{ open, overdue, due_today }`, frontend reads `briefing.global_signals?.team?.open`. Pick one shape and enforce it in both places.
- Add a `debug` field on the API response temporarily so we can see the raw MV row in the network tab during verification.

**Acceptance:**
- Team Signals strip shows the same numbers as `select sum(open_count), sum(overdue_count) from mv_work_counts;`.

---

## Deploy & verify checklist

After merging:
1. `ls api/*.js | wc -l` → must be ≤ 12.
2. Hit each endpoint with `curl`:
   - `/api/sync?action=flagged_emails` → 200, no `db_query_failed`.
   - `/api/daily-briefing` → check `global_signals.team`, `domain_highlights.government`, `domain_highlights.dialysis`, `global_market_intelligence` for dedup and no `(Untitled)`.
   - `/api/entity-hub?action=contact&id={sarahMartinId}` → touchpoints > 0.
3. Load LCC in a fresh Chrome profile:
   - Click an email link → Outlook Desktop opens to the correct message.
   - Archive that same email in Outlook, then click the LCC link again → still opens the correct message (no "moved or deleted").
   - Properties tab → Avg Building SF shows a real number.
   - Properties state dropdown → ≤ 56 US state codes.
   - Briefing Team Signals → non-zero Open/Overdue counts matching DB.
4. Commit message: `Round 6 — email desktop links, sync regression, properties + highlights cleanup`.
