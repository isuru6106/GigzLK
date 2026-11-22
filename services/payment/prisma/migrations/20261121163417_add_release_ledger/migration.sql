-- CreateEnum
CREATE TYPE "AccountingSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('PROTECTED_FUNDS', 'WORKER_PAYABLE', 'COMMISSION_REVENUE');

-- CreateTable
CREATE TABLE "ReleaseJournal" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "callerId" VARCHAR(100) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "commissionMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'LKR',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "side" "AccountingSide" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'LKR',

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseJournal_paymentId_key" ON "ReleaseJournal"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseJournal_callerId_idempotencyKey_key" ON "ReleaseJournal"("callerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_journalId_position_key" ON "LedgerEntry"("journalId", "position");

-- AddForeignKey
ALTER TABLE "ReleaseJournal" ADD CONSTRAINT "ReleaseJournal_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "ReleaseJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Validate release amounts and the current 10% commission rule.
ALTER TABLE "ReleaseJournal"
    ADD CONSTRAINT "ReleaseJournal_gross_valid"
        CHECK ("grossMinor" > 0 AND "grossMinor" <= 9007199254740991),
    ADD CONSTRAINT "ReleaseJournal_commission_valid"
        CHECK (
            "commissionMinor" >= 0
            AND "commissionMinor" <= "grossMinor"
        ),
    ADD CONSTRAINT "ReleaseJournal_net_valid"
        CHECK (
            "netMinor" > 0
            AND "netMinor" = "grossMinor" - "commissionMinor"
        ),
    ADD CONSTRAINT "ReleaseJournal_commission_rate"
        CHECK ("commissionMinor" = ("grossMinor" + 5) / 10),
    ADD CONSTRAINT "ReleaseJournal_caller_not_blank"
        CHECK (length(btrim("callerId")) > 0),
    ADD CONSTRAINT "ReleaseJournal_key_not_blank"
        CHECK (length(btrim("idempotencyKey")) > 0);

-- Validate individual ledger entries.
ALTER TABLE "LedgerEntry"
    ADD CONSTRAINT "LedgerEntry_amount_valid"
        CHECK ("amountMinor" > 0 AND "amountMinor" <= 9007199254740991),
    ADD CONSTRAINT "LedgerEntry_position_valid"
        CHECK ("position" >= 0);