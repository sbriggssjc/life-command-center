# GitHub Copilot Instructions — Life Command Center

> **CRITICAL: Read .github/AI_INSTRUCTIONS.md before modifying any files in /api/.**

This project is on Vercel's Hobby plan with a hard limit of 12 serverless functions.
The /api/ directory currently has exactly 12 .js files — there is ZERO room for new ones.

## Key Rules for Copilot

1. NEVER create new .js files in /api/ — add sub-routes to existing functions instead
2. New utility code goes in /api/_shared/ or /api/_handlers/
3. Always verify: `ls api/*.js | wc -l` must be <= 12
4. Use descriptive commit messages (not "GPT changes")
5. See .github/AI_INSTRUCTIONS.md for full architecture and routing patterns
