-- Claims of a bill: by order id (orders list include, GET /claims/claimed-orders) ...
CREATE INDEX "customer_claims_order_id_idx" ON "customer_claims"("order_id");

-- ... and by the bill number kept in the claim's CLAIM_META audit log (claims recorded by bill number have no
-- order id). Expression + partial index: not expressible in schema.prisma, kept here only (like the triggers).
CREATE INDEX "audit_logs_claim_meta_order_number_idx" ON "audit_logs" ((details ->> 'orderNumber'))
  WHERE entity = 'CustomerClaim' AND action = 'CLAIM_META';
