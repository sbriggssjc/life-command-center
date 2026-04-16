# Copilot Studio Manifest — LCC Assistant

This directory contains the four files that form a sideloadable Teams + Copilot Studio app package for the Life Command Center assistant.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Teams app manifest (schema v1.17) with Declarative Copilot declaration. Defines app identity, icons, permissions, and valid domains. |
| `declarative-copilot.json` | Declarative Copilot definition — system prompt (instructions), conversation starters, and action references. The `instructions` field contains the full COPILOT_SYSTEM_PROMPT from `api/_shared/ai.js`. |
| `ai-plugin.json` | AI plugin manifest that tells Copilot Studio how to authenticate and discover the LCC OpenAPI spec. Points to the `/api/copilot-spec` endpoint for action discovery. |
| `README.md` | This file. |

## Placeholder Locations

Before deploying, replace all placeholder values with your actual Railway deployment URL and domain.

### `RAILWAY_URL` (replace with full URL, e.g. `https://lcc-production.up.railway.app`)

| File | Field / Location |
|------|-----------------|
| `manifest.json` | `developer.websiteUrl` |
| `manifest.json` | `developer.privacyUrl` |
| `manifest.json` | `developer.termsOfUseUrl` |
| `ai-plugin.json` | `api.url` |
| `ai-plugin.json` | `logo_url` |
| `ai-plugin.json` | `legal_info_url` |

### `RAILWAY_DOMAIN` (replace with domain only, e.g. `lcc-production.up.railway.app`)

| File | Field / Location |
|------|-----------------|
| `manifest.json` | `validDomains[0]` |

## How to Deploy

1. Replace all `RAILWAY_URL` and `RAILWAY_DOMAIN` placeholders with your actual values.
2. Add `color.png` (192x192 full-color icon) and `outline.png` (32x32 transparent outline icon) to this directory.
3. Zip all files in this directory (not the folder itself) into a `.zip` archive.
4. Upload via Teams or Copilot Studio — see `docs/setup/COPILOT_STUDIO_SETUP.md` for full instructions.
