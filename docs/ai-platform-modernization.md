# Ayo AI Platform Modernization

## Current Audit

The current production assistant is `ai-farm-assistant`. It is authenticated, persists conversations, supports image upload, calls Bedrock or a rule-based fallback, and exposes admin analytics/settings. The legacy `ai-chat` module is not registered in `AppModule`; it contains older session-state, WebSocket, LangChain, Kendra, and DynamoDB concepts but is not used by the active frontend.

Primary weaknesses identified:

- Live business answers can be mixed into model prompts without a centralized tool boundary.
- RAG knowledge is not yet managed as first-class, versioned, cited content.
- Agent and workflow execution are not represented as auditable platform concepts.
- Tool permissions are not centralized by actor type.
- AI telemetry is split between assistant-specific analytics and provider metadata, with no generic tool/agent/workflow run logs.
- Legacy AI code increases confusion around which endpoint powers Ayo.

Scalability risks:

- A single assistant service will become difficult to extend across farmers, suppliers, sales, logistics, admins, and BI.
- Full conversation history and product lookups need bounded retrieval, caching, and async execution for higher volume.
- Provider calls are not yet isolated behind agent/workflow timeouts or circuit breakers.

Security and hallucination risks:

- Prompt injection detection was not centralized.
- Tool calls did not have a reusable actor permission model.
- PII masking was not applied to generic AI telemetry.
- Business data should be retrieved only through tools and cited RAG context, not inferred by the model.

## Implemented Foundation

This change introduces `AiPlatformModule` as the modernization layer beside the existing assistant.

New runtime APIs:

- `POST /ayo/gateway`: routes a user request through the AI router, RAG search, permitted tools, workflow hooks, and agent selection.
- `GET /ayo/capabilities`: lists available agents, workflows, and tools for farmers.
- `POST /admin/ai-knowledge/documents`: ingests a knowledge document into persistent RAG storage.
- `GET /admin/ai-knowledge/search`: searches RAG chunks and returns citations.
- `GET /admin/ai-platform/architecture`: shows current rollout state and platform capabilities.

New layers:

- Gateway: `AyoGatewayController`
- Router: `AyoRouterService`
- RAG: `AiRagService`
- Tool layer: `AiToolRegistryService`
- Security: `AiSecurityService`
- Analytics: `AiPlatformAnalyticsService`

New persisted tables:

- `ai_knowledge_document`
- `ai_knowledge_chunk`
- `ai_rag_query`
- `ai_tool_invocation`
- `ai_workflow_run`
- `ai_agent_run`

Initial tools:

- `commerce.product_search`
- `order.track`
- `customer.profile`
- `credit.eligibility`

Initial agents represented in routing:

- `farm_advisor_agent`
- `commerce_agent`
- `credit_underwriting_agent`
- `sales_copilot_agent`
- `logistics_agent`
- `market_intelligence_agent`
- `executive_bi_agent`

## Rollout Plan

1. Keep `/ai-farm-assistant/*` as the active customer-facing endpoint.
2. Seed `ai_knowledge_document` with farming, Agrofount policy, FAQ, and market content.
3. Test `/ayo/gateway` internally with admin and sales users.
4. Move product/order/credit data access inside tools only.
5. Add true provider-token streaming to the provider layer.
6. Add background ingestion with BullMQ and embeddings once `pgvector` or an external vector store is provisioned.
7. Gradually route the frontend assistant through `/ayo/gateway`.
8. Retire or archive the legacy `ai-chat` module after parity checks.

## Next Production Hardening

- Add OpenAI embedding generation and vector similarity once the vector database is provisioned.
- Add deterministic workflow executors for credit applications, supplier onboarding, support escalation, and loan recovery.
- Add write tools for cart changes behind explicit user confirmation.
- Add provider circuit breakers, timeouts, and retry policies.
- Expand admin dashboards to include tool usage, agent usage, revenue assisted, satisfaction, escalation rate, and accepted recommendations.
