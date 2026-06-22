# Claude Code — R52b: stop masking Salesforce flow errors (the `.slice is not a function` bug)

## Why (live Activation-5 drain, 2026-06-21)
The R52 contact-writeback went live. The dedup/mirror path works end to end (an existing SF
contact was matched by email and its `external_identities (salesforce, Contact)` mirrored back).
But the **create path** failed for 2 candidates, and the worker reported a useless reason:
`((intermediate value) || (intermediate value) || text || "").slice is not a function`.

Root cause — `api/_shared/salesforce.js` `callSfLookupFlow`, the non-2xx branch:

```js
if (!res.ok) {
  return {
    ok: false,
    reason: 'flow_http_error',
    status: res.status,
    detail: (json?.error || json?.detail || text || '').slice(0, 300),   // ← line 86
  };
}
```

When the PA flow returns a non-2xx, the body's `error` is an **object** (e.g.
`{ "code": "...", "message": "Object with id '003...' does not exist" }`), so
`(json.error || ...).slice(0,300)` calls `.slice` on an object → throws `TypeError: ... .slice is
not a function`. The worker catches it and reports the TypeError as the outcome, **masking the real
Salesforce error** (which we only recovered by reading the PA run history: "Action 'Create_record_1'
failed: Object with id '003Vs000015j8hMIAQ' does not exist" — an org-side Contact-insert automation
issue, NOT our code).

## Fix (small, surgical, defensive)
Make the error detail robust to object/non-string values everywhere a flow error is summarized.

1. In `callSfLookupFlow` (non-2xx branch), coerce to a string before `.slice`, and dig out the
   common nested SF message shapes:
   ```js
   const pickMsg = (v) =>
     typeof v === 'string' ? v
     : (v && typeof v === 'object')
       ? (v.message || v.error_description || v.errorMessage
          || (Array.isArray(v) ? pickMsg(v[0]) : '') || JSON.stringify(v))
       : '';
   const detailRaw = pickMsg(json?.error) || pickMsg(json?.detail) || (typeof text === 'string' ? text : '') || '';
   return { ok: false, reason: 'flow_http_error', status: res.status, detail: String(detailRaw).slice(0, 500) };
   ```
   (Salesforce connector errors commonly arrive as `{error:{message}}`, `{message}`, or an array of
   `{message}` — handle those; never call `.slice` on a non-string.)
2. Apply the same `String(...)` guard to the `if (!json || json.ok !== true)` branch's `detail`
   (`json?.detail` can also be an object) so it can't throw either.
3. Audit `salesforce.js` for any other `(... || ...).slice(...)` on a possibly-non-string and guard
   them the same way (line ~86 is the known one; the date helpers at 44/56/64 are fine).
4. Ensure the contact-writeback worker records this `detail` in its per-item `reason` so the real SF
   message surfaces in the tick response (it already returns `reason`; just make sure the richer
   `detail` rides along — e.g. `reason: result.reason, detail: result.detail`).

## Verify
- Unit test `callSfLookupFlow`-style: a non-2xx response whose JSON body is
  `{ error: { message: "Object with id '003x' does not exist" } }` → returns
  `detail: "Object with id '003x' does not exist"` (no throw); an array-shaped
  `{ error: [{ message: "X" }] }` → `detail: "X"`; a plain-text body → that text; a null body →
  `''`. No `.slice is not a function` under any shape.
- `node --check`; ≤12 api/*.js; suite green.

## Bottom line
A one-spot robustness fix so a Salesforce/PA flow error is reported as the actual Salesforce message
instead of a TypeError. This doesn't change the writeback logic — it makes failures legible. (The
current live create-path failure itself is an org-side Contact-insert automation referencing a
deleted record id — a Salesforce admin fix, separate from this code change.)
