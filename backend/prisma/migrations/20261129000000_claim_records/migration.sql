-- Claims screens computed in PostgreSQL over EVERY claim (they read the newest 500 claims in the browser).
-- A claim as the pages see it = the customer_claims row merged with its CLAIM_META / EXCHANGE audit logs
-- (ClaimsService.mergeClaimWithLogs) and mapped by the frontend (claim-service mapServerClaim).
-- claim_facts keeps, per claim, the mapped fields that depend only on the claim row and its logs; it is kept by
-- the row triggers below (any write of a claim or of its CLAIM_META / EXCHANGE logs recomputes that claim).
-- The view claim_records adds the product / customer / bill fallbacks. The JS rules (truthiness, `??`,
-- Number()) are spelled out by the helper functions. Functions, triggers and the view are not expressible in
-- schema.prisma: kept here only (the table is model ClaimFact).

-- {...a, ...b} of JSON objects, in order (jsonb || keeps the later key, also when its value is null)
CREATE AGGREGATE claim_jsonb_merge(jsonb) (SFUNC = jsonb_concat, STYPE = jsonb, INITCOND = '{}');

-- JS truthiness of a JSON value (SQL NULL = undefined)
CREATE FUNCTION claim_js_truthy(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'string' THEN (j #>> '{}') <> ''
    WHEN 'number' THEN (j #>> '{}')::numeric <> 0
    WHEN 'boolean' THEN (j #>> '{}')::boolean
    WHEN 'object' THEN true
    WHEN 'array' THEN true
    ELSE false END
$$;

-- a ?? b (a missing or JSON null -> b)
CREATE FUNCTION claim_js_nn(a jsonb, b jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN a IS NULL OR jsonb_typeof(a) = 'null' THEN b ELSE a END
$$;

-- Number(x) as double precision (undefined / not a number -> NaN, null -> 0, '' -> 0, true -> 1)
CREATE FUNCTION claim_js_number(j jsonb) RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'number' THEN (j #>> '{}')::double precision
    WHEN 'null' THEN 0::double precision
    WHEN 'boolean' THEN CASE WHEN (j #>> '{}')::boolean THEN 1 ELSE 0 END::double precision
    WHEN 'string' THEN CASE
      WHEN btrim(j #>> '{}', E' \t\n\r\f\v') = '' THEN 0::double precision
      WHEN btrim(j #>> '{}', E' \t\n\r\f\v') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
        THEN btrim(j #>> '{}', E' \t\n\r\f\v')::double precision
      ELSE 'NaN'::double precision END
    ELSE 'NaN'::double precision END
$$;

-- JS text of a truthy JSON value (for `a || b` chains); NULL when falsy
CREATE FUNCTION claim_js_text(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN claim_js_truthy(j) THEN j #>> '{}' END
$$;

-- new Date(text) for the ISO dates the app writes (any other text: NULL = Invalid Date)
CREATE FUNCTION claim_js_date(t text) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF t IS NULL OR t !~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$' THEN RETURN NULL; END IF;
  IF length(t) = 10 THEN RETURN (t || 'T00:00:00Z')::timestamptz; END IF; -- date only: UTC (like JS)
  IF t !~ '(Z|[+-]\d{2}:\d{2})$' THEN RETURN NULL; END IF; -- local time: depends on the browser zone
  RETURN t::timestamptz;
EXCEPTION WHEN others THEN RETURN NULL;
END
$$;

-- x || fallback for a number (NaN and 0 are falsy; NaN = NaN in PostgreSQL). Each argument used once: inlined.
CREATE FUNCTION claim_js_or(x double precision, fallback double precision) RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(NULLIF(NULLIF(x, 'NaN'::double precision), 0), fallback)
$$;

CREATE TABLE "claim_facts" (
  "claim_id" TEXT NOT NULL,
  "claim_key" TEXT NOT NULL,
  "claim_date" TIMESTAMPTZ,
  "res_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "has_return_doc" BOOLEAN NOT NULL,
  "return_doc_id" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL,
  "conversion_factor" DOUBLE PRECISION NOT NULL,
  "base_quantity" DOUBLE PRECISION NOT NULL,
  "unit_price" DOUBLE PRECISION,
  "claim_value" DOUBLE PRECISION,
  "refund_amount" JSONB,
  "order_number" TEXT,
  "customer_name" TEXT,
  "customer_phone" TEXT,
  "product_name" TEXT,
  "sku" TEXT,
  "defect_reason" TEXT NOT NULL,
  "unit_name" TEXT,
  "replacement_unit_name" TEXT,
  "supplier_id" TEXT,
  "supplier_name" TEXT,
  "cost_price" DOUBLE PRECISION,
  CONSTRAINT "claim_facts_pkey" PRIMARY KEY ("claim_id")
);
ALTER TABLE "claim_facts" ADD CONSTRAINT "claim_facts_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "customer_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recompute the facts of these claims from the claim row and its logs (in log order: created_at, id).
CREATE FUNCTION claim_facts_refresh(ids text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- one writer per claim at a time; the statement below then sees every committed log of the claim
  PERFORM 1 FROM customer_claims WHERE id = ANY(ids) ORDER BY id FOR UPDATE;
  INSERT INTO claim_facts AS f (claim_id, claim_key, claim_date, res_type, status, has_return_doc, return_doc_id,
      quantity, conversion_factor, base_quantity, unit_price, claim_value, refund_amount, order_number, customer_name,
      customer_phone, product_name, sku, defect_reason, unit_name, replacement_unit_name, supplier_id, supplier_name, cost_price)
  SELECT c.id,
    COALESCE(NULLIF(c.claim_number, ''), c.id),
    -- claimDate || receivedDate
    CASE WHEN claim_js_truthy(lg.xm -> 'claimDate') THEN claim_js_date(lg.xm ->> 'claimDate') ELSE c.received_date END,
    st.res_type,
    CASE
      WHEN jsonb_typeof(st.raw) = 'string' AND (st.raw #>> '{}') IN ('COMPLETED', 'PENDING_CHECKOUT', 'PENDING_SUPPLIER', 'SENT_TO_SUPPLIER', 'SUPPLIER_REPLACED', 'SCRAPPED') THEN st.raw #>> '{}'
      WHEN st.raw = '"IN_PROGRESS"' THEN CASE WHEN claim_js_truthy(lg.m -> 'returnDocId') THEN 'SENT_TO_SUPPLIER' ELSE 'PENDING_SUPPLIER' END
      WHEN st.raw = '"PENDING"' THEN CASE WHEN st.res_type = 'STORE_DISCOUNT' THEN 'PENDING_CHECKOUT' ELSE 'PENDING_SUPPLIER' END
      WHEN st.raw = '"REJECTED"' THEN 'SCRAPPED'
      ELSE 'COMPLETED' END,
    claim_js_truthy(lg.m -> 'returnDocId'),
    claim_js_text(lg.m -> 'returnDocId'),
    claim_js_number(claim_js_nn(lg.m -> 'quantity', claim_js_nn(lg.x -> 'quantity', '1'))),
    claim_js_number(claim_js_nn(lg.m -> 'conversionFactor', claim_js_nn(lg.x -> 'conversionFactor', '1'))),
    claim_js_number(claim_js_nn(lg.m -> 'baseQuantity', claim_js_nn(lg.x -> 'baseQuantity', claim_js_nn(lg.m -> 'quantity', '1')))),
    -- unitPrice ?? (product price: NULL here, added by the view)
    CASE WHEN claim_js_nn(lg.m -> 'unitPrice', lg.x -> 'unitPrice') IS NULL OR jsonb_typeof(claim_js_nn(lg.m -> 'unitPrice', lg.x -> 'unitPrice')) = 'null'
         THEN NULL ELSE claim_js_number(claim_js_nn(lg.m -> 'unitPrice', lg.x -> 'unitPrice')) END,
    -- totalClaimValue ?? refundAmount ?? (unit price x quantity: NULL here, added by the view)
    CASE
      WHEN claim_js_nn(lg.m -> 'totalClaimValue', lg.x -> 'totalClaimValue') IS NOT NULL AND jsonb_typeof(claim_js_nn(lg.m -> 'totalClaimValue', lg.x -> 'totalClaimValue')) <> 'null'
        THEN claim_js_number(claim_js_nn(lg.m -> 'totalClaimValue', lg.x -> 'totalClaimValue'))
      WHEN claim_js_nn(lg.m -> 'refundAmount', lg.x -> 'refundAmount') IS NOT NULL AND jsonb_typeof(claim_js_nn(lg.m -> 'refundAmount', lg.x -> 'refundAmount')) <> 'null'
        THEN claim_js_number(claim_js_nn(lg.m -> 'refundAmount', lg.x -> 'refundAmount'))
      END,
    claim_js_nn(lg.m -> 'refundAmount', lg.x -> 'refundAmount'),
    claim_js_text(lg.m -> 'orderNumber'),
    claim_js_text(lg.m -> 'customerName'),
    claim_js_text(lg.m -> 'customerPhone'),
    claim_js_text(lg.m -> 'productName'),
    claim_js_text(lg.m -> 'sku'),
    COALESCE(claim_js_text(lg.m -> 'defectReason'), NULLIF(c.problem_description, ''), '-'),
    claim_js_text(claim_js_nn(lg.m -> 'unitName', lg.x -> 'unitName')),
    claim_js_text(lg.m -> 'replacementUnitName'),
    claim_js_text(lg.m -> 'supplierId'),
    claim_js_text(lg.m -> 'supplierName'),
    CASE WHEN lg.m ? 'costPrice' THEN claim_js_number(lg.m -> 'costPrice') END
  FROM customer_claims c
  CROSS JOIN LATERAL (
    SELECT mx.m, mx.x, mx.x || mx.m AS xm FROM (
      SELECT COALESCE(claim_jsonb_merge(l.details ORDER BY l.created_at, l.id)
                        FILTER (WHERE l.action = 'CLAIM_META' AND jsonb_typeof(l.details) = 'object'), '{}') AS m,
             COALESCE(claim_jsonb_merge(l.details -> 'result' ORDER BY l.created_at, l.id)
                        FILTER (WHERE l.action = 'EXCHANGE' AND jsonb_typeof(l.details -> 'result') = 'object'), '{}') AS x
        FROM audit_logs l
       WHERE l.entity = 'CustomerClaim' AND l.entity_id = c.id AND l.action IN ('CLAIM_META', 'EXCHANGE')
    ) mx
  ) lg
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN claim_js_truthy(lg.m -> 'resolutionType') THEN lg.m ->> 'resolutionType'
           WHEN c.claim_type = 'REFUND' THEN 'REFUND_CASH'
           WHEN c.claim_type = 'EXCHANGE' THEN 'REPLACE_ITEM'
           ELSE 'SUPPLIER_RMA' END AS res_type,
      CASE WHEN claim_js_truthy(lg.m -> 'frontendStatus') THEN lg.m -> 'frontendStatus'
           WHEN claim_js_truthy(lg.m -> 'status') THEN lg.m -> 'status'
           WHEN claim_js_truthy(lg.xm -> 'claimStatus') THEN lg.xm -> 'claimStatus'
           ELSE to_jsonb(c.status::text) END AS raw
  ) st
  WHERE c.id = ANY(ids)
  ON CONFLICT (claim_id) DO UPDATE SET
    claim_key = EXCLUDED.claim_key, claim_date = EXCLUDED.claim_date, res_type = EXCLUDED.res_type, status = EXCLUDED.status,
    has_return_doc = EXCLUDED.has_return_doc, return_doc_id = EXCLUDED.return_doc_id, quantity = EXCLUDED.quantity,
    conversion_factor = EXCLUDED.conversion_factor, base_quantity = EXCLUDED.base_quantity, unit_price = EXCLUDED.unit_price,
    claim_value = EXCLUDED.claim_value, refund_amount = EXCLUDED.refund_amount, order_number = EXCLUDED.order_number,
    customer_name = EXCLUDED.customer_name, customer_phone = EXCLUDED.customer_phone, product_name = EXCLUDED.product_name,
    sku = EXCLUDED.sku, defect_reason = EXCLUDED.defect_reason, unit_name = EXCLUDED.unit_name,
    replacement_unit_name = EXCLUDED.replacement_unit_name, supplier_id = EXCLUDED.supplier_id,
    supplier_name = EXCLUDED.supplier_name, cost_price = EXCLUDED.cost_price;
END
$$;

CREATE FUNCTION claim_facts_on_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM claim_facts_refresh(ARRAY[NEW.id]);
  RETURN NULL;
END
$$;

CREATE FUNCTION claim_facts_on_audit_log() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[] := '{}';
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.entity = 'CustomerClaim' AND OLD.entity_id IS NOT NULL THEN ids := ids || OLD.entity_id; END IF;
  IF TG_OP <> 'DELETE' AND NEW.entity = 'CustomerClaim' AND NEW.entity_id IS NOT NULL THEN ids := ids || NEW.entity_id; END IF;
  IF cardinality(ids) > 0 THEN PERFORM claim_facts_refresh(ids); END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER customer_claims_facts AFTER INSERT OR UPDATE ON customer_claims
  FOR EACH ROW EXECUTE FUNCTION claim_facts_on_claim();
CREATE TRIGGER audit_logs_claim_facts_ins AFTER INSERT ON audit_logs
  FOR EACH ROW WHEN (NEW.entity = 'CustomerClaim' AND NEW.action IN ('CLAIM_META', 'EXCHANGE'))
  EXECUTE FUNCTION claim_facts_on_audit_log();
CREATE TRIGGER audit_logs_claim_facts_upd AFTER UPDATE ON audit_logs
  FOR EACH ROW WHEN ((OLD.entity = 'CustomerClaim' AND OLD.action IN ('CLAIM_META', 'EXCHANGE'))
                  OR (NEW.entity = 'CustomerClaim' AND NEW.action IN ('CLAIM_META', 'EXCHANGE')))
  EXECUTE FUNCTION claim_facts_on_audit_log();
CREATE TRIGGER audit_logs_claim_facts_del AFTER DELETE ON audit_logs
  FOR EACH ROW WHEN (OLD.entity = 'CustomerClaim' AND OLD.action IN ('CLAIM_META', 'EXCHANGE'))
  EXECUTE FUNCTION claim_facts_on_audit_log();

-- backfill
SELECT claim_facts_refresh(ARRAY(SELECT id FROM customer_claims));
ANALYZE claim_facts;

-- A claim as the pages see it (mapServerClaim fields): facts + the product / customer / bill fallbacks.
CREATE VIEW claim_records AS
SELECT
  f.claim_id,
  f.claim_key,
  c.received_date,
  c.product_id,
  c.customer_id,
  COALESCE(c.order_id, '') AS order_id,
  f.claim_date,
  f.res_type,
  f.status,
  f.has_return_doc,
  f.return_doc_id,
  f.quantity,
  f.conversion_factor,
  f.base_quantity,
  COALESCE(f.unit_price, COALESCE(p.price_level_1, p.base_price, 0)::double precision) AS unit_price,
  COALESCE(f.claim_value, COALESCE(f.unit_price, COALESCE(p.price_level_1, p.base_price, 0)::double precision) * f.quantity) AS total_claim_value,
  f.refund_amount,
  COALESCE(NULLIF(o.order_number, ''), f.order_number, '-') AS order_number,
  COALESCE(NULLIF(cu.name, ''), f.customer_name, 'ลูกค้าทั่วไป') AS customer_name,
  COALESCE(NULLIF(cu.phone, ''), f.customer_phone, '-') AS customer_phone,
  COALESCE(NULLIF(p.name, ''), f.product_name, 'สินค้า') AS product_name,
  COALESCE(NULLIF(p.sku, ''), f.sku, '-') AS sku,
  f.defect_reason,
  -- (unitName ?? product unit ?? 'ชิ้น') || store unit || 'ชิ้น' (a given but empty unit name falls back the same way)
  COALESCE(f.unit_name, NULLIF(p.unit, ''), 'ชิ้น') AS unit_name,
  f.replacement_unit_name,
  f.supplier_id,
  f.supplier_name,
  f.cost_price
FROM claim_facts f
JOIN customer_claims c ON c.id = f.claim_id
JOIN products p ON p.id = c.product_id
LEFT JOIN customers cu ON cu.id = c.customer_id
LEFT JOIN orders o ON o.id = c.order_id;
