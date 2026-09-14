# Claude Code Prompt — Alert-triage fixes: domain-code normalization + thin-capture alert noise

**Repo: life-command-center.** Two small fixes from the 2026-08-06 alert triage sweep
(`docs/audits/AUDIT_REFRESH_2026-08-06.md` §3A has the full disposition).

## Fix 1 — `propagateToDomainDb` rejects the short domain codes the data actually uses

Live evidence (alert 983): a re-capture of an existing dia entity carried
`entity.domain='dia'` (the preserve-existing branch in the domain classifier returns the
stored value) into `propagateToDomainDb` (`api/_handlers/sidebar-pipeline.js` ~line 2297),
which accepts ONLY `'dialysis'|'government'` → `{ propagated:false, reason:'unknown_domain' }`.
Measured live: `entities.domain` holds SHORT codes exclusively — gov 23,622 / dia 14,167 /
lcc 22,006 / cre 99 / null 2,692; zero rows carry the long names. **Consequence: every
sidebar RE-capture of an existing dia/gov entity silently skips domain-DB propagation.**

Fix: normalize at the dispatcher — map `dia→dialysis`, `gov→government` (accept both
forms) before the branch; leave `lcc`/`cre`/anything-else on the existing unknown_domain
path. Check whether `classifyAllApplicableDomains` / other callers of
`propagateToDomainDb` need the same normalization (grep for callers). Regression test:
`entity.domain='dia'` propagates to the dialysis path (mock `getDomainCredentials`);
`'gov'` likewise; `'lcc'` still unknown_domain.

Also scan for the inverse hazard: anywhere long-form domain strings get written into
`entities.domain` (would explain zero long-form rows only if writes normalize — confirm
where normalization happens and note it in the fix comment so the two conventions are
documented).

## Fix 2 — thin-capture `no_domain` alerts are noise; downgrade to digest

8 of the 9 open `sidebar_promote_pipeline_failed` alerts were captures with
`searchTextLen` 56–97 chars, no sale notes, no PDFs — CoStar contact-page fragments with
zero domain signal. The classifier declined CORRECTLY; a per-capture warn alert for a
legitimately out-of-scope page is noise that buries real signals.

Fix (in the alert-emission path for sidebar promote, same file): when
`reason='no_domain'` AND the classifier diagnostics show a thin capture
(`searchTextLen < 150` && `!hasSaleNotes` && `!hasPdfTexts`), do NOT open an
`lcc_health_alerts` row — count it (e.g. into the existing briefing digest surface or a
simple counter in the promote response diagnostics). Substantive captures
(rich text, sale notes, or PDFs) that still land no_domain KEEP the per-capture alert —
those are potential classifier gaps (the Topic-1 history). `unknown_domain` and every
other failure reason keeps alerting unchanged. Tests: thin no_domain → no alert row +
counted; rich no_domain → alert; unknown_domain → alert.

## Context already handled (do NOT redo)
- field-provenance-prune FK fix: applied live as migration
  `lcc_prune_skip_resolution_referenced_provenance` (mirror into supabase/migrations/ if
  the repo tracks LCC Opps migrations — check precedent — but do not re-apply).
- sf_sync_queue apostrophe row: closed failed→done with terminal note (data fix, done).
- ORE queue depth: operator flag issue (ORE_USE_RESOLVER off), not code — out of scope.

## Verify
Tests green; after merge+redeploy, a re-capture of an existing dia entity (Scott can
trigger one from the sidebar) must show domain propagation in the response diagnostics
instead of unknown_domain. Record in ROLLOUT_STATUS session log.
