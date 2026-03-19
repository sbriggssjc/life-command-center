// ============================================================================
// RCM Ingest API — Parses RCM email notifications into marketing_leads
// Life Command Center
//
// Receives POST from Power Automate with raw email body, parses structured
// contact fields, inserts into marketing_leads, and attempts SF matching.
//
// Routed via vercel.json: /api/rcm-ingest → /api/rcm-ingest
// ============================================================================

import { authenticate, requireRole, primaryWorkspace, handleCors } from './_shared/auth.js';

const DIA_SUPABASE_URL = process.env.DIA_SUPABASE_URL;
const DIA_SUPABASE_KEY = process.env.DIA_SUPABASE_KEY;

// ============================================================================
// RCM EMAIL PARSER
// ============================================================================

/**
 * Parse an RCM notification email body to extract structured contact fields.
 *
 * Handles common RCM email patterns:
 *   - Label-value pairs (Name: John Smith)
 *   - Label-value with extra whitespace
 *   - Inline text with extractable email/phone via regex
 *   - HTML remnants in plain text conversion
 */
function parseRcmEmail(rawBody, subject) {
  const lines = rawBody.split('\n').map(l => l.trim()).filter(Boolean);

  function extractAfterLabel(labels) {
    for (const label of labels) {
      for (const line of lines) {
        if (line.toLowerCase().startsWith(label.toLowerCase())) {
          return line.substring(label.length).trim().replace(/^[:\s]+/, '');
        }
      }
    }
    return null;
  }

  // Extract by label
  const name = extractAfterLabel(['Full Name:', 'Name:', 'Contact:', 'Requestor:']);
  const company = extractAfterLabel(['Company:', 'Firm:', 'Organization:', 'Affiliation:']);
  const inquiryType = extractAfterLabel(['Request Type:', 'Inquiry:', 'Action:', 'Type:']);
  const propertyRef = extractAfterLabel(['Property:', 'Listing:', 'Asset:']);

  // Extract email via regex (more reliable than labels for varied formats)
  const emailMatch = rawBody.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const email = emailMatch ? emailMatch[0] : null;

  // Extract phone via regex
  const phoneMatch = rawBody.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0] : null;

  // Split name into first/last
  let firstName = null, lastName = null;
  if (name) {
    const parts = name.split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(' ') || null;
  }

  return {
    lead_name: name,
    lead_first_name: firstName,
    lead_last_name: lastName,
    lead_email: email,
    lead_phone: phone,
    lead_company: company,
    deal_name: subject || propertyRef || null,
    activity_type: inquiryType || 'rcm_inquiry',
    activity_detail: inquiryType
  };
}

// ============================================================================
// HANDLER
// ============================================================================

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const ws = primaryWorkspace(user);
  if (!ws || !requireRole(user, 'operator', ws.workspace_id)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  if (!DIA_SUPABASE_URL || !DIA_SUPABASE_KEY) {
    return res.status(500).json({ error: 'DIA Supabase not configured' });
  }

  const { source, source_ref, deal_name, raw_body, status } = req.body || {};

  if (!raw_body) {
    return res.status(400).json({ error: 'raw_body is required' });
  }
  if (source !== 'rcm') {
    return res.status(400).json({ error: 'source must be "rcm"' });
  }

  // Parse the email body
  const parsed = parseRcmEmail(raw_body, deal_name);

  const insertPayload = {
    source: 'rcm',
    source_ref: source_ref || null,
    lead_name: parsed.lead_name,
    lead_first_name: parsed.lead_first_name,
    lead_last_name: parsed.lead_last_name,
    lead_email: parsed.lead_email,
    lead_phone: parsed.lead_phone,
    lead_company: parsed.lead_company,
    deal_name: parsed.deal_name,
    activity_type: parsed.activity_type,
    activity_detail: parsed.activity_detail,
    raw_body: raw_body,
    status: status || 'new',
    ingested_at: new Date().toISOString()
  };

  // Insert into marketing_leads (ON CONFLICT DO NOTHING for dedup on source+source_ref)
  try {
    const insertUrl = `${DIA_SUPABASE_URL}/rest/v1/marketing_leads`;
    const insertRes = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        'apikey': DIA_SUPABASE_KEY,
        'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation,resolution=ignore-duplicates'
      },
      body: JSON.stringify(insertPayload)
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return res.status(insertRes.status).json({
        error: 'Failed to insert marketing lead',
        detail: errText
      });
    }

    const inserted = await insertRes.json();
    const lead = Array.isArray(inserted) ? inserted[0] : inserted;

    // If no row returned, it was a duplicate (conflict ignored)
    if (!lead || !lead.lead_id) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        message: 'Lead already exists (duplicate source_ref)',
        source_ref
      });
    }

    // Attempt auto-match to Salesforce by email
    let sfMatch = null;
    if (parsed.lead_email) {
      try {
        const sfUrl = new URL(`${DIA_SUPABASE_URL}/rest/v1/salesforce_activities`);
        sfUrl.searchParams.set('select', 'sf_contact_id,first_name,last_name,company_name');
        sfUrl.searchParams.set('email', `eq.${parsed.lead_email}`);
        sfUrl.searchParams.set('limit', '1');

        const sfRes = await fetch(sfUrl.toString(), {
          headers: {
            'apikey': DIA_SUPABASE_KEY,
            'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        if (sfRes.ok) {
          const sfData = await sfRes.json();
          if (Array.isArray(sfData) && sfData.length > 0 && sfData[0].sf_contact_id) {
            sfMatch = sfData[0];

            // Update lead with SF match
            await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
              method: 'PATCH',
              headers: {
                'apikey': DIA_SUPABASE_KEY,
                'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                sf_contact_id: sfMatch.sf_contact_id,
                sf_match_status: 'matched'
              })
            });
          }
        }
      } catch (sfErr) {
        // SF matching is best-effort — don't fail the ingest
        console.error('SF match attempt failed:', sfErr.message);
      }
    }

    return res.status(201).json({
      ok: true,
      lead_id: lead.lead_id,
      parsed: {
        lead_name: parsed.lead_name,
        lead_email: parsed.lead_email,
        lead_phone: parsed.lead_phone,
        lead_company: parsed.lead_company,
        deal_name: parsed.deal_name,
        activity_type: parsed.activity_type
      },
      sf_match: sfMatch ? {
        sf_contact_id: sfMatch.sf_contact_id,
        name: `${sfMatch.first_name || ''} ${sfMatch.last_name || ''}`.trim()
      } : null
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
