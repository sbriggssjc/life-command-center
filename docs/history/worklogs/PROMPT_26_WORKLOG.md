# Prompt 26 Worklog

Date: 2026-08-03

## Objective

Fix appraisal-mode comps so subject location ranks comps instead of hard-filtering them, preserving explicit
non-appraisal metro/state filters.

## Plan

1. Read the shared comps engine and current bounded-output tests.
2. Relax appraisal-mode subject-derived metro/state before RPC/local filtering while keeping them as score inputs.
3. Pull a broader state/region candidate pool with national fallback before similarity ranking.
4. Exclude the resolved subject asset from appraisal comp rows when identifiable.
5. Add focused regression tests for appraisal broadening and non-appraisal Tampa filtering.

## Notes

- `scoreComp` already gives subject metro/state/region proximity ranking credit.
- The bug is caused by copied parsed `states`/`metros` reaching both RPC params and `applyLocalScope`.
- Added appraisal-only query/local scope shaping:
  - primary candidate pull uses subject state plus known region states and no metro filter;
  - national fallback runs when the primary candidate pool is under the candidate cap;
  - local `states`/`metros` filtering is bypassed only for appraisal requests with a subject anchor.
- Added subject exclusion by concrete subject id or address/state match, with `meta.excluded_subject`.
- Tightened appraisal auto-detection so `dialysis comps in Tampa` remains a non-appraisal hard-filter lookup,
  while explicit appraisal/valuation language and `for <subject>` appraisal defaults still work.

## Verification

- `node --test test\comps-bounded-output.test.mjs`
- `node --check mcp\comps-tools.js`
