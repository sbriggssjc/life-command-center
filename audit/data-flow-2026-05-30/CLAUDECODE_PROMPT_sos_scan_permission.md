# Claude Code (LCC extension) — the SOS scan fails: grant host permission to inject the scanner

**Root cause (confirmed in code).** The worklist's "Scan This Page" → `SCAN_PAGE` handler in
`extension/background.js` calls `chrome.scripting.executeScript({ target:{tabId}, files:
['content/public-records.js'] })` to inject the scanner into the active tab (the SOS page). But
the extension has **no host permission for SOS/county sites** — `manifest.json` `host_permissions`
lists only costar/salesforce/crexi/loopnet/rcanalytics/outlook/railway/supabase/csgpimgs. The
injection was relying on `activeTab`, but **`activeTab` is NOT granted from a side-panel button
click** (only from the toolbar action, a context menu, or a keyboard command). So `executeScript`
throws *"Cannot access contents of the page…"*, the handler's `catch` returns `{ok:false}`, and
the operator sees "scan failed immediately." The error surfaces only in the background
service-worker console, which is why the side-panel console looked clean.

## The fix — let the operator grant scan access to arbitrary SOS/county pages

The worklist targets all 50 states' SOS sites plus county assessors/recorders — an open-ended set
that can't be a static host list. Use a **runtime-requested broad injection permission**:

### Preferred: `optional_host_permissions` + one-time runtime request

1. In `manifest.json`, add
   ```json
   "optional_host_permissions": ["<all_urls>"]
   ```
   (leave the existing `host_permissions` as-is — minimal default footprint).
2. In the `SCAN_PAGE` path (or when the operator first clicks Scan), before `executeScript`,
   ensure the permission is held; if not, request it from the user gesture:
   ```js
   const need = { origins: [new URL(tab.url).origin + '/*'] };   // or ['<all_urls>']
   const has = await chrome.permissions.contains(need);
   if (!has) {
     const granted = await chrome.permissions.request(need);      // must be user-gesture-driven
     if (!granted) { respond({ ok:false, error:'Permission to read this SOS page was denied.' }); return; }
   }
   ```
   Requesting the **specific page origin** (`https://bizfileonline.sos.ca.gov/*`) is friendlier
   than `<all_urls>` — Chrome prompts "Allow LCC to read data on bizfileonline.sos.ca.gov?" and
   the grant persists, so subsequent scans on that site are silent. Over time the operator grants
   each SOS site once. If per-origin proves awkward, request `<all_urls>` once and be done.
   - **Gesture caveat:** `chrome.permissions.request` must run in a user gesture. If it can't be
     satisfied from the background message handler, move the `permissions.request` into the
     side-panel Scan click handler (`sidepanel.js`, where the gesture is) BEFORE sending
     `SCAN_PAGE`, then send the message once granted. Do whichever actually satisfies the gesture
     requirement — verify it works, don't assume.
3. Keep the existing dedicated-host refusal (costar/loopnet/etc.) unchanged.

### Acceptable fallback (if the runtime request can't be made to work cleanly)

Add `"<all_urls>"` (or a curated SOS/gov domain list) directly to `host_permissions`. This grants
injection at install with no per-site prompt, but Chrome will disable the extension until the
operator re-accepts the widened permissions on next load. For a private internal tool this is
acceptable; the runtime-request path is cleaner if achievable.

## Verify

1. `node --check` on touched files; extension loads without manifest errors.
2. On a CA bizfile entity **detail** record, click Scan → (first time) Chrome prompts to allow
   reading that site → Allow → the scanner injects, the editable capture form opens (pre-filled
   where parsed, blank+editable otherwise), and Save posts to `/api/sos-writeback`.
3. Second scan on the same site does NOT re-prompt (permission persists).
4. A denied prompt returns a clear "permission denied" message, not a silent failure.
5. Confirm the dedicated-host refusal (CoStar etc.) still works unchanged.

## Boundaries

Extension only (`manifest.json` + `background.js` and/or `sidepanel.js`) · reuse the existing
`SCAN_PAGE` → `executeScript` → `loadOrgView` path — only ADD the permission acquisition in front
of the injection · no server/API change · minimal default permissions (request broad access at
runtime, don't bake it into the install if avoidable) · ships on unpacked-reload (the operator
will re-accept permissions).

## Context

This is the actual blocker behind "scan failed / nothing happens" on bizfile. Everything else in
the Option-B SOS flow is built and confirmed live (front door, 887 owners, two-state recovery,
the worklist, Copy name, Not-in-state, the editable capture form, and the scan button itself —
DevTools confirmed it renders and fires). The one missing piece is host permission to inject the
scanner into the SOS page the operator navigated to. Also pending on a separate branch: pinning
the scan button to the persistent bottom bar so it stops scrolling off (cosmetic; this
permission fix is what makes the scan actually run).
