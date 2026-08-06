# LCC Deal Intelligence connector spec — changelog

> `info.description` in the swagger must stay under Power Platform's **1000-char limit**
> (import fails otherwise: "custom connector description ... too long"). Keep the full
> changelog HERE, not in the spec.

- **v4.2.0 (2026-08-06):** RESTORED the 41 legacy `/api/copilot/compat/*` snake_case
  operations (verbatim from v3, security normalized to apiKey) — the v4 cleanup removed
  them but the Copilot Studio agent still had tool tiles bound to those operationIds, so
  importing v4 made every agent message fail with ConnectorOperationNotFound. Server
  still routes `/api/copilot/compat/:action` through the dispatch registry; all 41
  verified in ACTION_REGISTRY. Retirement order: delete tile in Studio → Publish → then
  drop the op from this spec.
- **v4.1.1 (2026-08-06):** removed the bearerAuth securityDefinition — Power Platform
  honors only ONE security definition per connector; importing a spec with two flipped
  the API-key header from X-LCC-Key to Authorization → 401 on every call (root cause of
  the 2026-08-06 agent outage). apiKey/X-LCC-Key is the ONLY auth definition.
- **v4.1.0 (2026-08-06):** added W7.3 capture actions `log_call_note` +
  `tag_comm_to_deal` to the dispatchCopilotAction copilot_action enum.
- **v4.0.x:** x-ms-requestBody-name added to all POST body params
  (PowerFxJsonException fix); PascalCase dedicated operations.
