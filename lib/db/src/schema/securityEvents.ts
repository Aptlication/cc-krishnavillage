import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { staffAccountsTable } from "./staffAccounts";

export const securityEventsTable = pgTable("security_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  eventType: text("event_type").notNull(),
  triggeredByStaffId: integer("triggered_by_staff_id").references(() => staffAccountsTable.id),
  triggeredByDisplayName: text("triggered_by_display_name"),
  targetStaffId: integer("target_staff_id").references(() => staffAccountsTable.id),
  targetStaffDisplayName: text("target_staff_display_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SecurityEvent = typeof securityEventsTable.$inferSelect;
