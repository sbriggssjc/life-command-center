# Copilot LCC Deal Agent — Tool Selection Sheet (Phase 1)

Keep ONLY the 20 tools below enabled on the LCC Deal Agent (Tools page). Disable everything else.
Left column = the name shown in Copilot's "Add tool" / Tools list (LCC Intelligence). Right = the operationId
the instructions call. All are the discrete PascalCase ops from the slimmed connector (post prompts 66 + 67).

## KEEP — Read (11)
| Copilot display name (LCC Intelligence) | operationId |
|---|---|
| Get today's prioritized daily briefing with strategic, important… | GetDailyBriefingSnapshot |
| List high-priority business development contacts with recent activity… | GetHotBusinessContacts |
| Search the LCC entity graph and GOV contacts database by name or keyword | SearchEntities |
| Get pipeline intelligence — deal velocity, conversion rates, bottleneck… | GetPipelineIntelligence |
| Get aggregate work counts — open actions, inbox items, overdue tasks… | GetWorkCounts |
| Get my prioritized work queue — open action items sorted by due date… | GetMyExecutionQueue |
| Get full relationship context and relationship health summary for a contact | GetRelationshipContext |
| List inbox items awaiting triage — flagged emails, SF tasks, system alerts | ListStagedIntakeInbox |
| Check health status of all sync connectors — Salesforce, Outlook, domain DBs | GetSyncRunHealth |
| Synthesize a ranked sales-comp set from a plain-language request | SynthesizeComps* |
| Query de-duplicated sales comps by explicit filters | QueryComps* |

## KEEP — Write (9)
| Copilot display name (LCC Intelligence) | operationId |
|---|---|
| Draft a personalized outreach email for a business development contact | DraftOutreachEmail |
| Draft a seller update email for an active listing | DraftSellerUpdateEmail |
| Generate an AI-powered daily prospecting call sheet | GenerateProspectingBrief |
| Generate a Briggs CRE comps workbook (returns a download link) | GenerateComps* |
| Generate a document (BOV, comp package, report) using AI-assembled context | GenerateDocument |
| Create a Microsoft To Do task linked to an LCC action item | CreateTodoTask |
| Triage an inbox item — change status, set priority, assign | TriageInboxItem |
| Update the status of an action item in the execution queue | UpdateExecutionTaskStatus |
| Log a phone/Teams call as a first-class call note on a deal | LogCallNote |

\* SynthesizeComps / QueryComps / GenerateComps appear only after prompt 67 is merged + the connector re-imported.
If you re-import before 67 deploys, the three comps tools won't be in the list yet — add them after 67.

## DISABLE — everything else on the connector
All other LCC Intelligence operations (SearchEntityTargets, SearchDeals, FetchListingActivityContext,
GenerateListingPursuitDossier, GenerateTeamsCard, GuidedEntityMerge, RunListingBdPipeline, IngestOutlookFlaggedEmails,
IngestPdfDocument, PromoteIntakeToAction, CreateListingPursuitFollowupTask, ReassignWorkItem, RetrySyncErrorRecord,
ResearchFollowup, EscalateAction, TagCommToDeal, DraftReplyFromInbox, ListEmailTemplates, GetEmailTemplate,
GenerateTemplateDraft, GenerateBatchDrafts, RecordTemplateSend, GetTemplatePerformance, EvaluateTemplateHealth,
ListGovernmentReviewObservations, ListDialysisReviewQueue, intakeStageOm, intakeFinalizeOm, contextRetrieveEntity,
memoryLogTurn, and any snake_case /compat duplicates) → DISABLE. They come back later as their own child agents (Phase 4).
