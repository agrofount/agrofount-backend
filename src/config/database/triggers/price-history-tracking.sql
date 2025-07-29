CREATE OR REPLACE FUNCTION track_price_history()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.price <> NEW.price THEN
        INSERT INTO price_history ("productLocationId", "oldPrice", "newPrice", "changedAt")
        VALUES (OLD.id, OLD.price, NEW.price, NOW());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE trigger_name = 'price_history_trigger'
    ) THEN
        CREATE TRIGGER price_history_trigger
        BEFORE UPDATE ON product_location
        FOR EACH ROW
        EXECUTE FUNCTION track_price_history();
    END IF;
END $$;

