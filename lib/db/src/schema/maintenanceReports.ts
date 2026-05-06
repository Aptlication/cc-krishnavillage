import { pgTable, text, serial, timestamp, json, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const maintenanceReportsTable = pgTable("maintenance_reports", {
  id: serial("id").primaryKey(),
  // Who raised the issue
  source: text("source").notNull().default("guest"), // "guest" | "staff"
  guestName: text("guest_name").notNull(),
  roomNumber: text("room_number").notNull(),
  openedByStaffId: integer("opened_by_staff_id"),
  openedByName: text("opened_by_name"),
  // Issue details
  title: text("title").notNull(),
  description: text("description").notNull(),
  urgency: text("urgency").notNull(), // "urgent" | "non_urgent"
  photos: json("photos").$type<string[]>(),
  // Lifecycle: open → in_progress → resolved
  status: text("status").notNull().default("open"), // "open" | "in_progress" | "resolved"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Acknowledged (in_progress)
  inProgressAt: timestamp("in_progress_at"),
  inProgressByStaffId: integer("in_progress_by_staff_id"),
  inProgressByName: text("in_progress_by_name"),
  inProgressNote: text("in_progress_note"), // e.g. "Assigned to plumber"
  // Resolved (sign-off)
  resolution: text("resolution"), // "actioned" | "delegated"
  resolvedByStaffId: integer("resolved_by_staff_id"),
  resolvedByName: text("resolved_by_name"),
  resolutionNote: text("resolution_note"),
  resolvedAt: timestamp("resolved_at"),
  resolutionNoteEditedByName: text("resolution_note_edited_by_name"),
  resolutionNoteEditedAt: timestamp("resolution_note_edited_at"),
  tenantId: integer("tenant_id").notNull().default(1),
});

export const insertMaintenanceReportSchema = createInsertSchema(maintenanceReportsTable).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
  resolvedByStaffId: true,
  resolvedByName: true,
  resolutionNote: true,
  status: true,
  resolution: true,
  inProgressAt: true,
  inProgressByStaffId: true,
  inProgressByName: true,
  inProgressNote: true,
  openedByStaffId: true,
  openedByName: true,
  source: true,
});

export type InsertMaintenanceReport = z.infer<typeof insertMaintenanceReportSchema>;
export type MaintenanceReport = typeof maintenanceReportsTable.$inferSelect;
