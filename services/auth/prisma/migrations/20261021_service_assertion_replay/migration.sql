CREATE TABLE "ServiceAssertionReplay" (
    "issuer" VARCHAR(255) NOT NULL,
    "jti" VARCHAR(32) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAssertionReplay_pkey" PRIMARY KEY ("issuer", "jti")
);

CREATE INDEX "ServiceAssertionReplay_expiresAt_idx"
    ON "ServiceAssertionReplay"("expiresAt");