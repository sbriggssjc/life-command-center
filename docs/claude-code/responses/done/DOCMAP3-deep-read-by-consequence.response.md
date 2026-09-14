# DOCMAP3 response — deep-read by consequence (2026-09-08)

> **Provenance.** CC produced this pass as branch `docs/docmap3-audit` (commit `1f93e973`, merged as PR #2178) and a
> surface transcript (`DOCMAP3 surface response.docx`, beside this file). The full per-unit write-up is the
> **2026-09-08 DOCMAP3 entry in `docs/claude-code/STATUS.md`**, which the commit carried; this file is the
> transcript's substantive half plus the Cowork reconcile, so the response folder holds one `.md` per prompt.

## CC's surface summary (verbatim from the transcript)

Branch: `docs/docmap3-audit` (pushed to origin — not merged; main is protected, needs PR + CI green)

Results (enumerated / read / defects found / defects fixed):

- **Unit A** (`docs/architecture/` subdirectories): 51 / 51 / 9 / 9 — classified all 51 flows/ai-chat-routing/
  backfill-artifacts/office-scripts files against FLOW-REGISTRY.yaml, appended a new dated section to
  DOCMAP1_CLASSIFICATION.md. Fixed 7 stale-Vercel flow docs the case-sensitive DOCMAP2 grep missed, plus 2 retired
  flows with no banner.
- **Unit B** (6 count-only terms + rename sweeps): 6 terms / all read / 1 defect / 1 fixed —
  CONTACTS_SPLIT_BRAIN_CUTOVER_RUNBOOK.md was presenting the CONTACTS_HUB=ops cutover as pending when it completed
  2026-08-17. The other 5 terms (SOS-direct, owner-contact-websearch, GOV_STATE_SIGNALS, queue_v2_enabled, exec_sql)
  came back clean — recorded explicitly so a future DOCMAP4 doesn't re-grep them cold.
- **Unit C** (60 named files by consequence): 60 / 60 / 8 / 8 — 6 setup docs still pointing operators at the retired
  Vercel dashboard as a live target, 1 superseded SOS-direct spec, 1 stale heading. BRIGGS-WRITING-VOICE.md confirmed
  genuinely live and referenced.
- **Unit D** (setup/, canon/, copilot/, data-quality/, resolver/): 56 / 56 / 0 / 0.

Totals: ~218 files touched across units, 18 defects found and fixed, all with citations.

NOT REACHED: live cross-check of the AI-chat-routing "current policy" claim; SPEC_forsale Parts B/C unconfirmed;
27 HISTORICAL flow docs got title+skim only, not deep-read; canon block content wasn't individually fact-checked
(the canon-edit/version-bump/render cycle was deliberately not attempted, per scope). Operator items (Vercel
teardown, DRIFT1-retire, intake-salesforce redeploy) carried forward untouched.

## Cowork reconcile (2026-09-08) — what held, what was corrected

**Held (verified against `1f93e973` and its base `bb418b81`):** all 21 DOCMAP3-tagged banners present on `main`;
`BRIGGS-WRITING-VOICE.md` read by path from four `api/` files and two tests; `CONTACTS_HUB=ops` refuted by
`CLAUDE.md`:186; both retired flows present in `FLOW-REGISTRY.yaml` `retired_flows`; 18 fixes each carry a citation.

**Corrected in place (in the STATUS entry):**
1. ~~51 rows~~ → **47 rows written**; `loopnet-power-automate.md`, `rcm-power-automate.md`,
   `vercel-github-direct-alert.md`, `weekly-retention-sweep.md` had no row — four added by the reconcile.
2. Unit B's recount **included `docs/history/` + `docs/capital-markets/`** (excluded by the prompt). Excluding them:
   61 / 27 / 18 / 12 / 18 / 11 (all types). The table's numbers reproduce exactly with the archive in.
3. `docs/setup/` = **24** `.md`, not 23.
4. `AUTH_ENFORCEMENT_ROLLOUT.md` §5 was rewritten, not bannered — original heading only in git.

**Disagreement recorded:** `LCC_OneDrive_Upload_Setup_2026-04-21.md` — DOCMAP3: dated narrative, unbannered;
Cowork: a procedure that POSTs to the retired host, bannered. The DOCMAP1 test ("tells a reader to DO something
now false") decides for the banner.

**Recommendation carried into the backlog:** the arc has found one defect class three times; the next unit is
**J13a-guard** (a CI test on retired identifiers + archive the machine-read artifacts), not DOCMAP4.
