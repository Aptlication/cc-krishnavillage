import { pgTable, text, serial, timestamp, json, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { staffAccountsTable } from "./staffAccounts";
import { maintenanceReportsTable } from "./maintenanceReports";

export const expenseClaimsTable = pgTable("expense_claims", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  staffId: integer("staff_id").notNull().references(() => staffAccountsTable.id),
  maintenanceReportId: integer("maintenance_report_id").references(() => maintenanceReportsTable.id),
  claimDate: text("claim_date").notNull(), // ISO date string e.g. "2026-05-02"
  description: text("description").notNull(),
  project: text("project"),
  amountAud: numeric("amount_aud", { precision: 10, scale: 2 }).notNull(),
  receiptUrls: json("receipt_urls").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("claimed"), // "claimed" | "in_progress" | "reimbursed" | "rejected"
  rejectionNote: text("rejection_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertExpenseClaimSchema = createInsertSchema(expenseClaimsTable).omit({
  id: true,
  createdAt: true,
  status: true,
  rejectionNote: true,
});
export type InsertExpenseClaim = z.infer<typeof insertExpenseClaimSchema>;
export type ExpenseClaim = typeof expenseClaimsTable.$inferSelect;
