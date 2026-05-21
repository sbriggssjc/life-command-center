import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export const DIALYSIS_URL = Deno.env.get("SUPABASE_URL") || "";
export const DIALYSIS_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
export const GOV_URL = "https://scknotsqkcheojiaewwh.supabase.co";
export const GOV_ANON_KEY = Deno.env.get("GOV_ANON_KEY") || "";
export const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
export const PA_LOG_ACTIVITY_URL = Deno.env.get("PA_LOG_ACTIVITY_URL") || "";

export function getDialysisClient() { return createClient(DIALYSIS_URL, DIALYSIS_SERVICE_KEY); }
export function getGovClient() { return createClient(GOV_URL, GOV_ANON_KEY); }

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export function normalizeSFArray<T>(input: T[] | { value?: T[] } | undefined | null): T[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'object' && 'value' in input && Array.isArray(input.value)) return input.value;
  return [];
}

export interface SFActivity { sf_task_id: string; subject?: string; first_name?: string; last_name?: string; sf_contact_id?: string; company_name?: string; sf_company_id?: string; company_address?: string; company_city_state?: string; assigned_to?: string; nm_type?: string; activity_date?: string; nm_notes?: string; task_subtype?: string; email?: string; phone?: string; status?: string; }
export interface SFAccount { [key: string]: unknown; }
export interface SFContact { [key: string]: unknown; }
export interface SFTask { Id?: string; id?: string; Subject?: string; subject?: string; Description?: string; description?: string; Status?: string; status?: string; Priority?: string; priority?: string; ActivityDate?: string; activity_date?: string; OwnerId?: string; owner_id?: string; WhoId?: string; who_id?: string; WhoName?: string; who_name?: string; WhatId?: string; what_id?: string; WhatName?: string; what_name?: string; TaskType?: string; task_type?: string; Type?: string; CreatedDate?: string; created_date?: string; LastModifiedDate?: string; last_modified_date?: string; [key: string]: unknown; }
export interface FlaggedEmail { Id?: string; id?: string; Subject?: string; subject?: string; SenderName?: string; sender_name?: string; SenderEmail?: string; sender_email?: string; ReceivedDate?: string; received_date?: string; receivedDateTime?: string; FlagStatus?: string; flag_status?: string; FlagDueDate?: string; flag_due_date?: string; Importance?: string; importance?: string; HasAttachments?: boolean; has_attachments?: boolean; hasAttachments?: boolean; Preview?: string; preview?: string; bodyPreview?: string; Categories?: string[]; categories?: string[]; WebLink?: string; web_link?: string; webLink?: string; [key: string]: unknown; }

export function constructOutlookWebLink(messageId: string): string | null {
  if (!messageId) return null;
  return `https://outlook.office365.com/mail/inbox/id/${encodeURIComponent(messageId)}`;
}

export function constructOutlookDesktopLink(webLink: string | null, messageId?: string): string | null {
  if (webLink) return `ms-outlook://open?url=${encodeURIComponent(webLink)}`;
  if (messageId) return `ms-outlook://open?url=${encodeURIComponent(`https://outlook.office365.com/mail/inbox/id/${encodeURIComponent(messageId)}`)}`;
  return null;
}

export function constructSFTaskLink(taskId: string): string | null {
  if (!taskId) return null;
  return `https://northmarqcapital.lightning.force.com/lightning/r/Task/${taskId}/view`;
}

export function parseSenderEmail(e: FlaggedEmail): string | null {
  if (e.SenderEmail) return e.SenderEmail as string;
  if (e.sender_email) return e.sender_email as string;
  const fromVal = e.from;
  if (typeof fromVal === 'string' && fromVal) {
    const angleMatch = fromVal.match(/<([^>]+)>/);
    if (angleMatch) return angleMatch[1];
    if (fromVal.includes('@')) return fromVal.trim();
  }
  if (fromVal && typeof fromVal === 'object') {
    const addr = (fromVal as Record<string,unknown>)?.emailAddress as Record<string,string> | undefined;
    if (addr?.address) return addr.address;
  }
  return null;
}

export function parseSenderName(e: FlaggedEmail): string | null {
  // Try explicit fields first
  let name: string | null = null;
  if (e.SenderName) name = e.SenderName as string;
  else if (e.sender_name) name = e.sender_name as string;
  else {
    const fromVal = e.from;
    if (typeof fromVal === 'string' && fromVal) {
      const angleMatch = fromVal.match(/^(.+?)\s*<[^>]+>$/);
      if (angleMatch) name = angleMatch[1].trim().replace(/^["']|["']$/g, '');
    } else if (fromVal && typeof fromVal === 'object') {
      const addr = (fromVal as Record<string, unknown>)?.emailAddress as Record<string, string> | undefined;
      if (addr?.name) name = addr.name;
    }
  }

  // Validate: if name looks like a mailbox alias (no spaces, or matches common
  // non-name patterns), return null so the post-sync SQL can resolve it properly
  if (name) {
    const trimmed = name.trim();
    const PLACEHOLDERS = ['account', 'postmaster', 'noreply', 'no-reply', 'mailer-daemon', 'info', 'support', 'admin', 'award', 'cfo'];
    if (trimmed.includes('@')) return null;  // It's an email address, not a name
    if (PLACEHOLDERS.includes(trimmed.toLowerCase())) return null;
    if (!trimmed.includes(' ') && trimmed.length < 30) {
      // Single word — could be alias like "Sbriggssjc" or legit org like "GovTribe"
      // If it matches the local part of the sender email, it's definitely an alias
      const email = parseSenderEmail(e);
      if (email) {
        const localPart = email.split('@')[0].toLowerCase().replace(/[._-]/g, '');
        if (trimmed.toLowerCase().replace(/[._-]/g, '') === localPart) return null;
      }
    }
    return trimmed;
  }
  return null;
}

export const VALID_ACTIVITY_TYPES = ["Client Outreach", "Market Update", "Follow-up", "Introduction Call", "Property Discussion", "Email Correspondence"];

const ACTIVITY_CATEGORY_PATTERNS: Record<string, RegExp> = {
  'Government - GSA': /\bGSA\b|general\s*services\s*administration/i,
  'Government - VA': /\bVA\b.*(?:hospital|clinic|medical|vet)|veterans?\s*affairs/i,
  'Government - SSA': /\bSSA\b|social\s*security/i,
  'Government - USPS': /\bUSPS\b|post\s*office|postal/i,
  'Government - Federal': /\b(?:FBI|DEA|EPA|ICE|BLM|USCIS|FEMA|DOJ|DOD|DOE|HHS|IRS|CBP|ATF|NOAA|NASA|FAA|FCC|SEC|USDA|DOT|DOI|DHS)\b|federal\s*(?:building|office|courthouse|facility)|u\.?s\.?\s*(?:courthouse|customs|border)|department\s*of/i,
  'Government - State/Local': /\bstate\s*(?:office|building|agency)|county\s*(?:office|building|courthouse)|(?:city|municipal)\s*(?:office|building|hall)|government(?:\s*-?\s*(?:leased|owned))?/i,
  'Government': /^government\b/i,
  'Dialysis - DaVita': /\bdavita\b/i,
  'Dialysis - FMC/Fresenius': /\b(?:fmc|fresenius)\b/i,
  'Dialysis': /dialysis|renal|kidney\s*care|nephrol/i,
  'Medical/Healthcare': /medical\s*(?:buyer|developer|owner|office|center)|(?:hospital|clinic|health\s*care|healthcare|physician|urgent\s*care|dental|optom|ophthalm|orthoped|cardio|oncol|radiol|physical\s*therapy|rehab|ambulat|surgical\s*center)/i,
  'Net Lease/Portfolio': /net\s*lease|portfolio\s*(?:buyer|owner|developer)|blue\s*suit|\bnnn\b/i,
  'Developer': /(?:^|\s)(?:\d+\s*-?\s*)?(?:developer|development)\b/i,
  'Tenant': /(?:^|\s)(?:\d+\s*-?\s*)?tenant\b/i,
  'Follow-up': /follow\s*up|callback|emailed|om\s*download/i,
  'Call': /^call\b|^calls?\s*-/i,
  'Priority': /^!!!/,
};

export function categorizeActivity(subject: string | null): string {
  if (!subject) return 'Uncategorized';
  for (const [category, pattern] of Object.entries(ACTIVITY_CATEGORY_PATTERNS)) {
    if (pattern.test(subject)) return category;
  }
  if (/^\d+\s*-/.test(subject)) return 'Numbered Task';
  return 'General';
}

const TASK_CATEGORY_PATTERNS: Record<string, RegExp> = {
  'Follow-up': /follow\s*up|check\s*in|touch\s*base|reconnect|circle\s*back/i,
  'Call': /call|phone|dial|ring|voicemail|vm|spoke\s*with|spoke\s*to/i,
  'Email': /email|send|forward|reply|respond|correspondence|wrote/i,
  'Meeting': /meeting|meet|lunch|coffee|visit|tour|site\s*visit/i,
  'Proposal': /proposal|bid|offer|quote|pricing|underwriting|loi|letter\s*of\s*intent/i,
  'Research': /research|analyze|review|comp|market\s*survey|due\s*diligence/i,
  'Listing': /listing|om\s*download|offering\s*memorandum|brochure|marketing/i,
  'Admin': /update|log|note|record|file|organize|schedule/i,
};

export function categorizeTask(subject: string | null, whatType: string | null): string {
  if (!subject) return whatType || 'Uncategorized';
  for (const [category, pattern] of Object.entries(TASK_CATEGORY_PATTERNS)) {
    if (pattern.test(subject)) return category;
  }
  return whatType || 'General';
}

const EMAIL_CATEGORY_PATTERNS: Record<string, RegExp> = {
  'Deal/Transaction': /deal|transaction|closing|escrow|psa|purchase\s*agreement|contract|executed|signed/i,
  'Listing': /listing|om\b|offering\s*memorandum|brochure|just\s*listed|new\s*to\s*market|marketing/i,
  'Client Communication': /follow\s*up|check\s*in|touch\s*base|thank|appreciate|great\s*meeting/i,
  'Market Intel': /market\s*update|comp|cap\s*rate|vacancy|rent\s*growth|trend|report|research/i,
  'Meeting/Calendar': /meeting|calendar|invite|schedule|call\s*time|available|agenda/i,
  'Internal': /team|internal|northmarq|nmrq|staff|hr|compliance|training/i,
  'News/Newsletter': /newsletter|digest|alert|news|update|weekly|daily|morning/i,
};

export function categorizeEmail(subject: string | null, senderEmail: string | null): string {
  if (!subject) return 'Uncategorized';
  for (const [category, pattern] of Object.entries(EMAIL_CATEGORY_PATTERNS)) {
    if (pattern.test(subject)) return category;
  }
  if (senderEmail) {
    const domain = senderEmail.split('@')[1]?.toLowerCase() || '';
    if (domain.includes('northmarq')) return 'Internal';
    if (domain.includes('costar') || domain.includes('reonomy') || domain.includes('crexi')) return 'Market Intel';
  }
  return 'General';
}

export interface CalendarEvent {
  Id?: string; id?: string;
  Subject?: string; subject?: string;
  Start?: string | Record<string, unknown>; start?: string | Record<string, unknown>;
  End?: string | Record<string, unknown>; end?: string | Record<string, unknown>;
  Location?: string | Record<string, unknown>; location?: string | Record<string, unknown>;
  Organizer?: string | Record<string, unknown>; organizer?: string | Record<string, unknown>;
  IsAllDay?: boolean; isAllDay?: boolean; is_all_day?: boolean;
  CalendarName?: string; calendar_name?: string;
  Categories?: string[]; categories?: string[];
  BodyPreview?: string; bodyPreview?: string; body_preview?: string;
  WebLink?: string; webLink?: string; web_link?: string;
  Sensitivity?: string; sensitivity?: string;
  ShowAs?: string; showAs?: string; show_as?: string;
  ResponseStatus?: Record<string, unknown>; responseStatus?: Record<string, unknown>;
  IsRecurring?: boolean; isRecurring?: boolean; is_recurring?: boolean;
  [key: string]: unknown;
}

export const BD_ROUTING_PATTERNS: Record<string, RegExp> = {
  dialysis: /medical\s*(buyer|developer|owner)|dialysis|fmc|davita|fresenius|renal|kidney/i,
  government: /government|gsa|va\s*(developer|owner|portfolio)|federal|agency|veterans\s*affairs/i,
  blue_suit: /net\s*lease\s*(portfolio|developer|buyer)|portfolio\s*(buyer|owner)|blue\s*suit/i,
  listing_followup: /follow\s*up|callback|emailed|website|om\s*download|offering\s*memorandum|brochure|inquiry/i,
};