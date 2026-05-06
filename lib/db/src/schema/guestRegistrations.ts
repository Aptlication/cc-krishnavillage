import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const guestRegistrationsTable = pgTable("guest_registrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  roomNumber: text("room_number").notNull(),
  pushToken: text("push_token").notNull(),
  webPushSubscription: text("web_push_subscription"),
  tenantId: integer("tenant_id").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertGuestRegistrationSchema = createInsertSchema(guestRegistrationsTable).omit({ id: true, createdAt: true });
export type InsertGuestRegistration = z.infer<typeof insertGuestRegistrationSchema>;
export type GuestRegistration = typeof guestRegistrationsTable.$inferSelect;
