# Prompt 109 — draft-assist: flag-gate consistency (env-OR-registry) + fact-validator false-positive

**Status: DONE (2026-08-14).** One PR, additive + reversible.

## Part A — flag consistency (the bug)
`api/draft-assist.js:260` gated POST-save on `flagOn(process.env.DRAFT_ASSIST)` only — no registry
fallback — so Cowork flipping `feature_flags_registry.DRAFT_ASSIST` to `on` did NOT enable saves.
Fixed to the house env-OR-registry pattern (mirrors `comms-owner-attribution-tick.js` / admin.js
`w93FlagEnabled`) via a NEW shared resolver `api/_shared/feature-flag.js`
(`flagEnabled` + `fetchFeatureFlag`). Precedence: an explicitly-set `DRAFT_ASSIST` env var wins
(on OR off — ops override); else the registry `state='on'` enables it. GET dry-run unchanged.

## Part B — fact-validator proper-name false-positive
`validateDraftFacts` flagged "Quick Check" (from "Quick Check-In") as an ungrounded `proper_name`.
Added `NAME_STOPWORDS` in `draft-assist-core.js`: a NAME_TOKEN run whose words are ALL common
capitalized English words is benign boilerplate (not flagged); a run with any non-stopword token
("Kingsbarn Capital", "Boyd Watterson") is still flagged; ungrounded numbers/dates still STRIPPED.

## Tests
`test/draft-assist.test.mjs` — flag structural test now asserts the shared env-or-registry resolver
(not `process.env` alone) + resolver precedence unit test; 7 new Part-B name cases. 29 pass.

## Files
- `api/draft-assist.js` (gate → shared resolver)
- `api/_shared/feature-flag.js` (NEW shared env-OR-registry resolver)
- `api/_shared/draft-assist-core.js` (NAME_STOPWORDS + isBoilerplateNameRun)
- `test/draft-assist.test.mjs`
- `ROLLOUT_STATUS.md` (W10.2 row), `docs/claude-code/STATUS.md` (session entry)
