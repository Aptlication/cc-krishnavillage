import { pgTable, serial, timestamp, integer, text, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { expenseClaimsTable } from "./expenseClaims";
import { staffAccountsTable } from "./staffAccounts";

export const expenseReimbursementsTable = pgTable(
  "expense_reimbursements",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().default(1),
    claimId: integer("claim_id").notNull().references(() => expenseClaimsTable.id),
    reimbursedByStaffId: integer("reimbursed_by_staff_id").notNull().references(() => staffAccountsTable.id),
    reimbursedAt: timestamp("reimbursed_at").notNull().defaultNow(),
    emailSent: boolean("email_sent").notNull().default(false),
    notes: text("notes"),
  },
  (t) => [
    // Enforce at most one reimbursement record per claim at the DB level,
    // preventing duplicate rows from concurrent reimburse requests.
    uniqueIndex("expense_reimbursements_claim_id_unique").on(t.claimId),
  ]
);

export type ExpenseReimbursement = typeof expenseReimbursementsTable.$inferSelect;
