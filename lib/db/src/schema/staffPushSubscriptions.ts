import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";

export const staffPushSubscriptionsTable = pgTable(
  "staff_push_subscriptions",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull(),
    tenantId: integer("tenant_id").notNull().default(1),
    endpoint: text("endpoint").notNull(),
    subscription: text("subscription").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("staff_push_subscriptions_staff_endpoint_key").on(t.staffId, t.endpoint)],
);

export type StaffPushSubscription = typeof staffPushSubscriptionsTable.$inferSelect;
