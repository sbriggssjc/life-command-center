import { corsHeaders, jsonResponse } from "./utils.ts";
import { handleHealth, handleSearchProperty, handleEnrich, handleChat, handleSyncActivities, handleSyncAccounts } from "./handlers-a.ts";
import { handleLogToSF, handleContactLookup, handleSyncSFTasks, handleGetSFTasks, handleGetSFActivities } from "./handlers-b1.ts";
import { handleSyncFlaggedEmails, handleGetFlaggedEmails, handleSyncCalendarEvents, handleGetCalendarEvents, handleBDRouteTask, handleBDDailyProgress, handleBDGenerateEmail, handleBDAutoReschedule, handleBDLogCompletion, handleBDConfig, handleBDConfigUpdate } from "./handlers-b2.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/ai-copilot/, "");
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