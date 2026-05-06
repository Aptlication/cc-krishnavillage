import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const staffAccountsTable = pgTable("staff_accounts", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("housekeeper"),
  active: boolean("active").notNull().default(true),
  tenantId: integer("tenant_id").notNull().default(1),
  email: text("email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sessionsRevokedBefore: timestamp("sessions_revoked_before"),
}, (t) => [
  uniqueIndex("staff_accounts_email_tenant_idx").on(t.tenantId, t.email),
]);

export const insertStaffAccountSchema = createInsertSchema(staffAccountsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertStaffAccount = z.infer<typeof insertStaffAccountSchema>;
export type StaffAccount = typeof staffAccountsTable.$inferSelect;
