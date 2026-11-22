-- CreateTable
CREATE TABLE "OutboxEvent" (
    "eventId" UUID NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "producer" VARCHAR(100) NOT NULL,
    "aggregateId" UUID NOT NULL,
    "aggregateVersion" INTEGER NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "correlationId" UUID NOT NULL,
    "causationId" UUID,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_nextAttemptAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_aggregateId_aggregateVersion_eventType_key" ON "OutboxEvent"("aggregateId", "aggregateVersion", "eventType");


-- Outbox metadata safeguards
ALTER TABLE "OutboxEvent"
    ADD CONSTRAINT "OutboxEvent_schemaVersion_positive"
        CHECK ("schemaVersion" > 0),
    ADD CONSTRAINT "OutboxEvent_aggregateVersion_positive"
        CHECK ("aggregateVersion" > 0),
    ADD CONSTRAINT "OutboxEvent_attempts_nonnegative"
        CHECK ("attempts" >= 0),
    ADD CONSTRAINT "OutboxEvent_eventType_nonblank"
        CHECK (
            length(btrim("eventType")) > 0
            AND "eventType" = btrim("eventType")
        ),
    ADD CONSTRAINT "OutboxEvent_producer_nonblank"
        CHECK (
            length(btrim("producer")) > 0
            AND "producer" = btrim("producer")
        ),
    ADD CONSTRAINT "OutboxEvent_data_object"
        CHECK (jsonb_typeof("data") = 'object');