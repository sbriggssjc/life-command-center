# Retired-host artifacts (J13a)

Every file in this directory names `life-command-center-nine.vercel.app` — the Vercel deployment
retired 2026-07-20 (see `CLAUDE.md` § "PRODUCTION RUNS ON RAILWAY"). They were **moved, not edited**:
`test/retired-identifiers-guard.test.mjs` (J13a-guard) fails CI on any *new* occurrence of that
hostname outside this directory, `docs/history/`, or a correctly-bannered doc — these machine-read
artifacts are exactly the class no `.md` sweep (DOCMAP1–3) could see, so they are parked here rather
than hand-edited, per the standing rule: **never hand-edit a flow definition's `uri`** — a re-imported
flow or agent package must come from a fresh export of the *live* flow/agent, not a patched old one.

**Do not re-import or re-deploy any file here.** If one of these capabilities is needed again,
re-export it fresh from the live source named below.

| archived file | original path | what it was | live equivalent |
|---|---|---|---|
| `flow-loopnet-backfill.json` | `flow-loopnet-backfill.json` | Power Automate def, `uri` → `.../api/loopnet-ingest` | Re-export from the live PA flow; target `https://tranquil-delight-production-633f.up.railway.app/api/loopnet-ingest` (see `server.js` routing) |
| `flow-rcm-backfill.json` | `flow-rcm-backfill.json` | Power Automate def, `uri` → `.../api/rcm-ingest` | Re-export from the live PA flow; target the Railway host, `/api/rcm-ingest` |
| `flow-a-lcc-stage-om-http.json` | `flow-a-lcc-stage-om-http.json` | Power Automate def, `LccHost` variable | Re-export from the live PA flow; `LccHost` should be the Railway host |
| `copilot_studio_manifest_manifest.json` | `docs/setup/copilot_studio_manifest/manifest.json` | Copilot Studio agent manifest | `docs/setup/copilot_studio_manifest/replacement-files/` (current) or a fresh package build via `scripts/build_canonical_connector.py` |
| `copilot_studio_manifest_ai-plugin.json` | `docs/setup/copilot_studio_manifest/ai-plugin.json` | Copilot Studio AI-plugin descriptor | `docs/setup/copilot_studio_manifest/replacement-files/ai-plugin.json` (current) |
| `LCC-Assistant.zip` | `docs/setup/copilot_studio_manifest/LCC-Assistant.zip` | Packaged Copilot Studio agent (embeds the two files above) | Re-build the package from `replacement-files/` + the canonical connector spec, never re-upload this zip |
| `lcc-agent_appPackage_manifest.json` | `docs/setup/copilot_studio_manifest/lcc-agent/appPackage/manifest.json` | Teams Toolkit app manifest | Regenerate via the Teams Toolkit build from current `appPackage/` sources |
| `lcc-agent_appPackage_build_manifest.dev.json` | `docs/setup/copilot_studio_manifest/lcc-agent/appPackage/build/manifest.dev.json` | Teams Toolkit dev-build manifest (generated artifact) | Regenerate with the Teams Toolkit dev build; never hand-restore |
| `lcc-agent_appPackage_build_appPackage.dev.zip` | `docs/setup/copilot_studio_manifest/lcc-agent/appPackage/build/appPackage.dev.zip` | Teams Toolkit dev-build package (embeds the manifest above) | Regenerate with the Teams Toolkit dev build; never re-upload |

`scripts/build_canonical_connector.py` reads only the sibling `openapi.json` files under
`docs/setup/copilot_studio_manifest/{replacement-files,lcc-agent/appPackage}/` — those files never
carried the retired host and were **not** moved; the script's build path is unaffected by this move.

## Referrers reconciled at move time (2026-09-08)

These docs name the moved paths and were left as historical narrative (they describe what was true
when written, inside `docs/architecture/`, `docs/audits/`, `docs/history/`, `docs/claude-code/`, or
carry their own `STALE`/`RETIRED` banner) rather than rewritten, per the guard's exemption rule:

- `docs/architecture/INTAKE_TODO_FLOW_AUDIT_2026-07-23.md`, `docs/architecture/flows/google-news-alert-power-automate.md`,
  `docs/architecture/scott-pa-flows-reference.md`, `docs/comps-tools/04_Comps_Tools_Revised_Architecture.md`,
  `docs/setup/LCC_OneDrive_Upload_Setup_2026-04-21.md` — name the flow files by their original path.
- `docs/audits/ROLLOUT_STATUS.md`, `docs/comps-rollout/connector-upload-walkthrough-2026-08-02.md`,
  `docs/setup/COPILOT_STUDIO_SETUP.md`, `docs/setup/copilot_studio_manifest/lcc-agent/README.md` —
  name the Copilot Studio package by its original path.
- `docs/claude-code/STATUS.md`, `docs/os/PLANNED-BACKLOG.md`, `docs/history/GIT_PULL_RECOVERY_LOG.md`,
  `docs/claude-code/prompts/J13a-retired-host-guard.md`,
  `docs/claude-code/responses/done/DOCMAP2-retired-dependency-sweep.response.md` — worklog/backlog
  entries about this exact defect class, correctly framed as history.
