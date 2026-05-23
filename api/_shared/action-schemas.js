// ============================================================================
// Action Schemas — Input/output JSON schemas for every ACTION_REGISTRY entry
// Life Command Center — Copilot Integration Layer
//
// These schemas serve three purposes:
//   1. OpenAPI spec generation for MS Copilot plugin discovery
//   2. Runtime input validation in the copilot_action gateway
//   3. Human-readable documentation of the action contract
//
// Schema format follows JSON Schema draft-07 (OpenAPI 3.0 compatible).
// Each entry maps an action_id → { description, category, inputs, outputs }
//
// Categories map to Copilot's natural language groupings:
//   portfolio  — "What should I work on?" / "What's happening?"
//   ops        — "Is the system healthy?" / "Are there errors?"
//   domain     — "Show me government/dialysis data"
//   outreach   — "Draft an email" / "Who should I contact?"
//   workflow   — "Triage this" / "Reassign that"
// ============================================================================

export const ACTION_SCHEMAS = {

  // =========================================================================
  // TIER 0 — READ-ONLY
  // =========================================================================

  get_daily_briefing_snapshot: {
    description: 'Get today\'s prioritized daily briefing with strategic, important, and urgent items requiring attention.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        timeframe: { type: 'string', enum: ['today', 'since_yesterday', 'this_week'], description: 'Time range for the briefing' },
        domain: { type: 'string', enum: ['government', 'dialysis', 'both'], description: 'Filter by business domain' }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        briefing: { type: 'object', description: 'Structured briefing with priority sections' },
        generated_at: { type: 'string', format: 'date-time' }
      }
    }
  },

  list_staged_intake_inbox: {
    description: 'List inbox items awaiting triage — flagged emails, SF tasks, system alerts.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'triaged', 'promoted', 'dismissed'], description: 'Filter by inbox status' },
        domain: { type: 'string', enum: ['government', 'dialysis'], description: 'Filter by domain' },
        source_type: { type: 'string', enum: ['flagged_email', 'sf_task', 'system', 'listing_bd_trigger'], description: 'Filter by source' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max items to return' }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        items: { type: 'array', description: 'Inbox items' },
        count: { type: 'integer' }
      }
    }
  },

  get_my_execution_queue: {
    description: 'Get my prioritized work queue — open action items sorted by due date and priority.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['government', 'dialysis'], description: 'Filter by domain' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        order: { type: 'string', description: 'Sort order (e.g., sort_date.asc)' }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        items: { type: 'array', description: 'Prioritized work items' },
        count: { type: 'integer' },
        view: { type: 'string', const: 'my_work' }
      }
    }
  },

  get_sync_run_health: {
    description: 'Check health status of all sync connectors — Salesforce, Outlook, domain databases.',
    category: 'ops',
    inputs: { type: 'object', properties: {} },
    outputs: {
      type: 'object',
      properties: {
        connectors: { type: 'array', description: 'Connector health statuses' },
        overall_status: { type: 'string', enum: ['healthy', 'degraded', 'error'] }
      }
    }
  },

  get_hot_business_contacts: {
    description: 'List high-priority business development contacts with recent activity or upcoming touchpoints.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['government', 'dialysis'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        contacts: { type: 'array', description: 'Hot lead contacts with activity context' },
        count: { type: 'integer' }
      }
    }
  },

  search_entity_targets: {
    description: 'Search canonical entities (contacts, organizations, assets) by name across all types.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query (name match)' },
        entity_type: { type: 'string', enum: ['contact', 'organization', 'asset'], description: 'Filter by entity type' },
        domain: { type: 'string', enum: ['government', 'dialysis'] }
      },
      required: ['q']
    },
    outputs: {
      type: 'object',
      properties: {
        entities: { type: 'array', description: 'Matching entities' },
        count: { type: 'integer' }
      }
    }
  },

  search_deals: {
    description: 'Count and list LIVE government deals by state from the live database — currently-available listings and sales closed within the past N months. Use this for any quantitative or geographic deal question (e.g. "how many gov deals are available in Texas", "what sold in Florida in the last 12 months"). Returns exact live counts; prefer this over knowledge-file lookups for current numbers.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'US state, 2-letter code or full name (e.g. "TX" or "Texas").' },
        status: { type: 'string', enum: ['available', 'sold', 'both'], description: 'Which deals to return (default: both).' },
        months: { type: 'integer', description: 'Look-back window in months for sold deals (default: 12).' },
        agency: { type: 'string', description: 'Optional tenant/agency filter (substring match), e.g. "SSA", "VA".' },
        limit: { type: 'integer', description: 'Max sample rows to return per category (default: 10, max: 25).' }
      },
      required: ['state']
    },
    outputs: {
      type: 'object',
      properties: {
        state: { type: 'string' },
        available_count: { type: 'integer', description: 'Exact count of active listings in the state.' },
        available_sample: { type: 'array' },
        sold_count: { type: 'integer', description: 'Exact count of sales in the look-back window.' },
        sold_window_months: { type: 'integer' },
        sold_sample: { type: 'array' },
        source: { type: 'string' }
      }
    }
  },

  fetch_listing_activity_context: {
    description: 'Get the activity timeline for a specific entity — calls, emails, status changes, research.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', format: 'uuid', description: 'Entity UUID' },
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      },
      required: ['entity_id']
    },
    outputs: {
      type: 'object',
      properties: {
        items: { type: 'array', description: 'Timeline events' },
        count: { type: 'integer' }
      }
    }
  },

  list_government_review_observations: {
    description: 'List government domain research observations pending review or promotion.',
    category: 'domain',
    inputs: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by observation status' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        observations: { type: 'array' },
        count: { type: 'integer' }
      }
    }
  },

  list_dialysis_review_queue: {
    description: 'List dialysis clinic-property link review queue for operator verification.',
    category: 'domain',
    inputs: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        items: { type: 'array' },
        count: { type: 'integer' }
      }
    }
  },

  get_work_counts: {
    description: 'Get aggregate work counts — open actions, inbox items, overdue tasks, by domain and priority.',
    category: 'ops',
    inputs: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['government', 'dialysis'] }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        counts: { type: 'object', description: 'Categorized work counts' }
      }
    }
  },

  // =========================================================================
  // TIER 0-1 — AI-POWERED GENERATION
  // =========================================================================

  generate_prospecting_brief: {
    description: 'Generate an AI-powered daily prospecting call sheet — ranks top contacts by engagement score with call prep notes and talking points.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Number of top contacts to include (default 10)' }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'AI-generated call sheet with prep notes' },
        contacts: { type: 'array', description: 'Ranked contacts with engagement data' },
        provider: { type: 'string' }
      }
    }
  },

  draft_outreach_email: {
    description: 'Draft a personalized outreach email for a business development contact. Provide contact_id (unified_id from GOV contacts DB) or contact_name. Set create_draft=true to also create the email as a real draft in the user\'s Outlook (returns draft_web_link).',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Contact unified_id from GOV contacts DB' },
        contact_name: { type: 'string', description: 'Contact name (used if contact_id not available)' },
        intent: { type: 'string', description: 'Purpose of the outreach (e.g., "reconnect", "listing pitch", "market update")' },
        tone: { type: 'string', description: 'Desired tone (default: professional, warm, and concise)' },
        create_draft: { type: 'boolean', description: 'If true, create the email as a real draft in Outlook (requires a recipient — uses the contact email or the "to" field).' },
        to: { type: 'string', description: 'Recipient email address; required for an Outlook draft when the contact has no email on file.' },
        cc: { type: 'string', description: 'Optional CC email address(es), semicolon-separated.' }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
        provider: { type: 'string' },
        draft_created: { type: 'boolean' },
        draft_web_link: { type: 'string', description: 'Link that opens the created Outlook draft.' }
      }
    }
  },

  draft_seller_update_email: {
    description: 'Draft a seller update email for an active listing with marketing activity summary. Set create_draft=true with a "to" address to also create the email as a real draft in the user\'s Outlook.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', format: 'uuid', description: 'Listing entity UUID' },
        include_metrics: { type: 'boolean', description: 'Include marketing metrics (OM downloads, showings)' },
        create_draft: { type: 'boolean', description: 'If true, create the email as a real draft in Outlook (requires the "to" field — the seller\'s email).' },
        to: { type: 'string', description: 'Seller recipient email address; required to create an Outlook draft.' },
        cc: { type: 'string', description: 'Optional CC email address(es), semicolon-separated.' }
      },
      required: ['entity_id']
    },
    outputs: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
        provider: { type: 'string' },
        draft_created: { type: 'boolean' },
        draft_web_link: { type: 'string', description: 'Link that opens the created Outlook draft.' }
      }
    }
  },

  // =========================================================================
  // TEMPLATE ENGINE
  // =========================================================================

  list_email_templates: {
    description: 'List all active email templates available for draft generation.',
    category: 'outreach',
    inputs: { type: 'object', properties: {} },
    outputs: {
      type: 'object',
      properties: {
        templates: { type: 'array', description: 'Active template definitions' },
        count: { type: 'integer' }
      }
    }
  },

  get_email_template: {
    description: 'Get a specific email template by ID with its variable bindings and tone notes.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template ID (e.g., T-001)' }
      },
      required: ['template_id']
    },
    outputs: {
      type: 'object',
      properties: {
        template: { type: 'object', description: 'Full template definition' }
      }
    }
  },

  generate_template_draft: {
    description: 'Generate an email draft from a template and context payload. Populates variables and renders the template.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template ID (e.g., T-003)' },
        context: { type: 'object', description: 'Merged context payload with contact, property, listing data' },
        strict: { type: 'boolean', description: 'Fail if mandatory variables are missing' }
      },
      required: ['template_id', 'context']
    },
    outputs: {
      type: 'object',
      properties: {
        draft: { type: 'object', description: 'Rendered draft with subject, body, variable resolution status' },
        metadata: { type: 'object' }
      }
    }
  },

  generate_batch_drafts: {
    description: 'Generate email drafts for multiple contacts using the same template. Used for listing blasts and market updates.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        template_id: { type: 'string' },
        contacts: { type: 'array', items: { type: 'object' }, description: 'Array of contact context objects' },
        shared_context: { type: 'object', description: 'Shared listing/property context merged with each contact' },
        strict: { type: 'boolean' }
      },
      required: ['template_id', 'contacts']
    },
    outputs: {
      type: 'object',
      properties: {
        drafts: { type: 'array' },
        errors: { type: 'array' },
        ok: { type: 'boolean' }
      }
    }
  },

  record_template_send: {
    description: 'Record that a template-generated draft was sent. Tracks edit distance and feeds the learning loop.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        template_id: { type: 'string' },
        template_version: { type: 'integer' },
        entity_id: { type: 'string', format: 'uuid' },
        domain: { type: 'string' },
        rendered_subject: { type: 'string' },
        rendered_body: { type: 'string' },
        final_subject: { type: 'string', description: 'Subject after broker edits' },
        final_body: { type: 'string', description: 'Body after broker edits' }
      },
      required: ['template_id']
    },
    outputs: {
      type: 'object',
      properties: {
        send: { type: 'object', description: 'Created template_send record' },
        ok: { type: 'boolean' }
      }
    }
  },

  get_template_performance: {
    description: 'Get template performance analytics — open rates, reply rates, deal advancement, and edit distances. Use to evaluate which templates are working and which need revision.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Filter to a specific template ID (e.g., T-003). Omit for all templates.' },
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'Lookback window in days (default 90)' },
        domain: { type: 'string', description: 'Filter by domain (e.g., briggscre.com)' }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        lookback_days: { type: 'integer' },
        total_sends: { type: 'integer' },
        templates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              template_id: { type: 'string' },
              total_sends: { type: 'integer' },
              open_rate_pct: { type: 'number' },
              reply_rate_pct: { type: 'number' },
              deal_advance_rate_pct: { type: 'number' },
              avg_edit_distance_pct: { type: 'number', description: '0=no edits, 100=completely rewritten. High values suggest template needs revision.' }
            }
          }
        },
        _insight: { type: 'string', description: 'AI-generated summary of template performance' }
      }
    }
  },

  evaluate_template_health: {
    description: 'Evaluate the health of all email templates — identifies templates with high edit rates (needs revision), underperformance against targets, and stale templates. Auto-flags templates for revision and generates suggestions.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Evaluate a specific template (e.g., T-001). Omit for all.' },
        lookback_days: { type: 'integer', minimum: 7, maximum: 365, description: 'Analysis window in days (default 120)' }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        total_templates: { type: 'integer' },
        summary: { type: 'object', description: 'Counts by status: needs_revision, underperforming, stale, healthy' },
        evaluations: { type: 'array', description: 'Per-template health evaluations with metrics and issues' },
        revisions_flagged: { type: 'integer' },
        revision_suggestions: { type: 'array', description: 'AI revision suggestions for flagged templates' },
        _insight: { type: 'string' }
      }
    }
  },

  run_listing_bd_pipeline: {
    description: 'Run the listing-as-BD pipeline for a listing entity. Finds matching contacts (same asset type/state + geographic proximity) and queues draft candidates for review.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        listing_entity_id: { type: 'string', format: 'uuid', description: 'The listing entity to run BD matching against' },
        exclude_entity_ids: { type: 'array', items: { type: 'string' }, description: 'Entity IDs to exclude (e.g., the seller)' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max contacts per match pool' }
      },
      required: ['listing_entity_id']
    },
    outputs: {
      type: 'object',
      properties: {
        listing_id: { type: 'string' },
        t011_same_asset: { type: 'object', description: 'T-011 match results (same asset type/state)' },
        t012_geographic: { type: 'object', description: 'T-012 match results (geographic proximity)' },
        total_queued: { type: 'integer' }
      }
    }
  },

  // =========================================================================
  // AI INTELLIGENCE
  // =========================================================================

  generate_listing_pursuit_dossier: {
    description: 'Generate an AI-powered listing pursuit dossier with market analysis, comp data, and strategy recommendations.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', format: 'uuid' },
        domain: { type: 'string', enum: ['government', 'dialysis'] }
      },
      required: ['entity_id']
    },
    outputs: {
      type: 'object',
      properties: {
        dossier: { type: 'object' },
        provider: { type: 'string' }
      }
    }
  },

  generate_teams_card: {
    description: 'Generate a Microsoft Teams adaptive card for a work item, briefing, or notification.',
    category: 'ops',
    inputs: {
      type: 'object',
      properties: {
        card_type: { type: 'string', enum: ['work_item', 'briefing', 'alert', 'listing_update'], description: 'Type of card to generate' },
        data: { type: 'object', description: 'Data payload to render into the card' }
      },
      required: ['card_type', 'data']
    },
    outputs: {
      type: 'object',
      properties: {
        card: { type: 'object', description: 'Adaptive card JSON' }
      }
    }
  },

  get_relationship_context: {
    description: 'Get full relationship context for an entity — communication history, deal involvement, touchpoint cadence.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', format: 'uuid' }
      },
      required: ['entity_id']
    },
    outputs: {
      type: 'object',
      properties: {
        context: { type: 'object', description: 'Relationship context with history and recommendations' }
      }
    }
  },

  get_pipeline_intelligence: {
    description: 'Get pipeline intelligence — deal velocity, conversion rates, bottleneck analysis across domains.',
    category: 'portfolio',
    inputs: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['government', 'dialysis', 'both'] },
        timeframe: { type: 'string', enum: ['30d', '90d', '6m', '1y'] }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        intelligence: { type: 'object', description: 'Pipeline metrics and analysis' }
      }
    }
  },

  // =========================================================================
  // TIER 1-2 — MUTATIONS (require confirmation)
  // =========================================================================

  create_todo_task: {
    description: 'Create a Microsoft To Do task linked to an LCC action item.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        body: { type: 'string', description: 'Task notes/body' },
        due_date: { type: 'string', format: 'date', description: 'Due date (YYYY-MM-DD)' },
        importance: { type: 'string', enum: ['low', 'normal', 'high'] },
        list_name: { type: 'string', description: 'To Do list name' },
        lcc_action_id: { type: 'string', format: 'uuid', description: 'Linked LCC action item ID' }
      },
      required: ['title']
    },
    outputs: {
      type: 'object',
      properties: {
        task: { type: 'object', description: 'Created To Do task' },
        ok: { type: 'boolean' }
      }
    }
  },

  ingest_outlook_flagged_emails: {
    description: 'Trigger ingestion of flagged Outlook emails into the inbox queue.',
    category: 'workflow',
    inputs: { type: 'object', properties: {} },
    outputs: {
      type: 'object',
      properties: {
        processed: { type: 'integer' },
        failed: { type: 'integer' }
      }
    }
  },

  ingest_pdf_document: {
    description: 'Ingest an uploaded PDF into the LCC intake queue for triage. Used when a user uploads a document in Copilot chat (deed, offering memorandum, lease, brochure, financials, etc.) and wants it captured into LCC.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        file_name: { type: 'string', description: 'Original filename including extension, e.g. "deed.pdf"' },
        file_content_base64: { type: 'string', description: 'Base64-encoded PDF content. Provide this OR file_url.' },
        file_url: { type: 'string', format: 'uri', description: 'Publicly accessible HTTPS download URL (SharePoint or OneDrive share link, direct PDF URL). Provide this OR file_content_base64.' },
        entity_id: { type: 'string', format: 'uuid', description: 'Optional UUID of a property or organization this document relates to. Pre-links the intake item to that entity.' },
        note: { type: 'string', description: 'Optional one-line user description of what the document is.' }
      },
      required: ['file_name'],
      additionalProperties: false
    },
    outputs: {
      type: 'object',
      additionalProperties: true,
      properties: {
        ok: { type: 'boolean' },
        inbox_item_id: { type: 'string', format: 'uuid' },
        file_name: { type: 'string' },
        page_count: { type: 'integer' },
        size_bytes: { type: 'integer' },
        text_preview: { type: 'string' },
        extraction_ok: { type: 'boolean' },
        entity_id: { type: 'string' },
        message: { type: 'string', description: 'Human-readable summary for Copilot to display to the user.' }
      }
    }
  },

  triage_inbox_item: {
    description: 'Triage an inbox item — change status, set priority, assign.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Inbox item ID' },
        status: { type: 'string', enum: ['triaged', 'dismissed', 'snoozed'] },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        assigned_to: { type: 'string', format: 'uuid' }
      },
      required: ['id']
    },
    outputs: {
      type: 'object',
      properties: {
        item: { type: 'object' },
        ok: { type: 'boolean' }
      }
    }
  },

  promote_intake_to_action: {
    description: 'Promote an inbox item to a shared team action item.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        inbox_item_id: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        action_type: { type: 'string', enum: ['follow_up', 'research', 'review', 'outreach', 'meeting'] },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        assigned_to: { type: 'string', format: 'uuid' },
        due_date: { type: 'string', format: 'date' },
        entity_id: { type: 'string', format: 'uuid' }
      },
      required: ['inbox_item_id']
    },
    outputs: {
      type: 'object',
      properties: {
        action: { type: 'object', description: 'Created action item' },
        inbox_status: { type: 'string' }
      }
    }
  },

  create_listing_pursuit_followup_task: {
    description: 'Create a follow-up action item for a listing pursuit.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        entity_id: { type: 'string', format: 'uuid' },
        action_type: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        due_date: { type: 'string', format: 'date' },
        description: { type: 'string' }
      },
      required: ['title', 'entity_id']
    },
    outputs: {
      type: 'object',
      properties: {
        action: { type: 'object' },
        ok: { type: 'boolean' }
      }
    }
  },

  update_execution_task_status: {
    description: 'Update the status of an action item in the execution queue.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Action item ID' },
        status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'completed', 'cancelled'] }
      },
      required: ['id', 'status']
    },
    outputs: {
      type: 'object',
      properties: {
        action: { type: 'object' },
        ok: { type: 'boolean' }
      }
    }
  },

  retry_sync_error_record: {
    description: 'Retry a failed sync job.',
    category: 'ops',
    inputs: {
      type: 'object',
      properties: {
        job_id: { type: 'string', format: 'uuid', description: 'Sync job ID to retry' }
      },
      required: ['job_id']
    },
    outputs: {
      type: 'object',
      properties: {
        job: { type: 'object' },
        ok: { type: 'boolean' }
      }
    }
  },

  research_followup: {
    description: 'Close a research task and optionally create a follow-up action item.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        research_task_id: { type: 'string', format: 'uuid' },
        outcome: { type: 'object', description: 'Research outcome data' },
        followup_title: { type: 'string' },
        followup_type: { type: 'string' },
        followup_priority: { type: 'string' },
        assigned_to: { type: 'string', format: 'uuid' },
        due_date: { type: 'string', format: 'date' }
      },
      required: ['research_task_id']
    },
    outputs: {
      type: 'object',
      properties: {
        research_status: { type: 'string' },
        action: { type: 'object' }
      }
    }
  },

  reassign_work_item: {
    description: 'Reassign a work item (action, inbox, or research task) to a different team member.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        item_type: { type: 'string', enum: ['action', 'inbox', 'research'] },
        item_id: { type: 'string', format: 'uuid' },
        assigned_to: { type: 'string', format: 'uuid', description: 'Target user ID' },
        reason: { type: 'string', description: 'Reason for reassignment' }
      },
      required: ['item_type', 'item_id', 'assigned_to']
    },
    outputs: {
      type: 'object',
      properties: {
        item_id: { type: 'string' },
        assigned_to: { type: 'string' },
        previous: { type: 'string' }
      }
    }
  },

  escalate_action: {
    description: 'Escalate an action item to a manager with a reason. Requires manager-level approval.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        action_item_id: { type: 'string', format: 'uuid' },
        escalate_to: { type: 'string', format: 'uuid', description: 'Manager user ID' },
        reason: { type: 'string', description: 'Escalation reason' }
      },
      required: ['action_item_id', 'escalate_to', 'reason']
    },
    outputs: {
      type: 'object',
      properties: {
        action_item_id: { type: 'string' },
        escalated_to: { type: 'string' },
        reason: { type: 'string' }
      }
    }
  },

  guided_entity_merge: {
    description: 'Get merge guidance for two potentially duplicate entities — shows what would be combined.',
    category: 'workflow',
    inputs: {
      type: 'object',
      properties: {
        target_id: { type: 'string', format: 'uuid' },
        source_id: { type: 'string', format: 'uuid' }
      },
      required: ['target_id', 'source_id']
    },
    outputs: {
      type: 'object',
      properties: {
        guidance: { type: 'object', description: 'Merge preview with field-by-field comparison' }
      }
    }
  },

  generate_document: {
    description: 'Generate a document (BOV, comp package, report) using AI-assembled context.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        document_type: { type: 'string', enum: ['bov', 'comp_package', 'market_report', 'seller_report'] },
        entity_id: { type: 'string', format: 'uuid' },
        domain: { type: 'string', enum: ['government', 'dialysis'] }
      },
      required: ['document_type', 'entity_id']
    },
    outputs: {
      type: 'object',
      properties: {
        document: { type: 'object', description: 'Generated document content' },
        provider: { type: 'string' }
      }
    }
  }
};

// ============================================================================
// OPENAPI SPEC GENERATOR
// ============================================================================

// Typed gateway operations that live OUTSIDE ACTION_REGISTRY (routed via the
// /api/intake, /api/context, /api/memory gateways in server.js). They MUST be
// included in the generated specs so the connector definition is a COMPLETE
// superset — re-importing the spec must never drop the OM-intake or
// entity-memory actions the Copilot agent depends on.
const TYPED_GATEWAY_OPERATIONS = [
  {
    path: '/api/intake/stage-om', operationId: 'intakeStageOm', tag: 'intake',
    summary: 'Stage an Offering Memorandum for intake',
    description: 'Stages a property OM PDF inline (base64) into inbox_items + staged_intake_items, kicks off AI extraction + property matching, and logs an interaction for entity-scoped memory.',
    inputs: {
      type: 'object',
      properties: {
        intake_source: { type: 'string', description: 'e.g. copilot' },
        intake_channel: { type: 'string', description: 'e.g. copilot_chat' },
        intent: { type: 'string' },
        artifacts: {
          type: 'object',
          properties: {
            primary_document: {
              type: 'object',
              properties: {
                file_name: { type: 'string' },
                mime_type: { type: 'string' },
                bytes_base64: { type: 'string', description: 'Base64-encoded document bytes' },
                storage_path: { type: 'string' }
              }
            }
          }
        },
        seed_data: { type: 'object' }
      },
      required: ['artifacts']
    },
    outputs: { type: 'object', properties: { ok: { type: 'boolean' }, intake_id: { type: 'string' }, extraction_status: { type: 'string' }, classified_domain: { type: 'string' }, matched_entity_id: { type: 'string' } } }
  },
  {
    path: '/api/intake/finalize-om', operationId: 'intakeFinalizeOm', tag: 'intake',
    summary: 'Finalize staged OM intake',
    description: 'Idempotent status probe. Flips the staged inbox_item from new to triaged.',
    inputs: { type: 'object', properties: { intake_id: { type: 'string' } }, required: ['intake_id'] },
    outputs: { type: 'object', properties: { ok: { type: 'boolean' }, status: { type: 'string' } } }
  },
  {
    path: '/api/context/retrieve-entity', operationId: 'contextRetrieveEntity', tag: 'context',
    summary: 'Retrieve full entity context (timeline + open work + recent inbox)',
    description: 'THE memory-retrieval action. Call at the start of any conversation that mentions a specific contact, property, or organization — before drafting emails or making recommendations.',
    inputs: { type: 'object', properties: { entity_id: { type: 'string' }, entity_name: { type: 'string' }, entity_type: { type: 'string' } } },
    outputs: { type: 'object', properties: { ok: { type: 'boolean' }, entity: { type: 'object' }, recent_interactions: { type: 'array' }, open_action_items: { type: 'array' }, recent_inbox_items: { type: 'array' }, last_touchpoint: { type: 'string' }, active_listings: { type: 'array' } } }
  },
  {
    path: '/api/memory/log-turn', operationId: 'memoryLogTurn', tag: 'context',
    summary: 'Log an agent-worthy insight, preference, or commitment',
    description: 'Explicit memory write. Use to capture context the agent decides should persist across conversations.',
    inputs: { type: 'object', properties: { entity_id: { type: 'string' }, summary: { type: 'string' }, turn_text: { type: 'string' }, channel: { type: 'string' } }, required: ['summary'] },
    outputs: { type: 'object', properties: { ok: { type: 'boolean' }, activity_id: { type: 'string' } } }
  }
];

/**
 * Generate an OpenAPI 3.0 spec from the ACTION_REGISTRY + ACTION_SCHEMAS.
 * This spec is consumable by MS Copilot as a plugin manifest.
 *
 * @param {object} registry - The ACTION_REGISTRY from operations.js
 * @param {string} baseUrl - The public base URL (e.g., https://lcc.vercel.app)
 * @returns {object} OpenAPI 3.0 spec object
 */
export function generateOpenApiSpec(registry, baseUrl = process.env.LCC_BASE_URL || 'https://tranquil-delight-production-633f.up.railway.app') {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Life Command Center — Copilot Actions API',
      version: '1.0.0',
      description: 'Copilot-facing action gateway for the Life Command Center. All actions route through a single gateway endpoint with typed schemas, tier-based confirmation, and full telemetry. LCC orchestrates; Copilot is a lens.'
    },
    servers: [{ url: baseUrl, description: 'Production' }],
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'LCC JWT or API key'
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-LCC-Key',
          description: 'LCC API key for Power Automate / Copilot'
        }
      }
    },
    security: [{ bearerAuth: [] }, { apiKey: [] }]
  };

  // Group actions by category for organized paths
  const categories = {};
  for (const [actionId, regEntry] of Object.entries(registry)) {
    const schema = ACTION_SCHEMAS[actionId];
    if (!schema) continue; // Skip actions without schemas

    const cat = schema.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({ actionId, regEntry, schema });
  }

  // Build the unified gateway path
  spec.paths['/api/chat'] = {
    post: {
      operationId: 'dispatchCopilotAction',
      summary: 'Copilot Action Gateway — dispatch any registered action',
      description: 'Single entry point for all Copilot actions. Validates action_id against the registry, enforces tier-based confirmation, routes internally, and logs telemetry.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                copilot_action: { type: 'string', description: 'Action ID from the registry', enum: Object.keys(registry) },
                params: { type: 'object', additionalProperties: true, description: 'Action-specific parameters (see individual action schemas)' },
                surface: { type: 'string', enum: ['copilot_chat', 'teams', 'outlook', 'power_automate'], description: 'Which Microsoft surface is calling' }
              },
              required: ['copilot_action']
            }
          }
        }
      },
      responses: {
        '200': {
          description: 'Action executed successfully or confirmation required',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  source: { type: 'string', const: 'copilot_action_dispatch' },
                  data: { type: 'object', additionalProperties: true, description: 'Action-specific response data' },
                  requires_confirmation: { type: 'boolean', description: 'True if action needs _confirmed: true' },
                  action: { type: 'string' },
                  tier: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    }
  };

  // Build per-action operation paths (for Copilot's natural language routing)
  for (const [category, actions] of Object.entries(categories)) {
    for (const { actionId, regEntry, schema } of actions) {
      const pathKey = `/api/copilot/${category}/${actionId.replace(/_/g, '-')}`;
      const tierLabel = regEntry.tier === 0 ? 'read-only' : regEntry.tier === 1 ? 'lightweight-confirm' : regEntry.tier === 2 ? 'explicit-confirm' : 'human-approval';

      spec.paths[pathKey] = {
        post: {
          operationId: actionId,
          summary: schema.description,
          description: `**Tier ${regEntry.tier}** (${tierLabel})${regEntry.confirm ? ` — requires ${regEntry.confirm} confirmation` : ''}. Category: ${category}.`,
          tags: [category],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: schema.inputs || { type: 'object', additionalProperties: true }
              }
            }
          },
          responses: {
            '200': {
              description: 'Success',
              content: {
                'application/json': {
                  schema: schema.outputs || { type: 'object', additionalProperties: true }
                }
              }
            }
          }
        }
      };
    }
  }

  // Typed gateway operations (outside ACTION_REGISTRY) — keep the spec complete.
  for (const op of TYPED_GATEWAY_OPERATIONS) {
    spec.paths[op.path] = {
      post: {
        operationId: op.operationId,
        summary: op.summary,
        description: op.description,
        tags: [op.tag],
        requestBody: { required: true, content: { 'application/json': { schema: op.inputs } } },
        responses: { '200': { description: 'Success', content: { 'application/json': { schema: op.outputs } } } }
      }
    };
  }

  return spec;
}

/**
 * Generate a Swagger 2.0 (OpenAPI 2.0) spec from the same ACTION_REGISTRY +
 * ACTION_SCHEMAS. Power Platform custom connectors require Swagger 2.0 for
 * "Update from OpenAPI URL/file" (the 3.0 doc from generateOpenApiSpec fails to
 * parse there). This mirrors generateOpenApiSpec() in the 2.0 dialect:
 *   - servers[]            → host + basePath + schemes
 *   - requestBody          → parameters[{in:'body'}]
 *   - responses[].content  → responses[].schema
 *   - components.security  → securityDefinitions (bearer represented as an
 *                            apiKey Authorization header, since 2.0 has no
 *                            native bearer scheme)
 *
 * @param {object} registry - The ACTION_REGISTRY from operations.js
 * @param {string} baseUrl
 * @returns {object} Swagger 2.0 spec object
 */
export function generateSwagger2Spec(registry, baseUrl = process.env.LCC_BASE_URL || 'https://tranquil-delight-production-633f.up.railway.app') {
  let host = baseUrl;
  let schemes = ['https'];
  try {
    const u = new URL(baseUrl);
    host = u.host;
    schemes = [(u.protocol || 'https:').replace(':', '') || 'https'];
  } catch { /* fall back to raw baseUrl */ }

  const spec = {
    swagger: '2.0',
    info: {
      title: 'Life Command Center — Copilot Actions API',
      version: '1.0.0',
      description: 'Copilot-facing action gateway for the Life Command Center. All actions route through a single gateway endpoint with typed schemas, tier-based confirmation, and full telemetry. LCC orchestrates; Copilot is a lens.'
    },
    host,
    basePath: '/',
    schemes,
    consumes: ['application/json'],
    produces: ['application/json'],
    paths: {},
    securityDefinitions: {
      apiKey: { type: 'apiKey', in: 'header', name: 'X-LCC-Key', description: 'LCC API key for Power Automate / Copilot' },
      bearerAuth: { type: 'apiKey', in: 'header', name: 'Authorization', description: 'LCC JWT or API key (Bearer)' }
    },
    security: [{ apiKey: [] }, { bearerAuth: [] }],
    definitions: {}
  };

  const categories = {};
  for (const [actionId, regEntry] of Object.entries(registry)) {
    const schema = ACTION_SCHEMAS[actionId];
    if (!schema) continue;
    const cat = schema.category || 'other';
    (categories[cat] = categories[cat] || []).push({ actionId, regEntry, schema });
  }

  // Unified gateway
  spec.paths['/api/chat'] = {
    post: {
      operationId: 'dispatchCopilotAction',
      summary: 'Copilot Action Gateway — dispatch any registered action',
      description: 'Single entry point for all Copilot actions. Validates action_id against the registry, enforces tier-based confirmation, routes internally, and logs telemetry.',
      'x-ms-summary': 'Dispatch Copilot Action',
      parameters: [{
        in: 'body',
        name: 'body',
        required: true,
        schema: {
          type: 'object',
          properties: {
            copilot_action: { type: 'string', description: 'Action ID from the registry', enum: Object.keys(registry) },
            params: { type: 'object', description: 'Action-specific parameters (see individual action schemas)' },
            surface: { type: 'string', enum: ['copilot_chat', 'teams', 'outlook', 'power_automate'], description: 'Which Microsoft surface is calling' }
          },
          required: ['copilot_action']
        }
      }],
      responses: {
        '200': {
          description: 'Action executed successfully or confirmation required',
          schema: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              source: { type: 'string' },
              data: { type: 'object' },
              requires_confirmation: { type: 'boolean' },
              action: { type: 'string' },
              tier: { type: 'integer' }
            }
          }
        }
      }
    }
  };

  // Per-action paths
  for (const [category, actions] of Object.entries(categories)) {
    for (const { actionId, regEntry, schema } of actions) {
      const pathKey = `/api/copilot/${category}/${actionId.replace(/_/g, '-')}`;
      const tierLabel = regEntry.tier === 0 ? 'read-only' : regEntry.tier === 1 ? 'lightweight-confirm' : regEntry.tier === 2 ? 'explicit-confirm' : 'human-approval';
      spec.paths[pathKey] = {
        post: {
          operationId: actionId,
          summary: (schema.description || actionId).slice(0, 80),
          description: `**Tier ${regEntry.tier}** (${tierLabel})${regEntry.confirm ? ` — requires ${regEntry.confirm} confirmation` : ''}. Category: ${category}. ${schema.description || ''}`,
          'x-ms-summary': actionId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          tags: [category],
          parameters: [{
            in: 'body',
            name: 'body',
            required: true,
            schema: schema.inputs || { type: 'object' }
          }],
          responses: {
            '200': { description: 'Success', schema: schema.outputs || { type: 'object' } }
          }
        }
      };
    }
  }

  // Typed gateway operations (outside ACTION_REGISTRY) — keep the spec complete.
  for (const op of TYPED_GATEWAY_OPERATIONS) {
    spec.paths[op.path] = {
      post: {
        operationId: op.operationId,
        summary: op.summary,
        description: op.description,
        'x-ms-summary': op.summary.slice(0, 80),
        tags: [op.tag],
        parameters: [{ in: 'body', name: 'body', required: true, schema: op.inputs }],
        responses: { '200': { description: 'Success', schema: op.outputs } }
      }
    };
  }

  return spec;
}

/**
 * Generate a Copilot plugin manifest (ai-plugin.json format).
 *
 * @param {string} baseUrl
 * @returns {object} Plugin manifest
 */
export function generatePluginManifest(baseUrl = process.env.LCC_BASE_URL || 'https://tranquil-delight-production-633f.up.railway.app') {
  return {
    schema_version: 'v1',
    name_for_human: 'Life Command Center',
    name_for_model: 'lcc_copilot',
    description_for_human: 'NorthMarq NNN team CRE deal intelligence — briefings, pipeline, outreach, queue management.',
    description_for_model: 'Life Command Center is the orchestration system for a commercial real estate brokerage team specializing in net-leased government and dialysis properties. Use this plugin to get daily briefings, check the work queue, search contacts and entities, draft outreach emails, run listing BD pipelines, and manage workflow items. All actions are read-only by default; write actions require explicit confirmation. LCC is the system of record — never bypass it.',
    auth: {
      type: 'service_http',
      authorization_type: 'bearer'
    },
    api: {
      type: 'openapi',
      url: `${baseUrl}/api/copilot-spec`
    },
    logo_url: `${baseUrl}/logo.png`,
    contact_email: 'sbriggssjc@gmail.com',
    legal_info_url: `${baseUrl}/legal`
  };
}
