# Lib Refactor Patch — Apply to Restore Vercel Deploys

> Generated 2026-05-10 by Claude session. Source commit `c885d1a` on local sandbox
> branch (the sandbox couldn't `git push` due to missing GitHub credentials, so the
> change ships as a gzipped patch you apply locally).

## What this patch does

Restores the broken Vercel deployment by moving helper modules out of `api/`
(where Vercel was counting them as Serverless Functions, blowing past the 12-function
Hobby cap):

- `api/_handlers/` → `lib/handlers/` (21 files, mostly renames)
- `api/_shared/`   → `lib/shared/`   (44 files, mostly renames)
- Updated imports across the 12 `api/*.js` files, all 18 test files, scripts, the
  Chrome extension, and the MCP server
- Updated `CLAUDE.md` rule 3 to reflect the new lib/ structure
- Updated `package.json` `check:functions` to walk recursively + warn at exactly 12
  (so the next addition flags before Vercel rejects)

Final state: 12 functions in `api/` (verified), zero ambiguity about underscore-folder
behavior. Should restore Vercel deploys immediately on the next push.

## Apply (≈ 2 minutes from your workstation)

```bash
# From the repo root, on a branch with git push access:
git checkout main && git pull

# Decode the gzipped + base64 patch
base64 -d _patches/lib-refactor-cap-fix.patch.gz.b64 | gunzip > /tmp/lib-refactor.patch

# Apply it
git apply /tmp/lib-refactor.patch

# Remove the patch artifacts (they live in _patches/ which the .vercelignore-style
# glob won't pick up, but they're noise — clean up)
git rm _patches/lib-refactor-cap-fix.patch.gz.b64 _patches/README.md
rmdir _patches

# Stage everything (including the renames that git apply created) and commit
git add -A
git commit -m "refactor: move api/_handlers + api/_shared to lib/ (Vercel cap fix)"
git push
```

Vercel should auto-deploy from the new HEAD within a couple of minutes.

## Validation (already passed in sandbox)

- `npm run check:functions` → "12/12 serverless functions" with new at-cap warning
- `npm test` → 225 pass / 1 fail / 5 skipped. The single failure (`raw-write-guardrail`
  for `gov.js` having 4 raw proxy mutations vs cap=2) pre-exists on main and is
  unrelated to this refactor — verified by re-running against main HEAD.
- `node --check` on every `api/*.js`, sample `lib/handlers/*.js`, sample
  `lib/shared/*.js`, and `server.js` — all OK.

## If `git apply` fails

Most likely cause: main has moved since the patch was generated. Try one of:

```bash
# 3-way merge — handles minor drift gracefully:
git apply --3way /tmp/lib-refactor.patch

# Or use `git am` which preserves the original commit metadata + allows --3way:
git am --3way /tmp/lib-refactor.patch
```

If neither works, ping the session — I can regenerate against current HEAD.
