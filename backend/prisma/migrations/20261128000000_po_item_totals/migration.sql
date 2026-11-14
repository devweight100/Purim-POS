-- GET /payables/bills: per-PO sums of the lines (count, value received at gross per unit) were aggregated over
-- every purchase_order_items row on each request (~0.2 s of the 0.4 s at 50,000 POs). Kept here instead, by
-- statement triggers on purchase_order_items that ADD each statement's change (+ new rows, - old rows): numeric
-- addition is exact, so the stored sum always equals SUM(...) over the PO's current lines, and concurrent writers
-- never lose an update (ON CONFLICT DO UPDATE adds to the latest committed value).

-- CreateTable
CREATE TABLE "purchase_order_item_totals" (
    "purchase_order_id" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "received_value" DECIMAL NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_item_totals_pkey" PRIMARY KEY ("purchase_order_id")
);

-- AddForeignKey
ALTER TABLE "purchase_order_item_totals" ADD CONSTRAINT "purchase_order_item_totals_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Value received on one line, as payableNow / billFigures count it: received qty x gross per unit (incl. discounts
-- and VAT); quantity <= 0 -> unit cost.
CREATE OR REPLACE FUNCTION purim_po_line_received_value(received_qty numeric, quantity numeric, total numeric, unit_cost numeric)
  RETURNS numeric LANGUAGE sql IMMUTABLE AS
$$ SELECT received_qty * CASE WHEN quantity > 0 THEN total / quantity ELSE unit_cost END $$;

CREATE OR REPLACE FUNCTION purim_po_item_totals_apply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- one signed row per changed line; POs deleted in the same statement (cascade) are skipped
  IF TG_OP = 'INSERT' THEN
    INSERT INTO purchase_order_item_totals AS t (purchase_order_id, item_count, received_value)
    SELECT d.po, SUM(d.n), SUM(d.v) FROM (
      SELECT purchase_order_id AS po, 1 AS n, purim_po_line_received_value(received_qty, quantity, total, unit_cost) AS v FROM new_rows
    ) d WHERE EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id = d.po)
    GROUP BY d.po ORDER BY d.po
    ON CONFLICT (purchase_order_id) DO UPDATE SET item_count = t.item_count + EXCLUDED.item_count, received_value = t.received_value + EXCLUDED.received_value;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO purchase_order_item_totals AS t (purchase_order_id, item_count, received_value)
    SELECT d.po, SUM(d.n), SUM(d.v) FROM (
      SELECT purchase_order_id AS po, -1 AS n, -purim_po_line_received_value(received_qty, quantity, total, unit_cost) AS v FROM old_rows
    ) d WHERE EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id = d.po)
    GROUP BY d.po ORDER BY d.po
    ON CONFLICT (purchase_order_id) DO UPDATE SET item_count = t.item_count + EXCLUDED.item_count, received_value = t.received_value + EXCLUDED.received_value;
  ELSE
    INSERT INTO purchase_order_item_totals AS t (purchase_order_id, item_count, received_value)
    SELECT d.po, SUM(d.n), SUM(d.v) FROM (
      SELECT purchase_order_id AS po, 1 AS n, purim_po_line_received_value(received_qty, quantity, total, unit_cost) AS v FROM new_rows
      UNION ALL
      SELECT purchase_order_id AS po, -1 AS n, -purim_po_line_received_value(received_qty, quantity, total, unit_cost) AS v FROM old_rows
    ) d WHERE EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id = d.po)
    GROUP BY d.po ORDER BY d.po
    ON CONFLICT (purchase_order_id) DO UPDATE SET item_count = t.item_count + EXCLUDED.item_count, received_value = t.received_value + EXCLUDED.received_value;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS purim_po_item_totals_ins ON "purchase_order_items";
CREATE TRIGGER purim_po_item_totals_ins AFTER INSERT ON "purchase_order_items"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION purim_po_item_totals_apply();
DROP TRIGGER IF EXISTS purim_po_item_totals_upd ON "purchase_order_items";
CREATE TRIGGER purim_po_item_totals_upd AFTER UPDATE ON "purchase_order_items"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION purim_po_item_totals_apply();
DROP TRIGGER IF EXISTS purim_po_item_totals_del ON "purchase_order_items";
CREATE TRIGGER purim_po_item_totals_del AFTER DELETE ON "purchase_order_items"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION purim_po_item_totals_apply();

-- Existing lines
INSERT INTO purchase_order_item_totals (purchase_order_id, item_count, received_value)
SELECT purchase_order_id, COUNT(*), SUM(purim_po_line_received_value(received_qty, quantity, total, unit_cost))
  FROM purchase_order_items GROUP BY purchase_order_id;
