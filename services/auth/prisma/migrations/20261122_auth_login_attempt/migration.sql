CREATE TYPE "AuthLoginAttemptState" AS ENUM (
    'ADMITTED',
    'COMMITTED',
    'CANCELLED',
    'REJECTED',
    'EXPIRED'
);

CREATE TABLE "AuthLoginAttempt" (
    "id" UUID NOT NULL,
    "callerIssuer" VARCHAR(255) NOT NULL,
    "audience" "SessionAudience" NOT NULL,
    "contextBinding" VARCHAR(255) NOT NULL,
    "state" "AuthLoginAttemptState" NOT NULL DEFAULT 'ADMITTED',
    "admittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuanceExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "recoveryExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "AuthLoginAttempt_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "AuthLoginAttempt_deadlines_valid"
        CHECK (
            "issuanceExpiresAt" > "admittedAt"
            AND "recoveryExpiresAt" > "issuanceExpiresAt"
        ),

    CONSTRAINT "AuthLoginAttempt_binding_nonempty"
        CHECK (
            length(btrim("callerIssuer")) > 0
            AND length(btrim("contextBinding")) > 0
        ),

    CONSTRAINT "AuthLoginAttempt_cancellation_consistent"
        CHECK (
            ("state" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
        )
);

CREATE INDEX "AuthLoginAttempt_callerIssuer_audience_idx"
    ON "AuthLoginAttempt" ("callerIssuer", "audience");

CREATE INDEX "AuthLoginAttempt_recoveryExpiresAt_idx"
    ON "AuthLoginAttempt" ("recoveryExpiresAt");

ALTER TABLE "AuthSession"
    ADD COLUMN "loginAttemptId" UUID;

CREATE UNIQUE INDEX "AuthSession_loginAttemptId_key"
    ON "AuthSession" ("loginAttemptId");

ALTER TABLE "AuthSession"
    ADD CONSTRAINT "AuthSession_loginAttemptId_fkey"
    FOREIGN KEY ("loginAttemptId")
    REFERENCES "AuthLoginAttempt" ("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
