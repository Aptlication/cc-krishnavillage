import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sessionsRevokedBefore: timestamp("sessions_revoked_before"),
});

export type Tenant = typeof tenantsTable.$inferSelect;
