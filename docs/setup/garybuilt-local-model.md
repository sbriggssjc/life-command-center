# GaryBuilt local-model stand-up — LCC on-prem background analyst

**Goal:** run an open-source LLM on Scott's home desktop ("GaryBuilt") that does LCC's
**background** AI work — extraction, data review, draft/review of work product — at
**zero incremental cloud cost**, while all interactive/chat work stays on
Claude / Cowork / Northmarq Claude / Copilot / ChatGPT. Cloud stays the automatic
fallback, so a powered-off desktop never breaks the pipeline.

This is a playbook you (Scott) run once on the machine. The LCC side is already wired:
the Ollama provider seam ships in `api/_shared/ai.js` and activates the moment
`OLLAMA_URL` is set in Railway — no code change to switch over.

---

## 0. What GaryBuilt can run

| Spec | Value | Implication |
|---|---|---|
| GPU | NVIDIA RTX 3060, **12 GB VRAM** | Fits a **14B model at Q4** (~8–9 GB) fully on-GPU, or 8B with room to spare. |
| CPU | Ryzen 5 5600X (6c/12t) | Fine for offload + serving; GPU does the work. |
| RAM | 48 GB | Ample; model runs in VRAM, RAM holds the OS + KV cache overflow. |
| Net | Ethernet → fiber, UPS on both | Stable enough to expose a tunnel during/after hours. |
| OS | Windows | Use the native Windows Ollama build (no WSL needed). |

**Model recommendation (start here):** `qwen2.5:14b` (Q4_K_M). Strong at structured
extraction and instruction-following, fits the 3060 comfortably, permissive license.
Alternates: `phi4:14b` (Microsoft, excellent reasoning/JSON), or `llama3.1:8b` if you
want maximum headroom / faster tokens. All are one `ollama pull` away, so you can A/B
them later without touching LCC.

> Rule of thumb for the 3060: a **14B Q4** model is the ceiling for all-on-GPU speed.
> Bigger (32B+) will spill to CPU and crawl — don't. Update the tag as better small
> models ship (that's the whole point of keeping this model-agnostic).

---

## 1. Install Ollama (Windows)

1. Download the Windows installer from https://ollama.com/download and run it.
2. It installs as a background service and auto-starts on login. Confirm in a terminal:
   ```powershell
   ollama --version
   ```
3. Pull the model (first pull downloads ~9 GB):
   ```powershell
   ollama pull qwen2.5:14b
   ```
4. Smoke-test it uses the GPU:
   ```powershell
   ollama run qwen2.5:14b "Reply with only the word: ready"
   ```
   In another terminal, `nvidia-smi` should show the `ollama` process holding ~8–9 GB
   VRAM while it answers. If it's on CPU (slow, no VRAM use), the GPU driver needs a
   refresh — install the latest **NVIDIA Game Ready / Studio** driver and reboot.

### Keep it serving on the LAN
By default Ollama listens on `127.0.0.1:11434` only. To let the tunnel reach it, set an
environment variable (System → Environment Variables, or PowerShell as admin):
```powershell
setx OLLAMA_HOST "0.0.0.0:11434" /M
```
Then restart the Ollama service (or reboot). Verify: `curl http://localhost:11434/api/tags`.

### Keep the model warm (avoid cold-load latency)
```powershell
setx OLLAMA_KEEP_ALIVE "-1" /M
```
`-1` keeps the model resident in VRAM indefinitely so background jobs don't pay a
10–20 s reload each time. (If you'd rather free the GPU when idle, use e.g. `30m`.)

---

## 2. Expose it to Railway — pick ONE

Railway (the cloud LCC server) needs to reach GaryBuilt over the internet. Home ISPs
block inbound ports, so use an **outbound** tunnel — no port-forwarding, no static IP.

### Option A — Cloudflare Tunnel (recommended: stable hostname, free)
1. Install `cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Quick tunnel (ephemeral URL, good for a first test):
   ```powershell
   cloudflared tunnel --url http://localhost:11434
   ```
   It prints `https://<random>.trycloudflare.com` → that's your `OLLAMA_URL`.
3. **Persistent** (recommended once it works): `cloudflared tunnel login`, create a named
   tunnel, map a subdomain you own (e.g. `garybuilt.yourdomain.com`), and install it as a
   Windows service so it survives reboots. Cloudflare's "Connect an application" guide
   walks this in 5 minutes.
4. **Lock it down** (this is an open inference endpoint): put **Cloudflare Access** in
   front of the hostname with a **Service Auth** policy + service token.
   **CORRECTED 2026-07-31 (session 33):** Access service tokens authenticate with the
   `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers — a Bearer header does
   NOT pass an Access policy. The seam now sends those headers when
   `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET` are set in Railway (ai.js
   patched this session; `OLLAMA_API_KEY`/Bearer remains for other proxy styles).

### Option B — Tailscale (simplest if you don't want a public hostname)
1. Install Tailscale on GaryBuilt **and** add it to the Railway service (Tailscale has a
   Railway integration / you can run `tailscaled` in the container). Both join your tailnet.
2. `OLLAMA_URL = http://<garybuilt-tailscale-ip>:11434`. Traffic is WireGuard-encrypted
   and never touches the public internet — no separate auth layer needed.

Either way the connection is **outbound from GaryBuilt**, so your home firewall stays closed.

---

## 3. Flip LCC over (config-only, in Railway env)

Once the tunnel answers, set these in the Railway service and redeploy:

| Var | Value |
|---|---|
| `OLLAMA_URL` | your tunnel URL (Cloudflare hostname or Tailscale `http://ip:11434`) |
| `OLLAMA_MODEL` | `qwen2.5:14b` |
| `AI_EXTRACTION_PROVIDER` | `ollama` (routes extraction to local; unset keeps edge primary) |
| `OLLAMA_API_KEY` | *(Option A only)* the Cloudflare Access service token |

Then update the flags registry row: set `OLLAMA_EXTRACTION.state = 'on'`.

**Verify end-to-end:**
```
GET  https://<railway>/api/diag?kind=ai-ping     # if present, or trigger a test intake
```
Watch for `ai_final_provider: "ollama"` in the per-artifact diagnostics. Kill the tunnel
and re-run — it should fall back to edge/OpenAI cleanly (that's the safety net proving out).

---

## 4. Reliability & housekeeping

- **Fallback is automatic.** The seam returns control to `AI_EXTRACTION_FALLBACK_CHAIN`
  on any Ollama error/timeout, so GaryBuilt being off, asleep, or mid-Windows-update
  degrades to cloud, never to a broken pipeline. You can run GaryBuilt business-hours-only.
- **Keep it awake.** Set Windows power plan to never sleep (or "when plugged in: never"),
  and disable "USB selective suspend" for the NIC. UPS already covers brownouts.
- **Auto-start order:** Ollama service (auto) → cloudflared service (auto). Both as
  Windows services so a reboot fully self-heals with no login.
- **Disk:** each model is ~5–9 GB; keep 2–3 tags around for A/B, prune the rest with
  `ollama rm <tag>`.
- **Security:** never expose `:11434` without Access/Tailscale in front — an open Ollama
  endpoint is a free GPU for anyone who finds it. BitLocker the drive (Settings → Privacy
  & security → Device encryption) since deal data transits the box.

---

## 5. Roadmap — rolling the local analyst to more functions

Phase 1 wires **extraction** (intake OM parsing + the next-step engine) to the seam. The
same `invokeOllamaExtraction` path generalizes to every background job as you go:

1. **Now:** intake extraction + content-aware next-step derivation (this bundle).
2. **Next:** overnight data-review sweeps (portfolio/provenance QA, dedup candidate
   scoring) — batch jobs that don't need cloud and love a always-on local GPU.
3. **Then:** draft generation — follow-up emails, template drafts — grounded in
   `BRIGGS-WRITING-VOICE.md` via RAG/few-shot first; a LoRA fine-tune on the 10-yr sent
   corpus later if the few-shot voice isn't tight enough.
4. **Interactive stays cloud.** Chat, Cowork, Northmarq Claude, Copilot, ChatGPT keep the
   on-demand seat. GaryBuilt is the tireless background analyst, not the chat model.

Update the model tag (`OLLAMA_MODEL`) as better small open models ship — no LCC code
change, just a `pull` + env bump.

---

## 6. Session-33 expansion map (2026-07-31 — post-Wave-4 integration review)

Wave 4 (entity-resolution stack) and W3.7c (SF file discovery) shipped after this
playbook was written; Cowork's integration review mapped GaryBuilt into them:

1. **W5.1 party extraction — channel B (✅ MECHANISM SHIPPED 2026-07-31).** Channel B
   runs through THIS seam (`invokeExtractionAI`) — no second Ollama client. The
   adjudicator (`api/_handlers/party-extract.js`) writes only on field-level agreement
   with the GLiNER span channel (`resolver POST /extract-parties`); the bulk run
   (`scripts/party-extract-backlog.mjs --apply`) is GATED on `ai_final_provider='ollama'`
   so the sweep costs zero cloud (override: `W51_ALLOW_CLOUD=1`). **Grounded correction:**
   the addressable note backlog is smaller than the audit's raw missing counts —
   `sale_notes_raw` covers ~281 dia / ~163 gov live sales; folding dia's `notes` column
   lifts dia to ~2,242. Realizing value needs OLLAMA_URL live + the 100-sample gate. See
   `audit/data-flow-2026-05-30/CLAUDECODE_PROMPT_w51_party_extraction_local_llm.md`.
2. **OM extraction cost-avoidance (automatic once cut over).** W3.7c file discovery
   now drains 679 gov + 465 dia staged ids' attachments through
   `/api/intake/stage-om` — each OM is an AI extraction call. The moment
   `OLLAMA_URL` is live, that whole growing stream rides the local GPU (cloud
   stays fallback).
3. **Review-lane pre-screen (OPTIONAL, not yet approved).** A nightly batch that
   annotates the sf_link review queue (3,357 pending) with a non-binding local-LLM
   same-party opinion + one-line reasoning, used only to SORT the lane (confident-
   distinct cluster first for fast rejection sweeps). Labels remain 100% human —
   the annotation never writes a verdict. Ships only with its own consumer + gate
   (producer/consumer doctrine).
4. **Hard-negative candidate proposals (OPTIONAL, not yet approved).** The W4.1
   corpus generator refuses to auto-label shared-rare-token pairs (could be same
   party). A local-LLM pass can PROPOSE the likely-distinct subset of those pairs
   into the review lane, accelerating exactly the hard-negative accrual the W4.4
   drift alerts are waiting on. Human adjudicates; corpus ingests via
   entity_match_labels as usual.
5. **What stays deterministic:** W5.2 signal value-gates, resolver scoring bands,
   ORE merge decisions — no LLM in auditable gates.

## 7. Employment map — where the local model works across LCC (path forward)

Doctrine first: GaryBuilt does **background** work only; **never** an auditable
gate (resolver bands, ORE merges, W5.2 value thresholds) and never the
interactive chat seat. Every new use ships with its own consumer + gate.

**LIVE NOW (via the seam, since cutover):**
- Intake OM extraction (`/api/intake/stage-om` pipeline — includes the whole
  W3.7c Salesforce file stream as discovery drains gov 679 + dia 465 ids).
- Content-aware next-step derivation (next-step engine).

**BUILT, GATED (run when approved):**
- W5.1 party extraction channel B — 100-sample sheet → Scott → `--apply`.

**NEAR-TERM CANDIDATES (background batch, high fit, in rough value order):**
1. **Junk-entity-name pre-screen** — the `junk_entity_name` lane has absorbed
   ~2,000 human decisions; a nightly local pass can PROPOSE
   dismiss/rename/parse_contact verdicts as annotations for one-click confirm
   (verdicts stay human; mirrors the sf_link pre-screen pattern).
- 2. **Review-lane pre-screen sort** + **hard-negative candidate proposals**
   (§6 items 3–4) — accelerates the W4.4 drift-alert self-resolution.
3. **Email-intake classification assist** — `email_intake_v2` review_reason
   triage annotations (background, human disposition unchanged).
4. **Daily-briefing narrative polish** — the briefing snapshot's prose section
   generated locally each night instead of cloud.
5. **Research synthesis** — owner-contact-websearch / research_task result
   summarization into structured payloads.

**MID-TERM (needs design):**
- Draft generation grounded in `BRIGGS-WRITING-VOICE.md` (playbook phase 3):
  outreach/follow-up drafts, BOV exhibit narrative FIRST DRAFTS for human edit.
  Respect the offer-submission doctrine — strategy stays verbal, drafts only.
- ~~`match_disambiguation` card assist annotations (1,120 open, zero decided — an
  LLM first-pass ranking might be what finally makes that lane workable).~~
  **✅ SHIPPED (Prompt 80, 2026-08-08).** Nightly Ollama pre-rank (`/api/match-disambig-assist-tick`,
  flag `MATCH_DISAMBIG_ASSIST` OFF, ~20/night, resumable via the `metadata->>assist IS NULL`
  cursor) ranks each card's candidates best-first into `lcc_decisions.metadata.assist` — an
  ANNOTATION, never a verdict (the SQL writer `lcc_annotate_match_disambig_assist` is metadata-only
  and structurally cannot touch verdict/status). The lane sorts by the assist's top confidence,
  shows each candidate's rank/reason inline, and adds a one-click "assist agrees" confirm on the
  existing verdict path. Every human verdict records agree/disagree vs the assist's top pick
  (`metadata.assist_agreed`) → `v_lcc_w8_u4_match_assist_accuracy` feeds the U4 report a per-month
  accuracy metric (the future gate for auto-resolving the top-confidence band — NOT yet; no LLM in
  auditable gates until measured). **Grounded live (LCC Opps 2026-08-08):** the open lane is now
  **32** cards (the "1,120" was a historical high-water mark), all unannotated — the mechanism is
  the durable fix; realizing value needs `OLLAMA_URL` live + the flag flipped.
- LoRA fine-tune on the 10-yr sent corpus if few-shot voice isn't tight enough.

**Measured note (2026-07-31 live test):** GLiNER channel A on real dia notes —
sale 14787 extracted buyer/seller/price perfectly; sale 14808 got the broker
right but returned the TENANT (DaVita) as seller — the exact miss class the
channel-B adjudication + human sample gate exist to catch. First-call latency is
high (model cold start; third call exceeded 120s) — the sample runner should
warm both channels first and use generous per-call timeouts.

**Cutover state: LIVE (2026-07-31 evening, session 33).** Permanent transport built
and verified end-to-end: named Cloudflare tunnel `garybuilt.briggscrelccopps.com`
(cloudflared as a Windows service, auto-start) + **Access Service Auth** policy with
the `lcc-railway` service token. Verified: unauthenticated → 403 Access page (GPU
not exposed); authenticated `/api/tags` → qwen2.5:14b present; `OLLAMA_URL`
(**https**, no trailing slash — http would 301 and silently convert POSTs to GETs,
the same hazard class as the GOV_SUPABASE_URL incident) + `OLLAMA_MODEL` +
`AI_EXTRACTION_PROVIDER=ollama` + `CF_ACCESS_CLIENT_ID/SECRET` set on LCC Railway;
ai.js patched to send the CF Access headers. `feature_flags_registry.OLLAMA_EXTRACTION
= on`. Remaining niceties: observe `ai_final_provider: "ollama"` on the first real
extraction, and an optional fallback drill (stop the Ollama service for a minute →
confirm clean cloud degradation — the seam's fallback is also unit-covered).
