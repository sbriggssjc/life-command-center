import { corsHeaders, jsonResponse } from "./utils.ts";
import { handleHealth, handleSearchProperty, handleEnrich, handleChat, handleSyncActivities, handleSyncAccounts } from "./handlers-a.ts";
import { handleLogToSF, handleContactLookup, handleSyncSFTasks, handleGetSFTasks, handleGetSFActivities } from "./handlers-b1.ts";
import { handleSyncFlaggedEmails, handleGetFlaggedEmails, handleSyncCalendarEvents, handleGetCalendarEvents, handleBDRouteTask, handleBDDailyProgress, handleBDGenerateEmail, handleBDAutoReschedule, handleBDLogCompletion, handleBDConfig, handleBDConfigUpdate } from "./handlers-b2.ts";
import { authenticateWebhook } from "../_shared/auth.ts";
import { parseKnownIps, uaClass as callerUaClass, ipClass as callerIpClass, requestIp as callerRequestIp } from "../_shared/caller-class.ts";

// ── COPILOT-OPEN-gate ────────────────────────────────────────────────────────
// v79 shipped `verify_jwt:false` with no authenticateWebhook() call anywhere
// in the body — every route but the two below reached a service-role client
// with no credential of any kind (found by CI accidentally reaching /chat
// 798 times in 24h; see docs/os/PLANNED-BACKLOG.md COPILOT-OPEN). This gate
// reuses the SAME door intake-salesforce already sits behind
// (X-PA-Webhook-Secret against PA_WEBHOOK_SECRET, ../_shared/auth.ts).
//
// COPILOT_AUTH_MODE:
//   "log"     (default) — an unauthenticated non-/health request is logged
//             as DENY-WOULD and allowed through unchanged. This is the
//             mode this function ships in; it exists so the caller
//             inventory (PA flows, Railway, the browser) can be confirmed
//             complete BEFORE anything is refused.
//   "enforce" — the same request gets a 401 instead of reaching a handler.
// Any other value behaves as "log".
const COPILOT_AUTH_MODE = (Deno.env.get("COPILOT_AUTH_MODE") || "log").toLowerCase();

// COPILOT_KNOWN_IPS — a comma-separated list of `class:ip-prefix` pairs Scott
// sets from the caller inventory, e.g.
//   COPILOT_KNOWN_IPS=railway:152.55.,railway:162.220.232.,scott:<home-ip-prefix>
// Never hardcode an address in source — this file only knows the FORMAT.
const COPILOT_KNOWN_IPS = parseKnownIps(Deno.env.get("COPILOT_KNOWN_IPS"));

// SFENRICH-gate: the three classifier helpers used to be defined here as
// copilotUaClass/copilotIpClass/copilotRequestIp. Factored out to
// ../_shared/caller-class.ts (2026-09-09) so salesforce-enrichment's identical
// log-only gate does not grow a second copy — the normaliser-drift class this
// repo warns about repeatedly. Thin wrappers kept so the call sites below are
// unchanged.
function copilotUaClass(ua: string): string {
  return callerUaClass(ua);
}

function copilotIpClass(ip: string): string {
  return callerIpClass(ip, COPILOT_KNOWN_IPS);
}

function copilotRequestIp(req: Request): string {
  return callerRequestIp(req);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/ai-copilot/, "");

  // The gate runs BEFORE dispatch, for every route except /health (which
  // returns operational counts, not a credential or PII, and is what a
  // health probe needs to stay reachable with no auth — same as every other
  // edge function in this repo).
  if (path !== "/health" && path !== "/health/") {
    if (!authenticateWebhook(req)) {
      const uaClass = copilotUaClass(req.headers.get("user-agent") || "");
      const ipClass = copilotIpClass(copilotRequestIp(req));
      console.log(`[copilot-auth] DENY-WOULD ${req.method} ${path} ${uaClass} ${ipClass}`);
      if (COPILOT_AUTH_MODE === "enforce") {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
    }
  }

  try {
    if (req.method === "GET") {
      if (path === "/health" || path === "/health/") return await handleHealth();
      if (path === "/bd/daily-progress" || path === "/bd/daily-progress/") return await handleBDDailyProgress(url);
      if (path === "/bd/config" || path === "/bd/config/") return await handleBDConfig();
      if (path === "/sync/sf-tasks" || path === "/sync/sf-tasks/") return await handleGetSFTasks(url);
      if (path === "/sync/sf-activities" || path === "/sync/sf-activities/") return await handleGetSFActivities(url);
      if (path === "/sync/flagged-emails" || path === "/sync/flagged-emails/") return await handleGetFlaggedEmails(url);
      if (path === "/sync/calendar-events" || path === "/sync/calendar-events/") return await handleGetCalendarEvents(url);
      return jsonResponse({ error: "Not found", path }, 404);
    }
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const body = await req.json();
    if (path === "/search/property" || path === "/search/property/") return await handleSearchProperty(body);
    if (path === "/enrich" || path === "/enrich/") return await handleEnrich(body);
    if (path === "/chat" || path === "/chat/") return await handleChat(body);
    if (path === "/sync/activities" || path === "/sync/activities/") return await handleSyncActivities(req, body);
    if (path === "/sync/accounts" || path === "/sync/accounts/") return await handleSyncAccounts(req, body);
    if (path === "/sync/log-to-sf" || path === "/sync/log-to-sf/") return await handleLogToSF(body);
    if (path === "/sync/contact-lookup" || path === "/sync/contact-lookup/") return await handleContactLookup(body);
    if (path === "/sync/sf-tasks" || path === "/sync/sf-tasks/") return await handleSyncSFTasks(body);
    if (path === "/sync/flagged-emails" || path === "/sync/flagged-emails/") return await handleSyncFlaggedEmails(body);
    if (path === "/sync/calendar-events" || path === "/sync/calendar-events/") return await handleSyncCalendarEvents(body);
    if (path === "/bd/route-task" || path === "/bd/route-task/") return await handleBDRouteTask(body);
    if (path === "/bd/generate-email" || path === "/bd/generate-email/") return await handleBDGenerateEmail(body);
    if (path === "/bd/auto-reschedule" || path === "/bd/auto-reschedule/") return await handleBDAutoReschedule(body);
    if (path === "/bd/log-completion" || path === "/bd/log-completion/") return await handleBDLogCompletion(body);
    if (path === "/bd/config" || path === "/bd/config/") return await handleBDConfigUpdate(body);
    return jsonResponse({ error: "Not found", path }, 404);
  } catch (e) { console.error("ROUTER ERROR:", (e as Error).message, (e as Error).stack); return jsonResponse({ error: "Internal server error", details: (e as Error).message }, 500); }
});