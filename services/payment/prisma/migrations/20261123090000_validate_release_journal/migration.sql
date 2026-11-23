CREATE FUNCTION validate_release_journal_entries()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target_id UUID;
    valid BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'ReleaseJournal' THEN
        target_id := NEW."id";
    ELSE
        target_id := NEW."journalId";
    END IF;

    -- Resolve tables in the trigger's own schema, including test schemas.
    EXECUTE format(
        $query$
        SELECT EXISTS (
            SELECT 1
            FROM %I."ReleaseJournal" j
            LEFT JOIN %I."LedgerEntry" e
                ON e."journalId" = j."id"
            WHERE j."id" = $1
            GROUP BY j."id"
            HAVING
                count(e."id") =
                    CASE WHEN j."commissionMinor" > 0 THEN 3 ELSE 2 END
                AND count(*) FILTER (
                    WHERE e."position" = 0
                      AND e."account" = 'PROTECTED_FUNDS'
                      AND e."side" = 'DEBIT'
                      AND e."amountMinor" = j."grossMinor"
                      AND e."currency" = j."currency"
                ) = 1
                AND count(*) FILTER (
                    WHERE e."position" = 1
                      AND e."account" = 'WORKER_PAYABLE'
                      AND e."side" = 'CREDIT'
                      AND e."amountMinor" = j."netMinor"
                      AND e."currency" = j."currency"
                ) = 1
                AND count(*) FILTER (
                    WHERE e."position" = 2
                      AND e."account" = 'COMMISSION_REVENUE'
                      AND e."side" = 'CREDIT'
                      AND e."amountMinor" = j."commissionMinor"
                      AND e."currency" = j."currency"
                ) = CASE WHEN j."commissionMinor" > 0 THEN 1 ELSE 0 END
        )
        $query$,
        TG_TABLE_SCHEMA,
        TG_TABLE_SCHEMA
    )
    INTO valid
    USING target_id;

    IF NOT valid THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Release journal entries do not match journal amounts';
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "ReleaseJournal_entries_valid"
AFTER INSERT ON "ReleaseJournal"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_release_journal_entries();

CREATE CONSTRAINT TRIGGER "LedgerEntry_journal_valid"
AFTER INSERT ON "LedgerEntry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_release_journal_entries();