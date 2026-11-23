-- CreateEnum
CREATE TYPE "SimulatedPayoutStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "SimulatedPayout" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "releaseJournalId" UUID NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'LKR',
    "status" "SimulatedPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SimulatedPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatedPayoutRequest" (
    "id" UUID NOT NULL,
    "callerId" VARCHAR(100) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "paymentId" UUID NOT NULL,
    "outcome" "SimulatedPayoutStatus" NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatedPayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedPayout_paymentId_key" ON "SimulatedPayout"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedPayout_releaseJournalId_key" ON "SimulatedPayout"("releaseJournalId");

-- CreateIndex
CREATE INDEX "SimulatedPayoutRequest_paymentId_idx" ON "SimulatedPayoutRequest"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedPayoutRequest_callerId_idempotencyKey_key" ON "SimulatedPayoutRequest"("callerId", "idempotencyKey");
ALTER TABLE "SimulatedPayout"
    ADD CONSTRAINT "SimulatedPayout_net_valid"
        CHECK (
            "netMinor" > 0
            AND "netMinor" <= 9007199254740991
        ),
    ADD CONSTRAINT "SimulatedPayout_version_valid"
        CHECK ("version" >= 0),
    ADD CONSTRAINT "SimulatedPayout_completion_valid"
        CHECK (
            ("status" = 'PENDING' AND "completedAt" IS NULL)
            OR
            ("status" IN ('SUCCEEDED', 'FAILED')
                AND "completedAt" IS NOT NULL)
        ),
    ADD CONSTRAINT "SimulatedPayout_payment_fkey"
        FOREIGN KEY ("paymentId")
        REFERENCES "Payment"("id")
        ON DELETE RESTRICT,
    ADD CONSTRAINT "SimulatedPayout_journal_fkey"
        FOREIGN KEY ("releaseJournalId")
        REFERENCES "ReleaseJournal"("id")
        ON DELETE RESTRICT;

ALTER TABLE "SimulatedPayoutRequest"
    ADD CONSTRAINT "SimulatedPayoutRequest_caller_valid"
        CHECK (
            length(btrim("callerId")) > 0
            AND "callerId" = btrim("callerId")
        ),
    ADD CONSTRAINT "SimulatedPayoutRequest_key_valid"
        CHECK (
            length(btrim("idempotencyKey")) > 0
            AND "idempotencyKey" = btrim("idempotencyKey")
        ),
    ADD CONSTRAINT "SimulatedPayoutRequest_outcome_valid"
        CHECK ("outcome" IN ('SUCCEEDED', 'FAILED')),
    ADD CONSTRAINT "SimulatedPayoutRequest_response_valid"
        CHECK (jsonb_typeof("response") = 'object');