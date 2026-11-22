-- CreateEnum
CREATE TYPE "AuthAdmissionReservationState" AS ENUM ('RESERVED', 'CONSUMED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "AuthLoginAttempt" ADD COLUMN     "reservationId" UUID,
ADD COLUMN     "verificationClaimHash" CHAR(64),
ADD COLUMN     "verificationClaimedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "AuthAdmissionControl" (
    "id" VARCHAR(32) NOT NULL,
    "epoch" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "activeHour" BIGINT NOT NULL,
    "closedThroughHour" BIGINT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthAdmissionControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAdmissionNamespace" (
    "id" UUID NOT NULL,
    "epoch" UUID NOT NULL,
    "hour" BIGINT NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AuthAdmissionNamespace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAdmissionReservation" (
    "id" UUID NOT NULL,
    "namespaceId" UUID NOT NULL,
    "attemptComponent" UUID NOT NULL,
    "callerIssuer" VARCHAR(255) NOT NULL,
    "audience" "SessionAudience" NOT NULL,
    "operation" VARCHAR(128) NOT NULL,
    "contextBinding" VARCHAR(255) NOT NULL,
    "authorizationHash" CHAR(64) NOT NULL,
    "state" "AuthAdmissionReservationState" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "authorizationExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "issuanceExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "recoveryExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "reconciliationPending" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AuthAdmissionReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAdmissionCallerQuota" (
    "callerIssuer" VARCHAR(255) NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "refilledAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthAdmissionCallerQuota_pkey" PRIMARY KEY ("callerIssuer")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthAdmissionNamespace_epoch_hour_key" ON "AuthAdmissionNamespace"("epoch", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAdmissionReservation_authorizationHash_key" ON "AuthAdmissionReservation"("authorizationHash");

-- CreateIndex
CREATE INDEX "AuthAdmissionReservation_callerIssuer_createdAt_idx" ON "AuthAdmissionReservation"("callerIssuer", "createdAt");

-- CreateIndex
CREATE INDEX "AuthAdmissionReservation_callerIssuer_audience_contextBindi_idx" ON "AuthAdmissionReservation"("callerIssuer", "audience", "contextBinding", "createdAt");

-- CreateIndex
CREATE INDEX "AuthAdmissionReservation_state_issuanceExpiresAt_idx" ON "AuthAdmissionReservation"("state", "issuanceExpiresAt");

-- CreateIndex
CREATE INDEX "AuthAdmissionReservation_recoveryExpiresAt_idx" ON "AuthAdmissionReservation"("recoveryExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAdmissionReservation_namespaceId_attemptComponent_key" ON "AuthAdmissionReservation"("namespaceId", "attemptComponent");

-- CreateIndex
CREATE UNIQUE INDEX "AuthLoginAttempt_reservationId_key" ON "AuthLoginAttempt"("reservationId");

-- AddForeignKey
ALTER TABLE "AuthAdmissionReservation" ADD CONSTRAINT "AuthAdmissionReservation_namespaceId_fkey" FOREIGN KEY ("namespaceId") REFERENCES "AuthAdmissionNamespace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthLoginAttempt" ADD CONSTRAINT "AuthLoginAttempt_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "AuthAdmissionReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Admission invariants
ALTER TABLE "AuthAdmissionControl"
ADD CONSTRAINT "AuthAdmissionControl_singleton"
CHECK ("id" = 'admission'),
ADD CONSTRAINT "AuthAdmissionControl_hours_valid"
CHECK (
    "activeHour" >= 0
    AND "closedThroughHour" >= -1
    AND "closedThroughHour" < "activeHour"
);

ALTER TABLE "AuthAdmissionNamespace"
ADD CONSTRAINT "AuthAdmissionNamespace_hour_valid"
CHECK ("hour" >= 0),
ADD CONSTRAINT "AuthAdmissionNamespace_closure_valid"
CHECK ("closedAt" IS NULL OR "closedAt" >= "openedAt");

ALTER TABLE "AuthAdmissionReservation"
ADD CONSTRAINT "AuthAdmissionReservation_deadlines_valid"
CHECK (
    "authorizationExpiresAt" > "createdAt"
    AND "authorizationExpiresAt" <= "issuanceExpiresAt"
    AND "issuanceExpiresAt" = "createdAt" + INTERVAL '5 minutes'
    AND "recoveryExpiresAt" = "createdAt" + INTERVAL '24 hours'
),
ADD CONSTRAINT "AuthAdmissionReservation_binding_valid"
CHECK (
    length(btrim("callerIssuer")) > 0
    AND length(btrim("contextBinding")) > 0
    AND "operation" = '/internal/v1/auth/login'
),
ADD CONSTRAINT "AuthAdmissionReservation_hash_valid"
CHECK ("authorizationHash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "AuthAdmissionReservation_cancellation_consistent"
CHECK (
    ("state" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
),
ADD CONSTRAINT "AuthAdmissionReservation_consumption_consistent"
CHECK (
    ("state" <> 'CONSUMED' OR "consumedAt" IS NOT NULL)
    AND ("state" <> 'RESERVED' OR "consumedAt" IS NULL)
    AND ("consumedAt" IS NULL OR "consumedAt" >= "createdAt")
),
ADD CONSTRAINT "AuthAdmissionReservation_cancellation_time_valid"
CHECK ("cancelledAt" IS NULL OR "cancelledAt" >= "createdAt");

ALTER TABLE "AuthAdmissionCallerQuota"
ADD CONSTRAINT "AuthAdmissionCallerQuota_caller_valid"
CHECK (length(btrim("callerIssuer")) > 0),
ADD CONSTRAINT "AuthAdmissionCallerQuota_tokens_valid"
CHECK ("tokens" >= 0 AND "tokens" <= 5);

ALTER TABLE "AuthLoginAttempt"
ADD CONSTRAINT "AuthLoginAttempt_verification_claim_consistent"
CHECK (
    ("verificationClaimHash" IS NULL) =
    ("verificationClaimedAt" IS NULL)
),
ADD CONSTRAINT "AuthLoginAttempt_verification_claim_hash_valid"
CHECK (
    "verificationClaimHash" IS NULL
    OR "verificationClaimHash" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "AuthLoginAttempt"
ADD COLUMN "verificationStartedAt" TIMESTAMPTZ(3),
ADD CONSTRAINT "AuthLoginAttempt_verification_start_valid"
CHECK (
    "verificationStartedAt" IS NULL
    OR (
        "verificationClaimedAt" IS NOT NULL
        AND "verificationStartedAt" >= "verificationClaimedAt"
    )
);
