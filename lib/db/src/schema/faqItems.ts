import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const faqItemsTable = pgTable("faq_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FaqItem = typeof faqItemsTable.$inferSelect;
