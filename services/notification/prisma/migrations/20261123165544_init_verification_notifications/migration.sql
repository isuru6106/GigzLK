-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('QUEUED', 'SENDING', 'RETRY_WAIT', 'SENT', 'FAILED', 'CANCELLED', 'EXPIRED', 'DELIVERY_UNKNOWN');

-- CreateEnum
CREATE TYPE "VerificationDeliveryOutcome" AS ENUM ('NOT_SENT', 'ACCEPTED', 'MAY_HAVE_BEEN_SENT');

-- CreateTable
CREATE TABLE "VerificationNotification" (
    "id" UUID NOT NULL,
    "callerId" VARCHAR(100) NOT NULL,
    "requestId" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "fingerprintKeyId" VARCHAR(100) NOT NULL,
    "templateId" VARCHAR(100) NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'QUEUED',
    "deliveryOutcome" "VerificationDeliveryOutcome" NOT NULL DEFAULT 'NOT_SENT',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "sendBefore" TIMESTAMPTZ(3) NOT NULL,
    "metadataDeleteAfter" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancellationRequested" BOOLEAN NOT NULL DEFAULT false,
    "claimId" UUID,
    "claimExpiresAt" TIMESTAMPTZ(3),
    "providerReference" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VerificationNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationPayload" (
    "notificationId" UUID NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "authenticationTag" BYTEA NOT NULL,
    "encryptionKeyId" VARCHAR(100) NOT NULL,

    CONSTRAINT "VerificationPayload_pkey" PRIMARY KEY ("notificationId")
);

-- CreateIndex
CREATE INDEX "VerificationNotification_status_nextAttemptAt_idx" ON "VerificationNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "VerificationNotification_metadataDeleteAfter_idx" ON "VerificationNotification"("metadataDeleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationNotification_callerId_requestId_key" ON "VerificationNotification"("callerId", "requestId");

-- AddForeignKey
ALTER TABLE "VerificationPayload" ADD CONSTRAINT "VerificationPayload_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "VerificationNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VerificationNotification"
    ADD CONSTRAINT "VerificationNotification_attempts_valid"
        CHECK ("attempts" BETWEEN 0 AND 5),
    ADD CONSTRAINT "VerificationNotification_send_before_valid"
        CHECK ("sendBefore" = "expiresAt" - INTERVAL '2 minutes'),
    ADD CONSTRAINT "VerificationNotification_retention_valid"
        CHECK ("metadataDeleteAfter" = "expiresAt" + INTERVAL '168 hours'),
    ADD CONSTRAINT "VerificationNotification_claim_pair_valid"
        CHECK (
            ("claimId" IS NULL AND "claimExpiresAt" IS NULL)
            OR
            ("claimId" IS NOT NULL AND "claimExpiresAt" IS NOT NULL)
        ),
    ADD CONSTRAINT "VerificationNotification_fingerprint_valid"
        CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "VerificationNotification_caller_valid"
        CHECK (
            length(btrim("callerId")) > 0
            AND "callerId" = btrim("callerId")
        ),
    ADD CONSTRAINT "VerificationNotification_fingerprint_key_valid"
        CHECK (
            length(btrim("fingerprintKeyId")) > 0
            AND "fingerprintKeyId" = btrim("fingerprintKeyId")
        ),
    ADD CONSTRAINT "VerificationNotification_template_valid"
        CHECK ("templateId" = 'email-verification-v1');

ALTER TABLE "VerificationPayload"
    ADD CONSTRAINT "VerificationPayload_ciphertext_valid"
        CHECK (octet_length("ciphertext") BETWEEN 1 AND 16384),
    ADD CONSTRAINT "VerificationPayload_nonce_valid"
        CHECK (octet_length("nonce") = 12),
    ADD CONSTRAINT "VerificationPayload_tag_valid"
        CHECK (octet_length("authenticationTag") = 16),
    ADD CONSTRAINT "VerificationPayload_key_valid"
        CHECK (
            length(btrim("encryptionKeyId")) > 0
            AND "encryptionKeyId" = btrim("encryptionKeyId")
        );