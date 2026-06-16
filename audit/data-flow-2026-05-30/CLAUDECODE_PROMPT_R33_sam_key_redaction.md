# Claude Code (GovernmentProject) — R33: redact + scrub the leaked SAM.gov API key

## Why (grounded live 2026-06-16 via the MCP pipeline-health tool + gov DB)
The SAM.gov lease-opportunities ingest logs its full request URL on error, including
`?api_key=SAM-…`. As a result the **API key is sitting in plaintext** across ~60 gov-DB
rows: **6 `ingestion_tracker.error_log`** + **54 `ingestion_run_errors`** (error_message /
stack_trace / record_context). The ingest is also **failing 401** (key invalid/expired; 37
runs, last failed 2026-06-15) — so the leaked key is likely already dead, but it leaked and
must be treated as compromised.

**Out of scope for code (Scott does this):** rotate the key at SAM.gov and set the new
value in the GovernmentProject env (`SAM_API_KEY`). That clears the 401 and retires the
leaked key. R33 is purely the redaction + scrub so a key can never sit in the DB again.

## Unit 1 — never log the key again (redaction at the source)
- In `ingest_sam_opportunities.py` (and any shared error logger in `public_data_utils.py`
  that records the request URL / exception text), mask the key before ANY log/DB write:
  replace `api_key=<value>` (and a bare `SAM-[A-Za-z0-9-]+`) with `api_key=***` /
  `SAM-***`. A single `redact_secrets(text)` helper applied on every path that writes to
  `error_log` / `ingestion_run_errors` / stdout logs.
- Prefer not to put the key in the URL at all if the SAM API accepts it via header — but
  SAM.gov uses the `api_key` query param, so redaction-on-log is the real defense. Keep the
  key sourced from env only (confirm it's `os.environ['SAM_API_KEY']`, never hardcoded).
- Apply the same `redact_secrets` to any other ingest that puts a key in a query string
  (scan the `ingest_*.py` family — FRED/Census/BLS/USAspending often do too) so this class
  of leak is closed, not just SAM.

## Unit 2 — scrub the ~60 existing exposed rows (one-time, idempotent)
- A migration/script that regex-replaces the key pattern in place:
  `regexp_replace(col, 'SAM-[A-Za-z0-9-]+', 'SAM-***', 'g')` and
  `regexp_replace(col, 'api_key=[^& "'']+', 'api_key=***', 'g')` on
  `ingestion_tracker.error_log`, and `ingestion_run_errors.error_message` /
  `stack_trace` / `record_context::text`. Scope to rows matching the pattern (the ~60).
  Preserve the rest of the error text (diagnostics stay; only the secret is masked).
  Idempotent (re-running redacts nothing new). Verify 0 rows match `SAM-[A-Za-z0-9-]{6,}`
  after.

## Guards / house rules
- GovernmentProject repo (Python), follows its git workflow (feature branch, tests, merge
  note). No LCC `api/*.js` involved.
- Don't break the ingest logic — only the logging/redaction changes. After Scott sets the
  rotated key, the 401 clears on the next run; R33 doesn't depend on the key being valid.
- Add a unit test for `redact_secrets` (key in URL, bare SAM- token, no-key passthrough).

## Verify
- After deploy + scrub: `SELECT count(*) FROM ingestion_run_errors WHERE
  error_message ~ 'SAM-[A-Za-z0-9-]{6,}'` = 0 (and same for tracker.error_log); a forced
  SAM run logs `api_key=***` on any error, never the value.
- Once Scott rotates + sets `SAM_API_KEY`, the pipeline-health tool shows SAM ingest
  succeeding again (no 401).

## Bottom line
A real (if low-blast-radius, since the key is 401-dead) credential leak: the SAM key is in
~60 DB error rows. R33 masks-on-log so it can't recur, scrubs the existing rows, and
generalizes the redaction to the other key-in-querystring ingests. Key rotation is Scott's
one manual step.
