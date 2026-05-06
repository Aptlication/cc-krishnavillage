import webPush from "web-push";
import { db } from "@workspace/db";
import { staffPushSubscriptionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const VAPID_PUBLIC_KEY = process.env["VAPID_PUBLIC_KEY"];
const VAPID_PRIVATE_KEY = process.env["VAPID_PRIVATE_KEY"];

let vapidConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webPush.setVapidDetails(
      "mailto:notifications@krishnavillage.com.au",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    );
    vapidConfigured = true;
  } catch {
    // Already logged by notificationsRoute
  }
}

export async function sendStaffMaintenanceAlert(
  tenantId: number,
  roomNumber: string,
  title: string,
): Promise<void> {
  if (!vapidConfigured) return;

  const subscriptions = await db
    .select()
    .from(staffPushSubscriptionsTable)
    .where(eq(staffPushSubscriptionsTable.tenantId, tenantId));

  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: "Urgent Maintenance Request",
    body: `Room ${roomNumber}: ${title}`,
    type: "urgent_maintenance",
  });

  const staleIds: number[] = [];

  await Promise.all(
    subscriptions.map(async (row) => {
      try {
        const sub = JSON.parse(row.subscription) as webPush.PushSubscription;
        await webPush.sendNotification(sub, payload);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          staleIds.push(row.id);
        } else {
          logger.warn({ err }, "Staff web push send failed");
        }
      }
    }),
  );

  for (const id of staleIds) {
    try {
      await db
        .delete(staffPushSubscriptionsTable)
        .where(eq(staffPushSubscriptionsTable.id, id));
    } catch (err) {
      logger.warn({ err, id }, "Failed to delete stale staff push subscription");
    }
  }
}
