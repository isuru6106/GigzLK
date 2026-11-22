ALTER TABLE "Account"
ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Account"
ADD CONSTRAINT "Account_credentialVersion_positive"
CHECK ("credentialVersion" > 0);
