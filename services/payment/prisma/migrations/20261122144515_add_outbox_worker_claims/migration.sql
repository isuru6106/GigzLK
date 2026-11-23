-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "claimExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "claimId" UUID,
ADD COLUMN     "failedAt" TIMESTAMPTZ(3);

-- Worker claim and terminal-state safeguards
ALTER TABLE "OutboxEvent"
    ADD CONSTRAINT "OutboxEvent_claim_pair"
        CHECK (
            ("claimId" IS NULL) = ("claimExpiresAt" IS NULL)
        ),
    ADD CONSTRAINT "OutboxEvent_terminal_exclusive"
        CHECK (
            "publishedAt" IS NULL OR "failedAt" IS NULL
        ),
    ADD CONSTRAINT "OutboxEvent_terminal_unclaimed"
        CHECK (
            ("publishedAt" IS NULL AND "failedAt" IS NULL)
            OR ("claimId" IS NULL AND "claimExpiresAt" IS NULL)
        );