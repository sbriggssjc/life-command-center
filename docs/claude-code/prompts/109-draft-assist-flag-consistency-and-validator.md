# Prompt 109 — draft-assist: flag-gate consistency (env-OR-registry) + fact-validator false-positive

Grounding (read first): `api/draft-assist.js` (the POST-save gate ~line 260 + `validateDraftFacts` usage ~212),
the **house flag pattern**: `api/_handlers/comms-owner-attribution-tick.js` (~line 36–43 — checks
`process.env.<FLAG>` FIRST, then falls back to `feature_flags_registry.state`) and the reachability harvest
(`api/admin.js` ~4687–4694) + the shared `w93FlagEnabled` helper (`api/admin.js` ~1913) that already implements
env-or-registry. The inert-feature registry doctrine (CLAUDE.md §4.4.3). Two small, additive fixes; one PR.

## Part A — flag consistency (THE bug: registry flip doesn't enable draft-assist)

**The gap (verified live 2026-08-14):** every flag-gated tick in LCC enables on **env var OR
`feature_flags_registry.state`** — so "Cowork flips the registry row to on" activates them. But
`api/draft-assist.js:260` gates ONLY on `flagOn(process.env.DRAFT_ASSIST)` with **no registry fallback**, so the
registry flip (state=`on`) does NOT enable POST-save — the endpoint reports `save_skipped: DRAFT_ASSIST flag is
OFF` even though the registry says on. This breaks the uniform operator flow and confused a live test.

**Do:** make the POST-save gate honor **env var OR registry**, mirroring `comms-owner-attribution-tick.js` /
the reachability harvest. **Reuse the existing helper** (`w93FlagEnabled` or whatever the shared env-or-registry
resolver is — grep first; do NOT fork a new one). Precedence: an explicitly-set `process.env.DRAFT_ASSIST` wins
(so ops can force it), else fall back to `feature_flags_registry.state='on'`. The GET dry-run stays always-on
(unchanged). After this, the already-flipped registry row (`DRAFT_ASSIST`=on, set by Cowork 2026-08-14) enables
POST-save on redeploy — no Railway env var required, consistent with every other feature.

**Acceptance (A):** with the registry row `on` and no `DRAFT_ASSIST` env var, a `POST /api/draft-assist
{save:true}` saves the Outlook draft (mode=`save`, `saved:true`); with the registry `off` AND no env var it
dry-runs; an env var explicitly `off` still forces off (ops override). A structural test asserts the gate reads
the shared env-or-registry resolver, not `process.env` alone.

## Part B — fact-validator proper-name false-positive

**The gap (from the live sample):** `validateDraftFacts` flagged **"Quick Check"** (from the subject
"Quick Check-In") as an ungrounded `proper_name`. It only FLAGS names (doesn't strip them — numbers/dates are
stripped), so it's noise not risk, but the Title-Cased-token detector is too eager: benign capitalized subject
phrases ("Quick Check-In", "Follow Up", "Touch Base") trip it, so `fact_validation.clean` is falsely `false` on
almost every draft, training the operator to ignore the signal (the Producer/Consumer honest-signal rule).

**Do:** tighten the proper-name detection so it flags plausible PERSON/COMPANY names, not common Title-Case
words. Options (pick the tightest that still catches a real ungrounded name like "Kingsbarn" or "Boyd Watterson"):
a small stoplist of common capitalized English words (Quick, Check, Follow, Up, Touch, Base, Best, Thanks,
Regards, Re, Fwd, …) excluded from the scan; and/or require a multi-token Capitalized sequence or a known
name-shape rather than any single Title-Cased word; and/or exclude tokens that also appear in the `intent` /
subject boilerplate. Keep stripping ungrounded numbers/dates (the cardinal-sin guard) exactly as-is.

**Acceptance (B):** the two live sample drafts (`relationship_touch` "Quick Check-In", `follow_up` "Following Up
on BOV") come back `fact_validation.clean=true` (no false proper-name flags); a planted genuinely-ungrounded
company name (e.g. "Kingsbarn" not in facts/exemplars) is still flagged; a planted fabricated figure ($99,000,000)
is still STRIPPED. Tests updated in `test/draft-assist.test.mjs`.

## Docs
STATUS + ROLLOUT_STATUS Wave 10 Stage 2 row: note the flag now honors the registry (so `DRAFT_ASSIST`=on in the
registry enables saves post-redeploy) + the validator tightening. Prompt → `done/`.

Small, additive, reversible. Commit with the repo Co-Authored-By + Claude-Session trailer. One PR. Report the
post-fix live POST result (`saved:true`) and the two samples' `clean=true`.
