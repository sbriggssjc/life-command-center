# QA-12 — P2 omnibus: casing, calendar, FAB, header (P2)

**Severity: P2.** A bundle of small fixes from the 2026-05-18 in-browser
QA pass. Each one is a few lines; together they remove the most visible
"why does the dashboard look unfinished?" papercuts.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-12-p2-omnibus
node audit/patches/qa-12-p2-omnibus/apply.mjs --dry
node audit/patches/qa-12-p2-omnibus/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-12-p2-omnibus/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-12-p2-omnibus -m "Merge audit/qa-12-p2-omnibus"
git push origin main
```

## What ships

### 1. Address direction-suffix canonicalization (DATA FIX, both DBs)

**Before:** "1200 New Jersey Ave Se", "350 Massachusetts Ave Nw", etc.
**After:** "1200 New Jersey Ave SE", "350 Massachusetts Ave NW", etc.

- New helper `public.canonicalize_address_directions(text)` —
  IMMUTABLE, case-sensitive whole-word regex replace for
  `Se→SE / Sw→SW / Ne→NE / Nw→NW`.
- Backfill on `properties.address`. **Affected rows:**
  - gov (`scknotsqkcheojiaewwh`): **710** of 17,435
  - dia (`zqzrriwuavgrquhisnoa`): **450** of 15,194
- BEFORE INSERT/UPDATE trigger keeps future inserts canonical.

Verified live — property 3198 now stores "1200 New Jersey Ave SE".

### 2. AI Copilot FAB accessibility

`index.html` — adds `aria-label="Open AI Copilot"` to `#copilotFab`
so screen readers announce the button (the SVG icon is decorative).
The visible glyph was already present; only the a11y attribute was
missing.

### 3. Calendar zero-duration events

`app.js` `renderCalendarFull` — events with `start_time === end_time`
were rendering as "5:40 AM – 5:40 AM Essentia to Brokers" (these are
Outlook tasks ingested as zero-duration calendar entries). Now
render as `Task @ 5:40 AM` instead.

### 4. Detail panel header — duplicated city

`detail.js` (two header sites: the loading-state header at line ~117
and the fully-hydrated header at line ~480). The `page_title` often
embeds the city ("1200 New Jersey Ave SE – Washington, DC"), and
the subtitle was rendering "Washington, DC" again right below it.
The subtitle is now suppressed when its content is already a
substring of the title (case-insensitive).

### 5. Data Quality duplicate-candidate cluster cleanup

`ops.js` `renderDataQualityPage` — two issues:
- "Unnamed · 4 matches · CO · CO · CO · CO" — a parse-failure
  cluster where `canonical_name` is null and every member name is
  a 2-letter state code. **Suppressed entirely** with the
  `_qaIsParseDebris` predicate.
- "townebank · 3 matches · Townebank · Townebank · Townebank" —
  lowercase cluster label while children are Title Case.
  **Title-cased the label** via a small `_qaTitleCase` helper.

## What we explicitly did NOT change (deferred)

These were also flagged P2 but each is a bigger UI refactor than the
omnibus warrants. Captured as separate follow-ups:

- **Home Inbox cards inline actions** — currently the Home inbox
  rail has only "Open in Outlook ↗"; the dedicated Inbox PAGE has
  the full Triage/Promote/Assign/Dismiss action set. Mirroring the
  Inbox-page card markup onto the Home rail is a ~100-line change.
- **Messages page inline actions** — every row links out to Outlook.
  Adding even a "Promote to property" CTA is a non-trivial workflow
  refactor.
- **Research page widgets** — the Research page renders only
  "0 tasks", missing the LLC + Agency Drift widgets referenced in
  earlier sprint work. Decision needed on whether those move here
  or stay on their current surfaces.

## Files changed

- `supabase/migrations/government/20260518160000_gov_qa12_address_direction_caps.sql`
- `supabase/migrations/dialysis/20260518160000_dia_qa12_address_direction_caps.sql`
- `index.html` — FAB aria-label
- `app.js` — Calendar zero-duration render
- `detail.js` — header dedupe (two sites)
- `ops.js` — Data Quality cluster filter + Title-case
- `AUDIT_PROGRESS.md` (closeout)

Both SQL migrations applied live via Supabase MCP. Frontend changes
require a Vercel deploy to ship.

## Follow-ups

Three deferred items above (Home Inbox card actions, Messages page
actions, Research page widgets). Optional schema follow-up: also
canonicalize cardinal-only suffixes ("N", "S", "E", "W") and
ordinal prefixes — would need to be careful not to title-case
ordinary words like "St" / "Ave" / "Blvd" abbreviations that
already render correctly.
