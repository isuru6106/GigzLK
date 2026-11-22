-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('LKR');

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'LKR',
    "fundedAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "holdActive" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_assignmentId_key" ON "Payment"("assignmentId");


-- Financial and lifecycle safeguards
ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_grossMinor_valid"
        CHECK ("grossMinor" > 0 AND "grossMinor" <= 9007199254740991),
    ADD CONSTRAINT "Payment_version_nonnegative"
        CHECK ("version" >= 0),
    ADD CONSTRAINT "Payment_release_requires_funding_and_approval"
        CHECK (
            "releasedAt" IS NULL
            OR ("fundedAt" IS NOT NULL AND "approvedAt" IS NOT NULL)
        );