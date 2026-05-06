import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const serviceAssetsTable = pgTable("service_assets", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  assetKey: text("asset_key").notNull(),
  url: text("url").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ServiceAsset = typeof serviceAssetsTable.$inferSelect;
