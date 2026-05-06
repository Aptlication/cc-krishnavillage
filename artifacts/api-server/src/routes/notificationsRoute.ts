import { Router } from "express";
import webPush from "web-push";
import { db } from "@workspace/db";
import {
  guestRegistrationsTable,
  notificationsTable,
  staffPushSubscriptionsTable,
} from "@workspace/db/schema";
import { and, count, eq, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireStaffAuth, resolveTenant } from "../middlewares/staffAuth";
import type { TenantRequest, StaffRequest } from "../middlewares/staffAuth";

const notificationsRouter = Router();

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
  } catch (err) {
    logger.warn({ err }, "VAPID keys are invalid — web push disabled. Regenerate with web-push generate-vapid-keys.");
  }
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

async function sendExpoPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<number> {
  const expoTokens = tokens.filter(
    (t) => t.startsWith("ExponentPushToken") || t.startsWith("ExpoPushToken"),
  );
  if (expoTokens.length === 0) return 0;

  const messages = expoTokens.map((token) => ({
    to: token,
    sound: "default" as const,
    title,
    body,
    data: data ?? {},
    priority: "high" as const,
    channelId: "default",
  }));

  const chunks: typeof messages[] = [];
  for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));

  let successCount = 0;
  const receiptIds: string[] = [];

  for (const chunk of chunks) {
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, "Expo push send failed");
        continue;
      }
      const result = (await response.json()) as { data: ExpoPushTicket[] };
      const tickets = Array.isArray(result.data) ? result.data : [];
      for (const ticket of tickets) {
        if (ticket.status === "ok" && ticket.id) {
          successCount++;
          receiptIds.push(ticket.id);
        } else if (ticket.status === "error") {
          logger.warn({ message: ticket.message, details: ticket.details }, "Push ticket error");
        }
      }
    } catch (err) {
      logger.warn({ err }, "Error sending push chunk");
    }
  }

  if (receiptIds.length > 0) {
    setImmediate(async () => {
      try {
        const receiptChunks: string[][] = [];
        for (let i = 0; i < receiptIds.length; i += 300) receiptChunks.push(receiptIds.slice(i, i + 300));
        for (const chunk of receiptChunks) {
          const resp = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ ids: chunk }),
          });
          if (resp.ok) {
            const receiptsData = (await resp.json()) as { data: Record<string, ExpoPushReceipt> };
            for (const [id, receipt] of Object.entries(receiptsData.data ?? {})) {
              if (receipt.status === "error") {
                logger.warn({ id, message: receipt.message, details: receipt.details }, "Push receipt error");
              }
            }
          }
        }
      } catch (err) {
        logger.warn({ err }, "Error polling push receipts");
      }
    });
  }

  return successCount;
}

async function sendWebPushNotifications(
  subscriptions: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<number> {
  if (!vapidConfigured) return 0;
  let successCount = 0;
  const payload = JSON.stringify({ title, body, ...data });
  for (const subJson of subscriptions) {
    try {
      const subscription = JSON.parse(subJson) as webPush.PushSubscription;
      await webPush.sendNotification(subscription, payload);
      successCount++;
    } catch (err) {
      logger.warn({ err }, "Web push send failed");
    }
  }
  return successCount;
}

// ── VAPID public key (unauthenticated) ────────────────────────────────────────
notificationsRouter.get("/vapid-public-key", (_req, res) => {
  if (!vapidConfigured || !VAPID_PUBLIC_KEY) {
    res.status(503).json({ error: "Web push not configured" });
    return;
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ── Deprecated endpoint ───────────────────────────────────────────────────────
notificationsRouter.post("/notifications", (_req, res) => {
  res.status(410).json({
    error: "This endpoint has been removed. Use POST /api/notifications/send with a Bearer token instead.",
  });
});

// ── Staff: send notification ──────────────────────────────────────────────────
notificationsRouter.post("/notifications/send", requireStaffAuth, async (req, res) => {
  const staff = (req as unknown as StaffRequest).staff;
  const tenantId = (req as unknown as TenantRequest).tenantId;

  const body = req.body as {
    title?: string;
    body?: string;
    type?: string;
    targetRoom?: string;
  };
  const { title, body: msgBody, type, targetRoom } = body;

  if (!title || !msgBody || !type || !targetRoom) {
    res.status(400).json({ error: "title, body, type, and targetRoom are required" });
    return;
  }

  const validTypes = ["room_ready", "activity", "checkout_reminder", "general"];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
    return;
  }

  const guestConditions = [eq(guestRegistrationsTable.tenantId, tenantId)];
  if (targetRoom !== "all") {
    guestConditions.push(eq(guestRegistrationsTable.roomNumber, targetRoom));
  }

  const guests = await db
    .select()
    .from(guestRegistrationsTable)
    .where(and(...guestConditions));

  const pushData = { type, targetRoom };
  const expoTokens = guests.map((g) => g.pushToken);
  const webSubscriptions = guests
    .map((g) => g.webPushSubscription)
    .filter((s): s is string => s != null && s.length > 0);

  const [expoCount, webCount] = await Promise.all([
    sendExpoPushNotifications(expoTokens, title, msgBody, pushData),
    sendWebPushNotifications(webSubscriptions, title, msgBody, pushData),
  ]);

  const recipientCount = expoCount + webCount;

  const [notification] = await db
    .insert(notificationsTable)
    .values({
      title,
      body: msgBody,
      type,
      targetRoom,
      recipientCount,
      sentByStaffId: staff.staffId,
      sentByName: staff.displayName,
      tenantId,
    })
    .returning();

  res.status(201).json({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    type: notification.type,
    targetRoom: notification.targetRoom,
    sentAt: notification.sentAt.toISOString(),
    recipientCount: notification.recipientCount,
    sentByName: notification.sentByName ?? null,
  });
});

// ── Guest: notification count for this tenant ─────────────────────────────────
notificationsRouter.get("/notifications/count", resolveTenant, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;
  const [row] = await db
    .select({ value: count() })
    .from(notificationsTable)
    .where(eq(notificationsTable.tenantId, tenantId));
  res.json({ count: Number(row?.value ?? 0) });
});

// ── Guest: notifications for a specific room ──────────────────────────────────
notificationsRouter.get("/notifications", resolveTenant, async (req, res, next) => {
  const { roomNumber } = req.query;
  if (!roomNumber || typeof roomNumber !== "string") {
    next();
    return;
  }
  const tenantId = (req as unknown as TenantRequest).tenantId;
  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.tenantId, tenantId),
        or(
          eq(notificationsTable.targetRoom, roomNumber),
          eq(notificationsTable.targetRoom, "all"),
        ),
      ),
    )
    .orderBy(notificationsTable.sentAt);

  res.json(
    notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      targetRoom: n.targetRoom,
      sentAt: n.sentAt.toISOString(),
      recipientCount: n.recipientCount,
      sentByName: n.sentByName ?? null,
    })),
  );
});

// ── Staff: all notifications for this tenant ──────────────────────────────────
notificationsRouter.get("/notifications", requireStaffAuth, async (req, res) => {
  const tenantId = (req as unknown as TenantRequest).tenantId;
  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.tenantId, tenantId))
    .orderBy(notificationsTable.sentAt);

  res.json(
    notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      targetRoom: n.targetRoom,
      sentAt: n.sentAt.toISOString(),
      recipientCount: n.recipientCount,
      sentByName: n.sentByName ?? null,
    })),
  );
});

// ── Staff: register push subscription ─────────────────────────────────────────
notificationsRouter.post("/notifications/staff-subscribe", requireStaffAuth, async (req, res) => {
  const staff = (req as unknown as StaffRequest).staff;
  const tenantId = (req as unknown as TenantRequest).tenantId;
  const { subscription } = req.body as { subscription?: unknown };

  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) {
    res.status(400).json({ error: "subscription is required" });
    return;
  }

  const sub = subscription as { endpoint?: unknown };
  if (!sub.endpoint || typeof sub.endpoint !== "string") {
    res.status(400).json({ error: "subscription must include an endpoint" });
    return;
  }

  const endpoint = sub.endpoint;
  const subscriptionJson = JSON.stringify(subscription);

  await db
    .insert(staffPushSubscriptionsTable)
    .values({ staffId: staff.staffId, tenantId, endpoint, subscription: subscriptionJson })
    .onConflictDoUpdate({
      target: [staffPushSubscriptionsTable.staffId, staffPushSubscriptionsTable.endpoint],
      set: { subscription: subscriptionJson, tenantId },
    });

  res.status(201).json({ ok: true });
});

// ── Staff: unregister push subscription ───────────────────────────────────────
notificationsRouter.delete("/notifications/staff-subscribe", requireStaffAuth, async (req, res) => {
  const staff = (req as unknown as StaffRequest).staff;
  const { endpoint } = req.body as { endpoint?: string };

  if (!endpoint || typeof endpoint !== "string") {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }

  await db
    .delete(staffPushSubscriptionsTable)
    .where(
      and(
        eq(staffPushSubscriptionsTable.staffId, staff.staffId),
        eq(staffPushSubscriptionsTable.endpoint, endpoint),
      ),
    );

  res.json({ ok: true });
});

export default notificationsRouter;
