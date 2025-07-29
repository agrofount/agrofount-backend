-- Function to update purchase counts for product locations
CREATE OR REPLACE FUNCTION update_purchase_count_from_orders()
RETURNS TRIGGER AS $$
DECLARE
    item RECORD;
BEGIN
    -- Check if the order status is updated to 'confirmed'
    IF NEW.status = 'confirmed' THEN
        -- Loop through each item in the order's items JSON array
        FOR item IN SELECT * FROM jsonb_to_recordset(NEW.items::jsonb) AS x(id UUID, quantity INT) LOOP
            -- Update the purchaseCount for the corresponding product location
            UPDATE product_location
            SET "purchaseCount" = "purchaseCount" + item.quantity
            WHERE id = item.id;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for the orders table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE trigger_name = 'order_completion_trigger'
    ) THEN
        CREATE TRIGGER order_completion_trigger
        AFTER UPDATE OF status ON orders
        FOR EACH ROW
        WHEN (NEW.status = 'confirmed')
        EXECUTE FUNCTION update_purchase_count_from_orders();
    END IF;
END $$;