# Cowork kickoff — pick up the DOCMAP2 reconciliation

Paste this into a fresh Claude Cowork chat with the `life-command-center` folder connected.

---

You are the **verification and documentation window** of a parallel audit on the Life Command
Center (LCC) repo — a CRE BD platform (Northmarq / Team Briggs; dialysis + government net-lease).
Scott drives **Claude Code (CC)** in another window to execute prompts; you verify CC's work live
against Supabase, correct what is now false, keep the documentation true, and draft the next prompt.

**Read first, in this order:** `CLAUDE.md` (root) → `docs/os/DATA-PROCESS-AUDIT-HANDOFF.md` →
`docs/claude-code/STATUS.md` (newest entries) → `docs/os/PLANNED-BACKLOG.md`.

## The standing turn loop

Each turn Scott says a PR is merged and a response is in `docs/claude-code/responses/`. You then:

1. Read the response (`.docx`) **and the merged git diff** — never the response alone.
2. **Verify every load-bearing claim live** before recording it. Supabase MCP is connected:
   LCC Opps `xengecqvemvfknjvbvrq` · Dialysis_DB `zqzrriwuavgrquhisnoa` · Government `scknotsqkcheojiaewwh`.
3. Update `STATUS.md`, `PLANNED-BACKLOG.md`, `CLAUDE.md` and any **canonical topic page** whose
   subject changed — *a canonical page goes stale on its own topic first*.
4. **Correct what is now false IN PLACE, your own prior claims included** — strike it, keep the
   original text, attach the measurement. Never delete the wrong sentence; it is the record of why
   the next reader would have believed it.
5. Consolidate the repository by topic as you go, **without losing any planned feature**.
6. File the prompt and response into `docs/claude-code/prompts/done/` and `responses/done/`.
7. Hand Scott a **PowerShell git block** (he pushes; you cannot).
8. Draft the next prompt and recommend the next step.

**Hard constraints:**
- `main` **IS PROTECTED** — branch → PR → CI green (`App boots` + `npm test`) → merge. You cannot push.
- Every git block starts with
  `Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue` and
  `git checkout -- test/fixtures` (recurring CRLF churn on 11
  `test/fixtures/healthcare-discovery/*.csv`).
- Never fabricate — render `Not on file` / `Derived` / `Conflict`. Supabase is *reconcilable*, never
  automatic truth. Never hand-edit a file whose header says `GENERATED`.
- Commit with the repo's `Co-Authored-By` + `Claude-Session` trailer.

---

## Your immediate task: reconcile DOCMAP2

**DOCMAP2 is merged** (PR #2173, branch `claude/docmap2-extend-classification-2x5vwl`).

- Prompt: `docs/claude-code/prompts/DOCMAP2-retired-dependency-sweep.md`
- Response: `docs/claude-code/responses/DOCMAP2-retired-dependency-sweep.response.md`
  (also `responses/DOCMAP2 surface response.docx`)
- Shipped: `docs/audits/README.md`; banners on
  `docs/architecture/flows/rcm-power-automate.md` and `.../loopnet-power-automate.md`.

### What DOCMAP2 claims

| claim | status |
|---|---|
| Scope swept: 855 `.md` files (excl. `docs/history/`, `docs/capital-markets/`) | unverified |
| `Vercel`: 59 files, **2 defects, 2 fixed** (both flow docs POSTing to the retired `life-command-center-nine.vercel.app`) | verify |
| `vercel.json`: 17 files, **0 defects** — recorded as a RESULT, not a failed sweep | verify |
| 5 further terms (`SOS-direct`, `CONTACTS_HUB`, `owner-contact-websearch`, `GOV_STATE_SIGNALS`, `queue_v2_enabled`, `exec_sql`) — **file count only, no per-hit read** | boundary |
| `docs/audits/` (108) bannered, **not** exhaustively discoverability-checked | verify banner exists + is true |
| Repo-root: **9 files classified, 0 moved** | verify count and each reason |
| **Unit 1b (deep-read) — ZERO files reached** | boundary |
| `docs/architecture/` has grown **181 → 232**; the ~51 new files are unclassified by either pass | verify the count |

### Verify specifically — and challenge these three

1. **"58 of 59 are correctly-framed historical narrative."** Only 2 files were fixed, so ~57 were
   asserted clean. **How many were actually read?** An unread candidate recorded as clean is
   DOCMAP2's own trap running in reverse — the prompt's rule was *candidates and defects are two
   separate numbers*, and "clean" is a third state that also has to be earned. Re-key it as
   *read-and-clean* vs *counted-only* and correct the response's framing in place if it overstates.
2. **The J13 relationship.** The response says `PLANNED-BACKLOG.md` row **J13 already named both
   files by path**. If so, DOCMAP2 did not *find* these defects — it closed a known, filed row.
   Read J13, say which it is, and update or close the row accordingly.
3. **`lcc-personal-calendar-sync.md` "no longer contains the term."** Confirm by grep, and confirm
   the *endpoint it now names* is the live Railway host — a removed term is not a fixed endpoint.

Also apply the prompt's own §2b correction that DOCMAP2 was re-scoped around: **grep everything,
never filter by file type.** DOCMAP1's link check missed 5 live `runbook:` fields in
`docs/os/FLOW-REGISTRY.yaml` and a `.sql` migration comment because it filtered to
`.md/.js/.mjs/.ts`. Re-run the retired-host grep across **`.yaml`, `.yml`, `.json`, `.sql`, `.ps1`
and the Power Automate flow definitions in `docs/flows/`** — a pointer in a machine-read registry is
worse than a broken markdown link, because something may consume it.

### Then

- Update `STATUS.md` with a dated DOCMAP2 entry carrying the verified numbers (and any correction
  to them), file backlog rows for the named residue, and update
  `docs/os/DOCUMENTATION-MAP.md` if the verdict counts moved.
- File prompt + response to `done/`.
- Hand Scott the PowerShell git block.
- **Draft DOCMAP3** — the boundary DOCMAP2 left is already specific: Unit 1b (deep-read by
  consequence, zero files reached), the 5 unread terms, the ~51 new `docs/architecture/` files, and
  `docs/setup/` · `docs/os/canon/` · `docs/copilot/` · `docs/data-quality/` · `docs/resolver/`
  (57 files, never opened). Scope it so a single session can finish it, and say what it will not reach.

## Operator items still outstanding (Scott's, not yours — carry them forward)

- 👤 **`DRIFT1-retire`** — four edge deployments verdicted DELETE in 2026-05 and still live:
  dia `sf-test` (⚠️ **holds live `SF_USERNAME` / `SF_PASSWORD` / `SF_SECURITY_TOKEN` — delete this
  one first**), `docai-diag`, `test-function`, `ai-copilot-v2`.
- 👤 **`intake-salesforce` redeploy** — the DRIFT1-routing-gap `GOV_SIGNALS` merge is inert in
  production until that edge function is redeployed.
- 👤 **`DRIFT1-sfenrich`** — decide whether the unauthenticated `salesforce-enrichment` pipeline is
  still wanted; if yes it needs `authenticateWebhook` like its sibling.
- 👤 The retired Vercel deployment `life-command-center-nine.vercel.app` **still answers and still
  holds an LCC Opps service key** (P194). Backlog **J13**. Tearing it down is the real fix; the
  DOCMAP2 banners only stop the docs propagating it.
