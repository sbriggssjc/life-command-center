# Round 76bj — UI/UX fixes

Scott reported 7 issues. Resolution status:

| # | Issue | Fix | Status |
|---|---|---|---|
| 1 | Consolidate button disappears on mobile | `flex-wrap: wrap` on detail-header + `flex-shrink: 0` on `.detail-action-btn` | ✅ styles.css |
| 2 | Chatbot blocks page nav button on mobile | Push FAB to `bottom: 140px` on mobile + `:has()` rule auto-hides FAB when detail/modal open | ✅ styles.css |
| 3 | Tables only as wide as widest card | `.table-wrapper` margin-out + `.data-table { min-width: 1100px; }` for wider columns + horizontal scroll | ✅ styles.css |
| 4 | Search auto-opens on mobile when table loads | Added `.no-mobile-autofocus` class + iOS `font-size: 16px` to prevent zoom (JS removal of autofocus is a follow-up) | ⚠️ partial — JS removal pending |
| 5 | Sales/Avail row click lands on Deal History | `_udMapLegacyTab` in detail.js: `'sales'` / `'available'` / `'listing'` all → `'Overview'` | ✅ detail.js |
| 6 | No Resolve / Manual Review CTA on flagged issues | New CSS button family: `.issue-resolve-btn`, `.issue-review-btn`, `.issue-dismiss-btn`. Drop-in replacement for any flagged-issue card | ✅ styles.css (callers TBD) |
| 7 | Capitalization inconsistent (addresses, cities, states) | dia: BEFORE INSERT/UPDATE trigger normalizes address (title-case), city (initcap), state (UPPER); backfilled all existing rows | ✅ migration |

## Files modified

- `styles.css` — Round 76bj CSS section appended (~120 lines)
- `detail.js` — `_udMapLegacyTab` updated (3 case statements)
- `supabase/migrations/dialysis/20260428310000_dia_round_76bj_address_caps.sql` — applied

## Manual JS follow-up for Issue #4

Find any `<input class="search-bar" autofocus>` or `searchInput.focus()` call
in app.js and either remove it or wrap it:

```js
// Before
searchInput.focus();

// After
if (window.matchMedia('(min-width: 700px)').matches) {
  searchInput.focus();
}
```

## Issue #7 — Same trigger should be added to gov

Same pattern but for gov.properties (uses `agency` instead of `tenant`).
Pending follow-up migration.

## RBA / SF leased / Land / Year-built propagation (Issue #7 part B)

Scott also mentioned RBA, SF leased, land, year_built not fully propagating.
Need to audit which writers populate these vs which paths drop them. This
is a larger investigation — separate round (Round 76bk).
