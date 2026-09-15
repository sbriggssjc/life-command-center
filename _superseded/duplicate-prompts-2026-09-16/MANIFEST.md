# Superseded — duplicate prompts, 2026-09-16

| file | superseded by | why |
|---|---|---|
| `DEED1-RELAND-the-migration-went-to-the-wrong-repo.md` | `docs/claude-code/prompts/DEED1-reconcile-2-the-migration-is-in-the-wrong-repo.md` | Two Cowork sessions wrote the same prompt within hours. The surviving one is better: it forbids re-applying anything (this is a file-location fix, not a schema change) and asks whether the `Dialysis` repo also carries an older copy of `v_owner_source_conflict` — a check the retired prompt missed. The retired prompt's one unique contribution, the md5 behaviour pin, was folded into the survivor before retirement. Its ownership argument (that `CLAUDE.md` line 375 settles who owns Dialysis_DB) is **withdrawn** — see CANON-OWNERSHIP1. |
