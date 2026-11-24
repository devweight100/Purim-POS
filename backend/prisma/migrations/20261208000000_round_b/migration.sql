-- Round B (docs/round-b.md): dashboard "due soon" window, LINE staff-group notifications for online orders.
-- Additive only: new columns have defaults / are nullable, new tables are empty.

-- dashboard: upcoming expenses / supplier bills within N days (default 7)
ALTER TABLE "store_settings" ADD COLUMN "dashboard_due_days" INTEGER NOT NULL DEFAULT 7;

-- LINE: channel secret (webhook signature), the staff group that gets new-order alerts, the bot's back-office link
ALTER TABLE "online_shop_config" ADD COLUMN "channel_secret" TEXT;
ALTER TABLE "online_shop_config" ADD COLUMN "staff_group_id" TEXT;
ALTER TABLE "online_shop_config" ADD COLUMN "back_office_url" TEXT;

-- groups the bot is in (captured from webhook join / message events)
CREATE TABLE "line_groups" (
    "group_id" TEXT NOT NULL,
    "name" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "line_groups_pkey" PRIMARY KEY ("group_id")
);

-- staff alert schedule per online order (DB-based: survives a restart). null = nothing more to send
ALTER TABLE "online_orders" ADD COLUMN "staff_alert_next_at" TIMESTAMP(3);
ALTER TABLE "online_orders" ADD COLUMN "staff_alert_count" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "online_orders_staff_alert_next_at_idx" ON "online_orders"("staff_alert_next_at");

-- every LINE send to the staff group (shown on the order)
CREATE TABLE "online_order_line_logs" (
    "id" TEXT NOT NULL,
    "online_order_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT,
    "ok" BOOLEAN NOT NULL,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "online_order_line_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "online_order_line_logs_online_order_id_created_at_idx" ON "online_order_line_logs"("online_order_id", "created_at");
ALTER TABLE "online_order_line_logs" ADD CONSTRAINT "online_order_line_logs_online_order_id_fkey" FOREIGN KEY ("online_order_id") REFERENCES "online_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
