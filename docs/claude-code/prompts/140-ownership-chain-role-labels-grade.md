# Prompt 140 — Grade the dormant OWNERSHIP_CHAIN_ROLE_LABELS layer before flipping

## Context
The P131 ownership-chain drafter is deterministic and live (`OWNERSHIP_CHAIN_DRAFT` on, cron 239). It ships
an **optional Layer 2** — `OWNERSHIP_CHAIN_ROLE_LABELS` (flag OFF) — where Ollama LABELS a transfer type
(e.g. "arms-length sale", "affiliate/SPE transfer", "foreclosure") on chain links it **may not add, remove,
reorder, re-date, or re-name**. Guardrail already specced: a label whose rationale names a party absent from
that link is dropped. It's never been graded, so it stays off.

## Ask — produce a gradeable dry-run sample, don't flip
Add (or expose, if it already exists) a **dry-run path** for the role-labeler:
`GET /api/ownership-chain-draft-tick?role_labels=1&generate=1` (or an equivalent GET that runs the Layer-2
labeler WITHOUT writing) that returns, for ~15–20 real chain links across a spread of chain shapes
(single-link, multi-link, SPE-heavy, arms-length):

- the link as drafted (grantor → grantee, date, price, `data_source`),
- the proposed `role_label` + the model's one-line rationale,
- whether the rationale passes the **party-presence guard** (every party the rationale names appears on that
  exact link) — surface the pass/fail, don't silently drop, so the grader sees the drop rate.

No writes. Flag stays OFF. This mirrors the `?generate=1` dry-run pattern the P138 analyst-take tick uses.

## What "graded clean" means (for the follow-up review)
- Labels are **accurate to the link's own facts** (an SPE→parent transfer is not called an arms-length sale;
  a $0/nominal transfer is flagged as non-arm's-length).
- The party-presence guard drops the hallucinated-rationale cases (analogous to W8-U3's ~52%
  `quote_not_verbatim` drop rate — expect a meaningful drop rate and that's HEALTHY, not a failure).
- No label alters the chain — labels are additive metadata only.
- `uncertain`/no-label on genuinely ambiguous links, never a guessed type.

## Verify / deploy
Dry-run only in this prompt — the grade decides the flip. GET path, no migration, ships on the Railway
redeploy. Once a sample grades clean, Cowork flips `OWNERSHIP_CHAIN_ROLE_LABELS` (registry) and the labels
render on the chain-draft cards as additive annotations. Small, low-risk (annotation-only, never touches the
deterministic chain). Commit with the repo trailer.
