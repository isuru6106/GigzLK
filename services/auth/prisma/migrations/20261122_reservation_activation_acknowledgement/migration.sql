ALTER TABLE "AuthAdmissionReservation"
    ADD COLUMN "activationId" CHAR(64),
    ADD COLUMN "activationAcknowledgedAt" TIMESTAMPTZ(3),
    ADD COLUMN "activationSessionId" UUID,
    ADD COLUMN "activationSessionExpiresAt" TIMESTAMPTZ(3),
    ADD COLUMN "activationConfirmationUntil" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX
    "AuthAdmissionReservation_callerIssuer_namespaceId_activationId_key"
ON "AuthAdmissionReservation"
    ("callerIssuer", "namespaceId", "activationId");

ALTER TABLE "AuthAdmissionReservation"
ADD CONSTRAINT "AuthAdmissionReservation_activation_fields_consistent"
CHECK (
    (
        "activationId" IS NULL
        AND "activationAcknowledgedAt" IS NULL
        AND "activationSessionId" IS NULL
        AND "activationSessionExpiresAt" IS NULL
        AND "activationConfirmationUntil" IS NULL
    )
    OR
    (
        "activationId" IS NOT NULL
        AND "activationAcknowledgedAt" IS NOT NULL
        AND "activationSessionId" IS NOT NULL
        AND "activationSessionExpiresAt" IS NOT NULL
        AND "activationConfirmationUntil" IS NOT NULL
    )
),
ADD CONSTRAINT "AuthAdmissionReservation_activation_id_valid"
CHECK (
    "activationId" IS NULL
    OR "activationId" ~ '^[0-9a-f]{64}$'
),
ADD CONSTRAINT "AuthAdmissionReservation_activation_deadlines_valid"
CHECK (
    "activationAcknowledgedAt" IS NULL
    OR (
        "consumedAt" IS NOT NULL
        AND "activationAcknowledgedAt" >= "createdAt"
        AND "activationAcknowledgedAt" >= "consumedAt"
        AND "activationAcknowledgedAt" < "recoveryExpiresAt"
        AND "activationAcknowledgedAt" < "activationSessionExpiresAt"
        AND "activationConfirmationUntil" =
            "activationSessionExpiresAt" + INTERVAL '24 hours'
    )
);
