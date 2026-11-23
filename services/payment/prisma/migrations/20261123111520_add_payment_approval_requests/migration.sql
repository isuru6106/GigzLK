-- CreateTable
CREATE TABLE "PaymentApprovalRequest" (
    "id" UUID NOT NULL,
    "callerId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "paymentId" UUID NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentApprovalRequest_paymentId_idx" ON "PaymentApprovalRequest"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentApprovalRequest_callerId_idempotencyKey_key" ON "PaymentApprovalRequest"("callerId", "idempotencyKey");

-- Reject blank or whitespace-padded idempotency keys.
ALTER TABLE "PaymentApprovalRequest"
    ADD CONSTRAINT "PaymentApprovalRequest_key_valid"
        CHECK (
            length(btrim("idempotencyKey")) > 0
            AND "idempotencyKey" = btrim("idempotencyKey")
        ),
    ADD CONSTRAINT "PaymentApprovalRequest_response_object"
        CHECK (jsonb_typeof("response") = 'object');