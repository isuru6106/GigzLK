-- Preserve financial history against ordinary SQL mutation.
CREATE FUNCTION reject_release_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Release ledger records are immutable';
END;
$$;

CREATE TRIGGER "ReleaseJournal_immutable"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "ReleaseJournal"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_release_ledger_mutation();

CREATE TRIGGER "LedgerEntry_immutable"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "LedgerEntry"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_release_ledger_mutation();