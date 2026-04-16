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
    description: 'Draft a personalized outreach email for a business development contact. Provide contact_id (unified_id from GOV contacts DB) or contact_name.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Contact unified_id from GOV contacts DB' },
        contact_name: { type: 'string', description: 'Contact name (used if contact_id not available)' },
        intent: { type: 'string', description: 'Purpose of the outreach (e.g., "reconnect", "listing pitch", "market update")' },
        tone: { type: 'string', description: 'Desired tone (default: professional, warm, and concise)' }
      }
    },
    outputs: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
        provider: { type: 'string' }
      }
    }
  },

  draft_seller_update_email: {
    description: 'Draft a seller update email for an active listing with marketing activity summary.',
    category: 'outreach',
    inputs: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', format: 'uuid', description: 'Listing entity UUID' },
        include_metrics: { type: 'boolean', description: 'Include marketing metrics (OM downloads, showings)' }
      },
      required: ['entity_id']
    },
    outputs: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
        provider: { type: 'string' }
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

/**
 * Generate an OpenAPI 3.0 spec from the ACTION_REGISTRY + ACTION_SCHEMAS.
 * This spec is consumable by MS Copilot as a plugin manifest.
 *
 * @param {object} registry - The ACTION_REGISTRY from operations.js
 * @param {string} baseUrl - The public base URL (e.g., https://lcc.vercel.app)
 * @returns {object} OpenAPI 3.0 spec object
 */
export function generateOpenApiSpec(registry, baseUrl = 'https://life-command-center.vercel.app') {
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

  return spec;
}

/**
 * Generate a Copilot plugin manifest (ai-plugin.json format).
 *
 * @param {string} baseUrl
 * @returns {object} Plugin manifest
 */
export function generatePluginManifest(baseUrl = 'https://life-command-center.vercel.app') {
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
