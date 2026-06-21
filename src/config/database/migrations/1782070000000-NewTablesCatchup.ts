import { MigrationInterface, QueryRunner } from 'typeorm';

export class NewTablesCatchup1782070000000 implements MigrationInterface {
  name = 'NewTablesCatchup1782070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── New tables added in production hardening (never synced to DB) ──

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth_session" (
        "id"               uuid                        NOT NULL DEFAULT uuid_generate_v4(),
        "principalType"    character varying(20)       NOT NULL,
        "principalId"      uuid                        NOT NULL,
        "refreshTokenHash" character varying(64)       NOT NULL,
        "tokenVersion"     integer                     NOT NULL,
        "expiresAt"        timestamp with time zone    NOT NULL,
        "revokedAt"        timestamp with time zone    NULL,
        "userAgent"        character varying(512)      NULL,
        "ipAddress"        character varying(64)       NULL,
        "lastUsedAt"       timestamp with time zone    NULL,
        "createdAt"        TIMESTAMP                   NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP                   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_session" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_auth_session_principal" ON "auth_session" ("principalType", "principalId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_auth_session_expires" ON "auth_session" ("expiresAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory" (
        "id"                uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "productLocationId" uuid              NOT NULL,
        "unit"              character varying(40) NOT NULL,
        "availableQuantity" numeric(18,3)     NOT NULL DEFAULT 0,
        "reservedQuantity"  numeric(18,3)     NOT NULL DEFAULT 0,
        "version"           integer           NOT NULL DEFAULT 0,
        "createdAt"         TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"         TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_inventory_avail"    CHECK ("availableQuantity" >= 0),
        CONSTRAINT "CHK_inventory_reserved" CHECK ("reservedQuantity"  >= 0),
        CONSTRAINT "CHK_inventory_lte"      CHECK ("reservedQuantity"  <= "availableQuantity")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_inventory_product_unit" ON "inventory" ("productLocationId", "unit")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_reservation" (
        "id"                uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "orderId"           uuid              NOT NULL,
        "productLocationId" uuid              NOT NULL,
        "unit"              character varying(40) NOT NULL,
        "quantity"          numeric(18,3)     NOT NULL,
        "status"            character varying(20) NOT NULL DEFAULT 'held',
        "expiresAt"         timestamp with time zone NOT NULL,
        "createdAt"         TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"         TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_reservation" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_inv_res_order_product_unit" ON "inventory_reservation" ("orderId", "productLocationId", "unit")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_inv_res_status_expires" ON "inventory_reservation" ("status", "expiresAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outbox_event" (
        "id"            uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "type"          character varying(80) NOT NULL,
        "payload"       jsonb             NOT NULL,
        "status"        character varying(20) NOT NULL DEFAULT 'pending',
        "attempts"      integer           NOT NULL DEFAULT 0,
        "nextAttemptAt" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "processedAt"   timestamp with time zone NULL,
        "lastError"     text              NULL,
        "createdAt"     TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"     TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_outbox_event" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_outbox_status_next" ON "outbox_event" ("status", "nextAttemptAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "upload_asset" (
        "id"            uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "ownerId"       uuid              NOT NULL,
        "purpose"       character varying(40) NOT NULL,
        "objectKey"     character varying(1024) NOT NULL,
        "originalName"  character varying(255) NOT NULL,
        "contentType"   character varying(80) NOT NULL,
        "sizeBytes"     bigint            NOT NULL,
        "checksum"      character varying(64) NOT NULL,
        "status"        character varying(20) NOT NULL DEFAULT 'pending',
        "failureReason" text              NULL,
        "createdAt"     TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"     TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_upload_asset"         PRIMARY KEY ("id"),
        CONSTRAINT "UQ_upload_asset_key"     UNIQUE ("objectKey")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_upload_owner_created" ON "upload_asset" ("ownerId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_upload_owner_checksum" ON "upload_asset" ("ownerId", "checksum")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ledger_entry" (
        "id"                  uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "operationKey"        character varying(160) NOT NULL,
        "lineNumber"          smallint          NOT NULL,
        "accountType"         character varying(40) NOT NULL,
        "accountId"           character varying(100) NOT NULL,
        "direction"           character varying(10) NOT NULL,
        "amountMinor"         bigint            NOT NULL,
        "currency"            character varying(3) NOT NULL DEFAULT 'NGN',
        "referenceType"       character varying(32) NULL,
        "referenceId"         character varying(100) NULL,
        "walletTransactionId" uuid              NULL,
        "createdAt"           TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ledger_entry" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ledger_operation_line" ON "ledger_entry" ("operationKey", "lineNumber")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ledger_account_created" ON "ledger_entry" ("accountType", "accountId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ledger_reference" ON "ledger_entry" ("referenceType", "referenceId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_likes" (
        "id"                uuid      NOT NULL DEFAULT uuid_generate_v4(),
        "userId"            uuid      NOT NULL,
        "productLocationId" uuid      NOT NULL,
        "createdAt"         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_likes"             PRIMARY KEY ("id"),
        CONSTRAINT "UQ_product_likes_user_product" UNIQUE ("userId", "productLocationId")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_product_likes_product_created" ON "product_likes" ("productLocationId", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "seller_interest" (
        "id"                      uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "contactName"             character varying(120) NOT NULL,
        "email"                   character varying(254) NOT NULL,
        "phone"                   character varying(30)  NOT NULL,
        "businessName"            character varying(160) NULL,
        "businessType"            character varying(120) NULL,
        "location"                character varying(255) NOT NULL,
        "productName"             character varying(160) NOT NULL,
        "productCategory"         character varying(120) NOT NULL,
        "productDescription"      text              NOT NULL,
        "quantityAvailable"       numeric(14,3)     NOT NULL,
        "unit"                    character varying(50) NOT NULL,
        "pricePerUnit"            numeric(14,2)     NULL,
        "additionalNotes"         text              NULL,
        "sampleAssetIds"          uuid[]            NOT NULL DEFAULT '{}',
        "status"                  character varying(20) NOT NULL DEFAULT 'new',
        "notificationsQueuedAt"   timestamp with time zone NULL,
        "createdAt"               TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"               TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_seller_interest" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_seller_interest_email"  ON "seller_interest" ("email", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_seller_interest_status" ON "seller_interest" ("status", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_attempt" (
        "id"                uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "paymentId"         uuid              NOT NULL,
        "attemptNumber"     integer           NOT NULL,
        "provider"          character varying(30) NOT NULL,
        "providerReference" character varying(160) NULL,
        "status"            character varying(20) NOT NULL,
        "requestHash"       character varying(64) NOT NULL,
        "providerStatus"    character varying(80) NULL,
        "failureReason"     text              NULL,
        "completedAt"       timestamp with time zone NULL,
        "createdAt"         TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"         TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_attempt" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_attempt_number" ON "payment_attempt" ("paymentId", "attemptNumber")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_attempt_status" ON "payment_attempt" ("status", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_refund" (
        "id"              uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "paymentId"       uuid              NOT NULL,
        "operationKey"    character varying(160) NOT NULL,
        "providerRefundId" character varying(160) NULL,
        "amountMinor"     bigint            NOT NULL,
        "currency"        character varying(3) NOT NULL,
        "reason"          character varying(500) NOT NULL,
        "initiatedById"   uuid              NOT NULL,
        "status"          character varying(20) NOT NULL DEFAULT 'pending',
        "failureReason"   text              NULL,
        "processedAt"     timestamp with time zone NULL,
        "createdAt"       TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_refund" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_refund_op_key"   ON "payment_refund" ("operationKey")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_refund_prov_id"  ON "payment_refund" ("providerRefundId") WHERE "providerRefundId" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_payment_refund_payment"         ON "payment_refund" ("paymentId", "status")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_webhook_event" (
        "id"          uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "provider"    character varying(30) NOT NULL,
        "eventKey"    character varying(160) NOT NULL,
        "eventType"   character varying(80) NOT NULL,
        "reference"   character varying(160) NULL,
        "payloadHash" character varying(64) NOT NULL,
        "processed"   boolean           NOT NULL DEFAULT false,
        "processedAt" timestamp with time zone NULL,
        "createdAt"   TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_webhook_event" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_webhook_provider_key" ON "payment_webhook_event" ("provider", "eventKey")`);

    // ── New columns on existing tables ──

    await queryRunner.query(`
      ALTER TABLE "Admin"
      ADD COLUMN IF NOT EXISTS "tokenVersion"              integer   NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "mfaEnabled"               boolean   NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "mfaSecretEncrypted"        text      NULL,
      ADD COLUMN IF NOT EXISTS "mfaRecoveryCodeHashes"     jsonb     NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "verificationTokenExpires"  timestamp NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD COLUMN IF NOT EXISTS "actorType"   character varying(20)  NULL,
      ADD COLUMN IF NOT EXISTS "requestId"   character varying(100) NULL,
      ADD COLUMN IF NOT EXISTS "method"      character varying(10)  NULL,
      ADD COLUMN IF NOT EXISTS "route"       character varying(300) NULL,
      ADD COLUMN IF NOT EXISTS "payloadHash" character varying(64)  NULL,
      ADD COLUMN IF NOT EXISTS "outcome"     character varying(20)  NULL,
      ADD COLUMN IF NOT EXISTS "statusCode"  integer                NULL,
      ADD COLUMN IF NOT EXISTS "userAgent"   character varying(512) NULL,
      ADD COLUMN IF NOT EXISTS "reason"      character varying(500) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "userId"         uuid              NULL,
      ADD COLUMN IF NOT EXISTS "fullName"        character varying NULL,
      ADD COLUMN IF NOT EXISTS "isPickup"        boolean          NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "pickupDate"      timestamp        NULL,
      ADD COLUMN IF NOT EXISTS "phoneNumber"     character varying NULL,
      ADD COLUMN IF NOT EXISTS "idempotencyKey"  character varying NULL,
      ADD COLUMN IF NOT EXISTS "updatedByAdmin"  boolean          NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "amountMinor"              bigint               NULL,
      ADD COLUMN IF NOT EXISTS "amountPaidMinor"          bigint               NULL,
      ADD COLUMN IF NOT EXISTS "currency"                 character varying(3) NOT NULL DEFAULT 'NGN',
      ADD COLUMN IF NOT EXISTS "providerStatus"           character varying(80) NULL,
      ADD COLUMN IF NOT EXISTS "failureReason"            text                 NULL,
      ADD COLUMN IF NOT EXISTS "initializationAttempts"   integer              NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "initializedAt"            timestamp with time zone NULL,
      ADD COLUMN IF NOT EXISTS "initializationLeaseUntil" timestamp with time zone NULL,
      ADD COLUMN IF NOT EXISTS "completedAt"              timestamp with time zone NULL,
      ADD COLUMN IF NOT EXISTS "referralProcessed"        boolean              NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "wallet_transaction"
      ADD COLUMN IF NOT EXISTS "amountMinor"   bigint               NULL,
      ADD COLUMN IF NOT EXISTS "operationKey"  character varying(160) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "shipment"
      ADD COLUMN IF NOT EXISTS "orderId" uuid NULL
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shipment_order" ON "shipment" ("orderId") WHERE "orderId" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_webhook_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_refund"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_attempt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "seller_interest"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_likes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledger_entry"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "upload_asset"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_reservation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_session"`);
  }
}
