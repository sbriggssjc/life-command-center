# Item #10 Phase A — Global error visibility

Closes the silent-failure surface across the app. Adds a central error
reporting helper, global error + unhandled-rejection handlers, missing
toast tier styles, and per-label rate limiting.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/10-global-error-visibility
node audit/patches/10-global-error-visibility/apply.mjs --dry
node audit/patches/10-global-error-visibility/apply.mjs --apply
git add -A
git commit -F audit/patches/10-global-error-visibility/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/10-global-error-visibility -m "Merge audit/10-global-error-visibility: global error visibility"
git push origin main
```

No SQL migration. No backend changes.

## Smoke test (in devtools console after deploy)

**1. Synthetic uncaught error:**
```js
setTimeout(() => { throw new Error('test uncaught'); }, 0);
```
Expected: red toast like "Something went wrong on this page. (test uncaught) [E-XXXX]" appears for ~3s. Console shows `[LCC E-XXXX] JS error`.

**2. Synthetic unhandled rejection:**
```js
Promise.reject(new Error('test rejection'));
```
Expected: red toast "A background task failed silently. Reload may help. [E-XXXX]". Console shows `[LCC E-XXXX] Unhandled promise rejection`.

**3. Rate-limit test:**
```js
for (let i = 0; i < 50; i++) {
  setTimeout(() => { throw new Error('spam ' + i); }, i * 50);
}
```
Expected: ~1 toast (rest suppressed). Every error still logs to console. Check the counter:
```js
window.lccErrorStats();
// → { "JS error": { count: 50, lastShownAt: "..." } }
```

**4. Migrate an existing call site (optional, smoke for the helper):**
Open any handler that does `if (typeof showToast === 'function') showToast('Failed: ' + e.message, 'error')` and replace with `lccReportError('Action label', e)`. Trigger the failure path. Same UX, plus rate-limited and tagged.

## Adoption guide

Existing pattern (~50 sites in `app.js`, `contacts-ui.js`, `detail.js`, etc.):
```js
try {
  await someAsyncThing();
} catch (e) {
  console.warn('Failed to load X:', e);
  if (typeof showToast === 'function') showToast('Failed: ' + e.message, 'error');
}
```

New pattern:
```js
try {
  await someAsyncThing();
} catch (e) {
  lccReportError('Load X', e);
}
```

Behavioral changes:
- Console output now includes an error code (`[LCC E-XXXX]`) the user can quote.
- Toast is rate-limited per label (max 1 / 10s). If "Load X" fails repeatedly, only the first toast shows; the rest are suppressed but still console-logged.
- Tiers available: `'error'` (default), `'warn'`, `'info'`, `'ok'`.
- Optional second arg: `{ tier, userMessage, silent, code }`.

Migration is one site at a time — no big-bang refactor required. The old pattern keeps working.

## What's next (Phase B, deferred)

- POST captured errors to a `client_errors` table on LCC Opps so we can aggregate, alert, and see error trends over time.
- Sweep the ~50 ad-hoc `console.warn + showToast` sites and migrate them to `lccReportError`.
- Extend the existing `.widget-error` retry pattern (used by Daily Briefing) to every list-loader `catch` block so list failures get a standard retry CTA.
- Sourcemap symbolication so production stack traces are readable.
