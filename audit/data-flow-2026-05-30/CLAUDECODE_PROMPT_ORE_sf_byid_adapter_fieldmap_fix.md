# Claude Code (LCC) — fix the SF-by-id adapter field mapping (resolver guard-rejects valid contacts)

## Symptom (verified live 2026-07-15)

The SF WhoId-resolver (PR #1406) is deployed and running: `sf-contact-resolve-tick`
returns `byid_configured: true`, calls the "SF Get Contact By Id" flow, and the flow
**succeeds and returns a clean, complete payload** — but every contact comes back
`guard_rejected` → marked `no_data`, minting/reconciling nothing.

**Ground truth — the flow's Response body (confirmed in the Power Automate run history) is
lowercase-keyed and correct:**
```json
{
  "id":           "0038W00002PRqkNQAT",
  "name":         "Eric Dowling",
  "email":        "edowling@boydwatterson.com",
  "first_name":   "Eric",
  "last_name":    "Dowling",
  "phone":        "3127773704",
  "title":        "Analyst",
  "account_id":   "0018W00001dRmM1QAK",
  "account_name": "Arbor Realty Trust"
}
```
Both Joseph Capra (`0038W00002PRo0iQAD`) and Eric Dowling (`0038W00002PRqkNQAT`) returned
clean `name` + `email` like the above, yet both were `guard_rejected`. These are plainly
plausible person names — the guard should NOT reject them.

## Root cause (almost certainly a field-name mismatch)

`getSalesforceContactById` (in `salesforce.js`) must map the flow's **lowercase** keys
(`name`, `email`, `first_name`, `last_name`, `phone`, `title`, `account_id`,
`account_name`) to whatever `defaultResolveOrCreateSfContact` / `ensureEntityLink` expects.
If the adapter reads a different shape (e.g. capitalized `Name`/`Email`, a nested
`contact` object, or SF-raw `FirstName`/`LastName`), the resolved `name` is **null** → the
person guard treats an empty/undefined name as implausible → `guard_rejected`. That
matches the symptom exactly (a *clean* name in the flow, a *rejected* name in LCC ⇒ the
name never reached the guard).

## The fix
1. **Align `getSalesforceContactById` to the flow's actual (lowercase) response keys** above
   — read `name`/`email`/`first_name`/`last_name`/`phone`/`title`/`account_id`/`account_name`
   (be tolerant: accept both the lowercase keys AND capitalized `Name`/`Email`/`FirstName`…
   so a future flow tweak won't rebreak it). Confirm the mapped object is exactly the shape
   `resolveOrCreateSfContact` reads for the mint (name/email/first/last/phone/title) and
   `sfContactAccountMismatch` reads for the flag (email + account_name).
2. **Distinguish a genuine guard-reject from a null/empty name.** If the resolved name is
   empty (adapter mismatch or the flow returned nothing), that's `no_data`/`no_name`, NOT
   `guard_rejected` — so the honest outcome + queue status is accurate and a real
   junk-name is still labeled `guard_rejected`. (The current mislabel hid the field-map bug.)
3. Add/adjust a unit test with the **exact lowercase payload above** → asserts the adapter
   yields `{name:'Eric Dowling', email:'edowling@boydwatterson.com', account_name:'Arbor
   Realty Trust', ...}` and that `resolveOrCreateSfContact` mints/attaches (not guard-reject).

## Verify (Cowork, post-deploy)
The two WhoIds are already in `sf_contact_resolve_queue` (currently `no_data`). After the
fix ships, Cowork resets them to `status='seen'` and re-drains: expect **Joseph Capra
mints onto Boyd** with a `salesforce/Contact` identity, the **SF Eric Dowling merges by
email into the existing CoStar/RCA Dowling** (one entity, no dup), and the
**`sf_contact_account_mismatch` lane surfaces Dowling-on-"Arbor Realty Trust"**
(account_name contradicts the @boydwatterson.com email). Boundaries unchanged: LCC-Opps
only, SF read-only, no fabrication, ≤12 api/*.js.

## Bottom line
The PA flow is verified correct end-to-end (returns clean name/email/account_name, 200).
The resolver's by-id adapter isn't reading the flow's lowercase keys, so the name arrives
null and the guard rejects it. Map the fields, stop mislabeling a null name as
`guard_rejected`, and Capra/Dowling resolve.
