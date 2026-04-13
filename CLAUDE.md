# Claude Code / Cowork Instructions — Life Command Center

> **CRITICAL: Read .github/AI_INSTRUCTIONS.md before modifying any files in /api/.**

## Vercel Hobby Plan Constraint

HARD LIMIT: 12 serverless functions max (12 .js files in /api/).
Currently at 9 functions (Phase 4b freed 3 slots via edge migration).
data-proxy, daily-briefing, diagnostics absorbed into admin.js + Supabase Edge Functions.

## Rules

0. LCC_API_KEY is set in Vercel env vars for Power Automate auth. The frontend works without auth via dual-mode transitional fallback (dev env only). Do NOT change LCC_ENV to production/staging until frontend JWT auth is implemented.
1. NEVER create new .js files directly in /api/
2. Add new endpoints as sub-routes (use ?action= or ?_route= query param patterns)
3. New utility/handler code goes in /api/_shared/ or /api/_handlers/
4. After ANY /api/ change, verify: `ls api/*.js | wc -l` must be <= 12
5. Update vercel.json rewrites when adding new sub-routes
6. Use descriptive Round-numbered commit messages, never generic "GPT changes"
7. See .github/AI_INSTRUCTIONS.md for full architecture and routing patterns

## Architecture Quick Reference

- LCC orchestrates, domain Supabase backends execute domain logic
- Contacts + Entities consolidated into entity-hub.js (routes to _handlers/)
- Bridge + Workflows consolidated into operations.js
- Intake functions consolidated into intake.js
- admin.js: workspaces, members, flags, connectors, diagnostics (config/diag/treasury), edge proxies (data-query, daily-briefing)
- Supabase Edge Functions: data-query (gov/dia PostgREST proxy), daily-briefing (snapshot orchestration) on LCC Opps project
- All rewrites defined in vercel.json — order matters (specific before catch-all)
