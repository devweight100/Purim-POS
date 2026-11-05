-- Baseline: database schema as it existed before 20260902000000_product_persistence.
-- Allows `prisma migrate deploy` to build a brand-new database from scratch.
-- EXISTING databases already contain these objects: mark this migration as applied once with
--   npx prisma migrate resolve --applied 20260901000000_baseline

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'CASHIER', 'WAREHOUSE');

CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'VOIDED', 'REFUNDED');

CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QR_PROMPTPAY', 'CREDIT_CARD', 'TRANSFER', 'CREDIT_NOTE', 'CREDIT_DEBT');

CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'PENDING', 'ISSUED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'COMPLETED', 'CANCELLED');

CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TYPE "DebtStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

CREATE TYPE "ClaimType" AS ENUM ('EXCHANGE', 'REFUND', 'WARRANTY');

CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

CREATE TYPE "ReturnNoteStatus" AS ENUM ('PENDING', 'USED', 'PARTIALLY_USED', 'CANCELLED');

CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CASHIER',
    "pin_code" TEXT,
    "permissions" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "shift_number" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "starting_cash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cash_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "promptpay_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit_card_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "debt_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expected_cash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actual_cash" DECIMAL(12,2),
    "cash_difference" DECIMAL(12,2),
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT NOT NULL,
    "category_id" TEXT,
    "base_price" DECIMAL(10,2) NOT NULL,
    "cost_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "price_level_1" DECIMAL(10,2),
    "price_level_2" DECIMAL(10,2),
    "price_level_3" DECIMAL(10,2),
    "price_level_4" DECIMAL(10,2),
    "price_level_5" DECIMAL(10,2),
    "unit" TEXT DEFAULT 'ชิ้น',
    "image_url" TEXT,
    "is_bundle" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_bundle_items" (
    "id" TEXT NOT NULL,
    "bundle_product_id" TEXT NOT NULL,
    "child_product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_bundle_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_barcodes" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity_received" INTEGER NOT NULL,
    "quantity_remaining" INTEGER NOT NULL,
    "unit_cost" DECIMAL(10,2) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier_id" TEXT,
    "purchase_order_id" TEXT,
    "note" TEXT,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_suppliers" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_sku" TEXT,
    "unit_cost" DECIMAL(10,2),
    "is_preferred" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "credit_terms" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_invoice_no" TEXT,
    "bill_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remaining_payable" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(10,2) NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_vouchers" (
    "id" TEXT NOT NULL,
    "voucher_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_bills_amount" DECIMAL(12,2) NOT NULL,
    "debit_deducted" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_paid_amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "bank_account_label" TEXT,
    "reference_no" TEXT,
    "note" TEXT,
    "cashier_name" TEXT NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_voucher_items" (
    "id" TEXT NOT NULL,
    "voucher_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payment_voucher_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_voucher_debits" (
    "id" TEXT NOT NULL,
    "voucher_id" TEXT NOT NULL,
    "return_note_id" TEXT NOT NULL,
    "amount_deducted" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payment_voucher_debits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_return_notes" (
    "id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "total_quantity" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "remaining_credit_amount" DECIMAL(12,2) NOT NULL,
    "status" "ReturnNoteStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "supplier_return_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_return_note_items" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "product_id" TEXT,
    "claim_id" TEXT,
    "item_type" TEXT NOT NULL DEFAULT 'DEFECTIVE',
    "product_name" TEXT,
    "sku" TEXT,
    "unit_name" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_return_note_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_return_note_deductions" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "net_paid" DECIMAL(12,2),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_return_note_deductions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "replacement_warranties" (
    "id" TEXT NOT NULL,
    "original_claim_id" TEXT,
    "original_order_id" TEXT,
    "original_order_number" TEXT,
    "replacement_date" TIMESTAMP(3),
    "customer_id" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "product_id" TEXT,
    "product_name" TEXT,
    "sku" TEXT,
    "unit_name" TEXT,
    "unit_price" DECIMAL(12,2),
    "is_claimed" BOOLEAN NOT NULL DEFAULT false,
    "claim_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replacement_warranties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_debts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "total_debt" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL(12,2) NOT NULL,
    "due_date" TIMESTAMP(3),
    "status" "DebtStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_debts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "debt_payments" (
    "id" TEXT NOT NULL,
    "debt_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "reference_no" TEXT,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashier_name" TEXT NOT NULL,
    "receipt_no" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "client_order_id" TEXT,
    "order_number" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "shift_id" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'COMPLETED',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "total_cogs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "unit_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "bundle_data" JSONB,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference_no" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_claims" (
    "id" TEXT NOT NULL,
    "claim_number" TEXT NOT NULL,
    "order_id" TEXT,
    "customer_id" TEXT,
    "product_id" TEXT NOT NULL,
    "serial_no" TEXT,
    "claim_type" "ClaimType" NOT NULL,
    "problem_description" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "resolution_note" TEXT,
    "received_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_name" TEXT,
    "conversion_factor" INTEGER NOT NULL DEFAULT 1,
    "base_quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2),
    "total_claim_value" DECIMAL(12,2),
    "refund_amount" DECIMAL(12,2),
    "cost_price" DECIMAL(12,2),
    "total_cost_value" DECIMAL(12,2),
    "resolution_type" TEXT,
    "frontend_status" TEXT,
    "cashier_name" TEXT,
    "supplier_id" TEXT,
    "return_note_id" TEXT,
    "replacement_product_id" TEXT,
    "replacement_base_quantity" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "customer_claims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "claim_inventory" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "condition" TEXT,
    "location" TEXT,
    "note" TEXT,
    "claim_id" TEXT,
    "customer_id" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "supplier_id" TEXT,
    "supplier_name" TEXT,
    "status" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_inventory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "branch" TEXT,
    "qr_code_url" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_settings" (
    "id" TEXT NOT NULL,
    "store_name" TEXT NOT NULL DEFAULT 'ร้านปุริม POS',
    "store_phone" TEXT,
    "store_address" TEXT,
    "store_email" TEXT,
    "logo_url" TEXT,
    "qr_image_url" TEXT,
    "qr_label" TEXT,
    "tax_id" TEXT,
    "receipt_footer" TEXT,
    "points_per_baht" DECIMAL(10,4) NOT NULL DEFAULT 0.01,
    "point_value" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

CREATE UNIQUE INDEX "shifts_shift_number_key" ON "shifts"("shift_number");

CREATE INDEX "shifts_user_id_idx" ON "shifts"("user_id");

CREATE INDEX "shifts_opened_at_idx" ON "shifts"("opened_at");

CREATE INDEX "shifts_status_idx" ON "shifts"("status");

CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

CREATE INDEX "products_category_id_idx" ON "products"("category_id");

CREATE INDEX "products_name_idx" ON "products"("name");

CREATE INDEX "product_bundle_items_bundle_product_id_idx" ON "product_bundle_items"("bundle_product_id");

CREATE INDEX "product_bundle_items_child_product_id_idx" ON "product_bundle_items"("child_product_id");

CREATE UNIQUE INDEX "product_bundle_items_bundle_product_id_child_product_id_key" ON "product_bundle_items"("bundle_product_id", "child_product_id");

CREATE UNIQUE INDEX "product_barcodes_barcode_key" ON "product_barcodes"("barcode");

CREATE INDEX "product_barcodes_product_id_idx" ON "product_barcodes"("product_id");

CREATE INDEX "stock_batches_product_id_quantity_remaining_idx" ON "stock_batches"("product_id", "quantity_remaining");

CREATE INDEX "stock_batches_received_at_idx" ON "stock_batches"("received_at");

CREATE UNIQUE INDEX "product_suppliers_product_id_supplier_id_key" ON "product_suppliers"("product_id", "supplier_id");

CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

CREATE INDEX "purchase_orders_payment_status_idx" ON "purchase_orders"("payment_status");

CREATE INDEX "purchase_orders_bill_date_idx" ON "purchase_orders"("bill_date");

CREATE INDEX "purchase_orders_supplier_invoice_no_idx" ON "purchase_orders"("supplier_invoice_no");

CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

CREATE UNIQUE INDEX "payment_vouchers_voucher_number_key" ON "payment_vouchers"("voucher_number");

CREATE INDEX "payment_vouchers_supplier_id_idx" ON "payment_vouchers"("supplier_id");

CREATE INDEX "payment_vouchers_payment_date_idx" ON "payment_vouchers"("payment_date");

CREATE INDEX "payment_vouchers_status_idx" ON "payment_vouchers"("status");

CREATE INDEX "payment_voucher_items_voucher_id_idx" ON "payment_voucher_items"("voucher_id");

CREATE INDEX "payment_voucher_items_purchase_order_id_idx" ON "payment_voucher_items"("purchase_order_id");

CREATE INDEX "payment_voucher_debits_voucher_id_idx" ON "payment_voucher_debits"("voucher_id");

CREATE INDEX "payment_voucher_debits_return_note_id_idx" ON "payment_voucher_debits"("return_note_id");

CREATE UNIQUE INDEX "supplier_return_notes_return_number_key" ON "supplier_return_notes"("return_number");

CREATE INDEX "supplier_return_notes_supplier_id_idx" ON "supplier_return_notes"("supplier_id");

CREATE INDEX "supplier_return_notes_status_idx" ON "supplier_return_notes"("status");

CREATE INDEX "supplier_return_note_items_note_id_idx" ON "supplier_return_note_items"("note_id");

CREATE INDEX "supplier_return_note_items_product_id_idx" ON "supplier_return_note_items"("product_id");

CREATE INDEX "supplier_return_note_deductions_note_id_idx" ON "supplier_return_note_deductions"("note_id");

CREATE INDEX "replacement_warranties_original_claim_id_idx" ON "replacement_warranties"("original_claim_id");

CREATE INDEX "replacement_warranties_customer_id_idx" ON "replacement_warranties"("customer_id");

CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

CREATE UNIQUE INDEX "customer_debts_order_id_key" ON "customer_debts"("order_id");

CREATE INDEX "customer_debts_customer_id_idx" ON "customer_debts"("customer_id");

CREATE INDEX "customer_debts_status_idx" ON "customer_debts"("status");

CREATE INDEX "customer_debts_due_date_idx" ON "customer_debts"("due_date");

CREATE INDEX "debt_payments_debt_id_idx" ON "debt_payments"("debt_id");

CREATE INDEX "debt_payments_payment_date_idx" ON "debt_payments"("payment_date");

CREATE UNIQUE INDEX "orders_client_order_id_key" ON "orders"("client_order_id");

CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

CREATE INDEX "orders_created_at_status_idx" ON "orders"("created_at", "status");

CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");

CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

CREATE INDEX "orders_shift_id_idx" ON "orders"("shift_id");

CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

CREATE UNIQUE INDEX "customer_claims_claim_number_key" ON "customer_claims"("claim_number");

CREATE INDEX "customer_claims_status_idx" ON "customer_claims"("status");

CREATE INDEX "customer_claims_product_id_idx" ON "customer_claims"("product_id");

CREATE INDEX "customer_claims_customer_id_idx" ON "customer_claims"("customer_id");

CREATE INDEX "customer_claims_supplier_id_idx" ON "customer_claims"("supplier_id");

CREATE INDEX "customer_claims_return_note_id_idx" ON "customer_claims"("return_note_id");

CREATE INDEX "claim_inventory_product_id_idx" ON "claim_inventory"("product_id");

CREATE UNIQUE INDEX "bank_accounts_account_number_key" ON "bank_accounts"("account_number");

CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_bundle_items" ADD CONSTRAINT "product_bundle_items_bundle_product_id_fkey" FOREIGN KEY ("bundle_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_bundle_items" ADD CONSTRAINT "product_bundle_items_child_product_id_fkey" FOREIGN KEY ("child_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_voucher_items" ADD CONSTRAINT "payment_voucher_items_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "payment_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_voucher_items" ADD CONSTRAINT "payment_voucher_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_voucher_debits" ADD CONSTRAINT "payment_voucher_debits_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "payment_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_voucher_debits" ADD CONSTRAINT "payment_voucher_debits_return_note_id_fkey" FOREIGN KEY ("return_note_id") REFERENCES "supplier_return_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_return_notes" ADD CONSTRAINT "supplier_return_notes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_return_note_items" ADD CONSTRAINT "supplier_return_note_items_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "supplier_return_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_return_note_deductions" ADD CONSTRAINT "supplier_return_note_deductions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "supplier_return_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_debts" ADD CONSTRAINT "customer_debts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_debts" ADD CONSTRAINT "customer_debts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_debt_id_fkey" FOREIGN KEY ("debt_id") REFERENCES "customer_debts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_claims" ADD CONSTRAINT "customer_claims_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_claims" ADD CONSTRAINT "customer_claims_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_claims" ADD CONSTRAINT "customer_claims_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_claims" ADD CONSTRAINT "customer_claims_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_claims" ADD CONSTRAINT "customer_claims_return_note_id_fkey" FOREIGN KEY ("return_note_id") REFERENCES "supplier_return_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "claim_inventory" ADD CONSTRAINT "claim_inventory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
