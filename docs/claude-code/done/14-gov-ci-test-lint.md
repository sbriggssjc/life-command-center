# Prompt 14 — government-lease CI: Test & Lint failing (68b293a)
- Priority: **P1** (red CI on the gov repo)
- Status: open (drafted 2026-08-01)
- Related: `error-triage-2026-08-01.md`; field_source_priority #710 also flagged gov.available_listings columns
- Response file: `../responses/14-gov-ci-test-lint.response.md`

## Prompt (copy/paste to Claude Code)
```
The government-lease repo's CI Pipeline failed on main (commit 68b293a): job "Test & Lint failed" with 2
annotations (the Monthly/Weekly/Quarterly/Daily/GSA-Sync pipeline jobs were skipped as downstream). Pull the two
Test & Lint annotations from that run, identify the root cause (lint error, failing unit test, or a schema/data
assertion), and fix it. Check whether it is related to the field_source_priority schema drift (#710) — that
audit also flagged gov.available_listings columns (asking_cap -> asking_cap_rate, listing_price, sold_cap_rate,
sold_price) — and if so coordinate with prompt 09's gov half. Get Test & Lint green and confirm the downstream
pipeline jobs run.
```

## Verify
government-lease CI Test & Lint passes on main; root cause reported; if schema-drift-related, gov columns
remapped consistently with prompt 09.
