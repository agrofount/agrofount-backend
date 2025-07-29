-- Function for payments table
CREATE OR REPLACE FUNCTION update_order_status_from_payments()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."paymentStatus" = 'completed' THEN
        UPDATE orders
        SET status = 'confirmed',
            "paymentStatus" = 'completed'
        WHERE id = NEW."orderId"::uuid;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function for shipment table
CREATE OR REPLACE FUNCTION update_order_status_from_shipment()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'shipped' THEN
        UPDATE orders
        SET status = 'shipped'
        WHERE id = NEW."orderId";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for payments table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE trigger_name = 'payment_status_trigger'
    ) THEN
        CREATE TRIGGER payment_status_trigger
        AFTER INSERT OR UPDATE ON payments
        FOR EACH ROW
        EXECUTE FUNCTION update_order_status_from_payments();
    END IF;
END $$;

-- Trigger for shipment table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE trigger_name = 'shipment_status_trigger'
    ) THEN
        CREATE TRIGGER shipment_status_trigger
        AFTER INSERT OR UPDATE ON shipment
        FOR EACH ROW
        EXECUTE FUNCTION update_order_status_from_shipment();
    END IF;
END $$;