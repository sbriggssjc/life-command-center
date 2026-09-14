# Prompt 99 — W9.1 Stage 2: SOS-direct via the GaryBuilt residential fetch proxy (Scott-sanctioned 2026-08-12)

**Grounding:** gov repo `docs/SOS_ENDPOINT_VERIFICATION_2026-07-22.md` (FL/CA Cloudflare/Incapsula
403 datacenter IPs; AZ portal migrated; handlers correct + honest-blocked; weekly `--apply`
DISABLED), `SOS_STATE_ADAPTERS` + `OWNER_ENRICH_SOS_URL` webhook pattern, the GaryBuilt playbook
(cloudflared named tunnel + CF Access Service Auth — the proven transport), prompt 98's pluggable
stage runner. **Scott sanctioned the design: a locked-down fetch proxy on the GaryBuilt machine,
residential egress, public-records lookups only.**

## Part A — the proxy service (runs on the GaryBuilt box)

A minimal HTTP service (Node preferred — zero-dep or near) with HARD constraints, every one
non-negotiable and tested:

1. **Domain allowlist, compiled in + env-extendable:** official state SOS/registry hosts ONLY
   (seed from the verified adapter list: FL sunbiz, CA bizfile, and the states in
   `SOS_STATE_ADAPTERS`). Any other host → 403, logged. No redirects followed off-allowlist.
2. **GET-only, no arbitrary headers passthrough,** response size cap (~2MB), timeout per request.
3. **Human-like rate limiting:** global min-interval (~5-10s between fetches) + per-host daily cap
   (~200) + jitter. Queue-and-wait semantics so the Railway caller doesn't need retry logic.
4. **Auth:** exposed ONLY via the existing cloudflared tunnel — add a second public hostname (or
   path route) with a NEW CF Access Service Auth policy + dedicated service token (do NOT reuse
   the ollama token — separate blast radius). Localhost bind; never a direct port exposure.
5. **Observability + kill switches:** request log (host, path, status, bytes, timing) to a local
   rotating file + a `/health` endpoint (counts, allowlist hash); the Railway side is flag-gated
   (`W9_1_SOS_DIRECT`, OFF in-migration) AND the box service can simply be stopped — either kills
   the pipeline honestly (adapters revert to honest-blocked, never silent).

**Deliver as:** `sos-proxy/` in the repo (service + config + tests) + a Windows install runbook
for Scott (nssm/sc service install, cloudflared config addition with the exact YAML block, CF
Zero Trust dashboard steps for the new hostname/policy/token, env vars). Mirror the GaryBuilt
playbook's format — Scott has done this dance once already.

## Part B — reconnect the SOS pipeline through it

1. The SOS fetch layer (gov repo adapters / the LCC webhook seam — ground which side actually
   fetches) gains a transport option: `SOS_PROXY_URL` + CF Access headers (the ai.js CF-header
   pattern). When set, all SOS fetches route through the proxy; unset ⇒ honest-blocked as today.
2. **Re-verify each adapter live through the proxy** (the July verification found AZ migrated —
   re-ground each state's endpoint/parse before enabling it; update `SOS_STATE_ADAPTERS` enabled
   flags + registry rows per state, the 36y rule).
3. **Wire into 98's stage runner** as the SOS stage: value-ranked no-contact owners whose entity
   name resolves in a state registry → registered-agent / officer names + addresses as
   CREATE-contact proposals (provenance `sos_registry`, the fsp ladder already ranks it) — lane
   confirm, never auto. Weekly cadence at most (registry data moves slowly); budget/bounded per
   the house pattern.
4. **Tests:** allowlist enforcement (off-list host rejected), rate-limit behavior, transport
   fallback to honest-blocked, adapter re-verification fixtures, stage integration.

## Acceptance

- Proxy installed by Scott (runbook), `/health` reachable via tunnel with the new token, a
  verification fetch of one FL + one CA registry page succeeds through residential egress where
  Railway-direct 403s (prove the unblock with a side-by-side).
- Dry-run of the SOS stage on ~10 top-value owners → sampled proposal sheet (agent/officer names
  with source URLs) → Scott reviews → Cowork flips `W9_1_SOS_DIRECT`.
- ROLLOUT_STATUS W9.1 Stage 2 row; kickoff status; prompt to done/. CF token rotation item (§3C)
  folds in here — rotate BOTH service tokens while in the Zero Trust dashboard.

Commit with the repo Co-Authored-By + Claude-Session trailer.
