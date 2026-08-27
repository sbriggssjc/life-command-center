# Salesforce Buyer Parent Mapping Worklog

## 2026-08-10

Objective: investigate the Decision Center buyer-parent Salesforce mapping card after a pasted Lightning Account URL produced `flow_http_error` for `0018W00002MMNwAQAX`.

Observed:
- The UI correctly extracts the `001...` Account Id from the Lightning URL.
- Manual validation calls `/api/decision-sf-search?id=<sf id>`, which routes to `getSalesforceAccountById()`.
- The ID lookup depends on the `SF_LOOKUP_WEBHOOK_URL` Power Automate operation `find_account_by_id`; a non-2xx response is surfaced as `flow_http_error`.
- The card already offers "Map by ID anyway", but the fallback candidate stores `Name: null`, so the mapping can land with an empty `sf_account_name` even though the card already knows the buyer-parent name.

Plan:
- Add an Account lookup fallback through the generic `SF_RECORD_LOOKUP_URL` record lookup flow when `find_account_by_id` fails or is not configured.
- Keep returning flow details for diagnosis instead of collapsing everything to `lookup_failed`.
- Preserve the visible parent name when the operator explicitly maps an unverified ID.

Verification target:
- Unit-test `getSalesforceAccountById()` fallback and failure detail behavior.
- Run focused Salesforce flow tests.

Live action:
- Applied the explicit screenshot mapping through the live decision-verdict API:
  decision `323` (`US Federal Properties Trust`) mapped to Salesforce Account `0018W00002MMNwAQAX`.
- Verified `lcc_buyer_parents.sf_account_id = 0018W00002MMNwAQAX`, `sf_account_name = US Federal Properties Trust`, and `needs_sf_mapping = false`.
- Verified decision `323` is `decided` with effects `{ lcc_buyer_parents: "mapped", external_identity: true }`.
- Left `USGBF (sponsor unconfirmed)` unmapped/unconfirmed because no Salesforce Account URL or sponsor confirmation was provided in the screenshot.
