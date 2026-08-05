# Prompt 53 — Confirm/land 48 & 49 (generate_comps still runs pre-fix code)

## Why (live acceptance test, 2026-08-05)
`generate_comps` still fails identically to before Prompts 48/49: HTTP 500 `shared column widths differ … [('PATIENTS', 10.0, 13.0)]`, and subject resolution still collapses to a place on non-appraisal phrasing. Checking origin/`main`: there are **no 48 or 49 commits on main** (tip is a docs commit on top of the 47 merge), and no branch matching the 48/49 work was found among 884 branches. So the fixes never actually merged — the redeploy is serving pre-48/49 code, which is why the connector can't build the workbook and Scott's exports are being hand-assembled each round.

## Task
1. Confirm the state of the 48 (builder conformance: re-apply the shared-width contract AFTER the LibreOffice recalc, preserving cached values — the PATIENTS 10↔13 desync) and 49 (subject resolution: extract the street address and resolve to the property regardless of phrasing; keep national scope; propagate the hydrated cap into `subject.fields`) work: are there open PRs, and against which base?
2. If not merged, re-apply and merge 48 and 49 to `main` (they are specified in `docs/claude-code/done/48-*.md` and `done/49-*.md`), then redeploy BOTH Railway services (tranquil-delight for comps-tools.js / 49; the BOV generator for bov-generator/ / 48).
3. Re-run the acceptance test: `generate_comps` for "The Villages DaVita — 1050 Old Camp Rd" returns a conforming workbook (no 500), subject resolved (6,453 SF / 12 chairs / ~2038 / 6.75%) and excluded, both phrasings.

## Verify
- `generate_comps` returns a workbook with no conformance 500.
- `synthesize_comps` with non-appraisal wording resolves the subject to property_id 31964 (not a place) with cap 6.75%.
