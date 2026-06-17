# Agrofount Backend Production Audit

Date: 2026-06-15

Scope: current working tree, including uncommitted changes. This is a static review plus `npm run lint`, `npm run build`, `npm run test:ci`, and `npm audit --omit=dev`.

## Executive verdict

The service is not production-ready for real orders, payments, wallets, credit, or privileged admin activity. Useful controls are present: strict global validation, Helmet, webhook HMAC verification over the raw body, selected database locks, pagination caps, health endpoints, non-root containers, and TLS enforcement for production Redis. They do not compensate for the account takeover path, non-atomic checkout/inventory design, incomplete financial ledger, RBAC gaps, absent audit trail, failing tests, and vulnerable runtime dependency tree.

Immediate release blockers:

1. Rotate the Redis credential exposed from `.env` in the IDE/chat context. The file is ignored by Git and was not found in Git history, but the credential itself must now be treated as compromised.
2. Disable phone verification and phone password reset until OTP challenges are bound server-side to the intended user and phone.
3. Do not deploy checkout, wallet, or credit until inventory reservation, durable idempotency, and ledger reconciliation are implemented.
4. Remove or upgrade the dormant AI dependency tree. The production audit currently reports 47 vulnerabilities: 2 critical, 15 high, 28 moderate, and 2 low.
5. Restore a green test pipeline. The current test command fails 40 of 49 suites.

## Findings

| Severity | Location | Problem and risk | Required fix |
|---|---|---|---|
| Critical | `.env`; `.gitignore:42-47` | A live Redis credential was exposed in the IDE/chat context. It is not tracked, but disclosure is enough for unauthorized cache/session/cart access. | Rotate the Redis password immediately, terminate old connections, inspect Redis/ECS logs, and use a secret manager rather than developer-shared values. |
| Critical | `src/auth/auth.service.ts:304-350`, `407-429`; `src/notification/notification.service.ts:480-538` | The client supplies `phone`, `pinId`, and OTP. The server verifies only the provider pin challenge and never proves that the challenge was issued for the target account phone. An attacker can verify or reset another phone-based account using a challenge issued to the attacker. | Store a hashed challenge record in Redis/DB containing purpose, user ID, normalized phone, provider pin ID, attempts, and expiry. Accept only an opaque server challenge ID and consume it atomically after success. |
| Critical | `src/product-location/entities/product-location.entity.ts:33-71`; `src/order/order.service.ts:95-145`, `648-693` | There is no stock quantity, reservation, or atomic decrement. Checkout checks only `isAvailable`, so concurrent buyers can oversell indefinitely. | Model inventory per product location/UOM, lock rows during checkout, atomically reserve stock, expire abandoned reservations, and convert reservations to allocations after payment. |
| Critical | `src/order/order.service.ts:136-201`, `721-760` | Order/voucher commit happens before payment initialization. Provider or DB failure leaves a consumed voucher and stranded order. Idempotent retries return `payment: null` even when payment exists and do not resume initialization. | Implement a checkout command with a persisted idempotency record and state machine. Commit order, reservation, voucher hold, payment intent, and outbox together; initialize the provider asynchronously and make retries resume the same intent. |
| Critical | `src/wallet/wallet.service.ts:57-176`; `src/wallet/entities/wallet-transactions.entity.ts:12-40` | Wallet writes have row locks but no operation/idempotency key, external reference, balance-before/after, order/facility link, reversal model, or immutable ledger guarantee. Retried credits/debits cannot be safely deduplicated or reconciled. | Use integer minor units or a decimal library; add a unique `operationKey`; write double-entry ledger records and wallet balance in one serializable transaction; make corrections append-only reversals. |
| Critical | `package.json:25-69` | Disabled AI code remains in runtime dependencies. `npm audit --omit=dev` reports critical protobuf code execution plus high LangChain serialization/secret-extraction and other advisories. | Remove the AI tree from the API image, move build-only packages to dev dependencies, or isolate AI into a separate service. Upgrade and rerun the production audit with a zero critical/high release policy. |
| High | `src/order/order.controller.ts:42-65`; `src/invoice/invoice.controller.ts:11-32`; `src/voucher/voucher.controller.ts:11-33`; `src/supply-chain/supply-chain.service.ts:201-211` | Any verified admin token is treated as system-wide read access without the corresponding permission. Granular RBAC is bypassed for orders, invoices, vouchers, and user shipments. | Split user and admin endpoints or apply `AdminAuthGuard`, `RolesGuard`, and explicit read permissions. Keep ownership checks for customer routes. |
| High | `src/auth/auth.service.ts:78-111`, `237-258`, `447-468`; `src/auth/strategy/jwt.strategy.ts:21-68` | There is no refresh-token rotation, family reuse detection, global logout, password-change revocation, issuer/audience validation, or key rotation. Access tokens last up to 60 minutes. | Use 5-15 minute access tokens plus hashed rotating refresh tokens; add `sessionId` and `tokenVersion`; revoke all sessions after reset/change; validate algorithm, issuer, and audience; use managed asymmetric keys. |
| High | `src/admins/admins.service.ts:230-247`; `src/auth/auth.service.ts:59-69` | Admin login reveals whether an account is missing, unverified, or has a wrong password. Admin accounts also have no MFA or step-up authorization for money/role actions. | Return a uniform credential error, add TOTP/WebAuthn MFA, require recent authentication for role, credit, payment, and destructive operations, and alert on abnormal access. |
| High | `src/app.module.ts:58-63`; `src/auth/auth.controller.ts:35-133`; `src/main.ts:50-55` | Throttling is in process memory and primarily IP-based. Limits reset per replica and proxy IP handling is not configured, enabling bypass or accidental shared throttling behind a load balancer. | Use Redis-backed throttler storage, configure trusted proxy hops, and key limits by normalized account/phone/email plus IP. Add progressive cooldowns for login, OTP, reset, upload, checkout, and payment actions. |
| High | `src/payment/payment.service.ts:234-325`, `332-386`; `src/payment/entities/payment.entity.ts:10-61` | Payment records use string IDs without database foreign keys, support only one attempt per order, and lack currency, provider event ID, failure reason, and settlement timestamps. A provider intent can be created but lost if local persistence fails. | Introduce `payment_intent`, `payment_attempt`, and `webhook_event` tables with FKs and unique provider IDs. Persist intent before provider calls and reconcile pending attempts on a schedule. |
| High | `src/payment/payment.service.ts:339-386` | Webhook state changes are transactional and reference-locked, but notification is sent after commit inside the webhook request. A notification failure returns an error; the retry is treated as duplicate and suppresses the confirmation message. | Persist the raw event ID and an outbox record in the payment transaction. Return 2xx after durable acceptance and process notification/referral jobs idempotently. |
| High | `src/order/order.service.ts:454-495`; `src/supply-chain/supply-chain.service.ts:184-199`; `src/payment/payment.service.ts:158-198` | Order, shipment, and bank-transfer statuses can jump between enum values without a state-transition policy. Paid orders can be cancelled without refund workflow, and users can mark orders delivered from invalid states. | Centralize allowed transitions, lock the aggregate row, validate actor and preconditions, and record transition/audit events. Couple cancellation to inventory release and refund state. |
| High | `src/voucher/entities/voucher.entity.ts:13-38`; `src/order/order.service.ts:534-545` | Vouchers have no expiry despite customer messages claiming 30 days. Discount is not capped at subtotal, so totals can become zero or negative after the voucher is consumed. | Add `expiresAt`, status, campaign, currency, minimum spend, and redemption records. Cap/validate discounts before holding the voucher and finalize redemption only with a valid order. |
| High | `src/credit-facility/credit-facility.service.ts:79-193`, `236-303` | Approval can exceed the requested amount and underwriting equates order completion with repayment. There is no loan ledger, repayment schedule, delinquency/default model, affordability control, or maker-checker approval. | Separate credit decision, facility, drawdown, installment, repayment, and delinquency aggregates. Enforce limits and dual approval, use auditable score versions, and never describe order history as repayment history. |
| High | `src/audit-log/audit-log.service.ts:1-4`; `src/audit-log/audit-log.controller.ts:1-7` | Audit logging is an empty scaffold. Admin role edits, payment confirmation, credit decisions, wallet changes, user activation, and shipment changes are not independently attributable. | Add append-only audit events with actor, subject, action, before/after hashes, request ID, source IP, timestamp, and reason. Export to tamper-resistant storage with retention alerts. |
| High | `src/cart/dto/create-cart.dto.ts:12-22`; `src/cart/cart.service.ts:109-196` | `SyncCartDto` defines undecorated `productId/quantity`, while the service expects `itemId/selectedUOMUnit/quantity`. Strict validation rejects or strips the data. The service also `JSON.parse`s values that are stored as objects. | Use one validated nested item DTO shared by add/update/sync and add contract tests. Treat the cache value as a typed object, not conditionally serialized JSON. |
| High | `src/cart/cart.service.ts:23-184`, `215-238` | Cart mutations are non-atomic read-modify-write operations, store full eager-loaded product graphs, and the admin listing calls Redis `KEYS` despite claiming SCAN. This causes lost updates, memory growth, and Redis blocking. | Store compact item IDs/UOM/quantity in Redis hashes, mutate with Lua/WATCH, cap cart size, and use cursor SCAN. Do not expose all carts synchronously. |
| High | `src/upload/upload.controller.ts:26-94`; `src/upload/upload.service.ts:19-93` | Uploads trust client MIME/extension, buffer up to 50 MB per request in API memory, permit PDFs without malware scanning, lack quotas/purpose/ownership, and return direct bucket URLs with unclear privacy. | Prefer presigned private uploads; verify magic bytes; enforce per-user quotas; scan/quarantine files; force safe content disposition; encrypt; store metadata/ownership; serve through signed URLs/CDN. |
| High | `src/user/entities/user.entity.ts:84-89`; `src/user/entities/profile.entity.ts:53-110`; `src/product-location/entities/product-location.entity.ts:80-107`; `src/order/entities/order.entity.ts:51-55` | Eager relations load full profiles, contacts, breeds, locations, products, SEO, and complete price histories in routine authentication and list queries. This creates join explosions, excess PII exposure, and unpredictable latency. | Remove eager loading, use explicit projections/read models, paginate child collections, and cache only stable public projections. |
| High | `src/product-location/product-location.service.ts:318-335`; `src/notification/notification.processor.ts:33-66` | Scheduled jobs load whole product/review/like datasets into memory. Every API replica runs the popularity cron; the notification worker has no dedicated deployment or distributed scheduler policy. | Run workers separately, elect one scheduler or enqueue repeatable jobs, aggregate in SQL, paginate/chunk by primary key, configure concurrency, backoff, DLQ, and job metrics. |
| High | `src/config/database/migrations/1760000000000-HardeningConstraints.ts:1-70`; `src/config/database/database.config.ts:26-31` | Only a hardening delta migration exists, not a baseline schema. Production has synchronization disabled, so a clean deployment cannot recreate the database. Trigger DDL may instead run from application startup. | Generate and test a complete baseline plus forward-only migrations. Run migrations as a one-off deployment job, not on every app instance, and represent all triggers/functions in migrations. |
| High | `.github/workflows/main.yaml:22-29`; `.github/workflows/template.yaml:41-95` | A push to `main` deploys production directly. There is no environment approval binding, migration job, dependency gate, image scan, SBOM/signing, integration/e2e stage, canary, or automated rollback verification. | Separate CI from deployment, bind GitHub environments and approvals, pin actions by commit SHA, scan/sign images, run migrations once, deploy canary/blue-green, and verify alarms before promotion. |
| High | `ecs/prod/task-definition.json:27-33`; `src/config/env.validation.ts:1-44` | Production secrets are supplied as a whole S3 env file and validation omits Paystack, Brevo, Termii, S3, frontend, and other required values. The process can start partially configured or expose broad secret-file access. | Use Secrets Manager/SSM per secret with least-privilege task roles and rotation. Validate a typed environment schema completely at startup. Avoid static AWS access keys. |
| High | `src/app.controller.ts:25-43`; `ecs/prod/task-definition.json:20-25` | ECS container health uses the deep DB/Redis readiness endpoint. A dependency outage marks every container unhealthy and can create restart churn during the outage. | Point container liveness at `/health/live`; use a separate ALB/Kubernetes readiness check for dependencies; add startup probes and dependency latency metrics. |
| High | Test suite under `src/**/*.spec.ts`; `test/app.e2e-spec.ts:1-23` | `npm run test:ci` currently fails 40/49 suites. Most tests only assert provider construction; there are 54 total tests for the entire service. The sole e2e test uses the real app configuration and is not run in CI. | Build deterministic test modules, use isolated Postgres/Redis containers, and test checkout races, webhook replay, OTP binding, RBAC matrix, wallet idempotency, migrations, uploads, and failure recovery. Enforce coverage on critical branches. |
| Medium | `src/auth/guards/roles.guard.ts:49-67`; `src/role/dto/create-role.dto.ts:27-39`; `src/role/role.service.ts:19-25` | Permissions are arbitrary JSON strings with shallow validation. `manage` authorization uses suffix matching, and role editors can grant permissions without an authorization ceiling. | Use canonical action/resource enums or normalized permission rows, exact matching, nested DTO validation, immutable system roles, and prevent actors from granting privileges they do not hold. |
| Medium | `src/upload/upload.gateway.ts:22-36` | WebSocket authentication verifies JWT cryptography only. It does not check token revocation, current account state, current roles, or whether the HTTP uploader owns the supplied socket ID. | Share the HTTP session validation service and bind socket IDs to the authenticated user before emitting progress. |
| Medium | `src/notification/notification.service.ts:56-77`; `src/notification/notification.processor.ts:141-169`, `218-227` | Queue deduplication is non-atomic and sets the job name but not BullMQ `jobId`. Per-recipient failures are swallowed, no DLQ is configured, and price-update SMS is not supported by the SMS switch. | Set deterministic `jobId`, use Redis/BullMQ as the source of dedupe, throw retryable failures, configure exponential backoff/DLQ, and add a supported SMS template path. |
| Medium | `src/supply-chain/supply-chain.service.ts:92-151`; `src/supply-chain/entities/shipment.entity.ts:22-73` | Shipment creation has a check-then-insert race with no unique order constraint. An optional driver is dereferenced as `driver.phone` after persistence, so a request can fail after creating the shipment. Admin deletion cascades can erase logistics records. | Add unique order/FK constraints, use a transaction, handle nullable drivers, catch notification failures via outbox, and use `RESTRICT`/`SET NULL` for historical actors. |
| Medium | `src/review/review.service.ts:28-57`; `src/product-location/product-location.service.ts:124-157` | Review creation passes a product-location ID to a lookup that expects a slug, then checks duplicates using that same value as an ID. There is no unique user/product-location database constraint. | Use explicit `findById`, add a unique composite index, and verify the user purchased/delivered the product if reviews must be verified. |
| Medium | `src/product-location/product-location.service.ts:368-381`, `489-512`, `538-561` | Recommendations issue an N+1 query and compare a product relation to the location ID. Search loops reuse one parameter name, so only the last diagnosis/symptom term is applied. ILIKE scans have no search index. | Use one ranked SQL query, unique parameter names, PostgreSQL FTS/trigram indexes, and query-plan/load tests. |
| Medium | `src/order/dto/create-order.dto.ts:72-156`; `src/order/order.service.ts:61-134` | The API requires client `totalPrice` and `items` but ignores them in favor of the cart. Address fields are optional, pickup time is validated as a date-time, and idempotency keys have no length/format limit. | Expose a minimal checkout DTO, add conditional delivery/pickup validation, use UUID idempotency headers, and document server-calculated totals. |
| Medium | `src/payment/payment.service.ts:63-123`; `src/order/order.service.ts:332-377`; `src/invoice/invoice.service.ts:27-77` | Domain and HTTP exceptions are repeatedly wrapped in generic `Error`, turning 404/validation failures into 500 responses. Response envelopes also vary across controllers. | Preserve typed exceptions, map infrastructure failures centrally, use stable RFC 9457-style errors, and standardize pagination/success responses. |
| Medium | `src/main.ts:12-85`; `src/utils/Exceptions/globalException.filter.ts:28-42` | Logging is mostly console/Nest text without request IDs, structured fields, PII redaction, traces, metrics, or alert policy. Startup rejection is not explicitly handled. | Add JSON logging with correlation IDs, OpenTelemetry traces/metrics, error reporting, redaction, SLO dashboards, and fatal bootstrap handling. |
| Medium | Entity definitions for orders, payments, wallets, reviews, shipments | Frequently filtered FKs/status/date fields lack a complete index strategy and money/balance fields lack database CHECK constraints. Several relationships are plain string IDs rather than FKs. | Add measured composite indexes, FKs, nonnegative/check constraints, and migration tests. Use `EXPLAIN ANALYZE` against production-sized fixtures. |
| Low | `src/main.ts:50-55`, `57-75` | CORS enables credentials and a broad non-production default origin list. Swagger can be enabled in production with one flag. | Keep an environment-specific exact allowlist, disable credentials unless cookie auth is used, and protect any production API documentation behind admin/VPN controls. |
| Low | `docker-compose.yaml:3-23`; `Dockerfile:26-49` | Local Redis/Postgres images are unpinned and exposed on host ports. The runtime starts through npm rather than directly as PID 1. | Pin image versions/digests, add health conditions, bind local ports to loopback, and run `node dist/main` with a proper init process where needed. |

## Example fixes

### Bind OTP challenges server-side

```ts
const challengeId = randomUUID();
await redis.set(`otp:${challengeId}`, JSON.stringify({
  userId: user.id,
  phone: normalizePhone(user.phone),
  purpose: 'password-reset',
  providerPinId: response.pin_id,
  attempts: 0,
}), { EX: 600, NX: true });

// Verify by challengeId, load the record, increment attempts atomically,
// call the provider with the stored pin ID, then DEL on success.
```

### Make financial operations idempotent

```ts
@Index(['operationKey'], { unique: true })
export class LedgerEntry {
  operationKey: string; // e.g. payment:<paymentId>:debit
  amountMinor: string;  // bigint-compatible minor units
  accountId: string;
  direction: 'debit' | 'credit';
  referenceType: 'order' | 'payment' | 'facility' | 'reversal';
  referenceId: string;
}
```

Within one transaction: insert the unique operation, lock/update the wallet, insert balanced ledger entries, and write an outbox event. On unique conflict, return the original result.

## Target architecture

```text
src/
  bootstrap/                 # main, configuration, health
  common/                    # guards, pipes, errors, logging, tracing
  infrastructure/            # database, redis, queues, object storage, providers
  modules/
    identity/                # users, admins, sessions, MFA, RBAC
    catalog/                 # products, locations, inventory, pricing
    cart/
    ordering/                # orders, reservations, state machine
    payments/                # intents, attempts, webhooks, refunds
    ledger/                  # wallets, journal entries, reconciliation
    credit/                  # decisions, facilities, drawdowns, repayments
    logistics/
    notifications/           # outbox consumers and templates
    audit/
```

Each business module should expose application commands/queries, keep domain invariants out of controllers, and isolate TypeORM/provider implementations behind repositories/adapters. Use one API deployment, one worker deployment, and one one-off migration task. Split AI into a separate service with its own dependency and network boundary.

## Production strategies

### Auth and RBAC

- Short access tokens, rotating hashed refresh tokens, session families, reuse detection, issuer/audience/algorithm checks, and key rotation.
- MFA for all admins; step-up auth for payments, refunds, credit, role changes, exports, and destructive actions.
- Exact action/resource permissions plus ownership policies. Add automated endpoint-permission matrix tests.

### Database and transactions

- PostgreSQL is the source of truth. Use FKs, CHECK constraints, complete migrations, and explicit projections.
- Checkout transaction: lock inventory, reserve stock, hold voucher, create order/payment intent/idempotency record, and write outbox.
- Payment/wallet/credit use append-only journal entries and unique operation keys. Run scheduled reconciliation against provider settlements.

### Payments and webhooks

- Verify raw-body signatures, store every provider event by unique event/reference ID, acknowledge after durable storage, and process asynchronously.
- Validate amount, currency, merchant account, expected state, and order association. Support multiple attempts, expiry, refunds, disputes, and reconciliation.

### Cache and queues

- Redis-backed distributed throttling and compact typed cart records. Define TTLs, key prefixes, max memory policy, and cache-failure behavior.
- BullMQ workers with deterministic IDs, bounded concurrency, backoff, DLQ, dashboards, and outbox-driven jobs. Keep cron execution out of API replicas.

### Logging and monitoring

- Structured JSON logs with request/trace/session IDs and PII/secret redaction.
- Metrics: latency/error/saturation, DB pool, Redis, queue age/failures, checkout conversion, webhook lag, payment mismatch, ledger imbalance, inventory oversell, OTP failures, and admin actions.
- Alerts tied to SLOs and runbooks; distributed tracing across HTTP, DB, Redis, queues, S3, Paystack, Termii, and Brevo.

### Testing

- Unit tests for state machines and pure pricing/eligibility logic.
- Integration tests with real disposable Postgres and Redis for constraints, locks, migrations, idempotency, and queue behavior.
- E2E tests for auth/MFA/RBAC, checkout races, webhook replay/out-of-order delivery, refunds, wallet reconciliation, upload abuse, and dependency failures.
- Contract tests for Paystack/Termii/Brevo/S3 and load/soak tests for catalog, checkout, and workers.

## Deployment checklist

- All lint/build/unit/integration/e2e/migration tests green; zero critical/high runtime advisories or approved time-bound exception.
- Secrets rotated and sourced from Secrets Manager/SSM; least-privilege task and CI roles verified.
- Database backup, point-in-time recovery, restore drill, migration rollback/forward plan, and reconciliation job tested.
- Signed/scanned image, SBOM, immutable digest, environment approval, canary deployment, alarms, and rollback verified.
- Liveness/readiness/startup probes separated; CPU/memory limits, autoscaling, DB pool budget, multi-AZ Redis/Postgres, and graceful drain tested.

## Security hardening checklist

- OTP binding, refresh rotation, MFA, generic login/reset responses, session revocation, and abnormal-login alerts.
- Exact RBAC and ownership tests; append-only admin/financial audit logs.
- Inventory reservations, payment event idempotency, ledger operation keys, state machines, refunds, and daily reconciliation.
- Private scanned uploads with magic-byte validation, signed access, quotas, retention, and deletion workflows.
- Distributed rate limits, WAF/bot controls, strict CORS, security headers, dependency/secret/SAST/container scanning, and incident response runbooks.
