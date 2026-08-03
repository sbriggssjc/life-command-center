# Prompt 20 — Trim two comps descriptions in lcc-openapi.yaml to <=300 chars (ChatGPT Actions limit)

## Why
ChatGPT custom-GPT Actions cap each operation's `description` at ~300 characters. When Scott tried to update the
"Briggs CRE Analyst" GPT with the current schema, it rejected two operations. Confirmed by counting characters in
`docs/comps-rollout/lcc-openapi.yaml`:
- `queryComps` description = **459 chars** (over)
- `synthesizeComps` description = **421 chars** (over)
- `generateComps` description = 270 chars (fine)

The Power Platform Swagger 2.0 file (`copilot/lcc-deal-intelligence.connector.v4.swagger.json`) already carries
short versions of these — QueryComps = 247, SynthesizeComps = 246 — so the fix is to port those shorter texts
into the OpenAPI yaml. Do NOT change behavior, paths, params, or schemas — only the two `description` strings.

## Task
In `docs/comps-rollout/lcc-openapi.yaml`:
1. Replace the `queryComps` operation `description` with a <=300-char version (reuse/adapt the swagger's ~247-char
   text). It must still say: pulls candidate dialysis/government sale comps from the LCC engine for a market/asset,
   with filters (geography, product type, date window, cap/price), returns a bounded ranked set (not the universe).
2. Replace the `synthesizeComps` operation `description` with a <=300-char version (reuse the swagger's ~246-char
   text). It must still say: takes a comp set (or query) and produces the narrative/adjusted synthesis + summary
   stats used in a BOV/OM.
3. Leave `generateComps` and all 7 read ops untouched.

## Verify
- `python3 -c "import yaml;d=yaml.safe_load(open('docs/comps-rollout/lcc-openapi.yaml'));import sys;\
  [print(k,len(v['description'])) for k,v in {op['operationId']:op for p in d['paths'].values() for op in p.values() if isinstance(op,dict) and 'operationId' in op}.items()]"`
  — every operation's description length must be <=300.
- Confirm the yaml still parses and the two ops keep the same `operationId`, path, method, params, and responses.

## After
Scott re-imports the schema into the ChatGPT GPT (Configure -> Actions -> replace schema), sets
`servers[0].url = https://tranquil-delight-production-633f.up.railway.app`, Bearer auth. Then test:
"Government medical-office comps in Texas, last 12 months" and "Pull DaVita comps in The Villages, FL."

## Note
This is a stopgap. Prompt 21 (Copilot Studio -> /mcp direct) removes the per-surface OpenAPI maintenance for the
Microsoft side entirely; ChatGPT still needs the OpenAPI schema, so this trim stays useful for ChatGPT.
