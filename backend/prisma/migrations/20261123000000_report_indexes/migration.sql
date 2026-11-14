-- Reports computed in PostgreSQL: period filters on audit_logs (P&L write-offs) and customer_claims (claim accounting)
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
CREATE INDEX "customer_claims_created_at_idx" ON "customer_claims"("created_at");
