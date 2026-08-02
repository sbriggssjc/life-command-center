# Prompt 10 — Triage & fix the failing Power Automate flows (deal-spine connectors)
- Priority: **P0** (the deal-spine connectors are down; blocks prompt 02)
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/error-triage-2026-08-01.md` §3, `power-automate-flow-audit.md`, `power-automate-remediation-plan.md`
- Response file: `../responses/10-pa-flow-failures.response.md`

## Prompt (copy/paste to Claude Code)
```
Twenty Power Automate flows have been failing over the past week (Default env
fccf69d3-58a4-4c10-a59d-14937a5f5d3f). Triage and fix, highest-impact first — these ARE the deal-spine
connectors, so their failure is why deals have no SF Opportunity / correspondence / documents:
  1. Http -> Get file (LCC Get Artifact) — 685 failures (flow c63003a0-5d08-4b08-93cb-ad0eecfa2ae3): artifact/OM
     download; likely a bad storage path/auth or an expired token. This also affects dossier storage reads.
  2. SF Deal -> LCC Opportunity Sync — 74 (7657a3bc-8761-4d2e-b385-ed112411bc42): the Salesforce Opportunity ->
     LCC sync. Fixing this is what gives closed deals (e.g. 35724) their SF Opportunity + parties.
  3. LCC - Outlook Intake to Teams (Hardened) — 30 (45faffcc-...); Http Get Account/Contact — 16
     (c3744e93-...); LCC Processing Complete -> Move Message — 9; RCM_Power_Automate — 7; SF Listing Activity ->
     LCC engagement — 7 (a81b5708-...); LCC List Folder (SharePoint) — 5 (ff4815eb-...); Outlook Deal Thread
     Search — 4 (fb95da20-...); LCC — SF File Discovery — 3 (c7b21a66-...).
For each: pull the recent run error, find the root cause (auth/token, changed schema/endpoint, null handling,
throttling), fix it, and add the observability the remediation plan calls for (per-flow health + alert before a
weekly digest). Prioritize (1) LCC Get Artifact and (2) SF Deal -> LCC Opportunity Sync. Report the root cause
per flow and confirm success runs. This unblocks prompt 02 (connect the deal spine) — the flows are the
mechanism.
```

## Verify
The top flows (LCC Get Artifact, SF Deal -> LCC Opportunity Sync) run green; 35724 gets its SF Opportunity via
the sync; per-flow health is surfaced (not just a weekly digest).

> **Review note (2026-08-01):** several failing flows are HTTP calls INTO the LCC app (LCC Get Artifact -> `api/_handlers/intake-artifact-download.js`; account/contact lookups -> entities). While the app was crash-looping on the duplicate-import boot failure (commit 766df77, fixed in 1aae4e20), those HTTP flows would all fail — so confirm how many failures postdate the crash; deploying 1aae4e20 likely clears a chunk. SF Deal -> LCC Opportunity Sync (sf-deal-closing.js / sf-owner-sync.js) and the Outlook/SharePoint flows need their own root-cause (auth/token/schema), independent of the boot.

> **Option B (2026-08-01):** Scott chose to leave 35724 comp-only and let FUTURE deals fill via this flow. So
> fixing **SF Deal -> LCC Opportunity Sync** (+ the sf_deal_id return-path stamp) is now the primary mechanism
> by which live deals populate their parties/commission — prioritize it alongside LCC Get Artifact.
