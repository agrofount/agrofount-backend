CREATE OR REPLACE FUNCTION create_invoice_for_order()
RETURNS TRIGGER AS $$
DECLARE
    user_data RECORD;
BEGIN
    -- Fetch user data from the user table
    SELECT username, email, phone INTO user_data
    FROM "user"
    WHERE id = NEW."userId";

     -- Insert a new invoice using the fetched user data
    INSERT INTO invoices ("invoiceNumber", "orderId", "totalAmount", "customerName", "customerEmail", "customerPhone", "createdAt", "updatedAt")
        VALUES (
        CONCAT('INV-', UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 8))), -- Generate a unique alphanumeric invoice number
        NEW.id,            
        NEW."totalPrice",    
        user_data.username,  
        user_data.email, 
        user_data.phone, 
        NOW(),             
        NOW()              
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update the invoice when an order is completed
CREATE OR REPLACE FUNCTION update_invoice_for_completed_order()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the order status is updated to 'completed'
    IF NEW.status = 'confirmed' THEN
        UPDATE invoices
        SET "updatedAt" = NOW(),
            "totalAmount" = NEW."totalPrice",
            status = 'paid'
        WHERE "orderId" = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE trigger_name = 'create_invoice_trigger'
    ) THEN
        CREATE TRIGGER create_invoice_trigger
        AFTER INSERT ON orders
        FOR EACH ROW
        EXECUTE FUNCTION create_invoice_for_order();
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE trigger_name = 'update_invoice_trigger'
    ) THEN
        CREATE TRIGGER update_invoice_trigger
        AFTER UPDATE OF status ON orders
        FOR EACH ROW
        EXECUTE FUNCTION update_invoice_for_completed_order();
    END IF;
END $$;
