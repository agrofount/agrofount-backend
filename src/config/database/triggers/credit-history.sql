CREATE OR REPLACE FUNCTION log_credit_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    INSERT INTO credit_history (
      id,
      userId,
      "creditFacilityId",
      amount,
      action,
      notes,
      "createdAt"
    ) VALUES (
      gen_random_uuid(),
      NEW."userId",
      NEW."id",
      NEW."approvedAmount",
      'approved',
      'Credit approved by admin',
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE trigger_name = 'log_credit_approval'
    ) THEN
        CREATE TRIGGER log_credit_approval
        AFTER INSERT ON credit_facility_request
        FOR EACH ROW
        EXECUTE FUNCTION log_credit_approval();
    END IF;
END $$;